import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {CharacterFullscreen} from './CharacterFullscreen';
import {PreviewModeToggle} from './PreviewModeToggle';
import {CharacterStage} from './CharacterPreview';
import {_resetTiltMotion} from './stageParallax';
import type {Configuration} from './composition';

const config: Configuration = {
  bodyType: 'male', style: 'curls', hairColor: 'brown', skin: 'medium',
  eyes: 'brown', attire: 'student', background: 'sunrise', slots: [null, null, null],
};

beforeEach(() => {
  // jsdom does not implement the dialog imperative API.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  }) as unknown as () => void;
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  }) as unknown as () => void;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function openDialog(props: Partial<React.ComponentProps<typeof CharacterFullscreen>> = {}) {
  const onClose = vi.fn();
  const onModeChange = vi.fn();
  render(<CharacterFullscreen config={config} mode="still" onModeChange={onModeChange} onClose={onClose} {...props}/>);
  return {onClose, onModeChange, dialog: screen.getByRole('dialog', {name: 'Character fullscreen preview'})};
}

describe('CharacterFullscreen', () => {
  it('opens as a modal dialog showing the character in the current mode', () => {
    const {dialog} = openDialog();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByRole('img', {name: /Pathfinder/i})).toBeInTheDocument();
  });

  it('shows the animated preview when the mode is 3D', () => {
    openDialog({mode: 'animated'});
    expect(screen.getByRole('img', {name: /animated preview/i})).toBeInTheDocument();
  });

  it('closes from the X button', () => {
    const {onClose} = openDialog();
    fireEvent.click(screen.getByRole('button', {name: 'Close fullscreen preview'}));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from a backdrop tap but not from taps inside the preview', () => {
    const {dialog, onClose} = openDialog();
    fireEvent.click(screen.getByRole('button', {name: '3D'}));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape via the dialog cancel event', () => {
    const {dialog, onClose} = openDialog();
    fireEvent(dialog, new Event('cancel', {bubbles: false, cancelable: true}));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches the 2D/3D mode inside fullscreen without closing', () => {
    const {onModeChange, onClose} = openDialog();
    fireEvent.click(screen.getByRole('button', {name: '3D'}));
    expect(onModeChange).toHaveBeenCalledWith('animated');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('PreviewModeToggle', () => {
  it('stops toggle clicks from reaching an outer tap target', () => {
    const outer = vi.fn();
    const onChange = vi.fn();
    render(<div onClick={outer}><PreviewModeToggle mode="still" onChange={onChange}/></div>);
    fireEvent.click(screen.getByRole('button', {name: '3D'}));
    expect(onChange).toHaveBeenCalledWith('animated');
    expect(outer).not.toHaveBeenCalled();
  });

  it('marks the active mode pressed', () => {
    render(<PreviewModeToggle mode="animated" onChange={vi.fn()}/>);
    expect(screen.getByRole('button', {name: '3D'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', {name: '2D'})).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('CharacterStage tap target', () => {
  it('opens fullscreen from a tap or keyboard on the stage', () => {
    const open = vi.fn();
    render(<CharacterStage background="sunrise" onActivate={open}><span>art</span></CharacterStage>);
    const stage = screen.getByRole('button', {name: 'Open fullscreen character preview'});
    fireEvent.click(stage);
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(stage, {key: 'Enter'});
    expect(open).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(stage, {key: ' '});
    expect(open).toHaveBeenCalledTimes(3);
  });

  it('renders a plain stage without a tap target when no activator is given', () => {
    render(<CharacterStage background="sunrise"><span>art</span></CharacterStage>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('art')).toBeInTheDocument();
  });
});

describe('TiltOptIn', () => {
  function stubIOSGate(result: 'granted' | 'denied') {
    const requestPermission = vi.fn().mockResolvedValue(result);
    const doe = {requestPermission};
    vi.stubGlobal('DeviceOrientationEvent', doe);
    (window as unknown as {DeviceOrientationEvent: unknown}).DeviceOrientationEvent = doe;
    return requestPermission;
  }

  afterEach(() => {
    delete (window as unknown as {DeviceOrientationEvent?: unknown}).DeviceOrientationEvent;
    _resetTiltMotion();
  });

  it('hides the tilt button where no iOS permission gate exists', () => {
    openDialog();
    expect(screen.queryByRole('button', {name: 'Enable tilt'})).not.toBeInTheDocument();
  });

  it('requests permission from the button tap and hides it once granted', async () => {
    const requestPermission = stubIOSGate('granted');
    openDialog();
    const button = screen.getByRole('button', {name: 'Enable tilt'});
    fireEvent.click(button);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', {name: 'Enable tilt'})).not.toBeInTheDocument());
  });

  it('fails silently when permission is denied', async () => {
    stubIOSGate('denied');
    openDialog();
    fireEvent.click(screen.getByRole('button', {name: 'Enable tilt'}));
    // No prompt retry, no error surface: the button just goes away and the
    // pointer path keeps working.
    await waitFor(() => expect(screen.queryByRole('button', {name: 'Enable tilt'})).not.toBeInTheDocument());
  });

  it('hides the tilt button under prefers-reduced-motion', () => {
    stubIOSGate('granted');
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion'),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    openDialog();
    expect(screen.queryByRole('button', {name: 'Enable tilt'})).not.toBeInTheDocument();
  });
});
