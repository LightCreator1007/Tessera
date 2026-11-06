// Next config. /api/coord proxies to the coordinator so the browser stays same-origin. Files named *.dev.tsx are routes only under next dev, so playgrounds never reach a production build.
import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";

const coordinator = process.env.NEXT_PUBLIC_COORDINATOR_URL?.replace(/\/$/, "");

const config: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return coordinator ? [{ source: "/api/coord/:path*", destination: `${coordinator}/:path*` }] : [];
  },
  pageExtensions: dev ? ["dev.tsx", "tsx", "ts"] : ["tsx", "ts"],
};
export default config;
