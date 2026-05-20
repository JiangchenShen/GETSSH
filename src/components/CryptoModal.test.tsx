// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CryptoModal } from './CryptoModal';

describe('CryptoModal', () => {
  const mockOnUnlock = vi.fn();
  const mockOnSetup = vi.fn();
  const mockOnCancel = vi.fn();
  const mockOnSkip = vi.fn();
  const mockOnRetryBiometric = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mode: locked', () => {
    it('renders the unlock title and description', () => {
      render(
        <CryptoModal
          mode="locked"
          isDark={false}
          onUnlock={mockOnUnlock}
          onSetup={mockOnSetup}
        />
      );

      expect(screen.getByText('Zero-Knowledge Storage Locked')).toBeDefined();
      expect(screen.getByText(/Your SSH profiles are locally encrypted/)).toBeDefined();
    });

    it('calls onUnlock with the entered password', async () => {
      mockOnUnlock.mockResolvedValueOnce(true);

      render(
        <CryptoModal
          mode="locked"
          isDark={false}
          onUnlock={mockOnUnlock}
          onSetup={mockOnSetup}
        />
      );

      const passwordInput = screen.getByPlaceholderText('Master Password');
      fireEvent.change(passwordInput, { target: { value: 'mypassword' } });

      const submitButton = screen.getByText('Decrypt Profiles');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnUnlock).toHaveBeenCalledWith('mypassword');
      });
    });

    it('shows "Invalid master password or corrupted file" if onUnlock resolves to false', async () => {
      mockOnUnlock.mockResolvedValueOnce(false);

      render(
        <CryptoModal
          mode="locked"
          isDark={false}
          onUnlock={mockOnUnlock}
          onSetup={mockOnSetup}
        />
      );

      const passwordInput = screen.getByPlaceholderText('Master Password');
      fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });

      const submitButton = screen.getByText('Decrypt Profiles');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Invalid master password or corrupted file')).toBeDefined();
      });
    });

    it('calls onRetryBiometric when the fingerprint button is clicked', () => {
      render(
        <CryptoModal
          mode="locked"
          isDark={false}
          onUnlock={mockOnUnlock}
          onSetup={mockOnSetup}
          onRetryBiometric={mockOnRetryBiometric}
        />
      );

      const retryButton = screen.getByTitle('Retry TouchID');
      fireEvent.click(retryButton);

      expect(mockOnRetryBiometric).toHaveBeenCalled();
    });
  });

  describe('mode: setup', () => {
    it('renders the setup title and description', () => {
      render(
        <CryptoModal
          mode="setup"
          isDark={false}
          onUnlock={mockOnUnlock}
          onSetup={mockOnSetup}
        />
      );

      expect(screen.getByText('Initialize Secure Storage')).toBeDefined();
      expect(screen.getByText(/Set a Master Password to encrypt your SSH profiles/)).toBeDefined();
    });

    it('calls onSetup with the entered password if it matches confirmation and length >= 4', async () => {
      mockOnSetup.mockResolvedValueOnce(undefined);

      render(
        <CryptoModal
          mode="setup"
          isDark={false}
          onUnlock={mockOnUnlock}
          onSetup={mockOnSetup}
        />
      );

      const passwordInput = screen.getByPlaceholderText('Master Password');
      const confirmInput = screen.getByPlaceholderText('Confirm Master Password');

      fireEvent.change(passwordInput, { target: { value: 'securepass' } });
      fireEvent.change(confirmInput, { target: { value: 'securepass' } });

      const submitButton = screen.getByText('Encrypt & Save');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnSetup).toHaveBeenCalledWith('securepass');
      });
    });

    it('shows "Passwords do not match" error if passwords differ', () => {
      render(
        <CryptoModal
          mode="setup"
          isDark={false}
          onUnlock={mockOnUnlock}
          onSetup={mockOnSetup}
        />
      );

      const passwordInput = screen.getByPlaceholderText('Master Password');
      const confirmInput = screen.getByPlaceholderText('Confirm Master Password');

      fireEvent.change(passwordInput, { target: { value: 'securepass' } });
      fireEvent.change(confirmInput, { target: { value: 'differentpass' } });

      const submitButton = screen.getByText('Encrypt & Save');
      fireEvent.click(submitButton);

      expect(screen.getByText('Passwords do not match')).toBeDefined();
      expect(mockOnSetup).not.toHaveBeenCalled();
    });

    it('shows "Password too short (min 4 chars)" error if length < 4', () => {
      render(
        <CryptoModal
          mode="setup"
          isDark={false}
          onUnlock={mockOnUnlock}
          onSetup={mockOnSetup}
        />
      );

      const passwordInput = screen.getByPlaceholderText('Master Password');
      const confirmInput = screen.getByPlaceholderText('Confirm Master Password');

      fireEvent.change(passwordInput, { target: { value: '123' } });
      fireEvent.change(confirmInput, { target: { value: '123' } });

      const submitButton = screen.getByText('Encrypt & Save');
      fireEvent.click(submitButton);

      expect(screen.getByText('Password too short (min 4 chars)')).toBeDefined();
      expect(mockOnSetup).not.toHaveBeenCalled();
    });

    it('calls onSkip when Skip button is clicked', () => {
      render(
        <CryptoModal
          mode="setup"
          isDark={false}
          onUnlock={mockOnUnlock}
          onSetup={mockOnSetup}
          onSkip={mockOnSkip}
        />
      );

      const skipButton = screen.getByText('Skip');
      fireEvent.click(skipButton);

      expect(mockOnSkip).toHaveBeenCalled();
    });

    it('calls onCancel when Cancel button is clicked', () => {
      render(
        <CryptoModal
          mode="setup"
          isDark={false}
          onUnlock={mockOnUnlock}
          onSetup={mockOnSetup}
          onCancel={mockOnCancel}
        />
      );

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalled();
    });
  });
});
