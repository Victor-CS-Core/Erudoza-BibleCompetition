import { useEffect, useRef, useState } from "react";
import { Button, Panel, Textarea } from "../../components/ui";
import { diffWords, type DiffToken } from "./wordDiff";

function DiffTokens({ tokens }: { tokens: DiffToken[] }) {
  return <>{tokens.map((token, index) => <span key={index}>{index > 0 ? " " : ""}<span className={`diff-token diff-${token.status}`}>{token.text}</span></span>)}</>;
}

/**
 * Optional full-verse recitation aid with a microphone option.
 *
 * Voice input uses the browser-native Web Speech API
 * (SpeechRecognition / webkitSpeechRecognition) only: no external speech
 * service, no API keys, and no audio is uploaded or stored anywhere. The
 * transcript lands in the same text box as typing, stays editable, and is
 * never submitted anywhere — this panel is private, unscored practice, so
 * reciting can never auto-submit an answer. The app's content is English
 * (NKJV) and the UI has no locale switcher, so recognition is pinned to
 * en-US.
 */

interface SpeechResultLike { isFinal: boolean; 0: { transcript: string } }
interface SpeechResultEventLike { resultIndex: number; results: ArrayLike<SpeechResultLike> }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function RecitationPanel({ compareSourceText }: {
  /** The checked card's verse text from the attempt result. Only passed
   * once the card has been checked, so comparing a recitation against it
   * costs nothing: no reader trip, no assistance change, nothing sent to
   * the server — the answer is already revealed by the feedback. */
  compareSourceText?: string;
} = {}) {
  const [text, setText] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(() => recognitionCtor() !== undefined);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");
  const finalRef = useRef("");

  useEffect(() => () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null; recognition.onerror = null; recognition.onend = null;
      try { recognition.stop(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    }
  }, []);

  const stop = () => {
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    setListening(false);
  };

  const start = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    baseRef.current = text.trim();
    finalRef.current = "";
    const recognition = new Ctor();
    recognitionRef.current = recognition;
    // App content is English (NKJV) and there is no app locale setting.
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalRef.current = `${finalRef.current} ${result[0].transcript}`.trim();
        else interim = `${interim} ${result[0].transcript}`.trim();
      }
      const spoken = `${finalRef.current} ${interim}`.trim();
      setText(baseRef.current ? `${baseRef.current} ${spoken}`.trim() : spoken);
    };
    recognition.onerror = (event) => {
      setListening(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was blocked. Check the browser's microphone permission, or type your recitation instead.");
      } else if (event.error === "audio-capture") {
        setError("No microphone was found. You can type your recitation instead.");
      } else if (event.error !== "aborted" && event.error !== "no-speech") {
        setError("Voice recitation stopped unexpectedly. You can type your recitation instead.");
      }
    };
    recognition.onend = () => setListening(false);
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      setError("Voice recitation could not start. You can type your recitation instead.");
    }
  };

  return (
    <Panel>
      <details>
        <summary>Optional full-verse recitation</summary>
        <p>Recite aloud or type from memory, then compare with the passage reader. This private practice is not scored and does not earn mastery evidence.</p>
        <label>
          Your private recitation practice
          <Textarea rows={4} className="mt-2 w-full" value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <div className="student-study-actions">
          {supported ? (
            <Button
              type="button"
              variant={listening ? "primary" : "secondary"}
              className={listening ? "recitation-mic is-listening" : "recitation-mic"}
              aria-pressed={listening}
              onClick={() => (listening ? stop() : start())}
            >
              {listening ? "Stop reciting" : "Tap to recite"}
            </Button>
          ) : (
            <p className="text-sm">Voice recitation isn't available in this browser — you can type it instead.</p>
          )}
          {listening && <p className="text-sm" aria-live="polite">Listening… speak the verse, then tap Stop reciting. You can edit the words before comparing.</p>}
        </div>
        {error && <p role="alert" className="text-sm">{error}</p>}
        {compareSourceText && text.trim() && (
          <div className="mt-3">
            <Button type="button" variant="secondary" data-testid="recitation-compare-toggle" aria-expanded={compareOpen}
              onClick={() => setCompareOpen(open => !open)}>
              {compareOpen ? "Hide recitation comparison" : "Compare your recitation"}
            </Button>
            {compareOpen && (() => {
              // Spoken answers never get spelling callouts: the transcript's
              // spelling comes from the speech engine, not the student.
              const diff = diffWords(compareSourceText, text, { markSpelling: false });
              return (
                <div data-testid="recitation-compare" className="mt-3">
                  <p className="er-scripture" data-testid="recitation-compare-source">
                    <DiffTokens tokens={diff.expected} />
                  </p>
                  <p className="mt-2 text-sm">
                    <span className="font-semibold">Your recitation: </span>
                    <DiffTokens tokens={diff.submitted} />
                  </p>
                  <p className="mt-2 text-sm" data-testid="recitation-compare-summary">
                    {[
                      diff.missed ? `${diff.missed} missed ${diff.missed === 1 ? "word is" : "words are"} underlined in the verse.` : "",
                      diff.extra ? `${diff.extra} extra ${diff.extra === 1 ? "word is" : "words are"} struck through in your recitation.` : "",
                      !diff.missed && !diff.extra ? "Every word matches the verse." : "",
                    ].filter(Boolean).join(" ")}
                  </p>
                </div>
              );
            })()}
          </div>
        )}
      </details>
    </Panel>
  );
}
