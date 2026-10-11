import type { AiMessagePage, AiSessionPage } from '../../../../../rust-core/getssh-store/store';
import { DatabaseManager } from './DatabaseManager';
import { LocalMemoryService } from './LocalMemoryService';

export interface ChatSession {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  raw_content?: string;
  timestamp: number;
}

export class ChatStorageManager {
  private static currentWorkspaceId: string | null = null;

  public static init(workspaceId: string) {
    this.currentWorkspaceId = workspaceId;
  }

  public static getCurrentWorkspaceId(): string | null {
    return this.currentWorkspaceId;
  }

  /**
   * Chats a page at a time, without their messages: loading every chat with every message at once
   * held the whole history in memory twice and sent it to the window in one message.
   */
  public static listSessions(limit: number, cursor?: string | null): AiSessionPage {
    if (!this.currentWorkspaceId) return { sessions: [], next: null };
    return DatabaseManager.listAiSessions(this.currentWorkspaceId, limit, cursor);
  }

  /** Only user and assistant messages are ever saved through saveMessage(). */
  public static getMessages(sessionId: string, limit: number, before?: string | null): AiMessagePage {
    if (!this.currentWorkspaceId) return { messages: [], before: null };
    return DatabaseManager.getAiMessages(this.currentWorkspaceId, sessionId, limit, before);
  }

  public static createSession(id: string, title: string, timestamp: number) {
    if (!this.currentWorkspaceId) return;
    DatabaseManager.createAiSession(this.currentWorkspaceId, id, title, timestamp);
  }

  public static saveMessage(msg: ChatMessage) {
    if (!this.currentWorkspaceId) return;
    DatabaseManager.saveAiMessage(this.currentWorkspaceId, msg);
    LocalMemoryService.indexMessage(this.currentWorkspaceId, msg);
  }

  public static deleteSession(id: string) {
    if (!this.currentWorkspaceId) return;
    DatabaseManager.deleteAiSession(this.currentWorkspaceId, id);
    LocalMemoryService.deleteSession(this.currentWorkspaceId, id);
  }

  public static updateSessionTitle(id: string, title: string) {
    if (!this.currentWorkspaceId) return;
    DatabaseManager.updateAiSessionTitle(this.currentWorkspaceId, id, title);
  }
}
