// Tiny side channel between the prompt-building step and the grading step.
//
// promptfoo's custom prompt function only gets to return a prompt string;
// there's no built-in way to hand the assertion function the list of chunks
// that got retrieved for that question. But the prompt function and the
// assertion both run inside the same promptfoo Node process, and Node
// caches modules by resolved path, so every file that requires this module
// gets the *same* Map instance. promptfoo-prompt.js writes into it (keyed
// by the test's `id` var, which tests.csv guarantees is unique); the
// retrieval-quality assertion reads it back. Different test ids never
// collide, so this is safe even though promptfoo runs tests concurrently.

const retrievalCache = new Map();

module.exports = retrievalCache;
