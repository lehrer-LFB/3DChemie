// Nukleophile Substitution erster Ordnung (SN1):
//   (CH₃)₃C–Br  →  (CH₃)₃C⁺ + Br⁻            (langsam, Heterolyse)
//   (CH₃)₃C⁺ + H₂O  →  (CH₃)₃C–OH₂⁺          (schnell)
//   (CH₃)₃C–OH₂⁺ + H₂O  →  (CH₃)₃C–OH + H₃O⁺
// Konkurrenz: Gibt das Carbenium-Ion ein β-H an Wasser ab → E1 (2-Methylpropen).

import { V } from '../vec.js';
import { COLORS } from '../mechanism.js';
import { near } from './base.js';
import { CarbeniumBase, T } from './carbenium.js';

export class SN1 extends CarbeniumBase {
  static id = 'sn1';
  static title = 'Nukleophile Substitution (SN1)';
  static example = '2-Brom-2-methylpropan + Wasser → 2-Methylpropan-2-ol + HBr';
  static steps = ['Heterolyse', 'Nukleophiler Angriff', 'Deprotonierung'];
  static scenarios = {
    sn1: {
      label: 'SN1',
      items: [
        ['tBuBr', [-2.8, -0.3, 0], [0, 0.4, -1.0]],
        ['water', [3.0, 0.6, 0.6]],
        ['water', [2.6, -1.6, -1.4]],
        ['water', [1.8, -2.0, 1.8]],
      ],
    },
  };
  static extra = ['tBuBr', 'water', 'water'];

  check() {
    const s = this.sim, A = s.atoms;
    const started = this.checkCarbenium('sn1');
    if (started === true) return;
    const ws = this.waters();

    // 1) Heterolyse: Wasser an das Brom-Atom (Solvatation des austretenden Bromid-Ions)
    const halides = [];
    for (let i = 0; i < A.length; i++) { const h = this.tertHalide(i); if (h) halides.push(h); }
    for (const x of halides) {
      this.hl(x.br, COLORS.carbonylO, 0.5);
      for (const w of ws) {
        const d = V.dist(A[w.o].p, A[x.br].p);
        this.hl(w.o, COLORS.nucleophile, 0.4 + 0.6 * near(d, T.heterolysis));
        this.hl(x.br, COLORS.carbonylO, 0.5 + 0.5 * near(d, T.heterolysis));
        if (d < T.heterolysis) return this.startHeterolysis(x, w);
        if (V.dist(A[w.o].p, A[x.c].p) < 2.6) {
          this._hint('Bei der SN1 greift das Nukleophil nicht direkt an: Zuerst muss sich das Bromid-Ion ablösen (Heterolyse). Bringe ein Wassermolekül an das Brom-Atom (gelb) – die polaren Wassermoleküle stabilisieren das austretende Br⁻.');
        }
      }
    }

    let g;
    if (started === 'idle') g = 'Carbenium-Ion (orange): Bringe den Sauerstoff eines Wassermoleküls (grün) an das C⁺ – von oberhalb oder unterhalb der Ebene. Alternativ: Wasser an ein H der Methylgruppen (gelb) → Eliminierung.';
    else if (halides.length) g = 'Bringe ein Wassermolekül (grün) an das Brom-Atom (gelb) des 2-Brom-2-methylpropans. Das polare Lösungsmittel hilft dem Bromid-Ion beim Ablösen.';
    else g = 'Kein Halogenalkan mehr vorhanden – starte neu oder lege Edukte nach.';
    this.setGuidance(g);
  }

  startHeterolysis(x, w) {
    const s = this.sim, A = s.atoms;
    const steps = [
      {
        index: 0,
        title: 'Heterolyse (langsam)',
        text: 'Die polare C–Br-Bindung (Cδ+, Brδ−) bricht heterolytisch: Das bindende Elektronenpaar geht vollständig zum elektronegativeren Brom. Es entstehen ein Bromid-Ion und ein Carbenium-Ion. Die Wassermoleküle stabilisieren beide Ionen (Hydratation). Dieser Schritt ist langsam und bestimmt die Geschwindigkeit der gesamten Reaktion.',
        arrows: [{ from: { bond: [x.c, x.br] }, to: { atom: x.br } }],
        exec: () => { s.setBond(x.c, x.br, 0, 2.6); return 2.7; },
        after: () => this.driftAway(x.br, A[x.c].p, 2.0, 1.2),
      },
    ];
    this._begin({
      kind: 'sn1-heterolysis',
      reaction: 'Nukleophile Substitution (SN1)',
      steps,
      busy: [...s.fragmentOf(x.c)],
      done: () => {
        this.status.title = 'Carbenium-Ion entstanden';
        this.status.text = 'Das tert-Butyl-Kation ist planar (sp², 120°) und trägt die positive Ladung am C-Atom. Die drei Methylgruppen stabilisieren es durch ihren +I-Effekt. Ein Nukleophil kann es jetzt von beiden Seiten der Ebene angreifen.';
        this.status.stepDone = true;
      },
    });
  }

  *demo(d) {
    const { sim } = d;
    const A = sim.atoms;
    let x = null;
    for (let i = 0; i < A.length && !x; i++) x = this.tertHalide(i);
    if (x) {
      const w = this.waters()[0];
      if (!w) return;
      const dir = V.norm(V.sub(A[x.br].p, A[x.c].p));
      yield* d.bringLonePair(w.o, V.add(A[x.br].p, V.mul(V.norm(V.add(dir, [0, 0, 0.5])), 2.3)), V.mul(dir, -1), 2.0);
      yield* d.untilIdle();
    }
    const k = this.carbenia()[0];
    if (!k) return;
    const ws = this.waters().sort((p, q) => V.dist(A[p.o].p, A[k.c].p) - V.dist(A[q.o].p, A[k.c].p));
    const w = ws[0];
    if (!w) return;
    const n = this.planeNormal(k, V.add(A[k.c].p, [0, 0, 1]));
    yield* d.bringLonePair(w.o, V.add(A[k.c].p, V.mul(n, 2.6)), V.mul(n, -1), 2.0);
    yield* d.untilIdle();
  }
}
