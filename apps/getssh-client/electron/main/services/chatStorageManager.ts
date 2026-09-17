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

  public static getSessions(): (ChatSession & { messages: ChatMessage[] })[] {
    if (!this.currentWorkspaceId) return [];
    return DatabaseManager.getAiSessions(this.currentWorkspaceId);
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
