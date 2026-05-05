import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// Global mocks for Node environment
(global as any).window = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  electronAPI: {
    getPluginRenderers: vi.fn().mockResolvedValue([]),
  },
};

const mockBody = {
  appendChild: vi.fn(),
  innerHTML: '',
};

(global as any).document = {
  createElement: vi.fn(),
  body: mockBody,
  querySelector: vi.fn(),
  querySelectorAll: vi.fn().mockReturnValue([]),
};

(global as any).Notification = vi.fn();

import { initPluginBridge, bootSandboxedPlugins } from './PluginBridge';
import { usePluginStore } from '../store/pluginStore';

vi.mock('./svgSanitizer', () => ({
  sanitizeSVG: vi.fn((svg: string) => `sanitized-${svg}`),
}));

vi.mock('../store/pluginStore', () => ({
  usePluginStore: {
    getState: vi.fn(() => ({
      registerSidebarAction: vi.fn(),
    })),
  },
}));

describe('PluginBridge', () => {
  let mockWarn: ReturnType<typeof vi.spyOn>;
  let mockError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset global mocks
    (global as any).Notification = vi.fn();
    (global as any).window.electronAPI.getPluginRenderers = vi.fn().mockResolvedValue([]);
    (global as any).window.addEventListener = vi.fn();
    (global as any).window.removeEventListener = vi.fn();

    (global as any).document.createElement = vi.fn((tag) => {
      if (tag === 'iframe') {
        const iframe: any = {
          setAttribute: vi.fn(),
          style: { display: '' },
          contentWindow: {
            postMessage: vi.fn(),
            document: {
              open: vi.fn(),
              write: vi.fn(),
              close: vi.fn(),
              createElement: vi.fn((t) => ({ textContent: '', tagName: t })),
              body: { appendChild: vi.fn() }
            }
          }
        };
        return iframe;
      }
      return { tagName: tag };
    });

    mockBody.appendChild = vi.fn();
    mockBody.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initPluginBridge & handlePluginMessage', () => {
    let dispatchMessage: (data: any, source?: any) => void;

    beforeEach(() => {
      // Intercept addEventListener to capture the handler
      (global as any).window.addEventListener = vi.fn((type, listener) => {
        if (type === 'message') {
          dispatchMessage = (data: any, source?: any) => {
            (listener as EventListener)({ data, source } as MessageEvent);
          };
        }
      });
    });

    it('should add and remove message event listener', () => {
      const addSpy = (global as any).window.addEventListener;
      const removeSpy = (global as any).window.removeEventListener;

      const cleanup = initPluginBridge();

      expect(addSpy).toHaveBeenCalledWith('message', expect.any(Function));

      cleanup();

      expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should ignore messages without __getssh_plugin flag', () => {
      initPluginBridge();
      if(dispatchMessage) dispatchMessage({ action: 'registerSidebarAction' });
      expect(mockWarn).not.toHaveBeenCalled();
      expect(usePluginStore.getState().registerSidebarAction).not.toHaveBeenCalled();
    });

    it('should block and warn on dangerous actions', () => {
      initPluginBridge();
      if(dispatchMessage) dispatchMessage({ __getssh_plugin: true, action: 'sshWrite', pluginId: '1' });
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('BLOCKED dangerous action "sshWrite"'));
    });

    it('should warn on unknown actions', () => {
      initPluginBridge();
      if(dispatchMessage) dispatchMessage({ __getssh_plugin: true, action: 'someUnknownAction', pluginId: '1' });
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Unknown action "someUnknownAction"'));
    });

    it('should handle registerSidebarAction', () => {
      initPluginBridge();
      const mockRegister = vi.fn();
      (usePluginStore.getState as Mock).mockReturnValue({ registerSidebarAction: mockRegister });

      if(dispatchMessage) dispatchMessage({
        __getssh_plugin: true,
        pluginId: 'test-plugin',
        action: 'registerSidebarAction',
        payload: { id: 'btn1', icon: '<svg/>', label: 'Test Button' }
      });

      expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({
        id: 'plugin-test-plugin-btn1',
        icon: 'sanitized-<svg/>',
        label: 'Test Button',
      }));

      // Test onClick callback
      const registeredAction = mockRegister.mock.calls[0][0];

      // Mock document.querySelector for the iframe
      const mockPostMessage = vi.fn();
      (global as any).document.querySelector = vi.fn().mockReturnValue({
        contentWindow: { postMessage: mockPostMessage }
      });

      registeredAction.onClick();

      expect(mockPostMessage).toHaveBeenCalledWith({
        __getssh_host: true,
        event: 'sidebarClick',
        actionId: 'btn1'
      }, '*');
    });

    it('should handle showNotification when permission is granted', () => {
      initPluginBridge();
      const MockNotification = vi.fn();
      (MockNotification as any).permission = 'granted';
      (global as any).Notification = MockNotification;

      if(dispatchMessage) dispatchMessage({
        __getssh_plugin: true,
        pluginId: '1',
        action: 'showNotification',
        payload: { title: 'Test Title', body: 'Test Body' }
      });

      expect(MockNotification).toHaveBeenCalledWith('Test Title', { body: 'Test Body' });
    });

    it('should ignore showNotification when permission is not granted', () => {
      initPluginBridge();
      const MockNotification = vi.fn();
      (MockNotification as any).permission = 'denied';
      (global as any).Notification = MockNotification;

      if(dispatchMessage) dispatchMessage({
        __getssh_plugin: true,
        pluginId: '1',
        action: 'showNotification',
        payload: { title: 'Test Title', body: 'Test Body' }
      });

      expect(MockNotification).not.toHaveBeenCalled();
    });

    it('should handle getActiveSessionId and return null to plugin', () => {
      initPluginBridge();
      const mockSource = { postMessage: vi.fn() };

      if(dispatchMessage) dispatchMessage({
        __getssh_plugin: true,
        pluginId: '1',
        action: 'getActiveSessionId',
        payload: { requestId: 123 }
      }, mockSource);

      expect(mockSource.postMessage).toHaveBeenCalledWith({
        __getssh_host: true,
        event: 'sessionId',
        requestId: 123,
        sessionId: null
      }, '*');
    });
  });

  describe('bootSandboxedPlugins', () => {
    it('should fetch plugins and create sandboxed iframes', async () => {
      const mockScripts = ['console.log("plugin 0");', 'console.log("plugin 1");'];
      (global as any).window.electronAPI.getPluginRenderers.mockResolvedValue(mockScripts);

      const createdIframes: any[] = [];
      (global as any).document.createElement = vi.fn((tag) => {
        if (tag === 'iframe') {
          const iframe: any = {
            setAttribute: vi.fn(),
            style: { display: '' },
            contentWindow: {
              document: {
                open: vi.fn(),
                write: vi.fn(),
                close: vi.fn(),
                createElement: vi.fn((t) => ({ textContent: '', tagName: t })),
                body: { appendChild: vi.fn() }
              }
            }
          };
          createdIframes.push(iframe);
          return iframe;
        }
        return { tagName: tag };
      });

      await bootSandboxedPlugins();

      expect(mockBody.appendChild).toHaveBeenCalledTimes(2);
      expect(createdIframes.length).toBe(2);

      createdIframes.forEach((iframe, idx) => {
        expect(iframe.setAttribute).toHaveBeenCalledWith('sandbox', 'allow-scripts');
        expect(iframe.setAttribute).toHaveBeenCalledWith('data-plugin-id', `plugin-${idx}`);
        expect(iframe.style.display).toBe('none');
      });
    });

    it('should handle errors during boot gracefully', async () => {
      const mockErrorObj = new Error('Failed to fetch renderers');
      (global as any).window.electronAPI.getPluginRenderers.mockRejectedValue(mockErrorObj);

      await bootSandboxedPlugins();

      expect(mockError).toHaveBeenCalledWith('[PluginBridge] Failed to boot sandboxed plugins:', mockErrorObj);
    });

    it('should ignore empty scripts', async () => {
      (global as any).window.electronAPI.getPluginRenderers.mockResolvedValue(['script 1', null, 'script 2']);

      const createdIframes: any[] = [];
      (global as any).document.createElement = vi.fn((tag) => {
        if (tag === 'iframe') {
          const iframe: any = {
            setAttribute: vi.fn(),
            style: { display: '' },
            contentWindow: {
              document: {
                open: vi.fn(),
                write: vi.fn(),
                close: vi.fn(),
                createElement: vi.fn((t) => ({ textContent: '', tagName: t })),
                body: { appendChild: vi.fn() }
              }
            }
          };
          createdIframes.push(iframe);
          return iframe;
        }
        return { tagName: tag };
      });

      await bootSandboxedPlugins();

      expect(mockBody.appendChild).toHaveBeenCalledTimes(2); // The null script should be skipped
      expect(createdIframes.length).toBe(2);
    });
  });
});
