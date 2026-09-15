// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  errorResponseSchema,
  listTodosResponseSchema,
  todoResponseSchema,
} from "ai-tutor-todo-api";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { authOptions } from "@/lib/auth-config";
import * as schema from "@/lib/schema";
import { todos } from "@/lib/schema";
import { removeTempDir } from "@/tests/unit/temp-dir";

// The routes run for real — lib/auth.ts with its bearer plugin, lib/db.ts, the
// shared queries — on a throwaway file that DATABASE_URL points them at. Only
// the `server-only` marker is stubbed, as it throws outside Next.js.
vi.mock("server-only", () => ({}));

const secret = "test-secret-at-least-32-characters-long";
const baseURL = "http://localhost:3000";

let dir: string;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: typeof import("@/app/api/todos/route");
let itemRoute: typeof import("@/app/api/todos/[id]/route");
let test_: Awaited<ReturnType<typeof createTestAuth>["$context"]>["test"];

// A second instance over the same file, only to mint sessions: the app's own
// has no testUtils, and a shared secret makes its signed tokens valid there.
function createTestAuth(database: typeof db) {
  return betterAuth({
    ...authOptions(database),
    secret,
    baseURL,
    plugins: [testUtils()],
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-tutor-todos-api-"));
  const url = `file:${join(dir, "test.db")}`;
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubEnv("BETTER_AUTH_URL", baseURL);

  db = drizzle({ connection: { url }, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  test_ = (await createTestAuth(db).$context).test;

  routes = await import("@/app/api/todos/route");
  itemRoute = await import("@/app/api/todos/[id]/route");
});

afterAll(async () => {
  db.$client.close();
  // lib/db.ts caches its connection on globalThis; Windows cannot delete an
  // open database file.
  const cached = globalThis as { db?: typeof db };
  cached.db?.$client.close();
  delete cached.db;
  vi.unstubAllEnvs();
  await removeTempDir(dir);
});

/** A signed-in user and the bearer token a CLI would hold for them. */
async function signIn() {
  const user = await test_.saveUser(test_.createUser());
  const { headers } = await test_.login({ userId: user.id });
  // test-utils signs the session token into the cookie it builds; that signed
  // value is exactly what sign-in's `set-auth-token` header hands a client.
  const cookie = headers.get("cookie") ?? "";
  const token = cookie.slice(cookie.indexOf("=") + 1);
  return { user, cookie, bearer: { authorization: `Bearer ${token}` } };
}

const request = (
  path: string,
  init: { method?: string; headers?: HeadersInit; body?: unknown } = {},
) =>
  new Request(`${baseURL}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function expectUnauthorized(response: Response) {
  expect(response.status).toBe(401);
  expect(errorResponseSchema.parse(await response.json())).toEqual({
    error: "unauthorized",
  });
}

describe("without a token", () => {
  test("GET /api/todos is 401", async () => {
    await expectUnauthorized(await routes.GET(request("/api/todos")));
  });

  test("POST /api/todos is 401 and writes nothing", async () => {
    await expectUnauthorized(
      await routes.POST(
        request("/api/todos", { method: "POST", body: { title: "Sneaky" } }),
      ),
    );
    expect(await db.select().from(todos)).toEqual([]);
  });

  test("PATCH /api/todos/:id is 401", async () => {
    await expectUnauthorized(
      await itemRoute.PATCH(
        request("/api/todos/some-id", {
          method: "PATCH",
          body: { done: true },
        }),
        params("some-id"),
      ),
    );
  });
});

test("a bearer token adds an item, lists it, marks it done, and filters", async () => {
  const { bearer } = await signIn();

  const created = await routes.POST(
    request("/api/todos", {
      method: "POST",
      headers: bearer,
      body: { title: "Buy milk" },
    }),
  );
  expect(created.status).toBe(201);
  const { todo } = todoResponseSchema.parse(await created.json());
  expect(todo).toEqual({
    id: expect.any(String),
    title: "Buy milk",
    done: false,
  });

  // A second item, so the filter below has something to leave out.
  await routes.POST(
    request("/api/todos", {
      method: "POST",
      headers: bearer,
      body: { title: "Walk the dog" },
    }),
  );

  const listed = await routes.GET(request("/api/todos", { headers: bearer }));
  expect(listed.status).toBe(200);
  expect(listTodosResponseSchema.parse(await listed.json()).todos).toEqual([
    todo,
    { id: expect.any(String), title: "Walk the dog", done: false },
  ]);

  const marked = await itemRoute.PATCH(
    request(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: bearer,
      body: { done: true },
    }),
    params(todo.id),
  );
  expect(marked.status).toBe(200);
  expect(todoResponseSchema.parse(await marked.json()).todo).toEqual({
    ...todo,
    done: true,
  });

  const filtered = await routes.GET(
    request("/api/todos?q=MILK", { headers: bearer }),
  );
  expect(filtered.status).toBe(200);
  expect(listTodosResponseSchema.parse(await filtered.json()).todos).toEqual([
    { ...todo, done: true },
  ]);
});

test("the sidebar's session cookie still reads the list but cannot write", async () => {
  const { cookie } = await signIn();

  const listed = await routes.GET(
    request("/api/todos", { headers: { cookie } }),
  );
  expect(listed.status).toBe(200);
  expect(listTodosResponseSchema.parse(await listed.json())).toEqual({
    todos: [],
  });

  await expectUnauthorized(
    await routes.POST(
      request("/api/todos", {
        method: "POST",
        headers: { cookie },
        body: { title: "From the browser" },
      }),
    ),
  );
});
