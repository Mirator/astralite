import assert from 'node:assert/strict';
import {generateFloor,canStand,TILE,cellKey} from '../../game/app/dungeon-floor.ts';
let min=Infinity,max=0;const shapes=new Set(),counts=new Set();
for(let seed=0;seed<500;seed++){
 const f=generateFloor(seed);min=Math.min(min,f.tiles.length);max=Math.max(max,f.tiles.length);counts.add(f.rooms.length);assert(f.tiles.length>=1610);
 const seen=new Set(),q=[f.tiles[0]];seen.add(cellKey(q[0].x,q[0].z));for(let i=0;i<q.length;i++){const t=q[i];for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const key=cellKey(t.x+dx,t.z+dz);if(f.cells.has(key)&&!seen.has(key)){seen.add(key);q.push({x:t.x+dx,z:t.z+dz});}}}assert.equal(seen.size,f.cells.size,`connectivity seed ${seed}`);
 f.rooms.forEach(r=>{shapes.add(r.shape);assert(canStand(f.cells,r.x*TILE,r.z*TILE));for(const side of [-1,1])assert(canStand(f.cells,r.x*TILE+side*2.3,r.z*TILE));});
 f.props.forEach(p=>assert(!canStand(f.cells,p.x*TILE,p.z*TILE)));
}
console.log({min,max,roomCounts:[...counts].sort(),shapes:[...shapes],seeds:500});
