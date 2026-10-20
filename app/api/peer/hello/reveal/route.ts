import { helloRoute } from "@/lib/peer/hello-route";
import { receiveReveal } from "@/lib/peer/pairing";

// POST /api/peer/hello/reveal - public: the asking machine reveals the nonce
// its hello committed to.
export const POST = helloRoute((body) => receiveReveal(body));
