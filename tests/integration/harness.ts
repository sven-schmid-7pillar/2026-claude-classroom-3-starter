import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/libsql/node";
import { inject } from "vitest";
import { authOptions } from "@/lib/auth-config";

/**
 * What tests/integration/server.ts provides, plus Better Auth's test helpers
 * over the server's database and secret, so the sessions they mint pass there.
 * Close `db` when the file is done.
 */
export async function harness() {
  const provided = inject("integration");
  const db = drizzle({ connection: { url: provided.databaseUrl } });
  const helpers = (
    await betterAuth({
      ...authOptions(db),
      secret: provided.secret,
      baseURL: provided.server,
      plugins: [testUtils()],
    }).$context
  ).test;
  return { ...provided, db, helpers };
}

export type Harness = Awaited<ReturnType<typeof harness>>;
