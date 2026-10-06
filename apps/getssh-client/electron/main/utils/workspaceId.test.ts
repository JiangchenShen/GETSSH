import { describe, expect, it } from 'vitest';
import { isValidWorkspaceId } from './workspaceId';

// The same ids are refused by getssh-store (store.rs validate_workspace_id) and its fake.
describe('isValidWorkspaceId', () => {
  it('refuses what cannot be a portable file name or a keystore scope id', () => {
    for (const bad of ['', '..', '../x', 'a/b', 'a\\b', 'a:b', ' x', 'x ', 'x.', '.x', 'CON', 'lpt1.txt', 'con.a b', 'LPT1.x ',
      'a\u0000b', 'a\u007fb', 'x\u0085', 'a\u009fb', '﻿x', 'x　', 'x'.repeat(129)]) {
      expect(isValidWorkspaceId(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('keeps CJK names and inner spaces', () => {
    for (const good of ['default', '工作区 1', 'a b', 'con-x', 'x'.repeat(128)]) {
      expect(isValidWorkspaceId(good), JSON.stringify(good)).toBe(true);
    }
  });
});
