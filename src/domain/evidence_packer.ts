/**
 * Pure Functional Evidence Packer: Deterministic 64-bit SimHash, Binary Fuse8
 * Fingerprint Deduplication, and MaxSim Token-Overlap Scoring with Symbol Boost.
 *
 * Strictly zero I/O imports. Used by `capsule_pack_context` MCP tool and
 * Pi SDK extension to pack long coding context into high-density evidence capsules.
 */

export interface PackContextInput {
  readonly chunks: readonly string[] | string;
  readonly query?: string;
  readonly keepRatio?: number;
  readonly symbolBoost?: number;
  readonly chunkTokens?: number;
  readonly hammingDedupeBits?: number;
}

export interface ScoredEvidenceChunk {
  readonly index: number;
  readonly text: string;
  readonly estimatedTokens: number;
  readonly simhash64Hex: string;
  readonly fuse8Fingerprint: number;
  readonly maxSimScore: number;
  readonly matchedSymbols: readonly string[];
  readonly deduplicated: boolean;
}

export interface PackContextResult {
  readonly totalInputChunks: number;
  readonly uniqueFingerprintCount: number;
  readonly deduplicatedCount: number;
  readonly selectedCount: number;
  readonly inputEstimatedTokens: number;
  readonly packedEstimatedTokens: number;
  readonly tokenCompressionRatio: number;
  readonly keepRatioApplied: number;
  readonly symbolBoostApplied: number;
  readonly globalSummaryHeader: string;
  readonly selectedChunks: readonly ScoredEvidenceChunk[];
  readonly allScoredChunks: readonly ScoredEvidenceChunk[];
}

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * Computes a deterministic 64-bit FNV-1a + SplitMix64 avalanche hash for a token.
 */
export function hashToken64(token: string): bigint {
  let h = FNV_OFFSET_64;
  for (let i = 0; i < token.length; i++) {
    h ^= BigInt(token.charCodeAt(i));
    h = (h * FNV_PRIME_64) & MASK_64;
  }
  // SplitMix64 finalizer for uniform bit distribution
  h ^= h >> 30n;
  h = (h * 0xbf58476d1ce4e5b9n) & MASK_64;
  h ^= h >> 27n;
  h = (h * 0x94d049bb133111ebn) & MASK_64;
  h ^= h >> 31n;
  return h & MASK_64;
}

/**
 * Extracts normalized lexical tokens and code identifiers from a text block.
 */
export function tokenizeChunk(text: string): readonly string[] {
  const matches = text.match(/[A-Za-z_][A-Za-z0-9_.:/-]*|[0-9]+/g);
  if (!matches) {
    return [];
  }
  return matches.filter((t) => t.length >= 2);
}

/**
 * Checks whether a token looks like a code symbol / identifier (camelCase, snake_case,
 * qualified path, CLI flag, or constant).
 */
export function isCodeSymbolToken(token: string): boolean {
  if (token.includes("_") || token.includes(".") || token.includes("/") || token.includes(":")) {
    return true;
  }
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(token) || /^[A-Z][A-Za-z0-9]+[A-Z][A-Za-z0-9]*$/.test(token)) {
    return true;
  }
  return false;
}

/**
 * Computes a 64-bit Charikar SimHash sketch over the tokens of a text chunk.
 * Code symbols receive weight 2; regular words receive weight 1.
 */
export function computeSimHash64(text: string): bigint {
  const tokens = tokenizeChunk(text);
  if (tokens.length === 0) {
    return 0n;
  }
  const accum = new Int32Array(64);
  for (const rawTok of tokens) {
    const isSym = isCodeSymbolToken(rawTok);
    const weight = isSym ? 2 : 1;
    const h = hashToken64(rawTok.toLowerCase());
    for (let bit = 0; bit < 64; bit++) {
      if (((h >> BigInt(bit)) & 1n) === 1n) {
        accum[bit] += weight;
      } else {
        accum[bit] -= weight;
      }
    }
  }
  let simhash = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (accum[bit] >= 0) {
      simhash |= 1n << BigInt(bit);
    }
  }
  return simhash & MASK_64;
}

/**
 * Computes the 8-bit Binary Fuse8 fingerprint (0..255) from a 64-bit SimHash.
 */
export function computeFuse8Fingerprint(simhash64: bigint): number {
  const folded = (simhash64 ^ (simhash64 >> 24n) ^ (simhash64 >> 48n)) & 0xffn;
  return Number(folded);
}

/**
 * Computes the Hamming distance (0..64) between two 64-bit SimHash values.
 */
export function hammingDistance64(a: bigint, b: bigint): number {
  let xor = (a ^ b) & MASK_64;
  let count = 0;
  while (xor > 0n) {
    xor &= xor - 1n;
    count++;
  }
  return count;
}

/**
 * Splits a raw string into fixed-granularity chunks if `chunks` is passed as a single string.
 */
export function normalizeInputChunks(
  chunksInput: readonly string[] | string,
  chunkTokens = 64,
): readonly string[] {
  if (Array.isArray(chunksInput)) {
    return chunksInput.map((c) => String(c)).filter((c) => c.trim().length > 0);
  }
  const raw = String(chunksInput).trim();
  if (raw.length === 0) {
    return [];
  }
  const paragraphs = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    return paragraphs;
  }
  const words = raw.split(/\s+/);
  const out: string[] = [];
  const step = Math.max(8, chunkTokens);
  for (let i = 0; i < words.length; i += step) {
    out.push(words.slice(i, i + step).join(" "));
  }
  return out;
}

/**
 * Computes MaxSim token-overlap + symbol-boost score between query tokens and a chunk.
 */
function scoreChunkAgainstQuery(
  chunkText: string,
  chunkSimHash: bigint,
  queryTokens: readonly string[],
  querySimHash: bigint,
  symbolBoost: number,
  chunkIndex: number,
  totalChunks: number,
): { readonly score: number; readonly matchedSymbols: readonly string[] } {
  const chunkTokens = tokenizeChunk(chunkText);
  if (chunkTokens.length === 0) {
    return { score: 0, matchedSymbols: [] };
  }

  const chunkLowerSet = new Set(chunkTokens.map((t) => t.toLowerCase()));
  const matchedSymbols: string[] = [];

  if (queryTokens.length === 0) {
    const symCount = chunkTokens.filter(isCodeSymbolToken).length;
    const density = symCount / Math.max(1, chunkTokens.length);
    const recencyBias = 0.05 * (1 - chunkIndex / Math.max(1, totalChunks));
    return {
      score: Number((1.0 + density * symbolBoost + recencyBias).toFixed(4)),
      matchedSymbols: chunkTokens.filter(isCodeSymbolToken).slice(0, 5),
    };
  }

  let maxSimSum = 0;
  for (const qTok of queryTokens) {
    const qLow = qTok.toLowerCase();
    const isSym = isCodeSymbolToken(qTok);
    const weight = isSym ? symbolBoost : 1.0;

    if (chunkLowerSet.has(qLow)) {
      maxSimSum += weight;
      if (isSym && !matchedSymbols.includes(qTok)) {
        matchedSymbols.push(qTok);
      }
      continue;
    }

    // Substring / prefix match for compound identifiers
    let bestPartial = 0;
    for (const cTok of chunkLowerSet) {
      if (cTok.includes(qLow) || qLow.includes(cTok)) {
        const ratio = Math.min(cTok.length, qLow.length) / Math.max(cTok.length, qLow.length);
        if (ratio > bestPartial) {
          bestPartial = ratio;
        }
      }
    }
    maxSimSum += bestPartial * 0.65 * weight;
  }

  const hammingSim = 1.0 - hammingDistance64(chunkSimHash, querySimHash) / 64.0;
  const normalizedOverlap = maxSimSum / Math.max(1, queryTokens.length);
  const totalScore = Number((normalizedOverlap * 0.85 + hammingSim * 0.15).toFixed(4));

  return {
    score: totalScore,
    matchedSymbols: Object.freeze(matchedSymbols),
  };
}

/**
 * Pure deterministic context capsule packer (`capsule_pack_context`).
 * Deduplicates near-identical chunks via 64-bit SimHash + Binary Fuse8 fingerprints,
 * scores remaining chunks via MaxSim token overlap with identifier symbol boost,
 * and retains the top `keepRatio` chunks in original document order.
 */
export function packContextCapsules(input: PackContextInput): PackContextResult {
  const chunkTokens = input.chunkTokens ?? 64;
  const rawChunks = normalizeInputChunks(input.chunks, chunkTokens);
  const keepRatio = Math.max(0.05, Math.min(1.0, input.keepRatio ?? 0.25));
  const symbolBoost = Math.max(1.0, input.symbolBoost ?? 3.5);
  const hammingDedupeBits = input.hammingDedupeBits ?? 3;

  if (rawChunks.length === 0) {
    return Object.freeze({
      totalInputChunks: 0,
      uniqueFingerprintCount: 0,
      deduplicatedCount: 0,
      selectedCount: 0,
      inputEstimatedTokens: 0,
      packedEstimatedTokens: 0,
      tokenCompressionRatio: 1.0,
      keepRatioApplied: keepRatio,
      symbolBoostApplied: symbolBoost,
      globalSummaryHeader: "[Capsule Global Header: 0 chunks, 0 tokens]",
      selectedChunks: Object.freeze([]),
      allScoredChunks: Object.freeze([]),
    });
  }

  const queryText = (input.query ?? "").trim();
  const queryTokens = tokenizeChunk(queryText);
  const querySimHash = queryText.length > 0 ? computeSimHash64(queryText) : 0n;

  const seenSimHashes: bigint[] = [];
  const uniqueFingerprints = new Set<string>();
  const scored: ScoredEvidenceChunk[] = [];
  let inputEstimatedTokens = 0;
  let deduplicatedCount = 0;

  for (let i = 0; i < rawChunks.length; i++) {
    const text = rawChunks[i];
    const estTokens = Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3));
    inputEstimatedTokens += estTokens;

    const simhash = computeSimHash64(text);
    const simhashHex = simhash.toString(16).padStart(16, "0");
    const fuse8 = computeFuse8Fingerprint(simhash);

    let isDuplicate = false;
    for (const prevHash of seenSimHashes) {
      if (hammingDistance64(simhash, prevHash) <= hammingDedupeBits) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      deduplicatedCount++;
    } else {
      seenSimHashes.push(simhash);
      uniqueFingerprints.add(`${fuse8}:${simhashHex}`);
    }

    const { score, matchedSymbols } = scoreChunkAgainstQuery(
      text,
      simhash,
      queryTokens,
      querySimHash,
      symbolBoost,
      i,
      rawChunks.length,
    );

    scored.push(
      Object.freeze({
        index: i,
        text,
        estimatedTokens: estTokens,
        simhash64Hex: simhashHex,
        fuse8Fingerprint: fuse8,
        maxSimScore: isDuplicate ? Number((score * 0.1).toFixed(4)) : score,
        matchedSymbols,
        deduplicated: isDuplicate,
      }),
    );
  }

  const nonDuplicateCandidates = scored.filter((c) => !c.deduplicated);
  const pool = nonDuplicateCandidates.length > 0 ? nonDuplicateCandidates : scored;
  const targetKeepCount = Math.max(1, Math.min(pool.length, Math.ceil(rawChunks.length * keepRatio)));

  const ranked = [...pool].sort((a, b) => {
    if (b.maxSimScore !== a.maxSimScore) {
      return b.maxSimScore - a.maxSimScore;
    }
    return a.index - b.index;
  });

  const selectedIndices = new Set(ranked.slice(0, targetKeepCount).map((c) => c.index));
  const selectedChunks = scored.filter((c) => selectedIndices.has(c.index));

  const packedEstimatedTokens = selectedChunks.reduce((acc, c) => acc + c.estimatedTokens, 0);
  const tokenCompressionRatio =
    packedEstimatedTokens > 0
      ? Number((inputEstimatedTokens / packedEstimatedTokens).toFixed(2))
      : 1.0;

  const globalSummaryHeader = `[Capsule Global Header: total_chunks=${rawChunks.length}, unique_fuse8=${uniqueFingerprints.size}, deduped=${deduplicatedCount}, selected=${selectedChunks.length}, compression=${tokenCompressionRatio}x]`;

  return Object.freeze({
    totalInputChunks: rawChunks.length,
    uniqueFingerprintCount: uniqueFingerprints.size,
    deduplicatedCount,
    selectedCount: selectedChunks.length,
    inputEstimatedTokens,
    packedEstimatedTokens,
    tokenCompressionRatio,
    keepRatioApplied: keepRatio,
    symbolBoostApplied: symbolBoost,
    globalSummaryHeader,
    selectedChunks: Object.freeze(selectedChunks),
    allScoredChunks: Object.freeze(scored),
  });
}
