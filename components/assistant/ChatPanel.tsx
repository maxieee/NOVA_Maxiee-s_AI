"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

const SESSION_STORAGE_KEY = "nova-assistant-session-id";

function getOrCreateSessionId(): string {
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(SESSION_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private browsing / blocked storage: fall back to a per-load id. Only
    // affects "it"/"that" continuity across page reloads, never data.
    return `session-${Date.now()}`;
  }
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Hi, I'm NOVA. Try \"remind me to call the dentist tomorrow at 10am\" or \"what's due today?\"",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const sessionIdRef = useRef<string>("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendText = useCallback(async (text: string) => {
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", text }]);
    setSending(true);
    let reply = "Something went wrong on my end.";
    try {
      const res = await fetch("/api/assistant/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sessionId: sessionIdRef.current || getOrCreateSessionId() }),
      });
      const data = (await res.json().catch(() => null)) as { reply?: string; error?: string } | null;
      reply = data?.reply ?? (data?.error ? `Something went wrong: ${data.error}` : reply);
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", text: reply }]);
    } catch {
      reply = "I couldn't reach the server just now. Please try again.";
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", text: reply }]);
    } finally {
      setSending(false);
    }
    return reply;
  }, []);

  // V10: voice input is a client-side wrapper around this exact same
  // sendText call — a transcribed message goes through the identical
  // /api/assistant/message -> handleAssistantMessage path as typed text.
  // There is no separate "voice intent" pipeline.
  const handleVoiceResult = useCallback(
    (transcript: string) => {
      void sendText(transcript).then((reply) => {
        voiceRef.current?.finishedProcessing();
        voiceRef.current?.speak(reply);
      });
    },
    [sendText]
  );
  const voice = useVoiceAssistant({ onResult: handleVoiceResult });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    await sendText(text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function onMicClick() {
    if (voice.status === "listening" || voice.status === "requesting_permission") {
      voice.cancelListening();
    } else {
      voice.startListening();
    }
  }

  const isBusy = sending || voice.status === "processing";
  const micLabel =
    voice.status === "listening"
      ? "Stop listening"
      : voice.status === "requesting_permission"
        ? "Requesting microphone permission"
        : "Speak to NOVA";

  return (
    <div className="nova-card flex h-[70vh] flex-col overflow-hidden md:h-[75vh]">
      <div className="flex items-center justify-between border-b border-nova-border px-4 py-2">
        <span className="text-xs text-nova-muted">
          {voice.sttSupported ? "Voice input available" : "Voice input isn't supported in this browser — you can still type."}
        </span>
        {voice.ttsSupported && (
          <label className="flex items-center gap-1.5 text-xs text-nova-muted">
            <input
              type="checkbox"
              checked={voice.speechEnabled}
              onChange={(e) => voice.setSpeechEnabled(e.target.checked)}
              className="h-3.5 w-3.5 accent-nova-primary"
            />
            Speak replies
          </label>
        )}
      </div>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-nova-primary text-white"
                  : "border border-nova-border bg-nova-surface2 text-nova-text"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {voice.status === "listening" && voice.interimTranscript && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-nova-primary/50 px-3.5 py-2 text-sm italic text-white">
              {voice.interimTranscript}
            </div>
          </div>
        )}
        {isBusy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-nova-border bg-nova-surface2 px-3.5 py-2 text-sm text-nova-muted">
              Thinking…
            </div>
          </div>
        )}
        {voice.status === "error" && voice.errorMessage && (
          <div className="flex justify-center">
            <div className="max-w-[90%] rounded-xl border border-nova-border bg-nova-surface2 px-3 py-1.5 text-xs text-nova-muted">
              {voice.errorMessage}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-nova-border p-3">
        <label htmlFor="assistant-input" className="sr-only">
          Message NOVA
        </label>
        <input
          id="assistant-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            voice.status === "listening" ? "Listening…" : "Ask NOVA to remind you, snooze, or check what's due…"
          }
          className="flex-1 rounded-xl border border-nova-border bg-nova-surface2 px-3.5 py-2.5 text-sm text-nova-text placeholder:text-nova-muted focus:border-nova-primary/50 focus:outline-none"
        />
        {voice.sttSupported && (
          <button
            type="button"
            onClick={onMicClick}
            disabled={voice.status === "processing"}
            aria-label={micLabel}
            title={micLabel}
            className={`px-3.5 py-2.5 rounded-xl border transition-colors disabled:opacity-50 ${
              voice.status === "listening"
                ? "animate-pulse border-nova-primary bg-nova-primary text-white"
                : voice.status === "requesting_permission"
                  ? "border-nova-primary/50 bg-nova-surface2 text-nova-primary"
                  : "border-nova-border bg-nova-surface2 text-nova-text"
            }`}
          >
            <Icon name={voice.status === "listening" ? "mic" : "mic"} className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => void send()}
          disabled={isBusy || !input.trim()}
          aria-label="Send message"
          className="nova-btn-primary px-3.5 py-2.5 disabled:opacity-50"
        >
          <Icon name="send" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
