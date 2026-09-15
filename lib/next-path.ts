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
