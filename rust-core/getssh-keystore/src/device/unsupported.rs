use super::Device;
use crate::crypto::Key32;
use crate::error::KsError;
use crate::keyring::DeviceKey;

/// Platforms without a device key backend: every device operation fails closed.
pub struct PlatformDevice;

impl Default for PlatformDevice {
    fn default() -> Self {
        Self::new()
    }
}

impl PlatformDevice {
    pub fn new() -> Self {
        PlatformDevice
    }
}

fn unavailable() -> KsError {
    KsError::Unavailable("no device key backend on this platform".into())
}

impl Device for PlatformDevice {
    fn create_quiet_key(&self) -> Result<DeviceKey, KsError> {
        Err(unavailable())
    }

    fn presence_supported(&self) -> bool {
        false
    }

    fn create_presence_key(&self, _reason: &str) -> Result<DeviceKey, KsError> {
        Err(unavailable())
    }

    fn encapsulate(&self, _key: &DeviceKey, _info: &[u8], _reason: &str) -> Result<(Key32, Vec<u8>), KsError> {
        Err(unavailable())
    }

    fn decapsulate(&self, _key: &DeviceKey, _blob: &[u8], _info: &[u8], _reason: &str) -> Result<Key32, KsError> {
        Err(unavailable())
    }

    fn verify_presence(&self, _reason: &str) -> Result<(), KsError> {
        Err(unavailable())
    }

    fn key_usable(&self, _key: &DeviceKey) -> Result<bool, KsError> {
        Err(unavailable())
    }

    fn delete_key(&self, _key: &DeviceKey) {}
}
