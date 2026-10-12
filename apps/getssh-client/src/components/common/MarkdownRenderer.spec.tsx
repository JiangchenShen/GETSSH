// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ markdown: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-US' } }) }));
vi.mock('react-markdown', () => ({ default: (props: any) => {
  mocks.markdown(props);
  const Code = props.components.code;
  return <div><p>{props.children}</p><Code inline={false} className="language-bash">{'echo test\n'}</Code></div>;
} }));
vi.mock('react-syntax-highlighter', () => ({ Prism: ({ children }: any) => <pre>{children}</pre> }));

import { MarkdownRenderer } from './MarkdownRenderer';

let root: Root;
let container: HTMLDivElement;
const onPaperPlane = vi.fn();
const copy = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.markdown.mockClear(); onPaperPlane.mockClear(); copy.mockClear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
const render = (content = 'reply') => act(async () => root.render(<MarkdownRenderer content={content} onPaperPlane={onPaperPlane} />));

describe('stable Markdown parsing configuration', () => {
  it('skips parsing when its message and action callback have not changed', async () => {
    await render();
    await render();
    expect(mocks.markdown).toHaveBeenCalledTimes(1);
  });
  it('keeps components and remark plugins stable while the reply grows', async () => {
    await render('first');
    const before = mocks.markdown.mock.calls[0][0];
    await render('first second');
    const after = mocks.markdown.mock.calls[1][0];
    expect(after.components).toBe(before.components);
    expect(after.remarkPlugins).toBe(before.remarkPlugins);
  });
  it('retains code-copy and terminal injection actions after memoization', async () => {
    vi.useFakeTimers();
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Inject to terminal"]')!.click());
    expect(onPaperPlane).toHaveBeenCalledWith('echo test');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Copy code"]')!.click());
    expect(copy).toHaveBeenCalledWith('echo test');
    await act(async () => vi.advanceTimersByTime(2000));
  });
});
