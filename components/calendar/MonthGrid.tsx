import type { Reminder } from "@/types/reminder";
import { toISODate } from "@/lib/utils/date";
import Link from "next/link";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthGrid({ year, month, reminders }: { year: number; month: number; reminders: Reminder[] }) {
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDate = new Map<string, Reminder[]>();
  for (const r of reminders) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }

  const cells: (number | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayISO = toISODate(new Date());

  return (
    <div className="nova-card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-nova-border bg-nova-surface2/50 text-center text-xs font-medium text-nova-muted">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          if (day === null) return <div key={idx} className="min-h-24 border-b border-r border-nova-border/60" />;
          const iso = toISODate(new Date(year, month, day));
          const items = byDate.get(iso) ?? [];
          const isToday = iso === todayISO;
          return (
            <div
              key={idx}
              className="min-h-24 border-b border-r border-nova-border/60 p-1.5 last:border-r-0"
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  isToday ? "bg-nova-primary text-white" : "text-nova-muted"
                }`}
              >
                {day}
              </span>
              <div className="mt-1 flex flex-col gap-1">
                {items.slice(0, 2).map((r) => (
                  <Link
                    key={r.id}
                    href={`/reminders/${r.id}`}
                    prefetch={false}
                    className="truncate rounded bg-nova-surface2 px-1.5 py-0.5 text-[10px] text-white hover:bg-nova-primary/30"
                  >
                    {r.title}
                  </Link>
                ))}
                {items.length > 2 && (
                  <span className="text-[10px] text-nova-muted">+{items.length - 2} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
