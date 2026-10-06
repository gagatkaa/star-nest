import * as THREE from 'three/webgpu';
import { wgslFn, uniform, uv, texture } from 'three/tsl';
import * as CANNON from 'cannon-es';
import { GUI } from 'lil-gui';

import starNestShader from './shaders/starNest.wgsl?raw';
import compositeShader from './shaders/composite.wgsl?raw';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_BALLS = 32;
const BALL_RADIUS = 0.045; // world units; the fullscreen plane spans -1..1
const BOUND_LEFT = -1 + BALL_RADIUS;
const BOUND_RIGHT = 1 - BALL_RADIUS;
const BOUND_BOTTOM = -1 + BALL_RADIUS;
const BOUND_TOP = 1 - BALL_RADIUS;

// ---------------------------------------------------------------------------
// TSL uniforms (updated from javascript every frame)
// ---------------------------------------------------------------------------
const rtUniforms = {
  iTime: uniform(0),
  iMouse: uniform(new THREE.Vector2(0, 0)),
  iResolution: uniform(new THREE.Vector2(2, 2)),
  iSpeed: uniform(0.01),
};

const uniforms = {
  iTime: uniform(0),
  iMouse: uniform(new THREE.Vector2(0, 0)),
  iResolution: uniform(new THREE.Vector2(2, 2)),
  uLensing: uniform(0.5),
  uGlow: uniform(1.1),
  uCore: uniform(0.55),
  uGlowColor: uniform(new THREE.Color(0xbfe8ff)),
};

// ---------------------------------------------------------------------------
// Shader recourse
// ---------------------------------------------------------------------------
const starNestData = new Float32Array(MAX_BALLS * 4); // r,g = uv pos, b = uv radius, a = active
const ballsTex = new THREE.DataTexture(starNestData, MAX_BALLS, 1, THREE.RGBAFormat, THREE.FloatType);
ballsTex.magFilter = THREE.NearestFilter;
ballsTex.minFilter = THREE.NearestFilter;
ballsTex.generateMipmaps = false;
ballsTex.needsUpdate = true;
const ballsTexture = texture(ballsTex);

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
const canvas = document.getElementById('webgl') as HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let renderTarget: THREE.RenderTarget;
let camera: THREE.OrthographicCamera;
let scene: THREE.Scene;
let rtScene: THREE.Scene;
let clock = new THREE.Clock();

const world = new CANNON.World();
world.gravity.set(0, 0, 0);
world.allowSleep = false;

const ballMat = new CANNON.Material('ball');
const wallMat = new CANNON.Material('wall');
const ballWallContact = new CANNON.ContactMaterial(ballMat, wallMat, { friction: 0.0, restitution: 0.85 });
const ballBallContact = new CANNON.ContactMaterial(ballMat, ballMat, { friction: 0.05, restitution: 0.85 });
world.addContactMaterial(ballWallContact);
world.addContactMaterial(ballBallContact);
world.defaultContactMaterial.friction = 0;

const bodies: CANNON.Body[] = [];

const params = {
  attractor: 4.0,
  attractorOn: true,
  gravity: 1.5,
  gravityOn: false,
  launchPower: 3.0,
  restitution: 0.85,
  lensing: 0.5,
  glow: 1.1,
  core: 0.55,
  starSpeed: 0.01,
  glowColor: '#bfe8ff',
};

const pointer = { x: 0.5, y: 0.5 }; // uv space, y down
const drag = { active: false, startUv: { x: 0, y: 0 }, currentUv: { x: 0, y: 0 } };

// ---------------------------------------------------------------------------
// Physics helpers
// ---------------------------------------------------------------------------
const worldFromUv = (ux: number, uy: number) => ({
  x: ux * 2 - 1,
  y: (1 - uy) * 2 - 1,
});

const addWall = (nx: number, ny: number, px: number, py: number) => {
  const wall = new CANNON.Body({
    type: CANNON.Body.STATIC,
    material: wallMat,
    position: new CANNON.Vec3(px, py, 0),
  });
  wall.addShape(new CANNON.Plane());
  wall.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(nx, ny, 0));
  world.addBody(wall);
};

const spawnBall = (wx: number, wy: number, vx = 0, vy = 0) => {
  if (bodies.length >= MAX_BALLS) return;
  const body = new CANNON.Body({
    mass: 1,
    material: ballMat,
    position: new CANNON.Vec3(wx, wy, 0),
    velocity: new CANNON.Vec3(vx, vy, 0),
  });
  body.addShape(new CANNON.Sphere(BALL_RADIUS));
  body.linearDamping = 0.02;
  body.angularDamping = 0.9;
  world.addBody(body);
  bodies.push(body);
};

const resetBalls = () => {
  while (bodies.length > 0) {
    world.removeBody(bodies.pop()!);
  }
  for (let i = 0; i < 8; i++) {
    spawnBall(
      (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 1.5,
    );
  }
};

const applyAttractor = () => {
  if (!params.attractorOn || drag.active) return;
  const m = worldFromUv(pointer.x, pointer.y);
  for (const body of bodies) {
    const dx = m.x - body.position.x;
    const dy = m.y - body.position.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-4) continue;
    const f = Math.min(params.attractor * 8, params.attractor / Math.max(d, 0.05));
    body.applyForce(new CANNON.Vec3((dx / d) * f, (dy / d) * f, 0), body.position);
  }
};

const clampBodies = () => {
  for (const body of bodies) {
    body.position.x = THREE.MathUtils.clamp(body.position.x, BOUND_LEFT, BOUND_RIGHT);
    body.position.y = THREE.MathUtils.clamp(body.position.y, BOUND_BOTTOM, BOUND_TOP);
  }
};

const uploadBalls = () => {
  starNestData.fill(0);
  for (let i = 0; i < bodies.length; i++) {
    const p = bodies[i].position;
    const ux = (p.x + 1) * 0.5;
    const uy = (p.y + 1) * 0.5; // shader uv() is y-up
    starNestData[i * 4] = ux;
    starNestData[i * 4 + 1] = uy;
    starNestData[i * 4 + 2] = BALL_RADIUS * 0.5;
    starNestData[i * 4 + 3] = 1;
  }
  ballsTex.needsUpdate = true;
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const updatePointer = (e: MouseEvent) => {
  pointer.x = e.clientX / window.innerWidth;
  pointer.y = e.clientY / window.innerHeight;
  const iRes = uniforms.iResolution.value;
  // shader fragCoord.y is bottom-up, so invert the mouse Y for iMouse
  uniforms.iMouse.value.set(pointer.x * iRes.x, (1 - pointer.y) * iRes.y);
  rtUniforms.iMouse.value.set(pointer.x * rtUniforms.iResolution.value.x, (1 - pointer.y) * rtUniforms.iResolution.value.y);
};

window.addEventListener('mousemove', (e) => {
  updatePointer(e);
  if (drag.active) {
    drag.currentUv = { x: e.clientX / window.innerWidth, y: 1 - e.clientY / window.innerHeight };
  }
});

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  drag.active = true;
  const ux = e.clientX / window.innerWidth;
  const uy = 1 - e.clientY / window.innerHeight;
  drag.startUv = { x: ux, y: uy };
  drag.currentUv = { x: ux, y: uy };
});

window.addEventListener('pointerup', () => {
  if (!drag.active) return;
  drag.active = false;
  const s = worldFromUv(drag.startUv.x, drag.startUv.y);
  const c = worldFromUv(drag.currentUv.x, drag.currentUv.y);
  const dx = s.x - c.x;
  const dy = s.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len > 0.03) {
    // slingshot: pull back, release -> ball flies in the drag direction
    spawnBall(s.x, s.y, dx * params.launchPower, dy * params.launchPower);
  } else {
    // simple click: drop a ball with a little random motion
    spawnBall(s.x, s.y, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6);
  }
});

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'g') {
    params.gravityOn = !params.gravityOn;
    updateGui();
  } else if (k === 'r') {
    resetBalls();
  } else if (k === 's') {
    for (const body of bodies) {
      body.velocity.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 0);
    }
  } else if (k === ' ') {
    e.preventDefault();
    spawnBall((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5), (Math.random() - 0.5));
  }
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const setupPhysics = () => {
  addWall(1, 0, BOUND_RIGHT, 0);
  addWall(-1, 0, BOUND_LEFT, 0);
  addWall(0, 1, 0, BOUND_TOP);
  addWall(0, -1, 0, BOUND_BOTTOM);
  resetBalls();
};

const init = async () => {
  renderer = new THREE.WebGPURenderer({ canvas, alpha: false, antialias: true });
  // Star Nest outputs display-ready colors, so skip the linear -> sRGB conversion
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  await renderer.init();

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  camera.position.z = 1;

  // --- buffer pass: render Star Nest into a render target ------------------
  const starNest = wgslFn(starNestShader) as (p: Record<string, unknown>) => any;
  const rtMaterial = new THREE.MeshBasicNodeMaterial();
  rtMaterial.colorNode = starNest({
    fragCoord: uv().mul(rtUniforms.iResolution),
    iTime: rtUniforms.iTime,
    iMouse: rtUniforms.iMouse,
    iResolution: rtUniforms.iResolution,
    iSpeed: rtUniforms.iSpeed,
  });

  const rtPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), rtMaterial);
  rtScene = new THREE.Scene();
  rtScene.add(rtPlane);

  renderTarget = new THREE.RenderTarget(600, 400, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  // --- composite pass: lensing + glow over the Star Nest buffer ------------
  const iChannel0 = texture(renderTarget.texture);
  const composite = wgslFn(compositeShader) as (p: Record<string, unknown>) => any;
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = composite({
    fragCoord: uv().mul(uniforms.iResolution),
    iTime: uniforms.iTime,
    iMouse: uniforms.iMouse,
    iResolution: uniforms.iResolution,
    iChannel0,
    iChannel0Sampler: iChannel0,
    ballsMap: ballsTexture,
    ballsMapSampler: ballsTexture,
    uLensing: uniforms.uLensing,
    uGlow: uniforms.uGlow,
    uCore: uniforms.uCore,
    uGlowColor: uniforms.uGlowColor,
  });

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene = new THREE.Scene();
  scene.add(plane);

  setupPhysics();
  setupGui();

  window.addEventListener('resize', resize);
  resize();

  renderer.setAnimationLoop(draw);
};

const resize = () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w * window.devicePixelRatio, h * window.devicePixelRatio, false);
  uniforms.iResolution.value.set(w, h);
  renderTarget.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
  rtUniforms.iResolution.value.set(renderTarget.width, renderTarget.height);
};

// ---------------------------------------------------------------------------
// GUI
// ---------------------------------------------------------------------------
let gui: GUI;

const setupGui = () => {
  gui = new GUI({ title: 'Gravity Wells' });

  gui.add(params, 'starSpeed', 0, 0.05, 0.001).name('Star speed').onChange((v: number) => (rtUniforms.iSpeed.value = v));
  rtUniforms.iSpeed.value = params.starSpeed;

  gui.add(params, 'attractor', 0, 10, 0.1).name('Mouse attractor');
  gui.add(params, 'attractorOn').name('Attractor on');
  gui.add(params, 'gravity', 0, 5, 0.1).name('Gravity');
  gui.add(params, 'gravityOn').name('Gravity on').onChange((v: boolean) => {
    world.gravity.set(0, v ? -params.gravity : 0, 0);
  });
  gui.add(params, 'launchPower', 0.5, 8, 0.1).name('Slingshot power');
  gui.add(params, 'restitution', 0, 1, 0.01).name('Bounciness').onChange((v: number) => {
    ballWallContact.restitution = v;
    ballBallContact.restitution = v;
  });

  gui.add(params, 'lensing', 0, 1.5, 0.01).name('Lensing').onChange((v: number) => (uniforms.uLensing.value = v));
  gui.add(params, 'glow', 0, 3, 0.01).name('Glow').onChange((v: number) => (uniforms.uGlow.value = v));
  gui.add(params, 'core', 0, 1, 0.01).name('Core darkness').onChange((v: number) => (uniforms.uCore.value = v));
  gui.addColor(params, 'glowColor').name('Glow color').onChange((v: string) => {
    params.glowColor = v;
    uniforms.uGlowColor.value.set(v);
  });

  gui.add({ reset: resetBalls }, 'reset').name('Reset balls');

  uniforms.uLensing.value = params.lensing;
  uniforms.uGlow.value = params.glow;
  uniforms.uCore.value = params.core;
  uniforms.uGlowColor.value.set(params.glowColor);
};

const updateGui = () => {
  if (!gui) return;
  gui.controllers.forEach((c) => c.updateDisplay());
};

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
const draw = () => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  if (params.gravityOn) {
    world.gravity.set(0, -params.gravity, 0);
  } else {
    world.gravity.set(0, 0, 0);
  }

  applyAttractor();
  world.step(1 / 60, dt, 3);
  clampBodies();
  uploadBalls();

  rtUniforms.iTime.value = elapsed;
  uniforms.iTime.value = elapsed;

  renderer.setRenderTarget(renderTarget);
  renderer.render(rtScene, camera);
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
};

// ---------------------------------------------------------------------------
init();