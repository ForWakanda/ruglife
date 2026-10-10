// Seeded, serializable RNG. mulberry32 over a 32-bit state kept in GameState so replays are exact.
export function seedToState(seed: string): number {
  // FNV-1a over the seed string → 32-bit state
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0 || 1;
}

/** Returns a float in [0,1) and the next state. */
export function next(state: number): [number, number] {
  let a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const v = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [v, a];
}

export class Rng {
  constructor(public state: number) {}
  float(): number {
    const [v, s] = next(this.state);
    this.state = s;
    return v;
  }
  int(n: number): number {
    return Math.floor(this.float() * n);
  }
  d6(): number {
    return 1 + this.int(6);
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = a;
    }
    return arr;
  }
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("pick from empty");
    return arr[this.int(arr.length)] as T;
  }
}
