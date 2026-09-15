import { z } from "zod";

/**
 * The wire contract of the /api/todos REST API, for the route handlers and for
 * any client (such as a CLI in this repo). Imports nothing but zod, so a client
 * can load it without pulling in the database or the auth instance.
 *
 * Every call sends `Authorization: Bearer <token>`, where the token is the
 * signed session token Better Auth returns in the `set-auth-token` header on
 * sign-in. `GET` also accepts the app's session cookie; writes do not.
 */
export const TODOS_PATH = "/api/todos";

export const todoPath = (id: string) =>
  `${TODOS_PATH}/${encodeURIComponent(id)}`;

export const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});
export type Todo = z.infer<typeof todoSchema>;

/** `GET /api/todos?q=milk` — `q` keeps items whose title contains it, ignoring case. */
export const listTodosQuerySchema = z.object({
  q: z.string().optional(),
});
export type ListTodosQuery = z.infer<typeof listTodosQuerySchema>;

/** 200 from `GET /api/todos`, in insertion order. */
export const listTodosResponseSchema = z.object({
  todos: z.array(todoSchema),
});
export type ListTodosResponse = z.infer<typeof listTodosResponseSchema>;

/** Body of `POST /api/todos`; the title is trimmed before it is checked. */
export const createTodoRequestSchema = z.object({
  title: z.string().trim().min(1),
});
export type CreateTodoRequest = z.input<typeof createTodoRequestSchema>;

/** Body of `PATCH /api/todos/:id`; `true` marks the item done, `false` reopens it. */
export const updateTodoRequestSchema = z.object({
  done: z.boolean(),
});
export type UpdateTodoRequest = z.infer<typeof updateTodoRequestSchema>;

/** 201 from `POST /api/todos` and 200 from `PATCH /api/todos/:id`. */
export const todoResponseSchema = z.object({
  todo: todoSchema,
});
export type TodoResponse = z.infer<typeof todoResponseSchema>;

/**
 * Every non-2xx body: 400 `invalid_request` (with `issues`), 401
 * `unauthorized`, 404 `not_found`.
 */
export const errorResponseSchema = z.object({
  error: z.enum(["invalid_request", "unauthorized", "not_found"]),
  issues: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
