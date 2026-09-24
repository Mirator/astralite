// Plan 014 round 6 (lever 1): the flame itself, replacing the hard-edged low-poly solids in
// `dungeon-flame.ts` - those read, correctly, as "flat low-poly octagon/cone blobs of solid colour"
// once the rest of the scene had real texture and lighting to be compared against. A flame is not a
// solid; it is a soft, teardrop-shaped, scrolling-noise glow, and the only way to draw that cheaply
// is a few camera-ish-facing quads with a shader, not a mesh with faces.
//
// The camera in this game is fixed - it never orbits - so a true per-frame billboard (recomputing an
// orientation from the camera's basis every frame) buys nothing a *fixed* orientation chosen to face
// that one camera does not already give for free. Three quads, crossed at 0 deg and +-55 deg around
// the vertical axis, read as a flame with real volume from the one angle this game is ever seen from,
// the same trick 2D-sprite foliage has used since isometric games had trees.
import * as THREE from 'three';

const FLAME_NOISE = `
  float fxHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float fxNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), f.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

/** One quad, pivoted at its own bottom edge (not its centre) so it stands up out of a bowl rather
 * than needing a caller to re-offset it. Shared and never disposed - see `keep()` elsewhere in this
 * codebase's prop geometries for the same convention. */
let sharedQuad: THREE.PlaneGeometry | null = null;
/** How far toward the camera, in world units, the cards are pushed for the depth test - enough to
 * clear a brazier bowl's near rim, well short of a wall's thickness. */
const NUDGE = 0.6;
const flameQuad = () => (sharedQuad ??= (() => {
  const g = new THREE.PlaneGeometry(1, 1, 1, 1).translate(0, 0.5, 0);
  g.userData.shared = true;
  return g;
})());

export type FlameHandle = {
  group: THREE.Group;
  /** Called once a frame with the world clock and this source's own phase; drives flicker and the
   * whole thing's own bob/sway (kept subtle - the shader carries most of the "alive" read now). */
  update(t: number, colour: THREE.Color): void;
  dispose(): void;
};

/**
 * `width`/`height` are the flame's own rest footprint (the geometry solids in `dungeon-flame.ts`
 * carried per-theme envelopes; this keeps the same idea in two numbers instead of six vertices).
 * `seed` desyncs one brazier's flicker from its neighbour's, the same job `phase` did before.
 */
export function makeFlameBillboard(width: number, height: number, seed: number): FlameHandle {
  // Plan 014 round A: `group` is the caller's to place; the flicker bob/breathe below moves `body`, a
  // child of it. It used to write `group.position.y = bob` straight onto the caller's own group, which
  // threw away the height every caller had just set - every brazier, sconce and lantern flame in the
  // keep was being drawn at floor level (y ~ 0), under its own bowl or at the foot of its pillar,
  // which is most of what read as a pale "mushroom" cap with a smear of fire beneath it.
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  const quad = flameQuad();
  const materials: THREE.ShaderMaterial[] = [];
  const angles = [0, 55, -55];
  for (let i = 0; i < angles.length; i++) {
    const material = new THREE.ShaderMaterial({
      // depthTest was briefly off (plan 014 round 6) because the bowl and rim, at the same (x, z),
      // could read closer to the camera than the crossed cards and swallow the flame. That fixed the
      // bowl but let every flame draw through walls too - a sconce behind a wall or just off the
      // frame edge still painted, and at these HDR values bloom spread it into a frame-corner wash.
      // Depth test is back on; instead the vertex shader nudges the cards `NUDGE` world units toward
      // the camera in view space. Under this game's fixed orthographic camera that moves nothing on
      // screen, but it clears the flame's own bowl while a wall between flame and camera still wins.
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uColour: { value: new THREE.Color(0xffffff) },
        uSeed: { value: seed + i * 13.7 },
        // A touch narrower and hotter on the pass facing the camera dead-on than the two crossed
        // behind it, so the silhouette does not look like three identical cards fanned open.
        uWidth: { value: i === 0 ? 1 : 0.86 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          mv.z += ${NUDGE.toFixed(2)};
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime; uniform vec3 uColour; uniform float uSeed; uniform float uWidth;
        ${FLAME_NOISE}
        void main() {
          // Plan 014 round A: rebuilt so it reads as fire rather than a smooth glowing cone. The body
          // sways (a height-weighted noise offset on x), and a climbing noise field erodes it against
          // a threshold that rises with height, so the upper half tears into separate tongues and
          // licks. Three cards overlap additively, so each one is dim on its own: a saturated body
          // in the theme's own colour, a hotter core only low and central, darker tips.
          float sway = (fxNoise(vec2(vUv.y * 2.2 - uTime * 1.7, uSeed)) - 0.5) * 0.34 * vUv.y;
          float dx = abs(vUv.x - 0.5 - sway) / uWidth;
          float taper = mix(0.44, 0.05, pow(vUv.y, 0.85));
          float body = smoothstep(taper, taper * 0.35, dx) * smoothstep(0.0, 0.08, vUv.y);
          vec2 nuv = vec2(vUv.x * 4.2, vUv.y * 3.2 - uTime * 3.1 + uSeed * 9.0);
          float n = fxNoise(nuv) * 0.6 + fxNoise(nuv * 2.1 + 11.0) * 0.4;
          float erode = smoothstep(vUv.y * 0.9 - 0.12, vUv.y * 0.9 + 0.1, n * body + (1.0 - vUv.y) * 0.32);
          float alpha = clamp(body * erode * 1.3, 0.0, 1.0);
          float coreAmt = smoothstep(0.24, 0.0, dx) * smoothstep(0.55, 0.04, vUv.y);
          vec3 core = mix(uColour, vec3(1.0, .9, .7), .5) * 1.7;
          vec3 colour = mix(uColour * 1.05, core, coreAmt) * mix(1.0, 0.6, smoothstep(0.45, 1.0, vUv.y));
          gl_FragColor = vec4(colour * (0.24 + alpha * 0.32), alpha);
        }
      `,
    });
    material.customProgramCacheKey = () => 'flame-billboard-v4';
    const mesh = new THREE.Mesh(quad, material);
    mesh.rotation.y = angles[i] * Math.PI / 180;
    mesh.scale.set(width, height, 1);
    mesh.renderOrder = 4;
    mesh.castShadow = false; mesh.receiveShadow = false;
    body.add(mesh);
    materials.push(material);
  }
  return {
    group,
    update(t, colour) {
      // A little bob and a little width breathing, both driven straight off the clock rather than
      // per-instance state - subtle, because unlike the old geometry the shader itself is already
      // doing almost all of the "this is alive" work.
      const bob = Math.sin(t * 3.1 + seed * 5.2) * 0.03;
      body.position.y = bob;
      const breathe = 1 + Math.sin(t * 2.2 + seed * 3.7) * 0.05;
      body.scale.set(breathe, 1 + Math.sin(t * 1.7 + seed * 4.1) * 0.06, breathe);
      for (const material of materials) {
        (material.uniforms.uTime.value as number) = t;
        (material.uniforms.uColour.value as THREE.Color).copy(colour);
      }
    },
    dispose() { materials.forEach(m => m.dispose()); },
  };
}
