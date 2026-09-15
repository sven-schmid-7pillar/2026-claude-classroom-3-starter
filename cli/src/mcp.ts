import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { todoTools, toolResult } from "ai-tutor-todo-api";
import pkg from "../package.json" with { type: "json" };
import { session } from "./config";
import { addTodo, completeTodo, listTodos } from "./todos";

/**
 * Serves the todo commands as MCP tools on stdin/stdout, with the names,
 * descriptions and schemas the contract shares with the web app's /api/mcp.
 * Each call reads the stored login afresh, so the server starts without one
 * and works as soon as `ai-tutor login` has run. A handler that throws becomes
 * an `isError` result carrying the message, which is how the CLI's own errors
 * reach the client.
 */
export async function serveStdio() {
  // stdout carries the protocol alone, so anything that logs goes to stderr.
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;

  const server = new McpServer({ name: "ai-tutor", version: pkg.version });

  server.registerTool("list_todos", todoTools.list_todos, async ({ q }) =>
    toolResult(await listTodos(await session(), q)),
  );

  server.registerTool("add_todo", todoTools.add_todo, async ({ title }) =>
    toolResult(await addTodo(await session(), title)),
  );

  server.registerTool(
    "complete_todo",
    todoTools.complete_todo,
    async ({ id }) => toolResult(await completeTodo(await session(), id)),
  );

  await server.connect(new StdioServerTransport());
}
