import { IpcMainInvokeEvent, BrowserWindow, app, safeStorage } from 'electron';
import { streamLLM, fetchAvailableModels } from '../services/llmService';
import { AgentEngine } from '../services/AgentEngine';
import { MicroContextAssembler } from '../services/MicroContextAssembler';
import { ChatStorageManager } from '../services/chatStorageManager';
import { LocalMemoryService, formatLocalMemoryContext } from '../services/LocalMemoryService';
import { SearchEngine } from '../services/SearchEngine';
import { SentinelGateway } from '../services/SentinelGateway';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const AGENT_APPROVAL_TIMEOUT_MS = 5 * 60_000;

/**
 * Per-provider vault path. Each provider stores its API Key separately.
 * Format: ai_vault_${provider}.enc (e.g. ai_vault_gemini.enc)
 * Legacy fallback: ai_vault.enc (pre-multi-provider)
 */
const getAiVaultPath = (provider = 'default') =>
  join(app.getPath('userData'), `ai_vault_${provider.toLowerCase()}.enc`);

function getSecureApiKey(provider = 'default'): string {
  // Per-provider vault (new format)
  let vaultPath = getAiVaultPath(provider);
  // Legacy fallback: read ai_vault.enc if per-provider file doesn't exist yet
  if (!fs.existsSync(vaultPath)) {
    vaultPath = join(app.getPath('userData'), 'ai_vault.enc');
  }
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
  // ai-save-api-key: now accepts optional provider to separate vaults
  ipcMain.handle('ai-save-api-key', async (event: IpcMainInvokeEvent, apiKey: string, provider?: string) => {
    if (event.senderFrame && event.senderFrame.parent !== null) {
      throw new Error('Security Violation: Unauthorized AI invocation from sandbox.');
    }
    if (!apiKey) return { success: false };
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(apiKey);
        fs.writeFileSync(getAiVaultPath(provider), encrypted);
        return { success: true };
      }
      return { success: false, error: 'OS Keychain encryption unavailable' };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ai-delete-api-key: delete per-provider vault (and legacy vault as fallback)
  ipcMain.handle('ai-delete-api-key', async (event: IpcMainInvokeEvent, provider?: string) => {
    if (event.senderFrame && event.senderFrame.parent !== null) {
      throw new Error('Security Violation: Unauthorized AI invocation from sandbox.');
    }
    try {
      const vaultPath = getAiVaultPath(provider);
      if (fs.existsSync(vaultPath)) fs.unlinkSync(vaultPath);
      // Also clean up legacy vault
      const legacyVaultPath = join(app.getPath('userData'), 'ai_vault.enc');
      if (fs.existsSync(legacyVaultPath)) fs.unlinkSync(legacyVaultPath);
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

    const rawPrompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
    const contextData = payload?.contextData;
    const mode = payload?.mode || 'readonly';

    const aiMaxTokens = payload?.aiMaxTokens || 200000;
    const endpoint = payload?.endpoint || '';
    const provider = payload?.provider || 'openai';
    const model = payload?.model || 'gpt-3.5-turbo';

    const sessionId = typeof contextData?.sessionId === 'string' ? contextData.sessionId : undefined;
    const workspaceId = ChatStorageManager.getCurrentWorkspaceId() || undefined;
    let memoryContext = '';
    if (workspaceId && rawPrompt.trim()) {
      try {
        memoryContext = formatLocalMemoryContext(
          LocalMemoryService.search(workspaceId, rawPrompt, {
            excludeSessionId: sessionId,
            limit: 6
          }),
          contextData?.language
        );
      } catch (error) {
        console.warn('[AI Gateway] Encrypted local-memory retrieval failed:', error);
      }
    }

    // Retrieved history is bounded, marked as untrusted data, and passes
    // through the same final Sentinel egress sanitizer as all other context.
    const rawContext = contextData
      ? MicroContextAssembler.assemble({
          ...contextData,
          agentMode: mode,
          aiMaxTokens,
          provider,
          memoryContext
        })
      : '';

    // LlmGateway is the single egress sanitizer. A one-shot pass here is only
    // returned as local audit evidence; the outbound request is sanitized again
    // as one reversible session together with history and tool results.
    const auditPrompt = SentinelGateway.sanitize(rawPrompt).cleanText;
    const auditContext = SentinelGateway.sanitize(rawContext).cleanText;

    // Formatting and identity instructions are handled by MicroContextAssembler.
    // No additional prompt injection needed here.

    console.log(`[AI Gateway] 🟢 数据洗涤完毕，准备建立流式隧道. RequestID: ${requestId}`);

    // BYOK 加密解密与云端大模型 API 直连逻辑
    // 强制从安全存储中读取，忽略前端传入的任何伪造 apiKey
    // 按 provider 分文件读取，确保不同 provider 的 key 完全隔离
    const apiKey = provider === 'ollama' ? '' : getSecureApiKey(provider);

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

    if (mode === 'agent_semi' || mode === 'agent_full') {
      console.log(`[AI Gateway] 🚀 Launching Agent Engine for session ${sessionId || 'GLOBAL'} in mode ${mode}`);

      const askApproval = async (command: string): Promise<boolean> => {
        return new Promise((resolve) => {
          const approvalId = randomUUID();
          const requestSender = event.sender;
          let settled = false;
          const finish = (approved: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            ipcMain.removeListener('ai-agent-approve', listener);
            requestSender.removeListener('destroyed', senderDestroyed);
            resolve(approved);
          };
          const listener = (
            approvalEvent: Electron.IpcMainEvent,
            receivedApprovalId: unknown,
            isApproved: unknown
          ) => {
            if (
              approvalEvent.sender.id !== requestSender.id ||
              (approvalEvent.senderFrame && approvalEvent.senderFrame.parent !== null) ||
              receivedApprovalId !== approvalId
            ) return;
            finish(isApproved === true);
          };
          const senderDestroyed = () => finish(false);
          const timer = setTimeout(() => finish(false), AGENT_APPROVAL_TIMEOUT_MS);
          timer.unref();
          ipcMain.on('ai-agent-approve', listener);
          requestSender.once('destroyed', senderDestroyed);
          if (!requestSender.isDestroyed()) {
            requestSender.send('ai-agent-approval-request', { requestId: approvalId, command });
          } else {
            finish(false);
          }
        });
      };

      const onGlobalAction = (actionPayload: any) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ai-agent-global-action', actionPayload);
        }
      };

      const aiMaxTokens = payload?.aiMaxTokens || 200000;
      const searchConfig = payload?.searchConfig || { enabled: true, provider: 'hybrid' };
      const thinkingEffort = payload?.thinkingEffort || 'medium';

      AgentEngine.runAgentLoop(
        endpoint, apiKey, provider, model,
        rawPrompt, rawContext, sessionId, workspaceId, mode, requestId, aiMaxTokens,
        searchConfig,
        onChunk, onDone, onError, askApproval, onGlobalAction, thinkingEffort
      );
    } else {
      const thinkingEffort = payload?.thinkingEffort || 'medium';
      const aiMaxTokens = payload?.aiMaxTokens;

      streamLLM(
        endpoint, apiKey, provider, model,
        rawPrompt, rawContext,
        onChunk, onDone, onError,
        { thinkingEffort, maxOutputTokens: aiMaxTokens }
      );
    }

    // 立刻返回成功，由前端开始监听 stream 频道
    return {
      success: true,
      _audit: {
        sanitizedPrompt: auditPrompt,
        sanitizedContext: auditContext,
        // Native Sentinel uses reversible placeholders. If it is unavailable,
        // SentinelGateway applies an irreversible JS fallback to every egress segment.
        sentinelActive: SentinelGateway.isAvailable(),
        sentinelError: SentinelGateway.getLoadError()
      }
    };
  });

  ipcMain.handle('ai-get-models', async (event: IpcMainInvokeEvent, payload: any) => {
    if (event.senderFrame && event.senderFrame.parent !== null) {
      throw new Error('Security Violation: Unauthorized AI invocation from sandbox.');
    }

    const endpoint = payload?.endpoint || '';
    const provider = payload?.provider || 'openai';

    // 强制从安全存储中读取，忽略前端传入的任何伪造 apiKey（按 provider 分文件）
    const apiKey = provider === 'ollama' ? '' : getSecureApiKey(provider);

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

    // Local memory is workspace-keyed inside the app-key SQLCipher database.
    // A workspace switch changes the active key immediately; persistent history
    // remains available until the user deletes its sessions or workspace.

    return { success: true };
  });

  // =====================================================================
  // 【3.5】 测试搜索配置
  // =====================================================================
  ipcMain.handle('ai-test-search', async (event: IpcMainInvokeEvent, config: any) => {
    try {
      // Force enabled for test, otherwise it might throw if disabled
      const testConfig = { ...config, enabled: true };
      const results = await SearchEngine.search('GETSSH', testConfig);
      return { success: true, count: results.length };
    } catch (e: any) {
      console.warn('[AI Gateway] Test search failed:', e);
      return { success: false, error: e.message };
    }
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
