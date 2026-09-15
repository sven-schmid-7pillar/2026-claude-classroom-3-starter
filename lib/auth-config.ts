import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { mcp } from "@better-auth/mcp";
import { CLI_CLIENT_ID, MCP_PATH } from "ai-tutor-todo-api";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import { deviceAuthorization, jwt } from "better-auth/plugins";
import * as schema from "@/lib/schema";

type DrizzleDb = Parameters<typeof drizzleAdapter>[0];

/**
 * Everything about the auth instance except the plugins, which each entry point
 * spreads in as a static array — Better Auth only infers plugin helpers (such as
 * `ctx.test`) from literal arrays. Kept free of the `server-only` marker in
 * lib/db.ts so the Better Auth CLI and the Vitest suite can load it.
 */
export function authOptions(db: DrizzleDb) {
  return {
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true },
    // The JWT plugin's /token signs session JWTs, which nothing here accepts.
    disabledPaths: ["/token"],
  } satisfies BetterAuthOptions;
}

/**
 * The device authorization grant behind `ai-tutor login`. Only the CLI's own
 * client id may start one, and people approve the code on app/device/page.tsx
 * (Better Auth's `/api/auth/device` is the JSON endpoint behind that page).
 */
export const cliDeviceAuthorization = () =>
  deviceAuthorization({
    verificationUri: "/device",
    validateClient: (clientId) => clientId === CLI_CLIENT_ID,
  });

/**
 * `/device/token` answers with the raw session token — the very value stored
 * in the session table, which `bearer({ requireSignature: true })` refuses.
 * This signs it the way the session cookie is signed, so the CLI holds the same
 * credential sign-in's `set-auth-token` header hands any other client.
 */
export const signedDeviceToken = () =>
  ({
    id: "signed-device-token",
    hooks: {
      after: [
        {
          matcher: (context) => context.path === "/device/token",
          handler: createAuthMiddleware(async (ctx) => {
            // An error is an APIError, and success is the JSON body, wrapped
            // when the endpoint was called for a Response.
            const returned = ctx.context.returned as
              | { access_token?: unknown; body?: { access_token?: unknown } }
              | undefined;
            const body =
              returned && "body" in returned ? returned.body : returned;
            if (!body || returned instanceof Error) {
              return;
            }
            const token = body.access_token;
            if (typeof token !== "string") {
              return;
            }
            const signature = await makeSignature(token, ctx.context.secret);
            return ctx.json({ ...body, access_token: `${token}.${signature}` });
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;

/** The scope /api/mcp requires of an access token. */
export const MCP_SCOPE = "todos";

/**
 * The canonical URL of /api/mcp: the RFC 8707 `resource` an MCP client asks a
 * token for, the audience that token carries, and the RFC 9728 metadata's
 * `resource`. It lives on BETTER_AUTH_URL's origin, like every auth URL.
 */
export function mcpResource(baseURL = process.env.BETTER_AUTH_URL) {
  if (!baseURL) {
    throw new Error("BETTER_AUTH_URL must be set to derive the MCP resource");
  }
  return new URL(MCP_PATH, baseURL).href;
}

/** Signs the access tokens /api/mcp verifies against /api/auth/jwks. */
export const mcpTokenSigning = () => jwt({ disableSettingJwtHeader: true });

/**
 * The OAuth 2.1 authorization server for /api/mcp, which signs people in on
 * /login and asks them on /consent. Only grants made by a signed-in user are
 * enabled, so every access token's subject is a user id.
 */
export const mcpAuthorization = (baseURL?: string) =>
  mcp({
    loginPage: "/login",
    consentPage: "/consent",
    resource: mcpResource(baseURL),
    scopes: [MCP_SCOPE, "offline_access"],
    grantTypes: ["authorization_code", "refresh_token"],
  });

/**
 * Client ID Metadata Documents: a client such as Claude Code identifies itself
 * by the HTTPS URL of a JSON document it hosts, so it needs no registration.
 * The Node transport refuses private addresses and redirects.
 */
export const mcpClientMetadata = () =>
  cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" });
