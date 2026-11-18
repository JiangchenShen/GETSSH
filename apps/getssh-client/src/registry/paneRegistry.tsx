import { Component, useMemo, type ErrorInfo, type ReactNode } from 'react';
import { TerminalSquare, AlertTriangle, RefreshCw } from 'lucide-react';
import { callTidal, isSSHConfig, PaneLeaf } from '../store/sessionStore';
import { Terminal as TerminalComponent } from '../components/Terminal';
import { RecBadge } from '../components/RecBadge';
import { PluginPane } from '../components/PluginPane';
import { WORKSPACE_PAGES, WorkspaceCenter, type WorkspacePage } from '../components/WorkspaceCenter';
import { AiSettingsModal as AiSettingsPane } from '../components/AiSettingsModal';
import { PluginCenterModal as PluginCenterPane } from '../components/PluginCenterModal';
import { SettingsPane } from '../components/SettingsPane';
import { SETTINGS_TABS, type SettingsTab } from '../components/SettingsView';

interface ErrorBoundaryProps {
  paneId: string;
  fallbackTitle?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Isolated Error Boundary per Pane
 * Prevents a crash in any single tool/center from bringing down the entire split layout or active terminals.
 */
class PaneErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[PaneRegistry] Error in pane ${this.props.paneId}:`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center select-none bg-bg text-ink">
          <div className="w-10 h-10 rounded-lg bg-down/10 border border-down/25 flex items-center justify-center text-down mb-3">
            <AlertTriangle size={20} />
          </div>
          <h4 className="text-sm font-semibold text-down mb-1">
            {this.props.fallbackTitle || 'Panel Crashed (Isolated)'}
          </h4>
          <p className="text-xs text-ink-2 max-w-xs mb-4 font-mono break-all line-clamp-2">
            {this.state.error?.message || 'An unexpected rendering error occurred inside this pane.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surf hover:bg-surf-2 text-ink text-xs font-medium transition-colors border border-line"
            >
              <RefreshCw size={12} />
              Reload Pane
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.electronAPI?.tidalClosePane) {
                  void callTidal('close crashed pane', window.electronAPI.tidalClosePane(this.props.paneId));
                }
              }}
              className="px-3 py-1.5 rounded-md bg-down/10 hover:bg-down/15 text-down text-xs font-medium transition-colors border border-down/30"
            >
              Close Pane
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface PaneRenderContext {
  node: PaneLeaf;
  tabId: string;
  appConfig: any;
  isDark: boolean;
  isTabActive: boolean;
  isActive: boolean;
  onDisconnectedChange?: (val: boolean) => void;
  onClosePane?: () => void;
  onReconnect?: () => void;
}

export type PaneRenderer = (ctx: PaneRenderContext) => ReactNode;

// A component (not a bare render function) so the terminal config can be memoized: a fresh object on
// every LeafPane render would re-run Terminal's config effect (theme repaint, fit, ssh-resize).
function TerminalPaneView({ ctx }: { ctx: PaneRenderContext }) {
  const { node, appConfig, isDark, isTabActive, isActive, onDisconnectedChange, onClosePane, onReconnect } = ctx;
  const terminalTheme = isSSHConfig(node.config) && node.config.themeOverride
    ? node.config.themeOverride
    : appConfig.terminalTheme;
  const config = useMemo(() => ({ ...appConfig, terminalTheme }), [appConfig, terminalTheme]);
  if (!node.sessionId) return null;

  return (
    <>
      <TerminalComponent
        sessionId={node.sessionId}
        isDisconnected={node.isDisconnected ?? false}
        onDisconnectedChange={onDisconnectedChange}
        onDisconnected={onClosePane}
        onReconnect={onReconnect}
        config={config}
        isDark={isDark}
        isActive={isTabActive && isActive}
      />
      <RecBadge isRecording={appConfig.enableAuditLogging || false} />
    </>
  );
}

/**
 * Pluggable Component Registry for Split Panes
 */
class PaneRegistry {
  private renderers = new Map<string, PaneRenderer>();

  constructor() {
    this.registerDefaults();
  }

  public register(paneKey: string, renderer: PaneRenderer) {
    this.renderers.set(paneKey, renderer);
  }

  public unregister(paneKey: string) {
    this.renderers.delete(paneKey);
  }

  public render(ctx: PaneRenderContext): ReactNode {
    const { node } = ctx;
    let key = node.paneType as string;

    if (node.paneType === 'center' && node.config && 'centerType' in node.config) {
      key = `center:${node.config.centerType}`;
    }

    const renderer = this.renderers.get(key);

    if (!renderer) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-bg text-ink-3">
          <TerminalSquare className="w-7 h-7 mb-2 text-ink-3" />
          <p className="text-xs">Unknown or unmounted pane type: {key}</p>
        </div>
      );
    }

    return (
      <PaneErrorBoundary paneId={node.paneId} fallbackTitle={`Pane: ${key}`}>
        {renderer(ctx)}
      </PaneErrorBoundary>
    );
  }

  private registerDefaults() {
    // 1. Terminal Pane
    this.register('terminal', (ctx) => <TerminalPaneView ctx={ctx} />);

    // 2. Plugin Pane
    this.register('plugin', (ctx) => {
      const { node, isDark } = ctx;
      const pluginUrl = node.config && 'pluginUrl' in node.config ? (node.config as any).pluginUrl : undefined;
      return <PluginPane paneId={node.paneId} isDark={isDark} pluginUrl={pluginUrl} />;
    });

    // 3. Welcome Pane
    this.register('welcome', () => (
      <div className="w-full h-full flex flex-col items-center justify-center bg-bg min-h-0 overflow-y-auto">
        <div className="flex flex-col items-center gap-2.5 text-center px-4 py-4 min-h-min shrink-0">
          <div className="w-10 h-10 shrink-0 rounded-lg border border-line bg-surf flex items-center justify-center text-primary">
            <TerminalSquare className="w-5 h-5" />
          </div>
          <div className="shrink-0">
            <h3 className="text-sm font-semibold text-ink">Ready to Connect</h3>
            <p className="text-xs mt-1 leading-relaxed text-ink-2 max-w-[230px]">
              Press <kbd className="px-1.5 py-0.5 rounded border border-line font-mono text-[10px] mx-0.5 bg-surf text-ink-2">Ctrl+K</kbd> or <kbd className="px-1.5 py-0.5 rounded border border-line font-mono text-[10px] mx-0.5 bg-surf text-ink-2">Option+Space</kbd> to open Command Center
            </p>
          </div>
        </div>
      </div>
    ));

    // 4. Center Panes (Blade Modules)
    this.register('center:workspace', ({ node }) => {
      const requested = node.config && 'centerType' in node.config ? node.config.workspacePage : undefined;
      return <WorkspaceCenter initialPage={requested && WORKSPACE_PAGES.includes(requested as WorkspacePage) ? requested as WorkspacePage : undefined} />;
    });
    this.register('center:ai', () => <AiSettingsPane />);
    this.register('center:plugin', () => <PluginCenterPane />);
    this.register('center:secure', () => <SettingsPane initialTab="Security" />);
    this.register('center:settings', ({ node }) => {
      const requested = node.config && 'centerType' in node.config ? node.config.settingsTab : undefined;
      return <SettingsPane initialTab={requested && SETTINGS_TABS.includes(requested as SettingsTab) ? requested as SettingsTab : undefined} />;
    });
  }
}

export const paneRegistry = new PaneRegistry();
