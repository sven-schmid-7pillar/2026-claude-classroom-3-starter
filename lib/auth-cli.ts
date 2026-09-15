import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/libsql/node";
import { authOptions, cliDeviceAuthorization } from "@/lib/auth-config";

/**
 * Config target for `npm run auth:generate` only. The Better Auth CLI refuses to
 * load a module graph containing `server-only`, which rules out lib/auth.ts, and
 * `generate` never queries the database — hence the throwaway connection. Lists
 * every plugin of lib/auth.ts that brings a table of its own.
 */
export const auth = betterAuth({
  ...authOptions(drizzle({ connection: { url: ":memory:" } })),
  plugins: [cliDeviceAuthorization()],
});
