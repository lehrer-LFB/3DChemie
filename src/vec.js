// Kleine Vektor- und Quaternion-Helfer (Arrays [x,y,z] bzw. [x,y,z,w]).
// Bewusst ohne Three.js, damit der Chemie-Kern auch headless (Node) testbar ist.

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  centroid: (pts) => {
    const c = [0, 0, 0];
    for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    const n = pts.length || 1;
    return [c[0] / n, c[1] / n, c[2] / n];
  },
  // Anteil von a senkrecht zu (normierter) Richtung d
  reject: (a, d) => {
    const k = a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
    return [a[0] - d[0] * k, a[1] - d[1] * k, a[2] - d[2] * k];
  },
  anyPerp: (d) => {
    const t = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    return V.norm(V.cross(d, t));
  },
};

export const Q = {
  identity: () => [0, 0, 0, 1],
  normalize: (q) => {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
  fromAxisAngle: (axis, ang) => {
    const s = Math.sin(ang / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(ang / 2)];
  },
  // Rotation, die den Einheitsvektor u auf v dreht
  fromUnitVectors: (u, v) => {
    let r = V.dot(u, v) + 1;
    let q;
    if (r < 1e-6) {
      r = 0;
      q = Math.abs(u[0]) > Math.abs(u[2]) ? [-u[1], u[0], 0, r] : [0, -u[2], u[1], r];
    } else {
      const c = V.cross(u, v);
      q = [c[0], c[1], c[2], r];
    }
    return Q.normalize(q);
  },
  mul: (a, b) => {
    const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
    return [
      ax * bw + aw * bx + ay * bz - az * by,
      ay * bw + aw * by + az * bx - ax * bz,
      az * bw + aw * bz + ax * by - ay * bx,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
  },
  rotate: (q, v) => {
    const [x, y, z] = v, [qx, qy, qz, qw] = q;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    return [
      ix * qw + iw * -qx + iy * -qz - iz * -qy,
      iy * qw + iw * -qy + iz * -qx - ix * -qz,
      iz * qw + iw * -qz + ix * -qy - iy * -qx,
    ];
  },
  slerp: (a, b, t) => {
    let [x, y, z, w] = b;
    let cos = a[0] * x + a[1] * y + a[2] * z + a[3] * w;
    if (cos < 0) { x = -x; y = -y; z = -z; w = -w; cos = -cos; }
    if (cos > 0.9995) {
      return Q.normalize([
        a[0] + (x - a[0]) * t, a[1] + (y - a[1]) * t,
        a[2] + (z - a[2]) * t, a[3] + (w - a[3]) * t,
      ]);
    }
    const th = Math.acos(cos), s = Math.sin(th);
    const k0 = Math.sin((1 - t) * th) / s, k1 = Math.sin(t * th) / s;
    return [a[0] * k0 + x * k1, a[1] * k0 + y * k1, a[2] * k0 + z * k1, a[3] * k0 + w * k1];
  },
};
