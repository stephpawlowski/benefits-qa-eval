// Custom promptfoo assertion: did retrieval actually pull back the right
// document(s) for this question? This is graded separately from whether the
// final answer was correct (see promptfooconfig.yaml's defaultTest
// assertion) — a question can have a correct answer despite bad retrieval
// (the model got lucky, or the wrong-but-similar chunk still had the right
// number on it), and a question can have perfect retrieval but a wrong
// answer (the model misread a correctly-retrieved chunk). Grading these
// separately is what makes a RAG eval more informative than an ordinary
// Q&A eval — it tells you which half of the pipeline to fix.
//
// tests.csv's `expected_source` column names which plan doc(s) the correct
// answer actually lives in (e.g. "plan-c", or "plan-a,plan-d" for a
// cross-plan comparison question). This assertion passes if at least one of
// those source docs appears among the chunks promptfoo-prompt.js retrieved
// for this test (read via the retrieval-cache.js side channel).
//
// Referenced from promptfooconfig.yaml as a javascript assertion with
// value: file://scripts/assert-retrieval.js

const retrievalCache = require('./retrieval-cache.js');

module.exports = function assertRetrieval(output, context) {
  const { vars } = context;
  const id = String(vars.id);
  const retrievedSources = retrievalCache.get(id) || [];
  const expectedSources = String(vars.expected_source || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (expectedSources.length === 0) {
    // No expected_source annotated for this row (shouldn't happen once
    // tests.csv is fully filled in) — don't fail the run over a data gap.
    return { pass: true, score: 1, reason: 'No expected_source annotated; skipped.' };
  }

  const hit = expectedSources.some((src) => retrievedSources.includes(src));

  return {
    pass: hit,
    score: hit ? 1 : 0,
    reason: hit
      ? `Retrieved the right document (expected one of: ${expectedSources.join(', ')}; got: ${retrievedSources.join(', ')})`
      : `Did not retrieve the right document (expected one of: ${expectedSources.join(', ')}; got: ${retrievedSources.join(', ')})`,
  };
};
