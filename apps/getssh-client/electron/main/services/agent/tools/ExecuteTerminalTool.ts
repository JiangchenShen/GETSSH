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

  private collectOutput(targetSessionId: string, onChunk: (chunk: string) => void): Promise<{ output: string; interactivePrompt: string | null }> {
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

        const interactivePrompt = detectInteractivePrompt(outputBuffer);
        resolve({ output: outputBuffer, interactivePrompt });
      };

      const resetSettle = () => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, SETTLE_MS);
      };

      const handleData = (data: string) => {
        outputBuffer += data;
        onChunk(data);
        resetSettle();
      };

      sshBridge.on(`data:${targetSessionId}`, handleData);
      resetSettle();
      maxTimer = setTimeout(finish, MAX_WAIT_MS);
    });
  }

  private waitForUserTerminalInput(targetSessionId: string, onChunk: (chunk: string) => void): Promise<string> {
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
        resolve(outputBuffer);
      };

      const handleData = (data: string) => {
        outputBuffer += data;
        onChunk(data);
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

      const { output: rawOutput, interactivePrompt } = await this.collectOutput(sessionId, onChunk);
      let safeOutput = rawOutput.trim() ? rawOutput.substring(rawOutput.length - 2000) : '[No Output]';

      if (interactivePrompt) {
        onChunk(`\n⏳ 服务器正在等待输入 (\`${interactivePrompt}\`)，请在终端中输入后按回车...\n`);
        const followUpOutput = await this.waitForUserTerminalInput(sessionId, onChunk);
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
