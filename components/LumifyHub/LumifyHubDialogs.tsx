"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { lumifyhubKeys } from "@/data/lumifyhub";
import { ConnectDialog } from "./ConnectDialog";
import { WorkspaceLinkDialog } from "./WorkspaceLinkDialog";
import { BoardLinkDialog } from "./BoardLinkDialog";
import { DocsDialog } from "./Docs/DocsDialog";

// The connect callback lands on /?lumifyhub=connected|error.
function useConnectResult() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("lumifyhub");
    if (!result) return;
    if (result === "connected") {
      toast.success("LumifyHub connected");
      queryClient.invalidateQueries({ queryKey: lumifyhubKeys.all });
    } else {
      toast.error("Couldn't connect LumifyHub. Try again.");
    }
    url.searchParams.delete("lumifyhub");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [queryClient]);
}

export function LumifyHubDialogs() {
  useConnectResult();
  return (
    <>
      <ConnectDialog />
      <WorkspaceLinkDialog />
      <BoardLinkDialog />
      <DocsDialog />
    </>
  );
}
