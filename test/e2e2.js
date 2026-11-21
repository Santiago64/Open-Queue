'use strict';
// Segunda prueba: colas filtradas, seguridad del ban, ARAM, cambios, skins, runas y diagnóstico.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { startMock } = require('./mock-lcu');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (_) {} await sleep(50); }
  throw new Error('Timeout esperando: ' + label);
}

(async () => {
  const mock = await startMock();
  process.env.OQ_LOCKFILE = mock.lockfile;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-data2-'));
  const { startServer } = require('../src/server');
  const srv = await startServer({ dataDir, port: 4950 });
  let n = 0; const ok = (m) => console.log(`  ✓ ${++n}. ${m}`);

  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  let state = null; const alerts = []; const results = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'state') state = m.state;
    if (m.type === 'alert') alerts.push(m.alert);
    if (m.type === 'result') results.set(m.id, m.result);
  });
  await new Promise((r) => ws.on('open', r));
  let id = 100;
  const cmd = (type, extra) => { const i = ++id; ws.send(JSON.stringify(Object.assign({ type, id: i }, extra))); return i; };
  const ask = async (type, extra) => { const i = cmd(type, extra); return waitFor(() => results.get(i), 'resultado ' + type); };
  ws.send(JSON.stringify({ type: 'auth', code: srv.store.code }));
  await waitFor(() => state && state.connected, 'conectado');

  // 1) Colas: solo las vigentes
  const ids = state.queues.map((q) => q.id);
  assert.deepStrictEqual(ids, [400, 420, 450, 2400, 480, 1100], 'colas: ' + ids);
  ok('colas: sin Clash, URF, tutoriales, bots ni personalizadas; con TFT; Draft y Ranked distinguibles');

  // 2) Ban: no se apaga nada que sirva y el pick preparado nunca se banea
  cmd('setPrePick', { championId: 22 });
  await waitFor(() => state.settings.prePick.championId === 22, 'prepick');
  mock.startChampSelect();
  await waitFor(() => state.champSelect && state.champSelect.myTurn, 'turno ban');
  await sleep(500);
  assert(!mock.calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/actions/2')), 'marcó el pick durante los baneos');
  ok('pick preparado NO se marca mientras hay baneos pendientes');
  assert.strictEqual(state.champSelect.bansDone, false);
  // simula el caso del error: el ban quedó apuntando al pick preparado sin elegirlo vos
  mock.updateSession((s) => { s.actions[0][0].championId = 22; });
  await waitFor(() => mock.calls.find((c) => c.url.endsWith('/actions/0') && c.body && c.body.championId === 0), 'limpieza de seguridad');
  ok('seguro: si el ban queda apuntando a tu pick preparado sin elegirlo, se limpia');
  const noChamp = await ask('lockIn', {});
  assert.strictEqual(noChamp.ok, false);
  ok('confirmar un ban sin elegir campeón es rechazado');
  const early = await ask('hover', { championId: 266 });
  assert(early.ok); // es el ban en curso
  cmd('lockIn', { championId: 266 });
  await waitFor(() => mock.calls.find((c) => c.url.endsWith('/actions/0') && c.body.completed === true && c.body.championId === 266), 'ban real');
  ok('el ban que elegís vos sí se confirma');
  await waitFor(() => mock.calls.find((c) => c.url.endsWith('/actions/2') && c.body.championId === 22), 'prepick tras bans');
  ok('al terminar los baneos, recién ahí se marca el pick preparado');

  // 3) cambios de orden/rol/campeón
  mock.updateSession((s) => { s.pickOrderSwaps = [{ id: 7, cellId: 3, state: 'RECEIVED' }]; s.positionSwaps = [{ id: 8, cellId: 1, state: 'RECEIVED' }]; });
  await waitFor(() => state.champSelect.swaps.pickOrder.length === 1 && state.champSelect.swaps.position.length === 1, 'swaps');
  await waitFor(() => alerts.find((a) => a.kind === 'swap'), 'alerta swap');
  ok('pedidos de cambio de orden de pick y de rol aparecen y avisan');
  cmd('swap', { kind: 'pickOrder', swapId: 7, accept: true });
  await waitFor(() => mock.calls.find((c) => c.url === '/lol-champ-select/v1/session/pick-order-swaps/7/accept'), 'accept swap');
  cmd('swap', { kind: 'position', swapId: 8, accept: false });
  await waitFor(() => mock.calls.find((c) => c.url === '/lol-champ-select/v1/session/position-swaps/8/decline'), 'decline swap');
  await waitFor(() => state.champSelect.swaps.pickOrder.length === 0, 'swap resuelto');
  ok('aceptar y rechazar cambios desde el celu');

  // 4) skins
  mock.updateSession((s) => { s.myTeam[0].championId = 22; });
  await waitFor(() => state.skins.length === 2, 'skins');
  assert(!state.skins.find((x) => x.name === 'No owned'));
  ok('lista solo las skins que tenés');
  cmd('selectSkin', { skinId: 22001 });
  await waitFor(() => mock.calls.find((c) => c.url.endsWith('/my-selection') && c.body.selectedSkinId === 22001), 'skin');
  ok('elige skin');

  // 5) runas: datos, recomendadas, guardar editada
  const rd = await ask('runeData', { championId: 22, position: 'bottom' });
  assert(rd.ok && rd.styles.length === 2 && rd.recommended.length === 1 && rd.perks[8005]);
  assert(/22\/bottom\/11/.test(rd.recommended[0].name));
  ok('runas: estilos, íconos y recomendadas del juego para tu campeón y línea');
  const bad = await ask('saveRunes', { page: { primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [1, 2, 3] } });
  assert.strictEqual(bad.ok, false);
  ok('rechaza páginas de runas incompletas');
  const sv = await ask('saveRunes', { page: rd.recommended[0] });
  assert(sv.ok);
  assert(mock.st.pages.find((p) => p.name === 'Open Queue'));
  const created = mock.st.pages.find((p) => p.name === 'Open Queue');
  assert.strictEqual(mock.st.currentPage, created.id);
  ok('guarda una página "Open Queue" y la deja activa');
  const sv2 = await ask('saveRunes', { page: { name: 'x', primaryStyleId: 8100, subStyleId: 8000, selectedPerkIds: [8112, 8126, 8136, 8135, 9111, 9104, 5005, 5010, 5013] } });
  assert(sv2.ok && mock.st.pages.filter((p) => p.name === 'Open Queue').length === 1);
  assert.strictEqual(mock.st.pages.find((p) => p.name === 'Open Queue').primaryStyleId, 8100);
  ok('editar runas reutiliza la misma página (no llena tus páginas)');

  // 6) ARAM
  mock.setPhase('None'); await sleep(200);
  mock.startAram();
  await waitFor(() => state.champSelect && state.champSelect.benchEnabled, 'aram');
  assert.deepStrictEqual(state.champSelect.bench, [103, 157]);
  assert.strictEqual(state.champSelect.hasActions, false);
  ok('ARAM: muestra el banco de campeones disponibles y los rerolls');
  cmd('benchSwap', { championId: 103 });
  await waitFor(() => state.champSelect.myTeam[0].championId === 103, 'swap banco');
  ok('ARAM: cambiar por un campeón del banco');
  cmd('reroll');
  await waitFor(() => state.champSelect.rerolls === 1, 'reroll');
  ok('ARAM: reroll');

  // 7) diagnóstico
  const d = await ask('swap', { kind: 'nope', swapId: 1, accept: true });
  assert.strictEqual(d.ok, false);
  const info = await fetch(`http://127.0.0.1:${srv.port}/api/diag`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: true }) }).then((r) => r.json());
  assert(info.ok && info.file);
  mock.setPhase('Lobby'); await sleep(300);
  const stop = await fetch(`http://127.0.0.1:${srv.port}/api/diag`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: false }) }).then((r) => r.json());
  const dump = JSON.parse(fs.readFileSync(stop.file, 'utf8'));
  assert(dump.events.some((e) => e.uri === '/lol-gameflow/v1/gameflow-phase') && dump.snapshots.queues);
  assert(!JSON.stringify(dump).includes('secret123'));
  ok('diagnóstico: graba eventos y estado del cliente en un archivo, sin contraseñas');

  // 8) proxy de imágenes: solo rutas de assets
  const bad1 = await fetch(`http://127.0.0.1:${srv.port}/lcu-asset/lol-summoner/v1/current-summoner`);
  assert.strictEqual(bad1.status, 400);
  ok('proxy de imágenes rechaza rutas que no son de assets');

  ws.close(); await srv.close(); mock.close();
  console.log(`\nTODO OK (${n} comprobaciones)`);
  process.exit(0);
})().catch((e) => { console.error('\nFALLÓ:', e.message); process.exit(1); });
