import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Plus, RefreshCw, Trash2, Globe, Terminal, Wrench, CheckCircle2, Sparkles, BookOpen, Database, Copy, Check } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

export const McpTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  // New Server Form State
  const [newServerType, setNewServerType] = useState<'stdio' | 'http'>('stdio');
  const [newServerName, setNewServerName] = useState('');
  const [newServerCommand, setNewServerCommand] = useState('npx');
  const [newServerArgs, setNewServerArgs] = useState('-y @modelcontextprotocol/server-memory');
  const [newServerUrl, setNewServerUrl] = useState('');
  const [newServerNetwork, setNewServerNetwork] = useState(false);
  const [newServerSampling, setNewServerSampling] = useState(false);
  const [newServerReadPaths, setNewServerReadPaths] = useState('');
  const [newServerWritePaths, setNewServerWritePaths] = useState('');
  const [formError, setFormError] = useState('');

  // Native Server Config Copy State
  const [copiedTarget, setCopiedTarget] = useState<'claude' | 'cursor' | 'antigravity' | null>(null);

  const fetchServers = async () => {
    if (window.electronAPI?.mcp) {
      setLoading(true);
      try {
        const res = await window.electronAPI.mcp.getServers();
        if (res.success && res.servers) {
          setServers(res.servers);
        }
      } catch (e) {
        console.error('Failed to fetch MCP servers', e);
      } finally {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const handleAddServer = async () => {
    if (!newServerName.trim()) return;
    setFormError('');

    const payload: any = {
      name: newServerName.trim(),
      transport: newServerType,
      enabled: true,
      permissions: { sampling: newServerSampling }
    };

    if (newServerType === 'stdio') {
      payload.command = newServerCommand.trim();
      payload.args = newServerArgs.split(' ').filter(Boolean);
      payload.permissions.network = newServerNetwork;
      payload.permissions.readPaths = newServerReadPaths
        .split(/\r?\n/)
        .map(path => path.trim())
        .filter(Boolean);
      payload.permissions.writePaths = newServerWritePaths
        .split(/\r?\n/)
        .map(path => path.trim())
        .filter(Boolean);
    } else {
      payload.url = newServerUrl.trim();
    }

    try {
      const res = await window.electronAPI.mcp.addServer(payload);
      if (res.success) {
        setIsAdding(false);
        setNewServerName('');
        setNewServerCommand('npx');
        setNewServerArgs('-y @modelcontextprotocol/server-memory');
        setNewServerUrl('');
        setNewServerNetwork(false);
        setNewServerSampling(false);
        setNewServerReadPaths('');
        setNewServerWritePaths('');
        await fetchServers();
      } else {
        setFormError(res.error || 'Failed to add MCP server.');
      }
    } catch (e: any) {
      console.error('Failed to add MCP server', e);
      setFormError(e?.message || 'Failed to add MCP server.');
    }
  };

  const handleToggleEnable = async (server: any) => {
    setActionError('');
    try {
      const res = await window.electronAPI.mcp.updateServer(server.config.id, {
        enabled: !server.config.enabled
      });
      if (!res.success) setActionError(res.error || 'Failed to update MCP server.');
      await fetchServers();
    } catch (e: any) {
      console.error('Failed to toggle MCP server', e);
      setActionError(e?.message || 'Failed to update MCP server.');
    }
  };

  const handleRestart = async (id: string) => {
    setRestartingId(id);
    setActionError('');
    try {
      const res = await window.electronAPI.mcp.restartServer(id);
      if (!res.success) setActionError(res.error || 'Failed to restart MCP server.');
      await fetchServers();
    } catch (e: any) {
      console.error('Failed to restart MCP server', e);
      setActionError(e?.message || 'Failed to restart MCP server.');
    } finally {
      setRestartingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setActionError('');
    try {
      const res = await window.electronAPI.mcp.removeServer(id);
      if (!res.success) setActionError(res.error || 'Failed to delete MCP server.');
      await fetchServers();
    } catch (e: any) {
      console.error('Failed to delete MCP server', e);
      setActionError(e?.message || 'Failed to delete MCP server.');
    }
  };

  const copySnippet = (target: 'claude' | 'cursor' | 'antigravity', text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTarget(target);
    setTimeout(() => setCopiedTarget(null), 2000);
  };

  const claudeConfigSnippet = JSON.stringify({
    mcpServers: {
      getssh: {
        command: "getssh",
        args: ["--mcp-server"]
      }
    }
  }, null, 2);

  const cursorConfigSnippet = JSON.stringify({
    mcpServers: {
      "getssh-daemon": {
        type: "stdio",
        command: "getssh",
        args: ["--mcp-server"]
      }
    }
  }, null, 2);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-black tracking-tight flex items-center gap-3">
            <Cpu className="w-7 h-7 text-amber-500" />
            Model Context Protocol (MCP)
          </h3>
          <p className="text-xs text-white/50 mt-1">
            {t('aiSettings.mcpDesc', 'Connect external Anthropic MCP Servers (Tools, Resources, Prompts) & expose GETSSH to external AI hosts.')}
          </p>
        </div>
        <button
          onClick={() => {
            setFormError('');
            setIsAdding(true);
          }}
          className="px-4 py-2.5 rounded-xl font-bold text-xs bg-amber-500 hover:bg-amber-400 text-black flex items-center gap-2 transition-all shadow-lg shadow-amber-500/20 active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> {t('aiSettings.addMcpServer', 'Add MCP Server')}
        </button>
      </div>

      {/* Module C: GETSSH Native MCP Server Export Banner */}
      <div className="relative overflow-hidden p-6 rounded-[24px] bg-gradient-to-r from-amber-500/10 via-purple-500/10 to-transparent border border-amber-500/20 shadow-xl backdrop-blur-xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-black uppercase tracking-wider text-white">GETSSH Native MCP Server</h4>
              <p className="text-xs text-white/50">Expose GETSSH terminals & SSH sessions directly to Cursor / Claude Desktop / Antigravity</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => copySnippet('claude', claudeConfigSnippet)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white flex items-center gap-1.5 transition-all"
            >
              {copiedTarget === 'claude' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              Claude Desktop Config
            </button>
            <button
              onClick={() => copySnippet('cursor', cursorConfigSnippet)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white flex items-center gap-1.5 transition-all"
            >
              {copiedTarget === 'cursor' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              Cursor / IDE Config
            </button>
          </div>
        </div>
      </div>

      {/* Add Server Modal / Form */}
      {isAdding && (
        <div className={`p-6 rounded-[24px] border ${isDark ? 'bg-black/40 border-amber-500/30' : 'bg-white border-amber-500/30'} shadow-2xl backdrop-blur-xl space-y-4`}>
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <h4 className="text-sm font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> {t('aiSettings.newMcpServer', 'New MCP Server Configuration')}
            </h4>
            <div className="flex gap-2">
              <button
                onClick={() => setNewServerType('stdio')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${newServerType === 'stdio' ? 'bg-amber-500 text-black' : 'bg-white/5 text-white/60'}`}
              >
                Stdio (Process)
              </button>
              <button
                onClick={() => setNewServerType('http')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${newServerType === 'http' ? 'bg-amber-500 text-black' : 'bg-white/5 text-white/60'}`}
              >
                HTTP / SSE
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">Server Name</label>
              <input
                type="text"
                placeholder="e.g. Memory Server"
                value={newServerName}
                onChange={(e) => setNewServerName(e.target.value)}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-amber-500"
              />
            </div>

            {newServerType === 'stdio' ? (
              <>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">Command</label>
                  <input
                    type="text"
                    placeholder="e.g. npx, python, node"
                    value={newServerCommand}
                    onChange={(e) => setNewServerCommand(e.target.value)}
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-amber-500"
                  />
                </div>
                <div className="col-span-full">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">Arguments (space separated)</label>
                  <input
                    type="text"
                    placeholder="e.g. -y @modelcontextprotocol/server-memory"
                    value={newServerArgs}
                    onChange={(e) => setNewServerArgs(e.target.value)}
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white font-mono outline-none focus:border-amber-500"
                  />
                </div>
                <div className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
                      Additional read paths (one absolute path per line)
                    </label>
                    <textarea
                      rows={3}
                      placeholder="/Users/you/Documents/mcp-input"
                      value={newServerReadPaths}
                      onChange={(e) => setNewServerReadPaths(e.target.value)}
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white font-mono outline-none focus:border-amber-500 resize-y"
                    />
                    <p className="text-[10px] text-white/45 mt-1">
                      User files are hidden by default. The server can always read its runtime and command files.
                    </p>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
                      Read &amp; write paths (one absolute path per line)
                    </label>
                    <textarea
                      rows={3}
                      placeholder="/Users/you/Documents/mcp-output"
                      value={newServerWritePaths}
                      onChange={(e) => setNewServerWritePaths(e.target.value)}
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white font-mono outline-none focus:border-amber-500 resize-y"
                    />
                    <p className="text-[10px] text-white/45 mt-1">
                      Writes stay inside the private runtime unless you grant an existing path here.
                    </p>
                  </div>
                </div>
                <label className="col-span-full flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newServerNetwork}
                    onChange={(e) => setNewServerNetwork(e.target.checked)}
                    className="mt-0.5 accent-amber-500"
                  />
                  <span>
                    <span className="block text-xs font-bold text-white/80">Allow network access</span>
                    <span className="block text-[10px] text-white/45 mt-0.5">
                      Blocked by default. Enable only when this server must download packages or call remote APIs.
                    </span>
                  </span>
                </label>
              </>
            ) : (
              <div className="col-span-full">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">Endpoint URL</label>
                <input
                  type="text"
                  placeholder="https://example.com/mcp"
                  value={newServerUrl}
                  onChange={(e) => setNewServerUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white font-mono outline-none focus:border-amber-500"
                />
              </div>
            )}
          </div>

          <label className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
            <input
              type="checkbox"
              checked={newServerSampling}
              onChange={(e) => setNewServerSampling(e.target.checked)}
              className="mt-0.5 accent-amber-500"
            />
            <span>
              <span className="block text-xs font-bold text-white/80">Allow reverse AI sampling</span>
              <span className="block text-[10px] text-white/45 mt-0.5">
                Off by default. When enabled, this server can use your configured AI provider and quota through GETSSH.
              </span>
            </span>
          </label>

          {formError && (
            <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-300">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => {
                setFormError('');
                setIsAdding(false);
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 text-white/70"
            >
              Cancel
            </button>
            <button
              onClick={handleAddServer}
              disabled={
                !newServerName.trim() ||
                (newServerType === 'stdio' ? !newServerCommand.trim() : !newServerUrl.trim())
              }
              className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Connect & Save
            </button>
          </div>
        </div>
      )}

      {/* Server List */}
      <div className="space-y-4">
        {actionError && (
          <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-300">
            {actionError}
          </div>
        )}
        {servers.length === 0 && !loading && (
          <div className="p-8 text-center border border-dashed border-white/10 rounded-2xl opacity-40">
            <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs uppercase font-bold tracking-wider">No MCP Servers Configured</p>
          </div>
        )}

        {servers.map((s) => {
          const isConnected = s.status === 'connected';
          const isErr = s.status === 'error';
          const isRestarting = restartingId === s.config.id;

          return (
            <div
              key={s.config.id}
              className={`p-6 rounded-[24px] border transition-all ${
                isDark ? 'bg-black/40 border-white/10' : 'bg-white border-black/5'
              } shadow-xl space-y-4`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    isConnected ? 'bg-emerald-500/20 text-emerald-400' : isErr ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-white/40'
                  }`}>
                    {s.config.transport === 'http' ? <Globe className="w-5 h-5" /> : <Terminal className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-base font-black text-white">{s.config.name}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        isConnected ? 'bg-emerald-500/20 text-emerald-400' : isErr ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/40'
                      }`}>
                        {s.status}
                      </span>
                      <span className="text-[10px] font-mono opacity-40 uppercase">
                        [{s.config.transport}]
                      </span>
                      {s.config.transport === 'stdio' && (
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                          s.config.permissions?.network === true
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-emerald-500/15 text-emerald-300'
                        }`}>
                          {s.config.permissions?.network === true ? 'network allowed' : 'network blocked'}
                        </span>
                      )}
                      {s.config.transport === 'stdio' && (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-sky-500/15 text-sky-300">
                          {(s.config.permissions?.readPaths?.length || 0) + (s.config.permissions?.writePaths?.length || 0)} path grants
                        </span>
                      )}
                      {s.config.permissions?.sampling === true && (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-purple-500/15 text-purple-300">
                          AI sampling allowed
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono opacity-50 mt-0.5 truncate max-w-md">
                      {s.config.transport === 'stdio'
                        ? `${s.config.command} ${(s.config.args || []).join(' ')}`
                        : s.config.url}
                    </p>
                    {s.error && (
                      <p className="text-[11px] text-red-300 mt-1 max-w-xl">{s.error}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRestart(s.config.id)}
                    disabled={isRestarting}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                    title="Reconnect / Refresh Tools"
                  >
                    <RefreshCw className={`w-4 h-4 ${isRestarting ? 'animate-spin text-amber-400' : ''}`} />
                  </button>
                  <button
                    onClick={() => handleToggleEnable(s)}
                    className={`p-2 rounded-xl transition-colors ${s.config.enabled ? 'text-emerald-400 bg-emerald-500/10' : 'text-white/40 bg-white/5'}`}
                    title={s.config.enabled ? 'Disable Server' : 'Enable Server'}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(s.config.id)}
                    className="p-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors"
                    title="Delete Server"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* 1. Tools Discovered */}
              {s.tools && s.tools.length > 0 && (
                <div className="pt-3 border-t border-white/5">
                  <div className="text-[10px] font-bold uppercase tracking-wider opacity-40 mb-2 flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-amber-400" /> Tools ({s.tools.length})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {s.tools.map((t: any) => (
                      <div key={t.name} className="p-2.5 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-0.5">
                        <span className="text-xs font-bold font-mono text-amber-400">{t.name}</span>
                        <span className="text-[11px] opacity-60 line-clamp-1">{t.description || 'No description provided'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 2. Resources Discovered */}
              {s.resources && s.resources.length > 0 && (
                <div className="pt-3 border-t border-white/5">
                  <div className="text-[10px] font-bold uppercase tracking-wider opacity-40 mb-2 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-purple-400" /> Resources ({s.resources.length})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {s.resources.map((r: any) => (
                      <div key={r.uri} className="p-2.5 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-0.5">
                        <span className="text-xs font-bold font-mono text-purple-400">{r.name || r.uri}</span>
                        <span className="text-[10px] font-mono opacity-50 truncate">{r.uri}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. Prompts Discovered */}
              {s.prompts && s.prompts.length > 0 && (
                <div className="pt-3 border-t border-white/5">
                  <div className="text-[10px] font-bold uppercase tracking-wider opacity-40 mb-2 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-blue-400" /> Prompts & Workflows ({s.prompts.length})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {s.prompts.map((p: any) => (
                      <div key={p.name} className="p-2.5 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-0.5">
                        <span className="text-xs font-bold font-mono text-blue-400">/{p.name}</span>
                        <span className="text-[11px] opacity-60 line-clamp-1">{p.description || 'No description provided'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
