"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";

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

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", text }]);
    setSending(true);
    try {
      const res = await fetch("/api/assistant/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sessionId: sessionIdRef.current || getOrCreateSessionId() }),
      });
      const data = (await res.json().catch(() => null)) as { reply?: string; error?: string } | null;
      const reply = data?.reply ?? (data?.error ? `Something went wrong: ${data.error}` : "Something went wrong on my end.");
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", text: reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", text: "I couldn't reach the server just now. Please try again." },
      ]);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="nova-card flex h-[70vh] flex-col overflow-hidden md:h-[75vh]">
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
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-nova-border bg-nova-surface2 px-3.5 py-2 text-sm text-nova-muted">
              Thinking…
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
          placeholder="Ask NOVA to remind you, snooze, or check what's due…"
          className="flex-1 rounded-xl border border-nova-border bg-nova-surface2 px-3.5 py-2.5 text-sm text-nova-text placeholder:text-nova-muted focus:border-nova-primary/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !input.trim()}
          aria-label="Send message"
          className="nova-btn-primary px-3.5 py-2.5 disabled:opacity-50"
        >
          <Icon name="send" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
