'use strict';
// Tercera prueba: ARAM Mayhem, ARAM sin baneos, hechizos por modo y los 2 slots de Swiftplay.
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
  process.env.OQ_NO_KILL = '1';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-data3-'));
  const { startServer } = require('../src/server');
  const srv = await startServer({ dataDir, port: 4960 });
  let n = 0; const ok = (m) => console.log(`  ✓ ${++n}. ${m}`);
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  let state = null; const results = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'state') state = m.state;
    if (m.type === 'result') results.set(m.id, m.result);
  });
  await new Promise((r) => ws.on('open', r));
  let id = 0;
  const ask = async (type, extra) => { const i = ++id; ws.send(JSON.stringify(Object.assign({ type, id: i }, extra))); return waitFor(() => results.get(i), 'resultado ' + type); };
  ws.send(JSON.stringify({ type: 'auth', code: srv.store.code }));
  await waitFor(() => state && state.connected, 'conectado');

  // 1) ARAM Mayhem en la lista, justo después de ARAM
  const ids = state.queues.map((q) => q.id);
  assert(ids.includes(2400) && ids.indexOf(2400) === ids.indexOf(450) + 1, 'Mayhem: ' + ids);
  const r = await ask('search', { queueId: 2400 });
  assert(r.ok);
  assert(mock.calls.find((c) => c.method === 'POST' && c.url === '/lol-lobby/v2/lobby' && c.body.queueId === 2400));
  ok('ARAM Mayhem aparece junto a ARAM y se puede buscar');
  await ask('leaveLobby');

  // 2) El cliente informa los hechizos de cada modo
  assert(state.spellModes && state.spellModes['32'].includes('ARAM') && !state.spellModes['11'].includes('ARAM'));
  ok('el cliente informa en qué modos va cada hechizo (Marca solo ARAM, Aplastar solo clásico)');

  // 3) ARAM: sin baneos
  mock.startAram();
  await waitFor(() => state.champSelect && state.champSelect.benchEnabled, 'aram');
  assert.strictEqual(state.champSelect.hasBans, false);
  assert.deepStrictEqual(state.champSelect.bans, { my: [], their: [] });
  ok('ARAM: no hay fase ni lista de baneos');
  await waitFor(() => state.gameMode === 'CLASSIC' || state.gameMode === 'ARAM' || state.gameMode === 'KIWI', 'modo');

  // 4) Draft normal sí tiene baneos
  mock.setPhase('None'); await sleep(200);
  mock.startChampSelect();
  await waitFor(() => state.champSelect && state.champSelect.hasBans, 'draft con bans');
  ok('Draft: sí hay baneos');
  mock.setPhase('None'); await sleep(200);

  // 5) Swiftplay: los dos slots
  const s1 = await ask('search', { queueId: 480 });
  assert(s1.ok);
  await waitFor(() => state.lobby && state.lobby.quickPlay && state.lobby.slots.length === 2, 'slots swiftplay');
  assert.strictEqual(state.lobby.slots[0].position, 'BOTTOM');
  assert.strictEqual(state.lobby.slots[1].perks.primaryStyleId, 8000);
  ok('Swiftplay: se leen los 2 slots (rol, campeón, hechizos, runas, skin)');
  await waitFor(() => state.owned && state.owned.length === 3, 'campeones propios');
  ok('Swiftplay: lista de campeones que tenés');

  const c1 = await ask('setQuickSlot', { index: 0, patch: { championId: 103 } });
  assert(c1.ok, JSON.stringify(c1));
  await waitFor(() => state.lobby.slots[0].championId === 103, 'campeón nuevo');
  assert.strictEqual(state.lobby.slots[0].skinId, 103000);
  const put = mock.calls.filter((c) => c.url.endsWith('/player-slots')).pop();
  assert.strictEqual(put.body.length, 2);
  assert.strictEqual(put.body[1].championId, 22);
  assert.strictEqual(typeof put.body[0].perks, 'string');
  assert.strictEqual(JSON.parse(put.body[0].perks).perkStyle, 8000);
  assert(mock.calls.find((c) => c.url === '/lol-perks/v1/quick-play-selections/champion/103/position/BOTTOM'));
  ok('Swiftplay: al cambiar de campeón se piden al cliente las runas sugeridas de ese campeón y rol');
  ok('Swiftplay: cambiar campeón manda los 2 slots y deja la skin base');

  await ask('setQuickSlot', { index: 1, patch: { position: 'JUNGLE', spell1: 11, spell2: 4 } });
  await waitFor(() => state.lobby.slots[1].position === 'JUNGLE' && state.lobby.slots[1].spell1 === 11, 'rol y hechizos');
  ok('Swiftplay: rol y hechizos del slot 2');

  const rn = await ask('setQuickSlot', { index: 0, patch: { perks: { primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [8005, 9111, 9104, 8014, 8126, 8136, 5008, 5008, 5011] } } });
  assert(rn.ok);
  await waitFor(() => state.lobby.slots[0].perks.selectedPerkIds[0] === 8005, 'runas');
  ok('Swiftplay: runas del slot (guardadas, recomendadas o propias)');

  const sk = await ask('ownedSkins', { championId: 103 });
  assert(sk.ok && sk.skins.length === 2 && sk.skins.every((x) => x.id !== 103002));
  await ask('setQuickSlot', { index: 0, patch: { skinId: 103001 } });
  await waitFor(() => state.lobby.slots[0].skinId === 103001, 'skin');
  ok('Swiftplay: solo muestra las skins que tenés y la elegida queda guardada');

  const bad = await ask('setQuickSlot', { index: 0, patch: { spell1: 4, spell2: 4 } });
  assert.strictEqual(bad.ok, false);
  const bad2 = await ask('setQuickSlot', { index: 5, patch: { position: 'TOP' } });
  assert.strictEqual(bad2.ok, false);
  const bad3 = await ask('setQuickSlot', { index: 0, patch: { position: 'NOPE' } });
  assert.strictEqual(bad3.ok, false);
  ok('Swiftplay: rechaza hechizos repetidos, slots y roles inválidos');

  // Runas recomendadas: las 3 del juego (endpoint) + páginas temporales del cliente
  const rr = await ask('runeData', { championId: 103, position: 'middle' });
  assert(rr.ok && rr.recommended.length === 3 && rr.recommended.every((x) => x.selectedPerkIds.length === 9), JSON.stringify(rr.recommended));
  ok('runas recomendadas: aparecen las 3 que ofrece el juego para el campeón');
  const rr2 = await ask('runeData', { championId: 22, position: 'bottom' });
  assert(rr2.recommended.length === 1 && !rr2.recommended[0].id);
  ok('runas recomendadas: con una sola disponible se muestra solo esa');
  // el cliente ya tiene una página temporal de Ahri: "usar" reutiliza esa página y no gasta un lugar propio
  mock.st.pages.push({ id: 950, name: 'Ahri - Old', isEditable: true, isValid: true, isTemporary: true, recommendationChampionId: 103, recommendationIndex: 0, primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [8005, 9111, 9104, 8014, 8126, 8136, 5008, 5008, 5011] });
  await waitFor(async () => { await ask('runeData', { championId: 103, position: 'middle' }); return state.runes.pages.some((p) => p.temp); }, 'páginas temporales');
  assert(state.runes.pages.filter((p) => !p.temp).length === 2);
  ok('las páginas temporales se distinguen de tus páginas propias');
  const nOwn = mock.st.pages.length;
  const us = await ask('useRunes', { page: rr.recommended[1], championId: 103 });
  assert(us.ok, JSON.stringify(us));
  assert.strictEqual(mock.st.pages.length, nOwn);
  assert.strictEqual(mock.st.pages.find((p) => p.id === 950).selectedPerkIds[0], 8006);
  assert.strictEqual(mock.st.currentPage, 950);
  ok('usar una recomendada: se aplica sobre la página temporal del cliente, sin gastar tus páginas');
  mock.st.pages = mock.st.pages.filter((p) => p.id !== 950);

  // Guardar runas propias con las 3 páginas ya llenas
  const mine = { primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [8005, 9111, 9104, 8014, 8126, 8136, 5008, 5008, 5011] };
  const sv1 = await ask('saveRunes', { page: mine });
  assert(sv1.ok, JSON.stringify(sv1)); // hay lugar: se crea "Open Queue"
  const before = mock.st.pages.filter((p) => !p.isTemporary).length;
  assert.strictEqual(before, 3);
  mock.st.pages = mock.st.pages.filter((p) => p.name !== 'Open Queue');
  mock.st.pages.push({ id: 12, name: 'Page C', isEditable: true, isValid: true });
  const sv2 = await ask('saveRunes', { page: mine });
  assert.strictEqual(sv2.ok, false);
  assert.strictEqual(sv2.error, 'full');
  assert(sv2.pages.length === 3 && sv2.pages.every((x) => x.id && x.name) && !sv2.pages.some((x) => x.id >= 900));
  ok('guardar con las 3 páginas llenas: pide elegir cuál reemplazar (sin ofrecer las temporales)');
  const sv3 = await ask('saveRunes', { page: mine, replaceId: 11 });
  assert(sv3.ok);
  assert.strictEqual(mock.st.pages.find((p) => p.id === 11).name, 'Page B');
  assert.strictEqual(mock.st.pages.find((p) => p.id === 10).name, 'Page A');
  ok('reemplazar la página elegida y dejarla activa, sin tocar las demás');

  // ---- Crear una página nueva con nombre propio (hay lugar libre)
  mock.st.pages = mock.st.pages.filter((p) => p.id !== 12 && p.isTemporary !== true).slice(0, 2);
  const nOwn2 = mock.st.pages.length;
  const sv4 = await ask('saveRunes', { page: mine, name: 'Mi build' });
  assert(sv4.ok, JSON.stringify(sv4));
  assert.strictEqual(mock.st.pages.length, nOwn2 + 1);
  assert(mock.st.pages.some((p) => p.name === 'Mi build'));
  ok('runas: se puede crear una página nueva con nombre propio cuando hay lugar');

  // ---- Rol principal/secundario antes de buscar
  await ask('leaveLobby'); await sleep(200);
  const rs = await ask('setRoles', { first: 'MIDDLE', second: 'BOTTOM' });
  assert(rs.ok && state.settings.roles.first === 'MIDDLE');
  assert.strictEqual((await ask('setRoles', { first: 'NOPE', second: '' })).ok, false);
  const nCalls = mock.calls.length;
  const sr = await ask('search', { queueId: 420 });
  assert(sr.ok);
  const after = mock.calls.slice(nCalls).map((c) => c.method + ' ' + c.url);
  const iPos = after.indexOf('PUT /lol-lobby/v1/lobby/members/localMember/position-preferences');
  const iSearch = after.indexOf('POST /lol-lobby/v2/lobby/matchmaking/search');
  assert(iPos >= 0 && iSearch > iPos, after.join(' | '));
  assert.deepStrictEqual(mock.calls.filter((c) => c.url.endsWith('/position-preferences')).pop().body, { firstPreference: 'MIDDLE', secondPreference: 'BOTTOM' });
  ok('rol principal y secundario: se aplican a la sala antes de empezar la búsqueda');
  await ask('cancelSearch'); await ask('leaveLobby'); mock.setPhase('None'); await sleep(200);

  // ---- Pedir cambios (Grieta) y pedido recibido en ARAM
  mock.startChampSelect();
  await waitFor(() => state.champSelect && state.champSelect.hasBans, 'draft');
  mock.updateSession((x) => {
    x.pickOrderSwaps = [{ id: 5, cellId: 1, state: 'AVAILABLE' }];
    x.positionSwaps = [{ id: 6, cellId: 2, state: 'SENT' }, { id: 7, cellId: 3, state: 'AVAILABLE' }];
  });
  await waitFor(() => state.champSelect.swapOpts.pickOrder.length === 1, 'opciones');
  assert.strictEqual(state.champSelect.swapOpts.position.length, 2);
  assert.strictEqual(state.champSelect.swapOpts.position.find((x) => x.cellId === 2).sent, true);
  const rq = await ask('swap', { kind: 'pickOrder', swapId: 5, action: 'request' });
  assert(rq.ok && mock.calls.find((c) => c.url === '/lol-champ-select/v1/session/pick-order-swaps/5/request'));
  const cn = await ask('swap', { kind: 'position', swapId: 6, action: 'cancel' });
  assert(cn.ok && mock.calls.find((c) => c.url === '/lol-champ-select/v1/session/position-swaps/6/cancel'));
  ok('pedir cambio de orden de pick y de rol a un compañero, y cancelar el pedido');
  mock.setPhase('None'); await sleep(200);
  mock.startAram();
  await waitFor(() => state.champSelect && state.champSelect.benchEnabled, 'aram');
  mock.updateSession((x) => { x.trades = [{ id: 11, cellId: 2, state: 'RECEIVED' }, { id: 12, cellId: 3, state: 'AVAILABLE' }]; });
  await waitFor(() => state.champSelect.swaps.champion.length === 1 && state.champSelect.swapOpts.champion.length === 1, 'cambio de campeón');
  const rc = await ask('swap', { kind: 'champion', swapId: 12, action: 'request' });
  assert(rc.ok && mock.calls.find((c) => c.url === '/lol-champ-select/v1/session/trades/12/request'));
  await ask('swap', { kind: 'champion', swapId: 11, accept: true });
  assert(mock.calls.find((c) => c.url === '/lol-champ-select/v1/session/trades/11/accept'));
  ok('ARAM: aparece el pedido de cambio de campeón que te hacen, y podés pedirlo vos');

  // ---- ARAM Mayhem: 2 opciones iniciales + estado del pedido en curso
  mock.setPhase('None'); await sleep(200);
  mock.startAram();
  await waitFor(() => state.champSelect && state.champSelect.benchEnabled, 'aram2');
  mock.emit('/lol-lobby-team-builder/champ-select/v1/subset-champion-list', [421, 18], 'Create');
  await waitFor(() => state.champSelect.subset && state.champSelect.subset.length === 2, 'subset');
  assert.deepStrictEqual(state.champSelect.subset, [421, 18]);
  mock.emit('/lol-champ-select/v1/ongoing-champion-swap', { id: 56, initiatedByLocalPlayer: true, state: 'DECLINED', requesterChampionName: 'Tristana', responderChampionName: 'Maokai' }, 'Update');
  await waitFor(() => state.champSelect.ongoingSwap && state.champSelect.ongoingSwap.state === 'DECLINED', 'ongoing');
  ok('ARAM Mayhem: se leen las 2 opciones iniciales y el estado del cambio pedido (rechazado)');

  // ---- Dodge (solo en champ select; en la prueba no se cierra ningún proceso)
  const dg = await ask('dodge', {});
  assert(dg.ok && mock.calls.find((c) => c.url === '/process-control/v1/process/quit'));
  mock.setPhase('None'); await sleep(300);
  assert.strictEqual((await ask('dodge', {})).ok, false);
  ok('dodge: cierra el cliente solo durante el champ select');

  ws.close(); await srv.close(); mock.close();
  console.log(`\nTODO OK (${n} comprobaciones)`);
  process.exit(0);
})().catch((e) => { console.error('\nFALLÓ:', e.message); process.exit(1); });
