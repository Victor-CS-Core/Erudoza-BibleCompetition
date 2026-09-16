import {useEffect, useRef, useState} from 'react';
import type {Configuration} from './composition';
import {Button} from '../../../components/ui';
import {CharacterPreview} from './CharacterPreview';
import {AnimatedCharacterView} from './AnimatedCharacterView';
import {PreviewModeToggle, type PreviewMode} from './PreviewModeToggle';
import {enableTiltMotion, needsMotionPermission, prefersReducedMotion} from './stageParallax';

/**
 * iOS-only one-time tilt opt-in. The tap is the user gesture
 * DeviceOrientationEvent.requestPermission() requires; a denied or
 * unavailable grant fails silently and the pointer path keeps working. The
 * button only renders where the iOS permission gate exists.
 */
function TiltOptIn() {
  const [done, setDone] = useState(false);
  if (done || !needsMotionPermission() || prefersReducedMotion()) return null;
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
