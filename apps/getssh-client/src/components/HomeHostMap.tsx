import { useId, useLayoutEffect, useRef, useState } from 'react';
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

interface MarkerGroup {
  key: string;
  codes: string[];
  hosts: HomeHostMapHost[];
  x: number;
  y: number;
}

function groupNearbyMarkers(countries: Map<string, HomeHostMapHost[]>, width: number, height: number): MarkerGroup[] {
  const markers = Array.from(countries).sort(([a], [b]) => a.localeCompare(b)).map(([code, hosts]) => ({
    key: code, codes: [code], hosts, x: anchors[code]![0], y: anchors[code]![1],
  }));
  if (!width || !height) return markers;
  // Keep the 24 px button hit areas separated by 4 px. Recheck after each merge,
  // since moving a cluster to its centre can bring it close to another marker.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < markers.length && !merged; i++) {
      for (let j = i + 1; j < markers.length; j++) {
        const a = markers[i], b = markers[j];
        if (Math.abs(a.x - b.x) * width / 100 >= 28 || Math.abs(a.y - b.y) * height / 100 >= 28) continue;
        const codes = [...a.codes, ...b.codes].sort();
        markers[i] = {
          key: codes.join(','), codes, hosts: [...a.hosts, ...b.hosts],
          x: (a.x * a.codes.length + b.x * b.codes.length) / codes.length,
          y: (a.y * a.codes.length + b.y * b.codes.length) / codes.length,
        };
        markers.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return markers;
}

export function HomeHostMap({ hosts, selectedId, onSelect, loading }: HomeHostMapProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const choicesId = useId();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [openRegion, setOpenRegion] = useState<{ key: string; selection: string | null }>();
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = ({ width, height }: { width: number; height: number }) => setCanvasSize(previous =>
      previous.width === width && previous.height === height ? previous : { width, height });
    measure(canvas.getBoundingClientRect());
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      if (entries[0]) measure(entries[0].contentRect);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  const names = new Intl.DisplayNames(i18n.language || 'en', { type: 'region' });
  const groups = new Map<string, HomeHostMapHost[]>();
  for (const host of hosts) {
    if (!host.countryCode || !anchors[host.countryCode]) continue;
    const group = groups.get(host.countryCode);
    if (group) group.push(host);
    else groups.set(host.countryCode, [host]);
  }

  const markers = groupNearbyMarkers(groups, canvasSize.width, canvasSize.height);
  const regionName = (codes: string[]) => codes.map(code => names.of(code) || code).join(' · ');
  const selected = hosts.find(host => host.id === selectedId);
  const unknownCount = hosts.filter(host => !host.countryCode || !anchors[host.countryCode]).length;
  const expandedGroup = openRegion?.selection === selectedId ? markers.find(marker => marker.key === openRegion.key) : undefined;
  const detail = loading
    ? t('welcome.home.map.loading')
    : selected?.countryCode
      ? names.of(selected.countryCode) || selected.countryCode
      : t(selected ? 'welcome.home.map.unknown' : hosts.length ? 'welcome.home.map.selectHost' : 'welcome.home.map.empty');

  return (
    <section className="home-host-map" aria-labelledby={titleId} aria-busy={loading || undefined}>
      <header className="home-host-map-header">
        <p className="home-host-map-eyebrow">{t('welcome.home.map.title')}</p>
        <h2 id={titleId}>{t('welcome.home.map.headline')}</h2>
        <p>{t('welcome.home.map.description')}</p>
      </header>

      <div className="home-host-map-canvas" ref={canvasRef}>
        <svg viewBox={map.viewBox} aria-hidden="true">
          <path d={map.path} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
        </svg>
        {markers.map(group => {
          const { x, y } = group;
          const country = regionName(group.codes);
          const selectedMarker = group.hosts.some(host => host.id === selectedId);
          const expandable = group.hosts.length > 1;
          const expanded = !loading && expandable && expandedGroup?.key === group.key;
          return (
            <button
              key={group.key}
              type="button"
              className="home-host-map-marker"
              disabled={loading}
              style={{ left: `${x}%`, top: `${y}%` }}
              data-label-side={x < 18 ? 'right' : x > 82 ? 'left' : 'center'}
              data-selected={selectedMarker || expanded}
              data-grouped={expandable}
              aria-label={t('welcome.home.map.marker', { location: country, count: group.hosts.length })}
              aria-pressed={expandable ? undefined : selectedMarker}
              aria-expanded={expandable ? expanded : undefined}
              aria-controls={expanded ? choicesId : undefined}
              onClick={() => {
                if (expandable) setOpenRegion(expanded ? undefined : { key: group.key, selection: selectedId });
                else {
                  setOpenRegion(undefined);
                  onSelect(group.hosts[0].id);
                }
              }}
            >
              {expandable && <span className="home-host-map-marker-count" aria-hidden="true">{group.hosts.length > 99 ? '99+' : group.hosts.length}</span>}
              <span className="home-host-map-tooltip" aria-hidden="true">{country}</span>
            </button>
          );
        })}
      </div>

      <div className="home-host-map-detail">
        <MapPin size={17} aria-hidden="true" />
        {!loading && expandedGroup && expandedGroup.hosts.length > 1 ? (
          <div className="home-host-map-detail-text ui-section-enter" id={choicesId}>
            <strong>{regionName(expandedGroup.codes)}</strong>
            <select
              key={expandedGroup.key}
              autoFocus
              aria-label={t('welcome.home.map.selectHost')}
              value={expandedGroup.hosts.some(host => host.id === selectedId) ? selectedId! : ''}
              onChange={event => {
                const id = event.currentTarget.value;
                setOpenRegion({ key: expandedGroup.key, selection: id });
                onSelect(id);
              }}
            >
              <option value="" disabled>{t('welcome.home.map.selectHost')}</option>
              {expandedGroup.hosts.map(host => <option key={host.id} value={host.id}>{host.name} · {names.of(host.countryCode!) || host.countryCode}</option>)}
            </select>
          </div>
        ) : (
          <div className="home-host-map-detail-text" aria-live="polite">
            <strong className="ui-section-enter" key={detail}>{detail}</strong>
            {!loading && selected && (
              <small className="ui-section-enter" key={selected.id}>{selected.name}{selected.countryCode && ` · ${t('welcome.home.map.countryEstimate')}`}</small>
            )}
          </div>
        )}
      </div>

      <footer className="home-host-map-footer">
        {!loading && <span className="home-host-map-counts">
          <span>{t('welcome.home.map.regions', { count: groups.size })}</span>
          <span>{t('welcome.home.map.unknownCount', { count: unknownCount })}</span>
        </span>}
        <button type="button" onClick={() => window.electronAPI.openExternal('https://db-ip.com/db/download/ip-to-country-lite')}>
          {t('welcome.home.map.dbipCredit')}
        </button>
      </footer>
    </section>
  );
}
