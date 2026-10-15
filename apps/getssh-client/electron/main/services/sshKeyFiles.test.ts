import crypto from 'node:crypto';
import { utils as sshUtils } from 'ssh2';
import { describe, expect, it } from 'vitest';
import { generateEd25519, keyFileNeedsPassphrase, KeyFileProblem, readPrivateKey } from './sshKeyFiles';

// Key files as the tools that write them do: OpenSSH files from ssh2's generator, PEM files from
// node:crypto, and .ppk files built here by the layout of PuTTY's manual (appendix C). The .ppk
// reader was also checked against files PuTTY itself wrote (v2 and v3, plain and encrypted,
// Ed25519, RSA and the three ECDSA curves); those files are not ours to commit.

const PASS = 'correct horse battery staple';

const publicOf = (data: Buffer, passphrase?: string) => {
  const parsed = sshUtils.parseKey(data, passphrase);
  if (parsed instanceof Error) throw parsed;
  return (Array.isArray(parsed) ? parsed[0] : parsed).getPublicSSH();
};

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof KeyFileProblem) return error.code;
    throw error;
  }
  return 'ok';
}

// --- .ppk files, written the way PuTTY writes them ---

const sshString = (value: Buffer | string) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
};
const mpint = (magnitude: Buffer) => {
  let start = 0;
  while (start < magnitude.length - 1 && magnitude[start] === 0) start++;
  const value = magnitude.subarray(start);
  return sshString(value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value);
};
const b64 = (value: string) => Buffer.from(value, 'base64url');
const lines = (blob: Buffer) => blob.toString('base64').match(/.{1,64}/g)!;

/** The public and private blobs PuTTY writes for a key. */
function ppkBlobs(key: crypto.KeyObject): { algorithm: string; publicBlob: Buffer; privateBlob: Buffer } {
  const jwk = key.export({ format: 'jwk' });
  if (jwk.kty === 'OKP') {
    // PuTTY keeps the 32 private bytes as a little-endian integer.
    return { algorithm: 'ssh-ed25519', publicBlob: Buffer.concat([sshString('ssh-ed25519'), sshString(b64(jwk.x!))]), privateBlob: mpint(Buffer.from(b64(jwk.d!)).reverse()) };
  }
  if (jwk.kty === 'RSA') {
    return {
      algorithm: 'ssh-rsa',
      publicBlob: Buffer.concat([sshString('ssh-rsa'), mpint(b64(jwk.e!)), mpint(b64(jwk.n!))]),
      privateBlob: Buffer.concat([mpint(b64(jwk.d!)), mpint(b64(jwk.p!)), mpint(b64(jwk.q!)), mpint(b64(jwk.qi!))]),
    };
  }
  const curve = { 'P-256': 'nistp256', 'P-384': 'nistp384', 'P-521': 'nistp521' }[jwk.crv!]!;
  const point = Buffer.concat([Buffer.from([4]), b64(jwk.x!), b64(jwk.y!)]);
  return { algorithm: `ecdsa-sha2-${curve}`, publicBlob: Buffer.concat([sshString(`ecdsa-sha2-${curve}`), sshString(curve), sshString(point)]), privateBlob: mpint(b64(jwk.d!)) };
}

function ppk(version: 2 | 3, key: crypto.KeyObject, options: { passphrase?: string; comment?: string; argon2?: Record<string, string>; privateBlob?: Buffer } = {}): Buffer {
  const blobs = ppkBlobs(key);
  const comment = options.comment ?? 'ppk-test';
  const encryption = options.passphrase ? 'aes256-cbc' : 'none';
  let plain = options.privateBlob ?? blobs.privateBlob;
  if (options.passphrase) plain = Buffer.concat([plain, crypto.randomBytes((16 - (plain.length % 16)) % 16)]);
  let cipherKey = Buffer.alloc(0);
  let iv = Buffer.alloc(0);
  let macKey = Buffer.alloc(0);
  const argon2 = { 'Key-Derivation': 'Argon2id', 'Argon2-Memory': '8192', 'Argon2-Passes': '1', 'Argon2-Parallelism': '1', 'Argon2-Salt': crypto.randomBytes(16).toString('hex'), ...options.argon2 };
  const pass = Buffer.from(options.passphrase ?? '', 'utf8');
  if (version === 2) {
    const sha1 = (...parts: Buffer[]) => crypto.createHash('sha1').update(Buffer.concat(parts)).digest();
    cipherKey = Buffer.concat([sha1(Buffer.from([0, 0, 0, 0]), pass), sha1(Buffer.from([0, 0, 0, 1]), pass)]).subarray(0, 32);
    iv = Buffer.alloc(16);
    macKey = sha1(Buffer.from('putty-private-key-file-mac-key'), pass);
  } else if (options.passphrase && options.argon2) {
    // Settings the reader refuses before deriving anything: no need to run them here.
    [cipherKey, iv, macKey] = [Buffer.alloc(32), Buffer.alloc(16), Buffer.alloc(32)];
  } else if (options.passphrase) {
    const flavour = argon2['Key-Derivation'].toLowerCase() as 'argon2id';
    const derived = crypto.argon2Sync(flavour, {
      message: pass, nonce: Buffer.from(argon2['Argon2-Salt'], 'hex'),
      memory: Number(argon2['Argon2-Memory']), passes: Number(argon2['Argon2-Passes']), parallelism: Number(argon2['Argon2-Parallelism']), tagLength: 80,
    });
    [cipherKey, iv, macKey] = [derived.subarray(0, 32), derived.subarray(32, 48), derived.subarray(48, 80)];
  }
  const mac = crypto.createHmac(version === 3 ? 'sha256' : 'sha1', macKey)
    .update(Buffer.concat([sshString(blobs.algorithm), sshString(encryption), sshString(comment), sshString(blobs.publicBlob), sshString(plain)])).digest('hex');
  const stored = options.passphrase ? Buffer.concat([crypto.createCipheriv('aes-256-cbc', cipherKey, iv).setAutoPadding(false).update(plain)]) : plain;
  const text = [
    `PuTTY-User-Key-File-${version}: ${blobs.algorithm}`, `Encryption: ${encryption}`, `Comment: ${comment}`,
    `Public-Lines: ${lines(blobs.publicBlob).length}`, ...lines(blobs.publicBlob),
    ...(version === 3 && options.passphrase ? Object.entries(argon2).map(([name, value]) => `${name}: ${value}`) : []),
    `Private-Lines: ${lines(stored).length}`, ...lines(stored), `Private-MAC: ${mac}`, '',
  ];
  return Buffer.from(text.join('\r\n'));
}

const KEYS = {
  ed25519: () => crypto.generateKeyPairSync('ed25519').privateKey,
  rsa: () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey,
  'ecdsa-p256': () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey,
  'ecdsa-p521': () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-521' }).privateKey,
};

describe('key files ssh2 reads itself', () => {
  it('keeps an encrypted OpenSSH key as it is, with its passphrase', async () => {
    for (const type of ['ed25519', 'ecdsa', 'rsa'] as const) {
      const pair = sshUtils.generateKeyPairSync(type, { bits: type === 'rsa' ? 2048 : type === 'ecdsa' ? 384 : undefined, passphrase: PASS, cipher: 'aes256-ctr', rounds: 4, comment: `fixture-${type}` });
      const file = Buffer.from(pair.private);
      expect(keyFileNeedsPassphrase(file), type).toBe(true);
      expect(await code(readPrivateKey(file)), type).toBe('needs_password');
      expect(await code(readPrivateKey(file, 'wrong')), type).toBe('wrong_password');
      const key = await readPrivateKey(file, PASS);
      expect(key.data.equals(file), type).toBe(true);
      expect(key.passphrase).toBe(PASS);
      expect(key.comment).toBe(`fixture-${type}`);
      expect(key.publicKey.toString('base64')).toBe(pair.public.split(' ')[1]);
    }
  });

  it('keeps PEM PKCS#1 and SEC1 keys as they are; a passphrase given for a plain key is not kept', async () => {
    const rsa = KEYS.rsa();
    const encrypted = Buffer.from(rsa.export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: PASS }) as string);
    expect(keyFileNeedsPassphrase(encrypted)).toBe(true);
    expect(await code(readPrivateKey(encrypted, 'wrong'))).toBe('wrong_password');
    expect((await readPrivateKey(encrypted, PASS)).passphrase).toBe(PASS);
    const ec = Buffer.from(KEYS['ecdsa-p256']().export({ type: 'sec1', format: 'pem' }) as string);
    expect(keyFileNeedsPassphrase(ec)).toBe(false);
    const plain = await readPrivateKey(ec, 'not needed');
    expect(plain.passphrase).toBeNull();
    expect(plain.data.equals(ec)).toBe(true);
  });
});

describe('key files converted for ssh2', () => {
  it('converts PKCS#8 keys, plain and encrypted, keeping the public key', async () => {
    for (const [name, make] of Object.entries(KEYS)) {
      const key = make();
      // The SSH public key blob is the same in every file format.
      const expected = ppkBlobs(key).publicBlob;
      for (const passphrase of [undefined, PASS]) {
        const file = Buffer.from(key.export({ type: 'pkcs8', format: 'pem', ...(passphrase ? { cipher: 'aes-256-cbc', passphrase } : {}) }) as string);
        expect(keyFileNeedsPassphrase(file), name).toBe(!!passphrase);
        if (passphrase) {
          expect(await code(readPrivateKey(file)), name).toBe('needs_password');
          expect(await code(readPrivateKey(file, 'wrong')), name).toBe('wrong_password');
        }
        const converted = await readPrivateKey(file, passphrase);
        expect(converted.passphrase, name).toBeNull();
        expect(converted.publicKey.equals(expected), name).toBe(true);
        expect(publicOf(converted.data).equals(expected), `${name}: ssh2 reads the converted key`).toBe(true);
      }
    }
  });

  it('converts .ppk version 3 and 2 keys (Ed25519, RSA, ECDSA), plain and encrypted', async () => {
    for (const [name, make] of Object.entries(KEYS)) {
      const key = make();
      const expected = ppkBlobs(key).publicBlob;
      for (const version of [3, 2] as const) {
        for (const passphrase of [undefined, PASS]) {
          const label = `${name} v${version}${passphrase ? ' encrypted' : ''}`;
          const file = ppk(version, key, { passphrase, comment: 'from PuTTY' });
          expect(keyFileNeedsPassphrase(file), label).toBe(!!passphrase);
          if (passphrase) {
            expect(await code(readPrivateKey(file)), label).toBe('needs_password');
            expect(await code(readPrivateKey(file, 'wrong')), label).toBe('wrong_password');
          }
          const converted = await readPrivateKey(file, passphrase);
          expect(converted.publicKey.equals(expected), label).toBe(true);
          expect(publicOf(converted.data, converted.passphrase ?? undefined).equals(expected), `${label}: ssh2 reads it`).toBe(true);
          expect(converted.comment, label).toBe('from PuTTY');
          // ssh2 reads version 2 RSA files itself: those stay as they are, with their passphrase.
          const native = version === 2 && name === 'rsa';
          expect(converted.data.equals(file), label).toBe(native);
          expect(converted.passphrase, label).toBe(native && passphrase ? passphrase : null);
        }
      }
    }
  });

  it('refuses a .ppk whose private key is not its public key, a damaged MAC, and hostile Argon2 settings', async () => {
    const key = KEYS.ed25519();
    const other = ppkBlobs(KEYS.ed25519()).privateBlob;
    expect(await code(readPrivateKey(ppk(3, key, { privateBlob: other })))).toBe('unsupported_key');
    const damaged = Buffer.from(ppk(3, key).toString().replace(/Private-MAC: (.)/, (_, c) => `Private-MAC: ${c === '0' ? '1' : '0'}`));
    expect(await code(readPrivateKey(damaged))).toBe('unsupported_key');
    for (const argon2 of [
      { 'Argon2-Memory': String(4 * 1024 * 1024) }, { 'Argon2-Passes': '100000' }, { 'Argon2-Parallelism': '64' }, { 'Key-Derivation': 'scrypt' },
      // Each within its own cap, but 256 MiB times 9 passes is over the work budget.
      { 'Argon2-Memory': String(256 * 1024), 'Argon2-Passes': '9' },
    ] as Record<string, string>[]) {
      expect(await code(readPrivateKey(ppk(3, key, { passphrase: PASS, argon2 }), PASS)), JSON.stringify(argon2)).toBe('unsupported_key');
    }
  });
});

/** DER, for building encrypted PKCS#8 files with the iteration count a test needs. */
const der = (tag: number, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const length = body.length < 128 ? Buffer.from([body.length]) : body.length < 256 ? Buffer.from([0x81, body.length]) : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const derInt = (value: number) => {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const bytes = Buffer.from(hex, 'hex');
  return der(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
};
const oid = (hex: string) => der(0x06, Buffer.from(hex, 'hex'));

/** PBES2 (PBKDF2-HMAC-SHA256, AES-256-CBC) as OpenSSL writes it, with `iterations`. */
function encryptedPkcs8(key: crypto.KeyObject, passphrase: string, iterations: number): Buffer {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const plain = key.export({ type: 'pkcs8', format: 'der' });
  const derived = iterations <= 100_000 ? crypto.pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256') : Buffer.alloc(32);
  const cipher = crypto.createCipheriv('aes-256-cbc', derived, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const algorithm = der(0x30, oid('2a864886f70d01050d'), der(0x30,
    der(0x30, oid('2a864886f70d01050c'), der(0x30, der(0x04, salt), derInt(iterations), der(0x30, oid('2a864886f70d0209'), Buffer.from([5, 0])))),
    der(0x30, oid('60864801650304012a'), der(0x04, iv))));
  const body = der(0x30, algorithm, der(0x04, encrypted));
  return Buffer.from(`-----BEGIN ENCRYPTED PRIVATE KEY-----\n${body.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END ENCRYPTED PRIVATE KEY-----\n`);
}

describe('key derivation costs', () => {
  it('reads PBKDF2 settings as node:crypto does, and refuses iteration counts above the cap before deriving', async () => {
    const key = KEYS.ed25519();
    const fine = encryptedPkcs8(key, PASS, 4096);
    expect((await readPrivateKey(fine, PASS)).publicKey.equals(ppkBlobs(key).publicBlob)).toBe(true);
    expect(await code(readPrivateKey(fine, 'wrong'))).toBe('wrong_password');
    const started = Date.now();
    expect(await code(readPrivateKey(encryptedPkcs8(key, PASS, 5_000_000), PASS))).toBe('unsupported_key');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await code(readPrivateKey(Buffer.from('-----BEGIN ENCRYPTED PRIVATE KEY-----\nMAA=\n-----END ENCRYPTED PRIVATE KEY-----\n'), PASS))).toBe('unsupported_key');
  });

  it('refuses an OpenSSH key with more bcrypt rounds than the cap, before ssh2 runs them', async () => {
    const pair = sshUtils.generateKeyPairSync('ed25519', { passphrase: PASS, cipher: 'aes256-ctr', rounds: 4 });
    const body = /-----BEGIN OPENSSH PRIVATE KEY-----\n([\s\S]+?)\n-----END/.exec(pair.private)![1].replace(/\n/g, '');
    const raw = Buffer.from(body, 'base64');
    // magic, cipher, kdfname, kdfoptions = string salt + uint32 rounds
    let at = 15;
    for (let i = 0; i < 2; i++) at += 4 + raw.readUInt32BE(at);
    const saltLength = raw.readUInt32BE(at + 4);
    raw.writeUInt32BE(0xffffffff, at + 8 + saltLength);
    const hostile = Buffer.from(`-----BEGIN OPENSSH PRIVATE KEY-----\n${raw.toString('base64').match(/.{1,70}/g)!.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`);
    expect(keyFileNeedsPassphrase(hostile)).toBe(true);
    const started = Date.now();
    expect(await code(readPrivateKey(hostile, 'any passphrase'))).toBe('unsupported_key');
    expect(Date.now() - started).toBeLessThan(1000);
    expect((await readPrivateKey(Buffer.from(pair.private), PASS)).passphrase).toBe(PASS);
  });
});

describe('what cannot be imported', () => {
  it('refuses public keys, other files and key types ssh2 cannot use', async () => {
    const pair = sshUtils.generateKeyPairSync('ed25519');
    const ed448 = Buffer.from([
      'PuTTY-User-Key-File-3: ssh-ed448', 'Encryption: none', 'Comment: x', 'Public-Lines: 1', sshString('ssh-ed448').toString('base64'),
      'Private-Lines: 1', 'AAAA', `Private-MAC: ${'0'.repeat(64)}`, '',
    ].join('\n'));
    for (const file of [Buffer.from(pair.public), Buffer.from('hello'), Buffer.from('PuTTY-User-Key-File-1: ssh-rsa\n'), ed448]) {
      let problem = '';
      try {
        keyFileNeedsPassphrase(file);
        problem = await code(readPrivateKey(file));
      } catch (error) {
        problem = (error as KeyFileProblem).code;
      }
      expect(problem, file.toString().slice(0, 30)).toBe('unsupported_key');
    }
  });
});

describe('generateEd25519', () => {
  it('makes an unencrypted OpenSSH key ssh2 reads, with the name as comment', () => {
    const made = generateEd25519('laptop');
    expect(made.data.toString()).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
    expect(made.passphrase).toBeNull();
    expect(publicOf(made.data).equals(made.publicKey)).toBe(true);
    expect(made.publicKey.subarray(4, 15).toString()).toBe('ssh-ed25519');
    expect(generateEd25519('laptop').publicKey.equals(made.publicKey)).toBe(false);
  });
});
