import { useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { MapPin, Minus, Plus } from 'lucide-react';
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
const [mapLeft, mapTop, mapWidth, mapHeight] = map.viewBox.split(' ').map(Number);
const overview = { zoom: 1, x: 50, y: 50 };
const maxZoom = 8;
const panKeys: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12],
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mapView(zoom: number, x: number, y: number) {
  const half = 50 / zoom;
  return { zoom, x: clamp(x, half, 100 - half), y: clamp(y, half, 100 - half) };
}

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
  const canvasId = useId();
  const landId = useId();
  const dotsId = useId();
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [openRegion, setOpenRegion] = useState<{ key: string; selection: string | null }>();
  const [camera, setCamera] = useState(overview);
  const view = mapView(camera.zoom, camera.x, camera.y);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = ({ width, height }: { width: number; height: number }) => setCanvasSize(previous =>
      previous.width === width && previous.height === height ? previous : { width, height });
    measure(canvas.getBoundingClientRect());
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
      if (entries[0]) measure(entries[0].contentRect);
    });
    observer?.observe(canvas);
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !event.deltaY) return;
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      event.preventDefault();
      const dx = (event.clientX - bounds.left) * 100 / bounds.width - 50;
      const dy = (event.clientY - bounds.top) * 100 / bounds.height - 50;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
      const factor = Math.exp(clamp(-event.deltaY * unit / 100, -1, 1));
      setCamera(current => {
        const zoom = clamp(current.zoom * factor, 1, maxZoom);
        if (zoom === current.zoom) return current;
        if (zoom === 1) return overview;
        const visible = mapView(current.zoom, current.x, current.y);
        const shift = 1 / current.zoom - 1 / zoom;
        return mapView(zoom, visible.x + dx * shift, visible.y + dy * shift);
      });
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      observer?.disconnect();
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, []);
  const names = useMemo(() => new Intl.DisplayNames(i18n.language || 'en', { type: 'region' }), [i18n.language]);
  const groups = useMemo(() => {
    const byCountry = new Map<string, HomeHostMapHost[]>();
    for (const host of hosts) {
      if (!host.countryCode || !anchors[host.countryCode]) continue;
      const group = byCountry.get(host.countryCode);
      if (group) group.push(host);
      else byCountry.set(host.countryCode, [host]);
    }
    return byCountry;
  }, [hosts]);
  const markers = useMemo(() => groupNearbyMarkers(groups, canvasSize.width * view.zoom, canvasSize.height * view.zoom),
    [groups, canvasSize, view.zoom]);
  const regionName = (codes: string[]) => codes.map(code => names.of(code) || code).join(' · ');
  const selected = hosts.find(host => host.id === selectedId);
  const selectedAnchor = selected?.countryCode ? anchors[selected.countryCode] : undefined;
  useLayoutEffect(() => {
    if (!selectedAnchor) return;
    const [x, y] = selectedAnchor;
    setCamera(current => {
      const visible = mapView(current.zoom, current.x, current.y);
      const half = 50 / current.zoom;
      return Math.abs(x - visible.x) < half && Math.abs(y - visible.y) < half
        ? current : { zoom: current.zoom, x, y };
    });
  }, [selectedAnchor]);

  const zoomBy = (factor: number) => setCamera(current => {
    const zoom = clamp(current.zoom * factor, 1, maxZoom);
    if (zoom === current.zoom) return current;
    if (zoom === 1) return overview;
    // Keep the focal point even when the world edge temporarily limits the visible centre.
    const [x, y] = current.zoom === 1 && selectedAnchor ? selectedAnchor : [current.x, current.y];
    return { zoom, x, y };
  });

  const panBy = (dx: number, dy: number) => setCamera(current => {
    const visible = mapView(current.zoom, current.x, current.y);
    return mapView(current.zoom, visible.x + dx / current.zoom, visible.y + dy / current.zoom);
  });

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (view.zoom === 1 || event.button !== 0 || !event.isPrimary || (event.target as Element).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const dragMap = (event: PointerEvent<HTMLDivElement>) => {
    const previous = drag.current;
    if (previous?.pointerId !== event.pointerId || !canvasSize.width || !canvasSize.height) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    panBy((previous.x - event.clientX) * 100 / canvasSize.width, (previous.y - event.clientY) * 100 / canvasSize.height);
  };

  const half = 50 / view.zoom;
  const viewBox = [mapLeft + mapWidth * (view.x - half) / 100, mapTop + mapHeight * (view.y - half) / 100,
    mapWidth / view.zoom, mapHeight / view.zoom].join(' ');
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
        <div className="home-host-map-heading-row">
          <p className="home-host-map-eyebrow">{t('welcome.home.map.title')}</p>
          <div className="home-host-map-controls" role="group" aria-label={t('welcome.home.map.zoomControls')}>
            <button type="button" aria-controls={canvasId} aria-label={t('welcome.home.map.zoomOut')} title={t('welcome.home.map.zoomOut')}
              aria-disabled={view.zoom === 1} onClick={() => zoomBy(0.5)}><Minus size={14} aria-hidden="true" /></button>
            <button type="button" aria-controls={canvasId} aria-label={t('welcome.home.map.resetZoom', { zoom: Math.round(view.zoom * 100) })}
              title={t('welcome.home.map.resetZoom', { zoom: Math.round(view.zoom * 100) })} className="home-host-map-zoom-value"
              onClick={() => setCamera(overview)}>{Math.round(view.zoom * 100)}%</button>
            <button type="button" aria-controls={canvasId} aria-label={t('welcome.home.map.zoomIn')} title={t('welcome.home.map.zoomIn')}
              aria-disabled={view.zoom === maxZoom} onClick={() => zoomBy(2)}><Plus size={14} aria-hidden="true" /></button>
          </div>
        </div>
        <h2 id={titleId}>{t('welcome.home.map.headline')}</h2>
        <p>{t('welcome.home.map.description')}</p>
      </header>

      <div className="home-host-map-canvas" id={canvasId} ref={canvasRef} role="group" aria-label={t('welcome.home.map.title')}
        aria-description={t('welcome.home.map.navigation')} tabIndex={0} data-zoomed={view.zoom > 1}
        onPointerDown={startPan} onPointerMove={dragMap}
        onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
          const delta = Object.hasOwn(panKeys, event.key) ? panKeys[event.key] : undefined;
          if (delta && view.zoom > 1) panBy(...delta);
          else if (event.key === '+' || event.key === '=') zoomBy(2);
          else if (event.key === '-') zoomBy(0.5);
          else if (event.key === 'Home') setCamera(overview);
          else return;
          event.preventDefault();
        }}>
        <svg viewBox={viewBox} aria-hidden="true">
          <defs>
            <path id={landId} d={map.landPath} fillRule="evenodd" vectorEffect="non-scaling-stroke" />
            <pattern id={dotsId} width={6 / view.zoom} height={6 / view.zoom} patternUnits="userSpaceOnUse" viewBox="0 0 6 6">
              <circle className="home-host-map-dot" cx="3" cy="3" r="1.05" />
            </pattern>
          </defs>
          <use href={`#${landId}`} className="home-host-map-land" />
          <use href={`#${landId}`} fill={`url(#${dotsId})`} />
        </svg>
        {markers.map(group => {
          const x = (group.x - view.x) * view.zoom + 50;
          const y = (group.y - view.y) * view.zoom + 50;
          if (x < 0 || x > 100 || y < 0 || y > 100) return null;
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
              data-label-above={y > (view.zoom > 1 ? 22 : 78) || undefined}
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
