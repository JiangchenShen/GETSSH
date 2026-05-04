// @vitest-environment jsdom
import { render, act, fireEvent } from '@testing-library/react';
import { Terminal } from './Terminal';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mockTermInstance = {
  loadAddon: vi.fn(),
  open: vi.fn(),
  dispose: vi.fn(),
  write: vi.fn(),
  writeln: vi.fn(),
  onData: vi.fn(),
  onSelectionChange: vi.fn(),
  getSelection: vi.fn(),
  options: {},
};

vi.mock('xterm', () => {
  return {
    Terminal: class {
      loadAddon = mockTermInstance.loadAddon;
      open = mockTermInstance.open;
      dispose = mockTermInstance.dispose;
      write = mockTermInstance.write;
      writeln = mockTermInstance.writeln;
      onData = mockTermInstance.onData;
      onSelectionChange = mockTermInstance.onSelectionChange;
      getSelection = mockTermInstance.getSelection;
      options = mockTermInstance.options;
    }
  };
});

vi.mock('xterm-addon-fit', () => {
  return {
    FitAddon: class {
      fit = vi.fn();
      proposeDimensions = vi.fn().mockReturnValue({ rows: 24, cols: 80 });
    }
  };
});

describe('Terminal Component', () => {
  const mockConfig = {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorStyle: 'block',
    themeColor: '255 255 255',
    scrollback: 10000,
    copyOnSelect: true,
  };

  beforeEach(() => {
    window.electronAPI = {
      onSshData: vi.fn().mockReturnValue(vi.fn()),
      onSshClosed: vi.fn().mockReturnValue(vi.fn()),
      sshWrite: vi.fn(),
      sshResize: vi.fn(),
      sshDisconnect: vi.fn(),
      showContextMenu: vi.fn(),
    } as any;

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('renders without crashing', () => {
    const { container } = render(
      <Terminal sessionId="test-session" config={mockConfig} />
    );
    expect(container).toBeDefined();
    // Wait for set timeout handleResize to fire so no pending timers
    act(() => {
        vi.runAllTimers();
    });
  });

  it('subscribes and unsubscribes from IPC channels correctly', () => {
    const unsubData = vi.fn();
    const unsubClosed = vi.fn();

    window.electronAPI.onSshData = vi.fn().mockReturnValue(unsubData);
    window.electronAPI.onSshClosed = vi.fn().mockReturnValue(unsubClosed);

    const { unmount } = render(
      <Terminal sessionId="test-session" config={mockConfig} />
    );

    expect(window.electronAPI.onSshData).toHaveBeenCalledWith('test-session', expect.any(Function));
    expect(window.electronAPI.onSshClosed).toHaveBeenCalledWith('test-session', expect.any(Function));

    unmount();

    expect(unsubData).toHaveBeenCalled();
    expect(unsubClosed).toHaveBeenCalled();
    expect(window.electronAPI.sshDisconnect).toHaveBeenCalledWith('test-session');
  });

  it('calls sshResize when window resizes', () => {
    render(<Terminal sessionId="test-session" config={mockConfig} />);

    // Initial resize is delayed via setTimeout
    act(() => {
        vi.runAllTimers();
    });

    expect(window.electronAPI.sshResize).toHaveBeenCalledWith('test-session', 24, 80);

    window.electronAPI.sshResize = vi.fn(); // clear initial calls

    // Trigger window resize event
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });

    expect(window.electronAPI.sshResize).toHaveBeenCalledWith('test-session', 24, 80);
  });

  it('shows custom context menu on right click', () => {
    const { container } = render(
      <Terminal sessionId="test-session" config={mockConfig} />
    );

    const wrapper = container.firstChild as Element;
    fireEvent.contextMenu(wrapper);

    expect(window.electronAPI.showContextMenu).toHaveBeenCalled();

    act(() => {
        vi.runAllTimers();
    });
  });

  it('handles incoming SSH data', () => {
    let dataCallback: any;
    window.electronAPI.onSshData = vi.fn().mockImplementation((id, cb) => {
        dataCallback = cb;
        return vi.fn();
    });

    render(<Terminal sessionId="test-session" config={mockConfig} />);

    act(() => {
        dataCallback('hello server');
    });

    expect(mockTermInstance.write).toHaveBeenCalledWith('hello server');

    act(() => {
        vi.runAllTimers();
    });
  });

  it('handles outgoing SSH data (input)', () => {
    render(<Terminal sessionId="test-session" config={mockConfig} />);

    // Simulate XTerm calling the onData callback
    const onDataCallback = mockTermInstance.onData.mock.calls[0][0];

    act(() => {
        onDataCallback('ls -la\r');
    });

    expect(window.electronAPI.sshWrite).toHaveBeenCalledWith('test-session', 'ls -la\r');

    act(() => {
        vi.runAllTimers();
    });
  });

  it('handles SSH connection closed correctly', () => {
    let closeCallback: any;
    const onDisconnectedMock = vi.fn();
    const onReconnectMock = vi.fn();

    window.electronAPI.onSshClosed = vi.fn().mockImplementation((id, cb) => {
        closeCallback = cb;
        return vi.fn();
    });

    render(<Terminal
             sessionId="test-session"
             config={mockConfig}
             onDisconnected={onDisconnectedMock}
             onReconnect={onReconnectMock}
           />);

    act(() => {
        closeCallback();
    });

    expect(onDisconnectedMock).toHaveBeenCalled();
    expect(mockTermInstance.writeln).toHaveBeenCalledWith(expect.stringContaining('[SSH Connection Closed]'));

    // Test reconnection behavior when pressing enter (\r) while disconnected
    const onDataCallback = mockTermInstance.onData.mock.calls[0][0];

    act(() => {
        onDataCallback('\r');
    });

    expect(onReconnectMock).toHaveBeenCalled();
    expect(mockTermInstance.writeln).toHaveBeenCalledWith(expect.stringContaining('[Reconnecting...]'));

    act(() => {
        vi.runAllTimers();
    });
  });
});
