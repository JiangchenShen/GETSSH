import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AiConfigurationSection, type AiConfigurationTab } from '../../ai-center/AiConfigurationSection';
import '../../ManagementSurface.css';

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
    <div role="tablist" aria-label={zh ? 'AI 配置分类' : 'AI configuration sections'} className="management-inline-tabs">
      {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{zh ? item.cn : item.en}</button>)}
    </div>
    <AiConfigurationSection tab={tab} />
  </div>;
};
