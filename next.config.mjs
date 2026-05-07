/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      "chromadb",
      "@chroma-core/default-embed",
      "@chroma-core/ai-embeddings-common",
      "@huggingface/transformers",
      "onnxruntime-node",
      "@google/generative-ai",
      "groq-sdk",
      "better-sqlite3",
      "playwright"
    ]
  }
};

export default nextConfig;
