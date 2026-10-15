import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { utils as sshUtils } from 'ssh2';

/**
 * SSH private key files for the store (stage B): what can be imported, in the form ssh2 (the
 * library that connects) reads. MAIN PROCESS ONLY.
 *
 * - ssh2 reads OpenSSH keys, PEM PKCS#1 / SEC1, and PuTTY .ppk version 2 RSA and DSA keys. Those
 *   are kept as they are, with their passphrase; ssh2 checks the passphrase here exactly as it
 *   will at connect.
 * - PKCS#8 PEM (plain or encrypted), and the other .ppk keys (version 3, PuTTY's default since
 *   0.75, and version 2 ECDSA / Ed25519 keys), are converted with node:crypto into a format ssh2
 *   reads, unencrypted: the store seals them, as it seals the passphrase of the others.
 * - Every converted key is checked against the public key its file states: a key whose public
 *   half differs is refused, never stored.
 * - A passphrase is turned into a key at the cost the file names (bcrypt rounds, PBKDF2
 *   iterations, scrypt or Argon2 settings), and ssh2 and node:crypto do the first two on the main
 *   thread. A hostile file could block the app for hours, so every cost is checked against a cap
 *   before any derivation: far above what ssh-keygen, OpenSSL and PuTTY write, a few seconds at
 *   most.
 *
 * The .ppk format is PuTTY's (manual, appendix C): every private field is an mpint; version 3
 * derives the AES-256-CBC key, IV and HMAC-SHA-256 key with Argon2, version 2 with SHA-1 and an
 * HMAC-SHA-1, both over the algorithm, encryption, comment, public blob and padded private blob.
 */

export type KeyFileError = 'needs_password' | 'wrong_password' | 'unsupported_key';

export class KeyFileProblem extends Error {
  constructor(readonly code: KeyFileError, message: string) {
    super(message);
    this.name = 'KeyFileProblem';
  }
}

export interface PrivateKeyForStore {
  /** The key as ssh2 reads it; the caller wipes it after use. */
  data: Buffer;
  /** What `data` still needs at connect, or null. */
  passphrase: string | null;
  /** The SSH public key blob (wire format): the store derives fingerprint and algorithm from it. */
  publicKey: Buffer;
  comment: string;
}

const problem = (code: KeyFileError, message: string): never => {
  throw new KeyFileProblem(code, message);
};

// --- SSH wire format ---

function sshString(value: Buffer | string): Buffer {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

class Reader {
  private at = 0;
  constructor(private readonly bytes: Buffer) {}
  rewind(): void {
    this.at = 0;
  }
  string(): Buffer {
    if (this.at + 4 > this.bytes.length) problem('unsupported_key', 'the key data ends early');
    const length = this.bytes.readUInt32BE(this.at);
    const start = this.at + 4;
    if (start + length > this.bytes.length) problem('unsupported_key', 'the key data ends early');
    this.at = start + length;
    return this.bytes.subarray(start, start + length);
  }
  text(): string {
    return this.string().toString('latin1');
  }
  /** An mpint's magnitude, big-endian, without the sign byte. Negative values are refused. */
  mpint(): Buffer {
    const raw = this.string();
    if (raw.length > 0 && raw[0] & 0x80) problem('unsupported_key', 'a negative number in the key');
    let start = 0;
    while (start < raw.length && raw[start] === 0) start++;
    return raw.subarray(start);
  }
}

const b64url = (bytes: Buffer) => bytes.toString('base64url');
const fixed = (bytes: Buffer, length: number) => {
  if (bytes.length > length) problem('unsupported_key', 'a key field is too long');
  return Buffer.concat([Buffer.alloc(length - bytes.length), bytes]);
};
const toBigInt = (bytes: Buffer) => (bytes.length === 0 ? 0n : BigInt(`0x${bytes.toString('hex')}`));
const fromBigInt = (value: bigint) => {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return Buffer.from(hex, 'hex');
};

// --- the forms ssh2 reads ---

/** An unencrypted OpenSSH ("openssh-key-v1") Ed25519 key. */
function openSshEd25519(seed: Buffer, publicKey: Buffer, comment: string): Buffer {
  const blob = Buffer.concat([sshString('ssh-ed25519'), sshString(publicKey)]);
  const check = crypto.randomBytes(4);
  const secret = Buffer.concat([check, check, sshString('ssh-ed25519'), sshString(publicKey), sshString(Buffer.concat([seed, publicKey])), sshString(comment)]);
  const padding: number[] = [];
  for (let i = 1; (secret.length + padding.length) % 8 !== 0; i++) padding.push(i);
  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'latin1'), sshString('none'), sshString('none'), sshString(Buffer.alloc(0)),
    Buffer.from([0, 0, 0, 1]), sshString(blob), sshString(Buffer.concat([secret, Buffer.from(padding)])),
  ]);
  secret.fill(0);
  const lines = body.toString('base64').match(/.{1,70}/g)!.join('\n');
  body.fill(0);
  return Buffer.from(`-----BEGIN OPENSSH PRIVATE KEY-----\n${lines}\n-----END OPENSSH PRIVATE KEY-----\n`, 'latin1');
}

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function ed25519FromSeed(seed: Buffer): crypto.KeyObject {
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  try {
    return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } finally {
    der.fill(0);
  }
}

/** A node KeyObject as ssh2 reads it: OpenSSH for Ed25519, PEM PKCS#1 for RSA, SEC1 for ECDSA. */
function forSsh2(key: crypto.KeyObject, comment: string): Buffer {
  switch (key.asymmetricKeyType) {
    case 'ed25519': {
      const jwk = key.export({ format: 'jwk' });
      const seed = Buffer.from(jwk.d!, 'base64url');
      try {
        return openSshEd25519(seed, Buffer.from(jwk.x!, 'base64url'), comment);
      } finally {
        seed.fill(0);
      }
    }
    case 'rsa':
      return Buffer.from(key.export({ format: 'pem', type: 'pkcs1' }) as string, 'latin1');
    case 'ec':
      if (!['prime256v1', 'secp384r1', 'secp521r1'].includes(key.asymmetricKeyDetails?.namedCurve ?? '')) problem('unsupported_key', 'this elliptic curve cannot be used for SSH');
      return Buffer.from(key.export({ format: 'pem', type: 'sec1' }) as string, 'latin1');
    default:
      return problem('unsupported_key', `${key.asymmetricKeyType} keys cannot be used for SSH`);
  }
}

/** ssh2's reading of a key: the public blob and comment, or the reason it fails. */
function parseWithSsh2(data: Buffer, passphrase?: string): { publicKey: Buffer; comment: string } | Error {
  const parsed = sshUtils.parseKey(data, passphrase);
  if (parsed instanceof Error) return parsed;
  const keys = Array.isArray(parsed) ? parsed : [parsed];
  if (keys.length !== 1) return new Error('the file holds more than one key');
  const [key] = keys;
  if (!key.isPrivateKey()) problem('unsupported_key', 'this is a public key; choose the private key file');
  return { publicKey: Buffer.from(key.getPublicSSH()), comment: key.comment || '' };
}

const NO_PASSPHRASE = /no passphrase given/i;

// ssh-keygen writes 16 bcrypt rounds (-a sets more; guides suggest 100). ssh2's bcrypt runs in
// JavaScript on the main thread at about 8 ms a round, so 256 rounds is about 2 seconds.
const MAX_BCRYPT_ROUNDS = 256;

/** The bcrypt rounds of an encrypted "openssh-key-v1" key, or null for another kind of file. */
function openSshBcryptRounds(source: string): number | null {
  const body = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/.exec(source)?.[1];
  if (!body) return null;
  const raw = Buffer.from(body.replace(/\s+/g, ''), 'base64');
  const magic = Buffer.from('openssh-key-v1\0', 'latin1');
  if (!raw.subarray(0, magic.length).equals(magic)) return null;
  const header = new Reader(raw.subarray(magic.length));
  header.string(); // cipher
  if (header.text() !== 'bcrypt') return null;
  // kdfoptions: string salt, uint32 rounds.
  const options = header.string();
  const salt = new Reader(options).string();
  if (options.length !== 4 + salt.length + 4) problem('unsupported_key', 'the OpenSSH key is damaged');
  return options.readUInt32BE(4 + salt.length);
}

// --- PKCS#8 ---

// OpenSSL writes 2048 PBKDF2 iterations (ssh-keygen -m PKCS8 the same); a million SHA-256
// iterations take about half a second.
const MAX_PBKDF2_ITERATIONS = 1_000_000;
// node:crypto refuses scrypt above 32 MiB of memory (128 * N * r) anyway.
const MAX_SCRYPT_MEMORY = 32 * 1024 * 1024;
const MAX_SCRYPT_PARALLELISM = 4;

/** One DER element: its tag and the bytes of its content. */
function derElement(bytes: Buffer, at: number): { tag: number; content: Buffer; next: number } {
  if (at + 2 > bytes.length) problem('unsupported_key', 'the PKCS#8 key is damaged');
  const tag = bytes[at];
  let length = bytes[at + 1];
  let start = at + 2;
  if (length & 0x80) {
    const size = length & 0x7f;
    if (size < 1 || size > 3 || start + size > bytes.length) problem('unsupported_key', 'the PKCS#8 key is damaged');
    length = 0;
    for (let i = 0; i < size; i++) length = length * 256 + bytes[start + i];
    start += size;
  }
  if (start + length > bytes.length) problem('unsupported_key', 'the PKCS#8 key is damaged');
  return { tag, content: bytes.subarray(start, start + length), next: start + length };
}

/** The elements of a DER SEQUENCE. */
function derSequence(bytes: Buffer): Array<{ tag: number; content: Buffer }> {
  const items: Array<{ tag: number; content: Buffer }> = [];
  for (let at = 0; at < bytes.length;) {
    const element = derElement(bytes, at);
    items.push(element);
    at = element.next;
  }
  return items;
}

const derOid = (content: Buffer) => content.toString('hex');
/** A DER INTEGER up to 2^48, or Infinity for anything larger (refused by the caps). */
const derInteger = (content: Buffer) => (content.length > 6 ? Infinity : content.reduce((n, byte) => n * 256 + byte, 0));

const OID_PBES2 = '2a864886f70d01050d';
const OID_PBKDF2 = '2a864886f70d01050c';
const OID_SCRYPT = '2b06010401da47040b';
// PBES1 (1.2.840.113549.1.5.x) and PKCS#12 (1.2.840.113549.1.12.1.x) schemes: salt and iterations.
const OID_PBES1 = /^2a864886f70d0105(01|03|04|06|0a|0b)$|^2a864886f70d010c01/;

/**
 * Refuses an encrypted PKCS#8 key whose key derivation costs more than the caps, before
 * node:crypto runs it on the main thread with the passphrase.
 */
function checkPkcs8Cost(source: string): void {
  try {
    checkPkcs8Parameters(source);
  } catch (error) {
    if (error instanceof KeyFileProblem) throw error;
    problem('unsupported_key', 'the PKCS#8 key is damaged');
  }
}

function checkPkcs8Parameters(source: string): void {
  const body = /-----BEGIN ENCRYPTED PRIVATE KEY-----([\s\S]*?)-----END ENCRYPTED PRIVATE KEY-----/.exec(source)?.[1];
  if (!body) problem('unsupported_key', 'the PKCS#8 key is damaged');
  const der = Buffer.from(body!.replace(/\s+/g, ''), 'base64');
  const [algorithm] = derSequence(derElement(der, 0).content);
  const [oid, params] = derSequence(algorithm.content);
  const scheme = derOid(oid.content);
  if (scheme === OID_PBES2) {
    const [kdf] = derSequence(params.content);
    const [kdfOid, kdfParams] = derSequence(kdf.content);
    const fields = derSequence(kdfParams.content);
    if (derOid(kdfOid.content) === OID_PBKDF2) {
      if (!(derInteger(fields[1].content) <= MAX_PBKDF2_ITERATIONS)) problem('unsupported_key', 'the key asks for more PBKDF2 iterations than GETSSH accepts');
      return;
    }
    if (derOid(kdfOid.content) === OID_SCRYPT) {
      const [n, r, p] = [derInteger(fields[1].content), derInteger(fields[2].content), derInteger(fields[3].content)];
      if (!(128 * n * r <= MAX_SCRYPT_MEMORY && p <= MAX_SCRYPT_PARALLELISM)) problem('unsupported_key', 'the key asks for more scrypt work than GETSSH accepts');
      return;
    }
    problem('unsupported_key', 'the key uses a key derivation GETSSH does not know');
  }
  if (OID_PBES1.test(scheme)) {
    const fields = derSequence(params.content);
    if (!(derInteger(fields[1].content) <= MAX_PBKDF2_ITERATIONS)) problem('unsupported_key', 'the key asks for more iterations than GETSSH accepts');
    return;
  }
  problem('unsupported_key', 'the key uses an encryption GETSSH does not know');
}

function readPkcs8(source: string, passphrase: string | null): PrivateKeyForStore {
  const encrypted = source.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----');
  if (encrypted && !passphrase) problem('needs_password', 'this key is protected by a passphrase');
  if (encrypted) checkPkcs8Cost(source);
  let key: crypto.KeyObject;
  try {
    key = crypto.createPrivateKey(encrypted ? { key: source, format: 'pem', passphrase: passphrase! } : { key: source, format: 'pem' });
  } catch {
    return problem(encrypted ? 'wrong_password' : 'unsupported_key', encrypted ? 'wrong passphrase for this key' : 'the PKCS#8 key is damaged');
  }
  const data = forSsh2(key, '');
  const parsed = parseWithSsh2(data);
  if (parsed instanceof Error) {
    data.fill(0);
    return problem('unsupported_key', `the converted key cannot be read (${parsed.message})`);
  }
  return { data, passphrase: null, publicKey: parsed.publicKey, comment: '' };
}

// --- PuTTY .ppk ---

const ARGON2 = { Argon2id: 'argon2id', Argon2i: 'argon2i', Argon2d: 'argon2d' } as const;
const argon2 = promisify(crypto.argon2);
// PuTTY writes 8 MiB, a pass count tuned to about 100 ms, and parallelism 1. The caps allow 256
// MiB and 8 passes over all of it (memory times passes), about 3 seconds; Argon2 runs on libuv's
// thread pool, not the main thread.
const MAX_ARGON2_MEMORY_KIB = 256 * 1024;
const MAX_ARGON2_WORK_KIB = MAX_ARGON2_MEMORY_KIB * 8;
const MAX_ARGON2_PASSES = 1000;
const MAX_ARGON2_PARALLELISM = 16;

interface PpkFile {
  version: 2 | 3;
  algorithm: string;
  encryption: 'none' | 'aes256-cbc';
  comment: string;
  publicBlob: Buffer;
  privateBlob: Buffer;
  mac: Buffer;
  headers: Map<string, string>;
}

function parsePpk(source: string): PpkFile {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const headers = new Map<string, string>();
  let publicBlob: Buffer | null = null;
  let privateBlob: Buffer | null = null;
  const first = /^PuTTY-User-Key-File-([23]): (\S+)$/.exec(lines[0] ?? '');
  if (!first) problem('unsupported_key', 'only PuTTY key files of version 2 and 3 can be imported');
  for (let i = 1; i < lines.length; i++) {
    const header = /^([A-Za-z0-9-]+): ?(.*)$/.exec(lines[i]);
    if (!header) continue;
    const [, name, value] = header;
    if (name === 'Public-Lines' || name === 'Private-Lines') {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1 || count > 1024) problem('unsupported_key', 'the PuTTY key is damaged');
      const blob = Buffer.from(lines.slice(i + 1, i + 1 + count).join(''), 'base64');
      if (name === 'Public-Lines') publicBlob = blob;
      else privateBlob = blob;
      i += count;
    } else {
      headers.set(name, value);
    }
  }
  const encryption = headers.get('Encryption');
  const mac = headers.get('Private-MAC');
  if (!publicBlob || !privateBlob || !mac || !/^[0-9a-f]+$/i.test(mac) || (encryption !== 'none' && encryption !== 'aes256-cbc')) {
    problem('unsupported_key', 'the PuTTY key is damaged');
  }
  return {
    version: Number(first![1]) as 2 | 3,
    algorithm: first![2],
    encryption: encryption as PpkFile['encryption'],
    comment: headers.get('Comment') ?? '',
    publicBlob: publicBlob!,
    privateBlob: privateBlob!,
    mac: Buffer.from(mac!, 'hex'),
    headers,
  };
}

async function ppkKeys(file: PpkFile, passphrase: string): Promise<{ cipherKey: Buffer; iv: Buffer; macKey: Buffer }> {
  const secret = Buffer.from(passphrase, 'utf8');
  try {
    if (file.version === 2) {
      const hash = (prefix: Buffer) => crypto.createHash('sha1').update(prefix).update(secret).digest();
      return {
        cipherKey: Buffer.concat([hash(Buffer.from([0, 0, 0, 0])), hash(Buffer.from([0, 0, 0, 1]))]).subarray(0, 32),
        iv: Buffer.alloc(16),
        macKey: hash(Buffer.from('putty-private-key-file-mac-key', 'latin1')),
      };
    }
    if (file.encryption === 'none') return { cipherKey: Buffer.alloc(0), iv: Buffer.alloc(0), macKey: Buffer.alloc(0) };
    const flavour = ARGON2[file.headers.get('Key-Derivation') as keyof typeof ARGON2];
    const memory = Number(file.headers.get('Argon2-Memory'));
    const passes = Number(file.headers.get('Argon2-Passes'));
    const parallelism = Number(file.headers.get('Argon2-Parallelism'));
    const salt = file.headers.get('Argon2-Salt') ?? '';
    if (!flavour || !/^([0-9a-f]{2})+$/i.test(salt)
      || !Number.isInteger(memory) || memory < 8 * parallelism || memory > MAX_ARGON2_MEMORY_KIB
      || !Number.isInteger(passes) || passes < 1 || passes > MAX_ARGON2_PASSES || memory * passes > MAX_ARGON2_WORK_KIB
      || !Number.isInteger(parallelism) || parallelism < 1 || parallelism > MAX_ARGON2_PARALLELISM) {
      problem('unsupported_key', 'the PuTTY key has key derivation settings GETSSH does not accept');
    }
    const derived = await argon2(flavour, { message: secret, nonce: Buffer.from(salt, 'hex'), memory, passes, parallelism, tagLength: 80 });
    return { cipherKey: derived.subarray(0, 32), iv: derived.subarray(32, 48), macKey: derived.subarray(48, 80) };
  } finally {
    secret.fill(0);
  }
}

/** The PuTTY private fields as a node KeyObject, checked against the file's public blob. */
function ppkPrivateKey(algorithm: string, publicBlob: Buffer, privateBlob: Buffer): crypto.KeyObject {
  const pub = new Reader(publicBlob);
  if (pub.text() !== algorithm) problem('unsupported_key', 'the PuTTY key is damaged');
  const priv = new Reader(privateBlob);
  if (algorithm === 'ssh-ed25519') {
    const point = pub.string();
    if (point.length !== 32) problem('unsupported_key', 'the PuTTY key is damaged');
    // PuTTY keeps the 32-byte private key as an integer; the byte order that yields the stated
    // public key is the right one.
    for (const reversed of [true, false]) {
      const seed = fixed(priv.mpint(), 32);
      priv.rewind();
      if (reversed) seed.reverse();
      const key = ed25519FromSeed(seed);
      seed.fill(0);
      if (Buffer.from(crypto.createPublicKey(key).export({ format: 'jwk' }).x!, 'base64url').equals(point)) return key;
    }
    return problem('unsupported_key', 'the PuTTY key does not match its public key');
  }
  if (algorithm === 'ssh-rsa') {
    const e = pub.mpint();
    const n = pub.mpint();
    const [d, p, q, iqmp] = [priv.mpint(), priv.mpint(), priv.mpint(), priv.mpint()];
    const [D, P, Q] = [toBigInt(d), toBigInt(p), toBigInt(q)];
    if (P * Q !== toBigInt(n) || P < 2n || Q < 2n) problem('unsupported_key', 'the PuTTY key does not match its public key');
    return crypto.createPrivateKey({
      format: 'jwk',
      key: { kty: 'RSA', n: b64url(n), e: b64url(e), d: b64url(d), p: b64url(p), q: b64url(q), qi: b64url(iqmp), dp: b64url(fromBigInt(D % (P - 1n))), dq: b64url(fromBigInt(D % (Q - 1n))) },
    });
  }
  const curve = { 'ecdsa-sha2-nistp256': ['nistp256', 'P-256', 'prime256v1', 32], 'ecdsa-sha2-nistp384': ['nistp384', 'P-384', 'secp384r1', 48], 'ecdsa-sha2-nistp521': ['nistp521', 'P-521', 'secp521r1', 66] }[algorithm] as [string, string, string, number] | undefined;
  if (curve) {
    const [name, crv, opensslName, size] = curve;
    if (pub.text() !== name) problem('unsupported_key', 'the PuTTY key is damaged');
    const point = pub.string();
    if (point.length !== 1 + 2 * size || point[0] !== 4) problem('unsupported_key', 'the PuTTY key is damaged');
    const d = fixed(priv.mpint(), size);
    const ecdh = crypto.createECDH(opensslName);
    ecdh.setPrivateKey(d);
    if (!ecdh.getPublicKey().equals(point)) problem('unsupported_key', 'the PuTTY key does not match its public key');
    const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv, d: b64url(d), x: b64url(point.subarray(1, 1 + size)), y: b64url(point.subarray(1 + size)) } });
    d.fill(0);
    return key;
  }
  return problem('unsupported_key', `PuTTY ${algorithm} keys cannot be imported`);
}

async function readPpk(source: string, passphrase: string | null): Promise<PrivateKeyForStore> {
  const file = parsePpk(source);
  const encrypted = file.encryption !== 'none';
  if (encrypted && !passphrase) problem('needs_password', 'this key is protected by a passphrase');
  // What ssh2 reads itself (version 2 RSA and DSA) stays as it is, with its passphrase.
  if (file.version === 2 && (file.algorithm === 'ssh-rsa' || file.algorithm === 'ssh-dss')) {
    file.privateBlob.fill(0);
    const data = Buffer.from(source, 'utf8');
    const parsed = parseWithSsh2(data, encrypted ? passphrase! : undefined);
    if (parsed instanceof Error) {
      data.fill(0);
      return problem(encrypted ? 'wrong_password' : 'unsupported_key', parsed.message);
    }
    return { data, passphrase: encrypted ? passphrase : null, publicKey: parsed.publicKey, comment: parsed.comment || file.comment };
  }
  const { cipherKey, iv, macKey } = await ppkKeys(file, encrypted ? passphrase! : '');
  let plain = file.privateBlob;
  try {
    if (encrypted) {
      if (plain.length === 0 || plain.length % 16 !== 0) problem('unsupported_key', 'the PuTTY key is damaged');
      const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv).setAutoPadding(false);
      plain = Buffer.concat([decipher.update(plain), decipher.final()]);
    }
    const macData = Buffer.concat([sshString(file.algorithm), sshString(file.encryption), sshString(file.comment), sshString(file.publicBlob), sshString(plain)]);
    const expected = crypto.createHmac(file.version === 3 ? 'sha256' : 'sha1', macKey).update(macData).digest();
    if (expected.length !== file.mac.length || !crypto.timingSafeEqual(expected, file.mac)) {
      problem(encrypted ? 'wrong_password' : 'unsupported_key', encrypted ? 'wrong passphrase for this key' : 'the PuTTY key is damaged');
    }
    const data = forSsh2(ppkPrivateKey(file.algorithm, file.publicBlob, plain), file.comment);
    const parsed = parseWithSsh2(data);
    if (parsed instanceof Error || !parsed.publicKey.equals(file.publicBlob)) {
      data.fill(0);
      return problem('unsupported_key', 'the converted PuTTY key does not match its public key');
    }
    return { data, passphrase: null, publicKey: parsed.publicKey, comment: file.comment };
  } finally {
    if (plain !== file.privateBlob) plain.fill(0);
    file.privateBlob.fill(0);
    cipherKey.fill(0);
    macKey.fill(0);
  }
}

// --- entry points ---

const PPK = /^PuTTY-User-Key-File-\d+:/;
const PKCS8 = /-----BEGIN (ENCRYPTED )?PRIVATE KEY-----/;

/**
 * Whether the file needs a passphrase, without one: the first look after the file dialog.
 * Throws unsupported_key for anything that cannot be imported.
 */
export function keyFileNeedsPassphrase(file: Buffer): boolean {
  const source = file.toString('utf8');
  if (PPK.test(source)) {
    const ppk = parsePpk(source);
    ppk.privateBlob.fill(0);
    return ppk.encryption !== 'none';
  }
  if (PKCS8.test(source)) return source.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----');
  const parsed = parseWithSsh2(file);
  if (!(parsed instanceof Error)) return false;
  if (NO_PASSPHRASE.test(parsed.message)) return true;
  return problem('unsupported_key', parsed.message);
}

/** The key in the form ssh2 reads, with what the store keeps beside it. */
export async function readPrivateKey(file: Buffer, passphrase?: string | null): Promise<PrivateKeyForStore> {
  const given = passphrase ? passphrase : null;
  const source = file.toString('utf8');
  if (PPK.test(source)) return readPpk(source, given);
  if (PKCS8.test(source)) return readPkcs8(source, given);
  const plain = parseWithSsh2(file);
  if (!(plain instanceof Error)) return { data: Buffer.from(file), passphrase: null, publicKey: plain.publicKey, comment: plain.comment };
  if (!NO_PASSPHRASE.test(plain.message)) return problem('unsupported_key', plain.message);
  if (!given) return problem('needs_password', 'this key is protected by a passphrase');
  const rounds = openSshBcryptRounds(source);
  if (rounds !== null && rounds > MAX_BCRYPT_ROUNDS) problem('unsupported_key', `the key asks for ${rounds} bcrypt rounds; GETSSH accepts up to ${MAX_BCRYPT_ROUNDS}`);
  const opened = parseWithSsh2(file, given);
  if (opened instanceof Error) return problem('wrong_password', 'wrong passphrase for this key');
  return { data: Buffer.from(file), passphrase: given, publicKey: opened.publicKey, comment: opened.comment };
}

/** A new Ed25519 key, unencrypted OpenSSH: the store seals it. */
export function generateEd25519(comment: string): PrivateKeyForStore {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const data = forSsh2(privateKey, comment);
  const parsed = parseWithSsh2(data);
  if (parsed instanceof Error) {
    data.fill(0);
    throw parsed;
  }
  return { data, passphrase: null, publicKey: parsed.publicKey, comment };
}
