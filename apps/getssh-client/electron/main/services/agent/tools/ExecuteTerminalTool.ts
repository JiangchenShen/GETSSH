import { AgentTool, ToolExecutionContext, ToolExecutionResult } from '../types';
import { sshBridge } from '../../SSHBridge';
import { SecureCenter } from '../../../security/SecureCenter';

const INTERACTIVE_PROMPT_PATTERNS = [
  /password\s*:/i,
  /\[sudo\]/i,
  /\(yes\/no(\/\[fingerprint\])?\)/i,
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /Are you sure/i,
  /Enter passphrase/i,
  /login:\s*$/i,
  /Press any key/i,
  /Do you want to continue/i,
];

/** How much of one command's output the chat shows; the terminal has all of it. */
const MAX_CHAT_OUTPUT_CHARS = 32 * 1024;
/** How much of it the tool keeps for the model, which reads the end. */
const MAX_KEPT_OUTPUT_CHARS = 64 * 1024;
const CHAT_FLUSH_MS = 100;

const keepTail = (text: string) => (text.length > MAX_KEPT_OUTPUT_CHARS ? text.slice(-MAX_KEPT_OUTPUT_CHARS) : text);

/**
 * A command's output on its way to the chat: in batches at most every 100 ms, and at most 32 KB in
 * all. Each SSH packet used to be its own message, the renderer re-parses the conversation for
 * every message, and the whole dump was saved with the chat, so a command with a lot of output
 * froze the window and made the chat history heavy for good.
 */
export class ChatOutput {
  private pending = '';
  private forwarded = 0;
  private truncated = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onChunk: (chunk: string) => void) {}

  push(data: string) {
    if (this.truncated) return;
    const room = MAX_CHAT_OUTPUT_CHARS - this.forwarded - this.pending.length;
    if (data.length > room) {
      this.pending += data.slice(0, Math.max(0, room)) + '\n[输出太长，这里只显示前 32 KB，完整内容在终端里]\n';
      this.truncated = true;
      this.flush();
      return;
    }
    this.pending += data;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), CHAT_FLUSH_MS);
  }

  /** Sends what is waiting; call it before any other chat line so the order stays right. */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;
    const chunk = this.pending;
    this.forwarded += chunk.length;
    this.pending = '';
    this.onChunk(chunk);
  }
}

function detectInteractivePrompt(output: string): string | null {
  for (const pattern of INTERACTIVE_PROMPT_PATTERNS) {
    if (pattern.test(output)) {
      const match = output.match(pattern);
      return match ? match[0] : 'interactive prompt';
    }
  }
  return null;
}

export class ExecuteTerminalTool implements AgentTool {
  public name = 'execute_terminal';
  public description = 'Executes a shell command directly inside the active SSH/Local terminal session.';
  public parameters = {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'The shell command to execute in the terminal' },
      sessionId: { type: 'string', description: 'Optional target session ID' }
    },
    required: ['command']
  };

  private collectOutput(targetSessionId: string, chat: ChatOutput): Promise<{ output: string; interactivePrompt: string | null }> {
    const SETTLE_MS = 800;
    const MAX_WAIT_MS = 15000;

    return new Promise((resolve) => {
      let outputBuffer = '';
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      let maxTimer: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (settleTimer) clearTimeout(settleTimer);
        if (maxTimer) clearTimeout(maxTimer);
        sshBridge.removeListener(`data:${targetSessionId}`, handleData);
        chat.flush();

        const interactivePrompt = detectInteractivePrompt(outputBuffer);
        resolve({ output: outputBuffer, interactivePrompt });
      };

      const resetSettle = () => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, SETTLE_MS);
      };

      const handleData = (data: string) => {
        outputBuffer = keepTail(outputBuffer + data);
        chat.push(data);
        resetSettle();
      };

      sshBridge.on(`data:${targetSessionId}`, handleData);
      resetSettle();
      maxTimer = setTimeout(finish, MAX_WAIT_MS);
    });
  }

  private waitForUserTerminalInput(targetSessionId: string, chat: ChatOutput): Promise<string> {
    const SETTLE_MS = 800;

    return new Promise((resolve) => {
      let outputBuffer = '';
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      let maxTimer: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (settleTimer) clearTimeout(settleTimer);
        if (maxTimer) clearTimeout(maxTimer);
        sshBridge.removeListener(`data:${targetSessionId}`, handleData);
        chat.flush();
        resolve(outputBuffer);
      };

      const handleData = (data: string) => {
        outputBuffer = keepTail(outputBuffer + data);
        chat.push(data);
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, SETTLE_MS);
      };

      sshBridge.on(`data:${targetSessionId}`, handleData);
      maxTimer = setTimeout(finish, 60000);
    });
  }

  public async execute(payload: any, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const { sessionId, mode, aiMaxTokens, onChunk, askApproval } = ctx;
    const commandToExecute = payload.command;

    if (!commandToExecute) {
      onChunk(`\n❌ **[AGENT]** 执行失败：未提供 command 参数。\n`);
      return { success: false, shouldContinue: false, error: 'Missing command argument' };
    }

    if (!sessionId) {
      onChunk(`\n❌ **[AGENT]** 当前没有活跃的终端会话，无法执行命令。\n`);
      return { success: false, shouldContinue: false, error: 'No active session' };
    }

    // Semi-takeover approval
    if (mode === 'agent_semi' && askApproval) {
      onChunk(`\n\n\`\`\`bash\n# [AGENT PROPOSES COMMAND]\n${commandToExecute}\n\`\`\`\n\n`);
      try {
        const isApproved = await askApproval(commandToExecute);
        if (!isApproved) {
          onChunk(`\n❌ **[AGENT]** 用户拒绝了该命令。\n`);
          return {
            success: false,
            shouldContinue: true,
            contextFeed: `\nAction Proposed: ${commandToExecute}\nResult: User Rejected.\n`,
            promptFeed: `[Command Rejected by User]: ${commandToExecute}\nDo not execute this command again. What is the alternative?`
          };
        }
        onChunk(`\n✅ **已批准** 正在执行...\n`);
      } catch (err: any) {
        onChunk(`\n❌ **[AGENT]** 审批请求失败: ${err.message}\n`);
        return { success: false, shouldContinue: false, error: err.message };
      }
    } else {
      onChunk(`\n\n\`\`\`bash\n# [AGENT IS EXECUTING COMMAND]\n${commandToExecute}\n\`\`\`\n\n`);
    }

    // Security audit is now fully delegated to SSHBridge.writeCommand
    // If blocked, SSHBridge will throw an error which will be caught below.

    try {
      sshBridge.writeCommand(sessionId, commandToExecute);
      onChunk(`\n\n\`\`\`\n# [AGENT LIVE OUTPUT]\n`);

      const chat = new ChatOutput(onChunk);
      const { output: rawOutput, interactivePrompt } = await this.collectOutput(sessionId, chat);
      let safeOutput = rawOutput.trim() ? rawOutput.substring(rawOutput.length - 2000) : '[No Output]';

      if (interactivePrompt) {
        onChunk(`\n⏳ 服务器正在等待输入 (\`${interactivePrompt}\`)，请在终端中输入后按回车...\n`);
        const followUpOutput = await this.waitForUserTerminalInput(sessionId, chat);
        if (followUpOutput.trim()) {
          safeOutput += followUpOutput;
        }
      }

      onChunk(`\n\`\`\`\n\n`);

      const singleOutputMaxChars = Math.max(2000, Math.floor((aiMaxTokens * 3) / 5));
      const contextOutput = safeOutput.length > singleOutputMaxChars
        ? safeOutput.substring(safeOutput.length - singleOutputMaxChars)
        : safeOutput;

      return {
        success: true,
        shouldContinue: true,
        contextFeed: `\nAction: ${commandToExecute}\nOutput:\n${contextOutput}\n`,
        promptFeed: `[Command Output for \`${commandToExecute}\`]:\n${contextOutput}\n\nBased on this output, what is the next step?`
      };
    } catch (e: any) {
      onChunk(`\n❌ **[AGENT]** 执行失败: ${e.message}\n`);
      return { success: false, shouldContinue: false, error: e.message };
    }
  }
}
