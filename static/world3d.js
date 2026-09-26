(() => {
  'use strict';

  const canvas = document.getElementById('world3dCanvas');
  const map = document.getElementById('worldMap');
  if (!canvas || !map) return;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const saveData = navigator.connection?.saveData;
  if (saveData) {
    document.documentElement.classList.add('three-skipped');
    return;
  }

  const THREE_URLS = [
    'https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.module.min.js',
    'https://unpkg.com/three@0.185.0/build/three.module.min.js',
  ];
  async function loadThree(){ let last; for(const url of THREE_URLS){ try { return await import(url); } catch(error){ last=error; } } throw last || new Error('Three.js unavailable'); }
  const zones = {
    agentlab: { position: [0, 0, -5.1], color: 0x72f1b8, label: 'Agent Tower', focus: [0, 1.5, -4.6] },
    arena:    { position: [-5.7, 0, -0.9], color: 0xff667e, label: 'AI Arena', focus: [-5.2, 1.0, -0.6] },
    market:   { position: [5.8, 0, -0.7], color: 0x59c5ff, label: 'Market Citadel', focus: [5.2, 1.3, -0.4] },
    pulse:    { position: [4.7, 0, 4.7], color: 0xf0ba4f, label: 'Pulse District', focus: [4.2, 1.0, 4.2] },
    a2a:      { position: [-4.7, 0, 4.7], color: 0xb895ff, label: 'A2A Exchange', focus: [-4.2, 1.0, 4.2] },
    portal:   { position: [0, 0, 6.4], color: 0x79f0dc, label: 'Portal Hub', focus: [0, 1.0, 5.7] },
  };

  let THREE, scene, camera, renderer, clock, raycaster, pointer;
  let raf = 0, visible = !document.hidden, running = false;
  let yaw = 0.58, pitch = 0.56, distance = 18.8, targetDistance = 18.8;
  let cameraTarget, desiredTarget;
  let dragging = false, moved = false, startX = 0, startY = 0, startYaw = 0, startPitch = 0;
  let hovered = null, selected = null, agent = null, agentTravel = null;
  const zoneGroups = new Map();
  const pickMeshes = [];
  const districtButtons = new Map();
  const pulses = [];
  const travelers = [];
  const trails = [];
  const worldState = { color: '#72f1b8', accent: '#45a8ff', evolution: 'emerging' };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;

  function material(color, opts={}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? .56,
      metalness: opts.metalness ?? .24,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
    });
  }

  function box(w,h,d,color,opts={}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material(color,opts));
    m.position.y = h/2;
    return m;
  }

  function cylinder(r,h,color,segments=28,opts={}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,segments), material(color,opts));
    m.position.y = h/2;
    return m;
  }

  function glowRing(radius, color, opacity=.35) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius*.84, radius, 64),
      new THREE.MeshBasicMaterial({ color, transparent:true, opacity, side:THREE.DoubleSide, depthWrite:false })
    );
    ring.rotation.x = -Math.PI/2;
    ring.position.y = .08;
    ring.userData.ring = true;
    return ring;
  }

  function zoneBase(g, color, radius=1.6) {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius*1.08, .2, 48),
      material(0x0c1728,{roughness:.8,metalness:.12})
    );
    base.position.y=.1;
    g.add(base, glowRing(radius*1.08,color,.2));
    const light = new THREE.PointLight(color, 5, 6.2, 2);
    light.position.y=1.4;
    g.add(light);
  }

  function windowPanel(g,x,y,z,w,h,color) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshBasicMaterial({color,transparent:true,opacity:.74,side:THREE.DoubleSide}));
    p.position.set(x,y,z);
    g.add(p);
  }

  function buildAgentTower(color) {
    const g=new THREE.Group(); zoneBase(g,color,1.7);
    const base=cylinder(1.18,.55,0x12263a,32,{metalness:.38}); base.position.y=.38; g.add(base);
    const lower=cylinder(.86,2.2,0x173249,28,{metalness:.34,roughness:.4}); lower.position.y=1.45; g.add(lower);
    const mid=cylinder(.62,1.9,0x203d57,24,{metalness:.35}); mid.position.y=3.18; g.add(mid);
    const crown=new THREE.Mesh(new THREE.ConeGeometry(.74,1.5,8),material(0x1f5861,{emissive:color,emissiveIntensity:.16})); crown.position.y=4.88; g.add(crown);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;const p=box(.08,1.0,.08,color,{emissive:color,emissiveIntensity:.65});p.position.set(Math.cos(a)*1.2,.88,Math.sin(a)*1.2);g.add(p);}
    const core=new THREE.Mesh(new THREE.SphereGeometry(.27,18,18),new THREE.MeshBasicMaterial({color}));core.position.y=3.45;core.userData.pulse=true;g.add(core);
    return g;
  }

  function buildArena(color) {
    const g=new THREE.Group(); zoneBase(g,color,1.9);
    const outer=new THREE.Mesh(new THREE.CylinderGeometry(1.58,1.76,.75,40,1,true),material(0x301b2d,{transparent:true,opacity:.96,metalness:.3}));outer.position.y=.56;g.add(outer);
    const floor=cylinder(1.3,.18,0x141a28,40);floor.position.y=.31;g.add(floor);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.28,.07,10,64),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.85}));ring.rotation.x=Math.PI/2;ring.position.y=.95;ring.userData.spin=true;g.add(ring);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;const p=box(.15,2.0,.15,0x5c273c,{emissive:color,emissiveIntensity:.08});p.position.set(Math.cos(a)*1.42,1.1,Math.sin(a)*1.42);g.add(p);}
    return g;
  }

  function buildMarket(color) {
    const g=new THREE.Group(); zoneBase(g,color,1.9);
    const left=box(.85,3.5,1.15,0x112f4d,{metalness:.42,roughness:.36});left.position.set(-.7,1.86,0);g.add(left);
    const right=box(.85,3.5,1.15,0x112f4d,{metalness:.42,roughness:.36});right.position.set(.7,1.86,0);g.add(right);
    const bridge=box(1.5,.26,.5,0x245e79,{emissive:color,emissiveIntensity:.2});bridge.position.set(0,2.3,.12);g.add(bridge);
    const spire=cylinder(.18,2.2,0x326d87,18,{emissive:color,emissiveIntensity:.12});spire.position.y=4.15;g.add(spire);
    for(const x of [-.7,.7]) for(const y of [.8,1.35,1.9,2.45,3]) windowPanel(g,x,y,.58,.42,.13,color);
    const ticker=new THREE.Mesh(new THREE.TorusGeometry(1.25,.035,8,54),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.64}));ticker.rotation.x=Math.PI/2;ticker.position.y=.46;ticker.userData.spin=true;g.add(ticker);
    return g;
  }

  function buildPulse(color) {
    const g=new THREE.Group(); zoneBase(g,color,1.75);
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2+.45;
      const tower=cylinder(.28,.7+i*.24,0x47391d,18,{metalness:.3,emissive:color,emissiveIntensity:.08});
      tower.position.set(Math.cos(a)*.9,.46+(i*.12),Math.sin(a)*.9);g.add(tower);
      const orb=new THREE.Mesh(new THREE.SphereGeometry(.18,14,14),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9}));
      orb.position.set(Math.cos(a)*.9,1.05+i*.25,Math.sin(a)*.9);orb.userData.pulse=true;g.add(orb);
      pulses.push(orb);
    }
    const hub=cylinder(.48,1.55,0x5a461e,24,{emissive:color,emissiveIntensity:.13});hub.position.y=.98;g.add(hub);
    const crown=new THREE.Mesh(new THREE.OctahedronGeometry(.34,0),new THREE.MeshBasicMaterial({color}));crown.position.y=2.06;crown.userData.spin=true;g.add(crown);
    return g;
  }

  function buildA2A(color) {
    const g=new THREE.Group(); zoneBase(g,color,1.85);
    const hub=new THREE.Mesh(new THREE.IcosahedronGeometry(.56,1),material(0x402d61,{emissive:color,emissiveIntensity:.16,metalness:.45}));hub.position.y=1.2;hub.userData.spin=true;g.add(hub);
    for(let i=0;i<5;i++){
      const a=i*Math.PI*2/5;
      const node=new THREE.Mesh(new THREE.OctahedronGeometry(.24,0),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.84}));
      node.position.set(Math.cos(a)*1.05,.8+Math.sin(a*2)*.18,Math.sin(a)*1.05);node.userData.pulse=true;g.add(node);
      const geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,1.2,0),node.position.clone()]);
      const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color,transparent:true,opacity:.42}));g.add(line);
    }
    return g;
  }

  function buildPortal(color) {
    const g=new THREE.Group(); zoneBase(g,color,1.8);
    const left=box(.28,2.75,.42,0x1b4648,{metalness:.32});left.position.set(-.95,1.5,0);g.add(left);
    const right=box(.28,2.75,.42,0x1b4648,{metalness:.32});right.position.set(.95,1.5,0);g.add(right);
    const top=box(2.18,.28,.42,0x22585b,{metalness:.35,emissive:color,emissiveIntensity:.1});top.position.set(0,2.82,0);g.add(top);
    const portal=new THREE.Mesh(new THREE.TorusGeometry(.73,.09,12,64),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.92}));portal.position.y=1.48;portal.userData.spin=true;g.add(portal);
    const surface=new THREE.Mesh(new THREE.CircleGeometry(.62,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.15,side:THREE.DoubleSide,depthWrite:false}));surface.position.y=1.48;surface.userData.pulse=true;g.add(surface);
    return g;
  }

  function buildDistrict(key,spec) {
    const builders={agentlab:buildAgentTower,arena:buildArena,market:buildMarket,pulse:buildPulse,a2a:buildA2A,portal:buildPortal};
    const g=builders[key](spec.color);g.position.set(...spec.position);g.userData.zone=key;scene.add(g);zoneGroups.set(key,g);
    const pick=new THREE.Mesh(new THREE.CylinderGeometry(2.05,2.05,5.4,20),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
    pick.position.set(spec.position[0],2.5,spec.position[2]);pick.userData.zone=key;scene.add(pick);pickMeshes.push(pick);
    const label=document.querySelector(`[data-district="${key}"]`);if(label)districtButtons.set(key,label);
  }

  function buildGround() {
    const ground=new THREE.Mesh(new THREE.CircleGeometry(13.4,96),material(0x06101a,{roughness:.9,metalness:.08}));ground.rotation.x=-Math.PI/2;ground.position.y=-.03;scene.add(ground);
    const under=new THREE.Mesh(new THREE.CylinderGeometry(13.15,12.3,.34,96),material(0x040a11,{roughness:.82,metalness:.18}));under.position.y=-.22;scene.add(under);
    const grid=new THREE.GridHelper(25,50,0x163047,0x0b1b29);grid.position.y=.012;grid.material.transparent=true;grid.material.opacity=.16;scene.add(grid);
    [3.1,5.8,8.8,11.8].forEach((r,i)=>{
      const ring=new THREE.Mesh(new THREE.RingGeometry(r-.025,r+.025,128),new THREE.MeshBasicMaterial({color:i%2?0x21435c:0x1f5e61,transparent:true,opacity:i===0?.28:.12,side:THREE.DoubleSide,depthWrite:false}));
      ring.rotation.x=-Math.PI/2;ring.position.y=.018;ring.userData.spin=i===0;scene.add(ring);
    });
    const coreBase=new THREE.Mesh(new THREE.CylinderGeometry(2.15,2.55,.34,64),material(0x0b1928,{metalness:.5,roughness:.34}));coreBase.position.y=.16;scene.add(coreBase);
    const coreRing=new THREE.Mesh(new THREE.TorusGeometry(1.82,.045,10,96),new THREE.MeshBasicMaterial({color:0x72f1b8,transparent:true,opacity:.54}));coreRing.rotation.x=Math.PI/2;coreRing.position.y=.39;coreRing.userData.spin=true;scene.add(coreRing);
    const coreRing2=new THREE.Mesh(new THREE.TorusGeometry(1.28,.018,8,80),new THREE.MeshBasicMaterial({color:0x59c5ff,transparent:true,opacity:.28}));coreRing2.rotation.x=Math.PI/2.6;coreRing2.position.y=1.14;coreRing2.userData.spin=true;scene.add(coreRing2);
    const core=new THREE.Mesh(new THREE.IcosahedronGeometry(.58,2),material(0x163548,{emissive:0x72f1b8,emissiveIntensity:.62,metalness:.56,roughness:.2}));core.position.y=1.2;core.userData.spin=true;scene.add(core);pulses.push(core);
    const spire=new THREE.Mesh(new THREE.CylinderGeometry(.055,.14,4.7,16),new THREE.MeshBasicMaterial({color:0x72f1b8,transparent:true,opacity:.28,depthWrite:false}));spire.position.y=2.7;scene.add(spire);
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(.5,.12,8,24,1,true),new THREE.MeshBasicMaterial({color:0x59c5ff,transparent:true,opacity:.025,side:THREE.DoubleSide,depthWrite:false}));beam.position.y=4.2;scene.add(beam);
    const beacon=new THREE.PointLight(0x72f1b8,13,10,2);beacon.position.y=1.9;scene.add(beacon);
    // Roads / data rails
    for(const spec of Object.values(zones)){
      const a=new THREE.Vector3(0,.055,0), b=new THREE.Vector3(spec.position[0],.055,spec.position[2]);
      const curve=new THREE.LineCurve3(a,b);
      const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,1,.022,6,false),new THREE.MeshBasicMaterial({color:spec.color,transparent:true,opacity:.23}));scene.add(tube);
      const outer=new THREE.Mesh(new THREE.TubeGeometry(curve,1,.06,6,false),new THREE.MeshBasicMaterial({color:spec.color,transparent:true,opacity:.026,depthWrite:false}));scene.add(outer);
    }
  }

  function buildSkyline() {
    const group=new THREE.Group();
    for(let i=0;i<72;i++){
      const a=i/72*Math.PI*2, r=10.7+(i%7)*.5, h=.7+(i%9)*.31;
      const b=box(.22+(i%4)*.12,h,.26+(i%5)*.07,0x081624,{emissive:i%5===0?0x12354a:0x000000,emissiveIntensity:.22,roughness:.62,metalness:.18});
      b.position.set(Math.cos(a)*r,h/2-.03,Math.sin(a)*r);group.add(b);
      if(i%8===0){const cap=new THREE.Mesh(new THREE.ConeGeometry(.12,.55,6),new THREE.MeshBasicMaterial({color:i%16===0?0x59c5ff:0x72f1b8,transparent:true,opacity:.34}));cap.position.set(b.position.x,h+.25,b.position.z);group.add(cap);}
    }
    scene.add(group);
  }

  function buildAgent() {
    const g=new THREE.Group();
    const orb=new THREE.Mesh(new THREE.SphereGeometry(.23,18,18),material(0x72f1b8,{emissive:0x45a8ff,emissiveIntensity:.8,metalness:.2,roughness:.25}));orb.name='orb';g.add(orb);
    const halo=new THREE.Mesh(new THREE.TorusGeometry(.42,.026,8,36),new THREE.MeshBasicMaterial({color:0x45a8ff,transparent:true,opacity:.85}));halo.rotation.x=Math.PI/2;halo.name='halo';g.add(halo);
    const lower=new THREE.Mesh(new THREE.TorusGeometry(.31,.016,8,32),new THREE.MeshBasicMaterial({color:0x72f1b8,transparent:true,opacity:.5}));lower.rotation.x=Math.PI/2;lower.position.y=-.18;lower.name='lower-halo';g.add(lower);
    const light=new THREE.PointLight(0x72f1b8,4,2.4,2);light.name='core-light';g.add(light);
    g.position.set(0,.8,0);scene.add(g);agent=g;
  }

  function buildTravelers() {
    const colors=[0xff667e,0x59c5ff,0xb895ff,0xf0ba4f,0x79f0dc];
    for(let i=0;i<12;i++){
      const g=new THREE.Group();
      const orb=new THREE.Mesh(new THREE.SphereGeometry(.07,8,8),new THREE.MeshBasicMaterial({color:colors[i%colors.length],transparent:true,opacity:.78}));g.add(orb);
      const halo=new THREE.Mesh(new THREE.TorusGeometry(.12,.01,5,16),new THREE.MeshBasicMaterial({color:colors[i%colors.length],transparent:true,opacity:.5}));halo.rotation.x=Math.PI/2;g.add(halo);
      scene.add(g);travelers.push({g,r:2.8+(i%5)*1.3,s:.05+(i%4)*.014,p:i*.73,y:.28+(i%3)*.12});
    }
  }

  function buildParticles() {
    const positions=[];
    for(let i=0;i<420;i++) positions.push((Math.random()-.5)*28,Math.random()*7+.15,(Math.random()-.5)*28);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    const points=new THREE.Points(geo,new THREE.PointsMaterial({color:0x82a8c8,size:.025,transparent:true,opacity:.35,depthWrite:false}));scene.add(points);
  }

  function setupRenderer() {
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:window.devicePixelRatio<2,powerPreference:'high-performance'});
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.05;
    renderer.setClearColor(0x050a13,1);
  }

  function setupLights() {
    scene.add(new THREE.HemisphereLight(0x6984b5,0x07101c,2.1));
    const key=new THREE.DirectionalLight(0xbad7ff,3.4);key.position.set(-7,12,6);scene.add(key);
    const fill=new THREE.DirectionalLight(0x9a72ff,1.4);fill.position.set(7,5,-8);scene.add(fill);
  }

  function fit() {
    if(!renderer)return;
    const r=map.getBoundingClientRect();
    const w=Math.max(320,r.width), h=Math.max(350,r.height);
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,window.innerWidth<760?1.15:1.6));
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();projectDomLabels();
  }

  function updateCamera(dt,elapsed) {
    cameraTarget.lerp(desiredTarget,1-Math.pow(.0008,dt));
    distance += (targetDistance-distance)*(1-Math.pow(.002,dt));
    if(!dragging && !selected && !reducedMotion) yaw += Math.sin(elapsed*.12)*.0002;
    const h=Math.cos(pitch)*distance;
    camera.position.set(cameraTarget.x+Math.sin(yaw)*h,cameraTarget.y+Math.sin(pitch)*distance,cameraTarget.z+Math.cos(yaw)*h);
    camera.lookAt(cameraTarget);
  }

  function projectDomLabels() {
    if(!camera)return;
    const rect=map.getBoundingClientRect();
    for(const [key,g] of zoneGroups){
      const v=new THREE.Vector3();g.getWorldPosition(v);v.y+= key==='agentlab'?4.9:2.9;v.project(camera);
      const label=districtButtons.get(key);if(!label)continue;
      label.style.left=`${(v.x*.5+.5)*rect.width}px`;label.style.top=`${(-v.y*.5+.5)*rect.height}px`;label.style.visibility=v.z>-1&&v.z<1?'visible':'hidden';
    }
    const mapAgent=document.getElementById('mapAgent');
    if(mapAgent&&agent){const v=agent.position.clone();v.y+=.7;v.project(camera);mapAgent.style.left=`${(v.x*.5+.5)*rect.width}px`;mapAgent.style.top=`${(-v.y*.5+.5)*rect.height}px`;mapAgent.style.visibility=v.z>-1&&v.z<1?'visible':'hidden';}
  }

  function moveAgent(zone='agentlab') {
    const spec=zones[zone]||zones.agentlab;
    const from=agent.position.clone(), to=new THREE.Vector3(spec.position[0],.72,spec.position[2]);
    agentTravel={from,to,start:performance.now(),duration:850+from.distanceTo(to)*55};
    const trail=[];
    for(let i=0;i<10;i++){
      const p=new THREE.Mesh(new THREE.SphereGeometry(.018,5,5),new THREE.MeshBasicMaterial({color:i%2?0x72f1b8:0x59c5ff,transparent:true,opacity:.6}));p.position.copy(from);scene.add(p);trail.push(p);
    }
    trails.push({items:trail,start:performance.now(),life:850});
  }

  function focusZone(zone) {
    const spec=zones[zone];if(!spec)return;
    selected=zone;desiredTarget.set(...spec.focus);targetDistance=10.7;
    for(const [k,g] of zoneGroups) g.userData.selected=k===zone;
    for(const [k,label] of districtButtons) label.classList.toggle('threeSelected',k===zone);
    const title=document.getElementById('cinematicStoryTitle'),copy=document.getElementById('cinematicStoryCopy');
    const stories={
      agentlab:['Your Agent is the world.','Inspect memory, behavioural change and capability evidence.'],
      arena:['Intelligence needs opposition.','Challenge rivals and turn Agent differences into visible competition.'],
      market:['Deep market intelligence.','OKX Perp Wars tests thesis, risk discipline and memory under live market structure.'],
      pulse:['Fast decisions. Persistent consequences.','BNB Pulse compresses Agent judgement into repeatable 5M / 15M / 60M rounds.'],
      a2a:['Agents become an economy.','Hire capabilities, buy intelligence and build reputation through Agent-to-Agent work.'],
      portal:['Every world can train the same Agent.','Games, partner experiences and KULT Create become capability environments.']
    };
    if(title&&stories[zone]){title.textContent=stories[zone][0];copy.textContent=stories[zone][1];}
    moveAgent(zone);
  }

  function resetCamera() {
    selected=null;desiredTarget.set(0,1.0,.2);targetDistance=18.2;
    for(const g of zoneGroups.values())g.userData.selected=false;
    for(const label of districtButtons.values())label.classList.remove('threeSelected');
    const title=document.getElementById('cinematicStoryTitle'),copy=document.getElementById('cinematicStoryCopy');
    if(title)title.textContent='Every experience leaves a mark.';if(copy)copy.textContent='Choose where your Agent goes next. The world remembers the outcome.';
  }

  function pointerNdc(ev) {
    const rect=canvas.getBoundingClientRect();
    pointer.x=((ev.clientX-rect.left)/rect.width)*2-1;pointer.y=-((ev.clientY-rect.top)/rect.height)*2+1;
  }

  function hit(ev) {
    pointerNdc(ev);raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(pickMeshes,false)[0]?.object?.userData?.zone||null;
  }

  function setupInteraction() {
    canvas.addEventListener('pointerdown',ev=>{dragging=true;moved=false;startX=ev.clientX;startY=ev.clientY;startYaw=yaw;startPitch=pitch;canvas.setPointerCapture?.(ev.pointerId);});
    canvas.addEventListener('pointermove',ev=>{
      if(dragging){const dx=ev.clientX-startX,dy=ev.clientY-startY;if(Math.abs(dx)+Math.abs(dy)>4)moved=true;yaw=startYaw-dx*.006;pitch=clamp(startPitch+dy*.004,.27,.9);return;}
      const key=hit(ev);if(key!==hovered){hovered=key;for(const [k,g] of zoneGroups)g.userData.hovered=k===key;canvas.style.cursor=key?'pointer':'grab';}
    });
    canvas.addEventListener('pointerup',ev=>{if(!dragging)return;dragging=false;if(!moved){const key=hit(ev);if(key){focusZone(key);districtButtons.get(key)?.click();}}});
    canvas.addEventListener('pointerleave',()=>{dragging=false;hovered=null;for(const g of zoneGroups.values())g.userData.hovered=false;});
    canvas.addEventListener('wheel',ev=>{ev.preventDefault();targetDistance=clamp(targetDistance+Math.sign(ev.deltaY)*1.25,9.5,24);},{passive:false});
    canvas.addEventListener('dblclick',resetCamera);
  }

  function addControls() {
    const controls=document.createElement('div');controls.className='world3dControls';controls.innerHTML='<span class="world3dLive"><i></i>KULT WORLD ONLINE</span><span class="world3dHint">DRAG TO ORBIT · SCROLL TO ZOOM · DOUBLE CLICK TO RESET</span><button type="button" class="world3dReset">RESET VIEW</button>';
    map.appendChild(controls);controls.querySelector('button').addEventListener('click',resetCamera);
  }

  function animateObjects(elapsed,dt) {
    scene.traverse(o=>{
      if(o.userData?.spin)o.rotation.y+=dt*.35;
      if(o.userData?.pulse){const s=1+Math.sin(elapsed*2.2+o.id)*.05;o.scale.setScalar(s);}
    });
    for(const [key,g] of zoneGroups){
      const scale=g.userData.selected?1.055:g.userData.hovered?1.035:1;
      const s=scale+Math.sin(elapsed*.7+key.length)*.003;g.scale.lerp(new THREE.Vector3(s,s,s),.08);
      const ring=g.children.find(o=>o.userData?.ring);if(ring){const offline=g.userData.runtimeStatus==='offline',hot=g.userData.runtimeHot;ring.material.opacity=offline?.055:(g.userData.hovered||g.userData.selected||hot)?.45:.18+Math.sin(elapsed*.9+key.length)*.035;}
    }
    travelers.forEach((t,i)=>{const a=elapsed*t.s*6+t.p;t.g.position.set(Math.cos(a)*t.r,t.y+Math.sin(elapsed*1.7+i)*.04,Math.sin(a*.94)*t.r*.7);t.g.children[1].rotation.z=elapsed*.5+i;});
    if(agentTravel){const t=clamp((performance.now()-agentTravel.start)/agentTravel.duration,0,1),e=ease(t);agent.position.lerpVectors(agentTravel.from,agentTravel.to,e);agent.position.y=.72+Math.sin(e*Math.PI)*.55;if(t>=1)agentTravel=null;}else if(agent){agent.position.y=.72+Math.sin(elapsed*1.5)*.04;agent.getObjectByName('halo').rotation.z=elapsed*.5;agent.getObjectByName('lower-halo').rotation.z=-elapsed*.32;}
    for(let i=trails.length-1;i>=0;i--){const tr=trails[i],t=(performance.now()-tr.start)/tr.life;tr.items.forEach((p,j)=>{p.material.opacity=Math.max(0,.55*(1-t));p.position.y+=dt*(.2+j*.01);});if(t>=1){tr.items.forEach(p=>{scene.remove(p);p.geometry.dispose();p.material.dispose();});trails.splice(i,1);}}
  }

  function applyRuntime(detail={}) {
    const districts=detail.districts||{};
    for(const [key,g] of zoneGroups){
      const d=districts[key]||{};g.userData.runtimeStatus=d.status||'unknown';
      g.userData.runtimeHot=(key==='pulse'&&Boolean(detail.pulse?.active))||(key==='a2a'&&Boolean(detail.a2a?.recent?.length))||(key==='market'&&Boolean(detail.market?.rating));
      const label=districtButtons.get(key);if(label){label.dataset.runtimeStatus=g.userData.runtimeStatus;label.title=d.detail||zones[key]?.label||key;}
    }
  }

  function updateAgentAppearance(detail={}) {
    Object.assign(worldState,detail);if(!agent)return;
    const orb=agent.getObjectByName('orb'),halo=agent.getObjectByName('halo'),lower=agent.getObjectByName('lower-halo'),light=agent.getObjectByName('core-light');
    try{if(detail.color){orb.material.color.set(detail.color);lower.material.color.set(detail.color);light.color.set(detail.color);}if(detail.accent){orb.material.emissive.set(detail.accent);halo.material.color.set(detail.accent);}}catch(_){ }
    const scale=detail.evolution==='elite'?1.28:detail.evolution==='skilled'?1.18:detail.evolution==='capable'?1.09:1;agent.scale.setScalar(scale);
  }

  function loop(){if(!running)return;raf=requestAnimationFrame(loop);if(!visible)return;const dt=Math.min(clock.getDelta(),.05),elapsed=clock.elapsedTime;updateCamera(dt,elapsed);animateObjects(elapsed,dt);projectDomLabels();renderer.render(scene,camera);}

  async function init(){
    try{
      THREE=await loadThree();scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x050a13,.026);
      camera=new THREE.PerspectiveCamera(39,1,.1,120);cameraTarget=new THREE.Vector3(0,.8,.4);desiredTarget=cameraTarget.clone();raycaster=new THREE.Raycaster();pointer=new THREE.Vector2();
      setupRenderer();setupLights();buildGround();buildSkyline();Object.entries(zones).forEach(([k,v])=>buildDistrict(k,v));buildAgent();buildTravelers();buildParticles();setupInteraction();addControls();fit();clock=new THREE.Clock();
      const ro=new ResizeObserver(fit);ro.observe(map);window.addEventListener('pagehide',()=>ro.disconnect(),{once:true});document.addEventListener('visibilitychange',()=>{visible=!document.hidden;if(visible)clock.getDelta();});
      document.documentElement.classList.add('three-ready');running=true;if(reducedMotion){updateCamera(.016,0);renderer.render(scene,camera);projectDomLabels();}else loop();
    }catch(err){console.warn('[KULT World v6] Three.js unavailable; keeping accessible UI fallback.',err?.message||err);document.documentElement.classList.add('three-fallback');}
  }

  document.addEventListener('kult:world-state',e=>updateAgentAppearance(e.detail||{}));
  document.addEventListener('kult:runtime',e=>applyRuntime(e.detail||{}));
  document.addEventListener('kult:zone-focus',e=>focusZone(e.detail?.zone));
  init();
})();
