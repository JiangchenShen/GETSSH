import { describe, expect, it } from 'vitest';
import { compareVersions } from './compareVersions';

describe('compareVersions', () => {
  it('orders a pre-release before its release, so a preview hears about the release', () => {
    expect(compareVersions('v3.0.0', '3.0.0-preview')).toBe(1);
    expect(compareVersions('3.0.0-preview', 'v3.0.0')).toBe(-1);
    expect(compareVersions('v3.0.0-preview', '3.0.0-preview')).toBe(0);
  });

  it('orders pre-releases by their identifiers', () => {
    expect(compareVersions('3.0.0-preview.2', '3.0.0-preview.1')).toBe(1);
    expect(compareVersions('3.0.0-preview.10', '3.0.0-preview.9')).toBe(1);
    expect(compareVersions('3.0.0-preview.1', '3.0.0-preview')).toBe(1);
    expect(compareVersions('3.0.0-rc.1', '3.0.0-preview')).toBe(1);
    expect(compareVersions('3.0.0-1', '3.0.0-alpha')).toBe(-1);
  });

  it('compares the release numbers first and ignores build labels', () => {
    expect(compareVersions('v3.0.0-preview', 'v2.0.0_R7K4S')).toBe(1);
    expect(compareVersions('v2.0.0_R7K4S', '2.0.0')).toBe(0);
    expect(compareVersions('3.0.1', '3.0.0')).toBe(1);
    expect(compareVersions('3.1.0', '3.0.9')).toBe(1);
    expect(compareVersions('2.9.0', '3.0.0-preview')).toBe(-1);
  });

  it('treats something that is not a version as 0.0.0', () => {
    expect(compareVersions('latest', '0.0.0')).toBe(0);
    expect(compareVersions('latest', '3.0.0')).toBe(-1);
  });
});
