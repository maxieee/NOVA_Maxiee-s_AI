import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const { y, m } = await searchParams;
  const now = new Date();
  const year = y ? parseInt(y, 10) : now.getFullYear();
  const month = m ? parseInt(m, 10) : now.getMonth();

  const userId = await db.getCurrentUserId();
  const reminders = await db.listReminders(userId);

  const prev = month === 0 ? { y: year - 1, m: 11 } : { y: year, m: month - 1 };
  const next = month === 11 ? { y: year + 1, m: 0 } : { y: year, m: month + 1 };

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Everything scheduled, month by month"
        action={
          <div className="flex items-center gap-2">
            <Link href={`/calendar?y=${prev.y}&m=${prev.m}`} className="nova-btn-secondary px-2.5 py-2">
              <Icon name="chevron-left" className="h-4 w-4" />
            </Link>
            <Link href={`/calendar?y=${next.y}&m=${next.m}`} className="nova-btn-secondary px-2.5 py-2">
              <Icon name="chevron-right" className="h-4 w-4" />
            </Link>
          </div>
        }
      />

      <div className="px-4 pt-6 md:px-8">
        <h2 className="mb-3 text-lg font-semibold text-white">
          {MONTH_NAMES[month]} {year}
        </h2>
        <MonthGrid year={year} month={month} reminders={reminders} />
      </div>
    </div>
  );
}
