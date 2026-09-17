/**
 * Model Context Protocol (MCP) Types & Contracts
 * Fully compliant with Anthropic MCP 2024-11-05 specification
 * (Tools, Resources, Prompts, Sampling, and Server Primitives)
 */

export type McpTransportType = 'stdio' | 'sse' | 'http';

export interface McpServerPermissions {
  /** Stdio servers start without host networking unless this is explicitly true. */
  network?: boolean;
  /** Allow the server to spend the user's configured AI quota through reverse sampling. */
  sampling?: boolean;
  /** Absolute host paths that a stdio server may read in addition to its code and cwd. */
  readPaths?: string[];
  /** Absolute host paths that a stdio server may read and write. */
  writePaths?: string[];
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportType;
  enabled: boolean;
  // Stdio Transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  permissions?: McpServerPermissions;
  // HTTP / SSE Transport
  url?: string;
  headers?: Record<string, string>;
}

// ── 1. Tools (Model-controlled actions) ──────────────────────────────────
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

export interface McpToolCallContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: any;
}

export interface McpCallToolResult {
  content: McpToolCallContent[];
  isError?: boolean;
}

// ── 2. Resources (Application/Data Context) ──────────────────────────────
export interface McpResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64
}

export interface McpResourceReadResult {
  contents: McpResourceContent[];
}

// ── 3. Prompts (Workflow & Slash Templates) ─────────────────────────────
export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptDefinition {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface McpPromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text' | 'image' | 'resource';
    text?: string;
    resource?: McpResourceContent;
  };
}

export interface McpGetPromptResult {
  description?: string;
  messages: McpPromptMessage[];
}

// ── 4. Sampling (Reverse LLM Inference) ──────────────────────────────────
export interface McpSamplingMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mimeType?: string;
  };
}

export interface McpSamplingParams {
  messages: McpSamplingMessage[];
  systemPrompt?: string;
  includeContext?: 'none' | 'thisServer' | 'allServers';
  temperature?: number;
  maxTokens: number;
  stopSequences?: string[];
  metadata?: Record<string, any>;
}

export interface McpSamplingResult {
  role: 'assistant';
  content: {
    type: 'text';
    text: string;
  };
  model: string;
  stopReason?: 'endTurn' | 'stopSequence' | 'maxTokens' | string;
}

// ── 5. Server State ──────────────────────────────────────────────────────
export interface McpServerState {
  config: McpServerConfig;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  error?: string;
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
  prompts: McpPromptDefinition[];
  lastConnectedAt?: number;
}

// ── JSON-RPC 2.0 Primitives ─────────────────────────────────────────────
export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface McpJsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}
