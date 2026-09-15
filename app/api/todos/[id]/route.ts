import { type TodoResponse, updateTodoRequestSchema } from "ai-tutor-todo-api";
import { apiError, getApiSession, parseJsonBody } from "@/lib/api-session";
import { db } from "@/lib/db";
import { setTodoDoneFor } from "@/lib/todo-tools";

/** Marks one item done (or reopens it); Bearer token only. */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/todos/[id]">,
) {
  const session = await getApiSession(request, { allowCookie: false });
  if (!session) {
    return apiError(401, "unauthorized");
  }

  const parsed = await parseJsonBody(request, updateTodoRequestSchema);
  if ("response" in parsed) {
    return parsed.response;
  }

  const { id } = await ctx.params;
  const todo = await setTodoDoneFor(db, session.user.id, id, parsed.data.done);
  if (!todo) {
    return apiError(404, "not_found");
  }
  return Response.json({ todo } satisfies TodoResponse);
}
