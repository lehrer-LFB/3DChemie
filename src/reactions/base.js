// Basisklasse für Reaktionsmodule: bequemer Zugriff auf die Engine und
// gemeinsame Hilfsfunktionen.

import { V, Q } from '../vec.js';

export const near = (d, t) => Math.max(0, Math.min(1, (2.5 * t - d) / (1.5 * t)));

export class ReactionBase {
  static lk = false;
  static levels = ['q2'];
  static extra = [];

  constructor(m) {
    this.m = m;
  }

  get sim() { return this.m.sim; }
  get level() { return this.m.level; }
  get highlights() { return this.m.highlights; }
  get counts() { return this.m.counts; }
  get status() { return this.m.status; }
  get guidance() { return this.m.guidance; }
  set guidance(g) { this.m.guidance = g; }
  get hintCooldown() { return this.m.hintCooldown; }
  set hintCooldown(v) { this.m.hintCooldown = v; }

  _begin(seq) { this.m._begin(seq); }
  _hint(text) { this.m._hint(text); }
  _emitStatus() { this.m._emitStatus(); }

  check() {}
  checkEF() { this.check(); }
  *demo() {}

  /** Atom hervorheben (die stärkste Hervorhebung gewinnt) */
  hl(id, color, strength) {
    if (id == null) return;
    const cur = this.highlights.get(id);
    if (!cur || cur.strength < strength) this.highlights.set(id, { color, strength });
  }

  setGuidance(g) {
    if (g !== this.m.guidance) {
      this.m.guidance = g;
      this.m._emitStatus();
    }
  }

  freeProton(h) {
    const s = this.sim;
    return s.atoms[h].el === 'H' && s.nbrs(h).length === 0;
  }

  /** Wassermolekül mit Sauerstoff o? */
  water(o) {
    const s = this.sim, A = s.atoms;
    if (A[o].el !== 'O') return null;
    const nb = s.nbrs(o);
    if (nb.length !== 2 || nb.some((x) => x.o !== 1 || A[x.j].el !== 'H')) return null;
    return { o, H: nb.map((x) => x.j) };
  }

  /** Oxonium-Ion H₃O⁺ mit Sauerstoff o? */
  hydronium(o) {
    const s = this.sim, A = s.atoms;
    if (A[o].el !== 'O') return null;
    const nb = s.nbrs(o);
    if (nb.length !== 3 || nb.some((x) => x.o !== 1 || A[x.j].el !== 'H')) return null;
    return { o, H: nb.map((x) => x.j) };
  }

  /**
   * Molekül so drehen und verschieben, dass das freie Elektronenpaar von
   * Atom `o` in Richtung `dir` zeigt und `o` bei `target` liegt.
   */
  alignLonePair(o, target, dir, dur = 1.0) {
    const s = this.sim, A = s.atoms;
    const ids = [...s.fragmentOf(o)];
    const p = A[o].p;
    const sub = s.nbrs(o).map((x) => A[x.j].p);
    const lp = sub.length ? V.norm(V.sub(p, V.centroid(sub))) : V.norm(dir);
    const rot = Q.fromUnitVectors(lp, V.norm(dir));
    s.addMove(ids, { pivot: [...p], rot, trans: V.sub(target, p) }, dur);
    return dur + 0.05;
  }

  /** Fragment von `id` seitlich wegdriften lassen (nicht auf die Person zu) */
  driftAway(id, from, dist = 2.6, dur = 1.4) {
    const s = this.sim, A = s.atoms;
    s.ensureTopo();
    const ids = [...s.fragmentOf(id)];
    const d0 = V.norm(V.sub(A[id].p, from));
    // bevorzugt nach rechts (links liegt die Infokarte) und fast waagerecht
    const dir = V.norm([Math.abs(d0[0]) + 0.6, Math.max(-0.2, Math.min(0.2, d0[1] * 0.4)), d0[2] * 0.3]);
    s.addMove(ids, { trans: V.mul(dir, dist) }, dur);
    return dur + 0.1;
  }
}
