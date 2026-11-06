"use client";
// Anything that needs a wallet calls openConnect(); it goes to the sign-in page and comes back here once the wallet is connected and verified.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const subs = new Set<() => void>();
export const openConnect = () => subs.forEach((f) => f());

/** Where sign-in should return to: this page, unless we're already inside the sign-in flow. */
export function signInHref(base: "/signin" | "/join" = "/signin") {
  if (typeof window === "undefined") return base;
  const here = window.location.pathname + window.location.search;
  return /^\/(signin|join)(\/|$|\?)/.test(here) ? base : `${base}?next=${encodeURIComponent(here)}`;
}

/** Mounted once in the shell, so openConnect() can navigate from any click handler. */
export function ConnectRoute() {
  const router = useRouter();
  useEffect(() => {
    const go = () => router.push(signInHref());
    subs.add(go);
    return () => { subs.delete(go); };
  }, [router]);
  return null;
}
