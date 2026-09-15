import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { CLI_CLIENT_ID } from "ai-tutor-todo-api";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import { deviceAuthorization } from "better-auth/plugins";
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
