import {
  createTodoRequestSchema,
  errorResponseSchema,
  listTodosQuerySchema,
  listTodosResponseSchema,
  TODOS_PATH,
  type Todo,
  todoPath,
  todoResponseSchema,
  updateTodoRequestSchema,
} from "ai-tutor-todo-api";
import type { z } from "zod";
import { CliError, reach, tokenRejected } from "./errors";

/** Where and as whom to call the API. */
export interface Api {
  server: string;
  token: string;
}

/** One item as every command prints it: `<id>  [ ]  <title>`, `[x]` once done. */
export const formatTodo = (todo: Todo) =>
  `${todo.id}  [${todo.done ? "x" : " "}]  ${todo.title}`;

/** Checks input against the contract before it goes on the wire. */
function input<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => issue.message);
    throw new CliError(`Invalid ${what}: ${reasons.join("; ")}`);
  }
  return parsed.data;
}

async function call<T>(
  api: Api,
  path: string,
  init: { method: string; body?: unknown; notFound?: string },
  schema: z.ZodType<T>,
): Promise<T> {
  const url = `${api.server}${path}`;
  const response = await reach(api.server, () =>
    fetch(url, {
      method: init.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${api.token}`,
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  const body: unknown = await response.json().catch(() => undefined);

  if (response.ok) {
    const parsed = schema.safeParse(body);
    if (parsed.success) {
      return parsed.data;
    }
    throw new CliError(`Unexpected response from ${init.method} ${url}.`);
  }

  if (response.status === 401) {
    throw tokenRejected(api.server);
  }
  const failure = errorResponseSchema.safeParse(body);
  if (failure.success && failure.data.error === "not_found") {
    throw new CliError(init.notFound ?? `Not found: ${url}`);
  }
  if (failure.success && failure.data.error === "invalid_request") {
    const issues = (failure.data.issues ?? []).map(
      (issue) => `${issue.path || "body"}: ${issue.message}`,
    );
    throw new CliError(`The server rejected the request: ${issues.join("; ")}`);
  }
  throw new CliError(
    `${init.method} ${url} failed with HTTP ${response.status}.`,
  );
}

export function listTodos(api: Api, filter: string | undefined) {
  const { q } = input(listTodosQuerySchema, { q: filter }, "filter");
  const search = q ? `?${new URLSearchParams({ q })}` : "";
  return call(
    api,
    `${TODOS_PATH}${search}`,
    { method: "GET" },
    listTodosResponseSchema,
  );
}

export function addTodo(api: Api, title: string) {
  return call(
    api,
    TODOS_PATH,
    {
      method: "POST",
      body: input(createTodoRequestSchema, { title }, "title"),
    },
    todoResponseSchema,
  );
}

export function completeTodo(api: Api, id: string) {
  return call(
    api,
    todoPath(id),
    {
      method: "PATCH",
      body: input(updateTodoRequestSchema, { done: true }, "update"),
      notFound: `No item with id ${id} on your list. Run ai-tutor list to see the ids.`,
    },
    todoResponseSchema,
  );
}
