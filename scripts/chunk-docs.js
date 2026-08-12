// Splits a condensed plan-*.md document into small, independently retrievable
// chunks. Used by scripts/build-index.js at index-build time. Kept in its own
// module (rather than inlined) because both the offline index builder and any
// future re-chunking / debugging script need the exact same logic: chunk
// boundaries have to be identical every time a document is re-indexed, or
// retrieval quality drifts silently between runs.
//
// Chunking strategy: each markdown "## " section is handled a little
// differently depending on its shape, because a single fixed rule (e.g.
// "one chunk per paragraph") doesn't fit this document type well:
//   - Header/metadata (title, plan name, coverage period, source) -> 1 chunk.
//     Answers "what type of plan is this" / "who administers this" questions.
//   - "Important Questions"                -> 1 chunk per bullet.
//     Each bullet is already a self-contained Q&A pair.
//   - "Common Medical Events"              -> 1 chunk per bullet.
//     Each bullet is one service (e.g. "Specialist visit") with its own
//     cost-sharing details. This is the section most questions target, and
//     it's also where cross-plan confusion is easiest, so keeping these
//     atomic is the most important call this script makes.
//   - "Excluded Services" / "Other Covered Services" -> 1 chunk each.
//     These are short lists; splitting per-item would create chunks with
//     almost no distinguishing context ("Acupuncture" alone embeds poorly).
//   - "Does this plan provide..." (minimum essential coverage / minimum
//     value)                                -> 1 chunk.
//   - "Coverage Examples"                  -> 1 chunk per named example
//     (Peg / Joe / Mia), since each is a self-contained worked scenario.

function chunkDocument(markdown, sourceId) {
  const chunks = [];
  let chunkIndex = 0;

  const nextId = () => `${sourceId}-${String(++chunkIndex).padStart(3, '0')}`;

  const lines = markdown.split('\n');

  // Split the doc into ## sections, keeping the intro (before the first ##)
  // as its own pseudo-section called "header".
  const sections = [];
  let current = { heading: 'header', body: [] };
  for (const line of lines) {
    const match = line.match(/^##\s+(.*)$/);
    if (match) {
      sections.push(current);
      current = { heading: match[1].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);

  for (const section of sections) {
    const text = section.body.join('\n').trim();
    if (!text) continue;

    if (section.heading === 'header') {
      chunks.push({
        id: nextId(),
        source: sourceId,
        section: 'header',
        text,
      });
      continue;
    }

    if (
      section.heading === 'Important Questions' ||
      section.heading.startsWith('Common Medical Events')
    ) {
      // One chunk per top-level "- " bullet. A bullet may wrap onto
      // following indented lines, so we accumulate until the next bullet.
      const bullets = [];
      let buf = null;
      for (const line of section.body) {
        if (/^-\s+/.test(line)) {
          if (buf) bullets.push(buf.trim());
          buf = line.replace(/^-\s+/, '');
        } else if (buf !== null && line.trim()) {
          buf += ' ' + line.trim();
        }
      }
      if (buf) bullets.push(buf.trim());

      for (const bullet of bullets) {
        if (!bullet) continue;
        chunks.push({
          id: nextId(),
          source: sourceId,
          section: section.heading,
          text: bullet,
        });
      }
      continue;
    }

    if (section.heading === 'Coverage Examples') {
      // Each of the 3 named examples (Peg / Joe / Mia) is its own paragraph,
      // separated by a blank line in the source markdown. Splitting on blank
      // lines is more robust than matching the bold title text, since the
      // title wording isn't consistent ("Peg is Having a Baby" vs.
      // "Managing Joe's Type 2 Diabetes" vs. "Mia's Simple Fracture").
      const exampleBlocks = text.split(/\n\s*\n/).filter(Boolean);
      for (const block of exampleBlocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        chunks.push({
          id: nextId(),
          source: sourceId,
          section: 'Coverage Examples',
          text: trimmed,
        });
      }
      continue;
    }

    // Default: Excluded Services, Other Covered Services, Minimum
    // Essential/Value Coverage, and anything else -> one chunk for the
    // whole section.
    chunks.push({
      id: nextId(),
      source: sourceId,
      section: section.heading,
      text,
    });
  }

  return chunks;
}

module.exports = { chunkDocument };
