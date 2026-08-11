// Custom promptfoo prompt function — this is the actual RAG step.
//
// v1/v2 of this eval pasted both source documents into every prompt in
// full ("long-context stuffing"). This version instead: embeds the
// question, retrieves the top-K most relevant chunks from the precomputed
// index (docs/embedding-index.json, built by build-index.js), and builds
// the prompt from ONLY those chunks. With 6 documents (~260 chunks) this is
// the point where full-context stuffing stops being practical, and where
// retrieval quality — not just answer quality — becomes something worth
// measuring on its own (see scripts/assert-retrieval.js).
//
// promptfoo calls this once per test case, before calling the provider.
// Referenced from promptfooconfig.yaml as: prompts: [file://scripts/promptfoo-prompt.js]

const fs = require('fs');
const path = require('path');
const { retrieve } = require('./retrieval.js');
const retrievalCache = require('./retrieval-cache.js');

const TOP_K = 5;
const INDEX_PATH = path.join(__dirname, '..', 'docs', 'embedding-index.json');

let indexPromise = null;
function loadIndex() {
  if (!indexPromise) {
    indexPromise = Promise.resolve().then(() => {
      const raw = fs.readFileSync(INDEX_PATH, 'utf8');
      return JSON.parse(raw).chunks;
    });
  }
  return indexPromise;
}

// Human-readable labels for the source docs, used in the prompt so the
// model can cite "Plan A" etc. instead of the internal id "plan-a".
const PLAN_LABELS = {
  'plan-a': 'Plan A (CMS reference PPO)',
  'plan-b': 'Plan B (Auburn University HDHP)',
  'plan-c': 'Plan C (Illinois State Employees HMO)',
  'plan-d': 'Plan D (Northwestern University PPO)',
  'plan-e': 'Plan E (Cochise Combined Trust EPO)',
  'plan-f': 'Plan F (CalPERS Access+ HMO)',
};

module.exports = async function promptfooPrompt(context) {
  const { vars } = context;
  const question = vars.question;

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'VOYAGE_API_KEY is not set. This eval retrieves context via Voyage AI embeddings — ' +
        'get a free key at https://dash.voyageai.com/ and run: export VOYAGE_API_KEY="pa-..."'
    );
  }

  const index = await loadIndex();
  const retrieved = await retrieve(question, index, apiKey, TOP_K);

  // Side channel for the retrieval-quality assertion — see retrieval-cache.js.
  if (vars.id !== undefined) {
    retrievalCache.set(String(vars.id), retrieved.map((c) => c.source));
  }

  const context_block = retrieved
    .map((chunk, i) => {
      const label = PLAN_LABELS[chunk.source] || chunk.source;
      return `[Excerpt ${i + 1} — ${label}, section: ${chunk.section}]\n${chunk.text}`;
    })
    .join('\n\n');

  return `You are a benefits assistant answering questions strictly from the excerpts below, which were retrieved from a library of Summary of Benefits and Coverage (SBC) documents for six different health plans. Do not use outside knowledge about health insurance, and do not assume facts about a plan that aren't in the excerpts you were given — answer only from what is written below. If a fact isn't present in these excerpts, say "Not stated in the document" instead of guessing.

====================
RETRIEVED EXCERPTS
====================

${context_block}

====================
QUESTION
${question}

Answer with exactly one line first: just the specific fact requested (a dollar amount, a percentage, a number, "Yes"/"No"/"Not Covered", or a plan name — whichever the question calls for), with no extra words on that line. On the next line, give a one-sentence explanation citing which plan the fact came from.`;
};
