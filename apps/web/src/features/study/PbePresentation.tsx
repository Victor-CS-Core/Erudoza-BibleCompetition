import { useEffect, useRef, useState } from 'react';
import { Button, Notice, Panel } from '../../components/ui';
import { localSpeechPort, readTwice, type SpeechPort } from './pbeSpeech';

type Delivery = 'Audio' | 'TextFallback' | 'Coach';

export function PbePresentation({ text, onReady, createPort = localSpeechPort }: {
  text: string;
  onReady: (delivery: Delivery) => void;
  createPort?: () => Promise<SpeechPort | null>;
}) {
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<'Ready' | 'Speaking' | 'Fallback1' | 'Fallback2' | 'Complete'>('Ready');
  useEffect(() => () => controller.current?.abort(), []);
  const begin = async () => {
    if (state !== 'Ready') return;
    if (document.visibilityState === 'hidden') { setState('Fallback1'); return; }
    setState('Speaking');
    const abort = new AbortController();
    controller.current = abort;
    const port = await createPort();
    if (abort.signal.aborted) return;
    if (!port) { setState('Fallback1'); return; }
    try {
      const delivery = await readTwice(text, port, abort.signal);
      if (delivery === 'Audio') { setState('Complete'); onReady('Audio'); }
      else setState('Fallback1');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setState('Fallback1');
    }
  };
  const confirm = () => {
    if (state === 'Fallback1') setState('Fallback2');
    else if (state === 'Fallback2') { setState('Complete'); onReady('TextFallback'); }
  };
  return <Panel aria-label="Question presentation">
    {state === 'Ready' && <><p>The reference, point value, and question will be read twice.</p><Button onClick={() => void begin()}>I’m ready to hear the question</Button></>}
    {state === 'Speaking' && <p role="status">Reading the question twice…</p>}
    {(state === 'Fallback1' || state === 'Fallback2') && <><Notice>Audio is unavailable. Use the disclosed text fallback; this does not reproduce an audible event reading.</Notice><p className="er-scripture">{text}</p><p role="status">Text reading {state === 'Fallback1' ? '1' : '2'} of 2</p><Button onClick={confirm}>Finished {state === 'Fallback1' ? 'first' : 'second'} reading</Button></>}
    {state === 'Complete' && <p role="status">Presentation complete. Waiting for the response window.</p>}
  </Panel>;
}
