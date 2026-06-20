import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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
    // We no longer read from ai_chats.json, we just set the workspace id.
  }

  public static getSessions(): (ChatSession & { messages: ChatMessage[] })[] {
    if (!this.currentWorkspaceId) return [];
    const { DatabaseManager } = require('./DatabaseManager');
    return DatabaseManager.getAiSessions(this.currentWorkspaceId);
  }

  public static createSession(id: string, title: string, timestamp: number) {
    if (!this.currentWorkspaceId) return;
    const { DatabaseManager } = require('./DatabaseManager');
    DatabaseManager.createAiSession(this.currentWorkspaceId, id, title, timestamp);
  }

  public static saveMessage(msg: ChatMessage) {
    const { DatabaseManager } = require('./DatabaseManager');
    DatabaseManager.saveAiMessage(msg);
  }

  public static deleteSession(id: string) {
    const { DatabaseManager } = require('./DatabaseManager');
    DatabaseManager.deleteAiSession(id);
  }

  public static updateSessionTitle(id: string, title: string) {
    const { DatabaseManager } = require('./DatabaseManager');
    DatabaseManager.updateAiSessionTitle(id, title);
  }
}
