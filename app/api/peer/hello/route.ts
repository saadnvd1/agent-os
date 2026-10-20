import { helloRoute } from "@/lib/peer/hello-route";
import { receiveHello } from "@/lib/peer/pairing";
import { SOURCE_HEADER } from "@/lib/security/auth";

// POST /api/peer/hello - public: another machine on this Connect account
// asks to link (lib/peer/pairing.ts).
export const POST = helloRoute((body, request) =>
  receiveHello(body, undefined, request.headers.get(SOURCE_HEADER) ?? "unknown")
);
