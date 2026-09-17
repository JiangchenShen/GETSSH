import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TerminalSquare, AlertTriangle, RefreshCw } from 'lucide-react';
import { isSSHConfig, PaneLeaf } from '../store/sessionStore';
import { Terminal as TerminalComponent } from '../components/Terminal';
import { RecBadge } from '../components/RecBadge';
import { PluginPane } from '../components/PluginPane';
import { WorkspaceCenter } from '../components/WorkspaceCenter';
import { AiSettingsModal as AiSettingsPane } from '../components/AiSettingsModal';
import { PluginCenterModal as PluginCenterPane } from '../components/PluginCenterModal';
import { SecureCenter } from '../components/SecureCenter';
import { SettingsPane } from '../components/SettingsPane';

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
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center select-none bg-red-500/5 backdrop-blur-md">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-3">
            <AlertTriangle size={24} />
          </div>
          <h4 className="text-sm font-bold text-red-400 mb-1">
            {this.props.fallbackTitle || 'Panel Crashed (Isolated)'}
          </h4>
          <p className="text-xs text-white/50 max-w-xs mb-4 font-mono break-all line-clamp-2">
            {this.state.error?.message || 'An unexpected rendering error occurred inside this pane.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={this.handleRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all border border-white/10"
            >
              <RefreshCw size={12} />
              Reload Pane
            </button>
            <button
              onClick={() => {
                if (window.electronAPI?.nexusClosePane) {
                  window.electronAPI.nexusClosePane(this.props.paneId).catch(console.error);
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-semibold transition-all border border-red-500/30"
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
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-white/40">
          <TerminalSquare className="w-8 h-8 opacity-40 mb-2" />
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
    this.register('terminal', (ctx) => {
      const { node, appConfig, isDark, isTabActive, isActive, onDisconnectedChange, onClosePane, onReconnect } = ctx;
      if (!node.sessionId) return null;
      const terminalTheme = isSSHConfig(node.config) && node.config.themeOverride
        ? node.config.themeOverride
        : appConfig.terminalTheme;

      return (
        <>
          <TerminalComponent
            sessionId={node.sessionId}
            isDisconnected={node.isDisconnected ?? false}
            onDisconnectedChange={onDisconnectedChange}
            onDisconnected={onClosePane}
            onReconnect={onReconnect}
            config={{ ...appConfig, terminalTheme }}
            isDark={isDark}
            isActive={isTabActive && isActive}
          />
          <RecBadge isRecording={appConfig.enableAuditLogging || false} />
        </>
      );
    });

    // 2. Plugin Pane
    this.register('plugin', (ctx) => {
      const { node, isDark } = ctx;
      const pluginUrl = node.config && 'pluginUrl' in node.config ? (node.config as any).pluginUrl : undefined;
      return <PluginPane paneId={node.paneId} isDark={isDark} pluginUrl={pluginUrl} />;
    });

    // 3. Welcome Pane
    this.register('welcome', () => (
      <div className="w-full h-full flex flex-col items-center justify-center bg-transparent min-h-0 overflow-y-auto">
        <div className="flex flex-col items-center gap-3 text-center px-4 py-4 min-h-min shrink-0">
          <div className="w-12 h-12 shrink-0 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
            <TerminalSquare className="w-6 h-6" />
          </div>
          <div className="shrink-0">
            <h3 className="text-base font-bold text-white">Ready to Connect</h3>
            <p className="text-xs mt-1.5 leading-relaxed text-white/50 max-w-[220px]">
              Press <kbd className="px-1.5 py-0.5 rounded border border-white/20 font-mono text-[10px] mx-0.5 shadow-sm bg-white/5">Ctrl+K</kbd> or <kbd className="px-1.5 py-0.5 rounded border border-white/20 font-mono text-[10px] mx-0.5 shadow-sm bg-white/5">Option+Space</kbd> to open Command Center
            </p>
          </div>
        </div>
      </div>
    ));

    // 4. Center Panes (Blade Modules)
    this.register('center:workspace', () => <WorkspaceCenter />);
    this.register('center:ai', () => <AiSettingsPane />);
    this.register('center:plugin', () => <PluginCenterPane />);
    this.register('center:secure', () => <SecureCenter />);
    this.register('center:settings', () => <SettingsPane />);
  }
}

export const paneRegistry = new PaneRegistry();
