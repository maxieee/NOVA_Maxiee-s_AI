"use client";

import type { ReminderTypeKey } from "@/types/reminder";
import { TYPE_META } from "./TypeBadges";
import { Icon } from "@/components/ui/Icon";

const ALL_TYPES = Object.keys(TYPE_META) as ReminderTypeKey[];

export function TypeSelector({
  selected,
  onChange,
}: {
  selected: ReminderTypeKey[];
  onChange: (next: ReminderTypeKey[]) => void;
}) {
  function toggle(type: ReminderTypeKey) {
    if (selected.includes(type)) {
      onChange(selected.filter((t) => t !== type));
    } else {
      onChange([...selected, type]);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {ALL_TYPES.map((type) => {
        const meta = TYPE_META[type];
        const active = selected.includes(type);
        return (
          <button
            key={type}
            type="button"
            onClick={() => toggle(type)}
            aria-pressed={active}
            className={`flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-all duration-150 ${
              active
                ? "border-nova-primary bg-nova-primary/10 shadow-lg shadow-nova-primary/10"
                : "border-nova-border bg-nova-surface hover:border-nova-primary/40"
            }`}
          >
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
                active ? "border-nova-primary/40 bg-nova-primary/20" : "border-nova-border bg-nova-surface2"
              }`}
            >
              <Icon name={meta.icon} className={`h-5 w-5 ${meta.color}`} />
            </span>
            <span className="text-xs font-medium text-white">{meta.label}</span>
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-md border ${
                active ? "border-nova-primary bg-nova-primary" : "border-nova-border"
              }`}
            >
              {active && <Icon name="check" className="h-3 w-3 text-white" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
