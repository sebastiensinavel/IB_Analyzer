/**
 * Plain numbers, not a `Uint8Array`: convert both sides before comparing two byte buffers
 * with `toEqual` (or `not.toEqual`).
 *
 * jsdom's window carries its own `Uint8Array`/`ArrayBuffer` — a class distinct from the one
 * code running in the same test process, but outside jsdom, hands back. This codebase has
 * observed `CompressionStream`/`DecompressionStream` output (`apps/web/src/db/backup/crypto.ts`,
 * task 5) fall into that second, non-jsdom class, while a sibling `TextEncoder().encode(...)`
 * call in the very same test file produced jsdom's own class. Two byte-for-byte identical
 * arrays, different `[[Prototype]]` — and `expect(...).toEqual(...)` fails on that mismatch,
 * not on any byte. The reported diff is actively misleading: it prints the same numbers on
 * both sides and says "Compared values have no visual difference", because nothing about the
 * *values* differs — chasing that message by re-checking the bytes by hand costs real time
 * before the two-realms explanation surfaces.
 *
 * `Array.from(bytes)` throws the constructor away and keeps only what a byte-level test
 * should ever care about: the sequence of numbers. Two `number[]` never carry this trap,
 * whichever realm produced the `Uint8Array` they were read from.
 */
export function bytesOf(bytes: Uint8Array): number[] {
  return Array.from(bytes);
}
