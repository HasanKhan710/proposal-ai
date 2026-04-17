import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent these packages from being bundled by webpack/Turbopack.
  // They must be required natively by Node.js at runtime — bundling them
  // can corrupt binary file handling (especially xlsx and jszip).
  serverExternalPackages: ['pdf-parse', 'xlsx', 'jszip'],

  experimental: {
    // Raise the upload body limit for the knowledge-base route.
    // Default is 10 MB; PPTX/Excel files with embedded media can exceed this,
    // causing Next.js to silently truncate the body — which busboy then reports
    // as "Unexpected end of multipart data".
    proxyClientMaxBodySize: '50mb',
  },
};

export default nextConfig;
