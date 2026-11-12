import { useId, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import map from '../assets/home-host-map.json';
import './HomeHostMap.css';

export interface HomeHostMapHost {
  id: string;
  name: string;
  countryCode: string | null;
}

interface HomeHostMapProps {
  hosts: HomeHostMapHost[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

const anchors: Record<string, number[] | undefined> = map.anchors;

export function HomeHostMap({ hosts, selectedId, onSelect, loading }: HomeHostMapProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const choicesId = useId();
  const [openRegion, setOpenRegion] = useState<{ code: string; selection: string | null }>();
  const names = new Intl.DisplayNames(i18n.language || 'en', { type: 'region' });
  const groups = new Map<string, HomeHostMapHost[]>();
  for (const host of hosts) {
    if (!host.countryCode || !anchors[host.countryCode]) continue;
    const group = groups.get(host.countryCode);
    if (group) group.push(host);
    else groups.set(host.countryCode, [host]);
  }

  const selected = hosts.find(host => host.id === selectedId);
  const unknownCount = hosts.filter(host => !host.countryCode).length;
  const expandedCode = openRegion && openRegion.selection === selectedId ? openRegion.code : undefined;
  const expandedGroup = expandedCode ? groups.get(expandedCode) : undefined;
  const detail = loading
    ? t('welcome.home.map.loading')
    : selected?.countryCode
      ? names.of(selected.countryCode) || selected.countryCode
      : t(selected ? 'welcome.home.map.unknown' : hosts.length ? 'welcome.home.map.selectHost' : 'welcome.home.map.empty');

  return (
    <section className="home-host-map" aria-labelledby={titleId} aria-busy={loading || undefined}>
      <header className="home-host-map-header">
        <h2 id={titleId}>{t('welcome.home.map.title')}</h2>
        {!loading && <span>{t('welcome.home.map.regions', { count: groups.size })}</span>}
      </header>

      <div className="home-host-map-canvas">
        <svg viewBox={map.viewBox} aria-hidden="true">
          <path d={map.path} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
        </svg>
        {Array.from(groups, ([code, group]) => {
          const [x, y] = anchors[code]!;
          const country = names.of(code) || code;
          const selectedMarker = selected?.countryCode === code;
          const expandable = group.length > 1;
          const expanded = !loading && expandable && expandedCode === code;
          return (
            <button
              key={code}
              type="button"
              className="home-host-map-marker"
              disabled={loading}
              style={{ left: `${x}%`, top: `${y}%` }}
              data-label-side={x < 18 ? 'right' : x > 82 ? 'left' : 'center'}
              data-selected={selectedMarker || expanded}
              aria-label={t('welcome.home.map.marker', { location: country, count: group.length })}
              aria-pressed={expandable ? undefined : selectedMarker}
              aria-expanded={expandable ? expanded : undefined}
              aria-controls={expanded ? choicesId : undefined}
              onClick={() => {
                if (expandable) setOpenRegion(expanded ? undefined : { code, selection: selectedId });
                else {
                  setOpenRegion(undefined);
                  onSelect(group[0].id);
                }
              }}
            >
              <span className="home-host-map-tooltip" aria-hidden="true">{country}</span>
            </button>
          );
        })}
      </div>

      <div className="home-host-map-detail">
        <MapPin size={17} aria-hidden="true" />
        {!loading && expandedCode && expandedGroup && expandedGroup.length > 1 ? (
          <div className="home-host-map-detail-text" id={choicesId}>
            <strong>{names.of(expandedCode) || expandedCode}</strong>
            <select
              key={expandedCode}
              autoFocus
              aria-label={t('welcome.home.map.selectHost')}
              value={expandedGroup.some(host => host.id === selectedId) ? selectedId! : ''}
              onChange={event => {
                const id = event.currentTarget.value;
                setOpenRegion({ code: expandedCode, selection: id });
                onSelect(id);
              }}
            >
              <option value="" disabled>{t('welcome.home.map.selectHost')}</option>
              {expandedGroup.map(host => <option key={host.id} value={host.id}>{host.name}</option>)}
            </select>
          </div>
        ) : (
          <div className="home-host-map-detail-text" aria-live="polite">
            <strong>{detail}</strong>
            {!loading && selected && (
              <small>{selected.name}{selected.countryCode && ` · ${t('welcome.home.map.countryEstimate')}`}</small>
            )}
          </div>
        )}
      </div>

      <footer className="home-host-map-footer">
        {!loading && <span>{t('welcome.home.map.unknownCount', { count: unknownCount })}</span>}
        <button type="button" onClick={() => window.electronAPI.openExternal('https://db-ip.com/db/download/ip-to-country-lite')}>
          {t('welcome.home.map.dbipCredit')}
        </button>
      </footer>
    </section>
  );
}
