// Where the knight is pointing, as opposed to where he is walking.
//
// Until now those were the same quantity: the swing took its direction from the movement input on the
// frame it started, so aim was whatever eight screen directions the keys could express. That is a
// 22.5-degree worst case, which the Tideblade's arc absorbs and the Keep Crossbow's does not — a bolt
// carries 11.8 units of range and a 0.62 contact radius, so a worst-aligned body was only ever struck
// out to 0.62/tan(22.5deg), about 1.5 of those units. The other 10 were decoration.
//
// Two ways out, and the keep now has both. A pointer names a place on the ground and the knight faces
// it, which is exact. A key or a stick names one of eight directions and `snapAim` closes the gap to
// whatever body is nearly in front of him, which is approximate on purpose.
//
// Pure, like `dungeon-combat` and `dungeon-floor`: no React, no DOM, no three.js, so node executes it
// directly and the tests exercise the same arithmetic the game does rather than a copy of it.

export type Ground = { x: number; z: number };
export type Triple = { x: number; y: number; z: number };

/**
 * The camera, as the only two numbers anything outside the renderer needs: where it stands relative to
 * what it is looking at. Everything else here is derived from it.
 */
export const CAMERA_OFFSET: Triple = { x: 9.2, y: 12.5, z: 11.5 };

const flat = (x: number, z: number): Ground => { const m = Math.hypot(x, z) || 1; return { x: x / m, z: z / m }; };

/**
 * Screen right and screen down, on the ground. Movement is expressed in these so that pressing D walks
 * the knight rightwards across the picture rather than along some world axis the player cannot see.
 * They are the horizontal part of the camera's own basis and are derived from CAMERA_OFFSET rather
 * than written down twice, which is what lets `groundPoint` promise that a pointer and a key steer in
 * the same world.
 */
export const SCREEN_RIGHT = flat(CAMERA_OFFSET.z, -CAMERA_OFFSET.x);
export const SCREEN_DOWN = flat(CAMERA_OFFSET.x, CAMERA_OFFSET.z);

/** The eight directions a keyboard can name, as the nearest one to `to`. */
export const eightWay = (to: Ground): Ground => {
  const sx = to.x * SCREEN_RIGHT.x + to.z * SCREEN_RIGHT.z;
  const sz = to.x * SCREEN_DOWN.x + to.z * SCREEN_DOWN.z;
  if (!sx && !sz) return to;
  const step = Math.round(Math.atan2(sz, sx) / (Math.PI / 4)) * (Math.PI / 4);
  const cx = Math.cos(step), cz = Math.sin(step);
  return flat(cx * SCREEN_RIGHT.x + cz * SCREEN_DOWN.x, cx * SCREEN_RIGHT.z + cz * SCREEN_DOWN.z);
};

const unit3 = (v: Triple): Triple => {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
};

/**
 * The world point on the ground under a screen position, for the keep's **orthographic** camera.
 *
 * Orthographic is what makes this exact rather than a raycast: every screen point sends a ray in the
 * same direction, so the whole map is affine and inverts in closed form. `ndcX` and `ndcY` are the
 * usual -1..1 with +y up the screen; `span` and `aspect` are the frustum the game rebuilds on resize;
 * `focus` is what the camera is looking at and `offset` is the fixed vector from that focus to the
 * camera itself.
 *
 * The basis is derived from `offset` rather than written down, and reproduces three.js's own lookAt:
 * z away from the target, x across it, y the cross of the two. That matters because the game's
 * movement basis is written down — `screenRight` and `screenDown` are literals in the game loop — and
 * the two must agree exactly or a pointer and a key would steer in subtly different worlds. The test
 * asserts they do.
 */
export function groundPoint(
  ndcX: number,
  ndcY: number,
  span: number,
  aspect: number,
  focus: Ground,
  offset: Triple,
  groundY = 0,
): Ground {
  const away = unit3(offset);
  // cross((0,1,0), away), which has no y component for any camera that is not directly overhead.
  const across = unit3({ x: away.z, y: 0, z: -away.x });
  const up = {
    x: away.y * across.z - away.z * across.y,
    y: away.z * across.x - away.x * across.z,
    z: away.x * across.y - away.y * across.x,
  };
  const wide = span * aspect;
  const px = focus.x + offset.x + ndcX * wide * across.x + ndcY * span * up.x;
  const py = offset.y + ndcX * wide * across.y + ndcY * span * up.y;
  const pz = focus.z + offset.z + ndcX * wide * across.z + ndcY * span * up.z;
  // The camera looks along -away, so falling to the ground plane costs this much of it. A camera
  // pointed at the horizon would divide by zero; this one is pinned at 12.5 over 14.7 of floor.
  const drop = away.y ? (py - groundY) / away.y : 0;
  return { x: px - drop * away.x, z: pz - drop * away.z };
}

/**
 * Where to face to point at a screen position: the normalised ground direction from `from` to the
 * point under the cursor, or null when the cursor is on the knight himself and there is no direction
 * to be had. A null means "keep whatever facing you had" rather than "face east".
 */
export function groundAim(
  ndcX: number,
  ndcY: number,
  span: number,
  aspect: number,
  focus: Ground,
  offset: Triple,
  from: Ground,
  groundY = 0,
): Ground | null {
  const at = groundPoint(ndcX, ndcY, span, aspect, focus, offset, groundY);
  const dx = at.x - from.x, dz = at.z - from.z;
  const span2 = Math.hypot(dx, dz);
  // A shade off zero rather than zero: a cursor resting on the knight jitters by fractions of a unit
  // and would otherwise hand the swing a new direction every frame.
  return span2 < 0.15 ? null : { x: dx / span2, z: dz / span2 };
}

/**
 * How far off a body may be and still be taken as the intended target, in radians. Wide enough to
 * cover the 22.5 degrees eight directions can be wrong by, with enough left over that a body one step
 * to the side still counts.
 */
export const SNAP_ANGLE = 35 * Math.PI / 180;

/**
 * Close the gap between the eight directions a key can name and where a body actually stands.
 *
 * Only ever called at the moment a swing starts, never per frame: a snap that ran continuously would
 * turn the knight toward whatever he walked past, and walking would feel magnetic. Callers pass only
 * bodies a blow could actually reach — living, and with a clear lane — so this stays free of floor
 * geometry and is the same arithmetic whether a pad, a key or a test asked.
 *
 * Deliberately not applied to a pointer. Someone aiming with a mouse has already said where they mean,
 * and correcting them is worse than missing.
 */
export function snapAim(
  facing: Ground,
  bodies: readonly Ground[],
  from: Ground,
  reach: number,
  maxAngle = SNAP_ANGLE,
): Ground {
  const limit = Math.cos(Math.min(Math.PI, Math.max(0, maxAngle)));
  let best: Ground | null = null, bestDot = limit;
  for (const body of bodies) {
    const dx = body.x - from.x, dz = body.z - from.z;
    const distance = Math.hypot(dx, dz);
    // A body standing exactly on the knight has no direction to snap to, and one out of reach is not
    // what the swing was for.
    if (!distance || distance > reach) continue;
    const dot = (dx / distance) * facing.x + (dz / distance) * facing.z;
    // Strictly greater, so the first of two equally-placed bodies wins rather than the last. Which one
    // hardly matters; that it is the same one every time does.
    if (dot > bestDot) { bestDot = dot; best = { x: dx / distance, z: dz / distance }; }
  }
  return best ?? facing;
}

/** How much further than a swing's own reach a body may stand and still pull the aim onto itself. */
export const SNAP_REACH = 1.3;
