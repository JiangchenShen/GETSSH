export interface ContextMetadata {
  workspaceName: string;
  sessionAlias: string;
  runbooks: Array<{
    name: string;
    description: string;
    dangerLevel: string;
  }>;
}

export class MicroContextAssembler {
  /**
   * Assembles a strictly formatted, ultra-lightweight System Prompt
   * based on the frontend's deterministic Zustand state.
   */
  static assemble(metadata: ContextMetadata): string {
    const { workspaceName, sessionAlias, runbooks } = metadata;
    
    const runbooksString = runbooks && runbooks.length > 0
      ? runbooks.map(rb => `- ${rb.name}: ${rb.description} (危险级别: ${rb.dangerLevel})`).join('\n')
      : '无';

    return `你是一个运行在 GETSSH 3.0 终端内的顶级运维 AI 副官。
[当前运行环境]
工作区: ${workspaceName || '未命名工作区'}
目标主机: ${sessionAlias || '未连接'}
[当前可用的运维剧本 Runbooks]
${runbooksString}`;
  }
}
