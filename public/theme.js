// Personalización (solo en este dispositivo): color, tipografía, fondo propio, sonido propio y orden de los paneles.
// No incluye ningún arte de Riot: el fondo y el sonido los sube la persona desde su propio celular.
(function () {
  const KEY = 'oq_theme';
  const COLORS = ['#f2f2f5', '#c9a24b', '#4fa3ff', '#e0485a', '#46c28a', '#a66bff'];
  const FONTS = {
    classic: { n: 'Clásica', d: '"Cormorant Garamond","Palatino Linotype",Georgia,serif', b: '"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif' },
    modern: { n: 'Moderna', d: '"Segoe UI",system-ui,Roboto,Arial,sans-serif', b: '"Segoe UI",system-ui,Roboto,Arial,sans-serif' },
    mono: { n: 'Mono', d: 'ui-monospace,Consolas,Menlo,monospace', b: 'ui-monospace,Consolas,Menlo,monospace' },
    serif: { n: 'Serif', d: 'Georgia,"Times New Roman",serif', b: 'Georgia,"Times New Roman",serif' },
  };
  const PANELS = ['autoCard', 'phaseArea', 'preCard', 'chatCard'];
  const DEF = { color: '#f2f2f5', font: 'classic', fontData: '', fontName: '', bg: '', bgDim: 0.75, sound: '', order: PANELS.slice() };
  let cfg = Object.assign({}, DEF);
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
  if (!Array.isArray(cfg.order) || PANELS.some((p) => cfg.order.indexOf(p) < 0)) cfg.order = PANELS.slice();

  const T = () => window.OQ.t;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); return true; } catch (_) { return false; } }
  function ink(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16) || 0;
    const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return l > 0.55 ? '#0a0a0c' : '#ffffff';
  }
  function hsl(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16) || 0;
    const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, sa = 0;
    if (mx !== mn) {
      const d = mx - mn; sa = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
    }
    return [h, sa, l];
  }
  function toHex(h, sa, l) {
    const a = sa * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); };
    return '#' + f(0) + f(8) + f(4);
  }
  // Rueda de color: el ángulo es el tono, la distancia al centro la saturación y el control deslizante el brillo.
  function drawWheel() {
    const c = document.getElementById('thWheel'); if (!c) return;
    const ctx = c.getContext('2d'); const R = c.width / 2;
    const l = (Number((document.getElementById('thLight') || {}).value) || 50) / 100;
    const img = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const dx = x - R + 0.5, dy = y - R + 0.5, d = Math.sqrt(dx * dx + dy * dy); if (d > R) continue;
      const hx = toHex((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, d / R, l); const n = parseInt(hx.slice(1), 16); const i = (y * c.width + x) * 4;
      img.data[i] = n >> 16; img.data[i + 1] = (n >> 8) & 255; img.data[i + 2] = n & 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const [h, sa] = hsl(cfg.color); const px = R + Math.cos(h * Math.PI / 180) * sa * R, py = R + Math.sin(h * Math.PI / 180) * sa * R;
    ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.beginPath(); ctx.arc(px, py, 9, 0, 7); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
  }
  function pickWheel(e) {
    const c = document.getElementById('thWheel'); if (!c) return;
    const b = c.getBoundingClientRect(); const R = b.width / 2;
    const dx = e.clientX - b.left - R, dy = e.clientY - b.top - R; const d = Math.min(Math.sqrt(dx * dx + dy * dy), R);
    const l = (Number(document.getElementById('thLight').value) || 50) / 100;
    cfg.color = toHex((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, d / R, l);
    save(); apply(); drawWheel(); liveHex();
  }
  function liveHex() {
    const x = document.getElementById('thHex'); if (x) x.textContent = cfg.color;
    const w = document.getElementById('thSwatch'); if (w) w.style.background = cfg.color;
  }
  let dragging = false;
  document.addEventListener('pointerdown', (e) => { if (e.target.id === 'thWheel') { dragging = true; e.target.setPointerCapture(e.pointerId); pickWheel(e); } });
  document.addEventListener('pointermove', (e) => { if (dragging) pickWheel(e); });
  document.addEventListener('pointerup', () => { if (dragging) { dragging = false; document.dispatchEvent(new CustomEvent('oq-theme')); } });
  new MutationObserver(() => { if (document.getElementById('thWheel') && !document.getElementById('thWheel').dataset.d) { document.getElementById('thWheel').dataset.d = '1'; drawWheel(); } })
    .observe(document.documentElement, { childList: true, subtree: true });

  function apply() {
    const r = document.documentElement.style;
    r.setProperty('--accent', cfg.color);
    r.setProperty('--accent-ink', ink(cfg.color));
    let st = document.getElementById('oqFontFace');
    if (cfg.font === 'custom' && cfg.fontData) {
      if (!st) { st = document.createElement('style'); st.id = 'oqFontFace'; document.head.appendChild(st); }
      st.textContent = `@font-face{font-family:"OQCustom";src:url("${cfg.fontData}");font-display:swap}`;
      r.setProperty('--display', '"OQCustom",system-ui,sans-serif'); r.setProperty('--body', '"OQCustom",system-ui,sans-serif');
    } else {
      if (st) st.textContent = '';
      const f = FONTS[cfg.font] || FONTS.classic;
      r.setProperty('--display', f.d); r.setProperty('--body', f.b);
    }
    if (cfg.bg) {
      const a = Math.min(0.95, Math.max(0.3, Number(cfg.bgDim) || 0.75));
      document.body.style.background = `linear-gradient(rgba(10,10,12,${a}),rgba(10,10,12,${a})),url("${cfg.bg}") center/cover fixed no-repeat #0a0a0c`;
    } else document.body.style.background = '';
    const mv = document.getElementById('mainView');
    if (mv) {
      mv.style.display = 'flex'; mv.style.flexDirection = 'column';
      ['statusbar'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.order = '-1'; });
      cfg.order.forEach((id, i) => { const e = document.getElementById(id); if (e) e.style.order = String(i); });
    }
  }
  function changed() { save(); apply(); document.dispatchEvent(new CustomEvent('oq-theme')); }

  function readImage(file, cb) {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => cb(null);
      img.src = fr.result;
    };
    fr.onerror = () => cb(null);
    fr.readAsDataURL(file);
  }

  let audio = null;
  function playSound() {
    if (!cfg.sound) return false;
    try { if (!audio) audio = new Audio(cfg.sound); audio.currentTime = 0; audio.play(); return true; } catch (_) { return false; }
  }

  const PANEL_KEYS = { autoCard: 'thPanelAuto', phaseArea: 'thPanelMain', preCard: 'thPanelPre', chatCard: 'thPanelChat' };
  function html() {
    const t = T(); const esc = window.OQ.esc;
    return `<div class="card"><h2>${t('thTitle')}</h2><p class="note">${t('thHelp')}</p>
      <div class="dim" style="font-size:12px;margin:10px 0 6px">${t('thColor')}</div>
      <div class="chips">${COLORS.map((c) => `<button class="chip ${cfg.color === c ? 'on' : ''}" data-th="color" data-v="${c}" style="min-width:44px;background:${c};color:${ink(c)}">&nbsp;</button>`).join('')}
</div>
      <div class="dim" style="font-size:12px;margin:10px 0 6px">${t('thWheel')}</div>
      <div class="row" style="gap:14px;align-items:center"><canvas id="thWheel" width="160" height="160" style="touch-action:none;border-radius:50%;flex:none"></canvas>
        <div style="flex:1;min-width:0"><input type="range" id="thLight" min="15" max="90" value="${Math.round(hsl(cfg.color)[2] * 100)}" style="width:100%"><div class="note" id="thHex" style="margin:6px 0 0">${esc(cfg.color)}</div>
        <div style="width:100%;height:26px;margin-top:6px;border:1px solid var(--line2);background:${esc(cfg.color)}" id="thSwatch"></div></div></div>
      <div class="dim" style="font-size:12px;margin:14px 0 6px">${t('thFont')}</div>
      <div class="chips">${Object.keys(FONTS).map((k) => `<button class="chip ${cfg.font === k ? 'on' : ''}" data-th="font" data-v="${k}" style="font-family:${FONTS[k].b}">${esc(FONTS[k].n)}</button>`).join('')}${cfg.fontData ? `<button class="chip ${cfg.font === 'custom' ? 'on' : ''}" data-th="font" data-v="custom">${esc(cfg.fontName || 'Mi fuente')}</button>` : ''}</div>
      <div class="row wrap" style="gap:8px;margin-top:8px"><label class="btn small" style="cursor:pointer">${t('thFontUp')}<input type="file" id="thFontIn" accept=".ttf,.otf,.woff,.woff2,font/*" style="display:none"></label>
        ${cfg.fontData ? `<button class="btn small" data-th="fontClear">${t('thRemove')}</button>` : ''}</div><p class="note">${t('thFontNote')}</p>
      <div class="dim" style="font-size:12px;margin:14px 0 6px">${t('thBg')}</div>
      <div class="row wrap" style="gap:8px"><label class="btn small" style="cursor:pointer">${t('thUpload')}<input type="file" id="thBgIn" accept="image/*" style="display:none"></label>
        ${cfg.bg ? `<button class="btn small" data-th="bgClear">${t('thRemove')}</button>` : ''}</div>
      ${cfg.bg ? `<div class="dim" style="font-size:12px;margin:10px 0 4px">${t('thDim')}</div><input type="range" id="thDim" min="30" max="95" value="${Math.round(cfg.bgDim * 100)}" style="width:100%">` : ''}
      <p class="note">${t('thBgNote')}</p>
      <div class="dim" style="font-size:12px;margin:14px 0 6px">${t('thSound')}</div>
      <div class="row wrap" style="gap:8px"><label class="btn small" style="cursor:pointer">${t('thUpload')}<input type="file" id="thSndIn" accept="audio/*" style="display:none"></label>
        ${cfg.sound ? `<button class="btn small" data-th="sndTest">${t('testSound')}</button><button class="btn small" data-th="sndClear">${t('thRemove')}</button>` : ''}</div>
      <div class="dim" style="font-size:12px;margin:14px 0 6px">${t('thOrder')}</div>
      ${cfg.order.map((id, i) => `<div class="row" style="gap:8px;margin-bottom:6px"><span style="flex:1">${t(PANEL_KEYS[id])}</span>
        <button class="btn small" data-th="up" data-v="${i}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
        <button class="btn small" data-th="down" data-v="${i}" ${i === cfg.order.length - 1 ? 'disabled' : ''}>&darr;</button></div>`).join('')}
      <button class="btn small" style="margin-top:12px" data-th="reset">${t('thReset')}</button><div class="err" id="thErr"></div></div>`;
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-th]'); if (!el) return;
    const a = el.getAttribute('data-th'); const v = el.getAttribute('data-v');
    if (a === 'color') cfg.color = v;
    else if (a === 'font') cfg.font = v;
    else if (a === 'bgClear') cfg.bg = '';
    else if (a === 'fontClear') { cfg.fontData = ''; cfg.fontName = ''; if (cfg.font === 'custom') cfg.font = 'classic'; }
    else if (a === 'sndClear') { cfg.sound = ''; audio = null; }
    else if (a === 'sndTest') { playSound(); return; }
    else if (a === 'up' || a === 'down') {
      const i = Number(v); const j = a === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < cfg.order.length) { const o = cfg.order; [o[i], o[j]] = [o[j], o[i]]; }
    } else if (a === 'reset') { cfg = Object.assign({}, DEF, { order: PANELS.slice() }); audio = null; }
    changed();
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'thDim') { cfg.bgDim = Number(e.target.value) / 100; save(); apply(); }
    if (e.target.id === 'thLight') {
      const [h, sa] = hsl(cfg.color); cfg.color = toHex(h, sa, Number(e.target.value) / 100); save(); apply(); drawWheel(); liveHex();
    }
  });
  document.addEventListener('change', (e) => {
    const id = e.target.id; const err = (m) => { const x = document.getElementById('thErr'); if (x) x.textContent = m || ''; };
    if (id === 'thFontIn' && e.target.files[0]) {
      const f = e.target.files[0];
      if (f.size > 900 * 1024) return err(T()('thTooBigFont'));
      const fr = new FileReader();
      fr.onload = () => {
        const prev = [cfg.fontData, cfg.fontName, cfg.font];
        cfg.fontData = fr.result; cfg.fontName = f.name.replace(/\.[^.]+$/, '').slice(0, 20); cfg.font = 'custom';
        if (!save()) { [cfg.fontData, cfg.fontName, cfg.font] = prev; return err(T()('thTooBigFont')); } changed();
      };
      fr.readAsDataURL(f);
    } else if (id === 'thBgIn' && e.target.files[0]) {
      readImage(e.target.files[0], (d) => {
        if (!d) return err(T()('thBadFile'));
        cfg.bg = d; if (!save()) { cfg.bg = ''; return err(T()('thTooBig')); } changed();
      });
    } else if (id === 'thSndIn' && e.target.files[0]) {
      const f = e.target.files[0];
      if (f.size > 600 * 1024) return err(T()('thTooBig'));
      const fr = new FileReader();
      fr.onload = () => { cfg.sound = fr.result; audio = null; if (!save()) { cfg.sound = ''; return err(T()('thTooBig')); } changed(); };
      fr.readAsDataURL(f);
    }
  });

  window.OQTheme = { apply, html, playSound, get hasSound() { return !!cfg.sound; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
