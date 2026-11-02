/* Optional 3D table for the board games. Only loaded when someone turns 3D on, and purely a view:
   each device chooses for itself, so players in the same room can mix 2D and 3D.
   Every frame the game describes its board with view.scene3d(), in board units with (0, 0) at the top left. */
import * as THREE from './vendor/three.module.min.js';

const RAD = Math.PI / 180;
const VIEWS = { angle: { yaw: 0, pitch: 52 * RAD }, top: { yaw: 0, pitch: 89.5 * RAD }, low: { yaw: 0, pitch: 20 * RAD } };
const MIN_PITCH = 12 * RAD, MAX_PITCH = 89.5 * RAD, MIN_ZOOM = .55, MAX_ZOOM = 3.5;
const DEFAULT_FOV = 40;
const SNAKE_STEPS = 90;
const TAP_PX = 8, TAP_MS = 500, PICK_PX = 44;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const UP = new THREE.Vector3(0, 1, 0);

// a chess-style pawn, one unit tall
function pawnGeometry() {
  const outline = [[0, 0], [.38, 0], [.38, .07], [.3, .13], [.2, .3], [.13, .56], [.21, .6], [.13, .65]];
  for (let i = 0; i <= 8; i++) { const a = -50 + i * 27.5; outline.push([Math.cos(a * RAD) * .2, .8 + Math.sin(a * RAD) * .2]); }
  const geometry = new THREE.LatheGeometry(outline.map(([x, y]) => new THREE.Vector2(x, y)), 28);
  geometry.computeVertexNormals();
  return geometry;
}

function numberSprite(text) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(15, 23, 42, .85)';
  g.beginPath(); g.arc(32, 32, 30, 0, 6.283); g.fill();
  g.fillStyle = '#fff'; g.font = '800 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map }));
  sprite.scale.setScalar(.42);
  sprite.position.y = 1.28;
  return sprite;
}

export function createBoard3D({ wrap, saved, onTap, onCameraChange }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'board3d';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Board in 3D. Drag or use the arrow keys to rotate, pinch or use plus and minus to zoom.');
  wrap.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, .1, 200);
  scene.add(new THREE.HemisphereLight('#ffffff', '#94a3b8', 2.1));
  const sun = new THREE.DirectionalLight('#ffffff', 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(innerWidth < 720 ? 1024 : 2048);
  sun.shadow.bias = -.0004;
  sun.shadow.normalBias = .02;
  scene.add(sun);

  /* ----- camera ----- */
  const goal = { yaw: 0, pitch: VIEWS.angle.pitch, zoom: 1, fov: DEFAULT_FOV, x: 0, z: 0, ...saved };
  const cam = { ...goal };
  let units = 0, width = 0, height = 0;

  function fitDistance(fov) {
    // pull back as the lens narrows, so changing the perspective keeps the board the same size
    return units * .74 / Math.tan(fov * RAD / 2) / Math.min(1, width / height);
  }
  function placeCamera() {
    for (const key of Object.keys(cam)) cam[key] += (goal[key] - cam[key]) * .2;
    const d = fitDistance(cam.fov) / cam.zoom, flat = Math.cos(cam.pitch);
    camera.fov = cam.fov;
    camera.near = d * .05; camera.far = d * 6;
    camera.position.set(cam.x + d * Math.sin(cam.yaw) * flat, d * Math.sin(cam.pitch), cam.z + d * Math.cos(cam.yaw) * flat);
    camera.lookAt(cam.x, 0, cam.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  const rememberCamera = () => onCameraChange({ yaw: goal.yaw, pitch: goal.pitch, zoom: goal.zoom, fov: goal.fov });
  function setView(name) {
    const v = VIEWS[name];
    // the short way round, however many turns the board has been spun
    goal.yaw = v.yaw + Math.round((goal.yaw - v.yaw) / 6.283185) * 6.283185;
    Object.assign(goal, { pitch: v.pitch, zoom: 1, x: 0, z: 0 });
    rememberCamera();
  }
  const rotate = (dx, dy) => { goal.yaw -= dx * .008; goal.pitch = clamp(goal.pitch + dy * .006, MIN_PITCH, MAX_PITCH); };
  const zoomBy = (k) => { goal.zoom = clamp(goal.zoom * k, MIN_ZOOM, MAX_ZOOM); };
  function pan(dx, dy) {
    const perPixel = 2 * fitDistance(goal.fov) / goal.zoom * Math.tan(goal.fov * RAD / 2) / height;
    const s = Math.sin(goal.yaw), c = Math.cos(goal.yaw), lim = units / 2;
    goal.x = clamp(goal.x - (c * dx + s * dy) * perPixel, -lim, lim);
    goal.z = clamp(goal.z + (s * dx - c * dy) * perPixel, -lim, lim);
  }

  /* ----- touch, mouse and keys ----- */
  const pointers = new Map();
  let tap = null, spread = 0, middle = null;
  const fingers = () => {
    const [a, b] = [...pointers.values()];
    return { spread: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pans: e.button === 2 || e.shiftKey });
    hint?.remove(); hint = null;
    tap = pointers.size === 1 ? { x: e.clientX, y: e.clientY, at: performance.now() } : null;
    if (pointers.size === 2) { const f = fingers(); spread = f.spread; middle = f; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_PX) tap = null;
    if (pointers.size === 2) {
      const f = fingers();
      if (spread) zoomBy(f.spread / spread);
      pan(f.x - middle.x, f.y - middle.y);
      spread = f.spread; middle = f;
    } else if (!tap) {
      if (p.pans) pan(dx, dy); else rotate(dx, dy);
    }
  });
  const release = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (e.type === 'pointerup' && tap && performance.now() - tap.at < TAP_MS) pick(e.clientX, e.clientY);
    tap = null;
    if (!pointers.size) rememberCamera();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * .0012)); rememberCamera(); }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const moves = { ArrowLeft: [-28, 0], ArrowRight: [28, 0], ArrowUp: [0, -22], ArrowDown: [0, 22] }[e.key];
    if (moves) rotate(...moves);
    else if (e.key === '+' || e.key === '=') zoomBy(1.12);
    else if (e.key === '-') zoomBy(1 / 1.12);
    else return;
    e.preventDefault();
    rememberCamera();
  });

  /* ----- view controls ----- */
  const tools = document.createElement('div');
  tools.className = 'view3d-tools';
  tools.innerHTML = `<button type="button" data-view="angle">Angle</button><button type="button" data-view="top">Top</button><button type="button" data-view="low">Low</button>
    <label title="Perspective"><span>Perspective</span><input type="range" min="15" max="80" value="${Math.round(goal.fov)}" aria-label="Perspective"></label>`;
  tools.addEventListener('click', (e) => { const name = e.target.dataset?.view; if (name) setView(name); });
  tools.querySelector('input').addEventListener('input', (e) => { goal.fov = Number(e.target.value); rememberCamera(); });
  wrap.appendChild(tools);
  let hint = null;
  if (!saved) {
    hint = document.createElement('div');
    hint.className = 'view3d-hint';
    hint.textContent = 'Drag to rotate · pinch or scroll to zoom';
    wrap.appendChild(hint);
    setTimeout(() => { hint?.remove(); hint = null; }, 6000);
  }

  /* ----- the board ----- */
  const top = new THREE.MeshStandardMaterial({ roughness: .75 });
  function buildTable() {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(units + .5, .45, units + .5), new THREE.MeshStandardMaterial({ color: '#7c4a21', roughness: .55 }));
    slab.position.y = -.226;
    slab.castShadow = true;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(units, units), top);
    face.rotation.x = -Math.PI / 2;
    face.receiveShadow = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(units * 6, units * 6), new THREE.ShadowMaterial({ opacity: .28 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.46;
    ground.receiveShadow = true;
    scene.add(slab, face, ground);
    sun.position.set(units * .35, units * 1.1, units * .55);
    const box = sun.shadow.camera;
    box.left = box.bottom = -units; box.right = box.top = units;
    box.far = units * 3;
    box.updateProjectionMatrix();
  }
  let boardKey = null;
  function paintBoard(desc) {
    if (desc.boardKey === boardKey) return;
    boardKey = desc.boardKey;
    top.map?.dispose();
    top.map = new THREE.CanvasTexture(desc.texture());
    top.map.colorSpace = THREE.SRGBColorSpace;
    top.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    top.needsUpdate = true;
  }
  const toWorld = (x, y, target = new THREE.Vector3(), h = 0) => target.set(x - units / 2, h, y - units / 2);

  /* ----- pieces ----- */
  const pawn = pawnGeometry();
  const pieces = [];
  const ringGeometry = new THREE.TorusGeometry(.5, .05, 8, 36);
  function makePiece(desc) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: desc.color, emissive: desc.color, emissiveIntensity: 0, roughness: .32, metalness: .08 });
    const body = new THREE.Mesh(pawn, material);
    body.castShadow = true;
    if (desc.label) body.add(numberSprite(desc.label));
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: '#0f172a' }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = .03;
    group.add(body, ring);
    scene.add(group);
    return { group, body, ring, material, color: desc.color, lift: 0, last: null };
  }
  function updatePieces(list, now, dt) {
    list.forEach((desc, i) => {
      const piece = pieces[i] ??= makePiece(desc);
      const visible = desc.scale > .01;
      piece.group.visible = visible;
      if (!visible) { piece.last = null; return; }
      // the same piece can be a different colour in the next game, which may have a different number of players
      if (piece.color !== desc.color) { piece.color = desc.color; piece.material.color.set(desc.color); piece.material.emissive.set(desc.color); }
      // anything moving quickly hops, so every walk and flight across the board gets an arc without being scripted
      const speed = piece.last ? Math.hypot(desc.x - piece.last[0], desc.y - piece.last[1]) / Math.max(dt, 1) : 0;
      piece.last = [desc.x, desc.y];
      piece.lift += (Math.min(2.2, speed * 45) - piece.lift) * .22;
      toWorld(desc.x, desc.y, piece.group.position, piece.lift);
      piece.group.rotation.y = desc.rot;
      piece.group.scale.setScalar(desc.size * desc.scale);
      piece.ring.visible = desc.selectable;
      const bob = desc.selectable ? .5 + .5 * Math.sin(now / 220) : 0;
      piece.body.position.y = bob * .22;
      piece.material.emissiveIntensity = Math.max(desc.glow * .8, bob * .35);
    });
    pieces.forEach((piece, i) => { if (i >= list.length) piece.group.visible = false; });
  }

  /* ----- block squares ----- */
  const blockGeometry = new THREE.RingGeometry(.56, .66, 4, 1, Math.PI / 4);
  blockGeometry.rotateX(-Math.PI / 2);
  const blocks = [];
  function updateBlocks(list = []) {
    list.forEach((b, i) => {
      if (!blocks[i]) { blocks[i] = new THREE.Mesh(blockGeometry, new THREE.MeshBasicMaterial()); scene.add(blocks[i]); }
      const mesh = blocks[i];
      mesh.material.color.set(b.color);
      toWorld(b.x, b.y, mesh.position, .012);
      mesh.visible = true;
    });
    blocks.forEach((mesh, i) => { if (i >= list.length) mesh.visible = false; });
  }

  /* ----- ladders and snakes ----- */
  const scenery = new THREE.Group();
  scene.add(scenery);
  const stick = new THREE.CylinderGeometry(1, 1, 1, 10);
  const ball = new THREE.SphereGeometry(1, 14, 10);
  let sceneryKey = null, ladderParts = [], snakeParts = [];

  function addStick(parent, material, from, to, radius) {
    const mesh = new THREE.Mesh(stick, material), dir = to.clone().sub(from), length = dir.length();
    mesh.position.copy(from).addScaledVector(dir, .5);
    mesh.scale.set(radius, length, radius);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    mesh.castShadow = true;
    parent.add(mesh);
  }
  function buildLadder(l) {
    const rail = new THREE.MeshStandardMaterial({ color: l.rail, emissive: '#fbbf24', emissiveIntensity: 0, roughness: .6 });
    const rung = new THREE.MeshStandardMaterial({ color: l.rung, roughness: .6 });
    const len = Math.hypot(l.bx - l.ax, l.by - l.ay) || 1, nx = -(l.by - l.ay) / len, ny = (l.bx - l.ax) / len;
    const width = .17, rise = .16;
    const point = (k, side, h) => toWorld(l.ax + (l.bx - l.ax) * k + nx * width * side, l.ay + (l.by - l.ay) * k + ny * width * side, undefined, h);
    for (const side of [-1, 1]) {
      addStick(scenery, rail, point(0, side, rise), point(1, side, rise), .035);
      addStick(scenery, rail, point(0, side, 0), point(0, side, rise), .03);
      addStick(scenery, rail, point(1, side, 0), point(1, side, rise), .03);
    }
    const rungs = Math.max(2, Math.floor(len / .34));
    for (let i = 1; i < rungs; i++) addStick(scenery, rung, point(i / rungs, -1, rise), point(i / rungs, 1, rise), .024);
    return rail;
  }
  function buildSnake(s) {
    const body = new THREE.InstancedMesh(ball, new THREE.MeshStandardMaterial({ roughness: .42 }), SNAKE_STEPS + 1);
    body.castShadow = true;
    body.frustumCulled = false;
    const plain = new THREE.Color().setHSL(s.hue / 360, .72, .44), band = new THREE.Color().setHSL(((s.hue + 45) % 360) / 360, .88, .62);
    for (let i = 0; i <= SNAKE_STEPS; i++) body.setColorAt(i, Math.floor(i * 54 / SNAKE_STEPS / 4) % 2 ? band : plain);
    const head = new THREE.Group();
    const skull = new THREE.Mesh(ball, new THREE.MeshStandardMaterial({ color: plain, roughness: .38 }));
    skull.castShadow = true;
    const mouth = new THREE.Mesh(ball, new THREE.MeshStandardMaterial({ color: '#450a0a', roughness: .6 }));
    const tongue = new THREE.Mesh(stick, new THREE.MeshBasicMaterial({ color: '#ef4444' }));
    tongue.rotation.z = Math.PI / 2;
    head.add(skull, mouth, tongue);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(ball, new THREE.MeshStandardMaterial({ color: '#fef9c3', roughness: .3 }));
      eye.scale.setScalar(.075);
      eye.position.set(.06, .12, side * .12);
      const pupil = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ color: '#0f172a' }));
      pupil.scale.set(.03, .045, .03);
      pupil.position.set(.115, .14, side * .135);
      head.add(eye, pupil);
    }
    scenery.add(body, head);
    return { body, head, skull, mouth, tongue, stamp: null };
  }
  const dummy = new THREE.Object3D();
  function updateSnake(part, s) {
    if (part.stamp === s.stamp) return;
    part.stamp = s.stamp;
    for (let i = 0; i <= SNAKE_STEPS; i++) {
      const k = i / SNAKE_STEPS, [x, y] = s.at(k), r = Math.max(.035, s.radius(k));
      toWorld(x, y, dummy.position, r * .85);
      dummy.scale.setScalar(r);
      dummy.updateMatrix();
      part.body.setMatrixAt(i, dummy.matrix);
    }
    part.body.instanceMatrix.needsUpdate = true;
    const [hx, hy] = s.at(0), [nx, ny] = s.at(.05), angle = Math.atan2(hy - ny, hx - nx);
    toWorld(hx + Math.cos(angle) * s.lunge * .3, hy + Math.sin(angle) * s.lunge * .3, part.head.position, .17);
    part.head.rotation.y = -angle;
    part.skull.scale.set(.29 * (1 + s.open * .25), .16, .216 * (1 + s.open * .15));
    part.mouth.visible = s.open > .02;
    part.mouth.scale.set(.1, .07 * s.open + .01, .13 * s.open + .01);
    part.mouth.position.set(.23, -.02, 0);
    part.tongue.visible = s.open > .1;
    part.tongue.scale.set(.012, .28, .012);
    part.tongue.position.set(.4, -.02, 0);
  }
  function buildScenery(desc) {
    scenery.traverse((o) => {
      if (o === scenery) return;
      if (o.isInstancedMesh) o.dispose();
      for (const m of [o.material].flat()) m?.dispose();
    });
    scenery.clear();
    ladderParts = (desc.ladders ?? []).map(buildLadder);
    snakeParts = (desc.snakes ?? []).map(buildSnake);
  }

  /* ----- picking ----- */
  const raycaster = new THREE.Raycaster(), plane = new THREE.Plane(UP, 0), hit = new THREE.Vector3(), probe = new THREE.Vector3();
  function toScreen(vec) {
    const r = canvas.getBoundingClientRect();
    probe.copy(vec).project(camera);
    return [r.left + (probe.x + 1) / 2 * r.width, r.top + (1 - probe.y) / 2 * r.height];
  }
  let lastPieces = [];
  function pick(clientX, clientY) {
    // the nearest token on screen wins, so a tall piece can be tapped from any angle
    let best = null, bestD = PICK_PX;
    for (const p of lastPieces) {
      if (!p.selectable) continue;
      const [sx, sy] = toScreen(toWorld(p.x, p.y, hit, p.size * .5)), d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) { onTap(best.x / units, best.y / units); return; }
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera({ x: (clientX - r.left) / r.width * 2 - 1, y: 1 - (clientY - r.top) / r.height * 2 }, camera);
    if (raycaster.ray.intersectPlane(plane, hit)) onTap(hit.x / units + .5, hit.z / units + .5);
  }

  function resize() {
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height || (r.width === width && r.height === height)) return;
    width = r.width; height = r.height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
  }
  new ResizeObserver(resize).observe(wrap);

  let lastFrame = 0;
  return {
    render(desc, now) {
      resize();
      if (!width) return;
      if (!units) { units = desc.units; buildTable(); }
      const dt = Math.min(50, now - lastFrame);
      lastFrame = now;
      paintBoard(desc);
      if (desc.sceneryKey !== sceneryKey) { sceneryKey = desc.sceneryKey; buildScenery(desc); }
      desc.ladders?.forEach((l, i) => { ladderParts[i].emissiveIntensity = l.glow * .9; });
      desc.snakes?.forEach((s, i) => updateSnake(snakeParts[i], s));
      lastPieces = desc.pieces;
      updatePieces(desc.pieces, now, dt);
      updateBlocks(desc.blocks);
      placeCamera();
      renderer.render(scene, camera);
    },
    // where a point on the board is on screen, with x and y from 0 to 1 across the board
    project(x, y) {
      return toScreen(toWorld(x * units, y * units, hit, .4));
    },
    show(on) {
      canvas.hidden = tools.hidden = !on;
      if (hint) hint.hidden = !on;
    },
  };
}
