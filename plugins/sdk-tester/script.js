const TESTS = [
  {
    id: 'api:getLocale',
    name: 'window.GETSSH.getLocale()',
    desc: 'Retrieves current host app language',
    fn: async () => {
      if (typeof window.GETSSH.getLocale !== 'function') throw new Error('API missing: getLocale');
      const locale = window.GETSSH.getLocale();
      if (!locale) throw new Error('Locale returned empty');
      return locale;
    }
  },
  {
    id: 'api:showNotification',
    name: 'window.GETSSH.showNotification()',
    desc: 'Triggers a native OS desktop notification',
    fn: async () => {
      if (typeof window.GETSSH.showNotification !== 'function') throw new Error('API missing: showNotification');
      window.GETSSH.showNotification('SDK Test', 'If you see this, notifications are working!');
      return 'Notification requested';
    }
  },
  {
    id: 'api:registerSidebarAction',
    name: 'window.GETSSH.registerSidebarAction()',
    desc: 'Injects a custom icon into the GETSSH sidebar',
    fn: async () => {
      if (typeof window.GETSSH.registerSidebarAction !== 'function') throw new Error('API missing: registerSidebarAction');
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>';
      window.GETSSH.registerSidebarAction('test-btn', svg, 'SDK Test Button');
      return 'Sidebar action registered';
    }
  },
  {
    id: 'api:onThemeChange',
    name: 'window.GETSSH.onThemeChange()',
    desc: 'Subscribes to app theme changes',
    fn: async () => {
      if (typeof window.GETSSH.onThemeChange !== 'function') throw new Error('API missing: onThemeChange');
      let registered = false;
      window.GETSSH.onThemeChange((theme) => {
        console.log('Theme changed to:', theme);
      });
      return 'Theme listener attached';
    }
  },
  {
    id: 'rpc:ping',
    name: 'invokeBackend("ping")',
    desc: 'Tests basic IPC connectivity and backend response',
    fn: async () => {
      const res = await window.GETSSH.invokeBackend('ping');
      if (res !== 'pong') throw new Error('Expected "pong", got: ' + res);
      return res;
    }
  },
  {
    id: 'rpc:plugin:storage:set',
    name: 'invokeBackend("plugin:storage:set")',
    desc: 'Tests the capability to persist data in the Secure Vault',
    fn: async () => {
      const payload = { test_key: 'test_value_' + Date.now() };
      const res = await window.GETSSH.invokeBackend('plugin:storage:set', payload);
      if (!res.success) throw new Error('Storage set failed');
      return JSON.stringify(payload);
    }
  },
  {
    id: 'rpc:plugin:storage:get',
    name: 'invokeBackend("plugin:storage:get")',
    desc: 'Tests the capability to retrieve data from the Secure Vault',
    fn: async () => {
      const res = await window.GETSSH.invokeBackend('plugin:storage:get');
      if (!res || !res.test_key) throw new Error('Storage get failed or key missing');
      return 'Retrieved: ' + res.test_key;
    }
  },
  {
    id: 'rpc:window:info',
    name: 'invokeBackend("window:info")',
    desc: 'Retrieves current window dimensions',
    fn: async () => {
      const res = await window.GETSSH.invokeBackend('window:info');
      if (!res.width || !res.height) throw new Error('Invalid window info: ' + JSON.stringify(res));
      return `Width: ${res.width}, Height: ${res.height}`;
    }
  },
  {
    id: 'rpc:sysmon:poll',
    name: 'invokeBackend("sysmon:poll")',
    desc: 'Triggers a system monitor snapshot (sysmon:data)',
    fn: async () => {
      await window.GETSSH.invokeBackend('sysmon:poll');
      return 'Poll triggered';
    }
  }
];

const listEl = document.getElementById('test-list');
const runBtn = document.getElementById('run-btn');

function renderTests() {
  listEl.innerHTML = '';
  TESTS.forEach(test => {
    const li = document.createElement('li');
    li.className = 'test-item pending';
    li.id = `test-${test.id}`;
    
    li.innerHTML = `
      <div class="status-icon"></div>
      <div class="test-content">
        <h3 class="test-name">
          ${test.name}
        </h3>
        <p class="test-desc">${test.desc}</p>
        <pre class="test-output" id="out-${test.id}"></pre>
      </div>
    `;
    listEl.appendChild(li);
  });
}

async function runAllTests() {
  if (runBtn.disabled) return;
  runBtn.disabled = true;
  runBtn.innerText = 'Running...';
  
  // Reset all
  TESTS.forEach(test => {
    const el = document.getElementById(`test-${test.id}`);
    el.className = 'test-item pending';
    document.getElementById(`out-${test.id}`).innerText = '';
  });

  for (const test of TESTS) {
    const el = document.getElementById(`test-${test.id}`);
    const out = document.getElementById(`out-${test.id}`);
    el.className = 'test-item running';
    
    try {
      const start = performance.now();
      const result = await test.fn();
      const time = Math.round(performance.now() - start);
      
      el.className = 'test-item passed';
      out.innerText = `[${time}ms] OK: ${result}`;
    } catch (err) {
      el.className = 'test-item failed';
      out.innerText = `ERROR: ${err.message || err}`;
    }
  }
  
  runBtn.disabled = false;
  runBtn.innerText = 'Run Diagnostics Again';
}

// Initial render
renderTests();

// Also test the incoming backend events
window.GETSSH.onBackendMessage((data) => {
  if (data.type === 'sysmon:data') {
    const el = document.getElementById('test-rpc:sysmon:poll');
    if (el && el.classList.contains('passed')) {
      const out = document.getElementById('out-rpc:sysmon:poll');
      out.innerText += '\\n[Event Received] sysmon:data - CPU load: ' + 
        (data.payload && data.payload.cpus ? 'OK' : 'Invalid');
    }
  }
});
