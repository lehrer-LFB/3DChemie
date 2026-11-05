// Ablauf-Engine für Reaktionsmechanismen: Sie führt die Schritt-Sequenzen der
// aktiven Reaktion aus (Pfeile zeigen → Bindungen umbauen → Pause) und ruft im
// Leerlauf deren Erkennungsregeln auf. Die Chemie steckt in src/reactions/*.js.

// Stufen: EF = vereinfachter Ablauf (alle drei Teilchen zusammenbringen, eine
// kurze Animation), Q2 = vollständiger Mechanismus in fünf Schritten.
export const LEVELS = {
  ef: { label: 'EF', name: 'Einführungsphase – vereinfachter Ablauf' },
  q2: { label: 'Q2', name: 'Qualifikationsphase – vollständiger Mechanismus' },
};

export const COLORS = {
  carbonylO: 0xffd23f, // Ziel / reaktives Zentrum (gelb)
  proton: 0x5fd8ff,
  activatedC: 0xff7a1a,
  nucleophile: 0x6dff8a,
};

export class Mechanism {
  constructor(sim, hooks = {}) {
    this.sim = sim;
    this.hooks = hooks;
    this.level = 'q2';
    this.stepMode = false;
    this.showArrows = true;
    this.counts = {};
    this.highlights = new Map(); // atomId -> { color, strength }
    this.markers = []; // Zielmarkierungen [{ p, color }]
    this.partialOverride = new Map(); // atomId -> ±1: induzierte Partialladung (z. B. polarisiertes Br₂)
    this.tags = []; // Textschilder [{ atom, text, color }] – bleiben bis zum Neustart
    this.busy = new Set();
    this.seq = null;
    this.nextRequested = false;
    this.hintCooldown = 0;
    this.guidance = '';
    this.status = { reaction: null, stepIndex: -1, stepDone: false, title: '', text: '' };
    this.def = null; // Klasse der aktiven Reaktion
    this.rx = null; // Instanz der aktiven Reaktion
  }

  /** Aktive Reaktion setzen (Klasse aus src/reactions) */
  setReaction(def) {
    this.def = def;
    this.rx = new def(this);
    for (const c of def.counters) this.counts[c.key] ??= 0;
    this.reset();
  }

  get steps() {
    return this.def?.steps || [];
  }

  reset() {
    this.seq = null;
    this.busy.clear();
    this.highlights.clear();
    this.markers = [];
    this.tags = [];
    this.partialOverride.clear();
    this.nextRequested = false;
    this.status = { reaction: null, stepIndex: -1, stepDone: false, title: '', text: '' };
    this.hooks.onArrows?.(null);
    this._emitStatus();
  }

  next() {
    this.nextRequested = true;
  }

  get waitingForNext() {
    return !!(this.seq && !this.seq.fast && this.seq.phase === 'arrows' && this.stepMode);
  }

  update(dt) {
    this.hintCooldown = Math.max(0, this.hintCooldown - dt);
    if (this.seq) return this._runSeq(dt);
    if (!this.rx) return;
    this.sim.ensureTopo();
    this.highlights.clear();
    this.markers = [];
    this.partialOverride.clear();
    if (this.level === 'ef') this.rx.checkEF();
    else this.rx.check();
  }

  _hint(text) {
    if (this.hintCooldown > 0) return;
    this.hintCooldown = 5;
    this.hooks.onHint?.(text);
  }

  // ---------- Sequenzen ----------

  // ---------- Sequenzen ----------

  _begin(seq) {
    this.seq = { ...seq, i: -1, phase: null, t: 0, wait: 0 };
    this.busy = new Set(seq.busy);
    this.highlights.clear();
    this.hooks.onBusy?.(this.busy);
    this.status.reaction = seq.reaction;
    this._nextStep();
  }

  _nextStep() {
    const q = this.seq;
    q.i++;
    if (q.i >= q.steps.length) return this._finish();
    const st = q.steps[q.i];
    this.status.stepIndex = st.index;
    this.status.stepDone = false;
    this.status.title = q.fast ? st.title : `${st.index + 1}. ${st.title}`;
    this.status.text = st.text;
    this._emitStatus();
    this._enter('pre', st.pre ? st.pre() : 0);
  }

  _enter(phase, wait) {
    const q = this.seq;
    q.phase = phase;
    q.t = 0;
    q.wait = wait;
    const st = q.steps[q.i];
    if (phase === 'arrows') {
      this.nextRequested = false;
      if (this.showArrows && st.arrows.length) this.hooks.onArrows?.(st.arrows);
      this._emitStatus();
    }
    if (phase === 'exec') this.hooks.onArrows?.(null);
  }

  _runSeq(dt) {
    const q = this.seq;
    q.t += dt;
    const st = q.steps[q.i];
    switch (q.phase) {
      case 'pre':
        if (q.t >= q.wait) this._enter('arrows', q.fast ? 0 : this.showArrows ? 1.6 : 0.5);
        break;
      case 'arrows':
        if (this.stepMode && !q.fast ? this.nextRequested : q.t >= q.wait) {
          this.nextRequested = false;
          this._enter('exec', st.exec());
          this._emitStatus();
        }
        break;
      case 'exec':
        if (q.t >= q.wait) this._enter('pause', st.after ? st.after() : 0.7);
        break;
      case 'pause':
        if (q.t >= q.wait && !this.sim.moves.length) this._nextStep();
        break;
    }
  }

  _finish() {
    const q = this.seq;
    this.seq = null;
    this.busy.clear();
    this.status.stepDone = true;
    q.done?.();
    this.hooks.onArrows?.(null);
    this.hooks.onDone?.(q);
    this._emitStatus();
  }

  _emitStatus() {
    this.hooks.onStatus?.(this);
  }
}