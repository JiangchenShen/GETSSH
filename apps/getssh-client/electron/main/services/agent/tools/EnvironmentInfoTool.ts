import { AgentTool, ToolExecutionContext, ToolExecutionResult } from '../types';

export class EnvironmentInfoTool implements AgentTool {
  public name = 'get_environment_info';
  public description = 'Gets local time and client OS environment metadata.';

  public async execute(_payload: any, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const { onChunk } = ctx;
    const now = new Date();
    const currentPlatform = typeof process !== 'undefined' ? process.platform : 'Unknown OS';
    const timeString = now.toLocaleString();

    const envInfo = `Local Time: ${timeString}\nClient OS Platform: ${currentPlatform}`;

    onChunk(`\n\n\`\`\`\n# [AGENT COMMAND OUTPUT]\n${envInfo}\n\`\`\`\n\n`);

    return {
      success: true,
      shouldContinue: false,
      contextFeed: `\nAction Taken: get_environment_info\nResult:\n${envInfo}\n`,
      promptFeed: `[Environment Info]:\n${envInfo}`
    };
  }
}
