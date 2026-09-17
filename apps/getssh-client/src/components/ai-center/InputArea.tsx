import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ClipboardPaste, 
  Send, 
  Brain, 
  Globe, 
  Bot, 
  Sparkles, 
  ChevronDown, 
  Check, 
  Shield, 
  MessageSquare,
  Search,
  Plus,
  ExternalLink,
  Cpu,
  RefreshCw
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAiStore } from '../../store/aiStore';
import { AiBridge } from '../../services/aiBridge';
import { 
  cleanModelId, 
  isConversationalModel, 
  formatModelDisplayName, 
  matchModelQuery, 
  isSameModel 
} from '../../utils/aiModelUtils';

interface ModelItem {
  id: string;
  name: string;
  badge?: string;
  desc?: string;
  isCustom?: boolean;
}

const BASELINE_PRESETS: Record<string, ModelItem[]> = {
  gemini: [
    { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', badge: 'Interactions', desc: '多模态深度思考旗舰' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', badge: 'Long Context', desc: '超长上下文深度分析' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', badge: 'Fast', desc: '高性价比快速响应' },
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', badge: 'Next-Gen', desc: '新一代多模态生成' },
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', badge: 'Lite', desc: '轻量低延迟' },
  ],
  openai: [
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', badge: 'Balanced', desc: '新一代均衡推理旗舰' },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', badge: 'Flagship', desc: '最强全能深度大模型' },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', badge: 'Fast', desc: '低成本极速推理' },
    { id: 'gpt-4o', name: 'GPT-4o', badge: 'Omni', desc: '经典极速全模态' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', badge: 'Mini', desc: '轻量秒级响应' },
    { id: 'o3-mini', name: 'o3-mini', badge: 'Reasoning', desc: '代码与数理强化推理' },
  ],
  claude: [
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', badge: 'Adaptive', desc: '自适应思考与代码旗舰' },
    { id: 'claude-opus-5', name: 'Claude Opus 5', badge: 'Deep', desc: '极限复杂推理与架构' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', badge: 'Speed', desc: '轻量秒级极速响应' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', badge: 'Classic', desc: '经典代码与运维分析' },
  ],
  ollama: [
    { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder', badge: 'Code', desc: '本地运维代码专家' },
    { id: 'llama3.3:70b', name: 'Llama 3.3 (70B)', badge: 'Reasoning', desc: '开源最强大脑' },
    { id: 'deepseek-r1:14b', name: 'DeepSeek-R1 (14B)', badge: 'CoT', desc: '本地深度推理' },
    { id: 'mistral:latest', name: 'Mistral', badge: 'Local', desc: '轻量快速模型' },
  ],
  custom: [
    { id: 'deepseek-r1', name: 'DeepSeek-R1', badge: 'Reasoning', desc: '开源深度推理强化模型' },
    { id: 'deepseek-v3', name: 'DeepSeek-V3', badge: 'General', desc: '通用全能大模型' },
  ],
  deepseek: [
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4 Pro', badge: 'Pro', desc: '单模型混合推理，最新旗舰' },
    { id: 'deepseek-v4-flash', name: 'DeepSeek-V4 Flash', badge: 'Flash', desc: '极致高并发低延迟模型' },
  ],
  zhipu: [
    { id: 'glm-5.3', name: 'GLM-5.3', badge: 'V5', desc: '百万上下文，强制深度推理' },
    { id: 'glm-5.2', name: 'GLM-5.2', badge: 'V5', desc: '多模态新一代模型' },
    { id: 'glm-4.7', name: 'GLM-4.7', badge: 'Fast', desc: '极速代码生成与排障' },
  ],
  kimi: [
    { id: 'kimi-k3', name: 'Kimi K3', badge: 'K3', desc: '默认 128K 上下文始终推理' },
    { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', badge: 'Code', desc: '专业运维与代码调试引擎' },
    { id: 'kimi-k2.6', name: 'Kimi K2.6', badge: 'Classic', desc: '经典全栈多模态' },
  ],
};

const PROVIDER_METADATA: Record<string, { label: string; badge: string; color: string }> = {
  gemini: { label: 'Google Gemini', badge: 'Gemini API', color: 'text-sky-400 bg-sky-500/10 border-sky-500/30' },
  openai: { label: 'OpenAI', badge: 'Responses API', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  claude: { label: 'Anthropic Claude', badge: 'Messages API', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  ollama: { label: 'Ollama (本地)', badge: 'Local Engine', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
  deepseek: { label: 'DeepSeek (深度求索)', badge: 'Reasoning API', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  zhipu: { label: 'Zhipu GLM (智谱清言)', badge: 'GLM API', color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30' },
  kimi: { label: 'Moonshot Kimi (月之暗面)', badge: 'Moonshot API', color: 'text-red-400 bg-red-500/10 border-red-500/30' },
  custom: { label: '自定义端点', badge: 'Custom', color: 'text-neutral-400 bg-neutral-500/10 border-neutral-500/30' },
};

const THINKING_LEVELS = [
  { id: 'none', label: '关闭 (None)', icon: '⚡', desc: '0 思考 Token，即时回答', color: 'text-neutral-400' },
  { id: 'low', label: '轻量 (Low)', icon: '🌱', desc: '快速引导思考，极低延迟', color: 'text-emerald-400' },
  { id: 'medium', label: '均衡 (Medium)', icon: '⚖️', desc: '默认推荐，平衡耗时与质量', color: 'text-sky-400' },
  { id: 'high', label: '深度 (High)', icon: '🧠', desc: '深入剖析，复杂排障推理', color: 'text-purple-400' },
  { id: 'xhigh', label: '超级 (XHigh)', icon: '🚀', desc: '更深更广的推理分析', color: 'text-rose-400' },
  { id: 'max', label: '极限 (Max)', icon: '🔥', desc: '最大推理预算，攻克疑难杂症', color: 'text-amber-400' },
] as const;

const AGENT_MODES = [
  { id: 'readonly', label: '只读问答', icon: Shield, desc: '仅回答问题，不读取终端或执行命令' },
  { id: 'assistant', label: '感知助手', icon: MessageSquare, desc: '自动感知终端报错与上下文，不执行命令' },
  { id: 'agent_semi', label: '半托管 (审批)', icon: Sparkles, desc: '自主生成排障命令，需用户点击确认执行' },
  { id: 'agent_full', label: '全托管 (Agent)', icon: Bot, desc: '全自动自主循环诊断与命令执行' },
] as const;

export const InputArea: React.FC<{
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  isGenerating: boolean;
  onSubmit: (e: React.FormEvent) => void;
}> = ({ prompt, setPrompt, isGenerating, onSubmit }) => {
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);

  const aiConfig = useAiStore(state => state.aiConfig);
  const updateAiConfig = useAiStore(state => state.updateAiConfig);

  const currentTerminalSelection = useAppStore(state => state.currentTerminalSelection);
  const setCurrentTerminalSelection = useAppStore(state => state.setCurrentTerminalSelection);

  // Popover States
  const [activeMenu, setActiveMenu] = useState<'model' | 'thinking' | 'mode' | null>(null);
  const [customModelInput, setCustomModelInput] = useState('');
  const [modelSearchQuery, setModelSearchQuery] = useState('');

  // Dynamic API Models
  const [dynamicApiModels, setDynamicApiModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Current active provider
  const currentProvider = (appConfig.aiProvider || aiConfig.aiProvider || 'gemini') as 'openai' | 'claude' | 'gemini' | 'ollama' | 'deepseek' | 'zhipu' | 'kimi' | 'custom';
  const providerMeta = PROVIDER_METADATA[currentProvider] || PROVIDER_METADATA.gemini;

  // Resolve current active model with clean ID
  const defaultModelForProvider = 
    currentProvider === 'gemini' ? 'gemini-3.7-flash' :
    currentProvider === 'claude' ? 'claude-sonnet-5' :
    currentProvider === 'ollama' ? 'qwen2.5-coder' :
    currentProvider === 'deepseek' ? 'deepseek-v4-pro' :
    currentProvider === 'zhipu' ? 'glm-5.3' :
    currentProvider === 'kimi' ? 'kimi-k3' :
    'gpt-5.6-terra';

  const rawCurrentModel = appConfig.aiModel || aiConfig.aiModel || defaultModelForProvider;
  const currentModel = cleanModelId(rawCurrentModel);
  const currentThinking = appConfig.aiThinkingEffort || aiConfig.aiThinkingEffort || 'medium';
  const currentMode = appConfig.aiMode || aiConfig.aiMode || 'readonly';
  const isSearchOn = (appConfig.aiSearchEnabled ?? aiConfig.aiSearchEnabled) ?? true;

  const currentThinkingInfo = THINKING_LEVELS.find(l => l.id === currentThinking) || THINKING_LEVELS[2];
  const currentModeInfo = AGENT_MODES.find(m => m.id === currentMode) || AGENT_MODES[0];

  // Fetch dynamic models from API for current provider
  const fetchLiveModels = async () => {
    setIsFetchingModels(true);
    try {
      const fetched = await AiBridge.getModels({
        provider: currentProvider,
        endpoint: appConfig.aiEndpoint
      });
      if (Array.isArray(fetched) && fetched.length > 0) {
        const cleanList = fetched
          .map(cleanModelId)
          .filter(isConversationalModel);
        const unique = Array.from(new Set(cleanList));
        setDynamicApiModels(unique);
      }
    } catch {
      // Keep baseline presets if fetch fails or unconfigured
    } finally {
      setIsFetchingModels(false);
    }
  };

  useEffect(() => {
    fetchLiveModels();
  }, [currentProvider, appConfig.aiEndpoint]);

  // Merge dynamic models and baseline presets
  const allAvailableModels = useMemo<ModelItem[]>(() => {
    const baselines = BASELINE_PRESETS[currentProvider] || BASELINE_PRESETS.gemini;
    
    if (dynamicApiModels.length === 0) {
      return baselines;
    }

    // Convert dynamic API models into ModelItem structures
    const fromApi: ModelItem[] = dynamicApiModels.map(id => {
      const matchedBaseline = baselines.find(b => isSameModel(b.id, id));
      return {
        id,
        name: formatModelDisplayName(id),
        badge: matchedBaseline?.badge || 'API',
        desc: matchedBaseline?.desc || id
      };
    });

    // Also include any baseline models that weren't in API list as reference
    const remainingBaselines = baselines.filter(b => !fromApi.some(a => isSameModel(a.id, b.id)));
    return [...fromApi, ...remainingBaselines];
  }, [currentProvider, dynamicApiModels]);

  // Filter models via fuzzy/cleaned match
  const filteredModels = useMemo(() => {
    return allAvailableModels.filter(m => matchModelQuery(m.id, m.name, modelSearchQuery));
  }, [allAvailableModels, modelSearchQuery]);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInjectSelection = () => {
    if (!currentTerminalSelection) return;
    setPrompt(prev => prev + (prev ? '\n' : '') + `\`\`\`stderr\n${currentTerminalSelection}\n\`\`\`\n`);
    setCurrentTerminalSelection('');
  };

  const handleSelectModel = (modelId: string) => {
    const cleanId = cleanModelId(modelId);
    updateConfig('aiModel', cleanId);
    updateAiConfig('aiModel', cleanId);
    setActiveMenu(null);
  };

  const handleApplyCustomModel = () => {
    if (!customModelInput.trim()) return;
    const cleanId = cleanModelId(customModelInput);
    updateConfig('aiModel', cleanId);
    updateAiConfig('aiModel', cleanId);
    setCustomModelInput('');
    setActiveMenu(null);
  };

  const handleSelectThinking = (level: typeof THINKING_LEVELS[number]['id']) => {
    updateConfig('aiThinkingEffort', level);
    updateAiConfig('aiThinkingEffort', level);
    setActiveMenu(null);
  };

  const handleSelectMode = (mode: typeof AGENT_MODES[number]['id']) => {
    updateConfig('aiMode', mode);
    updateAiConfig('aiMode', mode);
    setActiveMenu(null);
  };

  const handleToggleSearch = () => {
    const nextVal = !(aiConfig.aiSearchEnabled ?? true);
    updateConfig('aiSearchEnabled', nextVal);
    updateAiConfig('aiSearchEnabled', nextVal);
  };

  return (
    <div 
      ref={containerRef} 
      className={`relative p-3.5 border-t shrink-0 flex flex-col gap-2.5 transition-colors ${
        isDark ? 'border-white/10 bg-[#0c0e14]/80' : 'border-black/10 bg-slate-100/80'
      }`}
    >
      {/* ── Selection Injection Pill ── */}
      <AnimatePresence>
        {currentTerminalSelection && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute -top-12 left-4 z-10"
          >
            <button
              onClick={handleInjectSelection}
              className="flex items-center gap-2 px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 border border-indigo-400 text-white text-[11px] font-bold rounded-full shadow-lg shadow-indigo-500/30 transition-all active:scale-95"
            >
              <ClipboardPaste size={13} />
              粘贴终端选中文本 ({currentTerminalSelection.length} 字符)
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Quick Action Popovers ── */}
      <AnimatePresence>
        {/* 1. Dynamic Model Selector Popover (Auto-Cleaned & Fuzzy Matched) */}
        {activeMenu === 'model' && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={`absolute bottom-16 left-4 z-30 w-80 p-3 rounded-2xl border backdrop-blur-2xl shadow-2xl flex flex-col gap-2.5 ${
              isDark ? 'bg-[#12141e]/95 border-white/10 text-white shadow-black/80' : 'bg-white/95 border-black/10 text-slate-900 shadow-xl'
            }`}
          >
            {/* Header with active provider badge & refresh button */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <Cpu size={13} className="text-amber-400" />
                <span className="text-[11px] font-bold">
                  {providerMeta.label}
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md border ${providerMeta.color}`}>
                  {dynamicApiModels.length > 0 ? `${dynamicApiModels.length} 个模型` : '默认模型'}
                </span>
              </div>
              
              <div className="flex items-center gap-1.5">
                <button
                  onClick={fetchLiveModels}
                  disabled={isFetchingModels}
                  className={`p-1 rounded-lg hover:bg-white/10 transition-all ${isFetchingModels ? 'animate-spin text-amber-400' : (isDark ? 'text-white/50' : 'text-slate-500')}`}
                  title="刷新 API 模型列表"
                >
                  <RefreshCw size={11} />
                </button>
                <button 
                  onClick={() => {
                    setActiveMenu(null);
                    window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'ai', title: 'AI CENTER' } }));
                  }}
                  className={`text-[10px] font-semibold flex items-center gap-0.5 ${isDark ? 'text-amber-400 hover:text-amber-300' : 'text-amber-600 hover:text-amber-700'}`}
                  title="切换 API Key 或绑定其他提供商"
                >
                  <span>换厂商</span>
                  <ExternalLink size={10} />
                </button>
              </div>
            </div>

            {/* Search Input (Automatic cleaning of hyphens & fuzzy matching) */}
            <div className="relative">
              <Search size={13} className={`absolute left-2.5 top-2.5 ${isDark ? 'text-white/30' : 'text-slate-400'}`} />
              <input
                type="text"
                placeholder={`模糊搜索 (如 flash 3.7, 4o, r1)...`}
                value={modelSearchQuery}
                onChange={e => setModelSearchQuery(e.target.value)}
                className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-none ${
                  isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/20' : 'bg-black/5 border-black/5 text-slate-800 placeholder-slate-400'
                }`}
              />
            </div>

            {/* Dynamic & Cleaned Model List */}
            <div className="max-h-56 overflow-y-auto flex flex-col gap-1 pr-1 scrollbar-hide">
              {filteredModels.length > 0 ? (
                filteredModels.map(m => {
                  const isSelected = isSameModel(currentModel, m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => handleSelectModel(m.id)}
                      className={`px-3 py-2 rounded-xl text-left flex items-start justify-between transition-all group ${
                        isSelected 
                          ? (isDark ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-amber-50 border border-amber-400 text-amber-900')
                          : (isDark ? 'hover:bg-white/5 text-white/80 border border-transparent' : 'hover:bg-slate-100 text-slate-700 border border-transparent')
                      }`}
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-xs truncate">{m.name}</span>
                          {m.badge && (
                            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded-md ${
                              isDark ? 'bg-white/10 text-white/60' : 'bg-slate-200 text-slate-600'
                            }`}>
                              {m.badge}
                            </span>
                          )}
                        </div>
                        <span className={`text-[10px] font-mono leading-tight mt-0.5 truncate ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                          {m.id}
                        </span>
                      </div>
                      {isSelected && <Check size={14} className="text-amber-400 shrink-0 mt-0.5" />}
                    </button>
                  );
                })
              ) : (
                <div className={`p-3 text-center text-xs ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                  未找到匹配模型，可在下方直接输入
                </div>
              )}
            </div>

            {/* Custom Model Input */}
            <div className={`pt-2 border-t flex gap-1.5 ${isDark ? 'border-white/10' : 'border-black/5'}`}>
              <input
                type="text"
                placeholder="或自定义输入模型 ID"
                value={customModelInput}
                onChange={e => setCustomModelInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleApplyCustomModel()}
                className={`flex-1 px-3 py-1.5 text-xs rounded-xl border outline-none font-mono ${
                  isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/20' : 'bg-black/5 border-black/5 text-slate-800 placeholder-slate-400'
                }`}
              />
              <button
                onClick={handleApplyCustomModel}
                disabled={!customModelInput.trim()}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-amber-950 font-bold text-xs rounded-xl transition-all shadow-sm flex items-center gap-1 shrink-0"
              >
                <Plus size={13} />
                应用
              </button>
            </div>
          </motion.div>
        )}

        {/* 2. Thinking Effort Popover */}
        {activeMenu === 'thinking' && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={`absolute bottom-16 left-28 z-30 w-72 p-3 rounded-2xl border backdrop-blur-2xl shadow-2xl flex flex-col gap-1.5 ${
              isDark ? 'bg-[#12141e]/95 border-white/10 text-white shadow-black/80' : 'bg-white/95 border-black/10 text-slate-900 shadow-xl'
            }`}
          >
            <div className="flex items-center justify-between px-1 mb-1">
              <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                <Brain size={12} className="text-purple-400" />
                Thinking 思考深度 (CoT Effort)
              </span>
            </div>

            <div className="flex flex-col gap-1">
              {THINKING_LEVELS.filter(lvl => appConfig.aiProvider !== 'gemini' || (lvl.id !== 'xhigh' && lvl.id !== 'max')).map(lvl => {
                const isSelected = currentThinking === lvl.id;
                return (
                  <button
                    key={lvl.id}
                    onClick={() => handleSelectThinking(lvl.id)}
                    className={`px-3 py-2 rounded-xl text-left flex items-center justify-between transition-all group ${
                      isSelected 
                        ? (isDark ? 'bg-purple-500/20 border border-purple-500/40 text-purple-300' : 'bg-purple-50 border border-purple-400 text-purple-900')
                        : (isDark ? 'hover:bg-white/5 text-white/80 border border-transparent' : 'hover:bg-slate-100 text-slate-700 border border-transparent')
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-base leading-none">{lvl.icon}</span>
                      <div className="flex flex-col">
                        <span className={`font-bold text-xs ${lvl.color}`}>{lvl.label}</span>
                        <span className={`text-[10px] leading-tight ${isDark ? 'text-white/40' : 'text-slate-400'}`}>{lvl.desc}</span>
                      </div>
                    </div>
                    {isSelected && <Check size={14} className="text-purple-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* 3. Agent Mode Popover */}
        {activeMenu === 'mode' && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={`absolute bottom-16 left-60 z-30 w-72 p-3 rounded-2xl border backdrop-blur-2xl shadow-2xl flex flex-col gap-1.5 ${
              isDark ? 'bg-[#12141e]/95 border-white/10 text-white shadow-black/80' : 'bg-white/95 border-black/10 text-slate-900 shadow-xl'
            }`}
          >
            <div className="flex items-center justify-between px-1 mb-1">
              <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                <Bot size={12} className="text-amber-400" />
                AI 权限与模式 (Agent Mode)
              </span>
            </div>

            <div className="flex flex-col gap-1">
              {AGENT_MODES.map(m => {
                const isSelected = currentMode === m.id;
                const IconComponent = m.icon;
                return (
                  <button
                    key={m.id}
                    onClick={() => handleSelectMode(m.id)}
                    className={`px-3 py-2 rounded-xl text-left flex items-center justify-between transition-all group ${
                      isSelected 
                        ? (isDark ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-amber-50 border border-amber-400 text-amber-900')
                        : (isDark ? 'hover:bg-white/5 text-white/80 border border-transparent' : 'hover:bg-slate-100 text-slate-700 border border-transparent')
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <IconComponent size={15} className={isSelected ? 'text-amber-400' : (isDark ? 'text-white/50' : 'text-slate-500')} />
                      <div className="flex flex-col">
                        <span className="font-bold text-xs">{m.label}</span>
                        <span className={`text-[10px] leading-tight ${isDark ? 'text-white/40' : 'text-slate-400'}`}>{m.desc}</span>
                      </div>
                    </div>
                    {isSelected && <Check size={14} className="text-amber-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Input Form ── */}
      <form id="ai-chat-form" onSubmit={onSubmit} className="flex flex-col gap-2 relative">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e as any);
            }
          }}
          disabled={isGenerating}
          placeholder={isGenerating ? '正在思考中...' : '输入问题或排障指令... (Enter 发送, Shift+Enter 换行)'}
          className={`w-full h-[62px] border text-sm p-3.5 outline-none resize-none rounded-2xl transition-colors shadow-inner font-sans ${
            isDark 
              ? 'bg-black/40 border-white/10 text-white placeholder-white/25 focus:border-amber-500/50' 
              : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-amber-500/50 shadow-sm'
          }`}
        />

        {/* ── Bottom In-Context Quick Toolbar ── */}
        <div className="flex items-center justify-between gap-2 px-0.5">
          {/* Left Quick Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* 1. Model Pill (Auto-Formatted Display Name) */}
            <button
              type="button"
              onClick={() => setActiveMenu(activeMenu === 'model' ? null : 'model')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all hover:scale-[1.02] active:scale-[0.98] ${
                activeMenu === 'model'
                  ? (isDark ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'bg-amber-100 border-amber-400 text-amber-800')
                  : (isDark ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white' : 'bg-white border-black/10 text-slate-600 hover:bg-slate-50')
              }`}
              title={`当前厂商: ${providerMeta.label} (点击选择该厂商支持的模型)`}
            >
              <Bot size={13} className="text-amber-400" />
              <span className="max-w-[130px] truncate">{formatModelDisplayName(currentModel)}</span>
              <ChevronDown size={11} className={`transition-transform duration-200 ${activeMenu === 'model' ? 'rotate-180' : ''}`} />
            </button>

            {/* 2. Thinking Effort Pill */}
            <button
              type="button"
              onClick={() => setActiveMenu(activeMenu === 'thinking' ? null : 'thinking')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all hover:scale-[1.02] active:scale-[0.98] ${
                activeMenu === 'thinking'
                  ? (isDark ? 'bg-purple-500/20 border-purple-500/50 text-purple-300' : 'bg-purple-100 border-purple-400 text-purple-800')
                  : currentThinking !== 'none'
                    ? (isDark ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'bg-purple-50 border-purple-300 text-purple-700')
                    : (isDark ? 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white' : 'bg-white border-black/10 text-slate-500 hover:bg-slate-50')
              }`}
              title="调节 Chain of Thought 思考深度"
            >
              <Brain size={13} className={currentThinking !== 'none' ? 'text-purple-400' : 'text-neutral-400'} />
              <span>{currentThinkingInfo.label}</span>
              <ChevronDown size={11} className={`transition-transform duration-200 ${activeMenu === 'thinking' ? 'rotate-180' : ''}`} />
            </button>

            {/* 3. Web Search Toggle Pill */}
            <button
              type="button"
              onClick={handleToggleSearch}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all hover:scale-[1.02] active:scale-[0.98] ${
                isSearchOn
                  ? (isDark ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.15)]' : 'bg-emerald-50 border-emerald-400 text-emerald-700')
                  : (isDark ? 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white/70' : 'bg-white border-black/10 text-slate-400 hover:bg-slate-50')
              }`}
              title={isSearchOn ? '联网搜索已开启 (点击关闭)' : '联网搜索已关闭 (点击开启)'}
            >
              <Globe size={13} className={isSearchOn ? 'text-emerald-400' : 'text-neutral-400'} />
              <span>{isSearchOn ? '联网开' : '联网关'}</span>
            </button>

            {/* 4. Agent Mode Pill */}
            <button
              type="button"
              onClick={() => setActiveMenu(activeMenu === 'mode' ? null : 'mode')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all hover:scale-[1.02] active:scale-[0.98] ${
                activeMenu === 'mode'
                  ? (isDark ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-indigo-100 border-indigo-400 text-indigo-800')
                  : (isDark ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white' : 'bg-white border-black/10 text-slate-600 hover:bg-slate-50')
              }`}
              title="切换 AI Agent 权限模式"
            >
              <currentModeInfo.icon size={13} className="text-indigo-400" />
              <span>{currentModeInfo.label}</span>
              <ChevronDown size={11} className={`transition-transform duration-200 ${activeMenu === 'mode' ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Right Action Button */}
          <button
            type="submit"
            disabled={isGenerating || !prompt.trim()}
            className={`h-9 px-4 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5 rounded-xl font-bold text-xs shadow-md shrink-0 ${
              (!isGenerating && prompt.trim()) 
                ? 'bg-amber-500 hover:bg-amber-400 text-amber-950 scale-100 active:scale-95 shadow-amber-500/20' 
                : (isDark ? 'bg-white/10 text-white/40 shadow-none' : 'bg-slate-100 border border-slate-200 text-slate-400 shadow-none')
            }`}
          >
            {isGenerating ? (
              <motion.div
                className={`w-4 h-4 border-2 border-t-transparent rounded-full ${isDark ? 'border-amber-400' : 'border-slate-500'}`}
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
              />
            ) : (
              <>
                <span>发送</span>
                <Send size={13} className="ml-0.5" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
