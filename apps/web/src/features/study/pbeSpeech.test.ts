import { expect, it, vi } from 'vitest';
import { localSpeechPort, readTwice, type SpeechPort } from './pbeSpeech';

it('waits for two complete readings', async () => {
  const ends: (() => void)[] = [];
  const spoken: string[] = [];
  const port: SpeechPort = { speak: (text, end) => { spoken.push(text); ends.push(end); }, cancel: vi.fn() };
  const done = readTwice('For one point. Fixture 1:1. Name the label.', port, new AbortController().signal);
  expect(spoken).toHaveLength(1);
  ends[0](); await Promise.resolve();
  expect(spoken).toHaveLength(2);
  ends[1]();
  await expect(done).resolves.toBe('Audio');
});

it('uses disclosed fallback after a speech error', async () => {
  const port: SpeechPort = { speak: (_text, _end, error) => error(), cancel: vi.fn() };
  await expect(readTwice('Question', port, new AbortController().signal)).resolves.toBe('TextFallback');
});

it('cancels and rejects without completing when aborted', async () => {
  const controller = new AbortController();
  const port: SpeechPort = { speak: vi.fn(), cancel: vi.fn() };
  const done = readTwice('Question', port, controller.signal);
  controller.abort();
  await expect(done).rejects.toMatchObject({ name: 'AbortError' });
  expect(port.cancel).toHaveBeenCalledOnce();
});

it('waits for voiceschanged and accepts only a local voice', async () => {
  const events = new EventTarget();
  let voices: SpeechSynthesisVoice[] = [];
  const synthesis = { getVoices: () => voices, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), speak: vi.fn(), cancel: vi.fn() } as unknown as SpeechSynthesis;
  const pending = localSpeechPort(synthesis);
  voices = [{ localService: true } as SpeechSynthesisVoice];
  events.dispatchEvent(new Event('voiceschanged'));
  await expect(pending).resolves.not.toBeNull();
});
