const ORIGIN = "http://next-path.invalid";

/**
 * Where a sign-in form sends the user afterwards, from its `?next=` parameter.
 * Only a path on this site survives — resolving it with the URL parser settles
 * `//evil.example`, `/\evil.example` and the like the way a browser would — so
 * the forms cannot be turned into an open redirect.
 */
export function safeNextPath(next: string | string[] | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/")) {
    return "/";
  }
  try {
    const url = new URL(next, ORIGIN);
    return url.origin === ORIGIN
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
}

/** `path`, carrying `next` along unless it is the default destination. */
export const withNext = (path: string, next: string) =>
  next === "/" ? path : `${path}?${new URLSearchParams({ next })}`;

/**
 * The authorization request Better Auth signed onto a /login or /consent URL
 * for an MCP client, as a `?query` to hand on unchanged, or "" when there is
 * none. Better Auth verifies its `sig` wherever a form sends it back.
 */
export function oauthQuery(
  params: Record<string, string | string[] | undefined>,
): string {
  if (typeof params.sig !== "string") {
    return "";
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of [value ?? []].flat()) {
      query.append(key, item);
    }
  }
  return `?${query}`;
}
