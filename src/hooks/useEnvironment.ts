/** Browser environment wiring: reduced motion, page visibility, fullscreen, unload. */
import { useEffect } from 'react';
import type { AppServices } from '../app/context';

export function useEnvironmentSync({ studio, ui }: AppServices): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => studio.setSystemReducedMotion(media.matches);
    syncMotion();
    media.addEventListener('change', syncMotion);

    const onVisibility = () => studio.setPageHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);

    const onPageHide = () => studio.flushPersistence();
    window.addEventListener('pagehide', onPageHide);

    // Leaving browser fullscreen (e.g. via the browser's own Esc) also leaves zen.
    const onFullscreen = () => {
      if (!document.fullscreenElement && ui.getState().zen) ui.setState({ zen: false });
    };
    document.addEventListener('fullscreenchange', onFullscreen);

    return () => {
      media.removeEventListener('change', syncMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [studio, ui]);
}
