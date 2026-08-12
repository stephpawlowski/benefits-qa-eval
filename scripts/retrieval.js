// Shared retrieval logic: embed a query with Voyage AI, then do a plain
// in-memory cosine-similarity nearest-neighbor search over the precomputed
// chunk index (docs/embedding-index.json, built by build-index.js).
//
// This is deliberately NOT a real vector database (Pinecone, Vectorize,
// etc.): at ~260 chunks, a linear scan over an array of float arrays is
// well under a millisecond and needs no infrastructure. A real vector DB
// only starts to matter once the corpus is large enough (tens of thousands+
// of chunks) that a linear scan becomes the bottleneck. Keeping this simple
// also means the exact same function runs unmodified in Node (this file, for
// promptfoo) and in the Cloudflare Worker (a copy of just this logic, since
// Workers can't `require()` a local file, see eval-proxy-worker.js).
//
// Used by:
//   - promptfoo-prompt.js (the eval's custom prompt function)
//   - the Worker's /benefits-rag route, for the live dashboard demo

// voyage-3-lite (512 dimensions) rather than voyage-3 (1024): plenty
// accurate for a ~260-chunk corpus, and it keeps embedding-index.json (which
// gets fetched by the Cloudflare Worker on every cold start) meaningfully
// smaller. This constant is the single source of truth for which model was
// used to build the index; build-index.js imports it from here rather than
// declaring its own copy, so the indexing side and the query side can never
// drift onto different models (which would silently break retrieval, since
// vectors from two different embedding spaces aren't comparable).
const EMBED_MODEL = 'voyage-3-lite';

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embedQuery(text, apiKey) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [text],
      model: EMBED_MODEL,
      // "query" vs "document" input_type is a Voyage-specific optimization:
      // the model applies a slightly different transform depending on which
      // side of the search you're embedding. Must match what build-index.js
      // used for the document side (input_type: "document").
      input_type: 'query',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  return json.data[0].embedding;
}

// Returns the top-k chunks (highest cosine similarity first), each annotated
// with its similarity score.
function retrieveTopK(queryEmbedding, indexChunks, k = 5) {
  const scored = indexChunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// Convenience wrapper: embed the query and retrieve in one call.
async function retrieve(queryText, indexChunks, apiKey, k = 5) {
  const queryEmbedding = await embedQuery(queryText, apiKey);
  return retrieveTopK(queryEmbedding, indexChunks, k);
}

module.exports = { cosineSimilarity, embedQuery, retrieveTopK, retrieve, EMBED_MODEL };
