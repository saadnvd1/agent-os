import { helloRoute } from "@/lib/peer/hello-route";
import { receiveStatus } from "@/lib/peer/pairing";

// POST /api/peer/hello/status - public: the asking machine learns, signed,
// whether the code was typed here.
export const POST = helloRoute((body) => receiveStatus(body));
