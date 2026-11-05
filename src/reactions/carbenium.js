// Gemeinsame Bausteine für SN1 und E1: Beide laufen über dasselbe planare
// Carbenium-Ion. Greift Wasser am C⁺ an → Substitution; gibt das Kation ein
// β-H an Wasser ab → Eliminierung (Alken).

import { V } from '../vec.js';
import { COLORS } from '../mechanism.js';
import { ReactionBase, near } from './base.js';

export const T = { heterolysis: 2.6, attack: 2.7, betaH: 1.75, protonation: 2.0 };

export class CarbeniumBase extends ReactionBase {
  static counters = [{ key: 'sn1', label: 'SN1-Produkte' }, { key: 'e1', label: 'E1-Produkte' }];

  // ---------- Erkennung ----------

  /** sp³-C mit vier Einfachbindungen? */
  sp3(c) {
    const nb = this.sim.nbrs(c);
    return this.sim.atoms[c].el === 'C' && nb.length === 4 && nb.every((x) => x.o === 1);
  }

  /** Carbenium-Ion: C mit drei Einfachbindungen zu C/H (keine Heteroatome) */
  carbenium(c) {
    const s = this.sim, A = s.atoms;
    if (A[c].el !== 'C') return null;
    const nb = s.nbrs(c);
    if (nb.length !== 3 || nb.some((x) => x.o !== 1 || (A[x.j].el !== 'C' && A[x.j].el !== 'H'))) return null;
    const beta = [];
    for (const { j } of nb) {
      if (A[j].el !== 'C' || !this.sp3(j)) continue;
      for (const x of s.nbrs(j)) if (A[x.j].el === 'H') beta.push({ h: x.j, cb: j });
    }
    return { c, subs: nb.map((x) => x.j), beta };
  }

  /** Tertiäres C mit Halogen: (R)₃C–Br */
  tertHalide(c) {
    const s = this.sim, A = s.atoms;
    if (!this.sp3(c)) return null;
    const nb = s.nbrs(c);
    const br = nb.find((x) => A[x.j].el === 'Br');
    if (!br || nb.filter((x) => A[x.j].el === 'C').length !== 3) return null;
    return { c, br: br.j };
  }

  /** Tertiärer Alkohol (R)₃C–OH, auch protoniert (R)₃C–OH₂⁺ */
  tertAlcohol(o) {
    const s = this.sim, A = s.atoms;
    if (A[o].el !== 'O') return null;
    const nb = s.nbrs(o);
    const cs = nb.filter((x) => A[x.j].el === 'C');
    const hs = nb.filter((x) => A[x.j].el === 'H').map((x) => x.j);
    if (cs.length !== 1 || hs.length < 1 || hs.length > 2 || nb.length !== 1 + hs.length) return null;
    const c = cs[0].j;
    if (!this.sp3(c) || s.nbrs(c).filter((x) => A[x.j].el === 'C').length !== 3) return null;
    return { o, c, H: hs, protonated: hs.length === 2 };
  }

  /** Alle Wassermoleküle */
  waters() {
    const out = [];
    for (let i = 0; i < this.sim.atoms.length; i++) { const w = this.water(i); if (w) out.push(w); }
    return out;
  }

  carbenia() {
    const out = [];
    for (let i = 0; i < this.sim.atoms.length; i++) { const k = this.carbenium(i); if (k) out.push(k); }
    return out;
  }

  /** Normale der Kationen-Ebene, zur Seite von `toward` gedreht */
  planeNormal(k, toward) {
    const A = this.sim.atoms;
    const [a, b, c] = k.subs.map((i) => A[i].p);
    let n = V.norm(V.cross(V.sub(b, a), V.sub(c, a)));
    if (V.dot(V.sub(toward, A[k.c].p), n) < 0) n = V.mul(n, -1);
    return n;
  }

  // ---------- Regeln am Carbenium-Ion ----------

  /**
   * Wasser an C⁺ (→ Angriff) oder an ein β-H (→ Eliminierung).
   * emphasis: 'sn1' hebt das C⁺ hervor, 'e1' die β-H-Atome.
   * Gibt true zurück, wenn eine Sequenz gestartet wurde.
   */
  checkCarbenium(emphasis) {
    const s = this.sim, A = s.atoms;
    const cats = this.carbenia();
    if (!cats.length) return false;
    const ws = this.waters();
    for (const k of cats) {
      this.hl(k.c, COLORS.activatedC, emphasis === 'sn1' ? 0.85 : 0.5);
      for (const b of k.beta) this.hl(b.h, COLORS.carbonylO, emphasis === 'e1' ? 0.6 : 0.22);
      for (const w of ws) {
        if (s.frag[w.o] === s.frag[k.c]) continue;
        const dC = V.dist(A[w.o].p, A[k.c].p);
        // β-H zählt nur, wenn das Wasser-O ungefähr in Verlängerung der C–H-Bindung sitzt
        // (sonst würde jedes Heranführen an das C⁺ an den Methyl-H vorbei eine Eliminierung auslösen)
        let best = null, dH = Infinity;
        for (const b of k.beta) {
          const d = V.dist(A[w.o].p, A[b.h].p);
          const along = V.dot(V.norm(V.sub(A[b.h].p, A[b.cb].p)), V.norm(V.sub(A[w.o].p, A[b.h].p)));
          if (along > 0.5 && d < dH) { dH = d; best = b; }
        }
        this.hl(w.o, COLORS.nucleophile, 0.4 + 0.6 * Math.max(near(dC, T.attack), near(dH, T.betaH)));
        // Angriff am C⁺ hat Vorrang; das β-H zählt nur, wenn das Wasser nicht am C sitzt
        if (dC >= T.attack && best && dH < T.betaH) return this.startElimination(k, w, best), true;
        if (dC < T.attack) {
          if (this.allowAttack) return this.startAttack(k, w), true;
          this._hint('Wasser kann sich wieder an das Carbenium-Ion anlagern – das wäre die Rückreaktion (SN1-Konkurrenz). Für die Eliminierung muss ein Wassermolekül ein H-Atom vom Nachbar-C (β-H, gelb) abziehen.');
        }
      }
    }
    return 'idle';
  }

  get allowAttack() { return true; }

  /** SN1, Schritte 2 und 3: Angriff von Wasser, dann Deprotonierung */
  startAttack(k, w) {
    const s = this.sim, A = s.atoms;
    const nrm = this.planeNormal(k, A[w.o].p);
    const nuFrag = [...s.fragmentOf(w.o)];
    // zweites Wassermolekül als Base für die Deprotonierung
    const others = this.waters().filter((x) => s.frag[x.o] !== s.frag[w.o] && s.frag[x.o] !== s.frag[k.c]);
    const base = others.sort((x, y) => V.dist(A[x.o].p, A[w.o].p) - V.dist(A[y.o].p, A[w.o].p))[0] || null;
    // Proton, das abgegeben wird: das H des angreifenden Wassers, das am weitesten vom C weg zeigt
    let Hx = null;
    const steps = [
      {
        index: 1,
        title: 'Nukleophiler Angriff des Wassers',
        text: 'Ein freies Elektronenpaar des Wasser-Sauerstoffs (δ−) greift das positiv geladene, planare C-Atom an. Weil das Carbenium-Ion eben ist, ist der Angriff von beiden Seiten gleich wahrscheinlich – bei einem chiralen Substrat entstünde ein Racemat. Es entsteht ein Alkyloxonium-Ion (O trägt die positive Ladung).',
        pre: () => this.alignLonePair(w.o, V.add(A[k.c].p, V.mul(nrm, 2.5)), V.mul(nrm, -1), 1.0),
        arrows: [{ from: { atom: w.o }, to: { atom: k.c } }],
        exec: () => { s.setBond(w.o, k.c, 1, 1.6); return 1.7; },
      },
      {
        index: 2,
        title: 'Deprotonierung',
        text: base
          ? 'Ein weiteres Wassermolekül nimmt ein Proton vom Oxonium-Ion auf (H₃O⁺ entsteht). Zurück bleibt der neutrale Alkohol 2-Methylpropan-2-ol.'
          : 'Das Oxonium-Ion gibt ein Proton an das Lösungsmittel ab. Zurück bleibt der neutrale Alkohol 2-Methylpropan-2-ol.',
        pre: () => {
          Hx = w.H.slice().sort((x, y) => V.dist(A[y].p, A[k.c].p) - V.dist(A[x].p, A[k.c].p))[0];
          if (!base) return 0.2;
          const dir = V.norm(V.sub(A[Hx].p, A[w.o].p));
          return this.alignLonePair(base.o, V.add(A[Hx].p, V.mul(dir, 1.75)), V.mul(dir, -1), 1.0);
        },
        get arrows() {
          return base
            ? [{ from: { atom: base.o }, to: { atom: Hx } }, { from: { bond: [w.o, Hx] }, to: { atom: w.o } }]
            : [{ from: { bond: [w.o, Hx] }, to: { atom: w.o } }];
        },
        exec: () => {
          s.setBond(w.o, Hx, 0, 1.3);
          if (base) s.setBond(base.o, Hx, 1, 1.3);
          return 1.4;
        },
        after: () => (base ? this.driftAway(base.o, A[k.c].p, 2.2, 1.2) : (s.addMove([Hx], { trans: [0.5, 0.3, 2.0] }, 1.2), 1.3)),
      },
    ];
    this._begin({
      kind: 'sn1-attack',
      reaction: 'Nukleophile Substitution (SN1)',
      steps,
      busy: [...s.fragmentOf(k.c), ...nuFrag, ...(base ? s.fragmentOf(base.o) : [])],
      done: () => {
        this.counts.sn1++;
        this.status.title = 'SN1 abgeschlossen';
        this.status.text = '(CH₃)₃C–Br + 2 H₂O → (CH₃)₃C–OH + H₃O⁺ + Br⁻. Geschwindigkeitsbestimmend ist die langsame Heterolyse: Die Geschwindigkeit hängt nur von der Konzentration des Halogenalkans ab (1. Ordnung, „SN1“). Tertiäre Carbenium-Ionen sind durch den +I-Effekt der drei Methylgruppen besonders stabil.';
        this.status.stepDone = true;
      },
    });
  }

  /** E1, letzter Schritt: Wasser zieht ein β-H ab, die C=C-Doppelbindung entsteht */
  startElimination(k, w, b) {
    const s = this.sim, A = s.atoms;
    const nuFrag = [...s.fragmentOf(w.o)];
    const inSN1 = this.constructor.id === 'sn1';
    const steps = [
      {
        index: 2,
        title: inSN1 ? 'Eliminierung statt Substitution (E1)' : 'Deprotonierung am β-C-Atom',
        text: `Das Wassermolekül greift nicht am C⁺ an, sondern zieht ein Proton vom benachbarten C-Atom (β-H) ab. Das bindende Elektronenpaar der C–H-Bindung bildet die C=C-Doppelbindung: Es entsteht 2-Methylpropen.${inSN1 ? ' Das ist die Konkurrenzreaktion zur SN1 – beide laufen über dasselbe Carbenium-Ion.' : ''}`,
        pre: () => {
          const dir = V.norm(V.sub(A[b.h].p, A[b.cb].p));
          return this.alignLonePair(w.o, V.add(A[b.h].p, V.mul(dir, 1.6)), V.mul(dir, -1), 0.6);
        },
        arrows: [
          { from: { atom: w.o }, to: { atom: b.h } },
          { from: { bond: [b.cb, b.h] }, to: { bond: [b.cb, k.c] } },
        ],
        exec: () => {
          s.setBond(w.o, b.h, 1, 1.5);
          s.setBond(b.cb, b.h, 0, 1.5);
          s.setBond(b.cb, k.c, 2, 1.5);
          return 1.6;
        },
        after: () => this.driftAway(w.o, A[k.c].p, 2.4, 1.3),
      },
    ];
    this._begin({
      kind: 'e1-deprotonation',
      reaction: 'Eliminierung (E1)',
      steps,
      busy: [...s.fragmentOf(k.c), ...nuFrag],
      done: () => {
        this.counts.e1++;
        this.status.title = 'E1 abgeschlossen: 2-Methylpropen';
        this.status.text = inSN1
          ? 'Aus dem Carbenium-Ion ist durch Abgabe eines β-H ein Alken entstanden – Eliminierung statt Substitution. SN1 und E1 konkurrieren immer: Höhere Temperatur und schwache Nukleophile begünstigen die Eliminierung.'
          : '(CH₃)₃C–OH → (CH₃)₂C=CH₂ + H₂O. Das H⁺ liegt am Ende wieder als H₃O⁺ vor – es wirkt als Katalysator. SN1 und E1 laufen über dasselbe Carbenium-Ion: Lagert sich Wasser an das C⁺ an, entsteht wieder der Alkohol; gibt das Kation ein β-H ab, entsteht das Alken. Hohe Temperatur begünstigt die Eliminierung.';
        this.status.stepDone = true;
      },
    });
  }
}
