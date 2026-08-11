# Benefits Q&A Checker

Can an LLM correctly answer coverage questions when given real health insurance documents as its only
source of truth — and just as important, does it know when to say "I don't know" instead of guessing?
This is a small eval built with [promptfoo](https://www.promptfoo.dev/), testing an LLM against a
library of real, publicly available Summary of Benefits and Coverage (SBC) documents.

This is version 3 of the project, and the first version that's actually retrieval-augmented generation
(RAG) rather than long-context stuffing. Versions 1 and 2 pasted both source documents into every
prompt in full — that worked fine at 2 documents, but it isn't how RAG systems actually work, and it
stops being practical once the document set grows. Version 3 expands the library to 6 real plan
documents and switches to real retrieval: each document is chunked into ~40 pieces, embedded with
[Voyage AI](https://www.voyageai.com/), and every question is answered by embedding the question,
finding the 5 most similar chunks via cosine similarity, and generating an answer from only those
chunks — never the full library. Every test case is now graded twice: did retrieval find the right
document, and was the final answer correct?

## The documents

SBCs are a standardized, federally mandated format (every US health plan has to produce one), so
these are easy to source publicly and easy to verify facts against. This version uses 6, covering 4
different plan types from 6 different real employers:

- **Plan A** — the official CMS reference example SBC (a PPO family plan), used industry-wide to
  illustrate the standard SBC template. Public domain, from cms.gov.
- **Plan B** — Auburn University's actual 2025 HDHP plan document (administered by Blue Cross Blue
  Shield of Alabama), posted publicly on Auburn's HR site.
- **Plan C** — the State of Illinois's HMO option for state employees (administered by Aetna),
  published by the state's Central Management Services agency.
- **Plan D** — Northwestern University's PPO plan (administered by UnitedHealthcare), posted publicly
  on the university's HR site.
- **Plan E** — Cochise County, Arizona's EPO plan for county employees (Cochise Combined Trust,
  administered on the BlueCross BlueShield of Arizona network), published on the county's public site.
- **Plan F** — CalPERS's Access+ HMO (Blue Shield of California), the HMO option offered to California
  state and public agency employees.

Deliberately picking 4 plan types (PPO x2, HDHP, HMO x2, EPO) instead of near-duplicates means a model
that's pattern-matching on "health insurance generally covers X" will get tripped up — referral
requirements, out-of-network coverage, and drug tiers all vary meaningfully across these 6.

## How the RAG pipeline works

1. **Chunking** (`scripts/chunk-docs.js`) — each `plan-*.md` file is split into small, independently
   retrievable pieces: one chunk per "Important Questions" bullet, one per line in the "Common Medical
   Events" cost table, one per excluded/other-covered-services list, and one per coverage example.
   ~40-44 chunks per document, ~260 total across all 6.
2. **Embedding** (`scripts/build-index.js`) — every chunk gets embedded with Voyage AI's
   `voyage-3-lite` model and written to `docs/embedding-index.json`, along with its source document and
   section. This is a build step, run locally, not something that happens per-request.
3. **Retrieval** (`scripts/retrieval.js`) — at query time, the question gets embedded the same way, and
   the 5 chunks with the highest cosine similarity to the question are retrieved. No vector database —
   at ~260 chunks, a linear scan over an array of float arrays is well under a millisecond, so a real
   vector DB (Pinecone, Vectorize, etc.) would be solving a problem this corpus doesn't have yet.
4. **Generation** — the prompt gets built from only the retrieved chunks (`scripts/promptfoo-prompt.js`
   for the eval; the same logic is duplicated in the Cloudflare Worker for the live demo, since Workers
   can't `require()` a file from this repo), and the model answers strictly from what it was given.

## What's in this repo

- **`plan-a.md`** through **`plan-f.md`** — the six source documents, condensed to their factual
  content (deductibles, copays, coinsurance, exclusions, coverage examples), with links to the
  originals.
- **`scripts/chunk-docs.js`** — splits a condensed plan doc into retrievable chunks.
- **`scripts/build-index.js`** — chunks all 6 documents and embeds every chunk with Voyage AI, writing
  `docs/embedding-index.json`. Run this whenever a plan doc changes.
- **`scripts/retrieval.js`** — shared cosine-similarity search logic (embed a query, return the top-K
  matching chunks). Used by the eval; mirrored in the Cloudflare Worker for the live demo.
- **`scripts/promptfoo-prompt.js`** — promptfoo's custom prompt function. This is what actually runs
  retrieval for each test case and builds the final prompt from the retrieved chunks.
- **`scripts/assert-retrieval.js`** / **`scripts/retrieval-cache.js`** — the retrieval-quality grading
  assertion, and the side-channel it uses to see which chunks got retrieved for each test case (see the
  comments in both files for why this needs a small workaround).
- **`tests.csv`** — 88 questions with answers I verified directly against the source documents: 60
  per-plan questions (10 per plan), 14 cross-plan comparisons, and 14 adversarial/hallucination-check
  questions (genuinely absent facts, invented plan names, detail-borrowing between plans, irrelevant
  narrative red herrings, and genuine ambiguity). Each row also has an `expected_source` column naming
  which plan document the correct answer actually lives in, used for retrieval-quality grading.
- **`promptfooconfig.yaml`** — wires the prompt function and test cases together, and grades each
  response twice: `answer_correct` (does the first line contain the expected fact?) and
  `retrieval_correct` (did retrieval pull back a chunk from the right document?).

## Try it yourself

The [live dashboard](https://benefits.stephpawlowski.com) has an "Ask the benefits library" panel: ask
any question about any of the 6 plans, and it runs the real pipeline live — your question gets embedded,
compared against the same ~260-chunk index used by the eval, and the retrieved chunks are shown
alongside the answer so you can see exactly what the model was (and wasn't) given. That call goes
through a small Cloudflare Worker I wrote that holds both the Anthropic and Voyage API keys
server-side, so neither is ever exposed in the browser, and rate-limits requests per visitor. It's a
real live pipeline, not a canned response.

## Setup

Requires [Node.js](https://nodejs.org/) 18+.

```bash
cd benefits-qa-eval
npm install
```

Set your Anthropic API key (get one at https://console.anthropic.com/):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Set a Voyage AI key too (get a free one at https://dash.voyageai.com/ — this eval's retrieval step
needs it both to build the index and to embed each question at eval time):

```bash
export VOYAGE_API_KEY="pa-..."
```

To test a different model, edit the `providers:` list in `promptfooconfig.yaml`.

## Building the embedding index

Before running the eval, build the retrieval index (this embeds all ~260 chunks — it costs a fraction
of a cent on Voyage's free tier and takes under a minute):

```bash
npm run build-index
```

This writes `docs/embedding-index.json`. Re-run it any time a `plan-*.md` file changes.

## Running the eval

```bash
npm run eval
```

Runs all 88 questions and prints a pass/fail summary with accuracy. Each test case is graded on two
separate metrics — `answer_correct` and `retrieval_correct` — so the summary table shows both. To also
save the full results to a file (needed if you want to build something like a results dashboard from
it):

```bash
npm run eval -- -o results.json
```

For a browsable per-question view instead:

```bash
npm run view
```

## Findings

Run against `claude-sonnet-5` on the full 88-question set: **85.2% answer accuracy (75/88)** and
**90.9% retrieval accuracy (80/88)**. (The automated grader actually scored 76/88 — one case, #44, is a
false positive where the model correctly said "Not stated in the document" to a yes/no question and the
substring grader matched because the word "not" contains "no." The dashboard shows the raw grader output
per question and flags this explicitly; the number above is manually corrected for it.)

**The headline result: zero hallucinations.** Every one of the 14 failures was the model declining to
answer ("Not stated in the document") rather than confidently stating something wrong. It never invented
a dollar figure, never guessed at a coverage rule, and never attributed one plan's fact to another. Given
that this was a real risk this eval was specifically built to catch — the test set includes 8 questions
about facts that plausibly sound like they belong to a plan but don't (asking about Plan C's premium,
inventing a "Plan G," borrowing a detail from the wrong plan's document) — the model got all 8 right,
correctly refusing every one.

**Where it actually broke down: retrieval, not reasoning — except for one clear exception.** Of the 14
misses, 8 trace to retrieval never surfacing the needed chunk in the top 5 (out of ~260 candidates, ranked
purely by embedding similarity). For most of those, the model did the right thing with bad information:
it said so, rather than guessing. The other 6 are the more interesting case — retrieval found the right
document, but the model still answered "Not stated" or got the comparison wrong anyway. All 6 of those are
**cross-plan comparison questions**: "Between Plan A and Plan D, which has the lower deductible?" style
questions, where the top-5 window has to hold chunks from *two* different plans simultaneously instead of
one. Retrieval nailed this 100% of the time (10/10) — both plans' relevant chunks made it into context —
but the model's final answer was only right 60% of the time (6/10). That's a real generation-side gap, not
a retrieval-side one: the model sometimes had both numbers in front of it and still said "not stated" or
compared the wrong figures. By contrast, single-plan questions scored 87% correct and adversarial
questions scored 100%. Splitting retrieval and answer grading is exactly what surfaces this — a single
pass/fail metric would have just called all 6 of these "wrong" without showing that the pipeline actually
did its job of finding the right sources.

## Project structure

```
benefits-qa-eval/
├── plan-a.md                    # Source doc 1 (CMS official PPO sample SBC)
├── plan-b.md                    # Source doc 2 (Auburn University HDHP SBC)
├── plan-c.md                    # Source doc 3 (Illinois State Employees HMO SBC)
├── plan-d.md                    # Source doc 4 (Northwestern University PPO SBC)
├── plan-e.md                    # Source doc 5 (Cochise Combined Trust EPO SBC)
├── plan-f.md                    # Source doc 6 (CalPERS Access+ HMO SBC)
├── tests.csv                    # 88 questions + answer key (id, question, expected, source, expected_source)
├── prompt.txt                   # No longer used — see scripts/promptfoo-prompt.js
├── promptfooconfig.yaml         # promptfoo config: prompt fn + tests + dual grading
├── scripts/
│   ├── chunk-docs.js            # Splits a plan doc into retrievable chunks
│   ├── build-index.js           # Chunks + embeds all 6 docs -> docs/embedding-index.json
│   ├── retrieval.js             # Embed a query, cosine-similarity search, top-K
│   ├── promptfoo-prompt.js      # Custom prompt function: retrieval + prompt building
│   ├── assert-retrieval.js      # Retrieval-quality grading assertion
│   └── retrieval-cache.js       # Side channel between the prompt fn and the assertion
├── docs/
│   ├── embedding-index.json     # Generated by build-index.js — the ~260-chunk vector index
│   └── index.html               # The dashboard: results table + live RAG demo
├── package.json
└── README.md
```

## Why this project

Second rep in a small LLM-evaluation portfolio, and the one where I moved from "give the model
everything and see if it stays grounded" to an actual RAG pipeline: chunking, embedding, retrieval, and
generation as separate, separately-measurable steps. Grading retrieval and generation independently is
the part I think matters most — an eval that only checks the final answer can't tell you whether a miss
came from bad retrieval or bad reasoning, and those need completely different fixes.
