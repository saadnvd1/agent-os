// What a paired device signs to prove a person is there. Client-safe (no
// database, no node modules), so the app builds the same bytes the server
// checks. The server rebuilds it from its own record of the challenge; what
// the client says it signed is never used.

export const DEVICE_KEY_DOMAIN = "AgentOS device approval v1";

export interface DeviceKeyMessage {
  challenge: string;
  purpose: string;
  binding: string;
  deviceId: string;
}

export function deviceKeyMessage(m: DeviceKeyMessage): string {
  return [
    DEVICE_KEY_DOMAIN,
    m.challenge,
    m.purpose,
    m.binding,
    m.deviceId,
  ].join("\n");
}

// A device key's relying-party id in the passkeys table. It can never equal
// a host name, so the browser flow never sees these keys.
export const deviceRp = (deviceId: string) => `device:${deviceId}`;
