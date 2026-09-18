import { Icon } from "@/components/ui/Icon";

const TONE_CLASSES: Record<string, string> = {
  urgent: "text-nova-urgent bg-nova-urgent/10 border-nova-urgent/30",
  warn: "text-nova-warn bg-nova-warn/10 border-nova-warn/30",
  accent: "text-nova-accent bg-nova-accent/10 border-nova-accent/30",
  good: "text-nova-good bg-nova-good/10 border-nova-good/30",
};

export function StatTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: string;
  tone: keyof typeof TONE_CLASSES;
}) {
  return (
    <div className="nova-card animate-slide-up flex flex-col gap-3 p-4">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${TONE_CLASSES[tone]}`}>
        <Icon name={icon} className="h-4.5 w-4.5" />
      </div>
      <div>
        <p className="text-2xl font-semibold text-white">{value}</p>
        <p className="text-xs text-nova-muted">{label}</p>
      </div>
    </div>
  );
}
