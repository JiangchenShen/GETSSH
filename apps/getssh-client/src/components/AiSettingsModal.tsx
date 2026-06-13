import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { AiBridge } from '../services/aiBridge';
import { X, Database, Globe, Key, RefreshCw, Cpu } from 'lucide-react';

const SPRING_SNAPPY = { type: 'spring', stiffness: 400, damping: 30, mass: 1.0 } as const;

export const AiSettingsModal: React.FC = () => {
  const isAiSettingsOpen = useAppStore(state => state.isAiSettingsOpen);
  const setIsAiSettingsOpen = useAppStore(state => state.setIsAiSettingsOpen);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);
  const { t } = useTranslation();
  
  const [activeTab, setActiveTab] = useState<'overview' | 'providers' | 'models'>('overview');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState('');

  // Close with Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAiSettingsOpen) {
        setIsAiSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAiSettingsOpen, setIsAiSettingsOpen]);

  const handleFetchModels = async () => {
    setIsFetchingModels(true);
    setFetchError('');
    try {
      const models = await AiBridge.getModels({
        provider: appConfig.aiProvider,
        endpoint: appConfig.aiEndpoint,
        apiKey: appConfig.aiApiKey
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

  return (
    <AnimatePresence>
      {isAiSettingsOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[99999] flex items-center justify-center p-8 bg-black/80 backdrop-blur-md animate-in fade-in duration-300"
        >
          {/* Main Glass Modal */}
          <motion.div
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            transition={SPRING_SNAPPY}
            className="relative w-[90vw] h-[90vh] max-w-[1200px] flex flex-col overflow-hidden border shadow-2xl rounded-none border-white/10 bg-[#0A0A0A]/95 backdrop-blur-3xl"
          >
                    {/* Standard Header */}
        <div className="shrink-0 flex items-center justify-between p-8 border-b border-white/5 bg-white/5" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <h2 className="text-3xl font-black flex items-center gap-4 uppercase tracking-widest text-white">
            <Cpu className="w-8 h-8 text-amber-500" />
            {t('aiSettings.title')}
          </h2>
          <button 
            onClick={() => setIsAiSettingsOpen(false)} 
            className="p-3 transition-colors rounded-none hover:bg-white/10 text-white"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar Navigation */}
            <div className="w-[240px] flex flex-col p-6 border-r border-white/5 bg-black/40">


              <nav className="flex flex-col gap-2">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-sm ${
                    activeTab === 'overview' ? 'bg-amber-500/10 text-amber-500' : 'text-white/40 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Globe size={18} /> {t('aiSettings.tabOverview')}
                </button>
                <button
                  onClick={() => setActiveTab('providers')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-sm ${
                    activeTab === 'providers' ? 'bg-amber-500/10 text-amber-500' : 'text-white/40 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Key size={18} /> {t('aiSettings.tabProviders')}
                </button>
                <button
                  onClick={() => setActiveTab('models')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-sm ${
                    activeTab === 'models' ? 'bg-amber-500/10 text-amber-500' : 'text-white/40 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Database size={18} /> {t('aiSettings.tabModels')}
                </button>
              </nav>
            </div>

            {/* Content Area */}
            <div className="relative flex-1 flex flex-col bg-neutral-900/50">


              <div className="flex-1 p-10 overflow-y-auto no-scrollbar">
                
                {/* 1. OVERVIEW TAB */}
                {activeTab === 'overview' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                    <h3 className="mb-2 text-2xl font-black tracking-tight text-white">{t("aiSettings.overviewTitle")}</h3>
                    <p className="mb-8 text-white/50">{t("aiSettings.overviewDesc")}</p>
                    <div className="flex items-center justify-between p-6 mb-6 border rounded-2xl border-white/5 bg-white/5">
                      <div>
                        <div className="text-lg font-bold text-white uppercase tracking-widest">{t("aiSettings.enableAi", "Enable AI Center")}</div>
                        <div className="text-sm text-white/50">{t("aiSettings.enableAiDesc", "Turn on AI features across the application")}</div>
                      </div>
                      <button
                        onClick={() => updateConfig('aiEnabled', !appConfig.aiEnabled)}
                        className={`relative w-12 h-6 rounded-none border transition-colors ${appConfig.aiEnabled ? 'bg-amber-500 border-amber-400' : 'bg-black/40 border-white/20'}`}
                      >
                        <div className={`absolute top-1 left-1 bg-white shadow-sm w-4 h-4 rounded-none transition-transform ${appConfig.aiEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                    </div>


                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-6 border rounded-2xl border-white/5 bg-white/5">
                        <div className="mb-1 text-sm font-bold text-white/40 uppercase tracking-widest">{t("aiSettings.activeProvider")}</div>
                        <div className="text-xl font-bold text-amber-400 uppercase">{appConfig.aiProvider || 'OpenAI'}</div>
                      </div>
                      <div className="p-6 border rounded-2xl border-white/5 bg-white/5">
                        <div className="mb-1 text-sm font-bold text-white/40 uppercase tracking-widest">{t("aiSettings.activeModel")}</div>
                        <div className="text-xl font-bold text-amber-400">{appConfig.aiModel || 'gpt-3.5-turbo'}</div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* 2. PROVIDERS TAB */}
                {activeTab === 'providers' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                    <h3 className="mb-2 text-2xl font-black tracking-tight text-white">{t("aiSettings.providersTitle")}</h3>
                    <p className="mb-8 text-white/50">{t("aiSettings.providersDesc")}</p>

                    <div className="flex flex-col gap-6">
                      {/* Provider Select */}
                      <div>
                        <label className="block mb-2 text-sm font-bold text-white/70">{t("aiSettings.providerArchitecture")}</label>
                        <select 
                          value={appConfig.aiProvider || 'openai'} 
                          onChange={(e) => updateConfig('aiProvider', e.target.value as any)}
                          className="w-full px-4 py-3 text-white border outline-none bg-black/40 border-white/10 rounded-xl focus:border-amber-500/50"
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
                          <label className="block mb-2 text-sm font-bold text-white/70">{t("aiSettings.endpointUrl")}</label>
                          <input 
                            type="text" 
                            value={appConfig.aiEndpoint || ''} 
                            onChange={(e) => updateConfig('aiEndpoint', e.target.value)}
                            placeholder={appConfig.aiProvider === 'ollama' ? "http://127.0.0.1:11434" : "https://api.openai.com/v1"}
                            className="w-full px-4 py-3 text-white border outline-none bg-black/40 border-white/10 rounded-xl focus:border-amber-500/50 font-mono text-sm"
                          />
                        </div>
                      )}

                      {/* API Key */}
                      {appConfig.aiProvider !== 'ollama' && (
                        <div>
                          <label className="block mb-2 text-sm font-bold text-white/70">{t("aiSettings.apiKey")}</label>
                          <input 
                            type="password" 
                            value={appConfig.aiApiKey || ''} 
                            onChange={(e) => updateConfig('aiApiKey', e.target.value)}
                            placeholder={appConfig.aiProvider === 'gemini' ? "AIza..." : "sk-..."}
                            className="w-full px-4 py-3 text-white border outline-none bg-black/40 border-white/10 rounded-xl focus:border-amber-500/50 font-mono text-sm"
                          />
                          <p className="mt-2 text-xs text-white/40">{t("aiSettings.apiKeyDesc")}</p>
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
                        <h3 className="mb-2 text-2xl font-black tracking-tight text-white">{t("aiSettings.modelsTitle")}</h3>
                        <p className="text-white/50">{t("aiSettings.modelsDesc")}</p>
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
                          <label className="block mb-2 text-sm font-bold text-white/70">{t("aiSettings.availableModels")}</label>
                          <select 
                            value={appConfig.aiModel || ''} 
                            onChange={(e) => updateConfig('aiModel', e.target.value)}
                            className="w-full px-4 py-3 text-white border outline-none bg-black/40 border-white/10 rounded-xl focus:border-amber-500/50 font-mono text-sm"
                          >
                            {availableModels.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Manual Override Input */}
                      <div>
                        <label className="block mb-2 text-sm font-bold text-white/70">{t("aiSettings.manualOverride")}</label>
                        <input 
                          type="text" 
                          value={appConfig.aiModel || ''} 
                          onChange={(e) => updateConfig('aiModel', e.target.value)}
                          placeholder="e.g. gpt-4o, gemini-1.5-flash"
                          className="w-full px-4 py-3 text-white border outline-none bg-black/40 border-white/10 rounded-xl focus:border-amber-500/50 font-mono text-sm"
                        />
                        <p className="mt-2 text-xs text-white/40">{t("aiSettings.manualOverrideDesc")}</p>
                      </div>
                    </div>
                  </motion.div>
                )}

              </div>
            </div>
          </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
