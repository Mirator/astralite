import * as THREE from 'three';
import { ROOM_MOOD } from './dungeon-art';
import { cellKey, TILE, type generateFloor } from './dungeon-floor';
import { stoneMood, tideMood } from './dungeon-motion';

type Floor = ReturnType<typeof generateFloor>;
export type Theme = keyof typeof ROOM_MOOD;

/**
 * Every room in the keep was lit by these same lamps under this same fog, so a theme could only ever
 * differ from its neighbours by the base colour of its paving — and the moss tint in the stone shader
 * pulled even that back toward one drowned green. Eight frames, one colour. The reference does the
 * opposite: an area commits to a hue family and leaves a single saturated thing to carry against it.
 *
 * So the key, the sky and ground bounce, the fog, the backdrop, the environment weight and the four tints
 * the stone weathers with all read `ROOM_MOOD` for the chamber the knight is standing in. Crossing a
 * threshold slides them over about a third of a second, which is slow enough to read as walking into
 * somewhere else and fast enough to have finished before he is through the door. The first frame of a
 * floor snaps rather than sliding, so a descent never fades in.
 */
export const createMood = (lights: {
  scene: THREE.Scene;
  moon: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
  /** Every lamp in the keep, including the one that gets lent out. */
  torches: THREE.PointLight[];
  /** The borrowed light's home colour, which has to follow the torches it returns to. */
  emberHome: THREE.Color;
}) => {
  const { scene, moon, hemisphere, torches, emberHome } = lights;
  const key = new THREE.Color(), sky = new THREE.Color(), ground = new THREE.Color();
  const fog = new THREE.Color(), back = new THREE.Color(), to = new THREE.Color();
  // What burns here, and the one accent hung on cloth. These two cross the threshold with the lights
  // rather than with the stone, because a brazier three rooms back is the thing that says which way
  // the knight has come from.
  const fire = new THREE.Color(), banner = new THREE.Color(), masonry = new THREE.Color(), bed = new THREE.Color();
  const numbers = { key: 0, hemisphere: 0, fog: 0, environment: 0 };
  const torchTint = new THREE.Color(), torchWarm = new THREE.Color(0xff9a4a);
  let lastFloor: Floor | null = null, cell = '', theme: Theme = 'keep', snap = true;
  const mixTo = (v: THREE.Vector3, target: readonly [number, number, number], k: number) =>
    v.set(v.x + (target[0] - v.x) * k, v.y + (target[1] - v.y) * k, v.z + (target[2] - v.z) * k);
  const mood = {
    fire, banner, masonry, bed, key, fog,
    get theme() { return theme; },
    /** The next move lands at once rather than sliding: arriving somewhere by fixture is not a walk. */
    snap() { cell = ''; snap = true; },
    /** Slides every light toward the chamber at (x, z) by `rate`, or all the way on a snap. */
    move(rate: number, floor: Floor, x: number, z: number) {
      // A corridor belongs to whichever chamber it is nearest. Without that the hue would change on
      // the doorway rather than on the approach, which is the one place the change would be visible
      // as a change rather than as arrival.
      const cx = Math.round(x / TILE), cz = Math.round(z / TILE), here = cellKey(cx, cz);
      if (lastFloor !== floor) { lastFloor = floor; cell = ''; snap = true; }
      if (here !== cell) {
        cell = here;
        const id = floor.roomByCell.get(here) ?? -1;
        if (id >= 0) theme = floor.rooms[id].theme;
        else { let best = Infinity; for (const r of floor.rooms) { const d = (r.x - cx) ** 2 + (r.z - cz) ** 2; if (d < best) { best = d; theme = r.theme; } } }
      }
      const m = ROOM_MOOD[theme], k = snap ? 1 : rate; snap = false;
      key.lerp(to.setHex(m.key), k); sky.lerp(to.setHex(m.sky), k); ground.lerp(to.setHex(m.ground), k);
      fog.lerp(to.setHex(m.fog), k); back.lerp(to.setHex(m.background), k);
      fire.lerp(to.setHex(m.fire), k); banner.lerp(to.setHex(m.banner), k);
      masonry.lerp(to.setHex(m.masonry), k); bed.lerp(to.setHex(m.foundation), k);
      numbers.key += (m.keyIntensity - numbers.key) * k;
      numbers.hemisphere += (m.hemisphere - numbers.hemisphere) * k;
      numbers.fog += (m.fogDensity - numbers.fog) * k;
      numbers.environment += (m.environment - numbers.environment) * k;
      moon.color.copy(key); moon.intensity = numbers.key;
      hemisphere.color.copy(sky); hemisphere.groundColor.copy(ground); hemisphere.intensity = numbers.hemisphere;
      (scene.fog as THREE.FogExp2).color.copy(fog); (scene.fog as THREE.FogExp2).density = numbers.fog;
      (scene.background as THREE.Color).copy(back); scene.environmentIntensity = numbers.environment;
      // Every lamp in the keep, including the one that gets lent out: the sconce it returns to has to
      // burn what its three neighbours burn or a borrow reads as a colour change rather than a flare.
      // Plan 014 round B: the pools carry the warmth. A brazier's light is its theme's fire run a third
      // of the way to amber, so even a teal or violet chamber holds a warm pool against its cool ambient.
      torchTint.copy(fire).lerp(torchWarm, .35);
      for (const light of torches) light.color.copy(torchTint);
      emberHome.copy(torchTint);
      mixTo(tideMood.value, m.water, k);
      mixTo(stoneMood.moss.value, m.moss, k); mixTo(stoneMood.warm.value, m.warm, k);
      mixTo(stoneMood.cool.value, m.cool, k); mixTo(stoneMood.crown.value, m.crown, k);
      stoneMood.mossAmount.value += (m.mossAmount - stoneMood.mossAmount.value) * k;
    },
  };
  return mood;
};
