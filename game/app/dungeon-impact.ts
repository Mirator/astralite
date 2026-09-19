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
const radial = (shader: { vertexShader: string; fragmentShader: string }, body: string) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 hitUv;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nhitUv = uv;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 hitUv;')
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
 * The cut, as a shape. A soft annulus opened on the side the knight swung
 * towards, lying flat on the ground so the isometric view reads it as the
 * ellipse a real swing traces rather than as a disc facing the camera.
 */
const arcMaterial = () => {
  const material = new THREE.MeshBasicMaterial({ color: 0xffdca8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => radial(shader, `
    vec2 hitP = hitUv * 2.0 - 1.0;
    float hitR = length(hitP);
    float band = smoothstep(.52, .81, hitR) * (1.0 - smoothstep(.81, 1.0, hitR));
    // Open towards local +y, which the mesh's own spin points down the cut.
    float wedge = smoothstep(-.7, .35, hitP.y);
    float rim = smoothstep(.64, .82, hitR);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.52, 1.52, 1.42), rim * .65);
    diffuseColor.a *= band * wedge;
  `);
  material.customProgramCacheKey = () => 'hit-arc-v1';
  return material;
};

/**
 * Seconds a shockwave lives, a crescent lives, and — much the shortest — a
 * bloom lives. The bloom is the one accent that sits on top of a body rather
 * than beside it, so it is the one that has to be gone before the eye starts
 * reading the follow-through.
 */
const HIT_LIFE = .26, ARC_LIFE = .18, FLASH_LIFE = .11;
/**
 * How bright the crescent is allowed to get. The knight is pale armour and the
 * arc is drawn around him additively, so a crescent at full opacity buries the
 * body it belongs to — which is a louder hit and a worse frame.
 */
const ARC_PEAK = .7;
/**
 * And the same argument, harder, for the bloom, which is emitted on the body
 * rather than on the knight. At .8 over an already-lit skeleton it clipped: a
 * measurement of the struck body counted ~940 pixels above luminance 245 on
 * every frame of the hit, flat to within one per cent, with the skull reduced to
 * a featureless lozenge. The accent has to mark the body, not delete it.
 */
const FLASH_PEAK = .24;

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
    const mesh = new THREE.Mesh(arcGeometry, arcMaterial());
    mesh.rotation.x = -Math.PI / 2; mesh.visible = false; mesh.renderOrder = 3; group.add(mesh);
    return { mesh, age: 1, span: 1 };
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
      slot.mesh.material.opacity = ARC_PEAK; slot.mesh.visible = true;
    },
    emit(at: { x: number; y: number; z: number }, color = 0xffedbb, heavy = false) {
      const slot = slots[cursor++ % slots.length]; slot.age = 0; slot.heavy = heavy;
      // .55 rather than .85: the blade lands on the chest, and a bloom centred a
      // head higher put its own brightest point squarely on the skull, which is
      // the one part of a skeleton with any detail left to lose at this size.
      slot.flash.position.set(at.x, at.y + .55, at.z); slot.flash.scale.setScalar(heavy ? 1.9 : 1.35);
      slot.flash.material.color.setHex(color); slot.flash.material.opacity = FLASH_PEAK; slot.flash.visible = true;
      slot.ring.position.set(at.x, .045, at.z); slot.ring.scale.setScalar(.2); slot.ring.material.color.setHex(color); slot.ring.material.opacity = .5; slot.ring.visible = true;
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
        slot.ring.scale.setScalar(.18 + t * (slot.heavy ? 1.6 : .95)); slot.ring.material.opacity = (1 - t) ** 2 * .42;
      }
      for (const slot of arcs) {
        slot.age += step;
        const t = Math.min(1, slot.age / ARC_LIFE);
        slot.mesh.visible = t < 1;
        // Barely grows. A crescent that expanded would read as a shockwave
        // leaving the knight; this one is the path the blade took through the
        // body, and it stays where it cut.
        slot.mesh.scale.setScalar(slot.span * (.86 + t * .14));
        slot.mesh.material.opacity = ARC_PEAK * (1 - t) ** 1.5;
      }
    },
    dispose() {
      flashGeometry.dispose(); ringGeometry.dispose(); arcGeometry.dispose();
      slots.forEach(slot => { slot.flash.material.dispose(); slot.ring.material.dispose(); });
      arcs.forEach(arc => arc.mesh.material.dispose());
    },
  };
}
