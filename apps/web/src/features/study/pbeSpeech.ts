export interface SpeechPort {
  speak(text: string, onEnd: () => void, onError: () => void): void;
  cancel(): void;
}

function aborted(): DOMException {
  return new DOMException('Presentation cancelled.', 'AbortError');
}

export async function readTwice(text: string, port: SpeechPort, signal: AbortSignal): Promise<'Audio' | 'TextFallback'> {
  if (signal.aborted) throw aborted();
  return new Promise((resolve, reject) => {
    let readings = 0;
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const finish = (value: 'Audio' | 'TextFallback') => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      port.cancel();
      cleanup();
      reject(aborted());
    };
    const speak = () => {
      if (signal.aborted) return abort();
      port.speak(text, () => {
        if (settled || signal.aborted) return;
        readings++;
        if (readings === 2) finish('Audio');
        else speak();
      }, () => finish('TextFallback'));
    };
    signal.addEventListener('abort', abort, { once: true });
    speak();
  });
}

/** Creates a browser speech port only when an installed local voice is available. */
export async function localSpeechPort(synthesis: SpeechSynthesis | undefined = window.speechSynthesis): Promise<SpeechPort | null> {
  if (!synthesis || typeof synthesis.getVoices !== 'function') return null;
  const local = () => synthesis.getVoices().find(voice => voice.localService);
  let voice = local();
  if (!voice) {
    await new Promise<void>(resolve => {
      const timeout = window.setTimeout(() => { synthesis.removeEventListener('voiceschanged', changed); resolve(); }, 250);
      const changed = () => { window.clearTimeout(timeout); synthesis.removeEventListener('voiceschanged', changed); resolve(); };
      synthesis.addEventListener('voiceschanged', changed, { once: true });
    });
    voice = local();
  }
  if (!voice) return null;
  return {
    speak(text, onEnd, onError) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice!;
      utterance.onend = onEnd;
      utterance.onerror = onError;
      synthesis.speak(utterance);
    },
    cancel: () => synthesis.cancel(),
  };
}
