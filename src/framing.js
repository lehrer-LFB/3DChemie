// Startansicht: Der Molekülraum wird für jede Szene so platziert, dass die
// Moleküle bei immer gleichem Maßstab (1 Å = 10 cm) mittig vor der Person
// schweben, auf gleicher Höhe und mit einem Mindestabstand zum Körper.
//
// Koordinaten: Molekülraum in Å, Welt in m (WebXR "local-floor": Person steht
// bei x = z = 0 und blickt in −z-Richtung).

export const FRAME = {
  scale: 0.1, // 1 Å = 10 cm
  height: 1.15, // Höhe der Szenenmitte über dem Boden (m)
  depth: -0.7, // z der Szenenmitte (m)
  front: -0.45, // vorderstes Atom höchstens hier (m), also ≥ 45 cm vor dem Körper
};

/**
 * Position des Molekülraums für eine Szene.
 * atoms: Liste von [x, y, z] in Å; lamp: { x, z, radius } (optional, zählt für x/z mit)
 */
export function homeFor(atoms, lamp = null) {
  const s = FRAME.scale;
  const xs = atoms.map((p) => p[0]), ys = atoms.map((p) => p[1]), zs = atoms.map((p) => p[2]);
  if (lamp) {
    xs.push(lamp.x - lamp.radius, lamp.x + lamp.radius);
    zs.push(lamp.z - lamp.radius, lamp.z + lamp.radius);
  }
  const mid = (v) => (v.length ? (Math.min(...v) + Math.max(...v)) / 2 : 0);
  const pos = [-mid(xs) * s, FRAME.height - mid(ys) * s, FRAME.depth - mid(zs) * s];
  const front = pos[2] + (zs.length ? Math.max(...zs) : 0) * s;
  if (front > FRAME.front) pos[2] -= front - FRAME.front;
  return { pos, scale: s };
}
