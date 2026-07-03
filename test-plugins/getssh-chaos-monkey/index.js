let burstInterval;

function activate(ctx) {
  console.log('[Chaos Monkey] Activated. Preparing destructive tests...');

  // --- ACTION A: I/O Hijacking ---
  ctx.ssh.onData('global_test_session', (chunk) => {
    console.log(`[Chaos Monkey] I/O Hijack on global_test_session: ${chunk.length} bytes`);
  });

  try {
    ctx.ssh.onData(undefined, (chunk) => {
      console.log(`[Chaos Monkey] HACK SUCCESS: Listening to undefined sessionId: ${chunk.length} bytes`);
    });
  } catch (e) {
    console.log(`[Chaos Monkey] INTERCEPTED undefined listen: ${e.message}`);
  }

  try {
    ctx.ssh.onData('*', (chunk) => {
      console.log(`[Chaos Monkey] HACK SUCCESS: Listening to '*' sessionId: ${chunk.length} bytes`);
    });
  } catch (e) {
    console.log(`[Chaos Monkey] INTERCEPTED '*' listen: ${e.message}`);
  }

  // --- ACTION B: Quota Bursting ---
  console.log('[Chaos Monkey] Starting 5MB Quota Burst Attack...');
  let mbCount = 0;
  
  burstInterval = setInterval(async () => {
    try {
      // Generate a 1MB random string
      const oneMegabyte = 'A'.repeat(1024 * 1024);
      const key = `payload_${mbCount}`;
      
      console.log(`[Chaos Monkey] Attempting to write block ${mbCount + 1}...`);
      await ctx.storage.set(key, oneMegabyte);
      console.log(`[Chaos Monkey] Block ${mbCount + 1} written successfully.`);
      mbCount++;
      
      // If we reach here and mbCount > 5 without an error, the defense failed.
      if (mbCount > 6) {
         console.error('[Chaos Monkey] ALERT! Defense breached! Successfully wrote > 5MB without QuotaExceededError.');
         clearInterval(burstInterval);
      }
    } catch (e) {
      console.log(`[Chaos Monkey] INTERCEPTED: ${e.message}`);
      if (e.message && e.message.includes('QuotaExceededError')) {
        console.log('[Chaos Monkey] Defense is SOLID. Burst attack neutralized by Quota Limits.');
      } else {
        console.error('[Chaos Monkey] Unexpected error during burst:', e);
      }
      clearInterval(burstInterval);
    }
  }, 1000); // Try writing 1MB every second
  
  // Simulate an SSH write to test SecureCenter audit
  setTimeout(() => {
    try {
      console.log('[Chaos Monkey] Attempting I/O Hijack (rm -rf /*) on dummy session...');
      ctx.ssh.write('dummy-session-123', 'rm -rf /*');
    } catch (e) {
      console.log(`[Chaos Monkey] INTERCEPTED SSH INJECTION: ${e.message}`);
    }
  }, 3000);
}

function deactivate() {
  console.log('[Chaos Monkey] Deactivated. Cleaning up timers.');
  if (burstInterval) clearInterval(burstInterval);
}

module.exports = {
  activate,
  deactivate
};
