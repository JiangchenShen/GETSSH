import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AiConfigurationSection, type AiConfigurationTab } from '../../ai-center/AiConfigurationSection';

export const AiIntegrationsTab: React.FC = () => {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const [tab, setTab] = useState<AiConfigurationTab>('providers');
  const tabs: { id: AiConfigurationTab; cn: string; en: string }[] = [
    { id: 'providers', cn: '模型服务', en: 'Providers' },
    { id: 'models', cn: '默认模型', en: 'Default model' },
    { id: 'search', cn: '网页搜索', en: 'Web search' },
    { id: 'mcp', cn: 'MCP 服务', en: 'MCP servers' },
  ];

  return <div>
    <div role="tablist" aria-label={zh ? 'AI 配置分类' : 'AI configuration sections'} className="mb-6 flex flex-wrap gap-1 border-b border-line pb-2">
      {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`min-h-9 rounded-md px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary ${tab === item.id ? 'bg-primary/10 font-medium text-primary' : 'text-ink-2 hover:bg-surf-2 hover:text-ink'}`}>{zh ? item.cn : item.en}</button>)}
    </div>
    <AiConfigurationSection tab={tab} />
  </div>;
};
