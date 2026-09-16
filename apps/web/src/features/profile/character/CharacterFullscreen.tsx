import {useEffect, useRef, useState} from 'react';
import type {Configuration} from './composition';
import {Button} from '../../../components/ui';
import {CharacterPreview} from './CharacterPreview';
import {AnimatedCharacterView} from './AnimatedCharacterView';
import {PreviewModeToggle, type PreviewMode} from './PreviewModeToggle';
import {enableTiltMotion, isTiltOptedIn, needsMotionPermission, prefersReducedMotion} from './stageParallax';

/**
 * iOS-only tilt opt-in button. Tapping the character preview already asks
 * for motion permission on the way in, so this button is the fallback: it
 * only shows where the iOS permission gate exists and tilt is not yet live
 * (e.g. the request was declined earlier and the user changed their mind).
 * A denied or unavailable grant fails silently and the pointer path keeps
 * working.
 */
function TiltOptIn() {
  const [done, setDone] = useState(false);
  const [live, setLive] = useState(isTiltOptedIn);
  useEffect(() => {
    const onGranted = () => setLive(true);
    window.addEventListener('erudoza:tilt-granted', onGranted);
    return () => window.removeEventListener('erudoza:tilt-granted', onGranted);
  }, []);
  if (done || live || !needsMotionPermission() || prefersReducedMotion()) return null;
  return <Button variant="secondary" size="compact"
    onClick={() => { void enableTiltMotion().then(() => setDone(true)); }}>
    Enable tilt
  </Button>;
}

/**
 * Fullscreen character preview. Opens from a tap on the inline preview card;
 * shows the character large in the current view mode (animated when 3D, still
 * when 2D) with the 2D/3D toggle available inside and the blurred scene
 * backdrop filling the screen behind it. On iPhones an "Enable tilt" button
 * offers the one-time gyroscope opt-in so tilting the phone drives the
 * parallax depth too. Native <dialog> gives Escape, focus
 * containment, and background scroll lock; focus returns to the preview card
 * on close. Closes via the X button, a tap on the backdrop, or Escape.
 */
export function CharacterFullscreen({config, mode, onModeChange, onClose, onError}: {
  config: Configuration;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  onClose: () => void;
  onError?: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLButtonElement>('[data-close]')?.focus();
    return () => {
      element.close();
      if (trigger?.isConnected) trigger.focus({preventScroll: true});
    };
  }, []);
  return <dialog ref={dialog} className="ds-dialog character-fullscreen" aria-label="Character fullscreen preview"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
    <div className="character-fullscreen-inner">
      <div className="character-fullscreen-bar">
        <PreviewModeToggle mode={mode} onChange={onModeChange}/>
        <TiltOptIn/>
        <Button variant="secondary" size="compact" data-close onClick={onClose} aria-label="Close fullscreen preview">✕</Button>
      </div>
      <div className="character-fullscreen-stage">
        {mode === 'animated'
          ? <AnimatedCharacterView config={config} onError={onError}/>
          : <CharacterPreview config={config} onError={onError}/>}
      </div>
    </div>
  </dialog>;
}
