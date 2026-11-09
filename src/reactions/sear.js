// Elektrophile aromatische Substitution: Bromierung von Benzol.
//   Br₂ + FeBr₃        →  Brδ+–Br⁺–FeBr₃⁻               (Erzeugung des Elektrophils)
//   + C₆H₆             →  π-Komplex  →  σ-Komplex + FeBr₄⁻ (Arenium-Ion, Ladung mesomer
//                                                         auf ortho/para verteilt)
//   σ-Komplex + FeBr₄⁻ →  C₆H₅Br + HBr + FeBr₃           (Rearomatisierung)
// Aromatische Bindungen haben die Ordnung 1,5.

import { V, Q } from '../vec.js';
import { COLORS } from '../mechanism.js';
import { ReactionBase, near } from './base.js';

const DEG = Math.PI / 180;
const T = { activation: 2.9, ring: 2.9, rearom: 2.2 };

export class SEAr extends ReactionBase {
  static id = 'sear';
  static title = 'Elektrophile aromatische Substitution';
  static example = 'Benzol + Brom (FeBr₃) → Brombenzol + HBr';
  static lk = true;
  static pi = true; // Schalter „π-Elektronenwolke“
  static steps = ['Bildung des Elektrophils', 'π-Komplex', 'σ-Komplex', 'Rearomatisierung'];
  static scenarios = {
    benzene: {
      label: 'Benzol + Brom',
      items: [
        ['benzene', [-2.2, 0.6, -1.8], [-1.0, 0.2, 0]],
        ['ironBromide', [3.2, -2.0, 1.6], [-0.6, 0.4, 0]],
        ['bromine', [3.6, 2.0, -1.4], [0, 0.6, 0.4]],
      ],
    },
  };
  static extra = ['benzene', 'bromine'];
  static counters = [{ key: 'sear', label: 'Brombenzol' }];

  // ---------- Erkennung ----------

  /** freies Br₂ (beide Br nur aneinander gebunden) */
  bromine(b) {
    const s = this.sim, A = s.atoms;
    if (A[b].el !== 'Br') return null;
    const nb = s.nbrs(b);
    if (nb.length !== 1 || A[nb[0].j].el !== 'Br' || nb[0].j < b || s.nbrs(nb[0].j).length !== 1) return null;
    return { a: b, b: nb[0].j };
  }

  /** FeBr₃ (Fe mit drei Br) oder FeBr₄⁻ (vier Br) */
  iron(f) {
    const s = this.sim, A = s.atoms;
    if (A[f].el !== 'Fe') return null;
    const brs = s.nbrs(f).map((x) => x.j);
    return { fe: f, brs, n: brs.length };
  }

  /** aktivierter Komplex Br_t–Br_b–FeBr₃ */
  complex(f) {
    const s = this.sim, A = s.atoms;
    const fe = this.iron(f);
    if (!fe || fe.n !== 4) return null;
    for (const b of fe.brs) {
      const t = s.nbrs(b).find((x) => x.j !== f && A[x.j].el === 'Br');
      if (t) return { fe: f, brb: b, brt: t.j };
    }
    return null;
  }

  /** FeBr₄⁻ ohne Br–Br */
  ferrate(f) {
    const fe = this.iron(f);
    if (!fe || fe.n !== 4 || this.complex(f)) return null;
    return fe;
  }

  /** Ringatome eines Benzolrings (C mit zwei aromatischen C–C-Bindungen) */
  benzenes() {
    const s = this.sim, A = s.atoms;
    const seen = new Set(), out = [];
    for (let c = 0; c < A.length; c++) {
      if (A[c].el !== 'C' || seen.has(c)) continue;
      const ar = s.nbrs(c).filter((x) => A[x.j].el === 'C' && x.o === 1.5);
      if (ar.length !== 2) continue;
      const ring = this.ringFrom(c);
      if (!ring || ring.some((x) => s.nbrs(x).filter((y) => A[y.j].el === 'C' && y.o === 1.5).length !== 2)) continue;
      ring.forEach((x) => seen.add(x));
      out.push(ring);
    }
    return out;
  }

  /** Sechsring ab c in Reihenfolge (über C–C-Bindungen) */
  ringFrom(c) {
    const s = this.sim, A = s.atoms;
    const ring = [c];
    let prev = -1, cur = c;
    for (let k = 0; k < 6; k++) {
      const nx = s.nbrs(cur).map((x) => x.j).filter((j) => A[j].el === 'C' && j !== prev && (j === c ? k === 5 : !ring.includes(j)));
      if (!nx.length) return null;
      if (nx[0] === c) return ring.length === 6 ? ring : null;
      prev = cur;
      cur = nx[0];
      ring.push(cur);
    }
    return null;
  }

  /** σ-Komplex: sp³-C im Ring mit H und Br */
  sigma(c) {
    const s = this.sim, A = s.atoms;
    if (A[c].el !== 'C') return null;
    const nb = s.nbrs(c);
    if (nb.length !== 4) return null;
    const h = nb.find((x) => A[x.j].el === 'H');
    const br = nb.find((x) => A[x.j].el === 'Br');
    if (!h || !br || nb.filter((x) => A[x.j].el === 'C').length !== 2) return null;
    const ring = this.ringFrom(c);
    if (!ring) return null;
    return { c, h: h.j, br: br.j, ring };
  }

  ringNormal(ring, toward) {
    const A = this.sim.atoms;
    const cen = V.centroid(ring.map((i) => A[i].p));
    let n = V.norm(V.cross(V.sub(A[ring[1]].p, A[ring[0]].p), V.sub(A[ring[2]].p, A[ring[0]].p)));
    if (toward && V.dot(V.sub(toward, cen), n) < 0) n = V.mul(n, -1);
    return { cen, n };
  }

  scan() {
    const A = this.sim.atoms;
    const out = { br2: [], fe3: [], cx: [], ferr: [], sig: [] };
    for (let i = 0; i < A.length; i++) {
      const b = this.bromine(i); if (b) out.br2.push(b);
      const f = this.iron(i); if (f && f.n === 3) out.fe3.push(f);
      const c = this.complex(i); if (c) out.cx.push(c);
      const r = this.ferrate(i); if (r) out.ferr.push(r);
      const g = this.sigma(i); if (g) out.sig.push(g);
    }
    out.rings = this.benzenes();
    return out;
  }

  // ---------- Regeln ----------

  check() {
    const s = this.sim, A = s.atoms;
    const P = (i) => A[i].p;
    const { br2, fe3, cx, ferr, sig, rings } = this.scan();

    // 3) σ-Komplex: FeBr₄⁻ holt das H⁺ → Rearomatisierung
    for (const g of sig) {
      this._sigmaDisplay(g);
      this.hl(g.h, COLORS.carbonylO, 0.6);
      for (const f of ferr) {
        for (const b of f.brs) {
          const d = V.dist(P(b), P(g.h));
          this.hl(b, COLORS.nucleophile, 0.3 + 0.6 * near(d, T.rearom));
          if (d < T.rearom) return this.startRearom(g, f, b);
        }
      }
    }

    // 2) aktivierter Komplex an den Ring
    for (const c of cx) {
      this.m.partialOverride.set(c.brt, 1);
      this.hl(c.brt, COLORS.activatedC, 0.6);
      for (const ring of rings) {
        const { cen } = this.ringNormal(ring);
        let best = null, dmin = Infinity;
        for (const x of ring) { const d = V.dist(P(c.brt), P(x)); if (d < dmin) { dmin = d; best = x; } }
        for (const x of ring) this.hl(x, COLORS.carbonylO, 0.3 + 0.4 * near(dmin, T.ring));
        if (dmin < T.ring || V.dist(P(c.brt), cen) < T.ring) return this.startSigma(c, ring, best);
      }
    }

    // 1) Br₂ an das FeBr₃
    for (const b of br2) {
      for (const f of fe3) {
        this.hl(f.fe, COLORS.activatedC, 0.5);
        for (const [bb, bt] of [[b.a, b.b], [b.b, b.a]]) {
          const d = V.dist(P(bb), P(f.fe));
          this.hl(bb, COLORS.nucleophile, 0.3 + 0.6 * near(d, T.activation));
          if (d < T.activation) return this.startActivation(f, bb, bt);
        }
      }
      // Br₂ ohne Katalysator an den Ring → Hinweis
      for (const ring of rings) {
        if (ring.some((x) => Math.min(V.dist(P(b.a), P(x)), V.dist(P(b.b), P(x))) < 2.8)) {
          this._hint('Ohne Katalysator reagiert Brom (fast) nicht mit Benzol: Das aromatische π-System ist besonders stabil, Br₂ ist nicht elektrophil genug. Bringe das Br₂ zuerst an das FeBr₃ (Lewis-Säure, orange).');
        }
      }
    }

    let g;
    if (sig.length && ferr.length) g = 'σ-Komplex: Die positive Ladung ist über den Ring verteilt. Bringe ein Br-Atom des FeBr₄⁻ (grün) an das H-Atom (gelb) am sp³-C – das H⁺ wird abgespalten.';
    else if (cx.length && rings.length) g = 'Das Elektrophil ist aktiviert (Brδ+, orange). Bringe dieses Br-Atom an den Benzolring (gelb) – am besten senkrecht auf die Ringebene.';
    else if (br2.length && fe3.length) g = 'Bringe ein Brom-Molekül (grün) an das Eisen-Atom des FeBr₃ (orange). Die Lewis-Säure polarisiert das Br₂ und macht es zum starken Elektrophil.';
    else if (!rings.length) g = 'Kein Benzol mehr vorhanden – lege Edukte nach.';
    else g = 'Kein Brom mehr vorhanden – lege Edukte nach.';
    this.setGuidance(g);
  }

  /** Mesomere Verteilung der Ladung im σ-Komplex: ortho/para hervorheben, „+“ in der Ringmitte */
  _sigmaDisplay(g) {
    const A = this.sim.atoms;
    const r = g.ring; // r[0] = sp³-C
    for (const i of [r[1], r[3], r[5]]) this.hl(i, COLORS.activatedC, 0.55);
    const cen = V.centroid(r.slice(1).map((i) => A[i].p));
    this.m.tags = [{ p: V.add(cen, [0, 0, 0.3]), text: '+', color: '#1565c0' }];
  }

  // ---------- Sequenzen ----------

  startActivation(f, bb, bt) {
    const s = this.sim, A = s.atoms;
    // Normale der FeBr₃-Ebene, zur Seite des Br₂
    const [p1, p2, p3] = f.brs.map((i) => A[i].p);
    let n = V.norm(V.cross(V.sub(p2, p1), V.sub(p3, p1)));
    if (V.dot(V.sub(A[bb].p, A[f.fe].p), n) < 0) n = V.mul(n, -1);
    const steps = [
      {
        index: 0,
        title: 'Bildung des Elektrophils',
        text: 'Eisen(III)-bromid ist eine Lewis-Säure: Am Fe-Atom fehlt ein Elektronenpaar zum Oktett. Ein freies Elektronenpaar des Brom-Moleküls bindet an das Fe-Atom. Dadurch wird die Br–Br-Bindung stark polarisiert: Das äußere Br-Atom wird positiviert (Brδ+) – ein starkes Elektrophil, das auch das stabile aromatische System angreifen kann.',
        pre: () => {
          const ids = [...s.fragmentOf(bb)];
          const rot = Q.fromUnitVectors(V.norm(V.sub(A[bt].p, A[bb].p)), n);
          s.addMove(ids, { pivot: [...A[bb].p], rot, trans: V.sub(V.add(A[f.fe].p, V.mul(n, 2.6)), A[bb].p) }, 1.0);
          return 1.05;
        },
        arrows: [{ from: { atom: bb }, to: { atom: f.fe } }],
        exec: () => {
          s.setBond(bb, f.fe, 1, 1.5);
          this.m.partialOverride.set(bt, 1);
          return 1.6;
        },
      },
    ];
    this._begin({
      kind: 'sear-activation', reaction: 'Elektrophile aromatische Substitution', steps, busy: [...s.fragmentOf(bb), ...s.fragmentOf(f.fe)],
      done: () => {
        this.status.title = 'Elektrophil aktiviert';
        this.status.text = 'Der Komplex Brδ+–Br–FeBr₃ trägt am äußeren Br-Atom eine positive Teilladung. Das Fe-Atom ist jetzt tetraedrisch von vier Br umgeben.';
        this.status.stepDone = true;
      },
    });
  }

  startSigma(c, ring, c1) {
    const s = this.sim, A = s.atoms;
    const k = ring.indexOf(c1);
    const r = [...ring.slice(k), ...ring.slice(0, k)]; // r[0] = angegriffenes C
    const { n } = this.ringNormal(ring, A[c.brt].p);
    const cxIds = () => [...s.fragmentOf(c.brt)];
    const hOf = (x) => s.nbrs(x).find((y) => A[y.j].el === 'H').j;
    const h1 = hOf(r[0]);
    const sp3Angles = (j, k2) => {
      const has = (x) => j === x || k2 === x;
      if (has(r[1]) && has(r[5])) return 116 * DEG;
      if (has(h1) && has(c.brt)) return 104 * DEG;
      return 109 * DEG;
    };
    const steps = [
      {
        index: 1,
        title: 'π-Komplex',
        text: 'Das positivierte Br-Atom nähert sich der Elektronenwolke des aromatischen Rings. Es lagert sich locker an die π-Elektronen an (π-Komplex) – das aromatische System ist dabei noch erhalten.',
        pre: () => {
          const { cen } = this.ringNormal(ring);
          const rot = Q.fromUnitVectors(V.norm(V.sub(A[c.brb].p, A[c.brt].p)), n);
          s.addMove(cxIds(), { pivot: [...A[c.brt].p], rot, trans: V.sub(V.add(cen, V.mul(n, 2.9)), A[c.brt].p) }, 1.0);
          return 1.05;
        },
        arrows: [],
        exec: () => { s.addMove(cxIds(), { trans: V.mul(n, -0.3) }, 0.8); return 0.9; },
      },
      {
        index: 2,
        title: 'σ-Komplex (Arenium-Ion)',
        text: 'Zwei π-Elektronen des Rings bilden eine σ-Bindung zum Br-Atom, gleichzeitig bricht die Br–Br-Bindung heterolytisch (FeBr₄⁻ entsteht). Das angegriffene C-Atom wird sp³-hybridisiert, das aromatische System ist unterbrochen. Die positive Ladung ist mesomeriestabilisiert über die übrigen fünf C-Atome verteilt – vor allem auf die ortho- und para-Positionen (orange).',
        pre: () => {
          s.addMove(cxIds(), { trans: V.sub(V.add(A[r[0]].p, V.mul(n, 2.3)), A[c.brt].p) }, 0.8);
          return 0.85;
        },
        arrows: [
          { from: { bond: [r[0], r[1]] }, to: { atom: c.brt } },
          { from: { bond: [c.brt, c.brb] }, to: { atom: c.brb } },
        ],
        exec: () => {
          s.angleOverride.set(r[0], sp3Angles);
          s.setBond(r[0], c.brt, 1, 1.8);
          s.setBond(c.brt, c.brb, 0, 1.8);
          s.setBond(r[0], r[1], 1, 1.8);
          s.setBond(r[0], r[5], 1, 1.8);
          this.m.partialOverride.delete(c.brt);
          return 1.9;
        },
        after: () => { s.ensureTopo(); s.addMove([...s.fragmentOf(c.fe)], { trans: [2.0, -1.4, 1.0] }, 1.1); return 1.2; },
      },
    ];
    this._begin({
      kind: 'sear-sigma', reaction: 'Elektrophile aromatische Substitution', steps, busy: [...s.fragmentOf(c1), ...cxIds()],
      done: () => {
        this.status.title = 'σ-Komplex entstanden';
        this.status.text = 'Im σ-Komplex ist die Aromatizität aufgehoben – er ist energiereich. Statt ein Br⁻ zu addieren (wie bei Alkenen), gibt er ein Proton ab: So wird das stabile aromatische System zurückgewonnen.';
        this.status.stepDone = true;
      },
    });
  }

  startRearom(g, f, bx) {
    const s = this.sim, A = s.atoms;
    const r = g.ring;
    const dir = V.norm(V.sub(A[g.h].p, A[g.c].p));
    const steps = [
      {
        index: 3,
        title: 'Rearomatisierung',
        text: 'Ein Br-Atom des FeBr₄⁻ nimmt das Proton am sp³-C auf, es entsteht HBr. Das Elektronenpaar der C–H-Bindung kehrt in den Ring zurück: Das aromatische π-System ist wiederhergestellt. FeBr₃ wird zurückgebildet – es ist ein Katalysator.',
        pre: () => {
          const ids = [...s.fragmentOf(bx)];
          s.addMove(ids, { trans: V.sub(V.add(A[g.h].p, V.mul(dir, 1.6)), A[bx].p) }, 0.7);
          return 0.75;
        },
        arrows: [
          { from: { atom: bx }, to: { atom: g.h } },
          { from: { bond: [g.c, g.h] }, to: { bond: [g.c, r[1]] } },
        ],
        exec: () => {
          this.m.tags = [];
          s.setBond(g.c, g.h, 0, 1.6);
          s.setBond(bx, g.h, 1, 1.6);
          s.setBond(f.fe, bx, 0, 1.6);
          s.setBond(g.c, r[1], 1.5, 1.6);
          s.setBond(g.c, r[5], 1.5, 1.6);
          return 1.7;
        },
        after: () => {
          s.angleOverride.delete(g.c);
          this.driftAway(bx, A[g.c].p, 2.0, 1.1);
          return 1.2;
        },
      },
    ];
    this._begin({
      kind: 'sear-rearom', reaction: 'Elektrophile aromatische Substitution', steps, busy: [...s.fragmentOf(g.c), ...s.fragmentOf(bx)],
      done: () => {
        s.angleOverride.delete(g.c);
        this.m.tags = [];
        this.counts.sear++;
        this.status.title = 'Substitution abgeschlossen: Brombenzol';
        this.status.text = 'C₆H₆ + Br₂ → C₆H₅Br + HBr (Katalysator FeBr₃). Ein H-Atom wurde durch ein Br-Atom ersetzt – Substitution statt Addition, denn so bleibt das energiearme aromatische System erhalten. Eine Addition würde die Aromatizität dauerhaft aufheben.';
        this.status.stepDone = true;
      },
    });
  }

  *demo(d) {
    const { sim } = d;
    const A = sim.atoms;
    let sc = this.scan();
    if (!sc.cx.length && !sc.sig.length && sc.br2.length && sc.fe3.length) {
      const b = sc.br2[0], f = sc.fe3[0];
      const [p1, p2, p3] = f.brs.map((i) => A[i].p);
      let n = V.norm(V.cross(V.sub(p2, p1), V.sub(p3, p1)));
      if (n[2] < 0) n = V.mul(n, -1);
      yield* d.bringOriented(b.a, V.add(A[f.fe].p, V.mul(n, 2.7)), V.sub(A[b.b].p, A[b.a].p), n, 2.0);
      yield* d.untilIdle();
      sc = this.scan();
    }
    if (sc.cx.length && sc.rings.length) {
      const c = sc.cx[0];
      const { cen, n } = this.ringNormal(sc.rings[0], V.add(V.centroid(sc.rings[0].map((i) => A[i].p)), [0, 1, 1]));
      yield* d.bringOriented(c.brt, V.add(cen, V.mul(n, 2.8)), V.sub(A[c.brb].p, A[c.brt].p), n, 2.0);
      yield* d.untilIdle();
      sc = this.scan();
    }
    if (sc.sig.length && sc.ferr.length) {
      const g = sc.sig[0], f = sc.ferr[0];
      const bx = f.brs.sort((p, q) => V.dist(A[p].p, A[g.h].p) - V.dist(A[q].p, A[g.h].p))[0];
      const dir = V.norm(V.sub(A[g.h].p, A[g.c].p));
      yield* d.bring(bx, V.add(A[g.h].p, V.mul(dir, 2.0)), 1.6);
      yield* d.untilIdle();
    }
  }
}
