// Eliminierung erster Ordnung (E1): säurekatalysierte Dehydratisierung
//   (CH₃)₃C–OH + H₃O⁺  →  (CH₃)₃C–OH₂⁺ + H₂O     (Protonierung)
//   (CH₃)₃C–OH₂⁺        →  (CH₃)₃C⁺ + H₂O        (langsam)
//   (CH₃)₃C⁺ + H₂O      →  (CH₃)₂C=CH₂ + H₃O⁺    (Deprotonierung am β-C)

import { V } from '../vec.js';
import { COLORS } from '../mechanism.js';
import { near } from './base.js';
import { CarbeniumBase, T } from './carbenium.js';

export class E1 extends CarbeniumBase {
  static id = 'e1';
  static title = 'Eliminierung (E1)';
  static example = '2-Methylpropan-2-ol → 2-Methylpropen + Wasser (H⁺-Katalyse)';
  static lk = true;
  static steps = ['Protonierung', 'Abspaltung von Wasser', 'Deprotonierung am β-C'];
  static scenarios = {
    e1: {
      label: 'E1',
      items: [
        ['tBuOH', [-2.8, -0.3, 0], [0, 0.4, -0.9]],
        ['hydronium', [1.3, 2.1, 1.4]],
        ['water', [3.0, 0.2, 0.6]],
        ['water', [2.4, -1.6, -1.2]],
      ],
    },
  };
  static extra = ['tBuOH'];

  get allowAttack() { return false; }

  /** Protonenquellen: freies H⁺ oder ein H von H₃O⁺ */
  donors() {
    const out = [];
    for (let i = 0; i < this.sim.atoms.length; i++) {
      if (this.freeProton(i)) out.push({ h: i, from: null });
      const hy = this.hydronium(i);
      if (hy) for (const h of hy.H) out.push({ h, from: i });
    }
    return out;
  }

  check() {
    const s = this.sim, A = s.atoms;
    const started = this.checkCarbenium('e1');
    if (started === true) return;

    const alcs = [];
    for (let i = 0; i < A.length; i++) { const a = this.tertAlcohol(i); if (a && !a.protonated) alcs.push(a); }
    const dons = this.donors();
    for (const a of alcs) {
      this.hl(a.o, COLORS.carbonylO, 0.5);
      for (const d of dons) {
        const dist = V.dist(A[d.h].p, A[a.o].p);
        this.hl(d.h, COLORS.proton, 0.5 + 0.5 * near(dist, T.protonation));
        this.hl(a.o, COLORS.carbonylO, 0.5 + 0.5 * near(dist, T.protonation));
        if (dist < T.protonation) return this.startProtonation(a, d);
      }
      for (const w of this.waters()) {
        if (V.dist(A[w.o].p, A[a.c].p) < 2.6 || V.dist(A[w.o].p, A[a.H[0]].p) < 1.9) {
          this._hint('Ohne Säure keine Reaktion: Die OH-Gruppe ist eine schlechte Abgangsgruppe (OH⁻). Bringe zuerst das H₃O⁺ (blau markiertes H) an den Sauerstoff des Alkohols.');
        }
      }
    }

    let g;
    if (started === 'idle') g = 'Carbenium-Ion (orange): Bringe ein Wassermolekül (grün) mit seinem Sauerstoff an ein H-Atom einer Methylgruppe (β-H, gelb). Wasser wirkt hier als Base.';
    else if (alcs.length && dons.length) g = 'Bringe das H⁺ des Oxonium-Ions H₃O⁺ (blau) an den Sauerstoff (gelb) des 2-Methylpropan-2-ols.';
    else if (alcs.length) g = 'Kein H⁺ (H₃O⁺) vorhanden – starte neu.';
    else g = 'Kein Alkohol mehr vorhanden – starte neu oder lege Edukte nach.';
    this.setGuidance(g);
  }

  startProtonation(a, d) {
    const s = this.sim, A = s.atoms;
    const steps = [
      {
        index: 0,
        title: 'Protonierung der OH-Gruppe',
        text: 'Ein freies Elektronenpaar des Hydroxy-Sauerstoffs (δ−) bindet ein Proton des Oxonium-Ions. Es entsteht ein Alkyloxonium-Ion. Aus der schlechten Abgangsgruppe OH⁻ wird so die gute Abgangsgruppe H₂O.',
        arrows: d.from != null
          ? [{ from: { atom: a.o }, to: { atom: d.h } }, { from: { bond: [d.from, d.h] }, to: { atom: d.from } }]
          : [{ from: { atom: a.o }, to: { atom: d.h } }],
        exec: () => {
          s.setBond(a.o, d.h, 1, 1.3);
          if (d.from != null) s.setBond(d.from, d.h, 0, 1.3);
          return 1.4;
        },
        after: () => (d.from != null ? this.driftAway(d.from, A[a.o].p, 2.0, 1.1) : 0.5),
      },
      {
        index: 1,
        title: 'Abspaltung von Wasser (langsam)',
        text: 'Die C–O-Bindung bricht heterolytisch, das Elektronenpaar bleibt am Sauerstoff: Ein Wassermolekül wird abgespalten, zurück bleibt das planare tert-Butyl-Kation (Carbenium-Ion). Dieser Schritt ist geschwindigkeitsbestimmend – genau wie die Heterolyse bei der SN1.',
        arrows: [{ from: { bond: [a.c, a.o] }, to: { atom: a.o } }],
        exec: () => { s.setBond(a.c, a.o, 0, 2.2); return 2.3; },
        after: () => this.driftAway(a.o, A[a.c].p, 2.2, 1.2),
      },
    ];
    this._begin({
      kind: 'e1-protonation',
      reaction: 'Eliminierung (E1)',
      steps,
      busy: [...s.fragmentOf(a.c), ...s.fragmentOf(d.h)],
      done: () => {
        this.status.title = 'Carbenium-Ion entstanden';
        this.status.text = 'Das tert-Butyl-Kation ist planar und positiv geladen. Jetzt kann ein Wassermolekül als Base ein Proton vom benachbarten C-Atom (β-H) abziehen.';
        this.status.stepDone = true;
      },
    });
  }

  *demo(d) {
    const { sim } = d;
    const A = sim.atoms;
    let a = null;
    for (let i = 0; i < A.length && !a; i++) { const x = this.tertAlcohol(i); if (x && !x.protonated) a = x; }
    if (a) {
      const don = this.donors()[0];
      if (!don) return;
      // freies Elektronenpaar des Alkohol-O zeigt weg von C und H
      const lp = V.norm(V.sub(A[a.o].p, V.centroid(sim.nbrs(a.o).map((x) => A[x.j].p))));
      const target = V.add(A[a.o].p, V.mul(V.norm(V.add(lp, [0, 0, 0.4])), 1.8));
      if (don.from != null) yield* d.bringOriented(don.h, target, V.norm(V.sub(A[don.h].p, A[don.from].p)), V.mul(lp, -1), 2.0);
      else yield* d.bring(don.h, target, 1.8);
      yield* d.untilIdle();
    }
    const k = this.carbenia()[0];
    if (!k || !k.beta.length) return;
    // β-H, das am besten zur Kamera zeigt
    const b = k.beta.slice().sort((p, q) => A[q.h].p[2] - A[p.h].p[2])[0];
    const w = this.waters().sort((p, q) => V.dist(A[p.o].p, A[b.h].p) - V.dist(A[q.o].p, A[b.h].p))[0];
    if (!w) return;
    const dir = V.norm(V.sub(A[b.h].p, A[b.cb].p));
    yield* d.bringLonePair(w.o, V.add(A[b.h].p, V.mul(dir, 1.6)), V.mul(dir, -1), 2.0);
    yield* d.untilIdle();
  }
}
