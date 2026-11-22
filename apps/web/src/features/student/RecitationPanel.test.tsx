import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecitationPanel } from "./RecitationPanel";

class MockRecognition {
  static instances: MockRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: never) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopped = false;
  constructor() { MockRecognition.instances.push(this); }
  start() { this.started = true; }
  stop() { this.stopped = true; this.onend?.(); }
  emitResult(transcript: string, isFinal: boolean) {
    const result = { isFinal, 0: { transcript }, length: 1 };
    this.onresult?.({ resultIndex: 0, results: [result] } as never);
  }
  emitError(error: string) { this.onerror?.({ error }); }
}

const win = window as unknown as Record<string, unknown>;

beforeEach(() => { MockRecognition.instances = []; });
afterEach(() => {
  cleanup();
  delete win.SpeechRecognition;
  delete win.webkitSpeechRecognition;
});

describe("RecitationPanel voice input", () => {
  it("hides the mic with a plain note when speech recognition is unsupported", () => {
    render(<RecitationPanel />);
    expect(screen.getByText("Voice recitation isn't available in this browser — you can type it instead.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /recite/i })).not.toBeInTheDocument();
    const box = screen.getByLabelText("Your private recitation practice");
    fireEvent.change(box, { target: { value: "typed instead" } });
    expect(box).toHaveValue("typed instead");
  });

  it("fills the answer box with interim then final transcripts and never submits", () => {
    win.SpeechRecognition = MockRecognition;
    render(<RecitationPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Tap to recite" }));
    const recognition = MockRecognition.instances[0];
    expect(recognition.started).toBe(true);
    expect(recognition.lang).toBe("en-US");
    expect(recognition.interimResults).toBe(true);
    expect(screen.getByRole("button", { name: "Stop reciting" })).toBeInTheDocument();
    expect(screen.getByText(/Listening…/)).toBeInTheDocument();

    const box = screen.getByLabelText("Your private recitation practice");
    act(() => recognition.emitResult("in the beginning", false));
    expect(box).toHaveValue("in the beginning");
    act(() => recognition.emitResult("in the beginning God created", true));
    expect(box).toHaveValue("in the beginning God created");

    fireEvent.click(screen.getByRole("button", { name: "Stop reciting" }));
    expect(recognition.stopped).toBe(true);
    expect(screen.getByRole("button", { name: "Tap to recite" })).toBeInTheDocument();
    // The transcript stays in the box, editable, after stopping.
    fireEvent.change(box, { target: { value: "in the beginning God created the heavens" } });
    expect(box).toHaveValue("in the beginning God created the heavens");
  });

  it("shows a plain-language message when the microphone is denied and typing still works", () => {
    win.SpeechRecognition = MockRecognition;
    render(<RecitationPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Tap to recite" }));
    act(() => MockRecognition.instances[0].emitError("not-allowed"));
    expect(screen.getByRole("alert")).toHaveTextContent("Microphone access was blocked");
    expect(screen.getByRole("button", { name: "Tap to recite" })).toBeInTheDocument();
    const box = screen.getByLabelText("Your private recitation practice");
    fireEvent.change(box, { target: { value: "still typing" } });
    expect(box).toHaveValue("still typing");
  });

  it("appends a new recitation after text already in the box", () => {
    win.SpeechRecognition = MockRecognition;
    render(<RecitationPanel />);
    const box = screen.getByLabelText("Your private recitation practice");
    fireEvent.change(box, { target: { value: "first part" } });
    fireEvent.click(screen.getByRole("button", { name: "Tap to recite" }));
    act(() => MockRecognition.instances[0].emitResult("second part", true));
    expect(box).toHaveValue("first part second part");
  });
});
