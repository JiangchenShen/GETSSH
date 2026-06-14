import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { AiBridge } from '../services/aiBridge';
import { Database, Globe, Key, RefreshCw, Cpu, BookOpen, Bot, Sparkles, TerminalSquare, Server, MessageSquare, Play } from 'lucide-react';



export const AiSettingsModal: React.FC = () => {
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);
  const { t } = useTranslation();
  
  const [activeTab, setActiveTab] = useState<'overview' | 'prompts' | 'agents' | 'providers' | 'models'>('overview');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [tempApiKey, setTempApiKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);



  const handleFetchModels = async () => {
    setIsFetchingModels(true);
    setFetchError('');
    try {
      const models = await AiBridge.getModels({
        provider: appConfig.aiProvider,
        endpoint: appConfig.aiEndpoint
      });
      setAvailableModels(models);
      
      // Auto-select first model if the current one is not in the list
      if (models.length > 0 && (!appConfig.aiModel || !models.includes(appConfig.aiModel))) {
        updateConfig('aiModel', models[0]);
      }
    } catch (err: any) {
      setFetchError(err.message || t('aiSettings.fetchError'));
    } finally {
      setIsFetchingModels(false);
    }
  };

  // If models tab is opened and no models are loaded yet, try fetching
  useEffect(() => {
    if (activeTab === 'models' && availableModels.length === 0) {
      handleFetchModels();
    }
  }, [activeTab]);

  const handleSaveApiKey = async () => {
    if (!tempApiKey.trim()) return;
    setIsSavingKey(true);
    try {
      const res = await window.electronAPI.ai.saveApiKey(tempApiKey.trim());
      if (res.success) {
        updateConfig('hasAiApiKey', true);
        setTempApiKey('');
      } else {
        alert('Failed to save API Key: ' + res.error);
      }
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleDeleteApiKey = async () => {
    if (confirm('Are you sure you want to delete the bound API Key?')) {
      const res = await window.electronAPI.ai.deleteApiKey();
      if (res.success) {
        updateConfig('hasAiApiKey', false);
      }
    }
  };

  return (
    <div className={`relative w-full h-full flex flex-col overflow-hidden ${isDark ? 'bg-[#0A0A0A]/95 text-white' : 'bg-white/95 text-slate-900'} backdrop-blur-3xl`}>
      {/* Ambient Gradient Background */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className={`absolute -top-[20%] -right-[10%] w-[60%] h-[60%] rounded-full mix-blend-screen filter blur-[120px] opacity-20 ${isDark ? 'bg-amber-500' : 'bg-amber-300'}`} />
        <div className={`absolute -bottom-[20%] -left-[10%] w-[60%] h-[60%] rounded-full mix-blend-screen filter blur-[120px] opacity-20 ${isDark ? 'bg-orange-600' : 'bg-orange-400'}`} />
      </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar Navigation */}
            <div className={`w-[240px] flex flex-col p-6 border-r ${isDark ? 'border-white/5 bg-black/40' : 'border-black/5 bg-slate-50/50'}`}>


              <nav className="flex flex-col gap-2 relative z-10">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-sm ${
                    activeTab === 'overview' ? 'bg-amber-500/10 text-amber-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] border border-amber-500/20' : (isDark ? 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5 border border-transparent')
                  }`}
                >
                  <Globe size={18} /> Dashboard
                </button>
                <button
                  onClick={() => setActiveTab('prompts')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-sm ${
                    activeTab === 'prompts' ? 'bg-amber-500/10 text-amber-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] border border-amber-500/20' : (isDark ? 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5 border border-transparent')
                  }`}
                >
                  <BookOpen size={18} /> {t('aiSettings.tabPrompts', 'Prompt Library')}
                </button>
                <button
                  onClick={() => setActiveTab('agents')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-sm ${
                    activeTab === 'agents' ? 'bg-amber-500/10 text-amber-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] border border-amber-500/20' : (isDark ? 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5 border border-transparent')
                  }`}
                >
                  <Bot size={18} /> {t('aiSettings.tabAgents', 'Autonomous Agents')}
                </button>
                
                <div className={`h-px w-full my-2 ${isDark ? 'bg-white/5' : 'bg-black/5'}`} />
                
                <button
                  onClick={() => setActiveTab('providers')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-sm ${
                    activeTab === 'providers' ? 'bg-amber-500/10 text-amber-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] border border-amber-500/20' : (isDark ? 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5 border border-transparent')
                  }`}
                >
                  <Server size={18} /> {t('aiSettings.tabProviders', 'Providers & Keys')}
                </button>
                <button
                  onClick={() => setActiveTab('models')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-sm ${
                    activeTab === 'models' ? 'bg-amber-500/10 text-amber-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] border border-amber-500/20' : (isDark ? 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5 border border-transparent')
                  }`}
                >
                  <Database size={18} /> {t('aiSettings.tabModels')}
                </button>
              </nav>
            </div>

            {/* Content Area */}
            <div className={`relative flex-1 flex flex-col ${isDark ? 'bg-neutral-900/50' : 'bg-slate-100/50'}`}>


              <div className="flex-1 p-10 overflow-y-auto no-scrollbar">
                
                {/* 1. OVERVIEW TAB */}
                {activeTab === 'overview' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="h-full flex flex-col">
                    <h3 className={`mb-2 text-3xl font-black tracking-tight uppercase flex items-center gap-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                      <Sparkles className="text-amber-500 w-8 h-8" /> {t('aiSettings.tabOverview', 'Dashboard')}
                    </h3>
                    <p className={`mb-8 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t('aiSettings.overviewDesc', 'Manage your global AI copilot, connection settings, and active models.')}</p>
                    
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6 auto-rows-[140px]">
                      {/* Big Status Card */}
                      <div className={`col-span-2 row-span-2 relative p-8 rounded-[32px] border flex flex-col overflow-hidden group shadow-lg backdrop-blur-xl transition-all hover:shadow-[0_20px_40px_rgba(0,0,0,0.2)] hover:-translate-y-1 hover:border-amber-500/30 ${isDark ? 'bg-white/5 border-white/5' : 'bg-white border-black/5'}`}>
                        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent opacity-50" />
                        
                        <div className="relative z-10 flex items-center justify-between mb-auto">
                          <div className="flex items-center gap-4">
                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-600'}`}>
                              <Cpu className="w-7 h-7" />
                            </div>
                            <div>
                              <div className={`text-sm font-bold uppercase tracking-widest mb-1 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t('aiSettings.systemStatus', 'System Status')}</div>
                              <div className="flex items-center gap-2 text-2xl font-black">
                                {appConfig.aiEnabled ? 'ONLINE' : 'OFFLINE'}
                                {appConfig.aiEnabled && <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />}
                              </div>
                            </div>
                          </div>
                          
                          <button
                            onClick={() => updateConfig('aiEnabled', !appConfig.aiEnabled)}
                            className={`relative w-16 h-8 rounded-full border-2 transition-all duration-300 ${appConfig.aiEnabled ? 'bg-amber-500 border-amber-400' : (isDark ? 'bg-black/40 border-white/20' : 'bg-slate-200 border-black/10')}`}
                          >
                            <div className={`absolute top-1/2 -translate-y-1/2 left-1 bg-white shadow-md w-5 h-5 rounded-full transition-all duration-300 ${appConfig.aiEnabled ? 'translate-x-8 scale-110' : 'translate-x-0'}`} />
                          </button>
                        </div>

                        <div className="relative z-10 mt-6 grid grid-cols-2 gap-4">
                          <div className={`rounded-2xl p-4 border ${isDark ? 'bg-black/20 border-white/5' : 'bg-slate-50 border-black/5'}`}>
                            <div className={`text-xs font-bold uppercase tracking-widest mb-1 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>{t('aiSettings.provider', 'Provider')}</div>
                            <div className={`text-lg font-bold uppercase ${isDark ? 'text-white' : 'text-slate-900'}`}>{appConfig.aiProvider || t('aiSettings.notSet', 'Not Set')}</div>
                          </div>
                          <div className={`rounded-2xl p-4 border ${isDark ? 'bg-black/20 border-white/5' : 'bg-slate-50 border-black/5'}`}>
                            <div className={`text-xs font-bold uppercase tracking-widest mb-1 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>{t('aiSettings.activeModel', 'Active Model')}</div>
                            <div className="text-lg font-bold text-amber-500 truncate">{appConfig.aiModel || t('aiSettings.notSet', 'Not Set')}</div>
                          </div>
                        </div>
                      </div>

                      {/* Launch Chat Card */}
                      <div 
                        onClick={() => {
                          useAppStore.getState().setIsAiCenterOpen(true);
                          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                        }}
                        className="relative p-6 rounded-[32px] border flex flex-col justify-center items-center gap-3 cursor-pointer overflow-hidden group shadow-lg backdrop-blur-xl transition-all hover:shadow-[0_20px_40px_rgba(0,0,0,0.2)] hover:-translate-y-1 hover:border-amber-500/30 bg-amber-500/5 border-amber-500/20 text-amber-500"
                      >
                        <MessageSquare className="w-8 h-8 group-hover:scale-110 transition-transform duration-300" />
                        <span className="font-bold tracking-wider">{t('aiSettings.summonAi', 'SUMMON AI')}</span>
                      </div>

                      {/* API Key Status Card */}
                      <div className={`relative p-6 rounded-[32px] border flex flex-col justify-center gap-2 overflow-hidden backdrop-blur-xl ${isDark ? 'bg-white/5 border-white/5' : 'bg-white border-black/5'}`}>
                         <div className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-white/40' : 'text-slate-500'}`}>{t('aiSettings.authentication', 'Authentication')}</div>
                         {appConfig.hasAiApiKey ? (
                           <div className="flex items-center gap-2 text-green-400 font-bold">
                             <Key className="w-5 h-5" /> {t('aiSettings.keyBound', 'Key Bound')}
                           </div>
                         ) : (
                           <div className="flex items-center gap-2 text-rose-400 font-bold">
                             <Key className="w-5 h-5" /> {t('aiSettings.noKey', 'No Key')}
                           </div>
                         )}
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* 2. PROMPTS TAB */}
                {activeTab === 'prompts' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="h-full flex flex-col">
                    <h3 className={`mb-2 text-3xl font-black tracking-tight uppercase flex items-center gap-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                      <BookOpen className="text-amber-500 w-8 h-8" /> {t('aiSettings.promptsTitle', 'Prompt Library')}
                    </h3>
                    <p className={`mb-8 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t('aiSettings.promptsDesc', 'Load pre-configured system personas for your AI to assist with server operations.')}</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-10">
                      {[
                        { title: t('aiSettings.promptLinux', 'Linux Expert'), desc: t('aiSettings.promptLinuxDesc', 'A senior Sysadmin specialized in kernel tuning and troubleshooting.'), icon: TerminalSquare, color: 'text-emerald-400' },
                        { title: t('aiSettings.promptLog', 'Log Analyzer'), desc: t('aiSettings.promptLogDesc', 'Find anomalies, trace errors, and extract patterns from raw logs.'), icon: Database, color: 'text-cyan-400' },
                        { title: t('aiSettings.promptDocker', 'Docker Master'), desc: t('aiSettings.promptDockerDesc', 'Containerization expert. Writes robust Dockerfiles and compose configs.'), icon: Server, color: 'text-blue-400' },
                        { title: t('aiSettings.promptSecurity', 'Security Auditor'), desc: t('aiSettings.promptSecurityDesc', 'Reviews configurations and scripts for vulnerabilities and bad practices.'), icon: Key, color: 'text-rose-400' }
                      ].map((prompt, i) => (
                        <div key={i} className={`group relative p-6 rounded-[32px] border flex flex-col overflow-hidden shadow-lg backdrop-blur-xl transition-all hover:shadow-[0_20px_40px_rgba(0,0,0,0.2)] hover:-translate-y-1 hover:border-amber-500/30 cursor-pointer ${isDark ? 'bg-white/5 border-white/5' : 'bg-white border-black/5'}`}>
                          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                          <div className="relative z-10 flex items-start gap-4 mb-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner border ${isDark ? 'bg-black/20 border-white/5' : 'bg-slate-50 border-black/5'} ${prompt.color}`}>
                              <prompt.icon className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                              <h4 className={`text-xl font-bold mb-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>{prompt.title}</h4>
                              <p className={`text-sm leading-relaxed ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{prompt.desc}</p>
                            </div>
                          </div>
                          <div className="relative z-10 mt-auto flex justify-end">
                            <button disabled className="px-4 py-2 rounded-xl text-xs font-bold text-amber-500/50 bg-amber-500/5 border border-amber-500/10 cursor-not-allowed flex items-center gap-1.5">
                              <Play className="w-3 h-3" /> {t('aiSettings.comingSoon', 'Coming Soon')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* 3. AGENTS TAB */}
                {activeTab === 'agents' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="h-full flex flex-col">
                    <h3 className={`mb-2 text-3xl font-black tracking-tight uppercase flex items-center gap-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                      <Bot className="text-amber-500 w-8 h-8" /> {t('aiSettings.agentsTitle', 'Autonomous Agents')}
                    </h3>
                    <p className={`mb-8 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t('aiSettings.agentsDesc', 'Deploy autonomous AI agents to your servers for continuous monitoring and management.')}</p>
                    
                    <div className={`flex-1 flex flex-col items-center justify-center p-12 text-center rounded-[32px] border-2 border-dashed backdrop-blur-sm relative overflow-hidden ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-white'}`}>
                      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5" />
                      <Bot className={`w-20 h-20 mb-6 ${isDark ? 'text-white/10' : 'text-slate-200'}`} />
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 text-amber-500 text-[10px] font-bold uppercase tracking-widest mb-4 border border-amber-500/20">
                        <Play className="w-3 h-3" /> {t('aiSettings.comingSoon', 'Coming Soon')}
                      </div>
                      <h4 className={`text-2xl font-black mb-2 tracking-wide ${isDark ? 'text-white' : 'text-slate-900'}`}>{t('aiSettings.agentWorkflows', 'Agent Workflows')}</h4>
                      <p className={`max-w-md mx-auto leading-relaxed ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                        {t('aiSettings.agentWorkflowsDesc', 'In a future update, you will be able to deploy long-running agents directly to your hosts from this command center.')}
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* 4. PROVIDERS TAB */}
                {activeTab === 'providers' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                    <h3 className={`mb-2 text-2xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{t("aiSettings.providersTitle")}</h3>
                    <p className={`mb-8 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t("aiSettings.providersDesc")}</p>

                    <div className="flex flex-col gap-6">
                      {/* Provider Select */}
                      <div>
                        <label className={`block mb-2 text-sm font-bold ${isDark ? 'text-white/70' : 'text-slate-600'}`}>{t("aiSettings.providerArchitecture")}</label>
                        <select 
                          value={appConfig.aiProvider || 'openai'} 
                          onChange={(e) => updateConfig('aiProvider', e.target.value as any)}
                          className={`w-full px-4 py-3 border outline-none rounded-xl focus:border-amber-500/50 text-sm ${isDark ? 'text-white bg-black/40 border-white/10' : 'text-slate-900 bg-white border-black/10'}`}
                        >
                          <option value="openai">{t("aiSettings.providerOpenAI")}</option>
                          <option value="gemini">{t("aiSettings.providerGemini")}</option>
                          <option value="ollama">{t("aiSettings.providerOllama")}</option>
                          <option value="custom">{t("aiSettings.providerCustom")}</option>
                        </select>
                      </div>

                      {/* Endpoint URL */}
                      {(appConfig.aiProvider === 'custom' || appConfig.aiProvider === 'ollama') && (
                        <div>
                          <label className={`block mb-2 text-sm font-bold ${isDark ? 'text-white/70' : 'text-slate-600'}`}>{t("aiSettings.endpointUrl")}</label>
                          <input 
                            type="text" 
                            value={appConfig.aiEndpoint || ''} 
                            onChange={(e) => updateConfig('aiEndpoint', e.target.value)}
                            placeholder={appConfig.aiProvider === 'ollama' ? "http://127.0.0.1:11434" : "https://api.openai.com/v1"}
                            className={`w-full px-4 py-3 border outline-none rounded-xl focus:border-amber-500/50 font-mono text-sm ${isDark ? 'text-white bg-black/40 border-white/10' : 'text-slate-900 bg-white border-black/10'}`}
                          />
                        </div>
                      )}

                      {/* API Key */}
                      {appConfig.aiProvider !== 'ollama' && (
                        <div className={`relative p-6 border border-amber-500/20 rounded-[32px] overflow-hidden shadow-lg backdrop-blur-xl ${isDark ? 'bg-black/40' : 'bg-white'}`}>
                          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-50" />
                          
                          <div className="relative z-10 flex items-center justify-between mb-6">
                            <label className={`text-sm font-bold flex items-center gap-3 ${isDark ? 'text-white/90' : 'text-slate-800'}`}>
                              <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500">
                                <Key size={16} />
                              </div>
                              {t('aiSettings.secureApiKeyVault', 'Secure API Key Vault')}
                            </label>
                            {appConfig.hasAiApiKey && (
                              <span className="px-3 py-1 text-[10px] font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-full uppercase tracking-wider flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {t('aiSettings.keyBound', 'Key Bound')}
                              </span>
                            )}
                          </div>
                          
                          <div className="relative z-10">
                            {appConfig.hasAiApiKey ? (
                              <div className="flex flex-col gap-4">
                                <div className={`px-5 py-4 border rounded-2xl font-mono text-sm flex items-center justify-between shadow-inner ${isDark ? 'bg-black/60 border-white/5 text-white/50' : 'bg-slate-50 border-black/5 text-slate-500'}`}>
                                  <span className="tracking-[0.5em]">****************************************</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className={`text-xs flex items-center gap-2 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                                    <Server className="w-3.5 h-3.5" /> {t('aiSettings.storedSecurely', 'Stored securely in OS Keychain')}
                                  </span>
                                  <button
                                    onClick={handleDeleteApiKey}
                                    className="px-5 py-2 text-xs font-bold text-rose-400 bg-rose-400/10 hover:bg-rose-400/20 rounded-xl transition-colors border border-rose-400/20 hover:border-rose-400/40"
                                  >
                                    {t('aiSettings.revokeAccess', 'Revoke Access')}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-4">
                                <input 
                                  type="password" 
                                  value={tempApiKey} 
                                  onChange={(e) => setTempApiKey(e.target.value)}
                                  placeholder={appConfig.aiProvider === 'gemini' ? "AIza..." : "sk-..."}
                                  className={`w-full px-5 py-4 border outline-none rounded-2xl focus:border-amber-500/50 font-mono text-sm shadow-inner transition-colors ${isDark ? 'text-white bg-black/60 border-white/10' : 'text-slate-900 bg-slate-50 border-black/10'}`}
                                />
                                <div className="flex items-center justify-between">
                                  <p className={`text-xs max-w-[70%] flex items-start gap-2 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                                    <Server className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                    {t('aiSettings.vaultWarning', 'Your key is encrypted and stored securely in the native OS Keychain (SafeStorage).')}
                                  </p>
                                  <button
                                    onClick={handleSaveApiKey}
                                    disabled={!tempApiKey.trim() || isSavingKey}
                                    className="px-6 py-2.5 text-xs font-bold text-amber-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:hover:bg-amber-500 rounded-xl transition-colors shrink-0 shadow-lg shadow-amber-500/20"
                                  >
                                    {isSavingKey ? t('aiSettings.encrypting', 'Encrypting...') : t('aiSettings.bindKey', 'Bind Key')}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* 3. MODELS TAB */}
                {activeTab === 'models' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col h-full">
                    <div className="flex items-start justify-between mb-8">
                      <div>
                        <h3 className={`mb-2 text-2xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{t("aiSettings.modelsTitle")}</h3>
                        <p className={`${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t("aiSettings.modelsDesc")}</p>
                      </div>
                      <button 
                        onClick={handleFetchModels}
                        disabled={isFetchingModels}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-bold transition-all border text-amber-500 border-amber-500/20 bg-amber-500/10 hover:bg-amber-500/20 rounded-xl disabled:opacity-50"
                      >
                        <RefreshCw size={14} className={isFetchingModels ? 'animate-spin' : ''} />
                        {t('aiSettings.fetchModelsBtn')}
                      </button>
                    </div>

                    {fetchError && (
                      <div className="p-4 mb-6 text-sm text-red-400 border border-red-500/20 bg-red-500/10 rounded-xl">
                        {fetchError}
                      </div>
                    )}

                    <div className="flex flex-col gap-6">
                      {/* Dropdown if models are available */}
                      {availableModels.length > 0 && (
                        <div>
                          <label className={`block mb-2 text-sm font-bold ${isDark ? 'text-white/70' : 'text-slate-600'}`}>{t("aiSettings.availableModels")}</label>
                          <select 
                            value={appConfig.aiModel || ''} 
                            onChange={(e) => updateConfig('aiModel', e.target.value)}
                            className={`w-full px-4 py-3 border outline-none rounded-xl focus:border-amber-500/50 font-mono text-sm ${isDark ? 'text-white bg-black/40 border-white/10' : 'text-slate-900 bg-white border-black/10'}`}
                          >
                            {availableModels.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Manual Override Input */}
                      <div>
                        <label className={`block mb-2 text-sm font-bold ${isDark ? 'text-white/70' : 'text-slate-600'}`}>{t("aiSettings.manualOverride")}</label>
                        <input 
                          type="text" 
                          value={appConfig.aiModel || ''} 
                          onChange={(e) => updateConfig('aiModel', e.target.value)}
                          placeholder="e.g. gpt-4o, gemini-1.5-flash"
                          className={`w-full px-4 py-3 border outline-none rounded-xl focus:border-amber-500/50 font-mono text-sm ${isDark ? 'text-white bg-black/40 border-white/10' : 'text-slate-900 bg-white border-black/10'}`}
                        />
                        <p className={`mt-2 text-xs ${isDark ? 'text-white/40' : 'text-slate-500'}`}>{t("aiSettings.manualOverrideDesc")}</p>
                      </div>
                    </div>
                  </motion.div>
                )}

              </div>
            </div>
      </div>
    </div>
  );
};
