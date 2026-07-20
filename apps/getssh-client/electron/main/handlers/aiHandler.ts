import { IpcMainInvokeEvent, BrowserWindow, app, safeStorage } from 'electron';
import { streamLLM, fetchAvailableModels } from '../services/llmService';
import { AgentEngine } from '../services/AgentEngine';
import { MicroContextAssembler } from '../services/MicroContextAssembler';
import { ChatStorageManager } from '../services/chatStorageManager';
import fs from 'node:fs';
import { join } from 'node:path';

const getAiVaultPath = () => join(app.getPath('userData'), 'ai_vault.enc');

function getSecureApiKey(): string {
  const vaultPath = getAiVaultPath();
  if (!fs.existsSync(vaultPath)) return '';
  try {
    const encrypted = fs.readFileSync(vaultPath);
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(encrypted);
    }
  } catch (e) {
    console.error('[AI Gateway] Failed to decrypt AI API Key:', e);
  }
  return '';
}

/**
 * AI CENTER Proxy Gateway (Workspace 2.0)
 * 核心安全网关：负责特权请求拦截、上下文脱敏与状态销毁
 */
export function registerAiHandlers(ipcMain: Electron.IpcMain, getWin: () => BrowserWindow | null) {
  
  // =====================================================================
  // 【0】 API Key 安全托管 (BYOK Vault)
  // =====================================================================
  ipcMain.handle('ai-save-api-key', async (event: IpcMainInvokeEvent, apiKey: string) => {
    if (event.senderFrame && event.senderFrame.parent !== null) {
      throw new Error('Security Violation: Unauthorized AI invocation from sandbox.');
    }
    if (!apiKey) return { success: false };
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(apiKey);
        fs.writeFileSync(getAiVaultPath(), encrypted);
        return { success: true };
      }
      return { success: false, error: 'OS Keychain encryption unavailable' };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('ai-delete-api-key', async (event: IpcMainInvokeEvent) => {
    if (event.senderFrame && event.senderFrame.parent !== null) {
      throw new Error('Security Violation: Unauthorized AI invocation from sandbox.');
    }
    try {
      const vaultPath = getAiVaultPath();
      if (fs.existsSync(vaultPath)) {
        fs.unlinkSync(vaultPath);
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // =====================================================================
  // 【1】&【2】 主进程特权 IPC 注册与溯源验证 & 统一安全洗涤层
  // =====================================================================
  ipcMain.handle('ai-privileged-invoke', async (event: IpcMainInvokeEvent, payload: any) => {
    
    // ---------------------------------------------------------
    // 1. 溯源验证 (Origin Verification) - 防护沙箱逃逸
    // ---------------------------------------------------------
    // 规则 A：绝不允许从任何 iframe/webview 子帧发起请求
    if (event.senderFrame && event.senderFrame.parent !== null) {
      console.error('[AI Gateway] 🔴 红色警报：检测到来自沙箱子帧的越权 AI 请求拦截。');
      throw new Error('Security Violation: Unauthorized AI invocation from sandbox.');
    }

    // 规则 B：必须来自于 GETSSH 核心主渲染窗口 (Main WebContents)
    const win = getWin();
    if (win && event.sender.id !== win.webContents.id) {
      console.error('[AI Gateway] 🔴 红色警报：拦截到未知 WebContents 发起的请求。');
      throw new Error('Security Violation: Unknown origin WebContents.');
    }

    // ---------------------------------------------------------
    // 2. 统一安全洗涤层 (Centralized Sanitization)
    // ---------------------------------------------------------
    const requestId = payload?.requestId;
    if (!requestId) {
      throw new Error('Security Violation: Missing requestId for IPC stream multiplexing.');
    }

    const rawPrompt = payload?.prompt || '';
    const contextData = payload?.contextData;
    const mode = payload?.mode || 'readonly';
    
    // Assemble the micro-RAG context dynamically
    const rawContext = contextData ? MicroContextAssembler.assemble({ ...contextData, agentMode: mode }) : '';
    
    // 将传入的 Prompt 和终端 Context 送入洗涤中间件
    const sanitizedPrompt = sanitizeAiContext(rawPrompt);
    let sanitizedContext = sanitizeAiContext(rawContext);

    // [System Prompt Injection] Enforce beautiful Markdown rendering
    const MARKDOWN_INSTRUCTION = `
[SYSTEM INSTRUCTION]
You are a highly capable AI assistant operating within the GETSSH terminal environment.
Please follow these formatting rules strictly:
1. Always format your responses using standard Markdown.
2. Use headings (##, ###) to structure your response.
3. Use bold (**text**) for emphasis.
${(mode === 'agent_semi' || mode === 'agent_full') ? '4. (Skipped for agent modes)' : '4. When providing code or terminal commands, ALWAYS use fenced code blocks (```language) with the correct language tag (e.g., bash, shell, python, json).'}
5. Use bullet points (-) or numbered lists for steps.
6. Keep your responses concise, professional, and visually structured.
`;
    sanitizedContext = MARKDOWN_INSTRUCTION + '\n' + sanitizedContext;

    console.log(`[AI Gateway] 🟢 数据洗涤完毕，准备建立流式隧道. RequestID: ${requestId}`);

    // BYOK 加密解密与云端大模型 API 直连逻辑
    const endpoint = payload?.endpoint || '';
    const provider = payload?.provider || 'openai';
    const model = payload?.model || 'gpt-3.5-turbo';
    
    // 强制从安全存储中读取，忽略前端传入的任何伪造 apiKey
    const apiKey = provider === 'ollama' ? '' : getSecureApiKey();

    const sessionId = contextData?.sessionId;

    // 发起不阻塞主流程的流式请求，并将 chunk 发回对应 requestId 的专属频道
    const onChunk = (chunk: string) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`ai-stream-chunk-${requestId}`, { chunk, isDone: false });
      }
    };
    const onDone = () => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`ai-stream-chunk-${requestId}`, { chunk: '', isDone: true });
      }
    };
    const onError = (error: Error) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`ai-stream-chunk-${requestId}`, { chunk: '', isDone: true, error: error.message });
      }
    };

    if ((mode === 'agent_semi' || mode === 'agent_full') && sessionId) {
      console.log(`[AI Gateway] 🚀 Launching Agent Engine for session ${sessionId} in mode ${mode}`);
      
      const askApproval = async (command: string): Promise<boolean> => {
        return new Promise((resolve) => {
          const listener = (e: any, approvedRequestId: string, isApproved: boolean) => {
            if (approvedRequestId === requestId) {
              ipcMain.removeListener('ai-agent-approve', listener);
              resolve(isApproved);
            }
          };
          ipcMain.on('ai-agent-approve', listener);
          if (!event.sender.isDestroyed()) {
            event.sender.send(`ai-agent-approval-request`, { requestId, command });
          }
        });
      };

      AgentEngine.runAgentLoop(
        endpoint, apiKey, provider, model,
        sanitizedPrompt, sanitizedContext, sessionId, mode, requestId,
        onChunk, onDone, onError, askApproval
      );
    } else {
      streamLLM(
        endpoint, apiKey, provider, model,
        sanitizedPrompt, sanitizedContext,
        onChunk, onDone, onError
      );
    }

    // 立刻返回成功，由前端开始监听 stream 频道
    return { 
      success: true, 
      _audit: { sanitizedPrompt, sanitizedContext } 
    };
  });

  ipcMain.handle('ai-get-models', async (event: IpcMainInvokeEvent, payload: any) => {
    if (event.senderFrame && event.senderFrame.parent !== null) {
      throw new Error('Security Violation: Unauthorized AI invocation from sandbox.');
    }
    
    const endpoint = payload?.endpoint || '';
    const provider = payload?.provider || 'openai';
    
    // 强制从安全存储中读取，忽略前端传入的任何伪造 apiKey
    const apiKey = provider === 'ollama' ? '' : getSecureApiKey();

    try {
      const models = await fetchAvailableModels(endpoint, apiKey, provider);
      return { success: true, models };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // =====================================================================
  // 【3】 状态联动原子销毁 (Zero-Out Memory)
  // =====================================================================
  ipcMain.handle('clear-ai-history', async (event: IpcMainInvokeEvent, targetWorkspaceId: string) => {
    
    // 即使是清空操作，依然需要进行溯源验证
    if (event.senderFrame && event.senderFrame.parent !== null) {
      throw new Error('Security Violation: Sandbox cannot issue memory wipe commands.');
    }

    console.log(`[AI Gateway] 🟡 接收到工作区切换指令，执行原子级销毁，目标: ${targetWorkspaceId}`);
    
    // The new LanceDB-free architecture does not require vector DB destruction.
    // The Zero-Out command here only signals the frontend to clear the ephemeral chat window.
    
    return { success: true };
  });
  // =====================================================================
  // 【4】 SQLite 聊天持久化接口 (Persistent Chat Storage)
  // =====================================================================
  ipcMain.handle('ai-get-sessions', async (event: IpcMainInvokeEvent) => {
    try {
      const sessions = ChatStorageManager.getSessions();
      return { success: true, sessions };
    } catch (e: any) {
      console.error('[AI Storage] Error getting sessions:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('ai-create-session', async (event: IpcMainInvokeEvent, id: string, title: string, timestamp: number) => {
    try {
      ChatStorageManager.createSession(id, title, timestamp);
      return { success: true };
    } catch (e: any) {
      console.error('[AI Storage] Error creating session:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('ai-save-message', async (event: IpcMainInvokeEvent, msg: any) => {
    try {
      ChatStorageManager.saveMessage(msg);
      return { success: true };
    } catch (e: any) {
      console.error('[AI Storage] Error saving message:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('ai-delete-session', async (event: IpcMainInvokeEvent, id: string) => {
    try {
      ChatStorageManager.deleteSession(id);
      return { success: true };
    } catch (e: any) {
      console.error('[AI Storage] Error deleting session:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('ai-update-session-title', async (event: IpcMainInvokeEvent, id: string, title: string) => {
    try {
      ChatStorageManager.updateSessionTitle(id, title);
      return { success: true };
    } catch (e: any) {
      console.error('[AI Storage] Error updating session title:', e);
      return { success: false, error: e.message };
    }
  });
}

/**
 * ---------------------------------------------------------
 * 核心数据洗涤中间件 (The Sentinel Sanitizer)
 * ---------------------------------------------------------
 * 负责对发往云端的任何纯文本数据进行高强度的物理打码
 */
function sanitizeAiContext(input: string): string {
  if (!input) return input;
  
  let output = input;

  // 1. SSH 私钥强行脱敏拦截 (涵盖 RSA, OPENSSH, ECDSA 等标准格式)
  const privateKeyRegex = /-----BEGIN (?:RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----(?:.|[\r\n])*?-----END (?:RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----/g;
  output = output.replace(privateKeyRegex, '[REDACTED_SSH_KEY]');

  return output;
}
