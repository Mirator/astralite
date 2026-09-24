// Plan 014 round 2 (lever B5): persistent blood-splat decals on the floor where a blow lands.
//
// Pooled like every other bounded effect in the keep (`dungeon-impact.ts`, `dungeon-footsteps.ts`):
// a fixed number of flat, alpha-mapped planes lying on the paving, cycled round-robin so the floor
// never grows a mesh per hit. Unlike a spark or a flash, a splat does not fade - it is meant to
// persist for the run of the room, the way a real fight leaves a mark - so the only thing this module
// animates is which pool slot a fresh hit claims and where it lands.
import * as THREE from 'three';

/** One splat shape, baked once: an irregular dark-red pool with a few flung droplets around it. */
function bloodTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  let seed = 4271;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const blot = (x: number, y: number, r: number, alpha: number) => {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(140,12,16,${alpha})`); grad.addColorStop(.55, `rgba(110,8,12,${alpha * .85})`); grad.addColorStop(1, 'rgba(70,4,6,0)');
    ctx.fillStyle = grad;
    ctx.save(); ctx.translate(x, y); ctx.scale(1, .6 + random() * .3); ctx.translate(-x, -y);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  };
  // The main pool, off-centre so the splat has a direction rather than sitting dead in the middle.
  blot(58, 68, 40, .85);
  blot(78, 60, 22, .7);
  // Flung droplets: small, scattered, fading out toward the texture's own edge.
  for (let i = 0; i < 10; i++) {
    const a = random() * Math.PI * 2, d = 30 + random() * 46;
    blot(64 + Math.cos(a) * d, 64 + Math.sin(a) * d * .7, 3 + random() * 7, .5 + random() * .3);
  }
  return new THREE.CanvasTexture(canvas);
}

export function bloodDecals(capacity = 18) {
  const texture = bloodTexture();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const group = new THREE.Group();
  const slots = Array.from({ length: capacity }, () => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; mesh.visible = false; mesh.renderOrder = 1;
    group.add(mesh);
    return mesh;
  });
  let cursor = 0;
  return {
    group,
    /** Claim the next pool slot and lay a splat at `at`, sized and turned so no two look stamped. */
    spawn(at: { x: number; z: number }, scale = 1) {
      const mesh = slots[cursor++ % slots.length];
      mesh.position.set(at.x, .028, at.z);
      mesh.rotation.z = Math.random() * Math.PI * 2;
      const s = (1.1 + Math.random() * .8) * scale;
      mesh.scale.set(s, s, 1);
      mesh.visible = true;
    },
    /** Every splat this floor grew, gone - called when a floor is torn down for the next one. */
    clear() { for (const mesh of slots) mesh.visible = false; },
    dispose() { geometry.dispose(); material.dispose(); texture.dispose(); },
  };
}
