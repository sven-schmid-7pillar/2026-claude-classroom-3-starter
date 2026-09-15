import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  createTodoRequestSchema,
  listTodosQuerySchema,
  listTodosResponseSchema,
  todoParamsSchema,
  todoResponseSchema,
} from "ai-tutor-todo-api";
import pkg from "../package.json" with { type: "json" };
import { session } from "./config";
import { addTodo, completeTodo, listTodos } from "./todos";

/** The API's response body, as structured content and as the same JSON in text. */
const body = <T extends Record<string, unknown>>(value: T) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value,
});

/**
 * Serves the todo commands as MCP tools on stdin/stdout. Each call reads the
 * stored login afresh, so the server starts without one and works as soon as
 * `ai-tutor login` has run. A handler that throws becomes an `isError` result
 * carrying the message, which is how the CLI's own errors reach the client.
 */
export async function serveStdio() {
  // stdout carries the protocol alone, so anything that logs goes to stderr.
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;

  const server = new McpServer({ name: "ai-tutor", version: pkg.version });

  server.registerTool(
    "list_todos",
    {
      title: "List to-dos",
      description:
        "List the items on the user's ai-tutor to-do list, oldest first, each with its id, title and done flag. Pass q to keep only titles containing that text.",
      inputSchema: listTodosQuerySchema,
      outputSchema: listTodosResponseSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ q }) => body(await listTodos(await session(), q)),
  );

  server.registerTool(
    "add_todo",
    {
      title: "Add a to-do",
      description:
        "Add an item to the user's ai-tutor to-do list and return it with its new id.",
      inputSchema: createTodoRequestSchema,
      outputSchema: todoResponseSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title }) => body(await addTodo(await session(), title)),
  );

  server.registerTool(
    "complete_todo",
    {
      title: "Mark a to-do done",
      description:
        "Mark an item on the user's ai-tutor to-do list done, by the id list_todos or add_todo returned, and return it. An item already done stays done.",
      inputSchema: todoParamsSchema,
      outputSchema: todoResponseSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => body(await completeTodo(await session(), id)),
  );

  await server.connect(new StdioServerTransport());
}
