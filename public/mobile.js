// Open Queue - web del celu. Sin dependencias.
(function () {
  'use strict';
  const { t, esc, fmtTime } = OQ;
  const $ = (id) => document.getElementById(id);

  // ---------- estado ----------
  let ws = null;
  let state = null;
  let stateAt = 0;
  let authed = false;
  let token = null;
  try { token = localStorage.getItem('oq_token'); } catch (_) {}
  let urlCode = new URLSearchParams(location.search).get('c');
  let sentTokenThisConn = false;
  let linkLost = false;
  let reconnectDelay = 1000;

  const S = { ok: false, version: null, champions: [], spells: [], byKey: {}, spellByKey: {} };
  const sheet = { mode: null, champ: null, search: '', cls: '' };
  let queuePick = 0; // modo elegido por vos en el selector
  try { queuePick = Number(localStorage.getItem('oq_queue')) || 0; } catch (_) {}
  let audioCtx = null;
  let keepAudio = null;
  let wakeLock = null;
  let cmdId = 0;

  const POS = {
    es: { top: 'Top', jungle: 'Jungla', middle: 'Mid', bottom: 'ADC', utility: 'Soporte' },
    en: { top: 'Top', jungle: 'Jungle', middle: 'Mid', bottom: 'Bot', utility: 'Support' },
  };

  // ---------- utilidades ----------
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), ms || 3200);
  }
  function applyStatic() {
    document.documentElement.lang = OQ.lang;
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
    $('codeIn').placeholder = '······';
    $('scSearch').placeholder = t('search_ph');
    $('chatIn').placeholder = t('chatPh');
    $('disclaimer').textContent = t('disclaimer');
  }
  function serverElapsedMs(serverTs) {
    // milisegundos desde un instante del reloj del servidor, estimados en este momento
    return (state.now - serverTs) + (Date.now() - stateAt);
  }

  // ---------- sonido / vibración ----------
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {}
  }
  document.addEventListener('touchstart', unlockAudio, { passive: true });
  document.addEventListener('click', unlockAudio);

  function beep(freqs) {
    try {
      unlockAudio();
      if (!audioCtx) return;
      const t0 = audioCtx.currentTime;
      freqs.forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        const s = t0 + i * 0.24;
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.6, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.2);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(s); o.stop(s + 0.22);
      });
    } catch (_) {}
  }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) {} }

  document.addEventListener('oq-theme', () => { if (!$('sheetList').classList.contains('hidden') && $('slTitle').textContent === t('settings')) openList('settings'); });

  function onAlert(a) {
    const own = (k) => !!(window.OQTheme && window.OQTheme.playSound(k)); // sonido propio (Ajustes > Personalizar)
    if (a.kind === 'matchFound') { if (!own('matchFound')) beep([784, 988, 1175, 1568]); vibrate([400, 150, 400, 150, 400]); }
    else if (a.kind === 'yourTurn') { if (!own('yourTurn')) beep([880, 1175]); vibrate([300, 120, 300]); }
    else if (a.kind === 'swap') { if (!own('swap')) beep([660, 880, 660]); vibrate([200, 100, 200, 100, 200]); }
    else if (a.kind === 'chat') { own('chat'); vibrate(60); }
    else if (a.kind === 'autoPicked') { if (!own('autoPick')) beep([988, 784]); toast(`${t('autoPicked')}: ${champName(a.championId)}`, 5000); vibrate([200, 80, 200]); }
    else if (a.kind === 'autoPickFailed') { toast(t('autoPickFailed'), 5000); vibrate([100, 60, 100]); }
    else if (a.kind === 'swapDeclined') { toast(`${t('swapSt_DECLINED')}: ${a.to || ''}`, 3500); vibrate([100, 60, 100]); }
    else if (a.kind === 'invite') { toast(`${t('inviteFrom')} ${a.from || ''}`, 5000); vibrate([100, 60, 100]); }
    else if (a.kind === 'inviteAccepted') toast(`${t('inviteJoined')} ${a.from || ''}`, 3500);
    else if (a.kind === 'prebanFailed') { toast(t('preBanFailed'), 5000); vibrate([100, 60, 100]); }
    else if (a.kind === 'prepickFailed') { toast(t('prePickFailed'), 5000); vibrate([100, 60, 100]); }
  }

  // ---------- mantener activo (experimental) ----------
  function silentWavUrl() {
    const rate = 8000, n = rate; // 1 s
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); v.setUint32(4, 36 + n, true); wr(8, 'WAVE'); wr(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    wr(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  async function setKeepAwake(on) {
    try { localStorage.setItem('oq_keep', on ? '1' : '0'); } catch (_) {}
    if (on) {
      try {
        if (!keepAudio) { keepAudio = new Audio(silentWavUrl()); keepAudio.loop = true; }
        await keepAudio.play();
      } catch (_) {}
      try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
    } else {
      try { if (keepAudio) keepAudio.pause(); } catch (_) {}
      try { if (wakeLock) await wakeLock.release(); } catch (_) {}
      wakeLock = null;
    }
  }
  document.addEventListener('visibilitychange', () => {
    let on = false; try { on = localStorage.getItem('oq_keep') === '1'; } catch (_) {}
    if (on && document.visibilityState === 'visible') setKeepAwake(true);
  });

  // ---------- datos de campeones (Data Dragon) ----------
  async function loadStatic() {
    try {
      const r = await fetch('/api/static?lang=' + OQ.lang);
      const d = await r.json();
      S.ok = !!d.ok; S.version = d.version;
      S.champions = (d.champions || []).slice().sort((a, b) => a.name.localeCompare(b.name, OQ.lang));
      S.spells = d.spells || [];
      S.byKey = {}; S.spellByKey = {};
      S.champions.forEach((c) => { S.byKey[c.key] = c; });
      S.spells.forEach((s) => { S.spellByKey[s.key] = s; });
    } catch (_) {}
    render();
  }
  function champName(k) { return S.byKey[k] ? S.byKey[k].name : (k ? '#' + k : ''); }
  function champImg(key, cls) {
    cls = cls || '';
    if (!key) return `<div class="portrait ${cls}"></div>`;
    const c = S.byKey[key];
    if (!c || !S.version) return `<div class="portrait ${cls}">${esc(key)}</div>`;
    return `<div class="portrait ${cls}"><img alt="${esc(c.name)}" src="https://ddragon.leagueoflegends.com/cdn/${S.version}/img/champion/${esc(c.id)}.png" onerror="this.remove()"></div>`;
  }
  function spellImg(key) {
    const s = S.spellByKey[key];
    if (!s || !S.version) return `<div class="portrait sm">${esc(key || '')}</div>`;
    return `<div class="portrait sm"><img alt="${esc(s.name)}" src="https://ddragon.leagueoflegends.com/cdn/${S.version}/img/spell/${esc(s.id)}.png" onerror="this.remove()"></div>`;
  }

  // ---------- conexión ----------
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  const pending = new Map();
  function cmd(type, extra) { send(Object.assign({ type, id: ++cmdId }, extra || {})); }
  function request(type, extra) {
    return new Promise((resolve) => {
      const id = ++cmdId;
      pending.set(id, resolve);
      send(Object.assign({ type, id }, extra || {}));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, error: 'timeout' }); } }, 12000);
    });
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    sentTokenThisConn = false;
    ws.onopen = () => { reconnectDelay = 1000; };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      handle(m);
    };
    ws.onclose = () => {
      authed = false;
      linkLost = true;
      render();
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.6, 8000);
    };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  }

  function handle(m) {
    if (m.type === 'authRequired') {
      authed = false;
      if (m.reason === 'revoked') { token = null; try { localStorage.removeItem('oq_token'); } catch (_) {} $('authErr').textContent = t('revoked'); }
      if (token && !sentTokenThisConn) { sentTokenThisConn = true; send({ type: 'auth', token }); }
      else if (urlCode) { send({ type: 'auth', code: urlCode }); urlCode = null; }
      else showAuth();
    } else if (m.type === 'authed') {
      authed = true; linkLost = false;
      token = m.token;
      try { localStorage.setItem('oq_token', token); } catch (_) {}
      if (location.search) history.replaceState(null, '', location.pathname);
      $('authErr').textContent = '';
      let keep = false; try { keep = localStorage.getItem('oq_keep') === '1'; } catch (_) {}
      if (keep) setKeepAwake(true);
      render();
    } else if (m.type === 'authError') {
      if (token && sentTokenThisConn && m.reason === 'invalid') {
        token = null; try { localStorage.removeItem('oq_token'); } catch (_) {}
        if (urlCode) { const c = urlCode; urlCode = null; send({ type: 'auth', code: c }); return; }
      }
      $('authErr').textContent = m.reason === 'locked' ? t('locked') : t('badCode');
      showAuth();
    } else if (m.type === 'state') {
      state = m.state; stateAt = Date.now();
      render();
    } else if (m.type === 'alert') {
      onAlert(m.alert);
    } else if (m.type === 'result') {
      const r = m.result || {};
      if (pending.has(m.id)) { pending.get(m.id)(r); pending.delete(m.id); }
      if (r.ok === false && !['runeData', 'saveRunes'].includes(m.cmd) && !(m.cmd === 'useRunes' && r.error === 'full')) {
        toast(r.error === 'notHost' ? t('errNotHost') : r.error === 'changeFail' ? t('errChangeFail') : r.error === 'bansfirst' ? t('pickFirstBans') : r.error === 'rejected' ? t('errRejected') : t('errGeneric'), 3500);
      }
    }
  }

  function showAuth() {
    $('authView').classList.remove('hidden');
    $('mainView').classList.add('hidden');
  }

  // ---------- render ----------
  function render() {
    if (!authed || !state) { if (!authed && !token && !urlCode) showAuth(); return; }
    $('authView').classList.add('hidden');
    $('mainView').classList.remove('hidden');
    renderStatus();
    renderAuto();
    renderPhase();
    renderPre();
    renderChat();
    renderSheets();
    tick();
  }

  function renderStatus() {
    const on = state.connected;
    const label = on ? t('phase_' + state.phase) : t('lolOff');
    $('statusbar').innerHTML = `<span class="dot ${on ? 'on' : ''}"></span><span class="dim" style="font-size:13px">${on ? t('lolOn') : ''}</span><span class="phase" style="${on ? '' : 'font-family:var(--body);text-transform:none;letter-spacing:0;font-weight:400;font-size:13px'}">${esc(label)}</span>`;
  }

  function renderAuto() {
    const a = state.settings.autoAccept;
    const max = state.maxAutoDelay;
    const steps = [0, 2, 4, 6, max];
    const chips = steps.map((s) => {
      const lbl = s === 0 ? t('autoNow') : s === max ? `${t('autoMax')} (${s}${t('seconds')})` : `${s}${t('seconds')}`;
      return `<button class="chip ${Number(a.delay) === s ? 'on' : ''}" data-act="delay" data-v="${s}">${esc(lbl)}</button>`;
    }).join('');
    const ai = !!(state.settings.autoInvite && state.settings.autoInvite.enabled);
    $('autoCard').innerHTML = `<div class="card">
      <div class="row"><h2>${t('autoTitle')}</h2><span class="spacer"></span><span class="dim" style="font-size:12px">${a.enabled ? t('autoOn') : t('autoOff')}</span><div class="toggle ${a.enabled ? 'on' : ''}" data-act="toggleAuto"></div></div>
      <div style="margin-top:12px" class="${a.enabled ? '' : 'dim'}"><div class="dim" style="font-size:12px;margin-bottom:6px">${t('autoDelay')}</div><div class="chips">${chips}</div></div>
      <p class="note">${t('autoNote')}</p></div>
      <div class="card"><div class="row"><h2>${t('inviteTitle')}</h2><span class="spacer"></span><div class="toggle ${ai ? 'on' : ''}" data-act="toggleInvite"></div></div>
      <p class="note">${t('inviteHelp')}</p>
      ${(state.invites || []).map((v) => `<div class="row" style="gap:8px;margin-top:8px"><span style="flex:1">${esc(v.from || '?')}</span><button class="btn primary small" data-act="invAccept" data-k="${esc(v.id)}">${t('accept')}</button><button class="btn small" data-act="invDecline" data-k="${esc(v.id)}">${t('decline')}</button></div>`).join('')}</div>`;
  }

  // Escribe un slot de Swiftplay y avisa el motivo si el juego lo rechaza.
  async function slotCmd(o) {
    const r = await request('setQuickSlot', o);
    if (!r || !r.ok) toast(failText(r), 6000);
    return r;
  }
  function failText(r) {
    if (r && r.error === 'samespell') return t('errSameSpell');
    return t('errRejected') + (r && r.message ? ': ' + r.message : (r && r.status ? ` (${r.status})` : ''));
  }

  function rememberQueue(q) {
    queuePick = q;
    try { localStorage.setItem('oq_queue', String(q)); } catch (_) {}
  }

  function queueOptions() {
    const ids = state.queues.map((q) => q.id);
    const cur = ids.includes(queuePick) ? queuePick : (ids.includes(Number(state.lobbyQueueId)) ? state.lobbyQueueId : (ids[0] || 0));
    return state.queues.map((q) => `<option value="${q.id}" ${Number(cur) === q.id ? 'selected' : ''}>${esc(OQ.qname(q))}</option>`).join('');
  }

  // Modos con rol principal/secundario
  const ROLE_QUEUES = [400, 420, 440];
  let lastLobbyQ = null;

  function roleOptions() {
    const keys = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'FILL'];
    return [''].concat(keys).map((k) => `<option value="${k}">${k === '' ? '—' : k === 'FILL' ? t('roleFill') : esc(POS[OQ.lang][k.toLowerCase()])}</option>`).join('');
  }

  function queueCardHtml() {
    return `<div class="card"><h2>${t('queueTitle')}</h2>
      <div class="dim" style="font-size:12px;margin-bottom:6px">${t('queueMode')}</div>
      <select id="queueSel">${queueOptions()}</select>
      <div id="rolesBox"></div>
      <button class="btn primary block" style="margin-top:12px" data-act="search">${t('search')}</button>
      <div id="createBox"></div>
      <div id="leaveBox"></div></div>`;
  }

  // Actualiza solo las partes que cambian: el selector de modo NUNCA se vuelve a dibujar mientras estás en esta pantalla.
  function updateQueueCard(p) {
    const sel = $('queueSel');
    const ids = state.queues.map((q) => q.id).join(',');
    if (sel.getAttribute('data-ids') !== ids) {
      const keep = Number(sel.value) || queuePick;
      if (keep) queuePick = keep;
      sel.innerHTML = queueOptions();
      sel.setAttribute('data-ids', ids);
    }
    // si en el cliente de la PC cambiaste de sala, el selector la acompaña
    const lq = Number(state.lobbyQueueId) || null;
    if (lq !== lastLobbyQ) {
      lastLobbyQ = lq;
      if (lq && state.queues.some((q) => q.id === lq)) { sel.value = String(lq); rememberQueue(lq); }
    }
    const cbox = $('createBox');
    const wantCreate = p === 'None';
    if (!!cbox.firstChild !== wantCreate) cbox.innerHTML = wantCreate ? `<button class="btn block dashed" style="margin-top:8px" data-act="createLobby">${t('createLobby')}</button><p class="note" style="margin-top:6px">${t('createLobbyHelp')}</p>` : '';
    const leave = $('leaveBox');
    const wantLeave = p === 'Lobby';
    if (!!leave.firstChild !== wantLeave) leave.innerHTML = wantLeave ? `<button class="btn block dashed" style="margin-top:8px" data-act="openFriends">+ ${t('inviteFriends')}</button><button class="btn block" style="margin-top:8px" data-act="leave">${t('leaveLobby')}</button>` : '';
    // roles
    const box = $('rolesBox');
    const wantRoles = ROLE_QUEUES.includes(Number(sel.value));
    if (!!box.firstChild !== wantRoles) {
      box.innerHTML = wantRoles ? `<div class="row" style="gap:8px;margin-top:12px"><div style="flex:1"><div class="dim" style="font-size:12px;margin-bottom:6px">${t('roleFirst')}</div><select id="roleFirst">${roleOptions()}</select></div>
        <div style="flex:1"><div class="dim" style="font-size:12px;margin-bottom:6px">${t('roleSecond')}</div><select id="roleSecond">${roleOptions()}</select></div></div>` : '';
    }
    if (wantRoles) {
      const rl = (state.settings && state.settings.roles) || {};
      const f = $('roleFirst'); const sc = $('roleSecond');
      if (f && document.activeElement !== f && f.value !== (rl.first || '')) f.value = rl.first || '';
      if (sc && document.activeElement !== sc && sc.value !== (rl.second || '')) sc.value = rl.second || '';
    }
  }

  function renderPhase() {
    const el = $('phaseArea');
    const p = state.phase;
    if (p !== 'ChampSelect' || !state.connected) el.removeAttribute('data-cs');
    if (!state.connected) { el.innerHTML = `<div class="card"><p style="margin:0">${t('lolOff')}</p></div>`; return; }

    if (p === 'None' || p === 'Lobby') {
      if (!$('queueCard')) {
        el.innerHTML = `<div id="queueCard">${queueCardHtml()}</div><div id="swiftArea"></div>`;
        $('queueSel').setAttribute('data-ids', state.queues.map((q) => q.id).join(','));
      }
      updateQueueCard(p);
      const sw = $('swiftArea');
      const html = p === 'Lobby' ? swiftHtml() : '';
      if (sw.getAttribute('data-h') !== html) { sw.innerHTML = html; sw.setAttribute('data-h', html); }
    } else if (p === 'Matchmaking') {
      el.innerHTML = `<div class="card"><h2>${t('inQueue')}</h2>
        <div class="bignum" id="qTime">0:00</div>
        <div class="dim" id="qEst" style="font-size:13px"></div>
        <button class="btn block" style="margin-top:12px" data-act="cancel">${t('cancel')}</button></div>`;
    } else if (p === 'ReadyCheck') {
      const rc = state.readyCheck || {};
      const a = state.settings.autoAccept;
      if (rc.response === 'Declined') {
        el.innerHTML = `<div class="card"><h2>${t('declined')}</h2></div>`;
      } else if (rc.accepted || rc.response === 'Accepted') {
        el.innerHTML = `<div class="card"><h2>${t('accepted')}</h2></div>`;
      } else {
        el.innerHTML = `<div class="card"><h2>${t('phase_ReadyCheck')}</h2>
          <button class="btn primary block huge" data-act="accept" style="margin-top:8px">${t('accept')}</button>
          <div class="dim" id="rcAuto" style="text-align:center;margin-top:10px;font-size:13px">${a.enabled ? '' : ''}</div>
          <button class="btn block small" style="margin-top:10px" data-act="decline">${t('decline')}</button></div>`;
      }
    } else if (p === 'ChampSelect') {
      const csh = state.champSelect ? champSelectHtml(state.champSelect) : '';
      if (el.getAttribute('data-cs') !== csh) { el.innerHTML = csh; el.setAttribute('data-cs', csh); } // no se redibuja si no cambió: evita el parpadeo de los campeones
    } else {
      el.innerHTML = `<div class="card"><h2>${t('phase_' + p)}</h2></div>`;
    }
  }

  // Pedir un cambio: arriba hay un botón por tipo (orden de pick / rol / campeón); al activarlo, tocás al compañero.
  let swapMode = null;
  const SWAP_KINDS = [['pickOrder', 'reqOrder'], ['position', 'reqRole'], ['champion', 'reqChamp']];
  function swapOptFor(cs, kind, cellId) { return ((cs.swapOpts || {})[kind] || []).find((x) => x.cellId === cellId); }
  function swapBarHtml(cs) {
    const avail = SWAP_KINDS.filter(([k]) => ((cs.swapOpts || {})[k] || []).length);
    if (!avail.length) { swapMode = null; return ''; }
    if (!avail.some(([k]) => k === swapMode)) swapMode = null;
    const ong = cs.ongoingSwap && cs.ongoingSwap.mine
      ? `<p class="note" style="margin:8px 0 0">${esc(cs.ongoingSwap.from)} ⇄ ${esc(cs.ongoingSwap.to)} · ${esc(t('swapSt_' + cs.ongoingSwap.state) === 'swapSt_' + cs.ongoingSwap.state ? cs.ongoingSwap.state : t('swapSt_' + cs.ongoingSwap.state))}</p>` : '';
    // Pedidos que ya enviaste: siempre se pueden cancelar desde acá, aunque estés en otro modo de cambio.
    const sent = [];
    SWAP_KINDS.forEach(([k, lbl]) => ((cs.swapOpts || {})[k] || []).filter((o) => o.sent).forEach((o) => {
      const pl = (cs.myTeam || []).find((x) => x.cellId === o.cellId) || {};
      const key = pl.championId || pl.intent;
      sent.push(`<div class="row" style="gap:8px;margin-top:8px;align-items:center">${key ? champImg(key) : ''}<span style="flex:1;min-width:0"><b>${t(lbl)}</b><br><small class="dim">${esc(key ? champName(key) : (POS[OQ.lang][pl.position] || '#' + (o.cellId + 1)))}</small></span><button class="btn small" data-act="swapCancel" data-kind="${k}" data-id="${o.id}">${t('cancelReq')}</button></div>`);
    }));
    return `<div class="card"><div class="row wrap" style="gap:8px">${avail.map(([k, lbl]) =>
      `<button class="btn small ${swapMode === k ? 'primary' : ''}" style="flex:1" data-act="swapMode" data-kind="${k}">${t(lbl)}</button>`).join('')}</div>
      ${swapMode ? `<p class="note" style="margin:8px 0 0">${t('swapPickMate')}</p>` : ''}${sent.join('')}${ong}</div>`;
  }

  function slotHtml(pl, ally, cs) {
    const key = pl.championId || pl.intent;
    const ghost = !pl.championId && pl.intent;
    const pos = POS[OQ.lang][pl.position] || '';
    const o = ally && cs && swapMode && !pl.isMe ? swapOptFor(cs, swapMode, pl.cellId) : null;
    const cls = `slot ${pl.isMe ? 'me' : ''} ${swapMode && ally ? (o ? 'swappable' : 'dimmed') : ''}`;
    const attrs = o ? ` data-act="${o.sent ? 'swapCancel' : 'swapReq'}" data-kind="${swapMode}" data-id="${o.id}"` : '';
    const tag = o ? `<span class="spacer"></span><small class="reqtag">${o.sent ? t('cancelReq') : t('reqTap')}</small>` : '';
    return `<div class="${cls}"${attrs}>${champImg(key, ghost ? 'ghost' : '')}
      <div class="meta"><b>${esc(key ? champName(key) : '—')}</b>${esc(pos)}${pl.isMe ? ` · ${t('you')}` : ''}</div>${tag}</div>`;
  }

  // Opciones iniciales de ARAM Mayhem: se elige 1 de 2 antes de que el cliente asigne una al azar.
  function subsetHtml(cs) {
    const me = (cs.myTeam || []).find((p) => p.isMe) || {};
    if (!cs.subset || !cs.subset.length || !cs.myPickAction || cs.myPickAction.completed || (me.championId && cs.phase !== 'BAN_PICK')) return '';
    return `<div class="card"><h3 style="margin:0 0 8px;font-size:12px;color:var(--dim)">${t('subsetTitle')}</h3>
      <div class="row" style="gap:10px">${cs.subset.map((c) => `<button class="pill" style="flex:1;flex-direction:column;padding:10px" data-act="subsetPick" data-champ="${c}">${champImg(c)}<span>${esc(champName(c))}</span></button>`).join('')}</div></div>`;
  }

  function champSelectHtml(cs) {
    let h = '';
    // En modos sin baneos (ARAM, Mayhem) el cliente igual llama BAN_PICK a la fase: no se muestra "Baneos".
    const phaseKey = cs.phase === 'BAN_PICK' && !cs.hasBans ? 'PICK_ONLY' : cs.phase;
    const phaseLbl = t('phase' + phaseKey);
    const hasTimer = cs.timeLeftMs != null && !cs.isInfinite;
    h += `<div class="card"><div class="row"><h2>${esc(phaseLbl === 'phase' + phaseKey ? cs.phase : phaseLbl)}</h2><span class="spacer"></span><span class="bignum" id="csTimer">${hasTimer ? '' : '∞'}</span></div>${hasTimer ? '<div class="bar"><i id="csBar"></i></div>' : ''}</div>`;

    h += swapsHtml(cs);
    h += subsetHtml(cs);
    h += swapBarHtml(cs);

    if (cs.benchEnabled) {
      // ARAM / Mayhem: no se puede elegir cualquier campeón; solo las opciones iniciales (arriba) y el banco.
    } else if (cs.myTurn) {
      h += `<div class="turn">${cs.myTurn.type === 'ban' ? t('yourTurnBan') : t('yourTurnPick')}</div>`;
      h += `<button class="btn primary block" style="margin-bottom:12px" data-act="openChamp" data-mode="turn">${cs.myTurn.type === 'ban' ? t('chooseBan') : t('chooseChamp')}</button>`;
    } else if (cs.myPickAction && !cs.myPickAction.completed) {
      h += `<button class="btn block" style="margin-bottom:${cs.bansDone ? 12 : 4}px" data-act="openChamp" data-mode="hover" ${cs.bansDone ? '' : 'disabled'}>${t('hoverChamp')}</button>`;
      if (!cs.bansDone) h += `<p class="note" style="margin:0 0 12px">${t('pickFirstBans')}</p>`;
    }
    h += recommendHtml(cs);
    if (cs.benchEnabled) h += benchHtml(cs);
    else if (!cs.hasActions) h += `<div class="card"><p class="note" style="margin:0">${t('noPool')}</p></div>`;

    const i = cs.info || {};
    const lines = [];
    if (i.pickNumber) {
      const before = i.picksBefore === 0 ? t('noneBefore') : `${i.picksBefore} ${t('picksBefore')}`;
      lines.push(`${t('pickOrder')} <b>#${i.pickNumber}</b>/${i.pickTotal} · ${before}`);
    }
    if (cs.hasBans && i.banNumber && i.bansBefore > 0) lines.push(`${t('banOrder')} <b>#${i.banNumber}</b> · ${i.bansBefore} ${t('picksBefore')}`);
    if (lines.length) h += `<div class="card" style="padding:10px 14px">${lines.map((l) => `<div style="font-size:13.5px">${l}</div>`).join('')}</div>`;

    const bansOf = (arr) => arr.filter((b) => b > 0).map((b) => champImg(b, 'sm')).join('');
    // En ARAM/Mayhem no se ven las elecciones rivales: no se muestra esa columna.
    h += `<div class="card"><div class="teams ${cs.benchEnabled ? 'one' : ''}">
      <div class="team"><h3>${t('yourTeam')}</h3>${cs.myTeam.map((p) => slotHtml(p, true, cs)).join('')}</div>
      ${cs.benchEnabled ? '' : `<div class="team"><h3>${t('enemyTeam')}</h3>${cs.theirTeam.map((p) => slotHtml(p, false)).join('')}</div>`}</div>
      ${(cs.hasBans && (cs.bans.my.some((b) => b > 0) || cs.bans.their.some((b) => b > 0))) ? `<h3 style="font-size:12px;color:var(--dim);margin-top:10px">${t('bans')}</h3><div class="row wrap" style="gap:14px"><div class="bans">${bansOf(cs.bans.my)}</div><div class="bans">${bansOf(cs.bans.their)}</div></div>` : ''}</div>`;

    const me = cs.myTeam.find((p) => p.isMe) || {};
    const noRunes = [2400, 3270].includes(Number(cs.queueId)) || cs.subsetPicks || state.gameMode === 'KIWI'; // ARAM Mayhem no tiene runas
    const curRune = (state.runes.pages.find((p) => p.id === state.runes.currentId) || {}).name || '—';
    h += `<div class="card"><div class="row wrap" style="gap:8px">
      <button class="pill" data-act="openSpell" data-slot="1">${spellImg(me.spell1Id)}<span><small>${t('spells')} 1</small>${esc((S.spellByKey[me.spell1Id] || {}).name || me.spell1Id || '—')}</span></button>
      <button class="pill" data-act="openSpell" data-slot="2">${spellImg(me.spell2Id)}<span><small>${t('spells')} 2</small>${esc((S.spellByKey[me.spell2Id] || {}).name || me.spell2Id || '—')}</span></button>
      ${noRunes ? '' : `<button class="pill" data-act="openRune" style="flex:1;min-width:140px"><span><small>${t('runes')}</small>${esc(curRune)}</span></button>`}
      ${(me.championId || me.intent) ? `<button class="pill" data-act="openSkins" style="flex:1;min-width:140px"><span><small>${t('skins')}</small>${esc(skinLabel(me))}</span></button>` : ''}</div></div>`;
    h += `<button class="btn block danger" style="margin-top:4px" data-act="dodge">${t('dodge')}</button><p class="note" style="margin:6px 0 0">${t('dodgeHelp')}</p>`;
    return h;
  }

  // ---------- hechizos de invocador por modo ----------
  // Respaldo por si el cliente no informa los modos de cada hechizo.
  const SPELLS_FALLBACK = { CLASSIC: [1, 3, 4, 6, 7, 11, 12, 14, 21], ARAM: [1, 3, 4, 6, 7, 13, 14, 21, 32] };
  function spellMode() {
    const cs = state && state.champSelect;
    const gm = (state && state.gameMode) || '';
    const q = state && Number(state.lobbyQueueId);
    if ((cs && cs.benchEnabled) || q === 450 || q === 2400 || gm === 'ARAM' || gm === 'KIWI') return 'ARAM';
    return 'CLASSIC';
  }
  function spellOptions() {
    const mode = spellMode();
    const sm = state && state.spellModes;
    let list = [];
    if (sm) {
      const keys = mode === 'ARAM' ? [state.gameMode === 'KIWI' ? 'KIWI' : 'ARAM', 'ARAM'] : ['CLASSIC'];
      for (const k of keys) {
        list = S.spells.filter((x) => (sm[x.key] || []).includes(k));
        if (list.length >= 5) break;
      }
    }
    if (list.length < 5 || list.length > 12) list = S.spells.filter((x) => SPELLS_FALLBACK[mode].includes(x.key));
    return list;
  }

  function skinLabel(me) {
    const sk = state.skins.find((x) => x.id === me.skinId);
    return sk ? sk.name : t('skinDefault');
  }

  function cellLabel(cs, cellId) {
    const pl = cs.myTeam.concat(cs.theirTeam).find((p) => p.cellId === cellId);
    if (!pl) return '';
    const pos = POS[OQ.lang][pl.position] || '';
    const ch = pl.championId ? champName(pl.championId) : '';
    return [pos, ch].filter(Boolean).join(' · ');
  }

  function swapsHtml(cs) {
    const sw = cs.swaps || {};
    const rows = [];
    [['pickOrder', 'swapPickOrder'], ['position', 'swapPosition'], ['champion', 'swapChampion']].forEach(([kind, key]) => {
      (sw[kind] || []).forEach((x) => {
        const who = cellLabel(cs, x.cellId);
        rows.push(`<div class="turn" style="animation:none;text-align:left;font-size:15px;letter-spacing:.06em;margin-bottom:10px">
          <div>${t(key)}${who ? ` <span class="dim">${t('swapWith')} ${esc(who)}</span>` : ''}</div>
          <div class="row" style="margin-top:10px"><button class="btn primary" style="flex:1" data-act="swap" data-kind="${kind}" data-id="${x.id}" data-accept="1">${t('swapAccept')}</button>
          <button class="btn" style="flex:1" data-act="swap" data-kind="${kind}" data-id="${x.id}" data-accept="0">${t('swapDecline')}</button></div></div>`);
      });
    });
    return rows.join('');
  }

  function benchHtml(cs) {
    const me = cs.myTeam.find((p) => p.isMe) || {};
    const cells = cs.bench.map((k) => `<div class="cell" data-act="benchSwap" data-k="${k}">${champImg(k)}<span>${esc(champName(k))}</span></div>`).join('');
    return `<div class="card"><div class="row"><h2>${t('bench')} (${cs.bench.length})</h2><span class="spacer"></span>
      ${cs.allowRerolling ? `<button class="btn small" data-act="reroll" ${cs.rerolls > 0 ? '' : 'disabled'}>${t('reroll')} (${cs.rerolls})</button>` : ''}</div>
      <div class="row" style="margin:10px 0">${champImg(me.championId)}<div><b>${esc(champName(me.championId))}</b></div></div>
      <p class="note" style="margin:0 0 6px">${t('benchHelp')}</p><div class="grid">${cells}</div></div>`;
  }

  function renderPre() {
    const el = $('preCard');
    if (!state.connected || ['InProgress', 'GameStart', 'Reconnect', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'].includes(state.phase)) { el.innerHTML = ''; return; }
    const id = state.settings.prePick.championId;
    const bid = state.settings.preBan && state.settings.preBan.championId;
    el.innerHTML = `<div class="card"><h2>${t('prePick')}</h2>
      <div class="row">${id ? champImg(id) : ''}<div style="flex:1"><div>${id ? esc(champName(id)) : `<span class="dim">${t('prePickNone')}</span>`}</div></div>
      <button class="btn small" data-act="openChamp" data-mode="prepick">${t('chooseChamp')}</button>
      ${id ? `<button class="btn small" data-act="clearPre">${t('prePickClear')}</button>` : ''}</div>
      <p class="note">${t('prePickHelp')}</p></div>
      <div class="card"><div class="row"><h2>${t('cosmetics')}</h2><span class="spacer"></span><button class="btn small" data-act="openCosmetics">${t('coOpen')}</button></div></div>
      <div class="card"><h2>${t('preBan')}</h2>
      <div class="row">${bid ? champImg(bid) : ''}<div style="flex:1"><div>${bid ? esc(champName(bid)) : `<span class="dim">${t('preBanNone')}</span>`}</div></div>
      <button class="btn small" data-act="openChamp" data-mode="preban">${t('chooseChamp')}</button>
      ${bid ? `<button class="btn small" data-act="clearPreBan">${t('prePickClear')}</button>` : ''}</div>
      <p class="note">${t('preBanHelp')}</p></div>
      ${favoritesHtml()}`;
  }

  // Favoritos (hasta 3) y pick automático en el último segundo.
  function favoritesHtml() {
    const f = state.settings.favorites || { ids: [] };
    const ids = f.ids || [];
    const slots = [0, 1, 2].map((i) => {
      const k = ids[i];
      return `<button class="pill" style="flex:1;flex-direction:column;padding:8px;min-width:0" data-act="openFav" data-i="${i}">${k ? champImg(k) : '<div class="portrait"></div>'}<span style="font-size:11px">${k ? esc(champName(k)) : '+'}</span></button>`;
    }).join('');
    return `<div class="card"><h2>${t('favorites')}</h2>
      <div class="row" style="gap:8px">${slots}</div>
      ${ids.length ? `<button class="btn small" style="margin-top:8px" data-act="clearFavs">${t('favClear')}</button>` : ''}
      <div class="row" style="margin-top:12px"><span style="flex:1">${t('autoPick')}</span><div class="toggle ${f.autoPick ? 'on' : ''}" data-act="toggleAutoPick"></div></div>
      ${f.autoPick ? `<div class="chips" style="margin-top:8px"><button class="chip ${f.when !== 'start' ? 'on' : ''}" data-act="autoPickWhen" data-v="end">${t('autoPickEnd')}</button><button class="chip ${f.when === 'start' ? 'on' : ''}" data-act="autoPickWhen" data-v="start">${t('autoPickStart')}</button></div>` : ''}
      <p class="note" style="margin-top:4px">${t(f.when === 'start' ? 'autoPickHelpStart' : 'autoPickHelp')}</p>
      <div class="row" style="margin-top:10px"><span style="flex:1">${t('useHistory')}</span><div class="toggle ${f.useHistory ? 'on' : ''}" data-act="toggleHistory"></div></div>
      <p class="note" style="margin-top:4px">${t('useHistoryHelp')}</p></div>`;
  }

  // En el champ select: tus mejores campeones para tu línea según tus partidas (si lo activaste).
  function recommendHtml(cs) {
    const f = state.settings.favorites || {};
    const rec = (cs.recommend || []).filter((x) => !bannedKeys().has(x.championId)).slice(0, 4);
    const pickOpen = cs.myPickAction && !cs.myPickAction.completed && !cs.benchEnabled;
    let h = '';
    if (f.useHistory && rec.length && pickOpen) {
      h += `<div class="card"><h3 style="margin:0 0 8px;font-size:12px;color:var(--dim)">${t('recTitle')}</h3><div class="row" style="gap:8px">${rec.map((x) => {
        const g = x.games || x.gamesAll; const w = x.games ? x.wins : x.winsAll;
        return `<button class="pill" style="flex:1;flex-direction:column;padding:6px;min-width:0" data-act="recHover" data-k="${x.championId}">${champImg(x.championId)}<span style="font-size:11px">${g ? `${w}V ${g - w}D` : t('recMastery')}</span></button>`;
      }).join('')}</div></div>`;
    }
    if (f.autoPick && pickOpen) h += `<p class="note" style="margin:0 0 10px">${t(f.when === 'start' ? 'autoPickOnStart' : 'autoPickOn')}</p>`;
    return h;
  }

  function renderChat() {
    const card = $('chatCard');
    const show = state.connected && (state.phase === 'ChampSelect' || (['Lobby', 'Matchmaking', 'ReadyCheck'].includes(state.phase) && state.chatReady));
    card.classList.toggle('hidden', !show);
    if (!show) return;
    const box = $('chatMsgs');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const chatHtml = state.chat.map((m) => {
      const pos = m.pos ? (POS[OQ.lang][m.pos.toLowerCase()] || '') : '';
      // Solo el ícono del campeón y la línea (sin el nombre del campeón: es mucho texto).
      const who = (m.champId || pos) ? `<span class="chwho">${m.champId ? champImg(m.champId) : ''}${pos ? `<span>${esc(pos)}</span>` : ''}</span>` : '';
      const name = m.name || (m.allyN ? t('ally') + ' ' + m.allyN : '');
      return `<div class="m ${m.mine ? 'mine' : ''}">${name ? `<b>${esc(name)}</b>` : ''}${who}${esc(m.body)}</div>`;
    }).join('');
    if (box._h !== chatHtml) { box.innerHTML = chatHtml; box._h = chatHtml; if (atBottom) box.scrollTop = box.scrollHeight; }
  }

  // ---------- temporizadores ----------
  function tick() {
    if (!state || !authed) return;
    const cs = state.champSelect;
    if (state.phase === 'ChampSelect' && cs && cs.timeLeftMs != null && !cs.isInfinite) {
      const left = Math.max(0, cs.timeLeftMs - serverElapsedMs(cs.at));
      const tm = $('csTimer'), bar = $('csBar');
      if (tm) tm.textContent = Math.ceil(left / 1000) + t('seconds');
      if (bar && cs.totalMs) bar.style.width = Math.min(100, (left / cs.totalMs) * 100) + '%';
    }
    if (state.phase === 'Matchmaking' && state.search) {
      const el = $('qTime');
      if (el) el.textContent = fmtTime(state.search.timeInQueue + serverElapsedMs(state.search.at) / 1000);
      const est = $('qEst');
      if (est && state.search.estimated) est.textContent = `${t('estimated')}: ${fmtTime(state.search.estimated)}`;
    }
    if (state.phase === 'ReadyCheck' && state.readyCheck) {
      const el = $('rcAuto');
      const a = state.settings.autoAccept;
      if (el) {
        if (a.enabled) {
          const rem = Math.max(0, a.delay - serverElapsedMs(state.readyCheck.startedAt) / 1000);
          el.textContent = `${t('autoWill')} · ${rem.toFixed(1)}${t('seconds')}`;
        } else el.textContent = '';
      }
    }
  }
  setInterval(tick, 250);

  // ---------- hojas (selectores) ----------
  function norm(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  // Campeones apagados en la grilla. Para banear solo se apagan los ya baneados.
  function disabledKeys() {
    const cs = state && state.champSelect;
    const d = new Set();
    if (sheet.mode === 'qslot') {
      const own = state && state.owned;
      if (own && own.length) { const ok = new Set(own); S.champions.forEach((c) => { if (!ok.has(c.key)) d.add(c.key); }); }
      return d;
    }
    if (!cs || sheet.mode === 'prepick' || sheet.mode === 'preban' || sheet.mode === 'fav') return d;
    bannedKeys().forEach((b) => d.add(b));
    const isBan = sheet.mode === 'turn' && cs.myTurn && cs.myTurn.type === 'ban';
    if (!isBan) {
      cs.myTeam.concat(cs.theirTeam).forEach((p) => { if (p.championId > 0 && !p.isMe) d.add(p.championId); });
      if (cs.pickable && cs.pickable.length) {
        const ok = new Set(cs.pickable);
        S.champions.forEach((c) => { if (!ok.has(c.key)) d.add(c.key); });
      }
    }
    return d;
  }

  function bannedKeys() {
    const cs = state && state.champSelect;
    if (!cs) return new Set();
    return new Set([].concat(cs.banned || [], cs.bans.my, cs.bans.their).map(Number).filter((b) => b > 0));
  }

  function openChampSheet(mode, qi) {
    if (mode === 'fav') {
      sheet.mode = 'fav'; sheet.qi = qi;
      const f = (state.settings.favorites && state.settings.favorites.ids) || [];
      sheet.champ = f[qi] || null; sheet.search = ''; sheet.cls = '';
      $('scSearch').value = '';
      $('sheetChamp').classList.remove('hidden');
      renderSheets();
      return;
    }
    sheet.mode = mode;
    if (mode === 'qslot') {
      sheet.qi = qi;
      const sl = state.lobby && state.lobby.slots[qi];
      sheet.champ = sl ? sl.championId : null; sheet.search = ''; sheet.cls = '';
      $('scSearch').value = '';
      $('sheetChamp').classList.remove('hidden');
      renderSheets();
      return;
    }
    const cs = state.champSelect;
    const banTurn = mode === 'turn' && cs && cs.myTurn && cs.myTurn.type === 'ban';
    sheet.champ = mode === 'prepick' ? state.settings.prePick.championId
      : mode === 'preban' ? state.settings.preBan.championId
      : banTurn ? null // en un ban nunca se arranca con un campeón marcado
      : (cs && cs.myTurn && cs.myTurn.championId) || (cs && cs.myPickAction && cs.myPickAction.championId) || null;
    if (sheet.champ && disabledKeys().has(sheet.champ)) sheet.champ = null; // nunca arranca marcado un campeón baneado o tomado
    sheet.search = ''; sheet.cls = '';
    $('scSearch').value = '';
    $('sheetChamp').classList.remove('hidden');
    renderSheets();
  }

  function renderSheets() {
    if ($('sheetChamp').classList.contains('hidden')) return;
    const cs = state && state.champSelect;
    // si el turno terminó, la hoja de "turno" pasa a modo "mostrar"
    if (sheet.mode === 'turn' && !(cs && cs.myTurn)) sheet.mode = 'hover';
    if (sheet.mode === 'hover' && !(cs && cs.myPickAction && !cs.myPickAction.completed)) { closeSheets(); return; }
    if (sheet.mode === 'turn' && cs.myTurn && cs.myTurn.type === 'pick' && !sheet.champ && cs.myTurn.championId && !bannedKeys().has(cs.myTurn.championId)) sheet.champ = cs.myTurn.championId;

    if (sheet.mode === 'qslot' && !(state && state.lobby && state.lobby.quickPlay)) { closeSheets(); return; }
    const isBan = sheet.mode === 'turn' && cs && cs.myTurn && cs.myTurn.type === 'ban';
    $('scTitle').textContent = sheet.mode === 'fav' ? `${t('favorites')} ${sheet.qi + 1}` : sheet.mode === 'prepick' ? t('prePick') : sheet.mode === 'preban' ? t('preBan') : isBan ? t('chooseBan') : t('chooseChamp');
    $('scNoData').textContent = S.ok ? '' : t('noData');

    const classes = ['Fighter', 'Tank', 'Mage', 'Assassin', 'Marksman', 'Support'];
    $('scChips').innerHTML = `<button class="chip ${sheet.cls === '' ? 'on' : ''}" data-act="cls" data-v="">${t('all')}</button>` +
      classes.map((c) => `<button class="chip ${sheet.cls === c ? 'on' : ''}" data-act="cls" data-v="${c}">${t('cls_' + c)}</button>`).join('');

    const off = disabledKeys();
    const banSet = (sheet.mode === 'turn' || sheet.mode === 'hover') ? bannedKeys() : new Set();
    if (sheet.champ && off.has(sheet.champ)) sheet.champ = null;
    let items = S.champions.length ? S.champions : ((cs && cs.pickable) || []).map((k) => ({ key: k, name: String(k), tags: [] }));
    const q = norm(sheet.search.trim());
    items = items.filter((c) => (!sheet.cls || (c.tags || []).includes(sheet.cls)) && (!q || norm(c.name).includes(q)));
    const gridHtml = items.map((c) => {
      const isOff = off.has(c.key);
      const isBan = isOff && banSet.has(c.key);
      return `<div class="cell ${sheet.champ === c.key ? 'sel' : ''} ${isOff ? 'off' : ''} ${isBan ? 'ban' : ''}" data-act="pickCell" data-k="${c.key}"${isOff ? ' aria-disabled="true"' : ''}>${champImg(c.key)}<span>${esc(c.name)}</span>${isBan ? `<em class="bantag">${t('bannedTag')}</em>` : ''}</div>`;
    }).join('');
    const gridEl = $('scGrid');
    if (gridEl._h !== gridHtml) { gridEl.innerHTML = gridHtml; gridEl._h = gridHtml; }

    const btn = $('scConfirm');
    if (sheet.mode === 'prepick' || sheet.mode === 'preban' || sheet.mode === 'qslot' || sheet.mode === 'fav') { btn.textContent = t('confirm'); btn.disabled = !sheet.champ; }
    else if (sheet.mode === 'turn') { btn.textContent = isBan ? t('confirmBan') : t('confirmPick'); btn.disabled = !sheet.champ; }
    else { btn.textContent = t('confirm'); btn.disabled = false; }
  }

  function openList(kind, slot) {
    const body = $('slBody');
    const me = state.champSelect && state.champSelect.myTeam.find((p) => p.isMe);
    if (kind === 'spell') {
      $('slTitle').textContent = `${t('spells')} ${slot}`;
      const cur = me ? me['spell' + slot + 'Id'] : 0;
      body.innerHTML = `<div class="list">${spellOptions().map((s) => `<div class="item ${s.key === cur ? 'sel' : ''}" data-act="setSpell" data-slot="${slot}" data-k="${s.key}">${spellImg(s.key)}<span>${esc(s.name)}</span></div>`).join('')}</div>`;
    } else if (kind === 'qspell') {
      const sl = (state.lobby && state.lobby.slots[sheet.qi]) || {};
      $('slTitle').textContent = `${t('spells')} ${slot}`;
      const cur = sl['spell' + slot];
      body.innerHTML = `<div class="list">${spellOptions().map((x) => `<div class="item ${x.key === cur ? 'sel' : ''}" data-act="setQSpell" data-slot="${slot}" data-k="${x.key}">${spellImg(x.key)}<span>${esc(x.name)}</span></div>`).join('')}</div>`;
    } else if (kind === 'qrole') {
      const sl = (state.lobby && state.lobby.slots[sheet.qi]) || {};
      $('slTitle').textContent = t('role');
      body.innerHTML = `<div class="list">${['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((r) => `<div class="item ${sl.position === r ? 'sel' : ''}" data-act="setQRole" data-k="${r}"><span>${esc(POS[OQ.lang][r.toLowerCase()])}</span></div>`).join('')}</div>`;
    } else if (kind === 'rune') {
      $('slTitle').textContent = t('runes');
      body.innerHTML = `<div class="list">${state.runes.pages.map((p) => `<div class="item ${p.id === state.runes.currentId ? 'sel' : ''}" data-act="setRune" data-k="${p.id}"><span style="flex:1">${esc(p.name)}</span>${RU.slot === null ? `<button class="btn small" data-act="rEditOwn" data-k="${p.id}">${t('runesEdit')}</button>` : ''}</div>`).join('')}</div>`;
    } else if (kind === 'settings') {
      $('slTitle').textContent = t('settings');
      let keep = false; try { keep = localStorage.getItem('oq_keep') === '1'; } catch (_) {}
      body.innerHTML = `
        <div class="card"><h2>${t('language')}</h2><div class="chips">
          <button class="chip ${OQ.lang === 'es' ? 'on' : ''}" data-act="lang" data-v="es">Español</button>
          <button class="chip ${OQ.lang === 'en' ? 'on' : ''}" data-act="lang" data-v="en">English</button></div></div>
        <div class="card"><div class="row"><h2 style="flex:1">${t('keepAwake')}</h2><div class="toggle ${keep ? 'on' : ''}" data-act="toggleKeep"></div></div><p class="note">${t('keepAwakeHelp')}</p>
          <button class="btn small" style="margin-top:10px" data-act="testSound">${t('testSound')}</button></div>
        <div class="card"><h2>${t('fullscreen')}</h2><p class="note">${t('fullscreenHelp')}</p>
          <button class="btn small" style="margin-top:10px" data-act="fullscreen">${t('fullscreenBtn')}</button></div>
        ${window.OQTheme ? window.OQTheme.html() : ''}
        <button class="btn block" data-act="unlink">${t('unlink')}</button>
        <p class="note" style="text-align:center;margin-top:12px">Open Queue v${esc(state.version || '?')}</p>`;
    }
    $('sheetList').classList.remove('hidden');
  }

  // ===== Runas =====
  const RU = { tab: 'mine', data: null, loading: false, custom: null, slot: null };
  const DEFAULT_SHARDS = [[5008, 5005, 5007], [5008, 5010, 5001], [5011, 5013, 5001]];
  const SHARD_NAMES = { 5008: 'Adaptive', 5005: 'Atk Speed', 5007: 'Haste', 5010: 'Move Spd', 5001: 'Health+', 5011: 'Health', 5013: 'Tenacity' };
  const blankCustom = () => ({ primary: null, sub: null, picks: [null, null, null, null], subPicks: [], shards: [null, null, null] });

  function runeIcon(path) { return path && String(path).startsWith('/lol-game-data/assets/') ? '/lcu-asset' + path : ''; }
  function perkImg(id, cls) {
    const info = RU.data && RU.data.perks && RU.data.perks[id];
    const ic = info ? runeIcon(info.icon) : '';
    const nm = (info && info.name) || SHARD_NAMES[id] || id;
    return ic ? `<img class="${cls || ''}" src="${ic}" alt="${esc(nm)}" title="${esc(nm)}">` : `<span class="dim" style="font-size:10px">${esc(nm)}</span>`;
  }
  function styleOf(id) { return RU.data && RU.data.styles.find((x) => x.id === id); }
  function regularRows(st) { return st ? st.slots.filter((sl) => sl.type !== 'kKeyStone' && sl.type !== 'kStatMod').slice(0, 3) : []; }
  function shardRows() {
    const st = RU.custom && styleOf(RU.custom.primary);
    const fromStyle = (st ? st.slots : []).filter((sl) => sl.type === 'kStatMod').slice(0, 3).map((sl) => sl.perks);
    if (fromStyle.length === 3) return fromStyle;
    const any = RU.data ? RU.data.styles.map((x) => x.slots.filter((sl) => sl.type === 'kStatMod')).find((a) => a.length >= 3) : null;
    return any ? any.slice(0, 3).map((sl) => sl.perks) : DEFAULT_SHARDS;
  }
  function customIds() {
    const c = RU.custom;
    if (!c || !c.primary || !c.sub) return null;
    const subSorted = c.subPicks.slice().sort((a, b) => a.row - b.row).map((x) => x.id);
    const ids = c.picks.concat(subSorted, c.shards);
    return ids.length === 9 && ids.every(Boolean) ? ids : null;
  }

  async function openRunes(slotIdx) {
    RU.slot = slotIdx === undefined || slotIdx === null ? null : slotIdx;
    RU.tab = 'mine'; RU.target = '';
    RU.custom = RU.custom || blankCustom();
    const meNow = state.champSelect && state.champSelect.myTeam.find((p) => p.isMe);
    const qs = RU.slot !== null && state.lobby ? state.lobby.slots[RU.slot] : null;
    const champNow = qs ? qs.championId : (meNow ? (meNow.championId || meNow.intent || (state.champSelect.myPickAction && state.champSelect.myPickAction.championId) || 0) : 0);
    RU.data = null; RU.forChamp = champNow; // las recomendadas dependen del campeón y el cliente puede generarlas recién ahora
    $('slTitle').textContent = t('runes');
    $('sheetList').classList.remove('hidden');
    renderRunes();
    if (!RU.data && !RU.loading) {
      RU.loading = true;
      const me = state.champSelect && state.champSelect.myTeam.find((p) => p.isMe);
      const r = await request('runeData', { championId: champNow, position: qs ? String(qs.position).toLowerCase() : (me ? me.position : '') });
      RU.loading = false;
      if (r && r.ok) RU.data = r;
      renderRunes();
    }
  }

  function renderRunes() {
    if ($('sheetList').classList.contains('hidden') || $('slTitle').textContent !== t('runes')) return;
    const tabs = [['mine', 'runesMine'], ['rec', 'runesRec'], ['custom', 'runesCustom']]
      .map(([k, l]) => `<button class="chip ${RU.tab === k ? 'on' : ''}" data-act="rTab" data-v="${k}">${t(l)}</button>`).join('');
    let h = `<div class="chips" style="margin-bottom:12px">${tabs}</div>`;
    if (RU.tab === 'mine') {
      const qsel = RU.slot !== null && state.lobby && state.lobby.slots[RU.slot] && state.lobby.slots[RU.slot].perks;
      const same = (p) => qsel && JSON.stringify(p.selectedPerkIds) === JSON.stringify(qsel.selectedPerkIds);
      h += `<div class="list">${state.runes.pages.filter((p) => !p.temp).map((p) => `<div class="item ${(RU.slot !== null ? same(p) : p.id === state.runes.currentId) ? 'sel' : ''}" data-act="setRune" data-k="${p.id}">${esc(p.name)}</div>`).join('')}</div>`;
    } else if (RU.tab === 'replace') {
      h += `<p class="note">${t('runesFull')}</p><div class="list">${(RU.replaceList || []).map((p) => `<div class="item" data-act="rReplace" data-k="${p.id}">${esc(p.name)}</div>`).join('')}</div>`;
    } else if (!RU.data) {
      h += `<p class="dim">${RU.loading ? t('runesLoading') : t('errGeneric')}</p>`;
    } else if (RU.tab === 'rec') {
      const rec = RU.data.recommended || [];
      h += rec.length ? rec.map((pg, i) => `<div class="card"><div class="row"><h2 style="font-size:13px;flex:1">${esc(pg.name || `${t('recN')} ${i + 1}`)}</h2></div>
        <div class="row wrap" style="gap:6px;margin:8px 0">${pg.selectedPerkIds.map((id) => `<div class="portrait sm">${perkImg(id)}</div>`).join('')}</div>
        <div class="row"><button class="btn primary small" data-act="rUseRec" data-i="${i}">${t('runesUse')}</button><button class="btn small" data-act="rEditRec" data-i="${i}">${t('runesEdit')}</button></div></div>`).join('')
        : `<p class="dim">${RU.forChamp ? t('runesNoRec') : t('runesNoChamp')}</p>`;
    } else {
      h += customEditorHtml();
    }
    $('slBody').innerHTML = h;
  }

  function perkBtn(id, selected, act, row, extra) {
    return `<button class="pill" style="padding:4px;${selected ? 'border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)' : 'opacity:.55'}" data-act="${act}" data-row="${row}" data-id="${id}" ${extra || ''}><div class="portrait sm" style="border:none">${perkImg(id)}</div></button>`;
  }

  function customEditorHtml() {
    const c = RU.custom;
    const styles = RU.data.styles.filter((x) => x.slots.some((sl) => sl.type === 'kKeyStone'));
    const styleBtn = (st, act, sel) => `<button class="pill" style="padding:6px;${sel ? 'border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)' : 'opacity:.55'}" data-act="${act}" data-v="${st.id}"><div class="portrait sm" style="border:none">${runeIcon(st.icon) ? `<img src="${runeIcon(st.icon)}" alt="${esc(st.name)}">` : esc(st.name)}</div></button>`;
    let h = `<h3 style="font-size:12px;color:var(--dim);margin:0 0 6px">${t('runesPrimary')}</h3><div class="row wrap" style="gap:8px">${styles.map((st) => styleBtn(st, 'rPrimary', c.primary === st.id)).join('')}</div>`;
    const pst = styleOf(c.primary);
    if (pst) {
      const ks = pst.slots.find((sl) => sl.type === 'kKeyStone');
      const rows = [ks].concat(regularRows(pst));
      h += `<div style="margin-top:10px">${rows.map((sl, r) => `<div class="row wrap" style="gap:6px;margin-bottom:6px">${(sl ? sl.perks : []).map((id) => perkBtn(id, c.picks[r] === id, 'rPick', r)).join('')}</div>`).join('')}</div>`;
      h += `<h3 style="font-size:12px;color:var(--dim);margin:12px 0 6px">${t('runesSecondary')}</h3><div class="row wrap" style="gap:8px">${styles.filter((st) => st.id !== c.primary).map((st) => styleBtn(st, 'rSub', c.sub === st.id)).join('')}</div>`;
      const sst = styleOf(c.sub);
      if (sst) {
        h += `<div style="margin-top:10px">${regularRows(sst).map((sl, r) => `<div class="row wrap" style="gap:6px;margin-bottom:6px">${sl.perks.map((id) => perkBtn(id, c.subPicks.some((x) => x.id === id), 'rSubPick', r)).join('')}</div>`).join('')}</div>`;
      }
      h += `<h3 style="font-size:12px;color:var(--dim);margin:12px 0 6px">${t('runesShards')}</h3>${shardRows().map((row, r) => `<div class="row wrap" style="gap:6px;margin-bottom:6px">${row.map((id) => perkBtn(id, c.shards[r] === id, 'rShard', r)).join('')}</div>`).join('')}`;
    }
    const ok = !!customIds();
    if (RU.slot === null) {
      const own = state.runes.pages.filter((p) => !p.temp);
      h += `<div class="dim" style="font-size:12px;margin:14px 0 6px">${t('runesSaveIn')}</div><select id="ruTarget" class="select" style="width:100%"><option value="">${t('runesSaveNew')}${state.runes.canAdd === false ? ' ✕' : ''}</option>${own.map((p) => `<option value="${p.id}" ${String(RU.target) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        ${RU.target ? '' : `<input id="ruName" type="text" maxlength="24" value="${esc(RU.newName || 'Open Queue')}" placeholder="${t('runesPageName')}" style="width:100%;margin-top:8px">${state.runes.canAdd === false ? `<p class="note">${t('runesNoSlot')}</p>` : ''}`}`;
    }
    h += `<button class="btn primary block" style="margin-top:14px" data-act="rSave" ${ok ? '' : 'disabled'}>${ok ? t('runesSave') : t('runesNeed')}</button>`;
    return h;
  }

  async function saveCustom(page, replaceId, name) {
    if (RU.slot !== null) {
      const r = await request('setQuickSlot', { index: RU.slot, patch: { perks: { primaryStyleId: page.primaryStyleId, subStyleId: page.subStyleId, selectedPerkIds: page.selectedPerkIds } } });
      if (r && r.ok) { toast(t('runesSaved'), 2500); closeSheets(); } else toast(t('errRejected'), 3500);
      return;
    }
    const r = await request('saveRunes', { page, replaceId, name });
    if (r && r.ok) { toast(t('runesSaved'), 2500); closeSheets(); RU.pending = null; }
    else if (r && r.error === 'full') { RU.pending = page; RU.replaceList = r.pages || []; RU.tab = 'replace'; renderRunes(); }
    else toast(failText(r), 6000);
  }

  function editFromRecommended(pg) {
    const c = blankCustom();
    c.primary = pg.primaryStyleId; c.sub = pg.subStyleId;
    c.picks = pg.selectedPerkIds.slice(0, 4);
    const sst = styleOf(pg.subStyleId);
    c.subPicks = pg.selectedPerkIds.slice(4, 6).map((id) => ({ id, row: regularRows(sst).findIndex((sl) => sl.perks.includes(id)) }));
    c.shards = pg.selectedPerkIds.slice(6, 9);
    RU.custom = c; RU.tab = 'custom';
    renderRunes();
  }

  // ===== Skins =====
  async function openQSkins(i) {
    sheet.qi = i;
    const sl = state.lobby && state.lobby.slots[i];
    if (!sl) return;
    $('slTitle').textContent = t('skins');
    $('slBody').innerHTML = `<p class="dim">${t('runesLoading')}</p>`;
    $('sheetList').classList.remove('hidden');
    const r = await request('ownedSkins', { championId: sl.championId });
    const list = (r && r.skins) || [];
    $('slBody').innerHTML = list.length
      ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">${list.map((sk) => `<div class="cell ${sk.id === sl.skinId ? 'sel' : ''}" data-act="setQSkin" data-k="${sk.id}">${sk.tile && runeIcon(sk.tile) ? `<img src="${runeIcon(sk.tile)}" alt="" style="width:100%;display:block;margin-bottom:4px">` : ''}<span>${esc(sk.name || t('skinDefault'))}</span></div>`).join('')}</div>`
      : `<p class="dim">${t('noSkins')}</p>`;
  }

  function swiftHtml() {
    const lb = state.lobby;
    if (!lb || !lb.quickPlay || !lb.slots.length) return '';
    const spellBtn = (i, n, k) => `<button class="pill" data-act="qSpell" data-i="${i}" data-slot="${n}">${spellImg(k)}<span><small>${t('spells')} ${n}</small>${esc((S.spellByKey[k] || {}).name || k || '—')}</span></button>`;
    const rows = lb.slots.map((sl, i) => {
      const posL = POS[OQ.lang][String(sl.position).toLowerCase()] || '—';
      const page = sl.perks && state.runes.pages.find((p) => JSON.stringify(p.selectedPerkIds) === JSON.stringify(sl.perks.selectedPerkIds));
      const runeL = !sl.perks ? '—' : page ? page.name : t('runesCustomSet');
      const skinL = sl.skinId && sl.skinId !== sl.championId * 1000 ? t('skinChosen') : t('skinDefault');
      return `<div class="card" style="margin-bottom:10px"><div class="row" style="margin-bottom:8px">${champImg(sl.championId)}
        <div style="flex:1"><b>${esc(sl.championId ? champName(sl.championId) : '—')}</b><div class="dim" style="font-size:12px">${t('slotN')} ${i + 1}</div></div>
        <button class="btn small" data-act="qChamp" data-i="${i}">${t('chooseChamp')}</button></div>
        <div class="row wrap" style="gap:8px">
          <button class="pill" data-act="qRole" data-i="${i}"><span><small>${t('role')}</small>${esc(posL)}</span></button>
          ${spellBtn(i, 1, sl.spell1)}${spellBtn(i, 2, sl.spell2)}
          <button class="pill" data-act="qRune" data-i="${i}" style="flex:1;min-width:140px"><span><small>${t('runes')}</small>${esc(runeL)}</span></button>
          <button class="pill" data-act="qSkin" data-i="${i}" style="flex:1;min-width:140px"><span><small>${t('skins')}</small>${esc(skinL)}</span></button></div></div>`;
    }).join('');
    return `<h2 style="margin:16px 0 4px">${t('swiftTitle')}</h2><p class="note" style="margin:0 0 10px">${t('swiftHelp')}</p>${rows}`;
  }

  function openSkins() {
    $('slTitle').textContent = t('skins');
    const me = state.champSelect && state.champSelect.myTeam.find((p) => p.isMe);
    const cur = me ? me.skinId : 0;
    const list = state.skins || [];
    $('slBody').innerHTML = list.length
      ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">${list.map((sk) => `<div class="cell ${sk.id === cur ? 'sel' : ''}" data-act="setSkin" data-k="${sk.id}">${sk.tile && runeIcon(sk.tile) ? `<img src="${runeIcon(sk.tile)}" alt="" style="width:100%;display:block;margin-bottom:4px">` : ''}<span>${esc(sk.name || t('skinDefault'))}</span></div>`).join('')}</div>`
      : `<p class="dim">${t('noSkins')}</p>`;
    $('sheetList').classList.remove('hidden');
  }

  // ---------- invitar amigos ----------
  const FR = { list: null, q: '', sent: new Set(), loading: false };
  async function openFriends() {
    FR.list = null; FR.q = '';
    $('slTitle').textContent = t('inviteFriends');
    $('sheetList').classList.remove('hidden');
    renderFriends();
    FR.loading = true;
    const r = await request('friends', {});
    FR.loading = false;
    if (r && r.ok) FR.list = r.friends;
    renderFriends();
    clearInterval(FR.timer);
    let n = 0;
    FR.timer = setInterval(async () => {
      const open = !$('sheetList').classList.contains('hidden') && $('slTitle').textContent === t('inviteFriends');
      if (!open) { clearInterval(FR.timer); return; }
      n += 1;
      if (n % 10 === 0) { // cada 10 s se vuelve a pedir la lista (estados, quién entró o salió de partida)
        const nr = await request('friends', {});
        if (nr && nr.ok) { FR.list = nr.friends; if (document.activeElement !== $('frQ')) renderFriends(); }
      }
      // cada segundo avanza el reloj de los que están en partida, sin redibujar la lista
      document.querySelectorAll('.frrow[data-fid]').forEach((row) => {
        const f = (FR.list || []).find((x) => String(x.id) === row.getAttribute('data-fid'));
        const el = row.querySelector('.frtext');
        if (f && el) el.textContent = friendText(f);
      });
    }, 1000);
  }
  function friendText(f) {
    const mins = f.since ? Math.max(0, Math.floor((Date.now() - f.since) / 1000)) : 0;
    const clock = f.since ? ` ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}` : '';
    if (f.status === 'mobile') return t('fr_mobile');
    if (f.status === 'ingame') return `${f.queue || t('fr_ingame')}${clock}`;
    if (f.gs && f.gs.startsWith('hosting')) return `${t('frLobby')}: ${f.queue}`.replace(/: $/, '');
    if (f.gs === 'championSelect') return t('frSelect');
    if (f.gs === 'inQueue') return `${t('frQueue')}${f.queue ? ': ' + f.queue : ''}`;
    if (f.status === 'away') return t('fr_away');
    if (f.status === 'dnd') return t('fr_dnd');
    return t('frOut');
  }
  function friendAvatar(f) {
    const src = f.icon && S.version ? `https://ddragon.leagueoflegends.com/cdn/${S.version}/img/profileicon/${f.icon}.png` : '';
    return `<div class="fravatar">${src ? `<img alt="" src="${esc(src)}" onerror="this.remove()">` : ''}<i class="frdot ${esc(f.status)}"></i></div>`;
  }
  function renderFriends() {
    if ($('sheetList').classList.contains('hidden') || $('slTitle').textContent !== t('inviteFriends')) return;
    const q = FR.q.trim().toLowerCase();
    let h = `<input id="frQ" class="input" placeholder="${esc(t('frSearch'))}" value="${esc(FR.q)}" style="width:100%;margin-bottom:12px">`;
    if (!FR.list) h += `<p class="dim">${FR.loading ? t('runesLoading') : t('errGeneric')}</p>`;
    else {
      const items = FR.list.filter((f) => !q || f.name.toLowerCase().includes(q));
      h += items.length ? `<div class="frlist">${items.map((f) => `<div class="frrow ${f.status === 'mobile' ? 'off' : ''}" data-fid="${f.id}" ${f.status === 'mobile' ? '' : `data-act="invFriend" data-k="${f.id}"`}>${friendAvatar(f)}<div class="frinfo"><div class="frname">${esc(f.name)}</div><div class="frtext">${esc(friendText(f))}</div></div>${f.status === 'mobile' ? '' : `<b class="frbtn">${FR.sent.has(f.id) ? t('frSent') : t('frInvite')}</b>`}</div>`).join('')}</div>` : `<p class="dim">${t('frNone')}</p>`;
    }
    $('slBody').innerHTML = h;
    const inp = $('frQ'); if (inp) inp.oninput = (e) => { FR.q = e.target.value; const pos = e.target.selectionStart; renderFriends(); const n = $('frQ'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  }

  // ---------- emotes y ward ----------
  const CO = { tab: 'emotes', slot: null, data: null, loading: false, busy: false };
  async function openCosmetics() {
    CO.slot = null; CO.data = null;
    $('slTitle').textContent = t('cosmetics');
    $('sheetList').classList.remove('hidden');
    renderCosmetics();
    CO.loading = true;
    const r = await request('cosmeticsData', {});
    CO.loading = false;
    if (r && r.ok) CO.data = r;
    renderCosmetics();
  }
  function coTile(it, attrs, sel) {
    if (!it) return `<div class="cotile ${sel ? 'sel' : ''}" ${attrs}><span class="dim">—</span></div>`;
    return `<div class="cotile ${sel ? 'sel' : ''}" ${attrs}>${it.icon ? `<img alt="" src="${esc(it.icon)}" onerror="this.remove()">` : ''}<span>${esc(it.name)}</span></div>`;
  }
  function renderCosmetics() {
    if ($('sheetList').classList.contains('hidden') || $('slTitle').textContent !== t('cosmetics')) return;
    const tabs = [['emotes', 'coEmotes'], ['ward', 'coWard']].map(([k, l]) => `<button class="chip ${CO.tab === k ? 'on' : ''}" data-act="coTab" data-v="${k}">${t(l)}</button>`).join('');
    let h = `<div class="chips" style="margin-bottom:12px">${tabs}</div>`;
    const d = CO.data;
    if (!d) h += `<p class="dim">${CO.loading ? t('runesLoading') : t('errGeneric')}</p>`;
    else if (CO.tab === 'emotes') {
      const order = ['EMOTES_WHEEL_UPPER_LEFT', 'EMOTES_WHEEL_UPPER', 'EMOTES_WHEEL_UPPER_RIGHT', 'EMOTES_WHEEL_LEFT', 'EMOTES_WHEEL_CENTER', 'EMOTES_WHEEL_RIGHT', 'EMOTES_WHEEL_LOWER_LEFT', 'EMOTES_WHEEL_LOWER', 'EMOTES_WHEEL_LOWER_RIGHT'];
      h += `<div class="cogrid">${order.map((k) => coTile(d.slots[k], `data-act="coSlot" data-k="${k}"`, CO.slot === k)).join('')}</div>`;
      h += `<p class="note" style="margin:12px 0 8px">${CO.slot ? t('coPickEmote') : t('coPickSlot')}</p>`;
      if (CO.slot) h += `<div class="cogrid">${d.ownedEmotes.map((e) => coTile(e, `data-act="coEmote" data-k="${e.id}"`, d.slots[CO.slot] && d.slots[CO.slot].id === e.id)).join('')}</div>`;
    } else {
      h += `<p class="note" style="margin-bottom:8px">${t('coWardHelp')}</p><div class="cogrid">${d.ownedWards.map((w) => coTile(w, `data-act="coWard" data-k="${w.id}"`, d.ward && d.ward.id === w.id)).join('')}</div>`;
    }
    $('slBody').innerHTML = h;
  }

  function closeSheets() {
    $('sheetChamp').classList.add('hidden');
    $('sheetList').classList.add('hidden');
    sheet.mode = null;
  }

  // ---------- eventos de la interfaz ----------
  document.addEventListener('change', (e) => {
    const id = e.target && e.target.id;
    if (id === 'queueSel' && Number(e.target.value)) { rememberQueue(Number(e.target.value)); updateQueueCard(state.phase); if (state.phase === 'Lobby' && Number(e.target.value) !== Number(state.lobbyQueueId)) cmd('setLobbyQueue', { queueId: Number(e.target.value) }); }
    if (id === 'ruTarget') { RU.target = e.target.value; renderRunes(); }
    if (id === 'ruName') RU.newName = e.target.value;
    if (id === 'roleFirst' || id === 'roleSecond') cmd('setRoles', { first: $('roleFirst').value, second: $('roleSecond').value });
  });

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    const v = el.getAttribute('data-v');
    switch (act) {
      case 'toggleInvite': cmd('setAutoInvite', { enabled: !(state.settings.autoInvite && state.settings.autoInvite.enabled) }); break;
      case 'invAccept': cmd('answerInvite', { inviteId: el.getAttribute('data-k'), accept: true }); break;
      case 'invDecline': cmd('answerInvite', { inviteId: el.getAttribute('data-k'), accept: false }); break;
      case 'toggleAuto': cmd('setAutoAccept', { enabled: !state.settings.autoAccept.enabled }); break;
      case 'delay': cmd('setAutoAccept', { delay: Number(v) }); break;
      case 'search': { const q = $('queueSel') ? Number($('queueSel').value) : 0; if (q) rememberQueue(q); cmd('search', { queueId: q }); break; }
      case 'cancel': cmd('cancelSearch'); break;
      case 'leave': cmd('leaveLobby'); break;
      case 'createLobby': cmd('createLobby', { queueId: Number($('queueSel').value) }); break;
      case 'accept': cmd('accept'); break;
      case 'decline': cmd('decline'); break;
      case 'openChamp': openChampSheet(el.getAttribute('data-mode')); break;
      case 'closeSheet': closeSheets(); break;
      case 'cls': sheet.cls = v; renderSheets(); break;
      case 'pickCell': {
        const k = Number(el.getAttribute('data-k'));
        if (el.classList.contains('off')) { toast(el.classList.contains('ban') ? t('champBanned') : t('champUnavailable'), 1800); break; } // no se puede elegir: el menú queda abierto
        sheet.champ = k;
        if (sheet.mode === 'turn' || sheet.mode === 'hover') cmd('hover', { championId: k });
        renderSheets();
        break;
      }
      case 'clearPreBan': cmd('setPreBan', { championId: null }); break;
      case 'openFav': openChampSheet('fav', Number(el.getAttribute('data-i'))); break;
      case 'clearFavs': cmd('setFavorites', { ids: [] }); break;
      case 'toggleAutoPick': cmd('setFavorites', { autoPick: !(state.settings.favorites && state.settings.favorites.autoPick) }); break;
      case 'autoPickWhen': cmd('setFavorites', { when: v }); break;
      case 'toggleHistory': cmd('setFavorites', { useHistory: !(state.settings.favorites && state.settings.favorites.useHistory) }); break;
      case 'recHover': request('hover', { championId: Number(el.getAttribute('data-k')) }).then((r) => { if (!(r && r.ok)) toast(failText(r), 3000); }); break;
      case 'clearPre': cmd('setPrePick', { championId: null }); break;
      case 'openSpell': openList('spell', el.getAttribute('data-slot')); break;
      case 'openRune': openRunes(null); break;
      case 'openCosmetics': openCosmetics(); break;
      case 'openFriends': openFriends(); break;
      case 'invFriend': {
        const id = Number(el.getAttribute('data-k'));
        const r = await request('inviteFriend', { summonerId: id });
        if (r && r.ok) { FR.sent.add(id); toast(t('frSentToast')); } else toast(t('frErr'), 5000);
        renderFriends();
        break;
      }
      case 'coTab': CO.tab = el.getAttribute('data-v'); renderCosmetics(); break;
      case 'coSlot': CO.slot = el.getAttribute('data-k'); renderCosmetics(); break;
      case 'coEmote': case 'coWard': {
        if (CO.busy) break;
        CO.busy = true;
        const id = Number(el.getAttribute('data-k'));
        const r = await request(act === 'coEmote' ? 'setEmote' : 'setWard', act === 'coEmote' ? { slot: CO.slot, itemId: id } : { itemId: id });
        if (r && r.ok) { toast(t('coDone')); const nd = await request('cosmeticsData', {}); if (nd && nd.ok) CO.data = nd; } else toast(t('coErr'), 5000);
        CO.busy = false; renderCosmetics();
        break;
      }
      case 'openSkins': openSkins(); break;
      case 'setSkin': cmd('selectSkin', { skinId: Number(el.getAttribute('data-k')) }); closeSheets(); break;
      case 'swap': cmd('swap', { kind: el.getAttribute('data-kind'), swapId: Number(el.getAttribute('data-id')), accept: el.getAttribute('data-accept') === '1' }); break;
      case 'swapMode': { const k = el.getAttribute('data-kind'); swapMode = swapMode === k ? null : k; render(); break; }
      case 'subsetPick': {
        request('lockIn', { championId: Number(el.getAttribute('data-champ')) }).then((r) => { if (!(r && r.ok)) toast(failText(r), 4000); });
        break;
      }
      case 'swapReq': case 'swapCancel': {
        const action = act === 'swapReq' ? 'request' : 'cancel';
        request('swap', { kind: el.getAttribute('data-kind'), swapId: Number(el.getAttribute('data-id')), action }).then((r) => {
          if (r && r.ok) toast(action === 'request' ? t('reqSent') : t('reqCancelled'), 2200); else toast(failText(r), 5000);
        });
        break;
      }
      case 'dodge':
        if (confirm(t('dodgeConfirm'))) request('dodge', {}).then((r) => toast(r && r.ok ? t('dodged') : t('errGeneric'), 4000));
        break;
      case 'benchSwap': cmd('benchSwap', { championId: Number(el.getAttribute('data-k')) }); break;
      case 'reroll': cmd('reroll'); break;
      case 'rTab': RU.tab = v; renderRunes(); break;
      case 'rPrimary': RU.custom.primary = Number(v); RU.custom.picks = [null, null, null, null]; RU.custom.shards = [null, null, null]; if (RU.custom.sub === Number(v)) { RU.custom.sub = null; RU.custom.subPicks = []; } renderRunes(); break;
      case 'rPick': RU.custom.picks[Number(el.getAttribute('data-row'))] = Number(el.getAttribute('data-id')); renderRunes(); break;
      case 'rSub': RU.custom.sub = Number(v); RU.custom.subPicks = []; renderRunes(); break;
      case 'rSubPick': {
        const row = Number(el.getAttribute('data-row')); const id = Number(el.getAttribute('data-id'));
        const sp = RU.custom.subPicks.filter((x) => x.row !== row);
        sp.push({ row, id });
        RU.custom.subPicks = sp.length > 2 ? sp.slice(sp.length - 2) : sp;
        renderRunes(); break;
      }
      case 'rShard': RU.custom.shards[Number(el.getAttribute('data-row'))] = Number(el.getAttribute('data-id')); renderRunes(); break;
      case 'rSave': { const ids = customIds(); if (ids) saveCustom({ name: 'Open Queue', primaryStyleId: RU.custom.primary, subStyleId: RU.custom.sub, selectedPerkIds: ids }, RU.slot === null && RU.target ? Number(RU.target) : undefined, RU.slot === null && !RU.target ? (($('ruName') && $('ruName').value) || RU.newName || '') : undefined); break; }
      case 'rEditOwn': {
        const pg = state.runes.pages.find((p) => p.id === Number(el.getAttribute('data-k')));
        if (pg && pg.selectedPerkIds.length === 9) { RU.target = pg.id; editFromRecommended(pg); }
        break;
      }
      case 'rUseRec': {
        const pg = RU.data.recommended[Number(el.getAttribute('data-i'))];
        if (RU.slot !== null) saveCustom(pg);
        else {
          request('useRunes', { page: pg, championId: RU.forChamp }).then((r) => {
            if (r && r.ok) { toast(t('runesActive'), 2000); closeSheets(); }
            else if (r && r.error === 'full') { RU.pending = pg; RU.replaceList = r.pages || []; RU.tab = 'replace'; renderRunes(); }
            else toast(failText(r), 6000);
          });
        }
        break;
      }
      case 'rReplace': {
        if (RU.pending && confirm(t('runesReplaceConfirm'))) saveCustom(RU.pending, Number(el.getAttribute('data-k')));
        break;
      }
      case 'rEditRec': editFromRecommended(RU.data.recommended[Number(el.getAttribute('data-i'))]); break;
      case 'qChamp': openChampSheet('qslot', Number(el.getAttribute('data-i'))); break;
      case 'qRole': sheet.qi = Number(el.getAttribute('data-i')); openList('qrole'); break;
      case 'qSpell': sheet.qi = Number(el.getAttribute('data-i')); openList('qspell', el.getAttribute('data-slot')); break;
      case 'qRune': openRunes(Number(el.getAttribute('data-i'))); break;
      case 'qSkin': openQSkins(Number(el.getAttribute('data-i'))); break;
      case 'setQRole': slotCmd({ index: sheet.qi, patch: { position: el.getAttribute('data-k') } }); closeSheets(); break;
      case 'setQSpell': {
        const sl = state.lobby.slots[sheet.qi]; const slot = el.getAttribute('data-slot'); const k = Number(el.getAttribute('data-k'));
        const other = slot === '1' ? 'spell2' : 'spell1';
        const patch = { ['spell' + slot]: k };
        if (sl[other] === k) patch[other] = sl['spell' + slot]; // intercambia si repetís el otro
        slotCmd({ index: sheet.qi, patch }); closeSheets(); break;
      }
      case 'setQSkin': slotCmd({ index: sheet.qi, patch: { skinId: Number(el.getAttribute('data-k')) } }); closeSheets(); break;
      case 'openSettings': openList('settings'); break;
      case 'setSpell': {
        const me = state.champSelect.myTeam.find((p) => p.isMe);
        const slot = el.getAttribute('data-slot');
        const k = Number(el.getAttribute('data-k'));
        const other = me['spell' + (slot === '1' ? 2 : 1) + 'Id'];
        const body = { spell1Id: slot === '1' ? k : me.spell1Id, spell2Id: slot === '2' ? k : me.spell2Id };
        if (k === other) { body['spell' + (slot === '1' ? 2 : 1) + 'Id'] = me['spell' + slot + 'Id']; } // intercambia si repetís el otro
        cmd('setSpells', body);
        closeSheets();
        break;
      }
      case 'setRune': {
        const id = Number(el.getAttribute('data-k'));
        if (RU.slot !== null) {
          const pg = state.runes.pages.find((x) => x.id === id);
          if (pg && pg.selectedPerkIds.length === 9) slotCmd({ index: RU.slot, patch: { perks: { primaryStyleId: pg.primaryStyleId, subStyleId: pg.subStyleId, selectedPerkIds: pg.selectedPerkIds } } });
        } else cmd('selectRunePage', { id });
        closeSheets();
        break;
      }
      case 'fullscreen': {
        const el = document.documentElement;
        const rq = el.requestFullscreen || el.webkitRequestFullscreen;
        if (rq) { try { Promise.resolve(rq.call(el)).then(() => closeSheets()).catch(() => toast(t('fullscreenNo'))); } catch (_) { toast(t('fullscreenNo')); } } else toast(t('fullscreenNo'));
        break;
      }
      case 'lang': OQ.setLang(v); applyStatic(); loadStatic(); openList('settings'); break;
      case 'toggleKeep': {
        let on = false; try { on = localStorage.getItem('oq_keep') === '1'; } catch (_) {}
        setKeepAwake(!on); setTimeout(() => openList('settings'), 50);
        break;
      }
      case 'testSound': if (!(window.OQTheme && window.OQTheme.playSound('matchFound'))) beep([784, 988, 1175, 1568]); vibrate([200, 100, 200]); break;
      case 'unlink':
        try { localStorage.removeItem('oq_token'); } catch (_) {}
        token = null; authed = false; closeSheets(); showAuth(); try { ws.close(); } catch (_) {}
        break;
    }
  });

  $('scConfirm').addEventListener('click', () => {
    if (sheet.mode === 'prepick') cmd('setPrePick', { championId: sheet.champ });
    else if (sheet.mode === 'preban') cmd('setPreBan', { championId: sheet.champ });
    else if (sheet.mode === 'qslot') slotCmd({ index: sheet.qi, patch: { championId: sheet.champ } });
    else if (sheet.mode === 'fav') {
      const ids = ((state.settings.favorites && state.settings.favorites.ids) || []).slice(0, 3);
      const other = ids.indexOf(sheet.champ);
      if (other >= 0 && other !== sheet.qi) ids[other] = ids[sheet.qi] || 0; // si ya estaba en otro lugar, se intercambian
      ids[sheet.qi] = sheet.champ;
      cmd('setFavorites', { ids: ids.filter(Boolean) });
    } else if (sheet.mode === 'turn') {
      // Si el cliente rechaza el pick, el menú queda abierto para elegir otro sin perder tiempo.
      const btn = $('scConfirm');
      if (!sheet.champ || disabledKeys().has(sheet.champ)) { toast(t('champBanned'), 1800); return; }
      btn.disabled = true;
      request('lockIn', { championId: sheet.champ }).then((r) => {
        if (r && r.ok) closeSheets();
        else { toast(r && r.error === 'banned' ? t('champBanned') : failText(r), 3000); renderSheets(); }
      });
      return;
    }
    closeSheets();
  });
  $('scSearch').addEventListener('input', (e) => { sheet.search = e.target.value; renderSheets(); });

  $('codeBtn').addEventListener('click', submitCode);
  $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCode(); });
  function submitCode() {
    const c = $('codeIn').value.replace(/\D/g, '');
    if (c.length !== 6) { $('authErr').textContent = t('badCode'); return; }
    $('authErr').textContent = '';
    sentTokenThisConn = true; // no reintentar token viejo
    send({ type: 'auth', code: c });
  }

  function sendChat() {
    const el = $('chatIn');
    const body = el.value.trim();
    if (!body) return;
    cmd('sendChat', { body });
    el.value = '';
  }
  $('chatSend').addEventListener('click', sendChat);
  $('chatIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  // ---------- arranque ----------
  applyStatic();
  loadStatic();
  connect();
  if (!token && !urlCode) showAuth();
})();
