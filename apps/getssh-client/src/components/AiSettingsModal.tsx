import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { AiBridge } from '../services/aiBridge';
import { Database, Globe, Key, RefreshCw, Cpu, BookOpen, Bot, Sparkles, TerminalSquare, Server, MessageSquare, Play, Check, Edit2, Trash2, Eye, Plus, X } from 'lucide-react';
import { PERSONAS } from '../utils/persona';



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

  // Prompt Vault States
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editingPromptData, setEditingPromptData] = useState<{id: string, title: string, desc: string, content: string, isBuiltin?: boolean} | null>(null);



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
    <div className={`w-full h-full flex flex-col overflow-hidden relative border shadow-2xl rounded-xl ${isDark ? 'bg-transparent text-white border-white/5' : 'bg-transparent text-slate-900 border-black/5'} transition-colors duration-1000`}>
      {/* Ambient Gradient Background */}
      {isDark && (
        <>
          <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
            <div className={`absolute -top-[20%] -right-[10%] w-[60%] h-[60%] rounded-full mix-blend-screen filter blur-[150px] opacity-30 bg-amber-500 transition-colors duration-1000`} />
            <div className={`absolute -bottom-[20%] -left-[10%] w-[60%] h-[60%] rounded-full mix-blend-screen filter blur-[150px] opacity-30 bg-orange-600 transition-colors duration-1000`} />
          </div>
        </>
      )}

      {/* Content Area - Split Pane */}
      <div className={`relative z-10 flex-1 flex overflow-hidden bg-transparent`}>
          
          {/* Left Sidebar */}
          <div className={`w-80 p-8 flex flex-col gap-6 border-r ${isDark ? 'border-white/5 bg-black/20' : 'border-black/5 bg-white/30'} backdrop-blur-md`}>
            {/* Header Widget */}
            <div className={`w-full p-8 flex flex-col items-center justify-center gap-5 border rounded-[32px] relative overflow-hidden shadow-lg ${isDark ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-500/5 border-amber-500/20'}`}>
              <div className="absolute inset-0 bg-gradient-to-b from-amber-500/10 to-transparent opacity-50 pointer-events-none" />
              <Sparkles className="w-20 h-20 text-amber-500 drop-shadow-[0_0_30px_rgba(245,158,11,0.6)] animate-pulse relative z-10" />
              <div className="text-center relative z-10">
                <h3 className={`text-[17px] font-black tracking-tight mb-1 ${isDark ? 'text-white' : 'text-slate-800'}`}>{t('aiSettings.title', 'AI Center')}</h3>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t('aiSettings.subtitle', 'Intelligence engine')}</p>
              </div>
            </div>

            {/* Navigation Menu */}
            <nav className="flex flex-col gap-1 overflow-y-auto pb-4">
              {(() => {
                const activeItemClass = isDark ? 'bg-amber-500/10 text-amber-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_10px_rgba(245,158,11,0.1)]' : 'bg-amber-500/10 text-amber-700 shadow-sm';
                const inactiveItemClass = isDark ? 'text-white/50 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5';
                const baseItemClass = 'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all text-left font-bold border border-transparent';
                
                return (
                  <>
                    <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('aiSettings.sidebar.core', 'Core')}</div>
                    <button onClick={() => setActiveTab('overview')} className={`${baseItemClass} ${activeTab === 'overview' ? activeItemClass : inactiveItemClass}`}><Globe className="w-4 h-4"/>{t('aiSettings.sidebar.dashboard', 'Dashboard')}</button>
                    <button onClick={() => setActiveTab('providers')} className={`${baseItemClass} ${activeTab === 'providers' ? activeItemClass : inactiveItemClass}`}><Server className="w-4 h-4"/>{t('aiSettings.sidebar.providers', 'Providers')}</button>
                    <button onClick={() => setActiveTab('models')} className={`${baseItemClass} ${activeTab === 'models' ? activeItemClass : inactiveItemClass}`}><Database className="w-4 h-4"/>{t('aiSettings.sidebar.models', 'Models')}</button>
                    
                    <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('aiSettings.sidebar.customization', 'Customization')}</div>
                    <button onClick={() => setActiveTab('prompts')} className={`${baseItemClass} ${activeTab === 'prompts' ? activeItemClass : inactiveItemClass}`}><BookOpen className="w-4 h-4"/>{t('aiSettings.sidebar.prompts', 'Prompts')}</button>
                    <button onClick={() => setActiveTab('agents')} className={`${baseItemClass} ${activeTab === 'agents' ? activeItemClass : inactiveItemClass}`}><Bot className="w-4 h-4"/>{t('aiSettings.sidebar.agents', 'Agents')}</button>
                  </>
                );
              })()}
            </nav>
          </div>

          {/* Right Payload Area */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
            <div className="max-w-4xl mx-auto p-12 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* 1. OVERVIEW TAB */}
                {activeTab === 'overview' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="h-full flex flex-col">
                    <h3 className={`mb-2 text-3xl font-black tracking-tight uppercase flex items-center gap-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                      <Sparkles className="text-amber-500 w-8 h-8" /> {t('aiSettings.tabOverview', 'Dashboard')}
                    </h3>
                    <p className={`mb-8 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t('aiSettings.overviewDesc', 'Manage your global AI copilot, connection settings, and active models.')}</p>
                    
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6 auto-rows-[140px]">
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
                    
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6 pb-10">
                      {[
                        { id: 'linux', title: t('aiSettings.promptLinux', 'Linux Expert'), desc: t('aiSettings.promptLinuxDesc', 'A senior Sysadmin specialized in kernel tuning and troubleshooting.'), content: appConfig.language === 'zh-CN' ? PERSONAS.linux.zh : PERSONAS.linux.en, icon: TerminalSquare, color: 'text-emerald-400', isBuiltin: true },
                        { id: 'log', title: t('aiSettings.promptLog', 'Log Analyzer'), desc: t('aiSettings.promptLogDesc', 'Find anomalies, trace errors, and extract patterns from raw logs.'), content: appConfig.language === 'zh-CN' ? PERSONAS.log.zh : PERSONAS.log.en, icon: Database, color: 'text-cyan-400', isBuiltin: true },
                        { id: 'docker', title: t('aiSettings.promptDocker', 'Docker Master'), desc: t('aiSettings.promptDockerDesc', 'Containerization expert. Writes robust Dockerfiles and compose configs.'), content: appConfig.language === 'zh-CN' ? PERSONAS.docker.zh : PERSONAS.docker.en, icon: Server, color: 'text-blue-400', isBuiltin: true },
                        { id: 'security', title: t('aiSettings.promptSecurity', 'Security Auditor'), desc: t('aiSettings.promptSecurityDesc', 'Reviews configurations and scripts for vulnerabilities and bad practices.'), content: appConfig.language === 'zh-CN' ? PERSONAS.security.zh : PERSONAS.security.en, icon: Key, color: 'text-rose-400', isBuiltin: true },
                        ...(appConfig.customPrompts || []).map(p => ({
                          id: p.id,
                          title: p.title,
                          desc: p.desc,
                          content: p.content,
                          icon: Bot,
                          color: 'text-purple-400',
                          isBuiltin: false
                        }))
                      ].map((prompt, i) => {
                        const isActive = appConfig.activePromptId === prompt.id;
                        return (
                        <div 
                          key={i} 
                          className={`group relative p-6 rounded-[32px] border flex flex-col overflow-hidden shadow-lg backdrop-blur-xl transition-all hover:shadow-[0_20px_40px_rgba(0,0,0,0.2)] hover:-translate-y-1 hover:border-amber-500/30 ${isActive ? (isDark ? 'bg-amber-500/10 border-amber-500/50' : 'bg-amber-50 border-amber-500/50') : (isDark ? 'bg-white/5 border-white/5' : 'bg-white border-black/5')}`}
                        >
                          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                          <div className="relative z-10 flex items-start gap-4 mb-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner border ${isDark ? 'bg-black/20 border-white/5' : 'bg-slate-50 border-black/5'} ${prompt.color}`}>
                              <prompt.icon className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                              <h4 className={`text-xl font-bold mb-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>{prompt.title}</h4>
                              <p className={`text-sm leading-relaxed ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{prompt.desc}</p>
                            </div>
                          </div>
                          <div className="relative z-10 mt-auto flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {prompt.isBuiltin ? (
                                <button onClick={() => { setEditingPromptData(prompt as any); setIsEditingPrompt(true); }} className={`p-2 rounded-xl transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-slate-500 hover:text-slate-900'}`} title={t('aiSettings.viewSource', 'View Source')}>
                                  <Eye className="w-4 h-4" />
                                </button>
                              ) : (
                                <>
                                  <button onClick={() => { setEditingPromptData(prompt as any); setIsEditingPrompt(true); }} className={`p-2 rounded-xl transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-slate-500 hover:text-slate-900'}`} title={t('aiSettings.editPersona', 'Edit Persona')}>
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => {
                                    if(confirm(t('aiSettings.deletePersonaConfirm', 'Delete this persona?'))) {
                                      const newPrompts = (appConfig.customPrompts || []).filter(p => p.id !== prompt.id);
                                      updateConfig('customPrompts', newPrompts);
                                      if (appConfig.activePromptId === prompt.id) updateConfig('activePromptId', undefined);
                                    }
                                  }} className={`p-2 rounded-xl transition-colors ${isDark ? 'hover:bg-rose-500/20 text-rose-400 hover:text-rose-300' : 'hover:bg-rose-100 text-rose-500 hover:text-rose-600'}`} title={t('aiSettings.deletePersona', 'Delete Persona')}>
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                            <button onClick={() => updateConfig('activePromptId', isActive ? undefined : prompt.id)} className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${isActive ? 'text-amber-500 bg-amber-500/10 border-amber-500/30' : 'text-slate-500 bg-black/5 border-transparent hover:bg-amber-500/10 hover:text-amber-600'}`}>
                              {isActive ? <><Check className="w-3 h-3" /> {t('aiSettings.active', 'Active')}</> : <><Play className="w-3 h-3" /> {t('aiSettings.activate', 'Activate')}</>}
                            </button>
                          </div>
                        </div>
                      )})}
                      
                      {/* Add New Persona Button */}
                      <div 
                        onClick={() => { setEditingPromptData({ id: `custom_${Date.now()}`, title: '', desc: '', content: '' }); setIsEditingPrompt(true); }}
                        className={`group relative p-6 rounded-[32px] border-2 border-dashed flex flex-col items-center justify-center text-center overflow-hidden transition-all hover:scale-[1.02] cursor-pointer ${isDark ? 'bg-white/5 border-white/10 hover:border-amber-500/50 hover:bg-amber-500/5' : 'bg-slate-50 border-black/10 hover:border-amber-500/50 hover:bg-amber-50'}`}
                      >
                        <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 transition-colors ${isDark ? 'bg-white/5 group-hover:bg-amber-500/20 text-white/50 group-hover:text-amber-400' : 'bg-black/5 group-hover:bg-amber-100 text-slate-500 group-hover:text-amber-600'}`}>
                          <Plus className="w-6 h-6" />
                        </div>
                        <h4 className={`text-lg font-bold mb-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>{t('aiSettings.newPersona', 'New Persona')}</h4>
                        <p className={`text-sm ${isDark ? 'text-white/40' : 'text-slate-500'}`}>{t('aiSettings.newPersonaDesc', 'Create your own custom AI expert')}</p>
                      </div>
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
                    <div className="grid gap-4 mt-4">
                      {[
                        { id: 'readonly', title: t('aiSettings.modeReadonly', 'Read-Only (Default)'), desc: t('aiSettings.modeReadonlyDesc', 'AI can only answer questions and read your prompt. It cannot read the server terminal or execute commands.') },
                        { id: 'assistant', title: t('aiSettings.modeAssistant', 'Assistant Mode'), desc: t('aiSettings.modeAssistantDesc', 'AI automatically reads your active terminal buffer to understand the context, but it cannot run commands.') },
                        { id: 'agent_semi', title: t('aiSettings.modeAgentSemi', 'Semi-Takeover (Approval)'), desc: t('aiSettings.modeAgentSemiDesc', 'AI has autonomy to plan and propose commands, but requires your explicit click approval before executing any command.') },
                        { id: 'agent_full', title: t('aiSettings.modeAgentFull', 'Full Takeover (Agent)'), desc: t('aiSettings.modeAgentFullDesc', 'AI has full autonomy. It will execute commands directly on the server until the objective is completed.') }
                      ].map((mode) => (
                        <div 
                          key={mode.id}
                          onClick={() => updateConfig('aiMode', mode.id as any)}
                          className={`relative p-5 rounded-2xl border cursor-pointer flex items-start gap-4 transition-all ${
                            appConfig.aiMode === mode.id 
                              ? (isDark ? 'bg-amber-500/10 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]' : 'bg-amber-50 border-amber-500/50 shadow-md')
                              : (isDark ? 'bg-black/20 border-white/5 hover:border-white/20' : 'bg-white border-black/5 hover:border-black/20')
                          }`}
                        >
                          <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            appConfig.aiMode === mode.id 
                              ? 'border-amber-500' 
                              : (isDark ? 'border-white/30' : 'border-slate-300')
                          }`}>
                            {appConfig.aiMode === mode.id && <div className="w-2.5 h-2.5 bg-amber-500 rounded-full" />}
                          </div>
                          <div>
                            <h4 className={`text-lg font-bold mb-1 ${
                              appConfig.aiMode === mode.id 
                                ? 'text-amber-500' 
                                : (isDark ? 'text-white' : 'text-slate-900')
                            }`}>{mode.title}</h4>
                            <p className={`text-sm leading-relaxed ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
                              {mode.desc}
                            </p>
                          </div>
                        </div>
                      ))}
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

      {/* Edit/View Persona Modal positioned relative to the whole Settings pane, not inside scrolling div */}
      {isEditingPrompt && editingPromptData && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className={`w-full max-w-2xl max-h-full overflow-y-auto rounded-3xl border shadow-2xl p-8 flex flex-col gap-6 ${isDark ? 'bg-[#1a1a24] border-white/10' : 'bg-white border-black/10'}`}>
            <div className="flex items-center justify-between">
              <h3 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {editingPromptData.isBuiltin ? t('aiSettings.modalViewPersona', 'View Persona') : (editingPromptData.title ? t('aiSettings.modalEditPersona', 'Edit Persona') : t('aiSettings.modalNewPersona', 'New Custom Persona'))}
              </h3>
              <button onClick={() => { setIsEditingPrompt(false); setEditingPromptData(null); }} className={`p-2 rounded-xl transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}>
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex flex-col gap-4">
              <div>
                <label className={`block text-xs font-bold uppercase tracking-widest mb-2 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t('aiSettings.personaTitle', 'Title')}</label>
                <input 
                  type="text"
                  value={editingPromptData.title}
                  onChange={e => setEditingPromptData({...editingPromptData, title: e.target.value})}
                  readOnly={editingPromptData.isBuiltin}
                  placeholder={t('aiSettings.personaTitlePlaceholder', 'e.g. Database Architect')}
                  className={`w-full px-4 py-3 rounded-xl border outline-none transition-all ${isDark ? 'bg-black/20 border-white/10 text-white focus:border-amber-500 focus:bg-white/5' : 'bg-slate-50 border-black/10 text-slate-900 focus:border-amber-500 focus:bg-white'}`}
                />
              </div>
              <div>
                <label className={`block text-xs font-bold uppercase tracking-widest mb-2 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t('aiSettings.personaDesc', 'Description')}</label>
                <input 
                  type="text"
                  value={editingPromptData.desc}
                  onChange={e => setEditingPromptData({...editingPromptData, desc: e.target.value})}
                  readOnly={editingPromptData.isBuiltin}
                  placeholder={t('aiSettings.personaDescPlaceholder', 'e.g. Expert at optimizing Postgres queries.')}
                  className={`w-full px-4 py-3 rounded-xl border outline-none transition-all ${isDark ? 'bg-black/20 border-white/10 text-white focus:border-amber-500 focus:bg-white/5' : 'bg-slate-50 border-black/10 text-slate-900 focus:border-amber-500 focus:bg-white'}`}
                />
              </div>
              <div>
                <label className={`block text-xs font-bold uppercase tracking-widest mb-2 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t('aiSettings.personaSystemPrompt', 'System Prompt')}</label>
                <textarea 
                  value={editingPromptData.content}
                  onChange={e => setEditingPromptData({...editingPromptData, content: e.target.value})}
                  readOnly={editingPromptData.isBuiltin}
                  placeholder={t('aiSettings.personaSystemPromptPlaceholder', 'You are a senior database architect...')}
                  className={`w-full h-48 px-4 py-3 rounded-xl border outline-none transition-all resize-none font-mono text-sm leading-relaxed ${isDark ? 'bg-black/20 border-white/10 text-white focus:border-amber-500 focus:bg-white/5' : 'bg-slate-50 border-black/10 text-slate-900 focus:border-amber-500 focus:bg-white'}`}
                />
              </div>
            </div>
            
            {!editingPromptData.isBuiltin && (
              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => { setIsEditingPrompt(false); setEditingPromptData(null); }} className={`px-6 py-3 rounded-xl font-bold transition-all ${isDark ? 'hover:bg-white/5 text-white/70' : 'hover:bg-black/5 text-slate-600'}`}>{t('common.cancel', 'Cancel')}</button>
                <button onClick={() => {
                  if (!editingPromptData.title.trim() || !editingPromptData.content.trim()) return;
                  const existingPrompts = appConfig.customPrompts || [];
                  const isExisting = existingPrompts.find(p => p.id === editingPromptData.id);
                  let newPrompts;
                  if (isExisting) {
                    newPrompts = existingPrompts.map(p => p.id === editingPromptData.id ? { ...p, title: editingPromptData.title, desc: editingPromptData.desc, content: editingPromptData.content } : p);
                  } else {
                    newPrompts = [...existingPrompts, { id: editingPromptData.id, title: editingPromptData.title, desc: editingPromptData.desc, content: editingPromptData.content }];
                  }
                  updateConfig('customPrompts', newPrompts);
                  setIsEditingPrompt(false);
                  setEditingPromptData(null);
                }} className="px-6 py-3 rounded-xl font-bold bg-amber-500 text-white shadow-lg hover:bg-amber-400 transition-all hover:scale-105 active:scale-95">{t('aiSettings.savePersona', 'Save Persona')}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
