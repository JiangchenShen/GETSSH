//! Software stand-in for device keys, for tests. A FakeDevice with another `machine` secret
//! behaves like another computer: keys created elsewhere report DeviceKeyLost.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use super::Device;
use crate::crypto::{self, Key32};
use crate::error::KsError;
use crate::keyring::DeviceKey;

pub struct FakeDevice {
    machine: [u8; 32],
    pub presence: bool,
    pub prompts: AtomicUsize,
    pub cancel_next: AtomicBool,
    pub quiet_unavailable: AtomicBool,
    pub quiet_created: AtomicUsize,
    pub deleted: Mutex<Vec<String>>,
}

impl FakeDevice {
    pub fn new(machine: [u8; 32]) -> Self {
        FakeDevice {
            machine,
            presence: true,
            prompts: AtomicUsize::new(0),
            cancel_next: AtomicBool::new(false),
            quiet_unavailable: AtomicBool::new(false),
            quiet_created: AtomicUsize::new(0),
            deleted: Mutex::new(Vec::new()),
        }
    }

    pub fn prompts(&self) -> usize {
        self.prompts.load(Ordering::SeqCst)
    }

    fn machine_id(&self) -> String {
        crypto::to_hex(&crypto::hkdf32(&self.machine, b"fake", b"machine-id")[..8])
    }

    fn key(&self, backend: &str) -> DeviceKey {
        let mut params = BTreeMap::new();
        params.insert("machine".into(), self.machine_id());
        DeviceKey { id: crypto::random_id(), backend: backend.into(), params }
    }

    fn kek(&self, key: &DeviceKey, blob: &[u8], info: &[u8]) -> Result<Key32, KsError> {
        if key.params.get("machine") != Some(&self.machine_id()) {
            return Err(KsError::DeviceKeyLost);
        }
        let mut ikm = self.machine.to_vec();
        ikm.extend_from_slice(key.id.as_bytes());
        Ok(crypto::hkdf32(&ikm, blob, info))
    }

    fn prompt(&self) -> Result<(), KsError> {
        if !self.presence {
            return Err(KsError::Unavailable("no presence".into()));
        }
        self.prompts.fetch_add(1, Ordering::SeqCst);
        if self.cancel_next.swap(false, Ordering::SeqCst) {
            return Err(KsError::Cancelled);
        }
        Ok(())
    }
}

impl Device for FakeDevice {
    fn create_quiet_key(&self) -> Result<DeviceKey, KsError> {
        self.quiet_created.fetch_add(1, Ordering::SeqCst);
        Ok(self.key("fake-quiet"))
    }

    fn presence_supported(&self) -> bool {
        self.presence
    }

    fn create_presence_key(&self, _reason: &str) -> Result<DeviceKey, KsError> {
        if !self.presence {
            return Err(KsError::Unavailable("no presence".into()));
        }
        Ok(self.key("fake-presence"))
    }

    fn encapsulate(&self, key: &DeviceKey, info: &[u8], _reason: &str) -> Result<(Key32, Vec<u8>), KsError> {
        let blob = crypto::random_array::<16>().to_vec();
        let kek = self.kek(key, &blob, info)?;
        Ok((kek, blob))
    }

    fn decapsulate(&self, key: &DeviceKey, blob: &[u8], info: &[u8], _reason: &str) -> Result<Key32, KsError> {
        if key.backend == "fake-presence" {
            if key.params.get("machine") != Some(&self.machine_id()) {
                return Err(KsError::DeviceKeyLost);
            }
            self.prompt()?;
        } else if self.quiet_unavailable.load(Ordering::SeqCst) {
            return Err(KsError::Unavailable("transient".into()));
        }
        self.kek(key, blob, info)
    }

    fn verify_presence(&self, _reason: &str) -> Result<(), KsError> {
        self.prompt()
    }

    fn key_usable(&self, key: &DeviceKey) -> Result<bool, KsError> {
        if self.quiet_unavailable.load(Ordering::SeqCst) {
            return Err(KsError::Unavailable("transient".into()));
        }
        Ok(key.params.get("machine") == Some(&self.machine_id()))
    }

    fn delete_key(&self, key: &DeviceKey) {
        self.deleted.lock().unwrap().push(key.id.clone());
    }
}
