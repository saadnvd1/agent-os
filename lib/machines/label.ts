/** How a machine is named on every screen, so they all agree. */

export interface Nameable {
  id: string;
  name: string;
}

export const LOCAL_ID = "local";

/**
 * "spark-54423f (host)" for the machine serving this dashboard, the plain name
 * for the others; " · you're here" when the browser is on it.
 */
export function machineLabel(host: Nameable, browserHostId?: string | null) {
  const base = host.id === LOCAL_ID ? `${host.name} (host)` : host.name;
  return browserHostId && browserHostId === host.id
    ? `${base} · you're here`
    : base;
}

/** What a machine reports about itself, as one line. */
export function machineDetail(h: {
  name?: string;
  hostname?: string | null;
  os?: string | null;
  arch?: string | null;
}): string {
  // Its hostname is only news when the name isn't already it.
  const hostname =
    h.hostname && h.hostname.toLowerCase() !== h.name?.toLowerCase()
      ? h.hostname
      : null;
  return [hostname, [h.os, h.arch].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");
}
