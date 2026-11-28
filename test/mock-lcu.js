'use strict';
// Cliente de LoL simulado: imita lo justo del LCU para probar Open Queue sin el juego.
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { WebSocketServer } = require('ws');

async function startMock() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-mock-'));
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 2 -subj "/CN=127.0.0.1" 2>/dev/null`);
  const password = 'secret123';
  const calls = [];
  const st = {
    loadout: { id: 'lo1', name: 'x', scope: 'account', loadout: { EMOTES_WHEEL_CENTER: { contentId: '', data: {}, inventoryType: 'EMOTE', itemId: 4848 }, EMOTES_WHEEL_LEFT: { contentId: '', data: {}, inventoryType: 'EMOTE', itemId: 3120 }, WARD_SKIN_SLOT: { contentId: '', data: {}, inventoryType: 'WARD_SKIN', itemId: 1 } } },
    phase: 'None', queueId: null,
    session: null, chat: [], pickable: [1, 2, 3, 22, 266], bannable: [1, 2, 3, 22, 266],
    pages: [{ id: 10, name: 'Page A', isEditable: true, isValid: true }, { id: 11, name: 'Page B', isEditable: true, isValid: true }],
    currentPage: 10,
    slots: [
      { championId: 80, perks: JSON.stringify({ perkIds: [8360, 8321, 8345, 8347, 8106, 8141, 5008, 5008, 5001], perkStyle: 8300, perkSubStyle: 8100 }), positionPreference: 'BOTTOM', skinId: 80000, spell1: 4, spell2: 14 },
      { championId: 22, perks: JSON.stringify({ perkIds: [8005, 8009, 9103, 8014, 8410, 8345, 5005, 5008, 5001], perkStyle: 8000, perkSubStyle: 8300 }), positionPreference: 'MIDDLE', skinId: 22000, spell1: 1, spell2: 7 },
    ],
    gameMode: 'CLASSIC',
  };
  const lobbyObj = () => ({
    gameConfig: { queueId: st.queueId, gameMode: st.queueId === 480 ? 'SWIFTPLAY' : st.queueId === 450 ? 'ARAM' : st.queueId === 2400 ? 'KIWI' : 'CLASSIC', showQuickPlaySlotSelection: st.queueId === 480, showPositionSelector: [400, 420, 440].includes(st.queueId) },
    members: Array.from({ length: st.party || 1 }, (_, i) => ({ summonerId: i })),
    multiUserChatId: 'muc-1', multiUserChatPassword: 'pw-secreta', mucJwtDto: { channelClaim: 'muc-1', domain: 'lol-pre-game', jwt: 'jwt-secreto' },
    localMember: { isLeader: st.leader !== false, playerSlots: st.queueId === 480 ? st.slots : [], firstPositionPreference: st.firstPos || '', secondPositionPreference: st.secondPos || '' },
  });
  const subs = new Set();
  const emit = (uri, data, eventType = 'Update') => {
    const msg = JSON.stringify([8, 'OnJsonApiEvent', { uri, eventType, data }]);
    subs.forEach((ws) => { if (ws.readyState === 1) ws.send(msg); });
  };
  const setPhase = (p) => { st.phase = p; emit('/lol-gameflow/v1/gameflow-phase', p); };

  const handler = (req, res) => {
    const auth = 'Basic ' + Buffer.from('riot:' + password).toString('base64');
    if (req.headers.authorization !== auth) { res.writeHead(401); return res.end(); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let b; try { b = body ? JSON.parse(body) : undefined; } catch (_) { b = undefined; }
      const key = req.method + ' ' + req.url;
      calls.push({ method: req.method, url: req.url, body: b, t: Date.now() });
      const ok = (data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data)); };
      let m;
      if (key === 'GET /lol-gameflow/v1/gameflow-phase') return ok(st.phase);
      if (key === 'GET /lol-game-queues/v1/queues') return ok([
        { id: 420, name: 'Ranked Solo', shortName: 'Ranked Solo/Duo', queueAvailability: 'Available', isCustom: false, category: 'PvP' },
        { id: 450, name: 'ARAM', queueAvailability: 'Available', isCustom: false, category: 'PvP' },
        { id: 2400, name: 'ARAM: Mayhem', queueAvailability: 'Available', isCustom: false, category: 'PvP' },
        { id: 480, name: 'Swiftplay', queueAvailability: 'Available', isCustom: false, category: 'PvP' },
        { id: 999, name: 'Custom', queueAvailability: 'Available', isCustom: true, category: 'PvP' },
        { id: 700, name: 'Clash', queueAvailability: 'Available', category: 'PvP' },
        { id: 900, name: 'URF', queueAvailability: 'Available', category: 'PvP' },
        { id: 2000, name: 'Tutorial 1', queueAvailability: 'Available', category: 'PvP' },
        { id: 830, name: 'Co-op vs AI', queueAvailability: 'Available', category: 'PvP' },
        { id: 400, name: 'Draft', queueAvailability: 'Available', category: 'PvP' },
        { id: 1100, name: 'TFT Ranked', queueAvailability: 'Available', category: 'PvP' },
      ]);
      if (key === 'GET /lol-summoner/v1/current-summoner') return ok({ summonerId: 777, gameName: 'Yo', puuid: 'my-puu' });
      if (key === 'GET /lol-summoner/v2/summoners/puuid/other-puu') return ok({ gameName: 'Por Puuid' });
      if ((m = /^GET \/lol-summoner\/v1\/summoners\/(\d+)$/.exec(key))) return ok({ gameName: 'Player' + m[1] });
      if (key === 'GET /lol-perks/v1/pages') return ok(st.pages);
      if (key === 'GET /lol-perks/v1/currentpage') return ok({ id: st.currentPage });
      if (key === 'GET /lol-perks/v1/inventory') { const n = st.pages.filter((x) => !x.isTemporary).length; return ok({ canAddCustomPage: n < 3, customPageCount: n, ownedPageCount: 3 }); }
      if ((m = /^POST \/lol-perks\/v1\/recommended-pages-position\/champion\/(\d+)\/position\/(\w+)$/.exec(key))) {
        if (Number(m[1]) !== 103) return ok({ message: 'no recommendations' }, 404);
        if (st.noTempRec) return ok({ message: 'failed' }, 500);
        [0, 1, 2].forEach((i) => st.pages.push({ id: 900 + i, name: 'Ahri - Rec ' + (i + 1), isEditable: true, isValid: true, isTemporary: true, recommendationChampionId: 103, recommendationIndex: i, primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [8005 + i, 9111, 9104, 8014, 8126, 8136, 5008, 5008, 5011] }));
        return ok(undefined, 204);
      }
      if (key === 'POST /lol-perks/v1/pages') {
        if (st.pages.filter((x) => !x.isTemporary).length >= 3) return ok({ errorCode: 'RPC_ERROR', httpStatus: 400, message: 'Max pages reached' }, 400);
        const pg = Object.assign({ id: 50 + st.pages.length, isEditable: true, isValid: true }, b); st.pages.push(pg); return ok(pg);
      }
      if ((m = /^PUT \/lol-perks\/v1\/pages\/(\d+)$/.exec(key))) { const pg = st.pages.find((x) => x.id === Number(m[1])); Object.assign(pg, b); return ok(pg); }
      if (key === 'GET /lol-perks/v1/styles') return ok([
        { id: 8000, name: 'Precision', iconPath: '/lol-game-data/assets/v1/perk-images/Styles/7201_Precision.png', slots: [
          { type: 'kKeyStone', perks: [8005, 8008] }, { type: 'kMixedRegularSplashable', perks: [9111, 9101] }, { type: 'kMixedRegularSplashable', perks: [9104, 9105] }, { type: 'kMixedRegularSplashable', perks: [8014, 8017] },
          { type: 'kStatMod', perks: [5008, 5005, 5007] }, { type: 'kStatMod', perks: [5008, 5010, 5001] }, { type: 'kStatMod', perks: [5011, 5013, 5001] }] },
        { id: 8100, name: 'Domination', iconPath: '/lol-game-data/assets/v1/perk-images/Styles/7200_Domination.png', slots: [
          { type: 'kKeyStone', perks: [8112, 8128] }, { type: 'kMixedRegularSplashable', perks: [8126, 8139] }, { type: 'kMixedRegularSplashable', perks: [8136, 8120] }, { type: 'kMixedRegularSplashable', perks: [8135, 8105] }] },
      ]);
      if (key === 'GET /lol-perks/v1/perks') return ok([8005, 8008, 9111, 9101, 9104, 9105, 8014, 8017, 8112, 8128, 8126, 8139, 8136, 8120, 8135, 8105, 5008, 5005, 5007, 5010, 5001, 5011, 5013].map((id) => ({ id, name: 'Perk' + id, iconPath: '/lol-game-data/assets/v1/perk-images/p' + id + '.png' })));
      if ((m = /^GET \/lol-perks\/v1\/recommended-pages\/champion\/(\d+)\/position\/(\w+)\/map\/(\d+)$/.exec(key))) {
        const mk = (i) => ({ name: 'Rec ' + 'ABC'[i] + ' ' + m[1] + '/' + m[2] + '/' + m[3], primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [8005 + i, 9111, 9104, 8014, 8126, 8136, 5008, 5008, 5011] });
        return ok(Number(m[1]) === 103 ? [mk(0), mk(1), mk(2)] : [mk(0)]);
      }
      if (key === 'GET /lol-champ-select/v1/skin-carousel-skins') return ok([
        { id: 22000, name: 'Base', unlocked: true, disabled: false, tilePath: '/lol-game-data/assets/ASSETS/Characters/Ashe/Skins/Base/AsheLoadScreen.jpg', ownership: { owned: true } },
        { id: 22001, name: 'Freljord Ashe', unlocked: true, disabled: false, tilePath: '/lol-game-data/assets/x.jpg', ownership: { owned: true } },
        { id: 22002, name: 'No owned', unlocked: false, disabled: false, tilePath: '/lol-game-data/assets/y.jpg' },
      ]);
      if ((m = /^POST \/lol-champ-select\/v1\/session\/(pick-order-swaps|position-swaps|trades)\/(\d+)\/(accept|decline)$/.exec(key))) {
        const list = st.session[{ 'pick-order-swaps': 'pickOrderSwaps', 'position-swaps': 'positionSwaps', 'trades': 'trades' }[m[1]]];
        const sw = list.find((x) => x.id === Number(m[2])); sw.state = m[3] === 'accept' ? 'ACCEPTED' : 'DECLINED';
        emit('/lol-champ-select/v1/session', st.session); return ok(undefined, 204);
      }
      if ((m = /^POST \/lol-champ-select\/v1\/session\/bench\/swap\/(\d+)$/.exec(key))) {
        const i = st.session.benchChampions.findIndex((x) => x.championId === Number(m[1]));
        const mine = st.session.myTeam[0].championId; st.session.myTeam[0].championId = Number(m[1]); st.session.benchChampions[i].championId = mine;
        emit('/lol-champ-select/v1/session', st.session); return ok(undefined, 204);
      }
      if (key === 'POST /lol-champ-select/v1/session/my-selection/reroll') { st.session.rerollsRemaining -= 1; emit('/lol-champ-select/v1/session', st.session); return ok(undefined, 204); }
      if (key === 'PUT /lol-perks/v1/currentpage') { st.currentPage = b; return ok(undefined, 204); }
      if (key === 'GET /lol-lobby/v2/lobby') return st.queueId ? ok(lobbyObj()) : ok({}, 404);
      if (key === 'PUT /lol-lobby/v1/lobby/members/localMember/position-preferences') { st.firstPos = b.firstPreference; st.secondPos = b.secondPreference; emit('/lol-lobby/v2/lobby', lobbyObj()); return ok(undefined, 204); }
      if (key === 'POST /process-control/v1/process/quit') return ok(undefined, 204);
      if ((m = /^POST \/lol-champ-select\/v1\/session\/(pick-order-swaps|position-swaps|trades)\/(\d+)\/(request|cancel)$/.exec(key))) return ok(undefined, 204);
      if (key === 'PUT /lol-lobby/v1/lobby/members/localMember/player-slots') { st.slots = b; emit('/lol-lobby/v2/lobby', lobbyObj()); return ok(undefined, 204); }
      if ((m = /^GET \/lol-perks\/v1\/quick-play-selections\/champion\/(\d+)\/position\/(\w+)$/.exec(key))) return Number(m[2] === m[2].toUpperCase() ? 1 : 0) ? ok(JSON.stringify({ perkIds: [8005, 9111, 9104, 8014, 8126, 8136, 5008, 5008, 5011], perkStyle: 8000, perkSubStyle: 8100 })) : ok({}, 404);
      if (key === 'GET /lol-champions/v1/owned-champions-minimal') return ok([{ id: 22, ownership: { owned: true } }, { id: 80, ownership: { owned: true } }, { id: 103, ownership: { owned: true } }, { id: 1, ownership: { owned: false }, freeToPlay: false }]);
      if ((m = /^GET \/lol-champions\/v1\/inventories\/777\/champions\/(\d+)\/skins$/.exec(key))) return ok([{ id: Number(m[1]) * 1000, isBase: true, name: 'Base', ownership: { owned: true }, tilePath: '/lol-game-data/assets/b.jpg' }, { id: Number(m[1]) * 1000 + 1, name: 'Skin Uno', ownership: { owned: true }, tilePath: '/lol-game-data/assets/s1.jpg' }, { id: Number(m[1]) * 1000 + 2, name: 'No tengo', ownership: { owned: false } }]);
      if (key === 'GET /lol-game-data/assets/v1/summoner-spells.json') return ok([{ id: 1, gameModes: ['CLASSIC', 'ARAM'] }, { id: 3, gameModes: ['CLASSIC', 'ARAM'] }, { id: 4, gameModes: ['CLASSIC', 'ARAM'] }, { id: 6, gameModes: ['CLASSIC', 'ARAM'] }, { id: 7, gameModes: ['CLASSIC', 'ARAM'] }, { id: 11, gameModes: ['CLASSIC'] }, { id: 12, gameModes: ['CLASSIC'] }, { id: 13, gameModes: ['ARAM'] }, { id: 14, gameModes: ['CLASSIC', 'ARAM'] }, { id: 21, gameModes: ['CLASSIC', 'ARAM'] }, { id: 32, gameModes: ['ARAM'] }]);
      if (key === 'DELETE /lol-lobby/v2/lobby') { st.queueId = null; setPhase('None'); return ok(undefined, 204); }
      if (key === 'PUT /lol-lobby/v2/lobby/queue') { if (st.putFails) return ok({}, 404); st.queueId = Number(b); emit('/lol-lobby/v2/lobby', lobbyObj()); return ok(undefined, 204); }
      if (key === 'POST /lol-lobby/v2/lobby') { if (st.party > 1 && st.phase === 'Lobby') return ok({}, 409); st.queueId = b.queueId; setPhase('Lobby'); return ok(lobbyObj()); }
      if (key === 'POST /lol-lobby/v2/lobby/matchmaking/search') { setPhase('Matchmaking'); return ok(undefined, 204); }
      if (key === 'DELETE /lol-lobby/v2/lobby/matchmaking/search') { setPhase('Lobby'); return ok(undefined, 204); }
      if (key === 'GET /lol-lobby/v2/lobby/matchmaking/search-state') return ok({ searchState: 'Searching', timeInQueue: 3, estimatedQueueTime: 60 });
      if (key === 'POST /lol-matchmaking/v1/ready-check/accept') { emit('/lol-matchmaking/v1/ready-check', { state: 'InProgress', playerResponse: 'Accepted' }); return ok(undefined, 204); }
      if (key === 'POST /lol-matchmaking/v1/ready-check/decline') return ok(undefined, 204);
      if (key === 'GET /lol-champ-select/v1/session') return st.session ? ok(st.session) : ok({}, 404);
      if ((m = /^PATCH \/lol-champ-select\/v1\/session\/actions\/(\d+)$/.exec(key))) {
        const id = Number(m[1]);
        const a = st.session.actions.flat().find((x) => x.id === id);
        if (b.championId) a.championId = b.championId;
        if (b.completed) { a.completed = true; a.isInProgress = false; }
        emit('/lol-champ-select/v1/session', st.session);
        return ok(undefined, 204);
      }
      if (key === 'GET /lol-gameflow/v1/session') return ok({ phase: st.phase, gameData: { queue: { gameMode: st.queueId === 450 ? 'ARAM' : st.queueId === 2400 ? 'KIWI' : 'CLASSIC' } } });
      if (key === 'PATCH /lol-champ-select/v1/session/my-selection') {
        Object.assign(st.session.myTeam[0], b);
        emit('/lol-champ-select/v1/session', st.session);
        return ok(undefined, 204);
      }
      if (key === 'GET /lol-champ-select/v1/pickable-champion-ids') return ok(st.pickable);
      if (key === 'GET /lol-champ-select/v1/bannable-champion-ids') return ok(st.bannable);
      if (key === 'GET /lol-chat/v1/friends') return ok([
        { summonerId: 11, gameName: 'Amigo Uno', gameTag: 'AR1', availability: 'chat', product: 'league_of_legends', lol: { gameStatus: 'outOfGame' } },
        { summonerId: 12, gameName: 'Amigo Dos', gameTag: 'AR2', availability: 'dnd', product: 'league_of_legends', icon: 5, lol: { gameStatus: 'inGame', gameQueueType: 'KIWI', timeStamp: Date.now() - 184000 } },
        { summonerId: 15, gameName: 'Con Celu', gameTag: 'M', availability: 'mobile', product: 'league_of_legends', icon: 29 },
        { summonerId: 13, gameName: 'Desconectado', gameTag: 'X', availability: 'offline', product: 'league_of_legends' },
        { summonerId: 14, gameName: 'En Valorant', gameTag: 'X', availability: 'chat', product: 'valorant' },
      ]);
      if (key === 'POST /lol-lobby/v2/lobby/invitations') return st.inviteFails ? ok({}, 500) : ok([{ invitationId: 'i1' }]);
      if (key === 'GET /lol-loadouts/v4/loadouts/scope/account') return ok([st.loadout]);
      if ((m = /^(PUT|PATCH) \/lol-loadouts\/v4\/loadouts\/(.+)$/.exec(key))) {
        if (m[1] === 'PUT' && st.putLoadoutFails) return ok({}, 405);
        if (m[1] === 'PUT') st.loadout = b; else Object.assign(st.loadout.loadout, b.loadout);
        return ok(st.loadout);
      }
      if (key === 'GET /lol-inventory/v2/inventory/EMOTE') return ok([{ itemId: 3120 }, { itemId: 4848 }, { itemId: 5220 }]);
      if (key === 'GET /lol-inventory/v2/inventory/WARD_SKIN') return ok([{ itemId: 1 }, { itemId: 7 }]);
      if (key === 'GET /lol-game-data/assets/v1/summoner-emotes.json') return ok([{ id: 3120, name: 'Emote A', inventoryIcon: '/lol-game-data/assets/ASSETS/e/a.png' }, { id: 4848, name: 'Emote B' }, { id: 5220, name: 'Emote C' }]);
      if (key === 'GET /lol-game-data/assets/v1/ward-skins.json') return ok([{ id: 1, name: 'Ward Uno', wardImagePath: '/lol-game-data/assets/ASSETS/w/1.png' }, { id: 7, name: 'Ward Siete' }]);
      if (key === 'GET /lol-lobby/v2/received-invitations') return ok(st.invites || []);
      if ((m = /^POST \/lol-lobby\/v2\/received-invitations\/(.+)\/accept$/.exec(key))) { st.invites = (st.invites || []).filter((x) => x.invitationId !== m[1]); st.queueId = 450; setPhase('Lobby'); return ok(undefined, 204); }
      if ((m = /^POST \/lol-lobby\/v2\/received-invitations\/(.+)\/decline$/.exec(key))) { st.invites = (st.invites || []).filter((x) => x.invitationId !== m[1]); return ok(undefined, 204); }
      if ((m = /^GET \/lol-match-history\/v1\/products\/lol\/current-summoner\/matches\?begIndex=(\d+)&endIndex=(\d+)$/.exec(key))) {
        return ok({ games: { games: (st.history || []).slice(Number(m[1]), Number(m[2])) } });
      }
      if (key === 'GET /lol-champion-mastery/v1/local-player/champion-mastery') return ok(st.mastery || []);
      if ((m = /^GET \/lol-champ-select\/v1\/summoners\/(\d+)$/.exec(key))) return ok((st.cellSummoners || {})[m[1]] || {});
      if (key === 'GET /lol-chat/v1/me') return ok({ id: 'me1', pid: 'pme', gameName: 'Yo' });
      if (/^GET \/lol-chat\/v1\/conversations\/x(@|%40)champ-select\/participants$/.test(key) && st.csParticipants) return ok(st.csParticipants);
      if (/^GET \/lol-chat\/v1\/conversations\/.+\/participants$/.test(key)) return ok([{ pid: 'p5', name: 'Amigo Lobby' }, { pid: 'pme', name: 'Yo' }]);
      if (key === 'GET /lol-chat/v1/conversations') return ok([{ id: 'x@champ-select', type: 'championSelect' }, { id: 'y', type: 'chat' }, { id: 'amigo@la2.pvp.net', type: 'chat' }, { id: 'lob@party', type: 'groupchat' }].filter((c) => c.type !== 'groupchat' || st.lobbyChat !== false));
      if (/^GET \/lol-chat\/v1\/conversations\/.+\/messages$/.test(key)) return ok(st.chat);
      if (key === 'GET /lol-chat/v1/conversations/muc-1%40lol-pre-game.la2.pvp.net' && st.lobbyChat === false) return ok({ id: 'muc-1@lol-pre-game.la2.pvp.net', type: '' });
      if (/^POST \/lol-chat\/v1\/conversations\/.+\/messages$/.test(key)) {
        st.chat.push({ id: 'm' + (st.chat.length + 1), type: 'chat', body: b.body, fromSummonerId: 777 });
        return ok(undefined, 200);
      }
      ok({ message: 'not found' }, 404);
    });
  };

  const server = https.createServer({ key: fs.readFileSync(dir + '/k.pem'), cert: fs.readFileSync(dir + '/c.pem') }, handler);
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const auth = 'Basic ' + Buffer.from('riot:' + password).toString('base64');
    if (req.headers.authorization !== auth) return ws.close();
    ws.on('message', (raw) => {
      try { const m = JSON.parse(raw.toString()); if (m[0] === 5) subs.add(ws); } catch (_) {}
    });
    ws.on('close', () => subs.delete(ws));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const lockfile = path.join(dir, 'lockfile');
  fs.writeFileSync(lockfile, `LeagueClient:1234:${port}:${password}:https`);

  const mkSession = () => ({
    localPlayerCellId: 0,
    timer: { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 25000, totalTimeInPhase: 30000, isInfinite: false },
    myTeam: [0, 1, 2, 3, 4].map((c) => ({ cellId: c, championId: 0, championPickIntent: 0, assignedPosition: ['top', 'jungle', 'middle', 'bottom', 'utility'][c], spell1Id: 4, spell2Id: 14, summonerId: 700 + c })),
    theirTeam: [5, 6, 7, 8, 9].map((c) => ({ cellId: c, championId: 0, championPickIntent: 0, assignedPosition: '', summonerId: 0 })),
    bans: { myTeamBans: [], theirTeamBans: [] },
    pickOrderSwaps: [], positionSwaps: [], trades: [],
    actions: [
      [{ id: 0, actorCellId: 0, type: 'ban', championId: 0, completed: false, isInProgress: true }],
      [{ id: 1, actorCellId: 5, type: 'pick', championId: 0, completed: false, isInProgress: false }],
      [{ id: 2, actorCellId: 0, type: 'pick', championId: 0, completed: false, isInProgress: false }],
    ],
  });

  const mkAram = () => ({
    localPlayerCellId: 0, benchEnabled: true, allowRerolling: true, rerollsRemaining: 2,
    timer: { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 20000, totalTimeInPhase: 30000, isInfinite: false },
    myTeam: [0, 1, 2, 3, 4].map((c) => ({ cellId: c, championId: 22 + c, championPickIntent: 0, assignedPosition: '', spell1Id: 4, spell2Id: 6, summonerId: 700 + c })),
    theirTeam: [], bans: { myTeamBans: [], theirTeamBans: [] }, actions: [],
    benchChampions: [{ championId: 103 }, { championId: 157 }],
    pickOrderSwaps: [], positionSwaps: [], trades: [],
  });

  return {
    startAram() { st.session = mkAram(); setPhase('ChampSelect'); emit('/lol-champ-select/v1/session', st.session); },
    port, lockfile, calls, st,
    setPhase, emit,
    startChampSelect() { st.session = mkSession(); setPhase('ChampSelect'); emit('/lol-champ-select/v1/session', st.session); },
    updateSession(fn) { fn(st.session); emit('/lol-champ-select/v1/session', st.session); },
    addRawChat(msg) { st.chat.push(Object.assign({ id: 'm' + (st.chat.length + 1), type: 'groupchat' }, msg)); emit('/lol-chat/v1/conversations/lob@party/messages', {}); },
    addChat(body, from) { st.chat.push({ id: 'm' + (st.chat.length + 1), type: 'chat', body, fromSummonerId: from }); emit('/lol-chat/v1/conversations/x@champ-select/messages', {}); },
    close() { wss.clients.forEach((c) => c.terminate()); server.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

module.exports = { startMock };
