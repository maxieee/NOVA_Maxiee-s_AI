import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { AutomationsManager } from "@/components/automations/AutomationsManager";

export const dynamic = "force-dynamic";

/**
 * V11 — dedicated page (not another Settings card) since it needs its own
 * list + expandable run-history view; Settings links here instead of
 * embedding the whole manager, keeping Settings from getting crowded
 * (consistent with the project's existing card-per-concern pattern).
 */
export default function AutomationsPage() {
  const userId = db.getCurrentUserId();
  const automations = db.listAutomations(userId);

  return (
    <div>
      <PageHeader
        title="Automations"
        subtitle="Trigger -> condition -> action rules, built on NOVA's existing reminder and notification engines"
      />
      <section className="px-4 py-6 md:px-8">
        <AutomationsManager initialAutomations={automations} />
      </section>
    </div>
  );
}
