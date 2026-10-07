/**
 * What POST /api/pair/claim answers. A browser gets its token only as an
 * HttpOnly cookie, so page script can never read it. A native app has no
 * cookie jar it controls, so it asks for the token in the body; that's
 * honoured only when no Origin header came with the request, which every
 * browser sends on a cross- or same-origin POST.
 */

export interface ClaimBody {
  device: { id: string; name: string };
  token?: string;
}

export function claimResponseBody(
  device: { id: string; name: string },
  token: string,
  request: { wantsToken?: unknown; origin: string | null }
): ClaimBody {
  const native = request.wantsToken === true && !request.origin;
  return { device, ...(native ? { token } : {}) };
}
