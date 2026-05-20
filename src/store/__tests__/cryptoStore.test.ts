import { describe, it, expect, beforeEach } from 'vitest';
import { useCryptoStore } from '../cryptoStore';

describe('useCryptoStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useCryptoStore.setState({
      cryptoMode: 'idle',
      masterPassword: '',
      encryptionDisabled: false,
      safeAction: 'none',
      safeOldPwd: '',
      safeNewPwd: '',
      safeError: '',
    });
  });

  it('should have correct initial state', () => {
    const state = useCryptoStore.getState();
    expect(state.cryptoMode).toBe('idle');
    expect(state.masterPassword).toBe('');
    expect(state.encryptionDisabled).toBe(false);
    expect(state.safeAction).toBe('none');
    expect(state.safeOldPwd).toBe('');
    expect(state.safeNewPwd).toBe('');
    expect(state.safeError).toBe('');
  });

  it('should update cryptoMode', () => {
    useCryptoStore.getState().setCryptoMode('locked');
    expect(useCryptoStore.getState().cryptoMode).toBe('locked');

    useCryptoStore.getState().setCryptoMode('setup');
    expect(useCryptoStore.getState().cryptoMode).toBe('setup');
  });

  it('should update masterPassword', () => {
    useCryptoStore.getState().setMasterPassword('secret123');
    expect(useCryptoStore.getState().masterPassword).toBe('secret123');
  });

  it('should update encryptionDisabled', () => {
    useCryptoStore.getState().setEncryptionDisabled(true);
    expect(useCryptoStore.getState().encryptionDisabled).toBe(true);

    useCryptoStore.getState().setEncryptionDisabled(false);
    expect(useCryptoStore.getState().encryptionDisabled).toBe(false);
  });

  it('should update safeAction', () => {
    useCryptoStore.getState().setSafeAction('change');
    expect(useCryptoStore.getState().safeAction).toBe('change');
  });

  it('should update safeOldPwd', () => {
    useCryptoStore.getState().setSafeOldPwd('oldpass');
    expect(useCryptoStore.getState().safeOldPwd).toBe('oldpass');
  });

  it('should update safeNewPwd', () => {
    useCryptoStore.getState().setSafeNewPwd('newpass');
    expect(useCryptoStore.getState().safeNewPwd).toBe('newpass');
  });

  it('should update safeError', () => {
    useCryptoStore.getState().setSafeError('Invalid password');
    expect(useCryptoStore.getState().safeError).toBe('Invalid password');
  });

  it('should reset safe form properties', () => {
    // Setup state
    useCryptoStore.setState({
      safeAction: 'change',
      safeOldPwd: 'old',
      safeNewPwd: 'new',
      safeError: 'error',
    });

    useCryptoStore.getState().resetSafeForm();

    const state = useCryptoStore.getState();
    expect(state.safeAction).toBe('none');
    expect(state.safeOldPwd).toBe('');
    expect(state.safeNewPwd).toBe('');
    expect(state.safeError).toBe('');
  });
});
