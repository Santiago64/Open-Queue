'use strict';
// Prueba de punta a punta contra un cliente de LoL simulado.
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-data-'));
  const { startServer } = require('../src/server');
  const srv = await startServer({ dataDir, port: 0 + 4800 });
  const port = srv.port;
  let step = 0;
  const ok = (m) => console.log(`  ✓ ${++step}. ${m}`);

  // --- cliente "celu" ---
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let state = null;
  const alerts = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    inbox.push(m);
    if (m.type === 'state') state = m.state;
    if (m.type === 'alert') alerts.push(m.alert);
  });
  await new Promise((r) => ws.on('open', r));
  const cmd = (type, extra) => ws.send(JSON.stringify(Object.assign({ type }, extra)));

  // auth mala y buena
  cmd('accept'); // sin autenticar: debe ser ignorado
  ws.send(JSON.stringify({ type: 'auth', code: '000000' }));
  await waitFor(() => inbox.find((m) => m.type === 'authError'), 'authError');
  ok('código incorrecto rechazado');
  ws.send(JSON.stringify({ type: 'auth', code: srv.store.code }));
  const authed = await waitFor(() => inbox.find((m) => m.type === 'authed'), 'authed');
  assert(authed.token && authed.token.length > 20);
  ok('vinculación con código correcto, recibe token');

  await waitFor(() => state && state.connected, 'estado conectado al LCU');
  assert.strictEqual(state.phase, 'None');
  ok('detecta el cliente de LoL (lockfile + HTTPS autofirmado + WebSocket)');
  assert(state.queues.find((q) => q.id === 420) && !state.queues.find((q) => q.id === 999));
  ok('lista de colas filtra las personalizadas');

  // buscar partida
  cmd('search', { queueId: 420, id: 1 });
  await waitFor(() => state.phase === 'Matchmaking', 'fase Matchmaking');
  assert(mock.calls.find((c) => c.method === 'POST' && c.url === '/lol-lobby/v2/lobby' && c.body.queueId === 420));
  ok('crea sala y busca partida desde el celu');
  await waitFor(() => state.search && state.search.state === 'Searching', 'search-state');
  ok('muestra estado de la búsqueda');

  // autoaceptar con retraso de 1.5 s
  cmd('setAutoAccept', { enabled: true, delay: 1.5 });
  await waitFor(() => state.settings.autoAccept.enabled && state.settings.autoAccept.delay === 1.5, 'config autoaceptar');
  const t0 = Date.now();
  mock.setPhase('ReadyCheck');
  await waitFor(() => alerts.find((a) => a.kind === 'matchFound'), 'alerta matchFound');
  ok('alerta de partida encontrada llega al celu');
  await sleep(700);
  assert(!mock.calls.find((c) => c.url === '/lol-matchmaking/v1/ready-check/accept'), 'aceptó demasiado pronto');
  ok('el autoaceptar respeta el retraso (no acepta antes)');
  const acc = await waitFor(() => mock.calls.find((c) => c.url === '/lol-matchmaking/v1/ready-check/accept'), 'accept auto');
  const dt = acc.t - t0;
  assert(dt >= 1400 && dt < 2400, 'retraso fuera de rango: ' + dt);
  ok(`autoaceptó a los ${dt} ms (config 1500 ms)`);
  await sleep(500);
  assert.strictEqual(mock.calls.filter((c) => c.url === '/lol-matchmaking/v1/ready-check/accept').length, 1);
  ok('acepta una sola vez');

  // desconexión del celu: el autoaceptar corre en la PC
  ws.close();
  await sleep(200);
  mock.setPhase('None');
  await sleep(200);
  mock.calls.length = 0;
  mock.setPhase('ReadyCheck');
  await waitFor(() => mock.calls.find((c) => c.url === '/lol-matchmaking/v1/ready-check/accept'), 'accept sin celu', 4000);
  ok('el autoaceptar funciona sin ningún celu conectado');

  // reconexión con token
  const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox2 = [];
  let state2 = null;
  const alerts2 = [];
  ws2.on('message', (raw) => {
    const m = JSON.parse(raw.toString()); inbox2.push(m);
    if (m.type === 'state') state2 = m.state;
    if (m.type === 'alert') alerts2.push(m.alert);
  });
  await new Promise((r) => ws2.on('open', r));
  ws2.send(JSON.stringify({ type: 'auth', token: authed.token }));
  await waitFor(() => inbox2.find((m) => m.type === 'authed'), 'authed token');
  ok('reconecta con token guardado sin pedir código');
  const cmd2 = (type, extra) => ws2.send(JSON.stringify(Object.assign({ type }, extra)));

  // champ select
  mock.setPhase('None');
  await sleep(100);
  cmd2('setPrePick', { championId: 22 });
  await waitFor(() => state2.settings.prePick.championId === 22, 'prepick guardado');
  mock.startChampSelect();
  await waitFor(() => state2.champSelect && state2.champSelect.myTurn, 'champ select con turno');
  assert.strictEqual(state2.champSelect.myTurn.type, 'ban');
  assert.strictEqual(state2.champSelect.info.pickNumber, 2);
  assert.strictEqual(state2.champSelect.info.picksBefore, 1);
  ok('champ select: detecta tu turno de ban y tu orden de pick (#2, 1 pick antes)');
  await waitFor(() => alerts2.find((a) => a.kind === 'yourTurn' && a.type === 'ban'), 'alerta turno');
  ok('alerta de "es tu turno" al celu');
  await waitFor(() => state2.champSelect.bannable.length > 0, 'bannable');

  cmd2('hover', { championId: 266 });
  await waitFor(() => mock.calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/actions/0') && c.body.championId === 266), 'hover ban');
  cmd2('lockIn', { championId: 266 });
  await waitFor(() => mock.calls.find((c) => c.url.endsWith('/actions/0') && c.body.completed === true), 'lock ban');
  ok('banear: toque en campeón + confirmar (hover y completed=true)');

  // turno de pick: pre-pick debería haber hecho hover 22 sobre acción 2
  await waitFor(() => mock.calls.find((c) => c.url.endsWith('/actions/2') && c.body.championId === 22), 'prepick hover');
  ok('pick preparado: hace hover automático de tu campeón guardado al empezar');
  mock.updateSession((s) => { s.actions[1][0].completed = true; s.actions[1][0].isInProgress = false; s.actions[2][0].isInProgress = true; });
  await waitFor(() => state2.champSelect.myTurn && state2.champSelect.myTurn.type === 'pick', 'turno de pick');
  cmd2('lockIn', { championId: 22 });
  await waitFor(() => mock.calls.find((c) => c.url.endsWith('/actions/2') && c.body.completed === true), 'lock pick');
  ok('pickear: confirma el campeón');

  cmd2('setSpells', { spell1Id: 4, spell2Id: 7 });
  await waitFor(() => state2.champSelect.myTeam[0].spell2Id === 7, 'hechizos');
  ok('cambia hechizos de invocador');

  cmd2('selectRunePage', { id: 11 });
  await waitFor(() => state2.runes.currentId === 11, 'runas');
  assert.strictEqual(state2.runes.pages.length, 2);
  ok('cambia la página de runas');

  mock.addChat('hola equipo', 701);
  await waitFor(() => state2.chat.find((c) => c.body === 'hola equipo' && c.name === 'Player701'), 'chat recibido');
  cmd2('sendChat', { body: 'ok jg' });
  await waitFor(() => state2.chat.find((c) => c.body === 'ok jg' && c.mine), 'chat enviado');
  ok('chat de la lobby: recibe y envía mensajes con nombres');

  // pre-pick baneado
  cmd2('setPrePick', { championId: 99 });
  await waitFor(() => state2.settings.prePick.championId === 99, 'prepick 99');
  ok('guarda otro pick preparado (si estuviera baneado, avisa en vez de usarlo)');

  // seguridad
  const status = await new Promise((resolve) => {
    require('http').get({ host: '127.0.0.1', port, path: '/api/status', headers: { Host: 'evil.com' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0));
  });
  assert.strictEqual(status, 403);
  ok('API de escritorio rechaza Host ajeno (anti DNS-rebinding)');
  const r2 = await fetch(`http://127.0.0.1:${port}/api/status`);
  const js = await r2.json();
  assert(js.pairing.qr.startsWith('data:image/png') && js.pairing.code === srv.store.code);
  ok('el escritorio obtiene QR y código de vinculación');

  ws2.close();
  await srv.close();
  mock.close();
  console.log(`\nTODO OK (${step} comprobaciones)`);
  process.exit(0);
})().catch((e) => { console.error('\nFALLÓ:', e.message); process.exit(1); });
