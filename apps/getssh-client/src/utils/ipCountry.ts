type IpAddress = { family: 4; value: number } | { family: 6; value: bigint };

interface CountryRanges {
  starts: Uint32Array | bigint[];
  codes: Uint8Array;
}

interface CountryDatabase {
  countries: (string | null)[];
  ranges: Record<4 | 6, CountryRanges>;
}

const nonPublicIpv4: ReadonlyArray<readonly [network: number, prefixLength: number]> = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
  [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
];

function parseIpv4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => value * 256 + Number(part), 0);
}

function parseIp(host: string): IpAddress | null {
  let address = host.trim().replace(/^\[([^\]]+:.*?)\]$/, '$1');
  if (!address.includes(':')) {
    const value = parseIpv4(address);
    return value === null ? null : { family: 4, value };
  }

  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    const suffix = parseIpv4(address.slice(lastColon + 1));
    if (suffix === null) return null;
    address = `${address.slice(0, lastColon + 1)}${(suffix >>> 16).toString(16)}:${(suffix & 65535).toString(16)}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing <= 0) return null;
  const parts = [...left, ...Array<string>(missing).fill('0'), ...right];
  if (parts.some(part => !/^[0-9a-f]{1,4}$/i.test(part))) return null;

  const value = parts.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
  return value >> 32n === 0xffffn ? { family: 4, value: Number(value & 0xffffffffn) } : { family: 6, value };
}

function isPublicIp(ip: IpAddress): boolean {
  if (ip.family === 4) {
    return !nonPublicIpv4.some(([network, length]) => (ip.value >>> (32 - length)) === (network >>> (32 - length)));
  }

  // IPv6 global unicast, excluding protocol assignments, documentation, and 6to4.
  return ip.value >> 125n === 1n
    && ip.value >> 105n !== 0x100080n
    && ip.value >> 96n !== 0x20010db8n
    && ip.value >> 108n !== 0x3fff0n
    && ip.value >> 112n !== 0x2002n;
}

let countryDatabase: Promise<CountryDatabase> | undefined;

async function loadDatabase(): Promise<CountryDatabase> {
  const { default: dataUrl } = await import('../assets/geoip/dbip-country-lite-2026-11.bin.gz?url&inline');
  const compressed = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), character => character.charCodeAt(0));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const view = new DataView(bytes.buffer);
  if (view.getUint32(0) !== 0x47495031) throw new Error('Invalid IP country database header');

  const countries: (string | null)[] = [null];
  const countryCount = bytes[4];
  const decoder = new TextDecoder();
  let cursor = 5;
  for (let index = 0; index < countryCount; index++) {
    countries.push(decoder.decode(bytes.subarray(cursor, cursor + 2)));
    cursor += 2;
  }

  function readRanges(family: 4 | 6): CountryRanges {
    const mode = bytes[cursor++];
    const count = view.getUint32(cursor, true);
    cursor += 4;
    if (mode > 1 || count > bytes.length - cursor) throw new Error('Invalid IP country database ranges');

    const starts = family === 4 ? new Uint32Array(count) : new Array<bigint>(count);
    let position = 0n;
    for (let index = 0; index < count; index++) {
      const shift = mode === 1 ? bytes[cursor++] - 1 : 0;
      if (shift >= 0) {
        let delta = 0n;
        for (let offset = 0n; ; offset += 7n) {
          if (offset >= 128n || cursor >= bytes.length) throw new Error('Invalid IP country database offset');
          const byte = bytes[cursor++];
          delta |= BigInt(byte & 127) << offset;
          if (byte < 128) break;
        }
        position += delta << BigInt(shift);
      }
      if (starts instanceof Uint32Array) starts[index] = Number(position);
      else starts[index] = position;
    }
    const codes = bytes.subarray(cursor, cursor + count);
    cursor += count;
    return { starts, codes };
  }

  const ranges = { 4: readRanges(4), 6: readRanges(6) };
  if (cursor !== bytes.length) throw new Error('Invalid IP country database size');
  return { countries, ranges };
}

/** Estimates a country from a public address in the profile, without resolving names or making a request. */
export async function lookupIpCountry(host: string): Promise<string | null> {
  const ip = parseIp(host);
  if (!ip || !isPublicIp(ip)) return null;

  countryDatabase ??= loadDatabase().catch(error => {
    countryDatabase = undefined;
    throw error;
  });
  const { countries, ranges } = await countryDatabase;
  const { starts, codes } = ranges[ip.family];
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= ip.value) low = middle + 1;
    else high = middle;
  }
  return countries[codes[low - 1]] ?? null;
}
