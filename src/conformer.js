// Konformationsoptimierung: Drehung um Einfachbindungen in die energetisch
// günstigste Stellung. Das PBD-Kraftfeld kennt nur Bindungslängen und -winkel;
// hier kommen ein einfaches Torsionspotential und sterische Abstoßung dazu:
//   sp³–sp³:            V₃/2 · (1 + cos 3φ)        → gestaffelt
//   O=C–O–X (Säure/Ester): 3 · (1 − cos φ)/2        → syn/Z (φ ≈ 0°)
//   C–O (Alkohol/Ether): V₃ klein                   → gestaffelt
//   Sterik (≥ 3 Bindungen entfernt): Strafe, wenn näher als 0,85·(rᵢ + rⱼ) (van-der-Waals)
// Die Suche dreht nacheinander jede drehbare Bindung in 10°-Schritten (gierig,
// zwei Durchgänge) und liefert die Drehungen als Liste, die animiert werden kann.

import { V, Q } from './vec.js';

const VDW = { H: 1.2, C: 1.7, O: 1.52, Br: 1.85, Fe: 2.0 };

function dihedral(p0, p1, p2, p3) {
  const b1 = V.sub(p1, p0), b2 = V.sub(p2, p1), b3 = V.sub(p3, p2);
  const n1 = V.cross(b1, b2), n2 = V.cross(b2, b3);
  const m = V.cross(n1, V.norm(b2));
  return Math.atan2(V.dot(m, n2), V.dot(n1, n2));
}

/** drehbare Bindungen eines Fragments: [b, c, Atome auf der c-Seite, Torsionsterme] */
function rotatableBonds(sim, ids) {
  const A = sim.atoms;
  const inFrag = new Set(ids);
  const nb = (i) => sim.nbrs(i).map((x) => x.j).filter((j) => inFrag.has(j));
  const out = [];
  for (const bd of sim.bonds.values()) {
    const { a: b, b: c } = bd;
    if (!inFrag.has(b) || bd.target !== 1 || bd.order !== 1) continue;
    const nbB = nb(b).filter((j) => j !== c), nbC = nb(c).filter((j) => j !== b);
    if (!nbB.length || !nbC.length) continue;
    // Atome auf der c-Seite sammeln; erreicht man b, liegt die Bindung in einem Ring
    const side = [c];
    let ring = false;
    for (let q = 0; q < side.length && !ring; q++) {
      for (const j of nb(side[q])) {
        if (side[q] === c && j === b) continue;
        if (j === b) { ring = true; break; }
        if (!side.includes(j)) side.push(j);
      }
    }
    if (ring) continue;
    // kleinere Seite drehen
    const small = side.length <= ids.length / 2 ? { pivot: b, axisTo: c, atoms: side } : null;
    const atoms = small ? side : ids.filter((i) => !side.includes(i));
    out.push({ b, c, atoms, pivot: small ? b : c, axisTo: small ? c : b, terms: torsionTerms(sim, b, c, nbB, nbC) });
  }
  return out;
}

function torsionTerms(sim, b, c, nbB, nbC) {
  const A = sim.atoms;
  const nB = sim.nbrs(b), nC = sim.nbrs(c);
  const sp3 = (i, n) => A[i].el === 'C' && n.length === 4;
  const terms = [];
  const carbonylO = (x, n) => n.find((y) => y.o === 2 && A[y.j].el === 'O')?.j;
  if (sp3(b, nB) && sp3(c, nC)) {
    for (const a of nbB) for (const d of nbC) terms.push({ a, d, k: 1.0 / (nbB.length * nbC.length) * 3, n: 3 });
  } else if (A[b].el === 'O' || A[c].el === 'O') {
    const [o, x] = A[b].el === 'O' ? [c, b] : [b, c]; // x = O, o = Partner
    const nbO = x === b ? nbB : nbC, nbP = x === b ? nbC : nbB;
    const co = carbonylO(o, o === b ? nB : nC);
    if (co != null) {
      // O=C–O–X syn (Z-Ester, syn-Carbonsäure)
      for (const xx of nbO) terms.push({ a: co, d: xx, k: 3, n: 1, syn: true, order: o === b ? 'ad' : 'da' });
    } else if (sp3(o, o === b ? nB : nC)) {
      for (const a of nbP) for (const d of nbO) terms.push({ a, d, k: 0.6 / nbP.length, n: 3, order: o === b ? 'ad' : 'da' });
    }
  }
  return terms;
}

function energy(sim, ids, P, bonds, pairs) {
  let e = 0;
  for (const rb of bonds) {
    for (const t of rb.terms) {
      const [a, d] = t.order === 'da' ? [t.d, t.a] : [t.a, t.d];
      const phi = dihedral(P.get(a), P.get(rb.b), P.get(rb.c), P.get(d));
      e += t.syn ? (t.k * (1 - Math.cos(phi))) / 2 : (t.k * (1 + Math.cos(t.n * phi))) / 2;
    }
  }
  for (const [i, j, r0] of pairs) {
    const d = V.dist(P.get(i), P.get(j));
    if (d < r0) e += 2 * (r0 - d) * (r0 - d);
  }
  return e;
}

/** Paare mit ≥ 3 Bindungen Abstand für die Sterik */
function stericPairs(sim, ids) {
  const A = sim.atoms;
  const set = new Set(ids);
  const near = new Map();
  for (const i of ids) {
    const s = new Set([i]);
    for (const { j } of sim.adj[i]) {
      s.add(j);
      for (const { j: k } of sim.adj[j]) s.add(k);
    }
    near.set(i, s);
  }
  const out = [];
  for (let x = 0; x < ids.length; x++) {
    for (let y = x + 1; y < ids.length; y++) {
      const i = ids[x], j = ids[y];
      if (!set.has(j) || near.get(i).has(j)) continue;
      out.push([i, j, 0.85 * ((VDW[A[i].el] || 1.6) + (VDW[A[j].el] || 1.6))]);
    }
  }
  return out;
}

function rotateInto(P, rb, angle) {
  const pv = P.get(rb.pivot), axis = V.norm(V.sub(P.get(rb.axisTo), pv));
  const q = Q.fromAxisAngle(axis, angle);
  for (const i of rb.atoms) P.set(i, V.add(pv, Q.rotate(q, V.sub(P.get(i), pv))));
}

/** Liste der Drehungen [{ rb, angle }] für ein Fragment (Atom-IDs) */
export function planConformation(sim, ids) {
  sim.ensureTopo();
  const bonds = rotatableBonds(sim, ids);
  if (!bonds.length) return [];
  const pairs = stericPairs(sim, ids);
  const P = new Map(ids.map((i) => [i, [...sim.atoms[i].p]]));
  const ops = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const rb of bonds) {
      const e0 = energy(sim, ids, P, bonds, pairs);
      let best = 0, bestE = e0;
      for (let k = 1; k < 36; k++) {
        const ang = (k * 10 * Math.PI) / 180;
        const Pt = new Map(P);
        rotateInto(Pt, rb, ang);
        const e = energy(sim, ids, Pt, bonds, pairs);
        if (e < bestE - 0.02) { bestE = e; best = ang; }
      }
      if (best) {
        const a = best > Math.PI ? best - 2 * Math.PI : best;
        rotateInto(P, rb, a);
        ops.push({ rb, angle: a, gain: e0 - bestE });
      }
    }
  }
  return ops;
}

/** Sofort anwenden (z. B. beim Erzeugen eines Moleküls) */
export function optimizeNow(sim, ids) {
  const ops = planConformation(sim, ids);
  const P = new Map(ids.map((i) => [i, sim.atoms[i].p]));
  for (const { rb, angle } of ops) {
    rotateInto(P, rb, angle);
    for (const i of rb.atoms) sim.atoms[i].p = P.get(i);
  }
  return ops.length;
}

/** Animiert nacheinander in die günstigste Konformation drehen */
export function optimizeAnimated(sim, ids, dur = 0.55) {
  const ops = planConformation(sim, ids).filter((o) => Math.abs(o.angle) > (6 * Math.PI) / 180);
  const step = (k) => {
    if (k >= ops.length) return;
    const { rb, angle } = ops[k];
    const pv = sim.atoms[rb.pivot].p;
    const axis = V.norm(V.sub(sim.atoms[rb.axisTo].p, pv));
    sim.addMove(rb.atoms, { pivot: [...pv], rot: Q.fromAxisAngle(axis, angle) }, dur * Math.min(1.6, 0.5 + Math.abs(angle) / Math.PI), () => step(k + 1));
  };
  step(0);
  return ops.length;
}

/** Bindungen, die noch nicht optimal stehen (Drehung > tol Grad würde Energie sparen) */
export function unrelaxed(sim, ids, tol = 15, minGain = 0.1) {
  return planConformation(sim, ids).filter((o) => Math.abs(o.angle) > (tol * Math.PI) / 180 && o.gain > minGain)
    .map((o) => `${sim.atoms[o.rb.b].el}${o.rb.b}–${sim.atoms[o.rb.c].el}${o.rb.c}: ${((o.angle * 180) / Math.PI).toFixed(0)}°`);
}

export { dihedral };
