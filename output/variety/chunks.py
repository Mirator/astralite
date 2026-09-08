from pathlib import Path
p=Path('game/app/dungeon-atmosphere.ts');s=p.read_text();s=s.replace('sz:number;color:number}[]','sz:number;color:number;room:number}[]').replace('blocks.push({x:','blocks.push({room:tile.room,x:')
a=s.index('  const geometry=new THREE.BoxGeometry');b=s.index('  // Different landmarks',a)
s=s[:a]+'''  const geometry=new THREE.BoxGeometry(1,1,1),wallMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.95}),matrix=new THREE.Matrix4();
  // Separate chamber batches let the view and shadow frusta skip distant masonry.
  for(const room of floor.rooms){const local=blocks.filter(b=>b.room===room.id),masonry=new THREE.InstancedMesh(geometry,wallMaterial,local.length);
    local.forEach((b,i)=>{matrix.compose(new THREE.Vector3(b.x,b.y,b.z),new THREE.Quaternion(),new THREE.Vector3(b.sx,b.sy,b.sz));masonry.setMatrixAt(i,matrix);masonry.setColorAt(i,new THREE.Color(b.color).multiplyScalar(.9+random()*.22));});masonry.castShadow=masonry.receiveShadow=true;world.add(masonry);
  }
''' +s[b:];p.write_text(s,encoding='utf-8')
