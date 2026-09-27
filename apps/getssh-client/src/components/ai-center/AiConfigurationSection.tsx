import React, { useEffect, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';
import { useAiStore } from '../../store/aiStore';
import { AiBridge } from '../../services/aiBridge';
import { cleanModelId, formatModelDisplayName, isConversationalModel } from '../../utils/aiModelUtils';
import { McpTab } from './McpTab';

export type AiConfigurationTab = 'providers' | 'models' | 'search' | 'mcp';

const providerDefaults: Record<string, string> = {
  gemini: 'gemini-3.7-flash',
  claude: 'claude-sonnet-5',
  ollama: 'qwen2.5-coder',
  deepseek: 'deepseek-v4-pro',
  zhipu: 'glm-5.3',
  kimi: 'kimi-k3',
  openai: 'gpt-5.6-terra',
  custom: 'gpt-5.6-terra',
};

const inputClass = 'w-full min-w-0 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-primary';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink';
const helpClass = 'mt-1.5 text-xs leading-relaxed text-ink-3';
const actionClass = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line bg-panel px-3 text-sm text-ink hover:bg-surf-2 focus-visible:outline-2 focus-visible:outline-primary';

export const AiConfigurationSection: React.FC<{ tab: AiConfigurationTab }> = ({ tab }) => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const copy = (cn: string, en: string) => zh ? cn : en;
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [tempApiKey, setTempApiKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [isTestingSearch, setIsTestingSearch] = useState(false);
  const [testSearchResult, setTestSearchResult] = useState<{ success: boolean; message: string } | null>(null);

  const updateAiConfig = useAiStore(state => state.updateAiConfig);
  const syncAiConfig = (key: 'aiProvider' | 'aiModel' | 'aiThinkingEffort', value: any) => {
    updateConfig(key, value);
    updateAiConfig(key, value);
  };

  const fetchModels = async () => {
    setIsFetchingModels(true);
    setFetchError('');
    try {
      const models = await AiBridge.getModels({ provider: appConfig.aiProvider, endpoint: appConfig.aiEndpoint });
      setAvailableModels(Array.from(new Set((models || []).map(cleanModelId).filter(isConversationalModel))));
    } catch (error: any) {
      setFetchError(error?.message || t('aiSettings.fetchError', copy('无法获取模型列表', 'Could not fetch the model list')));
    } finally {
      setIsFetchingModels(false);
    }
  };

  useEffect(() => {
    if (tab === 'models') void fetchModels();
  }, [tab, appConfig.aiProvider, appConfig.aiEndpoint]);

  const saveApiKey = async () => {
    if (!tempApiKey.trim()) return;
    setIsSavingKey(true);
    setKeyError('');
    try {
      const result = await window.electronAPI.ai.saveApiKey(tempApiKey.trim(), appConfig.aiProvider || 'gemini');
      if (!result.success) throw new Error(result.error || copy('无法保存 API Key', 'Could not save the API key'));
      updateConfig('hasAiApiKey', true);
      setTempApiKey('');
    } catch (error: any) {
      setKeyError(error?.message || copy('无法保存 API Key', 'Could not save the API key'));
    } finally {
      setIsSavingKey(false);
    }
  };

  const deleteApiKey = async () => {
    if (!window.confirm(copy('确定撤销当前 API Key？', 'Remove the current API key?'))) return;
    setKeyError('');
    try {
      const result = await window.electronAPI.ai.deleteApiKey(appConfig.aiProvider || 'gemini');
      if (!result.success) throw new Error(result.error || copy('无法撤销 API Key', 'Could not remove the API key'));
      updateConfig('hasAiApiKey', false);
    } catch (error: any) {
      setKeyError(error?.message || copy('无法撤销 API Key', 'Could not remove the API key'));
    }
  };

  const testSearch = async () => {
    setIsTestingSearch(true);
    setTestSearchResult(null);
    try {
      const result = await AiBridge.testSearch({
        enabled: true,
        provider: appConfig.aiSearchProvider || 'hybrid',
        googleApiKey: appConfig.aiSearchGoogleApiKey,
        googleCx: appConfig.aiSearchGoogleCx,
        customUrl: appConfig.aiSearchCustomUrl,
      });
      setTestSearchResult({
        success: result.success,
        message: result.success ? copy(`连接成功，找到 ${result.count} 条结果`, `Connection successful. Found ${result.count} results.`) : (result.error || copy('连接失败', 'Connection failed')),
      });
    } catch (error: any) {
      setTestSearchResult({ success: false, message: error?.message || copy('连接失败', 'Connection failed') });
    } finally {
      setIsTestingSearch(false);
    }
  };

  if (tab === 'mcp') return <div className="center-workbench"><McpTab /></div>;

  return (
    <div className="center-workbench max-w-3xl space-y-8 text-ink">
      {tab === 'providers' && (
        <>
          <div>
            <h2 className="text-xl font-semibold">{copy('模型服务', 'Model providers')}</h2>
            <p className="mt-1 text-sm text-ink-2">{copy('选择供应商并管理连接凭据。', 'Choose a provider and manage its credentials.')}</p>
          </div>
          <section className="border-t border-line pt-5">
            <label className="flex items-center justify-between gap-4 text-sm text-ink">
              <span><span className="block font-medium">{copy('启用 AI', 'Enable AI')}</span><span className="mt-1 block text-xs text-ink-3">{copy('关闭后，对话入口会保留，但无法发送请求。', 'The chat remains available, but cannot send requests while AI is off.')}</span></span>
              <input type="checkbox" checked={!!appConfig.aiEnabled} onChange={event => updateConfig('aiEnabled', event.target.checked)} className="h-4 w-4 accent-primary" />
            </label>
          </section>
          <section className="grid gap-5 border-t border-line pt-5 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="ai-provider">{copy('供应商', 'Provider')}</label>
              <select id="ai-provider" className={inputClass} value={appConfig.aiProvider || 'gemini'} onChange={event => {
                const provider = event.target.value as NonNullable<typeof appConfig.aiProvider>;
                syncAiConfig('aiProvider', provider);
                syncAiConfig('aiModel', providerDefaults[provider]);
                setTempApiKey('');
              }}>
                <option value="openai">OpenAI</option><option value="gemini">Google Gemini</option>
                <option value="claude">Anthropic Claude</option><option value="deepseek">DeepSeek</option>
                <option value="zhipu">Zhipu GLM</option><option value="kimi">Moonshot Kimi</option>
                <option value="ollama">{copy('Ollama（本地）', 'Ollama (local)')}</option><option value="custom">{copy('自定义端点', 'Custom endpoint')}</option>
              </select>
            </div>
            {(appConfig.aiProvider === 'custom' || appConfig.aiProvider === 'ollama') && <div>
              <label className={labelClass} htmlFor="ai-endpoint">{copy('服务地址', 'Endpoint URL')}</label>
              <input id="ai-endpoint" className={`${inputClass} font-mono`} value={appConfig.aiEndpoint || ''} onChange={event => updateConfig('aiEndpoint', event.target.value)} placeholder={appConfig.aiProvider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.example.com/v1'} />
            </div>}
          </section>
          {appConfig.aiProvider !== 'ollama' && <section className="border-t border-line pt-5">
            <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-medium">API Key</h3><span className={`text-xs ${appConfig.hasAiApiKey ? 'text-ok' : 'text-ink-3'}`}>{appConfig.hasAiApiKey ? copy('已绑定', 'Configured') : copy('未绑定', 'Not configured')}</span></div>
            {appConfig.hasAiApiKey ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-ink-3">{copy('密钥保存在系统安全存储中，不会在这里显示。', 'The key is stored in the system secure storage and is not shown here.')}</p><button type="button" className={actionClass} onClick={deleteApiKey}>{copy('撤销密钥', 'Remove key')}</button></div>
              : <div className="flex flex-wrap items-center gap-2"><input type="password" aria-label="API Key" className={`${inputClass} min-w-48 flex-1 font-mono`} value={tempApiKey} onChange={event => setTempApiKey(event.target.value)} placeholder={copy('输入当前供应商的 API Key', 'Enter this provider’s API key')} /><button type="button" className={actionClass} onClick={saveApiKey} disabled={!tempApiKey.trim() || isSavingKey}>{isSavingKey ? copy('保存中…', 'Saving…') : copy('保存密钥', 'Save key')}</button></div>}
            {keyError && <p role="alert" className="mt-2 text-xs text-down">{keyError}</p>}
          </section>}
        </>
      )}

      {tab === 'models' && (
        <>
          <div><h2 className="text-xl font-semibold">{copy('默认模型', 'Default model')}</h2><p className="mt-1 text-sm text-ink-2">{copy('选择新对话默认使用的模型和推理预算。', 'Choose the model and reasoning budget for new conversations.')}</p></div>
          <section className="border-t border-line pt-5">
            <div className="mb-3 flex items-center justify-between gap-3"><label className={labelClass} htmlFor="ai-model-list">{copy('可用模型', 'Available models')}</label><button className={actionClass} type="button" onClick={fetchModels} disabled={isFetchingModels} aria-label={copy('刷新模型列表', 'Refresh model list')}><RefreshCw size={14} className={isFetchingModels ? 'animate-spin' : ''} />{copy('刷新', 'Refresh')}</button></div>
            {availableModels.length > 0 && <select id="ai-model-list" className={inputClass} value={availableModels.includes(appConfig.aiModel || '') ? appConfig.aiModel : ''} onChange={event => syncAiConfig('aiModel', event.target.value)}><option value="">{copy('选择已发现的模型', 'Choose a discovered model')}</option>{availableModels.map(model => <option key={model} value={model}>{formatModelDisplayName(model)} ({model})</option>)}</select>}
            {availableModels.length === 0 && !isFetchingModels && <p className="text-xs text-ink-3">{copy('暂无服务返回的模型；仍可手动填写 ID。', 'The provider returned no models; you can still enter an ID manually.')}</p>}
            {fetchError && <p role="alert" className="mt-2 text-xs text-down">{fetchError}</p>}
          </section>
          <section className="grid gap-5 border-t border-line pt-5 md:grid-cols-2">
            <div><label className={labelClass} htmlFor="ai-model-id">{copy('模型 ID', 'Model ID')}</label><input id="ai-model-id" className={`${inputClass} font-mono`} value={appConfig.aiModel || ''} onChange={event => syncAiConfig('aiModel', event.target.value)} placeholder={copy('例如 gpt-4o', 'e.g. gpt-4o')} /><p className={helpClass}>{copy('可手动指定服务支持的模型。', 'You can enter any model ID supported by the provider.')}</p></div>
            <div><label className={labelClass} htmlFor="ai-thinking">{copy('推理深度', 'Reasoning effort')}</label><select id="ai-thinking" className={inputClass} value={appConfig.aiThinkingEffort || 'medium'} onChange={event => syncAiConfig('aiThinkingEffort', event.target.value)}><option value="none">{copy('关闭', 'Off')}</option><option value="low">{copy('轻量', 'Low')}</option><option value="medium">{copy('均衡', 'Medium')}</option><option value="high">{copy('深度', 'High')}</option>{appConfig.aiProvider !== 'gemini' && <><option value="xhigh">{copy('更深', 'Extra high')}</option><option value="max">{copy('最大', 'Maximum')}</option></>}</select></div>
          </section>
          <section className="border-t border-line pt-5"><label className={labelClass} htmlFor="ai-context-size">{copy('上下文上限', 'Context limit')} · {Math.round((appConfig.aiMaxTokens || 200000) / 1000)}K tokens</label><input id="ai-context-size" type="range" min="4000" max="2000000" step="4000" value={appConfig.aiMaxTokens || 200000} onChange={event => updateConfig('aiMaxTokens', Number(event.target.value))} className="w-full accent-primary" /><p className={helpClass}>{copy('限制发送给模型的终端上下文长度。', 'Limit how much terminal context is sent to the model.')}</p></section>
        </>
      )}

      {tab === 'search' && (
        <>
          <div><h2 className="text-xl font-semibold">{copy('网页搜索', 'Web search')}</h2><p className="mt-1 text-sm text-ink-2">{copy('配置 AI 获取最新信息的方式。', 'Choose how AI can find up-to-date information.')}</p></div>
          <section className="border-t border-line pt-5"><label className="flex items-center justify-between gap-4 text-sm"><span>{copy('启用网页搜索', 'Enable web search')}</span><input type="checkbox" checked={!!appConfig.aiSearchEnabled} onChange={event => updateConfig('aiSearchEnabled', event.target.checked)} className="h-4 w-4 accent-primary" /></label></section>
          <div className={appConfig.aiSearchEnabled ? 'space-y-5' : 'pointer-events-none space-y-5 opacity-50'}>
            <section className="border-t border-line pt-5"><label className={labelClass} htmlFor="ai-search-provider">{copy('搜索服务', 'Search provider')}</label><select id="ai-search-provider" className={inputClass} value={appConfig.aiSearchProvider || 'hybrid'} onChange={event => updateConfig('aiSearchProvider', event.target.value as any)} disabled={!appConfig.aiSearchEnabled}><option value="hybrid">{copy('混合自动切换', 'Hybrid (automatic fallback)')}</option><option value="google">Google Custom Search</option><option value="searxng">SearXNG</option><option value="duckduckgo">DuckDuckGo</option><option value="bing">Bing</option></select></section>
            {appConfig.aiSearchProvider === 'google' && <section className="grid gap-5 border-t border-line pt-5 md:grid-cols-2"><div><label className={labelClass} htmlFor="ai-google-key">Google API Key</label><input id="ai-google-key" type="password" className={`${inputClass} font-mono`} value={appConfig.aiSearchGoogleApiKey || ''} onChange={event => updateConfig('aiSearchGoogleApiKey', event.target.value)} disabled={!appConfig.aiSearchEnabled} /></div><div><label className={labelClass} htmlFor="ai-google-cx">Search Engine ID</label><input id="ai-google-cx" className={`${inputClass} font-mono`} value={appConfig.aiSearchGoogleCx || ''} onChange={event => updateConfig('aiSearchGoogleCx', event.target.value)} disabled={!appConfig.aiSearchEnabled} /></div></section>}
            {appConfig.aiSearchProvider === 'searxng' && <section className="border-t border-line pt-5"><label className={labelClass} htmlFor="ai-searxng-url">{copy('实例地址（可选）', 'Instance URL (optional)')}</label><input id="ai-searxng-url" className={`${inputClass} font-mono`} value={appConfig.aiSearchCustomUrl || ''} onChange={event => updateConfig('aiSearchCustomUrl', event.target.value)} placeholder="http://127.0.0.1:8080" disabled={!appConfig.aiSearchEnabled} /></section>}
            <section className="border-t border-line pt-5"><button type="button" className={actionClass} onClick={testSearch} disabled={!appConfig.aiSearchEnabled || isTestingSearch}>{isTestingSearch ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}{isTestingSearch ? copy('检测中…', 'Testing…') : copy('测试连接', 'Test connection')}</button>{testSearchResult && <p role="status" className={`mt-3 text-xs ${testSearchResult.success ? 'text-ok' : 'text-down'}`}>{testSearchResult.message}</p>}</section>
          </div>
        </>
      )}
    </div>
  );
};
