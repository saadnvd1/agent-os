/**
 * Follow-latest share links: when a page gets a new version, every live link
 * that follows it is re-uploaded through Connect's PUT, built the same way as
 * a normal share (same snapshot, same redaction). Nothing here throws into
 * the caller: a failed try is logged and the next version tries again, and
 * the content already on the link stays live meanwhile.
 */

import { ApiError } from "@/lib/connect/control-api";
import { latestVersion } from "@/lib/artifacts/store";
import { linked, replaceRemote } from "./connect";
import { BadShare, buildPage } from "./service";
import { listFollowing, setLinkVersion, stopFollowing } from "./store";

// One run per page at a time, so two quick versions can't land out of order.
const running = new Map<string, Promise<void>>();

export function followLatest(pageId: string): Promise<void> {
  const next = (running.get(pageId) ?? Promise.resolve())
    .then(() => run(pageId))
    .catch((err) => console.error("[share-follow]", pageId, err))
    .finally(() => {
      if (running.get(pageId) === next) running.delete(pageId);
    });
  running.set(pageId, next);
  return next;
}

async function run(pageId: string): Promise<void> {
  const latest = latestVersion(pageId);
  if (!latest) return;
  // A link that missed an earlier version is behind too, so this is also the retry.
  const behind = listFollowing(pageId).filter(
    (l) => (l.version ?? 0) < latest.version
  );
  if (!behind.length || !linked()) return;
  let page;
  try {
    page = await buildPage({
      kind: "artifact",
      artifactId: latest.id,
      includeTools: false,
      sharedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      "[share-follow] could not build",
      latest.id,
      err instanceof BadShare ? err.message : err
    );
    return;
  }
  if (page.tooBig) {
    console.error("[share-follow] v%d is too big to share", latest.version);
    return;
  }
  for (const link of behind) {
    try {
      await replaceRemote(link.id, {
        title: page.title,
        html: page.html,
        markdown: page.markdown,
      });
      setLinkVersion(link.id, latest.version, page.title);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410))
        stopFollowing(link.id);
      console.error(
        "[share-follow] %s stays on v%s:",
        link.id,
        link.version,
        err instanceof Error ? err.message : err
      );
    }
  }
}
