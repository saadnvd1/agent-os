"use client";

import { Button } from "@/components/ui/button";
import { settingsUiActions } from "@/stores/settingsUi";
import { welcomeUiActions } from "@/stores/welcomeUi";
import { AppWideLimits } from "./AppWideLimits";
import { OwnerNameRow } from "./OwnerNameRow";
import { SettingRow, SettingSection } from "./SettingRow";

// The app-wide basics: who you are, alerts that apply everywhere, and the
// first-run setup again.
export function GeneralSection() {
  return (
    <div className="space-y-5">
      <OwnerNameRow />
      <AppWideLimits />
      <SettingSection>
        <SettingRow
          id="first-run-setup"
          label="First-run setup"
          help="Agents, your first project, and a first session."
          control={
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-8"
              onClick={() => {
                settingsUiActions.close();
                welcomeUiActions.open("agents");
              }}
            >
              Run setup again
            </Button>
          }
        />
      </SettingSection>
    </div>
  );
}
