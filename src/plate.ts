/**
 * A chip's tint: the hue rule of the web's `lib/plate.ts` (ADR 0056), which
 * the extension and iOS share, so a card keeps its colour everywhere. Change
 * the rules there first; a test checks the two agree.
 */

const HUES = [18, 42, 68, 96, 132, 162, 192, 214, 248, 278, 308, 338];

export function hueOf(seed: string): number {
  let hash = 2166136261;
  for (const ch of seed.toLowerCase()) {
    hash ^= ch.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  return HUES[(hash >>> 0) % HUES.length];
}
