import * as THREE from 'three';

// Every character in the reference sits in a soft pool of its own; ours sat on top of the paving with
// nothing between the boots and the stone, which is why the knight reads as a sprite pasted over the
// floor in the dash strip. The moon already casts a real shadow, but it is long, offset by most of a
// tile and regularly thrown behind the near-side structure the verticality pass put in — it says where
// the light is, not where the feet are. This is the other half: a small dark pool directly under the
// figure, one draw call each.
//
// It multiplies the frame rather than veiling it in black, so the paving keeps its hue and a torch pool
// under a figure is dimmed instead of being punched out. Multiply takes its strength from the texel and
// not from `opacity`, so each strength is its own 32px gradient; there are two of them.
const shadowTextures = new Map<number, THREE.DataTexture>();
function shadowFalloff(strength: number) {
  const key = Math.round(strength * 100);
  let texture = shadowTextures.get(key);
  if (!texture) {
    const size = 32, mid = (size - 1) / 2, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      // Squared falloff twice over: solid under the boots, and nothing at the rim that reads as an edge.
      const t = Math.min(1, Math.hypot(x - mid, y - mid) / mid), k = (1 - t * t) ** 2;
      const v = Math.round(255 * (1 - strength * k)), i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
    texture = new THREE.DataTexture(data, size, size);
    // Declared sRGB so the decode on the way in and the encode on the way out cancel: the texel is the
    // multiplier, and 0.45 in the table is 0.45 on the floor.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true; shadowTextures.set(key, texture);
  }
  return texture;
}
const shadowDisc = new THREE.CircleGeometry(1, 24);
shadowDisc.rotateX(-Math.PI / 2);
shadowDisc.userData.shared = true;
// The moon sits at a fixed offset from whoever it is lighting, so its direction never changes and the
// pool can lean the same way in every room: down-light from (-7, 12, 9) puts the contact at +x, -z.
const SHADOW_LEAN = [.15, -.19];

/**
 * A grounding pool for one character. It is parented to the actor so it is culled and disposed with it,
 * but it refuses the actor's transform: the knight bobs, pitches into a dash and is thrown by hit-stop,
 * and a shadow that bobs with him is worse than none. `onBeforeRender` runs before the renderer builds
 * the model-view matrix, so writing the world matrix there pins the pool flat on the floor at the
 * actor's x and z whatever the actor is doing above it. The actor's scale is refused with the rest of
 * it — the warden is drawn at 1.3 and his pool is sized here instead — and the height is the floor's,
 * not the actor's, which holds for every room the generator can build because it lays standable cells
 * at one level only. A figure ever put on a ledge would need that y to come from under him.
 */
export function contactShadow(radius: number, strength: number) {
  const mesh = new THREE.Mesh(shadowDisc, new THREE.MeshBasicMaterial({
    // Opacity is always 1 here, so premultiplied is a formality — but three refuses MultiplyBlending
    // without it, loudly, on every program it compiles.
    map: shadowFalloff(strength), blending: THREE.MultiplyBlending, transparent: true,
    premultipliedAlpha: true, depthWrite: false, toneMapped: false,
  }));
  mesh.matrixAutoUpdate = mesh.matrixWorldAutoUpdate = false;
  mesh.frustumCulled = false; mesh.renderOrder = 3;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.onBeforeRender = () => {
    const parent = mesh.parent?.matrixWorld.elements;
    if (!parent) return;
    mesh.matrixWorld.set(
      radius, 0, 0, parent[12] + SHADOW_LEAN[0],
      0, 1, 0, .028,
      0, 0, radius, parent[14] + SHADOW_LEAN[1],
      0, 0, 0, 1,
    );
  };
  return mesh;
}
