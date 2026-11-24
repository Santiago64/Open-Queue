// Personalización (solo en este dispositivo): color, tipografía, fondo propio (imagen o GIF), sonidos propios y orden de los paneles.
// No incluye ningún arte de Riot: el fondo y los sonidos los sube la persona desde su propio celular.
// El fondo y los sonidos se guardan en IndexedDB (entran archivos más grandes que en localStorage, por ejemplo GIFs).
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
  const SOUNDS = ['matchFound', 'yourTurn', 'swap', 'chat', 'autoPick'];
  const MAX_SOUND = 3 * 1024 * 1024;
  const MAX_BG = 8 * 1024 * 1024;
  // bg / sound: datos viejos (v0.8.7 y antes, en localStorage); se pasan a IndexedDB al abrir.
  const DEF = { color: '#f2f2f5', font: 'classic', fontData: '', fontName: '', bg: '', bgDim: 0.75, sound: '', hasBg: false, sounds: {}, order: PANELS.slice() };
  let cfg = Object.assign({}, DEF);
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
  if (!Array.isArray(cfg.order) || PANELS.some((p) => cfg.order.indexOf(p) < 0)) cfg.order = PANELS.slice();
  if (!cfg.sounds || typeof cfg.sounds !== 'object') cfg.sounds = {};

  // ---------- IndexedDB (fondo y sonidos) ----------
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      try {
        const rq = indexedDB.open('oq_media', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('m');
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      } catch (e) { rej(e); }
    });
    return dbp;
  }
  async function idb(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction('m', mode); const st = tx.objectStore('m'); const rq = fn(st);
      tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  }
  const mediaGet = (k) => idb('readonly', (st) => st.get(k)).catch(() => null);
  const mediaPut = (k, v) => idb('readwrite', (st) => st.put(v, k));
  const mediaDel = (k) => idb('readwrite', (st) => st.delete(k)).catch(() => {});
  function dataUrlToBlob(u) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/.exec(u || ''); if (!m) return null;
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]); const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: m[1] || 'application/octet-stream' });
  }

  let bgUrl = '';
  const audios = {};
  function setBgBlob(b) { if (bgUrl) URL.revokeObjectURL(bgUrl); bgUrl = b ? URL.createObjectURL(b) : ''; }
  function setSoundBlob(k, b) {
    if (audios[k] && audios[k].src) URL.revokeObjectURL(audios[k].src);
    delete audios[k];
    if (b) { const a = new Audio(URL.createObjectURL(b)); a.preload = 'auto'; audios[k] = a; }
  }
  async function loadMedia() {
    try {
      // Pasa el fondo y el sonido viejos (guardados como texto en localStorage) a IndexedDB.
      if (cfg.bg) { const b = dataUrlToBlob(cfg.bg); if (b) { await mediaPut('bg', b); cfg.hasBg = true; } cfg.bg = ''; save(); }
      if (cfg.sound) { const b = dataUrlToBlob(cfg.sound); if (b) { await mediaPut('snd_matchFound', b); cfg.sounds.matchFound = 'audio'; } cfg.sound = ''; save(); }
      if (cfg.hasBg) setBgBlob(await mediaGet('bg'));
      for (const k of SOUNDS) if (cfg.sounds[k]) setSoundBlob(k, await mediaGet('snd_' + k));
    } catch (_) {}
    apply();
  }

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
    const bgSrc = bgUrl || cfg.bg;
    if ((cfg.hasBg || cfg.bg) && bgSrc) {
      const a = Math.min(0.95, Math.max(0.3, Number(cfg.bgDim) || 0.75));
      document.body.style.background = `linear-gradient(rgba(10,10,12,${a}),rgba(10,10,12,${a})),url("${bgSrc}") center/cover fixed no-repeat #0a0a0c`;
    } else document.body.style.background = '';
    const mv = document.getElementById('mainView');
    if (mv) {
      mv.style.display = 'flex'; mv.style.flexDirection = 'column';
      ['statusbar'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.order = '-1'; });
      cfg.order.forEach((id, i) => { const e = document.getElementById(id); if (e) e.style.order = String(i); });
    }
  }
  function changed() { save(); apply(); document.dispatchEvent(new CustomEvent('oq-theme')); }

  // GIF, WebP y PNG se guardan tal cual (así siguen animados); las demás imágenes se achican a JPEG.
  function readBackground(file, cb) {
    if (/^image\/(gif|webp|png)$/i.test(file.type || '') || /\.(gif|webp|png)$/i.test(file.name || '')) {
      if (file.size > MAX_BG) return cb(null, 'big');
      return cb(file);
    }
    readImage(file, (d) => cb(d ? dataUrlToBlob(d) : null));
  }
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

  // Toca tu sonido propio para ese aviso. Devuelve false si no tenés uno (suena el de siempre).
  function playSound(kind) {
    const a = audios[kind || 'matchFound'];
    if (!a) return false;
    try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); return true; } catch (_) { return false; }
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
      <div class="row wrap" style="gap:8px"><label class="btn small" style="cursor:pointer">${t('thUpload')}<input type="file" id="thBgIn" accept="image/*,.gif" style="display:none"></label>
        ${cfg.hasBg ? `<button class="btn small" data-th="bgClear">${t('thRemove')}</button>` : ''}</div>
      ${cfg.hasBg ? `<div class="dim" style="font-size:12px;margin:10px 0 4px">${t('thDim')}</div><input type="range" id="thDim" min="30" max="95" value="${Math.round(cfg.bgDim * 100)}" style="width:100%">` : ''}
      <p class="note">${t('thBgGif')} ${t('thBgNote')}</p>
      <div class="dim" style="font-size:12px;margin:14px 0 6px">${t('thSounds')}</div>
      ${SOUNDS.map((k) => `<div class="row wrap" style="gap:8px;margin-bottom:6px;align-items:center"><span style="flex:1;min-width:120px">${t('snd_' + k)}${cfg.sounds[k] ? ` <small class="dim">· ${esc(cfg.sounds[k])}</small>` : ''}</span>
        <label class="btn small" style="cursor:pointer">${t('thUpload')}<input type="file" class="thSndIn" data-k="${k}" accept="audio/*" style="display:none"></label>
        ${cfg.sounds[k] ? `<button class="btn small" data-th="sndTest" data-v="${k}">&#9654;</button><button class="btn small" data-th="sndClear" data-v="${k}">${t('thRemove')}</button>` : ''}</div>`).join('')}
      <p class="note">${t('thSoundsHelp')}</p>
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
    else if (a === 'bgClear') { cfg.bg = ''; cfg.hasBg = false; setBgBlob(null); mediaDel('bg'); }
    else if (a === 'fontClear') { cfg.fontData = ''; cfg.fontName = ''; if (cfg.font === 'custom') cfg.font = 'classic'; }
    else if (a === 'sndClear') { delete cfg.sounds[v]; setSoundBlob(v, null); mediaDel('snd_' + v); }
    else if (a === 'sndTest') { playSound(v); return; }
    else if (a === 'up' || a === 'down') {
      const i = Number(v); const j = a === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < cfg.order.length) { const o = cfg.order; [o[i], o[j]] = [o[j], o[i]]; }
    } else if (a === 'reset') {
      cfg = Object.assign({}, DEF, { order: PANELS.slice(), sounds: {} });
      setBgBlob(null); mediaDel('bg'); SOUNDS.forEach((k) => { setSoundBlob(k, null); mediaDel('snd_' + k); });
    }
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
      readBackground(e.target.files[0], (b, why) => {
        if (!b) return err(T()(why === 'big' ? 'thTooBigBg' : 'thBadFile'));
        mediaPut('bg', b).then(() => { cfg.bg = ''; cfg.hasBg = true; setBgBlob(b); changed(); }).catch(() => err(T()('thTooBigBg')));
      });
    } else if (e.target.classList && e.target.classList.contains('thSndIn') && e.target.files[0]) {
      const f = e.target.files[0]; const k = e.target.getAttribute('data-k');
      if (SOUNDS.indexOf(k) < 0) return;
      if (f.size > MAX_SOUND) return err(T()('thTooBig'));
      mediaPut('snd_' + k, f).then(() => {
        cfg.sounds[k] = (f.name || 'audio').replace(/\.[^.]+$/, '').slice(0, 24); setSoundBlob(k, f); changed();
      }).catch(() => err(T()('thBadFile')));
    }
  });

  window.OQTheme = { apply, html, playSound, get hasSound() { return !!audios.matchFound; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { apply(); loadMedia(); }); else { apply(); loadMedia(); }
})();
