"use client";

import { canManageDevices } from "@/components/Devices";
import { SettingToggle } from "@/components/Settings/SettingToggle";
import {
  useDevicesQuery,
  useNetworkQuery,
  useUpdateNetwork,
} from "@/data/devices";

// Switching it off asks for a passkey (useUpdateNetwork), and only the
// machine itself or the tailnet may change it, like the other access
// switches.
export function MergeApprovalToggle() {
  const devices = useDevicesQuery(true);
  const { data, isPending, isError, error } = useNetworkQuery(true);
  const update = useUpdateNetwork();
  const canManage = canManageDevices(devices.data?.current.via);

  if (isPending)
    return <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;

  return (
    <div className="space-y-1">
      <SettingToggle
        title="Require my approval to merge sensitive or large PRs"
        detail="PRs touching CI, deploys, secrets, build scripts, agent config or AgentOS's security code, or too big to review whole, wait for you to approve them with your passkey. Off, they merge through the usual gates, and a big PR is reviewed in parts."
        checked={data.mergeApprovals.on}
        locked={data.mergeApprovals.locked || !canManage}
        onChange={(mergeApprovals) => update.mutate({ mergeApprovals })}
      />
      {update.error && (
        <p className="text-destructive text-xs">{update.error.message}</p>
      )}
    </div>
  );
}
