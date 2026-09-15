// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { removeTempDir } from "@/tests/unit/temp-dir";

// /api/mcp and the discovery routes run for real — lib/auth.ts with its mcp()
// plugin, on a migrated throwaway file — and are walked the way an MCP client
// walks them: the 401 names the resource metadata, that names the issuer, and
// the issuer gives the authorization server metadata's URL. Only the
// `server-only` marker is stubbed, as it throws outside Next.js.
vi.mock("server-only", () => ({}));

const baseURL = "http://localhost:3000";

let dir: string;
let mcpRoute: typeof import("@/app/api/mcp/route");
let wellKnown: typeof import("@/app/.well-known/[...path]/route");

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-tutor-mcp-route-"));
  const url = `file:${join(dir, "test.db")}`;
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-at-least-32-characters-long");
  vi.stubEnv("BETTER_AUTH_URL", baseURL);

  const db = drizzle({ connection: { url } });
  await migrate(db, { migrationsFolder: "./drizzle" });
  db.$client.close();

  mcpRoute = await import("@/app/api/mcp/route");
  wellKnown = await import("@/app/.well-known/[...path]/route");
});

afterAll(async () => {
  // lib/db.ts caches its connection on globalThis; Windows cannot delete an
  // open database file.
  const cached = globalThis as { db?: { $client: { close(): void } } };
  cached.db?.$client.close();
  delete cached.db;
  vi.unstubAllEnvs();
  await removeTempDir(dir);
});

const initialize = (headers: HeadersInit = {}) =>
  new Request(`${baseURL}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "mcp-route-test", version: "0.0.0" },
      },
    }),
  });

const challenge = `Bearer resource_metadata="${baseURL}/.well-known/oauth-protected-resource/api/mcp", scope="todos"`;

test("POST /api/mcp without a token is 401 with the WWW-Authenticate challenge", async () => {
  const response = await mcpRoute.POST(initialize());

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe(challenge);
  expect(await response.json()).toMatchObject({
    jsonrpc: "2.0",
    error: { code: -32000 },
    id: null,
  });
});

test("a token that is not an access token gets the same challenge", async () => {
  const response = await mcpRoute.POST(
    initialize({ authorization: "Bearer not-an-access-token" }),
  );

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe(challenge);
});

test("the challenge leads to the resource and authorization server metadata", async () => {
  const header = (await mcpRoute.POST(initialize())).headers.get(
    "www-authenticate",
  );
  const resourceMetadataUrl = /resource_metadata="([^"]+)"/.exec(
    header ?? "",
  )?.[1];
  expect(resourceMetadataUrl).toBeDefined();

  const resource = await wellKnown.GET(new Request(resourceMetadataUrl ?? ""));
  expect(resource.status).toBe(200);
  const resourceMetadata = await resource.json();
  expect(resourceMetadata).toMatchObject({
    resource: `${baseURL}/api/mcp`,
    authorization_servers: [`${baseURL}/api/auth`],
    scopes_supported: ["todos"],
    bearer_methods_supported: ["header"],
  });

  // RFC 8414 inserts the issuer's path after the well-known segment.
  const issuer = new URL(resourceMetadata.authorization_servers[0]);
  const server = await wellKnown.GET(
    new Request(
      `${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`,
    ),
  );
  expect(server.status).toBe(200);
  const serverMetadata = await server.json();
  expect(serverMetadata).toMatchObject({
    issuer: issuer.href,
    authorization_endpoint: `${issuer.href}/oauth2/authorize`,
    token_endpoint: `${issuer.href}/oauth2/token`,
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
  });
  expect(serverMetadata).not.toHaveProperty("registration_endpoint");
});

test("other well-known paths are not found", async () => {
  const response = await wellKnown.GET(
    new Request(`${baseURL}/.well-known/security.txt`),
  );
  expect(response.status).toBe(404);
});
