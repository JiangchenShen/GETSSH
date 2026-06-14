import React from 'react';
import { Monitor, Terminal as TerminalIcon, Network, Command, Info, Archive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';

interface SettingsSidebarProps {
  settingsActiveTab: 'Appearance'|'Terminal'|'SSH'|'System'|'About'|'Audit';
  setSettingsActiveTab: (tab: 'Appearance'|'Terminal'|'SSH'|'System'|'About'|'Audit') => void;
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  settingsActiveTab,
  setSettingsActiveTab,
}) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);

  return (
    <div className={`w-[260px] p-6 border-r flex flex-col shrink-0 ${isDark ? 'border-white/10 bg-[#0a0a0a]/50' : 'border-black/5 bg-slate-50/50'} backdrop-blur-xl z-20 shadow-[10px_0_30px_rgba(0,0,0,0.2)]`}>
      <div className="flex items-center gap-3 mb-8 px-2">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/50 shadow-lg shadow-primary/20 flex items-center justify-center">
          <Command className="w-4 h-4 text-white" />
        </div>
        <span className="text-lg font-black tracking-tight">{t('settings.title', 'Settings')}</span>
      </div>
      
      <nav className="flex flex-col gap-1.5 overflow-y-auto pr-2 pb-8">
        {[
          { id: 'Appearance', icon: Monitor, label: t('settings.appearance'), colorClass: 'fuchsia' },
          { id: 'Terminal', icon: TerminalIcon, label: t('settings.terminal'), colorClass: 'emerald' },
          { id: 'SSH', icon: Network, label: t('settings.ssh'), colorClass: 'blue' },
          { id: 'System', icon: Command, label: t('settings.general'), colorClass: 'teal' },
          { divider: true, id: 'div1' },
          { id: 'Audit', icon: Archive, label: t('settings.auditLogs'), colorClass: 'orange' },
          { divider: true, id: 'div2' },
          { id: 'About', icon: Info, label: t('settings.about'), colorClass: 'cyan' }
        ].map((item) => {
          if (item.divider) return <div key={item.id} className={`my-3 pt-3 border-t ${isDark ? 'border-white/5' : 'border-black/5'}`} />;
          
          const isActive = settingsActiveTab === item.id;
          const colorMap: Record<string, { active: string, inactive: string }> = {
            fuchsia: { active: 'bg-fuchsia-500/20 text-fuchsia-400 ring-1 ring-fuchsia-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]', inactive: 'hover:bg-fuchsia-500/10 hover:text-fuchsia-400' },
            emerald: { active: 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]', inactive: 'hover:bg-emerald-500/10 hover:text-emerald-400' },
            blue: { active: 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]', inactive: 'hover:bg-blue-500/10 hover:text-blue-400' },
            teal: { active: 'bg-teal-500/20 text-teal-400 ring-1 ring-teal-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]', inactive: 'hover:bg-teal-500/10 hover:text-teal-400' },
            orange: { active: 'bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]', inactive: 'hover:bg-orange-500/10 hover:text-orange-400' },
            cyan: { active: 'bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]', inactive: 'hover:bg-cyan-500/10 hover:text-cyan-400' },
          };
          
          const styles = colorMap[item.colorClass!];
          
          return (
            <button 
              key={item.id}
              onClick={() => setSettingsActiveTab(item.id as any)} 
              className={`flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-sm transition-all duration-300 text-left font-bold ${isActive ? styles.active : `border border-transparent ${isDark ? 'text-white/40' : 'text-black/40'} ${styles.inactive}`}`}
            >
              {item.icon && <item.icon className={`w-5 h-5 ${isActive ? '' : 'opacity-70'}`} />}
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
