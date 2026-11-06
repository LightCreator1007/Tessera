// ?next= is user-controlled, so only same-site paths are followed; anything else would let a link bounce someone to another origin.
export function safeNext(v: string | null): string | null {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : null;
}
