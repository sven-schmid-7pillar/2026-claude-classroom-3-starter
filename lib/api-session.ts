import "server-only";
import type { z } from "zod";
import { auth } from "@/lib/auth";
import type { ErrorResponse } from "@/lib/todo-api";

/**
 * Resolves the session behind an /api/todos request. The bearer plugin turns a
 * validly signed `Authorization: Bearer` token into the session cookie, but it
 * silently falls back to any real cookie when the token is bad — so writes pass
 * Better Auth only the Authorization header, and a browser's cookie cannot
 * reach them. Reads pass every header, which keeps the sidebar's cookie `GET`.
 */
export function getApiSession(
  request: Request,
  { allowCookie }: { allowCookie: boolean },
) {
  const authorization = request.headers.get("authorization");
  if (allowCookie) {
    return auth.api.getSession({ headers: request.headers });
  }
  if (!authorization) {
    return Promise.resolve(null);
  }
  return auth.api.getSession({ headers: new Headers({ authorization }) });
}

export const apiError = (
  status: 400 | 401 | 404,
  error: ErrorResponse["error"],
  issues?: ErrorResponse["issues"],
) => Response.json({ error, issues } satisfies ErrorResponse, { status });

/** Parses a JSON body against a contract schema, or builds the 400 for it. */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ data: T } | { response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      response: apiError(400, "invalid_request", [
        { path: "", message: "Body must be JSON" },
      ]),
    };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      response: apiError(
        400,
        "invalid_request",
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      ),
    };
  }
  return { data: result.data };
}
