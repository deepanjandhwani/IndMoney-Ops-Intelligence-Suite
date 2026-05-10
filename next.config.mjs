/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      "chromadb",
      "@google/generative-ai",
      "groq-sdk",
      "better-sqlite3",
      "playwright"
    ],
    outputFileTracingExcludes: {
      "*": [
        "node_modules/onnxruntime-node/**",
        "node_modules/@chroma-core/default-embed/**",
        "node_modules/@chroma-core/ai-embeddings-common/**",
        "node_modules/@huggingface/transformers/**",
        "node_modules/@img/**",
        "node_modules/sharp/**",
        "node_modules/playwright/**",
        "node_modules/playwright-core/**"
      ]
    }
  },
  webpack: (config, { isServer, dev }) => {
    if (dev && process.env.WATCHPACK_POLLING === "true") {
      config.watchOptions = {
        ...config.watchOptions,
        poll: 1000,
        aggregateTimeout: 300
      };
    }
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push(
        "onnxruntime-node",
        "@chroma-core/default-embed",
        "@chroma-core/ai-embeddings-common",
        "@huggingface/transformers",
        "sharp"
      );
    }
    return config;
  }
};

export default nextConfig;
