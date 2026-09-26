(() => {
  'use strict';
  const canvas = document.getElementById('perps3dCanvas');
  const root = document.getElementById('perpsWorld');
  if (!canvas || !root) return;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const saveData = navigator.connection?.saveData;
  if (saveData) return;

  const THREE_URLS = [
    'https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.module.min.js',
    'https://unpkg.com/three@0.185.0/build/three.module.min.js',
  ];
  async function loadThree(){ let last; for(const url of THREE_URLS){ try { return await import(url); } catch(error){ last=error; } } throw last || new Error('Three.js unavailable'); }
  let THREE, scene, camera, renderer, clock, ro;
  let running = false, visible = !document.hidden;
  let citadel, rivalCitadel, marketCore, bridge, agentOrb, rivalOrb, proofOrb;
  let cameraTarget, desiredTarget;
  let current = { citadelLevel:1, rating:1000, rivalId:'shadow09', activeStatus:null, duelOutcome:null, signal:0 };

  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function mat(color, opts={}) {
    return new THREE.MeshStandardMaterial({
      color, roughness:opts.roughness ?? .52, metalness:opts.metalness ?? .34,
      emissive:opts.emissive ?? 0x000000, emissiveIntensity:opts.emissiveIntensity ?? 0,
      transparent:opts.transparent ?? false, opacity:opts.opacity ?? 1,
    });
  }
  function mesh(geo,color,opts={}){ const m=new THREE.Mesh(geo,mat(color,opts)); m.castShadow=true; m.receiveShadow=true; return m; }
  function addBox(group,w,h,d,color,x=0,y=h/2,z=0,opts={}){ const m=mesh(new THREE.BoxGeometry(w,h,d),color,opts); m.position.set(x,y,z); group.add(m); return m; }
  function addCylinder(group,r,h,color,x=0,y=h/2,z=0,segments=20,opts={}){ const m=mesh(new THREE.CylinderGeometry(r,r,h,segments),color,opts);m.position.set(x,y,z);group.add(m);return m; }

  function buildCitadel(color, x, mirrored=false) {
    const g = new THREE.Group();
    g.position.x = x;
    const base = addCylinder(g,2.05,.34,0x101a2d,0,.17,0,32,{metalness:.65});
    base.scale.z=.78;
    addCylinder(g,1.5,.18,color,0,.42,0,32,{emissive:color,emissiveIntensity:.12});
    const tower=addBox(g,1.05,2.8,1.05,0x17233a,0,1.92,0,{metalness:.58});
    tower.rotation.y=Math.PI/4;
    const core=mesh(new THREE.OctahedronGeometry(.48,0),color,{emissive:color,emissiveIntensity:.55,roughness:.3});core.position.y=3.55;g.add(core);
    for(let i=0;i<4;i++){
      const a=(Math.PI*2*i)/4 + Math.PI/4;
      addBox(g,.46,1.5,.46,0x1f2d48,Math.cos(a)*1.22,1.15,Math.sin(a)*.86,{metalness:.45});
      const beacon=mesh(new THREE.SphereGeometry(.14,12,12),color,{emissive:color,emissiveIntensity:1});beacon.position.set(Math.cos(a)*1.22,1.98,Math.sin(a)*.86);g.add(beacon);
    }
    const halo=mesh(new THREE.TorusGeometry(1.78,.035,8,64),color,{emissive:color,emissiveIntensity:.65,transparent:true,opacity:.75}); halo.rotation.x=Math.PI/2; halo.position.y=.55; g.add(halo);
    g.userData={core,halo,tower,mirrored};
    scene.add(g); return g;
  }

  function buildWorld(){
    scene.background = new THREE.Color(0x060913);
    scene.fog = new THREE.FogExp2(0x060913,.035);
    const hemi=new THREE.HemisphereLight(0x8ec8ff,0x0a0d16,1.25);scene.add(hemi);
    const key=new THREE.DirectionalLight(0xd6e6ff,2.2);key.position.set(3,8,4);scene.add(key);
    const violet=new THREE.PointLight(0x8b7cff,26,16,2);violet.position.set(0,4,-2);scene.add(violet);

    const ground=mesh(new THREE.CylinderGeometry(8.8,9.4,.36,64),0x0b1220,{metalness:.22});ground.position.y=-.25;ground.scale.z=.62;scene.add(ground);
    const ring=mesh(new THREE.TorusGeometry(6.8,.035,8,96),0x2a5f88,{emissive:0x58b8ff,emissiveIntensity:.42,transparent:true,opacity:.55});ring.rotation.x=Math.PI/2;ring.scale.z=.66;ring.position.y=.04;scene.add(ring);

    citadel=buildCitadel(0x58b8ff,-3.85,false);
    rivalCitadel=buildCitadel(0xa678ff,3.85,true);

    marketCore=new THREE.Group();
    const coreBase=addCylinder(marketCore,1.18,.2,0x10182b,0,.11,0,32,{metalness:.6});coreBase.scale.z=.8;
    const core=mesh(new THREE.IcosahedronGeometry(.72,1),0x72f1b8,{emissive:0x1fe5a6,emissiveIntensity:.7,roughness:.24});core.position.y=1.1;marketCore.add(core);
    const coreRing=mesh(new THREE.TorusGeometry(1.18,.055,10,64),0x72f1b8,{emissive:0x72f1b8,emissiveIntensity:.75});coreRing.rotation.x=Math.PI/2;coreRing.position.y=1.08;marketCore.add(coreRing);
    marketCore.userData={core,coreRing};scene.add(marketCore);

    bridge=new THREE.Group();
    addBox(bridge,5.7,.15,.62,0x152139,0,.22,0,{metalness:.5});
    for(let x=-2.5;x<=2.5;x+=.5)addBox(bridge,.04,.04,.72,0x58b8ff,x,.34,0,{emissive:0x58b8ff,emissiveIntensity:.45});
    scene.add(bridge);

    agentOrb=mesh(new THREE.SphereGeometry(.28,18,18),0x58b8ff,{emissive:0x58b8ff,emissiveIntensity:.9});agentOrb.position.set(-2.55,1.15,0);scene.add(agentOrb);
    rivalOrb=mesh(new THREE.SphereGeometry(.28,18,18),0xa678ff,{emissive:0xa678ff,emissiveIntensity:.9});rivalOrb.position.set(2.55,1.15,0);scene.add(rivalOrb);
    proofOrb=mesh(new THREE.OctahedronGeometry(.22,0),0xffd166,{emissive:0xffd166,emissiveIntensity:.9});proofOrb.position.set(0,2.6,.2);scene.add(proofOrb);

    const starsGeo=new THREE.BufferGeometry();const pts=[];for(let i=0;i<260;i++){pts.push((Math.random()-.5)*22,Math.random()*8+1,(Math.random()-.5)*14)}starsGeo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
    const stars=new THREE.Points(starsGeo,new THREE.PointsMaterial({color:0x88bfff,size:.035,transparent:true,opacity:.55}));scene.add(stars);
  }

  function fit(){
    if(!renderer)return;const r=root.getBoundingClientRect();const w=Math.max(320,r.width),h=Math.max(260,r.height);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.55));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  }
  function focus(mode='all'){
    if(!desiredTarget)return;
    if(mode==='citadel')desiredTarget.set(-3.5,1.5,0);
    else if(mode==='rival')desiredTarget.set(3.5,1.5,0);
    else desiredTarget.set(0,1.3,0);
  }
  function updateFromState(detail={}){
    const p=detail.perps||detail.arena?.perps||{};const b=detail.active||detail.arena?.active||null;
    current={...current,citadelLevel:Number(p.citadelLevel||1),rating:Number(p.rating||1000),rivalId:b?.rival?.id||p.lastRivalId||current.rivalId,activeStatus:b?.status||null,duelOutcome:b?.result?.duelOutcome||null,signal:Number(b?.nori?.signalStrength||0)};
    if(citadel){
      const scale=1+Math.min(7,current.citadelLevel-1)*.065;citadel.scale.setScalar(scale);
      const color=current.rating>=1350?0xffd166:current.rating>=1125?0x72f1b8:0x58b8ff;citadel.userData.core.material.color.setHex(color);citadel.userData.core.material.emissive.setHex(color);citadel.userData.halo.material.color.setHex(color);citadel.userData.halo.material.emissive.setHex(color);
    }
    if(rivalCitadel){
      const colors={shadow09:0x8b7cff,berserker:0xff7b6b,athena:0x6fd8ff,aegis07:0x72f1b8,voidwalker:0xd491ff};const c=colors[current.rivalId]||0x8b7cff;rivalCitadel.userData.core.material.color.setHex(c);rivalCitadel.userData.core.material.emissive.setHex(c);rivalCitadel.userData.halo.material.color.setHex(c);rivalOrb.material.color.setHex(c);rivalOrb.material.emissive.setHex(c);
    }
  }
  function animate(){
    if(!running)return;requestAnimationFrame(animate);if(!visible)return;const dt=Math.min(clock.getDelta(),.05),t=clock.elapsedTime;
    cameraTarget.lerp(desiredTarget,1-Math.pow(.001,dt));camera.position.x=7.8*Math.sin(.18+t*.012);camera.position.z=10.7*Math.cos(.18+t*.012);camera.position.y=5.7;camera.lookAt(cameraTarget);
    if(citadel){citadel.userData.core.rotation.y=t*.7;citadel.userData.halo.rotation.z=t*.22;}
    if(rivalCitadel){rivalCitadel.userData.core.rotation.y=-t*.8;rivalCitadel.userData.halo.rotation.z=-t*.18;}
    if(marketCore){marketCore.userData.core.rotation.x=t*.35;marketCore.userData.core.rotation.y=t*.6;marketCore.userData.coreRing.rotation.z=t*.35;}
    const battleLive=['prepared','executing','active','closing'].includes(current.activeStatus);
    const pulse=battleLive?1.15+Math.sin(t*5)*.12:1+Math.sin(t*1.8)*.05;agentOrb.scale.setScalar(pulse);rivalOrb.scale.setScalar(pulse);
    agentOrb.position.y=1.1+Math.sin(t*2.1)*.12;rivalOrb.position.y=1.1+Math.sin(t*2.1+1.4)*.12;proofOrb.rotation.y=t*1.1;proofOrb.position.y=2.55+Math.sin(t*1.6)*.12;
    bridge.visible=battleLive||current.duelOutcome!=null;
    renderer.render(scene,camera);
  }
  async function init(){
    try{
      THREE=await loadThree();scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(39,1,.1,80);cameraTarget=new THREE.Vector3(0,1.2,0);desiredTarget=cameraTarget.clone();renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;clock=new THREE.Clock();buildWorld();fit();ro=new ResizeObserver(fit);ro.observe(root);running=true;if(reducedMotion)renderer.render(scene,camera);else animate();
      document.addEventListener('visibilitychange',()=>{visible=!document.hidden;});
      document.getElementById('perpsFocusCitadel')?.addEventListener('click',()=>focus('citadel'));
      root.addEventListener('dblclick',()=>focus('all'));
      document.documentElement.classList.add('perps-three-ready');
    }catch(error){console.warn('[KULT Perp Wars] 3D layer unavailable; retaining DOM UI.',error?.message||error);}
  }
  document.addEventListener('kult:perps-state',e=>updateFromState(e.detail||{}));
  window.addEventListener('pagehide',()=>ro?.disconnect(),{once:true});
  init();
})();
