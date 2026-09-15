import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin, so the client needs no baseURL. The device plugin backs the
// approve and deny buttons on /device. The OAuth provider plugin adds the
// signed authorization request in the page's URL to every call a form makes,
// which is how /login, /signup and /consent resume an MCP client's sign-in.
export const authClient = createAuthClient({
  plugins: [deviceAuthorizationClient(), oauthProviderClient()],
});
