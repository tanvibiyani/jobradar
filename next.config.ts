import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse pulls in pdfjs-dist, which ships its own worker bundles and
  // dynamic imports that don't survive the server-component bundler. Loading
  // it through Node's require keeps everything intact.
  serverExternalPackages: ["pdf-parse"],
  experimental: {
    // Default is 1MB; PDFs routinely exceed that. 10MB is generous enough for
    // resumes without enabling abuse.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
