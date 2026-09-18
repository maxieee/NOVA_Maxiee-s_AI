import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { buildAnalyticsReport, ANALYTICS_WINDOW_DAYS } from "@/lib/analytics/report";

export const dynamic = "force-dynamic";

/**
 * V12 — dedicated page (not a Settings card), same reasoning V11 used for
 * Automations: there's too much content here (trends, breakdowns,
 * insights, recommendations) to cram into a Settings card without
 * crowding it.
 */
export default async function AnalyticsPage() {
  const userId = await db.getCurrentUserId();
  const report = await buildAnalyticsReport(userId);

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle={`Observations from your own NOVA activity over the last ${ANALYTICS_WINDOW_DAYS} days — statistical, never psychological`}
      />
      <section className="px-4 py-6 md:px-8">
        <AnalyticsDashboard report={report} />
      </section>
    </div>
  );
}
