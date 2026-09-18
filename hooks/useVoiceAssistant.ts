"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * V10 — client-side voice wrapper around the existing V7 text pipeline.
 *
 * This hook does NOT parse intents, does NOT call the assistant API, and
 * does NOT know anything about reminders/payments. Its only job is:
 *   1. Honestly detect whether this browser supports the Web Speech API
 *      (SpeechRecognition for speech-to-text, SpeechSynthesis for
 *      text-to-speech), mirroring the honest-status model established by
 *      hooks/usePushNotifications.ts.
 *   2. Turn a press-to-talk gesture into a transcript string.
 *   3. Optionally speak a reply string back.
 *
 * The transcript is handed to the caller (ChatPanel) via onResult, which
 * feeds it into the SAME `/api/assistant/message` call used for typed
 * text — there is no separate "voice intent" code path anywhere in this
 * file or the app.
 *
 * Browser caveats we do not paper over (documented in README):
 *  - Some browsers' SpeechRecognition implementation streams audio to a
 *    remote recognition service even though the JS API itself is local —
 *    that's a "network" error case, surfaced honestly below, not treated
 *    as an app bug.
 *  - iOS Safari's support has historically been partial/version-gated.
 *  - getUserMedia/SpeechRecognition require a secure context (HTTPS or
 *    localhost) in production.
 */

export type VoiceStatus =
  | "unsupported"
  | "idle"
  | "requesting_permission"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

export type VoiceErrorReason =
  | "not-allowed"
  | "no-speech"
  | "network"
  | "audio-capture"
  | "aborted"
  | "unknown";

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance !== "undefined";
}

/** Pure status-derivation helpers, exported for isolated unit testing. */
export function deriveSupport(recognitionCtor: unknown, synthesisAvailable: boolean) {
  return {
    sttSupported: typeof recognitionCtor === "function",
    ttsSupported: synthesisAvailable,
  };
}

export function errorReasonFromCode(code: string): VoiceErrorReason {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "not-allowed";
    case "no-speech":
      return "no-speech";
    case "network":
      return "network";
    case "audio-capture":
      return "audio-capture";
    case "aborted":
      return "aborted";
    default:
      return "unknown";
  }
}

export function errorMessageFor(reason: VoiceErrorReason): string {
  switch (reason) {
    case "not-allowed":
      return "Microphone access was denied. Allow microphone permission in your browser settings to use voice input.";
    case "no-speech":
      return "No speech was detected. Tap the mic and try again.";
    case "network":
      return "Voice recognition needs a network connection in this browser and it isn't reachable right now.";
    case "audio-capture":
      return "No microphone was found on this device.";
    case "aborted":
      return "Listening was stopped.";
    default:
      return "Voice input hit an unexpected error. You can still type your message.";
  }
}

export interface UseVoiceAssistantOptions {
  onResult: (transcript: string) => void;
  lang?: string;
}

export function useVoiceAssistant({ onResult, lang = "en-US" }: UseVoiceAssistantOptions) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [errorReason, setErrorReason] = useState<VoiceErrorReason | null>(null);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const { sttSupported, ttsSupported } = useMemo(() => {
    const ctor = getSpeechRecognitionCtor();
    return deriveSupport(ctor, hasSpeechSynthesis());
  }, []);

  useEffect(() => {
    if (!sttSupported) setStatus("unsupported");
  }, [sttSupported]);

  const startListening = useCallback(() => {
    if (!sttSupported) {
      setStatus("unsupported");
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }

    setErrorReason(null);
    setInterimTranscript("");
    setStatus("requesting_permission");

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => setStatus("listening");

    recognition.onresult = (e) => {
      let finalTranscript = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalTranscript += result[0].transcript;
        else interim += result[0].transcript;
      }
      setInterimTranscript(interim);
      if (finalTranscript.trim()) {
        setStatus("processing");
        onResult(finalTranscript.trim());
      }
    };

    recognition.onerror = (e) => {
      const reason = errorReasonFromCode(e.error);
      setErrorReason(reason);
      setStatus("error");
    };

    recognition.onend = () => {
      setInterimTranscript("");
      setStatus((s) => (s === "listening" || s === "requesting_permission" ? "idle" : s));
    };

    try {
      recognition.start();
    } catch {
      setStatus("error");
      setErrorReason("unknown");
    }
  }, [sttSupported, lang, onResult]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const cancelListening = useCallback(() => {
    recognitionRef.current?.abort();
    setStatus("idle");
    setInterimTranscript("");
  }, []);

  const finishedProcessing = useCallback(() => {
    setStatus((s) => (s === "processing" ? "idle" : s));
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported || !speechEnabled || !text.trim()) return;
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onstart = () => setStatus("speaking");
        utterance.onend = () => setStatus((s) => (s === "speaking" ? "idle" : s));
        utterance.onerror = () => setStatus((s) => (s === "speaking" ? "idle" : s));
        window.speechSynthesis.speak(utterance);
      } catch {
        /* TTS is best-effort; never block the text reply on it */
      }
    },
    [ttsSupported, speechEnabled]
  );

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      if (ttsSupported) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [ttsSupported]);

  return {
    status,
    errorReason,
    errorMessage: errorReason ? errorMessageFor(errorReason) : null,
    interimTranscript,
    sttSupported,
    ttsSupported,
    speechEnabled,
    setSpeechEnabled,
    startListening,
    stopListening,
    cancelListening,
    finishedProcessing,
    speak,
  };
}
