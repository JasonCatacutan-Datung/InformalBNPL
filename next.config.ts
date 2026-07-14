import type { NextConfig } from "next";

// Files the tesseract.js OCR worker needs at runtime on Vercel. Includes the
// full data + core + library dirs (so require.resolve of their package.json
// works) and the worker-script's transitive deps (it require()s these inside a
// worker_thread, which file-tracing can't detect).
const OCR_TRACE_INCLUDES = [
  "./node_modules/@tesseract.js-data/eng/**",
  "./node_modules/@tesseract.js-data/fil/**",
  "./node_modules/tesseract.js-core/**",
  "./node_modules/tesseract.js/**",
  "./node_modules/bmp-js/**",
  "./node_modules/is-url/**",
  "./node_modules/wasm-feature-detect/**",
  "./node_modules/regenerator-runtime/**",
  "./node_modules/node-fetch/**",
];

const nextConfig: NextConfig = {
  // tesseract.js uses worker threads + WASM and sharp is a native (libvips)
  // addon; keep both external so Next doesn't try to bundle them into the server
  // build (OCR + image preprocessing run in operator-side actions).
  serverExternalPackages: ["tesseract.js", "sharp"],
  // OCR loads the worker, core wasm and language data from node_modules at
  // runtime via dynamic paths, which file-tracing can't detect — force-include
  // them in the operator review route bundles so OCR works on Vercel.
  outputFileTracingIncludes: {
    // OCR runs in the server actions imported by these review pages. The worker
    // runs in a worker_thread that require()s the core wasm, the language data,
    // and several small deps at runtime — paths file-tracing can't follow
    // because tesseract.js is an external package. Ship them all (full package
    // dirs incl. package.json, which require.resolve needs).
    "/operator/reviews/buyers": OCR_TRACE_INCLUDES,
    "/operator/reviews/sellers": OCR_TRACE_INCLUDES,
  },
  experimental: {
    // Seller verification uploads a live item photo through a server action;
    // bump the request body limit above the 1 MB default for camera images.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
