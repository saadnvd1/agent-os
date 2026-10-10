"use client";

import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useGlobalMergeSettings,
  useUpdateGlobalMergeSettings,
} from "@/data/merge";
import { mergeUi, mergeUiActions } from "@/stores/mergeUi";
import { MergeSettingsFields } from "./MergeSettingsFields";

// The global merge settings. A project's settings or its agentos.json
// `merge` override them.
export function MergeSettingsDialog() {
  const { open } = useSnapshot(mergeUi);
  const { data, isPending, isError, error } = useGlobalMergeSettings(open);
  const update = useUpdateGlobalMergeSettings();

  return (
    <Dialog open={open} onOpenChange={mergeUiActions.setOpen}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Merging</DialogTitle>
          <DialogDescription>
            How tasks&rsquo; PRs merge and what&rsquo;s cleaned up after, for
            every project. A project can override these in its settings or in
            agentos.json.
          </DialogDescription>
        </DialogHeader>
        {isPending && (
          <div className="bg-muted/40 h-48 animate-pulse rounded-lg" />
        )}
        {isError && <p className="text-destructive text-sm">{error.message}</p>}
        {data && (
          <MergeSettingsFields
            settings={data.settings}
            inherited={data.defaults}
            disabled={update.isPending}
            onChange={(s) => update.mutate(s)}
          />
        )}
        {update.isError && (
          <p className="text-destructive text-sm">{update.error.message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
