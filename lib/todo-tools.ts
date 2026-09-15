import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { and, asc, eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/libsql/node";
import { z } from "zod";
import type * as schema from "@/lib/schema";
import { todos } from "@/lib/schema";
import { todoSchema } from "@/lib/todo-api";

/**
 * The one key the tools read out of Mastra's `RequestContext`, and the only
 * way a user id reaches them. The route sets it from the verified session (see
 * app/api/copilotkit/[...all]/route.ts); the AG-UI bridge writes only the
 * separate "ag-ui" key, so nothing the model or the browser sends can reach it.
 * Declaring it as a schema makes an execution without one fail before the
 * statement runs rather than fall through to some default.
 */
const requestContextSchema = z.object({ userId: z.string().min(1) });

/**
 * Builds a context the tools accept; the route and the tests share it. Left on
 * the plain `RequestContext` type because that is what `getLocalAgent` takes.
 */
export function tutorRequestContext(userId: string) {
  const requestContext = new RequestContext();
  requestContext.set("userId", userId);
  return requestContext;
}

// Same shape as lib/db.ts builds, so the app hands over its own connection and
// a test hands over one on a throwaway file.
export type TodoDb = ReturnType<typeof drizzle<typeof schema>>;

const todoColumns = { id: todos.id, title: todos.title, done: todos.done };

/**
 * The one read of the list, shared by the `listTodos` tool, the page, and
 * /api/todos so all of them show the same thing. created_at has millisecond
 * precision, so the list comes back in insertion order; id breaks the rare tie
 * so the order is stable across queries. `filter` keeps titles containing it,
 * case-insensitively for ASCII; `instr` rather than LIKE, so `%` and `_` in the
 * filter match themselves.
 */
export function listTodosFor(db: TodoDb, userId: string, filter?: string) {
  const text = filter?.trim();
  return db
    .select(todoColumns)
    .from(todos)
    .where(
      and(
        eq(todos.userId, userId),
        text
          ? sql`instr(lower(${todos.title}), lower(${text})) > 0`
          : undefined,
      ),
    )
    .orderBy(asc(todos.createdAt), asc(todos.id));
}

export type TodoItem = Awaited<ReturnType<typeof listTodosFor>>[number];

/** The one insert, shared by the `addTodo` tool and `POST /api/todos`. */
export async function addTodoFor(db: TodoDb, userId: string, title: string) {
  const [row] = await db
    .insert(todos)
    .values({ userId, title: title.trim() })
    .returning(todoColumns);
  return row;
}

/**
 * The one update, shared by the `setTodoDone` tool and `PATCH /api/todos/:id`.
 * Filtered by `userId` too, so a row belonging to another student is invisible
 * rather than merely forbidden — a stolen id reads as "no such item" (null).
 */
export async function setTodoDoneFor(
  db: TodoDb,
  userId: string,
  id: string,
  done: boolean,
) {
  const [row] = await db
    .update(todos)
    .set({ done })
    .where(and(eq(todos.id, id), eq(todos.userId, userId)))
    .returning(todoColumns);
  return row ?? null;
}

/**
 * The tutor's write path onto lib/schema.ts's `todos`, as thin wrappers over
 * the queries above with the user id taken from the request context.
 */
export function createTodoTools(db: TodoDb) {
  const listTodos = createTool({
    id: "listTodos",
    description:
      "Read the student's whole to-do list, open and completed items alike. Call this before answering any question about what is on the list.",
    inputSchema: z.object({}),
    outputSchema: z.object({ todos: z.array(todoSchema) }),
    requestContextSchema,
    // `requestContext` is typed by requestContextSchema and always present.
    execute: async (_input, { requestContext }) => ({
      todos: await listTodosFor(db, requestContext.get("userId")),
    }),
  });

  const addTodo = createTool({
    id: "addTodo",
    description:
      "Put one new item on the student's to-do list. Pass the item as a short imperative phrase; call it once per item.",
    inputSchema: z.object({
      title: z.string().min(1).describe("The item, e.g. 'Buy milk'"),
    }),
    outputSchema: z.object({ todo: todoSchema }),
    requestContextSchema,
    execute: async ({ title }, { requestContext }) => ({
      todo: await addTodoFor(db, requestContext.get("userId"), title),
    }),
  });

  const setTodoDone = createTool({
    id: "setTodoDone",
    description:
      "Mark one item on the student's list completed, or put it back to open. Take the id from listTodos.",
    inputSchema: z.object({
      id: z.string().min(1).describe("The item's id, as listTodos reported it"),
      done: z.boolean().describe("true to complete it, false to reopen it"),
    }),
    outputSchema: z.object({
      todo: todoSchema
        .nullable()
        .describe("null when the student's list holds no item with that id"),
    }),
    requestContextSchema,
    execute: async ({ id, done }, { requestContext }) => ({
      todo: await setTodoDoneFor(db, requestContext.get("userId"), id, done),
    }),
  });

  return { listTodos, addTodo, setTodoDone };
}
