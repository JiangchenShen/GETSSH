import { createHash } from 'node:crypto';
import type {
  McpPromptDefinition,
  McpResourceDefinition,
  McpSamplingMessage,
  McpSamplingParams,
  McpToolDefinition
} from './mcpTypes';

export const MAX_MCP_TOOLS = 128;
export const MAX_MCP_RESOURCES = 512;
export const MAX_MCP_PROMPTS = 256;
export const MAX_MCP_TOOL_OUTPUT_CHARS = 200_000;
export const MAX_MCP_TOOL_ARGUMENT_DISPLAY_CHARS = 32_000;
export const MAX_MCP_SAMPLING_OUTPUT_TOKENS = 4_096;

const MAX_DEFINITION_DESCRIPTION_CHARS = 4_096;
const MAX_TOOL_SCHEMA_BYTES = 64 * 1024;
const MAX_SCHEMA_DEPTH = 32;
const MAX_SCHEMA_NODES = 10_000;
const MAX_PROMPT_ARGUMENTS = 64;
const MAX_SAMPLING_MESSAGES = 128;
const MAX_SAMPLING_TEXT_CHARS = 50_000;
const MAX_SAMPLING_SYSTEM_CHARS = 20_000;
const MAX_SAMPLING_IMAGE_BASE64_CHARS = 5 * 1024 * 1024;
const MAX_STOP_SEQUENCES = 16;
const MAX_STOP_SEQUENCE_CHARS = 256;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string' &&
    (allowEmpty || value.length > 0) &&
    value.length <= maxLength &&
    !/[\0\r\n]/.test(value);
}

function boundedJson(value: unknown, maxDepth: number, maxNodes: number): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > maxNodes || current.depth > maxDepth) return false;
    if (!current.value || typeof current.value !== 'object') continue;
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}

function normalizeToolSchema(value: unknown): McpToolDefinition['inputSchema'] | undefined {
  if (!isRecord(value) || !boundedJson(value, MAX_SCHEMA_DEPTH, MAX_SCHEMA_NODES)) return undefined;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_TOOL_SCHEMA_BYTES) return undefined;

  const required = Array.isArray(value.required)
    ? value.required.filter((entry: unknown): entry is string => validString(entry, 256)).slice(0, 256)
    : undefined;
  return {
    ...value,
    type: 'object',
    properties: isRecord(value.properties) ? value.properties : {},
    ...(required ? { required } : {})
  };
}

export function normalizeMcpToolDefinitions(value: unknown): McpToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const normalized: McpToolDefinition[] = [];
  const names = new Set<string>();
  for (const candidate of value) {
    if (normalized.length >= MAX_MCP_TOOLS) break;
    if (!isRecord(candidate) || !validString(candidate.name, 256) || names.has(candidate.name)) continue;
    const schema = normalizeToolSchema(candidate.inputSchema);
    if (candidate.inputSchema !== undefined && !schema) continue;
    names.add(candidate.name);
    normalized.push({
      name: candidate.name,
      ...(typeof candidate.description === 'string'
        ? { description: candidate.description.slice(0, MAX_DEFINITION_DESCRIPTION_CHARS) }
        : {}),
      ...(schema ? { inputSchema: schema } : {})
    });
  }
  return normalized;
}

export function normalizeMcpResourceDefinitions(value: unknown): McpResourceDefinition[] {
  if (!Array.isArray(value)) return [];
  const normalized: McpResourceDefinition[] = [];
  const uris = new Set<string>();
  for (const candidate of value) {
    if (normalized.length >= MAX_MCP_RESOURCES) break;
    if (
      !isRecord(candidate) ||
      !validString(candidate.uri, 8_192) ||
      !validString(candidate.name, 512) ||
      uris.has(candidate.uri)
    ) continue;
    uris.add(candidate.uri);
    normalized.push({
      uri: candidate.uri,
      name: candidate.name,
      ...(typeof candidate.description === 'string'
        ? { description: candidate.description.slice(0, MAX_DEFINITION_DESCRIPTION_CHARS) }
        : {}),
      ...(validString(candidate.mimeType, 256) ? { mimeType: candidate.mimeType } : {})
    });
  }
  return normalized;
}

export function normalizeMcpPromptDefinitions(value: unknown): McpPromptDefinition[] {
  if (!Array.isArray(value)) return [];
  const normalized: McpPromptDefinition[] = [];
  const names = new Set<string>();
  for (const candidate of value) {
    if (normalized.length >= MAX_MCP_PROMPTS) break;
    if (!isRecord(candidate) || !validString(candidate.name, 256) || names.has(candidate.name)) continue;
    names.add(candidate.name);
    const args = Array.isArray(candidate.arguments)
      ? candidate.arguments
          .filter((entry: unknown) => isRecord(entry) && validString(entry.name, 256))
          .slice(0, MAX_PROMPT_ARGUMENTS)
          .map((entry: Record<string, any>) => ({
            name: entry.name,
            ...(typeof entry.description === 'string'
              ? { description: entry.description.slice(0, MAX_DEFINITION_DESCRIPTION_CHARS) }
              : {}),
            required: entry.required === true
          }))
      : undefined;
    normalized.push({
      name: candidate.name,
      ...(typeof candidate.description === 'string'
        ? { description: candidate.description.slice(0, MAX_DEFINITION_DESCRIPTION_CHARS) }
        : {}),
      ...(args ? { arguments: args } : {})
    });
  }
  return normalized;
}

export function mcpToolRegistryName(serverId: string, toolName: string): string {
  const serverPart = serverId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 14) || 'server';
  const toolPart = toolName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 28) || 'tool';
  const digest = createHash('sha256').update(`${serverId}\0${toolName}`).digest('hex').slice(0, 10);
  return `mcp_${serverPart}_${toolPart}_${digest}`.slice(0, 64);
}

export function truncateMcpText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[Truncated by GETSSH MCP policy]`;
}

function normalizeSamplingMessage(value: unknown): McpSamplingMessage {
  if (!isRecord(value) || (value.role !== 'user' && value.role !== 'assistant') || !isRecord(value.content)) {
    throw new Error('MCP sampling message is invalid.');
  }
  if (value.content.type === 'text') {
    if (typeof value.content.text !== 'string') throw new Error('MCP sampling text must be a string.');
    return { role: value.role, content: { type: 'text', text: value.content.text } };
  }
  if (value.content.type === 'image') {
    if (
      typeof value.content.data !== 'string' ||
      value.content.data.length > MAX_SAMPLING_IMAGE_BASE64_CHARS ||
      !validString(value.content.mimeType, 256)
    ) {
      throw new Error('MCP sampling image is invalid or too large.');
    }
    return {
      role: value.role,
      content: { type: 'image', data: value.content.data, mimeType: value.content.mimeType }
    };
  }
  throw new Error('MCP sampling content type is unsupported.');
}

export function normalizeMcpSamplingParams(value: unknown): McpSamplingParams {
  if (!isRecord(value) || !Array.isArray(value.messages) || value.messages.length === 0) {
    throw new Error('MCP sampling request must contain messages.');
  }
  if (value.messages.length > MAX_SAMPLING_MESSAGES) {
    throw new Error(`MCP sampling request exceeds ${MAX_SAMPLING_MESSAGES} messages.`);
  }

  const messages = value.messages.map(normalizeSamplingMessage);
  const textChars = messages.reduce(
    (total, message) => total + (message.content.type === 'text' ? message.content.text?.length || 0 : 0),
    0
  );
  if (textChars > MAX_SAMPLING_TEXT_CHARS) {
    throw new Error(`MCP sampling text exceeds ${MAX_SAMPLING_TEXT_CHARS} characters.`);
  }

  const systemPrompt = value.systemPrompt;
  if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
    throw new Error('MCP sampling systemPrompt must be a string.');
  }
  if (typeof systemPrompt === 'string' && systemPrompt.length > MAX_SAMPLING_SYSTEM_CHARS) {
    throw new Error(`MCP sampling systemPrompt exceeds ${MAX_SAMPLING_SYSTEM_CHARS} characters.`);
  }

  const requestedTokens = Number(value.maxTokens);
  if (!Number.isFinite(requestedTokens) || requestedTokens <= 0) {
    throw new Error('MCP sampling maxTokens must be a positive number.');
  }

  const normalized: McpSamplingParams = {
    messages,
    maxTokens: Math.min(Math.floor(requestedTokens), MAX_MCP_SAMPLING_OUTPUT_TOKENS)
  };
  if (systemPrompt !== undefined) normalized.systemPrompt = systemPrompt;
  if (value.includeContext === 'none' || value.includeContext === 'thisServer' || value.includeContext === 'allServers') {
    normalized.includeContext = value.includeContext;
  }
  if (typeof value.temperature === 'number' && Number.isFinite(value.temperature)) {
    normalized.temperature = Math.max(0, Math.min(2, value.temperature));
  }
  if (Array.isArray(value.stopSequences)) {
    normalized.stopSequences = value.stopSequences
      .filter((entry: unknown): entry is string => typeof entry === 'string' && entry.length <= MAX_STOP_SEQUENCE_CHARS)
      .slice(0, MAX_STOP_SEQUENCES);
  }
  return normalized;
}
