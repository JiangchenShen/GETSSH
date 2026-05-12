// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initPluginBridge, bootSandboxedPlugins } from './PluginBridge';
import { usePluginStore } from '../store/pluginStore';

vi.mock('../store/pluginStore', () => {
  const registerSidebarAction = vi.fn();
  return {
    usePluginStore: {
      getState: vi.fn(() => ({
        registerSidebarAction,
      })),
    },
  };
});

vi.mock('./svgSanitizer', () => ({
  sanitizeSVG: vi.fn((svg) => `sanitized-${svg}`),
}));

describe('PluginBridge', () => {
  let addEventListenerSpy: any;
  let removeEventListenerSpy: any;
  let warnSpy: any;
  let errorSpy: any;
  let NotificationMock: any;

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock Notification
    NotificationMock = vi.fn();
    vi.stubGlobal('Notification', Object.assign(NotificationMock, {
      permission: 'granted',
    }));

    // Clear dom
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('initPluginBridge and handlePluginMessage', () => {
    it('should add and remove message event listeners correctly', () => {
      const cleanup = initPluginBridge();
      expect(addEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));

      cleanup();
      expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should ignore messages without data or __getssh_plugin flag', () => {
      initPluginBridge();
      const handler = addEventListenerSpy.mock.calls.find((call: any) => call[0] === 'message')[1];

      handler(new MessageEvent('message', { data: null }));
      handler(new MessageEvent('message', { data: { some: 'data' } }));

      expect(warnSpy).not.toHaveBeenCalled();
      expect(usePluginStore.getState().registerSidebarAction).not.toHaveBeenCalled();
    });

    it('should block dangerous actions', () => {
      initPluginBridge();
      const handler = addEventListenerSpy.mock.calls.find((call: any) => call[0] === 'message')[1];

      handler(new MessageEvent('message', {
        data: { __getssh_plugin: true, action: 'sshWrite', pluginId: 'test-plugin' }
      }));

      expect(warnSpy).toHaveBeenCalledWith('[PluginBridge] BLOCKED dangerous action "sshWrite" from plugin "test-plugin"');
    });

    it('should warn on unknown actions', () => {
      initPluginBridge();
      const handler = addEventListenerSpy.mock.calls.find((call: any) => call[0] === 'message')[1];

      handler(new MessageEvent('message', {
        data: { __getssh_plugin: true, action: 'unknownAction', pluginId: 'test-plugin' }
      }));

      expect(warnSpy).toHaveBeenCalledWith('[PluginBridge] Unknown action "unknownAction" from plugin "test-plugin"');
    });

    it('should handle registerSidebarAction and process click callback', () => {
      initPluginBridge();
      const handler = addEventListenerSpy.mock.calls.find((call: any) => call[0] === 'message')[1];

      // Setup iframe
      const iframe = document.createElement('iframe');
      iframe.setAttribute('data-plugin-id', 'test-plugin');
      document.body.appendChild(iframe);

      const postMessageSpy = vi.fn();
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: postMessageSpy },
        writable: true,
      });

      handler(new MessageEvent('message', {
        data: {
          __getssh_plugin: true,
          action: 'registerSidebarAction',
          pluginId: 'test-plugin',
          payload: { id: 'btn1', icon: '<svg/>', label: 'My Button' }
        }
      }));

      const registerMock = usePluginStore.getState().registerSidebarAction as any;
      expect(registerMock).toHaveBeenCalled();
      const registeredAction = registerMock.mock.calls[0][0];

      expect(registeredAction.id).toBe('plugin-test-plugin-btn1');
      expect(registeredAction.icon).toBe('sanitized-<svg/>');
      expect(registeredAction.label).toBe('My Button');

      // Test click callback
      registeredAction.onClick();
      expect(postMessageSpy).toHaveBeenCalledWith({
        __getssh_host: true,
        event: 'sidebarClick',
        actionId: 'btn1'
      }, '*');
    });

    it('should handle showNotification if permission is granted', () => {
      initPluginBridge();
      const handler = addEventListenerSpy.mock.calls.find((call: any) => call[0] === 'message')[1];

      handler(new MessageEvent('message', {
        data: {
          __getssh_plugin: true,
          action: 'showNotification',
          pluginId: 'test-plugin',
          payload: { title: 'Test Title', body: 'Test Body' }
        }
      }));

      expect(NotificationMock).toHaveBeenCalledWith('Test Title', { body: 'Test Body' });
    });

    it('should handle showNotification with default title', () => {
      initPluginBridge();
      const handler = addEventListenerSpy.mock.calls.find((call: any) => call[0] === 'message')[1];

      handler(new MessageEvent('message', {
        data: {
          __getssh_plugin: true,
          action: 'showNotification',
          pluginId: 'test-plugin',
          payload: { body: 'Test Body' }
        }
      }));

      expect(NotificationMock).toHaveBeenCalledWith('GETSSH Plugin', { body: 'Test Body' });
    });

    it('should handle getActiveSessionId and post null sessionId', () => {
      initPluginBridge();
      const handler = addEventListenerSpy.mock.calls.find((call: any) => call[0] === 'message')[1];

      const sourcePostMessageSpy = vi.fn();
      const mockSource = { postMessage: sourcePostMessageSpy };

      handler(new MessageEvent('message', {
        source: mockSource as any,
        data: {
          __getssh_plugin: true,
          action: 'getActiveSessionId',
          pluginId: 'test-plugin',
          payload: { requestId: 'req-123' }
        }
      }));

      expect(sourcePostMessageSpy).toHaveBeenCalledWith({
        __getssh_host: true,
        event: 'sessionId',
        requestId: 'req-123',
        sessionId: null,
      }, '*');
    });
  });

  describe('bootSandboxedPlugins', () => {
    it('should create iframes for sandboxed plugins and inject sdk and script', async () => {
      const getPluginRenderersSpy = vi.fn().mockResolvedValue([
        'console.log("plugin 1");',
        '', // Empty script should be skipped
        'console.log("plugin 2");',
      ]);

      vi.stubGlobal('electronAPI', {
        getPluginRenderers: getPluginRenderersSpy,
      });

      vi.stubGlobal('window', {
        ...window,
        electronAPI: {
          getPluginRenderers: getPluginRenderersSpy,
        },
      });

      await bootSandboxedPlugins();

      expect(getPluginRenderersSpy).toHaveBeenCalled();

      // Check iframes in DOM
      const iframes = document.querySelectorAll('iframe');
      expect(iframes.length).toBe(2);

      const iframe1 = iframes[0];
      expect(iframe1.getAttribute('sandbox')).toBe('allow-scripts');
      expect(iframe1.getAttribute('data-plugin-id')).toBe('plugin-0');
      expect(iframe1.style.display).toBe('none');

      const iframe2 = iframes[1];
      expect(iframe2.getAttribute('sandbox')).toBe('allow-scripts');
      expect(iframe2.getAttribute('data-plugin-id')).toBe('plugin-2');
    });

    it('should catch and log errors if booting plugins fails', async () => {
      const mockError = new Error('Failed to get plugins');
      const getPluginRenderersSpy = vi.fn().mockRejectedValue(mockError);

      vi.stubGlobal('electronAPI', {
        getPluginRenderers: getPluginRenderersSpy,
      });

      vi.stubGlobal('window', {
        ...window,
        electronAPI: {
          getPluginRenderers: getPluginRenderersSpy,
        },
      });

      await bootSandboxedPlugins();

      expect(errorSpy).toHaveBeenCalledWith('[PluginBridge] Failed to boot sandboxed plugins:', mockError);
    });
  });
});
