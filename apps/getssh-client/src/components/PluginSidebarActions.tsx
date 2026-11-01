import React from 'react';
import { useTranslation } from 'react-i18next';
import { Puzzle } from 'lucide-react';
import { usePluginStore } from '../store/pluginStore';

/**
 * A plugin's icon as the mask of a span filled with the text color, the way an image shows an
 * SVG: no scripts, links or outside loads. The SVG never becomes markup in this window, where an
 * <a href="javascript:…"> left in it would run on a click with window.electronAPI in reach.
 */
function iconMask(svg: string): React.CSSProperties {
  const image = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  return {
    maskImage: image, WebkitMaskImage: image,
    maskSize: 'contain', WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center', WebkitMaskPosition: 'center',
  };
}

/** The buttons plugins add with registerSidebarAction(), from renderer.js or a panel. */
export const PluginSidebarActions: React.FC = () => {
  const { t } = useTranslation();
  const actions = usePluginStore(state => state.sidebarActions);
  if (!actions.length) return null;
  const heading = t('settings.plugins');

  return (
    <div className="no-drag-region flex-none space-y-1.5">
      <div className="px-1 text-[11px] font-medium text-ink-3">{heading}</div>
      <div role="toolbar" aria-label={heading} className="flex flex-wrap items-center gap-1 px-0.5">
        {actions.map(action => (
          <button
            key={action.id}
            type="button"
            onClick={action.onClick}
            title={action.label || heading}
            aria-label={action.label || heading}
            className="w-7 h-7 rounded-md grid place-items-center text-ink-2 transition-colors hover:bg-surf hover:text-primary
                       focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
          >
            {action.icon
              ? <span aria-hidden="true" className="w-4 h-4 bg-current" style={iconMask(action.icon)} />
              : <Puzzle className="w-4 h-4" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
};
