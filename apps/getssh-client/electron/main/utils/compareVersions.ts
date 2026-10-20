/**
 * Orders two release versions by semver precedence: 1 when `a` is newer, -1 when older, 0 when
 * equal. A leading "v" and a build label after "_" (v2.0.0_R7K4S) are ignored. A pre-release
 * comes before its release, so 3.0.0-preview < 3.0.0; without that, a preview would never be
 * told about the release that follows it. Anything that is not x.y.z counts as 0.0.0.
 */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1;
  }
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumber = /^\d+$/.test(x);
    const yNumber = /^\d+$/.test(y);
    if (xNumber && yNumber) return Number(x) > Number(y) ? 1 : -1;
    if (xNumber !== yNumber) return xNumber ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function parse(version: string): { core: number[]; pre: string[] } {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!match) return { core: [0, 0, 0], pre: [] };
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] };
}
