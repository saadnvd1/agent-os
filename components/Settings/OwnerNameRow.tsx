"use client";

import { useClientConfig } from "@/data/client-config/queries";
import { useSetOwnerName } from "@/data/owner/mutations";
import { SettingSection } from "./SettingRow";
import { TextSetting } from "./settings-fields";

// The name AgentOS and the orchestrators use when they refer to you.
export function OwnerNameRow() {
  const saved = useClientConfig().data?.ownerName ?? "";
  const save = useSetOwnerName();
  return (
    <SettingSection>
      <TextSetting
        id="owner-name"
        label="Your name"
        help="Used where AgentOS and your orchestrators refer to you. Orchestrators pick it up when they next start."
        placeholder="Not set"
        value={saved}
        maxLength={40}
        onSave={(name) => save.mutateAsync(name || null)}
      />
    </SettingSection>
  );
}
