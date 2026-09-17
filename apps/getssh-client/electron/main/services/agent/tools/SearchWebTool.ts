import { AgentTool, ToolExecutionContext, ToolExecutionResult } from '../types';
import { SearchEngine } from '../../SearchEngine';

export class SearchWebTool implements AgentTool {
  public name = 'search_web';
  public isCritical = false;
  public description = 'Searches the internet for technical solutions, error codes, and documentation.';
  public parameters = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query keyword or technical question' }
    },
    required: ['query']
  };

  public async execute(payload: any, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const { onChunk, searchConfig } = ctx;
    const query = payload.query;

    if (!query) {
      onChunk(`\n❌ **[AGENT]** 搜索失败：未提供 query 参数。\n`);
      return { success: false, shouldContinue: false, error: 'Missing query argument' };
    }

    onChunk(`\n\n\`\`\`bash\n# [AGENT IS SEARCHING THE WEB]\nQuery: ${query}\n\`\`\`\n\n`);

    try {
      const results = await SearchEngine.search(query, searchConfig);

      let resultText = `Search Results for "${query}":\n\n`;
      results.forEach((res, i) => {
        resultText += `${i + 1}. ${res.title}\nURL: ${res.url}\nSnippet: ${res.snippet}\n\n`;
      });

      onChunk(`\n\n\`\`\`\n# [AGENT COMMAND OUTPUT]\nFetched ${results.length} results.\n\`\`\`\n\n`);

      return {
        success: true,
        shouldContinue: true,
        contextFeed: `\nAction Taken: search_web ("${query}")\nResult:\n${resultText}\n`,
        promptFeed: `[Web Search Results]:\n${resultText}\n\nBased on these results, what is the next step?`
      };
    } catch (e: any) {
      onChunk(`\n❌ **[AGENT]** 搜索失败: ${e.message}\n`);
      return {
        success: false,
        shouldContinue: true,
        contextFeed: `\nAction Taken: search_web ("${query}")\nResult: Failed (${e.message})\n`,
        promptFeed: `[Web Search Failed]: ${e.message}\n\nPlease proceed without search or try an alternative approach.`
      };
    }
  }
}
