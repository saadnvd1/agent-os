// Live session status over /ws/status into the query cache, like the web's
// useStatusStream; a slow REST poll covers the gaps.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { RowStatus } from "@/lib/sidebar/shelves";
import { api, authHeaders } from "~/lib/api/client";
import { keys } from "~/lib/api/keys";
import type { Machine } from "~/lib/machines/store";
import { socketUrl } from "~/lib/machines/url";
import { openSocket, type SocketState } from "~/lib/ws/socket";

export type Statuses = Record<string, RowStatus | undefined>;

interface StatusMessage {
  type: "statuses";
  statuses: Statuses;
}

export function useStatuses(machine: Machine | null) {
  const client = useQueryClient();
  const [link, setLink] = useState<SocketState>("connecting");
  const id = machine?.id ?? "none";

  useEffect(() => {
    if (!machine) return;
    const socket = openSocket<StatusMessage>({
      url: socketUrl(machine.url, "/ws/status"),
      headers: authHeaders(machine),
      onState: setLink,
      onMessage: (msg) => {
        if (msg.type === "statuses")
          client.setQueryData(keys.statuses(machine.id), {
            statuses: msg.statuses,
          });
      },
    });
    return () => socket.close();
  }, [machine, client]);

  const query = useQuery({
    queryKey: keys.statuses(id),
    queryFn: () =>
      api<{ statuses: Statuses }>(machine!, "/api/sessions/status"),
    select: (d) => d.statuses,
    enabled: !!machine,
    refetchInterval: link === "open" ? 60000 : 5000,
  });
  return { statuses: query.data ?? {}, live: link === "open" };
}
