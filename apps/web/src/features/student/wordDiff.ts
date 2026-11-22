/**
 * Word-level diff between the expected verse text and a student's typed
 * answer, for the post-check feedback view. Alignment is LCS-based so one
 * mistake does not cascade-highlight the rest of the verse. Words are
 * compared with the same normalization the grader uses (worker
 * `normalizeText`: lowercase, strip .,;:!? and quote marks).
 *
 * Categories:
 * - match:    present in both, in aligned position.
 * - missed:   in the expected verse, absent from the student's answer.
 * - extra:    in the student's answer, not in the expected verse.
 * - spelling: a substitution pair (aligned missed+extra in the same gap)
 *   whose words are near-matches — almost certainly a misspelling rather
 *   than a wrong word. In PBE a misspelling can be accepted or earn partial
 *   credit, unlike a missing/wrong word, so it is called out separately.
 *
 * The grader itself has no spelling tolerance (strict normalized equality
 * for the verdict, positional partial credit), so this module defines the
 * spelling rule: both words at least 3 letters, Damerau-Levenshtein
 * (transpositions count once) distance <= 1 for words up to 5 letters,
 * <= 2 for longer words, and never more than a third of the longer word.
 */
export type DiffStatus = "match" | "missed" | "extra" | "spelling";
export interface DiffToken { text: string; status: DiffStatus }
export interface SpellingPair { expected: string; submitted: string }
export interface WordDiff {
  expected: DiffToken[];
  submitted: DiffToken[];
  spellingPairs: SpellingPair[];
  missed: number;
  extra: number;
  spelling: number;
}

const normalizeWord = (word: string) => word.toLowerCase().replace(/[.,;:!?"“”‘’]/g, "");
const tokenize = (text: string) => text.split(/\s+/).filter(Boolean);

/** Optimal-string-alignment distance (Levenshtein + adjacent transposition). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1, cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

export function isSpellingPair(expectedWord: string, submittedWord: string): boolean {
  const a = normalizeWord(expectedWord), b = normalizeWord(submittedWord);
  if (!a || !b || a === b) return false;
  const longer = Math.max(a.length, b.length);
  if (Math.min(a.length, b.length) < 3) return false;
  const limit = longer <= 5 ? 1 : 2;
  const distance = editDistance(a, b);
  return distance <= limit && distance <= Math.ceil(longer / 3);
}

export function diffWords(expectedText: string, submittedText: string, options?: { markSpelling?: boolean }): WordDiff {
  // markSpelling=false is for spoken submissions: the transcript's spelling
  // comes from the speech engine, not the student, so near-matches must not
  // be called out as the student's spelling errors — they stay missed+extra.
  const markSpelling = options?.markSpelling !== false;
  const expectedRaw = tokenize(expectedText), submittedRaw = tokenize(submittedText);
  const expected = expectedRaw.map(normalizeWord), submitted = submittedRaw.map(normalizeWord);
  const n = expected.length, m = submitted.length;
  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = expected[i] === submitted[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  // Walk the alignment, collecting gaps (runs of unmatched words on both
  // sides between two matched anchors).
  type Op = { kind: "match" | "missed" | "extra"; e?: number; s?: number };
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (expected[i] === submitted[j]) { ops.push({ kind: "match", e: i, s: j }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ kind: "missed", e: i }); i++; }
    else { ops.push({ kind: "extra", s: j }); j++; }
  }
  while (i < n) { ops.push({ kind: "missed", e: i }); i++; }
  while (j < m) { ops.push({ kind: "extra", s: j }); j++; }
  // Within each gap, pair missed and extra words positionally; a near-match
  // pair is a spelling error, not a missed word plus an extra word.
  const spellingExpected = new Set<number>(), spellingSubmitted = new Set<number>();
  const spellingPairs: SpellingPair[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].kind === "match") { k++; continue; }
    const gap: Op[] = [];
    while (k < ops.length && ops[k].kind !== "match") { gap.push(ops[k]); k++; }
    const missedIdx = gap.filter(op => op.kind === "missed").map(op => op.e!), extraIdx = gap.filter(op => op.kind === "extra").map(op => op.s!);
    const pairs = Math.min(missedIdx.length, extraIdx.length);
    for (let p = 0; p < pairs; p++) {
      const e = missedIdx[p], s = extraIdx[p];
      if (markSpelling && isSpellingPair(expectedRaw[e], submittedRaw[s])) {
        spellingExpected.add(e); spellingSubmitted.add(s);
        spellingPairs.push({ expected: expectedRaw[e], submitted: submittedRaw[s] });
      }
    }
  }
  const expectedTokens: DiffToken[] = expectedRaw.map((text, idx) => ({ text, status: spellingExpected.has(idx) ? "spelling" : ops.some(op => op.kind === "match" && op.e === idx) ? "match" : "missed" }));
  const submittedTokens: DiffToken[] = submittedRaw.map((text, idx) => ({ text, status: spellingSubmitted.has(idx) ? "spelling" : ops.some(op => op.kind === "match" && op.s === idx) ? "match" : "extra" }));
  return {
    expected: expectedTokens,
    submitted: submittedTokens,
    spellingPairs,
    missed: expectedTokens.filter(t => t.status === "missed").length,
    extra: submittedTokens.filter(t => t.status === "extra").length,
    spelling: spellingPairs.length,
  };
}
