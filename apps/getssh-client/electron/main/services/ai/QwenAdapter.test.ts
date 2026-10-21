// @vitest-environment node
/**
 * QwenAdapter against the DashScope native text-generation wire format.
 *
 * Fixtures follow Alibaba Cloud Model Studio's documentation:
 *   - streaming output (help.aliyun.com/en/model-studio/stream): each event is
 *     `id:N` / `event:result` / `:HTTP_STATUS/200` / `data:{...}` with no space after the colon,
 *     `finish_reason` is the string "null" until the last frame, usage is cumulative per frame;
 *   - DashScope API reference (help.aliyun.com/en/model-studio/qwen-api-via-dashscope): request
 *     shape { model, input: { messages }, parameters }, `X-DashScope-SSE: enable`, tool_calls
 *     entries { index, id, type, function: { name, arguments } }, usage fields;
 *   - function calling (help.aliyun.com/en/model-studio/qwen-function-calling): the first tool
 *     call frame carries id + name, later frames carry `"id":""`, no name, and argument pieces;
 *   - error codes (help.aliyun.com/en/model-studio/error-code): { code, message, request_id };
 *   - the official Python SDK (dashscope/common/utils.py): error events arrive as `event:error`
 *     inside a 200 stream, and a non-200 reply to an SSE request can itself be an SSE body.
 *
 * The defects these tests found against the docs were fixed on 2026-10-21; the comment on each
 * such test says what was wrong.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QwenAdapter } from './QwenAdapter';
import { ModelCaps } from './ModelCapabilities';
import { LlmError, type LlmRequest, type StreamCallbacks, type Turn } from './types';

const GENERATION_PATH = '/api/v1/services/aigc/text-generation/generation';
const MULTIMODAL_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const DEFAULT_HOST = 'https://dashscope.aliyuncs.com';
const WORKSPACE_HOST = 'https://ws-7f3k2.cn-beijing.maas.aliyuncs.com';
const REQUEST_ID = 'd30a9914-ac97-9102-b746-ce0cb35e3fa2';
const encoder = new TextEncoder();

// ── wire helpers ──────────────────────────────────────────────────────────────

/** One DashScope SSE event, byte for byte as the service writes it. */
function sseEvent(id: number, data: unknown, opts: { event?: string; status?: number; eol?: string } = {}): string {
  const eol = opts.eol ?? '\n';
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return [`id:${id}`, `event:${opts.event ?? 'result'}`, `:HTTP_STATUS/${opts.status ?? 200}`, `data:${payload}`, '', '']
    .join(eol);
}

function usage(input: number, output: number, extra: Record<string, unknown> = {}) {
  return {
    total_tokens: input + output,
    output_tokens: output,
    input_tokens: input,
    prompt_tokens_details: { cached_tokens: 0 },
    ...extra,
  };
}

/** A result frame in result_format "message" with incremental_output true. */
function resultFrame(
  message: Record<string, unknown>,
  finishReason: string,
  u: Record<string, unknown>,
  outputExtra: Record<string, unknown> = {},
) {
  return {
    output: { choices: [{ message: { role: 'assistant', ...message }, finish_reason: finishReason }], ...outputExtra },
    usage: u,
    request_id: REQUEST_ID,
  };
}

/** Cut the UTF-8 bytes of `text` at the given byte offsets. */
function splitBytes(text: string, cuts: number[]): Uint8Array[] {
  const bytes = encoder.encode(text);
  const out: Uint8Array[] = [];
  let start = 0;
  for (const cut of [...cuts].sort((a, b) => a - b)) {
    if (cut <= start || cut >= bytes.length) continue;
    out.push(bytes.slice(start, cut));
    start = cut;
  }
  out.push(bytes.slice(start));
  return out;
}

/** Byte offset of the first occurrence of `needle` in the UTF-8 encoding of `text`. */
function byteIndexOf(text: string, needle: string): number {
  const idx = text.indexOf(needle);
  if (idx < 0) throw new Error(`fixture does not contain ${needle}`);
  return encoder.encode(text.slice(0, idx)).length;
}

function streamResponse(chunks: Uint8Array[] | string, status = 200): Response {
  const parts = typeof chunks === 'string' ? [encoder.encode(chunks)] : chunks;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream;charset=UTF-8', 'X-DashScope-Request-Id': REQUEST_ID },
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The smallest complete answer: one text frame and a stop frame. */
function okStream(): Response {
  return streamResponse(
    sseEvent(1, resultFrame({ content: 'ok' }, 'null', usage(10, 1))) +
      sseEvent(2, resultFrame({ content: '' }, 'stop', usage(10, 1))),
  );
}

// ── fetch mock ────────────────────────────────────────────────────────────────

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[];
let fetchMock: ReturnType<typeof vi.fn>;

function replyWith(...responses: Array<Response | (() => Response) | Error>) {
  let i = 0;
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(i++, responses.length - 1)];
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  });
}

function sentBody(n = 0): any {
  return JSON.parse(String(calls[n].init.body));
}

function sentHeaders(n = 0): Record<string, string> {
  return calls[n].init.headers as Record<string, string>;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: any) => c?.text ?? '').join('');
  return '';
}

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return { apiKey: 'sk-test-0000', model: 'qwen-plus', prompt: 'hello', ...overrides };
}

function recorder() {
  const chunks: string[] = [];
  const thoughts: string[] = [];
  const done = vi.fn();
  const callbacks: StreamCallbacks = {
    onChunk: (c) => chunks.push(c),
    onThoughtChunk: (c) => thoughts.push(c),
    onDone: done,
  };
  return { chunks, thoughts, done, callbacks };
}

async function sendAndCapture(overrides: Partial<LlmRequest> = {}) {
  replyWith(okStream);
  await new QwenAdapter().streamTurn(request(overrides), {});
  return { url: calls[0].url, body: sentBody(), headers: sentHeaders() };
}

async function streamError(promise: Promise<unknown>): Promise<LlmError> {
  const err = await promise.then(
    () => { throw new Error('expected the turn to fail'); },
    (e) => e,
  );
  expect(err).toBeInstanceOf(LlmError);
  return err as LlmError;
}

beforeEach(() => {
  calls = [];
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  ModelCaps._reset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── the request ───────────────────────────────────────────────────────────────

describe('QwenAdapter request', () => {
  it('posts to the default DashScope host with bearer auth and the SSE header', async () => {
    const { url, headers } = await sendAndCapture();
    expect(url).toBe(`${DEFAULT_HOST}${GENERATION_PATH}`);
    expect(calls[0].init.method).toBe('POST');
    expect(headers['Authorization']).toBe('Bearer sk-test-0000');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-DashScope-SSE']).toBe('enable');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['a bare host', 'https://dashscope.aliyuncs.com', DEFAULT_HOST],
    ['a host with a trailing slash', 'https://dashscope.aliyuncs.com/', DEFAULT_HOST],
    ['the intl host', 'https://dashscope-intl.aliyuncs.com', 'https://dashscope-intl.aliyuncs.com'],
    ['the workspace base URL', `${WORKSPACE_HOST}/api/v1`, WORKSPACE_HOST],
    ['the workspace base URL with a slash', `${WORKSPACE_HOST}/api/v1/`, WORKSPACE_HOST],
    ['the full generation URL', `${WORKSPACE_HOST}${GENERATION_PATH}`, WORKSPACE_HOST],
    ['the full generation URL with a slash', `${WORKSPACE_HOST}${GENERATION_PATH}/`, WORKSPACE_HOST],
    ['the compatible-mode base URL', `${WORKSPACE_HOST}/compatible-mode/v1`, WORKSPACE_HOST],
    ['the compatible-mode base URL with a slash', `${WORKSPACE_HOST}/compatible-mode/v1/`, WORKSPACE_HOST],
    ['the compatible-mode chat URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', DEFAULT_HOST],
    ['the Anthropic-compatible base URL', 'https://dashscope.aliyuncs.com/apps/anthropic', DEFAULT_HOST],
    ['the Anthropic-compatible messages URL', 'https://dashscope.aliyuncs.com/apps/anthropic/v1/messages', DEFAULT_HOST],
  ])('normalises %s to the native generation URL', async (_label, endpoint, host) => {
    const { url } = await sendAndCapture({ endpoint });
    expect(url).toBe(`${host}${GENERATION_PATH}`);
  });

  // Fixed: the docs' own qwen3.8-max curl example uses the multimodal-generation URL, so that is
  // a URL users paste. resolveHost used to strip only the text-generation path.
  it('normalises the documented multimodal-generation URL a user may paste', async () => {
    const { url } = await sendAndCapture({ endpoint: `${WORKSPACE_HOST}${MULTIMODAL_PATH}` });
    expect(url.startsWith(`${WORKSPACE_HOST}/api/v1/services/aigc/`)).toBe(true);
    expect(url).not.toContain(`${MULTIMODAL_PATH}/api/v1`);
  });

  it('sends the three-part native body with message results and incremental output', async () => {
    const { body } = await sendAndCapture({
      systemPrompt: 'You are an SSH assistant.',
      context: 'host=prod-1',
      maxOutputTokens: 2048,
    });
    expect(Object.keys(body).sort()).toEqual(['input', 'model', 'parameters']);
    expect(body.model).toBe('qwen-plus');
    // Native mode streams by header; no OpenAI-style top-level fields.
    expect(body).not.toHaveProperty('stream');
    expect(body).not.toHaveProperty('messages');
    expect(body).not.toHaveProperty('tools');
    expect(body.parameters.result_format).toBe('message');
    expect(body.parameters.incremental_output).toBe(true);
    // qwen-plus is a Qwen3-generation model: DashScope documents max_completion_tokens only for
    // Qwen3.7-Max, Qwen3.5-Plus and Qwen3.5-Flash and later, so it gets max_tokens.
    expect(body.parameters.max_tokens).toBe(2048);
    expect(body.parameters).not.toHaveProperty('max_completion_tokens');
    expect(body.parameters).not.toHaveProperty('tools');
    expect(body.parameters).not.toHaveProperty('tool_choice');

    const [system, user] = body.input.messages;
    expect(system.role).toBe('system');
    expect(textOf(system.content)).toBe('You are an SSH assistant.\n\n[Context]\nhost=prod-1');
    expect(user.role).toBe('user');
    expect(textOf(user.content)).toBe('hello');
    expect(body.input.messages).toHaveLength(2);
  });

  it.each([
    ['qwen3.8-max', 'max_completion_tokens'],
    ['qwen3.8-flash', 'max_completion_tokens'],
    ['qwen3.7-max', 'max_completion_tokens'],
    ['qwen3.5-plus', 'max_completion_tokens'],
    ['qwen3.5-flash', 'max_completion_tokens'],
    ['qwen3-max', 'max_tokens'],
    ['qwen-flash', 'max_tokens'],
    ['qwq-plus', 'max_tokens'],
    ['qwen3.8-27b', 'max_tokens'],
    ['kimi-k2.6', 'max_completion_tokens'],
    ['kimi-k3', 'max_completion_tokens'],
    ['kimi-k2', 'max_tokens'],
    ['glm-5.3', 'max_completion_tokens'],
    ['glm-4.7', 'max_tokens'],
    ['MiniMax-M2.5', 'max_completion_tokens'],
    ['MiniMax-M2.1', 'max_tokens'],
    ['deepseek-v4-pro', 'max_completion_tokens'],
    ['deepseek-v3.2', 'max_tokens'],
    // "以上模型均不包含三方直供模型": the vendor-prefixed IDs.
    ['ZHIPU/GLM-5.3', 'max_tokens'],
  ])('limits %s output with %s', async (model, field) => {
    const { body } = await sendAndCapture({ model, maxOutputTokens: 1024 });
    expect(body.parameters[field]).toBe(1024);
    const other = field === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
    expect(body.parameters).not.toHaveProperty(other);
  });

  it('keeps an output limit within the model\'s known maximum', async () => {
    expect((await sendAndCapture({ model: 'qwen3.8-max', maxOutputTokens: 200000 })).body.parameters.max_completion_tokens).toBe(131072);
    calls = [];
    expect((await sendAndCapture({ model: 'qwq-plus', maxOutputTokens: 200000 })).body.parameters.max_tokens).toBe(32768);
  });

  it('sends no output limit when none is asked', async () => {
    const { body } = await sendAndCapture({ model: 'qwen3.8-max' });
    expect(body.parameters).not.toHaveProperty('max_tokens');
    expect(body.parameters).not.toHaveProperty('max_completion_tokens');
  });

  it('defaults the model to qwen3.8-max when none is given', async () => {
    const { body } = await sendAndCapture({ model: '' });
    expect(body.model).toBe('qwen3.8-max');
  });

  it('clamps temperature into the documented [0, 2) range for a known model', async () => {
    expect((await sendAndCapture({ temperature: 2.5 })).body.parameters.temperature).toBe(1.999);
    calls = [];
    expect((await sendAndCapture({ temperature: -1 })).body.parameters.temperature).toBe(0);
    calls = [];
    expect((await sendAndCapture({ temperature: 0.7 })).body.parameters.temperature).toBe(0.7);
  });

  // Fixed: API reference, messages[].content: "If the input is only text, this parameter is a
  // string." The adapter used to send [{ text }] arrays on the text-generation endpoint.
  it('sends a text-only user message as a string, as documented', async () => {
    const { body } = await sendAndCapture({ systemPrompt: 'Be brief.' });
    const user = body.input.messages.find((m: any) => m.role === 'user');
    expect(user.content).toBe('hello');
    expect(body.input.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
  });

  // The API reference calls qwen3.7-plus a multimodal model, and its text-only qwen3.8-max examples
  // use the multimodal-generation endpoint, with content as [{ text }] arrays.
  // The text-generation page: "输入模态包含图片或视频的模型使用多模态接口，即使只传入文本也需要使用
  // 多模态接口". Input modalities from each model page: Image/Text/Video for qwen3.8-max,
  // qwen3.8-flash ("多模态大模型"), qwen3.8-27b, qwen3.7-plus, qwen3.7-flash, the 3.6 and 3.5 series
  // and qwen3.7-max-2026-06-08; Text only for qwen3.7-max, -preview, -2026-05-17, -2026-05-20 and
  // qwen3.8-2.4t-a95b. The vision page lists the QVQ and VL series.
  it.each([
    ['qwen3.8-max', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.8-flash', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.8-27b', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.7-plus', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.7-flash', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.7-flash-2026-07-15', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.7-max-2026-06-08', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.6-plus', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.6-flash', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.5-plus', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.5-flash', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.5-397b-a17b', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qvq-max', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen2.5-vl-72b-instruct', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen-vl-max', MULTIMODAL_PATH, [{ text: 'hello' }]],
    ['qwen3.7-max', GENERATION_PATH, 'hello'],
    ['qwen3.7-max-preview', GENERATION_PATH, 'hello'],
    ['qwen3.7-max-2026-05-17', GENERATION_PATH, 'hello'],
    ['qwen3.7-max-2026-05-20', GENERATION_PATH, 'hello'],
    ['qwen3.8-2.4t-a95b', GENERATION_PATH, 'hello'],
    ['qwen3-max', GENERATION_PATH, 'hello'],
    ['qwen-plus', GENERATION_PATH, 'hello'],
    ['qwq-plus', GENERATION_PATH, 'hello'],
  ])('sends a text-only %s request to %s', async (model, path, content) => {
    const { url, body } = await sendAndCapture({ model, systemPrompt: 'Be brief.' });
    expect(url).toBe(`${DEFAULT_HOST}${path}`);
    expect(body.input.messages.find((m: any) => m.role === 'user').content).toEqual(content);
    expect(textOf(body.input.messages[0].content)).toBe('Be brief.');
    expect(Array.isArray(body.input.messages[0].content)).toBe(Array.isArray(content));
  });

  it('sends an image as a base64 data URL part beside the text', async () => {
    const history: Turn[] = [{
      role: 'user',
      blocks: [{ kind: 'image', mime: 'image/png', data: 'iVBORw0KGgo=' }, { kind: 'text', text: 'what is this' }],
    }];
    const { body } = await sendAndCapture({ model: 'qwen3-vl-plus', history, prompt: undefined });
    const user = body.input.messages.find((m: any) => m.role === 'user');
    expect(user.content).toEqual([{ image: 'data:image/png;base64,iVBORw0KGgo=' }, { text: 'what is this' }]);
  });

  // Fixed: the API reference sends multimodal input ("Multimodal models, such as qwen3.7-plus or
  // qwen3-vl-plus") to .../multimodal-generation/generation; the adapter always used text-generation.
  it('sends image input to the documented multimodal-generation endpoint', async () => {
    const history: Turn[] = [{
      role: 'user',
      blocks: [{ kind: 'image', mime: 'image/png', data: 'iVBORw0KGgo=' }, { kind: 'text', text: 'what is this' }],
    }];
    const { url } = await sendAndCapture({ model: 'qwen3-vl-plus', history, prompt: undefined });
    expect(url).toBe(`${DEFAULT_HOST}${MULTIMODAL_PATH}`);
    calls = [];
    // A text model still goes there once the request has an image.
    expect((await sendAndCapture({ model: 'qwen-plus', history, prompt: undefined })).url).toBe(`${DEFAULT_HOST}${MULTIMODAL_PATH}`);
  });

  it('maps tool history to assistant tool_calls and tool messages', async () => {
    const history: Turn[] = [
      { role: 'system', blocks: [{ kind: 'text', text: 'Be brief.' }] },
      { role: 'user', blocks: [{ kind: 'text', text: 'disk usage on prod-1?' }] },
      {
        role: 'assistant',
        blocks: [
          { kind: 'thought', text: 'Need df.' },
          { kind: 'tool_call', callId: 'call_8f08d2b0fc0c4d8fab7123', name: 'run_command', args: { cmd: 'df -h' }, raw: '{"cmd": "df -h"}' },
        ],
      },
      {
        role: 'user',
        blocks: [{ kind: 'tool_result', callId: 'call_8f08d2b0fc0c4d8fab7123', content: ['/dev/sda1 40G', { kind: 'text', text: '72% used' }] }],
      },
    ];
    const { body } = await sendAndCapture({ history, prompt: undefined });
    const [system, user, assistant, tool] = body.input.messages;

    expect(system.role).toBe('system');
    expect(textOf(system.content)).toBe('Be brief.');
    expect(user.role).toBe('user');
    expect(textOf(user.content)).toBe('disk usage on prod-1?');

    expect(assistant).toEqual({
      role: 'assistant',
      content: '',
      reasoning_content: 'Need df.',
      tool_calls: [{
        id: 'call_8f08d2b0fc0c4d8fab7123',
        type: 'function',
        function: { name: 'run_command', arguments: '{"cmd": "df -h"}' },
      }],
    });

    // Tool output "must be in string format"; name is filled in from the matching call.
    expect(tool).toEqual({
      role: 'tool',
      name: 'run_command',
      tool_call_id: 'call_8f08d2b0fc0c4d8fab7123',
      content: '/dev/sda1 40G\n72% used',
    });
    expect(body.input.messages).toHaveLength(4);
  });

  describe('thinking options', () => {
    it('turns thinking off with enable_thinking false when effort is none', async () => {
      const { body } = await sendAndCapture({ model: 'qwen3.8-max', thinkingEffort: 'none' });
      expect(body.parameters.enable_thinking).toBe(false);
      expect(body.parameters).not.toHaveProperty('thinking_budget');
    });

    it('turns thinking on and passes a budget through', async () => {
      const { body } = await sendAndCapture({ model: 'qwen3.8-max', thinkingBudget: 2048 });
      expect(body.parameters.enable_thinking).toBe(true);
      expect(body.parameters.thinking_budget).toBe(2048);
    });

    it('sends no thinking fields when nothing is asked', async () => {
      const { body } = await sendAndCapture({ model: 'qwen3.8-max' });
      expect(body.parameters).not.toHaveProperty('enable_thinking');
      expect(body.parameters).not.toHaveProperty('thinking_budget');
    });

    it('does not try to turn off thinking on qwq, which always thinks', async () => {
      const { body } = await sendAndCapture({ model: 'qwq-plus', thinkingEffort: 'none' });
      expect(body.parameters.enable_thinking).not.toBe(false);
    });

    it('sends neither thinking nor sampling fields for a model outside the qwen families', async () => {
      const { body } = await sendAndCapture({ model: 'kimi-k2.6', thinkingEffort: 'high', thinkingBudget: 4096, temperature: 0.3 });
      expect(body.model).toBe('kimi-k2.6');
      expect(body.parameters).not.toHaveProperty('enable_thinking');
      expect(body.parameters).not.toHaveProperty('thinking_budget');
      expect(body.parameters).not.toHaveProperty('temperature');
      expect(body.parameters.result_format).toBe('message');
      expect(body.parameters.incremental_output).toBe(true);
    });

    // Fixed: API reference, reasoning_effort "Controls the inference intensity of models";
    // Qwen3.8 maps low→4096, medium→16384, xhigh→262144 and defaults to xhigh. The adapter only
    // sent enable_thinking, so a user's "low" ran at the default xhigh.
    it('carries the requested effort to qwen3.8 as reasoning_effort or a matching budget', async () => {
      const { body } = await sendAndCapture({ model: 'qwen3.8-max', thinkingEffort: 'low' });
      const p = body.parameters;
      const carried = p.reasoning_effort === 'low' || (typeof p.thinking_budget === 'number' && p.thinking_budget <= 4096);
      expect(carried).toBe(true);
    });

    it.each([
      ['medium', 'medium'], ['high', 'xhigh'], ['max', 'xhigh'],
    ] as const)('maps effort %s to the qwen3.8 reasoning_effort %s', async (effort, sent) => {
      const { body } = await sendAndCapture({ model: 'qwen3.8-flash', thinkingEffort: effort });
      expect(body.parameters.reasoning_effort).toBe(sent);
    });

    // API reference: "For the qwen3.8 series, reasoning_effort and thinking_budget cannot be set at
    // the same time." and "Setting both will cause an error."
    it('sends a budget without reasoning_effort to qwen3.8', async () => {
      const { body } = await sendAndCapture({ model: 'qwen3.8-max', thinkingEffort: 'low', thinkingBudget: 2048 });
      expect(body.parameters.thinking_budget).toBe(2048);
      expect(body.parameters).not.toHaveProperty('reasoning_effort');
    });

    it('sends no reasoning_effort to a model outside qwen3.8', async () => {
      const { body } = await sendAndCapture({ model: 'qwen3.7-plus', thinkingEffort: 'low' });
      expect(body.parameters.enable_thinking).toBe(true);
      expect(body.parameters).not.toHaveProperty('reasoning_effort');
    });

    // Fixed: Qwen3.8's documented default thinking_budget is 131072 and xhigh maps to 262144; the
    // 32768 cap used to cut any budget below the model's default. Other models keep that cap.
    it('passes a budget inside the qwen3.8 documented range unchanged', async () => {
      const { body } = await sendAndCapture({ model: 'qwen3.8-max', thinkingBudget: 131072 });
      expect(body.parameters.thinking_budget).toBe(131072);
      calls = [];
      expect((await sendAndCapture({ model: 'qwen3.8-max', thinkingBudget: 500000 })).body.parameters.thinking_budget).toBe(262144);
      calls = [];
      expect((await sendAndCapture({ model: 'qwen3.7-plus', thinkingBudget: 131072 })).body.parameters.thinking_budget).toBe(32768);
    });
  });

  describe('tools', () => {
    const tools = [{
      name: 'run_command',
      description: 'Run a shell command on the connected host',
      parameters: { type: 'object' as const, properties: { cmd: { type: 'string' } }, required: ['cmd'] },
    }];

    it('puts tools, tool_choice and parallel_tool_calls under parameters', async () => {
      const { body } = await sendAndCapture({ tools });
      expect(body.parameters.tools).toEqual([{
        type: 'function',
        function: {
          name: 'run_command',
          description: 'Run a shell command on the connected host',
          parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
        },
      }]);
      expect(body.parameters.tool_choice).toBe('auto');
      expect(body.parameters.parallel_tool_calls).toBe(true);
      expect(body).not.toHaveProperty('tools');
    });

    it('downgrades required and any to auto, which Qwen models do not support', async () => {
      expect((await sendAndCapture({ tools, toolChoice: 'required' })).body.parameters.tool_choice).toBe('auto');
      calls = [];
      expect((await sendAndCapture({ tools, toolChoice: 'any' })).body.parameters.tool_choice).toBe('auto');
    });

    it('passes tool_choice none through', async () => {
      const { body } = await sendAndCapture({ tools, toolChoice: 'none' });
      expect(body.parameters.tool_choice).toBe('none');
    });

    it('forces a named tool in the documented object form when thinking is off', async () => {
      const { body } = await sendAndCapture({
        model: 'qwen3.8-max', thinkingEffort: 'none', tools, toolChoice: { type: 'tool', name: 'run_command' },
      });
      expect(body.parameters.enable_thinking).toBe(false);
      expect(body.parameters.tool_choice).toEqual({ type: 'function', function: { name: 'run_command' } });
    });

    // Fixed: API reference, tool_choice: "Models in thinking mode do not support forcing a call to
    // a specific tool"; function calling page: the request fails with "The tool_choice parameter
    // does not support being set to required or object in thinking mode." The adapter used to send
    // the object form next to enable_thinking: true.
    it('does not force a named tool while thinking is on', async () => {
      const { body } = await sendAndCapture({
        model: 'qwen3.8-max', thinkingEffort: 'high', tools, toolChoice: { type: 'tool', name: 'run_command' },
      });
      const forced = typeof body.parameters.tool_choice === 'object';
      const thinking = body.parameters.enable_thinking !== false; // qwen3.8 thinks by default
      expect(forced && thinking).toBe(false);
    });

    it('treats a model that thinks by default as thinking when nothing is asked', async () => {
      const toolChoice = { type: 'tool', name: 'run_command' } as const;
      expect((await sendAndCapture({ model: 'qwen3.8-max', tools, toolChoice })).body.parameters.tool_choice).toBe('auto');
      calls = [];
      expect((await sendAndCapture({ model: 'qwq-plus', tools, toolChoice })).body.parameters.tool_choice).toBe('auto');
      calls = [];
      // qwen-plus does not think unless asked, so the documented object form is sent.
      expect((await sendAndCapture({ model: 'qwen-plus', tools, toolChoice })).body.parameters.tool_choice)
        .toEqual({ type: 'function', function: { name: 'run_command' } });
    });
  });

  it('refuses a missing API key before any network call', async () => {
    replyWith(okStream);
    const err = await streamError(new QwenAdapter().streamTurn(request({ apiKey: '' }), {}));
    expect(err.code).toBe('no_api_key');
    expect(err.retryable).toBe(false);
    expect(err.provider).toBe('qwen');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── streamed answers ──────────────────────────────────────────────────────────

describe('QwenAdapter stream', () => {
  it('assembles a text answer cut across chunks, including inside a multi-byte character', async () => {
    const wire =
      sseEvent(1, resultFrame({ content: 'I am' }, 'null', usage(26, 1))) +
      sseEvent(2, resultFrame({ content: ' Qwen' }, 'null', usage(26, 2))) +
      sseEvent(3, resultFrame({ content: '，你好' }, 'null', usage(26, 4))) +
      sseEvent(4, resultFrame({ content: '！' }, 'null', usage(26, 5))) +
      sseEvent(5, resultFrame({ content: '' }, 'stop', usage(26, 5, { prompt_tokens_details: { cached_tokens: 8 } })));

    const ni = byteIndexOf(wire, '你');
    const bang = byteIndexOf(wire, '！');
    const cuts = [
      byteIndexOf(wire, 'event:result') + 3,        // inside a field name
      byteIndexOf(wire, ':HTTP_STATUS') + 6,        // inside the comment line
      byteIndexOf(wire, '"I am"') + 3,              // inside the JSON of a data line
      byteIndexOf(wire, 'id:3') - 1,                // between the two newlines ending event 2
      ni + 1, ni + 2,                               // 你 (3 bytes) cut twice
      bang + 1,                                     // ！ (3 bytes) cut once
      byteIndexOf(wire, '"stop"') + 2,
    ];
    replyWith(streamResponse(splitBytes(wire, cuts)));
    const rec = recorder();

    const res = await new QwenAdapter().streamTurn(request(), rec.callbacks);

    expect(res.text).toBe('I am Qwen，你好！');
    expect(res.text).not.toContain('�');
    expect(rec.chunks).toEqual(['I am', ' Qwen', '，你好', '！']);
    expect(rec.thoughts).toEqual([]);
    expect(res.blocks).toEqual([{ kind: 'text', text: 'I am Qwen，你好！' }]);
    expect(res.toolCalls).toEqual([]);
    expect(res.stopReason).toBe('end_turn');
    expect(res.model).toBe('qwen-plus');
    expect(res.usage).toEqual({ inputTokens: 26, outputTokens: 5, totalTokens: 31, cachedTokens: 8, reasoningTokens: 0 });
    expect(rec.done).toHaveBeenCalledTimes(1);
    expect(rec.done).toHaveBeenCalledWith(res);
  });

  it('delivers every byte in its own chunk without losing text', async () => {
    const wire =
      sseEvent(1, resultFrame({ content: '磁盘' }, 'null', usage(5, 1))) +
      sseEvent(2, resultFrame({ content: '已满' }, 'null', usage(5, 2))) +
      sseEvent(3, resultFrame({ content: '' }, 'stop', usage(5, 2)));
    const bytes = encoder.encode(wire);
    replyWith(streamResponse(Array.from(bytes, (b) => Uint8Array.of(b))));
    const rec = recorder();

    const res = await new QwenAdapter().streamTurn(request(), rec.callbacks);

    expect(res.text).toBe('磁盘已满');
    expect(rec.chunks).toEqual(['磁盘', '已满']);
  });

  it('accepts CRLF line endings', async () => {
    const wire =
      sseEvent(1, resultFrame({ content: 'up ' }, 'null', usage(3, 1)), { eol: '\r\n' }) +
      sseEvent(2, resultFrame({ content: '42 days' }, 'null', usage(3, 3)), { eol: '\r\n' }) +
      sseEvent(3, resultFrame({ content: '' }, 'stop', usage(3, 3)), { eol: '\r\n' });
    replyWith(streamResponse(wire));
    const res = await new QwenAdapter().streamTurn(request(), {});
    expect(res.text).toBe('up 42 days');
    expect(res.stopReason).toBe('end_turn');
  });

  it('maps finish_reason length to max_tokens', async () => {
    replyWith(streamResponse(
      sseEvent(1, resultFrame({ content: 'The log shows' }, 'null', usage(9, 3))) +
        sseEvent(2, resultFrame({ content: '' }, 'length', usage(9, 3))),
    ));
    const res = await new QwenAdapter().streamTurn(request(), {});
    expect(res.text).toBe('The log shows');
    expect(res.stopReason).toBe('max_tokens');
  });

  it('assembles a streamed tool call from the documented id-and-name-first frames', async () => {
    const wire =
      sseEvent(1, resultFrame({ content: '' }, 'null', usage(240, 0))) +
      sseEvent(2, resultFrame({
        content: '',
        tool_calls: [{ index: 0, id: 'call_ecc41296dccc47baa01567', type: 'function', function: { name: 'get_current_weather', arguments: '{"location": "Hangzhou' } }],
      }, 'null', usage(240, 12))) +
      sseEvent(3, resultFrame({
        content: '',
        tool_calls: [{ index: 0, id: '', type: 'function', function: { arguments: '"}' } }],
      }, 'null', usage(240, 14))) +
      sseEvent(4, resultFrame({ content: '' }, 'tool_calls', usage(240, 14)));
    replyWith(streamResponse(splitBytes(wire, [byteIndexOf(wire, 'Hangzhou') + 4, byteIndexOf(wire, 'id:3') + 2])));
    const rec = recorder();

    const res = await new QwenAdapter().streamTurn(request({ model: 'qwen3.8-max' }), rec.callbacks);

    const call = { callId: 'call_ecc41296dccc47baa01567', name: 'get_current_weather', args: { location: 'Hangzhou' }, raw: '{"location": "Hangzhou"}' };
    expect(res.toolCalls).toEqual([call]);
    expect(res.blocks).toEqual([{ kind: 'tool_call', ...call }]);
    expect(res.stopReason).toBe('tool_use');
    expect(res.text).toBe('');
    expect(rec.chunks).toEqual([]);
  });

  it('gives a tool call that streamed no arguments the args {}', async () => {
    replyWith(streamResponse(
      sseEvent(1, resultFrame({
        content: '',
        tool_calls: [{ index: 0, id: 'call_env', type: 'function', function: { name: 'get_environment_info', arguments: '' } }],
      }, 'null', usage(100, 5))) +
        sseEvent(2, resultFrame({ content: '' }, 'tool_calls', usage(100, 5))),
    ));
    const res = await new QwenAdapter().streamTurn(request({ model: 'qwen3.8-max' }), {});
    expect(res.toolCalls).toEqual([{ callId: 'call_env', name: 'get_environment_info', args: {}, raw: '' }]);
  });

  it('assembles a tool call whose frames omit index, as in the documented Java output', async () => {
    replyWith(streamResponse(
      sseEvent(1, resultFrame({
        content: '',
        tool_calls: [{ type: 'function', id: 'call_ecc41296dccc47baa01567', function: { name: 'get_current_weather', arguments: '{"location": "Hangzhou' } }],
      }, 'null', usage(240, 12))) +
        sseEvent(2, resultFrame({ content: '', tool_calls: [{ type: 'function', id: '', function: { arguments: '"}' } }] }, 'null', usage(240, 14))) +
        sseEvent(3, resultFrame({ content: '' }, 'tool_calls', usage(240, 14))),
    ));
    const res = await new QwenAdapter().streamTurn(request(), {});
    expect(res.toolCalls).toEqual([
      { callId: 'call_ecc41296dccc47baa01567', name: 'get_current_weather', args: { location: 'Hangzhou' }, raw: '{"location": "Hangzhou"}' },
    ]);
  });

  it('keeps parallel tool calls apart by index and returns them in index order', async () => {
    replyWith(streamResponse(
      sseEvent(1, resultFrame({
        content: '',
        tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'run_command', arguments: '{"cmd":' } }],
      }, 'null', usage(300, 5))) +
        sseEvent(2, resultFrame({
          content: '',
          tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{"path":"/etc/hosts"}' } }],
        }, 'null', usage(300, 12))) +
        sseEvent(3, resultFrame({
          content: '',
          tool_calls: [{ index: 1, id: '', type: 'function', function: { arguments: '"uptime"}' } }],
        }, 'null', usage(300, 15))) +
        sseEvent(4, resultFrame({ content: '' }, 'tool_calls', usage(300, 15))),
    ));
    const res = await new QwenAdapter().streamTurn(request(), {});
    expect(res.toolCalls).toEqual([
      { callId: 'call_a', name: 'read_file', args: { path: '/etc/hosts' }, raw: '{"path":"/etc/hosts"}' },
      { callId: 'call_b', name: 'run_command', args: { cmd: 'uptime' }, raw: '{"cmd":"uptime"}' },
    ]);
    expect(res.stopReason).toBe('tool_use');
  });

  it('keeps unparseable arguments raw and the max_tokens stop when the call was cut off', async () => {
    replyWith(streamResponse(
      sseEvent(1, resultFrame({
        content: '',
        tool_calls: [{ index: 0, id: 'call_cut', type: 'function', function: { name: 'run_command', arguments: '{"cmd": "tail -n' } }],
      }, 'null', usage(50, 8))) +
        sseEvent(2, resultFrame({ content: '' }, 'length', usage(50, 8))),
    ));
    const res = await new QwenAdapter().streamTurn(request(), {});
    expect(res.toolCalls).toEqual([{ callId: 'call_cut', name: 'run_command', args: { _raw: '{"cmd": "tail -n' }, raw: '{"cmd": "tail -n' }]);
    expect(res.stopReason).toBe('max_tokens');
  });

  it('streams reasoning_content as thought chunks and puts the thought block first', async () => {
    const wire =
      sseEvent(1, resultFrame({ content: '', reasoning_content: 'Hmm' }, 'null', usage(20, 1))) +
      sseEvent(2, resultFrame({ content: '', reasoning_content: '，用户想看负载' }, 'null', usage(20, 6))) +
      sseEvent(3, resultFrame({ content: '', reasoning_content: '' }, 'null', usage(20, 6))) +
      sseEvent(4, resultFrame({ content: 'Load is', reasoning_content: '' }, 'null', usage(20, 8))) +
      sseEvent(5, resultFrame({ content: ' 0.42', reasoning_content: '' }, 'null', usage(20, 10))) +
      sseEvent(6, resultFrame({ content: '', reasoning_content: '' }, 'stop', usage(20, 10)));
    const cut = byteIndexOf(wire, '负') + 1;
    replyWith(streamResponse(splitBytes(wire, [cut])));
    const rec = recorder();

    const res = await new QwenAdapter().streamTurn(request({ model: 'qwen3.8-max', thinkingEffort: 'high' }), rec.callbacks);

    expect(rec.thoughts).toEqual(['Hmm', '，用户想看负载']);
    expect(rec.chunks).toEqual(['Load is', ' 0.42']);
    expect(res.blocks).toEqual([
      { kind: 'thought', text: 'Hmm，用户想看负载' },
      { kind: 'text', text: 'Load is 0.42' },
    ]);
    expect(res.text).toBe('Load is 0.42');
  });

  // Fixed: API reference, usage.output_tokens_details.reasoning_tokens is "the thinking process
  // length in tokens" for reasoning models; the adapter always reported 0.
  it('reports reasoning tokens from usage.output_tokens_details', async () => {
    const final = usage(20, 10, { output_tokens_details: { reasoning_tokens: 6 } });
    replyWith(streamResponse(
      sseEvent(1, resultFrame({ content: '', reasoning_content: 'think' }, 'null', usage(20, 6, { output_tokens_details: { reasoning_tokens: 6 } }))) +
        sseEvent(2, resultFrame({ content: 'answer', reasoning_content: '' }, 'null', final)) +
        sseEvent(3, resultFrame({ content: '', reasoning_content: '' }, 'stop', final)),
    ));
    const res = await new QwenAdapter().streamTurn(request({ model: 'qwen3.8-max', thinkingEffort: 'high' }), {});
    expect(res.usage?.reasoningTokens).toBe(6);
  });

  it('returns search_info results as a web_search server_tool block', async () => {
    const results = [{ site_name: 'Alibaba Cloud', icon: 'https://img.example/icon.png', index: 1, title: 'Model Studio', url: 'https://help.aliyun.com/en/model-studio/' }];
    replyWith(streamResponse(
      sseEvent(1, resultFrame({ content: 'Per the docs' }, 'null', usage(30, 3), { search_info: { search_results: results } })) +
        sseEvent(2, resultFrame({ content: '' }, 'stop', usage(30, 3))),
    ));
    const res = await new QwenAdapter().streamTurn(request(), {});
    expect(res.blocks).toEqual([
      { kind: 'text', text: 'Per the docs' },
      { kind: 'server_tool', toolType: 'web_search', payload: { results } },
    ]);
  });

  it('treats a stream that ends before any finish_reason as a retryable disconnect', async () => {
    replyWith(streamResponse(
      sseEvent(1, resultFrame({ content: 'partial' }, 'null', usage(5, 1))) +
        sseEvent(2, resultFrame({ content: ' answer' }, 'null', usage(5, 2))),
    ));
    const rec = recorder();
    const err = await streamError(new QwenAdapter().streamTurn(request(), rec.callbacks));
    expect(err.retryable).toBe(true);
    expect(err.provider).toBe('qwen');
    expect(rec.chunks).toEqual(['partial', ' answer']);
    expect(rec.done).not.toHaveBeenCalled();
  });
});

// ── errors ────────────────────────────────────────────────────────────────────

describe('QwenAdapter errors', () => {
  it.each([
    [401, 'InvalidApiKey', 'Invalid API-key provided.', false],
    [400, 'Arrearage', 'Access denied, please make sure your account is in good standing.', false],
    [400, 'DataInspectionFailed', 'Input or output data may contain inappropriate content.', false],
    [403, 'AllocationQuota.FreeTierOnly', 'The free tier of the model has been exhausted.', false],
    [403, 'Model.AccessDenied', 'Model access denied.', false],
    [429, 'Throttling.RateQuota', 'Requests rate limit exceeded, please try again later.', true],
    [429, 'Throttling.AllocationQuota', 'Allocated quota exceeded, please increase your quota limit.', true],
    [500, 'InternalError', 'An internal error has occured, please try again later or contact service support.', true],
  ])('turns HTTP %i %s into an LlmError (retryable=%s)', async (status, code, message, retryable) => {
    replyWith(jsonResponse({ code, message, request_id: REQUEST_ID }, status));
    const rec = recorder();
    const err = await streamError(new QwenAdapter().streamTurn(request(), rec.callbacks));
    expect(err.retryable).toBe(retryable);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.provider).toBe('qwen');
    expect(err.message).toContain(message);
    expect(err.message).toContain(REQUEST_ID);
    expect(rec.done).not.toHaveBeenCalled();
  });

  it('still classifies an HTTP error whose body is not JSON by its status', async () => {
    replyWith(new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    const err = await streamError(new QwenAdapter().streamTurn(request(), {}));
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(502);
  });

  // Fixed: a request sent with X-DashScope-SSE can get its error back as an SSE body; the official
  // Python SDK (_handle_http_failed_response) reads the first data: line of such a reply. The
  // adapter called response.json(), which failed, so code and message were lost and the user saw
  // "HTTP 401" instead of "Invalid API-key provided."
  it('reads code and message from an SSE-formatted HTTP error body', async () => {
    const body = sseEvent(1, { code: 'InvalidApiKey', message: 'Invalid API-key provided.', request_id: REQUEST_ID }, { event: 'error', status: 401 });
    replyWith(streamResponse(body, 401));
    const err = await streamError(new QwenAdapter().streamTurn(request(), {}));
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('InvalidApiKey');
    expect(err.message).toContain('Invalid API-key provided.');
  });

  it('turns an error event inside a 200 stream into a non-retryable LlmError for a content block', async () => {
    replyWith(streamResponse(
      sseEvent(1, resultFrame({ content: 'Here is the' }, 'null', usage(40, 3))) +
        sseEvent(2, { code: 'DataInspectionFailed', message: 'Output data may contain inappropriate content.', request_id: REQUEST_ID }, { event: 'error', status: 400 }),
    ));
    const rec = recorder();
    const err = await streamError(new QwenAdapter().streamTurn(request(), rec.callbacks));
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('DataInspectionFailed');
    expect(err.provider).toBe('qwen');
    expect(err.message).toContain('Output data may contain inappropriate content.');
    expect(err.message).toContain(REQUEST_ID);
    expect(rec.chunks).toEqual(['Here is the']);
    expect(rec.done).not.toHaveBeenCalled();
  });

  it('marks a throttling error event inside a 200 stream as retryable', async () => {
    replyWith(streamResponse(
      sseEvent(1, { code: 'Throttling.RateQuota', message: 'Requests rate limit exceeded, please try again later.', request_id: REQUEST_ID }, { event: 'error', status: 429 }),
    ));
    const err = await streamError(new QwenAdapter().streamTurn(request(), {}));
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('Throttling.RateQuota');
  });

  // Fixed: an in-stream error carries its HTTP status only on the `:HTTP_STATUS/500` line, which
  // readDashScopeSse used to drop, so classifyError saw 200. InternalError is documented as 500
  // "please try again later", but came out retryable=false and the gateway never retried it.
  it('marks an InternalError event (HTTP_STATUS 500) inside a 200 stream as retryable', async () => {
    replyWith(streamResponse(
      sseEvent(1, resultFrame({ content: 'Checking' }, 'null', usage(40, 1))) +
        sseEvent(2, { code: 'InternalError', message: 'An internal error has occured, please try again later or contact service support.', request_id: REQUEST_ID }, { event: 'error', status: 500 }),
    ));
    const err = await streamError(new QwenAdapter().streamTurn(request(), {}));
    expect(err.code).toBe('InternalError');
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(500);
  });

  it('takes the HTTP status only from the event that carries it', async () => {
    const noStatusLine = `id:2\nevent:error\ndata:${JSON.stringify({ code: 'InvalidParameter', message: 'bad input', request_id: REQUEST_ID })}\n\n`;
    replyWith(streamResponse(sseEvent(1, resultFrame({ content: 'x' }, 'null', usage(1, 1)), { status: 503 }) + noStatusLine));
    const err = await streamError(new QwenAdapter().streamTurn(request(), {}));
    expect(err.code).toBe('InvalidParameter');
    expect(err.retryable).toBe(false);
  });
});

// ── models ────────────────────────────────────────────────────────────────────

describe('QwenAdapter.fetchModels', () => {
  const live = {
    object: 'list',
    data: [
      { id: 'qwen3.8-max', object: 'model', created: 1760000000, owned_by: 'system' },
      { id: 'qwen3.7-plus', object: 'model', created: 1750000000, owned_by: 'system' },
      { id: 'qwen-flash', object: 'model', created: 1740000000, owned_by: 'system' },
    ],
  };

  it('lists models from the compatible-mode models endpoint with bearer auth', async () => {
    replyWith(jsonResponse(live, 200));
    const models = await new QwenAdapter().fetchModels('sk-test-0000');
    expect(models).toEqual(['qwen3.8-max', 'qwen3.7-plus', 'qwen-flash']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${DEFAULT_HOST}/compatible-mode/v1/models`);
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test-0000');
    expect(calls[0].init.method ?? 'GET').toBe('GET');
  });

  it.each([
    [`${WORKSPACE_HOST}/api/v1`],
    [`${WORKSPACE_HOST}/compatible-mode/v1`],
    [`${WORKSPACE_HOST}/compatible-mode/v1/chat/completions`],
    [`${WORKSPACE_HOST}${GENERATION_PATH}`],
  ])('derives the models URL from the user endpoint %s', async (endpoint) => {
    replyWith(jsonResponse(live, 200));
    await new QwenAdapter().fetchModels('sk-test-0000', endpoint);
    expect(calls[0].url).toBe(`${WORKSPACE_HOST}/compatible-mode/v1/models`);
  });

  async function fallback(): Promise<string[]> {
    return new QwenAdapter().fetchModels('');
  }

  it('returns the built-in roster without a network call when there is no key', async () => {
    replyWith(jsonResponse(live, 200));
    const models = await fallback();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(models[0]).toBe('qwen3.8-max'); // the adapter's default model leads the list
    expect(models).toContain('qwq-plus');
    expect(new Set(models).size).toBe(models.length);
  });

  it('falls back to the roster on an HTTP error', async () => {
    const roster = await fallback();
    replyWith(jsonResponse({ code: 'InvalidApiKey', message: 'Invalid API-key provided.', request_id: REQUEST_ID }, 401));
    expect(await new QwenAdapter().fetchModels('sk-bad')).toEqual(roster);
    expect(calls).toHaveLength(1);
  });

  it('falls back to the roster when the request throws', async () => {
    const roster = await fallback();
    replyWith(new TypeError('fetch failed'));
    expect(await new QwenAdapter().fetchModels('sk-test-0000')).toEqual(roster);
  });

  it('falls back to the roster when the body has no data array', async () => {
    const roster = await fallback();
    replyWith(jsonResponse({ object: 'list' }, 200));
    expect(await new QwenAdapter().fetchModels('sk-test-0000')).toEqual(roster);
  });

  it('falls back to the roster when the body is not JSON', async () => {
    const roster = await fallback();
    replyWith(new Response('not json', { status: 200 }));
    expect(await new QwenAdapter().fetchModels('sk-test-0000')).toEqual(roster);
  });
});
