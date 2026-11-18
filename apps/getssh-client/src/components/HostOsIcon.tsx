import { Mountain, Network, Server, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import apple from '../assets/os/apple.svg';
import arch from '../assets/os/archlinux.svg';
import centos from '../assets/os/centos.svg';
import debian from '../assets/os/debian.svg';
import fedora from '../assets/os/fedora.svg';
import suse from '../assets/os/opensuse.svg';
import rhel from '../assets/os/redhat.svg';
import ubuntu from '../assets/os/ubuntu.svg';
import windows from '../assets/os/windows8.svg';
import type { OsType } from '../store/sessionStore';

const operatingSystems: Record<Exclude<OsType, 'generic'>, { name: string; image?: string; glyph?: LucideIcon }> = {
  alpine: { name: 'Alpine Linux', glyph: Mountain },
  arch: { name: 'Arch Linux', image: arch },
  centos: { name: 'CentOS', image: centos },
  cisco: { name: 'Cisco', glyph: Network },
  debian: { name: 'Debian', image: debian },
  fedora: { name: 'Fedora', image: fedora },
  huawei: { name: 'Huawei', glyph: Network },
  macos: { name: 'macOS', image: apple },
  rhel: { name: 'Red Hat Enterprise Linux', image: rhel },
  suse: { name: 'SUSE / openSUSE', image: suse },
  ubuntu: { name: 'Ubuntu', image: ubuntu },
  windows: { name: 'Windows', image: windows },
};

export function HostOsIcon({ osType }: { osType?: OsType }) {
  const { t } = useTranslation();
  const os = osType && osType !== 'generic' && Object.hasOwn(operatingSystems, osType) ? operatingSystems[osType] : undefined;
  const name = os?.name || t('welcome.home.unknownOS', 'Unknown operating system');
  const Glyph = os?.glyph ?? Server;

  return (
    <span className="grid size-8 shrink-0 place-items-center text-ink-2" role="img" aria-label={name} title={name}>
      {os?.image
        ? <img src={os.image} alt="" width={22} height={22} className={`object-contain ${osType === 'macos' ? 'dark:invert' : ''}`} />
        : <Glyph size={18} aria-hidden="true" />}
    </span>
  );
}
