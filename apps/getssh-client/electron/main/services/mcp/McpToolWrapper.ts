import { AgentTool, ToolExecutionContext, ToolExecutionResult } from '../agent/types';
import { McpClient } from './McpClient';
import { McpToolDefinition } from './mcpTypes';
import {
  MAX_MCP_TOOL_ARGUMENT_DISPLAY_CHARS,
  MAX_MCP_TOOL_OUTPUT_CHARS,
  mcpToolRegistryName,
  truncateMcpText
} from './McpProtocolPolicy';

function safeDisplayJson(value: unknown, maxChars: number): string {
  try {
    return truncateMcpText(JSON.stringify(value, null, 2), maxChars);
  } catch {
    return '[Unserializable MCP value]';
  }
}

/**
 * MCP server 给的 inputSchema 未必规整（可能没有 type，或整个缺失）。
 * 统一成 AgentTool.parameters 要求的对象 schema，缺什么补什么。
 */
function normalizeSchema(schema: any): AgentTool['parameters'] {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {}, required: [] };
  }
  return {
    ...schema,
    type: 'object',
    properties: (schema.properties && typeof schema.properties === 'object') ? schema.properties : {},
    required: Array.isArray(schema.required) ? schema.required : []
  };
}

/**
 * McpToolWrapper — Bridges an MCP Server tool into GETSSH's pluggable Agent ToolRegistry
 */
export class McpToolWrapper implements AgentTool {
  public name: string;
  public isCritical = false;
  public description: string;
  /** MCP 协议原样的 inputSchema，prompt 侧的 legacy <ACTION> 示例要用 */
  public inputSchema?: any;
  /**
   * AgentTool 接口用的字段名是 parameters，不是 inputSchema。
   * 之前只赋了 inputSchema，AgentEngine 取 `t.parameters || {空 schema}`，
   * 结果每个 MCP 工具发给模型的入参 schema 都是空的 —— 模型只能盲猜参数名。
   */
  public parameters: AgentTool['parameters'];
  private serverName: string;
  private client: McpClient;
  private originalToolName: string;

  constructor(serverId: string, serverName: string, toolDef: McpToolDefinition, client: McpClient) {
    this.serverName = serverName;
    this.originalToolName = toolDef.name;
    this.name = mcpToolRegistryName(serverId, toolDef.name);
    this.description = `[MCP: ${serverName}] ${toolDef.description || 'External MCP tool'}`;
    this.inputSchema = toolDef.inputSchema;
    this.parameters = normalizeSchema(toolDef.inputSchema);
    this.client = client;
  }

  public async execute(payload: any, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const { onChunk } = ctx;
    const payloadDisplay = safeDisplayJson(payload, MAX_MCP_TOOL_ARGUMENT_DISPLAY_CHARS);

    onChunk(`\n\n\`\`\`bash\n# [MCP TOOL CALL: ${this.serverName} -> ${this.originalToolName}]\n${payloadDisplay}\n\`\`\`\n\n`);

    try {
      const res = await this.client.callTool(this.originalToolName, payload);

      let textOutput = '';
      if (res.content && Array.isArray(res.content)) {
        textOutput = res.content
          .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : `[${String(c.type)} content]`))
          .join('\n');
      } else {
        textOutput = safeDisplayJson(res, MAX_MCP_TOOL_OUTPUT_CHARS);
      }
      textOutput = truncateMcpText(textOutput, MAX_MCP_TOOL_OUTPUT_CHARS);

      onChunk(`\n\n\`\`\`\n# [MCP TOOL OUTPUT]\n${textOutput}\n\`\`\`\n\n`);

      const isErr = !!res.isError;
      return {
        success: !isErr,
        shouldContinue: true,
        contextFeed: `\nAction Taken: MCP Tool '${this.name}' (${payloadDisplay})\nResult:\n${textOutput}\n`,
        promptFeed: `[MCP Tool '${this.name}' Output]:\n${textOutput}\n\nBased on this tool result, what is the next step?`
      };
    } catch (err: any) {
      const errorMessage = String(err?.message || err).slice(0, 4_096);
      onChunk(`\n❌ **[MCP TOOL ERROR]** ${errorMessage}\n`);
      return {
        success: false,
        shouldContinue: true,
        contextFeed: `\nAction Taken: MCP Tool '${this.name}' Failed\nError: ${errorMessage}\n`,
        promptFeed: `[MCP Tool '${this.name}' Execution Failed]: ${errorMessage}\nPlease proceed with an alternative approach.`
      };
    }
  }
}
