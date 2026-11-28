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
  process.env.OQ_NO_DDRAGON = '1';
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

  // 5b) Pick preparado: se respeta antes que los favoritos (aunque el cliente no muestre la marca).
  await ask('setFavorites', { autoPick: true, when: 'end' });
  await ask('setPrePick', { championId: 3 });
  mock.st.pickable = [];
  mock.startChampSelect();
  mock.updateSession((s) => {
    s.actions = [[{ id: 5, actorCellId: 0, type: 'pick', championId: 0, completed: false, isInProgress: true }]];
    s.timer = { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 1500, totalTimeInPhase: 30000, isInfinite: false };
  });
  await waitFor(() => mock.calls.find((c) => c.method === 'PATCH' && /actions\/5$/.test(c.url) && c.body.completed), 'pick con preparado');
  assert.strictEqual(mock.calls.find((c) => c.method === 'PATCH' && /actions\/5$/.test(c.url) && c.body.completed).body.championId, 3);
  ok('pick automático: tu pick preparado va antes que los favoritos (aunque la lista del cliente venga vacía)');
  mock.setPhase('None'); await sleep(300);
  await ask('setPrePick', { championId: null });
  mock.st.pickable = [1, 2, 3, 22, 266];

  // 5c) "Apenas me toca": se confirma al empezar el turno, sin esperar al 0; también sin reloj.
  await ask('setFavorites', { when: 'start' });
  await waitFor(() => state.settings.favorites.when === 'start', 'modo start');
  mock.startChampSelect();
  const t1 = Date.now();
  mock.updateSession((s) => {
    s.actions = [[{ id: 6, actorCellId: 0, type: 'pick', championId: 0, completed: false, isInProgress: true }]];
    s.timer = { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 0, totalTimeInPhase: 0, isInfinite: true };
  });
  await waitFor(() => mock.calls.find((c) => c.method === 'PATCH' && /actions\/6$/.test(c.url) && c.body.completed), 'pick al empezar', 5000);
  const st6 = mock.calls.find((c) => c.method === 'PATCH' && /actions\/6$/.test(c.url) && c.body.completed);
  assert(st6.t - t1 < 3000, 'apenas empieza el turno');
  ok('pick automático "apenas me toca": se confirma al empezar tu turno (también sin reloj)');
  mock.setPhase('None'); await sleep(300);
  await ask('setFavorites', { when: 'end' });

  // 5d) Runas automáticas: tras el pick automático se aplica la primera recomendada por el cliente.
  await ask('setFavorites', { autoPick: true, when: 'end', autoRunes: true });
  await waitFor(() => state.settings.favorites.autoRunes, 'runas auto');
  mock.st.pickable = [1, 2, 3, 22, 266, 103];
  mock.startChampSelect();
  const nPerk = mock.calls.length;
  mock.updateSession((s) => {
    s.actions = [[{ id: 7, actorCellId: 0, type: 'pick', championId: 103, completed: false, isInProgress: true }]];
    s.timer = { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 1200, totalTimeInPhase: 30000, isInfinite: false };
  });
  await waitFor(() => mock.calls.find((c) => c.method === 'PATCH' && /actions\/7$/.test(c.url) && c.body.completed && c.body.championId === 103), 'pick 103');
  await waitFor(() => alerts.find((a) => a.kind === 'autoRunes'), 'aviso runas', 8000);
  assert(mock.calls.slice(nPerk).find((c) => c.method === 'GET' && /recommended-pages\/champion\/103\/position\/top/.test(c.url)), 'pide las recomendadas para la línea');
  assert(mock.calls.slice(nPerk).find((c) => (c.method === 'PUT' || c.method === 'POST') && /^\/lol-perks\/v1\/pages/.test(c.url)), 'aplica la página');
  ok('runas automáticas: tras el pick automático se pone la recomendada del cliente para ese campeón y línea');
  mock.setPhase('None'); await sleep(300);
  await ask('setFavorites', { autoRunes: false });

  // 5e) Runas automáticas con tus 3 páginas llenas y sin página temporal (lo que pasó en la prueba real).
  const fullPages = () => [10, 11, 12].map((pid) => ({ id: pid, name: 'Mia ' + pid, isEditable: true, isValid: true, isTemporary: false, primaryStyleId: 8100, subStyleId: 8200, selectedPerkIds: [8112, 8126, 8139, 8135, 8005, 9111, 5008, 5008, 5001] }));
  mock.st.pages = fullPages();
  const runPick = async (actionId) => {
    alerts.length = 0;
    mock.startChampSelect();
    mock.updateSession((s) => {
      s.actions = [[{ id: actionId, actorCellId: 0, type: 'pick', championId: 103, completed: false, isInProgress: true }]];
      s.timer = { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 1000, totalTimeInPhase: 30000, isInfinite: false };
    });
    await waitFor(() => alerts.find((a) => /^autoRunes/.test(a.kind)), 'aviso runas ' + actionId, 10000);
    mock.setPhase('None'); await sleep(300);
    return alerts.find((a) => /^autoRunes/.test(a.kind)).kind;
  };
  await ask('setFavorites', { autoRunes: true, runePageId: 0 });
  assert.strictEqual(await runPick(8), 'autoRunes');
  const tmp = mock.st.pages.find((x) => x.isTemporary && x.id === mock.st.currentPage);
  assert(tmp, 'queda activa la página temporal del cliente');
  assert.deepStrictEqual(mock.st.pages.filter((x) => !x.isTemporary).map((x) => x.name), ['Mia 10', 'Mia 11', 'Mia 12'], 'no toca tus páginas');
  ok('runas automáticas con páginas llenas: el cliente crea su página temporal y se usa esa, sin tocar las tuyas');

  mock.st.pages = fullPages(); mock.st.noTempRec = true;
  assert.strictEqual(await runPick(9), 'autoRunesNoSlot');
  assert.deepStrictEqual(mock.st.pages.map((x) => x.selectedPerkIds[0]), [8112, 8112, 8112], 'sin permiso no pisa nada');
  await ask('setFavorites', { runePageId: 11 });
  assert.strictEqual(await runPick(10), 'autoRunes');
  assert.strictEqual(mock.st.currentPage, 11); assert.notStrictEqual(mock.st.pages.find((x) => x.id === 11).selectedPerkIds[0], 8112);
  assert.strictEqual(mock.st.pages.find((x) => x.id === 11).name, 'Mia 11');
  ok('runas automáticas sin lugar: avisa; si elegiste una página para la app, se guardan ahí');
  mock.st.noTempRec = false;
  await ask('setFavorites', { autoRunes: false, runePageId: 0 });

  // 5f) Reglas: contra Fiora, Malphite (saltear si tienen a Kindred) o Garen. Van antes que el pick preparado y los favoritos.
  await ask('setFavorites', { autoPick: true, when: 'end', useHistory: false, rules: [
    { vs: [114, 'x', 114], lane: 'nope', picks: [{ c: 54, avoid: [203] }, { c: 86 }, { c: 54 }] },
    { vs: [], lane: 'jungle', picks: [{ c: 2 }] },
  ] });
  await waitFor(() => (state.settings.favorites.rules || []).length === 2, 'reglas guardadas');
  assert.deepStrictEqual(state.settings.favorites.rules[0], { vs: [114], lane: '', picks: [{ c: 54, avoid: [203] }, { c: 86, avoid: [] }], off: false, conds: [], kind: 'pick' });
  assert.strictEqual(state.settings.favorites.rules[1].lane, 'jungle');
  ok('reglas: se guardan limpias (sin repetidos ni datos inválidos)');

  mock.st.pickable = [1, 2, 3, 22, 266, 54, 86];
  await ask('setPrePick', { championId: 3 });
  const rulePick = async (actionId, enemies) => {
    mock.startChampSelect();
    mock.updateSession((s) => {
      enemies.forEach((c, i) => { s.theirTeam[i].championId = c; });
      s.actions = [[{ id: actionId, actorCellId: 0, type: 'pick', championId: 3, completed: false, isInProgress: true }]];
      s.timer = { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 1500, totalTimeInPhase: 30000, isInfinite: false };
    });
    await waitFor(() => state.champSelect && state.champSelect.autoPickNext, 'vista previa ' + actionId);
    const preview = state.champSelect.autoPickNext;
    const c = await waitFor(() => mock.calls.find((x) => x.method === 'PATCH' && new RegExp('actions/' + actionId + '$').test(x.url) && x.body.completed), 'pick ' + actionId);
    mock.setPhase('None'); await sleep(300);
    return { champ: c.body.championId, preview };
  };
  let rr = await rulePick(20, [114]);
  assert.strictEqual(rr.champ, 54, 'Fiora: Malphite'); assert.deepStrictEqual(rr.preview, { championId: 54, rule: 0 });
  ok('reglas: contra Fiora elige la primera opción de la regla (antes que tu pick preparado marcado por la app)');
  rr = await rulePick(21, [114, 203]);
  assert.strictEqual(rr.champ, 86, 'con Kindred saltea Malphite');
  ok('reglas: si tienen al que te molesta, saltea esa opción y elige la siguiente');
  rr = await rulePick(22, [99]);
  assert.strictEqual(rr.champ, 3, 'sin Fiora y sin ser jungla: tu pick preparado');
  ok('reglas: si ninguna aplica (rival o línea), sigue con tu pick preparado y favoritos');
  await ask('setPrePick', { championId: null });
  await ask('setFavorites', { rules: [] });

  // 5g) Condiciones de composición, aliados, orden de pick y reglas de bloqueo.
  srv.engine._cinfo = new Map([
    [1, { tags: ['mage'], melee: false, dmg: 'ap' }], [103, { tags: ['mage', 'assassin'], melee: false, dmg: 'ap' }], [13, { tags: ['mage'], melee: false, dmg: 'ap' }],
    [266, { tags: ['fighter', 'tank'], melee: true, dmg: 'ad' }], [54, { tags: ['tank', 'fighter'], melee: true, dmg: 'ap' }],
    [51, { tags: ['marksman'], melee: false, dmg: 'ad' }], [412, { tags: ['support', 'fighter'], melee: true, dmg: 'ad' }], [2, { tags: ['fighter'], melee: true, dmg: 'ad' }],
  ]);
  mock.st.pickable = [1, 2, 3, 22, 266, 54, 86, 51, 103, 13];
  const compPick = async (actionId, rules, favs, allies, extraActions, afterActions) => {
    await ask('setFavorites', { rules, ids: favs, useHistory: false });
    mock.startChampSelect();
    mock.updateSession((s) => {
      allies.forEach((c, i) => { s.myTeam[i + 1].championId = c; });
      s.actions = [(extraActions || []).concat([{ id: actionId, actorCellId: 0, type: 'pick', championId: 0, completed: false, isInProgress: true }], afterActions || [])];
      s.timer = { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 1200, totalTimeInPhase: 30000, isInfinite: false };
    });
    const c = await waitFor(() => mock.calls.find((x) => x.method === 'PATCH' && new RegExp('actions/' + actionId + '$').test(x.url) && x.body.completed), 'pick ' + actionId);
    mock.setPhase('None'); await sleep(300);
    return c.body.championId;
  };
  const block = [{ kind: 'block', conds: [{ t: 'count', team: 'ally', attr: 'mage', op: 'ge', n: 2 }], block: { attr: 'mage' }, picks: [] }];
  assert.strictEqual(await compPick(30, block, [1, 266], [103, 13]), 266, 'con 2 magos aliados no saca otro mago');
  assert.strictEqual(await compPick(31, block, [1, 266], [103]), 1, 'con 1 mago sí');
  ok('reglas de bloqueo: "si mi equipo tiene 2 magos, no elegir otro mago"');
  assert.strictEqual(await compPick(32, [{ conds: [{ t: 'ally', champs: [412] }], picks: [{ c: 51 }] }], [1], [412]), 51);
  assert.strictEqual(await compPick(33, [{ conds: [{ t: 'ally', champs: [412] }], picks: [{ c: 51 }] }], [1], [2]), 1);
  ok('reglas con aliados: sinergia "si mi equipo tiene a Thresh, elegir Caitlyn"');
  assert.strictEqual(await compPick(34, [{ conds: [{ t: 'count', team: 'ally', attr: 'tank', op: 'eq', n: 0 }], picks: [{ attr: 'tank' }] }], [1, 54], [103, 51]), 54);
  ok('reglas por composición: "si falta tanque, mi mejor tanque" (de mis favoritos)');
  const allyDone = [{ id: 90, actorCellId: 1, type: 'pick', championId: 2, completed: true }, { id: 91, actorCellId: 2, type: 'pick', championId: 51, completed: true }];
  const lastRule = [{ conds: [{ t: 'order', v: 'last' }], picks: [{ c: 266 }] }];
  assert.strictEqual(await compPick(35, lastRule, [1], [2, 51], allyDone), 266, 'último pick de tu equipo');
  assert.strictEqual(await compPick(36, lastRule, [1], [], [], [{ id: 92, actorCellId: 1, type: 'pick', championId: 0, completed: false }]), 1, 'primero: no aplica');
  ok('reglas por orden de pick: "si pickeo último"');
  await ask('setFavorites', { rules: [], ids: [22, 266, 1] });

  // 5h) Hechizos y runas por regla, Aplastar fijo en jungla y hechizos recomendados.
  const loadPick = async (actionId, pos) => {
    const n0 = mock.calls.length;
    mock.startChampSelect();
    mock.updateSession((s) => {
      s.myTeam[0].assignedPosition = pos; s.myTeam[0].spell1Id = 4; s.myTeam[0].spell2Id = 14;
      s.actions = [[{ id: actionId, actorCellId: 0, type: 'pick', championId: 0, completed: false, isInProgress: true }]];
      s.timer = { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 1200, totalTimeInPhase: 30000, isInfinite: false };
    });
    await waitFor(() => mock.calls.slice(n0).find((x) => x.method === 'PATCH' && x.url === '/lol-champ-select/v1/session/my-selection' && x.body.spell1Id), 'hechizos ' + actionId);
    await sleep(400);
    const calls = mock.calls.slice(n0);
    mock.setPhase('None'); await sleep(300);
    return { spells: calls.find((x) => x.method === 'PATCH' && x.url === '/lol-champ-select/v1/session/my-selection' && x.body.spell1Id).body, page: (calls.find((x) => x.method === 'PUT' && x.url === '/lol-perks/v1/currentpage') || {}).body };
  };
  mock.st.pages = [{ id: 10, name: 'Page A', isEditable: true, isValid: true }, { id: 11, name: 'Page B', isEditable: true, isValid: true }];
  await ask('setFavorites', { ids: [], autoSpells: false, autoRunes: false, rules: [{ picks: [{ c: 266 }], spells: [12, 4], runes: 11 }, { lane: 'jungle', picks: [{ c: 2 }], spells: [11, 14, 4] }] });
  await waitFor(() => (state.settings.favorites.rules || []).length === 2, 'reglas con hechizos');
  assert.deepStrictEqual(state.settings.favorites.rules[1].spells, [14], 'en jungla se guarda solo el otro hechizo');
  let lp = await loadPick(40, 'top');
  assert.deepStrictEqual(lp.spells, { spell1Id: 4, spell2Id: 12 }, 'Destello queda en su tecla');
  assert.strictEqual(lp.page, 11);
  ok('reglas: hechizos y página de runas por regla (Destello queda en la tecla donde lo tenías)');
  lp = await loadPick(41, 'jungle');
  assert(lp.spells.spell1Id === 11 || lp.spells.spell2Id === 11, 'Aplastar siempre en jungla');
  assert([lp.spells.spell1Id, lp.spells.spell2Id].includes(12), 'la regla 1 (cualquier línea) gana: Teleportar + Aplastar');
  ok('reglas en jungla: Aplastar no se saca nunca, solo se elige el otro hechizo');
  await ask('setFavorites', { rules: [], ids: [22], autoSpells: true });
  lp = await loadPick(42, 'top');
  assert.deepStrictEqual(lp.spells, { spell1Id: 4, spell2Id: 12 }, 'top sin datos: Destello + Teleportar');
  ok('hechizos recomendados: sin regla, se ponen los típicos de la línea (o los que más usaste)');
  await ask('setFavorites', { autoSpells: false, ids: [22, 266, 1] });

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
