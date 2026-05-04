const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const os = require('os');

const PROFILES_PLAIN_PATH = path.join(os.tmpdir(), 'profiles.json');
const PROFILES_ENC_PATH = path.join(os.tmpdir(), 'profiles.enc');

const ITERATIONS = 100;
const payload = { test: 'payload'.repeat(1000) };
const masterPassword = 'testpassword';

// Sync Version
function saveProfilesSync(usePassword) {
  const tmpPath = path.join(os.tmpdir(), 'profiles.tmp');

  if (!usePassword) {
     fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
     fs.renameSync(tmpPath, PROFILES_PLAIN_PATH); // Atomic write
     if (fs.existsSync(PROFILES_ENC_PATH)) fs.unlinkSync(PROFILES_ENC_PATH);
     return true;
  }

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(masterPassword, salt, 100000, 32, 'sha256');

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  const output = Buffer.concat([salt, iv, authTag, encrypted]);
  fs.writeFileSync(tmpPath, output);
  fs.renameSync(tmpPath, PROFILES_ENC_PATH); // Atomic write
  if (fs.existsSync(PROFILES_PLAIN_PATH)) fs.unlinkSync(PROFILES_PLAIN_PATH);
  return true;
}

// Async Version - Need to not parallelize the same temp file
async function saveProfilesAsync(usePassword) {
  const tmpPath = path.join(os.tmpdir(), `profiles_${Math.random()}.tmp`);

  if (!usePassword) {
     await fs.promises.writeFile(tmpPath, JSON.stringify(payload, null, 2));
     await fs.promises.rename(tmpPath, PROFILES_PLAIN_PATH); // Atomic write
     try {
       await fs.promises.unlink(PROFILES_ENC_PATH);
     } catch (e) {}
     return true;
  }

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await new Promise((resolve, reject) => {
    crypto.pbkdf2(masterPassword, salt, 100000, 32, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  const output = Buffer.concat([salt, iv, authTag, encrypted]);
  await fs.promises.writeFile(tmpPath, output);
  await fs.promises.rename(tmpPath, PROFILES_ENC_PATH); // Atomic write
  try {
    await fs.promises.unlink(PROFILES_PLAIN_PATH);
  } catch (e) {}
  return true;
}

async function runBenchmark() {
  console.log('Running Sync Benchmark (Plain)...');
  let start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    saveProfilesSync(false);
  }
  let end = performance.now();
  console.log(`Sync (Plain): ${(end - start).toFixed(2)} ms`);

  console.log('Running Sync Benchmark (Encrypted)...');
  start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    saveProfilesSync(true);
  }
  end = performance.now();
  console.log(`Sync (Encrypted): ${(end - start).toFixed(2)} ms`);

  console.log('Running Async Benchmark (Plain)...');
  start = performance.now();
  let promises = [];
  for (let i = 0; i < ITERATIONS; i++) {
    promises.push(saveProfilesAsync(false));
  }
  await Promise.all(promises);
  end = performance.now();
  console.log(`Async (Plain): ${(end - start).toFixed(2)} ms`);

  console.log('Running Async Benchmark (Encrypted)...');
  start = performance.now();
  promises = [];
  for (let i = 0; i < ITERATIONS; i++) {
    promises.push(saveProfilesAsync(true));
  }
  await Promise.all(promises);
  end = performance.now();
  console.log(`Async (Encrypted): ${(end - start).toFixed(2)} ms`);
}

runBenchmark();
