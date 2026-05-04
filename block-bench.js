const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PROFILES_ENC_PATH = path.join(__dirname, 'profiles.enc');

// Create dummy file - 200k items is around 10-20MB
const masterPassword = 'password123';
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(masterPassword, salt, 100000, 32, 'sha256');

const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
let encrypted = cipher.update(JSON.stringify(Array(200000).fill({name: 'test', host: '127.0.0.1'})), 'utf8');
encrypted = Buffer.concat([encrypted, cipher.final()]);
const authTag = cipher.getAuthTag();

const output = Buffer.concat([salt, iv, authTag, encrypted]);
fs.writeFileSync(PROFILES_ENC_PATH, output);

async function runSync() {
    let maxBlock = 0;

    // We'll read the file synchronously. This will block the event loop entirely.
    // The time taken is exactly the block time.
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
        fs.readFileSync(PROFILES_ENC_PATH);
    }
    const end = performance.now();

    return end - start;
}

function measureAsync() {
    return new Promise(resolve => {
        let maxBlock = 0;
        let last = performance.now();
        let iters = 0;

        function tick() {
            const now = performance.now();
            const diff = now - last;
            if (iters > 0 && diff > maxBlock) {
                maxBlock = diff;
            }
            last = performance.now();
            iters++;

            if (!done) {
               setImmediate(tick);
            }
        }

        let done = false;
        setImmediate(tick);

        (async () => {
            const start = performance.now();
            for (let i = 0; i < 50; i++) {
                 await fs.promises.readFile(PROFILES_ENC_PATH);
            }
            const end = performance.now();
            done = true;
            resolve({
                totalTime: end - start,
                maxBlock: maxBlock
            });
        })();
    });
}

async function main() {
  const syncTime = await runSync();
  console.log("Total Event Loop Block Time (Sync):", syncTime, "ms");

  const asyncStats = await measureAsync();
  console.log("Total Time (Async):", asyncStats.totalTime, "ms");
  console.log("Max Event Loop Block Time (Async):", asyncStats.maxBlock, "ms");
}

main().catch(console.error);
