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
    ]
  },
  webpack: (config, { isServer }) => {
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
