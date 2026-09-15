import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { auth } from "@/lib/auth";
import { MCP_SCOPE, mcpResource } from "@/lib/auth-config";
import { db } from "@/lib/db";
import { createTodoMcpServer } from "@/lib/todo-mcp";

const resource = mcpResource();

/**
 * A fresh MCP server per request for the user in `authInfo`, which the SDK
 * takes only from the `fetch` call below and never from the request. 2025-era
 * clients get the SDK's stateless fallback, which answers without a session.
 */
const handler = createMcpHandler(({ authInfo }) => {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== "string") {
    throw new Error("An MCP request arrived without a verified user");
  }
  return createTodoMcpServer(db, userId);
});

/**
 * The MCP endpoint over Streamable HTTP. requireMcpAuth answers a request
 * without a valid token with 401 and the RFC 9728 challenge that starts an MCP
 * client's OAuth flow, and lets through only a JWT this app signed for this
 * resource with the `todos` scope, whose subject is the user id. POST alone,
 * because stateless serving has no session to GET or DELETE.
 */
export const POST = requireMcpAuth(
  auth,
  (request, claims) => {
    if (!claims.sub) {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32001, message: "The access token names no user" },
          id: null,
        },
        { status: 403 },
      );
    }
    return handler.fetch(request, {
      authInfo: {
        token: request.headers.get("authorization")?.split(" ")[1] ?? "",
        clientId: typeof claims.azp === "string" ? claims.azp : "",
        scopes: typeof claims.scope === "string" ? claims.scope.split(" ") : [],
        expiresAt: claims.exp,
        resource: new URL(resource),
        extra: { userId: claims.sub },
      },
    });
  },
  { resource, requiredScopes: [MCP_SCOPE] },
);
