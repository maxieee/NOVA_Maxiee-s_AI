export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 pt-6 md:px-8 md:pt-8">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-nova-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
