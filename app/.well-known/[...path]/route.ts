import { auth } from "@/lib/auth";

/**
 * OAuth discovery for /api/mcp lives at the site root, outside the /api/auth
 * catch-all: the RFC 9728 resource metadata at
 * /.well-known/oauth-protected-resource/api/mcp, and the RFC 8414 metadata of
 * the /api/auth issuer at /.well-known/oauth-authorization-server/api/auth.
 * Better Auth's mcp() plugin answers those before it routes a request by its
 * base path, so every well-known path is handed over, and the rest are 404.
 */
export const GET = (request: Request) => auth.handler(request);
