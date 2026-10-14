import type { ReactNode } from "react";
import { Star } from "lucide-react";

export function EmptyBookmarks({
  title,
  body,
}: {
  title: string;
  body: ReactNode;
}) {
  return (
    <div className="text-muted-foreground px-4 py-8 text-center text-sm">
      <div className="bg-muted mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg">
        <Star className="h-4 w-4" />
      </div>
      <p className="text-foreground font-medium">{title}</p>
      <p className="mt-0.5">{body}</p>
    </div>
  );
}
