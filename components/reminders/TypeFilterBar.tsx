"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { ReminderTypeKey } from "@/types/reminder";
import { TYPE_META } from "./TypeBadges";

const ALL_TYPES = Object.keys(TYPE_META) as ReminderTypeKey[];

export function TypeFilterBar({ basePath }: { basePath: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = searchParams.get("type");

  function setType(type: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (type) params.set("type", type);
    else params.delete("type");
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <button
        onClick={() => setType(null)}
        className={`nova-chip shrink-0 ${!active ? "nova-chip-active" : ""}`}
      >
        All
      </button>
      {ALL_TYPES.map((t) => (
        <button
          key={t}
          onClick={() => setType(t)}
          className={`nova-chip shrink-0 ${active === t ? "nova-chip-active" : ""}`}
        >
          {TYPE_META[t].label}
        </button>
      ))}
    </div>
  );
}
