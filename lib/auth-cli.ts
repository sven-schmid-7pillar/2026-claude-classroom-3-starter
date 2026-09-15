import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/libsql/node";
import {
  authOptions,
  cliDeviceAuthorization,
  mcpClientMetadata,
  mcpTokenSigning,
} from "@/lib/auth-config";

/**
 * Config target for `npm run auth:generate` only. The Better Auth CLI refuses to
 * load a module graph containing `server-only`, which rules out lib/auth.ts, and
 * `generate` never queries the database — hence the throwaway connection. Lists
 * every plugin of lib/auth.ts that brings a table of its own, except that the
 * bare oauthProvider() stands in for mcpAuthorization(): mcp() is that provider
 * with the same tables, but seeds its resource row at startup, which fails on
 * an empty database.
 */
export const auth = betterAuth({
  ...authOptions(drizzle({ connection: { url: ":memory:" } })),
  plugins: [
    cliDeviceAuthorization(),
    mcpTokenSigning(),
    oauthProvider({ loginPage: "/login", consentPage: "/consent" }),
    mcpClientMetadata(),
  ],
});
