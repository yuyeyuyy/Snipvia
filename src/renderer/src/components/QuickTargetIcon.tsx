import { useState } from 'react';
import type { QuickTargetView } from '../../../shared/quick-target';
import { Icon } from './Icon';
import { quickTargetBrandPaths } from './QuickTargetBrands';
import './quick-target-icon.css';

/** Receives only local PNG data and presets; never fetches a remote URL from Renderer. */
export function QuickTargetIcon({ target, size = 34 }: { target: Pick<QuickTargetView, 'kind' | 'icon' | 'websiteIcon' | 'browserIcon'>; size?: number }) {
  const [failedSource, setFailedSource] = useState<string>(), [failedBadge, setFailedBadge] = useState<string>();
  const source = target.icon;
  const brand = target.kind === 'website' && target.websiteIcon ? quickTargetBrandPaths[target.websiteIcon] : undefined;
  return <span className="quick-target-artwork" style={{ width: size, height: size }} aria-hidden="true">
    {source && source !== failedSource
      ? <img className={target.kind === 'website' ? 'quick-target-site-image' : undefined} src={source} alt="" draggable={false} onError={() => setFailedSource(source)} />
      : brand ? <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd"><path d={brand} /></svg>
        : <Icon name={target.kind === 'website' ? 'globe' : 'brand'} size={size} />}
    {target.kind === 'website' && <span className="quick-target-browser-badge">
      {target.browserIcon && target.browserIcon !== failedBadge ? <img src={target.browserIcon} alt="" draggable={false} onError={() => setFailedBadge(target.browserIcon)} /> : <Icon name="globe" size={11} />}
    </span>}
  </span>;
}
