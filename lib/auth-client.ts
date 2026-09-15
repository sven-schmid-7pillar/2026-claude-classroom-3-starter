import { deviceAuthorizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin, so the client needs no baseURL. The device plugin backs the
// approve and deny buttons on /device.
export const authClient = createAuthClient({
  plugins: [deviceAuthorizationClient()],
});
