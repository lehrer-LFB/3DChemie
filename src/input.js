// Eingabe: Maus/Touch am Desktop sowie Controller und Handtracking in WebXR
// (Meta Quest, Pico). Gegriffen wird immer ein ganzes Molekül (Fragment).
//
// VR:  Trigger/Pinch auf ein Atom (auch per Strahl aus der Ferne) = greifen,
//      Grip-Taste in der Nähe = greifen, Thumbstick vor/zurück = gegriffenes
//      Molekül wegschieben/heranholen, A/X = "Weiter" im Schrittmodus.
//      Ansicht: Thumbstick links/rechts = Molekülraum in 30°-Schritten drehen,
//      Grip im leeren Raum = Molekülraum greifen (eine Hand: verschieben,
//      zwei Hände: zusätzlich drehen und zoomen).

import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const NEAR_GRAB = 0.07; // m
const SNAP_TURN = Math.PI / 6; // 30°
const SCALE_MIN = 0.04, SCALE_MAX = 0.4; // 1 Å = 4 … 40 cm

export class Input {
  constructor({ renderer, camera, scene, lab, sim, view, ui, controls, mech }) {
    Object.assign(this, { renderer, camera, scene, lab, sim, view, ui, controls, mech });
    this.raycaster = new THREE.Raycaster();
    this.grabs = [];
    this.tmpM = new THREE.Matrix4();
    this.tmpV = new THREE.Vector3();
    this.world = null; // Greifen des ganzen Molekülraums
    this.home = { pos: new THREE.Vector3(0, 1.15, -0.6), scale: 0.1 }; // Startansicht der Szene
    this._setupDesktop();
    this._setupXR();
  }

  canGrab(atomId) {
    return !this.mech.busy.has(atomId);
  }

  // ---------- gemeinsames Greifen ----------

  _grab(owner, obj, atomId, ray) {
    this._releaseOwner(owner);
    const ids = [...this.sim.fragmentOf(atomId)];
    // anderen Greifer desselben Moleküls lösen
    for (const g of [...this.grabs]) if (g.ids.some((i) => ids.includes(i))) this._release(g);
    obj.updateMatrixWorld(true);
    this.lab.updateMatrixWorld(true);
    const inv = this.tmpM.copy(obj.matrixWorld).invert();
    const locals = ids.map((i) => {
      const w = this.lab.localToWorld(new THREE.Vector3(...this.sim.atoms[i].p));
      return w.applyMatrix4(inv);
    });
    for (const i of ids) this.sim.atoms[i].kin = true;
    const g = { owner, obj, ids, locals, ray };
    this.grabs.push(g);
    return g;
  }

  _release(g) {
    for (const i of g.ids) if (this.sim.atoms[i]) this.sim.atoms[i].kin = false;
    this.grabs.splice(this.grabs.indexOf(g), 1);
  }

  _releaseOwner(owner) {
    for (const g of [...this.grabs]) if (g.owner === owner) this._release(g);
  }

  /** Von der Reaktionslogik aufgerufen, wenn Moleküle in eine Reaktion gehen */
  releaseAtoms(set) {
    for (const g of [...this.grabs]) if (g.ids.some((i) => set.has(i))) this._release(g);
  }

  releaseAll() {
    for (const g of [...this.grabs]) this._release(g);
  }

  _applyGrabs() {
    this.lab.updateMatrixWorld(true);
    for (const g of this.grabs) {
      if (g.owner === 'mouse') continue;
      g.obj.updateMatrixWorld(true);
      g.ids.forEach((id, k) => {
        const w = this.tmpV.copy(g.locals[k]).applyMatrix4(g.obj.matrixWorld);
        const p = this.lab.worldToLocal(w);
        this.sim.atoms[id].p = [p.x, p.y, p.z];
      });
    }
  }

  _hoverFragment(atomId) {
    this.view.hover.clear();
    if (atomId == null || !this.canGrab(atomId)) return;
    for (const i of this.sim.fragmentOf(atomId)) this.view.hover.add(i);
  }

  // ---------- Desktop ----------

  _setupDesktop() {
    const el = this.renderer.domElement;
    this.pointer = new THREE.Vector2();
    this.drag = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this._onDown(e));
    el.addEventListener('pointermove', (e) => this._onMove(e));
    el.addEventListener('pointerup', (e) => this._onUp(e));
    el.addEventListener('pointercancel', (e) => this._onUp(e));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); this.mech.next(); }
    });
  }

  _pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.view.pickables, false)[0];
    return hit || null;
  }

  _onDown(e) {
    if (this.renderer.xr.isPresenting) return;
    const hit = this._pick(e);
    if (!hit) return;
    const id = hit.object.userData.atom;
    if (!this.canGrab(id)) return;
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    const ids = [...this.sim.fragmentOf(id)];
    for (const g of [...this.grabs]) if (g.ids.some((i) => ids.includes(i))) this._release(g);
    for (const i of ids) this.sim.atoms[i].kin = true;
    const g = { owner: 'mouse', ids };
    this.grabs.push(g);
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    this.drag = {
      g,
      rotate: e.button === 2 || e.shiftKey,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point),
      last: hit.point.clone(),
      x: e.clientX,
      y: e.clientY,
    };
  }

  _onMove(e) {
    if (this.renderer.xr.isPresenting) return;
    if (!this.drag) {
      const hit = this._pick(e);
      this._hoverFragment(hit ? hit.object.userData.atom : null);
      this.renderer.domElement.style.cursor = hit && this.canGrab(hit.object.userData.atom) ? 'grab' : 'default';
      return;
    }
    const d = this.drag;
    if (!this.grabs.includes(d.g)) { this._endDrag(); return; } // durch Reaktion gelöst
    const atoms = this.sim.atoms;
    if (d.rotate) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const q = new THREE.Quaternion().setFromAxisAngle(up, dx * 0.01)
        .multiply(new THREE.Quaternion().setFromAxisAngle(right, dy * 0.01));
      const c = new THREE.Vector3();
      for (const i of d.g.ids) c.add(new THREE.Vector3(...atoms[i].p));
      c.divideScalar(d.g.ids.length);
      for (const i of d.g.ids) {
        const v = new THREE.Vector3(...atoms[i].p).sub(c).applyQuaternion(q).add(c);
        atoms[i].p = [v.x, v.y, v.z];
      }
    } else {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const p = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(d.plane, p)) return;
      const delta = this.lab.worldToLocal(p.clone()).sub(this.lab.worldToLocal(d.last.clone()));
      d.last.copy(p);
      for (const i of d.g.ids) {
        const a = atoms[i].p;
        atoms[i].p = [a[0] + delta.x, a[1] + delta.y, a[2] + delta.z];
      }
    }
  }

  _onUp() {
    if (this.drag) this._endDrag();
  }

  _endDrag() {
    if (this.grabs.includes(this.drag.g)) this._release(this.drag.g);
    this.drag = null;
    this.controls.enabled = true;
  }

  // ---------- WebXR ----------

  _setupXR() {
    const xr = this.renderer.xr;
    const cmf = new XRControllerModelFactory();
    const hmf = new XRHandModelFactory();
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.ctrls = [];
    for (let i = 0; i < 2; i++) {
      const ctrl = xr.getController(i);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.7 }));
      line.scale.z = 2;
      ctrl.add(line);
      const state = { i, ctrl, line, src: null, btnA: false, hoverAtom: null, turnArmed: true, worldGrab: false };
      ctrl.addEventListener('connected', (e) => { state.src = e.data; });
      ctrl.addEventListener('disconnected', () => { state.src = null; this._releaseOwner(i); this._worldEnd(state); });
      ctrl.addEventListener('selectstart', () => this._xrStart(state, true));
      ctrl.addEventListener('selectend', () => this._releaseOwner(i));
      ctrl.addEventListener('squeezestart', () => this._xrStart(state, false));
      ctrl.addEventListener('squeezeend', () => { this._releaseOwner(i); this._worldEnd(state); });
      this.scene.add(ctrl);

      const grip = xr.getControllerGrip(i);
      grip.add(cmf.createControllerModel(grip));
      this.scene.add(grip);
      const hand = xr.getHand(i);
      hand.add(hmf.createHandModel(hand, 'mesh'));
      this.scene.add(hand);
      state.grip = grip;
      this.ctrls.push(state);
    }
  }

  _rayFrom(ctrl) {
    ctrl.updateMatrixWorld(true);
    this.tmpM.identity().extractRotation(ctrl.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tmpM);
    const targets = this.ui.panel.visible ? [this.ui.panel, ...this.view.pickables] : this.view.pickables;
    return this.raycaster.intersectObjects(targets, false)[0] || null;
  }

  _nearestAtom(worldPos) {
    this.lab.updateMatrixWorld(true);
    const local = this.lab.worldToLocal(worldPos.clone());
    const scale = this.lab.scale.x;
    let best = null, bestD = NEAR_GRAB / scale;
    this.sim.atoms.forEach((a, i) => {
      const d = Math.hypot(a.p[0] - local.x, a.p[1] - local.y, a.p[2] - local.z);
      if (d < bestD && this.canGrab(i)) { bestD = d; best = i; }
    });
    return best;
  }

  _xrStart(state, isSelect) {
    const { ctrl, i } = state;
    const hit = this._rayFrom(ctrl);
    if (isSelect && hit && hit.object === this.ui.panel) {
      this.ui.clickUV(hit.uv);
      return;
    }
    // Nahgriff: Atom in Reichweite der Hand/des Controllers
    const pos = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
    const near = this._nearestAtom(pos);
    if (near != null) { this._grab(i, ctrl, near, false); return; }
    // Ferngriff per Strahl
    if (hit && hit.object.userData.atom != null && this.canGrab(hit.object.userData.atom)) {
      this._grab(i, ctrl, hit.object.userData.atom, true);
      return;
    }
    // Grip ins Leere: den ganzen Molekülraum greifen
    if (!isSelect) this._worldStart(state);
  }

  // ---------- Ansicht in VR: Molekülraum greifen, drehen, zoomen ----------

  _handPos(st) {
    return new THREE.Vector3().setFromMatrixPosition(st.ctrl.matrixWorld);
  }

  _worldStart(st) {
    st.worldGrab = true;
    st.line.material.color.setHex(0xffb74d);
    this._worldReset();
  }

  _worldEnd(st) {
    if (!st.worldGrab) return;
    st.worldGrab = false;
    st.line.material.color.setHex(0x9fd3ff);
    this._worldReset();
  }

  /** Ausgangszustand für die laufende Greif-Geste neu festhalten (z. B. wenn eine Hand dazukommt) */
  _worldReset() {
    const hands = this.ctrls.filter((c) => c.worldGrab);
    if (!hands.length) { this.world = null; return; }
    for (const h of hands) h.ctrl.updateMatrixWorld(true);
    const p = hands.map((h) => this._handPos(h));
    const mid = p.length === 2 ? p[0].clone().add(p[1]).multiplyScalar(0.5) : p[0];
    const d = p.length === 2 ? p[1].clone().sub(p[0]) : null;
    this.world = {
      hands, mid,
      yaw0: d ? Math.atan2(d.x, d.z) : 0,
      dist0: d ? Math.max(0.05, d.length()) : 1,
      pos0: this.lab.position.clone(),
      rotY0: this.lab.rotation.y,
      scale0: this.lab.scale.x,
    };
  }

  _worldUpdate() {
    const w = this.world;
    if (!w) return;
    const p = w.hands.map((h) => this._handPos(h));
    if (p.length === 1) {
      this.lab.position.copy(w.pos0).add(p[0].clone().sub(w.mid));
      return;
    }
    const mid = p[0].clone().add(p[1]).multiplyScalar(0.5);
    const d = p[1].clone().sub(p[0]);
    const yaw = Math.atan2(d.x, d.z) - w.yaw0;
    const s = THREE.MathUtils.clamp((w.scale0 * d.length()) / w.dist0, SCALE_MIN, SCALE_MAX);
    // Molekülraum um den Mittelpunkt der Hände drehen und skalieren, aufrecht halten
    const rel = w.pos0.clone().sub(w.mid).multiplyScalar(s / w.scale0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.lab.position.copy(mid).add(rel);
    this.lab.rotation.set(0, w.rotY0 + yaw, 0);
    this.lab.scale.setScalar(s);
  }

  /** Molekülraum um seine Mitte drehen (Snap-Turn) */
  _snapTurn(dir) {
    // Drehpunkt: Schwerpunkt der Moleküle (in Weltkoordinaten)
    const A = this.sim.atoms;
    const c = new THREE.Vector3();
    if (A.length) {
      for (const a of A) c.add(new THREE.Vector3(...a.p));
      c.divideScalar(A.length);
    }
    this.lab.updateMatrixWorld(true);
    const pivot = this.lab.localToWorld(c);
    const ang = -dir * SNAP_TURN;
    const rel = this.lab.position.clone().sub(pivot).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    this.lab.position.copy(pivot).add(rel);
    this.lab.rotation.y += ang;
    this._worldReset();
  }

  /** Ansicht zurücksetzen */
  /** Startansicht der aktuellen Szene festlegen ({ pos: [x, y, z], scale }) */
  setHome({ pos, scale }) {
    this.home.pos.set(...pos);
    this.home.scale = scale;
  }

  resetView() {
    for (const st of this.ctrls || []) st.worldGrab = false;
    this.world = null;
    this.lab.position.copy(this.home.pos);
    this.lab.rotation.set(0, 0, 0);
    this.lab.scale.setScalar(this.home.scale);
    this._worldReset();
  }

  update(dt) {
    const presenting = this.renderer.xr.isPresenting;
    this.ui.panel.visible = presenting;
    if (presenting) {
      let anyHover = null;
      let panelUV = null;
      for (const st of this.ctrls) {
        if (!st.src) continue;
        const gp = st.src.gamepad;
        const grab = this.grabs.find((g) => g.owner === st.i);
        // Thumbstick: gegriffenes Molekül entlang des Strahls verschieben
        if (gp && grab && grab.ray) {
          const ay = gp.axes[3] ?? 0;
          if (Math.abs(ay) > 0.15) for (const l of grab.locals) l.z += ay * dt * 0.8;
        }
        // Thumbstick links/rechts: Molekülraum in 30°-Schritten drehen
        if (gp) {
          const ax = gp.axes[2] ?? 0;
          if (st.turnArmed && Math.abs(ax) > 0.7) { this._snapTurn(Math.sign(ax)); st.turnArmed = false; }
          else if (Math.abs(ax) < 0.3) st.turnArmed = true;
        }
        // A / X = Weiter
        const a = !!(gp && gp.buttons[4] && gp.buttons[4].pressed);
        if (a && !st.btnA) this.mech.next();
        st.btnA = a;

        const hit = grab || st.worldGrab ? null : this._rayFrom(st.ctrl);
        st.line.scale.z = hit ? hit.distance : 2;
        st.line.visible = !st.src.hand || !!hit;
        if (hit && hit.object === this.ui.panel) panelUV = hit.uv;
        else if (hit) anyHover = hit.object.userData.atom;
      }
      this.ui.setHover(panelUV);
      this._hoverFragment(anyHover);
      this._worldUpdate();
    } else if (this.world) {
      for (const st of this.ctrls) st.worldGrab = false;
      this.world = null;
    }
    this._applyGrabs();
  }
}
