# Benefits Q&A Checker

Can an LLM correctly answer coverage questions when given a real health insurance document as its
only source of truth? This is a small eval built with [promptfoo](https://www.promptfoo.dev/), testing
an LLM against two real, publicly available Summary of Benefits and Coverage (SBC) documents.

This is the closest of my portfolio evals to real retrieval/RAG evaluation work: the model is given
source documents as context and graded on whether it extracts the right facts from them, not on
outside medical knowledge.

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
- **`tests.csv`** — 50 questions with answers I verified directly against the source PDFs: 20 about
  Plan A only, 20 about Plan B only, and 10 that require comparing the two (e.g., "which plan requires
  a referral to see a specialist?").
- **`prompt.txt`** — both documents pasted in as context, followed by one question, with instructions
  to answer in a short first line (a dollar amount, percentage, Yes/No, or plan name) plus a one-sentence
  citation.
- **`promptfooconfig.yaml`** — wires it together and grades each response by checking whether the
  model's first line contains the expected fact from the answer key.

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

Runs all 50 questions and prints a pass/fail summary with accuracy. To also save the full results to a
file (needed if you want to build something like a results dashboard from it):

```bash
npm run eval -- -o results.json
```

For a browsable per-question view instead:

```bash
npm run view
```

## Findings

**Model tested:** `claude-sonnet-5`

**Overall accuracy: 49/50 (98%)** — 20/20 on Plan A questions, 19/20 on Plan B questions, 10/10 on the
cross-plan comparison questions. No sign of the model blending facts between the two documents; every
comparison question (the ones designed to catch that specific failure mode) was answered correctly.

### The one "failure"

Question 50 asked: *"Which plan type is Plan A, and which plan type is Plan B?"* Expected answer:
`"Plan A is PPO, Plan B is HDHP"`. The model actually answered correctly:

> Plan A: PPO; Plan B: HDHP
>
> Plan A's header states "Plan Type: PPO," while Plan B's header states "Plan Type: HDHP."

That's the right fact, just phrased with a colon instead of the word "is." My grading script does a
normalized substring match, and `"plan a: ppo; plan b: hdhp"` doesn't contain the literal phrase
`"plan a is ppo, plan b is hdhp"`, so it got marked as a fail even though the model was right.

This is actually a useful thing to have caught: it's a **grading harness bug, not a model error** —
the eval's answer key was too rigid for a question with more than one valid phrasing. The real
takeaway is that automated substring/exact-match grading works well for single-fact answers (dollar
amounts, percentages, Yes/No) but breaks down on any question whose correct answer can be phrased more
than one way. A more robust version of this eval would either restrict itself to single-token answers
or switch to a model-graded assertion (asking a second LLM call "does this answer convey the same two
facts as the reference answer?") for any multi-part questions like this one.

### What this suggests about using an LLM for benefits Q&A in production

With correctly designed grading, this model got all 50 facts right across two real, meaningfully
different plan documents, including every question that required keeping the two plans straight rather
than blending them. That's a strong result for a grounded-document Q&A use case. The one asterisk is
that "the eval said 49/50" and "the model was 49/50 correct" turned out to be two different numbers —
which is itself the more important lesson for anyone building this kind of check: always spot-read the
failures before trusting the accuracy percentage, because sometimes the harness is what's wrong.

## Project structure

```
benefits-qa-eval/
├── plan-a.md               # Source document 1 (CMS official PPO sample SBC)
├── plan-b.md               # Source document 2 (Auburn University HDHP SBC)
├── tests.csv                # 50 questions + answer key (id, question, expected, source)
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
