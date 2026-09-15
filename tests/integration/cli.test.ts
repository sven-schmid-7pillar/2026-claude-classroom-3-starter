// @vitest-environment node
import {
  type ChildProcess,
  execFile,
  execFileSync,
  spawn,
} from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  formatUserCode,
  listTodosResponseSchema,
  todoResponseSchema,
} from "ai-tutor-todo-api";
import { betterAuth } from "better-auth";
import { type TestHelpers, testUtils } from "better-auth/plugins";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { afterAll, beforeAll, expect, test } from "vitest";
import { authOptions } from "@/lib/auth-config";
import { removeTempDir } from "@/tests/unit/temp-dir";

/*
 * `ai-tutor` end to end: the CLI exactly as `npm install` builds it, against
 * the web app under `next dev` on a spare port, over a throwaway database, with
 * the token file redirected into a temp directory. Nobody opens a browser — a
 * session minted by Better Auth's test utils plays the signed-in user who
 * approves the code. The tests run in order and share that state.
 */

const root = resolve(import.meta.dirname, "..", "..");
const cli = join(root, "cli", "dist", "index.js");
const secret = "cli-integration-secret-at-least-32-chars";
const email = "cli-user@example.com";

let dir: string;
let configDir: string;
let db: ReturnType<typeof drizzle>;
let next: ChildProcess | undefined;
let nextOutput = "";
let server: string;
let helpers: TestHelpers;
let token: string;

beforeAll(async () => {
  execFileSync(process.execPath, ["build.mjs"], { cwd: join(root, "cli") });

  dir = await mkdtemp(join(tmpdir(), "ai-tutor-cli-"));
  configDir = join(dir, "config");
  const url = `file:${join(dir, "app.db")}`;
  db = drizzle({ connection: { url } });
  await migrate(db, { migrationsFolder: join(root, "drizzle") });

  server = `http://localhost:${await sparePort()}`;
  // The server's secret, so the session cookies these helpers sign pass there.
  helpers = (
    await betterAuth({
      ...authOptions(db),
      secret,
      baseURL: server,
      plugins: [testUtils()],
    }).$context
  ).test;

  const child = spawn(
    process.execPath,
    [
      join(root, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--port",
      new URL(server).port,
    ],
    {
      cwd: root,
      // Own dist dir (see next.config.ts), so neither `npm run dev` nor the
      // Playwright server stands in the way. NODE_ENV replaces Vitest's
      // `test`, which `next dev` warns about.
      env: {
        ...process.env,
        NODE_ENV: "development",
        NEXT_DIST_DIR: ".next-cli-e2e",
        DATABASE_URL: url,
        BETTER_AUTH_URL: server,
        BETTER_AUTH_SECRET: secret,
      },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group on POSIX, so stopServer can end the whole tree.
      detached: process.platform !== "win32",
    },
  );
  next = child;
  child.stdout?.on("data", (chunk) => {
    nextOutput += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    nextOutput += chunk;
  });
  await waitForServer();
}, 240_000);

afterAll(async () => {
  await stopServer();
  db?.$client.close();
  if (dir) {
    await removeTempDir(dir);
  }
}, 60_000);

test("login prints a URL and a code, then stores a token once the code is approved", async () => {
  const login = spawn(process.execPath, [cli, "login"], { env: cliEnv() });
  let stdout = "";
  let stderr = "";
  login.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  login.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const status = new Promise<number | null>((done) => login.on("close", done));

  const approvalUrl = await until(
    () => stdout.match(/(http\S+\?user_code=\S+)/)?.[1],
    () => `login printed no approval URL:\n${stdout}${stderr}`,
  );
  const userCode = new URL(approvalUrl).searchParams.get("user_code") ?? "";
  expect(approvalUrl).toBe(`${server}/device?user_code=${userCode}`);
  expect(stdout).toContain(formatUserCode(userCode));

  const user = await helpers.saveUser(
    helpers.createUser({ email, name: "Cli User" }),
  );
  const cookie =
    (await helpers.getAuthHeaders({ userId: user.id })).get("cookie") ?? "";

  // Opening the printed URL while signed in binds the code to that session…
  const page = await fetch(approvalUrl, { headers: { cookie } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain(formatUserCode(userCode));

  // …after which that session may approve it, as the page's button does.
  const approval = await fetch(`${server}/api/auth/device/approve`, {
    method: "POST",
    headers: { cookie, origin: server, "content-type": "application/json" },
    body: JSON.stringify({ userCode }),
  });
  expect(approval.status).toBe(200);

  expect(await status, stdout + stderr).toBe(0);
  expect(stdout).toContain(`Logged in to ${server} as ${email}.`);

  token = (await storedToken()) ?? "";
  expect(token).not.toBe("");
  expect(stdout + stderr).not.toContain(token);
  if (process.platform !== "win32") {
    const { mode } = await stat(join(configDir, "hosts.json"));
    expect(mode & 0o777).toBe(0o600);
  }
}, 120_000);

test("whoami names the account behind the token", async () => {
  const result = await run("whoami");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(email);
}, 60_000);

test("add, list with and without a filter, and done", async () => {
  const added = await run("add", "Buy", "milk", "--json");
  expect(added.status, added.stderr).toBe(0);
  const { todo: milk } = todoResponseSchema.parse(JSON.parse(added.stdout));
  expect(milk).toMatchObject({ title: "Buy milk", done: false });

  const dog = await run("add", "Walk the dog");
  expect(dog.status, dog.stderr).toBe(0);
  expect(dog.stdout).toMatch(/^\S+ {2}\[ \] {2}Walk the dog$/m);

  const listed = await run("list", "--json");
  expect(listed.status, listed.stderr).toBe(0);
  expect(
    listTodosResponseSchema
      .parse(JSON.parse(listed.stdout))
      .todos.map((todo) => todo.title),
  ).toEqual(["Buy milk", "Walk the dog"]);

  const filtered = await run("list", "--query", "MILK");
  expect(filtered.status, filtered.stderr).toBe(0);
  expect(filtered.stdout).toBe(`${milk.id}  [ ]  Buy milk\n`);

  const done = await run("done", milk.id);
  expect(done.status, done.stderr).toBe(0);
  expect(done.stdout).toBe(`${milk.id}  [x]  Buy milk\n`);

  const missing = await run("done", "no-such-id");
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain("No item with id no-such-id");

  const after = await run("list", "--json");
  expect(listTodosResponseSchema.parse(JSON.parse(after.stdout)).todos).toEqual(
    [
      { ...milk, done: true },
      { id: expect.any(String), title: "Walk the dog", done: false },
    ],
  );
}, 120_000);

test("logout revokes the token on the server and deletes it", async () => {
  const result = await run("logout");
  expect(result.status, result.stderr).toBe(0);
  expect(await storedToken()).toBeUndefined();

  const withOldToken = await fetch(`${server}/api/todos`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(withOldToken.status).toBe(401);
}, 60_000);

test("whoami fails once logged out", async () => {
  const result = await run("whoami");
  expect(result.status).toBe(4);
  expect(result.stderr).toContain(`Not logged in to ${server}`);
}, 60_000);

const cliEnv = () => ({
  ...process.env,
  AI_TUTOR_URL: server,
  AI_TUTOR_CONFIG_DIR: configDir,
});

function run(...args: string[]) {
  return new Promise<{ status: number; stdout: string; stderr: string }>(
    (done, fail) => {
      execFile(
        process.execPath,
        [cli, ...args],
        { env: cliEnv() },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") {
            fail(error);
            return;
          }
          done({ status: error ? Number(error.code) : 0, stdout, stderr });
        },
      );
    },
  );
}

async function storedToken(): Promise<string | undefined> {
  try {
    const hosts = JSON.parse(
      await readFile(join(configDir, "hosts.json"), "utf8"),
    );
    return hosts[server]?.token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

const sleep = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

async function until<T>(
  read: () => T | undefined,
  failure: () => string,
  timeout = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(failure());
    }
    await sleep(100);
  }
}

function sparePort() {
  return new Promise<number>((done, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (next?.exitCode !== null) {
      throw new Error(`next dev exited early:\n${nextOutput}`);
    }
    try {
      if ((await fetch(`${server}/api/auth/ok`)).ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  throw new Error(`next dev did not answer within 3 minutes:\n${nextOutput}`);
}

async function stopServer() {
  const child = next;
  if (!child?.pid || child.exitCode !== null) {
    return;
  }
  const exited = new Promise((done) => child.once("exit", done));
  // `next dev` serves from a child process of its own, so end the whole tree.
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
  } else {
    process.kill(-child.pid, "SIGTERM");
  }
  await exited;
}
