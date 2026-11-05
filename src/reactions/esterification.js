// Säurekatalysierte Veresterung und deren Rückreaktion, die Esterhydrolyse.
//
// Die Regeln erkennen funktionelle Gruppen über den Bindungsgraphen – nicht über
// feste Atom-IDs. Dadurch funktionieren sie auch mit nachgelegten Edukten und
// für Hin- und Rückreaktion mit demselben Code:
//
//   Säure  + H⁺ → Carbenium-Ion + Ethanol → … → Ester  + Wasser + H⁺
//   Ester  + H⁺ → Carbenium-Ion + Wasser  → … → Säure  + Ethanol + H⁺

import { V, Q } from '../vec.js';
import { COLORS } from '../mechanism.js';
import { ReactionBase } from './base.js';

const TRIGGER = { protonation: 2.0, attack: 2.7, hint: 2.6, efProton: 2.6, efNu: 2.9 };

const REACTION = {
  acid: {
    name: 'Säurekatalysierte Veresterung',
    acyl: 'Ethansäure',
    nu: 'Ethanol',
    nuType: 'alcohol',
    leaving: 'Wasser',
    leavingGroup: 'OH-Gruppe',
    product: 'Ethansäureethylester (Ethylacetat) und Wasser',
  },
  ester: {
    name: 'Säurekatalysierte Esterhydrolyse',
    acyl: 'Ester',
    nu: 'Wasser',
    nuType: 'water',
    leaving: 'Ethanol',
    leavingGroup: 'Ethoxy-Gruppe (–O–C₂H₅)',
    product: 'Ethansäure und Ethanol',
  },
};

export class Esterification extends ReactionBase {
  static id = 'esterification';
  static title = 'Veresterung & Esterhydrolyse';
  static example = 'Ethansäure + Ethanol ⇌ Ethansäureethylester + Wasser (H⁺-Katalyse)';
  static lk = false;
  static levels = ['ef', 'q2'];
  static steps = ['Protonierung', 'Nukleophiler Angriff', 'Protonenwanderung', 'Abspaltung', 'Deprotonierung'];
  static scenarios = {
    esterification: {
      label: 'Veresterung',
      items: [
        ['aceticAcid', [-3.4, 0, 0], [0, 0.3, 0]],
        ['ethanol', [3.4, 0, 0], [0, -0.4, 0]],
        ['proton', [0, 1.6, 1.0]],
      ],
    },
    hydrolysis: {
      label: 'Hydrolyse',
      items: [
        ['ethylAcetate', [-3.0, 0, 0], [0, 0.3, 0]],
        ['water', [3.4, 0, 0.5]],
        ['proton', [0, 1.6, 1.0]],
      ],
    },
  };
  static extra = ['aceticAcid', 'ethanol'];
  static counters = [{ key: 'ester', label: 'Estersynthesen' }, { key: 'hydrolysis', label: 'Hydrolysen' }];

  check() { this._checkRules(); }
  checkEF() { this._checkRulesEF(); }

  // ---------- Erkennung funktioneller Gruppen ----------

  /**
   * Carbonyl-C einer Säure oder eines Esters. Protoniert liegt es als
   * Carbenium-Ion vor (C⁺ mit drei Einfachbindungen, O1 = protonierter
   * ehemaliger Carbonyl-Sauerstoff).
   */
  acyl(c) {
    const s = this.sim, A = s.atoms;
    if (A[c].el !== 'C') return null;
    const nb = s.nbrs(c);
    if (nb.length !== 3) return null;
    const Os = nb.filter((x) => A[x.j].el === 'O');
    const Rs = nb.filter((x) => A[x.j].el === 'C' && x.o === 1);
    if (Os.length !== 2 || Rs.length !== 1) return null;
    const R = Rs[0].j;
    const others = (o) => s.nbrs(o).filter((x) => x.j !== c);
    let O1, OX, protonated, Hp = null;
    const dbl = Os.find((x) => x.o === 2);
    if (dbl) {
      O1 = dbl.j;
      OX = Os.find((x) => x !== dbl)?.j;
      if (OX == null || Os.find((x) => x !== dbl).o !== 1 || others(O1).length) return null;
      protonated = false;
    } else {
      if (Os.some((x) => x.o !== 1)) return null;
      // Carbenium-Ion: O1 ist der Sauerstoff, der das Katalysator-Proton trägt
      const hOf = (o) => others(o).filter((x) => A[x.j].el === 'H').map((x) => x.j);
      const cand = Os.map((x) => x.j).filter((o) => others(o).length === 1 && hOf(o).length === 1);
      if (!cand.length) return null;
      O1 = cand.find((o) => A[hOf(o)[0]].tag.catalyst) ?? cand[0];
      OX = Os.map((x) => x.j).find((o) => o !== O1);
      Hp = hOf(O1)[0];
      protonated = true;
    }
    const oxN = others(OX);
    if (oxN.length !== 1) return null;
    const xEl = A[oxN[0].j].el;
    const type = xEl === 'H' ? 'acid' : xEl === 'C' ? 'ester' : null;
    if (!type) return null;
    return { c, O1, OX, R, type, protonated, Hp };
  }

  /** Nukleophil: Sauerstoff von Wasser oder einem Alkohol. */
  nucleophile(o) {
    const s = this.sim, A = s.atoms;
    if (A[o].el !== 'O') return null;
    const nb = s.nbrs(o);
    if (nb.length !== 2 || nb.some((x) => x.o !== 1)) return null;
    const els = nb.map((x) => A[x.j].el);
    if (els[0] === 'H' && els[1] === 'H') return { o, type: 'water', H: nb.map((x) => x.j) };
    const ci = els.indexOf('C'), hi = els.indexOf('H');
    if (ci >= 0 && hi >= 0) {
      const cN = s.nbrs(nb[ci].j);
      if (cN.length === 4 && cN.every((x) => x.o === 1)) return { o, type: 'alcohol', H: [nb[hi].j] };
    }
    return null;
  }

  freeProton(h) {
    const s = this.sim;
    return s.atoms[h].el === 'H' && s.nbrs(h).length === 0;
  }

  _checkRules() {
    const s = this.sim, A = s.atoms;
    s.ensureTopo();
    this.highlights.clear();

    const { acyls, protons, nucs } = this._scan();
    const P = (i) => A[i].p;
    const near = (d, t) => Math.max(0, Math.min(1, (2.5 * t - d) / (1.5 * t)));
    const hl = (id, color, strength) => {
      const cur = this.highlights.get(id);
      if (!cur || cur.strength < strength) this.highlights.set(id, { color, strength });
    };

    // 1) Protonierung des Carbonyl-O
    for (const a of acyls) {
      if (a.protonated) continue;
      for (const h of protons) {
        const d = V.dist(P(h), P(a.O1));
        if (d < TRIGGER.protonation) return this._startProtonation(a, h);
        hl(a.O1, COLORS.carbonylO, 0.45 + 0.55 * near(d, TRIGGER.protonation));
        hl(h, COLORS.proton, 0.5 + 0.5 * near(d, TRIGGER.protonation));
      }
    }
    for (const h of protons) hl(h, COLORS.proton, 0.5);

    // 2) Nukleophiler Angriff am aktivierten (protonierten) Carbonyl-C
    for (const a of acyls) {
      if (!a.protonated) continue;
      hl(a.c, COLORS.activatedC, 0.8);
      for (const n of nucs) {
        if (s.frag[n.o] === s.frag[a.c]) continue;
        const good = n.type === REACTION[a.type].nuType;
        const d = V.dist(P(n.o), P(a.c));
        if (good) hl(n.o, COLORS.nucleophile, 0.45 + 0.55 * near(d, TRIGGER.attack));
        if (d < TRIGGER.attack) {
          if (good) return this._startAttack(a, n);
          this._hint(
            a.type === 'acid'
              ? 'Wasser kann die protonierte Ethansäure zwar angreifen – dabei entsteht aber wieder nur Ethansäure. Für die Veresterung brauchst du Ethanol.'
              : 'Ethanol + protonierter Ester ergäbe wieder denselben Ester (Umesterung). Für die Hydrolyse brauchst du Wasser.',
          );
        }
      }
    }

    // 3) Hinweis: ohne Katalysator keine Reaktion
    for (const a of acyls) {
      if (a.protonated) continue;
      for (const n of nucs) {
        if (s.frag[n.o] === s.frag[a.c]) continue;
        if (V.dist(P(n.o), P(a.c)) < TRIGGER.hint) {
          this._hint(
            'Keine Reaktion: Ohne Katalysator ist das Carbonyl-C nur partiell positiv (δ+) und damit nicht elektrophil genug. Bringe zuerst das H⁺-Ion an den Carbonyl-Sauerstoff (δ−).',
          );
        }
      }
    }

    this._updateGuidance(acyls, protons);
  }

  // ---------- EF: vereinfachte Regel ----------

  _scan() {
    const A = this.sim.atoms;
    const acyls = [], protons = [], nucs = [];
    for (let i = 0; i < A.length; i++) {
      const el = A[i].el;
      if (el === 'C') { const a = this.acyl(i); if (a) acyls.push(a); }
      else if (el === 'H') { if (this.freeProton(i)) protons.push(i); }
      else if (el === 'O') { const n = this.nucleophile(i); if (n) nucs.push(n); }
    }
    return { acyls, protons, nucs };
  }

  /** EF: Säure (bzw. Ester), passendes Nukleophil und H⁺ müssen gleichzeitig beisammen sein. */
  _checkRulesEF() {
    const s = this.sim, A = s.atoms;
    s.ensureTopo();
    this.highlights.clear();
    const { acyls, protons, nucs } = this._scan();
    const P = (i) => A[i].p;
    const near = (d, t) => Math.max(0, Math.min(1, (2.5 * t - d) / (1.5 * t)));
    const hl = (id, color, strength) => {
      const cur = this.highlights.get(id);
      if (!cur || cur.strength < strength) this.highlights.set(id, { color, strength });
    };
    let best = null; // für die Anleitung: wie weit ist die Person schon?
    for (const a of acyls) {
      if (a.protonated) continue;
      const want = REACTION[a.type].nuType;
      const group = [a.c, a.O1, a.OX];
      let hBest = null, dH = Infinity;
      for (const h of protons) {
        const d = Math.min(V.dist(P(h), P(a.O1)), V.dist(P(h), P(a.OX)), V.dist(P(h), P(a.c)));
        if (d < dH) { dH = d; hBest = h; }
      }
      let nBest = null, dN = Infinity, wrong = null;
      for (const n of nucs) {
        if (s.frag[n.o] === s.frag[a.c]) continue;
        const d = V.dist(P(n.o), P(a.c));
        if (n.type !== want) { if (d < TRIGGER.efNu) wrong = n; continue; }
        if (d < dN) { dN = d; nBest = n; }
      }
      const okH = dH < TRIGGER.efProton, okN = dN < TRIGGER.efNu;
      if (okH && okN) return this._startEF(a, nBest, hBest);
      const nh = hBest != null ? near(dH, TRIGGER.efProton) : 0;
      const nn = nBest ? near(dN, TRIGGER.efNu) : 0;
      const gs = 0.4 + 0.6 * Math.max(nh, nn);
      for (const i of group) hl(i, COLORS.carbonylO, gs);
      for (const x of s.nbrs(a.OX)) if (A[x.j].el === 'H') hl(x.j, COLORS.carbonylO, gs);
      if (nBest) { hl(nBest.o, COLORS.nucleophile, 0.45 + 0.55 * nn); for (const x of nBest.H) hl(x, COLORS.nucleophile, 0.3 + 0.5 * nn); }
      if (hBest != null) hl(hBest, COLORS.proton, 0.5 + 0.5 * nh);
      if (okN && !okH) this._hint(`Keine Reaktion: Ohne den Katalysator H⁺ läuft die Reaktion (fast) nicht ab. Bringe zusätzlich das H⁺-Ion (blau) an die ${a.type === 'acid' ? 'Carboxygruppe' : 'Estergruppe'}.`);
      if (wrong && okH) this._hint(a.type === 'acid'
        ? 'Mit Wasser entsteht aus Ethansäure kein Ester. Für die Veresterung brauchst du Ethanol.'
        : 'Ethanol und Ester ergeben keinen neuen Stoff. Für die Hydrolyse brauchst du Wasser.');
      const score = (okH ? 1 : 0) + (okN ? 1 : 0);
      if (!best || score > best.score) best = { a, okH, okN, score };
    }
    for (const h of protons) hl(h, COLORS.proton, 0.5);

    let g;
    if (!protons.length) g = 'Kein freies H⁺ vorhanden.';
    else if (!best) g = 'Keine passenden Edukte – starte ein Szenario oder lege Edukte nach.';
    else {
      const acid = best.a.type === 'acid';
      const grp = acid ? 'die Carboxygruppe (gelb) der Ethansäure' : 'die Estergruppe (gelb)';
      const nu = acid ? 'die OH-Gruppe des Ethanols (grün)' : 'ein Wassermolekül (grün)';
      if (best.okH) g = `Gut, das H⁺ ist da. Bringe jetzt ${nu} an ${grp}.`;
      else if (best.okN) g = `Fehlt noch der Katalysator: Bringe das H⁺-Ion (blau) an ${grp}.`;
      else g = `Bringe alle drei Teilchen zusammen: das H⁺-Ion (blau) und ${nu} an ${grp}.`;
    }
    if (g !== this.guidance) {
      this.guidance = g;
      this._emitStatus();
    }
  }

  _startEF(a, n, h) {
    const s = this.sim, A = s.atoms;
    const acid = a.type === 'acid';
    const r = REACTION[a.type];
    // H des Nukleophils, das zur Abgangsgruppe wandert
    const Hn = n.H.slice().sort((x, y) => V.dist(A[x].p, A[a.OX].p) - V.dist(A[y].p, A[a.OX].p))[0];
    const nuFrag = [...s.fragmentOf(n.o)];
    const text = acid
      ? 'Ethansäure und Ethanol reagieren unter Abspaltung von Wasser zum Ester. Das Wasser bildet sich aus der OH-Gruppe der Säure und dem H-Atom der Hydroxygruppe des Alkohols. Das H⁺-Ion beschleunigt die Reaktion als Katalysator und liegt danach unverändert vor.'
      : 'Wasser spaltet den Ester: Die OH-Gruppe des Wassers bindet an das C-Atom, das H-Atom an den Ester-Sauerstoff – Ethansäure und Ethanol entstehen. Das H⁺-Ion wirkt als Katalysator und wird wieder frei.';
    const steps = [
      {
        index: 0,
        title: acid ? 'Veresterung: Wasser wird abgespalten' : 'Hydrolyse: der Ester wird gespalten',
        text,
        pre: () => {
          const t = this._alignNucleophile(a, n, nuFrag, 2.4);
          // H⁺ an den Carbonyl-Sauerstoff heranführen
          const dir = V.norm(V.sub(A[a.O1].p, A[a.c].p));
          const tgt = V.add(A[a.O1].p, V.mul(V.norm(V.add(dir, [0, 0.4, 0.3])), 1.6));
          s.addMove([h], { trans: V.sub(tgt, A[h].p) }, 0.9);
          return t;
        },
        arrows: [],
        exec: () => { s.setBond(a.O1, h, 1, 0.7); return 0.8; },
        after: () => {
          s.setBond(n.o, a.c, 1, 1.6);
          s.setBond(a.c, a.OX, 0, 1.6);
          s.setBond(n.o, Hn, 0, 1.6);
          s.setBond(a.OX, Hn, 1, 1.6);
          return 1.7;
        },
      },
      {
        index: 0,
        keep: true,
        title: acid ? 'Veresterung: Ester entsteht, H⁺ wird frei' : 'Hydrolyse: Säure und Ethanol entstehen, H⁺ wird frei',
        text,
        pre: () => {
          s.ensureTopo();
          const ids = [...s.fragmentOf(a.OX)];
          const d0 = V.norm(V.sub(A[a.OX].p, A[a.c].p));
          const dir = V.norm([d0[0] + Math.sign(d0[0] || 1) * 0.5, d0[1] * 0.4, d0[2] * 0.3]);
          s.addMove(ids, { trans: V.mul(dir, 2.6) }, 1.4);
          return 0.2;
        },
        arrows: [],
        exec: () => { s.setBond(a.O1, h, 0, 0.9); return 1.0; },
        after: () => {
          // H⁺ nach vorn (zur Person) – sichtbar, aber außerhalb der Reichweite
          // des Produkts, damit die Rückreaktion bewusst neu gestartet wird
          const c = A[a.c].p;
          const target = V.add(c, V.mul(V.norm([1.4, 1.8, 2.4]), 4.0));
          s.addMove([h], { trans: V.sub(target, A[h].p) }, 1.2);
          return 1.3;
        },
      },
    ];
    this._begin({
      kind: 'ef',
      reaction: r.name,
      type: a.type,
      steps,
      fast: true,
      busy: [...s.fragmentOf(a.c), ...nuFrag, h],
      done: () => this._done(a, n),
    });
  }

  _updateGuidance(acyls, protons) {
    let g;
    const prot = acyls.find((a) => a.protonated);
    if (prot) {
      g = `Das Carbonyl-C ist jetzt ein Carbenium-Ion (C⁺). Bringe den Sauerstoff ${prot.type === 'acid' ? 'des Ethanols' : 'eines Wassermoleküls'} (grün) an das positiv geladene C-Atom (orange) – am besten von oberhalb oder unterhalb der Molekülebene.`;
    } else if (protons.length && acyls.length) {
      const names = [...new Set(acyls.map((a) => (a.type === 'acid' ? 'der Ethansäure' : 'des Esters')))].join(' oder ');
      g = `Greife das H⁺-Ion (blau) und bringe es an den Carbonyl-Sauerstoff (gelb) ${names}.`;
    } else if (!protons.length) {
      g = 'Kein freies H⁺ vorhanden.';
    } else {
      g = 'Keine passenden Edukte – starte ein Szenario oder lege Edukte nach.';
    }
    if (g !== this.guidance) {
      this.guidance = g;
      this._emitStatus();
    }
  }


  _startProtonation(a, h) {
    const s = this.sim;
    const r = REACTION[a.type];
    const steps = [
      {
        index: 0,
        title: 'Protonierung des Carbonyl-Sauerstoffs',
        text: `Ein freies Elektronenpaar des Carbonyl-Sauerstoffs (δ−) ${a.type === 'acid' ? 'der Ethansäure' : 'des Esters'} bindet das H⁺-Ion (in Lösung eigentlich H₃O⁺, z. B. aus konz. Schwefelsäure). Die Elektronen der C=O-π-Bindung verschieben sich vollständig zum Sauerstoff: Es entsteht ein Carbenium-Ion. Das C-Atom hat nur noch drei Bindungen und trägt formal die positive Ladung (aus δ+ wird +) – es ist jetzt stark elektrophil. Die Ladung ist mesomeriestabilisiert (Grenzformel mit C=O⁺–H).`,
        arrows: [
          { from: { atom: a.O1 }, to: { atom: h } },
          { from: { bond: [a.c, a.O1] }, to: { atom: a.O1 } },
        ],
        exec: () => { s.setBond(a.O1, h, 1, 1.4); s.setBond(a.c, a.O1, 1, 1.4); return 1.5; },
      },
    ];
    this._begin({ kind: 'protonation', reaction: r.name, type: a.type, steps, busy: [...s.fragmentOf(a.c), h] });
  }

  _startAttack(a, n) {
    const s = this.sim, A = s.atoms;
    const r = REACTION[a.type];
    // Proton am Nukleophil, das dem späteren Abgangsgruppen-O am nächsten ist
    const Ht = n.H.slice().sort((x, y) => V.dist(A[x].p, A[a.OX].p) - V.dist(A[y].p, A[a.OX].p))[0];
    const nuFrag = [...s.fragmentOf(n.o)];

    const steps = [
      {
        index: 1,
        title: `Nukleophiler Angriff des ${r.nu === 'Ethanol' ? 'Ethanols' : 'Wassers'}`,
        text: `Ein freies Elektronenpaar des ${r.nu}-Sauerstoffs (δ−) greift das positiv geladene C-Atom des Carbenium-Ions an. Es entsteht ein tetraedrisches Zwischenprodukt – das C-Atom ist jetzt sp³-hybridisiert, der angreifende Sauerstoff hat drei Bindungen und trägt die positive Ladung (Oxonium-Ion).`,
        pre: () => this._alignNucleophile(a, n, nuFrag),
        arrows: [{ from: { atom: n.o }, to: { atom: a.c } }],
        exec: () => { s.setBond(n.o, a.c, 1, 1.8); return 2.0; },
      },
      {
        index: 2,
        title: 'Protonenwanderung',
        text: `Ein Proton wechselt vom positiv geladenen Sauerstoff auf die ${r.leavingGroup} – in Lösung geschieht das über Lösungsmittelmoleküle. Dadurch wird ${r.leaving} zu einer guten Abgangsgruppe.`,
        arrows: [
          { from: { atom: a.OX }, to: { atom: Ht } },
          { from: { bond: [n.o, Ht] }, to: { atom: n.o } },
        ],
        exec: () => { s.setBond(n.o, Ht, 0, 1.7); s.setBond(a.OX, Ht, 1, 1.7); return 1.9; },
      },
      {
        index: 3,
        title: `Abspaltung von ${r.leaving}`,
        text: `${r.leaving} wird als neutrales Molekül abgespalten – das bindende Elektronenpaar geht mit dem Sauerstoff. Zurück bleibt wieder ein Carbenium-Ion: Das C-Atom hat drei Bindungen, ist sp²-hybridisiert (planar) und positiv geladen.`,
        arrows: [{ from: { bond: [a.c, a.OX] }, to: { atom: a.OX } }],
        exec: () => { s.setBond(a.c, a.OX, 0, 1.6); return 1.7; },
        after: () => {
          s.ensureTopo();
          const ids = [...s.fragmentOf(a.OX)];
          // eher seitlich wegdriften, nicht auf die Person zu
          const d0 = V.norm(V.sub(A[a.OX].p, A[a.c].p));
          const dir = V.norm([d0[0] + Math.sign(d0[0] || 1) * 0.5, d0[1] * 0.4, d0[2] * 0.3]);
          s.addMove(ids, { trans: V.mul(dir, 2.6) }, 1.4);
          return 1.5;
        },
      },
      {
        index: 4,
        title: 'Deprotonierung – Katalysator wird frei',
        text: `Das H⁺-Ion wird an das Lösungsmittel abgegeben. Das bindende Elektronenpaar der O–H-Bindung bildet die C=O-Doppelbindung zurück, das C-Atom ist wieder neutral (δ+). Der Katalysator liegt danach unverändert vor. Produkte: ${r.product}.`,
        arrows: [{ from: { bond: [a.O1, a.Hp] }, to: { bond: [a.c, a.O1] } }],
        exec: () => { s.setBond(a.O1, a.Hp, 0, 1.3); s.setBond(a.c, a.O1, 2, 1.3); return 1.4; },
        after: () => {
          // H⁺ wandert sichtbar zur Seite (eher waagerecht, zur Person hin)
          const d0 = V.norm(V.sub(A[a.Hp].p, A[a.O1].p));
          const dir = V.norm([d0[0], d0[1] * 0.3, d0[2] + 0.8]);
          s.addMove([a.Hp], { trans: V.mul(dir, 2.4) }, 1.2);
          return 1.3;
        },
      },
    ];
    this._begin({
      kind: 'attack',
      reaction: r.name,
      type: a.type,
      steps,
      busy: [...s.fragmentOf(a.c), ...nuFrag],
      done: () => this._done(a, n),
    });
  }

  _done(a, n) {
    const A = this.sim.atoms;
    if (a.type === 'acid') this.counts.ester++;
    else this.counts.hydrolysis++;
    this.status.title = a.type === 'acid' ? 'Veresterung abgeschlossen' : 'Hydrolyse abgeschlossen';
    // Isotopen-Aussage passend zum tatsächlich markierten Atom
    const nuL = A[n.o].tag.o18, oxL = A[a.OX].tag.o18;
    let iso = '';
    if (a.type === 'acid') {
      if (nuL) iso = ' Mit der ¹⁸O-Markierung siehst du: Der Sauerstoff des Ethanols steckt jetzt im Ester – das Wasser stammt aus der OH-Gruppe der Säure.';
      else if (oxL) iso = ' Mit der ¹⁸O-Markierung siehst du: Der OH-Sauerstoff der Säure findet sich im Wasser wieder.';
    } else {
      if (nuL) iso = ' Mit der ¹⁸O-Markierung siehst du: Der Sauerstoff des Wassers steckt jetzt in der Säure.';
      else if (oxL) iso = ' Mit der ¹⁸O-Markierung siehst du: Der Ester-Sauerstoff verlässt das Molekül mit dem Ethanol.';
    }
    this.status.text =
      a.type === 'acid'
        ? `CH₃COOH + C₂H₅OH ⇌ CH₃COOC₂H₅ + H₂O.${iso} ${this.level === 'ef' ? 'Die Hydrolyse ist die Rückreaktion: Bringe Ester, Wasser und H⁺ zusammen.' : 'Die Hydrolyse ist die Rückreaktion über dieselben Zwischenstufen – bringe das H⁺ an den Ester und danach Wasser an das Carbonyl-C.'}`
        : `CH₃COOC₂H₅ + H₂O ⇌ CH₃COOH + C₂H₅OH.${iso} ${this.level === 'ef' ? 'Hin- und Rückreaktion laufen beide ab – zusammen bilden sie ein chemisches Gleichgewicht.' : 'Hin- und Rückreaktion durchlaufen dieselben Zwischenstufen – zusammen bilden sie ein chemisches Gleichgewicht.'}`;
    this.status.stepDone = true;
  }

  /** Nukleophil vor dem Angriff sanft in Angriffsposition bringen (über/unter der Carbonylebene). */
  _alignNucleophile(a, n, ids, dist = 2.55) {
    const A = this.sim.atoms;
    const c = A[a.c].p, o1 = A[a.O1].p, ox = A[a.OX].p;
    const nuP = A[n.o].p;
    let nrm = V.norm(V.cross(V.sub(o1, c), V.sub(ox, c)));
    if (V.dot(V.sub(nuP, c), nrm) < 0) nrm = V.mul(nrm, -1);
    // Bürgi-Dunitz-Winkel (~107°): leicht vom Carbonyl-O weggeneigt
    const tilt = 17 * Math.PI / 180;
    const dir = V.norm(V.sub(V.mul(nrm, Math.cos(tilt)), V.mul(V.norm(V.sub(o1, c)), Math.sin(tilt))));
    const target = V.add(c, V.mul(dir, dist));
    // Richtung des freien Elektronenpaars: weg von den Substituenten des Nukleophils
    const sub = this.sim.nbrs(n.o).map((x) => A[x.j].p);
    const lp = V.norm(V.sub(nuP, V.centroid(sub)));
    const rot = Q.fromUnitVectors(lp, V.mul(dir, -1));
    this.sim.addMove(ids, { pivot: [...nuP], rot, trans: V.sub(target, nuP) }, 1.0);
    return 1.05;
  }


  // ---------- Vorführung ----------
  *demo(d) {
    const { sim } = d;
    const A = sim.atoms;
    const acyls = () => A.map((_, i) => this.acyl(i)).filter(Boolean);
    const nucFor = (a) => {
      const want = a.type === 'acid' ? 'alcohol' : 'water';
      for (let i = 0; i < A.length; i++) {
        const n = this.nucleophile(i);
        if (n && n.type === want && sim.frag[n.o] !== sim.frag[a.c]) return n;
      }
      return null;
    };
    let a = acyls().find((x) => nucFor(x));
    if (!a) return;
    if (!a.protonated) {
      const h = A.findIndex((at) => this.freeProton(at.id));
      if (h < 0) return;
      const dir = V.norm(V.sub(A[a.O1].p, A[a.c].p));
      yield* d.bring(h, V.add(A[a.O1].p, V.mul(V.norm(V.add(dir, [0, 0, 0.6])), 1.9)), 1.8);
      yield* d.untilIdle();
      a = this.acyl(a.c);
      // EF: H⁺ liegt jetzt nur bereit, die Reaktion startet erst mit dem dritten Teilchen
      if (!a || (this.level !== 'ef' && !a.protonated)) return;
    }
    const n = nucFor(a);
    if (!n) return;
    const c = A[a.c].p;
    let nrm = V.norm(V.cross(V.sub(A[a.O1].p, c), V.sub(A[a.OX].p, c)));
    if (V.dot(V.sub(A[n.o].p, c), nrm) < 0) nrm = V.mul(nrm, -1);
    yield* d.bringLonePair(n.o, V.add(c, V.mul(nrm, 2.6)), V.mul(nrm, -1), 2.2);
    yield* d.untilIdle();
  }
}
