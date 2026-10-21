// @vitest-environment node
/**
 * MiniMaxAdapter against MiniMax's documented wire formats (checked 2026-10-21):
 *
 *   Anthropic-compatible  POST {host}/anthropic/v1/messages, `Authorization: Bearer`,
 *     platform.minimax.io/docs/api-reference/text-anthropic-api. MiniMax publishes no raw stream,
 *     only an Anthropic-SDK example, so the stream fixtures follow Anthropic's own SSE contract
 *     (platform.claude.com/docs/en/build-with-claude/streaming), which that SDK parses.
 *   OpenAI-compatible     POST {host}/v1/chat/completions, `reasoning_split` puts thinking in
 *     `delta.reasoning_content`; chunk fixtures copy the documented chunk shape
 *     (platform.minimax.cn/docs/api-reference/text-chat-openai): no `[DONE]`, `finish_reason`
 *     on the last content chunk, `base_resp` only on the non-streaming response.
 *   Models                GET {host}/v1/models, Bearer, `{ object: "list", data: [{ id }] }`.
 *   Hosts                 api.minimax.io (international), api.minimax.cn (mainland China).
 *
 * Tests marked `it.fails` assert documented behaviour the adapter does not have yet.
 * The ones fixed on 2026-10-21 are plain `it` now; their comments say what was wrong.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MiniMaxAdapter } from './MiniMaxAdapter';
import { ModelCaps } from './ModelCapabilities';
import { LlmError, type LlmRequest, type LlmResponse, type StreamCallbacks, type Turn, type UnifiedTool } from './types';

const KEY = 'sk-minimax-test-fixture';
const enc = new TextEncoder();

// ── wire helpers ─────────────────────────────────────────────────────────────

/** A body that hands out exactly one of `chunks` per read, like a socket would. */
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}

function sseResponse(body: string | Uint8Array[]): Response {
  const chunks = typeof body === 'string' ? [enc.encode(body)] : body;
  return new Response(streamOf(chunks), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' },
  });
}

/** UTF-8 byte offset of `needle` inside `text`. */
function byteOffset(text: string, needle: string): number {
  const at = text.indexOf(needle);
  if (at < 0) throw new Error(`fixture is missing ${JSON.stringify(needle)}`);
  return enc.encode(text.slice(0, at)).length;
}

/** Cuts the UTF-8 bytes of `text` at the given byte offsets. */
function cutBytes(text: string, offsets: number[]): Uint8Array[] {
  const bytes = enc.encode(text);
  const cuts = [...new Set(offsets)].filter(o => o > 0 && o < bytes.length).sort((a, b) => a - b);
  const out: Uint8Array[] = [];
  let prev = 0;
  for (const o of cuts) { out.push(bytes.slice(prev, o)); prev = o; }
  out.push(bytes.slice(prev));
  return out;
}

/** Every byte its own chunk. */
function eachByte(text: string): Uint8Array[] {
  return Array.from(enc.encode(text), b => Uint8Array.of(b));
}

/** True when some chunk boundary falls strictly inside the UTF-8 encoding of `ch` in `text`. */
function cutsInside(text: string, chunks: Uint8Array[], ch: string): boolean {
  const start = byteOffset(text, ch);
  const end = start + enc.encode(ch).length;
  let pos = 0;
  for (const c of chunks.slice(0, -1)) {
    pos += c.length;
    if (pos > start && pos < end) return true;
  }
  return false;
}

// Anthropic Messages SSE: a named event line, its JSON data line, then a blank line.
const ev = (data: { type: string; [k: string]: unknown }) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
// OpenAI-compatible SSE: data-only frames.
const frame = (data: unknown) => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;

const messageStart = (usage: Record<string, number> | null = { input_tokens: 25, output_tokens: 1 }) => ev({
  type: 'message_start',
  message: {
    id: 'msg_0601', type: 'message', role: 'assistant', content: [], model: 'MiniMax-M3',
    stop_reason: null, stop_sequence: null, ...(usage ? { usage } : {}),
  },
});
const textStart = (index: number) => ev({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
const textDelta = (index: number, text: string) => ev({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } });
const blockStop = (index: number) => ev({ type: 'content_block_stop', index });
const messageDelta = (stop_reason: string, usage?: Record<string, number>) =>
  ev({ type: 'message_delta', delta: { stop_reason, stop_sequence: null }, ...(usage ? { usage } : {}) });
const messageStop = () => ev({ type: 'message_stop' });

const ANTHROPIC_OK = () => [
  messageStart(), textStart(0), textDelta(0, 'ok'), blockStop(0), messageDelta('end_turn', { output_tokens: 1 }), messageStop(),
].join('');

/** One chat.completion.chunk in the documented shape (platform.minimax.cn text-chat-openai). */
const oaChunk = (delta: Record<string, unknown>, extra: { finish_reason?: string; usage?: unknown; model?: string } = {}) => ({
  id: '066a2db7cb70134c45f5d6443d434c2c',
  choices: [{
    ...(extra.finish_reason ? { finish_reason: extra.finish_reason } : {}),
    index: 0,
    delta: { ...delta, role: 'assistant', name: 'MiniMax AI', audio_content: '' },
  }],
  created: 1780153015,
  model: extra.model ?? 'MiniMax-M3',
  object: 'chat.completion.chunk',
  usage: extra.usage ?? null,
  input_sensitive: false,
  output_sensitive: false,
  input_sensitive_type: 0,
  output_sensitive_type: 0,
  output_sensitive_int: 0,
});

const OPENAI_OK = () => frame(oaChunk({ content: 'ok' }, { finish_reason: 'stop' }));

// ── fixtures ─────────────────────────────────────────────────────────────────

const fetchMock = vi.fn<typeof fetch>();

function defaultFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.endsWith('/anthropic/v1/messages')) return Promise.resolve(sseResponse(ANTHROPIC_OK()));
  if (url.endsWith('/v1/chat/completions')) return Promise.resolve(sseResponse(OPENAI_OK()));
  return Promise.resolve(jsonResponse(404, { error: { type: 'not_found_error', message: 'not found' } }));
}

beforeEach(() => {
  ModelCaps._reset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({ apiKey: KEY, model: 'MiniMax-M3', prompt: 'hi', ...over });

function callbacks() {
  const chunks: string[] = [];
  const thoughts: string[] = [];
  const done: LlmResponse[] = [];
  const cb: StreamCallbacks = {
    onChunk: c => { chunks.push(c); },
    onThoughtChunk: t => { thoughts.push(t); },
    onDone: r => { done.push(r); },
  };
  return { cb, chunks, thoughts, done };
}

function call(i = -1) {
  const calls = fetchMock.mock.calls;
  const [input, init] = calls.at(i)!;
  const headers = new Headers(init?.headers);
  return {
    url: String(input),
    method: init?.method ?? 'GET',
    headers,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
}

async function run(request: LlmRequest, response?: Response) {
  if (response) fetchMock.mockResolvedValueOnce(response);
  const c = callbacks();
  const result = await new MiniMaxAdapter().streamTurn(request, c.cb);
  return { result, ...c };
}

async function runError(request: LlmRequest, response: Response): Promise<LlmError> {
  fetchMock.mockResolvedValueOnce(response);
  const err = await new MiniMaxAdapter().streamTurn(request, {}).then(
    () => { throw new Error('expected streamTurn to reject'); },
    e => e,
  );
  expect(err).toBeInstanceOf(LlmError);
  expect((err as LlmError).provider).toBe('minimax');
  return err as LlmError;
}

const TERMINAL_TOOL: UnifiedTool = {
  name: 'execute_terminal',
  description: 'Run a shell command on the active session',
  parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
};

/** A finished tool round in the unified model: thinking, text and a call, then its result. */
const TOOL_ROUND: Turn[] = [
  { role: 'system', blocks: [{ kind: 'text', text: 'You run commands for the user.' }] },
  { role: 'user', blocks: [{ kind: 'text', text: 'list files' }] },
  {
    role: 'assistant',
    blocks: [
      { kind: 'thought', text: 'I should run ls.', opaque: JSON.stringify({ signature: 'sig-0601' }) },
      { kind: 'text', text: 'Running ls.' },
      { kind: 'tool_call', callId: 'call_function_1', name: 'execute_terminal', args: { command: 'ls' }, raw: '{"command":"ls"}' },
    ],
  },
  {
    role: 'user',
    blocks: [{
      kind: 'tool_result', callId: 'call_function_1', name: 'execute_terminal',
      content: ['a.txt', { kind: 'text', text: 'b.txt' }], isError: false,
    }],
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// Requests: Anthropic-compatible (the default)
// ═════════════════════════════════════════════════════════════════════════════

describe('Anthropic-compatible request', () => {
  it('posts to the international host with a Bearer key and the Messages body', async () => {
    await run(req({ systemPrompt: 'Be brief.', context: 'host: web-1', maxOutputTokens: 2048 }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, method, headers, body } = call();
    expect(url).toBe('https://api.minimax.io/anthropic/v1/messages');
    expect(method).toBe('POST');
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('x-api-key')).toBe(false);
    expect(body).toEqual({
      model: 'MiniMax-M3',
      max_tokens: 2048,
      stream: true,
      system: [{ type: 'text', text: 'Be brief.\n\n[Context]\nhost: web-1' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      thinking: { type: 'adaptive' },
    });
  });

  it.each([
    [undefined, 'https://api.minimax.io/anthropic/v1/messages'],
    ['', 'https://api.minimax.io/anthropic/v1/messages'],
    ['https://api.minimax.cn', 'https://api.minimax.cn/anthropic/v1/messages'],
    ['https://api.minimax.cn/', 'https://api.minimax.cn/anthropic/v1/messages'],
    ['https://api.minimax.cn/anthropic', 'https://api.minimax.cn/anthropic/v1/messages'],
    ['https://api.minimax.cn/anthropic/', 'https://api.minimax.cn/anthropic/v1/messages'],
    ['https://api.minimax.cn/anthropic/v1/messages', 'https://api.minimax.cn/anthropic/v1/messages'],
    ['https://api.minimax.cn/anthropic/v1/messages/', 'https://api.minimax.cn/anthropic/v1/messages'],
    // the legacy native endpoint is moved onto the Anthropic-compatible one
    ['https://api.minimax.cn/v1/text/chatcompletion_v2', 'https://api.minimax.cn/anthropic/v1/messages'],
  ])('endpoint %j goes to %s', async (endpoint, expected) => {
    await run(req({ endpoint }));
    expect(call().url).toBe(expected);
  });

  it('sends tools with input_schema and maps every tool_choice form', async () => {
    const cases: Array<[LlmRequest['toolChoice'], unknown]> = [
      [undefined, { type: 'auto' }],
      ['auto', { type: 'auto' }],
      ['required', { type: 'any' }],
      ['any', { type: 'any' }],
      ['none', { type: 'none' }],
      [{ type: 'tool', name: 'execute_terminal' }, { type: 'tool', name: 'execute_terminal' }],
    ];
    for (const [toolChoice, expected] of cases) {
      await run(req({ tools: [TERMINAL_TOOL], toolChoice }));
      const { body } = call();
      expect(body.tools).toEqual([{
        name: 'execute_terminal',
        description: 'Run a shell command on the active session',
        input_schema: TERMINAL_TOOL.parameters,
      }]);
      expect(body.tool_choice).toEqual(expected);
    }
  });

  it('sends temperature only when the caller gives one', async () => {
    await run(req());
    expect(call().body).not.toHaveProperty('temperature');
    await run(req({ temperature: 0.3 }));
    expect(call().body.temperature).toBe(0.3);
  });

  it('replays a tool round with thinking (signature), text, tool_use and tool_result blocks', async () => {
    await run(req({ prompt: undefined, history: TOOL_ROUND }));
    const { body } = call();
    expect(body.system).toEqual([{ type: 'text', text: 'You run commands for the user.' }]);
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'list files' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should run ls.', signature: 'sig-0601' },
          { type: 'text', text: 'Running ls.' },
          { type: 'tool_use', id: 'call_function_1', name: 'execute_terminal', input: { command: 'ls' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_function_1', content: 'a.txt\nb.txt', is_error: false }],
      },
    ]);
  });

  it('a bare signature string in opaque is sent as the signature', async () => {
    const history: Turn[] = [
      { role: 'user', blocks: [{ kind: 'text', text: 'q' }] },
      { role: 'assistant', blocks: [{ kind: 'thought', text: 't', opaque: 'raw-sig' }, { kind: 'text', text: 'a' }] },
      { role: 'user', blocks: [{ kind: 'text', text: 'next' }] },
    ];
    await run(req({ prompt: undefined, history }));
    expect(call().body.messages[1].content[0]).toEqual({ type: 'thinking', thinking: 't', signature: 'raw-sig' });
  });

  // Documented thinking table: M3 omitted=off, adaptive=on, disabled=stays off;
  // M2.x thinking stays on whatever is sent.
  it('thinking: adaptive by default, disabled for M3 on effort none, adaptive for M2.x on effort none', async () => {
    await run(req({ model: 'MiniMax-M3' }));
    expect(call().body.thinking).toEqual({ type: 'adaptive' });
    await run(req({ model: 'MiniMax-M3', thinkingEffort: 'none' }));
    expect(call().body.thinking).toEqual({ type: 'disabled' });
    await run(req({ model: 'MiniMax-M2.7', thinkingEffort: 'none' }));
    expect(call().body.thinking).toEqual({ type: 'adaptive' });
  });

  // Fixed. Documented: `MiniMax-M3.1-Flash` + thinking {"type":"disabled"} "Returns 400 — thinking
  // cannot be disabled" (error 2013). The /m3/i family rule in ModelCapabilities.ts used to mark it
  // disablable; a /m3\.1-flash/i rule now comes first.
  it('MiniMax-M3.1-Flash with effort none does not send thinking disabled (documented 400)', async () => {
    await run(req({ model: 'MiniMax-M3.1-Flash', thinkingEffort: 'none' }));
    expect(call().body.thinking?.type).not.toBe('disabled');
  });

  // Documented: output_config.effort "Tunes thinking depth for MiniMax-M3.1-Flash", accepts
  // low/medium/high/xhigh/max, defaults to max when omitted, and returns 400 for none.
  it.each([
    ['none', 'low'], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max'],
  ] as const)('MiniMax-M3.1-Flash with effort %s sends output_config.effort %s', async (effort, sent) => {
    await run(req({ model: 'MiniMax-M3.1-Flash', thinkingEffort: effort }));
    expect(call().body.output_config).toEqual({ effort: sent });
    expect(call().body.thinking).toEqual({ type: 'adaptive' });
  });

  it('sends no effort to MiniMax-M3, or when no effort is asked', async () => {
    await run(req({ model: 'MiniMax-M3', thinkingEffort: 'low' }));
    expect(call().body).not.toHaveProperty('output_config');
    await run(req({ model: 'MiniMax-M3.1-Flash', thinkingEffort: undefined }));
    expect(call().body).not.toHaveProperty('output_config');
  });

  it('stops sending the effort once the model is known to reject it', async () => {
    ModelCaps.learnFromError('minimax', 'MiniMax-M3.1-Flash', 400, 'invalid params, output_config.effort is not supported (2013)');
    await run(req({ model: 'MiniMax-M3.1-Flash', thinkingEffort: 'low' }));
    expect(call().body).not.toHaveProperty('output_config');
  });

  // DEFECT. The adapter's own contract (MiniMaxAdapter.ts:69-73): a model no family rule matches is
  // sent the minimal request, without `thinking`. The else branch sends {type:'adaptive'} anyway,
  // and because supportsThinking is never consulted a learned `no_thinking` quirk cannot heal a 400.
  it.fails('a model no capability rule matches gets no thinking field (adapter comment)', async () => {
    await run(req({ model: 'MiniMax-Text-01' }));
    expect(call().body).not.toHaveProperty('thinking');
  });

  it('refuses before any network call when the API key is missing', async () => {
    const err = await new MiniMaxAdapter().streamTurn(req({ apiKey: '' }), {}).catch(e => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: 'no_api_key', retryable: false, provider: 'minimax' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Requests: OpenAI-compatible (only when the user names it)
// ═════════════════════════════════════════════════════════════════════════════

describe('OpenAI-compatible request', () => {
  it.each([
    ['https://api.minimax.io/v1', 'https://api.minimax.io/v1/chat/completions'],
    ['https://api.minimax.cn/v1', 'https://api.minimax.cn/v1/chat/completions'],
    ['https://api.minimax.cn/v1/', 'https://api.minimax.cn/v1/chat/completions'],
    ['https://api.minimax.cn/v1/chat/completions', 'https://api.minimax.cn/v1/chat/completions'],
    ['https://api.minimax.cn/v1/chat/completions/', 'https://api.minimax.cn/v1/chat/completions'],
  ])('endpoint %j goes to %s', async (endpoint, expected) => {
    await run(req({ endpoint }));
    expect(call().url).toBe(expected);
  });

  it('posts the chat body with reasoning_split, usage, thinking, tools and the replayed tool round', async () => {
    await run(req({
      endpoint: 'https://api.minimax.io/v1', prompt: undefined, history: TOOL_ROUND,
      tools: [TERMINAL_TOOL], maxOutputTokens: 4096,
    }));
    const { method, headers, body } = call();
    expect(method).toBe('POST');
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(body).toEqual({
      model: 'MiniMax-M3',
      messages: [
        { role: 'system', content: 'You run commands for the user.' },
        { role: 'user', content: 'list files' },
        {
          role: 'assistant',
          content: 'Running ls.',
          tool_calls: [{ id: 'call_function_1', type: 'function', function: { name: 'execute_terminal', arguments: '{"command":"ls"}' } }],
          // documented: reasoning_content "must also be preserved completely" across tool rounds
          reasoning_content: 'I should run ls.',
        },
        { role: 'tool', tool_call_id: 'call_function_1', content: 'a.txt\nb.txt' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      reasoning_split: true,
      max_completion_tokens: 4096,
      thinking: { type: 'adaptive' },
      tools: [{
        type: 'function',
        function: { name: 'execute_terminal', description: 'Run a shell command on the active session', parameters: TERMINAL_TOOL.parameters },
      }],
    });
  });

  it('thinking disabled for M3 on effort none, adaptive for M2.x', async () => {
    await run(req({ endpoint: 'https://api.minimax.io/v1', thinkingEffort: 'none' }));
    expect(call().body.thinking).toEqual({ type: 'disabled' });
    await run(req({ endpoint: 'https://api.minimax.io/v1', model: 'MiniMax-M2.7', thinkingEffort: 'none' }));
    expect(call().body.thinking).toEqual({ type: 'adaptive' });
  });

  // Fixed, same as on the Anthropic path: documented 400 (2013) for M3.1-Flash + disabled.
  it('MiniMax-M3.1-Flash with effort none does not send thinking disabled (documented 400)', async () => {
    await run(req({ endpoint: 'https://api.minimax.io/v1', model: 'MiniMax-M3.1-Flash', thinkingEffort: 'none' }));
    expect(call().body.thinking?.type).not.toBe('disabled');
  });

  // Documented: "Only MiniMax-M3.1-Flash supports real thinking-depth tuning; other models ignore
  // this field." reasoning_effort is top-level, defaults to max, and none returns 400.
  it('sends the effort to MiniMax-M3.1-Flash as reasoning_effort, and none as low', async () => {
    await run(req({ endpoint: 'https://api.minimax.io/v1', model: 'MiniMax-M3.1-Flash', thinkingEffort: 'medium' }));
    expect(call().body.reasoning_effort).toBe('medium');
    expect(call().body).not.toHaveProperty('output_config');
    await run(req({ endpoint: 'https://api.minimax.io/v1', model: 'MiniMax-M3.1-Flash', thinkingEffort: 'none' }));
    expect(call().body.reasoning_effort).toBe('low');
    await run(req({ endpoint: 'https://api.minimax.io/v1', model: 'MiniMax-M3', thinkingEffort: 'low' }));
    expect(call().body).not.toHaveProperty('reasoning_effort');
  });

  it('refuses before any network call when the API key is missing', async () => {
    const err = await new MiniMaxAdapter().streamTurn(req({ endpoint: 'https://api.minimax.io/v1', apiKey: '' }), {}).catch(e => e);
    expect(err).toMatchObject({ code: 'no_api_key', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Streams: Anthropic-compatible
// ═════════════════════════════════════════════════════════════════════════════

const TEXT_STREAM = [
  messageStart(),
  textStart(0),
  ev({ type: 'ping' }),
  textDelta(0, 'Hello'),
  textDelta(0, '，你好'),
  textDelta(0, '世界 🌏!'),
  blockStop(0),
  messageDelta('end_turn', { output_tokens: 15 }),
  messageStop(),
].join('');

describe('Anthropic-compatible stream', () => {
  it('text split across chunks, with multi-byte characters cut in half, arrives whole', async () => {
    const offsets = [
      byteOffset(TEXT_STREAM, '你') + 1,                 // inside a 3-byte character
      byteOffset(TEXT_STREAM, '世') + 2,                 // inside another
      byteOffset(TEXT_STREAM, '🌏') + 3,                 // inside a 4-byte character
      byteOffset(TEXT_STREAM, 'event: content_block_delta') + 9,  // inside an event line
      byteOffset(TEXT_STREAM, '"text_delta"') + 4,       // inside a data line
      byteOffset(TEXT_STREAM, '\n\nevent: content_block_stop') + 1, // between the two line breaks
    ];
    const chunks = cutBytes(TEXT_STREAM, offsets);
    expect(cutsInside(TEXT_STREAM, chunks, '你')).toBe(true);
    expect(cutsInside(TEXT_STREAM, chunks, '🌏')).toBe(true);

    const { result, chunks: seen, thoughts, done } = await run(req(), sseResponse(chunks));

    expect(seen).toEqual(['Hello', '，你好', '世界 🌏!']);
    expect(thoughts).toEqual([]);
    expect(result.text).toBe('Hello，你好世界 🌏!');
    expect(result.blocks).toEqual([{ kind: 'text', text: 'Hello，你好世界 🌏!' }]);
    expect(result.toolCalls).toEqual([]);
    expect(result.stopReason).toBe('end_turn');
    expect(result.model).toBe('MiniMax-M3');
    expect(done).toEqual([result]);
  });

  it('the same stream one byte at a time with CRLF line endings gives the same answer', async () => {
    const crlf = TEXT_STREAM.replace(/\n/g, '\r\n');
    const { result, chunks } = await run(req(), sseResponse(eachByte(crlf)));
    expect(chunks).toEqual(['Hello', '，你好', '世界 🌏!']);
    expect(result.text).toBe('Hello，你好世界 🌏!');
    expect(result.stopReason).toBe('end_turn');
  });

  // Anthropic's documented "streaming request with tool use" response, verbatim apart from ids.
  const TOOL_STREAM = [
    messageStart({ input_tokens: 472, output_tokens: 2 }),
    textStart(0),
    ev({ type: 'ping' }),
    textDelta(0, 'Okay'),
    textDelta(0, ', let\'s check the weather for San Francisco, CA:'),
    blockStop(0),
    ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call_function_8gr3jxf6m5wm_1', name: 'get_weather', input: {} } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"location":' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ' "San' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ' Francisc' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'o,' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ' CA"}' } }),
    blockStop(1),
    messageDelta('tool_use', { output_tokens: 89 }),
    messageStop(),
  ].join('');

  it('a streamed tool call gives the toolCalls entry with name, parsed args and raw JSON', async () => {
    const chunks = cutBytes(TOOL_STREAM, [byteOffset(TOOL_STREAM, 'Francisc') + 3, byteOffset(TOOL_STREAM, '"tool_use"') + 2]);
    const { result, chunks: seen } = await run(req({ tools: [TERMINAL_TOOL] }), sseResponse(chunks));

    const raw = '{"location": "San Francisco, CA"}';
    expect(result.toolCalls).toEqual([
      { callId: 'call_function_8gr3jxf6m5wm_1', name: 'get_weather', args: { location: 'San Francisco, CA' }, raw },
    ]);
    expect(result.blocks).toEqual([
      { kind: 'text', text: 'Okay, let\'s check the weather for San Francisco, CA:' },
      { kind: 'tool_call', callId: 'call_function_8gr3jxf6m5wm_1', name: 'get_weather', args: { location: 'San Francisco, CA' }, raw },
    ]);
    expect(seen).toEqual(['Okay', ', let\'s check the weather for San Francisco, CA:']);
    expect(result.stopReason).toBe('tool_use');
  });

  // Fixed. Anthropic contract: the tool_use block starts with "input": {} and the deltas are
  // partial JSON of that input; "the final tool_use.input is always an object". A tool without
  // arguments (e.g. get_environment_info) streams only `partial_json: ""`, so its input is {}.
  // The adapter used to JSON.parse('') and hand the tool { _raw: '' }.
  it('a tool call without arguments has args {}', async () => {
    const stream = [
      messageStart(),
      ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_function_2', name: 'get_environment_info', input: {} } }),
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '' } }),
      blockStop(0),
      messageDelta('tool_use', { output_tokens: 12 }),
      messageStop(),
    ].join('');
    const { result } = await run(req(), sseResponse(stream));
    expect(result.toolCalls[0]).toMatchObject({ callId: 'call_function_2', name: 'get_environment_info' });
    expect(result.toolCalls[0].args).toEqual({});
  });

  // Anthropic's documented "streaming request with thinking" response.
  const SIGNATURE = 'EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pkiMOYds';
  const THINKING_PARTS = [
    'I need to find the GCD of 1071 and 462 using the Euclidean algorithm.\n\n1071 = 2 × 462 + 147',
    '\n462 = 3 × 147 + 21',
    '\n147 = 7 × 21 + 0',
    '\nThe remainder is 0, so GCD(1071, 462) = 21.',
  ];
  const thinkingStream = (withSignature: boolean) => [
    messageStart(null),
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
    ...THINKING_PARTS.map(thinking => ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } })),
    ...(withSignature ? [ev({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: SIGNATURE } })] : []),
    blockStop(0),
    textStart(1),
    textDelta(1, 'The greatest common divisor of 1071 and 462 is **21**.'),
    blockStop(1),
    messageDelta('end_turn'),
    messageStop(),
  ].join('');

  it('thinking deltas become a thought block carrying the signature, and are replayed next turn', async () => {
    const stream = thinkingStream(true);
    const chunks = cutBytes(stream, [byteOffset(stream, '×') + 1, byteOffset(stream, 'signature_delta') + 5]);
    const { result, thoughts, chunks: seen } = await run(req(), sseResponse(chunks));

    expect(thoughts).toEqual(THINKING_PARTS);
    expect(seen).toEqual(['The greatest common divisor of 1071 and 462 is **21**.']);
    expect(result.blocks).toEqual([
      { kind: 'thought', text: THINKING_PARTS.join(''), opaque: JSON.stringify({ signature: SIGNATURE }) },
      { kind: 'text', text: 'The greatest common divisor of 1071 and 462 is **21**.' },
    ]);
    expect(result.text).toBe('The greatest common divisor of 1071 and 462 is **21**.');
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage).toBeUndefined();

    // Documented: keep thinking blocks unchanged in later turns.
    await run(req({
      prompt: undefined,
      history: [
        { role: 'user', blocks: [{ kind: 'text', text: 'gcd(1071, 462)?' }] },
        { role: 'assistant', blocks: result.blocks },
        { role: 'user', blocks: [{ kind: 'text', text: 'and lcm?' }] },
      ],
    }));
    expect(call().body.messages[1].content).toEqual([
      { type: 'thinking', thinking: THINKING_PARTS.join(''), signature: SIGNATURE },
      { type: 'text', text: 'The greatest common divisor of 1071 and 462 is **21**.' },
    ]);
  });

  // DEFECT (plausible). MiniMax documents thinking blocks but never a `signature`, and says to
  // "preserve them unchanged in later turns". A thought block without a signature has no opaque,
  // and the replay loop drops it (MiniMaxAdapter.ts:155), so the M3 reasoning chain is cut.
  it.fails('a thinking block that arrived without a signature is still replayed next turn', async () => {
    const { result } = await run(req(), sseResponse(thinkingStream(false)));
    await run(req({
      prompt: undefined,
      history: [
        { role: 'user', blocks: [{ kind: 'text', text: 'gcd(1071, 462)?' }] },
        { role: 'assistant', blocks: result.blocks },
        { role: 'user', blocks: [{ kind: 'text', text: 'and lcm?' }] },
      ],
    }));
    expect(call().body.messages[1].content[0]).toMatchObject({ type: 'thinking', thinking: THINKING_PARTS.join('') });
  });

  // Documented: thinking tokens count toward max_tokens; too small a value yields
  // stop_reason "max_tokens" with no text.
  it('stop_reason max_tokens after thinking only gives no text and stopReason max_tokens', async () => {
    const stream = [
      messageStart(),
      ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think about' } }),
      blockStop(0),
      messageDelta('max_tokens', { output_tokens: 16 }),
      messageStop(),
    ].join('');
    const { result } = await run(req({ maxOutputTokens: 16 }), sseResponse(stream));
    expect(result.text).toBe('');
    expect(result.stopReason).toBe('max_tokens');
    expect(result.blocks).toEqual([{ kind: 'thought', text: 'Let me think about', opaque: undefined }]);
  });

  it('cumulative usage on message_delta is normalised (cache reads and writes count as input)', async () => {
    const stream = [
      messageStart(), textStart(0), textDelta(0, 'ok'), blockStop(0),
      messageDelta('end_turn', { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 50 }),
      messageStop(),
    ].join('');
    const { result } = await run(req(), sseResponse(stream));
    expect(result.usage).toEqual({ inputTokens: 125, outputTokens: 50, reasoningTokens: 0, cachedTokens: 20, totalTokens: 175 });
  });

  // Fixed. Anthropic contract: input_tokens arrive in message_start's message.usage; the documented
  // message_delta carries only {"output_tokens": 15}. The adapter did not read message_start and
  // reported 0 input tokens for such a stream.
  it('input tokens from message_start are counted', async () => {
    const { result } = await run(req(), sseResponse(TEXT_STREAM));
    expect(result.usage).toEqual({ inputTokens: 25, outputTokens: 15, reasoningTokens: 0, cachedTokens: 0, totalTokens: 40 });
  });

  // MiniMax's cache docs: on the Anthropic endpoint input_tokens counts only new tokens and
  // cache_read_input_tokens is reported separately. Anthropic sends both in message_start.
  it('cache reads reported only in message_start count as cached input', async () => {
    const stream = [
      messageStart({ input_tokens: 108, cache_read_input_tokens: 14813, cache_creation_input_tokens: 0, output_tokens: 1 }),
      textStart(0), textDelta(0, 'ok'), blockStop(0),
      messageDelta('end_turn', { output_tokens: 15 }),
      messageStop(),
    ].join('');
    const { result } = await run(req(), sseResponse(stream));
    expect(result.usage).toEqual({ inputTokens: 14921, outputTokens: 15, reasoningTokens: 0, cachedTokens: 14813, totalTokens: 14936 });
  });

  it('a message_delta that zeroes a count does not lose the one from message_start', async () => {
    const stream = [
      messageStart({ input_tokens: 108, cache_read_input_tokens: 14813, output_tokens: 1 }),
      textStart(0), textDelta(0, 'ok'), blockStop(0),
      messageDelta('end_turn', { input_tokens: 0, cache_read_input_tokens: 14813, output_tokens: 15 }),
      messageStop(),
    ].join('');
    const { result } = await run(req(), sseResponse(stream));
    expect(result.usage).toMatchObject({ inputTokens: 14921, cachedTokens: 14813 });
  });

  it('a stream with usage only in message_start still reports it', async () => {
    const stream = [
      messageStart({ input_tokens: 40, cache_read_input_tokens: 60, output_tokens: 1 }),
      textStart(0), textDelta(0, 'ok'), blockStop(0),
      messageDelta('end_turn'),
      messageStop(),
    ].join('');
    const { result } = await run(req(), sseResponse(stream));
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 0, reasoningTokens: 0, cachedTokens: 60, totalTokens: 100 });
  });

  it('a stream cut off before message_stop is a retryable error', async () => {
    const stream = [messageStart(), textStart(0), textDelta(0, 'Hel')].join('');
    const err = await runError(req(), sseResponse(stream));
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/message_stop/);
  });

  it('an overloaded_error event inside a 200 stream is a retryable LlmError', async () => {
    const stream = [
      messageStart(), textStart(0), textDelta(0, 'Hel'),
      ev({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    ].join('');
    const err = await runError(req(), sseResponse(stream));
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('Overloaded');
  });

  // Fixed. An error event carries the same error types as the HTTP errors; the adapter marked
  // every one retryable, so a request the server rejects as invalid was sent again up to three
  // times. Its own HTTP branch treats 4xx as final.
  it('an invalid_request_error event inside a 200 stream is not retryable', async () => {
    const stream = [
      messageStart(),
      ev({ type: 'error', error: { type: 'invalid_request_error', message: 'invalid params, tool_result block(s) missing (2013)' } }),
    ].join('');
    const err = await runError(req(), sseResponse(stream));
    expect(err.retryable).toBe(false);
  });

  it('base_resp in a plain JSON 200 body is the MiniMax error on this path too', async () => {
    const err = await runError(req(), jsonResponse(200, { base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }));
    expect(err).toMatchObject({ code: '1008', retryable: false, status: 200 });
    expect(err.message).toContain('insufficient balance');
  });

  it('a JSON 200 body without an error is not retried as a dropped stream', async () => {
    const err = await runError(req(), jsonResponse(200, { id: 'msg_1', type: 'message', content: [] }));
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/stream was expected/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Streams: OpenAI-compatible
// ═════════════════════════════════════════════════════════════════════════════

const OA = req({ endpoint: 'https://api.minimax.io/v1' });

describe('OpenAI-compatible stream', () => {
  // Documented chunk shape: reasoning_content first, then content; finish_reason on the last
  // content chunk; no [DONE]. Usage goes on the last chunk when include_usage is set.
  const CONTENT = ['这张图片是一个小女孩的肖像特写照片。\n\n', '- **人物**：大约3-5岁', '，色彩温暖 ✨'];
  const REASONING = ['The user', ' is asking in Chinese what the content of this image is.'];
  const usage = { total_tokens: 50, total_characters: 0, prompt_tokens: 20, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 4 } };
  const STREAM = [
    frame(oaChunk({ reasoning_content: REASONING[0] })),
    frame(oaChunk({ reasoning_content: REASONING[1] })),
    frame(oaChunk({ content: CONTENT[0] })),
    frame(oaChunk({ content: CONTENT[1] })),
    frame(oaChunk({ content: CONTENT[2] }, { finish_reason: 'stop', usage })),
  ].join('');

  it('reasoning_content and content split across chunks, multi-byte cut, give thought and text', async () => {
    const offsets = [byteOffset(STREAM, '张') + 1, byteOffset(STREAM, '✨') + 2, byteOffset(STREAM, '"reasoning_content"') + 7];
    const chunks = cutBytes(STREAM, offsets);
    expect(cutsInside(STREAM, chunks, '张')).toBe(true);

    const { result, chunks: seen, thoughts, done } = await run(OA, sseResponse(chunks));
    expect(thoughts).toEqual(REASONING);
    expect(seen).toEqual(CONTENT);
    expect(result.text).toBe(CONTENT.join(''));
    expect(result.blocks).toEqual([
      { kind: 'thought', text: REASONING.join('') },
      { kind: 'text', text: CONTENT.join('') },
    ]);
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 30, totalTokens: 50, cachedTokens: 4, reasoningTokens: 0 });
    expect(done).toEqual([result]);
  });

  it('the same stream one byte at a time gives the same answer', async () => {
    const { result } = await run(OA, sseResponse(eachByte(STREAM)));
    expect(result.text).toBe(CONTENT.join(''));
    expect(result.blocks[0]).toEqual({ kind: 'thought', text: REASONING.join('') });
  });

  // MiniMax documents finish_reason "tool_calls" but no streamed tool_calls chunk; these chunks
  // follow the OpenAI streaming convention (index, id, function.name, function.arguments pieces).
  it('streamed tool_calls give the toolCalls entry and stopReason tool_use', async () => {
    const stream = [
      frame(oaChunk({ reasoning_content: 'Need a listing.' })),
      frame(oaChunk({ tool_calls: [{ index: 0, id: 'call_function_1', type: 'function', function: { name: 'execute_terminal', arguments: '' } }] })),
      frame(oaChunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":' } }] })),
      frame(oaChunk({ tool_calls: [{ index: 0, function: { arguments: ' "ls -la ~/文档"}' } }] }, { finish_reason: 'tool_calls' })),
      frame('[DONE]'),
    ].join('');
    const chunks = cutBytes(stream, [byteOffset(stream, '文') + 1, byteOffset(stream, '"tool_calls"') + 3]);
    const { result } = await run(OA, sseResponse(chunks));

    const raw = '{"command": "ls -la ~/文档"}';
    expect(result.toolCalls).toEqual([{ callId: 'call_function_1', name: 'execute_terminal', args: { command: 'ls -la ~/文档' }, raw }]);
    expect(result.blocks).toEqual([
      { kind: 'thought', text: 'Need a listing.' },
      { kind: 'tool_call', callId: 'call_function_1', name: 'execute_terminal', args: { command: 'ls -la ~/文档' }, raw },
    ]);
    expect(result.stopReason).toBe('tool_use');
  });

  it('finish_reason length is max_tokens', async () => {
    const stream = frame(oaChunk({ content: 'trunc' }, { finish_reason: 'length' }));
    const { result } = await run(OA, sseResponse(stream));
    expect(result.stopReason).toBe('max_tokens');
  });

  it('a stream with neither finish_reason nor [DONE] is a retryable error', async () => {
    const err = await runError(OA, sseResponse(frame(oaChunk({ content: 'half' }))));
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/finish_reason/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Errors
// ═════════════════════════════════════════════════════════════════════════════

const anthropicError = (type: string, message: string) => ({ type: 'error', error: { type, message } });
const baseResp = (status_code: number, status_msg: string) => ({
  id: '', choices: null, created: 1780153015, model: 'MiniMax-M3', object: 'chat.completion', usage: null,
  input_sensitive: false, output_sensitive: false, input_sensitive_type: 0, output_sensitive_type: 0, output_sensitive_int: 0,
  base_resp: { status_code, status_msg },
});

describe('errors', () => {
  it.each([
    // the documented 400 for M3.1-Flash + thinking disabled
    [400, 'invalid_request_error', false, 'model "MiniMax-M3.1-Flash" requires adaptive thinking; thinking.type="disabled" (including reasoning.effort=none) is not allowed (2013)'],
    [401, 'authentication_error', false, 'login fail: Please carry the API secret key in the \'Authorization\' field of the request header (1004)'],
    [429, 'rate_limit_error', true, 'rate limit exceeded (1002)'],
    [500, 'api_error', true, 'unknown error (1000)'],
    [529, 'overloaded_error', true, 'The server cluster is currently under high load (2064)'],
  ])('HTTP %i %s becomes LlmError retryable=%s', async (status, type, retryable, message) => {
    const err = await runError(req(), jsonResponse(status, anthropicError(type, message)));
    expect(err.status).toBe(status);
    expect(err.retryable).toBe(retryable);
    expect(err.code).toBe(type);
    expect(err.message).toContain(message);
  });

  it('an HTTP error whose body is not JSON keeps the status', async () => {
    const err = await runError(req(), jsonResponse(502, '<html>Bad Gateway</html>'));
    expect(err).toMatchObject({ status: 502, retryable: true, code: '502' });
    expect(err.message).toContain('HTTP 502');
  });

  it('an HTTP error carrying base_resp on the OpenAI endpoint is classified by its MiniMax code', async () => {
    const err = await runError(OA, jsonResponse(401, baseResp(1004, 'login fail')));
    expect(err).toMatchObject({ status: 401, retryable: false, code: '1004' });
    expect(err.message).toContain('login fail');
  });

  it.each([
    [1002, 'rate limit', true],
    [2056, 'usage limit exceeded', true],
    [1004, 'login fail', false],
    [1008, 'insufficient balance', false],
    [2013, 'invalid params', false],
    [2049, 'invalid api key', false],
  ])('base_resp %i (%s) inside a 200 stream becomes LlmError retryable=%s', async (code, msg, retryable) => {
    const err = await runError(OA, sseResponse(frame(baseResp(code, msg))));
    expect(err.retryable).toBe(retryable);
    expect(err.code).toBe(String(code));
    expect(err.message).toContain(msg);
  });

  it('base_resp status 0 on a chunk is not an error', async () => {
    const stream = frame({ ...oaChunk({ content: 'ok' }, { finish_reason: 'stop' }), base_resp: { status_code: 0, status_msg: '' } });
    const { result } = await run(OA, sseResponse(stream));
    expect(result.text).toBe('ok');
  });

  // Fixed. The error-code reference says "Please retry your requests later." for 1039 (token
  // limit), 2064 (server cluster under high load) and 2066 (request timed out while processing);
  // the adapter's retryable set used to leave them out, so they failed at once.
  for (const [code, msg] of [[1039, 'token limit'], [2064, 'The server cluster is currently under high load'], [2066, 'The request timed out while processing']] as const) {
    it(`base_resp ${code} (${msg}) is retryable`, async () => {
      const err = await runError(OA, sseResponse(frame(baseResp(code, msg))));
      expect(err.retryable).toBe(true);
    });
  }

  // Fixed. MiniMax documents base_resp only on the non-streaming application/json response
  // (ChatCompletionResp); the chunk schema has none. A 200 that answered with that JSON body
  // instead of SSE frames was never parsed (BaseAdapter only reads `data:` lines), so the adapter
  // reported a retryable "disconnected" error instead of insufficient balance.
  it('base_resp in a plain JSON 200 body becomes the MiniMax error, not a retryable disconnect', async () => {
    const err = await runError(OA, jsonResponse(200, baseResp(1008, 'insufficient balance')));
    expect(err).toMatchObject({ code: '1008', retryable: false });
    expect(err.message).toContain('insufficient balance');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// fetchModels
// ═════════════════════════════════════════════════════════════════════════════

// The documented example response of GET /v1/models.
const MODELS = {
  object: 'list',
  data: [
    { id: 'MiniMax-M3', object: 'model', created: 1780272000, owned_by: 'minimax' },
    { id: 'MiniMax-M2.7', object: 'model', created: 1773799200, owned_by: 'minimax' },
    { id: 'MiniMax-M2.5', object: 'model', created: 1770948000, owned_by: 'minimax' },
  ],
};

describe('fetchModels', () => {
  it('GETs /v1/models on the international host with a Bearer key and returns the ids', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, MODELS));
    const models = await new MiniMaxAdapter().fetchModels(KEY);
    const { url, method, headers } = call();
    expect(url).toBe('https://api.minimax.io/v1/models');
    expect(method).toBe('GET');
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(models).toEqual(['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5']);
  });

  it.each([
    'https://api.minimax.cn',
    'https://api.minimax.cn/',
    'https://api.minimax.cn/anthropic',
    'https://api.minimax.cn/anthropic/v1/messages',
    'https://api.minimax.cn/v1',
    'https://api.minimax.cn/v1/chat/completions',
  ])('endpoint %j lists models at https://api.minimax.cn/v1/models', async endpoint => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, MODELS));
    await new MiniMaxAdapter().fetchModels(KEY, endpoint);
    expect(call().url).toBe('https://api.minimax.cn/v1/models');
  });

  const FALLBACK_CASES: Array<[string, () => void, string]> = [
    ['HTTP 401', () => { fetchMock.mockResolvedValueOnce(jsonResponse(401, baseResp(1004, 'login fail'))); }, KEY],
    ['a network failure', () => { fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')); }, KEY],
    ['a body without a data array', () => { fetchMock.mockResolvedValueOnce(jsonResponse(200, baseResp(1000, 'unknown'))); }, KEY],
    ['a body that is not JSON', () => { fetchMock.mockResolvedValueOnce(jsonResponse(200, 'not json')); }, KEY],
  ];

  it.each(FALLBACK_CASES)('falls back to the built-in roster on %s', async (_label, arrange, key) => {
    arrange();
    const models = await new MiniMaxAdapter().fetchModels(key);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(models).toContain('MiniMax-M3');
    expect(models.length).toBeGreaterThan(1);
  });

  it('falls back without a network call when there is no key', async () => {
    const models = await new MiniMaxAdapter().fetchModels('');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(models[0]).toBe('MiniMax-M3');
  });

  // Fixed. platform.minimax.io/docs/faq/models lists MiniMax-M3.1-Flash and MiniMax-M3 as the
  // available text models and M2.x as retired (M2.5/M2.7: closed to new users 2026-10-19, retired
  // 2026-11-18). The fallback roster had no M3.1-Flash.
  it('the fallback roster offers MiniMax-M3.1-Flash', async () => {
    const models = await new MiniMaxAdapter().fetchModels('');
    expect(models).toContain('MiniMax-M3.1-Flash');
  });
});
