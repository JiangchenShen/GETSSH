module.exports = {
  activate(ctx) {
    ctx.rpc.registerMethod('ping', async () => {
      return 'pong';
    });

    ctx.rpc.registerMethod('plugin:storage:set', async (payload) => {
      if (ctx.storage && ctx.storage.set) {
        await ctx.storage.set('test_key', payload.test_key);
        return { success: true };
      }
      return { success: false, error: 'ctx.storage.set not available' };
    });

    ctx.rpc.registerMethod('plugin:storage:get', async () => {
      if (ctx.storage && ctx.storage.get) {
        const val = await ctx.storage.get('test_key');
        return { test_key: val };
      }
      return { error: 'ctx.storage.get not available' };
    });

    ctx.rpc.registerMethod('window:info', async () => {
      // Simulate window info if not directly available on ctx
      return { width: 1920, height: 1080 };
    });

    ctx.rpc.registerMethod('sysmon:poll', async () => {
      // Send a fake sysmon data event to the frontend
      ctx.rpc.sendToFrontend({
        type: 'sysmon:data',
        payload: {
          cpus: { overall: 15, cores: [10, 20] },
          mem: { total: 16000000, used: 8000000, free: 8000000 },
          net: { rx: 100, tx: 200 }
        }
      });
      return { success: true };
    });
  },
  
  deactivate() {
    // Clean up resources if any
  }
};
