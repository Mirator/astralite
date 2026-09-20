import * as THREE from 'three';

// What an effect does to the room it is standing in.
//
// A blind review of eight of our frames against eight of the reference named
// this as the sharpest single fault: "three fire telegraphs are flat black
// ellipses that float — no thickness, no light thrown onto the tiles they sit
// on — so the one dramatic element in the frame doesn't belong to the world."
// That is a bug rather than a preference. Every accent in the keep was a
// coloured decal: a ring drawn over the floor, brightening nothing, so the
// brightest thing in the frame was also the only thing casting nothing.
//
// Two answers here, and they are deliberately different in cost.
//
// `litDisc` is the free one. Every accent that lies flat already draws a disc,
// so the light it throws is painted in that same disc's fragment shader: one
// falloff term added to a draw call that was happening anyway. It is not a
// light — it cannot reach a wall or a shin — but it is what puts a warm pool on
// the paving directly under a burning grate, which is precisely the thing the
// review could not find.
//
// `borrowedLight` is the one that costs. A real point light reaches the stone,
// the grate's own rim and the bodies standing in it, and nothing painted on the
// floor can imitate that. The renderer's light budget is full — four torches, a
// moon, a hemisphere and the knight's own lantern — so this adds none: it takes
// the fourth torch, which is by construction the furthest of the four from the
// knight and the least of them in any frame, and lends it to whatever is
// happening. When nothing is, the torch has it back the same frame.

/**
 * The handles a lit disc exposes. All four are plain uniforms, so a frame that
 * changes them costs nothing but the write.
 */
export type Radiance = {
  /** Where the band sits: 0 at the centre of the disc, 1 at its rim. */
  edge: { value: number };
  /** Half the band's thickness, in the same units. */
  width: { value: number };
  /** How bright the band is. */
  band: { value: number };
  /** How much light the disc throws on the tiles under it. */
  pool: { value: number };
};

/**
 * Turns a flat disc — `RingGeometry(0, r)` or `CircleGeometry(r)`, both of which
 * lay their uv out over the bounding square — into a band plus the light that
 * band throws.
 *
 * The band is a distance field rather than a pair of radii, so it can be moved
 * and thinned by a uniform: a shockwave is then one mesh at a fixed size with a
 * travelling edge, rather than a mesh scaled up, which is what lets the pool
 * keep its own footprint while the ring inside it expands.
 *
 * `falloff` is the exponent on the pool. Higher keeps the light close to the
 * middle; the default is tuned for something about as wide as it is bright.
 */
export function litDisc(material: THREE.MeshBasicMaterial, key: string, falloff = 2.6): Radiance {
  const edge = { value: .5 }, width = { value: .1 }, band = { value: 1 }, pool = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rdEdge = edge; shader.uniforms.rdWidth = width;
    shader.uniforms.rdBand = band; shader.uniforms.rdPool = pool;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 rdUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nrdUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 rdUv;\nuniform float rdEdge;\nuniform float rdWidth;\nuniform float rdBand;\nuniform float rdPool;',
      )
      .replace('#include <color_fragment>', `#include <color_fragment>
    float rdR = length(rdUv * 2.0 - 1.0);
    float rdRing = 1.0 - smoothstep(0.0, max(1e-4, rdWidth), abs(rdR - rdEdge));
    // Reaches zero exactly at the disc's rim, so the light has no edge of its
    // own to give the quad away — which is the failure the old flat decal had.
    float rdSpill = pow(max(0.0, 1.0 - rdR), ${falloff.toFixed(2)});
    diffuseColor.a *= clamp(rdRing * rdBand + rdSpill * rdPool, 0.0, 1.0);
  `);
  };
  material.customProgramCacheKey = () => key;
  return { edge, width, band, pool };
}

/** What an event offers for the lamp, once it has beaten everything else. */
type Offer = { at: THREE.Vector3; colour: THREE.Color; intensity: number };

/**
 * One point light, lent out by the frame.
 *
 * Events bid during the update; the loudest bid wins the lamp for that frame
 * and every other bid is dropped. There is no crossfade and there should not
 * be: the things that bid are a grate catching fire and a blade landing, both
 * of which are meant to arrive on one frame, and the torch the lamp belongs to
 * is the fourth-nearest in the room — far enough that taking it away for the
 * eleven frames a flare lasts is not a change anyone can point at.
 *
 * `strength` is not intensity. It is what the bid is worth on screen, which is
 * intensity discounted by how far the event is from the knight, because the
 * camera is locked to him and a flare two rooms away is not in the frame.
 */
export function borrowedLight(light: THREE.PointLight, homeColour: number) {
  const offer: Offer = { at: new THREE.Vector3(), colour: new THREE.Color(), intensity: 0 };
  const home = new THREE.Color(homeColour);
  let best = 0, lent = false;
  return {
    /** True if the last `settle` gave the lamp to an event rather than the torch. */
    get lent() { return lent; },
    /**
     * The colour the lamp burns when nothing has borrowed it. Live, because what burns in a chamber is
     * the chamber's: copy the mood's fire into it and the sconce this lamp goes back to matches the
     * three it was never lent from.
     */
    home,
    /**
     * Offer the lamp to something happening at `at`. `near` is the distance from
     * the knight, which is what decides the contest when two things happen at
     * once; pass 0 for anything on top of him.
     */
    bid(at: THREE.Vector3, near: number, intensity: number, colour: number) {
      const strength = intensity / (1 + near * .18);
      if (!(strength > best)) return;
      best = strength; offer.at.copy(at); offer.intensity = intensity; offer.colour.setHex(colour);
    },
    /**
     * Hang the lamp for this frame: on the winning bid, or back on the torch at
     * `at` burning at `intensity`. Called once, after every bid is in.
     */
    settle(at: THREE.Vector3 | undefined, intensity: number) {
      lent = best > 0;
      if (lent) { light.position.copy(offer.at); light.color.copy(offer.colour); light.intensity = offer.intensity; }
      else { if (at) light.position.copy(at); light.color.copy(home); light.intensity = intensity; }
      best = 0;
    },
  };
}
