import { Blocks, Command, House, Server, Settings, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { WorkspaceSentinel } from './WorkspaceSentinel';
import './HomeNavigation.css';

interface HomeNavigationProps {
  onHome: () => void;
  onHosts: () => void;
  hostsOpen: boolean;
  poll?: boolean;
}

const centers = [
  { type: 'ai', label: 'statusBar.ai', Icon: Sparkles },
  { type: 'plugin', label: 'statusBar.plugins', Icon: Blocks },
  { type: 'settings', label: 'statusBar.settings', Icon: Settings },
] as const;

export function HomeNavigation({ onHome, onHosts, hostsOpen, poll }: HomeNavigationProps) {
  const { t } = useTranslation();
  const setCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);

  return (
    <nav className="home-navigation no-drag-region" aria-label={t('welcome.home.navigation.label', 'Home navigation')}>
      <div className="home-navigation-list">
        <button type="button" className="home-navigation-item" aria-current="page" onClick={onHome}>
          <House size={19} aria-hidden="true" /><span>{t('tabs.home')}</span>
        </button>
        <button type="button" className="home-navigation-item" aria-expanded={hostsOpen} onClick={onHosts}>
          <Server size={19} aria-hidden="true" /><span>{t('welcome.home.navigation.hosts', 'Hosts')}</span>
        </button>
        <div className="home-navigation-tools">
          {centers.map(({ type, label, Icon }) => {
            const title = t(label);
            return (
              <button type="button" key={type} className="home-navigation-item" onClick={() => {
                window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type, title } }));
              }}>
                <Icon size={19} aria-hidden="true" /><span>{title}</span>
              </button>
            );
          })}
          <button type="button" className="home-navigation-item" onClick={() => setCommandCenterOpen(true)}>
            <Command size={19} aria-hidden="true" /><span>{t('statusBar.commandCenter')}</span>
          </button>
        </div>
      </div>

      <div className="home-navigation-sentinel"><WorkspaceSentinel poll={poll} /></div>
    </nav>
  );
}
