import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";
import {
  createTodoRequestSchema,
  listTodosQuerySchema,
  listTodosResponseSchema,
  todoParamsSchema,
  todoResponseSchema,
} from "ai-tutor-todo-api";
import { afterAll, beforeAll, expect, test } from "vitest";
import { removeTempDir } from "@/tests/unit/temp-dir";
import { type Harness, harness } from "./harness";

/*
 * `ai-tutor mcp --stdio` as an MCP client sees it: the SDK spawns the built
 * CLI and speaks the protocol over its stdin and stdout, against the web app
 * tests/integration/server.ts runs. The tests run in order on one connection,
 * which starts with no token stored and gets one halfway through.
 */

let h: Harness;
let configDir: string;
let client: Client;
let stderr = "";
const clientErrors: Error[] = [];

beforeAll(async () => {
  h = await harness();
  configDir = await mkdtemp(join(tmpdir(), "ai-tutor-mcp-"));

  // The SDK's default environment, as a client like Claude Code passes it.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [h.cli, "mcp", "--stdio"],
    env: {
      ...getDefaultEnvironment(),
      AI_TUTOR_URL: h.server,
      AI_TUTOR_CONFIG_DIR: configDir,
    },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  client = new Client({ name: "ai-tutor-mcp-test", version: "0.0.0" });
  // Among others, a stdout line that is not a JSON-RPC message lands here.
  client.onerror = (error) => {
    clientErrors.push(error);
  };
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client?.close();
  h?.db.$client.close();
  if (configDir) {
    await removeTempDir(configDir);
  }
});

test("lists the todo tools with input schemas from the shared contract", async () => {
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  expect(Object.keys(byName).sort()).toEqual([
    "add_todo",
    "complete_todo",
    "list_todos",
  ]);

  expect(byName.list_todos.inputSchema).toMatchObject({
    type: "object",
    properties: {
      q: {
        type: "string",
        description: listTodosQuerySchema.shape.q.description,
      },
    },
  });
  expect(byName.list_todos.inputSchema.required ?? []).toEqual([]);
  expect(byName.list_todos.annotations?.readOnlyHint).toBe(true);

  expect(byName.add_todo.inputSchema).toMatchObject({
    type: "object",
    properties: {
      title: {
        type: "string",
        minLength: 1,
        description: createTodoRequestSchema.shape.title.description,
      },
    },
    required: ["title"],
  });

  expect(byName.complete_todo.inputSchema).toMatchObject({
    type: "object",
    properties: {
      id: {
        type: "string",
        minLength: 1,
        description: todoParamsSchema.shape.id.description,
      },
    },
    required: ["id"],
  });
}, 60_000);

test("without a stored token every tool call says to run ai-tutor login", async () => {
  for (const [name, args] of [
    ["list_todos", {}],
    ["add_todo", { title: "Buy milk" }],
    ["complete_todo", { id: "any" }],
  ] as const) {
    const result = await call(name, args);
    expect(result.isError, name).toBe(true);
    expect(text(result), name).toBe(
      `Not logged in to ${h.server}. Run: ai-tutor login`,
    );
  }
}, 60_000);

test("add, list with and without a filter, and done once a token is stored", async () => {
  // What `ai-tutor login` would leave behind, for a user of this file's own.
  const user = await h.helpers.saveUser(
    h.helpers.createUser({ email: "mcp-user@example.com" }),
  );
  const { headers } = await h.helpers.login({ userId: user.id });
  // test-utils signs the session token into the cookie it builds, which is the
  // form the device grant hands the CLI.
  const cookie = headers.get("cookie") ?? "";
  await writeFile(
    join(configDir, "hosts.json"),
    JSON.stringify({
      [h.server]: {
        token: cookie.slice(cookie.indexOf("=") + 1),
        email: user.email,
      },
    }),
  );

  const added = await call("add_todo", { title: "Buy milk" });
  expect(added.isError, text(added)).toBeFalsy();
  const { todo: milk } = todoResponseSchema.parse(added.structuredContent);
  expect(milk).toMatchObject({ title: "Buy milk", done: false });
  expect(JSON.parse(text(added))).toEqual(added.structuredContent);

  const dog = await call("add_todo", { title: "Walk the dog" });
  expect(dog.isError, text(dog)).toBeFalsy();

  const blank = await call("add_todo", { title: "   " });
  expect(blank.isError).toBe(true);
  expect(text(blank)).toContain("Input validation error");

  const filtered = await call("list_todos", { q: "MILK" });
  expect(filtered.isError, text(filtered)).toBeFalsy();
  expect(listTodosResponseSchema.parse(filtered.structuredContent)).toEqual({
    todos: [milk],
  });

  const done = await call("complete_todo", { id: milk.id });
  expect(done.isError, text(done)).toBeFalsy();
  expect(todoResponseSchema.parse(done.structuredContent)).toEqual({
    todo: { ...milk, done: true },
  });

  const missing = await call("complete_todo", { id: "no-such-id" });
  expect(missing.isError).toBe(true);
  expect(text(missing)).toContain("No item with id no-such-id");

  const listed = await call("list_todos", {});
  expect(listTodosResponseSchema.parse(listed.structuredContent)).toEqual({
    todos: [
      { ...milk, done: true },
      { id: expect.any(String), title: "Walk the dog", done: false },
    ],
  });
}, 120_000);

test("stdout carried nothing but protocol messages", () => {
  expect(clientErrors, stderr).toEqual([]);
});

test("mcp without --stdio fails without starting a server", async () => {
  const result = await new Promise<{
    code: unknown;
    stdout: string;
    stderr: string;
  }>((done) => {
    execFile(process.execPath, [h.cli, "mcp"], (error, stdout, stderr) => {
      done({ code: error?.code, stdout, stderr });
    });
  });
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("--stdio");
}, 60_000);

const call = (name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });

const text = (result: Awaited<ReturnType<typeof call>>) =>
  result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
