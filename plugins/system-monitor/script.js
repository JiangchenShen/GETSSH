// System Monitor logic
const cpuVal = document.getElementById('cpu-val');
const cpuBar = document.getElementById('cpu-bar');
const memVal = document.getElementById('mem-val');
const memBar = document.getElementById('mem-bar');
const memTotal = document.getElementById('mem-total');
const cpuCoresContainer = document.getElementById('cpu-cores-container');

let previousCpus = [];

window.addEventListener('message', (event) => {
  const { type, payload } = event.data;
  
  if (type === 'sysmon:data') {
    updateSystemStats(payload);
  }
});

function calculateCpuUsage(cpus) {
  if (previousCpus.length === 0) {
    previousCpus = cpus;
    return { overall: 0, cores: cpus.map(() => 0) };
  }

  let totalIdle = 0, totalTick = 0;
  const coreUsages = [];

  for (let i = 0; i < cpus.length; i++) {
    const cpu = cpus[i];
    const prev = previousCpus[i] || cpu;
    
    let idle = 0, total = 0;
    let prevIdle = 0, prevTotal = 0;
    
    for (const type in cpu.times) {
      total += cpu.times[type];
      if (type === 'idle') idle = cpu.times[type];
    }
    for (const type in prev.times) {
      prevTotal += prev.times[type];
      if (type === 'idle') prevIdle = prev.times[type];
    }

    const idleDiff = idle - prevIdle;
    const totalDiff = total - prevTotal;
    const usage = totalDiff === 0 ? 0 : 100 - ~~(100 * idleDiff / totalDiff);
    
    coreUsages.push(usage);
    totalIdle += idleDiff;
    totalTick += totalDiff;
  }

  previousCpus = cpus;
  const overall = totalTick === 0 ? 0 : 100 - ~~(100 * totalIdle / totalTick);
  
  return { overall, cores: coreUsages };
}

function updateSystemStats(data) {
  const { cpus, mem, net } = data;
  
  if (cpus && cpus.overall !== undefined) {
    // New Rust Sysprobe Format
    const usageInfo = cpus;
    
    cpuVal.textContent = `${Math.round(usageInfo.overall)}%`;
    cpuBar.style.width = `${usageInfo.overall}%`;
    
    // Render cores
    if (cpuCoresContainer.children.length === 0) {
      cpuCoresContainer.innerHTML = usageInfo.cores.map((usage, i) => `
        <div class="core-box">
          <div class="core-fill" id="core-fill-${i}" style="height: ${usage}%"></div>
          <div class="core-text">C${i} <span id="core-val-${i}">${Math.round(usage)}%</span></div>
        </div>
      `).join('');
    } else {
      usageInfo.cores.forEach((usage, i) => {
        const fill = document.getElementById(`core-fill-${i}`);
        const val = document.getElementById(`core-val-${i}`);
        if (fill && val) {
          fill.style.height = `${usage}%`;
          val.textContent = `${Math.round(usage)}%`;
        }
      });
    }
  }

  if (mem) {
    const totalGb = (mem.total / (1024 ** 3)).toFixed(1);
    const freeGb = (mem.free / (1024 ** 3)).toFixed(1);
    const usedGb = (mem.used !== undefined ? mem.used : mem.total - mem.free) / (1024 ** 3);
    const memUsage = Math.round((usedGb / (mem.total / (1024 ** 3))) * 100);
    
    memTotal.textContent = totalGb;
    memVal.textContent = `${memUsage}%`;
    memBar.style.width = `${memUsage}%`;
  }
}

// Request initial data or notify ready
window.parent.postMessage({ type: 'plugin:ready', pluginId: 'com.getssh.sysmon' }, '*');
