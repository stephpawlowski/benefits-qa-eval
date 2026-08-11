#!/usr/bin/env node
// Builds the RAG embedding index: chunks every plan-*.md document (via
// chunk-docs.js) and embeds each chunk with the Voyage AI API, then writes
// the result to docs/embedding-index.json.
//
// That output file is committed to the repo and used two ways:
//   1. By promptfoo at eval time (scripts/retrieval.js loads it to answer
//      each test question via retrieval instead of full-document stuffing).
//   2. By the live "ask the benefits library" demo on the dashboard, via
//      the Cloudflare Worker, which loads the same file as a static asset
//      so retrieval at query time uses the exact same vectors.
//
// Run this whenever a plan-*.md file changes, or when a new plan is added.
//
// Usage:
//   export VOYAGE_API_KEY="pa-..."
//   node scripts/build-index.js

const fs = require('fs');
const path = require('path');
const { chunkDocument } = require('./chunk-docs.js');
const { EMBED_MODEL } = require('./retrieval.js');

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const BATCH_SIZE = 32; // Voyage accepts batched input; keep batches modest.
const OUT_PATH = path.join(__dirname, '..', 'docs', 'embedding-index.json');
// Rounding to 6 decimal places barely affects cosine-similarity accuracy but
// meaningfully shrinks the JSON file (full float64 precision from the API
// serializes to ~17 significant digits per number, which adds up fast across
// ~260 chunks x 512 dimensions). This file gets fetched by the Cloudflare
// Worker on every cold start, so smaller matters.
const ROUND_DECIMALS = 6;
const round = (n) => Math.round(n * 10 ** ROUND_DECIMALS) / 10 ** ROUND_DECIMALS;

const PLAN_FILES = ['plan-a.md', 'plan-b.md', 'plan-c.md', 'plan-d.md', 'plan-e.md', 'plan-f.md'];

async function embedBatch(texts) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: texts,
      model: EMBED_MODEL,
      input_type: 'document',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  // Voyage returns data in the same order as input, each with an `embedding`.
  return json.data.map((d) => d.embedding);
}

async function main() {
  if (!VOYAGE_API_KEY) {
    console.error('Missing VOYAGE_API_KEY environment variable.');
    console.error('Get a free key at https://dash.voyageai.com/ and run:');
    console.error('  export VOYAGE_API_KEY="pa-..."');
    process.exit(1);
  }

  const repoRoot = path.join(__dirname, '..');
  let allChunks = [];

  for (const file of PLAN_FILES) {
    const filePath = path.join(repoRoot, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`Skipping missing file: ${file}`);
      continue;
    }
    const sourceId = path.basename(file, '.md'); // e.g. "plan-a"
    const markdown = fs.readFileSync(filePath, 'utf8');
    const chunks = chunkDocument(markdown, sourceId);
    console.log(`${file}: ${chunks.length} chunks`);
    allChunks = allChunks.concat(chunks);
  }

  console.log(`\nEmbedding ${allChunks.length} chunks with ${EMBED_MODEL}...`);

  const embedded = [];
  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    const vectors = await embedBatch(batch.map((c) => c.text));
    batch.forEach((chunk, j) => {
      embedded.push({ ...chunk, embedding: vectors[j].map(round) });
    });
    console.log(`  embedded ${Math.min(i + BATCH_SIZE, allChunks.length)}/${allChunks.length}`);
  }

  const output = {
    model: EMBED_MODEL,
    dimensions: embedded[0]?.embedding.length ?? null,
    builtAt: new Date().toISOString(),
    chunks: embedded,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output));
  console.log(`\nWrote ${embedded.length} embedded chunks to ${path.relative(repoRoot, OUT_PATH)}`);
  console.log(`File size: ${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
