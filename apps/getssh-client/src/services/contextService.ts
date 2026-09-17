import { useSessionStore, PaneNode } from '../store/sessionStore';
import { getTerminalBuffer } from '../components/Terminal';

export interface TerminalSnapshot {
  sessionId: string;
  name: string;
  buffer: string;
}

export interface TerminalSessionInfo {
  id: string;
  name: string;
}

/**
 * ContextService — 只读上下文快照总线
 * 
 * 隔离 AI 和外部模块对终端分屏树与 DOM 缓冲区的直接侵入。
 * 外部消费者（如 AI Center, Floating AI）仅通过本服务拉取安全的只读快照。
 */
export class ContextService {
  /**
   * 获取当前活动 Tab 下的所有存活终端列表及聚焦终端
   */
  public static getTerminalSessionContext(): {
    activeSession: TerminalSessionInfo | null;
    allSessions: TerminalSessionInfo[];
  } {
    const state = useSessionStore.getState();
    if (!state.activeTabId) return { activeSession: null, allSessions: [] };

    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    if (!tab || !tab.paneTree) return { activeSession: null, allSessions: [] };

    let activeSession: TerminalSessionInfo | null = null;
    const allTerminalSessions: TerminalSessionInfo[] = [];

    const traverse = (node: PaneNode) => {
      if (node.type === 'leaf' && node.paneType === 'terminal' && node.sessionId) {
        const config = node.config as any;
        const name = config?.alias || config?.host || node.sessionId;
        allTerminalSessions.push({ id: node.sessionId, name });

        if (node.paneId === state.activePaneId) {
          activeSession = { id: node.sessionId, name };
        }
      } else if (node.type !== 'leaf') {
        if (node.children?.[0]) traverse(node.children[0]);
        if (node.children?.[1]) traverse(node.children[1]);
      }
    };

    traverse(tab.paneTree);

    // Fallback: If no pane is explicitly active but exactly 1 terminal exists, use it
    if (!activeSession && allTerminalSessions.length === 1) {
      activeSession = allTerminalSessions[0];
    }

    return { activeSession, allSessions: allTerminalSessions };
  }

  /**
   * 获取当前聚焦终端的完整只读快照（含缓冲区）
   */
  public static getActiveTerminalSnapshot(overrideSessionId?: string): TerminalSnapshot | null {
    const { activeSession, allSessions } = this.getTerminalSessionContext();
    
    let target = activeSession;
    if (overrideSessionId) {
      target = allSessions.find((s) => s.id === overrideSessionId) || null;
    }

    if (!target) return null;

    const buffer = getTerminalBuffer(target.id) || '';

    return {
      sessionId: target.id,
      name: target.name,
      buffer,
    };
  }

  /**
   * 安全向指定终端写入命令
   */
  public static sendCommandToTerminal(sessionId: string, command: string): boolean {
    if (!sessionId || !command) return false;
    const sanitized = command.replace(/[\r\n]+/g, ' ').trim();
    if (window.electronAPI?.sshWrite) {
      window.electronAPI.sshWrite(sessionId, sanitized);
      return true;
    }
    return false;
  }
}
