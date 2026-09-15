import { apiError, getApiSession, parseJsonBody } from "@/lib/api-session";
import { db } from "@/lib/db";
import {
  createTodoRequestSchema,
  type ListTodosResponse,
  type TodoResponse,
} from "@/lib/todo-api";
import { addTodoFor, listTodosFor } from "@/lib/todo-tools";

/**
 * The REST collection for CLIs and services (Bearer token), and also the
 * sidebar's read path (session cookie). Same queries the tutor's tools run, on
 * the verified session's user id; shapes are in lib/todo-api.ts.
 */
export async function GET(request: Request) {
  const session = await getApiSession(request, { allowCookie: true });
  if (!session) {
    return apiError(401, "unauthorized");
  }

  const q = new URL(request.url).searchParams.get("q") ?? undefined;
  return Response.json({
    todos: await listTodosFor(db, session.user.id, q),
  } satisfies ListTodosResponse);
}

export async function POST(request: Request) {
  const session = await getApiSession(request, { allowCookie: false });
  if (!session) {
    return apiError(401, "unauthorized");
  }

  const parsed = await parseJsonBody(request, createTodoRequestSchema);
  if ("response" in parsed) {
    return parsed.response;
  }

  const todo = await addTodoFor(db, session.user.id, parsed.data.title);
  return Response.json({ todo } satisfies TodoResponse, { status: 201 });
}
