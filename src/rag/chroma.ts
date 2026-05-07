import {
  ChromaClient,
  ChromaConnectionError,
  ChromaNotFoundError,
  Collection,
  Metadata,
  Where
} from "chromadb";

import { ChunkMetadata, EmbeddedChunk, RetrievalCandidate, SMART_SYNC_COLLECTION } from "./types";

export type VectorStore = {
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  query(input: {
    queryEmbedding: number[];
    where?: Where;
    nResults: number;
  }): Promise<RetrievalCandidate[]>;
  getSourceContentHash(sourceId: string): Promise<string | null>;
  deleteBySourceId(sourceId: string): Promise<number>;
  deleteSourcesExcept(activeSourceIds: Set<string>): Promise<number>;
};

export function isChromaUnavailable(error: unknown) {
  if (error instanceof ChromaConnectionError || error instanceof ChromaNotFoundError) {
    return true;
  }
  if (!(error instanceof Error)) return false;
  // Only match generic network errors that originate from Chroma (not Gemini/Groq).
  // GoogleGenerativeAI and groq-sdk errors also produce "fetch failed" but are
  // unrelated to ChromaDB availability.
  if (/generativelanguage|googleapis|groq/i.test(error.message)) return false;
  return /ECONNREFUSED|fetch failed/i.test(error.message);
}

export async function createChromaVectorStore(
  env: NodeJS.ProcessEnv = process.env
): Promise<VectorStore> {
  const url = new URL(env.CHROMA_URL ?? "http://localhost:8001");
  const client = new ChromaClient({
    host: url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    ssl: url.protocol === "https:"
  });
  const collection = await client.getOrCreateCollection({
    name: env.CHROMA_COLLECTION ?? SMART_SYNC_COLLECTION,
    embeddingFunction: null,
    configuration: { hnsw: { space: "cosine" } },
    metadata: {
      embedding_model: env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",
      embedding_dimensions: 768
    }
  });

  return createCollectionVectorStore(collection);
}

export function createCollectionVectorStore(collection: Collection): VectorStore {
  return {
    async upsert(chunks) {
      if (chunks.length === 0) {
        return;
      }

      await collection.upsert({
        ids: chunks.map((chunk) => chunk.id),
        embeddings: chunks.map((chunk) => chunk.embedding),
        documents: chunks.map((chunk) => chunk.text),
        metadatas: chunks.map((chunk) => toChromaMetadata(chunk.metadata))
      });
    },

    async query({ queryEmbedding, where, nResults }) {
      const result = await collection.query<Metadata>({
        queryEmbeddings: [queryEmbedding],
        nResults,
        where,
        include: ["documents", "metadatas", "distances"]
      });

      return result.rows()[0]?.flatMap((row) => {
        if (!row.document || !row.metadata) {
          return [];
        }
        const distance = row.distance ?? 1;
        return [
          {
            id: row.id,
            text: row.document,
            metadata: fromChromaMetadata(row.metadata),
            distance,
            cosineScore: Math.max(0, 1 - distance),
            bm25Score: 0,
            relevanceScore: Math.max(0, 1 - distance)
          }
        ];
      }) ?? [];
    },

    async getSourceContentHash(sourceId) {
      const result = await collection.get<Metadata>({
        where: { source_id: sourceId },
        limit: 1,
        include: ["metadatas"]
      });

      const hash = result.metadatas[0]?.content_hash;
      return typeof hash === "string" ? hash : null;
    },

    async deleteBySourceId(sourceId) {
      const result = await collection.delete({ where: { source_id: sourceId } });
      return result.deleted ?? 0;
    },

    async deleteSourcesExcept(activeSourceIds) {
      const PAGE_SIZE = 500;
      let offset = 0;
      const allStaleIds: string[] = [];

      while (true) {
        const page = await collection.get<Metadata>({
          include: ["metadatas"],
          limit: PAGE_SIZE,
          offset
        });
        if (page.ids.length === 0) break;

        for (let i = 0; i < page.ids.length; i++) {
          const sourceId = page.metadatas[i]?.source_id;
          if (typeof sourceId === "string" && !activeSourceIds.has(sourceId)) {
            allStaleIds.push(page.ids[i]);
          }
        }

        if (page.ids.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      if (allStaleIds.length === 0) {
        return 0;
      }

      let totalDeleted = 0;
      for (let i = 0; i < allStaleIds.length; i += PAGE_SIZE) {
        const batch = allStaleIds.slice(i, i + PAGE_SIZE);
        const result = await collection.delete({ ids: batch });
        totalDeleted += result.deleted ?? batch.length;
      }
      return totalDeleted;
    }
  };
}

function toChromaMetadata(metadata: ChunkMetadata): Metadata {
  const output: Metadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      output[key] = value;
    }
  }
  return output;
}

function fromChromaMetadata(metadata: Metadata): ChunkMetadata {
  return {
    source_id: String(metadata.source_id),
    source_type: metadata.source_type === "static_fee_explainer" ? "static_fee_explainer" : "official_url",
    content_type: contentTypeFrom(metadata.content_type),
    title: String(metadata.title),
    url: typeof metadata.url === "string" ? metadata.url : null,
    last_checked: String(metadata.last_checked),
    content_hash: String(metadata.content_hash),
    chunk_index: Number(metadata.chunk_index),
    scheme_name: stringOrUndefined(metadata.scheme_name),
    section_type: stringOrUndefined(metadata.section_type),
    fee_type: stringOrUndefined(metadata.fee_type),
    scenario: stringOrUndefined(metadata.scenario),
    topic: stringOrUndefined(metadata.topic)
  };
}

function contentTypeFrom(value: Metadata[string]): ChunkMetadata["content_type"] {
  if (
    value === "scheme_fact" ||
    value === "fee_explanation" ||
    value === "regulatory_education" ||
    value === "help_page"
  ) {
    return value;
  }
  return "scheme_fact";
}

function stringOrUndefined(value: Metadata[string]) {
  return typeof value === "string" ? value : undefined;
}
