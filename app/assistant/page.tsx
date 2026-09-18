import { PageHeader } from "@/components/ui/PageHeader";
import { ChatPanel } from "@/components/assistant/ChatPanel";

export const dynamic = "force-dynamic";

export default function AssistantPage() {
  return (
    <div className="pb-24 md:pb-8">
      <PageHeader
        title="Assistant"
        subtitle="Talk to NOVA in plain English — create, snooze, complete, or ask what's due."
      />
      <div className="px-4 pt-4 md:px-8">
        <ChatPanel />
      </div>
    </div>
  );
}
