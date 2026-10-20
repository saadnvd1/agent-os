/**
 * What pairing tells the person: a request waiting for its code here, and a
 * machine linked. Pushed to paired phones (or Telegram); never throws.
 */

import { notifyPhone } from "../notify";

const short = (name: string) => name.replace(/\s+/g, " ").slice(0, 60);

export function notifyLinkRequest(name: string) {
  notifyPhone(
    "peer-link",
    `${short(name)} wants to link to this machine. Type the code it shows in Machines to allow it.`,
    {
      category: "system",
      key: `peer-link:${Date.now()}`,
      collapse: "peer-link",
    }
  );
}

export function notifyLinked(name: string) {
  notifyPhone(
    "peer-link",
    `New machine linked: ${short(name)}. It can start agents and run code here; unlink it in Machines.`,
    {
      category: "system",
      key: `peer-linked:${Date.now()}`,
      collapse: "peer-link",
    }
  );
}
