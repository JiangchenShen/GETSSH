import { AgentTool, ToolExecutionContext, ToolExecutionResult } from '../types';

export class OpenSessionTool implements AgentTool {
  public name = 'open_session';
  public description = 'Opens an SSH or terminal session by host or alias, optionally executing an initial command.';
  public parameters = {
    type: 'object' as const,
    properties: {
      target: { type: 'string', description: 'Session alias, host address, or username@host' },
      execute: { type: 'string', description: 'Optional initial command to execute immediately once connected (e.g. uptime, sudo -i, nginx status)' }
    },
    required: ['target']
  };

  public async execute(payload: any, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const { onChunk, onGlobalAction } = ctx;
    const target = payload.target;

    if (!target) {
      onChunk(`\n❌ **[AGENT]** 未提供目标主机名或别名。\n`);
      return { success: false, shouldContinue: false, error: 'Missing target argument' };
    }

    if (onGlobalAction) {
      const dispatched = onGlobalAction({
        type: 'open_session',
        target,
        ...payload
      });
      if (dispatched === false) {
        onChunk(`\n❌ **[AGENT]** 最近 10 分钟内由代理打开的会话已达上限，没有打开 ${target}。\n`);
        return {
          success: false,
          shouldContinue: true,
          error: 'Too many sessions opened by the agent recently',
          promptFeed: `[System]: open_session was refused: the agent has opened the maximum number of sessions for the last 10 minutes. Do not call open_session again; tell the user which sessions are open and what is left to do.`,
        };
      }
    } else {
      console.warn('[OpenSessionTool] ⚠️ No onGlobalAction callback registered, global action dropped!');
    }

    onChunk(`\n\n\`\`\`\n# [AGENT ACTION]\n🚀 已自动调度并打开终端会话: ${target}${payload.execute ? ` (附带执行: ${payload.execute})` : ''}\n\`\`\`\n\n`);

    return {
      success: true,
      shouldContinue: true,
      contextFeed: `\nAction Taken: open_session (${target})\nResult: Session "${target}" has been successfully dispatched to the UI workspace${payload.execute ? ` with initial command: "${payload.execute}"` : ''}.\n`,
      promptFeed: `[System]: Terminal session "${target}" has been opened in the workspace${payload.execute ? ` and queued command "${payload.execute}"` : ''}. Directly inform the user that the server is ready, summarize what was done, and offer next steps.`
    };
  }

}
