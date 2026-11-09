// Bedienoberfläche: HTML-Overlay (Desktop) und ein 3D-Panel (VR),
// beide aus demselben Zustand gezeichnet.

import * as THREE from 'three';
import { LEVELS } from './mechanism.js';
import { REACTIONS, PLANNED } from './reactions/index.js';

const BUTTONS = [
  { id: 'scen0', label: (s) => `Neustart: ${s.scenarios[0] || ''}`, when: (s) => s.scenarios.length > 0 },
  { id: 'scen1', label: (s) => `Neustart: ${s.scenarios[1] || ''}`, when: (s) => s.scenarios.length > 1 },
  { id: 'spawn', label: '+ Edukte' },
  { id: 'reaction', label: 'Reaktion ▾', levels: ['q2'] },
  { id: 'stepmode', label: 'Schrittmodus', toggle: 'stepMode', levels: ['q2'] },
  { id: 'next', label: 'Weiter ▶', enabledWhen: 'waiting', levels: ['q2'] },
  { id: 'arrows', label: 'Elektronenpfeile', toggle: 'showArrows', levels: ['q2'] },
  { id: 'partials', label: 'δ+/δ− Partialladungen', toggle: 'showPartials', levels: ['q2'] },
  { id: 'pi', label: 'π-Elektronenwolke', toggle: 'showPi', levels: ['q2'], when: (s) => s.piAvailable },
  { id: 'o18', label: '¹⁸O-Markierung', toggle: 'show18O', when: (s) => s.reactionId === 'esterification' },
  { id: 'demo', label: 'Vorführen ▶▶' },
  { id: 'level', label: (s) => `Stufe: ${LEVELS[s.level].label} ⇄` },
  { id: 'resetview', label: 'Ansicht zurücksetzen', when: (s) => s.xr },
];
const labelOf = (b, s) => (typeof b.label === 'function' ? b.label(s) : b.label);
const visible = (b, s) => (!b.levels || b.levels.includes(s.level)) && (!b.when || b.when(s));

/** Einträge des Reaktionsmenüs (verfügbar + geplant) */
const MENU = [
  ...REACTIONS.filter((r) => r.levels.includes('q2')).map((r) => ({ id: r.id, title: r.title, example: r.example, lk: r.lk })),
  ...PLANNED.map((p) => ({ ...p, planned: true })),
];

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class UI {
  constructor(onAction) {
    this.onAction = onAction;
    this.state = {
      reaction: null, reactionTitle: '', reactionId: '', stepIndex: -1, stepDone: false, title: '', text: '',
      guidance: '', hint: '', counters: [], steps: [], scenarios: [],
      stepMode: false, showArrows: true, show18O: false, showPartials: true, showPi: false, piAvailable: false, waiting: false,
      level: 'q2', panelPage: 'main', xr: false,
    };
    this.hintTimer = 0;
    this._buildHTML();
    this._buildPanel();
    this.dirty = true;
  }

  set(patch) {
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      const cur = this.state[k];
      const obj = typeof v === 'object' && v !== null;
      if (obj ? JSON.stringify(cur) !== JSON.stringify(v) : cur !== v) {
        this.state[k] = Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? { ...x } : x)) : obj ? { ...v } : v;
        changed = true;
      }
    }
    if (changed) this.dirty = true;
  }

  hint(text) {
    this.set({ hint: text });
    this.hintTimer = 6;
  }

  update(dt) {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.set({ hint: '' });
    }
    if (!this.dirty) return;
    this.dirty = false;
    this._renderHTML();
    this._renderPanel();
  }

  // ---------- HTML ----------
  _buildHTML() {
    const hud = document.getElementById('hud');
    const tiles = MENU.map((m) => `
      <button data-reaction="${m.id}" ${m.planned ? 'disabled' : ''}>
        <span class="tile-title">${esc(m.title)}${m.lk ? ' <em class="lk">LK</em>' : ''}</span>
        <small>${esc(m.example)}</small>
        ${m.planned ? '<i>in Vorbereitung</i>' : ''}
      </button>`).join('');
    hud.innerHTML = `
      <div class="side">
      <div class="card">
        <div class="reaction" id="ui-reaction"></div>
        <div class="level-badge" id="ui-level"></div>
        <ol class="steps" id="ui-steps"></ol>
        <h2 id="ui-title"></h2>
        <p id="ui-text"></p>
        <p class="guidance" id="ui-guidance"></p>
        <p class="hint" id="ui-hint"></p>
        <div class="counts" id="ui-counts"></div>
      </div>
      <section class="controls" id="ui-controls">
        <header><h3>Steuerung</h3><button id="ui-controls-toggle" title="Taste H">ausblenden</button></header>
        <dl>
          <div class="group">Moleküle</div>
          <dt><kbd>Links</kbd> ziehen</dt><dd>Molekül <b>verschieben</b> (Atom greifen)</dd>
          <dt><kbd>Rechts</kbd> ziehen</dt><dd>Molekül <b>drehen</b></dd>
          <dt><kbd>Shift</kbd> + <kbd>Links</kbd></dt><dd>drehen (Trackpad)</dd>
          <div class="group">Ansicht</div>
          <dt>Hintergrund ziehen</dt><dd>Ansicht drehen</dd>
          <dt><kbd>Mausrad</kbd></dt><dd>Zoom</dd>
          <div class="group">Ablauf</div>
          <dt data-level="q2"><kbd>Leertaste</kbd></dt><dd data-level="q2">Weiter (Schrittmodus)</dd>
          <dt><kbd>H</kbd></dt><dd>Hilfe ein-/ausblenden</dd>
        </dl>
      </section>
      </div>
      <div class="toolbar" id="ui-toolbar">
        ${BUTTONS.map((b) => `<button data-id="${b.id}">${esc(labelOf(b, this.state))}</button>`).join('')}
      </div>
      <div class="chooser" id="ui-chooser" hidden>
        <div class="chooser-box" data-page="level">
          <h1>3D-Chemie: Reaktionsmechanismen</h1>
          <p>Welche Version möchtest du verwenden?</p>
          <div class="chooser-options">
            <button data-level="ef"><b>EF</b><span>Einführungsphase</span><small>Veresterung vereinfacht: Säure, Alkohol und H⁺ zusammenbringen – Wasser wird abgespalten, der Ester entsteht, der Katalysator wird wieder frei.</small></button>
            <button data-level="q2"><b>Q2</b><span>Qualifikationsphase</span><small>Vollständige Mechanismen mit Elektronenpfeilen, Zwischenstufen und Partialladungen – Auswahl aus mehreren Reaktionstypen.</small></button>
          </div>
        </div>
        <div class="chooser-box" data-page="reactions" hidden>
          <h1>Reaktion wählen <span class="muted">(Q2)</span></h1>
          <p>Bringe die Teilchen an ihren reaktiven Zentren zusammen – der Mechanismus läuft dann Schritt für Schritt ab.</p>
          <div class="chooser-tiles">${tiles}</div>
          <button class="chooser-back" data-back>← Stufe wählen</button>
        </div>
      </div>`;
    hud.querySelector('#ui-toolbar').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.onAction(b.dataset.id);
    });
    hud.querySelector('#ui-chooser').addEventListener('click', (e) => {
      const lv = e.target.closest('button[data-level]');
      if (lv) {
        if (lv.dataset.level === 'q2') return this.showChooser('reactions');
        this.hideChooser();
        return this.onAction('setlevel:ef');
      }
      const rx = e.target.closest('button[data-reaction]');
      if (rx && !rx.disabled) { this.hideChooser(); return this.onAction('setreaction:' + rx.dataset.reaction); }
      if (e.target.closest('[data-back]')) this.showChooser('level');
    });
    this.hud = hud;
    this.el = (id) => hud.querySelector('#ui-' + id);
    this._initControls(hud);
    this.btnEls = [...hud.querySelectorAll('#ui-toolbar button')];
    this._stepsKey = '';
  }

  /** page: 'level' (Stufe wählen) oder 'reactions' (Q2-Reaktionsmenü) */
  showChooser(page = 'level') {
    const ch = this.el('chooser');
    ch.hidden = false;
    for (const box of ch.querySelectorAll('.chooser-box')) box.hidden = box.dataset.page !== page;
    for (const t of ch.querySelectorAll('button[data-reaction]')) t.classList.toggle('current', t.dataset.reaction === this.state.reactionId && this.state.level === 'q2');
    document.body.classList.add('choosing');
  }

  hideChooser() {
    this.el('chooser').hidden = true;
    document.body.classList.remove('choosing');
  }

  _initControls(hud) {
    const box = hud.querySelector('#ui-controls');
    const btn = hud.querySelector('#ui-controls-toggle');
    const KEY = '3dchemie.controlsCollapsed';
    const apply = (collapsed) => {
      box.classList.toggle('collapsed', collapsed);
      btn.textContent = collapsed ? '? Steuerung' : 'ausblenden';
      try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch {}
    };
    let start = false;
    try { start = localStorage.getItem(KEY) === '1'; } catch {}
    apply(start);
    btn.addEventListener('click', () => apply(!box.classList.contains('collapsed')));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH' && !e.ctrlKey && !e.metaKey && !e.altKey) apply(!box.classList.contains('collapsed'));
    });
  }

  _showSteps(s) {
    return s.level === 'q2' && s.steps.length > 1;
  }

  _renderHTML() {
    const s = this.state;
    this.el('reaction').textContent = s.reaction || s.reactionTitle;
    this.el('level').textContent = LEVELS[s.level].name;
    const stepsEl = this.el('steps');
    const key = s.steps.join('|');
    if (key !== this._stepsKey) {
      stepsEl.innerHTML = s.steps.map((n) => `<li>${esc(n)}</li>`).join('');
      stepsEl.style.gridTemplateColumns = `repeat(${Math.max(1, s.steps.length)}, minmax(0, 1fr))`;
      this._stepsKey = key;
    }
    stepsEl.hidden = !this._showSteps(s);
    for (const n of this.hud.querySelectorAll('#ui-controls [data-level]')) n.hidden = n.dataset.level !== s.level;
    [...stepsEl.children].forEach((li, i) => {
      li.className = i < s.stepIndex || (i === s.stepIndex && s.stepDone) ? 'done' : i === s.stepIndex ? 'active' : '';
    });
    this.el('title').textContent = s.title || 'Bereit';
    this.el('text').textContent = s.text || '';
    this.el('guidance').textContent = s.waiting ? 'Schrittmodus: „Weiter ▶“ (oder Leertaste / A-Taste) startet den nächsten Schritt.' : s.guidance;
    this.el('hint').textContent = s.hint;
    this.el('counts').textContent = s.counters.map((c) => `${c.label}: ${c.value}`).join(' · ');
    this.btnEls.forEach((el, i) => {
      const b = BUTTONS[i];
      el.hidden = !visible(b, s);
      el.textContent = labelOf(b, s);
      el.classList.toggle('on', !!(b.toggle && s[b.toggle]));
      el.disabled = !!(b.enabledWhen && !s[b.enabledWhen]);
    });
  }

  // ---------- VR-Panel ----------
  _buildPanel() {
    this.W = 1024;
    this.H = 860;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const w = 0.68;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, (w * this.H) / this.W),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true }),
    );
    this.panel.name = 'ui-panel';
    this.panel.visible = false;
    this.hoverButton = -1;
    this.rects = [];
    this._layoutPanel();
  }

  /** Button-Rechtecke (in Canvas-Pixeln) für die aktuelle Panel-Seite */
  _layoutPanel() {
    const s = this.state;
    if (s.panelPage === 'menu') {
      // Reaktionsmenü: zwei Spalten breite Buttons, darunter „Zurück“
      const bw = 464, bh = 92, gap = 16, x0 = 32, y0 = 110;
      const items = MENU.map((m) => ({
        id: 'setreaction:' + m.id, label: m.title + (m.lk ? '  (LK)' : ''), sub: m.planned ? 'in Vorbereitung' : m.example,
        disabled: !!m.planned, current: m.id === s.reactionId && s.level === 'q2',
      }));
      this.rects = items.map((b, i) => ({ ...b, x: x0 + (i % 2) * (bw + gap), y: y0 + Math.floor(i / 2) * (bh + gap), w: bw, h: bh }));
      this.rects.push({ id: 'menu-back', label: '← Zurück', x: x0, y: this.H - 92, w: 300, h: 64 });
      return;
    }
    const cols = 4, bw = 228, bh = 64, gap = 16, x0 = 32;
    const vis = BUTTONS.filter((b) => visible(b, s));
    const rows = Math.ceil(vis.length / cols);
    const y0 = this.H - rows * bh - (rows - 1) * gap - 28;
    this.rects = vis.map((b, i) => ({
      ...b, x: x0 + (i % cols) * (bw + gap), y: y0 + Math.floor(i / cols) * (bh + gap), w: bw, h: bh,
    }));
  }

  /** uv vom Raycast -> Button-Index */
  buttonAt(uv) {
    const x = uv.x * this.W, y = (1 - uv.y) * this.H;
    return this.rects.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  }

  clickUV(uv) {
    const i = this.buttonAt(uv);
    if (i >= 0) {
      const r = this.rects[i];
      if (r.disabled || (r.enabledWhen && !this.state[r.enabledWhen])) return;
      this.onAction(r.id);
    }
  }

  setHover(uv) {
    const i = uv ? this.buttonAt(uv) : -1;
    if (i !== this.hoverButton) {
      this.hoverButton = i;
      this._renderPanel();
    }
  }

  _renderPanel() {
    const ctx = this.canvas.getContext('2d');
    const { W, H } = this;
    const s = this.state;
    this._layoutPanel();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(16,22,38,0.92)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 36);
    ctx.fill();

    if (s.panelPage === 'menu') return this._renderMenu(ctx);

    ctx.fillStyle = '#8fb4ff';
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.fillText(s.reaction || s.reactionTitle, 32, 52, W - 200);

    ctx.fillStyle = '#8fa0c0';
    ctx.font = '22px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`Stufe ${LEVELS[s.level].label}`, W - 32, 52);
    ctx.textAlign = 'left';

    // Schritt-Chips (nur Q2)
    const n = s.steps.length;
    const showSteps = this._showSteps(s);
    const cw = (W - 64 - (n - 1) * 10) / Math.max(1, n);
    if (showSteps) s.steps.forEach((name, i) => {
      const x = 32 + i * (cw + 10), y = 72;
      const done = i < s.stepIndex || (i === s.stepIndex && s.stepDone);
      const active = i === s.stepIndex && !s.stepDone;
      ctx.fillStyle = active ? '#ff7a1a' : done ? '#2e7d5b' : '#2a3350';
      ctx.beginPath();
      ctx.roundRect(x, y, cw, 50, 12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${i + 1}. ${name}`, x + cw / 2, y + 32, cw - 10);
      ctx.textAlign = 'left';
    });

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px system-ui, sans-serif';
    const ty = showSteps ? 170 : 110;
    ctx.fillText(s.title || 'Bereit', 32, ty, W - 64);

    let y = ty + 42;
    ctx.font = '27px system-ui, sans-serif';
    ctx.fillStyle = '#dfe6f5';
    const textEnd = this.rects[0].y - 150;
    for (const line of wrap(ctx, s.text || '', W - 64)) {
      if (y > textEnd) break;
      ctx.fillText(line, 32, y);
      y += 35;
    }

    const g = s.hint || (s.waiting ? 'Schrittmodus: „Weiter ▶“ oder A-/X-Taste startet den nächsten Schritt.' : s.guidance);
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.fillStyle = s.hint ? '#ffb74d' : '#9be7b0';
    y = Math.max(y + 6, textEnd - 40);
    for (const line of wrap(ctx, g || '', W - 64).slice(0, 3)) { ctx.fillText(line, 32, y); y += 33; }

    ctx.font = '22px system-ui, sans-serif';
    ctx.fillStyle = '#8fa0c0';
    ctx.fillText(s.counters.map((c) => `${c.label}: ${c.value}`).join('   ·   '), 32, this.rects[0].y - 18);

    this._drawButtons(ctx);
    this.tex.needsUpdate = true;
  }

  _renderMenu(ctx) {
    const { W } = this;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillText('Reaktion wählen (Q2)', 32, 70, W - 64);
    this._drawButtons(ctx);
    this.tex.needsUpdate = true;
  }

  _drawButtons(ctx) {
    const s = this.state;
    this.rects.forEach((r, i) => {
      const on = (r.toggle && s[r.toggle]) || r.current;
      const disabled = r.disabled || (r.enabledWhen && !s[r.enabledWhen]);
      ctx.fillStyle = disabled ? '#1d2338' : on ? '#2f6fde' : i === this.hoverButton ? '#3a4670' : '#2a3350';
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 14);
      ctx.fill();
      ctx.fillStyle = disabled ? '#59627c' : '#fff';
      ctx.textAlign = 'center';
      if (r.sub) {
        ctx.font = '600 25px system-ui, sans-serif';
        ctx.fillText(labelOf(r, s), r.x + r.w / 2, r.y + 38, r.w - 20);
        ctx.font = '19px system-ui, sans-serif';
        ctx.fillStyle = disabled ? '#59627c' : '#c3cde3';
        ctx.fillText(r.sub, r.x + r.w / 2, r.y + 70, r.w - 20);
      } else {
        ctx.font = '600 23px system-ui, sans-serif';
        ctx.fillText(labelOf(r, s), r.x + r.w / 2, r.y + r.h / 2 + 8, r.w - 12);
      }
      ctx.textAlign = 'left';
    });
  }
}
