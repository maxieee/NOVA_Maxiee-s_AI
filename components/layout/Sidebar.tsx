"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/types/nav";
import { Icon } from "@/components/ui/Icon";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:border-nova-border md:bg-nova-surface/60 md:px-4 md:py-6">
      <div className="mb-8 flex items-center gap-2 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-nova-primary to-nova-primary2 font-bold text-white">
          N
        </div>
        <div>
          <p className="text-lg font-semibold leading-tight text-white">NOVA</p>
          <p className="text-xs text-nova-muted leading-tight">Your Personal Assistant</p>
        </div>
      </div>

      <Link href="/reminders/new" className="nova-btn-primary mb-6 w-full">
        <Icon name="plus" className="h-4 w-4" />
        Create Reminder
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                active
                  ? "bg-nova-surface2 text-white"
                  : "text-nova-muted hover:bg-nova-surface2/70 hover:text-white"
              }`}
            >
              <Icon name={item.icon} className="h-4.5 w-4.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
