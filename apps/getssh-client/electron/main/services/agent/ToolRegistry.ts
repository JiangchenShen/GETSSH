import { AgentTool, ToolExecutionContext, ToolExecutionResult } from './types';
import { ExecuteTerminalTool } from './tools/ExecuteTerminalTool';
import { SearchWebTool } from './tools/SearchWebTool';
import { OpenSessionTool } from './tools/OpenSessionTool';
import { EnvironmentInfoTool } from './tools/EnvironmentInfoTool';

/**
 * ToolRegistry — Agent 可插拔工具注册中心
 *
 * 彻底解耦 AgentEngine 核心循环与具体工具执行逻辑。
 * 支持热插拔与扩展未来工具（如 Anthropic MCP Server）。
 */
export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  constructor() {
    this.registerDefaults();
  }

  public register(tool: AgentTool) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Agent tool is already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  public unregister(name: string) {
    this.tools.delete(name);
  }

  public getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  public getRegisteredTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 当前上下文下真正该暴露给模型的工具。
   *
   * 这是「有哪些工具可用」的唯一判据。原来有两套：AgentEngine 生成 native
   * schema 时只滤了 execute_terminal，MicroContextAssembler 写 prompt 时另有
   * 一套硬编码规则。两边不同步的后果是模型看到 prompt 里没写、却在 native
   * 列表里挂着的工具 —— 比如联网搜索关掉后 search_web 仍可被调用，
   * 调完 SearchEngine 抛 disabled，SearchWebTool 因 isCritical=false 不中断，
   * 白烧一轮 MAX_LOOPS。
   */
  public getAvailableTools(av: { hasSession: boolean; searchEnabled: boolean }): AgentTool[] {
    return this.getRegisteredTools().filter(t => {
      // 没有已连接会话就无处执行命令
      if (t.name === 'execute_terminal') return av.hasSession;
      // 会话内不再调度新会话：与 MicroContextAssembler 的「终端会话模式 /
      // 全局调度模式」二分保持一致。想让 Agent 在会话中也能开新主机，
      // 把这行改成 `return true` 即可，两侧会一起生效。
      if (t.name === 'open_session') return !av.hasSession;
      if (t.name === 'search_web') return av.searchEnabled;
      return true; // get_environment_info 与所有 MCP 工具
    });
  }

  public async execute(actionType: string, payload: any, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const tool = this.tools.get(actionType);
    if (!tool) {
      ctx.onChunk(`\n❌ **[AGENT]** 未知或已禁用的操作类型: \`${actionType}\`\n`);
      return {
        success: false,
        shouldContinue: false,
        error: `Unknown action type: ${actionType}`
      };
    }

    return await tool.execute(payload, ctx);
  }

  private registerDefaults() {
    this.register(new ExecuteTerminalTool());
    this.register(new SearchWebTool());
    this.register(new OpenSessionTool());
    this.register(new EnvironmentInfoTool());
  }
}

export const toolRegistry = new ToolRegistry();
