// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeHostMap, type HomeHostMapHost } from './HomeHostMap';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  i18n: { language: 'en-US' },
  t: (key: string, values?: Record<string, unknown>) => {
    if (key.endsWith('.marker')) return `${values?.location}: ${values?.count} hosts`;
    if (key.endsWith('.regions')) return `regions: ${values?.count}`;
    if (key.endsWith('.unknownCount')) return `unknown: ${values?.count}`;
    return key;
  },
}) }));

let root: Root;
let container: HTMLDivElement;
let resize: ResizeObserverCallback | undefined;
const onSelect = vi.fn();
const europeanHosts: HomeHostMapHost[] = [
  { id: 'france', name: 'Paris', countryCode: 'FR' },
  { id: 'italy', name: 'Milan', countryCode: 'IT' },
];

beforeEach(() => {
  resize = undefined;
  onSelect.mockReset();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (hosts = europeanHosts, selectedId: string | null = 'france') => act(async () => {
  root.render(<HomeHostMap hosts={hosts} selectedId={selectedId} onSelect={onSelect} />);
});
const setWidth = (width: number) => act(async () => {
  resize?.([{ contentRect: { width, height: width / 2 } } as ResizeObserverEntry], {} as ResizeObserver);
});
const markers = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.home-host-map-marker'));

describe('map marker reachability', () => {
  it('groups overlapping France and Italy targets while keeping both hosts selectable', async () => {
    await render();
    await setWidth(500);
    expect(markers()).toHaveLength(1);
    expect(markers()[0].getAttribute('aria-label')).toContain('France');
    expect(markers()[0].getAttribute('aria-label')).toContain('Italy');
    expect(markers()[0].textContent).toContain('2');
    await act(async () => markers()[0].click());
    const select = container.querySelector('select')!;
    expect(Array.from(select.options).map(option => option.textContent)).toEqual([
      'welcome.home.map.selectHost', 'Paris · France', 'Milan · Italy',
    ]);
    await act(async () => {
      select.value = 'italy';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('italy');
    expect(container.querySelector('.home-host-map-counts')?.textContent).toContain('regions: 2');
  });

  it('recomputes groups on resize and keeps the selected host when markers separate', async () => {
    await render(europeanHosts, 'italy');
    await setWidth(1600);
    expect(markers()).toHaveLength(2);
    await setWidth(500);
    expect(markers()).toHaveLength(1);
    await act(async () => markers()[0].click());
    await setWidth(1600);
    expect(markers()).toHaveLength(2);
    expect(container.querySelector('select')).toBeNull();
    expect(markers().find(marker => marker.dataset.selected === 'true')?.getAttribute('aria-label')).toContain('Italy');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([[500, 2], [300, 3]])('separates France and Italy by zooming on a %ipx map, then restores the overview', async (width, steps) => {
    await render();
    await setWidth(width);
    expect(markers()).toHaveLength(1);

    const zoomIn = container.querySelector<HTMLButtonElement>('[aria-label="welcome.home.map.zoomIn"]')!;
    const reset = container.querySelector<HTMLButtonElement>('.home-host-map-zoom-value')!;
    for (let step = 0; step < steps; step++) await act(async () => zoomIn.click());

    const [france, italy] = markers();
    expect(france.getAttribute('aria-label')).toBe('France: 1 hosts');
    expect(italy.getAttribute('aria-label')).toBe('Italy: 1 hosts');
    await act(async () => italy.click());
    expect(onSelect).toHaveBeenCalledWith('italy');

    await act(async () => reset.click());
    expect(reset.textContent).toBe('100%');
    expect(markers()).toHaveLength(1);
  });

  it('keeps distant countries separate and includes country names for same-country hosts', async () => {
    await render([
      ...europeanHosts,
      { id: 'france-2', name: 'Paris backup', countryCode: 'FR' },
      { id: 'us', name: 'Virginia', countryCode: 'US' },
    ]);
    await setWidth(500);
    expect(markers()).toHaveLength(2);
    const europe = markers().find(marker => marker.getAttribute('aria-label')?.includes('France'))!;
    await act(async () => europe.click());
    expect(container.querySelector('select')?.textContent).toContain('Paris backup · France');
    const us = markers().find(marker => marker.getAttribute('aria-label')?.includes('United States'))!;
    await act(async () => us.click());
    expect(onSelect).toHaveBeenCalledWith('us');
  });

  it('accounts for country codes without map anchors instead of losing them from both counts', async () => {
    await render([
      { id: 'outlying', name: 'Outlying islands', countryCode: 'UM' },
      { id: 'unknown', name: 'Unknown', countryCode: null },
    ], 'outlying');
    await setWidth(500);
    expect(markers()).toHaveLength(0);
    expect(container.querySelector('.home-host-map-counts')?.textContent).toContain('regions: 0');
    expect(container.querySelector('.home-host-map-counts')?.textContent).toContain('unknown: 2');
  });
});
