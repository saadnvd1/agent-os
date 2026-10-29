"use client";

import type { AnchorHTMLAttributes } from "react";
import { useSessionHref } from "@/hooks/useSessionHref";
import { openSessionLink } from "./session-link";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  sessionId: string;
};

// A link to a session at its readable address. A plain click opens it here;
// a modified one, a new tab. An own onClick replaces the open.
export function SessionAnchor({ sessionId, onClick, ...rest }: Props) {
  const href = useSessionHref(sessionId);
  return (
    <a
      href={href}
      onClick={onClick ?? ((e) => openSessionLink(e, sessionId))}
      {...rest}
    />
  );
}
