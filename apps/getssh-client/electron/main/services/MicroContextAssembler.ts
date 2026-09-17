import { app } from 'electron';
import { toolRegistry } from './agent/ToolRegistry';

export interface ContextMetadata {
  workspaceName: string;
  sessionId?: string;
  sessionName?: string;
  terminalBuffer?: string;
  language?: string;
  personaContent?: string;
  runbooks: Array<{
    name: string;
    description: string;
    dangerLevel: string;
  }>;
  agentMode?: string;
  aiMaxTokens?: number;
  aiSearchEnabled?: boolean;
  provider?: string;
  /** Preformatted, bounded historical excerpts from encrypted local memory. */
  memoryContext?: string;
}

/**
 * MicroContextAssembler — 唯一的 System Prompt 权威来源
 *
 * 所有注入大模型的提示词都从这里产出。
 * 其他文件（AgentEngine, aiHandler）不允许再注入任何身份声明、格式要求或工具示例。
 */
export class MicroContextAssembler {

  static assemble(metadata: ContextMetadata): string {
    const {
      workspaceName,
      sessionId,
      sessionName,
      runbooks,
      terminalBuffer,
      language,
      personaContent,
      agentMode,
      aiMaxTokens = 200000,
      aiSearchEnabled = true,
      provider,
      memoryContext
    } = metadata;
    const isEn = language === 'en-US';
    const appVersion = app.getVersion();

    // ── 1. Identity ──────────────────────────────────────────────────────
    const identity = personaContent
      ? personaContent
      : isEn
        ? `You are a top-tier DevOps AI Adjutant running inside the GETSSH ${appVersion} terminal.`
        : `你是一个运行在 GETSSH ${appVersion} 终端内的顶级运维 AI 副官。`;

    // ── 2. Environment ───────────────────────────────────────────────────
    const environment = isEn
      ? `[Current Environment]\nWorkspace: ${workspaceName || 'Unnamed Workspace'}\nTarget Host: ${sessionName || 'Global Dispatch Center'}`
      : `[当前运行环境]\n工作区: ${workspaceName || '未命名工作区'}\n目标主机: ${sessionName || '全局调度中心 (Global Mode)'}`;

    // ── 3. Permissions ───────────────────────────────────────────────────
    // 只描述权限边界，不包含任何 <ACTION> 示例（工具格式由 Section 4 统一定义）
    const permissions = MicroContextAssembler.buildPermissions(agentMode, sessionId, isEn);

    // ── 4. Available Tools ───────────────────────────────────────────────
    // 唯一定义 <ACTION> 格式的地方 (仅对 ollama 有效，现代模型走 native tools)
    const tools = MicroContextAssembler.buildTools(agentMode, sessionId, isEn, aiSearchEnabled, provider);

    // ── 5. Formatting ────────────────────────────────────────────────────
    const formatting = isEn
      ? `[Formatting Rules]\n- Always format responses using standard Markdown.\n- Use headings (##, ###), bold (**text**), and bullet points.\n- Use fenced code blocks with language tags for code and commands.\n- Keep responses concise, professional, and visually structured.`
      : `[格式要求]\n- 始终使用标准 Markdown 格式回复。\n- 使用标题 (##, ###)、加粗 (**文本**) 和列表。\n- 代码和命令使用带语言标签的围栏代码块。\n- 回复简洁、专业、结构清晰。`;

    // ── 6. Runbooks ──────────────────────────────────────────────────────
    const runbooksLabel = isEn ? 'Available Runbooks' : '当前可用的运维剧本 Runbooks';
    const runbooksString = runbooks && runbooks.length > 0
      ? runbooks.map(rb => `- ${rb.name}: ${rb.description} (${isEn ? 'Danger Level' : '危险级别'}: ${rb.dangerLevel})`).join('\n')
      : (isEn ? 'None' : '无');

    // ── 7. Terminal / Global Context ─────────────────────────────────────
    // Limit terminal buffer based on aiMaxTokens (approx 4 chars per token). We leave some room for the rest of the prompt.
    const maxChars = Math.max(1000, (aiMaxTokens * 3));
    const safeTerminalBuffer = terminalBuffer
      ? (terminalBuffer.length > maxChars ? terminalBuffer.substring(terminalBuffer.length - maxChars) : terminalBuffer)
      : '';

    const terminalContext = safeTerminalBuffer && sessionId
      ? `\n[${isEn ? 'Terminal Buffer' : '终端缓冲 (Terminal Buffer)'}]\n\`\`\`\n${safeTerminalBuffer}\n\`\`\``
      : '';
    const globalContext = !sessionId && safeTerminalBuffer
      ? `\n[${isEn ? 'Global Mode - Available Hosts' : '全局模式 - 可用主机列表'}]\n\`\`\`json\n${safeTerminalBuffer}\n\`\`\``
      : '';

    // ── 8. Language ──────────────────────────────────────────────────────
    const langInstruction = isEn
      ? `\n[CRITICAL REQUIREMENT] You MUST respond entirely in English (en-US).`
      : `\n[关键指令] 你必须完全使用中文 (zh-CN) 进行回复。`;

    // ── Assemble ─────────────────────────────────────────────────────────
    return [
      identity,
      environment,
      permissions,
      tools,
      formatting,
      `[${runbooksLabel}]\n${runbooksString}`,
      memoryContext,
      terminalContext,
      globalContext,
      langInstruction,
    ].filter(Boolean).join('\n\n');
  }

  // =====================================================================
  // Private Builders
  // =====================================================================

  /**
   * 权限描述：只说你能/不能做什么，不包含任何 <ACTION> 格式示例
   */
  private static buildPermissions(agentMode: string | undefined, sessionId: string | undefined, isEn: boolean): string {
    switch (agentMode) {
      case 'agent_full':
        return isEn
          ? (sessionId
            ? '[PERMISSIONS: Full Takeover]\nYou have FULL autonomy to execute commands on the server to achieve the user\'s objective. Use the tools listed below to take action.'
            : '[PERMISSIONS: Full Takeover - Global Mode]\nYou are in the Global Dispatch Center. You have full autonomy to open server connections. Do NOT attempt to run terminal commands here — use the open_session tool instead.')
          : (sessionId
            ? '[权限状态: 完全接管 (Agent)]\n你拥有完全的自主权，可以直接在服务器上执行命令以达成用户目标。请使用下方列出的工具来执行操作。'
            : '[权限状态: 完全接管 - 全局模式]\n你目前在全局调度中心。你拥有完全自主权来打开服务器连接。此处没有终端，请绝对不要尝试执行终端命令——请使用 open_session 工具。');

      case 'agent_semi':
        return isEn
          ? (sessionId
            ? '[PERMISSIONS: Semi-Takeover]\nYou can propose commands using the tools below. The system will pause and ask the user for approval before running each command.'
            : '[PERMISSIONS: Semi-Takeover - Global Mode]\nYou can propose server connections using the tools below. The system will ask the user for approval before opening them.')
          : (sessionId
            ? '[权限状态: 半自动协同 (Approval)]\n你可以使用下方的工具提出命令建议。系统会自动暂停并弹窗请求用户授权后才会执行。'
            : '[权限状态: 半自动协同 - 全局模式]\n你可以使用下方的工具提出打开服务器的建议。系统会在执行前请求用户授权。');

      case 'assistant':
        return isEn
          ? '[PERMISSIONS: Assistant Mode]\nYou can READ the terminal context, but you CANNOT execute any commands. Advise the user and provide commands for them to run manually. Do NOT output any <ACTION> tags.'
          : '[权限状态: 助手模式 (Assistant)]\n你能看到终端的历史缓冲上下文，但你没有权限自动执行任何命令。请提供指导和建议，并给出命令让用户自行复制或运行。不要输出任何 <ACTION> 标签。';

      case 'readonly':
      default:
        return isEn
          ? '[PERMISSIONS: Read-Only]\nYou are in strict read-only mode. You cannot see the terminal or execute commands. Simply answer based on your knowledge. Do NOT output any <ACTION> tags.'
          : '[权限状态: 纯只读模式 (Read-Only)]\n你目前处于严格的只读模式，无法看到终端上下文，也没有权限执行任何命令。请仅根据你的知识库回答用户的问题。不要输出任何 <ACTION> 标签。';
    }
  }

  /**
   * 工具定义：唯一的 <ACTION> 格式权威来源
   * 只在 agent_full / agent_semi 模式下注入工具列表
   */
  private static buildTools(agentMode: string | undefined, sessionId: string | undefined, isEn: boolean, aiSearchEnabled: boolean, provider?: string): string {
    if (agentMode !== 'agent_full' && agentMode !== 'agent_semi') {
      return ''; // assistant / readonly 模式没有工具
    }

    const useLegacyFormat = provider === 'ollama';

    const header = isEn ? '### AVAILABLE TOOLS & USAGE GUIDELINES' : '### 可用工具与调用准则 (AVAILABLE TOOLS)';
    const subheader = useLegacyFormat
      ? (isEn
        ? 'Use the following tools by outputting the exact JSON syntax enclosed in <ACTION> tags.'
        : '通过输出包裹在 <ACTION> 标签中的 JSON 来调用以下工具。')
      : (isEn
        ? 'You have access to the following native tools. Prioritize local server operations. Only use web search selectively when external information is strictly needed.'
        : '你可以自主调用以下工具。原则：优先使用终端命令与本地上下文进行排障与执行；仅在遇到未知报错或确实需要外部最新技术文档时才选择性调用 search_web，绝不要无理由盲目全网搜索。');

    // 「列哪些工具」由 ToolRegistry.getAvailableTools 单点决定，与 AgentEngine
    // 生成 native schema 时用的是同一个判据 —— 这里只负责怎么措辞。
    // 以前两边各写一套硬编码规则，结果 prompt 里没写的工具照样挂在 native
    // 列表上（search_web 关了还在、open_session 有会话时还在）。
    const available = new Set(
      toolRegistry.getAvailableTools({ hasSession: !!sessionId, searchEnabled: aiSearchEnabled })
        .map(t => t.name)
    );

    const legacy = (body: string) => useLegacyFormat ? `\n<ACTION>\n{\n${body}\n}\n</ACTION>\n` : '';

    const BUILTIN_COPY: Record<string, { desc: string; action: string }> = {
      execute_terminal: {
        desc: isEn ? 'Execute a shell command on the connected server.' : '在已连接的服务器上执行 Shell 命令。',
        action: '  "type": "execute_terminal",\n  "command": "your command here"'
      },
      open_session: {
        desc: isEn ? 'Open a connection to a saved server.' : '打开到已保存服务器的连接。',
        action: '  "type": "open_session",\n  "target": "server alias or host",\n  "execute": "optional command (e.g. sudo -i)"'
      },
      get_environment_info: {
        desc: isEn ? 'Get the current local time, date, and client OS.' : '获取当前本地时间、日期和客户端操作系统。',
        action: '  "type": "get_environment_info"'
      },
      search_web: {
        desc: isEn ? 'Search the internet for technical solutions (USE SELECTIVELY).' : '搜索互联网获取技术方案与文档 (仅在本地信息不足时按需调用)。',
        action: '  "type": "search_web",\n  "query": "your search query here"'
      }
    };

    // 会话模式下终端在前，全局调度模式下开会话在前
    const order = sessionId
      ? ['execute_terminal', 'get_environment_info', 'search_web']
      : ['open_session', 'get_environment_info', 'search_web'];

    let toolList = '';
    let idx = 0;
    for (const name of order) {
      if (!available.has(name)) continue;
      const copy = BUILTIN_COPY[name];
      toolList += `\n${++idx}. **${name}** — ${copy.desc}${legacy(copy.action)}`;
    }

    // ── 3. Dynamic MCP (Model Context Protocol) Tools ──
    // 同样从注册表取：MCP 工具是 McpManager 注册进去的，
    // 走 mcpManager.getActiveMcpTools() 会绕开可用性判据。
    try {
      const mcpTools = toolRegistry
        .getAvailableTools({ hasSession: !!sessionId, searchEnabled: aiSearchEnabled })
        .filter(t => !BUILTIN_COPY[t.name]);
      if (mcpTools.length > 0) {
        toolList += `\n\n${isEn ? '### MCP EXTENSION TOOLS' : '### MCP 外部扩展工具 (Model Context Protocol)'}\n`;
        mcpTools.forEach((tool: any, i: number) => {
          toolList += `\n${i + 1}. **${tool.name}** — ${tool.description || 'Custom MCP tool'}`;
          if (useLegacyFormat) {
            const props = tool.parameters?.properties ?? tool.inputSchema?.properties;
            const hasProps = props && Object.keys(props).length > 0;
            toolList += `\n<ACTION>\n{\n  "type": "${tool.name}"${hasProps ? ',\n  ...parameters matching schema: ' + JSON.stringify(props) : ''}\n}\n</ACTION>\n`;
          }
        });
      }
    } catch (e) {}

    const rules = isEn
      ? `### RULES
- Your permission level above determines whether tools execute immediately or require user approval.
${useLegacyFormat ? '- Output ONLY ONE <ACTION> tag per response. Wait for output before deciding your next step.\n' : ''}- If you have achieved the goal or need to ask the user a question, reply directly.
${useLegacyFormat ? '- Explain what you are doing briefly *before* using <ACTION>.\n' : ''}- Some commands may trigger interactive prompts (password, yes/no). When the system tells you "[Interactive Prompt Detected]", it means the user was asked to type in the terminal. The follow-up output has been captured for you. Just analyze it and continue. Do NOT ask the user for passwords in this chat.`
      : `### 规则
- 你的权限等级决定了工具是立即执行还是需要用户审批。
${useLegacyFormat ? '- 每次回复只输出一个 <ACTION> 标签。等待输出结果后再决定下一步。\n' : ''}- 如果目标已达成或需要向用户提问，直接回复。
${useLegacyFormat ? '- 使用 <ACTION> 之前简要说明你要做什么。\n' : ''}- 部分命令可能触发交互式提示（密码、yes/no）。当系统告知你"[Interactive Prompt Detected]"，说明用户已在终端中输入。后续输出已为你捕获，直接分析并继续即可。不要在聊天中要求用户输入密码。`;

    return `${header}\n${subheader}\n${toolList}\n\n${rules}`;
  }
}
