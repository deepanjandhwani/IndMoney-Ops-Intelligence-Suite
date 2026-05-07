import { RetrievalCandidate } from "./types";

const K1 = 1.5;
const B = 0.75;

export function bm25Rerank(
  query: string,
  candidates: RetrievalCandidate[],
  topK = 5
): RetrievalCandidate[] {
  if (candidates.length === 0) {
    return [];
  }

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) {
    return candidates.sort(byCosine).slice(0, topK);
  }

  const documents = candidates.map((candidate) => tokenize(candidate.text));
  const averageDocumentLength =
    documents.reduce((sum, document) => sum + document.length, 0) / documents.length;
  const documentFrequencies = new Map<string, number>();

  for (const document of documents) {
    for (const term of new Set(document)) {
      documentFrequencies.set(term, (documentFrequencies.get(term) ?? 0) + 1);
    }
  }

  const scores = documents.map((document) =>
    scoreDocument(queryTerms, document, documentFrequencies, documents.length, averageDocumentLength)
  );
  const maxScore = Math.max(...scores);

  if (maxScore === 0) {
    return candidates.sort(byCosine).slice(0, topK);
  }

  return candidates
    .map((candidate, index) => {
      const bm25Score = scores[index] / maxScore;
      const relevanceScore = 0.7 * candidate.cosineScore + 0.3 * bm25Score;
      return {
        ...candidate,
        bm25Score,
        relevanceScore
      };
    })
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, topK);
}

function scoreDocument(
  queryTerms: string[],
  document: string[],
  documentFrequencies: Map<string, number>,
  documentCount: number,
  averageDocumentLength: number
) {
  const termCounts = new Map<string, number>();
  for (const term of document) {
    termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
  }

  return queryTerms.reduce((score, term) => {
    const termFrequency = termCounts.get(term) ?? 0;
    if (termFrequency === 0) {
      return score;
    }

    const documentFrequency = documentFrequencies.get(term) ?? 0;
    const inverseDocumentFrequency = Math.log(
      1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5)
    );
    const denominator =
      termFrequency +
      K1 * (1 - B + B * (document.length / Math.max(averageDocumentLength, 1)));

    return score + inverseDocumentFrequency * ((termFrequency * (K1 + 1)) / denominator);
  }, 0);
}

// English-only tokenizer: strips all non-ASCII characters, so Hindi/Devanagari
// tokens are dropped. This is acceptable while all indexed chunks are English.
// If Hindi KB chunks are added, switch to a Unicode-aware tokenizer that
// preserves Devanagari (\u0900-\u097F) script characters.
function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%.\s-]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
}

function byCosine(left: RetrievalCandidate, right: RetrievalCandidate) {
  return right.cosineScore - left.cosineScore;
}
