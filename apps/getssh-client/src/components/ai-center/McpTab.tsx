import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Trash2, Wrench, BookOpen, Database, Copy, Check } from 'lucide-react';
import { SettingsRow, SettingsSection, SettingsToggle, settingButtonClass, settingDangerButtonClass, settingFieldClass } from '../settings/SettingsControls';

export const McpTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState('');

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
  const [copiedTarget, setCopiedTarget] = useState<'claude' | 'cursor' | null>(null);

  const fetchServers = async () => {
    setLoading(true);
    setLoadError('');
    try {
      if (!window.electronAPI?.mcp) throw new Error('MCP API unavailable.');
      const res = await window.electronAPI.mcp.getServers();
      if (!res.success) throw new Error(res.error || 'Failed to fetch MCP servers.');
      setServers(res.servers || []);
    } catch (error: any) {
      console.error('Failed to fetch MCP servers', error);
      setLoadError(error?.message || 'Failed to fetch MCP servers.');
    } finally {
      setLoading(false);
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

  const copySnippet = async (target: 'claude' | 'cursor', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      setTimeout(() => setCopiedTarget(null), 2000);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : (zh ? '无法复制配置' : 'Could not copy configuration'));
    }
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
    <div className="space-y-7 text-ink">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{zh ? 'MCP 服务' : 'MCP servers'}</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-3">
            {zh ? '连接外部工具、资源与提示词；按需授予本地进程权限。' : 'Connect external tools, resources and prompts. Grant local process access only when needed.'}
          </p>
        </div>
        {!isAdding && <button type="button" onClick={() => { setFormError(''); setIsAdding(true); }} className={`${settingButtonClass} border-primary/40 text-primary`}>
          <Plus className="h-3.5 w-3.5" /> {t('aiSettings.addMcpServer', zh ? '添加 MCP 服务' : 'Add MCP server')}
        </button>}
      </div>

      {isAdding && <section className="rounded-lg border border-line bg-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-ink">{t('aiSettings.newMcpServer', zh ? '添加 MCP 服务' : 'New MCP server')}</h4>
          <div className="flex gap-1 rounded-md border border-line bg-surf p-0.5" aria-label={zh ? '传输方式' : 'Transport'}>
            <button type="button" aria-pressed={newServerType === 'stdio'} onClick={() => setNewServerType('stdio')} className={`min-h-8 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${newServerType === 'stdio' ? 'bg-panel text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}>Stdio</button>
            <button type="button" aria-pressed={newServerType === 'http'} onClick={() => setNewServerType('http')} className={`min-h-8 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${newServerType === 'http' ? 'bg-panel text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}>HTTP / SSE</button>
          </div>
        </div>
        <div className="space-y-5">
          <SettingsSection title={zh ? '连接配置' : 'Connection'}>
            <SettingsRow label={zh ? '服务名称' : 'Server name'}>
              <input type="text" aria-label={zh ? '服务名称' : 'Server name'} placeholder={zh ? '例如：Memory Server' : 'e.g. Memory Server'} value={newServerName} onChange={event => setNewServerName(event.target.value)} className={settingFieldClass} />
            </SettingsRow>
            {newServerType === 'stdio' ? <>
              <SettingsRow label={zh ? '启动命令' : 'Command'}>
                <input type="text" aria-label={zh ? '启动命令' : 'Command'} placeholder="npx, python, node" value={newServerCommand} onChange={event => setNewServerCommand(event.target.value)} className={`${settingFieldClass} font-mono`} />
              </SettingsRow>
              <SettingsRow label={zh ? '命令参数' : 'Arguments'} description={zh ? '以空格分隔。' : 'Space-separated.'}>
                <input type="text" aria-label={zh ? '命令参数' : 'Arguments'} placeholder="-y @modelcontextprotocol/server-memory" value={newServerArgs} onChange={event => setNewServerArgs(event.target.value)} className={`${settingFieldClass} font-mono`} />
              </SettingsRow>
            </> : <SettingsRow label={zh ? '服务地址' : 'Endpoint URL'} description={zh ? 'HTTP 服务位于远端，不受本地进程隔离保护。' : 'Remote HTTP services are not covered by local process isolation.'} stacked>
              <input type="url" aria-label={zh ? '服务地址' : 'Endpoint URL'} placeholder="https://example.com/mcp" value={newServerUrl} onChange={event => setNewServerUrl(event.target.value)} className={`${settingFieldClass} font-mono`} />
            </SettingsRow>}
          </SettingsSection>

          {newServerType === 'stdio' && <SettingsSection title={zh ? '本地进程权限' : 'Local process permissions'} description={zh ? '默认隐藏用户文件并阻止网络访问。只授权此服务实际需要的路径。' : 'User files and network access are blocked by default. Grant only the paths this server needs.'}>
            <SettingsRow label={zh ? '额外读取路径' : 'Additional read paths'} description={zh ? '每行一个已存在的绝对路径；运行时和命令文件仍可读取。' : 'One existing absolute path per line. Runtime and command files remain readable.'} stacked>
              <textarea rows={3} aria-label={zh ? '额外读取路径' : 'Additional read paths'} placeholder="/Users/you/Documents/mcp-input" value={newServerReadPaths} onChange={event => setNewServerReadPaths(event.target.value)} className={`${settingFieldClass} resize-y font-mono`} />
            </SettingsRow>
            <SettingsRow label={zh ? '读写路径' : 'Read & write paths'} description={zh ? '每行一个已存在的绝对路径；未授权时只能写入私有运行目录。' : 'One existing absolute path per line. Otherwise writes stay inside the private runtime.'} stacked>
              <textarea rows={3} aria-label={zh ? '读写路径' : 'Read & write paths'} placeholder="/Users/you/Documents/mcp-output" value={newServerWritePaths} onChange={event => setNewServerWritePaths(event.target.value)} className={`${settingFieldClass} resize-y font-mono`} />
            </SettingsRow>
            <SettingsRow label={zh ? '允许网络访问' : 'Allow network access'} description={zh ? '默认阻止；仅在需要下载依赖或调用远端 API 时开启。' : 'Blocked by default. Enable only to download packages or call remote APIs.'}>
              <SettingsToggle checked={newServerNetwork} onChange={setNewServerNetwork} label={zh ? '允许网络访问' : 'Allow network access'} />
            </SettingsRow>
          </SettingsSection>}

          <SettingsSection title={zh ? 'AI 权限' : 'AI permissions'}>
            <SettingsRow label={zh ? '允许反向 AI 采样' : 'Allow reverse AI sampling'} description={zh ? '默认关闭。开启后，此服务可通过 GETSSH 使用你配置的模型服务及额度。' : 'Off by default. This lets the server use your configured AI provider and quota through GETSSH.'}>
              <SettingsToggle checked={newServerSampling} onChange={setNewServerSampling} label={zh ? '允许反向 AI 采样' : 'Allow reverse AI sampling'} />
            </SettingsRow>
          </SettingsSection>
        </div>
        {formError && <p role="alert" className="mt-4 border-l-2 border-down bg-down/10 px-3 py-2 text-xs text-down">{formError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => { setFormError(''); setIsAdding(false); }} className={settingButtonClass}>{zh ? '取消' : 'Cancel'}</button>
          <button type="button" onClick={handleAddServer} disabled={!newServerName.trim() || (newServerType === 'stdio' ? !newServerCommand.trim() : !newServerUrl.trim())} className="inline-flex min-h-8 items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40">
            {zh ? '连接并保存' : 'Connect & save'}
          </button>
        </div>
      </section>}

      <SettingsSection title={zh ? '已配置的服务' : 'Configured servers'} description={zh ? '连接状态、权限和发现的能力在这里查看。' : 'Review connection status, permissions and discovered capabilities.'}>
        {actionError && <p role="alert" className="my-2 border-l-2 border-down bg-down/10 px-3 py-2 text-xs text-down">{actionError}</p>}
        {loadError && <p role="alert" className="my-2 border-l-2 border-down bg-down/10 px-3 py-2 text-xs text-down">{loadError}</p>}
        {loading && <p role="status" className="px-1 py-4 text-sm text-ink-3">{zh ? '正在读取服务…' : 'Loading servers…'}</p>}
        {!loading && !loadError && servers.length === 0 && <p className="px-1 py-5 text-sm text-ink-3">{zh ? '还没有配置 MCP 服务。' : 'No MCP servers configured yet.'}</p>}
        {servers.map(server => {
          const isConnected = server.status === 'connected';
          const isError = server.status === 'error';
          const isRestarting = restartingId === server.config.id;
          const pathGrants = (server.config.permissions?.readPaths?.length || 0) + (server.config.permissions?.writePaths?.length || 0);
          return <article key={server.config.id} className="border-b border-line-soft px-1 py-4 last:border-b-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h4 className="text-sm font-semibold text-ink">{server.config.name}</h4>
                  <span className={`text-xs ${server.config.enabled && isConnected ? 'text-ok' : server.config.enabled && isError ? 'text-down' : 'text-ink-3'}`}>
                    {!server.config.enabled ? (zh ? '已停用' : 'Disabled') : isConnected ? (zh ? '已连接' : 'Connected') : isError ? (zh ? '连接异常' : 'Error') : server.status}
                  </span>
                  <span className="text-xs text-ink-3">· {server.config.transport === 'http' ? 'HTTP' : 'Stdio'}</span>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-ink-3">{server.config.transport === 'stdio' ? `${server.config.command} ${(server.config.args || []).join(' ')}` : server.config.url}</p>
                <p className="mt-2 text-xs text-ink-2">
                  {server.config.transport === 'stdio' && <>{server.config.permissions?.network === true ? <span className="text-warn">{zh ? '网络已授权' : 'Network allowed'}</span> : (zh ? '网络已阻止' : 'Network blocked')} · {zh ? `${pathGrants} 个路径授权` : `${pathGrants} path grants`} · </>}
                  {server.config.permissions?.sampling === true ? <span className="text-warn">{zh ? 'AI 采样已授权' : 'AI sampling allowed'}</span> : (zh ? 'AI 采样已关闭' : 'AI sampling off')}
                </p>
                {server.error && <p role="alert" className="mt-2 break-words text-xs text-down">{server.error}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => handleRestart(server.config.id)} disabled={isRestarting} className={settingButtonClass} title={zh ? '重连并刷新工具' : 'Reconnect and refresh tools'}>
                  <RefreshCw className={`h-3.5 w-3.5 ${isRestarting ? 'animate-spin' : ''}`} /> {zh ? '重连' : 'Reconnect'}
                </button>
                <button type="button" onClick={() => handleToggleEnable(server)} className={settingButtonClass}>{server.config.enabled ? (zh ? '停用' : 'Disable') : (zh ? '启用' : 'Enable')}</button>
                <button type="button" onClick={() => handleDelete(server.config.id)} className={settingDangerButtonClass} title={zh ? '删除服务' : 'Delete server'}><Trash2 className="h-3.5 w-3.5" /> {zh ? '删除' : 'Delete'}</button>
              </div>
            </div>
            {(server.tools?.length > 0 || server.resources?.length > 0 || server.prompts?.length > 0) && <details className="group mt-3 border-t border-line-soft pt-2">
              <summary className="w-fit cursor-pointer rounded py-1 text-xs text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary">
                {zh ? `查看发现的能力 · ${server.tools?.length || 0} 工具 / ${server.resources?.length || 0} 资源 / ${server.prompts?.length || 0} 提示词` : `Discovered · ${server.tools?.length || 0} tools / ${server.resources?.length || 0} resources / ${server.prompts?.length || 0} prompts`}
              </summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {server.tools?.length > 0 && <div>
                  <h5 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><Wrench className="h-3.5 w-3.5" /> {zh ? '工具' : 'Tools'} ({server.tools.length})</h5>
                  <ul className="divide-y divide-line-soft border-y border-line-soft">{server.tools.map((tool: any) => <li key={tool.name} className="py-2"><div className="break-all font-mono text-xs text-ink">{tool.name}</div><div className="mt-0.5 text-xs text-ink-3">{tool.description || (zh ? '无描述' : 'No description provided')}</div></li>)}</ul>
                </div>}
                {server.resources?.length > 0 && <div>
                  <h5 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><Database className="h-3.5 w-3.5" /> {zh ? '资源' : 'Resources'} ({server.resources.length})</h5>
                  <ul className="divide-y divide-line-soft border-y border-line-soft">{server.resources.map((resource: any) => <li key={resource.uri} className="py-2"><div className="break-all text-xs text-ink">{resource.name || resource.uri}</div><div className="mt-0.5 break-all font-mono text-xs text-ink-3">{resource.uri}</div></li>)}</ul>
                </div>}
                {server.prompts?.length > 0 && <div>
                  <h5 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><BookOpen className="h-3.5 w-3.5" /> {zh ? '提示词与流程' : 'Prompts & workflows'} ({server.prompts.length})</h5>
                  <ul className="divide-y divide-line-soft border-y border-line-soft">{server.prompts.map((prompt: any) => <li key={prompt.name} className="py-2"><div className="break-all font-mono text-xs text-ink">/{prompt.name}</div><div className="mt-0.5 text-xs text-ink-3">{prompt.description || (zh ? '无描述' : 'No description provided')}</div></li>)}</ul>
                </div>}
              </div>
            </details>}
          </article>;
        })}
      </SettingsSection>

      <SettingsSection title={zh ? '让其他应用连接 GETSSH' : 'Use GETSSH from other apps'} description={zh ? '复制配置到 Claude Desktop、Cursor 或兼容 MCP 的客户端。' : 'Copy a configuration snippet into Claude Desktop, Cursor or a compatible MCP client.'}>
        <SettingsRow label={zh ? 'GETSSH 原生 MCP 服务' : 'GETSSH native MCP server'} description={zh ? '通过本机 stdio 接口向外部 AI 客户端提供 GETSSH 会话能力。' : 'Expose GETSSH sessions to external AI clients through its local stdio interface.'}>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => copySnippet('claude', claudeConfigSnippet)} className={settingButtonClass}>{copiedTarget === 'claude' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Claude Desktop</button>
            <button type="button" onClick={() => copySnippet('cursor', cursorConfigSnippet)} className={settingButtonClass}>{copiedTarget === 'cursor' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Cursor / IDE</button>
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
};
