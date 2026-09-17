use super::{valid_profile_name, CleanupJournal, SandboxConfig, CONFIG_VERSION, MAX_CONFIG_BYTES};
use std::collections::BTreeSet;
use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{
    CloseHandle, DuplicateHandle, GetLastError, LocalFree, DUPLICATE_SAME_ACCESS, GENERIC_ALL,
    HANDLE, INVALID_HANDLE_VALUE, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, DENY_ACCESS, EXPLICIT_ACCESS_W,
    GRANT_ACCESS, REVOKE_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_USER, TRUSTEE_W,
};
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeleteAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
};
use windows_sys::Win32::Security::{
    DeriveCapabilitySidsFromName, FreeSid, ACL, DACL_SECURITY_INFORMATION, NO_INHERITANCE,
    PSECURITY_DESCRIPTOR, PSID, SECURITY_CAPABILITIES, SID_AND_ATTRIBUTES,
    SUB_CONTAINERS_AND_OBJECTS_INHERIT,
};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_APPEND_DATA, FILE_DELETE_CHILD, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE, FILE_WRITE_ATTRIBUTES, FILE_WRITE_DATA, FILE_WRITE_EA, WRITE_DAC,
    WRITE_OWNER,
};
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, JobObjectBasicUIRestrictions, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_BASIC_UI_RESTRICTIONS,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::SystemServices::{JOB_OBJECT_UILIMIT_ALL, SE_GROUP_ENABLED};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetCurrentProcess, GetCurrentProcessId,
    GetExitCodeProcess, InitializeProcThreadAttributeList, OpenProcess, ResumeThread,
    TerminateProcess, UpdateProcThreadAttribute, WaitForMultipleObjects, WaitForSingleObject,
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT,
    INFINITE, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, PROCESS_SYNCHRONIZE,
    PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_JOB_LIST, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
    STARTF_UNTRUSTEDSOURCE, STARTF_USESTDHANDLES, STARTUPINFOEXW,
};
use windows_sys::Win32::System::WindowsProgramming::PROCESS_CREATION_CHILD_PROCESS_RESTRICTED;

type Result<T> = std::result::Result<T, String>;

fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

fn wide_str(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn windows_error(context: &str) -> String {
    format!("{context} (Windows error {})", unsafe { GetLastError() })
}

fn failed_hresult(value: i32) -> bool {
    value < 0
}

struct OwnedHandle(HANDLE);

impl OwnedHandle {
    fn new(handle: HANDLE, context: &str) -> Result<Self> {
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            Err(windows_error(context))
        } else {
            Ok(Self(handle))
        }
    }

    fn raw(&self) -> HANDLE {
        self.0
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(self.0) };
        }
    }
}

struct Profile {
    name: Vec<u16>,
    sid: PSID,
}

impl Profile {
    fn create(name: &str, capabilities: &[SID_AND_ATTRIBUTES]) -> Result<Self> {
        let name_wide = wide_str(name);
        let display = wide_str("GETSSH isolated process");
        let description = wide_str("Temporary GETSSH AppContainer security boundary");
        let mut sid: PSID = null_mut();
        let result = unsafe {
            CreateAppContainerProfile(
                name_wide.as_ptr(),
                display.as_ptr(),
                description.as_ptr(),
                if capabilities.is_empty() {
                    null()
                } else {
                    capabilities.as_ptr()
                },
                capabilities.len() as u32,
                &mut sid,
            )
        };
        if failed_hresult(result) || sid.is_null() {
            return Err(format!(
                "CreateAppContainerProfile failed (HRESULT 0x{:08x})",
                result as u32
            ));
        }
        Ok(Self {
            name: name_wide,
            sid,
        })
    }
}

impl Drop for Profile {
    fn drop(&mut self) {
        unsafe {
            let result = DeleteAppContainerProfile(self.name.as_ptr());
            if failed_hresult(result) {
                eprintln!(
                    "GETSSH sandbox cleanup warning: DeleteAppContainerProfile failed (HRESULT 0x{:08x})",
                    result as u32
                );
            }
            if !self.sid.is_null() {
                FreeSid(self.sid);
            }
        }
    }
}

struct LocalAllocation(*mut c_void);

impl Drop for LocalAllocation {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { LocalFree(self.0) };
        }
    }
}

struct CapabilityAllocations {
    arrays: Vec<LocalAllocation>,
    sids: Vec<LocalAllocation>,
    values: Vec<SID_AND_ATTRIBUTES>,
}

impl CapabilityAllocations {
    fn for_network(enabled: bool) -> Result<Self> {
        let mut result = Self {
            arrays: Vec::new(),
            sids: Vec::new(),
            values: Vec::new(),
        };
        if !enabled {
            return Ok(result);
        }

        for capability_name in ["internetClient", "privateNetworkClientServer"] {
            let name = wide_str(capability_name);
            let mut group_array: *mut PSID = null_mut();
            let mut group_count = 0u32;
            let mut capability_array: *mut PSID = null_mut();
            let mut capability_count = 0u32;
            let ok = unsafe {
                DeriveCapabilitySidsFromName(
                    name.as_ptr(),
                    &mut group_array,
                    &mut group_count,
                    &mut capability_array,
                    &mut capability_count,
                )
            };
            if ok == 0 {
                return Err(windows_error("DeriveCapabilitySidsFromName failed"));
            }

            if !group_array.is_null() {
                for index in 0..group_count as usize {
                    let sid = unsafe { *group_array.add(index) };
                    if !sid.is_null() {
                        result.sids.push(LocalAllocation(sid));
                    }
                }
                result
                    .arrays
                    .push(LocalAllocation(group_array.cast::<c_void>()));
            }
            if !capability_array.is_null() {
                for index in 0..capability_count as usize {
                    let sid = unsafe { *capability_array.add(index) };
                    if !sid.is_null() {
                        result.values.push(SID_AND_ATTRIBUTES {
                            Sid: sid,
                            Attributes: SE_GROUP_ENABLED as u32,
                        });
                        result.sids.push(LocalAllocation(sid));
                    }
                }
                result
                    .arrays
                    .push(LocalAllocation(capability_array.cast::<c_void>()));
            }
        }
        if result.values.is_empty() {
            return Err("Windows did not derive the requested network capabilities".into());
        }
        Ok(result)
    }
}

#[derive(Clone, Copy)]
enum AccessChange {
    AllowRead,
    AllowReadWrite,
    Deny,
    Revoke,
}

fn update_path_acl(path: &Path, sid: PSID, change: AccessChange) -> Result<bool> {
    let path_wide = wide(path.as_os_str());
    let mut old_acl: *mut ACL = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    let get_result = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &mut old_acl,
            null_mut(),
            &mut descriptor,
        )
    };
    if get_result != 0 {
        return Err(format!(
            "GetNamedSecurityInfoW failed for {} (Windows error {})",
            path.display(),
            get_result
        ));
    }
    let descriptor_guard = LocalAllocation(descriptor.cast::<c_void>());

    if old_acl.is_null() {
        drop(descriptor_guard);
        return match change {
            // A null DACL already grants full access. Replacing it with one
            // package ACE would accidentally remove the owner's access, while
            // leaving it in place cannot enforce read-only or deny semantics.
            AccessChange::AllowReadWrite | AccessChange::Revoke => Ok(false),
            AccessChange::AllowRead | AccessChange::Deny => Err(format!(
                "cannot safely restrict a path with a null DACL: {}",
                path.display()
            )),
        };
    }

    let is_directory = path.is_dir();
    let inheritance = if is_directory {
        SUB_CONTAINERS_AND_OBJECTS_INHERIT
    } else {
        NO_INHERITANCE
    };
    let trustee = TRUSTEE_W {
        pMultipleTrustee: null_mut(),
        MultipleTrusteeOperation: 0,
        TrusteeForm: TRUSTEE_IS_SID,
        TrusteeType: TRUSTEE_IS_USER,
        ptstrName: sid.cast::<u16>(),
    };
    let entries = match change {
        AccessChange::AllowRead => vec![
            EXPLICIT_ACCESS_W {
                // Do not deny GENERIC_WRITE here. Windows maps SYNCHRONIZE into
                // both generic read and generic write, so that deny would also
                // make the path unreadable. Deny only the concrete mutation
                // rights, then grant the package read/execute access.
                grfAccessPermissions: FILE_WRITE_DATA
                    | FILE_APPEND_DATA
                    | FILE_WRITE_EA
                    | FILE_WRITE_ATTRIBUTES
                    | DELETE
                    | FILE_DELETE_CHILD
                    | WRITE_DAC
                    | WRITE_OWNER,
                grfAccessMode: DENY_ACCESS,
                grfInheritance: inheritance,
                Trustee: trustee,
            },
            EXPLICIT_ACCESS_W {
                grfAccessPermissions: FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
                grfAccessMode: GRANT_ACCESS,
                grfInheritance: inheritance,
                Trustee: trustee,
            },
        ],
        AccessChange::AllowReadWrite => vec![EXPLICIT_ACCESS_W {
            grfAccessPermissions: FILE_GENERIC_READ
                | FILE_GENERIC_WRITE
                | FILE_GENERIC_EXECUTE
                | DELETE
                | FILE_DELETE_CHILD,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: inheritance,
            Trustee: trustee,
        }],
        AccessChange::Deny => vec![EXPLICIT_ACCESS_W {
            grfAccessPermissions: GENERIC_ALL,
            grfAccessMode: DENY_ACCESS,
            grfInheritance: inheritance,
            Trustee: trustee,
        }],
        AccessChange::Revoke => vec![EXPLICIT_ACCESS_W {
            grfAccessPermissions: 0,
            grfAccessMode: REVOKE_ACCESS,
            grfInheritance: inheritance,
            Trustee: trustee,
        }],
    };
    let mut new_acl: *mut ACL = null_mut();
    let acl_result = unsafe {
        SetEntriesInAclW(
            entries.len() as u32,
            entries.as_ptr(),
            old_acl,
            &mut new_acl,
        )
    };
    if acl_result != 0 || new_acl.is_null() {
        drop(descriptor_guard);
        return Err(format!(
            "SetEntriesInAclW failed for {} (Windows error {})",
            path.display(),
            acl_result
        ));
    }
    let new_acl_guard = LocalAllocation(new_acl.cast::<c_void>());
    let set_result = unsafe {
        SetNamedSecurityInfoW(
            path_wide.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            new_acl,
            null_mut(),
        )
    };
    drop(new_acl_guard);
    drop(descriptor_guard);
    if set_result != 0 {
        return Err(format!(
            "SetNamedSecurityInfoW failed for {} (Windows error {})",
            path.display(),
            set_result
        ));
    }
    Ok(true)
}

struct AclLease {
    sid: PSID,
    applied: Vec<PathBuf>,
}

impl AclLease {
    fn new(sid: PSID) -> Self {
        Self {
            sid,
            applied: Vec::new(),
        }
    }

    fn apply(&mut self, path: &Path, change: AccessChange) -> Result<()> {
        if update_path_acl(path, self.sid, change)? {
            self.applied.push(path.to_path_buf());
        }
        Ok(())
    }

    fn revoke_all(&mut self) -> bool {
        let mut failed = Vec::new();
        for path in std::mem::take(&mut self.applied).into_iter().rev() {
            if let Err(error) = update_path_acl(&path, self.sid, AccessChange::Revoke) {
                eprintln!("GETSSH sandbox cleanup warning: {error}");
                failed.push(path);
            }
        }
        self.applied = failed;
        self.applied.is_empty()
    }
}

impl Drop for AclLease {
    fn drop(&mut self) {
        let _ = self.revoke_all();
    }
}

fn derive_profile_sid(profile_name: &str) -> Result<PSID> {
    let profile = wide_str(profile_name);
    let mut sid: PSID = null_mut();
    let result = unsafe { DeriveAppContainerSidFromAppContainerName(profile.as_ptr(), &mut sid) };
    if failed_hresult(result) || sid.is_null() {
        Err(format!(
            "DeriveAppContainerSidFromAppContainerName failed (HRESULT 0x{:08x})",
            result as u32
        ))
    } else {
        Ok(sid)
    }
}

fn process_is_running(pid: u32) -> bool {
    let Ok(handle) = OwnedHandle::new(
        unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) },
        "OpenProcess failed",
    ) else {
        return false;
    };
    unsafe { WaitForSingleObject(handle.raw(), 0) == WAIT_TIMEOUT }
}

fn cleanup_stale_journals(journal_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(journal_dir) else {
        return;
    };
    for entry in entries.flatten().take(256) {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(journal) = serde_json::from_slice::<CleanupJournal>(&bytes) else {
            continue;
        };
        if journal.version != CONFIG_VERSION
            || !valid_profile_name(&journal.profile_name)
            || journal.launcher_pid == 0
            || journal.paths.len() > 384
            || journal
                .paths
                .iter()
                .any(|candidate| !candidate.is_absolute())
            || process_is_running(journal.launcher_pid)
        {
            continue;
        }

        let mut acl_cleanup_complete = false;
        if let Ok(sid) = derive_profile_sid(&journal.profile_name) {
            acl_cleanup_complete = true;
            for candidate in journal.paths.iter().rev() {
                if candidate.exists()
                    && update_path_acl(candidate, sid, AccessChange::Revoke).is_err()
                {
                    acl_cleanup_complete = false;
                }
            }
            unsafe { FreeSid(sid) };
        }
        let name = wide_str(&journal.profile_name);
        unsafe { DeleteAppContainerProfile(name.as_ptr()) };
        if acl_cleanup_complete {
            let _ = std::fs::remove_file(path);
        }
    }
}

struct JournalFile {
    path: PathBuf,
    remove_on_drop: bool,
}

impl JournalFile {
    fn create(config: &SandboxConfig, paths: Vec<PathBuf>) -> Result<Self> {
        let final_path = config
            .journal_dir
            .join(format!("{}.json", config.profile_name));
        let temporary_path = config.journal_dir.join(format!(
            "{}.{}.tmp",
            config.profile_name,
            GetCurrentProcessId_safe()
        ));
        let journal = CleanupJournal {
            version: CONFIG_VERSION,
            launcher_pid: GetCurrentProcessId_safe(),
            profile_name: config.profile_name.clone(),
            paths,
        };
        let bytes = serde_json::to_vec(&journal)
            .map_err(|error| format!("cannot encode sandbox cleanup journal: {error}"))?;
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        let mut file = options
            .open(&temporary_path)
            .map_err(|error| format!("cannot create sandbox cleanup journal: {error}"))?;
        use std::io::Write;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("cannot persist sandbox cleanup journal: {error}"))?;
        std::fs::rename(&temporary_path, &final_path)
            .map_err(|error| format!("cannot publish sandbox cleanup journal: {error}"))?;
        Ok(Self {
            path: final_path,
            remove_on_drop: false,
        })
    }

    fn mark_acl_cleanup_complete(&mut self) {
        self.remove_on_drop = true;
    }
}

impl Drop for JournalFile {
    fn drop(&mut self) {
        if self.remove_on_drop {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[allow(non_snake_case)]
fn GetCurrentProcessId_safe() -> u32 {
    unsafe { GetCurrentProcessId() }
}

struct AttributeList {
    storage: Vec<usize>,
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
}

impl AttributeList {
    fn new(count: u32) -> Result<Self> {
        let mut bytes = 0usize;
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), count, 0, &mut bytes);
        }
        if bytes == 0 {
            return Err(windows_error(
                "InitializeProcThreadAttributeList did not report a size",
            ));
        }
        let words = bytes.div_ceil(size_of::<usize>());
        let mut storage = vec![0usize; words];
        let pointer = storage.as_mut_ptr().cast::<c_void>();
        let ok = unsafe { InitializeProcThreadAttributeList(pointer, count, 0, &mut bytes) };
        if ok == 0 {
            return Err(windows_error("InitializeProcThreadAttributeList failed"));
        }
        Ok(Self { storage, pointer })
    }

    fn update<T>(&mut self, attribute: usize, value: &T) -> Result<()> {
        let ok = unsafe {
            UpdateProcThreadAttribute(
                self.pointer,
                0,
                attribute,
                (value as *const T).cast::<c_void>(),
                size_of::<T>(),
                null_mut(),
                null(),
            )
        };
        if ok == 0 {
            Err(windows_error("UpdateProcThreadAttribute failed"))
        } else {
            Ok(())
        }
    }
}

impl Drop for AttributeList {
    fn drop(&mut self) {
        let _keep_storage_alive = self.storage.len();
        unsafe { DeleteProcThreadAttributeList(self.pointer) };
    }
}

fn duplicate_standard_handle(kind: u32) -> Result<OwnedHandle> {
    let source = unsafe { GetStdHandle(kind) };
    if source.is_null() || source == INVALID_HANDLE_VALUE {
        return Err(windows_error("GETSSH sandbox has no valid standard handle"));
    }
    let current = unsafe { GetCurrentProcess() };
    let mut duplicate: HANDLE = null_mut();
    let ok = unsafe {
        DuplicateHandle(
            current,
            source,
            current,
            &mut duplicate,
            0,
            1,
            DUPLICATE_SAME_ACCESS,
        )
    };
    if ok == 0 {
        Err(windows_error("DuplicateHandle failed"))
    } else {
        OwnedHandle::new(duplicate, "DuplicateHandle returned an invalid handle")
    }
}

fn quote_windows_argument(value: &str) -> String {
    let mut quoted = String::from("\"");
    let mut backslashes = 0usize;
    for character in value.chars() {
        if character == '\\' {
            backslashes += 1;
            continue;
        }
        if character == '"' {
            quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
            quoted.push('"');
        } else {
            quoted.push_str(&"\\".repeat(backslashes));
            quoted.push(character);
        }
        backslashes = 0;
    }
    quoted.push_str(&"\\".repeat(backslashes * 2));
    quoted.push('"');
    quoted
}

fn build_command_line(config: &SandboxConfig) -> Result<Vec<u16>> {
    let mut parts = Vec::with_capacity(config.args.len() + 1);
    parts.push(quote_windows_argument(&config.command.to_string_lossy()));
    parts.extend(
        config
            .args
            .iter()
            .map(|value| quote_windows_argument(value)),
    );
    let command_line = parts.join(" ");
    let encoded = wide_str(&command_line);
    if encoded.len() > 32_767 {
        Err("Windows sandbox command line exceeds 32,767 UTF-16 code units".into())
    } else {
        Ok(encoded)
    }
}

fn build_environment(config: &SandboxConfig) -> Result<Vec<u16>> {
    let mut entries: Vec<_> = config.env.iter().collect();
    entries.sort_by(|(left, _), (right, _)| {
        left.to_ascii_uppercase().cmp(&right.to_ascii_uppercase())
    });
    let mut block = Vec::new();
    for (key, value) in entries {
        block.extend(format!("{key}={value}").encode_utf16());
        block.push(0);
    }
    block.push(0);
    if block.len() == 1 {
        block.push(0);
    }
    if block.len() > 1024 * 1024 {
        Err("Windows sandbox environment exceeds 1 MiB".into())
    } else {
        Ok(block)
    }
}

fn configure_job(max_processes: u32) -> Result<OwnedHandle> {
    let job = OwnedHandle::new(
        unsafe { CreateJobObjectW(null(), null()) },
        "CreateJobObjectW failed",
    )?;
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    limits.BasicLimitInformation.ActiveProcessLimit = max_processes;
    let ok = unsafe {
        SetInformationJobObject(
            job.raw(),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast::<c_void>(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if ok == 0 {
        return Err(windows_error("cannot set GETSSH sandbox job limits"));
    }

    let ui = JOBOBJECT_BASIC_UI_RESTRICTIONS {
        UIRestrictionsClass: JOB_OBJECT_UILIMIT_ALL,
    };
    let ok = unsafe {
        SetInformationJobObject(
            job.raw(),
            JobObjectBasicUIRestrictions,
            (&ui as *const JOBOBJECT_BASIC_UI_RESTRICTIONS).cast::<c_void>(),
            size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32,
        )
    };
    if ok == 0 {
        return Err(windows_error(
            "cannot set GETSSH sandbox user-interface limits",
        ));
    }
    Ok(job)
}

fn launch_target(
    config: &SandboxConfig,
    profile: &Profile,
    capabilities: &mut CapabilityAllocations,
) -> Result<u32> {
    let parent = OwnedHandle::new(
        unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, config.parent_pid) },
        "cannot monitor the GETSSH parent process",
    )?;
    let stdin = duplicate_standard_handle(STD_INPUT_HANDLE)?;
    let stdout = duplicate_standard_handle(STD_OUTPUT_HANDLE)?;
    let stderr = duplicate_standard_handle(STD_ERROR_HANDLE)?;
    let mut inherited_handles = [stdin.raw(), stdout.raw(), stderr.raw()];
    let job = configure_job(config.max_processes)?;
    let mut job_handles = [job.raw()];

    let security_capabilities = SECURITY_CAPABILITIES {
        AppContainerSid: profile.sid,
        Capabilities: if capabilities.values.is_empty() {
            null_mut()
        } else {
            capabilities.values.as_mut_ptr()
        },
        CapabilityCount: capabilities.values.len() as u32,
        Reserved: 0,
    };
    let attribute_count = if config.allow_child_processes { 3 } else { 4 };
    let mut attributes = AttributeList::new(attribute_count)?;
    attributes.update(
        PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
        &security_capabilities,
    )?;
    let handles_pointer = inherited_handles.as_mut_ptr();
    let ok = unsafe {
        UpdateProcThreadAttribute(
            attributes.pointer,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            handles_pointer.cast::<c_void>(),
            size_of::<HANDLE>() * inherited_handles.len(),
            null_mut(),
            null(),
        )
    };
    if ok == 0 {
        return Err(windows_error(
            "cannot restrict inherited handles for the sandbox target",
        ));
    }
    let ok = unsafe {
        UpdateProcThreadAttribute(
            attributes.pointer,
            0,
            PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
            job_handles.as_mut_ptr().cast::<c_void>(),
            size_of::<HANDLE>() * job_handles.len(),
            null_mut(),
            null(),
        )
    };
    if ok == 0 {
        return Err(windows_error(
            "cannot assign the sandbox target to its job at creation",
        ));
    }
    let child_policy = PROCESS_CREATION_CHILD_PROCESS_RESTRICTED;
    if !config.allow_child_processes {
        attributes.update(
            PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY as usize,
            &child_policy,
        )?;
    }

    let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES | STARTF_UNTRUSTEDSOURCE;
    startup.StartupInfo.hStdInput = stdin.raw();
    startup.StartupInfo.hStdOutput = stdout.raw();
    startup.StartupInfo.hStdError = stderr.raw();
    startup.lpAttributeList = attributes.pointer;

    let application = wide(config.command.as_os_str());
    let cwd = wide(config.cwd.as_os_str());
    let mut command_line = build_command_line(config)?;
    let environment = build_environment(config)?;
    let mut process_info: PROCESS_INFORMATION = unsafe { zeroed() };
    let creation_flags = CREATE_SUSPENDED
        | CREATE_UNICODE_ENVIRONMENT
        | EXTENDED_STARTUPINFO_PRESENT
        | CREATE_NO_WINDOW;
    let created = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            null(),
            null(),
            1,
            creation_flags,
            environment.as_ptr().cast::<c_void>(),
            cwd.as_ptr(),
            (&startup as *const STARTUPINFOEXW).cast(),
            &mut process_info,
        )
    };
    if created == 0 {
        return Err(windows_error(
            "CreateProcessW refused the AppContainer target",
        ));
    }
    let process = OwnedHandle::new(process_info.hProcess, "CreateProcessW returned no process")?;
    let thread = match OwnedHandle::new(process_info.hThread, "CreateProcessW returned no thread") {
        Ok(thread) => thread,
        Err(error) => {
            unsafe { TerminateProcess(process.raw(), 125) };
            return Err(error);
        }
    };
    if unsafe { ResumeThread(thread.raw()) } == u32::MAX {
        unsafe { TerminateJobObject(job.raw(), 125) };
        return Err(windows_error("ResumeThread failed for sandbox target"));
    }

    let handles = [process.raw(), parent.raw()];
    let wait_result = unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, INFINITE) };
    if wait_result == WAIT_FAILED {
        unsafe { TerminateJobObject(job.raw(), 125) };
        return Err(windows_error("WaitForMultipleObjects failed"));
    }
    if wait_result == WAIT_OBJECT_0 + 1 {
        unsafe { TerminateJobObject(job.raw(), 125) };
        let _ = unsafe { WaitForSingleObject(process.raw(), 5_000) };
        return Err("GETSSH parent process exited before the sandbox target".into());
    }
    if wait_result != WAIT_OBJECT_0 {
        unsafe { TerminateJobObject(job.raw(), 125) };
        return Err(format!("unexpected Windows wait result {wait_result}"));
    }

    let mut exit_code = 125u32;
    if unsafe { GetExitCodeProcess(process.raw(), &mut exit_code) } == 0 {
        return Err(windows_error("GetExitCodeProcess failed"));
    }
    // A malicious MCP server may leave descendants behind after its protocol
    // process exits. End the whole job before revoking its filesystem grants.
    unsafe { TerminateJobObject(job.raw(), exit_code) };
    Ok(exit_code)
}

pub(super) fn run(config: SandboxConfig) -> Result<u32> {
    if config.parent_pid == GetCurrentProcessId_safe() {
        return Err("parentPid cannot identify the sandbox launcher itself".into());
    }
    cleanup_stale_journals(&config.journal_dir);

    let mut capabilities = CapabilityAllocations::for_network(config.network)?;
    let profile = Profile::create(&config.profile_name, &capabilities.values)?;
    let mut all_paths = Vec::new();
    let mut seen = BTreeSet::new();
    for candidate in config
        .readonly_paths
        .iter()
        .chain(config.readwrite_paths.iter())
        .chain(config.denied_paths.iter())
    {
        let key = candidate.to_string_lossy().to_ascii_lowercase();
        if seen.insert(key) {
            all_paths.push(candidate.clone());
        }
    }
    let mut journal = JournalFile::create(&config, all_paths)?;
    let mut lease = AclLease::new(profile.sid);
    for candidate in &config.readonly_paths {
        lease.apply(candidate, AccessChange::AllowRead)?;
    }
    for candidate in &config.readwrite_paths {
        lease.apply(candidate, AccessChange::AllowReadWrite)?;
    }
    for candidate in &config.denied_paths {
        lease.apply(candidate, AccessChange::Deny)?;
    }

    let result = launch_target(&config, &profile, &mut capabilities);
    if lease.revoke_all() {
        journal.mark_acl_cleanup_complete();
    }
    drop(lease);
    drop(journal);
    drop(profile);
    result
}

#[cfg(test)]
mod tests {
    use super::quote_windows_argument;

    #[test]
    fn quotes_empty_spaces_quotes_and_trailing_backslashes() {
        assert_eq!(quote_windows_argument(""), "\"\"");
        assert_eq!(quote_windows_argument("plain"), "\"plain\"");
        assert_eq!(quote_windows_argument("two words"), "\"two words\"");
        assert_eq!(quote_windows_argument("a\\\"b"), "\"a\\\\\\\"b\"");
        assert_eq!(quote_windows_argument("C:\\dir\\"), "\"C:\\dir\\\\\"");
    }
}
