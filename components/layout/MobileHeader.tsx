import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-nova-border bg-nova-bg/90 px-4 py-3 backdrop-blur md:hidden">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-nova-primary to-nova-primary2 font-bold text-white text-sm">
          N
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-white">NOVA</p>
          <p className="text-[10px] text-nova-muted leading-tight">Your Personal Assistant</p>
        </div>
      </div>
      <Link
        href="/reminders/new"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-nova-primary to-nova-primary2 text-white shadow-lg shadow-nova-primary/20 active:scale-95 transition-transform"
        aria-label="Create Reminder"
      >
        <Icon name="plus" className="h-5 w-5" />
      </Link>
    </header>
  );
}
