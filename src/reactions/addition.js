// Elektrophile Addition von Brom an Ethen:
//   CH₂=CH₂ + Br₂  →  π-Komplex (Br₂ polarisiert)
//                 →  Bromonium-Ion (Dreiring, Br⁺) + Br⁻
//   Br⁻ greift von der Gegenseite an (anti)  →  CH₂Br–CH₂Br
// Der Dreiring braucht Sonderwinkel (Br–C–C ≈ 68°, C–Br–C ≈ 43°), die das
// Kraftfeld über sim.angleOverride bekommt.

import { V, Q } from '../vec.js';
import { COLORS } from '../mechanism.js';
import { ReactionBase, near } from './base.js';

const DEG = Math.PI / 180;
const T = { approach: 2.9, polarize: 3.8, attack: 2.8, anti: -0.6, syn: -0.1 };
const lerp = (a, b, t) => a + (b - a) * t;

export class Addition extends ReactionBase {
  static id = 'addition';
  static title = 'Elektrophile Addition';
  static example = 'Ethen + Brom → 1,2-Dibromethan (über das Bromonium-Ion)';
  static pi = true; // Schalter „π-Elektronenwolke“
  static steps = ['π-Komplex', 'Bromonium-Ion', 'Anti-Angriff des Br⁻'];
  static scenarios = {
    ethene: {
      label: 'Ethen + Brom',
      items: [
        ['ethene', [-1.3, -0.4, -0.6], [-1.25, 0.3, 0]],
        ['bromine', [3.2, 1.2, 1.6], [0, 0.6, 0.3]],
      ],
    },
  };
  static extra = ['ethene', 'bromine'];
  static counters = [{ key: 'addition', label: 'Additionen' }];

  // ---------- Erkennung ----------

  /** C=C-Doppelbindung (Alken): gibt beide C, Ebenen-Normale-Basis zurück */
  alkene(c) {
    const s = this.sim, A = s.atoms;
    if (A[c].el !== 'C') return null;
    const dbl = s.nbrs(c).find((x) => x.o === 2 && A[x.j].el === 'C');
    if (!dbl || dbl.j < c) return null; // jedes Alken nur einmal
    return { c1: c, c2: dbl.j };
  }

  bromine(b) {
    const s = this.sim, A = s.atoms;
    if (A[b].el !== 'Br') return null;
    const nb = s.nbrs(b);
    if (nb.length !== 1 || A[nb[0].j].el !== 'Br' || nb[0].j < b) return null;
    return { a: b, b: nb[0].j };
  }

  bromide(b) {
    return this.sim.atoms[b].el === 'Br' && this.sim.nbrs(b).length === 0 ? b : null;
  }

  /** Bromonium-Ion: Br mit zwei Bindungen zu zwei verbundenen C */
  bromonium(b) {
    const s = this.sim, A = s.atoms;
    if (A[b].el !== 'Br') return null;
    const nb = s.nbrs(b);
    if (nb.length !== 2 || nb.some((x) => A[x.j].el !== 'C')) return null;
    const [c1, c2] = nb.map((x) => x.j);
    if (!s.order(c1, c2)) return null;
    return { br: b, c1, c2 };
  }

  planeNormal(al, toward) {
    const s = this.sim, A = s.atoms;
    const h = s.nbrs(al.c1).find((x) => x.j !== al.c2).j;
    let n = V.norm(V.cross(V.sub(A[al.c2].p, A[al.c1].p), V.sub(A[h].p, A[al.c1].p)));
    const mid = V.lerp(A[al.c1].p, A[al.c2].p, 0.5);
    if (V.dot(V.sub(toward, mid), n) < 0) n = V.mul(n, -1);
    return n;
  }

  /** Ringwinkel am C des Bromonium-Ions */
  ringAngleC(c, other, br) {
    return (j, k) => {
      const has = (x) => j === x || k === x;
      if (has(other) && has(br)) return 68 * DEG;
      if (has(br)) return 112 * DEG;
      if (has(other)) return 119 * DEG;
      return 116 * DEG;
    };
  }

  scan() {
    const A = this.sim.atoms;
    const out = { alkenes: [], br2: [], bromides: [], ions: [] };
    for (let i = 0; i < A.length; i++) {
      const al = this.alkene(i); if (al) out.alkenes.push(al);
      const b2 = this.bromine(i); if (b2) out.br2.push(b2);
      if (this.bromide(i) != null) out.bromides.push(i);
      const ion = this.bromonium(i); if (ion) out.ions.push(ion);
    }
    return out;
  }

  // ---------- Regeln ----------

  check() {
    const s = this.sim, A = s.atoms;
    const { alkenes, br2, bromides, ions } = this.scan();

    // 2) Bromonium-Ion vorhanden: Bromid-Ion von der Gegenseite an ein C
    for (const ion of ions) {
      this.hl(ion.br, COLORS.carbonylO, 0.4);
      for (const c of [ion.c1, ion.c2]) {
        this.hl(c, COLORS.activatedC, 0.6);
        const back = V.norm(V.sub(A[c].p, A[ion.br].p));
        let best = 0;
        for (const b of bromides) {
          const d = V.dist(A[b].p, A[c].p);
          const cosA = V.dot(V.norm(V.sub(A[b].p, A[c].p)), V.mul(back, -1));
          best = Math.max(best, near(V.dist(A[b].p, V.add(A[c].p, V.mul(back, 2.5))), 2.5));
          this.hl(b, COLORS.nucleophile, 0.4 + 0.6 * near(d, T.attack));
          if (d >= T.attack) continue;
          if (cosA < T.anti) return this.startOpening(ion, c, b);
          if (cosA > T.syn) this._hint('Von dieser Seite geht es nicht: Das große Bromonium-Brom schirmt diese Seite des Moleküls ab. Das Bromid-Ion muss von der Gegenseite angreifen (anti) – grüne Markierung.');
        }
        this.m.markers.push({ p: V.add(A[c].p, V.mul(back, 2.5)), color: COLORS.nucleophile, opacity: 0.2 + 0.4 * best });
      }
    }

    // 1) Br₂ an die Doppelbindung → π-Komplex → Bromonium-Ion
    for (const al of alkenes) {
      const mid = V.lerp(A[al.c1].p, A[al.c2].p, 0.5);
      this.hl(al.c1, COLORS.carbonylO, 0.45);
      this.hl(al.c2, COLORS.carbonylO, 0.45);
      for (const b2 of br2) {
        const [near1, far1] = V.dist(A[b2.a].p, mid) < V.dist(A[b2.b].p, mid) ? [b2.a, b2.b] : [b2.b, b2.a];
        const d = V.dist(A[near1].p, mid);
        this.hl(near1, COLORS.nucleophile, 0.4 + 0.6 * near(d, T.approach));
        this.hl(far1, COLORS.nucleophile, 0.3);
        // induzierte Polarisierung schon bei der Annäherung zeigen
        if (d < T.polarize) {
          this.m.partialOverride.set(near1, 1);
          this.m.partialOverride.set(far1, -1);
        }
        if (d < T.approach) return this.startBromonium(al, { near: near1, far: far1 });
      }
    }

    let g;
    if (ions.length && bromides.length) g = 'Bromonium-Ion: Bringe das Bromid-Ion (grün) von der Gegenseite an eines der beiden C-Atome (orange) – gegenüber vom Brom des Dreirings (grüne Markierung).';
    else if (alkenes.length && br2.length) g = 'Bringe ein Brom-Molekül (grün) an die C=C-Doppelbindung (gelb) – am besten senkrecht von oben oder unten auf die Mitte der Doppelbindung. Achte auf die Polarisierung (δ+/δ−).';
    else if (alkenes.length) g = 'Kein Brom mehr vorhanden – lege Edukte nach.';
    else g = 'Keine Doppelbindung mehr vorhanden – starte neu oder lege Edukte nach.';
    this.setGuidance(g);
  }

  startBromonium(al, bb) {
    const s = this.sim, A = s.atoms;
    const mid = () => V.lerp(A[al.c1].p, A[al.c2].p, 0.5);
    const nrm = this.planeNormal(al, A[bb.near].p);
    const steps = [
      {
        index: 0,
        title: 'Polarisierung und π-Komplex',
        text: 'Das Brom-Molekül nähert sich der elektronenreichen C=C-Doppelbindung. Die π-Elektronen stoßen die Elektronen der Br–Br-Bindung ab: Das zuvor unpolare Brom-Molekül wird polarisiert (induzierter Dipol Brδ+–Brδ−). Das positivierte Br-Atom lagert sich an die π-Elektronenwolke an – es entsteht ein π-Komplex.',
        pre: () => {
          this.m.partialOverride.set(bb.near, 1);
          this.m.partialOverride.set(bb.far, -1);
          // Br₂ senkrecht über die Mitte der Doppelbindung ausrichten
          const ids = [...s.fragmentOf(bb.near)];
          const rot = Q.fromUnitVectors(V.norm(V.sub(A[bb.far].p, A[bb.near].p)), nrm);
          const target = V.add(mid(), V.mul(nrm, 2.7));
          s.addMove(ids, { pivot: [...A[bb.near].p], rot, trans: V.sub(target, A[bb.near].p) }, 1.0);
          return 1.05;
        },
        arrows: [],
        exec: () => {
          const ids = [...s.fragmentOf(bb.near)];
          s.addMove(ids, { trans: V.mul(nrm, -0.4) }, 0.9);
          return 1.0;
        },
      },
      {
        index: 1,
        title: 'Bromonium-Ion',
        text: 'Die π-Elektronen greifen das δ+-Br-Atom an, gleichzeitig bricht die Br–Br-Bindung heterolytisch: Das Bindungselektronenpaar geht zum δ−-Br, es entsteht ein Bromid-Ion. Das andere Br bildet mit einem freien Elektronenpaar einen Dreiring mit beiden C-Atomen: das cyclische Bromonium-Ion (Br trägt die positive Ladung). Es schirmt eine Seite des Moleküls ab.',
        arrows: [
          { from: { bond: [al.c1, al.c2] }, to: { atom: bb.near } },
          { from: { bond: [bb.near, bb.far] }, to: { atom: bb.far } },
        ],
        exec: () => {
          s.angleOverride.set(al.c1, this.ringAngleC(al.c1, al.c2, bb.near));
          s.angleOverride.set(al.c2, this.ringAngleC(al.c2, al.c1, bb.near));
          s.angleOverride.set(bb.near, () => 43 * DEG);
          s.setBond(al.c1, al.c2, 1, 1.8);
          s.setBond(bb.near, al.c1, 1, 1.8);
          s.setBond(bb.near, al.c2, 1, 1.8);
          s.setBond(bb.near, bb.far, 0, 1.8);
          return 1.9;
        },
        after: () => {
          this.m.partialOverride.clear();
          // Bromid-Ion etwas zur Seite, damit der Anti-Angriff selbst ausgeführt werden kann
          s.ensureTopo();
          s.addMove([bb.far], { trans: V.add(V.mul(nrm, 1.0), [1.6, 0, 0.4]) }, 1.2);
          return 1.3;
        },
      },
    ];
    this._begin({
      kind: 'bromonium',
      reaction: 'Elektrophile Addition',
      steps,
      busy: [...s.fragmentOf(al.c1), ...s.fragmentOf(bb.near)],
      done: () => {
        this.m.partialOverride.clear();
        this.status.title = 'Bromonium-Ion entstanden';
        this.status.text = 'Das Bromonium-Ion ist ein Dreiring aus zwei C-Atomen und einem positiv geladenen Br-Atom. Das große Br versperrt die eine Seite – das Bromid-Ion kann nur von der Gegenseite angreifen.';
        this.status.stepDone = true;
      },
    });
  }

  startOpening(ion, c, b) {
    const s = this.sim, A = s.atoms;
    const other = c === ion.c1 ? ion.c2 : ion.c1;
    const back = V.norm(V.sub(A[c].p, A[ion.br].p));
    const ring = this.ringAngleC(c, other, ion.br);
    const progress = () => {
      const o1 = s.bond(b, c)?.order ?? 0;
      const o2 = s.bond(c, ion.br)?.order ?? 0;
      return Math.max(0, Math.min(1, (o1 + (1 - o2)) / 2));
    };
    // angegriffenes C: wie SN2 – Br⁻ und Br⁺ axial, Übergang zu sp³
    const openAngle = (j, k) => {
      const p = progress();
      const has = (x) => j === x || k === x;
      if (has(b) && has(ion.br)) return Math.PI;
      if (has(b)) {
        const x = j === b ? k : j;
        return lerp(Math.PI - ring(x, ion.br), 109.47 * DEG, p);
      }
      if (has(ion.br)) return ring(j, k);
      return lerp(ring(j, k), 109.47 * DEG, p);
    };
    const steps = [
      {
        index: 2,
        title: 'Anti-Angriff des Bromid-Ions',
        text: 'Das Bromid-Ion greift ein C-Atom des Bromonium-Ions von der Rückseite an – also von der Seite, die dem Br⁺ gegenüberliegt. Dabei öffnet sich der Dreiring (ähnlich wie bei einer SN2-Reaktion). Die beiden Br-Atome landen auf entgegengesetzten Seiten: Anti-Addition.',
        pre: () => {
          s.addMove([b], { trans: V.sub(V.add(A[c].p, V.mul(back, 2.6)), A[b].p) }, 0.9);
          return 0.95;
        },
        arrows: [
          { from: { atom: b }, to: { atom: c } },
          { from: { bond: [c, ion.br] }, to: { atom: ion.br } },
        ],
        exec: () => {
          s.angleOverride.set(c, openAngle);
          s.setBond(b, c, 1, 1.8);
          s.setBond(c, ion.br, 0, 1.8);
          return 1.9;
        },
        after: () => {
          for (const x of [c, other, ion.br]) s.angleOverride.delete(x);
          return 0.8;
        },
      },
    ];
    this._begin({
      kind: 'addition-opening',
      reaction: 'Elektrophile Addition',
      steps,
      busy: [...s.fragmentOf(c), b],
      done: () => {
        for (const x of [c, other, ion.br]) s.angleOverride.delete(x);
        this.counts.addition++;
        this.status.title = 'Addition abgeschlossen: 1,2-Dibromethan';
        this.status.text = 'CH₂=CH₂ + Br₂ → CH₂Br–CH₂Br. Aus der Doppelbindung ist eine Einfachbindung geworden, beide C-Atome sind jetzt sp³-hybridisiert. Die zwei Br-Atome sind von entgegengesetzten Seiten angetreten (anti-Addition). Nachweis im Labor: Bromwasser wird entfärbt.';
        this.status.stepDone = true;
      },
    });
  }

  *demo(d) {
    const { sim } = d;
    const A = sim.atoms;
    let { alkenes, br2 } = this.scan();
    if (alkenes.length && br2.length) {
      const al = alkenes[0], b2 = br2[0];
      const mid = V.lerp(A[al.c1].p, A[al.c2].p, 0.5);
      const nrm = this.planeNormal(al, V.add(mid, [0, 0.6, 1]));
      yield* d.bringOriented(b2.a, V.add(mid, V.mul(nrm, 2.7)), V.sub(A[b2.b].p, A[b2.a].p), nrm, 2.0);
      yield* d.untilIdle();
    }
    const { ions, bromides } = this.scan();
    if (!ions.length || !bromides.length) return;
    const ion = ions[0];
    // C wählen, dessen Rückseite eher zur Kamera zeigt
    const backOf = (c) => V.norm(V.sub(A[c].p, A[ion.br].p));
    const c = [ion.c1, ion.c2].sort((p, q) => backOf(q)[2] - backOf(p)[2])[0];
    const b = bromides[0];
    yield* d.bring(b, V.add(A[c].p, V.mul(backOf(c), 5)), 1.4);
    yield* d.bring(b, V.add(A[c].p, V.mul(backOf(c), 2.6)), 1.0);
    yield* d.untilIdle();
  }
}
