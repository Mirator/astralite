// Which real lights a chamber gets (plan 025 D6, amended 2026-10-07).
//
// three.js compiles the point-light count into every lit shader, so the keep has a fixed pool of eight
// (progress.md "Light cap"). It used to be lent to whatever was nearest the knight, frame by frame: the
// third and fourth torch went to braziers in other chambers, sconces past the nearest four burned without
// throwing light, and lamps popped as he walked. Plan 025 Stage B counted the sources: 78% of chambers have
// more than eight (up to 23), so no assignment can light every flame. Every sconce therefore paints its own
// pool on the floor for free (`litDisc`, built by the atmosphere), and the eight real lights go to the
// chamber the knight is in, by a fixed priority, and stay put until he leaves it.
//
// Pure: no three.js, so node runs it directly.

/** The real point lights the keep lends out. Not the knight's fill, which follows him everywhere. */
export const LIGHT_POOL = 8;
/** A swap on entering a chamber: the old light fades out and the new one in, this long in all. */
export const LIGHT_FADE = .3;

export type LightKind = 'brazier' | 'door' | 'sconce' | 'bounce';
/** Something in a chamber that would like a real light. `id` is stable for the floor's life. */
export type LightSource = { id: string; kind: LightKind; room: number; x: number; y: number; z: number; color: number; intensity: number; distance: number };
/** A chamber as the pool sees it: where its heart is, every source on the floor, and whether its doors are open. */
export type LightChamber = { id: number; x: number; z: number; sources: readonly LightSource[]; open: boolean };

const RANK: Record<LightKind, number> = { brazier: 0, door: 1, sconce: 2, bounce: 3 };

/**
 * The sources the pool lights in `chamber`, in priority order, at most `LIGHT_POOL`: its braziers, then its
 * doors once it is open, then its sconces nearest its heart, then its water bounces nearest its heart. Never a
 * source of another chamber, and nothing here depends on where the knight stands, so the set is fixed for as
 * long as he is in the chamber and its doors stay as they are.
 */
export function chamberLights(chamber: LightChamber): LightSource[] {
  const near = (s: LightSource) => (s.x - chamber.x) ** 2 + (s.z - chamber.z) ** 2;
  return chamber.sources
    .filter(s => s.room === chamber.id && (s.kind !== 'door' || chamber.open))
    .map((s, order) => ({ s, order, key: s.kind === 'sconce' || s.kind === 'bounce' ? near(s) : 0 }))
    .sort((a, b) => RANK[a.s.kind] - RANK[b.s.kind] || a.key - b.key || a.order - b.order)
    .slice(0, LIGHT_POOL)
    .map(e => e.s);
}

/**
 * Which pool slot lights which source. A source already lit keeps its slot, so a door opening never makes a
 * brazier fade out and back in; the new ones take the slots nobody wanted, lowest first. `held` is what each
 * slot is lighting or fading towards now.
 */
export function assignSlots(held: readonly (string | null)[], wanted: readonly LightSource[]): (LightSource | null)[] {
  const slots: (LightSource | null)[] = held.map(id => wanted.find(s => s.id === id) ?? null);
  for (const source of wanted) {
    if (slots.some(s => s?.id === source.id)) continue;
    const free = slots.indexOf(null);
    if (free >= 0) slots[free] = source;
  }
  return slots;
}

/** One slot of the pool: what it is lighting and how far up it is (0..1). */
export type PoolSlot = { shown: LightSource | null; level: number };

/**
 * Steps one slot towards `target` over `dt` seconds. A slot lighting something else fades out first and only
 * then moves, so a light is never seen jumping: half of `LIGHT_FADE` down, half up. An idle slot takes its
 * source straight away and fades up.
 */
export function fadeSlot(slot: PoolSlot, target: LightSource | null, dt: number): PoolSlot {
  const rate = 2 / LIGHT_FADE;
  if (slot.shown?.id !== target?.id) {
    const level = slot.shown ? slot.level - dt * rate : 0;
    if (level > 0) return { shown: slot.shown, level };
    return { shown: target, level: 0 };
  }
  return { shown: target, level: target ? Math.min(1, slot.level + dt * rate) : 0 };
}

/** How long the camera looks towards a cleared chamber's open doors, there and back. */
export const GLANCE_SPAN = .8;
/** How far towards the doors' centroid the camera goes at the height of the glance (plan 025 D2 c). */
export const GLANCE_PULL = .55;
/** The share of `GLANCE_PULL` the camera is at, `age` seconds into a glance: eased out and back, 0 outside it. */
export const glanceWeight = (age: number) => age <= 0 || age >= GLANCE_SPAN ? 0 : Math.sin(Math.PI * age / GLANCE_SPAN) ** 2;
