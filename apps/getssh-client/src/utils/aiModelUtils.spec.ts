import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_BY_PROVIDER, defaultModelFor, isUsableEndpoint } from './aiModelUtils';

describe('defaultModelFor', () => {
  it.each([
    ['minimax', 'MiniMax-M3'],
    ['qwen', 'qwen3.8-max'],
    ['claude', 'claude-sonnet-5'],
    ['ollama', 'qwen2.5-coder'],
    ['kimi', 'kimi-k3'],
  ])('gives %s its own default, %s', (provider, model) => {
    expect(defaultModelFor(provider)).toBe(model);
  });

  it('falls back to the OpenAI default for an unknown or missing provider', () => {
    expect(defaultModelFor('something-new')).toBe('gpt-5.6-terra');
    expect(defaultModelFor(undefined)).toBe('gpt-5.6-terra');
  });

  it('has a default for every provider in the settings list', () => {
    for (const provider of ['openai', 'gemini', 'claude', 'deepseek', 'zhipu', 'kimi', 'minimax', 'qwen', 'ollama', 'custom']) {
      expect(DEFAULT_MODEL_BY_PROVIDER[provider], provider).toBeTruthy();
    }
  });
});

describe('isUsableEndpoint', () => {
  it.each([
    '',
    undefined,
    'https://dashscope.aliyuncs.com',
    'https://api.minimax.cn',
    'http://127.0.0.1:11434',
    'https://ws-7f3k2.cn-beijing.maas.aliyuncs.com/api/v1',
  ])('accepts %s', endpoint => {
    expect(isUsableEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'h',
    'https:',
    'dashscope.aliyuncs.com',
    'ftp://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ])('refuses %s', endpoint => {
    expect(isUsableEndpoint(endpoint)).toBe(false);
  });
});
