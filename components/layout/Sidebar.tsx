"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/types/nav";
import { Icon } from "@/components/ui/Icon";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-56 md:flex-col md:border-r md:border-nova-border md:bg-nova-surface/60 md:px-3 md:py-4">
      <div className="mb-5 flex items-center gap-2 px-1.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-nova-primary to-nova-primary2 text-xs font-bold text-white">
          N
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-nova-text">NOVA</p>
          <p className="text-[10px] text-nova-muted leading-tight">Your Personal Assistant</p>
        </div>
      </div>

      <Link href="/reminders/new" className="nova-btn-primary mb-4 w-full py-2 text-sm">
        <Icon name="plus" className="h-4 w-4" />
        Create Reminder
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                active
                  ? "bg-nova-accent/15 text-nova-text"
                  : "text-nova-muted hover:bg-nova-surface2/70 hover:text-nova-text"
              }`}
            >
              <Icon name={item.icon} className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
