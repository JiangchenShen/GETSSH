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
}

export class MicroContextAssembler {
  /**
   * Assembles a strictly formatted, ultra-lightweight System Prompt
   * based on the frontend's deterministic Zustand state.
   */
  static assemble(metadata: ContextMetadata): string {
    const { workspaceName, sessionId, sessionName, runbooks, terminalBuffer, language, personaContent, agentMode } = metadata;
    
    const isEn = language === 'en-US';

    const runbooksString = runbooks && runbooks.length > 0
      ? runbooks.map(rb => `- ${rb.name}: ${rb.description} (${isEn ? 'Danger Level' : '危险级别'}: ${rb.dangerLevel})`).join('\n')
      : (isEn ? 'None' : '无');

    const terminalContext = terminalBuffer && sessionId ? `\n[${isEn ? 'Terminal Buffer' : '终端缓冲 (Terminal Buffer)'}]\n\`\`\`\n${terminalBuffer}\n\`\`\`` : '';
    const globalContext = !sessionId && terminalBuffer ? `\n[${isEn ? 'Global Mode - Available Hosts' : '全局模式 - 可用主机列表'}]\n\`\`\`json\n${terminalBuffer}\n\`\`\`` : '';

    const langInstruction = isEn 
      ? `\n[CRITICAL REQUIREMENT] You MUST respond entirely in English (en-US).`
      : `\n[关键指令] 你必须完全使用中文 (zh-CN) 进行回复。`;

    let permissionInstructionEn = '';
    let permissionInstructionZh = '';

    switch(agentMode) {
      case 'agent_full':
        permissionInstructionEn = '[PERMISSIONS: Full Takeover] You have FULL autonomy. You can execute commands directly on the server to achieve the user\'s objective. Output commands strictly using the <EXECUTE> tag format specified in your system instructions.';
        permissionInstructionZh = '[权限状态: 完全接管 (Agent)] 你拥有完全的自主权，可以直接在服务器上执行命令以达成用户目标。请务必严格使用系统指令中规定的 <EXECUTE> 标签格式来输出你想执行的命令。';
        break;
      case 'agent_semi':
        permissionInstructionEn = '[PERMISSIONS: Semi-Takeover] You can propose commands for the user to execute. Output commands strictly using the <EXECUTE> tag format specified in your system instructions. The system will pause and ask the user for approval before running it.';
        permissionInstructionZh = '[权限状态: 半自动协同 (Approval)] 你可以提出解决方案和具体命令。请务必严格按照系统指令中规定的 <EXECUTE> 标签格式来包裹你想执行的命令，系统会自动拦截该标签并向用户弹窗请求授权，用户同意后才会真正执行。';
        break;
      case 'assistant':
        permissionInstructionEn = '[PERMISSIONS: Assistant Mode] You can READ the terminal context, but you CANNOT execute commands automatically. Advise the user and provide the commands for them to run manually.';
        permissionInstructionZh = '[权限状态: 助手模式 (Assistant)] 你能看到终端的历史缓冲上下文，但你没有权限自动执行任何命令。请提供指导和建议，并给出命令让用户自行复制或运行。';
        break;
      case 'readonly':
      default:
        permissionInstructionEn = '[PERMISSIONS: Read-Only] You are in strict read-only mode. You cannot see the live terminal or execute commands. Simply answer the user\'s questions based on your knowledge.';
        permissionInstructionZh = '[权限状态: 纯只读模式 (Read-Only)] 你目前处于严格的只读模式，无法看到终端上下文，也没有权限执行任何命令。请仅根据你的知识库回答用户的问题。';
        break;
    }

    const baseEn = personaContent ? personaContent : `You are a top-tier DevOps AI Adjutant running inside the GETSSH 3.0 terminal.`;
    const baseZh = personaContent ? personaContent : `你是一个运行在 GETSSH 3.0 终端内的顶级运维 AI 副官。`;

    if (isEn) {
      return `${baseEn}
[Current Environment]
Workspace: ${workspaceName || 'Unnamed Workspace'}
Target Host: ${sessionName ? sessionName : 'Global Dispatch Center'}
${permissionInstructionEn}
[Available Runbooks]
${runbooksString}${terminalContext}${globalContext}${langInstruction}`;
    }

    return `${baseZh}
[当前运行环境]
工作区: ${workspaceName || '未命名工作区'}
目标主机: ${sessionName ? sessionName : '全局调度中心 (Global Mode)'}
${permissionInstructionZh}
[当前可用的运维剧本 Runbooks]
${runbooksString}${terminalContext}${globalContext}${langInstruction}`;
  }
}
