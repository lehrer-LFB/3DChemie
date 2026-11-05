// "Vorführen": führt die nächste mögliche Reaktion automatisch aus, indem die
// Moleküle (wie von Hand) an die reaktiven Zentren geschoben werden.
// Frame-basiert (Generator), damit es mit Pause/Vorspulen deterministisch bleibt.

import { V, Q } from './vec.js';

export class Demo {
  constructor(sim, mech) {
    this.sim = sim;
    this.mech = mech;
    this.it = null;
  }

  get running() {
    return !!this.it;
  }

  start() {
    if (this.it || this.mech.seq) return false;
    this.it = this._run();
    return true;
  }

  stop() {
    this.it = null;
  }

  update(dt) {
    if (!this.it) return;
    if (this.it.next(dt).done) this.it = null;
  }

  *_wait(sec) {
    let t = 0;
    while (t < sec) t += yield;
  }

  *untilIdle() {
    while (this.mech.seq) yield;
    yield* this._wait(0.3);
  }

  /** Fragment von atomId verschieben (optional drehen um das Atom), bis atomId bei target liegt */
  *bring(atomId, target, dur, rot) {
    const ids = [...this.sim.fragmentOf(atomId)];
    const p = this.sim.atoms[atomId].p;
    this.sim.addMove(ids, { pivot: [...p], rot, trans: V.sub(target, p) }, dur);
    yield* this._wait(dur + 0.15);
  }

  /** wie bring, dabei wird Richtung `from` auf Richtung `to` gedreht */
  *bringOriented(atomId, target, from, to, dur) {
    yield* this.bring(atomId, target, dur, Q.fromUnitVectors(V.norm(from), V.norm(to)));
  }

  /** Freies Elektronenpaar von Atom o in Richtung dir ausrichten und o nach target bringen */
  *bringLonePair(o, target, dir, dur) {
    const A = this.sim.atoms;
    const sub = this.sim.nbrs(o).map((x) => A[x.j].p);
    const lp = sub.length ? V.norm(V.sub(A[o].p, V.centroid(sub))) : V.norm(dir);
    yield* this.bringOriented(o, target, lp, dir, dur);
  }

  *_run() {
    yield;
    if (this.mech.rx) yield* this.mech.rx.demo(this);
  }
}
