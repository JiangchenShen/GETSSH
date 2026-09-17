/**
 * Agent Tool Interface & Context Types
 */

export interface ToolExecutionContext {
  sessionId: string;
  workspaceId?: string;
  mode: string;
  aiMaxTokens: number;
  searchConfig: any;
  onChunk: (chunk: string) => void;
  askApproval?: (command: string) => Promise<boolean>;
  onGlobalAction?: (payload: any) => void;
}

export interface ToolExecutionResult {
  success: boolean;
  promptFeed?: string;
  contextFeed?: string;
  shouldContinue: boolean;
  error?: string;
  outputData?: any;
}

export interface AgentTool {
  name: string;
  description: string;
  isCritical?: boolean; // If false, failure won't halt the AgentEngine ReAct loop
  parameters?: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
  execute(payload: any, ctx: ToolExecutionContext): Promise<ToolExecutionResult>;
}
