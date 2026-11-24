'use strict';
// Cuarta prueba: baneados no elegibles, favoritos con pick automático al final del turno, recomendación por historial y apodos en ranked.
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
const game = (championId, lane, role, win) => ({ gameMode: 'CLASSIC', participants: [{ championId, stats: { win }, timeline: { lane, role } }] });

(async () => {
  const mock = await startMock();
  process.env.OQ_LOCKFILE = mock.lockfile;
  process.env.OQ_NO_KILL = '1';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-data4-'));
  const { startServer } = require('../src/server');
  const srv = await startServer({ dataDir, port: 4970 });
  let n = 0; const ok = (m) => console.log(`  ✓ ${++n}. ${m}`);
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  let state = null; const results = new Map(); const alerts = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'state') state = m.state;
    if (m.type === 'result') results.set(m.id, m.result);
    if (m.type === 'alert') alerts.push(m.alert);
  });
  await new Promise((r) => ws.on('open', r));
  let id = 0;
  const ask = async (type, extra) => { const i = ++id; ws.send(JSON.stringify(Object.assign({ type, id: i }, extra))); return waitFor(() => results.get(i), 'resultado ' + type); };
  ws.send(JSON.stringify({ type: 'auth', code: srv.store.code }));
  await waitFor(() => state && state.connected, 'conectado');

  // Historial: en top te va bien con 266 y mal con 22; 3 es tu mejor jungla.
  mock.st.history = [
    game(266, 'TOP', 'SOLO', true), game(266, 'TOP', 'SOLO', true), game(266, 'TOP', 'SOLO', true), game(266, 'TOP', 'SOLO', false),
    game(22, 'TOP', 'SOLO', false), game(22, 'TOP', 'SOLO', false), game(22, 'BOTTOM', 'DUO_CARRY', true),
    game(3, 'JUNGLE', 'NONE', true), { gameMode: 'ARAM', participants: [{ championId: 1, stats: { win: true }, timeline: {} }] },
  ];
  mock.st.mastery = [{ championId: 1, championPoints: 250000 }];
  mock.st.pickable = [1, 2, 3, 22, 266];

  // 1) Favoritos: máximo 3, sin repetidos
  assert((await ask('setFavorites', { ids: [22, 266, 22, 1, 2] })).ok);
  await waitFor(() => state.settings.favorites && state.settings.favorites.ids.length === 3, 'favoritos');
  assert.deepStrictEqual(state.settings.favorites.ids, [22, 266, 1]);
  await ask('setFavorites', { autoPick: true, useHistory: true });
  await waitFor(() => state.settings.favorites.autoPick && state.settings.favorites.useHistory, 'toggles');
  ok('favoritos: hasta 3 sin repetir, con pick automático y recomendación activables');

  // 2) Champ select: tu turno de pick con poco tiempo. 1 está baneado.
  mock.startChampSelect();
  const t0 = Date.now();
  mock.updateSession((s) => {
    s.actions = [
      [{ id: 0, actorCellId: 0, type: 'ban', championId: 1, completed: true, isInProgress: false }],
      [{ id: 2, actorCellId: 0, type: 'pick', championId: 0, completed: false, isInProgress: true }],
    ];
    s.timer = { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 3500, totalTimeInPhase: 30000, isInfinite: false };
  });
  await waitFor(() => state.champSelect && state.champSelect.myTurn && state.champSelect.myTurn.type === 'pick', 'turno de pick');
  assert(state.champSelect.banned.includes(1), 'el baneo confirmado figura como baneado');
  ok('los baneos confirmados figuran como baneados aunque la lista oficial no llegó');

  const lb = await ask('lockIn', { championId: 1 });
  assert.strictEqual(lb.ok, false); assert.strictEqual(lb.error, 'banned');
  const hb = await ask('hover', { championId: 1 });
  assert.strictEqual(hb.ok, false); assert.strictEqual(hb.error, 'banned');
  assert(!mock.calls.find((c) => c.method === 'PATCH' && /actions\/2$/.test(c.url) && c.body.championId === 1), 'no se manda al cliente');
  ok('un campeón baneado no se puede marcar ni confirmar (no llega al cliente)');

  await waitFor(() => state.champSelect.recommend && state.champSelect.recommend.length, 'recomendados');
  assert.strictEqual(state.champSelect.recommend[0].championId, 266, 'mejor en top: 266');
  assert.strictEqual(state.champSelect.recommend[0].games, 4); assert.strictEqual(state.champSelect.recommend[0].wins, 3);
  assert(!state.champSelect.recommend.some((x) => x.championId === 1 && x.games > 0), 'ARAM no cuenta');
  ok('recomendación: tus mejores campeones para tu línea según tus partidas (sin contar ARAM)');

  // 3) Pick automático: no se dispara antes de tiempo, y elige el mejor favorito para top (266 antes que 22; 1 está baneado).
  await sleep(1500);
  assert(!mock.calls.find((c) => c.method === 'PATCH' && /actions\/2$/.test(c.url) && c.body.completed), 'todavía no');
  await waitFor(() => mock.calls.find((c) => c.method === 'PATCH' && /actions\/2$/.test(c.url) && c.body.completed && c.body.championId === 266), 'pick automático', 4000);
  const pc = mock.calls.find((c) => c.method === 'PATCH' && /actions\/2$/.test(c.url) && c.body.completed);
  const leftAtPick = 3500 - (pc.t - t0);
  assert(leftAtPick < 1200 && leftAtPick > 0, 'se manda en el último segundo: ' + leftAtPick);
  await waitFor(() => alerts.find((a) => a.kind === 'autoPicked' && a.championId === 266), 'aviso pick automático');
  ok('pick automático: en el último segundo elige tu mejor favorito para la línea (salteando el baneado)');
  mock.setPhase('None'); await sleep(300);

  // 4) Si tenías uno marcado, se confirma ese.
  mock.startChampSelect();
  mock.updateSession((s) => {
    s.actions = [[{ id: 3, actorCellId: 0, type: 'pick', championId: 2, completed: false, isInProgress: true }]];
    s.timer = { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 1200, totalTimeInPhase: 30000, isInfinite: false };
  });
  await waitFor(() => mock.calls.find((c) => c.method === 'PATCH' && /actions\/3$/.test(c.url) && c.body.completed && c.body.championId === 2), 'confirma el marcado');
  ok('pick automático: si tenías un campeón marcado, se confirma ese');
  mock.setPhase('None'); await sleep(300);

  // 5) Apagado: no elige nada.
  await ask('setFavorites', { autoPick: false });
  mock.startChampSelect();
  mock.updateSession((s) => {
    s.actions = [[{ id: 4, actorCellId: 0, type: 'pick', championId: 0, completed: false, isInProgress: true }]];
    s.timer = { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 900, totalTimeInPhase: 30000, isInfinite: false };
  });
  await sleep(1500);
  assert(!mock.calls.find((c) => c.method === 'PATCH' && /actions\/4$/.test(c.url)), 'apagado no toca nada');
  ok('pick automático apagado: no elige nada');
  mock.setPhase('None'); await sleep(300);

  // 6) Chat en ranked: apodo que da el cliente por celda (en tu idioma), nunca "Aliado N".
  mock.st.chat = [];
  mock.st.cellSummoners = { 1: { cellId: 1, nameVisibilityType: 'HIDDEN', playerAlias: 'Dagarraco Rocoso' } };
  mock.startChampSelect();
  mock.updateSession((s) => {
    s.queueId = 420;
    Object.assign(s.myTeam[1], { nameVisibilityType: 'HIDDEN', gameName: '', obfuscatedSummonerId: 555, summonerId: 0, puuid: '', championId: 103, assignedPosition: 'jungle' });
    Object.assign(s.myTeam[2], { nameVisibilityType: 'HIDDEN', gameName: '', obfuscatedSummonerId: 556, summonerId: 0, puuid: '', championPickIntent: 22, assignedPosition: 'middle' });
  });
  mock.st.csParticipants = [{ pid: 'o2', name: 'Poro Veloz', obfuscatedSummonerId: 556 }];
  await waitFor(() => state.phase === 'ChampSelect' && state.champSelect, 'ranked');
  await sleep(300);
  mock.addRawChat({ body: 'voy top', type: 'chat', fromObfuscatedSummonerId: 555, fromSummonerId: 0, fromPuuid: '', fromId: 'o1', fromPid: 'o1' });
  mock.addRawChat({ body: 'mid', type: 'chat', fromObfuscatedSummonerId: 556, fromSummonerId: 0, fromPuuid: '', fromId: 'o2', fromPid: 'o2' });
  await waitFor(() => state.chat.some((c) => c.body === 'mid'), 'mensajes ranked');
  const c1 = state.chat.find((c) => c.body === 'voy top'); const c2 = state.chat.find((c) => c.body === 'mid');
  assert.strictEqual(c1.name, 'Dagarraco Rocoso'); assert.strictEqual(c1.allyN, 0); assert.strictEqual(c1.pos, 'jungle');
  assert.strictEqual(c2.name, 'Poro Veloz'); assert.strictEqual(c2.champId, 22);
  ok('chat en ranked: se ve el apodo del cliente (de la celda o del chat), con ícono y línea, sin "Aliado N"');
  mock.setPhase('None'); await sleep(200);

  ws.close(); await srv.close(); mock.close();
  console.log(`\nTODO OK (${n} comprobaciones)`);
  process.exit(0);
})().catch((e) => { console.error('\nFALLÓ:', e.message); process.exit(1); });
