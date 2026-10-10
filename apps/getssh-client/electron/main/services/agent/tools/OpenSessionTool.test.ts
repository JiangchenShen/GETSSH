import { describe, expect, it, vi } from 'vitest';
import { OpenSessionTool } from './OpenSessionTool';

// open_session tells the model when the run may not open another session.

const context = (onGlobalAction: (payload: any) => boolean | void) => ({
  sessionId: 's', mode: 'agent', aiMaxTokens: 1000, searchConfig: {}, onChunk: vi.fn(), onGlobalAction,
});

describe('OpenSessionTool', () => {
  it('dispatches the action and reports success', async () => {
    const dispatch = vi.fn(() => true);
    const result = await new OpenSessionTool().execute({ target: 'web', execute: 'uptime' }, context(dispatch));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'open_session', target: 'web', execute: 'uptime' }));
    expect(result).toMatchObject({ success: true, shouldContinue: true });
  });

  it('reports a refused action to the model instead of success', async () => {
    const result = await new OpenSessionTool().execute({ target: 'web' }, context(() => false));
    expect(result.success).toBe(false);
    expect(result.promptFeed).toMatch(/refused/);
  });
});
