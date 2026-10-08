// Plan 025 D7: the blood splat's canvas is authored in sRGB and has to be read as sRGB, like every other canvas texture in the game. Left at three's
// default (no colour space), its dark red was taken as linear and drawn lighter and greyer: the playtest's "the blood doesn't feel like it is red".
// The rendered hue and chroma before and after are in game/progress.md (plan 025 Stage A); this holds the texture the splats wear to sRGB.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

// The splat is baked on a 2D canvas, which node has none of: a canvas that takes every drawing call and draws nothing is enough to build it.
const pen = new Proxy({}, { get: (_, key) => key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => pen }) };
const { bloodDecals } = await import('../app/dungeon-blood.ts');

test('every blood splat wears a texture read as sRGB', () => {
  const blood = bloodDecals(3), splats = blood.group.children as THREE.Mesh[];
  assert.equal(splats.length, 3, 'precondition: the pool holds the splats it was asked for');
  for (const splat of splats) {
    const map = (splat.material as THREE.MeshBasicMaterial).map;
    assert.ok(map instanceof THREE.CanvasTexture, 'precondition: a splat wears the baked canvas');
    assert.equal(map.colorSpace, THREE.SRGBColorSpace, `a blood splat's texture is read as ${map.colorSpace || 'no colour space'}, not sRGB: its red comes out pale`);
  }
  blood.dispose();
});
