import QRCode from "qrcode";
import { formatCode, startPairing } from "./pairing";
import { reachableAt, type Reach } from "./reach";

export interface PairingLink {
  kind: Reach["kind"];
  base: string;
  link: string;
  svg: string;
}

export interface PairingOffer {
  code: string;
  display: string;
  expiresAt: number;
  /** One link per way in (Tailscale, Wi-Fi), best first; empty when nothing else can reach us. */
  links: PairingLink[];
}

// The code rides in the fragment, so it never reaches a server log.
export async function pairingOffer(): Promise<PairingOffer> {
  const { code, expiresAt } = startPairing();
  const display = formatCode(code);
  const firstOfKind = (await reachableAt()).filter(
    (r, i, all) => all.findIndex((x) => x.kind === r.kind) === i
  );
  const links = await Promise.all(
    firstOfKind.map(async (r) => {
      const link = `${r.url}/pair#${display}`;
      const svg = await QRCode.toString(link, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
      });
      return { kind: r.kind, base: r.url, link, svg };
    })
  );
  return { code, display, expiresAt, links };
}
