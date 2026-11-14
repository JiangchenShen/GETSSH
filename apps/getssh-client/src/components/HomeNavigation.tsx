import { Blocks, Folder, House, Server, Settings, Sparkles, SquareTerminal, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { WorkspaceSentinel } from './WorkspaceSentinel';
import './HomeNavigation.css';

interface HomeNavigationProps {
  onHome: () => void;
  onHosts: () => void;
  hostsOpen: boolean;
  onTerminal: () => void;
  onFiles: () => void;
  canOpenFiles: boolean;
  poll?: boolean;
}

export function HomeNavigation({ onHome, onHosts, hostsOpen, onTerminal, onFiles, canOpenFiles, poll }: HomeNavigationProps) {
  const { t } = useTranslation();
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);

  const destinations = [
    { type: 'ai', title: t('statusBar.ai'), Icon: Sparkles },
    { type: 'plugin', title: t('statusBar.plugins'), Icon: Blocks },
    { type: 'settings', title: t('statusBar.settings'), Icon: Settings },
  ];
  const files = t('welcome.home.navigation.files', 'Files');
  const commandCenter = t('statusBar.commandCenter');

  return (
    <nav className="home-navigation no-drag-region" aria-label={t('welcome.home.navigation.label', 'Home navigation')}>
      <div className="home-navigation-list">
        <button type="button" className="home-navigation-item" aria-current="page" onClick={onHome}>
          <House size={19} aria-hidden="true" /><span>{t('tabs.home')}</span>
        </button>
        <button type="button" className="home-navigation-item" aria-expanded={hostsOpen} onClick={onHosts}>
          <Server size={19} aria-hidden="true" /><span>{t('welcome.home.navigation.hosts', 'Hosts')}</span>
        </button>
        <button type="button" className="home-navigation-item" onClick={onTerminal}>
          <SquareTerminal size={19} aria-hidden="true" /><span>{t('welcome.home.navigation.terminal', 'Terminal')}</span>
        </button>
        <button type="button" className="home-navigation-item" disabled={!canOpenFiles} onClick={onFiles}
          title={canOpenFiles ? files : t('sftp.disabledHint')}>
          <Folder size={19} aria-hidden="true" /><span>{files}</span>
        </button>

        <div className="home-navigation-tools">
          <button type="button" className="home-navigation-item" title={commandCenter} aria-label={commandCenter}
            onClick={() => setIsCommandCenterOpen(true)}>
            <Terminal size={18} aria-hidden="true" />
          </button>
          {destinations.map(({ type, title, Icon }) => (
            <button type="button" key={type} className="home-navigation-item" title={title} aria-label={title}
              onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type, title } }))}>
              <Icon size={18} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div className="home-navigation-sentinel"><WorkspaceSentinel poll={poll} /></div>
    </nav>
  );
}
