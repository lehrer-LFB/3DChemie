// Headless-Test des Chemie-Kerns: node test/run.mjs
// Spielt Veresterung und anschließende Hydrolyse durch, indem Moleküle
// programmatisch an die reaktiven Zentren geschoben werden.

import { Sim } from '../src/sim.js';
import { Mechanism } from '../src/mechanism.js';
import { loadScenario as loadItems } from '../src/molecules.js';
import { reactionById } from '../src/reactions/index.js';
import { V } from '../src/vec.js';

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};

const sim = new Sim();
const log = [];
const mech = new Mechanism(sim, {
  onStatus: (m) => { if (m.status.title && log.at(-1) !== m.status.title) log.push(m.status.title); },
  onHint: (t) => log.push('HINWEIS: ' + t),
});

const loadScenario = (sim, key) => {
  const def = key === 'sn1' ? reactionById('sn1') : key === 'e1' ? reactionById('e1')
    : key === 'methyl' || key === 'chiral' ? reactionById('sn2')
    : key === 'ethene' ? reactionById('addition')
    : key === 'methane' ? reactionById('radical')
    : key === 'benzene' ? reactionById('sear') : reactionById('esterification');
  if (mech.def !== def) mech.setReaction(def);
  loadItems(sim, def.scenarios[key].items);
};
mech.setReaction(reactionById('esterification'));
const DT = 1 / 72;
const run = (sec) => { for (let t = 0; t < sec; t += DT) { mech.update(DT); sim.step(DT); } };
const runUntilIdle = (max = 30) => {
  let t = 0;
  while (t < max) { mech.update(DT); sim.step(DT); t += DT; if (!mech.seq && t > 0.2) break; }
  run(0.5);
  return t;
};
const fragFormulas = () => sim.fragments.map((f) => `${sim.formula(f)}${sim.fragmentCharge(f) > 0 ? '+' : ''}`).sort();

/** Fragment von Atom `i` starr verschieben, sodass i bei `target` liegt */
const moveFrag = (i, target) => {
  const d = V.sub(target, sim.atoms[i].p);
  for (const k of sim.fragmentOf(i)) sim.atoms[k].p = V.add(sim.atoms[k].p, d);
};

const angle = (a, c, b) => {
  const u = V.norm(V.sub(sim.atoms[a].p, sim.atoms[c].p));
  const v = V.norm(V.sub(sim.atoms[b].p, sim.atoms[c].p));
  return (Math.acos(V.dot(u, v)) * 180) / Math.PI;
};

const findAcyl = () => {
  for (let i = 0; i < sim.atoms.length; i++) { const a = mech.rx.acyl(i); if (a) return a; }
  return null;
};
const findNuc = (type) => {
  for (let i = 0; i < sim.atoms.length; i++) { const n = mech.rx.nucleophile(i); if (n && n.type === type) return n; }
  return null;
};
const proton = () => sim.atoms.findIndex((a) => a.el === 'H' && mech.rx.freeProton(a.id));

function geometryReport(label) {
  const a = findAcyl();
  const ang = [angle(a.O1, a.c, a.OX), angle(a.O1, a.c, a.R), angle(a.OX, a.c, a.R)];
  const sum = ang.reduce((x, y) => x + y, 0);
  console.log(`  ${label}: Winkel am Carbonyl-C ${ang.map((x) => x.toFixed(1)).join(' / ')}°, Summe ${sum.toFixed(1)}°`);
  check(Math.abs(sum - 360) < 2, `${label}: Carbonyl-C planar (sp²)`);
  const dCO = V.dist(sim.atoms[a.c].p, sim.atoms[a.O1].p);
  check(Math.abs(dCO - 1.22) < 0.05, `${label}: C=O-Länge ${dCO.toFixed(3)} Å`);
}

// ---------------- Veresterung ----------------
console.log('\n== Veresterung ==');
loadScenario(sim, 'esterification');
run(0.5);
check(JSON.stringify(fragFormulas()) === JSON.stringify(['C2H4O2', 'C2H6O', 'H+']), `Start: ${fragFormulas().join(', ')}`);
geometryReport('Ethansäure');

// Ethanol ohne Katalysator an das C → nur Hinweis
let acid = findAcyl();
let etoh = findNuc('alcohol');
moveFrag(etoh.o, V.add(sim.atoms[acid.c].p, [0, 0, 2.3]));
run(0.3);
check(!mech.seq && !findAcyl().protonated, 'Ohne H⁺ keine Reaktion');
check(log.some((l) => l.startsWith('HINWEIS: Keine Reaktion')), 'Hinweis "ohne Katalysator" erscheint');
moveFrag(etoh.o, V.add(sim.atoms[acid.c].p, [0, 0, 6]));
run(0.3);

// Protonierung
let h = proton();
moveFrag(h, V.add(sim.atoms[acid.O1].p, [0, 1.8, 0]));
run(0.1);
check(mech.seq?.kind === 'protonation', 'Protonierung startet');
runUntilIdle();
acid = findAcyl();
check(acid?.protonated, 'Carbonyl-O ist protoniert');
check(sim.formalCharge(acid.c) === 1 && sim.formalCharge(acid.O1) === 0, 'Carbenium-Ion: C trägt die positive Formalladung, O ist neutral');
check(sim.order(acid.c, acid.O1) === 1, 'C–O nach Protonierung nur noch Einfachbindung');
{
  const ang = [angle(acid.O1, acid.c, acid.OX), angle(acid.O1, acid.c, acid.R), angle(acid.OX, acid.c, acid.R)];
  const sum = ang.reduce((x, y) => x + y, 0);
  check(Math.abs(sum - 360) < 3, `Carbenium-C planar (Winkelsumme ${sum.toFixed(1)}°)`);
}

// Angriff des Ethanols
etoh = findNuc('alcohol');
const etohO = etoh.o;
moveFrag(etoh.o, V.add(sim.atoms[acid.c].p, [0.3, 0.2, 2.5]));
run(0.05);
check(mech.seq?.kind === 'attack', 'Nukleophiler Angriff startet');
// Zwischenprodukt prüfen (nach Schritt 2)
let sawTetra = false;
for (let t = 0; t < 30 && mech.seq; t += DT) {
  mech.update(DT); sim.step(DT);
  if (!sawTetra && mech.seq && mech.seq.i === 1 && mech.seq.phase === 'arrows') {
    sawTetra = true;
    const nb = sim.nbrs(acid.c).map((x) => x.j);
    const angs = [];
    for (let x = 0; x < 4; x++) for (let y = x + 1; y < 4; y++) angs.push(angle(nb[x], acid.c, nb[y]));
    const avg = angs.reduce((p, q) => p + q, 0) / angs.length;
    console.log(`  Tetraedrisches Zwischenprodukt: ${nb.length} Nachbarn, mittlerer Winkel ${avg.toFixed(1)}°, Fragmente ${fragFormulas().join(', ')}`);
    check(nb.length === 4 && Math.abs(avg - 109.5) < 2, 'Zwischenprodukt ist tetraedrisch');
  }
}
run(0.5);
check(JSON.stringify(fragFormulas()) === JSON.stringify(['C4H8O2', 'H+', 'H2O']), `Produkte: ${fragFormulas().join(', ')}`);
check(mech.counts.ester === 1, 'Zähler Veresterung = 1');
geometryReport('Ester');
const ester = findAcyl();
check(ester.type === 'ester' && ester.OX === etohO, 'Ethanol-Sauerstoff (¹⁸O) steckt im Ester');
const water = findNuc('water');
check(water && sim.atoms[water.o].tag.o18 !== true, 'Wasser-O stammt aus der Säure (nicht markiert)');
check(sim.atoms[proton()].tag.catalyst === true, 'Freigesetztes H⁺ ist das Katalysator-Proton');

// ---------------- Hydrolyse (Rückreaktion mit dem entstandenen Wasser) ----------------
console.log('\n== Hydrolyse ==');
h = proton();
moveFrag(h, V.add(sim.atoms[ester.O1].p, V.mul(V.norm(V.sub(sim.atoms[ester.O1].p, sim.atoms[ester.c].p)), 1.8)));
run(0.05);
check(mech.seq?.kind === 'protonation', 'Protonierung des Esters startet');
runUntilIdle();
check(findAcyl().protonated, 'Ester ist protoniert');
check(sim.formalCharge(findAcyl().c) === 1, 'Ester-Carbenium-Ion: C positiv');
const w = findNuc('water');
moveFrag(w.o, V.add(sim.atoms[ester.c].p, [0, 0, -2.5]));
run(0.05);
check(mech.seq?.kind === 'attack', 'Angriff des Wassers startet');
runUntilIdle();
check(JSON.stringify(fragFormulas()) === JSON.stringify(['C2H4O2', 'C2H6O', 'H+']), `Produkte: ${fragFormulas().join(', ')}`);
check(mech.counts.hydrolysis === 1, 'Zähler Hydrolyse = 1');
geometryReport('Ethansäure nach Hydrolyse');
const etoh2 = findNuc('alcohol');
check(etoh2.o === etohO, 'Ethanol enthält wieder seinen ursprünglichen Sauerstoff');

// ---------------- Szenario Hydrolyse direkt ----------------
console.log('\n== Szenario Hydrolyse ==');
loadScenario(sim, 'hydrolysis');
mech.reset();
run(0.3);
check(JSON.stringify(fragFormulas()) === JSON.stringify(['C4H8O2', 'H+', 'H2O']), `Start: ${fragFormulas().join(', ')}`);
geometryReport('Ester (Vorlage)');

// ---------------- EF: vereinfachter Ablauf ----------------
console.log('\n== EF: Veresterung (vereinfacht) ==');
mech.level = 'ef';
loadScenario(sim, 'esterification');
mech.reset();
mech.counts = { ester: 0, hydrolysis: 0 };
run(0.3);
acid = findAcyl();
etoh = findNuc('alcohol');
const efO = etoh.o;
// nur H⁺ an die Säure: keine Reaktion
h = proton();
moveFrag(h, V.add(sim.atoms[acid.O1].p, [0, 1.8, 0]));
run(0.3);
check(!mech.seq && !findAcyl().protonated, 'EF: H⁺ allein löst nichts aus (keine Protonierung)');
// nur Ethanol ohne H⁺: Hinweis
moveFrag(h, V.add(sim.atoms[acid.c].p, [0, 6, 0]));
run(0.2);
moveFrag(etoh.o, V.add(sim.atoms[acid.c].p, [0, 0, 2.5]));
mech.hintCooldown = 0;
run(0.2);
check(!mech.seq && log.at(-1).includes('Ohne den Katalysator'), 'EF: Ethanol ohne H⁺ → Hinweis');
// alle drei zusammen
moveFrag(h, V.add(sim.atoms[acid.O1].p, [0, 1.8, 0]));
run(0.05);
check(mech.seq?.kind === 'ef', 'EF: alle drei zusammen → Reaktion startet');
const tEF = runUntilIdle();
console.log(`  Dauer der EF-Animation: ${tEF.toFixed(1)} s`);
check(JSON.stringify(fragFormulas()) === JSON.stringify(['C4H8O2', 'H+', 'H2O']), `EF-Produkte: ${fragFormulas().join(', ')}`);
geometryReport('EF-Ester');
check(findAcyl().OX === efO, 'EF: Ethanol-Sauerstoff steckt im Ester');
check(sim.atoms[proton()].tag.catalyst === true, 'EF: Katalysator-H⁺ wird wieder frei');
check(mech.counts.ester === 1, 'EF: Zähler Veresterung = 1');

console.log('\n== EF: Hydrolyse (vereinfacht) ==');
const est = findAcyl();
const wEF = findNuc('water');
h = proton();
moveFrag(h, V.add(sim.atoms[est.O1].p, V.mul(V.norm(V.sub(sim.atoms[est.O1].p, sim.atoms[est.c].p)), 1.8)));
moveFrag(wEF.o, V.add(sim.atoms[est.c].p, [0, 0, -2.5]));
run(0.05);
check(mech.seq?.kind === 'ef', 'EF-Hydrolyse startet');
runUntilIdle();
check(JSON.stringify(fragFormulas()) === JSON.stringify(['C2H4O2', 'C2H6O', 'H+']), `EF-Hydrolyse-Produkte: ${fragFormulas().join(', ')}`);
geometryReport('EF-Säure nach Hydrolyse');

// ---------------- SN1 ----------------
console.log('\n== SN1 ==');
mech.level = 'q2';
loadScenario(sim, 'sn1');
mech.reset();
run(0.5);
check(JSON.stringify(fragFormulas()) === JSON.stringify(['C4H9Br', 'H2O', 'H2O', 'H2O']), `Start: ${fragFormulas().join(', ')}`);
const R = () => mech.rx;
const findIdx = (fn) => { for (let i = 0; i < sim.atoms.length; i++) { const x = fn(i); if (x) return x; } return null; };
let hal = findIdx((i) => R().tertHalide(i));
{
  const nb = sim.nbrs(hal.c).map((x) => x.j);
  const angs = [];
  for (let x = 0; x < 4; x++) for (let y = x + 1; y < 4; y++) angs.push(angle(nb[x], hal.c, nb[y]));
  const avg = angs.reduce((p, q) => p + q, 0) / angs.length;
  check(Math.abs(avg - 109.5) < 2, `Halogenalkan tetraedrisch (Mittel ${avg.toFixed(1)}°)`);
  const dCBr = V.dist(sim.atoms[hal.c].p, sim.atoms[hal.br].p);
  check(Math.abs(dCBr - 1.94) < 0.06, `C–Br ${dCBr.toFixed(2)} Å`);
}
// Wasser an das C (statt an Br) → nur Hinweis
let ws = R().waters();
moveFrag(ws[0].o, V.add(sim.atoms[hal.c].p, [0, -0.3, 2.4]));
mech.hintCooldown = 0;
run(0.2);
check(!mech.seq && log.at(-1).includes('Heterolyse'), 'SN1: Wasser direkt an C → Hinweis auf Heterolyse');
moveFrag(ws[0].o, V.add(sim.atoms[hal.c].p, [0, -3, 5]));
run(0.2);
// Wasser an das Br → Heterolyse
const brDir = V.norm(V.sub(sim.atoms[hal.br].p, sim.atoms[hal.c].p));
moveFrag(ws[0].o, V.add(sim.atoms[hal.br].p, V.mul(brDir, 2.3)));
run(0.05);
check(mech.seq?.kind === 'sn1-heterolysis', 'SN1: Heterolyse startet');
runUntilIdle();
let cat = R().carbenia()[0];
check(!!cat, 'Carbenium-Ion entstanden');
check(sim.formalCharge(cat.c) === 1, 'C⁺ trägt die Formalladung');
check(fragFormulas().includes('Br-') || sim.fragments.some((f) => sim.formula(f) === 'Br' && sim.fragmentCharge(f) === -1), 'Bromid-Ion entstanden');
{
  const [a, b, c] = cat.subs;
  const sum = angle(a, cat.c, b) + angle(b, cat.c, c) + angle(a, cat.c, c);
  check(Math.abs(sum - 360) < 3, `Carbenium-Ion planar (Winkelsumme ${sum.toFixed(1)}°)`);
}
// Angriff von Wasser am C⁺
ws = R().waters().sort((p, q) => V.dist(sim.atoms[p.o].p, sim.atoms[cat.c].p) - V.dist(sim.atoms[q.o].p, sim.atoms[cat.c].p));
let nrm = R().planeNormal(cat, V.add(sim.atoms[cat.c].p, [0, 0, 1]));
// schrittweise heranführen (wie mit der Hand), vorbei an den Methyl-H-Atomen
for (let d = 6; d >= 2.5 && !mech.seq; d -= 0.05) {
  const side = V.mul(V.norm(V.cross(nrm, [0, 1, 0])), (d - 2.5) * 0.4);
  moveFrag(ws[0].o, V.add(V.add(sim.atoms[cat.c].p, V.mul(nrm, d)), side));
  mech.update(DT); sim.step(DT);
}
run(0.05);
check(mech.seq?.kind === 'sn1-attack', `SN1: Heranführen an C⁺ → Angriff (nicht E1): ${mech.seq?.kind}`);
runUntilIdle();
const ff = (f) => `${sim.formula(f)}${sim.fragmentCharge(f) > 0 ? '+' : sim.fragmentCharge(f) < 0 ? '-' : ''}`;
const forms = sim.fragments.map(ff).sort();
check(forms.includes('C4H10O') && forms.includes('H3O+') && forms.includes('Br-'), `SN1-Produkte: ${forms.join(', ')}`);
check(mech.counts.sn1 === 1, 'Zähler SN1 = 1');

// Konkurrenz: zweites Halogenalkan, diesmal Eliminierung über β-H
console.log('\n== SN1-Szenario, Konkurrenz E1 ==');
loadScenario(sim, 'sn1');
mech.reset();
run(0.3);
hal = findIdx((i) => R().tertHalide(i));
ws = R().waters();
moveFrag(ws[0].o, V.add(sim.atoms[hal.br].p, V.mul(V.norm(V.sub(sim.atoms[hal.br].p, sim.atoms[hal.c].p)), 2.3)));
run(0.05);
runUntilIdle();
cat = R().carbenia()[0];
let b = cat.beta[0];
ws = R().waters().sort((p, q) => V.dist(sim.atoms[p.o].p, sim.atoms[b.h].p) - V.dist(sim.atoms[q.o].p, sim.atoms[b.h].p));
moveFrag(ws[0].o, V.add(sim.atoms[b.h].p, V.mul(V.norm(V.sub(sim.atoms[b.h].p, sim.atoms[b.cb].p)), 1.6)));
run(0.05);
check(mech.seq?.kind === 'e1-deprotonation', 'Wasser an β-H → Eliminierung startet');
runUntilIdle();
let forms2 = sim.fragments.map(ff).sort();
check(forms2.includes('C4H8') && forms2.includes('H3O+'), `E1-Produkte: ${forms2.join(', ')}`);
const alkeneC = findIdx((i) => sim.atoms[i].el === 'C' && sim.nbrs(i).some((x) => x.o === 2) ? i + 1 : null) - 1;
check(sim.nbrs(alkeneC).some((x) => x.o === 2 && sim.atoms[x.j].el === 'C'), 'C=C-Doppelbindung entstanden');
{
  const c2 = sim.nbrs(alkeneC).find((x) => x.o === 2).j;
  const d = V.dist(sim.atoms[alkeneC].p, sim.atoms[c2].p);
  check(Math.abs(d - 1.34) < 0.05, `C=C-Länge ${d.toFixed(3)} Å`);
}

// ---------------- E1 (säurekatalysierte Dehydratisierung) ----------------
console.log('\n== E1 ==');
loadScenario(sim, 'e1');
mech.reset();
mech.counts.e1 = 0;
run(0.5);
check(JSON.stringify(fragFormulas()) === JSON.stringify(['C4H10O', 'H2O', 'H2O', 'H3O+']), `Start: ${fragFormulas().join(', ')}`);
let alc = findIdx((i) => R().tertAlcohol(i));
// Wasser ohne Säure → Hinweis
ws = R().waters();
moveFrag(ws[0].o, V.add(sim.atoms[alc.c].p, [0, -0.3, 2.4]));
mech.hintCooldown = 0;
run(0.2);
check(!mech.seq && log.at(-1).includes('Ohne Säure'), 'E1: ohne H⁺ → Hinweis'); if (!log.at(-1).includes('Ohne Säure')) console.log('   log:', log.at(-1).slice(0, 90), mech.seq?.kind);
moveFrag(ws[0].o, V.add(sim.atoms[alc.c].p, [0, -3, 5]));
run(0.2);
const don = R().donors()[0];
const lp = V.norm(V.sub(sim.atoms[alc.o].p, V.centroid(sim.nbrs(alc.o).map((x) => sim.atoms[x.j].p))));
moveFrag(don.h, V.add(sim.atoms[alc.o].p, V.mul(lp, 1.8)));
run(0.05);
check(mech.seq?.kind === 'e1-protonation', 'E1: Protonierung startet');
runUntilIdle();
cat = R().carbenia()[0];
check(!!cat && sim.formalCharge(cat.c) === 1, 'E1: Carbenium-Ion nach Wasserabspaltung');
// Wasser an C⁺ → nur Hinweis
ws = R().waters().sort((p, q) => V.dist(sim.atoms[p.o].p, sim.atoms[cat.c].p) - V.dist(sim.atoms[q.o].p, sim.atoms[cat.c].p));
nrm = R().planeNormal(cat, V.add(sim.atoms[cat.c].p, [0, 0, 1]));
const wSave = [...sim.atoms[ws[0].o].p];
moveFrag(ws[0].o, V.add(sim.atoms[cat.c].p, V.mul(nrm, 2.5)));
mech.hintCooldown = 0;
run(0.1);
check(!mech.seq && log.at(-1).includes('Rückreaktion'), 'E1: Wasser an C⁺ → Hinweis (keine Substitution)');
moveFrag(ws[0].o, wSave);
run(0.1);
b = cat.beta[0];
ws = R().waters().sort((p, q) => V.dist(sim.atoms[p.o].p, sim.atoms[b.h].p) - V.dist(sim.atoms[q.o].p, sim.atoms[b.h].p));
moveFrag(ws[0].o, V.add(sim.atoms[b.h].p, V.mul(V.norm(V.sub(sim.atoms[b.h].p, sim.atoms[b.cb].p)), 1.6)));
run(0.05);
check(mech.seq?.kind === 'e1-deprotonation', 'E1: Deprotonierung am β-C startet');
runUntilIdle();
forms2 = sim.fragments.map(ff).sort();
check(forms2.includes('C4H8') && forms2.filter((f) => f === 'H3O+').length === 1, `E1-Produkte: ${forms2.join(', ')}`);
check(mech.counts.e1 === 1, 'Zähler E1 = 1');

// ---------------- SN2 ----------------
const tetraAvg = (c) => {
  const nb = sim.nbrs(c).map((x) => x.j);
  const angs = [];
  for (let x = 0; x < nb.length; x++) for (let y = x + 1; y < nb.length; y++) angs.push(angle(nb[x], c, nb[y]));
  return angs.reduce((p, q) => p + q, 0) / angs.length;
};
/** Vorzeichen der „Regenschirm“-Richtung: liegen die drei H/Substituenten auf der Seite von atom? */
const umbrellaSide = (c, ref, eq) => {
  const cen = V.centroid(eq.map((i) => sim.atoms[i].p));
  return Math.sign(V.dot(V.sub(cen, sim.atoms[c].p), V.sub(sim.atoms[ref].p, sim.atoms[c].p)));
};
for (const scen of ['methyl', 'chiral']) {
  console.log(`\n== SN2 (${scen}) ==`);
  loadScenario(sim, scen);
  mech.reset();
  run(0.5);
  const sub = findIdx((i) => R().substrate(i));
  const nu = findIdx((i) => R().hydroxide(i));
  check(!!sub && !!nu && sim.formalCharge(nu.o) === -1, `Start: ${sim.fragments.map(ff).sort().join(', ')}`);
  check(Math.abs(tetraAvg(sub.c) - 109.5) < 2, `Substrat tetraedrisch (${tetraAvg(sub.c).toFixed(1)}°)`);
  const before = R().cip(sub.c);
  if (scen === 'chiral') check(before === 'R', `Stereozentrum erkannt: (${before})`);
  else check(before === null, 'Brommethan hat kein Stereozentrum');
  const eq = sim.nbrs(sub.c).map((x) => x.j).filter((j) => j !== sub.br);
  const side0 = umbrellaSide(sub.c, sub.br, eq);
  const axis = V.norm(V.sub(sim.atoms[sub.c].p, sim.atoms[sub.br].p));
  // Angriff von vorne → Hinweis
  const perp = V.norm(V.cross(axis, [0, 1, 0.3]));
  moveFrag(nu.o, V.add(sim.atoms[sub.c].p, V.mul(V.norm(V.add(V.mul(axis, -0.6), perp)), 2.5)));
  mech.hintCooldown = 0;
  run(0.1);
  check(!mech.seq && /vorne|Fast/.test(log.at(-1)), 'Angriff nicht von der Rückseite → Hinweis');
  moveFrag(nu.o, V.add(sim.atoms[sub.c].p, V.mul(perp, 6)));
  run(0.1);
  // Rückseitenangriff
  moveFrag(nu.o, V.add(sim.atoms[sub.c].p, V.mul(axis, 2.6)));
  run(0.05);
  check(mech.seq?.kind === 'sn2', 'Rückseitenangriff startet SN2');
  let sawTS = false;
  for (let t = 0; t < 30 && mech.seq; t += DT) {
    mech.update(DT); sim.step(DT);
    if (!sawTS && mech.seq?.i === 1 && mech.seq.phase === 'arrows') {
      sawTS = true;
      const a = angle(nu.o, sub.c, sub.br);
      const eqAngs = eq.map((j) => angle(nu.o, sub.c, j));
      const avgAx = eqAngs.reduce((p, q) => p + q, 0) / 3;
      console.log(`  Übergangszustand: O–C–Br ${a.toFixed(1)}°, O–C–(H/R) Mittel ${avgAx.toFixed(1)}°, Fragmente ${sim.fragments.map(ff).sort().join(', ')}`);
      check(a > 170 && Math.abs(avgAx - 90) < 6, 'Übergangszustand trigonal-bipyramidal');
    }
  }
  run(0.5);
  const forms = sim.fragments.map(ff).sort();
  check(forms.includes('Br-') && forms.includes(scen === 'chiral' ? 'C4H10O' : 'CH4O'), `Produkte: ${forms.join(', ')}`);
  check(Math.abs(tetraAvg(sub.c) - 109.5) < 2, `Produkt tetraedrisch (${tetraAvg(sub.c).toFixed(1)}°)`);
  const side1 = umbrellaSide(sub.c, nu.o, eq);
  check(side0 === -1 && side1 === -1, 'Walden-Umkehr: Substituenten sind auf die andere Seite geklappt');
  if (scen === 'chiral') check(R().cip(sub.c) && R().cip(sub.c) !== before, `Konfiguration: (${before}) → (${R().cip(sub.c)})`);
}

// ---------------- Elektrophile Addition ----------------
console.log('\n== Elektrophile Addition ==');
loadScenario(sim, 'ethene');
mech.reset();
run(0.5);
check(JSON.stringify(sim.fragments.map(ff).sort()) === JSON.stringify(['Br2', 'C2H4']), `Start: ${sim.fragments.map(ff).sort().join(', ')}`);
let al = R().scan().alkenes[0];
const b2 = R().scan().br2[0];
{
  const nb = sim.nbrs(al.c1).map((x) => x.j);
  const sum = angle(nb[0], al.c1, nb[1]) + angle(nb[1], al.c1, nb[2]) + angle(nb[0], al.c1, nb[2]);
  check(Math.abs(sum - 360) < 2, `Ethen planar (Winkelsumme ${sum.toFixed(1)}°)`);
}
const midE = V.lerp(sim.atoms[al.c1].p, sim.atoms[al.c2].p, 0.5);
const nrmE = R().planeNormal(al, V.add(midE, [0, 0, 1]));
moveFrag(b2.a, V.add(midE, V.mul(nrmE, 3.4)));
run(0.05);
check(mech.partialOverride.get(b2.a) === 1 && mech.partialOverride.get(b2.b) === -1, 'Br₂ wird bei Annäherung polarisiert (δ+ nah, δ− fern)');
moveFrag(b2.a, V.add(midE, V.mul(nrmE, 2.6)));
run(0.05);
check(mech.seq?.kind === 'bromonium', 'Br₂ an C=C → Bromonium-Bildung startet');
runUntilIdle();
const ion = R().scan().ions[0];
check(!!ion && sim.formalCharge(ion.br) === 1, 'Bromonium-Ion: Br trägt +1');
check(sim.fragments.map(ff).sort().join() === 'Br-,C2H4Br+', `Fragmente: ${sim.fragments.map(ff).sort().join(', ')}`);
{
  const aBr = angle(ion.c1, ion.br, ion.c2);
  const aC = angle(ion.c2, ion.c1, ion.br);
  console.log(`  Dreiring: C–Br–C ${aBr.toFixed(1)}°, C–C–Br ${aC.toFixed(1)}°, C–C ${V.dist(sim.atoms[ion.c1].p, sim.atoms[ion.c2].p).toFixed(2)} Å`);
  check(aBr < 50 && aC > 60 && aC < 75, 'Dreiring-Geometrie plausibel');
}
const brm = R().scan().bromides[0];
const cA = ion.c1;
const backA = V.norm(V.sub(sim.atoms[cA].p, sim.atoms[ion.br].p));
// syn-Angriff (von der Br⁺-Seite) → Hinweis
const synDir = V.norm(V.sub(sim.atoms[ion.br].p, sim.atoms[cA].p));
moveFrag(brm, V.add(sim.atoms[cA].p, V.mul(V.norm(V.add(synDir, V.mul(backA, -0.2))), 2.6)));
mech.hintCooldown = 0;
run(0.1);
check(!mech.seq && log.at(-1).includes('Gegenseite'), 'Br⁻ von der Br⁺-Seite → Hinweis (anti nötig)');
moveFrag(brm, V.add(sim.atoms[cA].p, V.mul(backA, 6)));
run(0.1);
moveFrag(brm, V.add(sim.atoms[cA].p, V.mul(backA, 2.6)));
run(0.05);
check(mech.seq?.kind === 'addition-opening', 'Anti-Angriff startet Ringöffnung');
runUntilIdle();
check(sim.fragments.map(ff).sort().join() === 'C2H4Br2', `Produkt: ${sim.fragments.map(ff).sort().join(', ')}`);
{
  // Diederwinkel Br–C–C–Br
  const P = (i) => sim.atoms[i].p;
  const b1 = V.sub(P(cA), P(brm)), b2v = V.sub(P(ion.c2), P(cA)), b3 = V.sub(P(ion.br), P(ion.c2));
  const n1 = V.norm(V.cross(b1, b2v)), n2 = V.norm(V.cross(b2v, b3));
  const dih = Math.acos(Math.max(-1, Math.min(1, V.dot(n1, n2)))) * 180 / Math.PI;
  console.log(`  Diederwinkel Br–C–C–Br: ${dih.toFixed(1)}°, C–C ${V.dist(P(cA), P(ion.c2)).toFixed(2)} Å`);
  check(dih > 150, 'Anti-Stellung der beiden Br-Atome');
  check(Math.abs(tetraAvg(cA) - 109.5) < 2.5 && Math.abs(tetraAvg(ion.c2) - 109.5) < 2.5, `beide C sp³ (${tetraAvg(cA).toFixed(1)}° / ${tetraAvg(ion.c2).toFixed(1)}°)`);
}
check(mech.counts.addition === 1, 'Zähler Addition = 1');

// ---------------- Radikalische Substitution ----------------
console.log('\n== Radikalische Substitution ==');
loadScenario(sim, 'methane');
mech.reset();
run(0.5);
const rf = () => sim.fragments.map(ff).sort().join(', ');
check(rf() === 'Br2, Br2, Br2, CH4, CH4, CH4', `Start: ${rf()}`);
check(!mech.seq, 'Ohne Licht keine Reaktion');
const LAMP = R().constructor.lamp;
let rb = findIdx((i) => R().bromine(i));
// Br₂ an Methan ohne Licht → Hinweis
let chList = R().alkaneCH();
moveFrag(rb.a, V.add(sim.atoms[chList[0].h].p, V.mul(V.norm(V.sub(sim.atoms[chList[0].h].p, sim.atoms[chList[0].c].p)), 2.0)));
mech.hintCooldown = 0;
run(0.1);
check(!mech.seq && log.at(-1).includes('Dunkeln'), 'Br₂ an Methan im Dunkeln → Hinweis');
// in den Lichtkegel
const midB = V.lerp(sim.atoms[rb.a].p, sim.atoms[rb.b].p, 0.5);
moveFrag(rb.a, V.add([LAMP.x, 0, LAMP.z], V.sub(sim.atoms[rb.a].p, midB)));
run(0.05);
check(mech.seq?.kind === 'homolysis', 'Br₂ im Lichtkegel → Homolyse');
runUntilIdle();
let rads = R().radicals();
check(rads.length === 2 && rads.every((r) => sim.atoms[r].el === 'Br' && sim.formalCharge(r) === 0), 'Zwei neutrale Brom-Radikale (keine Ionen)');
check(sim.fragments.filter((f) => sim.formula(f) === 'Br').every((f) => sim.fragmentCharge(f) === 0), 'Br• hat Ladung 0');
// Kette 1 (das zweite Radikal vorher aus dem Weg räumen)
moveFrag(rads[1], [6, 3, 2]);
run(0.05);
const brR = rads[0];
chList = R().alkaneCH().sort((p, q) => V.dist(sim.atoms[p.h].p, sim.atoms[brR].p) - V.dist(sim.atoms[q.h].p, sim.atoms[brR].p));
const ch0 = chList[0];
moveFrag(brR, V.add(sim.atoms[ch0.h].p, V.mul(V.norm(V.sub(sim.atoms[ch0.h].p, sim.atoms[ch0.c].p)), 1.7)));
run(0.05);
check(mech.seq?.kind === 'abstraction', 'Br• an H → H-Abstraktion');
runUntilIdle();
check(sim.radicalOf(ch0.c) === 1 && sim.formalCharge(ch0.c) === 0, 'Methyl-Radikal: C mit ungepaartem Elektron, ungeladen');
{
  const nb = sim.nbrs(ch0.c).map((x) => x.j);
  const sum = angle(nb[0], ch0.c, nb[1]) + angle(nb[1], ch0.c, nb[2]) + angle(nb[0], ch0.c, nb[2]);
  check(Math.abs(sum - 360) < 3, `Methyl-Radikal planar (Winkelsumme ${sum.toFixed(1)}°)`);
}
check(rf().includes('HBr'), `Fragmente: ${rf()}`);
// Kette 2
rb = findIdx((i) => R().bromine(i));
const orb = R().orbitalDir(ch0.c, sim.atoms[rb.a].p);
const bDir = V.norm(V.sub(sim.atoms[rb.b].p, sim.atoms[rb.a].p));
// Br₂ entlang des p-Orbitals ausrichten: rb.a nah, rb.b fern
sim.atoms[rb.a].p = V.add(sim.atoms[ch0.c].p, V.mul(orb, 2.3));
sim.atoms[rb.b].p = V.add(sim.atoms[ch0.c].p, V.mul(orb, 2.3 + 2.28));
run(0.05);
check(mech.seq?.kind === 'bromination', `•CH₃ an Br₂ → Br-Übertragung (${mech.seq?.kind})`);
runUntilIdle();
check(rf().includes('CH3Br') && R().radicals().length === 2, `Brommethan + neues Br•: ${rf()}`);
check(mech.counts.rsub === 1 && mech.counts.chain === 2, 'Zähler: 1 Brommethan, 2 Kettenschritte');
// Abbruch: zwei Br•
rads = R().radicals();
moveFrag(rads[0], V.add(sim.atoms[rads[1]].p, [1.9, 0, 0]));
run(0.05);
check(mech.seq?.kind === 'termination', 'Zwei Radikale → Kettenabbruch');
runUntilIdle();
check(R().radicals().length === 0 && rf().split(', ').filter((f) => f === 'Br2').length === 2, `Br₂ zurückgebildet: ${rf()}`);
check(mech.counts.term === 1, 'Zähler Abbruch = 1');

// ---------------- Elektrophile aromatische Substitution ----------------
console.log('\n== Elektrophile aromatische Substitution ==');
loadScenario(sim, 'benzene');
mech.reset();
run(0.5);
check(rf() === 'Br2, Br3Fe, C6H6', `Start: ${rf()}`);
let sc = R().scan();
const ring = sc.rings[0];
check(ring?.length === 6, 'Benzolring erkannt');
{
  const angs = ring.map((c, k) => angle(ring[(k + 5) % 6], c, ring[(k + 1) % 6]));
  const dCC = V.dist(sim.atoms[ring[0]].p, sim.atoms[ring[1]].p);
  const { n, cen } = R().ringNormal(ring);
  const planar = Math.max(...ring.map((c) => Math.abs(V.dot(V.sub(sim.atoms[c].p, cen), n))));
  console.log(`  Benzol: Ringwinkel ${Math.min(...angs).toFixed(1)}–${Math.max(...angs).toFixed(1)}°, C–C ${dCC.toFixed(3)} Å, Abweichung aus Ebene ${planar.toFixed(3)} Å`);
  check(angs.every((a) => Math.abs(a - 120) < 1.5) && Math.abs(dCC - 1.40) < 0.05 && planar < 0.05, 'Benzol: planares Sechseck, gleich lange Bindungen');
}
{
  const f = sc.fe3[0];
  const sum = angle(f.brs[0], f.fe, f.brs[1]) + angle(f.brs[1], f.fe, f.brs[2]) + angle(f.brs[0], f.fe, f.brs[2]);
  check(Math.abs(sum - 360) < 3, `FeBr₃ trigonal-planar (${sum.toFixed(1)}°)`);
}
// Br₂ direkt an Benzol → Hinweis
let bb = sc.br2[0];
moveFrag(bb.a, V.add(sim.atoms[ring[0]].p, V.mul(R().ringNormal(ring, [0, 0, 9]).n, 2.5)));
mech.hintCooldown = 0;
run(0.1);
check(!mech.seq && log.at(-1).includes('Katalysator'), 'Br₂ ohne FeBr₃ an Benzol → Hinweis');
moveFrag(bb.a, [5, 3, 2]);
run(0.1);
// Aktivierung
const fe = sc.fe3[0];
moveFrag(bb.a, V.add(sim.atoms[fe.fe].p, [0, 0, 2.5]));
run(0.05);
check(mech.seq?.kind === 'sear-activation', 'Br₂ an FeBr₃ → Aktivierung');
runUntilIdle();
sc = R().scan();
const cx = sc.cx[0];
check(!!cx && sim.formalCharge(cx.fe) === -1 && sim.formalCharge(cx.brb) === 1, 'Komplex Br–Br⁺–Fe⁻Br₃');
check(mech.partialOverride.get(cx.brt) === 1, 'äußeres Br ist δ+');
check(Math.abs(tetraAvg(cx.fe) - 109.5) < 3, `Fe jetzt tetraedrisch (${tetraAvg(cx.fe).toFixed(1)}°)`);
// σ-Komplex
const rn = R().ringNormal(ring, [0, 0, 9]);
moveFrag(cx.brt, V.add(rn.cen, V.mul(rn.n, 2.7)));
run(0.05);
check(mech.seq?.kind === 'sear-sigma', 'aktiviertes Br an den Ring → π-/σ-Komplex');
runUntilIdle();
sc = R().scan();
const sg = sc.sig[0];
check(!!sg, 'σ-Komplex erkannt');
check(rf() === 'Br4Fe-, C6H6Br+', `Fragmente: ${rf()}`);
check(Math.abs(tetraAvg(sg.c) - 109.5) < 4, `angegriffenes C sp³ (${tetraAvg(sg.c).toFixed(1)}°)`);
check(mech.tags.some((t) => t.text === '+'), 'Ladung im Ring angezeigt');
// Rearomatisierung
const fr = sc.ferr[0];
const brx = fr.brs[0];
moveFrag(brx, V.add(sim.atoms[sg.h].p, V.mul(V.norm(V.sub(sim.atoms[sg.h].p, sim.atoms[sg.c].p)), 1.8)));
run(0.05);
check(mech.seq?.kind === 'sear-rearom', 'FeBr₄⁻ an das H → Rearomatisierung');
runUntilIdle();
check(rf() === 'Br3Fe, C6H5Br, HBr', `Produkte: ${rf()}`);
run(1.5);
{
  const r2 = R().ringFrom(sg.c);
  const angs = r2.map((c, k) => angle(r2[(k + 5) % 6], c, r2[(k + 1) % 6]));
  const arom = r2.every((c) => sim.nbrs(c).filter((x) => x.o === 1.5).length === 2);
  check(arom && angs.every((a) => Math.abs(a - 120) < 2.5), `Ring wieder aromatisch und planar (aromatisch: ${arom}, Winkel ${angs.map((a) => a.toFixed(0)).join('/')})`);
  const f = R().scan().fe3[0];
  check(!!f, 'FeBr₃ zurückgebildet (Katalysator)');
}
check(mech.counts.sear === 1, 'Zähler = 1');

console.log('\nAblauf:', log.map((l) => l.slice(0, 60)).join(' → '));
console.log(failures ? `\n${failures} FEHLER` : '\nAlle Tests bestanden.');
process.exit(failures ? 1 : 0);
