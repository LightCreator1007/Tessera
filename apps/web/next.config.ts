// Next config. /api/coord is a route handler (app/api/coord) that proxies to the coordinator. Files named *.dev.tsx are routes only under next dev, so playgrounds never reach a production build.
import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";

const config: NextConfig = {
  reactStrictMode: true,
  pageExtensions: dev ? ["dev.tsx", "tsx", "ts"] : ["tsx", "ts"],
};
export default config;
