// 3D-Darstellung der Simulation: Kugel-Stab-Modell, Hervorhebungen reaktiver
// Zentren, Formalladungen, Molekülnamen und Elektronenpfeile.

import * as THREE from 'three';
import { ELEMENTS } from './sim.js';
import { nameFor } from './molecules.js';
import { V } from './vec.js';

const O18_COLOR = 0xffa31a;
// Elektronegativität (Pauling) für die δ+/δ−-Anzeige
const EN = { H: 2.2, C: 2.55, Br: 2.96, O: 3.44, Fe: 1.83 };
const BOND_COLOR = new THREE.Color(0xc4c8d4);
const BOND_ACTIVE = new THREE.Color(0xffd23f);
const ARROW_COLOR = 0x4fc3ff;
const Y = new THREE.Vector3(0, 1, 0);

function canvasSprite(draw, w, h, worldHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((worldHeight * w) / h, worldHeight, 1);
  sprite.userData.redraw = (...args) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h, ...args);
    tex.needsUpdate = true;
  };
  sprite.raycast = () => {};
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class MoleculeView {
  constructor(lab, sim) {
    this.lab = lab;
    this.sim = sim;
    this.root = new THREE.Group();
    lab.add(this.root);
    this.sphereGeo = new THREE.SphereGeometry(1, 32, 20);
    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false);
    this.highlights = new Map();
    this.hover = new Set();
    this.show18O = false;
    this.showPartials = false;
    this.simpleNames = false; // EF: keine Namen für Zwischenstufen
    this.names = null; // reaktionsspezifische Namen
    this.partialOverride = null; // induzierte Partialladungen
    this.arrowGroup = new THREE.Group();
    this.root.add(this.arrowGroup);
    this.arrowFade = 0;
    this.atomObjs = [];
    this.bondObjs = new Map();
    this.labels = [];
    // Hilfsanzeigen der Reaktion: Zielmarkierungen und Textschilder an Atomen
    this.markers = []; // [{ p, color }]
    this.tags = []; // [{ atom, text, color }]
    this.markerObjs = [];
    this.tagObjs = [];
    // π-Elektronen: Ringsymbol (Standard) bzw. π-Wolke (zuschaltbar)
    this.showPi = false;
    this.piGroup = new THREE.Group();
    this.root.add(this.piGroup);
    this.piPool = { ring: [], arc: [], cloud: [], cloudArc: [], lobe: [] };
    this.piUsed = null;
    this.flatBonds = new Set(); // aromatische Bindungen: als Einfachlinie zeichnen
    this._ringsVersion = -1;
    this.rings = [];
    const mat = (color, opacity) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.5, depthWrite: false });
    this.piGeo = {
      ring: new THREE.TorusGeometry(1, 0.06, 10, 64),
      arc: new THREE.TorusGeometry(1, 0.06, 10, 48, (240 * Math.PI) / 180),
      cloud: new THREE.TorusGeometry(1, 0.42, 16, 64),
      cloudArc: new THREE.TorusGeometry(1, 0.42, 16, 48, (240 * Math.PI) / 180),
      lobe: new THREE.SphereGeometry(1, 24, 16),
    };
    this.piMat = {
      ring: () => mat(0x2b2f3a, 0.9),
      arc: () => mat(0x2b2f3a, 0.9),
      cloud: () => mat(0x5f8dff, 0.28),
      cloudArc: () => mat(0x5f8dff, 0.28),
      lobe: () => mat(0x5f8dff, 0.3),
    };
  }

  clear() {
    for (const o of this.atomObjs) {
      this.root.remove(o.mesh, o.halo, o.charge, o.partial, o.dot);
      o.dot.material.map.dispose();
      o.dot.material.dispose();
      o.partial.material.map.dispose();
      o.partial.material.dispose();
      o.mesh.material.dispose();
      o.halo.material.dispose();
      o.charge.material.map.dispose();
      o.charge.material.dispose();
    }
    for (const b of this.bondObjs.values()) this._disposeBond(b);
    for (const l of this.labels) {
      this.root.remove(l);
      l.material.map.dispose();
      l.material.dispose();
    }
    this.atomObjs = [];
    this.bondObjs.clear();
    this.labels = [];
    this.markers = [];
    this.tags = [];
    this.setArrows(null);
  }

  get pickables() {
    return this.atomObjs.map((o) => o.mesh);
  }

  _createAtom(a) {
    const el = ELEMENTS[a.el];
    const mat = new THREE.MeshStandardMaterial({ color: el.color, roughness: 0.35, metalness: 0.05 });
    const mesh = new THREE.Mesh(this.sphereGeo, mat);
    mesh.scale.setScalar(el.radius);
    mesh.userData.atom = a.id;

    const halo = new THREE.Mesh(
      this.sphereGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    halo.scale.setScalar(el.radius * 2.1);
    halo.visible = false;
    halo.raycast = () => {};

    const charge = canvasSprite((ctx, w, h, sign) => {
      const col = sign > 0 ? '#1565c0' : '#c62828';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = 'bold 96px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sign > 0 ? '+' : '−', w / 2, h / 2 + 6);
    }, 128, 128, 0.36);
    charge.userData.redraw(1);
    charge.userData.sign = 1;
    charge.visible = false;

    // Partialladung δ+ / δ−
    const partial = canvasSprite((ctx, w, h, sign) => {
      const pos = sign > 0;
      roundRect(ctx, 6, 6, w - 12, h - 12, 30);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = pos ? '#1565c0' : '#c62828';
      ctx.stroke();
      ctx.fillStyle = pos ? '#1565c0' : '#c62828';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'italic bold 78px system-ui, sans-serif';
      ctx.fillText('δ' + (pos ? '+' : '−'), w / 2, h / 2 + 4);
    }, 160, 112, 0.42);
    partial.visible = false;
    partial.userData.sign = 0;

    // ungepaartes Elektron (Radikal): Punkt
    const dot = canvasSprite((ctx, w, h) => {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 22, 0, Math.PI * 2);
      ctx.fill();
    }, 64, 64, 0.22);
    dot.userData.redraw();
    dot.visible = false;

    this.root.add(mesh, halo, charge, partial, dot);
    this.atomObjs.push({ mesh, halo, charge, partial, dot });
  }

  _makeLabel() {
    const s = canvasSprite((ctx, w, h, title, sub) => {
      ctx.font = 'bold 54px system-ui, sans-serif';
      const tw = Math.max(ctx.measureText(title).width, sub ? (ctx.font = '40px system-ui, sans-serif', ctx.measureText(sub).width) : 0);
      const bw = Math.min(w - 8, tw + 60);
      roundRect(ctx, (w - bw) / 2, 4, bw, h - 8, 28);
      ctx.fillStyle = 'rgba(18,24,40,0.78)';
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 54px system-ui, sans-serif';
      ctx.fillText(title, w / 2, sub ? h * 0.36 : h / 2);
      if (sub) {
        ctx.fillStyle = '#a9c7ff';
        ctx.font = '40px system-ui, sans-serif';
        ctx.fillText(sub, w / 2, h * 0.72);
      }
    }, 1024, 160, 0.75);
    s.userData.text = '';
    this.root.add(s);
    this.labels.push(s);
    return s;
  }

  _disposeBond(b) {
    this.root.remove(b.c1, b.c2);
    b.c1.material.dispose();
    b.c2.material.dispose();
  }

  _createBond() {
    const mk = () => {
      const m = new THREE.Mesh(this.cylGeo, new THREE.MeshStandardMaterial({ color: BOND_COLOR, roughness: 0.5, transparent: true }));
      m.raycast = () => {};
      this.root.add(m);
      return m;
    };
    return { c1: mk(), c2: mk() };
  }

  /** Elektronenpfeile setzen (Liste von {from, to} mit {atom} oder {bond:[a,b]}) */
  setArrows(specs) {
    for (const c of [...this.arrowGroup.children]) {
      this.arrowGroup.remove(c);
      c.geometry.dispose();
      c.material.dispose();
    }
    this.arrowFade = 0;
    if (!specs) return;
    const A = this.sim.atoms;
    const pt = (s) => (s.atom != null ? A[s.atom].p : V.lerp(A[s.bond[0]].p, A[s.bond[1]].p, 0.5));
    const ids = new Set();
    for (const s of specs) for (const e of [s.from, s.to]) (e.atom != null ? [e.atom] : e.bond).forEach((i) => ids.add(i));
    // Schwerpunkt der beteiligten Moleküle: Pfeile wölben sich davon weg
    const frags = new Set([...ids].map((i) => this.sim.frag[i]));
    const center = V.centroid([...frags].flatMap((f) => this.sim.fragments[f].map((i) => A[i].p)));

    for (const s of specs) {
      const a = pt(s.from), b = pt(s.to);
      const d = V.sub(b, a);
      const L = V.len(d) || 0.5;
      const dn = V.norm(d);
      const mid = V.lerp(a, b, 0.5);
      let out = V.reject(V.sub(mid, center), dn);
      out = V.len(out) < 0.05 ? V.anyPerp(dn) : V.norm(out);
      const start = V.add(a, V.mul(out, s.from.atom != null ? 0.42 : 0.18));
      const end = V.add(b, V.mul(out, s.to.atom != null ? 0.4 : 0.16));
      const ctrl = V.add(mid, V.mul(out, 0.45 * L + 0.45));
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...start), new THREE.Vector3(...ctrl), new THREE.Vector3(...end));
      const pts = [];
      const tEnd = s.half ? 0.96 : 0.84;
      for (let i = 0; i <= 24; i++) pts.push(curve.getPoint((i / 24) * tEnd));
      const mat = () => new THREE.MeshBasicMaterial({ color: ARROW_COLOR, transparent: true, opacity: 0, depthTest: false });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.045, 8), mat());
      const tan = curve.getTangent(0.92);
      let head;
      if (s.half) {
        // Fischhaken: ein einzelner Widerhaken zur Außenseite (ein Elektron)
        const tip = curve.getPoint(0.96);
        const barb = new THREE.Vector3(...V.norm(V.add(V.mul([tan.x, tan.y, tan.z], -0.85), V.mul(out, 0.53))));
        head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8), mat());
        head.quaternion.setFromUnitVectors(Y, barb);
        head.position.copy(tip).addScaledVector(barb, 0.16);
      } else {
        head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 16), mat());
        head.quaternion.setFromUnitVectors(Y, tan);
        head.position.copy(curve.getPoint(1)).addScaledVector(tan, -0.17);
      }
      tube.renderOrder = head.renderOrder = 10;
      this.arrowGroup.add(tube, head);
    }
  }

  update(time, dt) {
    const sim = this.sim;
    sim.ensureTopo();
    const A = sim.atoms;
    while (this.atomObjs.length < A.length) this._createAtom(A[this.atomObjs.length]);

    // Partialladungen nur in neutralen Molekülen (in Ionen zählt die Formalladung)
    const neutralFrag = this.showPartials
      ? sim.fragments.map((ids) => sim.fragmentCharge(ids) === 0 && ids.every((i) => sim.formalCharge(i) === 0 || sim.atoms[i].el !== 'C'))
      : null;

    // Atome
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      const o = this.atomObjs[i];
      o.mesh.position.set(...a.p);
      const col = this.show18O && a.tag.o18 ? O18_COLOR : ELEMENTS[a.el].color;
      o.mesh.material.color.setHex(col);
      o.mesh.material.emissive.setHex(this.hover.has(i) ? 0x333a4a : 0x000000);

      let h = this.highlights.get(i);
      if (!h && a.tag.catalyst) h = { color: 0x5fd8ff, strength: 0.18 };
      if (h) {
        o.halo.visible = true;
        o.halo.position.copy(o.mesh.position);
        o.halo.material.color.setHex(h.color);
        o.halo.material.opacity = h.strength * (0.32 + 0.12 * Math.sin(time * 5));
      } else o.halo.visible = false;

      const q = sim.formalCharge(i);
      const ps = neutralFrag && neutralFrag[sim.frag[i]] && q === 0
        ? (this.partialOverride?.get(i) ?? this._partialSign(i)) : 0;
      o.charge.visible = q !== 0;
      if (q !== 0 && Math.sign(q) !== o.charge.userData.sign) {
        o.charge.userData.sign = Math.sign(q);
        o.charge.userData.redraw(Math.sign(q));
      }
      o.partial.visible = ps !== 0;
      if (ps !== o.partial.userData.sign && ps !== 0) o.partial.userData.redraw(ps);
      o.partial.userData.sign = ps;
      const rad = sim.radicalOf(i);
      o.dot.visible = rad > 0;
      if (q !== 0 || ps || rad) {
        const nb = sim.adj[i].map((x) => A[x.j].p);
        let dir = nb.length ? V.sub(a.p, V.centroid(nb)) : [1, -0.1, 0.25];
        if (V.len(dir) < 0.05) dir = [0, 1, 0];
        dir = V.norm(V.add(V.norm(dir), [0, 0.35, 0]));
        const pos = V.add(a.p, V.mul(dir, ELEMENTS[a.el].radius + (q !== 0 ? 0.3 : a.el === 'H' ? 0.28 : 0.36)));
        if (q !== 0 || ps) (q !== 0 ? o.charge : o.partial).position.set(...pos);
        if (rad) o.dot.position.set(...V.add(a.p, V.mul(V.norm(V.add(dir, [0, 0.25, 0])), ELEMENTS[a.el].radius + 0.2)));
      }
    }

    this._updatePi();

    // Bindungen
    const seen = new Set();
    for (const [k, bd] of sim.bonds) {
      seen.add(k);
      let b = this.bondObjs.get(k);
      if (!b) { b = this._createBond(); this.bondObjs.set(k, b); }
      this._updateBond(b, bd);
    }
    for (const [k, b] of this.bondObjs) {
      if (!seen.has(k)) { this._disposeBond(b); this.bondObjs.delete(k); }
    }

    // Molekülnamen
    const frs = sim.fragments;
    while (this.labels.length < frs.length) this._makeLabel();
    for (let f = 0; f < this.labels.length; f++) {
      const l = this.labels[f];
      if (f >= frs.length) { l.visible = false; continue; }
      const ids = frs[f];
      // während sich Bindungen ändern, keinen (evtl. falschen) Namen zeigen
      if (ids.some((i) => sim.adj[i].some((x) => x.bond.order !== x.bond.target))) { l.visible = false; continue; }
      const charge = sim.fragmentCharge(ids);
      if (this.simpleNames && charge !== 0 && ids.length > 1) { l.visible = false; continue; }
      const [title, sub] = nameFor(sim.formula(ids), charge, this.names);
      const text = title + '|' + sub;
      if (l.userData.text !== text) { l.userData.redraw(title, sub); l.userData.text = text; }
      const pts = ids.map((i) => A[i].p);
      const c = V.centroid(pts);
      const top = Math.max(...pts.map((p) => p[1]));
      l.position.set(c[0], top + (ids.length === 1 ? 1.0 : this.showPartials ? 1.35 : 1.0), c[2]);
      l.visible = true;
    }
    // überlappende Namensschilder übereinander stapeln
    const vis = this.labels.filter((l) => l.visible).sort((p, q) => p.position.y - q.position.y);
    for (let i = 0; i < vis.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = vis[i].position, b = vis[j].position;
        const overlapX = Math.abs(a.x - b.x) < (vis[i].scale.x * 0.55 + vis[j].scale.x * 0.55) / 2 + 0.6;
        if (overlapX && Math.abs(a.z - b.z) < 2.5 && a.y - b.y < 0.8) a.y = b.y + 0.8;
      }
    }

    this._updateAnnotations(time);

    // Pfeile einblenden
    if (this.arrowGroup.children.length) {
      this.arrowFade = Math.min(1, this.arrowFade + dt * 3);
      for (const m of this.arrowGroup.children) m.material.opacity = 0.95 * this.arrowFade;
    }
  }

  /** UV-Lampe mit Lichtkegel (cfg: { x, z, radius, top, bottom } in Å) oder null */
  setLamp(cfg) {
    const key = cfg ? JSON.stringify(cfg) : '';
    if (key === this._lampKey) return;
    this._lampKey = key;
    if (this.lamp) {
      this.root.remove(this.lamp);
      this.lamp.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
      this.lamp = null;
    }
    if (!cfg) return;
    const g = new THREE.Group();
    const h = cfg.top - cfg.bottom;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.radius * 0.45, cfg.radius, h, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    beam.position.set(cfg.x, cfg.bottom + h / 2, cfg.z);
    beam.raycast = () => {};
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.radius * 0.55, cfg.radius * 0.45, 0.6, 24),
      new THREE.MeshStandardMaterial({ color: 0x3a3f55, emissive: 0x5a2fa0, emissiveIntensity: 0.6, roughness: 0.4 }),
    );
    head.position.set(cfg.x, cfg.top + 0.3, cfg.z);
    head.raycast = () => {};
    const label = canvasSprite((ctx, w, hh) => {
      roundRect(ctx, 4, 4, w - 8, hh - 8, 28);
      ctx.fillStyle = 'rgba(60,30,110,0.85)';
      ctx.fill();
      ctx.fillStyle = '#e6d9ff';
      ctx.font = 'bold 54px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('UV-Licht (hν)', w / 2, hh / 2);
    }, 512, 112, 0.6);
    label.userData.redraw();
    label.position.set(cfg.x, cfg.top + 1.0, cfg.z);
    g.add(beam, head, label);
    this.root.add(g);
    this.lamp = g;
  }

  /** Sechsringe aus C-Atomen suchen (nur bei Topologie-Änderung) */
  _findRings() {
    const sim = this.sim, A = sim.atoms;
    if (this._ringsVersion === sim.topoVersion) return;
    this._ringsVersion = sim.topoVersion;
    const rings = [];
    const cN = (i) => sim.adj[i].filter((x) => A[x.j].el === 'C').map((x) => x.j);
    for (let a = 0; a < A.length; a++) {
      if (A[a].el !== 'C') continue;
      const walk = (path) => {
        const cur = path[path.length - 1];
        for (const j of cN(cur)) {
          if (path.length === 6) {
            if (j === a && path[1] < path[5]) rings.push([...path]);
            continue;
          }
          if (j <= a || path.includes(j)) continue;
          walk([...path, j]);
        }
      };
      walk([a]);
    }
    this.rings = rings;
  }

  _piMesh(kind) {
    const used = this.piUsed[kind]++;
    const pool = this.piPool[kind];
    if (!pool[used]) {
      const m = new THREE.Mesh(this.piGeo[kind], this.piMat[kind]());
      m.raycast = () => {};
      m.renderOrder = 5;
      this.piGroup.add(m);
      pool.push(m);
    }
    const m = pool[used];
    m.visible = true;
    return m;
  }

  /** π-Elektronen darstellen: Benzolring (Kreis/Halbkreis bzw. π-Wolke) und C=C (π-Wolke) */
  _updatePi() {
    const sim = this.sim, A = sim.atoms;
    this._findRings();
    this.piUsed = { ring: 0, arc: 0, cloud: 0, cloudArc: 0, lobe: 0 };
    this.flatBonds.clear();
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const ringBonds = new Set();

    for (const r of this.rings) {
      const bonds = r.map((x, k) => sim.bond(x, r[(k + 1) % 6]));
      if (bonds.some((b) => !b)) continue;
      const orders = bonds.map((b) => b.order);
      const w6 = clamp01((Math.min(...orders) - 1) * 2);
      // σ-Komplex: fünf C mit π-Anteil, eines (sp³) ohne
      let w5 = 0;
      for (let k = 0; k < 6; k++) {
        const o4 = [1, 2, 3, 4].map((d) => orders[(k + d) % 6]);
        w5 = Math.max(w5, clamp01((Math.min(...o4) - 1) * 2) * (1 - w6));
      }
      if (w6 < 0.02 && w5 < 0.02) continue;
      bonds.forEach((b) => { if (b.order > 1.01 && b.order < 1.99) this.flatBonds.add(b); });
      const P = r.map((i) => A[i].p);
      const cen = V.centroid(P);
      const rad = P.reduce((s, p) => s + V.dist(p, cen), 0) / 6;
      let n = V.norm(V.cross(V.sub(P[1], P[0]), V.sub(P[2], P[0])));
      const place = (m, scaleR, offset, gapDir) => {
        const z = new THREE.Vector3(...n);
        let u = gapDir ? V.norm(V.reject(gapDir, n)) : V.anyPerp(n);
        // Bogen (240°) beginnt bei +x: so drehen, dass die Lücke bei gapDir liegt
        if (gapDir) u = V.add(V.mul(u, Math.cos(Math.PI / 3)), V.mul(V.cross(n, u), Math.sin(Math.PI / 3)));
        const x = new THREE.Vector3(...u);
        const y = new THREE.Vector3().crossVectors(z, x);
        m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
        m.position.set(...V.add(cen, V.mul(n, offset)));
        m.scale.set(scaleR, scaleR, 1);
      };
      // sp³-Atom im σ-Komplex: das Atom, dessen beide Ringbindungen keinen π-Anteil haben
      let sp3 = -1;
      if (w5 > 0) for (let k = 0; k < 6; k++) if (orders[k] < 1.2 && orders[(k + 5) % 6] < 1.2) sp3 = k;
      const gapDir = sp3 >= 0 ? V.sub(P[sp3], cen) : null;
      if (!this.showPi) {
        if (w6 > 0.02) { const m = this._piMesh('ring'); place(m, rad * 0.62, 0); m.material.opacity = 0.9 * w6; }
        if (w5 > 0.02 && gapDir) { const m = this._piMesh('arc'); place(m, rad * 0.62, 0, gapDir); m.material.opacity = 0.9 * w5; }
      } else {
        for (const side of [1, -1]) {
          if (w6 > 0.02) { const m = this._piMesh('cloud'); place(m, rad, side * 0.62); m.material.opacity = 0.28 * w6; }
          if (w5 > 0.02 && gapDir) { const m = this._piMesh('cloudArc'); place(m, rad, side * 0.62, gapDir); m.material.opacity = 0.28 * w5; }
        }
      }
      bonds.forEach((b) => ringBonds.add(b));
    }

    // C=C außerhalb von Ringen: π-Bindung als zwei Keulen ober-/unterhalb
    if (this.showPi) {
      for (const bd of sim.bonds.values()) {
        if (ringBonds.has(bd) || A[bd.a].el !== 'C' || A[bd.b].el !== 'C') continue;
        const w = clamp01(bd.order - 1);
        if (w < 0.02) continue;
        const pa = A[bd.a].p, pb = A[bd.b].p;
        const dn = V.norm(V.sub(pb, pa));
        const mid = V.lerp(pa, pb, 0.5);
        // Ebene über einen Nachbarn bestimmen, Keulen senkrecht dazu
        let inPlane = null;
        for (const { j } of sim.adj[bd.a]) if (j !== bd.b) { inPlane = V.reject(V.sub(A[j].p, pa), dn); break; }
        if (!inPlane || V.len(inPlane) < 0.1) inPlane = V.anyPerp(dn);
        const n = V.norm(V.cross(dn, V.norm(inPlane)));
        for (const side of [1, -1]) {
          const m = this._piMesh('lobe');
          const x = new THREE.Vector3(...dn), z = new THREE.Vector3(...n);
          const y = new THREE.Vector3().crossVectors(z, x);
          m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
          m.position.set(...V.add(mid, V.mul(n, side * 0.72)));
          m.scale.set(1.0, 0.55, 0.62);
          m.material.opacity = 0.42 * w;
        }
      }
    }
    for (const [kind, pool] of Object.entries(this.piPool)) pool.forEach((m, i) => { if (i >= this.piUsed[kind]) m.visible = false; });
  }

  _updateAnnotations(time) {
    while (this.markerObjs.length < this.markers.length) {
      const m = new THREE.Mesh(
        this.sphereGeo,
        new THREE.MeshBasicMaterial({ color: 0x6dff8a, transparent: true, opacity: 0.25, depthWrite: false, wireframe: true }),
      );
      m.raycast = () => {};
      this.root.add(m);
      this.markerObjs.push(m);
    }
    this.markerObjs.forEach((m, i) => {
      const mk = this.markers[i];
      m.visible = !!mk;
      if (!mk) return;
      m.position.set(...mk.p);
      m.scale.setScalar(0.42 + 0.05 * Math.sin(time * 4));
      m.material.color.setHex(mk.color ?? 0x6dff8a);
      m.material.opacity = mk.opacity ?? 0.35;
    });
    while (this.tagObjs.length < this.tags.length) {
      const t = canvasSprite((ctx, w, h, text, color) => {
        roundRect(ctx, 6, 6, w - 12, h - 12, 26);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 72px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2 + 4);
      }, 200, 112, 0.42);
      t.userData.key = '';
      this.root.add(t);
      this.tagObjs.push(t);
    }
    const A = this.sim.atoms;
    this.tagObjs.forEach((t, i) => {
      const tg = this.tags[i];
      t.visible = !!tg && (tg.p || !!A[tg.atom]);
      if (!t.visible) return;
      const key = tg.text + tg.color;
      if (t.userData.key !== key) { t.userData.redraw(tg.text, tg.color || '#7b3fd6'); t.userData.key = key; }
      // unterhalb des Atoms, damit es nicht mit Ladungen und Namen kollidiert
      if (tg.p) t.position.set(...tg.p);
      else t.position.set(A[tg.atom].p[0], A[tg.atom].p[1] - 0.75, A[tg.atom].p[2] + 0.2);
    });
  }

  /**
   * Vorzeichen der Partialladung aus den polaren Bindungen: Unterschied der
   * Elektronegativität > 0,4 (C–O, O–H, C–Br, H–Br; C–H gilt als unpolar).
   */
  _partialSign(i) {
    const A = this.sim.atoms;
    const ei = EN[A[i].el];
    let sum = 0;
    for (const { j, bond } of this.sim.adj[i]) {
      if (bond.order < 0.5) continue;
      const d = EN[A[j].el] - ei;
      if (Math.abs(d) > 0.4) sum += Math.sign(d); // Partner elektronegativer → δ+
    }
    return Math.sign(sum);
  }

  _updateBond(b, bd) {
    const A = this.sim.atoms;
    const pa = A[bd.a].p, pb = A[bd.b].p;
    const d = V.sub(pb, pa);
    const len = V.len(d);
    const dn = V.norm(d);
    const mid = V.lerp(pa, pb, 0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(...dn));

    // Ebene der Doppelbindung: über ein Nachbaratom festlegen
    let perp = null;
    for (const [c, other] of [[bd.a, bd.b], [bd.b, bd.a]]) {
      // C-Nachbarn zuerst: bei Ringen liegt die zweite Linie dann innen
      const cand = [...this.sim.adj[c]].sort((x, y) => (A[y.j].el === 'C') - (A[x.j].el === 'C'));
      for (const { j } of cand) {
        if (j === other) continue;
        const r = V.reject(V.sub(A[j].p, A[c].p), dn);
        if (V.len(r) > 0.1) { perp = V.norm(r); break; }
      }
      if (perp) break;
    }
    perp ||= V.anyPerp(dn);

    // aromatische Ringbindungen einfach zeichnen (π-System zeigt Ringsymbol bzw. Wolke)
    const o = this.flatBonds.has(bd) ? Math.min(bd.order, 1) : bd.order;
    const off = Math.max(0, Math.min(1, o - 1));
    const r = 0.085 - 0.022 * off;
    const active = bd.order !== bd.target;
    for (const [m, sign, opacity] of [[b.c1, -1, Math.min(1, o)], [b.c2, 1, off]]) {
      m.visible = opacity > 0.01;
      if (!m.visible) continue;
      m.position.set(...V.add(mid, V.mul(perp, sign * 0.1 * off)));
      m.quaternion.copy(q);
      m.scale.set(r, len, r);
      m.material.opacity = opacity;
      m.material.transparent = opacity < 0.999;
      m.material.depthWrite = opacity >= 0.999;
      m.material.color.copy(BOND_COLOR).lerp(BOND_ACTIVE, active ? 0.7 : 0);
    }
  }
}
