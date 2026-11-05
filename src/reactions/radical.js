// Radikalische Substitution: Bromierung von Methan unter UV-Licht.
//   Start:        Br₂  --hν-->  2 Br•                       (Homolyse)
//   Kette 1:      Br• + H–CH₃  →  H–Br + •CH₃
//   Kette 2:      •CH₃ + Br–Br  →  CH₃–Br + Br•
//   Abbruch:      Br• + Br• → Br₂,  •CH₃ + Br• → CH₃Br,  •CH₃ + •CH₃ → C₂H₆
// Pfeile sind Halbpfeile (Fischhaken): Jeder verschiebt nur ein Elektron.

import { V } from '../vec.js';
import { COLORS } from '../mechanism.js';
import { ReactionBase, near } from './base.js';

const T = { abstraction: 1.9, bromination: 2.5, termination: 2.2 };
const LAMP = { x: -1.6, z: -1.6, radius: 1.5, top: 4.2, bottom: -3.5 };

export class RadicalSubstitution extends ReactionBase {
  static id = 'radical';
  static title = 'Radikalische Substitution';
  static example = 'Methan + Brom (UV-Licht) → Brommethan + Bromwasserstoff';
  static steps = ['Startreaktion (hν)', 'Kettenfortpflanzung 1', 'Kettenfortpflanzung 2', 'Kettenabbruch'];
  static lamp = LAMP;
  static scenarios = {
    methane: {
      label: 'Methan + Brom',
      items: [
        ['methane', [0.6, 0.8, 0.2]],
        ['methane', [3.4, 2.2, -1.6]],
        ['methane', [0.2, 2.6, -3.6]],
        ['bromine', [4.2, -1.8, 1.8], [0, 0.4, 0.2]],
        ['bromine', [0.2, -2.6, 3.0], [0, -0.3, 0.1]],
        ['bromine', [6.0, 0.4, -0.8], [0, 1.2, -0.2]],
      ],
    },
  };
  static extra = ['methane', 'bromine'];
  static counters = [
    { key: 'rsub', label: 'Brommethan' },
    { key: 'chain', label: 'Kettenschritte' },
    { key: 'term', label: 'Abbrüche' },
  ];
  static names = {
    'Br|0': ['Brom-Radikal', 'Br•'],
    'CH3|0': ['Methyl-Radikal', '•CH₃'],
  };

  // ---------- Erkennung ----------

  /** Punkt (bzw. Atom) im Lichtkegel? */
  inBeam(i) {
    const p = Array.isArray(i) ? i : this.sim.atoms[i].p;
    return Math.hypot(p[0] - LAMP.x, p[2] - LAMP.z) < LAMP.radius && p[1] < LAMP.top && p[1] > LAMP.bottom;
  }

  bromine(b) {
    const s = this.sim, A = s.atoms;
    if (A[b].el !== 'Br' || s.radicalOf(b, true)) return null;
    const nb = s.nbrs(b);
    if (nb.length !== 1 || A[nb[0].j].el !== 'Br' || nb[0].j < b) return null;
    return { a: b, b: nb[0].j };
  }

  /** Radikal-Atom (Br• oder C•) */
  radicals() {
    const out = [];
    for (let i = 0; i < this.sim.atoms.length; i++) if (this.sim.radicalOf(i, true)) out.push(i);
    return out;
  }

  /** C–H-Bindungen von Alkanen (C nur mit C/H, vier Einfachbindungen, kein Radikal) */
  alkaneCH() {
    const s = this.sim, A = s.atoms;
    const out = [];
    for (let c = 0; c < A.length; c++) {
      if (A[c].el !== 'C' || s.radicalOf(c, true)) continue;
      const nb = s.nbrs(c);
      if (nb.length !== 4 || nb.some((x) => x.o !== 1 || (A[x.j].el !== 'H' && A[x.j].el !== 'C'))) continue;
      for (const x of nb) if (A[x.j].el === 'H') out.push({ c, h: x.j });
    }
    return out;
  }

  /** Richtung des einfach besetzten p-Orbitals am planaren •CH₃ (zur Seite von `toward`) */
  orbitalDir(c, toward) {
    const s = this.sim, A = s.atoms;
    const nb = s.nbrs(c).map((x) => A[x.j].p);
    let n = V.norm(V.cross(V.sub(nb[1], nb[0]), V.sub(nb[2], nb[0])));
    if (V.dot(V.sub(toward, A[c].p), n) < 0) n = V.mul(n, -1);
    return n;
  }

  // ---------- Regeln ----------

  check() {
    const s = this.sim, A = s.atoms;
    const P = (i) => A[i].p;
    const br2 = [];
    for (let i = 0; i < A.length; i++) { const b = this.bromine(i); if (b) br2.push(b); }
    const rads = this.radicals();
    const chs = this.alkaneCH();

    for (const r of rads) this.hl(r, COLORS.activatedC, 0.7);

    // Kette 1: Br• zieht ein H-Atom ab (ungefähr in Verlängerung der C–H-Bindung)
    for (const r of rads) {
      if (A[r].el !== 'Br') continue;
      for (const { c, h } of chs) {
        const d = V.dist(P(r), P(h));
        const along = V.dot(V.norm(V.sub(P(h), P(c))), V.norm(V.sub(P(r), P(h))));
        if (d < 3.5) this.hl(h, COLORS.nucleophile, 0.3 + 0.6 * near(d, T.abstraction));
        if (d < T.abstraction && along > 0.4) return this.startAbstraction(r, c, h);
      }
    }

    // Kette 2: •CH₃ greift ein Br₂ an
    for (const r of rads) {
      if (A[r].el !== 'C') continue;
      for (const b of br2) {
        for (const [bn, bf] of [[b.a, b.b], [b.b, b.a]]) {
          const d = V.dist(P(r), P(bn));
          const along = V.dot(V.norm(V.sub(P(bn), P(r))), V.norm(V.sub(P(bf), P(bn))));
          if (d < 4) this.hl(bn, COLORS.nucleophile, 0.3 + 0.6 * near(d, T.bromination));
          if (d < T.bromination && along > 0.4) return this.startBromination(r, bn, bf);
        }
      }
    }

    // Kettenabbruch: zwei Radikale treffen sich (nachrangig – Kettenschritte haben Vorrang)
    for (let x = 0; x < rads.length; x++) {
      for (let y = x + 1; y < rads.length; y++) {
        const a = rads[x], b = rads[y];
        if (s.frag[a] === s.frag[b]) continue;
        if (V.dist(P(a), P(b)) < T.termination) return this.startTermination(a, b);
      }
    }

    // Startreaktion: Br₂ im Lichtkegel
    for (const b of br2) {
      if (this.inBeam(V.lerp(A[b.a].p, A[b.b].p, 0.5))) return this.startHomolysis(b);
    }

    // Hinweis: Methan und Brom ohne Licht
    if (!rads.length) {
      for (const b of br2) {
        for (const { h } of chs) {
          if (Math.min(V.dist(P(b.a), P(h)), V.dist(P(b.b), P(h))) < 2.2) {
            this._hint('Im Dunkeln reagieren Methan und Brom nicht miteinander. Zuerst muss ein Brom-Molekül durch UV-Licht in zwei Radikale gespalten werden – bringe ein Br₂ in den violetten Lichtkegel.');
          }
        }
      }
    }

    const hasBr = rads.some((r) => A[r].el === 'Br');
    const hasC = rads.some((r) => A[r].el === 'C');
    let g;
    if (hasC && br2.length) g = 'Methyl-Radikal (orange, Elektronenpunkt): Bringe es an ein Brom-Molekül – es reißt ein Br-Atom heraus, dabei entsteht ein neues Br•. Oder: Zwei Radikale zusammenbringen → Kettenabbruch.';
    else if (hasBr && chs.length) g = 'Brom-Radikal (orange): Bringe es an ein H-Atom eines Methan-Moleküls – es reißt das H-Atom heraus (es entsteht HBr und ein Methyl-Radikal).';
    else if (rads.length >= 2) g = 'Nur noch Radikale übrig: Bringe zwei Radikale zusammen → Kettenabbruch.';
    else if (br2.length) g = 'Bringe ein Brom-Molekül in den violetten UV-Lichtkegel. Das Licht spaltet die Br–Br-Bindung homolytisch.';
    else g = 'Kein Brom mehr vorhanden – lege Edukte nach.';
    this.setGuidance(g);
  }

  // ---------- Sequenzen ----------

  startHomolysis(b) {
    const s = this.sim, A = s.atoms;
    const steps = [
      {
        index: 0,
        title: 'Startreaktion: Homolyse durch Licht',
        text: 'Ein Lichtquant (hν) liefert die Energie, um die unpolare Br–Br-Bindung zu spalten. Die Spaltung ist homolytisch: Jedes Br-Atom erhält eines der beiden Bindungselektronen. Es entstehen zwei Brom-Radikale (Br•) mit je einem ungepaarten Elektron – sie sind sehr reaktiv.',
        arrows: [
          { from: { bond: [b.a, b.b] }, to: { atom: b.a }, half: true },
          { from: { bond: [b.a, b.b] }, to: { atom: b.b }, half: true },
        ],
        exec: () => {
          s.setBond(b.a, b.b, 0, 1.6);
          s.setRadical(b.a, 1);
          s.setRadical(b.b, 1);
          return 1.7;
        },
        after: () => {
          // ein Radikal aus dem Lichtkegel heraus, Richtung Methan
          const dir = V.norm(V.sub(A[b.b].p, A[b.a].p));
          s.addMove([b.b], { trans: V.add(V.mul(dir, 1.2), [1.2, 0, 0.6]) }, 1.0);
          s.addMove([b.a], { trans: V.add(V.mul(dir, -0.6), [0.8, 0.4, 0.8]) }, 1.0);
          return 1.1;
        },
      },
    ];
    this._begin({
      kind: 'homolysis', reaction: 'Radikalische Substitution', steps, busy: [b.a, b.b],
      done: () => {
        this.status.title = 'Zwei Brom-Radikale';
        this.status.text = 'Die Brom-Radikale haben ein ungepaartes Elektron (Punkt). Sie können jetzt einem Methan-Molekül ein H-Atom entreißen – damit beginnt die Kettenreaktion.';
        this.status.stepDone = true;
      },
    });
  }

  startAbstraction(r, c, h) {
    const s = this.sim, A = s.atoms;
    const dir = V.norm(V.sub(A[h].p, A[c].p));
    const steps = [
      {
        index: 1,
        title: 'Kettenfortpflanzung 1: H-Abstraktion',
        text: 'Das Brom-Radikal greift ein H-Atom des Methans an. Die C–H-Bindung wird homolytisch gespalten: Ein Elektron bildet mit dem ungepaarten Elektron des Br• die neue H–Br-Bindung, das andere bleibt am C-Atom. Es entstehen Bromwasserstoff und ein Methyl-Radikal (•CH₃, nahezu planar).',
        pre: () => { s.addMove([r], { trans: V.sub(V.add(A[h].p, V.mul(dir, 1.6)), A[r].p) }, 0.6); return 0.65; },
        arrows: [
          { from: { atom: r }, to: { bond: [r, h] }, half: true },
          { from: { bond: [c, h] }, to: { bond: [r, h] }, half: true },
          { from: { bond: [c, h] }, to: { atom: c }, half: true },
        ],
        exec: () => {
          s.setBond(c, h, 0, 1.5);
          s.setBond(r, h, 1, 1.5);
          s.setRadical(r, 0);
          s.setRadical(c, 1);
          return 1.6;
        },
        after: () => this.driftAway(h, A[c].p, 2.0, 1.1),
      },
    ];
    this._begin({
      kind: 'abstraction', reaction: 'Radikalische Substitution', steps, busy: [...s.fragmentOf(c), r],
      done: () => {
        this.counts.chain++;
        this.status.title = 'Methyl-Radikal entstanden';
        this.status.text = 'CH₄ + Br• → •CH₃ + HBr. Das Radikal ist nicht verschwunden, es sitzt jetzt am C-Atom. Bringe das Methyl-Radikal an ein Brom-Molekül.';
        this.status.stepDone = true;
      },
    });
  }

  startBromination(r, bn, bf) {
    const s = this.sim, A = s.atoms;
    const n = this.orbitalDir(r, A[bn].p);
    const steps = [
      {
        index: 2,
        title: 'Kettenfortpflanzung 2: Br-Übertragung',
        text: 'Das Methyl-Radikal greift ein Brom-Molekül an. Die Br–Br-Bindung wird homolytisch gespalten: Ein Elektron bildet mit dem ungepaarten Elektron des C-Atoms die C–Br-Bindung, das andere bleibt am zweiten Br-Atom. Es entstehen Brommethan und ein neues Brom-Radikal – die Kette geht weiter.',
        pre: () => {
          const ids = [...s.fragmentOf(bn)];
          const target = V.add(A[r].p, V.mul(n, 2.3));
          s.addMove(ids, { trans: V.sub(target, A[bn].p) }, 0.6);
          return 0.65;
        },
        arrows: [
          { from: { atom: r }, to: { bond: [r, bn] }, half: true },
          { from: { bond: [bn, bf] }, to: { bond: [r, bn] }, half: true },
          { from: { bond: [bn, bf] }, to: { atom: bf }, half: true },
        ],
        exec: () => {
          s.setBond(r, bn, 1, 1.5);
          s.setBond(bn, bf, 0, 1.5);
          s.setRadical(r, 0);
          s.setRadical(bf, 1);
          return 1.6;
        },
        after: () => this.driftAway(bf, A[r].p, 1.6, 1.0),
      },
    ];
    this._begin({
      kind: 'bromination', reaction: 'Radikalische Substitution', steps, busy: [...s.fragmentOf(r), bn, bf],
      done: () => {
        this.counts.chain++;
        this.counts.rsub++;
        this.status.title = 'Brommethan entstanden – neues Br•';
        this.status.text = '•CH₃ + Br₂ → CH₃Br + Br•. Das entstandene Brom-Radikal kann das nächste Methan-Molekül angreifen: Kettenreaktion. Ein einziges Lichtquant kann so viele tausend Produktmoleküle liefern. Bei Bromüberschuss entstehen auch Mehrfachsubstitutionsprodukte (CH₂Br₂ …).';
        this.status.stepDone = true;
      },
    });
  }

  startTermination(a, b) {
    const s = this.sim, A = s.atoms;
    const els = [A[a].el, A[b].el].sort().join('+');
    const product = { 'Br+Br': 'Br₂', 'Br+C': 'Brommethan', 'C+C': 'Ethan' }[els];
    const steps = [
      {
        index: 3,
        title: `Kettenabbruch: ${product}`,
        text: 'Zwei Radikale treffen aufeinander: Ihre ungepaarten Elektronen bilden ein gemeinsames Elektronenpaar, eine neue Bindung entsteht. Dabei werden zwei Radikale verbraucht, ohne dass ein neues entsteht – die Kette bricht ab.',
        arrows: [
          { from: { atom: a }, to: { bond: [a, b] }, half: true },
          { from: { atom: b }, to: { bond: [a, b] }, half: true },
        ],
        exec: () => {
          s.setBond(a, b, 1, 1.4);
          s.setRadical(a, 0);
          s.setRadical(b, 0);
          return 1.5;
        },
      },
    ];
    this._begin({
      kind: 'termination', reaction: 'Radikalische Substitution', steps, busy: [...s.fragmentOf(a), ...s.fragmentOf(b)],
      done: () => {
        this.counts.term++;
        if (els === 'Br+C') this.counts.rsub++;
        this.status.title = `Kettenabbruch: ${product}`;
        this.status.text = `${{ 'Br+Br': 'Br• + Br• → Br₂', 'Br+C': '•CH₃ + Br• → CH₃Br', 'C+C': '•CH₃ + •CH₃ → C₂H₆ (Ethan – ein Nebenprodukt, das die Radikal-Kette nachweist)' }[els]}. Abbruchreaktionen sind selten, weil die Radikal-Konzentration sehr klein ist.`;
        this.status.stepDone = true;
      },
    });
  }

  *demo(d) {
    const { sim } = d;
    const A = sim.atoms;
    let b = null;
    for (let i = 0; i < A.length && !b; i++) b = this.bromine(i);
    if (!this.radicals().length) {
      if (!b) return;
      const mid = V.lerp(A[b.a].p, A[b.b].p, 0.5);
      yield* d.bring(b.a, V.add([LAMP.x, 0.2, LAMP.z], V.sub(A[b.a].p, mid)), 2.0);
      yield* d.untilIdle();
    }
    // Br• an ein H eines Methans
    const br = this.radicals().find((r) => A[r].el === 'Br');
    const chs = this.alkaneCH();
    if (br != null && chs.length) {
      const ch = chs.sort((p, q) => V.dist(A[p.h].p, A[br].p) - V.dist(A[q.h].p, A[br].p))[0];
      const dir = V.norm(V.sub(A[ch.h].p, A[ch.c].p));
      yield* d.bring(br, V.add(A[ch.h].p, V.mul(dir, 1.7)), 1.6);
      yield* d.untilIdle();
    }
    // •CH₃ an ein Br₂
    const c = this.radicals().find((r) => A[r].el === 'C');
    let b2 = null;
    for (let i = 0; i < A.length && !b2; i++) b2 = this.bromine(i);
    if (c != null && b2) {
      const n = this.orbitalDir(c, A[b2.a].p);
      yield* d.bringOriented(b2.a, V.add(A[c].p, V.mul(n, 2.4)), V.sub(A[b2.b].p, A[b2.a].p), n, 1.8);
      yield* d.untilIdle();
    }
  }
}
