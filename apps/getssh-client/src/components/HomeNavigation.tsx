import { Folder, House, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WorkspaceSentinel } from './WorkspaceSentinel';
import './HomeNavigation.css';

interface HomeNavigationProps {
  onHome: () => void;
  onHosts: () => void;
  hostsOpen: boolean;
  onFiles: () => void;
  canOpenFiles: boolean;
  poll?: boolean;
}

export function HomeNavigation({ onHome, onHosts, hostsOpen, onFiles, canOpenFiles, poll }: HomeNavigationProps) {
  const { t } = useTranslation();
  const files = t('welcome.home.navigation.files', 'Files');

  return (
    <nav className="home-navigation no-drag-region" aria-label={t('welcome.home.navigation.label', 'Home navigation')}>
      <div className="home-navigation-list">
        <button type="button" className="home-navigation-item" aria-current="page" onClick={onHome}>
          <House size={19} aria-hidden="true" /><span>{t('tabs.home')}</span>
        </button>
        <button type="button" className="home-navigation-item" aria-expanded={hostsOpen} onClick={onHosts}>
          <Server size={19} aria-hidden="true" /><span>{t('welcome.home.navigation.hosts', 'Hosts')}</span>
        </button>
        <button type="button" className="home-navigation-item" disabled={!canOpenFiles} onClick={onFiles}
          title={canOpenFiles ? files : t('sftp.disabledHint')}>
          <Folder size={19} aria-hidden="true" /><span>{files}</span>
        </button>
      </div>

      <div className="home-navigation-sentinel"><WorkspaceSentinel poll={poll} /></div>
    </nav>
  );
}
