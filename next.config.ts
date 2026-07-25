import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Собирает .next/standalone с минимальным server.js и только нужными модулями:
  // рантайм-образ обходится без node_modules целиком. public и .next/static
  // standalone не копирует — это делает Dockerfile.
  output: "standalone",
};

export default nextConfig;
