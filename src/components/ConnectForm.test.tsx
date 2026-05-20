// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectForm } from './ConnectForm';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ConnectForm', () => {
  const mockOnConnect = vi.fn();
  const mockOnUpdateSession = vi.fn();

  const defaultProps = {
    session: {
      host: 'example.com',
      port: 22,
      username: 'user',
      password: '',
      privateKeyPath: '',
      useKeepAlive: true,
    },
    index: 0,
    appConfig: { defaultPort: 22 },
    isDark: false,
    connecting: false,
    error: null,
    onConnect: mockOnConnect,
    onUpdateSession: mockOnUpdateSession,
  };

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    (window as any).electronAPI = {
      selectFile: vi.fn(),
    };
  });

  it('renders correctly with default props', () => {
    render(<ConnectForm {...defaultProps} />);
    expect(screen.getByText('Connect to Server')).toBeDefined();
    expect(screen.getByText('Launch a new Tabbed SSH session')).toBeDefined();
    expect(screen.getByText('connect.host')).toBeDefined();
    expect(screen.getByDisplayValue('example.com')).toBeDefined();
    expect(screen.getByText('connect.connectBtn')).toBeDefined();
  });

  it('displays error message when error prop is provided', () => {
    render(<ConnectForm {...defaultProps} error="Connection failed" />);
    expect(screen.getByText('Connection failed')).toBeDefined();
  });

  it('disables submit button and changes text when connecting', () => {
    render(<ConnectForm {...defaultProps} connecting={true} />);
    const submitButton = screen.getByRole('button', { name: 'connect.connecting' });
    expect(submitButton).toBeDefined();
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onUpdateSession when host input changes', () => {
    render(<ConnectForm {...defaultProps} />);
    const hostInput = screen.getByDisplayValue('example.com');
    fireEvent.change(hostInput, { target: { value: 'new-host.com' } });
    expect(mockOnUpdateSession).toHaveBeenCalledWith(0, {
      ...defaultProps.session,
      host: 'new-host.com',
    });
  });

  it('calls onUpdateSession when port input changes', () => {
    render(<ConnectForm {...defaultProps} />);
    const portInput = screen.getByDisplayValue('22');
    fireEvent.change(portInput, { target: { value: '2222' } });
    expect(mockOnUpdateSession).toHaveBeenCalledWith(0, {
      ...defaultProps.session,
      port: 2222,
    });
  });

  it('calls onUpdateSession when Keep-Alive checkbox changes', () => {
    render(<ConnectForm {...defaultProps} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(mockOnUpdateSession).toHaveBeenCalledWith(0, {
      ...defaultProps.session,
      useKeepAlive: false,
    });
  });

  it('calls window.electronAPI.selectFile and onUpdateSession when Browse is clicked', async () => {
    const mockSelectFile = vi.fn().mockResolvedValue('/path/to/key');
    (window as any).electronAPI.selectFile = mockSelectFile;

    render(<ConnectForm {...defaultProps} />);
    const browseButton = screen.getByText('Browse');
    fireEvent.click(browseButton);

    expect(mockSelectFile).toHaveBeenCalled();

    await waitFor(() => {
      expect(mockOnUpdateSession).toHaveBeenCalledWith(0, {
        ...defaultProps.session,
        privateKeyPath: '/path/to/key',
      });
    });
  });

  it('calls onConnect when form is submitted', () => {
    render(<ConnectForm {...defaultProps} />);
    const submitButton = screen.getByRole('button', { name: 'connect.connectBtn' });
    fireEvent.click(submitButton);
    expect(mockOnConnect).toHaveBeenCalledWith(defaultProps.session);
  });
});
