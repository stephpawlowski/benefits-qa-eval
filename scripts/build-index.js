#!/usr/bin/env node
// Builds the RAG embedding index: chunks every plan-*.md document (via
// chunk-docs.js) and embeds each chunk with the Voyage AI API, then writes
// the result to docs/embedding-index.json.

const fs = require('fs');
const path = require('path');
const { chunkDocument } = require('./chunk-docs.js');
const { EMBED_MODEL } = require('./retrieval.js');

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const BATCH_SIZE = 32;
const OUT_PATH = path.join(__dirname, '..', 'docs', 'embedding-index.json');
const ROUND_DECIMALS = 6;
const round = (n) => Math.round(n * 10 ** ROUND_DECIMALS) / 10 ** ROUND_DECIMALS;

// Voyage's free tier defaults to 3 requests/min, 10K tokens/min until a
// payment method is on file -- the free 200M-token allowance still applies
// either way. Rather than require a card, this script paces itself under
// that limit and retries with backoff on 429s.
const MIN_MS_BETWEEN_REQUESTS = 21000; // ~2.85 requests/minute, under the 3 RPM cap
const MAX_RETRIES = 6;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PLAN_FILES = ['plan-a.md', 'plan-b.md', 'plan-c.md', 'plan-d.md', 'plan-e.md', 'plan-f.md'];

async function embedBatch(texts, attempt = 1) {
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

  if (res.status === 429) {
    if (attempt > MAX_RETRIES) {
      throw new Error(`Voyage API error 429: rate limited after ${MAX_RETRIES} retries.`);
    }
    const waitMs = 15000 * attempt;
    console.log(`  Rate limited (429). Waiting ${(waitMs / 1000).toFixed(0)}s before retry ${attempt}/${MAX_RETRIES}...`);
    await sleep(waitMs);
    return embedBatch(texts, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${body}`);
  }

  const json = await res.json();
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
    const sourceId = path.basename(file, '.md');
    const markdown = fs.readFileSync(filePath, 'utf8');
    const chunks = chunkDocument(markdown, sourceId);
    console.log(`${file}: ${chunks.length} chunks`);
    allChunks = allChunks.concat(chunks);
  }

  console.log(`\nEmbedding ${allChunks.length} chunks with ${EMBED_MODEL}...`);
  console.log(`(Pacing requests under Voyage's free-tier rate limit -- this will take a few minutes.)`);

  const embedded = [];
  let lastRequestAt = 0;
  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const sinceLast = Date.now() - lastRequestAt;
    if (lastRequestAt && sinceLast < MIN_MS_BETWEEN_REQUESTS) {
      await sleep(MIN_MS_BETWEEN_REQUESTS - sinceLast);
    }
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    lastRequestAt = Date.now();
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
