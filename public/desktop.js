// Open Queue - ventana de escritorio.
(function () {
  'use strict';
  const { t, esc } = OQ;
  const $ = (id) => document.getElementById(id);
  let st = null;
  let dragging = false;
  let lastQr = '';

  function setStream(on) {
    try { localStorage.setItem('oq_stream', on ? '1' : '0'); } catch (_) {}
    document.body.classList.toggle('stream', on);
    $('streamBtn').classList.toggle('on', on);
    $('streamNote').style.display = on ? '' : 'none';
  }
  function isStream() { try { return localStorage.getItem('oq_stream') === '1'; } catch (_) { return false; } }

  function applyStatic() {
    document.documentElement.lang = OQ.lang;
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
    $('disclaimer').textContent = t('disclaimer');
    $('langEs').classList.toggle('on', OQ.lang === 'es');
    $('langEn').classList.toggle('on', OQ.lang === 'en');
  }

  async function post(path, body) {
    try { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return await r.json(); } catch (_) { return { ok: false }; }
  }

  // ---- Discord ----
  let dcFilled = false;
  function dcInfo(txt, bad) { const o = $('dcMsgOut'); o.textContent = txt; o.style.color = bad ? '#e0485a' : ''; clearTimeout(dcInfo._t); dcInfo._t = setTimeout(() => { o.textContent = ''; }, 4000); }
  function dcErr(r) { return r && r.error === 'badLink' ? t('voiceBadLink') : r && r.error === 'badId' ? t('rpcBadId') : r && r.error === 'noLink' ? t('voiceNoLink') : t('voiceNoChat'); }
  function paintDiscord() {
    const d = st.settings.discord || {};
    if (!dcFilled) { $('dcLink').value = d.voiceLink || ''; $('dcMsg').value = d.voiceMsg || ''; $('dcId').value = d.clientId || ''; dcFilled = true; }
    $('dcMsg').placeholder = t('voicePreset1');
    const ph = [1, 2, 3].map((n) => `<button class="chip" data-preset="${n}">${t('voicePresetN')} ${n}</button>`).join('');
    if ($('dcPresets')._h !== ph) { $('dcPresets').innerHTML = ph; $('dcPresets')._h = ph; }
    const canSend = !!d.voiceLink && st.lol.connected && !!st.lol.chatReady;
    $('dcSend').textContent = '🎧 ' + t('voiceSend');
    $('dcSend').disabled = !canSend;
    $('dcSend').title = canSend ? '' : t(d.voiceLink ? 'voiceNoChat' : 'voiceNoLink');
    $('rpcToggle').classList.toggle('on', !!d.rpc);
    $('rpcMore').style.display = d.rpc ? '' : 'none';
    $('rpcStatus').textContent = t('rpcStatus_' + (st.discordStatus || 'off'));
    $('rpcNick').classList.toggle('on', d.showNick !== false);
  }
  $('dcPresets').addEventListener('click', (e) => { const b = e.target.closest('[data-preset]'); if (b) $('dcMsg').value = t('voicePreset' + b.getAttribute('data-preset')); });
  $('dcSave').addEventListener('click', async () => {
    const r = await post('/api/discord', { voiceLink: $('dcLink').value, voiceMsg: $('dcMsg').value, lang: OQ.lang });
    if (r && r.ok) { dcFilled = false; dcInfo(t('saved')); } else dcInfo(dcErr(r), true);
    poll();
  });
  $('dcSend').addEventListener('click', async () => {
    const d = (st && st.settings.discord) || {};
    const r = await post('/api/sendVoice', { msg: d.voiceMsg || t('voicePreset1') });
    dcInfo(r && r.ok ? t('voiceSent') : dcErr(r), !(r && r.ok));
  });
  $('rpcToggle').addEventListener('click', async () => { await post('/api/discord', { rpc: !(st.settings.discord || {}).rpc, lang: OQ.lang }); poll(); });
  $('rpcNick').addEventListener('click', async () => { await post('/api/discord', { showNick: (st.settings.discord || {}).showNick === false, lang: OQ.lang }); poll(); });
  $('dcIdSave').addEventListener('click', async () => {
    const r = await post('/api/discord', { clientId: $('dcId').value, lang: OQ.lang });
    if (r && r.ok) { dcFilled = false; dcInfo(t('saved')); } else dcInfo(dcErr(r), true);
    poll();
  });

  function paint() {
    if (!st) return;
    const on = st.lol.connected;
    $('statusbar').innerHTML = `<span class="dot ${on ? 'on' : ''}"></span><span>${on ? t('lolOn') : t('lolOff')}</span><span class="phase">${on ? esc(t('phase_' + st.lol.phase)) : ''}</span>`;
    if (st.pairing.qr !== lastQr) { $('qr').src = st.pairing.qr; lastQr = st.pairing.qr; }
    $('url').textContent = st.pairing.url;
    $('code').textContent = st.pairing.code;
    $('phones').textContent = st.phones;
    const a = st.settings.autoAccept;
    $('autoToggle').classList.toggle('on', a.enabled);
    $('autoLbl').textContent = a.enabled ? t('autoOn') : t('autoOff');
    if (!dragging) { $('delay').value = a.delay; $('delay').max = st.maxAutoDelay; }
    const dg = st.diag || { on: false };
    $('diagBtn').textContent = dg.on ? t('diagStop') : t('diagStart');
    $('diagBtn').classList.toggle('primary', !!dg.on);
    $('diagInfo').textContent = dg.file ? `${t('diagFile')}: ${dg.file}${dg.on ? ` · ${dg.count} ${t('diagEvents')}` : ''}` : '';
    $('delayLbl').textContent = Number(a.delay) === 0 ? t('autoNow') : `${a.delay}${t('seconds')}`;
    paintDiscord();
  }

  async function poll() {
    try {
      const r = await fetch('/api/status');
      st = await r.json();
      paint();
    } catch (_) {}
  }

  $('autoToggle').addEventListener('click', async () => { await post('/api/autoaccept', { enabled: !st.settings.autoAccept.enabled }); poll(); });
  $('delay').addEventListener('input', (e) => { dragging = true; const v = Number(e.target.value); $('delayLbl').textContent = v === 0 ? t('autoNow') : `${v}${t('seconds')}`; });
  $('delay').addEventListener('change', async (e) => { await post('/api/autoaccept', { delay: Number(e.target.value) }); dragging = false; poll(); });
  $('diagBtn').addEventListener('click', async () => { await post('/api/diag', { on: !(st.diag && st.diag.on) }); poll(); });
  $('regen').addEventListener('click', async () => { await post('/api/regen'); poll(); });
  $('langEs').addEventListener('click', () => { OQ.setLang('es'); applyStatic(); paint(); });
  $('langEn').addEventListener('click', () => { OQ.setLang('en'); applyStatic(); paint(); });

  $('streamBtn').addEventListener('click', () => setStream(!isStream()));
  document.querySelectorAll('.secret').forEach((n) => {
    n.addEventListener('click', () => {
      if (!document.body.classList.contains('stream')) return;
      n.classList.add('peek');
      setTimeout(() => n.classList.remove('peek'), 4000);
    });
  });

  applyStatic();
  setStream(isStream());
  poll();
  setInterval(poll, 1000);
})();
