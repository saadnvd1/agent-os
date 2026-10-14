import type { Migration } from "../migration-types";

export default {
  id: 83,
  name: "native_devices_can_approve",
  up: (db) => {
    // New native pairings start with Can approve; this gives it once to the
    // ones paired before. The claim wasn't recorded, so the app is known by
    // its user agent (`AgentOS/<build> CFNetwork/...` on iOS) or by an
    // app push token. It only ever turns the flag on.
    db.exec(
      `UPDATE devices SET can_approve = 1
         WHERE revoked_at IS NULL AND can_approve = 0
           AND (user_agent LIKE 'AgentOS/% CFNetwork/%'
                OR push_platform IN ('ios', 'android'))`
    );
  },
} satisfies Migration;
