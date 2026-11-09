// Chemie-Kern: Atome, Bindungen und ein kleines "Kraftfeld" auf Basis von
// Position Based Dynamics (PBD). Es gibt keine Geschwindigkeiten – Atome
// entspannen sich in jedem Frame Richtung Gleichgewichtsgeometrie. Ändert sich
// eine Bindung (Bindungsordnung wird über die Zeit animiert), ergibt sich die
// Bewegung der Atome daraus von selbst.
//
// Einheiten: Ångström. Die Darstellung skaliert das später in den Raum.

import { V, Q } from './vec.js';

export const ELEMENTS = {
  H: { mass: 1.008, radius: 0.25, color: 0xf4f4f4 },
  C: { mass: 12.011, radius: 0.4, color: 0x3c3c3c },
  O: { mass: 15.999, radius: 0.38, color: 0xe2382d },
  Br: { mass: 79.904, radius: 0.5, color: 0x9c3a1e },
  Fe: { mass: 55.845, radius: 0.55, color: 0xe08a2e },
};

export const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const DEG = Math.PI / 180;
const bkey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export class Sim {
  constructor() {
    this.generation = 0;
    this.reset();
  }

  reset() {
    this.atoms = [];
    this.bonds = new Map();
    this.moves = [];
    this.adj = []; // physisch vorhandene Bindungen je Atom: [{ j, bond }]
    this.frag = []; // Fragment-Index je Atom
    this.fragments = []; // Liste von Atom-ID-Listen (zusammenhängende Moleküle)
    this.pairs = []; // Abstoßungspaare [i, j, dmin]
    // Sonderwinkel je Zentralatom: c -> (j, k) => Winkel in rad oder null (z. B. SN2-Übergangszustand)
    this.angleOverride = new Map();
    this.topoDirty = true;
    this.generation++;
  }

  addAtom(el, p, tag = {}) {
    const id = this.atoms.length;
    // radical: Anzahl ungepaarter Elektronen (Ziel), radicalPrev: Wert vor der letzten Änderung
    this.atoms.push({ id, el, p: [...p], kin: false, moving: false, tag: { ...tag }, radical: 0, radicalPrev: 0 });
    this.topoDirty = true;
    return id;
  }

  bond(a, b) {
    return this.bonds.get(bkey(a, b));
  }

  /** Logische (Ziel-)Bindungsordnung */
  order(a, b) {
    const bd = this.bond(a, b);
    return bd ? bd.target : 0;
  }

  /**
   * Bindungsordnung von a–b über `dur` Sekunden auf `target` animieren.
   * target 0 = Bindung bricht, 1 = Einfach-, 2 = Doppelbindung.
   */
  setBond(a, b, target, dur = 0) {
    let bd = this.bond(a, b);
    const d = V.dist(this.atoms[a].p, this.atoms[b].p);
    if (!bd) {
      if (target <= 0) return;
      bd = { a: Math.min(a, b), b: Math.max(a, b), order: 0, from: 0, target: 0, t: 0, dur: 0, far: d };
      this.bonds.set(bkey(a, b), bd);
    }
    if (bd.order <= 0.001) bd.far = Math.min(Math.max(d, 1.2), 4.0); // entsteht: startet beim aktuellen Abstand
    else if (target < bd.order && bd.order >= 0.999) {
      // bricht (ganz oder teilweise, z. B. Übergangszustand): Atome weichen auseinander
      bd.far = target <= 0 ? Math.max(d + 1.8, 3.4) : d + 1.2;
    }
    bd.from = bd.order;
    bd.target = target;
    bd.t = 0;
    bd.dur = dur;
    if (dur <= 0) bd.order = target;
    this.topoDirty = true;
  }

  isAnimating() {
    if (this.moves.length) return true;
    for (const bd of this.bonds.values()) if (bd.order !== bd.target) return true;
    return false;
  }

  ensureTopo() {
    if (this.topoDirty) this.rebuild();
  }

  rebuild() {
    this.topoVersion = (this.topoVersion || 0) + 1;
    const n = this.atoms.length;
    for (const [k, bd] of this.bonds) if (bd.order <= 0 && bd.target <= 0) this.bonds.delete(k);

    this.adj = Array.from({ length: n }, () => []);
    for (const bd of this.bonds.values()) {
      this.adj[bd.a].push({ j: bd.b, bond: bd });
      this.adj[bd.b].push({ j: bd.a, bond: bd });
    }

    this.frag = new Array(n).fill(-1);
    this.fragments = [];
    for (let i = 0; i < n; i++) {
      if (this.frag[i] >= 0) continue;
      const f = this.fragments.length;
      const list = [i];
      this.frag[i] = f;
      for (let q = 0; q < list.length; q++) {
        for (const { j } of this.adj[list[q]]) {
          if (this.frag[j] < 0) {
            this.frag[j] = f;
            list.push(j);
          }
        }
      }
      this.fragments.push(list);
    }

    // Paare mit topologischem Abstand <= 2 werden über Bindungs-/Winkel-Constraints
    // geregelt, alle anderen bekommen eine weiche Mindestabstands-Abstoßung.
    const near = this.atoms.map((_, i) => {
      const s = new Set([i]);
      for (const { j } of this.adj[i]) {
        s.add(j);
        for (const { j: k } of this.adj[j]) s.add(k);
      }
      return s;
    });
    // 1,4-Paare (drei Bindungen auseinander) dürfen sich näher kommen – sonst
    // würden syn-/gauche-Konformationen (z. B. O=C–O–H) herausgedrückt
    const near3 = near.map((s) => {
      const t = new Set(s);
      for (const k of s) for (const { j } of this.adj[k]) t.add(j);
      return t;
    });
    this.pairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (near[i].has(j)) continue;
        const hi = this.atoms[i].el === 'H', hj = this.atoms[j].el === 'H';
        if (this.frag[i] === this.frag[j] && near3[i].has(j)) {
          this.pairs.push([i, j, hi && hj ? 1.8 : hi || hj ? 2.0 : 2.2, 0.3]);
          continue;
        }
        // Innerhalb eines Moleküls: sterische Abstoßung (verhindert Verknäulen).
        // Zwischen Molekülen nur schwach – sonst schiebt ein herangeführtes
        // Molekül seinen Reaktionspartner vor sich her.
        if (this.frag[i] === this.frag[j]) this.pairs.push([i, j, hi && hj ? 2.0 : hi || hj ? 2.3 : 2.6, 0.3]);
        else this.pairs.push([i, j, hi || hj ? 1.1 : 1.5, 0.08]);
      }
    }
    this.topoDirty = false;
  }

  /** Logische Nachbarn (Zielordnung > 0) */
  nbrs(i) {
    this.ensureTopo();
    return this.adj[i].filter((x) => x.bond.target > 0).map((x) => ({ j: x.j, o: x.bond.target }));
  }

  fragmentOf(i) {
    this.ensureTopo();
    return this.fragments[this.frag[i]];
  }

  maxOrder(i, except = null) {
    let m = 0;
    for (const { bond } of this.adj[i]) if (bond !== except) m = Math.max(m, bond.order);
    return m;
  }

  /**
   * sp²-Anteil eines C-Atoms (0 = sp³, 1 = sp²): über eine Doppelbindung
   * oder – beim Carbenium-Ion – über eine fehlende vierte Bindung.
   */
  spC(c, except = null) {
    let maxO = 0, sum = 0;
    for (const { bond } of this.adj[c]) {
      if (bond === except) continue;
      maxO = Math.max(maxO, bond.order);
      sum += bond.order;
    }
    const nb = this.adj[c].length - (except ? 1 : 0);
    const cation = nb >= 2 ? clamp01(4 - (except ? 1 : 0) - sum) : 0;
    // ab Ordnung 1,5 (aromatisch) voll sp²
    return Math.max(clamp01((maxO - 1) * 2), cation);
  }

  restLen(bd) {
    const A = this.atoms[bd.a], B = this.atoms[bd.b];
    const pair = [A.el, B.el].sort().join('');
    let L1, L2;
    switch (pair) {
      case 'CH': L1 = 1.09; L2 = 1.0; break;
      case 'HO': L1 = 0.97; L2 = 0.9; break;
      case 'CC': {
        // aromatisch (Ordnung 1,5): 1,40 Å
        const o = bd.order;
        if (o > 1 && o < 2) return o <= 1.5 ? 1.51 + (1.395 - 1.51) * (o - 1) * 2 : 1.395 + (1.34 - 1.395) * (o - 1.5) * 2;
        L1 = 1.51; L2 = 1.34;
        break;
      }
      case 'CO': {
        // C–O-Einfachbindung am Carbonyl-C (Säure/Ester) ist kürzer (Mesomerie)
        const c = A.el === 'C' ? bd.a : bd.b;
        const s = this.spC(c, bd);
        L1 = 1.43 - 0.08 * s;
        L2 = 1.22;
        break;
      }
      case 'BrC': L1 = 1.94; L2 = 1.8; break;
      case 'BrH': L1 = 1.41; L2 = 1.3; break;
      case 'BrBr': L1 = 2.28; L2 = 2.1; break;
      case 'BrFe': L1 = 2.33; L2 = 2.2; break;
      default: L1 = 1.4; L2 = 1.25;
    }
    const o = bd.order;
    if (o >= 1) return L1 + (L2 - L1) * Math.min(o - 1, 1);
    return bd.far + (L1 - bd.far) * o;
  }

  /** Idealer Bindungswinkel am Zentralatom c (Hybridisierung aus aktuellen Bindungsordnungen) */
  idealAngle(c) {
    const A = this.atoms[c];
    const nb = this.adj[c];
    let maxO = 0, wsum = 0;
    for (const { bond } of nb) {
      maxO = Math.max(maxO, bond.order);
      wsum += Math.min(bond.order, 1);
    }
    const s = clamp01(maxO - 1); // 0 = sp3, 1 = sp2
    if (A.el === 'C') return (109.47 + (120 - 109.47) * this.spC(c)) * DEG;
    // Fe: FeBr₃ trigonal-planar, FeBr₄⁻ tetraedrisch
    if (A.el === 'Fe') return (120 - (120 - 109.47) * clamp01(wsum - 3)) * DEG;
    if (A.el === 'O') {
      let base;
      if (wsum > 2.4) base = 110; // Oxonium (pyramidal)
      else {
        const els = nb.map((x) => this.atoms[x.j].el);
        if (els.every((e) => e === 'H')) base = 104.5;
        else if (els.includes('H')) base = 107;
        else {
          const conj = nb.some((x) => this.atoms[x.j].el === 'C' && this.spC(x.j) > 0.5);
          base = conj ? 116 : 111;
        }
      }
      return (base + (120 - base) * s) * DEG;
    }
    return 109.47 * DEG;
  }

  invMass(a) {
    return a.kin || a.moving ? 0 : 1 / ELEMENTS[a.el].mass;
  }

  solve(iters = 8, k = 0.5) {
    this.ensureTopo();
    const A = this.atoms;
    const w = A.map((a) => this.invMass(a));
    const cons = []; // flach: i, j, rest, stiffness

    for (const bd of this.bonds.values()) cons.push(bd.a, bd.b, this.restLen(bd), k);

    for (let c = 0; c < A.length; c++) {
      const nb = this.adj[c];
      if (nb.length < 2) continue;
      const cosIdeal = Math.cos(this.idealAngle(c));
      const ov = this.angleOverride.get(c);
      for (let x = 0; x < nb.length; x++) {
        for (let y = x + 1; y < nb.length; y++) {
          const bx = nb[x].bond, by = nb[y].bond;
          const wgt = Math.min(1, bx.order) * Math.min(1, by.order);
          if (wgt <= 0.001) continue;
          const special = ov ? ov(nb[x].j, nb[y].j) : null;
          const cosT = special == null ? cosIdeal : Math.cos(special);
          const r1 = this.restLen(bx), r2 = this.restLen(by);
          const d = Math.sqrt(r1 * r1 + r2 * r2 - 2 * r1 * r2 * cosT);
          cons.push(nb[x].j, nb[y].j, d, k * 0.6 * wgt);
        }
      }
    }

    const pairs = this.pairs;
    for (let it = 0; it < iters; it++) {
      for (let n = 0; n < cons.length; n += 4) {
        this._dist(cons[n], cons[n + 1], cons[n + 2], cons[n + 3], w, false);
      }
      for (let n = 0; n < pairs.length; n++) {
        const pr = pairs[n];
        this._dist(pr[0], pr[1], pr[2], pr[3], w, true);
      }
    }
  }

  _dist(i, j, rest, k, w, minOnly) {
    const wi = w[i], wj = w[j];
    const ws = wi + wj;
    if (ws === 0) return;
    const pi = this.atoms[i].p, pj = this.atoms[j].p;
    let dx = pj[0] - pi[0], dy = pj[1] - pi[1], dz = pj[2] - pi[2];
    let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (minOnly && d >= rest) return;
    if (d < 1e-6) {
      dx = 1e-3; dy = 0; dz = 0; d = 1e-3;
    }
    const c = ((d - rest) / d) * k / ws;
    pi[0] += dx * c * wi; pi[1] += dy * c * wi; pi[2] += dz * c * wi;
    pj[0] -= dx * c * wj; pj[1] -= dy * c * wj; pj[2] -= dz * c * wj;
  }

  /** Starre, kinematische Bewegung einer Atomgruppe (Rotation um pivot, dann Translation). */
  addMove(ids, { pivot = [0, 0, 0], rot = Q.identity(), trans = [0, 0, 0] }, dur, onDone) {
    // laufende Bewegungen derselben Atome ablösen
    const set = new Set(ids);
    this.moves = this.moves.filter((m) => !m.ids.some((i) => set.has(i)));
    const start = ids.map((i) => [...this.atoms[i].p]);
    for (const i of ids) this.atoms[i].moving = true;
    this.moves.push({ ids, start, pivot, rot, trans, dur: Math.max(dur, 1e-3), t: 0, onDone });
  }

  _updateMoves(dt) {
    const id = Q.identity();
    for (const m of [...this.moves]) {
      m.t += dt;
      const s = smoothstep(m.t / m.dur);
      const q = Q.slerp(id, m.rot, s);
      for (let k = 0; k < m.ids.length; k++) {
        const rel = V.sub(m.start[k], m.pivot);
        this.atoms[m.ids[k]].p = V.add(V.add(m.pivot, V.mul(m.trans, s)), Q.rotate(q, rel));
      }
      if (m.t >= m.dur) {
        for (const i of m.ids) this.atoms[i].moving = false;
        this.moves.splice(this.moves.indexOf(m), 1);
        m.onDone?.();
      }
    }
  }

  step(dt) {
    this.ensureTopo();
    for (const bd of this.bonds.values()) {
      if (bd.order !== bd.target) {
        bd.t += dt;
        const s = bd.dur > 0 ? smoothstep(bd.t / bd.dur) : 1;
        bd.order = bd.t >= bd.dur ? bd.target : bd.from + (bd.target - bd.from) * s;
        if (bd.order <= 0 && bd.target <= 0) this.topoDirty = true;
      }
    }
    this.ensureTopo();
    this._updateMoves(dt);
    this.solve(8);
  }

  relax(iters = 300) {
    for (let i = 0; i < iters; i++) this.solve(1);
  }

  /** Formalladung aus Bindungsordnungen. useTarget: logisch statt aktuell angezeigt. */
  /** Radikal-Elektronen setzen (wird beim Umbau zusammen mit setBond aufgerufen) */
  setRadical(i, n) {
    const a = this.atoms[i];
    a.radicalPrev = a.radical;
    a.radical = n;
  }

  _bondSum(i, useTarget) {
    let sum = 0;
    for (const { bond } of this.adj[i]) sum += useTarget ? bond.target : Math.round(bond.order);
    return sum;
  }

  /**
   * Ungepaarte Elektronen. Während einer Bindungsänderung gilt der neue Wert erst,
   * wenn die (gerundeten) Bindungen den Zielzustand erreicht haben.
   */
  radicalOf(i, useTarget = false) {
    const a = this.atoms[i];
    if (useTarget || a.radical === a.radicalPrev) return a.radical;
    return this._bondSum(i, false) === this._bondSum(i, true) ? a.radical : a.radicalPrev;
  }

  formalCharge(i, useTarget = false) {
    this.ensureTopo();
    const sum = this._bondSum(i, useTarget);
    const r = this.radicalOf(i, useTarget);
    const el = this.atoms[i].el;
    if (el === 'H') return sum === 0 && !r ? 1 : 0;
    if (el === 'O') return sum - 2 + r;
    if (el === 'C') return sum <= 4 ? 4 - sum - r : 0;
    if (el === 'Br') return sum - 1 + r; // Br⁻ (0 Bindungen), Br• (0 + Radikal), Bromonium (2)
    if (el === 'Fe') return 3 - sum; // FeBr₃ neutral, FeBr₄⁻ −1
    return 0;
  }

  /** Summenformel (C, H, dann alphabetisch; ohne C: H zuerst) */
  formula(ids) {
    const c = {};
    for (const i of ids) c[this.atoms[i].el] = (c[this.atoms[i].el] || 0) + 1;
    const part = (el) => (c[el] ? el + (c[el] > 1 ? c[el] : '') : '');
    const rest = Object.keys(c).filter((e) => e !== 'C' && e !== 'H').sort();
    return part('C') + part('H') + rest.map(part).join('');
  }

  fragmentCharge(ids) {
    let q = 0;
    for (const i of ids) q += this.formalCharge(i, true);
    return q;
  }
}
