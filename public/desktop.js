// Open Queue - ventana de escritorio.
(function () {
  'use strict';
  const { t, esc } = OQ;
  const $ = (id) => document.getElementById(id);
  let st = null;
  let dragging = false;
  let lastQr = '';

  function applyStatic() {
    document.documentElement.lang = OQ.lang;
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
    $('disclaimer').textContent = t('disclaimer');
    $('langEs').classList.toggle('on', OQ.lang === 'es');
    $('langEn').classList.toggle('on', OQ.lang === 'en');
  }

  async function post(path, body) {
    try { await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); } catch (_) {}
  }

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

  applyStatic();
  poll();
  setInterval(poll, 1000);
})();
