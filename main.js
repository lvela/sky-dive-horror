import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

/* =====================================================================
   SKY DIVE HORROR
   WebXR game for Meta Quest (with a desktop fallback).
   Phases: menu -> cabin (escape the hitmen) -> freefall (dodge) ->
           canopy (steer to target) -> landed | dead
   ===================================================================== */

const CFG = {
  startAltitude: 3200,
  freefallSpeed: 55,      // m/s at terminal velocity
  canopySpeed: 26,        // sped up a bit so the canopy ride stays short
  pullAltitude: 1500,     // chute can be pulled below this
  lateAltitude: 900,      // "PULL NOW" warning below this
  maxHealth: 5,
  playerRadius: 0.22,
  dropSpeed: 80,
  moveCabin: 3.0,
  moveFall: 6.5,
  moveCanopy: 9.0,
  target: new THREE.Vector3(30, 0, -220),
};

// ---------------------------------------------------------------- utils
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const damp = THREE.MathUtils.damp;
const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _s1 = new THREE.Vector3();
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const easeOutBack = (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
const HORIZON = new THREE.Color(0xc4d9ec);
const ZENITH = new THREE.Color(0x3a74c4);
const BELOW = new THREE.Color(0xa9bccb);
scene.background = HORIZON.clone();
scene.fog = new THREE.Fog(HORIZON.clone(), 80, 5200);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 9000);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);
camera.position.set(0, 1.65, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0xdfefff, 0x6b7a5a, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 0.6);
sun.position.set(0.5, 1, 0.35);
scene.add(sun);

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}
const grime = (g, w, h, n, a) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * a})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }
};
const drawWall = (g, w, h) => {
  g.fillStyle = '#3b4136'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#464e40'; g.fillRect(16, 18, w - 32, h * 0.38);
  g.fillStyle = '#40473a'; g.fillRect(16, h * 0.5, w - 32, h * 0.4);
  g.strokeStyle = '#22261f'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = '#23271f';
  for (let i = 12; i < w; i += 24) {
    g.beginPath(); g.arc(i, 10, 3, 0, 7); g.fill();
    g.beginPath(); g.arc(i, h - 10, 3, 0, 7); g.fill();
  }
  grime(g, w, h, 500, 0.18);
};
const drawFloor = (g, w, h) => {
  g.fillStyle = '#34373a'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) {
    for (let x = ((y / 16) % 2) * 8; x < w; x += 16) {
      g.fillStyle = '#4a4e52'; g.fillRect(x, y, 9, 3);
    }
  }
  g.strokeStyle = '#1d1f21'; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
  grime(g, w, h, 300, 0.25);
};
const drawCeil = (g, w, h) => {
  g.fillStyle = '#2a2d29'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#545a50'; g.fillRect(w * 0.2, 0, 14, h); g.fillRect(w * 0.7, 0, 22, h);
  g.fillStyle = '#7a2a20'; g.fillRect(w * 0.45, 0, 8, h);
  grime(g, w, h, 300, 0.2);
};
const drawWood = (g, w, h) => {
  g.fillStyle = '#7d5e34'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += h / 5) {
    g.fillStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.15})`; g.fillRect(0, y, w, 3);
    for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(60,35,10,0.25)'; g.fillRect(0, y + Math.random() * (h / 5), w, 1); }
  }
  g.strokeStyle = '#4a3418'; g.lineWidth = 14; g.strokeRect(0, 0, w, h);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.stroke();
  g.fillStyle = '#1a1a1a'; g.font = 'bold 26px monospace'; g.fillText('FRAGILE', w * 0.22, h * 0.55);
};
const drawStripes = (g, w, h) => {
  g.fillStyle = '#e8c21c'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#111';
  for (let x = -h; x < w; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0); g.fill(); }
};
const drawFields = (g, w, h) => {
  const cols = ['#5f7f3b', '#748f45', '#8d9a4e', '#a59a5a', '#4e6b32', '#6a8a52', '#7d7346', '#93a663', '#56763e'];
  g.fillStyle = '#5d7a3c'; g.fillRect(0, 0, w, h);
  const n = 8, cell = w / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const strips = 1 + ((Math.random() * 3) | 0);
      const vertical = Math.random() < 0.5;
      for (let k = 0; k < strips; k++) {
        g.fillStyle = pick(cols);
        if (vertical) g.fillRect(i * cell + (k * cell) / strips, j * cell, cell / strips, cell);
        else g.fillRect(i * cell, j * cell + (k * cell) / strips, cell, cell / strips);
      }
      g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 1;
      for (let f = 2; f < cell; f += 5) {
        g.beginPath();
        if (vertical) { g.moveTo(i * cell + f, j * cell); g.lineTo(i * cell + f, j * cell + cell); }
        else { g.moveTo(i * cell, j * cell + f); g.lineTo(i * cell + cell, j * cell + f); }
        g.stroke();
      }
    }
  }
  g.strokeStyle = '#3b5426'; g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, h); g.stroke();
    g.beginPath(); g.moveTo(0, i * cell); g.lineTo(w, i * cell); g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const x = rand(80, w - 80), y = rand(80, h - 80), r = rand(20, 60);
    for (let k = 0; k < 45; k++) {
      g.fillStyle = `rgba(36,${(64 + Math.random() * 30) | 0},28,0.85)`;
      g.beginPath(); g.arc(x + rand(-r, r), y + rand(-r, r), rand(4, 10), 0, 7); g.fill();
    }
  }
  g.fillStyle = '#4c6f8a';
  g.beginPath(); g.ellipse(w * 0.72, h * 0.75, 60, 34, 0.4, 0, 7); g.fill();
  g.strokeStyle = '#8a8476'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(0, h * 0.37); g.bezierCurveTo(w * 0.3, h * 0.2, w * 0.6, h * 0.6, w, h * 0.37); g.stroke();
};
const drawGrass = (g, w, h) => {
  g.fillStyle = '#5c8a38'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${(30 + Math.random() * 60) | 0},${(90 + Math.random() * 70) | 0},${(20 + Math.random() * 30) | 0},0.6)`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 2 + Math.random() * 4);
  }
};
const drawTarget = (g, w, h) => {
  const c = w / 2;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#f0f0f0' : '#c81e1e';
    g.beginPath(); g.arc(c, c, c - i * (c / 8), 0, 7); g.fill();
  }
  g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(c, c, c / 10, 0, 7); g.fill();
};
const drawCloud = (g, w, h) => {
  for (let i = 0; i < 16; i++) {
    const x = w / 2 + rand(-60, 60), y = h / 2 + rand(-28, 28), r = rand(40, 90);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const shade = y > h / 2 ? 225 : 255;
    gr.addColorStop(0, `rgba(${shade},${shade},${shade + (255 - shade) / 2},0.5)`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
};
const drawGlow = (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.15, 'rgba(255,245,215,0.8)');
  gr.addColorStop(1, 'rgba(255,230,180,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
};

// ---------------------------------------------------------------- shared geo / mats
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 14, 10),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  cylOpen: new THREE.CylinderGeometry(1, 1, 1, 20, 1, true),
  ring: new THREE.RingGeometry(0.88, 1.05, 32),
};
const matCache = {};
const lam = (color) => (matCache[color] ??= new THREE.MeshLambertMaterial({ color }));
function part(geo, mat, sx, sy, sz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}
function instanced(geo, mat, list) {
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((it, i) => {
    _q1.setFromEuler(new THREE.Euler(0, it.ry || 0, 0));
    _m1.compose(_v1.set(it.x, it.y, it.z), _q1, _s1.set(it.sx, it.sy, it.sz));
    im.setMatrixAt(i, _m1);
  });
  im.instanceMatrix.needsUpdate = true;
  return im;
}

// ---------------------------------------------------------------- sky dome + sun
let sky;
{
  const skyGeo = new THREE.SphereGeometry(7000, 32, 16);
  const pos = skyGeo.attributes.position;
  const cols = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 7000;
    if (h > 0) c.copy(HORIZON).lerp(ZENITH, Math.pow(h, 0.6));
    else c.copy(HORIZON).lerp(BELOW, Math.min(1, -h * 3));
    cols.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: canvasTex(128, 128, drawGlow), color: 0xfff3d0, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
  }));
  sunSprite.scale.setScalar(1100);
  sunSprite.position.copy(sun.position).normalize().multiplyScalar(6500);
  sky.add(sunSprite);
}

// =====================================================================
//  THE PLANE (cargo hold you start in)
// =====================================================================
const CAB = { L: 26, W: 3.6, H: 2.8, front: 13, rear: -13, rampEnd: -15.6 };
const plane = new THREE.Group();
scene.add(plane);
const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0 });
const cabinLights = [];
const props = [];
let doorPivot;
{
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const sideMat = new THREE.MeshLambertMaterial({ map: canvasTex(256, 256, drawWall, [CAB.L / 2.6, 1]), side: THREE.BackSide });
  const ceilMat = new THREE.MeshLambertMaterial({ map: canvasTex(256, 256, drawCeil, [1, CAB.L / 3]), side: THREE.BackSide });
  const floorMat = new THREE.MeshLambertMaterial({ map: canvasTex(256, 256, drawFloor, [2, CAB.L / 1.8]), side: THREE.BackSide });
  const frontMat = new THREE.MeshLambertMaterial({ map: canvasTex(256, 256, drawWall, [1.4, 1]), side: THREE.BackSide });
  // px, nx, py, ny, pz(front wall), nz(open rear)
  const interior = new THREE.Mesh(new THREE.BoxGeometry(CAB.W, CAB.H, CAB.L), [sideMat, sideMat, ceilMat, floorMat, frontMat, hidden]);
  interior.position.set(0, CAB.H / 2, 0);
  plane.add(interior);

  // ribs and ceiling beams
  const ribs = [];
  for (let z = -12.2; z <= 12.2; z += 1.6) {
    ribs.push({ x: -CAB.W / 2 + 0.05, y: CAB.H / 2, z, sx: 0.1, sy: CAB.H, sz: 0.16 });
    ribs.push({ x: CAB.W / 2 - 0.05, y: CAB.H / 2, z, sx: 0.1, sy: CAB.H, sz: 0.16 });
    ribs.push({ x: 0, y: CAB.H - 0.05, z, sx: CAB.W, sy: 0.1, sz: 0.16 });
  }
  plane.add(instanced(GEO.box, lam(0x2c3129), ribs));

  // red webbing jump seats along both walls
  const seats = [];
  for (let z = -9.5; z <= 8.5; z += 0.55) {
    for (const side of [-1, 1]) {
      seats.push({ x: side * (CAB.W / 2 - 0.3), y: 0.45, z, sx: 0.42, sy: 0.07, sz: 0.46 });
      seats.push({ x: side * (CAB.W / 2 - 0.1), y: 0.85, z, sx: 0.04, sy: 0.6, sz: 0.46 });
    }
  }
  plane.add(instanced(GEO.box, lam(0x7a1d1a), seats));

  // crates near the cockpit and near the ramp
  const crates = [];
  for (const side of [-1, 1]) {
    for (const z of [10.2, 11.0, 11.8, -11.0, -11.8]) {
      crates.push({ x: side * 1.45, y: 0.3, z, sx: 0.6, sy: 0.6, sz: 0.7, ry: rand(-0.1, 0.1) });
      if (Math.random() < 0.6) crates.push({ x: side * 1.45, y: 0.9, z, sx: 0.55, sy: 0.6, sz: 0.6, ry: rand(-0.2, 0.2) });
    }
  }
  plane.add(instanced(GEO.box, new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, drawWood) }), crates));

  // ceiling lamps
  const lamps = [];
  for (let z = -11; z <= 11; z += 3.6) lamps.push({ x: 0, y: CAB.H - 0.14, z, sx: 0.32, sy: 0.05, sz: 0.32 });
  plane.add(instanced(GEO.box, lampMat, lamps));
  for (const z of [7, -1, -9]) {
    const pl = new THREE.PointLight(0xffd8a0, 5, 14, 1.6);
    pl.position.set(0, CAB.H - 0.35, z);
    plane.add(pl);
    cabinLights.push(pl);
  }

  // cockpit doorway + door
  const doorway = part(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x030303 }), 1.0, 2.0, 1, 0, 1.0, CAB.front - 0.02);
  doorway.rotation.y = Math.PI;
  plane.add(doorway);
  doorPivot = new THREE.Group();
  doorPivot.position.set(-0.5, 0, CAB.front - 0.06);
  doorPivot.add(part(GEO.box, lam(0x50564c), 1.0, 2.0, 0.06, 0.5, 1.0, 0));
  doorPivot.add(part(GEO.box, lam(0x0e1012), 0.35, 0.25, 0.07, 0.5, 1.55, 0));
  plane.add(doorPivot);

  // rear ramp
  const rampMat = new THREE.MeshLambertMaterial({ map: canvasTex(256, 256, drawFloor, [2, 1.5]) });
  const rampLen = CAB.rear - CAB.rampEnd;
  plane.add(part(GEO.box, rampMat, CAB.W, 0.12, rampLen, 0, -0.06, CAB.rear - rampLen / 2));
  plane.add(part(GEO.box, new THREE.MeshLambertMaterial({ map: canvasTex(256, 32, drawStripes) }), CAB.W, 0.02, 0.3, 0, 0.01, CAB.rampEnd + 0.15));
  for (const side of [-1, 1]) plane.add(part(GEO.box, lam(0xc9a21a), 0.06, 0.06, rampLen, side * 1.6, 0.9, CAB.rear - rampLen / 2));

  // exterior hull
  const hullMat = new THREE.MeshLambertMaterial({ color: 0x6e757d, side: THREE.DoubleSide });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.35, 30, 24, 1, true), hullMat);
  fus.rotation.x = Math.PI / 2;
  fus.position.set(0, 1.4, -0.5);
  plane.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(2.35, 4.5, 24, 1, true), hullMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.4, 14.5 + 2.25);
  plane.add(nose);
  plane.add(part(GEO.box, lam(0x161a20), 2.0, 0.45, 1.2, 0, 2.5, 15.3));
  plane.add(part(GEO.box, hullMat, 34, 0.35, 4.2, 0, 3.75, 1.5));
  plane.add(part(GEO.box, hullMat, 0.3, 4.5, 4, 0, 6.0, -12.5));
  plane.add(part(GEO.box, hullMat, 12, 0.25, 3, 0, 4.0, -13.5));
  for (const x of [-10, -5, 5, 10]) {
    const eng = part(GEO.cyl, lam(0x4a4f55), 0.6, 3.2, 0.6, x, 3.2, 3.2);
    eng.rotation.x = Math.PI / 2;
    plane.add(eng);
    const prop = new THREE.Group();
    prop.position.set(x, 3.2, 4.9);
    prop.add(part(GEO.box, lam(0x1a1a1a), 0.2, 3.2, 0.05));
    prop.add(part(GEO.box, lam(0x1a1a1a), 3.2, 0.2, 0.05));
    plane.add(prop);
    props.push(prop);
  }
}

// =====================================================================
//  THE GROUND (landing zone)
// =====================================================================
const groundGroup = new THREE.Group();
scene.add(groundGroup);
const policeLights = [];
{
  const T = CFG.target;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(28000, 28000), new THREE.MeshLambertMaterial({ map: canvasTex(1024, 1024, drawFields, [70, 70]) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(T.x, 0, T.z);
  groundGroup.add(ground);

  const off = (f, u) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: u });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshLambertMaterial({ map: canvasTex(256, 256, drawGrass, [40, 40]), ...off(-1, -4) }));
  field.rotation.x = -Math.PI / 2;
  field.position.set(T.x, 0, T.z);
  groundGroup.add(field);

  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 6000), new THREE.MeshLambertMaterial({ color: 0x55575a, ...off(-2, -8) }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(T.x + 95, 0, T.z);
  groundGroup.add(road);

  const target = new THREE.Mesh(new THREE.CircleGeometry(22, 64), new THREE.MeshLambertMaterial({ map: canvasTex(512, 512, drawTarget), ...off(-3, -12) }));
  target.rotation.x = -Math.PI / 2;
  target.position.set(T.x, 0, T.z);
  groundGroup.add(target);

  // orange signal smoke so you can find the target from altitude
  const smoke = new THREE.Mesh(new THREE.CylinderGeometry(30, 3, 600, 20, 1, true), new THREE.MeshBasicMaterial({
    color: 0xff7a1a, transparent: true, opacity: 0.16, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  smoke.position.set(T.x, 300, T.z);
  groundGroup.add(smoke);

  const crowns = [], trunks = [];
  for (let i = 0; i < 380; i++) {
    const a = rand(0, Math.PI * 2), r = rand(175, 1300), s = rand(0.7, 1.5);
    const x = T.x + Math.cos(a) * r, z = T.z + Math.sin(a) * r;
    if (Math.abs(x - (T.x + 95)) < 8) continue;
    crowns.push({ x, y: (2 + 3.5) * s, z, sx: 2.6 * s, sy: 7 * s, sz: 2.6 * s });
    trunks.push({ x, y: 1 * s, z, sx: 0.35 * s, sy: 2 * s, sz: 0.35 * s });
  }
  groundGroup.add(instanced(new THREE.ConeGeometry(1, 1, 7), lam(0x2f5a2a), crowns));
  groundGroup.add(instanced(GEO.cyl, lam(0x5a3f24), trunks));

  const houses = [], roofs = [];
  for (let i = 0; i < 26; i++) {
    const x = T.x + 95 + (i % 2 ? 18 : -18) + rand(-4, 4);
    const z = T.z + rand(-900, 900);
    if (Math.abs(z - T.z) < 180) continue;
    houses.push({ x, y: 2.5, z, sx: 8, sy: 5, sz: 11 });
    roofs.push({ x, y: 6.5, z, sx: 6.6, sy: 3, sz: 8.6, ry: Math.PI / 4 });
  }
  groundGroup.add(instanced(GEO.box, lam(0xd8cdb4), houses));
  groundGroup.add(instanced(new THREE.ConeGeometry(1, 1, 4), lam(0x8c3226), roofs));

  // police cars waiting at the landing zone (for the criminals)
  const red = new THREE.MeshBasicMaterial({ color: 0xff1010 });
  const blue = new THREE.MeshBasicMaterial({ color: 0x1030ff });
  policeLights.push(red, blue);
  for (const dz of [-14, 0, 14]) {
    const car = new THREE.Group();
    car.add(part(GEO.box, lam(0xeeeeee), 2.0, 0.8, 4.5, 0, 0.6, 0));
    car.add(part(GEO.box, lam(0x1a2340), 1.8, 0.6, 2.3, 0, 1.3, -0.2));
    car.add(part(GEO.box, red, 0.6, 0.15, 0.3, -0.35, 1.67, -0.2));
    car.add(part(GEO.box, blue, 0.6, 0.15, 0.3, 0.35, 1.67, -0.2));
    car.position.set(T.x + 88, 0, T.z + dz);
    car.rotation.y = rand(-0.4, 0.4);
    groundGroup.add(car);
  }
}

// =====================================================================
//  CLOUDS (one instanced mesh of camera-facing quads)
// =====================================================================
const cloudData = [];
function addCluster(cx, calt, cz, n, smin, smax, spread) {
  for (let i = 0; i < n; i++) {
    cloudData.push({ x: cx + rand(-spread, spread), alt: calt + rand(-spread * 0.25, spread * 0.25), z: cz + rand(-spread, spread), s: rand(smin, smax) });
  }
}
for (let i = 0; i < 70; i++) {
  const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 850;
  addCluster(CFG.target.x * 0.5 + Math.cos(a) * r, rand(1900, 2500), CFG.target.z * 0.5 + Math.sin(a) * r, 6, 50, 110, 45);
}
for (let i = 0; i < 6; i++) addCluster(rand(-25, 25) + (CFG.target.x * i) / 12, 2050 + i * 70, -15 + (CFG.target.z * i) / 12, 6, 60, 120, 30);
for (let i = 0; i < 14; i++) addCluster(rand(-900, 900), rand(3500, 3900), rand(-900, 900), 5, 90, 170, 70);
const clouds = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: canvasTex(256, 256, drawCloud), transparent: true, depthWrite: false, opacity: 0.92 }),
  cloudData.length,
);
clouds.frustumCulled = false;
scene.add(clouds);

// ---------------------------------------------------------------- speed lines
const SL_N = 90;
const slPos = new Float32Array(SL_N * 6);
const slData = [];
const newLine = (d) => { const a = rand(0, Math.PI * 2), r = rand(1.2, 7); d.x = Math.cos(a) * r; d.z = Math.sin(a) * r; return d; };
for (let i = 0; i < SL_N; i++) slData.push(newLine({ y: rand(-12, 12) }));
const slGeo = new THREE.BufferGeometry();
slGeo.setAttribute('position', new THREE.BufferAttribute(slPos, 3));
const slMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
const speedLines = new THREE.LineSegments(slGeo, slMat);
speedLines.frustumCulled = false;
scene.add(speedLines);

// =====================================================================
//  HITMEN
// =====================================================================
const thugMats = { suit: lam(0x17181c), mask: lam(0x0c0c0e), pants: lam(0x24262b), gun: lam(0x2b2b2b) };
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });

function makeThug(withGun) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.95;
  root.add(body);
  body.add(part(GEO.box, thugMats.suit, 0.48, 0.66, 0.26, 0, 0.35, 0));
  body.add(part(GEO.sphere, thugMats.mask, 0.14, 0.15, 0.14, 0, 0.83, 0));
  body.add(part(GEO.sphere, eyeMat, 0.03, 0.02, 0.02, -0.05, 0.85, 0.125));
  body.add(part(GEO.sphere, eyeMat, 0.03, 0.02, 0.02, 0.05, 0.85, 0.125));
  const limb = (x, y, w, h, mat) => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    p.add(part(GEO.box, mat, w, h, w, 0, -h / 2, 0));
    body.add(p);
    return p;
  };
  const armL = limb(0.31, 0.64, 0.13, 0.62, thugMats.suit);
  const armR = limb(-0.31, 0.64, 0.13, 0.62, thugMats.suit);
  const legL = limb(0.13, 0.02, 0.18, 0.93, thugMats.pants);
  const legR = limb(-0.13, 0.02, 0.18, 0.93, thugMats.pants);
  const hand = new THREE.Object3D();
  hand.position.set(0, -0.66, 0);
  armR.add(hand);
  let muzzle = null, flash = null;
  if (withGun) {
    armR.add(part(GEO.box, thugMats.gun, 0.06, 0.3, 0.1, 0, -0.7, 0.04));
    muzzle = new THREE.Object3D();
    muzzle.position.set(0, -0.86, 0.04);
    armR.add(muzzle);
    flash = part(GEO.sphere, flashMat, 0.08, 0.13, 0.08, 0, -0.92, 0.04);
    flash.visible = false;
    armR.add(flash);
  }
  root.userData = { body, armL, armR, legL, legR, hand, muzzle, flash, timer: 1, state: 'idle', st: 0, walk: 0, flashT: 0 };
  return root;
}

const CAB_LANES = [-0.55, 0.55, 0.0];
const cabinThugs = CAB_LANES.map(() => { const t = makeThug(true); plane.add(t); return t; });

const FF_SLOTS = [
  { slot: -0.5, dist: 19, yoff: -1.2 },
  { slot: 0.0, dist: 23, yoff: 1.2 },
  { slot: 0.5, dist: 19, yoff: -0.4 },
];
const ffThugs = FF_SLOTS.map((s) => {
  const t = makeThug(false);
  const d = t.userData;
  Object.assign(d, s);
  d.body.rotation.x = 1.25;
  d.armL.rotation.z = 1.2;
  d.legL.rotation.z = 0.25;
  d.legR.rotation.z = -0.25;
  t.visible = false;
  scene.add(t);
  return t;
});

// =====================================================================
//  OBSTACLES
// =====================================================================
const woodMat = new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, drawWood) });
const bombLight = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const OBSTACLES = [
  { r: 0.45, make() { // suitcase
    const g = new THREE.Group();
    g.add(part(GEO.box, lam(pick([0x6b3e26, 0x1f3b6b, 0x8a1c1c, 0x2b2b2b])), 0.75, 0.5, 0.25));
    g.add(part(GEO.box, lam(0x111111), 0.22, 0.06, 0.06, 0, 0.28, 0));
    return g;
  } },
  { r: 0.6, make() { // airplane seat
    const g = new THREE.Group();
    const c = lam(pick([0x23408a, 0x8a2323, 0x3a3a3a]));
    g.add(part(GEO.box, c, 0.6, 0.16, 0.6));
    g.add(part(GEO.box, c, 0.6, 0.8, 0.14, 0, 0.4, -0.27));
    g.add(part(GEO.box, lam(0x777777), 0.08, 0.35, 0.08, 0.25, -0.25, 0));
    g.add(part(GEO.box, lam(0x777777), 0.08, 0.35, 0.08, -0.25, -0.25, 0));
    return g;
  } },
  { r: 0.5, make() { // barrel
    const g = new THREE.Group();
    g.add(part(GEO.cyl, lam(pick([0x2f5a2f, 0x8b1a1a, 0x1d4f8a])), 0.32, 0.9, 0.32));
    g.add(part(GEO.cyl, lam(0x222222), 0.33, 0.05, 0.33, 0, 0.25, 0));
    g.add(part(GEO.cyl, lam(0x222222), 0.33, 0.05, 0.33, 0, -0.25, 0));
    return g;
  } },
  { r: 0.4, make() { // bomb
    const g = new THREE.Group();
    g.add(part(GEO.sphere, lam(0x111111), 0.33, 0.33, 0.33));
    g.add(part(GEO.cyl, lam(0x444444), 0.1, 0.12, 0.1, 0, 0.36, 0));
    g.add(part(GEO.sphere, bombLight, 0.06, 0.06, 0.06, 0, 0.45, 0));
    return g;
  } },
  { r: 0.3, make() { // fire extinguisher
    const g = new THREE.Group();
    g.add(part(GEO.cyl, lam(0xc81e1e), 0.12, 0.55, 0.12));
    g.add(part(GEO.box, lam(0x222222), 0.06, 0.12, 0.2, 0, 0.32, 0.05));
    return g;
  } },
  { r: 0.55, make() { // crate
    const g = new THREE.Group();
    g.add(part(GEO.box, woodMat, 0.8, 0.8, 0.8));
    return g;
  } },
];

const obstacles = [];
const columnPool = [];
function getColumn(R, y) {
  let col = columnPool.pop();
  if (!col) {
    col = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const ringMat = mat.clone();
    ringMat.side = THREE.DoubleSide;
    const cyl = new THREE.Mesh(GEO.cylOpen, mat);
    const ring = new THREE.Mesh(GEO.ring, ringMat);
    ring.rotation.x = -Math.PI / 2;
    col.add(cyl, ring);
    col.userData = { cyl, ring, mat, ringMat };
  }
  const d = col.userData;
  d.cyl.scale.set(R, 160, R);
  d.cyl.position.y = y;
  d.ring.scale.set(R, R, 1);
  d.ring.position.y = y - 0.6;
  d.mat.opacity = 0;
  d.ringMat.opacity = 0;
  col.visible = true;
  scene.add(col);
  return col;
}
function releaseColumn(col) {
  scene.remove(col);
  columnPool.push(col);
}

// ---------------------------------------------------------------- bullets
const bullets = [];
const bulletGeo = new THREE.BoxGeometry(0.03, 0.03, 0.6);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });

// =====================================================================
//  PARACHUTE + TARGET ARROW
// =====================================================================
const canopy = new THREE.Group();
{
  const tex = canvasTex(512, 64, (g, w, h) => {
    const n = 10;
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#f0f0f0' : '#d42a2a'; g.fillRect((i * w) / n, 0, w / n, h); }
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, 1.0),
    new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }),
  );
  dome.scale.set(5, 2.2, 3.6);
  dome.position.y = -Math.cos(1.0) * 2.2;
  canopy.add(dome);
  canopy.visible = false;
  scene.add(canopy);
}
const RIM = [];
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  RIM.push(new THREE.Vector3(Math.cos(a) * Math.sin(1) * 5, 0, Math.sin(a) * Math.sin(1) * 3.6));
}
const lineGeo = new THREE.BufferGeometry();
lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RIM.length * 6), 3));
const chuteLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x222222 }));
chuteLines.frustumCulled = false;
chuteLines.visible = false;
scene.add(chuteLines);

const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 12).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23a, fog: false }));
arrow.visible = false;
scene.add(arrow);

// =====================================================================
//  HUD (head-locked canvas), damage flash, hands
// =====================================================================
const hudCanvas = document.createElement('canvas');
hudCanvas.width = 1024; hudCanvas.height = 512;
const hudCtx = hudCanvas.getContext('2d');
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
const hud = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
hud.position.set(0, -0.05, -1.2);
hud.renderOrder = 1000;
camera.add(hud);

const flashSphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 8), new THREE.MeshBasicMaterial({
  color: 0xff0000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
}));
flashSphere.renderOrder = 999;
camera.add(flashSphere);

for (let i = 0; i < 2; i++) {
  const grip = renderer.xr.getControllerGrip(i);
  const glove = new THREE.Group();
  glove.add(part(GEO.box, lam(0x2a2a2a), 0.08, 0.05, 0.14, 0, 0, 0.02));
  glove.add(part(GEO.box, lam(0x1b1b1b), 0.085, 0.07, 0.05, 0, -0.01, 0.08));
  grip.add(glove);
  rig.add(grip);
}

// =====================================================================
//  AUDIO (all procedurally generated, no files to load)
// =====================================================================
const listener = new THREE.AudioListener();
camera.add(listener);
const AC = listener.context;
const SR = AC.sampleRate;
function makeBuf(sec, fn) {
  const n = Math.floor(sec * SR);
  const b = AC.createBuffer(1, n, SR);
  const d = b.getChannelData(0);
  const st = { lp: 0, ph: 0 };
  for (let i = 0; i < n; i++) d[i] = fn(i / SR, st);
  return b;
}
const nz = () => Math.random() * 2 - 1;
const SND = {
  noise: makeBuf(3, () => nz() * 0.6),
  shot: makeBuf(0.5, (t, s) => { s.lp = s.lp * 0.6 + nz() * 0.4; return nz() * Math.exp(-t * 35) * 0.9 + s.lp * Math.exp(-t * 10) * 0.6 + Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 14) * 0.7; }),
  thud: makeBuf(0.6, (t) => Math.sin(2 * Math.PI * (90 - 60 * t) * t) * Math.exp(-t * 7) * 0.9 + nz() * Math.exp(-t * 30) * 0.4),
  whoosh: makeBuf(0.9, (t, s) => { const env = Math.sin((Math.PI * t) / 0.9) ** 2; s.lp += (nz() - s.lp) * (0.05 + 0.25 * env); return s.lp * env * 1.8; }),
  whistle: makeBuf(1.6, (t, s) => { s.ph += (2 * Math.PI * (2200 - 1300 * (t / 1.6))) / SR; return Math.sin(s.ph) * 0.22 * Math.min(1, t * 4) * (0.5 + 0.5 * (t / 1.6)); }),
  flap: makeBuf(1.5, (t, s) => { s.lp += (nz() - s.lp) * 0.2; return s.lp * (0.5 + 0.5 * Math.sin(2 * Math.PI * 14 * t)) * Math.exp(-t * 2.2) * 1.8 + (t < 0.15 ? nz() * 0.8 * (1 - t / 0.15) : 0); }),
  engine: makeBuf(2, (t, s) => { s.lp += (nz() - s.lp) * 0.03; return 0.35 * Math.sin(2 * Math.PI * 48 * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 6 * t)) + 0.15 * Math.sin(2 * Math.PI * 96 * t) + s.lp * 1.5; }),
  alarm: makeBuf(1, (t) => Math.sign(Math.sin(2 * Math.PI * (t < 0.5 ? 660 : 520) * t)) * 0.12),
  boom: makeBuf(2, (t, s) => { s.lp += (nz() - s.lp) * 0.08; return s.lp * Math.exp(-t * 2.5) * 2.5 + Math.sin(2 * Math.PI * (50 - 15 * t) * t) * Math.exp(-t * 3) * 0.8; }),
};
function loopSound(buffer) {
  const a = new THREE.Audio(listener);
  a.setBuffer(buffer);
  a.setLoop(true);
  a.setVolume(0);
  return a;
}
const windSnd = loopSound(SND.noise);
const windFilter = AC.createBiquadFilter();
windFilter.type = 'lowpass';
windFilter.frequency.value = 400;
windSnd.setFilter(windFilter);
const engineSnd = loopSound(SND.engine);
const alarmSnd = loopSound(SND.alarm);

const sfxPool = Array.from({ length: 14 }, () => {
  const a = new THREE.PositionalAudio(listener);
  a.setRefDistance(4);
  a.setRolloffFactor(1.1);
  scene.add(a);
  return a;
});
let sfxI = 0;
function sfxAt(buffer, pos, vol = 1, rate = 1, follow = null) {
  if (AC.state !== 'running') return;
  const a = sfxPool[sfxI++ % sfxPool.length];
  if (a.isPlaying) a.stop();
  a.position.copy(pos);
  a.userData.follow = follow;
  a.setBuffer(buffer);
  a.setVolume(vol);
  a.setPlaybackRate(rate);
  a.play();
}
const sfx2DPool = Array.from({ length: 4 }, () => new THREE.Audio(listener));
let sfx2DI = 0;
function sfx(buffer, vol = 1, rate = 1) {
  if (AC.state !== 'running') return;
  const a = sfx2DPool[sfx2DI++ % sfx2DPool.length];
  if (a.isPlaying) a.stop();
  a.setBuffer(buffer);
  a.setVolume(vol);
  a.setPlaybackRate(rate);
  a.play();
}
function unlockAudio() {
  if (AC.state !== 'running') AC.resume();
  if (!windSnd.isPlaying) { windSnd.play(); engineSnd.play(); alarmSnd.play(); }
}
document.addEventListener('pointerdown', unlockAudio);
document.addEventListener('keydown', unlockAudio);

function haptic(intensity, ms) {
  const s = renderer.xr.getSession();
  if (!s) return;
  for (const src of s.inputSources) {
    const h = src.gamepad?.hapticActuators?.[0];
    if (h?.pulse) h.pulse(intensity, ms);
  }
}

// =====================================================================
//  STATE
// =====================================================================
const G = {
  phase: 'menu', phaseTime: 0, time: 0,
  health: CFG.maxHealth, altitude: CFG.startAltitude, fallSpeed: 0,
  invuln: 0, flash: 0, fade: 0,
  doorOpened: false, ffThugsOn: false, dropTimer: 0, frontYaw: 0, planeT: 0, canopyOpen: 0,
  msg: null, hint: '', hintColor: '#ffffff', hintFlash: false, recenter: 0, result: null, inDanger: false,
};
let best = 0;
try { best = Number(localStorage.getItem('skydive-horror-best')) || 0; } catch (e) { /* storage unavailable */ }

function setMessage(big, small = '', dur = 0, color = '#ffffff') {
  G.msg = { big, small, color, until: dur ? G.time + dur : Infinity };
}
const isVR = () => renderer.xr.isPresenting;
const btn = (vr, desk) => (isVR() ? vr : desk);

// ---------------------------------------------------------------- head / rig helpers
const head = new THREE.Vector3();
const headDir = new THREE.Vector3(0, 0, -1);
const yawOf = (d) => Math.atan2(-d.x, -d.z);
function refreshHead() {
  camera.getWorldPosition(head);
  camera.getWorldDirection(headDir);
  headDir.y = 0;
  if (headDir.lengthSq() < 1e-6) headDir.set(0, 0, -1);
  headDir.normalize();
}
function rotateRigAroundHead(angle) {
  refreshHead();
  rig.position.sub(head).applyAxisAngle(UP, angle).add(head);
  rig.rotation.y += angle;
  refreshHead();
}
function placeHead(x, z, yaw) {
  refreshHead();
  rotateRigAroundHead(yaw - yawOf(headDir));
  rig.position.x += x - head.x;
  rig.position.z += z - head.z;
  refreshHead();
}

// ---------------------------------------------------------------- input
const keys = {};
const input = { mx: 0, my: 0, turnLatch: false };
let dYaw = 0, dPitch = 0;
const moveVec = new THREE.Vector3();

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space' && !e.repeat) { e.preventDefault(); onAction(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
function lockPointer() {
  try { renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); } catch (e) { /* not available */ }
}
renderer.domElement.addEventListener('mousedown', () => {
  if (isVR()) return;
  if (document.pointerLockElement !== renderer.domElement) lockPointer();
  else onAction();
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  dYaw -= e.movementX * 0.0022;
  dPitch = clamp(dPitch - e.movementY * 0.0022, -1.5, 1.5);
});

function readInput() {
  input.mx = 0; input.my = 0;
  let tx = 0;
  if (keys.KeyW || keys.ArrowUp) input.my -= 1;
  if (keys.KeyS || keys.ArrowDown) input.my += 1;
  if (keys.KeyA || keys.ArrowLeft) input.mx -= 1;
  if (keys.KeyD || keys.ArrowRight) input.mx += 1;
  const session = renderer.xr.getSession();
  if (session) {
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp || gp.axes.length < 4) continue;
      if (src.handedness === 'left') { input.mx += gp.axes[2]; input.my += gp.axes[3]; }
      else if (src.handedness === 'right') tx = gp.axes[2];
    }
  }
  if (Math.abs(tx) > 0.7) {
    if (!input.turnLatch && G.phase !== 'menu') { input.turnLatch = true; rotateRigAroundHead(tx > 0 ? -Math.PI / 6 : Math.PI / 6); }
  } else if (Math.abs(tx) < 0.3) input.turnLatch = false;
}

function applyMove(speed, dt) {
  let mx = input.mx, my = input.my;
  const len = Math.hypot(mx, my);
  if (len < 0.15) { mx = 0; my = 0; } else if (len > 1) { mx /= len; my /= len; }
  const fx = headDir.x, fz = headDir.z;
  const rx = -fz, rz = fx;
  moveVec.set((fx * -my + rx * mx) * speed, 0, (fz * -my + rz * mx) * speed);
  rig.position.addScaledVector(moveVec, dt);
  head.addScaledVector(moveVec, dt);
}

// ---------------------------------------------------------------- collision
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
function segSegDist2(p1, q1, p2, q2) {
  _d1.subVectors(q1, p1); _d2.subVectors(q2, p2); _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s, t;
  if (a <= 1e-8 && e <= 1e-8) return _r.lengthSq();
  if (a <= 1e-8) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-8) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = _d1.dot(_d2), denom = a * e - b * b;
      s = denom > 1e-10 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s);
  _c2.copy(p2).addScaledVector(_d2, t);
  return _c1.distanceToSquared(_c2);
}
const capA = new THREE.Vector3(), capB = new THREE.Vector3();
function capsuleHit(p, q, r) {
  capA.copy(head); capA.y += 0.1;
  capB.copy(head); capB.y -= 1.15;
  const R = r + CFG.playerRadius;
  return segSegDist2(p, q, capA, capB) < R * R;
}

// =====================================================================
//  GAME FLOW
// =====================================================================
const overlay = document.getElementById('overlay');
document.getElementById('play').addEventListener('click', () => {
  unlockAudio();
  lockPointer();
  if (G.phase !== 'menu') reset();
  startGame();
});

function clearObstacles() {
  for (const o of obstacles) { if (o.obj) scene.remove(o.obj); if (o.col) releaseColumn(o.col); }
  obstacles.length = 0;
  for (const b of bullets) scene.remove(b.mesh);
  bullets.length = 0;
  for (const a of sfxPool) a.userData.follow = null;
}

function reset() {
  clearObstacles();
  plane.position.set(0, 0, 0);
  plane.visible = true;
  doorPivot.rotation.y = 0;
  cabinThugs.forEach((t, i) => {
    t.visible = false;
    t.position.set(CAB_LANES[i], 0, 12.5);
    t.userData.timer = rand(0.3, 1.2);
  });
  ffThugs.forEach((t) => { t.visible = false; t.userData.active = false; });
  canopy.visible = false;
  canopy.rotation.set(0, 0, 0);
  chuteLines.visible = false;
  arrow.visible = false;
  Object.assign(G, {
    phase: 'menu', phaseTime: 0, health: CFG.maxHealth, altitude: CFG.startAltitude, fallSpeed: 0,
    invuln: 0, flash: 0, fade: 0, doorOpened: false, ffThugsOn: false, dropTimer: 0, planeT: 0, canopyOpen: 0,
    hint: '', hintFlash: false, hintColor: '#ffffff', result: null, inDanger: false,
  });
  if (isVR()) {
    rig.rotation.set(0, 0, 0);
    G.recenter = 3;
  } else {
    rig.position.set(0, 0, 6);
    rig.rotation.set(0, 0, 0);
    dYaw = 0; dPitch = 0;
  }
  setMessage('SKY DIVE HORROR', 'You saw a mob hit. Now you are on their plane.');
  G.hint = btn('Pull TRIGGER to begin', 'Press SPACE to begin');
}

function startGame() {
  if (isVR()) placeHead(0, 6, 0);
  G.phase = 'cabin';
  G.phaseTime = 0;
  overlay.classList.add('hidden');
  setMessage('WHAT WAS THAT?!', 'Gunshots... from the cockpit', 2.5, '#ff5544');
  G.hint = btn('Move: left stick  •  Turn: right stick', 'WASD move  •  Mouse look  •  C duck');
}

function onAction() {
  unlockAudio();
  switch (G.phase) {
    case 'menu':
      startGame();
      break;
    case 'freefall':
      if (G.altitude <= CFG.pullAltitude) deployChute();
      else setMessage('TOO HIGH', `Wait until below ${CFG.pullAltitude} m`, 1.5, '#ffd23a');
      break;
    case 'dead':
    case 'landed':
      if (G.phaseTime > 1.5) { reset(); startGame(); }
      break;
  }
}

function damage(reason) {
  if (G.invuln > 0 || G.phase === 'dead' || G.phase === 'landed') return;
  G.health--;
  G.invuln = 0.9;
  G.flash = 0.75;
  haptic(1.0, 160);
  sfx(SND.thud, 1.2, rand(0.9, 1.1));
  if (G.health <= 0) die(reason);
}

function die(reason) {
  G.phase = 'dead';
  G.phaseTime = 0;
  sfx(SND.boom, 1.0);
  setMessage('YOU DIED', reason, 0, '#ff3b3b');
  G.hint = btn('Pull TRIGGER to try again', 'Press SPACE to try again');
  G.hintFlash = false;
  G.hintColor = '#ffffff';
}

function beginFreefall() {
  G.phase = 'freefall';
  G.phaseTime = 0;
  G.fallSpeed = 4;
  G.planeT = 0;
  G.dropTimer = 2.5;
  G.frontYaw = yawOf(headDir);
  for (const b of bullets) scene.remove(b.mesh);
  bullets.length = 0;
  setMessage('FREEFALL!', 'Dodge everything they throw at you', 3, '#7fd4ff');
  G.hint = '';
  haptic(0.6, 300);
}

function deployChute() {
  G.phase = 'canopy';
  G.phaseTime = 0;
  G.canopyOpen = 0;
  G.dropTimer = 2.5;
  canopy.visible = true;
  chuteLines.visible = true;
  canopy.rotation.set(0, G.frontYaw, 0);
  sfx(SND.flap, 1.3);
  haptic(1.0, 400);
  setMessage('CHUTE OPEN', 'Steer to the orange smoke and the target', 4, '#7dff8a');
  G.hint = '';
  for (const t of ffThugs) { t.userData.leaving = true; t.userData.leaveT = 0; }
}

function land() {
  G.phase = 'landed';
  G.phaseTime = 0;
  sfx(SND.thud, 1.0, 0.7);
  haptic(0.8, 200);
  clearObstacles();
  arrow.visible = false;
  chuteLines.visible = false;
  const dist = Math.hypot(CFG.target.x - head.x, CFG.target.z - head.z);
  const score = G.health * 500 + Math.max(0, Math.round(2000 - dist * 10));
  const rating = dist < 8 ? 'BULLSEYE!' : dist < 25 ? 'Great landing' : dist < 80 ? 'Rough landing' : 'Lost in the countryside';
  if (score > best) { best = score; try { localStorage.setItem('skydive-horror-best', String(best)); } catch (e) { /* ignore */ } }
  setMessage('YOU SURVIVED', `${rating}  •  ${Math.round(dist)} m from target  •  Score ${score}`, 0, '#7dff8a');
  G.result = { score, best };
  G.hint = btn('Pull TRIGGER to play again', 'Press SPACE to play again');
}

// =====================================================================
//  PHASE: CABIN
// =====================================================================
function shoot(th) {
  const d = th.userData;
  const from = d.muzzle.getWorldPosition(new THREE.Vector3());
  const target = head.clone();
  // sloppy aim that gets worse the farther away you are
  const spread = 0.45 + from.distanceTo(head) * 0.04;
  target.x += rand(-spread, spread);
  target.y += rand(-0.9, 0.35);
  target.z += rand(-0.2, 0.2);
  const vel = target.sub(from).normalize().multiplyScalar(22);
  const mesh = new THREE.Mesh(bulletGeo, bulletMat);
  mesh.position.copy(from);
  mesh.lookAt(_v1.copy(from).add(vel));
  scene.add(mesh);
  bullets.push({ mesh, vel, prev: from.clone(), t: 0 });
  d.flashT = 0.06;
  sfxAt(SND.shot, from, 1.5, rand(0.9, 1.1));
}

function updateCabin(dt) {
  const t = G.phaseTime;
  if (!G.doorOpened && t > 1.4) {
    G.doorOpened = true;
    cabinThugs.forEach((th) => { th.visible = true; });
    sfxAt(SND.shot, _v1.set(0, 1.2, CAB.front), 2, 0.6);
    setMessage('THEY FOUND YOU', 'Run to the open ramp and JUMP!', 4, '#ff3b2f');
  }
  if (G.doorOpened) doorPivot.rotation.y = damp(doorPivot.rotation.y, 1.9, 8, dt);

  applyMove(CFG.moveCabin, dt);
  // keep the player inside the hold
  const cx = clamp(head.x, -1.15, 1.15) - head.x;
  const cz = Math.min(head.z, CAB.front - 0.9) - head.z;
  rig.position.x += cx; rig.position.z += cz;
  head.x += cx; head.z += cz;

  for (let i = 0; i < cabinThugs.length; i++) {
    const th = cabinThugs[i], d = th.userData;
    if (!th.visible) continue;
    const tz = clamp(head.z + 4.5 + i * 1.4, -12.5, 12.4), tx = CAB_LANES[i];
    const dx = tx - th.position.x, dz = tz - th.position.z;
    const dist = Math.hypot(dx, dz);
    const walking = dist > 0.05;
    if (walking) {
      const step = Math.min(dist, 1.9 * dt);
      th.position.x += (dx / dist) * step;
      th.position.z += (dz / dist) * step;
      d.walk += dt * 9;
    }
    const sw = walking ? Math.sin(d.walk) * 0.5 : 0;
    d.legL.rotation.x = sw; d.legR.rotation.x = -sw; d.armL.rotation.x = -sw * 0.6;
    th.lookAt(head.x, 0, head.z);
    const sh = d.armR.getWorldPosition(_v2);
    const elev = Math.atan2(head.y - 0.3 - sh.y, Math.hypot(head.x - sh.x, head.z - sh.z));
    d.armR.rotation.x = -Math.PI / 2 - elev;
    d.flashT -= dt;
    d.flash.visible = d.flashT > 0;
    d.timer -= dt;
    if (t > 3.2 && d.timer <= 0) { shoot(th); d.timer = rand(1.6, 2.8); }
  }

  updateBullets(dt);
  if (G.phase === 'cabin' && head.z < CAB.rampEnd + 0.1) beginFreefall();
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.t += dt;
    b.prev.copy(b.mesh.position);
    b.mesh.position.addScaledVector(b.vel, dt);
    let dead = b.t > 2;
    if (capsuleHit(b.prev, b.mesh.position, 0.04)) { damage('Gunned down in the cargo hold'); dead = true; }
    if (dead) { scene.remove(b.mesh); bullets.splice(i, 1); }
  }
}

// =====================================================================
//  PHASE: FREEFALL + CANOPY
// =====================================================================
function spawnThrow(from, target, speed) {
  const type = pick(OBSTACLES);
  const obj = type.make();
  obj.position.copy(from);
  scene.add(obj);
  const vel = target.clone().sub(from).normalize().multiplyScalar(speed);
  obstacles.push({
    obj, type, r: type.r, vel, kind: 'throw', t: 0, hit: false,
    spin: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), prev: from.clone(), dir: vel.clone().normalize(),
  });
  sfxAt(SND.whoosh, from, 1.4, rand(0.9, 1.2), obj);
}

function spawnDrop(aimed, warn) {
  const type = pick(OBSTACLES);
  let x = head.x, z = head.z;
  if (aimed) { x += moveVec.x * 0.4; z += moveVec.z * 0.4; }
  else { const a = rand(0, Math.PI * 2), d = rand(1.4, 5); x += Math.cos(a) * d; z += Math.sin(a) * d; }
  const col = getColumn(type.r + CFG.playerRadius, head.y);
  col.position.set(x, 0, z);
  obstacles.push({
    obj: null, type, r: type.r, kind: 'drop', state: 'warn', t: 0, warn, col, x, z, hit: false,
    vel: new THREE.Vector3(0, -CFG.dropSpeed, 0), prev: new THREE.Vector3(),
    spin: new THREE.Vector3(rand(-5, 5), rand(-5, 5), rand(-5, 5)),
  });
  sfxAt(SND.whistle, _v1.set(x, head.y + 20, z), 1.6);
}

function releaseThrow(th, prog) {
  const from = th.userData.hand.getWorldPosition(new THREE.Vector3());
  const speed = lerp(15, 22, prog);
  const flight = from.distanceTo(head) / speed;
  const target = head.clone();
  target.x += rand(-0.35, 0.35);
  target.y += rand(-0.7, 0.1);
  target.z += rand(-0.35, 0.35);
  target.addScaledVector(moveVec, flight * lerp(0.2, 0.8, prog));
  spawnThrow(from, target, speed);
}

function updateFFThugs(dt, prog) {
  G.frontYaw = lerpAngle(G.frontYaw, yawOf(headDir), 1 - Math.exp(-dt * 0.7));
  for (let i = 0; i < ffThugs.length; i++) {
    const th = ffThugs[i], d = th.userData;
    if (!d.active) continue;
    d.life += dt;
    const ang = G.frontYaw + d.slot;
    let y = head.y + d.yoff + Math.sin(G.time * 0.8 + i * 2.1) * 0.7;
    if (d.life < 2.5) { const k = 1 - d.life / 2.5; y += k * k * 50; }
    if (d.leaving) {
      d.leaveT += dt;
      y -= d.leaveT * d.leaveT * 12;
      if (d.leaveT > 4) { d.active = false; th.visible = false; continue; }
    }
    th.position.set(head.x - Math.sin(ang) * d.dist + Math.sin(G.time * 0.5 + i) * 1.5, y, head.z - Math.cos(ang) * d.dist);
    th.lookAt(head);
    const a = d.armR;
    if (d.leaving || d.life < 2.5) { a.rotation.x = -1.0; a.rotation.z = -0.5; continue; }
    d.timer -= dt;
    if (d.state === 'idle') {
      a.rotation.x = -1.0 + Math.sin(G.time * 3 + i) * 0.1;
      a.rotation.z = -0.5;
      if (d.timer <= 0) { d.state = 'windup'; d.st = 0; }
    } else if (d.state === 'windup') {
      d.st += dt;
      const k = Math.min(1, d.st / 0.5);
      a.rotation.x = lerp(-1.0, 0.9, k);
      a.rotation.z = lerp(-0.5, 0, k);
      if (k >= 1) { d.state = 'throw'; d.st = 0; }
    } else if (d.state === 'throw') {
      d.st += dt;
      const k = Math.min(1, d.st / 0.12);
      a.rotation.x = lerp(0.9, -2.7, k);
      if (k >= 1) { releaseThrow(th, prog); d.state = 'recover'; d.st = 0; }
    } else if (d.state === 'recover') {
      d.st += dt;
      const k = Math.min(1, d.st / 0.5);
      a.rotation.x = lerp(-2.7, -1.0, k);
      a.rotation.z = lerp(0, -0.5, k);
      if (k >= 1) { d.state = 'idle'; d.timer = rand(2.4, 3.8) * lerp(1, 0.5, prog); }
    }
  }
}

function updateObstacles(dt) {
  G.inDanger = false;
  const pulse = 0.5 + 0.5 * Math.sin(G.time * 18);
  bombLight.color.setHex(pulse > 0.5 ? 0xff0000 : 0x330000);
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.t += dt;
    let remove = false;
    if (o.kind === 'drop') {
      const cd = o.col.userData;
      if (o.state === 'warn') {
        const k = Math.min(1, o.t / 0.25);
        cd.mat.opacity = k * (0.12 + 0.12 * pulse);
        if (Math.hypot(o.x - head.x, o.z - head.z) < o.r + CFG.playerRadius) G.inDanger = true;
        cd.ringMat.opacity = k * (0.55 + 0.45 * pulse);
        if (o.t >= o.warn) {
          o.state = 'fall';
          o.t = 0;
          o.obj = o.type.make();
          o.obj.position.set(o.x, head.y + 60, o.z);
          scene.add(o.obj);
        }
      } else {
        const fade = o.obj.position.y < head.y - 2 ? Math.max(0, cd.mat.opacity - dt * 1.5) : cd.mat.opacity;
        cd.mat.opacity = fade;
        cd.ringMat.opacity = Math.min(cd.ringMat.opacity, fade * 3);
        if (o.obj.position.y < head.y - 60) remove = true;
      }
    } else if (o.t > 4 || _v1.subVectors(o.obj.position, head).dot(o.dir) > 10) {
      remove = true;
    }
    if (o.obj && !remove) {
      o.prev.copy(o.obj.position);
      o.obj.position.addScaledVector(o.vel, dt);
      o.obj.rotation.x += o.spin.x * dt;
      o.obj.rotation.y += o.spin.y * dt;
      o.obj.rotation.z += o.spin.z * dt;
      if (!o.hit && capsuleHit(o.prev, o.obj.position, o.r)) {
        o.hit = true;
        damage(o.kind === 'drop' ? 'Crushed by falling debris' : 'Smashed out of the sky');
        o.vel.multiplyScalar(-0.25);
        o.vel.y -= 6;
      }
    }
    if (remove) {
      if (o.obj) scene.remove(o.obj);
      if (o.col) releaseColumn(o.col);
      for (const a of sfxPool) if (a.userData.follow === o.obj) a.userData.follow = null;
      obstacles.splice(i, 1);
    }
  }
}

function updateFall(dt) {
  const t = G.phaseTime;
  if (G.phase === 'freefall') {
    G.fallSpeed = Math.min(CFG.freefallSpeed, G.fallSpeed + 11 * dt);
  } else {
    const flare = G.altitude < 45;
    G.fallSpeed = damp(G.fallSpeed, flare ? 3 : CFG.canopySpeed, flare ? 2.5 : 1.6, dt);
  }
  G.altitude -= G.fallSpeed * dt;
  applyMove(G.phase === 'freefall' ? CFG.moveFall : CFG.moveCanopy, dt);

  const prog = clamp((CFG.startAltitude - G.altitude) / (CFG.startAltitude - 1200), 0, 1);
  G.dropTimer -= dt;
  if (G.phase === 'freefall') {
    if (!G.ffThugsOn && t > 4) {
      G.ffThugsOn = true;
      ffThugs.forEach((th) => {
        Object.assign(th.userData, { active: true, life: 0, leaving: false, leaveT: 0, state: 'idle', timer: rand(0.8, 2.2) });
        th.visible = true;
      });
      setMessage('THEY JUMPED AFTER YOU!', 'Sidestep and duck what they throw', 3, '#ff3b2f');
    }
    if (G.dropTimer <= 0) {
      if (t < 4) setMessage('INCOMING FROM ABOVE!', 'Get out of the red beams', 3, '#ff5544');
      spawnDrop(Math.random() < 0.6, lerp(1.5, 1.0, prog));
      G.dropTimer = lerp(2.6, 1.1, prog) * rand(0.8, 1.2);
    }
    if (G.altitude < CFG.lateAltitude) {
      G.hint = btn('PULL NOW!  [TRIGGER]', 'PULL NOW!  [SPACE]');
      G.hintColor = '#ff3b2f'; G.hintFlash = true;
    } else if (G.altitude < CFG.pullAltitude) {
      G.hint = btn('Pull your chute: TRIGGER', 'Pull your chute: SPACE');
      G.hintColor = '#ffd23a'; G.hintFlash = false;
    }
  } else if (G.altitude > 120 && G.dropTimer <= 0) {
    spawnDrop(Math.random() < 0.7, 1.4);
    G.dropTimer = rand(2.0, 2.8);
  }

  updateFFThugs(dt, prog);
  updateObstacles(dt);

  arrow.visible = G.altitude < CFG.pullAltitude;
  if (arrow.visible) {
    arrow.position.copy(head).addScaledVector(headDir, 0.9);
    arrow.position.y -= 0.45;
    arrow.lookAt(CFG.target.x, arrow.position.y, CFG.target.z);
  }

  if (G.altitude <= 0) {
    G.altitude = 0;
    if (G.fallSpeed > 12) die(`You hit the ground at ${Math.round(G.fallSpeed * 3.6)} km/h`);
    else land();
  }
}

function updateCanopy(dt) {
  if (!canopy.visible) return;
  if (G.phase === 'landed') {
    canopy.rotation.z = damp(canopy.rotation.z, 1.35, 1.5, dt);
    canopy.position.y = damp(canopy.position.y, 0.8, 1.5, dt);
    if (G.phaseTime < 2) { // drift off to the side so it doesn't land on your head
      canopy.position.x -= Math.cos(G.frontYaw) * 3 * dt;
      canopy.position.z += Math.sin(G.frontYaw) * 3 * dt;
    }
    return;
  }
  G.canopyOpen = Math.min(1, G.canopyOpen + dt * 1.2);
  const s = G.canopyOpen < 1 ? 0.1 + 0.9 * easeOutBack(G.canopyOpen) : 1;
  canopy.position.set(head.x, head.y + 4.6, head.z);
  canopy.rotation.set(0, G.frontYaw, 0);
  canopy.scale.setScalar(s);
  canopy.updateMatrixWorld();
  const rx = -headDir.z, rz = headDir.x;
  const arr = lineGeo.attributes.position.array;
  for (let i = 0; i < RIM.length; i++) {
    canopy.localToWorld(_v1.copy(RIM[i]));
    const side = RIM[i].x >= 0 ? 1 : -1;
    arr[i * 6] = _v1.x; arr[i * 6 + 1] = _v1.y; arr[i * 6 + 2] = _v1.z;
    arr[i * 6 + 3] = head.x + rx * 0.2 * side;
    arr[i * 6 + 4] = head.y - 0.35;
    arr[i * 6 + 5] = head.z + rz * 0.2 * side;
  }
  lineGeo.attributes.position.needsUpdate = true;
}

// =====================================================================
//  WORLD UPDATES (every frame)
// =====================================================================
const camQuat = new THREE.Quaternion();
function updateWorld(dt) {
  groundGroup.position.y = -G.altitude;
  sky.position.copy(head);

  const flying = G.phase === 'freefall' || G.phase === 'canopy';
  if (G.phase !== 'menu' && G.phase !== 'cabin' && plane.visible) {
    G.planeT += dt;
    plane.position.y += G.fallSpeed * dt;
    plane.position.z += Math.min(40, 8 + G.planeT * 20) * dt;
    if (plane.position.y > 2500) plane.visible = false;
  }
  for (const p of props) p.rotation.z += dt * 30;

  // clouds face the camera
  camera.getWorldQuaternion(camQuat);
  for (let i = 0; i < cloudData.length; i++) {
    const c = cloudData[i];
    _m1.compose(_v1.set(c.x, c.alt - G.altitude, c.z), camQuat, _s1.set(c.s, c.s * 0.65, 1));
    clouds.setMatrixAt(i, _m1);
  }
  clouds.instanceMatrix.needsUpdate = true;

  // speed lines
  const k = flying ? G.fallSpeed / CFG.freefallSpeed : 0;
  slMat.opacity = 0.45 * k;
  speedLines.visible = k > 0.02;
  if (speedLines.visible) {
    const len = 0.4 + G.fallSpeed * 0.05;
    for (let i = 0; i < SL_N; i++) {
      const d = slData[i];
      d.y += G.fallSpeed * dt;
      if (d.y > 12) { d.y -= 24; newLine(d); }
      const o = i * 6;
      slPos[o] = head.x + d.x; slPos[o + 1] = head.y + d.y; slPos[o + 2] = head.z + d.z;
      slPos[o + 3] = head.x + d.x; slPos[o + 4] = head.y + d.y - len; slPos[o + 5] = head.z + d.z;
    }
    slGeo.attributes.position.needsUpdate = true;
  }

  // lighting: dim alarm-lit hold, bright open sky
  const inCabin = G.phase === 'menu' || G.phase === 'cabin';
  hemi.intensity = damp(hemi.intensity, inCabin ? 0.6 : 1.6, 1.5, dt);
  sun.intensity = damp(sun.intensity, inCabin ? 0.6 : 2.6, 1.5, dt);
  const alarmOn = G.phase === 'cabin' && G.doorOpened;
  const blink = Math.sin(G.time * 7) > 0;
  for (const pl of cabinLights) {
    if (alarmOn) { pl.color.setHex(0xff1a0a); pl.intensity = blink ? 14 : 1.5; }
    else if (G.phase === 'cabin' || G.phase === 'menu') { pl.color.setHex(0xffd8a0); pl.intensity = 5; }
    else pl.intensity = 0;
  }
  lampMat.color.setHex(alarmOn ? (blink ? 0xff2010 : 0x330500) : 0xffe2b0);
  policeLights[0].color.setHex(blink ? 0xff1010 : 0x220000);
  policeLights[1].color.setHex(blink ? 0x000822 : 0x1030ff);

  // audio mix
  const planeDist = plane.visible ? plane.position.distanceTo(head) : 9999;
  const near = clamp(1 - planeDist / 400, 0, 1);
  engineSnd.setVolume(inCabin ? 0.6 : 0.6 * near);
  alarmSnd.setVolume(G.phase === 'cabin' ? 0.22 : G.phase === 'menu' ? 0 : 0.22 * clamp(1 - planeDist / 120, 0, 1));
  let windVol = 0.12, windHz = 400;
  if (G.phase === 'cabin') { windVol = 0.12 + clamp((6 - head.z) / 20, 0, 1) * 0.3; windHz = 500; }
  if (flying) { windVol = 0.15 + 0.75 * k; windHz = 300 + G.fallSpeed * 30; }
  if (G.phase === 'landed' || G.phase === 'dead') windVol = 0.05;
  windSnd.setVolume(windVol);
  windFilter.frequency.setTargetAtTime(windHz, AC.currentTime, 0.1);
  for (const a of sfxPool) if (a.userData.follow) a.position.copy(a.userData.follow.position);

  // damage flash / death fade
  G.flash = Math.max(0, G.flash - dt * 1.6);
  G.invuln = Math.max(0, G.invuln - dt);
  G.fade = G.phase === 'dead' ? Math.min(0.7, G.fade + dt * 0.5) : 0;
  flashSphere.material.opacity = Math.max(G.flash, G.fade);
  flashSphere.visible = flashSphere.material.opacity > 0.001;
}

// =====================================================================
//  HUD DRAWING
// =====================================================================
let hudSig = '';
function heart(g, x, y, s, filled) {
  g.beginPath();
  g.moveTo(x, y + s * 0.3);
  g.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  g.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
  g.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  g.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  g.closePath();
  g.fillStyle = filled ? '#ff2a2a' : 'rgba(40,0,0,0.6)';
  g.fill();
  g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.stroke();
}
function txt(g, s, x, y, size, color = '#fff', align = 'center') {
  g.font = `bold ${size}px system-ui, Arial, sans-serif`;
  while (size > 16 && g.measureText(s).width > 1000) { size -= 2; g.font = `bold ${size}px system-ui, Arial, sans-serif`; }
  g.textAlign = align; g.textBaseline = 'middle';
  g.lineWidth = Math.max(4, size / 6); g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(s, x, y);
  g.fillStyle = color; g.fillText(s, x, y);
}
function drawHUD() {
  const p = G.phase;
  const playing = p === 'cabin' || p === 'freefall' || p === 'canopy';
  const msg = G.msg && G.time < G.msg.until ? G.msg : null;
  const hintOn = G.hint && (!G.hintFlash || Math.sin(G.time * 10) > -0.3);
  const alt = Math.round(G.altitude / 10) * 10;
  const danger = playing && G.inDanger && Math.sin(G.time * 16) > -0.2;
  const dist = Math.round(Math.hypot(CFG.target.x - head.x, CFG.target.z - head.z));
  const sig = [p, G.health, alt, playing && p !== 'cabin' ? Math.round(G.fallSpeed * 3.6) : 0, p === 'canopy' ? dist : 0,
    msg ? msg.big + msg.small : '', hintOn ? G.hint : '', G.hintColor, danger].join('|');
  if (sig === hudSig) return;
  hudSig = sig;
  const g = hudCtx;
  g.clearRect(0, 0, 1024, 512);
  if (playing) {
    for (let i = 0; i < CFG.maxHealth; i++) heart(g, 50 + i * 54, 30, 44, i < G.health);
    if (p !== 'cabin') {
      txt(g, `ALT ${alt} m`, 990, 50, 44, G.altitude < CFG.lateAltitude && p === 'freefall' ? '#ff5544' : '#ffffff', 'right');
      txt(g, `${Math.round(G.fallSpeed * 3.6)} km/h`, 990, 100, 32, '#cfe8ff', 'right');
    }
    if (G.altitude < CFG.pullAltitude && p !== 'cabin') txt(g, `TARGET ${dist} m`, 990, 145, 30, '#ffd23a', 'right');
  }
  if (msg) {
    txt(g, msg.big, 512, 230, 70, msg.color);
    if (msg.small) txt(g, msg.small, 512, 300, 34, '#ffffff');
  }
  if (p === 'landed' && G.result) txt(g, `Best score: ${G.result.best}`, 512, 355, 30, '#ffd23a');
  if (hintOn) txt(g, G.hint, 512, 450, 36, G.hintColor);
  if (danger) txt(g, '!! MOVE !!', 512, 380, 54, '#ff2a1a');
  hudTex.needsUpdate = true;
}

// =====================================================================
//  XR SESSION EVENTS + MAIN LOOP
// =====================================================================
renderer.xr.addEventListener('sessionstart', () => {
  unlockAudio();
  overlay.classList.add('hidden');
  const s = renderer.xr.getSession();
  s.addEventListener('selectstart', onAction);
  s.addEventListener('squeezestart', onAction);
  reset();
});
renderer.xr.addEventListener('sessionend', () => {
  reset();
  overlay.classList.remove('hidden');
});

window.__game = { G, CFG }; // handy for debugging from the console
reset();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  G.time += dt;
  G.phaseTime += dt;

  if (!isVR()) {
    camera.position.set(0, keys.KeyC ? 1.0 : 1.65, 0);
    camera.rotation.set(dPitch, dYaw, 0, 'YXZ');
  } else if (G.recenter > 0 && --G.recenter === 0) {
    placeHead(0, 6, 0);
  }
  refreshHead();
  readInput();

  switch (G.phase) {
    case 'cabin': updateCabin(dt); break;
    case 'freefall':
    case 'canopy': updateFall(dt); break;
  }
  updateCanopy(dt);
  updateWorld(dt);
  drawHUD();
  renderer.render(scene, camera);
});
