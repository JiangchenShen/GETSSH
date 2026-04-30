const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const startStr = `{/* Main Area */}\n      <div className="flex-1 flex flex-col overflow-hidden relative">`;
const startIndex = code.indexOf(startStr);
if (startIndex === -1) throw new Error("Could not find start str");

const endStr = `      </div>\n    </div>\n  );\n}\n\nexport default App;`;
const endIndex = code.lastIndexOf(endStr);
if (endIndex === -1) throw new Error("Could not find end str");

// We extract the settings code:
const settingsMatch = code.match(/\{showSettings \? \(\s*<div className=\{`absolute inset-0 z-50[^>]+>([\s\S]*?)<\/div>\s*\)\s*:\s*(?:tabs\.length > 0|selectedSessionIndex !== null)/);
let settingsPayload = '';
if (settingsMatch) {
    settingsPayload = settingsMatch[0].split('<div className={`absolute inset-0 z-50')[1];
    settingsPayload = '<div className={`absolute inset-0 z-50' + settingsPayload;
    settingsPayload = settingsPayload.replace(/\) : (tabs\.length > 0|selectedSessionIndex !== null)$/, '').trim();
    if (settingsPayload.endsWith(') :')) settingsPayload = settingsPayload.slice(0, -3).trim();
} else {
    throw new Error("Could not extract settings block");
}

const newLayout = `
        {/* Settings Overlay */}
        <div className={\`absolute inset-0 z-50 flex shadow-2xl overflow-hidden transition-opacity duration-200 \${showSettings ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'} \${isDark ? 'bg-[#1e1e1e] text-white' : 'bg-gray-50 text-black'}\`}>
${settingsPayload.split('\n').slice(1).join('\n')}

        {/* Connect Form Overlay */}
        <div className={\`absolute inset-0 z-40 flex shadow-2xl overflow-hidden transition-opacity duration-200 \${!showSettings && selectedSessionIndex !== null && sessions[selectedSessionIndex] ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'} \${isDark ? 'bg-black/90' : 'bg-white/90'}\`}>
          {selectedSessionIndex !== null && sessions[selectedSessionIndex] && (
            <div className="flex-1 flex flex-col pt-10">
              <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
                <form onSubmit={(e) => { e.preventDefault(); handleConnect(sessions[selectedSessionIndex]); }} className={\`p-8 w-full max-w-md space-y-6 flex flex-col rounded-xl shadow-2xl border \${isDark ? 'bg-black/40 border-white/10' : 'bg-white border-black/5'}\`}>
                  <div className="text-center">
                    <h2 className="text-2xl font-bold mb-2">Connect to Server</h2>
                    <p className="opacity-50 text-sm">Launch a new Tabbed SSH session</p>
                  </div>

                  {error && (
                    <div className="bg-red-500/20 border border-red-500/50 text-red-600 dark:text-red-200 p-3 rounded-lg text-sm">
                      {error}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.host')}</label>
                        <input required value={sessions[selectedSessionIndex].host} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].host = e.target.value; syncProfiles(updated); }} type="text" placeholder="192.168.1.1 or example.com" className={\`w-full border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary focus:border-primary \${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}\`} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.port')}</label>
                        <input required value={sessions[selectedSessionIndex].port ?? appConfig.defaultPort ?? 22} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].port = parseInt(e.target.value) || 22; syncProfiles(updated); }} type="number" min="1" max="65535" className={\`w-full border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary focus:border-primary \${isDark ? 'bg-black/30 border-white/10' : 'bg-black/5 border-black/10'}\`} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.username')}</label>
                      <input required value={sessions[selectedSessionIndex].username} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].username = e.target.value; syncProfiles(updated); }} type="text" className={\`w-full border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary focus:border-primary \${isDark ? 'bg-black/30 border-white/10' : 'bg-black/5 border-black/10'}\`} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.password')}</label>
                      <input value={sessions[selectedSessionIndex].password || ''} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].password = e.target.value; syncProfiles(updated); }} type="password" placeholder="Leave empty if using key" className={\`w-full border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary focus:border-primary \${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}\`} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.privateKey')}</label>
                      <div className="flex gap-2">
                        <input value={sessions[selectedSessionIndex].privateKeyPath || ''} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].privateKeyPath = e.target.value; syncProfiles(updated); }} type="text" placeholder="e.g. ~/.ssh/id_rsa" className={\`flex-1 border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary focus:border-primary \${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}\`} />
                        <button type="button" onClick={async () => {
                          // @ts-ignore
                          const path = await window.electronAPI.selectFile();
                          if (path) { const updated = [...sessions]; updated[selectedSessionIndex].privateKeyPath = path; syncProfiles(updated); }
                        }} className={\`px-3 border rounded-lg text-sm transition-colors shrink-0 \${isDark ? 'bg-white/10 hover:bg-white/20 border-white/10' : 'bg-black/5 hover:bg-black/10 border-black/10 bg-white'}\`}>
                          Browse
                        </button>
                      </div>
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer pt-2">
                      <input type="checkbox" checked={sessions[selectedSessionIndex].useKeepAlive !== false} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].useKeepAlive = e.target.checked; syncProfiles(updated); }} className="w-4 h-4 accent-primary rounded" />
                      <div>
                        <div className="text-sm font-medium">Enable Keep-Alive</div>
                        <div className="text-xs opacity-50">Prevents session timeout drop</div>
                      </div>
                    </label>
                  </div>

                  <button disabled={connecting} type="submit" className="w-full bg-primary hover:bg-primary disabled:opacity-50 text-white font-medium py-3 mt-4 rounded-lg transition-colors shadow-lg shadow-primary/20">
                    {connecting ? t('connect.connecting') : t('connect.connectBtn')}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>

        {/* Terminals Layer (Always Mounted if tabs > 0) */}
        {tabs.length > 0 ? (
          <div className="flex flex-col h-full flex-1 relative z-10">
            <div className={\`flex items-end px-2 pt-8 gap-1 border-b \${isDark ? 'border-white/10 bg-black/20' : 'border-black/5 bg-white/30'}\`} style={{ WebkitAppRegion: 'drag' } as any}>
              {tabs.map((tab) => {
                const isActive = activeTabId === tab.id;
                return (
                  <div key={tab.id} onClick={() => setActiveTabId(tab.id)} style={{ WebkitAppRegion: 'no-drag' } as any} className={\`group flex items-center justify-between gap-3 px-4 py-2 rounded-t-lg border-t border-x cursor-pointer text-sm transition-all min-w-[150px] max-w-[200px] \${isActive ? (isDark ? 'bg-black/60 border-white/10 text-white shadow-md' : 'bg-white border-black/10 text-black shadow-md relative z-10') : (isDark ? 'bg-transparent border-transparent text-white/50 hover:bg-white/5' : 'bg-transparent border-transparent text-black/50 hover:bg-black/5')}\`}>
                    <span className="truncate">{tab.title}</span>
                    <button onClick={(e) => closeTab(e, tab.id)} className={\`p-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-colors \${isDark ? 'hover:bg-white/20 text-white/70' : 'hover:bg-black/10 text-black/70'}\`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className={\`flex-1 relative \${isDark ? 'bg-black/40' : 'bg-white/60'}\`}>
               {tabs.map(tab => (
                 <div key={tab.id} className={\`absolute inset-0 transition-opacity duration-200 \${activeTabId === tab.id ? 'z-10 opacity-100 pointer-events-auto' : '-z-10 opacity-0 pointer-events-none'}\`}>
                   <TerminalComponent sessionId={tab.id} onDisconnected={() => {}} onReconnect={() => handleReconnect(tab)} config={appConfig} />
                 </div>
               ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center relative z-0">
              <div className="opacity-30 flex flex-col items-center gap-4">
                 <TerminalIcon className="w-16 h-16" />
                 <p className="text-sm font-medium tracking-widest uppercase">Select or create a session to connect</p>
              </div>
          </div>
        )}
`;

const newCode = code.slice(0, startIndex + startStr.length) + '\n' + newLayout + '\n' + code.slice(endIndex);
fs.writeFileSync('src/App.tsx', newCode);
console.log("App.tsx fixed");
