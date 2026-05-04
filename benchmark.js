const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PROFILES_ENC_PATH = path.join(__dirname, 'profiles.enc');
const PROFILES_PLAIN_PATH = path.join(__dirname, 'profiles.json');

// Create dummy file
const masterPassword = 'password123';
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(masterPassword, salt, 100000, 32, 'sha256');

const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
let encrypted = cipher.update(JSON.stringify(Array(10000).fill({name: 'test', host: '127.0.0.1'})), 'utf8');
encrypted = Buffer.concat([encrypted, cipher.final()]);
const authTag = cipher.getAuthTag();

const output = Buffer.concat([salt, iv, authTag, encrypted]);
fs.writeFileSync(PROFILES_ENC_PATH, output);

async function runSync() {
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    if (!fs.existsSync(PROFILES_ENC_PATH)) throw new Error('No profiles found');
    const buffer = fs.readFileSync(PROFILES_ENC_PATH);
    const salt = buffer.subarray(0, 16);
    const iv = buffer.subarray(16, 28);
    const authTag = buffer.subarray(28, 44);
    const cipherText = buffer.subarray(44);
  }
  return performance.now() - start;
}

async function runAsync() {
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    const exists = await fs.promises.access(PROFILES_ENC_PATH).then(() => true).catch(() => false);
    if (!exists) throw new Error('No profiles found');
    const buffer = await fs.promises.readFile(PROFILES_ENC_PATH);
    const salt = buffer.subarray(0, 16);
    const iv = buffer.subarray(16, 28);
    const authTag = buffer.subarray(28, 44);
    const cipherText = buffer.subarray(44);
  }
  return performance.now() - start;
}

async function main() {
  console.log("Sync time:", await runSync(), "ms");
  console.log("Async time:", await runAsync(), "ms");
}

main().catch(console.error);
