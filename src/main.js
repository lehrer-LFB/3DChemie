import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Sim } from './sim.js';
import { Mechanism } from './mechanism.js';
import { loadScenario, spawnReactants } from './molecules.js';
import { REACTIONS, reactionById } from './reactions/index.js';
import { MoleculeView } from './view.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { Demo } from './demo.js';

// ---------- Renderer & Szene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141a2a);
scene.fog = new THREE.Fog(0x141a2a, 6, 18);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 50);
// Desktop-Ansicht leicht nach links versetzt, damit die Infokarte nichts verdeckt
const wide = window.innerWidth > 900;
camera.position.set(wide ? -0.28 : 0, 1.55, 0.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(wide ? -0.28 : 0, 1.12, -0.6);
controls.enableDamping = true;
controls.update();

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f3a, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1.5, 3, 1.2);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x9fb8ff, 0.6);
fill.position.set(-2, 1, -1);
scene.add(fill);

// Boden, Raster und ein schlichter Labortisch
const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 64), new THREE.MeshStandardMaterial({ color: 0x1d2436, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new THREE.GridHelper(16, 32, 0x34405e, 0x262f47);
grid.position.y = 0.002;
scene.add(grid);
const table = new THREE.Mesh(
  new THREE.BoxGeometry(1.7, 0.05, 0.9),
  new THREE.MeshStandardMaterial({ color: 0xe8ecf3, roughness: 0.6 }),
);
table.position.set(0, 0.76, -0.65);
scene.add(table);
for (const [x, z] of [[-0.8, -0.25], [0.8, -0.25], [-0.8, -1.05], [0.8, -1.05]]) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.76, 0.05), new THREE.MeshStandardMaterial({ color: 0x8a93a6 }));
  leg.position.set(x, 0.38, z);
  scene.add(leg);
}

// Molekülraum: 1 Å = 10 cm, schwebt über dem Tisch
const lab = new THREE.Group();
lab.position.set(0, 1.15, -0.6);
lab.scale.setScalar(0.1);
scene.add(lab);

// ---------- Simulation, Logik, Darstellung ----------
const sim = new Sim();
const view = new MoleculeView(lab, sim);
let input;

let showPartials = true;
let showPi = false;
let scenarioKey = null;

function restart(key) {
  input.releaseAll();
  demo.stop();
  demoQueue = 0;
  view.clear();
  const def = mech.def;
  scenarioKey = key in def.scenarios ? key : Object.keys(def.scenarios)[0];
  loadScenario(sim, def.scenarios[scenarioKey].items);
  mech.reset();
  ui.set({ title: `Bereit: ${def.scenarios[scenarioKey].label}`, text: '', stepIndex: -1, reaction: null });
}

/** Reaktion (und ggf. Stufe) wählen; EF bietet nur die Veresterung */
function setReaction(id, level = mech.level) {
  let def = reactionById(id) || REACTIONS[0];
  if (!def.levels.includes(level)) def = REACTIONS.find((r) => r.levels.includes(level));
  mech.level = level;
  mech.stepMode = false;
  mech.setReaction(def);
  view.setArrows(null);
  ui.set({ level, panelPage: 'main' });
  restart(Object.keys(def.scenarios)[0]);
}

const ui = new UI((action) => {
  if (action.startsWith('setlevel:')) {
    setReaction(mech.def?.id || 'esterification', action.slice(9));
    return syncUI();
  }
  if (action.startsWith('setreaction:')) {
    setReaction(action.slice(12), 'q2');
    return syncUI();
  }
  switch (action) {
    case 'scen0':
    case 'scen1':
      restart(Object.keys(mech.def.scenarios)[Number(action[4])]);
      break;
    case 'reaction':
      if (renderer.xr.isPresenting) ui.set({ panelPage: 'menu' });
      else ui.showChooser('reactions');
      break;
    case 'menu-back':
      ui.set({ panelPage: 'main' });
      break;
    case 'level':
      if (renderer.xr.isPresenting) setReaction(mech.def.id, mech.level === 'ef' ? 'q2' : 'ef');
      else ui.showChooser('level');
      break;
    case 'partials':
      showPartials = !showPartials;
      break;
    case 'pi':
      showPi = !showPi;
      break;
    case 'spawn':
      if (!mech.seq) spawnReactants(sim, mech.def.extra);
      break;
    case 'stepmode':
      mech.stepMode = !mech.stepMode;
      break;
    case 'next':
      mech.next();
      break;
    case 'arrows':
      mech.showArrows = !mech.showArrows;
      if (!mech.showArrows) view.setArrows(null);
      break;
    case 'o18':
      view.show18O = !view.show18O;
      break;
    case 'demo':
      input.releaseAll();
      demo.start();
      break;
  }
  syncUI();
});

const mech = new Mechanism(sim, {
  onBusy: (set) => { input.releaseAtoms(set); ui.set({ hint: '' }); },
  onArrows: (specs) => view.setArrows(specs),
  onHint: (text) => ui.hint(text),
  onStatus: () => syncUI(),
});
const demo = new Demo(sim, mech);
let demoQueue = 0;

function syncUI() {
  const s = mech.status;
  ui.set({
    reaction: s.reaction,
    stepIndex: s.stepIndex,
    stepDone: s.stepDone,
    title: s.title || ui.state.title,
    text: s.title ? s.text : ui.state.text,
    guidance: mech.seq ? '' : mech.guidance,
    counters: (mech.def?.counters || []).map((c) => ({ label: c.label, value: mech.counts[c.key] || 0 })),
    steps: mech.steps,
    scenarios: mech.def ? Object.values(mech.def.scenarios).map((x) => x.label) : [],
    reactionTitle: mech.def?.title || '',
    reactionId: mech.def?.id || '',
    stepMode: mech.stepMode,
    showArrows: mech.showArrows,
    show18O: view.show18O,
    showPartials,
    showPi,
    piAvailable: !!mech.def?.pi && mech.level === 'q2',
    level: mech.level,
    waiting: mech.waitingForNext,
  });
}

input = new Input({ renderer, camera, scene, lab, sim, view, ui, controls, mech });

// VR-Panel links vor der Person, leicht zugewandt
ui.panel.position.set(-0.72, 1.35, -0.42);
ui.panel.rotation.y = 0.85;
scene.add(ui.panel);

// ---------- Start: Stufe wählen ----------
const params = new URLSearchParams(location.search);
const startLevel = params.get('level');
const startReaction = params.get('reaction');
if (startLevel === 'ef' || startLevel === 'q2' || startReaction) {
  setReaction(startReaction || 'esterification', startLevel === 'ef' ? 'ef' : 'q2');
  const sc = params.get('scenario');
  if (sc && mech.def.scenarios[sc]) restart(sc);
} else {
  setReaction('esterification', 'q2');
  if (!params.has('demo') && !params.has('t')) ui.showChooser(params.get('choose') === 'reactions' ? 'reactions' : 'level');
}
syncUI();

// ?panel (bzw. ?panel=menu) blendet das VR-Panel zur Kontrolle am Rechner ein
if (params.has('panel')) {
  Object.assign(ui.canvas.style, { position: 'fixed', right: '16px', bottom: '90px', width: '480px', zIndex: 50, pointerEvents: 'none' });
  document.body.appendChild(ui.canvas);
  if (params.get('panel') === 'menu') ui.set({ panelPage: 'menu' });
}

// ---------- Hauptschleife ----------
if (params.has('o18')) view.show18O = true;
if (params.has('pi')) showPi = true;
// ?demo=N führt N Reaktionen automatisch vor (z. B. für Präsentationen)
if (params.has('demo')) demoQueue = Number(params.get('demo') || 1);

function tick(dt) {
  if (demoQueue > 0 && !demo.running && !mech.seq && demo.start()) demoQueue--;
  demo.update(dt);
  input.update(dt);
  mech.update(dt);
  view.highlights = mech.highlights;
  view.markers = mech.seq ? [] : mech.markers;
  view.tags = mech.tags;
  view.showPartials = showPartials && mech.level === 'q2';
  view.simpleNames = mech.level === 'ef';
  view.names = mech.def?.names || null;
  view.partialOverride = mech.partialOverride;
  view.setLamp(mech.def?.lamp || null);
  view.showPi = showPi && !!mech.def?.pi && mech.level === 'q2';
  sim.step(dt);
}

// ?t=SEKUNDEN spult die Simulation vor (für reproduzierbare Screenshots)
if (params.has('t')) {
  const T = Number(params.get('t'));
  for (let t = 0; t < T; t += 1 / 60) {
    tick(1 / 60);
    if (Math.abs(t - T + 0.4) < 1 / 120) view.update(t, 0.4); // Pfeile einblenden
  }
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  tick(dt);
  view.update(clock.elapsedTime, dt);
  syncUI();
  ui.update(dt);
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Für Experimente in der Browser-Konsole
Object.assign(window, { sim, mech, view, demo });
