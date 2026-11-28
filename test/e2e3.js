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

  // ---- Ban preparado: se banea solo al llegar tu turno
  assert((await ask('setPreBan', { championId: 266 })).ok);
  assert.strictEqual(state.settings.preBan.championId, 266);
  const nb = mock.calls.length;
  mock.startChampSelect();
  await waitFor(() => mock.calls.slice(nb).find((c) => c.method === 'PATCH' && /actions\/0$/.test(c.url) && c.body && c.body.championId === 266 && !c.body.completed), 'ban preparado marcado');
  await sleep(500);
  assert(!mock.calls.slice(nb).find((c) => c.method === 'PATCH' && /actions\/0$/.test(c.url) && c.body && c.body.completed), 'no se confirma antes del final');
  mock.updateSession((s) => { s.timer = { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 1200, totalTimeInPhase: 30000, isInfinite: false }; });
  await waitFor(() => mock.calls.slice(nb).find((c) => c.method === 'PATCH' && /actions\/0$/.test(c.url) && c.body && c.body.championId === 266 && c.body.completed === true), 'ban preparado');
  await ask('setPreBan', { championId: null });
  mock.setPhase('None'); await sleep(300);
  ok('ban preparado: se marca al empezar tu turno (tu equipo lo ve) y se confirma en el segundo 0');

  // ---- Chat en ranked: apodo del cliente + campeón de quien habla
  mock.st.chat = [];
  mock.startChampSelect();
  mock.st.session.queueId = 420;
  Object.assign(mock.st.session.myTeam[1], { nameVisibilityType: 'HIDDEN', playerAlias: 'Escarabajo Rocoso', gameName: '', obfuscatedSummonerId: 99123, summonerId: 0, puuid: '', championId: 103, assignedPosition: 'jungle' });
  mock.emit('/lol-champ-select/v1/session', mock.st.session);
  await waitFor(() => state.phase === 'ChampSelect' && state.champSelect, 'champ select ranked');
  await sleep(300);
  mock.addRawChat({ body: 'gank mid', type: 'chat', fromObfuscatedSummonerId: 99123, fromSummonerId: 0, fromPuuid: '', fromId: 'o1', fromPid: 'o1' });
  await waitFor(() => state.chat.some((c) => c.body === 'gank mid'), 'mensaje ranked');
  const rk = state.chat.find((c) => c.body === 'gank mid');
  assert.strictEqual(rk.name, ''); assert.strictEqual(rk.champId, 103); assert.strictEqual(rk.pos, 'jungle');
  mock.setPhase('None'); await sleep(300);
  ok('chat en ranked: sin nombre ni apodo, solo campeón y línea de quien habla');

  // ---- Crear sala sin buscar
  assert.strictEqual(state.phase, 'None');
  const nSearch = mock.calls.filter((c) => c.url === '/lol-lobby/v2/lobby/matchmaking/search').length;
  assert((await ask('createLobby', { queueId: 450 })).ok);
  mock.setPhase('Lobby'); await waitFor(() => state.phase === 'Lobby' && state.lobbyQueueId === 450, 'sala creada sin buscar');
  assert.strictEqual(mock.calls.filter((c) => c.url === '/lol-lobby/v2/lobby/matchmaking/search').length, nSearch, 'no debe buscar');
  assert((await ask('createLobby', { queueId: 2400 })).ok); // ya en sala: cambia el modo
  await waitFor(() => state.lobbyQueueId === 2400, 'modo en sala');
  await ask('leaveLobby', {}); await waitFor(() => state.phase === 'None', 'fuera crear');
  ok('crear sala sin buscar: entrás a la sala para invitar amigos antes');

  // ---- Invitar amigos
  const fr = await ask('friends', {});
  assert(fr.ok); assert.deepStrictEqual(fr.friends.map((f) => f.name), ['Amigo Uno#AR1', 'Amigo Dos#AR2', 'Con Celu#M']);
  assert.strictEqual(fr.friends[1].status, 'ingame'); assert.strictEqual(fr.friends[1].queue, 'ARAM Mayhem'); assert.strictEqual(fr.friends[1].icon, 5); assert.strictEqual(fr.friends[2].status, 'mobile');
  assert.strictEqual((await ask('inviteFriend', { summonerId: 11 })).error, 'notLobby');
  await ask('search', { queueId: 450 }); mock.setPhase('Lobby'); await waitFor(() => state.phase === 'Lobby', 'sala para invitar');
  assert((await ask('inviteFriend', { summonerId: 11 })).ok);
  const ic = mock.calls.filter((c) => c.method === 'POST' && c.url === '/lol-lobby/v2/lobby/invitations').pop();
  assert.deepStrictEqual(ic.body, [{ toSummonerId: 11 }]);
  mock.st.inviteFails = true; assert.strictEqual((await ask('inviteFriend', { summonerId: 11 })).error, 'inviteFail'); mock.st.inviteFails = false;
  // Quien ya está en la sala no se ofrece ni se puede invitar; los que tienen invitación pendiente se ven como enviada.
  mock.st.extraMembers = [11]; mock.st.lobbyInvites = [{ toSummonerId: 12, state: 'Pending' }];
  const fr2 = await ask('friends', {});
  const uno = fr2.friends.find((f) => f.id === 11); const dos = fr2.friends.find((f) => f.id === 12);
  assert(uno.inLobby && !dos.inLobby && dos.invited, 'marcas de sala e invitación');
  assert.strictEqual(fr2.friends[fr2.friends.length - 1].id, 11, 'los de la sala van al final');
  assert.strictEqual((await ask('inviteFriend', { summonerId: 11 })).error, 'inLobby');
  mock.st.extraMembers = []; mock.st.lobbyInvites = [];
  await ask('leaveLobby', {}); await waitFor(() => state.phase === 'None', 'fuera inv');
  ok('invitar amigos: lista de conectados con estado y envío de invitación; los que ya están en tu sala no se pueden invitar');

  // ---- Emotes y ward
  const cd = await ask('cosmeticsData', {});
  assert(cd.ok); assert.strictEqual(cd.slots.EMOTES_WHEEL_CENTER.name, 'Emote B'); assert.strictEqual(cd.ward.name, 'Ward Uno');
  assert(cd.ownedEmotes.length >= 3 && cd.ownedWards.length === 2);
  assert(cd.ownedEmotes.find((e) => e.id === 3120).icon.startsWith('/lcu-asset/lol-game-data/'));
  assert((await ask('setEmote', { slot: 'EMOTES_WHEEL_UPPER', itemId: 5220 })).ok);
  assert.strictEqual(mock.st.loadout.loadout.EMOTES_WHEEL_UPPER.itemId, 5220);
  mock.st.putLoadoutFails = true; // si el juego rechaza PUT, prueba PATCH
  assert((await ask('setEmote', { slot: 'EMOTES_WHEEL_LEFT', itemId: 4848 })).ok);
  assert.strictEqual(mock.st.loadout.loadout.EMOTES_WHEEL_LEFT.itemId, 4848);
  assert((await ask('setWard', { itemId: 7 })).ok);
  assert.strictEqual(mock.st.loadout.loadout.WARD_SKIN_SLOT.itemId, 7);
  assert.strictEqual((await ask('setEmote', { slot: 'NOPE', itemId: 1 })).ok, false);
  mock.st.putLoadoutFails = false;
  ok('emotes y ward: se listan los tuyos, se cambian en la rueda y se verifica que quedaron');

  // ---- Chat de la sala (antes del champ select)
  mock.st.chat = [];
  await ask('search', { queueId: 450 }); mock.setPhase('Lobby');
  await waitFor(() => state.phase === 'Lobby' && state.chatReady, 'chat de la sala');
  mock.addChat('hola lobby', 5);
  await waitFor(() => state.chat.some((c) => c.body === 'hola lobby' && !c.mine), 'mensaje de la sala');
  assert((await ask('sendChat', { body: 'listo para jugar' })).ok);
  await waitFor(() => state.chat.some((c) => c.body === 'listo para jugar' && c.mine), 'mi mensaje en la sala');
  await ask('leaveLobby', {}); await waitFor(() => state.phase === 'None' && !state.chatReady, 'chat cerrado');
  ok('chat de la sala: se ven los mensajes que escribís y los que te escriben');

  // ---- Nick en el chat de la sala (el cliente manda pid y no summonerId)
  await ask('search', { queueId: 450 }); mock.setPhase('Lobby');
  await waitFor(() => state.phase === 'Lobby' && state.chatReady, 'chat sala 2');
  mock.addRawChat({ body: 'hola desde pid', fromPid: 'p5', fromSummonerId: 0, fromId: 'x5' });
  mock.addRawChat({ body: 'mio por pid', fromPid: 'pme', fromId: 'me1', fromSummonerId: 0 });
  await waitFor(() => state.chat.some((c) => c.body === 'hola desde pid' && c.name === 'Amigo Lobby' && !c.mine), 'nick del amigo');
  assert(state.chat.find((c) => c.body === 'mio por pid').mine);
  mock.addRawChat({ body: 'solo puuid', fromPuuid: 'other-puu', fromId: 'z@br1', fromPid: 'z@br1', fromSummonerId: 0 });
  mock.addRawChat({ body: 'yo puuid', fromPuuid: 'my-puu', fromId: 'q@br1', fromPid: 'q@br1', fromSummonerId: 0 });
  await waitFor(() => state.chat.some((c) => c.body === 'solo puuid' && c.name === 'Por Puuid'), 'nick por puuid');
  assert(state.chat.find((c) => c.body === 'yo puuid').mine, 'mi mensaje por puuid');
  await ask('leaveLobby', {}); await waitFor(() => state.phase === 'None', 'fuera');
  ok('chat de la sala: se ve el nick de quien escribe (aunque el cliente no mande summonerId)');

  // ---- Chat de la sala en clientes nuevos: no tiene tipo conocido, se encuentra por el id de la sala
  mock.st.lobbyChat = false; mock.st.chat = [];
  await ask('search', { queueId: 450 }); mock.setPhase('Lobby');
  await waitFor(() => state.phase === 'Lobby' && state.chatReady, 'chat sala por muc', 12000);
  mock.addRawChat({ body: 'hola desde la sala nueva', fromPid: 'p5', fromSummonerId: 0, fromId: 'x5' });
  await waitFor(() => state.chat.some((c) => c.body === 'hola desde la sala nueva'), 'mensaje sala muc');
  const nPost = mock.calls.length;
  assert((await ask('sendChat', { body: 'vamos' })).ok);
  assert(mock.calls.slice(nPost).find((c) => c.method === 'POST' && c.url.startsWith('/lol-chat/v1/conversations/muc-1%40lol-pre-game.la2.pvp.net/messages')), 'manda al chat de la sala');
  await ask('leaveLobby', {}); await waitFor(() => state.phase === 'None', 'fuera muc');
  mock.st.lobbyChat = true;
  ok('chat de la sala (cliente nuevo): se encuentra por el id de la sala y se puede escribir');

  // ---- Invitaciones a sala
  mock.st.invites = [{ invitationId: 'inv1', fromSummonerId: 5, state: 'Pending' }];
  await waitFor(() => state.invites && state.invites.length === 1, 'invitación pendiente');
  assert.strictEqual(state.phase, 'None');
  await ask('setAutoInvite', { enabled: true });
  await waitFor(() => state.phase === 'Lobby', 'se unió solo');
  assert(mock.calls.find((c) => c.url === '/lol-lobby/v2/received-invitations/inv1/accept'));
  await ask('setAutoInvite', { enabled: false });
  await ask('leaveLobby', {}); await waitFor(() => state.phase === 'None', 'fuera 2');
  mock.st.invites = [{ invitationId: 'inv2', fromSummonerId: 5, state: 'Pending' }];
  await waitFor(() => state.invites.length === 1 && state.invites[0].id === 'inv2', 'inv2');
  assert((await ask('answerInvite', { inviteId: 'inv2', accept: true })).ok);
  await waitFor(() => state.phase === 'Lobby', 'aceptada a mano');
  await ask('leaveLobby', {}); await waitFor(() => state.phase === 'None', 'fuera 3');
  ok('invitaciones: se ven, se aceptan a mano o solas si lo activás');

  // ---- Cambiar el modo de la sala con amigos: nunca se sale de la sala
  await ask('leaveLobby', {}); mock.st.party = 2; mock.st.putFails = false;
  await ask('search', { queueId: 450 }); // crea la sala y busca
  mock.setPhase('Lobby'); await waitFor(() => state.phase === 'Lobby' && state.lobbyQueueId === 450, 'sala aram');
  const del0 = mock.calls.filter((c) => c.method === 'DELETE' && c.url === '/lol-lobby/v2/lobby').length;
  const sw = await ask('setLobbyQueue', { queueId: 2400 });
  assert(sw.ok); await waitFor(() => state.lobbyQueueId === 2400, 'modo cambiado');
  assert.strictEqual(mock.calls.filter((c) => c.method === 'DELETE' && c.url === '/lol-lobby/v2/lobby').length, del0, 'no debe cerrar la sala');
  ok('sala con amigos: el modo cambia en la misma sala, sin salirse');
  mock.st.putFails = true;
  const sw2 = await ask('setLobbyQueue', { queueId: 450 });
  assert.strictEqual(sw2.ok, false); assert.strictEqual(sw2.error, 'changeFail');
  assert.strictEqual(state.lobbyQueueId, 2400); assert.strictEqual(state.phase, 'Lobby');
  assert.strictEqual(mock.calls.filter((c) => c.method === 'DELETE' && c.url === '/lol-lobby/v2/lobby').length, del0);
  mock.st.leader = false; mock.st.putFails = false;
  await ask('setLobbyQueue', { queueId: 450 }); // no líder
  const sw3 = await ask('setLobbyQueue', { queueId: 450 });
  assert.strictEqual(sw3.error, 'notHost');
  mock.st.leader = true; mock.st.party = 1;
  ok('si el cambio falla con gente en la sala, no te saca; si no sos líder avisa');

  ws.close(); await srv.close(); mock.close();
  console.log(`\nTODO OK (${n} comprobaciones)`);
  process.exit(0);
})().catch((e) => { console.error('\nFALLÓ:', e.message); process.exit(1); });
