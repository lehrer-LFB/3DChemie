// Nukleophile Substitution zweiter Ordnung (SN2):
//   HO⁻ + CH₃–Br  →  [HO···CH₃···Br]⁻‡  →  HO–CH₃ + Br⁻
// Ein einziger, konzertierter Schritt mit Rückseitenangriff. Die Geometrie des
// Übergangszustands (trigonal-bipyramidal) und die Walden-Umkehr ergeben sich
// aus Sonderwinkeln am Zentral-C, die mit dem Reaktionsfortschritt laufen.

import { V } from '../vec.js';
import { COLORS } from '../mechanism.js';
import { ReactionBase, near } from './base.js';

const DEG = Math.PI / 180;
const T = { attack: 2.8, backside: -0.85, front: -0.5 };
const Z = { H: 1, C: 6, O: 8, Br: 35 };

export class SN2 extends ReactionBase {
  static id = 'sn2';
  static title = 'Nukleophile Substitution (SN2)';
  static example = 'Brommethan + OH⁻ → Methanol + Br⁻ (Rückseitenangriff, Walden-Umkehr)';
  static lk = true;
  static steps = ['Rückseitenangriff', 'Übergangszustand', 'Walden-Umkehr'];
  static scenarios = {
    methyl: {
      label: 'Brommethan',
      items: [
        ['bromomethane', [-1.2, 0.3, -1.0], [-1.1, -0.5, 0]],
        ['hydroxide', [2.6, -1.0, 1.8]],
      ],
    },
    chiral: {
      label: '(R)-2-Brombutan',
      items: [
        ['bromobutaneMirror', [-1.2, 0.3, -1.0], [-1.1, -0.5, 0]],
        ['hydroxide', [2.6, -1.0, 1.8]],
      ],
    },
  };
  static extra = ['bromomethane', 'hydroxide'];
  static counters = [{ key: 'sn2', label: 'SN2-Produkte' }];
  static names = {
    'C4H9Br|0': ['2-Brombutan', 'CH₃–CHBr–C₂H₅'],
    'C4H10O|0': ['Butan-2-ol', 'CH₃–CH(OH)–C₂H₅'],
    'C4H10BrO|-1': ['Übergangszustand', '[HO···C₄H₉···Br]⁻'],
  };

  // ---------- Erkennung ----------

  /** Halogenalkan: sp³-C mit genau einem Br; degree = Anzahl C-Nachbarn */
  substrate(c) {
    const s = this.sim, A = s.atoms;
    if (A[c].el !== 'C') return null;
    const nb = s.nbrs(c);
    if (nb.length !== 4 || nb.some((x) => x.o !== 1)) return null;
    const br = nb.filter((x) => A[x.j].el === 'Br');
    if (br.length !== 1) return null;
    return { c, br: br[0].j, degree: nb.filter((x) => A[x.j].el === 'C').length };
  }

  /** Hydroxid-Ion: O mit genau einem H */
  hydroxide(o) {
    const s = this.sim, A = s.atoms;
    if (A[o].el !== 'O') return null;
    const nb = s.nbrs(o);
    if (nb.length !== 1 || A[nb[0].j].el !== 'H') return null;
    return { o, h: nb[0].j };
  }

  /** CIP-Konfiguration (R/S) eines Stereozentrums, sonst null (einfache Rangfolge: Z, dann Nachbarn) */
  cip(c) {
    const s = this.sim, A = s.atoms;
    const nb = s.nbrs(c).map((x) => x.j);
    if (nb.length !== 4 || A[c].el !== 'C') return null;
    const key = (j) => [Z[A[j].el], ...s.nbrs(j).filter((x) => x.j !== c).map((x) => Z[A[x.j].el]).sort((a, b) => b - a)];
    const cmp = (a, b) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] || 0) - (b[i] || 0);
        if (d) return d;
      }
      return 0;
    };
    const ranked = nb.map((j) => ({ j, k: key(j) })).sort((p, q) => cmp(q.k, p.k));
    for (let i = 0; i < 3; i++) if (cmp(ranked[i].k, ranked[i + 1].k) === 0) return null;
    const p = (i) => V.sub(A[ranked[i].j].p, A[ranked[3].j].p);
    const triple = V.dot(p(0), V.cross(p(1), p(2)));
    return triple > 0 ? 'S' : 'R';
  }

  _updateTags() {
    const tags = [];
    for (let i = 0; i < this.sim.atoms.length; i++) {
      if (this.sim.atoms[i].el !== 'C') continue;
      const r = this.cip(i);
      if (r) tags.push({ atom: i, text: `(${r})`, color: r === 'R' ? '#7b3fd6' : '#d6489b' });
    }
    this.m.tags = tags;
  }

  // ---------- Regeln ----------

  check() {
    const s = this.sim, A = s.atoms;
    this._updateTags();
    const subs = [], nus = [];
    for (let i = 0; i < A.length; i++) {
      const x = this.substrate(i); if (x) subs.push(x);
      const n = this.hydroxide(i); if (n) nus.push(n);
    }
    for (const x of subs) {
      const axis = V.norm(V.sub(A[x.c].p, A[x.br].p));
      const back = V.add(A[x.c].p, V.mul(axis, 2.5));
      let best = 0;
      this.hl(x.c, COLORS.activatedC, 0.6);
      this.hl(x.br, COLORS.carbonylO, 0.35);
      for (const n of nus) {
        const d = V.dist(A[n.o].p, A[x.c].p);
        const cosA = V.dot(V.norm(V.sub(A[n.o].p, A[x.c].p)), V.mul(axis, -1));
        best = Math.max(best, near(V.dist(A[n.o].p, back), 2.5));
        this.hl(n.o, COLORS.nucleophile, 0.4 + 0.6 * near(d, T.attack));
        if (d >= T.attack) continue;
        if (x.degree === 3) {
          this._hint('Am tertiären C-Atom ist kein Rückseitenangriff möglich: Die drei großen Methylgruppen schirmen das C-Atom ab (sterische Hinderung). Tertiäre Halogenalkane reagieren nach SN1.');
          continue;
        }
        if (cosA < T.backside) return this.startSN2(x, n);
        if (cosA > T.front) this._hint('Von vorne kommt das Hydroxid-Ion nicht an das C-Atom heran: Das große, elektronenreiche Brom-Atom schirmt ab und stößt das negativ geladene Nukleophil ab. Greife von der Rückseite an – genau gegenüber dem Brom-Atom (grüne Markierung).');
        else this._hint('Fast! Der Angriff muss genau von der Rückseite erfolgen, auf der Linie Br–C (grüne Markierung).');
      }
      this.m.markers.push({ p: back, color: COLORS.nucleophile, opacity: 0.25 + 0.4 * best });
    }

    let g;
    if (subs.length && nus.length) g = 'Bringe das Hydroxid-Ion (grün) mit seinem Sauerstoff von der Rückseite an das C-Atom (orange) – genau gegenüber dem Brom-Atom (gelb). Die grüne Kugel zeigt die Angriffsposition.';
    else if (subs.length) g = 'Kein Nukleophil mehr vorhanden – lege Edukte nach.';
    else g = 'Kein Halogenalkan mehr vorhanden – starte neu oder lege Edukte nach.';
    this.setGuidance(g);
  }

  startSN2(x, n) {
    const s = this.sim, A = s.atoms;
    const before = this.cip(x.c);
    const axis = V.norm(V.sub(A[x.c].p, A[x.br].p));
    // Sonderwinkel: Nu–C–Br 180°, die Substituenten klappen mit dem Fortschritt um
    const progress = () => {
      const o1 = s.bond(n.o, x.c)?.order ?? 0;
      const o2 = s.bond(x.c, x.br)?.order ?? 0;
      return Math.max(0, Math.min(1, (o1 + (1 - o2)) / 2));
    };
    const angle = (j, k) => {
      const p = progress();
      const ax = (i) => i === n.o || i === x.br;
      if (ax(j) && ax(k)) return Math.PI;
      if (j === n.o || k === n.o) return (70.53 + 38.94 * p) * DEG;
      if (j === x.br || k === x.br) return (109.47 - 38.94 * p) * DEG;
      return (109.47 + 10.53 * Math.sin(Math.PI * p)) * DEG;
    };
    const arrows = [
      { from: { atom: n.o }, to: { atom: x.c } },
      { from: { bond: [x.c, x.br] }, to: { atom: x.br } },
    ];
    const steps = [
      {
        index: 0,
        title: 'Rückseitenangriff',
        text: 'Ein freies Elektronenpaar des Hydroxid-Ions greift das δ+-C-Atom von der Rückseite an – genau gegenüber dem Brom-Atom. Gleichzeitig beginnt sich die C–Br-Bindung zu lösen: Bindungsbildung und Bindungsbruch laufen in einem einzigen Schritt ab (konzertiert).',
        pre: () => this.alignLonePair(n.o, V.add(A[x.c].p, V.mul(axis, 2.6)), V.mul(axis, -1), 1.0),
        arrows,
        exec: () => {
          s.angleOverride.set(x.c, angle);
          s.setBond(n.o, x.c, 0.5, 1.8);
          s.setBond(x.c, x.br, 0.5, 1.8);
          return 1.9;
        },
      },
      {
        index: 1,
        title: 'Übergangszustand',
        text: 'Für einen Moment ist das C-Atom mit fünf Partnern verbunden: O und Br nur teilweise (halb transparente Bindungen), beide tragen eine negative Teilladung. Die drei übrigen Substituenten liegen in einer Ebene (trigonal-bipyramidale Anordnung). Das ist kein Zwischenprodukt, sondern der energiereichste Punkt der Reaktion.',
        arrows,
        exec: () => {
          s.setBond(n.o, x.c, 1, 1.8);
          s.setBond(x.c, x.br, 0, 1.8);
          return 1.9;
        },
        after: () => this.driftAway(x.br, A[x.c].p, 2.2, 1.2),
      },
      {
        index: 2,
        title: 'Walden-Umkehr',
        text: 'Das Bromid-Ion verlässt das Molekül. Die drei Substituenten klappen wie ein Regenschirm im Sturm auf die andere Seite um: Die Konfiguration am C-Atom kehrt sich um (Inversion).',
        arrows: [],
        exec: () => { s.angleOverride.delete(x.c); return 0.4; },
      },
    ];
    this._begin({
      kind: 'sn2',
      reaction: 'Nukleophile Substitution (SN2)',
      steps,
      busy: [...s.fragmentOf(x.c), ...s.fragmentOf(n.o)],
      done: () => {
        s.angleOverride.delete(x.c);
        this.counts.sn2++;
        const after = this.cip(x.c);
        this._updateTags();
        this.status.title = 'SN2 abgeschlossen';
        const stereo = before && after
          ? ` Am Stereozentrum wird aus (${before})-2-Brombutan (${after})-Butan-2-ol – die Raumanordnung ist gespiegelt (die Buchstaben ändern sich hier, weil OH wie Br die höchste Priorität hat).`
          : '';
        this.status.text = `${x.degree ? 'R–Br' : 'CH₃–Br'} + OH⁻ → ${x.degree ? 'R–OH' : 'CH₃–OH'} + Br⁻.${stereo} Die Geschwindigkeit hängt von beiden Konzentrationen ab (2. Ordnung, „SN2“). Bevorzugt bei Methyl- und primären Halogenalkanen; bei tertiären verhindern große Substituenten den Rückseitenangriff (sterische Hinderung) – dort läuft SN1.`;
        this.status.stepDone = true;
      },
    });
  }

  *demo(d) {
    const A = d.sim.atoms;
    let x = null, n = null;
    for (let i = 0; i < A.length; i++) {
      x ||= this.substrate(i);
      n ||= this.hydroxide(i);
    }
    if (!x || !n) return;
    const axis = V.norm(V.sub(A[x.c].p, A[x.br].p));
    // erst weiträumig hinter das Molekül, dann auf der Achse heran
    yield* d.bringLonePair(n.o, V.add(A[x.c].p, V.mul(axis, 5)), V.mul(axis, -1), 1.6);
    yield* d.bring(n.o, V.add(A[x.c].p, V.mul(axis, 2.6)), 1.2);
    yield* d.untilIdle();
  }
}
