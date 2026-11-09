// Molekülvorlagen (grobe Startkoordinaten in Å – das Kraftfeld entspannt sie
// beim Erzeugen zur korrekten Geometrie) und Szenarien.
//
// tag.o18: Atom kann für die Isotopen-Markierung (¹⁸O) hervorgehoben werden.
// tag.catalyst: das katalytische Proton.

import { V, Q } from './vec.js';
import { optimizeNow } from './conformer.js';

/**
 * Drei Richtungen, die mit der Bindung zum Elternatom (entlang -u) einen
 * Tetraederwinkel bilden – für CH₃-Gruppen und tertiäre Zentren.
 */
function tetraFrom(u, phase = 0) {
  u = V.norm(u);
  const p = V.anyPerp(u), q = V.cross(u, p);
  return [0, 1, 2].map((k) => {
    const a = phase + (k * 2 * Math.PI) / 3;
    return V.add(V.mul(u, 0.334), V.mul(V.add(V.mul(p, Math.cos(a)), V.mul(q, Math.sin(a))), 0.943));
  });
}

/**
 * Baukasten für einfache Vorlagen: tert-Butyl-Gerüst (CH₃)₃C–X.
 * X liegt entlang +y; gibt { atoms, bonds, c } zurück (c = zentrales C).
 */
function tertButyl(xEl, xLen, xTag) {
  const atoms = [['C', [0, 0, 0]], [xEl, [0, xLen, 0], xTag]];
  const bonds = [[0, 1, 1]];
  for (const d of tetraFrom([0, -1, 0])) {
    const cm = V.mul(d, 1.53);
    const ci = atoms.push(['C', cm]) - 1;
    bonds.push([0, ci, 1]);
    for (const h of tetraFrom(d, 0.5)) {
      const hi = atoms.push(['H', V.add(cm, V.mul(h, 1.09))]) - 1;
      bonds.push([ci, hi, 1]);
    }
  }
  return { atoms, bonds };
}

function tBuOH() {
  const t = tertButyl('O', 1.43);
  const hi = t.atoms.push(['H', [0.9, 1.43 + 0.33, 0]]) - 1;
  t.bonds.push([1, hi, 1]);
  return t;
}

function isobutene() {
  // (CH₃)₂C=CH₂, planar in der xy-Ebene
  const atoms = [['C', [0, 0, 0]], ['C', [0, 1.34, 0]], ['H', [0.93, 1.88, 0]], ['H', [-0.93, 1.88, 0]]];
  const bonds = [[0, 1, 2], [1, 2, 1], [1, 3, 1]];
  for (const d of [[0.866, -0.5, 0], [-0.866, -0.5, 0]]) {
    const cm = V.mul(d, 1.5);
    const ci = atoms.push(['C', cm]) - 1;
    bonds.push([0, ci, 1]);
    for (const h of tetraFrom(d, 0.3)) bonds.push([ci, atoms.push(['H', V.add(cm, V.mul(h, 1.09))]) - 1, 1]);
  }
  return { atoms, bonds };
}

/** CH₃–Br, Br entlang +y */
function bromomethane() {
  const atoms = [['C', [0, 0, 0]], ['Br', [0, 1.94, 0]]];
  const bonds = [[0, 1, 1]];
  for (const d of tetraFrom([0, -1, 0])) bonds.push([0, atoms.push(['H', V.mul(d, 1.09)]) - 1, 1]);
  return { atoms, bonds };
}

/** 2-Brombutan CH₃–CHBr–CH₂–CH₃ (Br entlang +y); mirror = Spiegelbild */
function bromobutane(mirror = false) {
  const atoms = [['C', [0, 0, 0]], ['Br', [0, 1.94, 0]]];
  const bonds = [[0, 1, 1]];
  let [dH, dMe, dEt] = tetraFrom([0, -1, 0]);
  if (mirror) [dMe, dEt] = [dEt, dMe];
  bonds.push([0, atoms.push(['H', V.mul(dH, 1.09)]) - 1, 1]);
  const me = atoms.push(['C', V.mul(dMe, 1.53)]) - 1;
  bonds.push([0, me, 1]);
  for (const h of tetraFrom(dMe, 0.5)) bonds.push([me, atoms.push(['H', V.add(atoms[me][1], V.mul(h, 1.09))]) - 1, 1]);
  const c3p = V.mul(dEt, 1.53);
  const c3 = atoms.push(['C', c3p]) - 1;
  bonds.push([0, c3, 1]);
  const [t0, t1, t2] = tetraFrom(dEt, 0.5);
  const c4p = V.add(c3p, V.mul(t0, 1.53));
  const c4 = atoms.push(['C', c4p]) - 1;
  bonds.push([c3, c4, 1]);
  for (const t of [t1, t2]) bonds.push([c3, atoms.push(['H', V.add(c3p, V.mul(t, 1.09))]) - 1, 1]);
  for (const h of tetraFrom(t0, 0.5)) bonds.push([c4, atoms.push(['H', V.add(c4p, V.mul(h, 1.09))]) - 1, 1]);
  return { atoms, bonds };
}

export const TEMPLATES = {
  aceticAcid: {
    atoms: [
      ['C', [-1.3, -0.75, 0]], // 0 Methyl-C
      ['C', [0, 0, 0]], // 1 Carbonyl-C
      ['O', [0, 1.21, 0]], // 2 Carbonyl-O
      ['O', [1.16, -0.67, 0]], // 3 Hydroxy-O
      ['H', [1.95, -0.1, 0]], // 4
      ['H', [-2.3, -0.35, 0]],
      ['H', [-1.15, -1.4, 0.88]],
      ['H', [-1.15, -1.4, -0.88]],
    ],
    bonds: [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1], [0, 5, 1], [0, 6, 1], [0, 7, 1]],
  },
  ethanol: {
    atoms: [
      ['C', [0, 0, 0]], // 0 CH2
      ['C', [-1.25, -0.85, 0]], // 1 CH3
      ['O', [1.2, -0.75, 0], { o18: true }], // 2 Hydroxy-O (klassisch ¹⁸O-markiert)
      ['H', [1.95, -0.15, 0]],
      ['H', [0, 0.65, 0.88]],
      ['H', [0, 0.65, -0.88]],
      ['H', [-2.15, -0.25, 0]],
      ['H', [-1.25, -1.5, 0.88]],
      ['H', [-1.25, -1.5, -0.88]],
    ],
    bonds: [[0, 1, 1], [0, 2, 1], [2, 3, 1], [0, 4, 1], [0, 5, 1], [1, 6, 1], [1, 7, 1], [1, 8, 1]],
  },
  ethylAcetate: {
    atoms: [
      ['C', [-1.3, -0.75, 0]], // 0
      ['C', [0, 0, 0]], // 1 Carbonyl-C
      ['O', [0, 1.21, 0]], // 2 Carbonyl-O
      ['O', [1.16, -0.67, 0]], // 3 Ester-O
      ['C', [2.4, 0.05, 0]], // 4
      ['C', [3.55, -0.9, 0]], // 5
      ['H', [-2.3, -0.35, 0]],
      ['H', [-1.15, -1.4, 0.88]],
      ['H', [-1.15, -1.4, -0.88]],
      ['H', [2.45, 0.7, 0.88]],
      ['H', [2.45, 0.7, -0.88]],
      ['H', [4.5, -0.4, 0]],
      ['H', [3.5, -1.55, 0.88]],
      ['H', [3.5, -1.55, -0.88]],
    ],
    bonds: [
      [0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1], [4, 5, 1],
      [0, 6, 1], [0, 7, 1], [0, 8, 1], [4, 9, 1], [4, 10, 1], [5, 11, 1], [5, 12, 1], [5, 13, 1],
    ],
  },
  water: {
    atoms: [
      ['O', [0, 0, 0], { o18: true }],
      ['H', [0.76, 0.59, 0]],
      ['H', [-0.76, 0.59, 0]],
    ],
    bonds: [[0, 1, 1], [0, 2, 1]],
  },
  proton: {
    atoms: [['H', [0, 0, 0], { catalyst: true }]],
    bonds: [],
  },
  hydronium: {
    atoms: [
      ['O', [0, 0, 0]],
      ['H', [0.94, 0.33, 0], { catalyst: true }],
      ['H', [-0.47, 0.33, 0.82]],
      ['H', [-0.47, 0.33, -0.82]],
    ],
    bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]],
  },
  bromide: { atoms: [['Br', [0, 0, 0]]], bonds: [] },
  tBuBr: tertButyl('Br', 1.94),
  tBuOH: tBuOH(),
  isobutene: isobutene(),
  bromomethane: bromomethane(),
  bromobutane: bromobutane(false),
  bromobutaneMirror: bromobutane(true),
  hydroxide: { atoms: [['O', [0, 0, 0]], ['H', [0.97, 0, 0]]], bonds: [[0, 1, 1]] },
  ethene: {
    atoms: [
      ['C', [0, 0, 0]], ['C', [1.34, 0, 0]],
      ['H', [-0.55, 0.93, 0]], ['H', [-0.55, -0.93, 0]],
      ['H', [1.89, 0.93, 0]], ['H', [1.89, -0.93, 0]],
    ],
    bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1], [1, 4, 1], [1, 5, 1]],
  },
  bromine: { atoms: [['Br', [0, 0, 0]], ['Br', [2.28, 0, 0]]], bonds: [[0, 1, 1]] },
  benzene: (() => {
    const atoms = [], bonds = [];
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      atoms.push(['C', [1.4 * Math.cos(a), 1.4 * Math.sin(a), 0]]);
    }
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      atoms.push(['H', [2.48 * Math.cos(a), 2.48 * Math.sin(a), 0]]);
      bonds.push([k, (k + 1) % 6, 1.5], [k, 6 + k, 1]);
    }
    return { atoms, bonds };
  })(),
  ironBromide: {
    atoms: [['Fe', [0, 0, 0]], ['Br', [2.33, 0, 0]], ['Br', [-1.165, 2.018, 0]], ['Br', [-1.165, -2.018, 0]]],
    bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]],
  },
  methane: {
    atoms: [['C', [0, 0, 0]], ['H', [0.63, 0.63, 0.63]], ['H', [-0.63, -0.63, 0.63]], ['H', [-0.63, 0.63, -0.63]], ['H', [0.63, -0.63, -0.63]]],
    bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]],
  },
};

/** Vorlage in die Simulation einsetzen. Gibt die neuen Atom-IDs zurück. */
export function spawn(sim, name, offset = [0, 0, 0], rot = Q.identity()) {
  const tpl = TEMPLATES[name];
  const c = V.centroid(tpl.atoms.map((a) => a[1]));
  const ids = tpl.atoms.map(([el, p, tag]) =>
    sim.addAtom(el, V.add(offset, Q.rotate(rot, V.sub(p, c))), tag || {}),
  );
  for (const [a, b, o] of tpl.bonds) sim.setBond(ids[a], ids[b], o, 0);
  sim.relax(250);
  if (optimizeNow(sim, ids)) sim.relax(80); // günstigste Konformation
  return ids;
}

/** Szenario laden: items = [[vorlage, position, euler?], …] */
export function loadScenario(sim, items) {
  sim.reset();
  for (const [name, pos, euler] of items) {
    // Euler-Winkel [x, y, z] in rad, angewendet in der Reihenfolge z, x, y
    const [ex = 0, ey = 0, ez = 0] = euler || [];
    const rot = Q.mul(Q.fromAxisAngle([0, 1, 0], ey), Q.mul(Q.fromAxisAngle([1, 0, 0], ex), Q.fromAxisAngle([0, 0, 1], ez)));
    spawn(sim, name, pos, rot);
  }
}

/** Zusätzliche Edukte an zufälliger freier Position nachlegen. */
export function spawnReactants(sim, names) {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = () => [rnd(-5.5, 5.5), rnd(-1.8, 2.2), rnd(-2.5, 1.5)];
  const free = (p) => sim.atoms.every((a) => V.dist(a.p, p) > 3.2);
  const place = () => {
    for (let n = 0; n < 40; n++) {
      const p = pick();
      if (free(p)) return p;
    }
    return pick();
  };
  for (const n of names) spawn(sim, n, place(), Q.fromAxisAngle([0, 1, 0], rnd(0, 6.28)));
}

// Anzeigenamen nach Summenformel und Ladung
const NAMES = {
  'C2H4O2|0': ['Ethansäure', 'CH₃COOH'],
  'C2H6O|0': ['Ethanol', 'C₂H₅OH'],
  'C4H8O2|0': ['Ethansäureethylester', 'CH₃COOC₂H₅'],
  'H2O|0': ['Wasser', 'H₂O'],
  'H|1': ['H⁺', 'Katalysator'],
  'C2H5O2|1': ['protonierte Ethansäure', 'Carbenium-Ion'],
  'C4H9O2|1': ['protonierter Ester', 'Carbenium-Ion'],
  'C4H11O3|1': ['tetraedrische Zwischenstufe', 'sp³-C'],
  'H3O|1': ['Oxonium-Ion', 'H₃O⁺'],
  'Br|-1': ['Bromid-Ion', 'Br⁻'],
  'HBr|0': ['Bromwasserstoff', 'HBr'],
  'C4H9Br|0': ['2-Brom-2-methylpropan', '(CH₃)₃CBr'],
  'C4H9|1': ['tert-Butyl-Kation', 'Carbenium-Ion'],
  'C4H10O|0': ['2-Methylpropan-2-ol', '(CH₃)₃COH'],
  'C4H11O|1': ['protonierter Alkohol', 'Alkyloxonium-Ion'],
  'C4H8|0': ['2-Methylpropen', '(CH₃)₂C=CH₂'],
  'CH3Br|0': ['Brommethan', 'CH₃Br'],
  'C2H4|0': ['Ethen', 'CH₂=CH₂'],
  'CH4|0': ['Methan', 'CH₄'],
  'C6H6|0': ['Benzol', 'C₆H₆'],
  'Br3Fe|0': ['Eisen(III)-bromid', 'FeBr₃ (Katalysator)'],
  'Br5Fe|0': ['Br₂-FeBr₃-Komplex', 'Brδ+–Br⁺–FeBr₃⁻'],
  'Br4Fe|-1': ['Tetrabromidoferrat-Ion', 'FeBr₄⁻'],
  'C6H6Br|1': ['σ-Komplex', 'Arenium-Ion'],
  'C6H5Br|0': ['Brombenzol', 'C₆H₅Br'],
  'C2H6|0': ['Ethan', 'C₂H₆'],
  'Br2|0': ['Brom', 'Br₂'],
  'C2H4Br|1': ['Bromonium-Ion', 'cyclisch, Br⁺'],
  'C2H4Br2|0': ['1,2-Dibromethan', 'CH₂Br–CH₂Br'],
  'HO|-1': ['Hydroxid-Ion', 'OH⁻'],
  'CH4O|0': ['Methanol', 'CH₃OH'],
  'CH4BrO|-1': ['Übergangszustand', '[HO···CH₃···Br]⁻'],

};

/** extra: Namen der aktiven Reaktion (haben Vorrang, z. B. bei Isomeren) */
export function nameFor(formula, charge, extra = null) {
  const key = `${formula}|${charge}`;
  return extra?.[key] || NAMES[key] || [formula + (charge > 0 ? '⁺' : charge < 0 ? '⁻' : ''), ''];
}
