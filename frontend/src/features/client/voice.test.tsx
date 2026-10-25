import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { EvidenceList } from "./EvidenceList";
import { VoiceNotes, VoiceRecorder } from "./VoiceRecorder";

class FakeRecorder {
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])]) });
    this.onstop?.();
  }
}

class FakeSpeech {
  static last: FakeSpeech | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror = null;
  constructor() {
    FakeSpeech.last = this;
  }
  start() {}
  stop() {}
}

const stopTrack = vi.fn();

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("SpeechRecognition", FakeSpeech);
  Object.defineProperty(window, "SpeechRecognition", { value: FakeSpeech, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
  FakeSpeech.last = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VoiceRecorder", () => {
  it("records, hands over the audio file and the pt-BR transcript, and releases the microphone", async () => {
    const user = userEvent.setup();
    const onNote = vi.fn();
    const onTranscript = vi.fn();
    render(<VoiceRecorder slotsLeft={5} onNote={onNote} onTranscript={onTranscript} />);
    await user.click(screen.getByRole("button", { name: /Gravar relato em áudio/ }));
    expect(await screen.findByRole("timer")).toHaveTextContent("Gravando");
    expect(FakeSpeech.last).not.toBeNull();
    act(() => {
      FakeSpeech.last!.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "meu patrão não pagou" } }] });
    });
    await user.click(screen.getByRole("button", { name: "Parar e usar" }));
    expect(onNote).toHaveBeenCalledTimes(1);
    const note = onNote.mock.calls[0][0];
    expect(note.file.name).toMatch(/^relato-voz-.*\.webm$/);
    expect(note.file.type).toContain("audio/webm");
    expect(onTranscript).toHaveBeenCalledWith("meu patrão não pagou");
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("transcrito");
  });

  it("discarding keeps nothing", async () => {
    const user = userEvent.setup();
    const onNote = vi.fn();
    const onTranscript = vi.fn();
    render(<VoiceRecorder slotsLeft={5} onNote={onNote} onTranscript={onTranscript} />);
    await user.click(screen.getByRole("button", { name: /Gravar relato em áudio/ }));
    await user.click(await screen.findByRole("button", { name: "Descartar" }));
    expect(onNote).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
  });

  it("saves the audio without a transcript when the browser cannot transcribe", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    const onNote = vi.fn();
    const onTranscript = vi.fn();
    render(<VoiceRecorder slotsLeft={5} onNote={onNote} onTranscript={onTranscript} />);
    await user.click(screen.getByRole("button", { name: /Gravar relato em áudio/ }));
    await user.click(await screen.findByRole("button", { name: "Parar e usar" }));
    expect(onNote).toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Não foi possível transcrever");
  });

  it("explains a denied microphone and blocks recording without free slots", async () => {
    const user = userEvent.setup();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("denied"));
    const { rerender } = render(<VoiceRecorder slotsLeft={5} onNote={vi.fn()} onTranscript={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Gravar relato em áudio/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("microfone");
    rerender(<VoiceRecorder slotsLeft={0} onNote={vi.fn()} onTranscript={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Gravar relato em áudio/ })).toBeDisabled();
  });
});

describe("VoiceNotes", () => {
  it("lists recorded notes with a player each and lets the user remove one", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const note = { id: "a", file: new File(["x"], "relato.webm", { type: "audio/webm" }), url: "blob:a", seconds: 65 };
    render(<VoiceNotes notes={[note]} onRemove={onRemove} />);
    expect(screen.getByText("Áudio 1 · 1:05")).toBeInTheDocument();
    expect(screen.getByLabelText("Ouvir áudio 1")).toHaveAttribute("src", "blob:a");
    await user.click(screen.getByRole("button", { name: "Remover" }));
    expect(onRemove).toHaveBeenCalledWith("a");
  });
});

describe("EvidenceList voice notes", () => {
  it("shows a Ouvir button for audio and plays it in the page without downloading a file", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listEvidence").mockResolvedValue([
      { id: "e1", filename: "relato-voz.webm", content_type: "audio/webm", size_bytes: 4096, created_at: "2026-10-23T10:00:00Z" },
      { id: "e2", filename: "contrato.pdf", content_type: "application/pdf", size_bytes: 2048, created_at: "2026-10-23T10:01:00Z" },
    ]);
    const blob = vi.spyOn(api, "evidenceBlob").mockResolvedValue(new Blob(["x"], { type: "audio/webm" }));
    render(<EvidenceList caseId="c1" editable={false} />);
    expect(await screen.findByRole("link", { name: "contrato.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "relato-voz.webm" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Ouvir relato-voz.webm" }));
    expect(blob).toHaveBeenCalledWith("c1", "e1");
    expect(await screen.findByLabelText("Ouvir relato-voz.webm")).toHaveAttribute("src", "blob:fake");
  });
});
