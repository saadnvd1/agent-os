"use client";

import { toast } from "sonner";
import { Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { writeClipboard } from "@/hooks/useCopyToClipboard";
import {
  useRevokeShare,
  useSharesQuery,
  type SharedLinkRow,
} from "@/data/shares";
import { cn } from "@/lib/utils";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

function Row({ share }: { share: SharedLinkRow }) {
  const revoke = useRevokeShare();
  const live = share.status === "active";

  const copy = async () => {
    try {
      await writeClipboard(share.url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };
  const onRevoke = () => {
    if (
      !window.confirm(
        "Revoke this link? The page is deleted from Connect and the link stops working."
      )
    )
      return;
    revoke.mutate(share.id, {
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const title =
    share.kind === "chat" && share.sessionId ? (
      <a
        href={`/?session=${encodeURIComponent(share.sessionId)}`}
        className="hover:underline"
      >
        {share.title}
      </a>
    ) : (
      share.title
    );

  return (
    <li className="bg-muted/40 flex flex-col gap-2 rounded-lg px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          <span>{share.kind === "chat" ? "Chat" : "Page"}</span>
          <span>Created {when(share.createdAt)}</span>
          <span>
            {share.status === "revoked"
              ? "Revoked"
              : share.status === "expired"
                ? "Expired"
                : share.expiresAt
                  ? `Expires ${when(share.expiresAt)}`
                  : "Never expires"}
          </span>
          <span>
            {share.views === null
              ? "Views unavailable"
              : `${share.views} ${share.views === 1 ? "view" : "views"}`}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="outline"
          className={cn("min-h-11 sm:min-h-8", !live && "invisible")}
          onClick={copy}
          disabled={!live}
        >
          <Copy className="h-4 w-4" />
          Copy link
        </Button>
        <Button
          variant="outline"
          className={cn(
            "text-destructive min-h-11 sm:min-h-8",
            !live && "invisible"
          )}
          onClick={onRevoke}
          disabled={!live || revoke.isPending}
        >
          Revoke
        </Button>
      </div>
    </li>
  );
}

// Every snapshot link made from this machine, with views from Connect.
export function SharedLinksPanel() {
  const { data, isLoading, error } = useSharesQuery();
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Read-only snapshots you shared from a chat or a page. Revoking one
        deletes it from Connect straight away.
      </p>
      {data?.connect === "unavailable" && (
        <p className="text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 text-xs">
          Can&apos;t reach Connect, so views are hidden and revoking is
          unavailable until it is back.
        </p>
      )}
      {data?.connect === "unlinked" && data.shares.length > 0 && (
        <p className="text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 text-xs">
          This machine isn&apos;t linked to Connect, so views are hidden and
          revoking is unavailable.
        </p>
      )}
      {error && (
        <p className="text-destructive text-sm">{(error as Error).message}</p>
      )}
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : data?.shares.length ? (
        <ul className="space-y-2">
          {data.shares.map((s) => (
            <Row key={s.id} share={s} />
          ))}
        </ul>
      ) : (
        <div className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-sm">
          <Link2 className="h-4 w-4 shrink-0" />
          Nothing shared yet. Use Share… in a chat&apos;s menu, or the share
          button on a page.
        </div>
      )}
    </div>
  );
}
