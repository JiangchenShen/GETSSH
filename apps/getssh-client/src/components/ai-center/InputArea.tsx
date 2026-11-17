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
import { useTranslation } from 'react-i18next';
import { settingButtonClass, settingFieldClass } from '../settings/SettingsControls';
import '../ManagementSurface.css';
import { 
  cleanModelId, 
  isConversationalModel, 
  formatModelDisplayName, 
  matchModelQuery, 
  isSameModel,
  defaultModelFor,
  isUsableEndpoint
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
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', badge: 'Flagship', desc: '通用推理模型' },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', badge: 'Fast', desc: '推理模型' },
    { id: 'gpt-4o', name: 'GPT-4o', badge: 'Omni', desc: '多模态模型' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', badge: 'Mini', desc: '轻量多模态模型' },
    { id: 'o3-mini', name: 'o3-mini', badge: 'Reasoning', desc: '代码与数理强化推理' },
  ],
  claude: [
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', badge: 'Adaptive', desc: '自适应思考与代码旗舰' },
    { id: 'claude-opus-5', name: 'Claude Opus 5', badge: 'Deep', desc: '极限复杂推理与架构' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', badge: 'Speed', desc: '轻量模型' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', badge: 'Classic', desc: '经典代码与运维分析' },
  ],
  ollama: [
    { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder', badge: 'Code', desc: '本地运维代码专家' },
    { id: 'llama3.3:70b', name: 'Llama 3.3 (70B)', badge: 'Reasoning', desc: '本地通用模型' },
    { id: 'deepseek-r1:14b', name: 'DeepSeek-R1 (14B)', badge: 'CoT', desc: '本地深度推理' },
    { id: 'mistral:latest', name: 'Mistral', badge: 'Local', desc: '轻量快速模型' },
  ],
  custom: [
    { id: 'deepseek-r1', name: 'DeepSeek-R1', badge: 'Reasoning', desc: '开源深度推理强化模型' },
    { id: 'deepseek-v3', name: 'DeepSeek-V3', badge: 'General', desc: '通用全能大模型' },
  ],
  deepseek: [
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4 Pro', badge: 'Pro', desc: '单模型混合推理，最新旗舰' },
    { id: 'deepseek-v4-flash', name: 'DeepSeek-V4 Flash', badge: 'Flash', desc: '通用模型' },
  ],
  zhipu: [
    { id: 'glm-5.3', name: 'GLM-5.3', badge: 'V5', desc: '百万上下文，强制深度推理' },
    { id: 'glm-5.2', name: 'GLM-5.2', badge: 'V5', desc: '多模态新一代模型' },
    { id: 'glm-4.7', name: 'GLM-4.7', badge: 'Fast', desc: '代码生成与排障' },
  ],
  kimi: [
    { id: 'kimi-k3', name: 'Kimi K3', badge: 'K3', desc: '默认 128K 上下文始终推理' },
    { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', badge: 'Code', desc: '专业运维与代码调试引擎' },
    { id: 'kimi-k2.6', name: 'Kimi K2.6', badge: 'Classic', desc: '经典全栈多模态' },
  ],
  minimax: [
    { id: 'MiniMax-M3', name: 'MiniMax M3', badge: 'M3', desc: 'MiniMax 当前旗舰' },
    { id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', badge: 'Fast', desc: '快速版，思考不能关闭' },
  ],
  qwen: [
    { id: 'qwen3.8-max', name: 'Qwen3.8 Max', badge: 'Max', desc: '千问当前旗舰' },
    { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', badge: 'Plus', desc: '效果与成本均衡' },
    { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', badge: 'Fast', desc: '快速、低成本' },
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
  minimax: { label: 'MiniMax', badge: 'MiniMax API', color: 'text-pink-400 bg-pink-500/10 border-pink-500/30' },
  qwen: { label: 'Alibaba Qwen (通义千问)', badge: 'DashScope API', color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
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
  formId?: string;
}> = ({ prompt, setPrompt, isGenerating, onSubmit, formId = 'ai-chat-form' }) => {
  const { t, i18n } = useTranslation();
  const copy = (cn: string, en: string) => i18n.language?.startsWith('zh') ? cn : en;
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
  const currentProvider = (appConfig.aiProvider || aiConfig.aiProvider || 'gemini') as 'openai' | 'claude' | 'gemini' | 'ollama' | 'deepseek' | 'zhipu' | 'kimi' | 'minimax' | 'qwen' | 'custom';
  const providerMeta = PROVIDER_METADATA[currentProvider] || PROVIDER_METADATA.gemini;

  // Resolve current active model with clean ID
  const defaultModelForProvider = defaultModelFor(currentProvider);

  const rawCurrentModel = appConfig.aiModel || aiConfig.aiModel || defaultModelForProvider;
  const currentModel = cleanModelId(rawCurrentModel);
  const currentThinking = appConfig.aiThinkingEffort || aiConfig.aiThinkingEffort || 'medium';
  const currentMode = appConfig.aiMode || aiConfig.aiMode || 'readonly';
  const isSearchOn = (appConfig.aiSearchEnabled ?? aiConfig.aiSearchEnabled) ?? true;

  const currentThinkingInfo = THINKING_LEVELS.find(l => l.id === currentThinking) || THINKING_LEVELS[2];
  const currentModeInfo = AGENT_MODES.find(m => m.id === currentMode) || AGENT_MODES[0];

  // Fetch dynamic models from API for current provider
  const fetchLiveModels = async () => {
    // A half-typed or malformed address gets no request carrying the saved API key.
    if (!isUsableEndpoint(appConfig.aiEndpoint)) return;
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
      className="ai-composer relative flex shrink-0 flex-col gap-2.5 border-t border-line bg-surf p-3.5 text-ink"
    >
      {/* ── Selection Injection Pill ── */}
      <AnimatePresence>
        {currentTerminalSelection && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              onClick={handleInjectSelection}
              className={settingButtonClass}
            >
              <ClipboardPaste size={13} />
              {copy('插入终端选中文本', 'Insert terminal selection')} · {currentTerminalSelection.length}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Quick Action Popovers ── */}
      <AnimatePresence>
        {/* 1. Dynamic Model Selector Popover (Auto-Cleaned & Fuzzy Matched) */}
        {activeMenu === 'model' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="ai-composer-menu"
          >
            {/* Header with active provider badge & refresh button */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Cpu size={13} className="shrink-0 text-primary" />
                <span className="text-xs font-medium">
                  {providerMeta.label}
                </span>
                <span className="text-xs font-mono text-ink-3">
                  {dynamicApiModels.length > 0 ? dynamicApiModels.length : copy('默认模型', 'Default models')}
                </span>
              </div>
              
              <div className="flex items-center gap-1.5">
                <button
                  onClick={fetchLiveModels}
                  disabled={isFetchingModels}
                  className="management-icon-button"
                  aria-label={copy('刷新模型列表', 'Refresh models')}
                  title={copy('刷新模型列表', 'Refresh models')}
                >
                  <RefreshCw size={13} className={isFetchingModels ? 'animate-spin' : undefined} />
                </button>
                <button 
                  onClick={() => {
                    setActiveMenu(null);
                    window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'settings', title: t('statusBar.settings'), settingsTab: 'AI' } }));
                  }}
                  className={settingButtonClass}
                >
                  <span>{copy('供应商设置', 'Provider settings')}</span>
                  <ExternalLink size={10} />
                </button>
              </div>
            </div>

            {/* Search Input (Automatic cleaning of hyphens & fuzzy matching) */}
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-3 text-ink-3" />
              <input
                type="text"
                aria-label={copy('搜索模型', 'Search models')}
                placeholder={copy('搜索模型', 'Search models')}
                value={modelSearchQuery}
                onChange={e => setModelSearchQuery(e.target.value)}
                className={`pl-8 ${settingFieldClass}`}
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
                      className="ai-composer-option"
                      aria-pressed={isSelected}
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-xs truncate">{m.name}</span>
                          {m.badge && (
                            <span className="rounded bg-surf-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                              {m.badge}
                            </span>
                          )}
                        </div>
                        <span className="mt-0.5 truncate font-mono text-[10px] leading-tight text-ink-3">
                          {m.id}
                        </span>
                      </div>
                      {isSelected && <Check size={14} className="mt-0.5 shrink-0 text-primary" />}
                    </button>
                  );
                })
              ) : (
                <div className="p-3 text-center text-xs text-ink-2">
                  {copy('没有匹配的模型。可输入模型 ID。', 'No matching models. Enter a model ID below.')}
                </div>
              )}
            </div>

            {/* Custom Model Input */}
            <div className="flex gap-1.5 border-t border-line-soft pt-2">
              <input
                type="text"
                aria-label={copy('模型 ID', 'Model ID')}
                placeholder={copy('模型 ID', 'Model ID')}
                value={customModelInput}
                onChange={e => setCustomModelInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleApplyCustomModel()}
                className={`min-w-0 flex-1 font-mono ${settingFieldClass}`}
              />
              <button
                onClick={handleApplyCustomModel}
                disabled={!customModelInput.trim()}
                className={`shrink-0 ${settingButtonClass}`}
              >
                <Plus size={13} />
                {copy('应用', 'Apply')}
              </button>
            </div>
          </motion.div>
        )}

        {/* 2. Thinking Effort Popover */}
        {activeMenu === 'thinking' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="ai-composer-menu"
          >
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
                <Brain size={13} className="text-primary" />
                {copy('思考深度', 'Reasoning effort')}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              {THINKING_LEVELS.filter(lvl => appConfig.aiProvider !== 'gemini' || (lvl.id !== 'xhigh' && lvl.id !== 'max')).map(lvl => {
                const isSelected = currentThinking === lvl.id;
                return (
                  <button
                    key={lvl.id}
                    onClick={() => handleSelectThinking(lvl.id)}
                    className="ai-composer-option"
                    aria-pressed={isSelected}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{lvl.label}</span>
                        <span className="text-[11px] leading-tight text-ink-2">{lvl.desc}</span>
                      </div>
                    </div>
                    {isSelected && <Check size={14} className="shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* 3. Agent Mode Popover */}
        {activeMenu === 'mode' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="ai-composer-menu"
          >
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
                <Bot size={13} className="text-primary" />
                {copy('智能体模式', 'Agent mode')}
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
                    className="ai-composer-option"
                    aria-pressed={isSelected}
                  >
                    <div className="flex items-center gap-2.5">
                      <IconComponent size={15} className={isSelected ? 'text-primary' : 'text-ink-3'} />
                      <div className="flex flex-col">
                        <span className="font-bold text-xs">{m.label}</span>
                        <span className="text-[11px] leading-tight text-ink-2">{m.desc}</span>
                      </div>
                    </div>
                    {isSelected && <Check size={14} className="shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <form id={formId} onSubmit={onSubmit} className="relative flex flex-col gap-2">
        <textarea
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit(event);
            }
          }}
          disabled={isGenerating}
          aria-label={copy('消息', 'Message')}
          placeholder={isGenerating ? copy('正在生成…', 'Generating…') : copy('输入消息。Shift+Enter 换行。', 'Enter a message. Shift+Enter adds a line.')}
          className="min-h-16 w-full resize-none rounded-lg border border-line bg-bg p-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-primary"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <button type="button" className="ai-composer-tool" aria-expanded={activeMenu === 'model'}
              onClick={() => setActiveMenu(activeMenu === 'model' ? null : 'model')}
              title={copy('选择模型', 'Choose model') + ' · ' + providerMeta.label}>
              <Bot size={13} aria-hidden="true" />
              <span className="max-w-[130px] truncate">{formatModelDisplayName(currentModel)}</span>
              <ChevronDown size={11} aria-hidden="true" />
            </button>
            <button type="button" className="ai-composer-tool" aria-expanded={activeMenu === 'thinking'}
              onClick={() => setActiveMenu(activeMenu === 'thinking' ? null : 'thinking')}
              title={copy('思考深度', 'Reasoning effort')}>
              <Brain size={13} aria-hidden="true" />
              <span>{currentThinkingInfo.label}</span>
              <ChevronDown size={11} aria-hidden="true" />
            </button>
            <button type="button" className="ai-composer-tool" aria-pressed={isSearchOn} onClick={handleToggleSearch}>
              <Globe size={13} aria-hidden="true" /><span>{copy('联网搜索', 'Web search')}</span>
            </button>
            <button type="button" className="ai-composer-tool" aria-expanded={activeMenu === 'mode'}
              onClick={() => setActiveMenu(activeMenu === 'mode' ? null : 'mode')}
              title={copy('智能体权限模式', 'Agent permissions')}>
              <currentModeInfo.icon size={13} aria-hidden="true" />
              <span>{currentModeInfo.label}</span>
              <ChevronDown size={11} aria-hidden="true" />
            </button>
          </div>
          <button type="submit" disabled={isGenerating || !prompt.trim()}
            className="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-[var(--primary-ink)] hover:brightness-95 disabled:opacity-45">
            {isGenerating ? copy('生成中', 'Generating') : copy('发送', 'Send')}
            <Send size={13} aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
};
