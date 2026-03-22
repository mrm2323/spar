import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  reactCompiler: true,
  // pdf-parse + pdf.js + native canvas must run from node_modules, not be bundled
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
