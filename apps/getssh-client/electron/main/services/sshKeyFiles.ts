import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { utils as sshUtils } from 'ssh2';

/**
 * SSH private key files for the store (stage B): what can be imported, in the form ssh2 (the
 * library that connects) reads. MAIN PROCESS ONLY.
 *
 * - ssh2 reads OpenSSH keys and PEM PKCS#1 / SEC1 keys. Those are kept as they are, with their
 *   passphrase; ssh2 checks the passphrase here exactly as it will at connect.
 * - PKCS#8 PEM (plain or encrypted) and PuTTY .ppk files (version 2 and 3) are converted with
 *   node:crypto into a format ssh2 reads, unencrypted: the store seals them, as it seals the
 *   passphrase of the others. Every converted key is checked against the public key its file
 *   states: a key whose public half differs is refused, never stored.
 * - Only Ed25519, RSA and NIST P-256 / P-384 / P-521 ECDSA keys: Electron's crypto (BoringSSL)
 *   cannot sign with DSA, so a DSA key could never log in.
 * - A passphrase is turned into a key at the cost the file names (bcrypt rounds, PBKDF2
 *   iterations, Argon2 settings), and ssh2 and node:crypto do the first two on the main thread. A
 *   hostile file could block the app for hours, so every cost is checked against a cap before
 *   any derivation: far above what ssh-keygen, OpenSSL and PuTTY write, a few seconds at most.
 *   What is checked is what is decrypted: a file must be exactly one key, as ssh2 requires.
 * - Only what Electron's crypto can decrypt is taken (PKCS#8: PBES2 with PBKDF2-HMAC-SHA1 or
 *   -SHA256 and AES-CBC or 3DES, or PKCS#12 SHA-1 3DES), so a right passphrase is never reported
 *   wrong. Argon2, which BoringSSL lacks, comes from the store (getssh-store deriveArgon2).
 *
 * The .ppk format is PuTTY's (manual, appendix C, and its source for Ed25519): the RSA and ECDSA
 * private fields are mpints, the Ed25519 one the 32 private bytes; version 3 derives the
 * AES-256-CBC key, IV and HMAC-SHA-256 key with Argon2, version 2 with SHA-1 and an HMAC-SHA-1,
 * both over the algorithm, encryption, comment (its bytes as written), public blob and padded
 * private blob.
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

/** Argon2 as getssh-store's deriveArgon2 offers it. */
export type Argon2 = (algorithm: 'argon2id' | 'argon2i' | 'argon2d', password: Buffer, salt: Buffer, memoryKib: number, passes: number, parallelism: number, length: number) => Promise<Buffer>;

const nodeArgon2 = promisify(crypto.argon2);
/** node:crypto's, for tests on plain Node. Electron's node:crypto has none: the app passes the store's. */
const defaultArgon2: Argon2 = (algorithm, password, salt, memory, passes, parallelism, length) =>
  nodeArgon2(algorithm, { message: password, nonce: salt, memory, passes, parallelism, tagLength: length });

export interface KeyFileOptions {
  argon2?: Argon2;
}

const KEY_TYPES = new Set(['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521']);

/** The base64 body of a file that is exactly one PEM block with `label`, decoded; null otherwise. */
function singlePem(source: string, label: string): Buffer | null {
  const match = new RegExp(`^-----BEGIN ${label}-----\\r?\\n([A-Za-z0-9+/=\\r\\n]+)-----END ${label}-----$`).exec(source.trim());
  return match ? Buffer.from(match[1].replace(/\s+/g, ''), 'base64') : null;
}

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
  if (!KEY_TYPES.has(key.type)) problem('unsupported_key', `${key.type} keys cannot be used: GETSSH takes Ed25519, RSA and ECDSA keys`);
  return { publicKey: Buffer.from(key.getPublicSSH()), comment: key.comment || '' };
}

const NO_PASSPHRASE = /no passphrase given/i;
/** ssh2's words for a passphrase that does not open the key; any other failure is not about it. */
const BAD_PASSPHRASE = /bad passphrase/i;

// ssh-keygen writes 16 bcrypt rounds (-a sets more; guides suggest 100). ssh2's bcrypt runs in
// JavaScript on the main thread at about 8 ms a round, so 256 rounds is about 2 seconds.
const MAX_BCRYPT_ROUNDS = 256;

/** The bcrypt rounds of an encrypted "openssh-key-v1" key, or null for another kind of file. */
function openSshBcryptRounds(source: string): number | null {
  // The block ssh2 reads: the whole file, trimmed (keyParser.js anchors its pattern the same way).
  const body = /^-----BEGIN OPENSSH PRIVATE KEY-----(?:\r\n|\n)([\s\S]+)(?:\r\n|\n)-----END OPENSSH PRIVATE KEY-----$/.exec(source.trim())?.[1];
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
// hmacWithSHA1 (the default when absent) and hmacWithSHA256: what BoringSSL takes.
const PBKDF2_PRFS = new Set(['2a864886f70d0207', '2a864886f70d0209']);
// AES-128/192/256-CBC and DES-EDE3-CBC.
const PBES2_CIPHERS = new Set(['608648016503040102', '608648016503040116', '60864801650304012a', '2a864886f70d0307']);
// pbeWithSHAAnd3-KeyTripleDES-CBC (PKCS#12): salt and iterations.
const OID_PKCS12_3DES = '2a864886f70d010c0103';

/**
 * Refuses an encrypted PKCS#8 key (its DER) that Electron cannot decrypt, or whose key derivation
 * costs more than the caps, before node:crypto runs it on the main thread with the passphrase.
 */
function checkPkcs8(der: Buffer): void {
  try {
    const [algorithm] = derSequence(derElement(der, 0).content);
    const [oid, params] = derSequence(algorithm.content);
    const scheme = derOid(oid.content);
    if (scheme === OID_PBES2) {
      const [kdf, cipher] = derSequence(params.content);
      const [kdfOid, kdfParams] = derSequence(kdf.content);
      if (derOid(kdfOid.content) !== OID_PBKDF2) problem('unsupported_key', 'the key uses a key derivation GETSSH cannot decrypt (only PBKDF2)');
      const fields = derSequence(kdfParams.content);
      const prf = fields.find(field => field.tag === 0x30);
      if (prf && !PBKDF2_PRFS.has(derOid(derSequence(prf.content)[0].content))) problem('unsupported_key', 'the key uses a PBKDF2 hash GETSSH cannot decrypt');
      if (!PBES2_CIPHERS.has(derOid(derSequence(cipher.content)[0].content))) problem('unsupported_key', 'the key uses a cipher GETSSH cannot decrypt');
      if (!(derInteger(fields[1].content) <= MAX_PBKDF2_ITERATIONS)) problem('unsupported_key', 'the key asks for more PBKDF2 iterations than GETSSH accepts');
      return;
    }
    if (scheme === OID_PKCS12_3DES) {
      if (!(derInteger(derSequence(params.content)[1].content) <= MAX_PBKDF2_ITERATIONS)) problem('unsupported_key', 'the key asks for more iterations than GETSSH accepts');
      return;
    }
    problem('unsupported_key', 'the key uses an encryption GETSSH cannot decrypt');
  } catch (error) {
    if (error instanceof KeyFileProblem) throw error;
    problem('unsupported_key', 'the PKCS#8 key is damaged');
  }
}

/** A file that is one PKCS#8 block: the DER checked here is the DER node:crypto decrypts. */
function readPkcs8(source: string, passphrase: string | null): PrivateKeyForStore {
  const encryptedDer = singlePem(source, 'ENCRYPTED PRIVATE KEY');
  const plainDer = encryptedDer ? null : singlePem(source, 'PRIVATE KEY');
  if (!encryptedDer && !plainDer) problem('unsupported_key', 'the file must hold exactly one PKCS#8 key');
  if (encryptedDer && !passphrase) problem('needs_password', 'this key is protected by a passphrase');
  if (encryptedDer) checkPkcs8(encryptedDer);
  let key: crypto.KeyObject;
  try {
    key = encryptedDer
      ? crypto.createPrivateKey({ key: encryptedDer, format: 'der', type: 'pkcs8', passphrase: passphrase! })
      : crypto.createPrivateKey({ key: plainDer!, format: 'der', type: 'pkcs8' });
  } catch {
    return problem(encryptedDer ? 'wrong_password' : 'unsupported_key', encryptedDer ? 'wrong passphrase for this key' : 'the PKCS#8 key is damaged');
  } finally {
    plainDer?.fill(0);
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
  /** As written, one char per byte (the file is read as latin1): the MAC covers these bytes. */
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

async function ppkKeys(file: PpkFile, passphrase: string, argon2: Argon2): Promise<{ cipherKey: Buffer; iv: Buffer; macKey: Buffer }> {
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
    let derived: Buffer;
    try {
      derived = await argon2(flavour, secret, Buffer.from(salt, 'hex'), memory, passes, parallelism, 80);
    } catch {
      return problem('unsupported_key', 'Argon2 for this PuTTY key could not run');
    }
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
    // PuTTY writes the 32 private bytes as they are (put_mp_le_fixedlen of the little-endian
    // seed), not as an mpint.
    const seed = priv.string();
    if (seed.length !== 32) problem('unsupported_key', 'the PuTTY key is damaged');
    const key = ed25519FromSeed(seed);
    if (!Buffer.from(crypto.createPublicKey(key).export({ format: 'jwk' }).x!, 'base64url').equals(point)) problem('unsupported_key', 'the PuTTY key does not match its public key');
    return key;
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

async function readPpk(file: Buffer, passphrase: string | null, argon2: Argon2): Promise<PrivateKeyForStore> {
  // latin1 keeps every byte, so the MAC is computed over the comment exactly as written.
  const ppk = parsePpk(file.toString('latin1'));
  const encrypted = ppk.encryption !== 'none';
  const comment = Buffer.from(ppk.comment, 'latin1').toString('utf8');
  let plain = ppk.privateBlob;
  let keys: { cipherKey: Buffer; macKey: Buffer } | null = null;
  try {
    if (encrypted && !passphrase) problem('needs_password', 'this key is protected by a passphrase');
    const derived = await ppkKeys(ppk, encrypted ? passphrase! : '', argon2);
    keys = derived;
    if (encrypted) {
      if (plain.length === 0 || plain.length % 16 !== 0) problem('unsupported_key', 'the PuTTY key is damaged');
      const decipher = crypto.createDecipheriv('aes-256-cbc', derived.cipherKey, derived.iv).setAutoPadding(false);
      plain = Buffer.concat([decipher.update(plain), decipher.final()]);
    }
    const macData = Buffer.concat([sshString(ppk.algorithm), sshString(ppk.encryption), sshString(Buffer.from(ppk.comment, 'latin1')), sshString(ppk.publicBlob), sshString(plain)]);
    const expected = crypto.createHmac(ppk.version === 3 ? 'sha256' : 'sha1', derived.macKey).update(macData).digest();
    if (expected.length !== ppk.mac.length || !crypto.timingSafeEqual(expected, ppk.mac)) {
      problem(encrypted ? 'wrong_password' : 'unsupported_key', encrypted ? 'wrong passphrase for this key' : 'the PuTTY key is damaged');
    }
    const data = forSsh2(ppkPrivateKey(ppk.algorithm, ppk.publicBlob, plain), comment);
    const parsed = parseWithSsh2(data);
    if (parsed instanceof Error || !parsed.publicKey.equals(ppk.publicBlob)) {
      data.fill(0);
      return problem('unsupported_key', 'the converted PuTTY key does not match its public key');
    }
    return { data, passphrase: null, publicKey: parsed.publicKey, comment };
  } finally {
    if (plain !== ppk.privateBlob) plain.fill(0);
    ppk.privateBlob.fill(0);
    keys?.cipherKey.fill(0);
    keys?.macKey.fill(0);
  }
}

// --- entry points ---

type FileKind = 'ppk' | 'pkcs8' | 'ssh2';

/** By its first line, as each reader expects the whole file to be one key. */
function kindOf(file: Buffer): FileKind {
  const head = file.toString('latin1', 0, Math.min(file.length, 256)).trimStart();
  if (head.startsWith('PuTTY-User-Key-File-')) return 'ppk';
  if (head.startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----') || head.startsWith('-----BEGIN PRIVATE KEY-----')) return 'pkcs8';
  return 'ssh2';
}

/**
 * Whether the file needs a passphrase, without one: the first look after the file dialog.
 * Throws unsupported_key for anything that cannot be imported.
 */
export function keyFileNeedsPassphrase(file: Buffer): boolean {
  const kind = kindOf(file);
  if (kind === 'ppk') {
    const ppk = parsePpk(file.toString('latin1'));
    ppk.privateBlob.fill(0);
    return ppk.encryption !== 'none';
  }
  if (kind === 'pkcs8') {
    const source = file.toString('latin1');
    if (singlePem(source, 'ENCRYPTED PRIVATE KEY')) return true;
    if (singlePem(source, 'PRIVATE KEY')?.fill(0)) return false;
    return problem('unsupported_key', 'the file must hold exactly one PKCS#8 key');
  }
  const parsed = parseWithSsh2(file);
  if (!(parsed instanceof Error)) return false;
  if (NO_PASSPHRASE.test(parsed.message)) return true;
  return problem('unsupported_key', parsed.message);
}

/** The key in the form ssh2 reads, with what the store keeps beside it. */
export async function readPrivateKey(file: Buffer, passphrase?: string | null, options: KeyFileOptions = {}): Promise<PrivateKeyForStore> {
  const given = passphrase ? passphrase : null;
  const kind = kindOf(file);
  if (kind === 'ppk') return readPpk(file, given, options.argon2 ?? defaultArgon2);
  if (kind === 'pkcs8') return readPkcs8(file.toString('latin1'), given);
  const plain = parseWithSsh2(file);
  if (!(plain instanceof Error)) return { data: Buffer.from(file), passphrase: null, publicKey: plain.publicKey, comment: plain.comment };
  if (!NO_PASSPHRASE.test(plain.message)) return problem('unsupported_key', plain.message);
  if (!given) return problem('needs_password', 'this key is protected by a passphrase');
  const rounds = openSshBcryptRounds(file.toString('latin1'));
  if (rounds !== null && rounds > MAX_BCRYPT_ROUNDS) problem('unsupported_key', `the key asks for ${rounds} bcrypt rounds; GETSSH accepts up to ${MAX_BCRYPT_ROUNDS}`);
  const opened = parseWithSsh2(file, given);
  if (opened instanceof Error) return problem(BAD_PASSPHRASE.test(opened.message) ? 'wrong_password' : 'unsupported_key', opened.message);
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
