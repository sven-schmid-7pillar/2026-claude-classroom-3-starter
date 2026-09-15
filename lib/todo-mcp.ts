import { McpServer } from "@modelcontextprotocol/server";
import { todoTools, toolResult } from "ai-tutor-todo-api";
import {
  addTodoFor,
  listTodosFor,
  setTodoDoneFor,
  type TodoDb,
} from "@/lib/todo-tools";
import pkg from "@/package.json";

/**
 * The MCP server behind /api/mcp for one user: the tools `ai-tutor mcp --stdio`
 * serves, on the queries /api/todos runs. The route builds one per request
 * from the verified access token, so no tool input can name another user.
 */
export function createTodoMcpServer(db: TodoDb, userId: string) {
  const server = new McpServer({ name: "ai-tutor", version: pkg.version });

  server.registerTool("list_todos", todoTools.list_todos, async ({ q }) =>
    toolResult({ todos: await listTodosFor(db, userId, q) }),
  );

  server.registerTool("add_todo", todoTools.add_todo, async ({ title }) =>
    toolResult({ todo: await addTodoFor(db, userId, title) }),
  );

  server.registerTool(
    "complete_todo",
    todoTools.complete_todo,
    async ({ id }) => {
      const todo = await setTodoDoneFor(db, userId, id, true);
      // Thrown, the SDK returns it as an `isError` result, as the CLI's do.
      if (!todo) {
        throw new Error(
          `No item with id ${id} on your list. Call list_todos to see the ids.`,
        );
      }
      return toolResult({ todo });
    },
  );

  return server;
}
