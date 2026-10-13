import type { Bell } from "lucide-react";

export function Block({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: typeof Bell;
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-muted/40 flex min-w-0 flex-col gap-3 rounded-lg px-3 py-3">
      <div className="flex items-start gap-3">
        <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-muted-foreground text-xs">{detail}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
