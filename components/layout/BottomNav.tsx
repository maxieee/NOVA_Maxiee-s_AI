"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/types/nav";
import { Icon } from "@/components/ui/Icon";

const MOBILE_ITEMS = NAV_ITEMS.slice(0, 5);

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-nova-border bg-nova-surface/95 backdrop-blur md:hidden">
      {MOBILE_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors duration-150 ${
              active ? "text-nova-text" : "text-nova-muted"
            }`}
          >
            <Icon name={item.icon} className="h-4.5 w-4.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
