import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatUserCode,
  listTodosResponseSchema,
  todoResponseSchema,
} from "ai-tutor-todo-api";
import { afterAll, beforeAll, expect, test } from "vitest";
import { removeTempDir } from "@/tests/unit/temp-dir";
import { type Harness, harness } from "./harness";

/*
 * `ai-tutor` end to end: the CLI exactly as `npm install` builds it, against
 * the web app tests/integration/server.ts runs, with the token file redirected
 * into a temp directory. Nobody opens a browser — a session minted by Better
 * Auth's test utils plays the signed-in user who approves the code. The tests
 * run in order and share that state.
 */

const email = "cli-user@example.com";

let h: Harness;
let dir: string;
let configDir: string;
let token: string;

beforeAll(async () => {
  h = await harness();
  dir = await mkdtemp(join(tmpdir(), "ai-tutor-cli-"));
  configDir = join(dir, "config");
});

afterAll(async () => {
  h?.db.$client.close();
  if (dir) {
    await removeTempDir(dir);
  }
});

test("login prints a URL and a code, then stores a token once the code is approved", async () => {
  const login = spawn(process.execPath, [h.cli, "login"], { env: cliEnv() });
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
  expect(approvalUrl).toBe(`${h.server}/device?user_code=${userCode}`);
  expect(stdout).toContain(formatUserCode(userCode));

  const user = await h.helpers.saveUser(
    h.helpers.createUser({ email, name: "Cli User" }),
  );
  const cookie =
    (await h.helpers.getAuthHeaders({ userId: user.id })).get("cookie") ?? "";

  // Opening the printed URL while signed in binds the code to that session…
  const page = await fetch(approvalUrl, { headers: { cookie } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain(formatUserCode(userCode));

  // …after which that session may approve it, as the page's button does.
  const approval = await fetch(`${h.server}/api/auth/device/approve`, {
    method: "POST",
    headers: { cookie, origin: h.server, "content-type": "application/json" },
    body: JSON.stringify({ userCode }),
  });
  expect(approval.status).toBe(200);

  expect(await status, stdout + stderr).toBe(0);
  expect(stdout).toContain(`Logged in to ${h.server} as ${email}.`);

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

  const withOldToken = await fetch(`${h.server}/api/todos`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(withOldToken.status).toBe(401);
}, 60_000);

test("whoami fails once logged out", async () => {
  const result = await run("whoami");
  expect(result.status).toBe(4);
  expect(result.stderr).toContain(`Not logged in to ${h.server}`);
}, 60_000);

const cliEnv = () => ({
  ...process.env,
  AI_TUTOR_URL: h.server,
  AI_TUTOR_CONFIG_DIR: configDir,
});

function run(...args: string[]) {
  return new Promise<{ status: number; stdout: string; stderr: string }>(
    (done, fail) => {
      execFile(
        process.execPath,
        [h.cli, ...args],
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
    return hosts[h.server]?.token;
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
