import * as THREE from 'three';

// Bounded, reusable hit accents. They never decide damage, block input, or advance combat time.
//
// Three shapes, each a single quad or a thin ring rather than a silhouette: a
// soft bloom where the blade bit, a shockwave on the floor under it, and — the
// loudest of the three — a crescent laid flat around the knight along the path
// the cut swept. The crescent is what tells a player which frame was contact. It
// arrives whole on the frame the blow scores, rather than being accumulated a
// sample at a time the way a trail is, and the hit-stop then holds it there.
//
// Everything is drawn with a radial falloff in the fragment shader, which is why
// the sixteen-point star this used to open with could go: fourteen triangles of
// spikes read smaller on screen than two triangles of soft light and cost seven
// times as much.

/** Installs the `hitUv` varying both accent shaders read, and their body. */
const radial = (shader: { vertexShader: string; fragmentShader: string }, body: string, head = '') => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 hitUv;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nhitUv = uv;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec2 hitUv;\n${head}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${body}`);
};

/** A round bloom: white at the middle, feathered to nothing at the rim. */
const flashMaterial = (color: number) => {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => radial(shader, `
    float hitR = length(hitUv * 2.0 - 1.0);
    float core = 1.0 - smoothstep(0.0, .36, hitR);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.06, 1.07, 1.0), core * .5);
    diffuseColor.a *= pow(max(0.0, 1.0 - hitR), 2.1);
  `);
  material.customProgramCacheKey = () => 'hit-flash-v1';
  return material;
};

/**
 * The cut, as a shape: an annulus lying flat on the ground so the isometric view
 * reads it as the ellipse a real swing traces rather than as a disc facing the
 * camera, with only a short stretch of that annulus lit at a time.
 *
 * What this replaced was a wedge — the whole forward half of the ring, opened at
 * a constant brightness and held there while it faded. Measured, it was 73% of
 * every blown pixel on the struck body: at the knight's stance the ring's far
 * rim projects, in this camera, exactly onto the chest and skull of whatever he
 * just hit, and a body deleted by its own hit marker is a worse frame however
 * loud it is. Dimming it was the obvious answer and it costs the blow.
 *
 * So the rim is moved instead of dimmed. `hitSweep` runs 0 to 1 over the
 * crescent's life and carries a bright head round the ring with a long tail
 * behind it, which is both narrower — a sixth of the ring rather than two thirds
 * — and, being *somewhere* rather than everywhere, reads as an edge passing
 * through instead of a wash sitting on top. The band is a line now, not a
 * plateau, for the same reason.
 */
const arcMaterial = () => {
  const sweep = { value: 0 };
  const material = new THREE.MeshBasicMaterial({ color: 0xffdca8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.hitSweep = sweep;
    radial(shader, `
    vec2 hitP = hitUv * 2.0 - 1.0;
    float hitR = length(hitP);
    // Measured off local +y, which the mesh's own spin points down the cut.
    float hitA = atan(hitP.x, hitP.y);
    // The head travels towards -x, which is the way the blade itself goes:
    // local +yaw turns forward -Z toward -X, so the follow-through is the
    // negative side. It starts a little past the line of the blow, so the frame
    // that blow lands on has the edge already leaving rather than arriving.
    float lead = mix(-.38, -1.90, hitSweep);
    float off = lead - hitA;
    // Hard in front of the head, long behind it: an edge, and what it dragged.
    float along = (1.0 - smoothstep(0.0, .22, off)) * (1.0 - smoothstep(0.0, 1.35, -off));
    float band = smoothstep(.49, .60, hitR) * (1.0 - smoothstep(.86, 1.0, hitR));
    float rim = smoothstep(.62, .71, hitR) * (1.0 - smoothstep(.76, .88, hitR));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.52, 1.52, 1.42), rim * along * .75);
    diffuseColor.a *= band * along;
  `, 'uniform float hitSweep;');
  };
  material.customProgramCacheKey = () => 'hit-arc-v2';
  return { material, sweep };
};

/**
 * Seconds a shockwave lives, a crescent lives, and — much the shortest — a
 * bloom lives. The bloom is the one accent that sits on top of a body rather
 * than beside it, so it is the one that has to be gone before the eye starts
 * reading the follow-through.
 */
const HIT_LIFE = .26, ARC_LIFE = .18, FLASH_LIFE = .11;
/**
 * How bright the crescent is allowed to get. It was held at .7 while the arc was
 * a wedge covering two thirds of the ring, because anything brighter buried the
 * body it belonged to. A sixth of the ring lit can carry half as much again and
 * still leave the struck body legible: measured on the software rasteriser, the
 * pixels above 245 on the struck skeleton went from 622 on the contact frame to
 * 413 across this change, and the decay behind it got steeper rather than
 * flatter — 248, 191, 145 against 500, 300, 165.
 */
const ARC_PEAK = 1.05;
/**
 * And the opposite argument for the bloom, which is emitted on the body rather
 * than beside it. At .8 over an already-lit skeleton it clipped flat and took
 * the skull with it, which is why it was cut to .24; with the crescent off the
 * body there is room to put a third of that back, and the blow needs something
 * at the bite point that the crescent no longer covers.
 */
const FLASH_PEAK = .34;

export function impactEffects(capacity = 12) {
  const group = new THREE.Group();
  const flashGeometry = new THREE.PlaneGeometry(1, 1), ringGeometry = new THREE.RingGeometry(.78, 1, 28);
  const arcGeometry = new THREE.PlaneGeometry(1, 1);
  const slots = Array.from({ length: capacity }, () => {
    const flash = new THREE.Mesh(flashGeometry, flashMaterial(0xffedbb));
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: 0xffedbb, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; flash.visible = ring.visible = false; group.add(flash, ring);
    return { flash, ring, age: 1, heavy: false };
  });
  // Two crescents, not twelve: a swing that takes three bodies is still one cut,
  // so the arc is emitted once per swing rather than once per body it found.
  const arcs = Array.from({ length: 2 }, () => {
    const { material, sweep } = arcMaterial();
    const mesh = new THREE.Mesh(arcGeometry, material);
    mesh.rotation.x = -Math.PI / 2; mesh.visible = false; mesh.renderOrder = 3; group.add(mesh);
    return { mesh, sweep, age: 1, span: 1 };
  });
  let cursor = 0, arcCursor = 0;
  const clear = () => {
    slots.forEach(slot => { slot.age = 1; slot.flash.visible = slot.ring.visible = false; });
    arcs.forEach(arc => { arc.age = 1; arc.mesh.visible = false; });
  };
  return {
    group, clear,
    get active() { return slots.filter(slot => slot.age < HIT_LIFE).length; },
    /**
     * Lay the crescent of one cut around `at`, turned so it opens along `yaw` —
     * the angle the knight's own body already carries, so the facing is not
     * derived twice. `reach` is the weapon's, so a spear draws a longer arc than
     * a pair of fangs without anybody passing a second number.
     */
    arc(at: { x: number; z: number }, yaw: number, reach: number) {
      const slot = arcs[arcCursor++ % arcs.length]; slot.age = 0;
      // The band peaks a little inside the quad's edge, so the quad is the outer
      // radius with that headroom added back on.
      slot.span = Math.max(1.1, reach + .25) * 2.35;
      slot.mesh.position.set(at.x, .62, at.z);
      slot.mesh.rotation.z = yaw;
      slot.mesh.scale.setScalar(slot.span * .86);
      slot.sweep.value = 0;
      slot.mesh.material.opacity = ARC_PEAK; slot.mesh.visible = true;
    },
    emit(at: { x: number; y: number; z: number }, color = 0xffedbb, heavy = false) {
      const slot = slots[cursor++ % slots.length]; slot.age = 0; slot.heavy = heavy;
      // .55 rather than .85: the blade lands on the chest, and a bloom centred a
      // head higher put its own brightest point squarely on the skull, which is
      // the one part of a skeleton with any detail left to lose at this size.
      slot.flash.position.set(at.x, at.y + .55, at.z); slot.flash.scale.setScalar(heavy ? 1.9 : 1.35);
      slot.flash.material.color.setHex(color); slot.flash.material.opacity = FLASH_PEAK; slot.flash.visible = true;
      slot.ring.position.set(at.x, .045, at.z); slot.ring.scale.setScalar(.2); slot.ring.material.color.setHex(color); slot.ring.material.opacity = .78; slot.ring.visible = true;
    },
    /**
     * `dt` here is wall-clock and deliberately not the simulation's: hit-stop
     * freezes the world, and an accent aged on the frozen clock holds at full
     * strength for exactly as long as the freeze lasts. That is what turned a
     * longer hit-stop into a longer plateau rather than a longer decay, and it
     * left the loudest thing on screen still at peak when the follow-through
     * began. A paused game passes zero and everything holds, which is what pause
     * is for; a frozen one does not.
     */
    update(dt: number, camera: THREE.Quaternion) {
      const step = dt > 0 && Number.isFinite(dt) ? dt : 0;
      for (const slot of slots) {
        slot.age += step;
        const t = Math.min(1, slot.age / HIT_LIFE);
        // A spike, not a plateau: full on the frame the blow lands, a quarter of
        // that three frames later, out by seven. The exponent is what puts the
        // fall in the first three frames instead of spreading it evenly.
        const flash = Math.max(0, 1 - slot.age / FLASH_LIFE);
        slot.flash.quaternion.copy(camera);
        slot.flash.visible = flash > 0; slot.ring.visible = t < 1;
        slot.flash.scale.setScalar((slot.heavy ? 1.9 : 1.35) * (.55 + flash * .45));
        slot.flash.material.opacity = FLASH_PEAK * flash ** 2.2;
        slot.ring.scale.setScalar(.18 + t * (slot.heavy ? 2.1 : 1.35)); slot.ring.material.opacity = (1 - t) ** 2 * .66;
      }
      for (const slot of arcs) {
        slot.age += step;
        const t = Math.min(1, slot.age / ARC_LIFE);
        slot.mesh.visible = t < 1;
        // Barely grows. A crescent that expanded would read as a shockwave
        // leaving the knight; this one is the path the blade took through the
        // body, and it stays where it cut. What moves instead is the lit part of
        // it, which is the whole point of the sweep.
        slot.mesh.scale.setScalar(slot.span * (.86 + t * .14));
        slot.sweep.value = t;
        slot.mesh.material.opacity = ARC_PEAK * (1 - t) ** 2.2;
      }
    },
    dispose() {
      flashGeometry.dispose(); ringGeometry.dispose(); arcGeometry.dispose();
      slots.forEach(slot => { slot.flash.material.dispose(); slot.ring.material.dispose(); });
      arcs.forEach(arc => arc.mesh.material.dispose());
    },
  };
}
