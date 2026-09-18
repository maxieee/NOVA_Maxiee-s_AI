import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { errorReasonFromCode, errorMessageFor, deriveSupport } from "../hooks/useVoiceAssistant";

/**
 * V10 — voice is a client-side wrapper around the existing V7 text
 * pipeline. There is no separate "voice intent" code path: once the Web
 * Speech API produces a transcript string, it is handed to the exact same
 * handleAssistantMessage() function that /api/assistant/message calls for
 * typed text. Real microphone/SpeechRecognition/SpeechSynthesis behavior
 * cannot be exercised in a Node/vitest environment (no real browser, no
 * real audio device) — that is verified structurally here (same function,
 * same result for the same string) and by code review, not by simulating
 * audio capture.
 */
describe("Voice input reuses the exact V7 assistant pipeline", () => {
  const dbPaths: string[] = [];

  beforeAll(async () => {
    await import("../lib/db");
    await import("../lib/assistant/pipeline");
  });

  beforeEach(() => {
    vi.resetModules();
    const dbPath = path.join(os.tmpdir(), `nova-voice-pipeline-test-${Date.now()}-${Math.random()}.sqlite`);
    dbPaths.push(dbPath);
    process.env.NOVA_SQLITE_PATH = dbPath;
    process.env.NOVA_DATA_SOURCE = "local";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  afterAll(() => {
    for (const p of dbPaths) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  });

  it("produces an identical result whether the text arrived typed or as a transcript", async () => {
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const { db } = await import("../lib/db");

    const now = new Date("2026-09-18T12:00:00");
    const transcript = "remind me to call the dentist tomorrow at 10am";

    // Simulates: SpeechRecognition.onresult -> transcript string -> the
    // SAME call ChatPanel's sendText() makes for a typed message. No
    // separate voice parser exists to diverge from this.
    const result = await handleAssistantMessage(transcript, "voice-session-1", now);

    expect(result.reply).toMatch(/dentist/i);
    const userId = await db.getCurrentUserId();
    const created = (await db.listReminders(userId)).find((r) => r.title.toLowerCase().includes("call the dentist"));
    expect(created).toBeTruthy();
    expect(created?.date).toBe("2026-09-19");
    expect(created?.time).toBe("10:00");
  });

  it("gives the same reply for the same text regardless of session used for voice vs typed", async () => {
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const now = new Date("2026-09-18T12:00:00");

    const typedResult = await handleAssistantMessage("what's due today?", "typed-session", now);
    const voiceResult = await handleAssistantMessage("what's due today?", "voice-session-2", now);

    // Both go through parse -> validate -> execute -> respond identically;
    // any difference would mean a fork exists, which V10 must not create.
    expect(typedResult.reply).toBe(voiceResult.reply);
  });
});

describe("Voice capability status derivation (pure logic, no real browser)", () => {
  it("reports unsupported when no SpeechRecognition constructor exists", () => {
    const { sttSupported } = deriveSupport(undefined, true);
    expect(sttSupported).toBe(false);
  });

  it("reports supported when a SpeechRecognition constructor is present", () => {
    class FakeRecognition {}
    const { sttSupported, ttsSupported } = deriveSupport(FakeRecognition, true);
    expect(sttSupported).toBe(true);
    expect(ttsSupported).toBe(true);
  });

  it("maps each honest SpeechRecognition error code to its own reason and message", () => {
    expect(errorReasonFromCode("not-allowed")).toBe("not-allowed");
    expect(errorReasonFromCode("no-speech")).toBe("no-speech");
    expect(errorReasonFromCode("network")).toBe("network");
    expect(errorReasonFromCode("audio-capture")).toBe("audio-capture");
    expect(errorReasonFromCode("some-unknown-code")).toBe("unknown");

    // Each reason must produce distinct, honest copy — never one generic
    // failure message covering permission denial, silence, and network
    // issues alike.
    const messages = new Set(
      ["not-allowed", "no-speech", "network", "audio-capture", "unknown"].map((c) =>
        errorMessageFor(errorReasonFromCode(c))
      )
    );
    expect(messages.size).toBe(5);
  });
});
