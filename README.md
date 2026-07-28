# Benefits Q&A Checker

Can an LLM correctly answer coverage questions when given a real health insurance document as its
only source of truth — and just as important, does it know when to say "I don't know" instead of
guessing? This is a small eval built with [promptfoo](https://www.promptfoo.dev/), testing an LLM
against two real, publicly available Summary of Benefits and Coverage (SBC) documents.

This is the closest of my portfolio evals to real retrieval/RAG evaluation work: the model is given
source documents as context and graded on whether it extracts the right facts from them, not on
outside medical knowledge.

This is version 2 of the project. Version 1 had 50 questions, all answerable from the documents.
Version 2 adds 15 adversarial/hallucination-check questions that don't have a clean answer sitting in
the text — genuinely missing facts (a premium amount, a phone number), invented plan names that don't
exist in either document, and questions that borrow one plan's specific detail (a deductible amount, a
regional coinsurance carve-out) and ask about the other plan, to see whether the model notices the
detail doesn't actually appear there. The prompt already instructs the model to say "Not stated in the
document" instead of guessing — these 15 cases are what actually puts that instruction to the test.

## The documents

SBCs are a standardized, federally mandated format (every US health plan has to produce one), so
these are easy to source publicly and easy to verify facts against.

- **Plan A** — the official CMS reference example SBC (a PPO family plan), used industry-wide to
  illustrate the standard SBC template. Public domain, from cms.gov.
- **Plan B** — Auburn University's actual 2025 HDHP plan document (administered by Blue Cross Blue
  Shield of Alabama), posted publicly on Auburn's HR site for employees and prospective employees.

I picked two genuinely different plan types (PPO vs. HDHP) on purpose, not two similar ones. They
disagree on real things — Plan A requires a specialist referral and Plan B doesn't, Plan A covers
mental health outpatient care and Plan B doesn't, Plan A covers skilled nursing and children's glasses
and Plan B doesn't — so a model that's actually reading the documents (rather than pattern-matching on
"health insurance generally covers X") has to get those distinctions right.

## What's in this repo

- **`plan-a.md`** / **`plan-b.md`** — the two source documents, condensed to their factual content
  (deductibles, copays, coinsurance, exclusions, coverage examples), with links to the originals.
- **`tests.csv`** — 65 questions with answers I verified directly against the source PDFs: the original
  50 (20 about Plan A only, 20 about Plan B only, 10 that require comparing the two, e.g. "which plan
  requires a referral to see a specialist?"), plus 15 new adversarial/hallucination-check questions
  (5 asking about facts genuinely absent from both documents, 5 that plant one plan's specific detail
  into a question about the other plan, 2 asking about invented plan names that don't exist, 2 wrapped
  in an irrelevant narrative red herring, and 1 that's genuinely ambiguous rather than answerable either
  way).
- **`prompt.txt`** — both documents pasted in as context, followed by one question, with instructions
  to answer in a short first line (a dollar amount, percentage, Yes/No, or plan name) plus a one-sentence
  citation.
- **`promptfooconfig.yaml`** — wires it together and grades each response by checking whether the
  model's first line contains the expected fact from the answer key.

## Try it yourself

The [live dashboard](https://benefits.stephpawlowski.com) has a "Try it with your own document"
panel: paste in any plan document text and ask it a question, and it calls `claude-sonnet-5` for a
real answer. That call goes through a small Cloudflare Worker I wrote that holds the Anthropic API
key server-side, so it's never exposed in the browser, and rate-limits requests per visitor. It's a
real live model call, not a canned response.

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

To test a different model, edit the `providers:` list in `promptfooconfig.yaml`.

## Running the eval

```bash
npm run eval
```

Runs all 65 questions and prints a pass/fail summary with accuracy. To also save the full results to a
file (needed if you want to build something like a results dashboard from it):

```bash
npm run eval -- -o results.json
```

For a browsable per-question view instead:

```bash
npm run view
```

## Findings

**Model tested:** `claude-sonnet-5`. This is the v2 run: all 65 questions, including the 15 new
adversarial/hallucination-check cases.

**63 out of 65 correct (96.9%)** — 13 of the 15 new adversarial cases passed outright, and neither of
the two misses is a real factual error or a hallucination. No sign of the model blending facts between
the two documents; every cross-plan comparison question (the ones designed to catch that specific
failure mode) was answered correctly, and the model correctly said "Not stated in the document" on the
genuinely-absent-fact questions rather than guessing.

### Miss #1: Q50 is a grading-script bug, not a model error

Question 50 asked: *"Which plan type is Plan A, and which plan type is Plan B?"* Expected answer:
`"Plan A is PPO, Plan B is HDHP"`. The model actually answered:

> Plan A — PPO; Plan B — HDHP
>
> Plan A's header states "Plan Type: PPO," while Plan B's header states "Plan Type: HDHP."

That's the right fact, just phrased with a dash instead of the word "is." My grading script does a
normalized substring match, and `"plan a — ppo; plan b — hdhp"` doesn't contain the literal phrase
`"plan a is ppo, plan b is hdhp"`, so it's marked as a fail even though the model was right. Same issue
I flagged in the v1 run, just with a slightly different dash/punctuation choice this time — automated
substring grading holds up fine for single-fact answers (dollar amounts, percentages, Yes/No) but
breaks down on any question whose correct answer can be phrased more than one way.

### Miss #2: Q59 is a test-design limitation, not a hallucination

Question 59 asks whether Alabama law affects Plan A's out-of-network coinsurance rate — a detail
borrowed from Plan B's document (which does have an Alabama-specific carve-out) and applied to a
question about Plan A (which doesn't have one). Expected answer: `"Not stated in the document"`. The
model answered:

> No
>
> Plan A's Summary of Benefits and Coverage does not mention any Alabama-specific provision affecting
> its out-of-network coinsurance rate.

The model got the substance exactly right: it correctly noticed the detail doesn't apply to Plan A and
didn't invent one. But my answer key expected the literal phrase "Not stated in the document," which is
a stricter standard than the question's own yes/no framing actually calls for — a question asked as
"does X affect Y?" can be answered "No" by a careful model instead of a "not stated" hedge, and both are
defensible. This is a limitation of how I wrote this particular adversarial question, distinct from the
genuinely open-ended absent-fact questions in the set (like "what is the premium?") where "not stated"
really is the only sensible answer.

### What this suggests about using an LLM for benefits Q&A in production

With correctly designed grading, this model effectively got all 65 facts right across two real,
meaningfully different plan documents, including every question built to catch fact-blending,
invented-plan hallucinations, or getting distracted by an irrelevant narrative detail. That's a strong
result for a grounded-document Q&A use case. Both "misses" here are about my own eval design (a rigid
answer-key phrasing, and a question framed more narrowly than my answer key assumed) rather than the
model getting anything factually wrong — which is itself the more important lesson for anyone building
this kind of check: always spot-read the failures before trusting the accuracy percentage, because
sometimes the harness is what's wrong.

## Project structure

```
benefits-qa-eval/
├── plan-a.md               # Source document 1 (CMS official PPO sample SBC)
├── plan-b.md               # Source document 2 (Auburn University HDHP SBC)
├── tests.csv                # 65 questions + answer key (id, question, expected, source)
├── prompt.txt                # Prompt template: both documents + one question
├── promptfooconfig.yaml       # promptfoo config wiring prompt + tests + grading
├── package.json
└── README.md
```

## Why this project

Second rep in a small LLM-evaluation portfolio, this time on a retrieval/grounding task instead of a
policy-classification task: does the model stick to what's actually in the source document, and can it
keep two similar-but-different documents straight instead of blending them. It also turned up a lesson
the first project didn't: that eval grading logic needs its own scrutiny, not just the model's answers.
