import { helloRoute } from "@/lib/peer/hello-route";
import { receiveHello } from "@/lib/peer/pairing";

// POST /api/peer/hello - public: another machine on this Connect account
// asks to link (lib/peer/pairing.ts).
export const POST = helloRoute((body) => receiveHello(body));
