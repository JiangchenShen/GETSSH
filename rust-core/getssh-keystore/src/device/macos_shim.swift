// Thin C-callable layer over CryptoKit's Secure Enclave, LocalAuthentication and the login
// Keychain, linked into the Rust keystore by build.rs. No certificate is involved: Secure Enclave
// keys are not stored in the Keychain; their handle (dataRepresentation) is an enclave-encrypted
// blob that only this Mac's enclave can load, kept in keyring.json.
//
// Every function returns one of the GK_* codes below. Functions that may prompt block on a
// semaphore and must never run on the main thread (the keystore calls them from libuv workers).
//
// Only handles created by gk_se_create and checked by the Rust side (checksum, DER framing) may
// reach the enclave: a malformed handle can crash CryptoKit or even panic the Secure Enclave
// firmware (seen on macOS 27.0, "SEP Panic: sks"). The public key embedded in a handle is not
// authenticated, so this file never reads it from a loaded handle.

import CryptoKit
import Foundation
import LocalAuthentication
import Security

private let GK_OK: Int32 = 0
private let GK_CANCELLED: Int32 = 1
private let GK_UNAVAILABLE: Int32 = 2
private let GK_LOST: Int32 = 3
private let GK_ERROR: Int32 = 4
private let GK_BUFFER: Int32 = 5

private let keychainService = "GETSSH Keystore"

private func presenceAccessControl() -> SecAccessControl? {
    SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], nil)
}

private func quietAccessControl() -> SecAccessControl? {
    SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, [.privateKeyUsage], nil)
}

private func laCode(_ error: Error?) -> Int32 {
    guard let error = error as? LAError else { return GK_ERROR }
    switch error.code {
    case .userCancel, .appCancel, .systemCancel, .userFallback, .authenticationFailed:
        return GK_CANCELLED
    case .passcodeNotSet, .notInteractive, .biometryNotAvailable, .biometryNotEnrolled, .biometryLockout:
        return GK_UNAVAILABLE
    default:
        return GK_ERROR
    }
}

/// Runs an LAContext call with a completion handler and waits for it.
private func wait(_ start: (@escaping (Bool, Error?) -> Void) -> Void) -> Int32 {
    let done = DispatchSemaphore(value: 0)
    var outcome: Int32 = GK_ERROR
    start { success, error in
        outcome = success ? GK_OK : laCode(error)
        done.signal()
    }
    done.wait()
    return outcome
}

private func cString(_ pointer: UnsafePointer<CChar>?, fallback: String) -> String {
    guard let pointer = pointer else { return fallback }
    let value = String(cString: pointer)
    return value.isEmpty ? fallback : value
}

@_cdecl("gk_se_available")
public func gk_se_available() -> Bool {
    SecureEnclave.isAvailable
}

@_cdecl("gk_la_available")
public func gk_la_available() -> Bool {
    var error: NSError?
    return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
}

/// Creates a Secure Enclave P-256 key-agreement key. With `presence`, every use needs Touch ID or
/// the login password. Creating either kind never prompts.
@_cdecl("gk_se_create")
public func gk_se_create(
    _ presence: Bool,
    _ handleOut: UnsafeMutablePointer<UInt8>,
    _ handleCap: Int,
    _ handleLen: UnsafeMutablePointer<Int>,
    _ publicOut: UnsafeMutablePointer<UInt8>
) -> Int32 {
    guard SecureEnclave.isAvailable else { return GK_UNAVAILABLE }
    guard let access = presence ? presenceAccessControl() : quietAccessControl() else { return GK_ERROR }
    do {
        let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
        let handle = key.dataRepresentation
        let publicKey = key.publicKey.x963Representation
        guard handle.count <= handleCap, publicKey.count == 65 else { return GK_BUFFER }
        handle.copyBytes(to: handleOut, count: handle.count)
        publicKey.copyBytes(to: publicOut, count: 65)
        handleLen.pointee = handle.count
        return GK_OK
    } catch {
        // Keys usable only while the Mac is unlocked cannot be made while the screen is locked.
        return (error as NSError).code == Int(errSecInteractionNotAllowed) ? GK_UNAVAILABLE : GK_ERROR
    }
}

/// ECDH between an enclave key and `peer` (65-byte X9.63). For presence keys the user is verified
/// first with `reason` in the system sheet; the authenticated context is then used for the key so
/// the user is asked only once.
@_cdecl("gk_se_ecdh")
public func gk_se_ecdh(
    _ handle: UnsafePointer<UInt8>,
    _ handleLen: Int,
    _ peer: UnsafePointer<UInt8>,
    _ presence: Bool,
    _ reason: UnsafePointer<CChar>?,
    _ secretOut: UnsafeMutablePointer<UInt8>
) -> Int32 {
    guard SecureEnclave.isAvailable else { return GK_LOST }
    guard let peerKey = try? P256.KeyAgreement.PublicKey(x963Representation: Data(bytes: peer, count: 65)) else {
        return GK_ERROR
    }
    let context = LAContext()
    if presence {
        guard let access = presenceAccessControl() else { return GK_ERROR }
        let text = cString(reason, fallback: "unlock GETSSH")
        let outcome = wait { reply in
            context.evaluateAccessControl(access, operation: .useKeyKeyExchange, localizedReason: text, reply: reply)
        }
        if outcome != GK_OK { return outcome }
    } else {
        // A quiet key must never show UI; fail instead of prompting if the enclave asks.
        context.interactionNotAllowed = true
    }
    let key: SecureEnclave.P256.KeyAgreement.PrivateKey
    do {
        key = try SecureEnclave.P256.KeyAgreement.PrivateKey(
            dataRepresentation: Data(bytes: handle, count: handleLen),
            authenticationContext: context
        )
    } catch {
        return GK_LOST
    }
    do {
        let shared = try key.sharedSecretFromKeyAgreement(with: peerKey)
        return shared.withUnsafeBytes { raw -> Int32 in
            guard raw.count == 32, let base = raw.baseAddress else { return GK_ERROR }
            secretOut.update(from: base.assumingMemoryBound(to: UInt8.self), count: 32)
            return GK_OK
        }
    } catch {
        return presence ? GK_CANCELLED : GK_UNAVAILABLE
    }
}

/// Asks the user for Touch ID or the login password.
@_cdecl("gk_la_verify")
public func gk_la_verify(_ reason: UnsafePointer<CChar>?) -> Int32 {
    let context = LAContext()
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return GK_UNAVAILABLE }
    let text = cString(reason, fallback: "verify it is you")
    return wait { reply in
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: text, reply: reply)
    }
}

// Login Keychain fallback for Macs without a Secure Enclave (Intel Macs without a T2 chip).

private func keychainQuery(_ account: String) -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keychainService,
        kSecAttrAccount as String: account,
    ]
}

private func keychainCode(_ status: OSStatus) -> Int32 {
    switch status {
    case errSecSuccess: return GK_OK
    case errSecItemNotFound: return GK_LOST
    case errSecUserCanceled, errSecAuthFailed: return GK_CANCELLED
    case errSecInteractionNotAllowed, errSecNotAvailable: return GK_UNAVAILABLE
    default: return GK_ERROR
    }
}

@_cdecl("gk_kc_store")
public func gk_kc_store(_ account: UnsafePointer<CChar>, _ secret: UnsafePointer<UInt8>, _ length: Int) -> Int32 {
    var query = keychainQuery(String(cString: account))
    query[kSecValueData as String] = Data(bytes: secret, count: length)
    query[kSecAttrLabel as String] = keychainService
    return keychainCode(SecItemAdd(query as CFDictionary, nil))
}

@_cdecl("gk_kc_load")
public func gk_kc_load(
    _ account: UnsafePointer<CChar>,
    _ out: UnsafeMutablePointer<UInt8>,
    _ capacity: Int,
    _ outLen: UnsafeMutablePointer<Int>
) -> Int32 {
    var query = keychainQuery(String(cString: account))
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else { return keychainCode(status) }
    guard var data = item as? Data else { return GK_ERROR }
    defer { data.resetBytes(in: 0..<data.count) }
    guard data.count <= capacity else { return GK_BUFFER }
    data.copyBytes(to: out, count: data.count)
    outLen.pointee = data.count
    return GK_OK
}

/// Whether the item exists; reads attributes only, so it never shows the Keychain access dialog.
@_cdecl("gk_kc_exists")
public func gk_kc_exists(_ account: UnsafePointer<CChar>) -> Int32 {
    var query = keychainQuery(String(cString: account))
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    return keychainCode(SecItemCopyMatching(query as CFDictionary, &item))
}

@_cdecl("gk_kc_delete")
public func gk_kc_delete(_ account: UnsafePointer<CChar>) -> Int32 {
    keychainCode(SecItemDelete(keychainQuery(String(cString: account)) as CFDictionary))
}
