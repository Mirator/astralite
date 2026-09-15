import * as THREE from 'three';

// Bounded, reusable hit accents. They never decide damage, block input, or advance combat time.
export function impactEffects(capacity = 12) {
  const group = new THREE.Group(), shape = new THREE.Shape();
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8, radius = i % 2 ? .11 : i % 4 ? .48 : 1;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    if (i) shape.lineTo(x, y); else shape.moveTo(x, y);
  }
  shape.closePath();
  const flashGeometry = new THREE.ShapeGeometry(shape), ringGeometry = new THREE.RingGeometry(.91, 1, 32);
  const slots = Array.from({ length: capacity }, () => {
    const material = new THREE.MeshBasicMaterial({ color: 0xffedbb, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const flash = new THREE.Mesh(flashGeometry, material), ring = new THREE.Mesh(ringGeometry, material.clone());
    ring.rotation.x = -Math.PI / 2; flash.visible = ring.visible = false; group.add(flash, ring);
    return { flash, ring, age: 1, heavy: false };
  });
  let cursor = 0;
  const clear = () => { slots.forEach(slot => { slot.age = 1; slot.flash.visible = slot.ring.visible = false; }); };
  return {
    group, clear,
    get active() { return slots.filter(slot => slot.age < .26).length; },
    emit(at: { x: number; y: number; z: number }, color = 0xffedbb, heavy = false) {
      const slot = slots[cursor++ % slots.length]; slot.age = 0; slot.heavy = heavy;
      slot.flash.position.set(at.x, at.y + .85, at.z); slot.flash.scale.setScalar(heavy ? .9 : .6);
      slot.flash.material.color.setHex(color); slot.flash.material.opacity = 1; slot.flash.visible = true;
      slot.ring.position.set(at.x, .045, at.z); slot.ring.scale.setScalar(.2); slot.ring.material.color.setHex(color); slot.ring.material.opacity = .5; slot.ring.visible = true;
    },
    update(dt: number, camera: THREE.Quaternion) {
      for (const slot of slots) {
        if (dt > 0 && Number.isFinite(dt)) slot.age += dt;
        const t = Math.min(1, slot.age / .26);
        slot.flash.quaternion.copy(camera); slot.flash.rotateZ(.32);
        slot.flash.visible = t < .6; slot.ring.visible = t < 1;
        slot.flash.scale.setScalar((slot.heavy ? .9 : .6) * (1 - t * .75));
        slot.flash.material.opacity = Math.max(0, 1 - t / .6);
        slot.ring.scale.setScalar(.18 + t * (slot.heavy ? 1.2 : .65)); slot.ring.material.opacity = (1 - t) ** 2 * .38;
      }
    },
    dispose() { flashGeometry.dispose(); ringGeometry.dispose(); slots.forEach(slot => { slot.flash.material.dispose(); slot.ring.material.dispose(); }); },
  };
}
