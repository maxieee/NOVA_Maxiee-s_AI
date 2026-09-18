"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PersonalContextEntry } from "@/types/reminder";
import { Icon } from "@/components/ui/Icon";

const inputClass =
  "w-full rounded-xl border border-nova-border bg-nova-surface2 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nova-accent";

export function PersonalAssistantMemory({ entries }: { entries: PersonalContextEntry[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("general");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  async function add() {
    if (!label.trim() || !value.trim()) return;
    setSubmitting(true);
    await fetch("/api/personal-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, value, category }),
    });
    setLabel("");
    setValue("");
    setCategory("general");
    setSubmitting(false);
    router.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/personal-context/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function saveEdit(id: string) {
    await fetch(`/api/personal-context/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: editValue }),
    });
    setEditingId(null);
    router.refresh();
  }

  return (
    <div className="nova-card space-y-4 p-5">
      <div>
        <h3 className="text-sm font-semibold text-white">What NOVA Knows</h3>
        <p className="mt-1 text-xs text-nova-muted">
          Personal context you&apos;ve told NOVA — purely user-authored. Starts empty; nothing is invented.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-nova-muted">Nothing here yet. Add the first thing NOVA should know.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-nova-border bg-nova-surface2/60 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-nova-muted">
                  {entry.category} · {entry.label}
                </p>
                {editingId === entry.id ? (
                  <input
                    className={`${inputClass} mt-1`}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                  />
                ) : (
                  <p className="mt-1 text-sm text-white">{entry.value}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {editingId === entry.id ? (
                  <button
                    onClick={() => saveEdit(entry.id)}
                    className="rounded-lg p-1.5 text-nova-good hover:bg-nova-surface"
                    title="Save"
                  >
                    <Icon name="check" className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setEditingId(entry.id);
                      setEditValue(entry.value);
                    }}
                    className="rounded-lg p-1.5 text-nova-muted hover:bg-nova-surface hover:text-white"
                    title="Edit"
                  >
                    <Icon name="repeat" className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => remove(entry.id)}
                  className="rounded-lg p-1.5 text-nova-urgent hover:bg-nova-surface"
                  title="Delete"
                >
                  <Icon name="bell" className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <input
          className={inputClass}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category"
        />
        <input
          className={inputClass}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Allergy)"
        />
        <input
          className={inputClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value (e.g. Peanuts)"
        />
        <button
          type="button"
          onClick={add}
          disabled={submitting}
          className="nova-btn-secondary whitespace-nowrap"
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}
