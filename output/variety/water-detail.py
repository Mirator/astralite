from pathlib import Path
p=Path('game/app/dungeon-atmosphere.ts');s=p.read_text()
s=s.replace("  ctx.strokeStyle='#e7e6d666'; ctx.strokeRect(3,3,122,122);", """  ctx.strokeStyle='#65706baa';ctx.lineWidth=2;
  for(let row=1;row<3;row++){ctx.beginPath();ctx.moveTo(0,row*42);ctx.lineTo(128,row*42);ctx.stroke();}
  for(let row=0;row<3;row++){const x=row%2?39:77;ctx.beginPath();ctx.moveTo(x,row*42);ctx.lineTo(x,(row+1)*42);ctx.stroke();}
  ctx.strokeStyle='#e7e6d644'; ctx.strokeRect(2,2,124,124);""")
s=s.replace("  const warm=new THREE.MeshBasicMaterial", """  const waterCanvas=document.createElement('canvas');waterCanvas.width=64;waterCanvas.height=128;const wc=waterCanvas.getContext('2d')!;wc.fillStyle='#619d9e';wc.fillRect(0,0,64,128);
  for(let i=0;i<35;i++){wc.fillStyle=i%2?'#c4eee0aa':'#83c7c4aa';wc.fillRect((i*17)%64,(i*37)%128,1+i%3,15+i%25);}
  const flowTexture=new THREE.CanvasTexture(waterCanvas);flowTexture.wrapT=THREE.RepeatWrapping;flowTexture.repeat.y=2;flowTexture.colorSpace=THREE.SRGBColorSpace;
  const flowing=new THREE.MeshBasicMaterial({map:flowTexture,color:0xc6f0e7,transparent:true,opacity:.85,side:THREE.DoubleSide});
  const warm=new THREE.MeshBasicMaterial""")
s=s.replace(',fallRooms=new Set<number>()','')
a=s.index("      if(room.theme==='flooded'");b=s.index('\n      }',a)+len('\n      }');s=s[:a]+s[b:]
a=s.index('  const geometry=new THREE.BoxGeometry')
s=s[:a]+"""  for(const room of floor.rooms.filter(r=>r.theme==='flooded')){
    const edges=floor.tiles.filter(t=>t.room===room.id).flatMap(t=>[[1,0],[0,1]].filter(([dx,dz])=>!floor.cells.has(cellKey(t.x+dx,t.z+dz))&&!blocked.has(cellKey(t.x+dx,t.z+dz))).map(([dx,dz])=>({x:t.x,z:t.z,dx,dz})));
    if(!edges.length)continue;const e=edges[Math.floor(random()*edges.length)],x=(e.x+e.dx*.58)*TILE,z=(e.z+e.dz*.58)*TILE;
    const fall=mesh(new THREE.PlaneGeometry(1.15,1.4,3,5),flowing,x,-.66,z);if(e.dx)fall.rotation.y=Math.PI/2;fall.castShadow=false;falls.push(fall);
    for(let i=0;i<4;i++){const ring=mesh(new THREE.RingGeometry(.22+i*.13,.25+i*.13,24),foam,x,-1.27,z);ring.rotation.x=-Math.PI/2;ring.castShadow=false;}
  }
  const chips:THREE.Vector3[]=[];for(const room of floor.rooms){const local=floor.tiles.filter(t=>t.room===room.id);for(let i=0;i<(room.theme==='ruins'?25:9);i++){const t=local[Math.floor(random()*local.length)];if(t)chips.push(new THREE.Vector3((t.x+random()-.5)*TILE,.05,(t.z+random()-.5)*TILE));}}
  const debris=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.2),stone,chips.length),chipMatrix=new THREE.Matrix4();chips.forEach((p,i)=>{chipMatrix.compose(p,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),random()*6.28),new THREE.Vector3(.5+random(),.22,.5+random()));debris.setMatrixAt(i,chipMatrix);});debris.receiveShadow=true;world.add(debris);
"""+s[a:]
s=s.replace("    falls.forEach((f,i)=>{(f.material as THREE.MeshBasicMaterial).opacity=.5+Math.sin(t*5+i)*.13;f.scale.x=1+Math.sin(t*4+i)*.08;});", "    flowTexture.offset.y=t*.5;falls.forEach((f,i)=>{f.scale.x=1+Math.sin(t*4+i)*.06;});")
s=s.replace('dispose(){motesGeo.dispose();','dispose(){flowTexture.dispose();motesGeo.dispose();')
p.write_text(s,encoding='utf-8')
