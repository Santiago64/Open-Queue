'use strict';
// Cerebro de Open Queue: sigue el estado del cliente de LoL y ejecuta las acciones.
const EventEmitter = require('events');
const { LCU } = require('./lcu');
let APP_VERSION = '';
try { APP_VERSION = require('../package.json').version; } catch (_) {}

const MAX_AUTO_DELAY = 8; // segundos: tope conservador para que nunca se pase el ready check

// Solo se muestran los modos de esta lista (y solo si el cliente los marca como disponibles).
// Sin Clash, URF, tutoriales ni partidas contra bots. Para sumar un modo, agregalo acá.
const QUEUE_NAMES = {
  400: 'Normal Draft',
  430: 'Normal Blind',
  420: 'Ranked Solo/Duo',
  440: 'Ranked Flex',
  450: 'ARAM',
  2400: 'ARAM Mayhem',
  480: 'Swiftplay',
  1090: 'TFT Normal',
  1100: 'TFT Ranked',
  1130: 'TFT Hyper Roll',
  1160: 'TFT Double Up',
};
// Orden explícito (las claves numéricas de un objeto se reordenan solas de menor a mayor).
const QUEUE_ORDER = [400, 430, 420, 440, 450, 2400, 480, 1090, 1100, 1160, 1130];
const FALLBACK_QUEUES = QUEUE_ORDER.slice(0, 6).map((id) => ({ id, name: QUEUE_NAMES[id] }));

const EMOTE_SLOTS = ['EMOTES_WHEEL_UPPER_LEFT', 'EMOTES_WHEEL_UPPER', 'EMOTES_WHEEL_UPPER_RIGHT', 'EMOTES_WHEEL_LEFT', 'EMOTES_WHEEL_CENTER', 'EMOTES_WHEEL_RIGHT', 'EMOTES_WHEEL_LOWER_LEFT', 'EMOTES_WHEEL_LOWER', 'EMOTES_WHEEL_LOWER_RIGHT'];
const SWAP_PATHS = { pickOrder: 'pick-order-swaps', position: 'position-swaps', champion: 'trades' };
const NOISY_URIS = ['/lol-chat', '/riotclient', '/lol-patch', '/data-store', '/lol-settings', '/lol-store', '/lol-inventory',
  '/lol-champions', '/lol-loot', '/lol-clubs', '/lol-hovercard', '/lol-summoner', '/lol-regalia', '/lol-challenges',
  '/lol-missions', '/lol-active-boosts', '/lol-honor', '/lol-platform-config', '/lol-login', '/lol-rms', '/lol-chat',
  '/lol-collections', '/lol-catalog', '/lol-premade-voice', '/lol-npe', '/lol-esport', '/lol-leaver', '/lol-statstones',
  '/lol-career', '/lol-account', '/lol-lcds', '/lol-player', '/lol-event', '/lol-pft', '/lol-yourshop', '/lol-vanguard'];

const { VOICE_RE } = require('./discord');
const AUTO_PICK_MARGIN_MS = 700; // pick automático: cuánto antes del 0 se manda
const AUTO_BAN_MARGIN_MS = 700; // ban automático: igual, cuánto antes del 0
const AUTO_PICK_START_DELAY_MS = 1500; // modo "apenas te toca": espera para que se marque tu pick preparado

// Línea del champ select ('top', 'jungle', 'middle', 'bottom', 'utility').
function normPos(p) {
  const x = String(p || '').toLowerCase();
  if (x === 'mid') return 'middle';
  if (x === 'bot' || x === 'adc') return 'bottom';
  if (x === 'support' || x === 'sup') return 'utility';
  return ['top', 'jungle', 'middle', 'bottom', 'utility'].includes(x) ? x : '';
}
// Línea de una partida del historial (lane + role del cliente).
function histPos(tl) {
  const lane = String(tl.lane || '').toUpperCase();
  const role = String(tl.role || '').toUpperCase();
  if (lane === 'TOP') return 'top';
  if (lane === 'JUNGLE') return 'jungle';
  if (lane === 'MIDDLE' || lane === 'MID') return 'middle';
  if (lane === 'BOTTOM' || lane === 'BOT') return role.includes('SUPPORT') ? 'utility' : 'bottom';
  return '';
}

// Reglas del pick automático, limpias y con topes (para que un pedido raro no rompa nada).
const LANES = ['top', 'jungle', 'middle', 'bottom', 'utility'];
const SPELL_IDS = [1, 3, 4, 6, 7, 11, 12, 14, 21]; // hechizos de la Grieta
const ATTRS = ['tank', 'fighter', 'mage', 'assassin', 'marksman', 'support', 'melee', 'ranged', 'ap', 'ad'];
function cleanRules(list) {
  const ids = (a, n) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter((x) => x > 0))].slice(0, n);
  return (Array.isArray(list) ? list : []).slice(0, 30).map((r) => {
    r = r || {};
    const picks = [];
    (Array.isArray(r.picks) ? r.picks : []).forEach((p) => {
      const c = Number(p && p.c) || 0;
      const attr = ATTRS.includes(p && p.attr) ? p.attr : '';
      if (picks.length >= 5) return;
      if (c > 0 && !picks.some((x) => x.c === c)) picks.push({ c, avoid: ids(p.avoid, 10) });
      else if (!c && attr && !picks.some((x) => x.attr === attr)) picks.push({ c: 0, attr, avoid: ids(p.avoid, 10) });
    });
    const conds = (Array.isArray(r.conds) ? r.conds : []).slice(0, 8).map((c) => {
      c = c || {};
      if (c.t === 'ally' || c.t === 'enemy') return { t: c.t, champs: ids(c.champs, 10) };
      if (c.t === 'count') return { t: 'count', team: c.team === 'enemy' ? 'enemy' : 'ally', attr: ATTRS.includes(c.attr) ? c.attr : 'mage', op: ['ge', 'le', 'eq'].includes(c.op) ? c.op : 'ge', n: Math.max(0, Math.min(5, Number(c.n) || 0)) };
      if (c.t === 'order') return { t: 'order', v: c.v === 'last' ? 'last' : String(Math.max(1, Math.min(5, Number(c.v) || 1))) };
      return null;
    }).filter(Boolean);
    const kind = r.kind === 'block' ? 'block' : 'pick';
    const b = r.block || {};
    const out = { vs: ids(r.vs, 10), lane: LANES.includes(r.lane) ? r.lane : '', picks, off: !!r.off, conds, kind };
    if (kind === 'pick') {
      let sp = (Array.isArray(r.spells) ? r.spells : []).map(Number).filter((x) => SPELL_IDS.includes(x));
      sp = [...new Set(sp)].slice(0, 2);
      if (out.lane === 'jungle') sp = sp.filter((x) => x !== 11).slice(0, 1); // en jungla Aplastar va siempre: solo se elige el otro
      if (sp.length) out.spells = sp;
      if (r.runes === 'rec') out.runes = 'rec'; else if (Number(r.runes) > 0) out.runes = Number(r.runes);
    }
    if (kind === 'block') out.block = { attr: ATTRS.includes(b.attr) ? b.attr : '', champs: ids(b.champs, 10) };
    return out;
  });
}

// El diagnóstico nunca lleva la clave ni el token del chat de la sala.
function redactLobby(l) {
  if (!l || typeof l !== 'object') return l;
  const o = Object.assign({}, l);
  if (o.multiUserChatPassword) o.multiUserChatPassword = '(oculto)';
  if (o.mucJwtDto) o.mucJwtDto = Object.assign({}, o.mucJwtDto, { jwt: '(oculto)' });
  return o;
}

function cleanRunePage(p) {
  if (!p) return null;
  const ids = Array.isArray(p.selectedPerkIds) ? p.selectedPerkIds.map(Number) : [];
  const ps = Number(p.primaryStyleId); const ss = Number(p.subStyleId);
  if (ids.length !== 9 || ids.some((n) => !(n > 0)) || !(ps > 0) || !(ss > 0) || ps === ss) return null;
  return { primaryStyleId: ps, subStyleId: ss, selectedPerkIds: ids };
}

function lcuMessage(r) {
  const d = r && r.data;
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 160);
  return String(d.message || d.error || '').slice(0, 160);
}

class Engine extends EventEmitter {
  constructor(store, lcu) {
    super();
    this.store = store;
    this.lcu = lcu || new LCU();
    this.s = this._blank();
    this._rcInterval = null;
    this._chatInterval = null;
    this._chatId = null;
    this._nameCache = new Map();
    this._mySummonerId = null;
    this._prepickDone = false; this._prepickTries = 0;
    this._listTimer = null;
    this._emitTimer = null;
    this._runesTimer = null;
    this._lastMyTurnId = null;
    this._lastChatId = null;
    this._userBanChoice = null;
    this._prebanTurn = null;
    this._banGuardId = null;
    this._skinsFor = null;
    this._lastSwapKey = '';
    this._styles = null;
    this._diag = null;
  }

  _blank() {
    return {
      skins: [],
      diag: { on: false, file: null, count: 0 },
      connected: false,
      phase: 'None',
      lobbyQueueId: null,
      lobby: null, // sala actual: {queueId, gameMode, quickPlay, slots[]} (Swiftplay usa 2 slots)
      gameMode: '',
      spellModes: null,
      owned: [],
      search: null,
      readyCheck: null,
      queues: [],
      champSelect: null,
      runes: { pages: [], currentId: null },
      chat: [],
      chatReady: false,
      invites: [],
      version: APP_VERSION,
    };
  }

  get settings() { return this.store.settings; }

  start() {
    this.lcu.on('connected', () => this._onConnected());
    this.lcu.on('disconnected', () => {
      this._stopReadyCheck();
      this._stopChat();
      this._ownedLoaded = false;
      this.s = this._blank();
      this._emitState();
    });
    this.lcu.on('event', (ev) => this._onEvent(ev));
    this.lcu.start();
  }

  stop() { clearInterval(this._invInterval); this.lcu.stop(); this._stopReadyCheck(); this._stopChat(); }

  snapshot() {
    return Object.assign({}, this.s, { settings: this.settings, maxAutoDelay: MAX_AUTO_DELAY, now: Date.now() });
  }

  _emitState() {
    if (this._emitTimer) return;
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      this.emit('state', this.snapshot());
    }, 30);
  }

  _alert(kind, extra) { this.emit('alert', Object.assign({ kind }, extra || {})); }

  // ---------- conexión inicial ----------
  async _onConnected() {
    const [phase, queues, me] = await Promise.all([
      this.lcu.request('GET', '/lol-gameflow/v1/gameflow-phase'),
      this.lcu.request('GET', '/lol-game-queues/v1/queues'),
      this.lcu.request('GET', '/lol-summoner/v1/current-summoner'),
    ]);
    if (me.status === 200 && me.data) { this._mySummonerId = me.data.summonerId; this._myPuuid = me.data.puuid || null; this._myName = me.data.gameName || me.data.displayName || ''; }
    this.s.queues = this._pickQueues(queues.data);
    this.s.connected = true; // recién con las colas cargadas (si no, el celular puede ver la lista vacía)
    await this._refreshRunes();
    this._loadChampInfo();
    this._loadSpellModes();
    clearInterval(this._invInterval);
    this._invInterval = setInterval(() => this._checkInvites(), 3000);
    this._checkInvites();
    this._setPhase(typeof phase.data === 'string' ? phase.data : 'None', true);
    this._emitState();
  }

  queueName(id) { return QUEUE_NAMES[Number(id)] || ''; }
  champName(id) { const c = this._cinfo && this._cinfo.get(Number(id)); return (c && c.name) || ''; }

  // Discord: link de invitación a tu canal de voz, mensaje para mandarlo y la presencia (Rich Presence).
  setDiscord(patch) {
    const d = this.settings.discord = Object.assign({ rpc: false, clientId: '', voiceLink: '', voiceMsg: '', lang: 'es', showNick: true }, this.settings.discord || {});
    patch = patch || {};
    if (patch.voiceLink !== undefined) {
      const v = String(patch.voiceLink || '').trim().replace(/^http:\/\//, 'https://').replace(/^(discord\.gg|discord\.com)/, 'https://$1');
      if (v && !VOICE_RE.test(v)) return { ok: false, error: 'badLink' };
      d.voiceLink = v;
    }
    if (patch.voiceMsg !== undefined) d.voiceMsg = String(patch.voiceMsg || '').slice(0, 200);
    if (patch.rpc !== undefined) d.rpc = !!patch.rpc;
    if (patch.showNick !== undefined) d.showNick = !!patch.showNick;
    if (patch.lang === 'es' || patch.lang === 'en') d.lang = patch.lang;
    if (patch.clientId !== undefined) { const c = String(patch.clientId || '').trim(); if (c && !/^\d{15,22}$/.test(c)) return { ok: false, error: 'badId' }; d.clientId = c; }
    this.store.save();
    this.emit('discord');
    this._emitState();
    return { ok: true };
  }

  // Manda tu link del voice al chat (de la sala o del champ select) con tu mensaje.
  async sendVoice(msg) {
    const d = this.settings.discord || {};
    if (!d.voiceLink) return { ok: false, error: 'noLink' };
    let body = String(msg || d.voiceMsg || '').trim() || '🎧 {link}';
    body = body.includes('{link}') ? body.split('{link}').join(d.voiceLink) : `${body} ${d.voiceLink}`;
    return this.sendChat(body);
  }

  _pickQueues(list) {
    if (!Array.isArray(list)) return FALLBACK_QUEUES;
    const ok = list.filter((q) => q && QUEUE_NAMES[q.id] && q.queueAvailability === 'Available');
    if (!ok.length) return FALLBACK_QUEUES;
    const ids = [...new Set(ok.map((q) => q.id))].sort((a, b) => QUEUE_ORDER.indexOf(a) - QUEUE_ORDER.indexOf(b));
    return ids.map((id) => ({ id, name: QUEUE_NAMES[id] }));
  }

  // ---------- eventos del cliente ----------
  _onEvent(ev) {
    const uri = ev.uri || '';
    if (this._diag) this._diagEvent(ev);
    if (uri === '/lol-gameflow/v1/gameflow-phase') {
      if (ev.eventType !== 'Delete' && typeof ev.data === 'string') this._setPhase(ev.data);
    } else if (uri === '/lol-matchmaking/v1/ready-check') {
      this._onReadyCheckEvent(ev.data);
    } else if (uri === '/lol-lobby/v2/lobby/matchmaking/search-state') {
      this._onSearchState(ev.data);
    } else if (uri === '/lol-champ-select/v1/session') {
      if (ev.eventType === 'Delete') { this.s.champSelect = null; this._emitState(); } else this._applySession(ev.data);
    } else if (uri === '/lol-champ-select/v1/ongoing-champion-swap') {
      const d = ev.eventType === 'Delete' ? null : ev.data;
      this._ongoing = d && d.id !== undefined ? {
        id: d.id, state: d.state, mine: !!d.initiatedByLocalPlayer,
        from: d.requesterChampionName || '', to: d.responderChampionName || '',
        fromId: d.requesterChampionId || 0,
      } : null;
      if (this.s.champSelect) { this.s.champSelect.ongoingSwap = this._ongoing; this._emitState(); }
      if (this._ongoing && this._ongoing.mine && this._ongoing.state === 'DECLINED') this._alert('swapDeclined', { to: this._ongoing.to });
    } else if (uri.endsWith('/champ-select/v1/subset-champion-list')) {
      this._subset = ev.eventType === 'Delete' || !Array.isArray(ev.data) ? [] : ev.data.map(Number);
      if (this.s.champSelect) { this.s.champSelect.subset = this._subset; this._emitState(); }
    } else if (uri.startsWith('/lol-lobby/v2/received-invitations')) {
      this._checkInvites();
    } else if (uri.startsWith('/lol-chat/v1/conversations/') && uri.endsWith('/messages')) {
      if (['Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect'].includes(this.s.phase)) this._chatPoll();
    } else if (uri === '/lol-perks/v1/currentpage' || uri === '/lol-perks/v1/pages') {
      clearTimeout(this._runesTimer);
      this._runesTimer = setTimeout(() => this._refreshRunes().then(() => this._emitState()), 300);
    } else if (uri === '/lol-lobby/v2/lobby' || uri === '/lol-lobby/v2/lobby/members') {
      if (uri === '/lol-lobby/v2/lobby' && ev.eventType === 'Delete') { this.s.lobbyQueueId = null; this.s.lobby = null; }
      else if (uri === '/lol-lobby/v2/lobby' && ev.data && ev.data.gameConfig) this._applyLobby(ev.data);
      else if (uri === '/lol-lobby/v2/lobby/members') this._lobbySoon();
      this._emitState();
    }
  }


  // ---------- sala (lobby) y Swiftplay ----------
  _lobbySoon() {
    clearTimeout(this._lobbyTimer);
    this._lobbyTimer = setTimeout(() => this._fetchLobby(), 150);
  }

  async _fetchLobby() {
    const r = await this.lcu.request('GET', '/lol-lobby/v2/lobby');
    if (r.status === 200 && r.data && r.data.gameConfig) { this._applyLobby(r.data); this._emitState(); }
  }

  _applyLobby(d) {
    const gc = d.gameConfig || {};
    this.s.lobbyQueueId = gc.queueId;
    const lm = d.localMember || {};
    const slots = Array.isArray(lm.playerSlots) ? lm.playerSlots.map((x) => {
      let perks = null;
      try { perks = x.perks ? JSON.parse(x.perks) : null; } catch (_) {}
      return {
        championId: x.championId || 0, skinId: x.skinId || 0, spell1: x.spell1 || 0, spell2: x.spell2 || 0,
        position: x.positionPreference || '',
        perks: perks && Array.isArray(perks.perkIds) ? { primaryStyleId: perks.perkStyle, subStyleId: perks.perkSubStyle, selectedPerkIds: perks.perkIds } : null,
      };
    }) : [];
    if (Array.isArray(d.members)) {
      // Gente de tu grupo (party): en ranked sus nombres se muestran en el chat aunque el cliente oculte a los demás.
      this._party = { sids: new Set(), puuids: new Set() };
      d.members.forEach((m) => { if (m && !m.isBot) { if (m.summonerId) this._party.sids.add(m.summonerId); if (m.puuid) this._party.puuids.add(m.puuid); } });
      if (!this._lobbyNames) this._lobbyNames = new Map();
      d.members.forEach((m) => { const nm = m.gameName || m.summonerName || m.summonerInternalName; if (m && m.summonerId && nm) this._lobbyNames.set(m.summonerId, nm); });
    }
    this._partyId = d.partyId || d.multiUserChatId || null;
    this._rawSlots = Array.isArray(lm.playerSlots) ? lm.playerSlots : [];
    const quick = !!gc.showQuickPlaySlotSelection || gc.queueId === 480;
    this.s.lobby = {
      queueId: gc.queueId, gameMode: gc.gameMode || '', quickPlay: quick && slots.length > 0, slots,
      showPositionSelector: !!gc.showPositionSelector,
      roles: { first: lm.firstPositionPreference || '', second: lm.secondPositionPreference || '' },
      members: Array.isArray(d.members) ? d.members.length : 1,
      isLeader: lm.isLeader !== false,
    };
    if (gc.gameMode) this.s.gameMode = gc.gameMode;
    if (this.s.lobby.quickPlay && !this._ownedLoaded) this._loadOwned();
  }

  async _loadOwned() {
    this._ownedLoaded = true;
    const r = await this.lcu.request('GET', '/lol-champions/v1/owned-champions-minimal');
    if (r.status === 200 && Array.isArray(r.data)) {
      this.s.owned = r.data.filter((c) => c && ((c.ownership && c.ownership.owned) || (c.freeToPlay))).map((c) => c.id);
      this._emitState();
    } else this._ownedLoaded = false;
  }

  // Hechizos válidos por modo, tal como los informa el propio cliente (gameModes de cada hechizo).
  async _loadSpellModes() {
    const r = await this.lcu.request('GET', '/lol-game-data/assets/v1/summoner-spells.json');
    if (r.status === 200 && Array.isArray(r.data)) {
      const m = {};
      r.data.forEach((x) => { if (x && x.id && Array.isArray(x.gameModes)) m[x.id] = x.gameModes; });
      this.s.spellModes = Object.keys(m).length ? m : null;
      this._emitState();
    }
  }

  async _loadGameMode() {
    const r = await this.lcu.request('GET', '/lol-gameflow/v1/session');
    const q = r.status === 200 && r.data && r.data.gameData && r.data.gameData.queue;
    if (q && q.gameMode) { this.s.gameMode = q.gameMode; this._emitState(); }
  }

  // Cambia un dato de uno de los 2 slots de Swiftplay (rol, campeón, hechizos, runas, skin).
  async setQuickSlot(index, patch) {
    index = Number(index);
    if (!this._rawSlots || !this._rawSlots[index] || !patch || typeof patch !== 'object') return { ok: false, error: 'noslot' };
    const slots = this._rawSlots.map((x) => Object.assign({}, x));
    const cur = slots[index];
    const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
    if (patch.position !== undefined) {
      if (!POS.includes(patch.position)) return { ok: false, error: 'invalid' };
      cur.positionPreference = patch.position;
    }
    if (patch.championId !== undefined) {
      const c = Number(patch.championId);
      if (!c) return { ok: false, error: 'invalid' };
      if (c !== cur.championId) { cur.championId = c; cur.skinId = c * 1000; }
    }
    if (patch.skinId !== undefined) cur.skinId = Number(patch.skinId);
    if (patch.spell1 !== undefined) cur.spell1 = Number(patch.spell1);
    if (patch.spell2 !== undefined) cur.spell2 = Number(patch.spell2);
    if (!patch.perks && (patch.championId !== undefined || patch.position !== undefined) && cur.championId && cur.positionPreference) {
      // igual que el cliente: runas sugeridas para ese campeón y rol
      const pp = cur.positionPreference;
      let q = await this.lcu.request('GET', `/lol-perks/v1/quick-play-selections/champion/${cur.championId}/position/${pp}`);
      if (q.status !== 200 || !q.data) q = await this.lcu.request('GET', `/lol-perks/v1/quick-play-selections/champion/${cur.championId}/position/${String(pp).toLowerCase()}`);
      if (q.status === 200 && q.data) cur.perks = typeof q.data === 'string' ? q.data : JSON.stringify(q.data);
    }
    if (patch.perks) {
      const ids = Array.isArray(patch.perks.selectedPerkIds) ? patch.perks.selectedPerkIds.map(Number) : [];
      if (ids.length !== 9 || ids.some((n) => !n) || !patch.perks.primaryStyleId || !patch.perks.subStyleId) return { ok: false, error: 'invalid' };
      cur.perks = JSON.stringify({ perkIds: ids, perkStyle: Number(patch.perks.primaryStyleId), perkSubStyle: Number(patch.perks.subStyleId) });
    }
    if (cur.spell1 && cur.spell1 === cur.spell2) return { ok: false, error: 'samespell' };
    const body = slots.map((x) => ({
      championId: x.championId, perks: x.perks, positionPreference: x.positionPreference, skinId: x.skinId, spell1: x.spell1, spell2: x.spell2,
    }));
    let r = await this.lcu.request('PUT', '/lol-lobby/v1/lobby/members/localMember/player-slots', body);
    if (r.status === 404 || r.status === 405) r = await this.lcu.request('PUT', '/lol-lobby/v2/lobby/members/localMember/player-slots', body);
    await this._fetchLobby();
    const okk = r.status >= 200 && r.status < 300;
    return { ok: okk, error: okk ? undefined : 'rejected', status: r.status, message: okk ? undefined : lcuMessage(r) };
  }

  // Skins que tenés de un campeón (para elegir antes de buscar, por ejemplo en Swiftplay).
  async ownedSkins(championId) {
    championId = Number(championId);
    if (!championId || !this._mySummonerId) return { ok: true, skins: [] };
    const r = await this.lcu.request('GET', `/lol-champions/v1/inventories/${this._mySummonerId}/champions/${championId}/skins`);
    if (r.status !== 200 || !Array.isArray(r.data)) return { ok: false, skins: [] };
    const skins = r.data
      .filter((x) => x && (x.isBase || (x.ownership && x.ownership.owned)))
      .map((x) => ({ id: x.id, name: x.isBase ? '' : (x.name || ''), tile: x.tilePath || x.splashTilePath || '' }));
    return { ok: true, skins };
  }

  _setPhase(p, force) {
    const prev = this.s.phase;
    if (p === prev && !force) return;
    this.s.phase = p;
    if (p !== prev) this._phaseSince = Date.now();
    // Campeón con el que entrás a la partida (para mostrarlo en Discord durante el juego).
    if (prev === 'ChampSelect') { const me = this.s.champSelect && (this.s.champSelect.myTeam || []).find((x) => x.isMe); this._gameChamp = (me && me.championId) || 0; }
    if (['None', 'Lobby'].includes(p)) this._gameChamp = 0;

    if (p === 'ReadyCheck' && prev !== 'ReadyCheck') this._startReadyCheck();
    if (prev === 'ReadyCheck' && p !== 'ReadyCheck') this._stopReadyCheck();

    if (p === 'Matchmaking') {
      this.lcu.request('GET', '/lol-lobby/v2/lobby/matchmaking/search-state').then((r) => {
        if (r.status === 200) this._onSearchState(r.data);
      });
    } else {
      this.s.search = null;
    }

    if (p !== 'ChampSelect') { this._subset = []; this._ongoing = null; this._allyNums = null; }
    if (p === 'Lobby' || p === 'Matchmaking') {
      this._fetchLobby();
    }
    if (p === 'None') { this.s.lobbyQueueId = null; this.s.lobby = null; this._party = null; }

    const chatWanted = (x) => ['Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect'].includes(x);
    if (chatWanted(p) && !chatWanted(prev)) this._startChat(); // chat de la sala
    if (!chatWanted(p) && chatWanted(prev)) this._stopChat();
    if (p === 'ChampSelect' && prev !== 'ChampSelect') {
      this._prepickDone = false; this._prepickTries = 0; this._intentDone = false;
      this._autoPickTurn = null; this._autoPickStartFor = null;
      this._prebanTurn = null; this._autoBanTurn = null; clearTimeout(this._autoBanTimer);
      this._loadChampInfo();
      this._loadHistory();
      this._lastMyTurnId = null;
      this._userBanChoice = null;
      this._banGuardId = null;
      this._skinsFor = null;
      this._lastSwapKey = '';
      this.s.skins = [];
      this._startChat();
      this._loadGameMode();
      this.lcu.request('GET', '/lol-champ-select/v1/session').then((r) => {
        if (r.status === 200) this._applySession(r.data);
      });
    }
    if (prev === 'ChampSelect' && p !== 'ChampSelect') {
      clearTimeout(this._autoPickTimer);
      this.s.champSelect = null;
      if (chatWanted(p)) this._startChat(); else this._stopChat();
    }
    this._emitState();
  }

  _onSearchState(d) {
    if (!d) { this.s.search = null; return; }
    this.s.search = {
      state: d.searchState,
      timeInQueue: d.timeInQueue || 0,
      estimated: d.estimatedQueueTime || 0,
      at: Date.now(),
    };
    this._emitState();
  }

  // ---------- ready check / autoaceptar ----------
  _startReadyCheck() {
    this.s.readyCheck = { startedAt: Date.now(), response: 'None', accepted: false };
    this._alert('matchFound');
    this._stopRcTimer();
    this._rcInterval = setInterval(() => this._rcTick(), 150);
    this._rcTick();
  }

  _stopRcTimer() { clearInterval(this._rcInterval); this._rcInterval = null; }

  _stopReadyCheck() { this._stopRcTimer(); this.s.readyCheck = null; }

  _rcTick() {
    const rc = this.s.readyCheck;
    if (!rc || rc.accepted || rc.response === 'Declined') return;
    const a = this.settings.autoAccept;
    if (!a.enabled) return;
    const delay = Math.min(Math.max(Number(a.delay) || 0, 0), MAX_AUTO_DELAY);
    if (Date.now() - rc.startedAt >= delay * 1000) this.acceptMatch('auto');
  }

  _onReadyCheckEvent(d) {
    const rc = this.s.readyCheck;
    if (!rc || !d) return;
    rc.response = d.playerResponse || 'None';
    if (d.playerResponse === 'Accepted') rc.accepted = true;
    this._emitState();
  }

  async acceptMatch(source) {
    const rc = this.s.readyCheck;
    if (!rc || rc.accepted) return { ok: false };
    rc.accepted = true; // evita doble envío
    const r = await this.lcu.request('POST', '/lol-matchmaking/v1/ready-check/accept');
    if (r.status >= 200 && r.status < 300) {
      rc.response = 'Accepted';
      rc.source = source || 'manual';
    } else {
      rc.accepted = false; // reintenta en el próximo tick si es automático
    }
    this._emitState();
    return { ok: rc.accepted };
  }

  async declineMatch() {
    const rc = this.s.readyCheck;
    if (!rc) return { ok: false };
    rc.accepted = true;
    rc.response = 'Declined';
    await this.lcu.request('POST', '/lol-matchmaking/v1/ready-check/decline');
    this._emitState();
    return { ok: true };
  }

  setAutoAccept(enabled, delay) {
    const a = this.settings.autoAccept;
    if (typeof enabled === 'boolean') a.enabled = enabled;
    if (delay !== undefined && delay !== null) a.delay = Math.min(Math.max(Number(delay) || 0, 0), MAX_AUTO_DELAY);
    this.store.save();
    this._emitState();
  }

  // ---------- invitar amigos a la sala ----------
  async friends() {
    const r = await this.lcu.request('GET', '/lol-chat/v1/friends');
    if (r.status !== 200 || !Array.isArray(r.data)) return { ok: false, error: 'nofriends' };
    if (this._diag) this._diag.friendsSample = r.data.slice(0, 3);
    const QT = { RANKED_SOLO_5x5: 'Ranked Solo/Duo', RANKED_FLEX_SR: 'Ranked Flex', NORMAL: 'Normal', NORMAL_DRAFT: 'Normal', ARAM: 'ARAM', KIWI: 'ARAM Mayhem', CHERRY: 'Arena', BOT: 'Bots', SWIFTPLAY: 'Swiftplay' };
    const label = (f) => {
      const gs = f.lol && f.lol.gameStatus;
      if (f.availability === 'mobile') return 'mobile';
      if (gs === 'inGame') return 'ingame';
      if (gs && gs !== 'outOfGame' && gs !== 'hosting_Unknown') return 'busy';
      if (f.availability === 'away') return 'away';
      if (f.availability === 'dnd') return 'dnd';
      return 'online';
    };
    const list = r.data
      .filter((f) => f && f.summonerId && f.availability && f.availability !== 'offline')
      .filter((f) => !f.product || f.product === 'league_of_legends')
      .map((f) => {
        const lol = f.lol || {};
        const qt = QT[lol.gameQueueType] || QT[lol.gameMode] || lol.gameQueueType || '';
        return {
          id: f.summonerId,
          name: f.gameName ? `${f.gameName}${f.gameTag ? '#' + f.gameTag : ''}` : (f.name || ''),
          icon: f.icon || f.profileIconId || 0,
          status: label(f),
          gs: lol.gameStatus || '',
          queue: qt,
          since: Number(lol.timeStamp) || 0,
        };
      })
      .filter((f) => f.name);
    const rank = { online: 0, away: 1, busy: 2, dnd: 3, ingame: 4, mobile: 5 };
    list.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
    return { ok: true, friends: list };
  }

  async inviteFriend(summonerId) {
    summonerId = Number(summonerId);
    if (!summonerId) return { ok: false, error: 'bad' };
    if (this.s.phase !== 'Lobby') return { ok: false, error: 'notLobby' };
    const r = await this.lcu.request('POST', '/lol-lobby/v2/lobby/invitations', [{ toSummonerId: summonerId }]);
    if (this._diag) this._diag.inviteTry = { status: r.status, data: r.data };
    return r.status >= 200 && r.status < 300 ? { ok: true } : { ok: false, error: 'inviteFail' };
  }

  // ---------- invitaciones a sala ----------
  setAutoInvite(enabled) {
    this.settings.autoInvite.enabled = !!enabled;
    this.store.save();
    if (enabled) this._checkInvites();
    this._emitState();
  }

  async _checkInvites() {
    if (!this.s.connected || this._invBusy) return;
    if (!['None', 'Lobby'].includes(this.s.phase)) { if (this.s.invites.length) { this.s.invites = []; this._emitState(); } return; }
    this._invBusy = true;
    try {
      const r = await this.lcu.request('GET', '/lol-lobby/v2/received-invitations');
      const list = r.status === 200 && Array.isArray(r.data) ? r.data.filter((x) => x && x.invitationId && (!x.state || x.state === 'Pending')) : [];
      const out = [];
      for (const x of list) {
        const from = x.fromSummonerName || (x.fromSummonerId ? await this._nameOf(x.fromSummonerId) : '');
        out.push({ id: String(x.invitationId), from, queueId: x.gameConfig && x.gameConfig.queueId ? x.gameConfig.queueId : null });
      }
      if (this.settings.autoInvite.enabled && out.length) {
        for (const x of out) await this.lcu.request('POST', `/lol-lobby/v2/received-invitations/${encodeURIComponent(x.id)}/accept`);
        this.s.invites = [];
        this._alert('inviteAccepted', { from: out[0].from });
      } else {
        const ids = out.map((x) => x.id).join(',');
        if (ids !== this.s.invites.map((x) => x.id).join(',')) {
          if (out.length && out.some((x) => !this.s.invites.find((y) => y.id === x.id))) this._alert('invite', { from: out[0].from });
          this.s.invites = out;
        }
      }
      this._emitState();
    } finally { this._invBusy = false; }
  }

  async answerInvite(id, accept) {
    const r = await this.lcu.request('POST', `/lol-lobby/v2/received-invitations/${encodeURIComponent(String(id))}/${accept ? 'accept' : 'decline'}`);
    this.s.invites = this.s.invites.filter((x) => x.id !== String(id));
    this._emitState();
    return { ok: r.status >= 200 && r.status < 300 };
  }

  // ---------- cola ----------
  async createLobbyAndSearch(queueId) {
    queueId = Number(queueId);
    if (!queueId) return { ok: false, error: 'queue' };
    if (this.s.phase === 'Matchmaking') return { ok: true };
    if (this.s.phase === 'Lobby') {
      if (this.s.lobbyQueueId !== queueId) {
        const ch = await this._changeLobbyQueue(queueId);
        if (!ch.ok) return ch;
      }
    } else if (this.s.phase === 'None') {
      const c = await this.lcu.request('POST', '/lol-lobby/v2/lobby', { queueId });
      if (c.status < 200 || c.status >= 300) return { ok: false, error: 'lobby' };
    } else {
      return { ok: false, error: 'phase' };
    }
    await this._fetchLobby();
    if (this.s.lobby && this.s.lobby.showPositionSelector) await this._applyRoles(); // rol principal/secundario antes de buscar
    const r = await this.lcu.request('POST', '/lol-lobby/v2/lobby/matchmaking/search');
    return { ok: r.status >= 200 && r.status < 300, error: r.status >= 300 ? 'search' : undefined };
  }

  // Crea la sala SIN buscar partida (para invitar amigos primero).
  async createLobby(queueId) {
    queueId = Number(queueId);
    if (!queueId) return { ok: false, error: 'queue' };
    if (this.s.phase === 'Lobby') {
      if (this.s.lobbyQueueId !== queueId) return this._changeLobbyQueue(queueId);
      return { ok: true };
    }
    if (this.s.phase !== 'None') return { ok: false, error: 'phase' };
    const c = await this.lcu.request('POST', '/lol-lobby/v2/lobby', { queueId });
    if (c.status < 200 || c.status >= 300) return { ok: false, error: 'lobby' };
    await this._fetchLobby();
    if (this.s.lobby && this.s.lobby.showPositionSelector) await this._applyRoles();
    this._emitState();
    return { ok: true };
  }

  // Cambia el modo de la sala SIN salirte: si hay gente en la sala nunca se cierra la sala.
  async _changeLobbyQueue(queueId) {
    await this._fetchLobby();
    const lb = this.s.lobby || {};
    if (this.s.lobbyQueueId === queueId) return { ok: true };
    if (lb.members > 1 && lb.isLeader === false) return { ok: false, error: 'notHost' };
    const tries = [
      () => this.lcu.request('PUT', '/lol-lobby/v2/lobby/queue', queueId),
      () => this.lcu.request('POST', '/lol-lobby/v2/lobby', { queueId }),
    ];
    for (const fn of tries) {
      try { await fn(); } catch (_) {}
      await this._fetchLobby();
      if (this.s.lobbyQueueId === queueId) return { ok: true };
    }
    if ((lb.members || 1) > 1) return { ok: false, error: 'changeFail' }; // con gente: no cerramos la sala
    await this.lcu.request('DELETE', '/lol-lobby/v2/lobby');
    const c = await this.lcu.request('POST', '/lol-lobby/v2/lobby', { queueId });
    if (c.status < 200 || c.status >= 300) return { ok: false, error: 'lobby' };
    return { ok: true };
  }

  // Cambiar el modo de la sala sin buscar partida (para jugar con amigos).
  async setLobbyQueue(queueId) {
    queueId = Number(queueId);
    if (!queueId) return { ok: false, error: 'queue' };
    if (this.s.phase !== 'Lobby') return { ok: true };
    const r = await this._changeLobbyQueue(queueId);
    this._emitState();
    return r;
  }

  // Rol principal y secundario (Normal y Clasificatoria). Se guarda y se aplica al crear la sala.
  async setRoles(first, second) {
    const OK = ['', 'TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'FILL'];
    first = String(first || ''); second = String(second || '');
    if (!OK.includes(first) || !OK.includes(second)) return { ok: false, error: 'invalid' };
    this.settings.roles.first = first;
    this.settings.roles.second = second;
    this.store.save();
    this._emitState();
    if (this.s.lobby && this.s.lobby.showPositionSelector && first) return this._applyRoles();
    return { ok: true };
  }

  async _applyRoles() {
    const rl = this.settings.roles;
    if (!rl || !rl.first) return { ok: true };
    const body = { firstPreference: rl.first, secondPreference: rl.second || 'FILL' };
    let r = await this.lcu.request('PUT', '/lol-lobby/v1/lobby/members/localMember/position-preferences', body);
    if (r.status === 404 || r.status === 405) r = await this.lcu.request('PUT', '/lol-lobby/v2/lobby/members/localMember/position-preferences', body);
    await this._fetchLobby();
    const okk = r.status >= 200 && r.status < 300;
    return { ok: okk, error: okk ? undefined : 'rejected', status: r.status, message: okk ? undefined : lcuMessage(r) };
  }

  async cancelSearch() {
    const r = await this.lcu.request('DELETE', '/lol-lobby/v2/lobby/matchmaking/search');
    return { ok: r.status >= 200 && r.status < 300 };
  }

  async leaveLobby() {
    const r = await this.lcu.request('DELETE', '/lol-lobby/v2/lobby');
    return { ok: r.status >= 200 && r.status < 300 };
  }

  // ---------- champ select ----------
  _applySession(sess) {
    if (!sess || typeof sess !== 'object') return;
    if (sess.queueId) this._csQueue = Number(sess.queueId);
    if (!this._puuidNames) this._puuidNames = new Map();
    [].concat(sess.myTeam || [], sess.theirTeam || []).forEach((p) => { if (p && p.puuid && p.gameName && p.nameVisibilityType !== 'HIDDEN') this._puuidNames.set(p.puuid, p.gameName); });
    this._csCells = (sess.myTeam || []).slice();
    const local = sess.localPlayerCellId;
    const groups = Array.isArray(sess.actions) ? sess.actions : [];
    const flat = groups.flat();
    const myCells = new Set((sess.myTeam || []).map((p) => p.cellId));

    const myActive = flat.find((a) => a.actorCellId === local && a.isInProgress && !a.completed);
    const myPick = flat.find((a) => a.actorCellId === local && a.type === 'pick');

    const order = flat
      .filter((a) => a.type === 'pick' || a.type === 'ban')
      .map((a) => ({
        id: a.id, type: a.type, cellId: a.actorCellId, ally: myCells.has(a.actorCellId),
        championId: a.championId || 0, inProgress: !!a.isInProgress, completed: !!a.completed,
        mine: a.actorCellId === local,
      }));
    const picks = order.filter((o) => o.type === 'pick');
    const bans = order.filter((o) => o.type === 'ban');
    const myPickIdx = picks.findIndex((o) => o.mine);
    const myBanIdx = bans.findIndex((o) => o.mine);
    const info = {
      pickNumber: myPickIdx >= 0 ? myPickIdx + 1 : null,
      pickTotal: picks.length,
      picksBefore: myPickIdx >= 0 ? picks.slice(0, myPickIdx).filter((o) => !o.completed).length : null,
      banNumber: myBanIdx >= 0 ? myBanIdx + 1 : null,
      bansBefore: myBanIdx >= 0 ? bans.slice(0, myBanIdx).filter((o) => !o.completed).length : null,
    };
    // Tu orden de pick dentro de tu equipo (1 = primero); para las reglas "si pickeo primero / último".
    const allyPicks = picks.filter((o) => o.ally);
    const myAllyIdx = allyPicks.findIndex((o) => o.mine);
    info.allyPickNumber = myAllyIdx >= 0 ? myAllyIdx + 1 : null;
    info.allyPickTotal = allyPicks.length;

    const mapP = (p) => ({
      cellId: p.cellId,
      championId: p.championId || 0,
      intent: p.championPickIntent || 0,
      position: p.assignedPosition || '',
      spell1Id: p.spell1Id || 0,
      spell2Id: p.spell2Id || 0,
      summonerId: p.summonerId || 0,
      skinId: p.selectedSkinId || 0,
      isMe: p.cellId === local,
    });
    const t = sess.timer || {};
    const prevLists = this.s.champSelect || {};
    const swaps = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x && x.state === 'RECEIVED').map((x) => ({ id: x.id, cellId: x.cellId }));
    const swapsNow = { pickOrder: swaps(sess.pickOrderSwaps), position: swaps(sess.positionSwaps), champion: swaps(sess.trades || sess.championSwaps) };
    // Lo que vos podés pedir (AVAILABLE) o ya pediste (SENT), por compañero.
    const opts = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x && (x.state === 'AVAILABLE' || x.state === 'SENT')).map((x) => ({ id: x.id, cellId: x.cellId, sent: x.state === 'SENT' }));
    const swapOpts = { pickOrder: opts(sess.pickOrderSwaps), position: opts(sess.positionSwaps), champion: opts(sess.trades || sess.championSwaps) };
    const bansDone = bans.every((o) => o.completed);
    // Baneados: los de la lista oficial y también los baneos ya confirmados (la lista a veces llega tarde).
    const bannedSet = new Set([...((sess.bans && sess.bans.myTeamBans) || []), ...((sess.bans && sess.bans.theirTeamBans) || []),
      ...bans.filter((o) => o.completed && o.championId > 0).map((o) => o.championId)].map(Number).filter((x) => x > 0));
    this.s.champSelect = {
      queueId: this._csQueue || null,
      subsetPicks: !!sess.allowSubsetChampionPicks, // ARAM Mayhem (también en partidas personalizadas)
      bansDone,
      hasBans: bans.length > 0, // ARAM y otros modos no tienen fase de baneos
      swaps: swapsNow,
      swapOpts,
      benchEnabled: !!sess.benchEnabled,
      bench: sess.benchEnabled ? (sess.benchChampions || []).map((b) => b.championId).filter(Boolean) : [],
      rerolls: sess.rerollsRemaining || 0,
      allowRerolling: !!sess.allowRerolling,
      hasActions: flat.length > 0,
      phase: t.phase || '',
      timeLeftMs: t.adjustedTimeLeftInPhase != null ? t.adjustedTimeLeftInPhase : null,
      totalMs: t.totalTimeInPhase || null,
      isInfinite: !!t.isInfinite,
      at: Date.now(),
      localCell: local,
      myTeam: (sess.myTeam || []).map(mapP),
      theirTeam: (sess.theirTeam || []).map(mapP),
      bans: bans.length ? {
        my: (sess.bans && sess.bans.myTeamBans) || [],
        their: (sess.bans && sess.bans.theirTeamBans) || [],
      } : { my: [], their: [] },
      banned: [...bannedSet],
      myTurn: myActive ? { id: myActive.id, type: myActive.type, championId: myActive.championId || 0 } : null,
      myPickAction: myPick ? { id: myPick.id, championId: myPick.championId || 0, completed: !!myPick.completed } : null,
      order,
      info,
      subset: this._subset || [], // opciones iniciales (ARAM Mayhem): se elige 1 de las 2
      ongoingSwap: this._ongoing || null,
      pickable: prevLists.pickable || [],
      bannable: prevLists.bannable || [],
      recommend: this._recommendFor((sess.myTeam || []).find((p) => p.cellId === local)),
    };
    this._previewAutoPick();
    this._scheduleAutoPick();

    const turnId = myActive ? myActive.id : null;
    if (turnId !== null && turnId !== this._lastMyTurnId) this._alert('yourTurn', { type: myActive.type });
    this._lastMyTurnId = turnId;

    // Aviso cuando llega un pedido nuevo de cambio (orden de pick, rol o campeón)
    const swapKey = ['pickOrder', 'position', 'champion'].map((k) => swapsNow[k].map((x) => k + x.id).join(',')).join('|');
    if (swapKey !== this._lastSwapKey) {
      const hadNew = ['pickOrder', 'position', 'champion'].some((k) => swapsNow[k].some((x) => !this._lastSwapKey.includes(k + x.id)));
      if (hadNew) this._alert('swap');
      this._lastSwapKey = swapKey;
    }

    // Seguro: si el ban en curso quedó apuntando a tu pick preparado sin que lo hayas elegido vos, se limpia.
    const prep = this.settings.prePick && this.settings.prePick.championId;
    if (myActive && myActive.type === 'ban' && prep && myActive.championId === prep
        && this._userBanChoice !== prep && this._banGuardId !== myActive.id) {
      this._banGuardId = myActive.id;
      this.lcu.request('PATCH', `/lol-champ-select/v1/session/actions/${myActive.id}`, { championId: 0 });
    }

    // Skins: recarga la lista cuando cambia tu campeón
    const meNow = this.s.champSelect.myTeam.find((p) => p.isMe);
    const myChamp = meNow ? meNow.championId : 0;
    if (myChamp !== this._skinsFor) this._refreshSkins(myChamp);

    this._saveDiagSession(sess);
    this._emitState();
    clearTimeout(this._listTimer);
    this._listTimer = setTimeout(() => this._refreshLists(), 150);
  }

  async _refreshSkins(champId) {
    this._skinsFor = champId;
    if (!champId) { this.s.skins = []; return; }
    const r = await this.lcu.request('GET', '/lol-champ-select/v1/skin-carousel-skins');
    if (this._skinsFor !== champId) return;
    if (r.status === 200 && Array.isArray(r.data)) {
      this.s.skins = r.data
        .filter((x) => x && !x.disabled && x.unlocked !== false && (!x.ownership || x.ownership.owned !== false))
        .map((x) => ({ id: x.id, name: x.name || '', tile: x.tilePath || x.splashTilePath || '', splash: x.splashPath || '' }));
    } else {
      this.s.skins = [];
    }
    this._emitState();
  }

  async selectSkin(skinId) {
    const r = await this.lcu.request('PATCH', '/lol-champ-select/v1/session/my-selection', { selectedSkinId: Number(skinId) });
    return { ok: r.status >= 200 && r.status < 300 };
  }

  // action: accept | decline (pedidos que te hacen) · request | cancel (pedidos que hacés vos)
  async answerSwap(kind, id, action) {
    const p = SWAP_PATHS[kind];
    if (action === true) action = 'accept';
    if (action === false) action = 'decline';
    if (!p || id === undefined || !['accept', 'decline', 'request', 'cancel'].includes(action)) return { ok: false };
    const cands = kind === 'champion' ? ['champion-swaps', 'trades'] : [p];
    if (kind === 'champion' && this._tradePath) cands.sort((a, b) => (b === this._tradePath) - (a === this._tradePath));
    let r;
    for (const c of cands) {
      r = await this.lcu.request('POST', `/lol-champ-select/v1/session/${c}/${Number(id)}/${action}`);
      if (r.status !== 404) { if (r.status < 300) this._tradePath = c; break; } // 404 = esa ruta no existe en este cliente
    }
    const okk = r.status >= 200 && r.status < 300;
    return { ok: okk, error: okk ? undefined : 'rejected', status: r.status, message: okk ? undefined : lcuMessage(r) };
  }

  // Dodge: cierra el cliente durante el champ select para no jugar la partida (tiene penalización del juego).
  async dodge() {
    if (this.s.phase !== 'ChampSelect') return { ok: false, error: 'phase' };
    let r = await this.lcu.request('POST', '/process-control/v1/process/quit');
    let ok = r.status >= 200 && r.status < 300;
    if (!ok || !process.env.OQ_NO_KILL) {
      // aseguramos el cierre por si el cliente no responde
      if (!process.env.OQ_NO_KILL) {
        setTimeout(() => {
          const { execFile } = require('child_process');
          if (process.platform === 'win32') {
            execFile('taskkill', ['/F', '/IM', 'LeagueClientUx.exe'], () => {});
            execFile('taskkill', ['/F', '/IM', 'LeagueClient.exe'], () => {});
          } else {
            execFile('pkill', ['-f', 'LeagueClientUx'], () => {});
          }
        }, 1500);
        ok = true;
      }
    }
    return { ok };
  }

  async benchSwap(championId) {
    const r = await this.lcu.request('POST', `/lol-champ-select/v1/session/bench/swap/${Number(championId)}`);
    return { ok: r.status >= 200 && r.status < 300 };
  }

  async reroll() {
    const r = await this.lcu.request('POST', '/lol-champ-select/v1/session/my-selection/reroll');
    return { ok: r.status >= 200 && r.status < 300 };
  }

  async _refreshLists() {
    if (this.s.phase !== 'ChampSelect' || !this.s.champSelect) return;
    const [p, b, sub] = await Promise.all([
      this.lcu.request('GET', '/lol-champ-select/v1/pickable-champion-ids'),
      this.lcu.request('GET', '/lol-champ-select/v1/bannable-champion-ids'),
      this.lcu.request('GET', '/lol-lobby-team-builder/champ-select/v1/subset-champion-list'),
    ]);
    if (!this.s.champSelect) return;
    if (sub.status === 200 && Array.isArray(sub.data)) { this._subset = sub.data.map(Number); this.s.champSelect.subset = this._subset; }
    this.s.champSelect.pickable = Array.isArray(p.data) ? p.data : [];
    this.s.champSelect.bannable = Array.isArray(b.data) ? b.data : [];
    await this._maybePrepick();
    await this._maybePreban();
    this._previewAutoPick();
    this._emitState();
  }

  // Ban preparado y lista de odiados. Al empezar tu turno de ban se marca (así tu equipo lo ve) y,
  // si llegás al final sin banear vos, se confirma en el último segundo. Sin reloj se confirma enseguida.
  _banTarget() {
    const cs = this.s.champSelect;
    if (!cs) return 0;
    const pb = this.settings.preBan || {};
    const list = [Number(pb.championId) || 0].concat(pb.autoBan ? (pb.hates || []).map(Number) : []).filter((x) => x > 0);
    if (!list.length) return 0;
    const bannable = new Set((cs.bannable || []).map(Number));
    const banned = new Set((cs.banned || []).map(Number));
    // Lo que ya marcaron tus compañeros para banear, lo que quieren jugar ellos y tu propio pick preparado no se banea.
    const allyBans = new Set((cs.order || []).filter((o) => o.type === 'ban' && o.ally && !o.mine && o.championId > 0).map((o) => o.championId));
    const allyWants = new Set((cs.myTeam || []).filter((p) => !p.isMe).flatMap((p) => [p.championId, p.intent]).map(Number).filter((x) => x > 0));
    const mine = Number((this.settings.prePick || {}).championId) || 0;
    return list.find((c) => (!bannable.size || bannable.has(c)) && !banned.has(c) && !allyBans.has(c) && !allyWants.has(c) && c !== mine) || 0;
  }

  async _maybePreban() {
    const cs = this.s.champSelect;
    if (!cs || !cs.myTurn || cs.myTurn.type !== 'ban' || cs.phase === 'PLANNING') return; // en la planificación todavía no se banea
    if (!(cs.bannable || []).length) return; // todavía no hay lista, reintenta luego
    const turn = cs.myTurn;
    const pb = this.settings.preBan || {};
    if (!pb.championId && !(pb.autoBan && (pb.hates || []).length)) return;
    if (this._autoBanTurn === turn.id) return;
    if (this._prebanTurn !== turn.id) {
      this._prebanTurn = turn.id;
      const target = this._banTarget();
      if (pb.championId && target !== Number(pb.championId)) this._alert('prebanFailed', { championId: pb.championId });
      if (!target) return;
      if (cs.isInfinite || cs.timeLeftMs == null) { this._autoBanTurn = turn.id; await this.lockIn(target); this._alert('autoBan', { championId: target }); return; }
      // Se marca para que tu equipo lo vea (si no marcaste otro vos).
      if (!turn.championId) await this.lcu.request('PATCH', `/lol-champ-select/v1/session/actions/${turn.id}`, { championId: target });
    }
    if (cs.isInfinite || cs.timeLeftMs == null) return;
    // Se reprograma con cada actualización del reloj.
    clearTimeout(this._autoBanTimer);
    const wait = Math.max(0, cs.timeLeftMs - (cs.at ? Date.now() - cs.at : 0) - AUTO_BAN_MARGIN_MS);
    this._autoBanTimer = setTimeout(() => this._autoBan(turn.id), wait);
  }

  // Último segundo del ban: se confirma lo que esté marcado (lo tuyo si cambiaste) o el ban preparado / un odiado disponible.
  async _autoBan(turnId) {
    const cs = this.s.champSelect;
    if (!cs || !cs.myTurn || cs.myTurn.id !== turnId || cs.myTurn.type !== 'ban' || this._autoBanTurn === turnId) return;
    this._autoBanTurn = turnId;
    const b = await this.lcu.request('GET', '/lol-champ-select/v1/bannable-champion-ids');
    if (Array.isArray(b.data) && b.data.length && this.s.champSelect) this.s.champSelect.bannable = b.data;
    const hovered = Number(cs.myTurn.championId) || 0;
    const bannable = new Set(((this.s.champSelect && this.s.champSelect.bannable) || []).map(Number));
    const champ = hovered && (!bannable.size || bannable.has(hovered)) && !(cs.banned || []).includes(hovered) ? hovered : this._banTarget();
    if (this._diag) (this._diag.autoBan = this._diag.autoBan || []).push({ t: Date.now(), turnId, hovered, champ });
    if (!champ) return;
    const r = await this.lockIn(champ);
    if (r && r.ok) this._alert('autoBan', { championId: champ });
  }

  async _maybePrepick() {
    const cs = this.s.champSelect;
    const want = this.settings.prePick && this.settings.prePick.championId;
    if (this._prepickDone || !cs || !want || !cs.myPickAction || cs.myPickAction.completed) return;
    // Planificación: se muestra a tu equipo lo que querés jugar (como cuando lo marcás en el cliente antes de los baneos).
    if (cs.phase === 'PLANNING') {
      if (!this._intentDone && !cs.myPickAction.championId && (!cs.pickable.length || cs.pickable.includes(want))) {
        this._intentDone = true;
        await this.lcu.request('PATCH', `/lol-champ-select/v1/session/actions/${cs.myPickAction.id}`, { championId: want });
      }
      return;
    }
    // Nunca se marca mientras haya baneos pendientes ni durante tu turno de ban: evita que se banee tu propio pick.
    if (!cs.bansDone || (cs.myTurn && cs.myTurn.type === 'ban')) return;
    if (!cs.pickable.length) return; // todavía no hay lista, reintenta luego
    if (cs.pickable.includes(want)) {
      this._prepickDone = true;
      await this.lcu.request('PATCH', `/lol-champ-select/v1/session/actions/${cs.myPickAction.id}`, { championId: want });
      return;
    }
    // Solo se avisa si de verdad está baneado; si no, la lista del cliente puede estar incompleta todavía y se reintenta.
    const banned = [...((cs.bans && cs.bans.my) || []), ...((cs.bans && cs.bans.their) || [])].map(Number);
    if (cs.hasBans && !banned.includes(Number(want))) {
      this._prepickTries = (this._prepickTries || 0) + 1;
      if (this._prepickTries < 6) return;
    }
    this._prepickDone = true;
    this._alert('prepickFailed', { championId: want });
  }

  async hoverChampion(championId) {
    const cs = this.s.champSelect;
    championId = Number(championId);
    if (!cs || !championId) return { ok: false };
    let action = cs.myTurn;
    if (!action) {
      if (!cs.myPickAction || cs.myPickAction.completed) return { ok: false, error: 'noaction' };
      if (!cs.bansDone) return { ok: false, error: 'bansfirst' }; // no se puede marcar un pick mientras se banea
      action = cs.myPickAction;
    }
    if (action.type === 'pick' && (cs.banned || []).includes(championId)) return { ok: false, error: 'banned' };
    if (action.type === 'ban') this._userBanChoice = championId;
    const r = await this.lcu.request('PATCH', `/lol-champ-select/v1/session/actions/${action.id}`, { championId });
    return { ok: r.status >= 200 && r.status < 300, error: r.status >= 300 ? 'rejected' : undefined };
  }

  async lockIn(championId) {
    const cs = this.s.champSelect;
    if (!cs || !cs.myTurn) return { ok: false, error: 'notyourturn' };
    const id = cs.myTurn.id;
    const champ = Number(championId);
    if (!champ) return { ok: false, error: 'nochamp' }; // nunca se usa un campeón que no elegiste vos en esta pantalla
    if (cs.myTurn.type === 'pick' && (cs.banned || []).includes(champ)) return { ok: false, error: 'banned' };
    if (cs.myTurn.type === 'ban') this._userBanChoice = champ;
    const r = await this.lcu.request('PATCH', `/lol-champ-select/v1/session/actions/${id}`, { championId: champ, completed: true });
    return { ok: r.status >= 200 && r.status < 300 };
  }

  async setSpells(spell1Id, spell2Id) {
    const body = {};
    if (spell1Id) body.spell1Id = Number(spell1Id);
    if (spell2Id) body.spell2Id = Number(spell2Id);
    const r = await this.lcu.request('PATCH', '/lol-champ-select/v1/session/my-selection', body);
    return { ok: r.status >= 200 && r.status < 300 };
  }

  setPreBan(championId) {
    this.settings.preBan.championId = championId ? Number(championId) : null;
    this._prebanTurn = null;
    this.store.save();
    this._emitState();
  }

  // Campeones que odiás (hasta 5). autoBan: si llegás al final de tu ban sin banear, se banea el primero disponible.
  setHates(patch) {
    const pb = this.settings.preBan;
    if (Array.isArray(patch.ids)) pb.hates = [...new Set(patch.ids.map(Number).filter((x) => x > 0))].slice(0, 5);
    if (patch.autoBan !== undefined) pb.autoBan = !!patch.autoBan;
    this._prebanTurn = null;
    this.store.save();
    this._emitState();
  }

  setPrePick(championId) {
    this.settings.prePick.championId = championId ? Number(championId) : null;
    this.store.save();
    this._emitState();
  }

  // ---------- favoritos y pick automático ----------
  setFavorites(patch) {
    const f = this.settings.favorites || (this.settings.favorites = { ids: [], autoPick: false, useHistory: false });
    patch = patch || {};
    if (Array.isArray(patch.ids)) f.ids = [...new Set(patch.ids.map(Number).filter((x) => x > 0))].slice(0, 3);
    if (patch.autoPick !== undefined) f.autoPick = !!patch.autoPick;
    if (patch.useHistory !== undefined) f.useHistory = !!patch.useHistory;
    if (patch.when === 'start' || patch.when === 'end') f.when = patch.when;
    if (patch.autoRunes !== undefined) f.autoRunes = !!patch.autoRunes;
    if (patch.runePageId !== undefined) f.runePageId = Number(patch.runePageId) || 0;
    if (patch.autoSpells !== undefined) { f.autoSpells = !!patch.autoSpells; if (f.autoSpells && this.s.phase === 'ChampSelect') this._loadHistory(); }
    if (Array.isArray(patch.rules)) f.rules = cleanRules(patch.rules);
    if (patch.runeSet && Number(patch.runeSet.championId) > 0) {
      // Guarda (o borra, con page null) el set de runas de un campeón.
      const sets = Object.assign({}, f.runeSets || {});
      const k = String(Number(patch.runeSet.championId));
      const pg = cleanRunePage(patch.runeSet.page);
      if (pg) sets[k] = pg; else delete sets[k];
      if (Object.keys(sets).length <= 300) f.runeSets = sets;
    }
    if (patch.spellSet && Number(patch.spellSet.championId) > 0) {
      // Hechizos fijos de un campeón (o null para borrarlos).
      const sets = Object.assign({}, f.spellSets || {});
      const k = String(Number(patch.spellSet.championId));
      const ids = [...new Set((Array.isArray(patch.spellSet.ids) ? patch.spellSet.ids : []).map(Number).filter((x) => SPELL_IDS.includes(x)))].slice(0, 2);
      if (ids.length) sets[k] = ids; else delete sets[k];
      if (Object.keys(sets).length <= 300) f.spellSets = sets;
    }
    this.settings.favorites = f;
    this.store.save();
    if (f.useHistory && this.s.phase === 'ChampSelect') this._loadHistory();
    if (this.s.champSelect) {
      const me = (this.s.champSelect.myTeam || []).find((p) => p.isMe);
      this.s.champSelect.recommend = this._recommendFor(me ? { assignedPosition: me.position } : null);
      this._previewAutoPick();
      this._scheduleAutoPick();
    }
    this._emitState();
  }

  // Lee tus últimas partidas (y tu maestría) para saber con qué campeones te va mejor en cada línea.
  async _loadHistory() {
    const f = this.settings.favorites || {};
    if (!f.useHistory && !f.autoSpells) return;
    if (this._hist && Date.now() - this._hist.at < 10 * 60 * 1000) return;
    if (this._histBusy) return;
    this._histBusy = true;
    try {
      const stats = new Map(); // championId -> { all: {g, w}, top: {g, w}, ... }
      const add = (champ, pos, win, sp) => {
        if (!champ) return;
        if (!stats.has(champ)) stats.set(champ, { all: { g: 0, w: 0 }, spells: {} });
        const e = stats.get(champ);
        e.all.g++; if (win) e.all.w++;
        if (pos) { e[pos] = e[pos] || { g: 0, w: 0 }; e[pos].g++; if (win) e[pos].w++; }
        if (sp && sp[0] && sp[1]) { const k = (pos || 'any') + ':' + sp.slice().sort((a, b) => a - b).join('-'); e.spells[k] = (e.spells[k] || 0) + 1; }
      };
      let games = 0;
      for (let beg = 0; beg < 100; beg += 20) {
        const r = await this.lcu.request('GET', `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=${beg}&endIndex=${beg + 20}`);
        const list = r.status === 200 && r.data && r.data.games && Array.isArray(r.data.games.games) ? r.data.games.games : null;
        if (!list || !list.length) break;
        for (const g of list) {
          if (!g || (g.gameMode && g.gameMode !== 'CLASSIC')) continue; // solo la Grieta (las líneas no aplican en ARAM)
          const me = (g.participants || [])[0];
          if (!me) continue;
          add(Number(me.championId), histPos(me.timeline || {}), !!(me.stats && me.stats.win), [Number(me.spell1Id) || 0, Number(me.spell2Id) || 0]);
          games++;
        }
        if (list.length < 20) break;
      }
      const mastery = new Map();
      const m = await this.lcu.request('GET', '/lol-champion-mastery/v1/local-player/champion-mastery');
      if (m.status === 200 && Array.isArray(m.data)) m.data.forEach((x) => { if (x && x.championId) mastery.set(Number(x.championId), Number(x.championPoints) || 0); });
      this._hist = { at: Date.now(), stats, mastery, games };
      if (this._diag) this._diag.history = { games, champs: stats.size, mastery: mastery.size };
      if (this.s.champSelect) {
        const me = (this.s.champSelect.myTeam || []).find((p) => p.isMe);
        this.s.champSelect.recommend = this._recommendFor(me ? { assignedPosition: me.position } : null);
        this._emitState();
      }
    } catch (_) {
    } finally { this._histBusy = false; }
  }

  // Puntaje de un campeón tuyo para una línea: rinde más ganar seguido y tener varias partidas en esa línea.
  _champScore(champ, pos) {
    const h = this._hist;
    if (!h) return 0;
    const e = h.stats.get(Number(champ));
    const p = e && pos && e[pos];
    const a = e && e.all;
    let sc = 0;
    if (p && p.g) sc += ((p.w + 2) / (p.g + 4)) + Math.min(p.g, 15) * 0.03 + 0.5; // jugado en esta línea: va primero
    else if (a && a.g) sc += ((a.w + 2) / (a.g + 4)) * 0.6 + Math.min(a.g, 15) * 0.01;
    const mp = h.mastery.get(Number(champ)) || 0;
    sc += Math.min(mp, 300000) / 300000 * 0.15;
    return sc;
  }

  _recommendFor(cell) {
    const f = this.settings.favorites || {};
    if (!f.useHistory || !this._hist) return [];
    const pos = normPos(cell && cell.assignedPosition);
    const owned = new Set(this.s.owned || []);
    const cands = [...new Set([...this._hist.stats.keys(), ...this._hist.mastery.keys()])].filter((c) => !owned.size || owned.has(c));
    return cands.map((c) => {
      const e = this._hist.stats.get(c) || { all: { g: 0, w: 0 } };
      const p = (pos && e[pos]) || null;
      return { championId: c, score: this._champScore(c, pos), games: p ? p.g : 0, wins: p ? p.w : 0, gamesAll: e.all.g, winsAll: e.all.w };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  }

  // Orden de campeones a probar si se te acaba el tiempo: lo que tenías marcado, tus favoritos y, si lo activaste, tus mejores según tus partidas.
  _autoPickCandidates() {
    const cs = this.s.champSelect;
    const f = this.settings.favorites || {};
    const me = (cs.myTeam || []).find((p) => p.isMe) || {};
    const pos = normPos(me.position);
    const out = [];
    const pre = Number(this.settings.prePick && this.settings.prePick.championId) || 0;
    // 1) lo que marcaste vos a mano, 2) tus reglas (en tu orden), 3) tu pick preparado, 4) tus favoritos, 5) tus mejores según tus partidas.
    const hover = Number((cs.myTurn && cs.myTurn.championId) || me.championId || me.intent) || 0;
    if (this._manualHover()) out.push(hover); // si lo marcó la app por tu pick preparado, va después de las reglas
    out.push(...this._rulePicks().map((x) => x.championId));
    if (hover) out.push(hover);
    if (pre) out.push(pre);
    let favs = (f.ids || []).slice();
    if (f.useHistory && this._hist) favs = favs.map((c, i) => ({ c, i, s: this._champScore(c, pos) })).sort((a, b) => (b.s - a.s) || (a.i - b.i)).map((x) => x.c);
    out.push(...favs);
    if (f.useHistory) out.push(...(cs.recommend || []).map((x) => x.championId));
    return [...new Set(out.map(Number).filter(Boolean))];
  }

  // Reglas: "si el rival tiene X (y juego tal línea), elegí A, B o C; salteá A si además tienen Y".
  // Solo se ven los campeones rivales ya mostrados por el cliente (en draft, los confirmados).
  _ruleCtx() {
    const cs = this.s.champSelect;
    const me = (cs.myTeam || []).find((p) => p.isMe) || {};
    // Aliados: lo confirmado o lo que tienen marcado (el cliente muestra la intención de tu equipo). Rivales: solo lo que ya se ve.
    const allies = (cs.myTeam || []).filter((p) => !p.isMe).map((p) => Number(p.championId || p.intent)).filter((x) => x > 0);
    const enemies = (cs.theirTeam || []).map((p) => Number(p.championId)).filter((x) => x > 0);
    const info = cs.info || {};
    return { pos: normPos(me.position), allies, enemies, enemySet: new Set(enemies), order: info.allyPickNumber || 0, orderTotal: info.allyPickTotal || 0 };
  }

  _condOk(c, x) {
    if (!c) return true;
    if (c.t === 'ally') return !c.champs.length || c.champs.some((k) => x.allies.includes(k));
    if (c.t === 'enemy') return !c.champs.length || c.champs.some((k) => x.enemySet.has(k));
    if (c.t === 'order') return c.v === 'last' ? (x.order > 0 && x.order === x.orderTotal) : x.order === Number(c.v);
    if (c.t === 'count') {
      const list = c.team === 'enemy' ? x.enemies : x.allies;
      const n = list.filter((k) => this._champHas(k, c.attr)).length;
      return c.op === 'le' ? n <= c.n : c.op === 'eq' ? n === c.n : n >= c.n;
    }
    return true;
  }

  _ruleApplies(r, x) {
    if (!r || r.off) return false;
    if (r.lane && r.lane !== x.pos) return false;
    if ((r.vs || []).length && !r.vs.some((c) => x.enemySet.has(Number(c)))) return false;
    return (r.conds || []).every((c) => this._condOk(c, x));
  }

  // Tu pool para opciones del tipo "mi mejor mago": favoritos, después tus mejores según partidas y tu maestría.
  _myPool() {
    const f = this.settings.favorites || {};
    const out = [...(f.ids || [])];
    const cs = this.s.champSelect;
    if (cs && cs.recommend) out.push(...cs.recommend.map((r) => r.championId));
    if (this._hist) out.push(...[...this._hist.mastery.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]));
    return [...new Set(out.map(Number).filter(Boolean))];
  }

  // Reglas: "si el rival tiene X (y juego tal línea, y se cumplen estas condiciones), elegí A, B o C; salteá A si además tienen Y".
  // Solo se ven los campeones rivales ya mostrados por el cliente (en draft, los confirmados).
  _rulePicks() {
    const cs = this.s.champSelect;
    const rules = ((this.settings.favorites || {}).rules) || [];
    if (!cs || !rules.length) return [];
    const x = this._ruleCtx();
    const out = [];
    rules.forEach((r, i) => {
      if ((r && r.kind) === 'block' || !this._ruleApplies(r, x)) return;
      (r.picks || []).forEach((pk) => {
        if ((pk.avoid || []).some((c) => x.enemySet.has(Number(c)))) return;
        if (pk.c) out.push({ championId: Number(pk.c), rule: i });
        else if (pk.attr) this._myPool().filter((c) => this._champHas(c, pk.attr)).forEach((c) => out.push({ championId: c, rule: i }));
      });
    });
    return out;
  }

  // Reglas de bloqueo: "no elegir magos si mi equipo ya tiene 2". Devuelve una función que dice si un campeón queda bloqueado.
  _blockedBy() {
    const cs = this.s.champSelect;
    const rules = ((this.settings.favorites || {}).rules) || [];
    if (!cs) return () => -1;
    const x = this._ruleCtx();
    const act = rules.map((r, i) => ((r && r.kind) === 'block' && this._ruleApplies(r, x) ? { r, i } : null)).filter(Boolean);
    return (c) => {
      const hit = act.find(({ r }) => (r.block.champs || []).includes(c) || (r.block.attr && this._champHas(c, r.block.attr)));
      return hit ? hit.i : -1;
    };
  }

  // ---------- datos de campeones para las reglas ----------
  // Clases (Tanque, Mago...), cuerpo a cuerpo / a distancia y tipo de daño. Fuente: Data Dragon (los datos públicos de Riot);
  // si no hay internet, las clases salen del propio cliente (sin melee/distancia ni tipo de daño).
  async _loadChampInfo() {
    if (this._cinfo || this._cinfoBusy) return;
    this._cinfoBusy = true;
    const map = new Map();
    try {
      const r = await this.lcu.request('GET', '/lol-game-data/assets/v1/champion-summary.json');
      if (r.status === 200 && Array.isArray(r.data)) r.data.forEach((c) => { if (c && c.id > 0) map.set(Number(c.id), { name: c.name || '', tags: (c.roles || []).map((x) => String(x).toLowerCase()), melee: null, dmg: null }); });
    } catch (_) {}
    try {
      if (typeof fetch === 'function' && !process.env.OQ_NO_DDRAGON) {
        const v = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0];
        const d = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/champion.json`)).json();
        Object.values(d.data || {}).forEach((c) => {
          const k = Number(c.key); const prev = map.get(k) || {};
          const range = c.stats && Number(c.stats.attackrange);
          const inf = c.info || {};
          map.set(k, {
            tags: (c.tags || []).map((x) => String(x).toLowerCase()).concat(prev.tags || []),
            melee: range ? range <= 250 : null,
            dmg: inf.magic != null && inf.attack != null ? (inf.magic > inf.attack ? 'ap' : 'ad') : null,
          });
        });
      }
    } catch (_) {}
    if (map.size) this._cinfo = map;
    this._cinfoBusy = false;
    if (this._diag) this._diag.champInfo = { size: map.size, withRange: [...map.values()].filter((v) => v.melee !== null).length };
  }

  _champHas(c, attr) {
    const v = this._cinfo && this._cinfo.get(Number(c));
    if (!v || !attr) return false;
    if (attr === 'melee') return v.melee === true;
    if (attr === 'ranged') return v.melee === false;
    if (attr === 'ap' || attr === 'ad') return v.dmg === attr;
    return v.tags.includes(attr);
  }

  // Campeón que marcaste vos a mano (no el que marcó la app por tu pick preparado). Ese se respeta siempre.
  _manualHover() {
    const cs = this.s.champSelect;
    const me = (cs.myTeam || []).find((p) => p.isMe) || {};
    const pre = Number(this.settings.prePick && this.settings.prePick.championId) || 0;
    const hover = Number((cs.myTurn && cs.myTurn.championId) || me.championId || me.intent) || 0;
    return hover && hover !== pre ? hover : 0;
  }

  // Qué elegiría el pick automático ahora mismo (para mostrarlo en el champ select).
  _previewAutoPick() {
    const cs = this.s.champSelect;
    const f = this.settings.favorites || {};
    if (!cs || !f.autoPick || !cs.myPickAction || cs.myPickAction.completed) { if (cs) cs.autoPickNext = null; return; }
    const pickable = new Set((cs.pickable || []).map(Number));
    const taken = new Set([...(cs.myTeam || []), ...(cs.theirTeam || [])].filter((x) => !x.isMe && x.championId).map((x) => Number(x.championId)));
    const banned = new Set((cs.banned || []).map(Number));
    const blocked = this._blockedBy(); const manual = this._manualHover();
    const c = this._autoPickCandidates().find((x) => (!pickable.size || pickable.has(x)) && !taken.has(x) && !banned.has(x) && (x === manual || blocked(x) < 0));
    const rp = c ? this._rulePicks().find((x) => x.championId === c) : null;
    cs.autoPickNext = c ? { championId: c, rule: rp ? rp.rule : -1 } : null;
  }

  // Después del pick automático: hechizos y runas según la regla que eligió el campeón, o los recomendados si los activaste.
  async _autoLoadout(champ, ruleIdx, log) {
    const f = this.settings.favorites || {};
    const r = ruleIdx >= 0 ? ((f.rules || [])[ruleIdx] || {}) : {};
    // Hechizos: los fijos del campeón, si no los de la regla, si no los recomendados (si los activaste).
    const own = (f.spellSets || {})[String(Number(champ))];
    let spells = Array.isArray(own) && own.length ? own : Array.isArray(r.spells) && r.spells.filter(Boolean).length ? r.spells.filter(Boolean) : null;
    let src = spells ? (spells === own ? 'champ' : 'rule') : '';
    if (!spells && f.autoSpells) { spells = this._recommendedSpells(champ); src = 'rec'; }
    if (spells) {
      const res = await this._applySpells(spells);
      if (log) log.spells = { src, ids: res.ids, ok: res.ok };
      this._alert(res.ok ? 'autoSpells' : 'autoSpellsFailed', { ids: res.ids });
    }
    if (r.runes === 'rec') return this._autoRunes(champ, log);
    if (Number(r.runes) > 0) {
      const ok = (await this.selectRunePage(Number(r.runes))) || {};
      if (log) log.runes = { page: Number(r.runes), ok: !!ok.ok };
      this._alert(ok.ok ? 'autoRunes' : 'autoRunesFailed', { name: ((this.s.runes.pages || []).find((p) => p.id === Number(r.runes)) || {}).name || '' });
      return;
    }
    // Set de runas que armaste para ese campeón (sirve en todas tus reglas).
    const set = (f.runeSets || {})[String(Number(champ))];
    if (set) return this._autoRunes(champ, log, set);
    if (f.autoRunes) return this._autoRunes(champ, log);
  }

  // Hechizos recomendados: los que más usaste vos con ese campeón en esa línea (tus partidas); si no hay datos, unos típicos de la línea.
  _recommendedSpells(champ) {
    const cs = this.s.champSelect || {};
    const me = (cs.myTeam || []).find((p) => p.isMe) || {};
    const pos = normPos(me.position);
    const e = this._hist && this._hist.stats.get(Number(champ));
    if (e && e.spells) {
      const best = Object.entries(e.spells).filter(([k]) => k.startsWith((pos || 'any') + ':')).sort((a, b) => b[1] - a[1])[0]
        || (!pos ? null : Object.entries(e.spells).sort((a, b) => b[1] - a[1])[0]);
      if (best) return best[0].split(':')[1].split('-').map(Number);
    }
    const has = (a) => this._champHas(champ, a);
    if (pos === 'jungle') return [4, 11];
    if (pos === 'top') return [4, 12];
    if (pos === 'middle') return [4, has('assassin') ? 14 : 12];
    if (pos === 'bottom') return [4, has('marksman') ? 7 : 21];
    if (pos === 'utility') return [4, has('tank') || has('fighter') ? 14 : 3];
    return [4, 14];
  }

  // Aplica 2 hechizos respetando dónde tenés Destello (D o F) y que en la jungla Aplastar no se puede sacar.
  async _applySpells(want) {
    const cs = this.s.champSelect || {};
    const me = (cs.myTeam || []).find((p) => p.isMe) || {};
    let ids = [...new Set(want.map(Number).filter((x) => x > 0))].slice(0, 2);
    if (normPos(me.position) === 'jungle') ids = [11].concat(ids.filter((x) => x !== 11)).slice(0, 2); // Aplastar es obligatorio en la jungla
    if (ids.length < 2) { const keep = [me.spell1Id, me.spell2Id].map(Number).find((x) => x && !ids.includes(x)); if (keep) ids.push(keep); }
    if (ids.length < 2) return { ok: false, ids };
    let [a, b] = ids;
    // Mantener cada hechizo en la tecla donde ya lo tenías (por ejemplo, Destello en la F).
    if (Number(me.spell1Id) === b || Number(me.spell2Id) === a) [a, b] = [b, a];
    const res = await this.setSpells(a, b);
    return { ok: !!res.ok, ids: [a, b] };
  }

  // Runas automáticas: después del pick automático se aplica la primera página recomendada por el propio cliente
  // para ese campeón y tu línea (las mismas que ves en "Runas recomendadas"). Va sobre la página temporal del cliente.
  // own: un set de runas armado por vos (en las reglas); si no, la primera recomendada por el cliente.
  async _autoRunes(championId, log, own) {
    try {
      const cs = this.s.champSelect;
      if (!cs || cs.benchEnabled || [2400, 3270].includes(Number(cs.queueId)) || cs.subsetPicks || this.s.gameMode === 'KIWI') return; // modos sin runas
      const me = (cs.myTeam || []).find((p) => p.isMe) || {};
      let page = null;
      if (own) page = Object.assign({ name: 'Open Queue' }, own);
      else {
        const d = await this.runeData(championId, normPos(me.position));
        page = d && d.ok && d.recommended && d.recommended[0];
      }
      if (log) log.runes = page ? { name: page.name, primary: page.primaryStyleId, own: !!own } : 'none';
      if (!page) { this._alert('autoRunesFailed'); return; }
      const pos = normPos(me.position) || 'none';
      // Primero solo en la página temporal del cliente (no ocupa tus páginas).
      let r = await this.useRunes(page, championId, { tempOnly: true });
      if (log) log.runesSteps = [['use', r && (r.ok ? 'ok' : r.error)]];
      if (r && r.error === 'noTemp') {
        // Sin página temporal y con tus páginas llenas: se le pide al cliente que cree su página temporal recomendada (como hace él al elegir una recomendada).
        const rq = await this.lcu.request('POST', `/lol-perks/v1/recommended-pages-position/champion/${Number(championId)}/position/${pos}`);
        let temp = null;
        for (let i = 0; i < 5 && !temp && rq.status < 300; i++) {
          await new Promise((res) => setTimeout(res, 400));
          await this._refreshRunes();
          temp = this.s.runes.pages.find((p) => p.temp);
        }
        if (log) log.runesSteps.push(['temp', rq.status, !!temp]);
        if (temp) { r = await this.useRunes(page, championId, { tempOnly: true }); if (log) log.runesSteps.push(['use2', r && (r.ok ? 'ok' : r.error)]); }
        // Si el cliente no dio página temporal: tu página "Open Queue" (o una nueva si hay lugar).
        if (!r || !r.ok) { r = await this.useRunes(page, championId); if (log) log.runesSteps.push(['own', r && (r.ok ? 'ok' : r.error)]); }
      }
      const spare = Number((this.settings.favorites || {}).runePageId) || 0;
      if (r && r.error === 'full' && spare) {
        // La página que elegiste en Ajustes para que la app pueda usar cuando no hay lugar.
        r = await this.saveRunes(page, spare);
        if (log) log.runesSteps.push(['spare', r && (r.ok ? 'ok' : r.error)]);
      }
      if (log) log.runesOk = !!(r && r.ok);
      if (r && r.error === 'full') { this._alert('autoRunesNoSlot'); return; }
      this._alert(r && r.ok ? 'autoRunes' : 'autoRunesFailed', { name: page.name || '' });
    } catch (_) { this._alert('autoRunesFailed'); }
  }

  _scheduleAutoPick() {
    clearTimeout(this._autoPickTimer);
    const cs = this.s.champSelect;
    const f = this.settings.favorites || {};
    if (!cs || !f.autoPick || !cs.myTurn || cs.myTurn.type !== 'pick' || cs.benchEnabled) return;
    if (this._autoPickTurn === cs.myTurn.id) return;
    const turnId = cs.myTurn.id;
    let wait;
    if (f.when === 'start') {
      // Apenas te toca: se espera un instante para que llegue tu pick preparado (si tenés uno) y se confirma.
      if (this._autoPickStartFor !== turnId) { this._autoPickStartFor = turnId; this._autoPickStartAt = Date.now() + AUTO_PICK_START_DELAY_MS; }
      wait = Math.max(0, this._autoPickStartAt - Date.now());
    } else {
      // Sin reloj (por ejemplo la herramienta de práctica) no hay "segundo 0": no se elige nada.
      if (cs.isInfinite || cs.timeLeftMs == null) return;
      // Se dispara en el último segundo (cuando el reloj llega a 0), con un pequeño margen para que el cliente lo reciba a tiempo.
      wait = Math.max(0, cs.timeLeftMs - (cs.at ? Date.now() - cs.at : 0) - AUTO_PICK_MARGIN_MS);
    }
    this._autoPickTimer = setTimeout(() => this._autoPick(turnId), wait);
  }

  async _autoPick(turnId) {
    const cs = this.s.champSelect;
    if (!cs || !cs.myTurn || cs.myTurn.id !== turnId || cs.myTurn.type !== 'pick' || this._autoPickTurn === turnId) return;
    this._autoPickTurn = turnId;
    const p = await this.lcu.request('GET', '/lol-champ-select/v1/pickable-champion-ids');
    const pickable = new Set(Array.isArray(p.data) && p.data.length ? p.data.map(Number) : (cs.pickable || []).map(Number));
    const taken = new Set([...(cs.myTeam || []), ...(cs.theirTeam || [])].filter((x) => !x.isMe && x.championId).map((x) => Number(x.championId)));
    const banned = new Set((cs.banned || []).map(Number));
    const cands = this._autoPickCandidates();
    const blocked = this._blockedBy(); const manual = this._manualHover();
    // Si la lista del cliente viene vacía (pasa en algunas partidas personalizadas) no se descarta a nadie por eso.
    const pick = cands.find((c) => (!pickable.size || pickable.has(c)) && !taken.has(c) && !banned.has(c) && (c === manual || blocked(c) < 0));
    const rp = pick ? this._rulePicks().find((x) => x.championId === pick) : null;
    const log = { rule: rp ? rp.rule : -1, t: Date.now(), when: (this.settings.favorites || {}).when || 'end', turnId, cands, pickableSize: pickable.size, hover: cs.myTurn.championId || 0, prePick: (this.settings.prePick || {}).championId || 0, pick: pick || 0 };
    if (this._diag) (this._diag.autoPick = this._diag.autoPick || []).push(log);
    if (!pick) { this._alert('autoPickFailed'); return; }
    let r = await this.lcu.request('PATCH', `/lol-champ-select/v1/session/actions/${turnId}`, { championId: pick, completed: true });
    if (r.status >= 300) {
      // Otra forma que aceptan algunos clientes: marcar y después confirmar.
      await this.lcu.request('PATCH', `/lol-champ-select/v1/session/actions/${turnId}`, { championId: pick });
      r = await this.lcu.request('POST', `/lol-champ-select/v1/session/actions/${turnId}/complete`);
    }
    log.status = r.status;
    if (r.status >= 200 && r.status < 300) {
      this._alert('autoPicked', { championId: pick });
      this._autoLoadout(pick, rp ? rp.rule : -1, log);
    } else this._alert('autoPickFailed');
  }

  // ---------- runas ----------
  async _refreshRunes() {
    const [pages, cur] = await Promise.all([
      this.lcu.request('GET', '/lol-perks/v1/pages'),
      this.lcu.request('GET', '/lol-perks/v1/currentpage'),
    ]);
    const list = Array.isArray(pages.data) ? pages.data : [];
    this.s.runes = {
      pages: list.filter((p) => p.isEditable !== false || p.isValid).map((p) => ({
        id: p.id, name: p.name, isValid: p.isValid !== false,
        // el cliente guarda las recomendadas (y las de Swiftplay) como páginas temporales
        temp: !!p.isTemporary, recChamp: p.recommendationChampionId || 0, recIndex: typeof p.recommendationIndex === 'number' ? p.recommendationIndex : -1,
        primaryStyleId: p.primaryStyleId, subStyleId: p.subStyleId, selectedPerkIds: Array.isArray(p.selectedPerkIds) ? p.selectedPerkIds : [],
      })),
      currentId: cur.status === 200 && cur.data ? cur.data.id : null,
      canAdd: true,
    };
    const inv = await this.lcu.request('GET', '/lol-perks/v1/inventory');
    if (inv.status === 200 && inv.data && typeof inv.data.canAddCustomPage === 'boolean') this.s.runes.canAdd = inv.data.canAddCustomPage;
  }

  async selectRunePage(id) {
    const r = await this.lcu.request('PUT', '/lol-perks/v1/currentpage', Number(id));
    await this._refreshRunes();
    this._emitState();
    return { ok: r.status >= 200 && r.status < 300 };
  }

  // Runas vigentes según Data Dragon: el cliente todavía lista runas viejas que ya no se pueden usar (el juego rechaza la página).
  async _loadValidPerks() {
    if (this._validPerks !== undefined) return this._validPerks;
    this._validPerks = null;
    try {
      const vers = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
      const tree = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${vers[0]}/data/en_US/runesReforged.json`)).json();
      const set = new Set();
      tree.forEach((st) => (st.slots || []).forEach((sl) => (sl.runes || []).forEach((r) => set.add(Number(r.id)))));
      if (set.size > 30) this._validPerks = set;
    } catch (_) { /* sin internet: no se filtra */ }
    return this._validPerks;
  }

  // El esquema de las recomendadas varía según el cliente: se lee de forma tolerante y se completan los estilos desde los ids.
  _normRec(p) {
    if (!p || typeof p !== 'object') return null;
    let ids = p.selectedPerkIds || p.perkIds || p.perks || p.runes || p.selectedPerks;
    if (!Array.isArray(ids)) return null;
    ids = ids.map((x) => Number(x && typeof x === 'object' ? (x.id || x.perkId) : x)).filter((n) => n > 0);
    if (ids.length !== 9) return null;
    const styleOfPerk = (id) => {
      const st = this._styles && this._styles.styles.find((z) => z.slots.some((sl) => sl.perks.includes(id)));
      return st ? st.id : 0;
    };
    const num = (v) => Number(v && typeof v === 'object' ? v.id : v) || 0;
    const primary = num(p.primaryStyleId || p.primaryPerkStyleId || p.primaryStyle || p.primaryPathId) || styleOfPerk(ids[0]);
    const sub = num(p.subStyleId || p.secondaryStyleId || p.subStyle || p.secondaryPerkStyleId || p.secondaryPathId) || styleOfPerk(ids[4]);
    if (!primary || !sub) return null;
    return { name: String(p.name || p.title || ''), primaryStyleId: primary, subStyleId: sub, selectedPerkIds: ids };
  }

  // Datos para el editor de runas y las runas recomendadas por el juego.
  // ---------- emotes y ward (loadout de la cuenta) ----------
  async _loadout() {
    const r = await this.lcu.request('GET', '/lol-loadouts/v4/loadouts/scope/account');
    const list = r.status === 200 && Array.isArray(r.data) ? r.data : [];
    return list.find((x) => x && x.loadout && x.loadout.EMOTES_WHEEL_CENTER) || list[0] || null;
  }

  async cosmeticsData() {
    const L = await this._loadout();
    if (!L) return { ok: false, error: 'noLoadout' };
    const slots = {};
    for (const k of EMOTE_SLOTS) slots[k] = L.loadout[k] ? L.loadout[k].itemId : null;
    const ward = L.loadout.WARD_SKIN_SLOT ? L.loadout.WARD_SKIN_SLOT.itemId : null;
    const get = async (path) => { const r = await this.lcu.request('GET', path); return r.status === 200 ? r.data : null; };
    const [emInv, wardInv1, emCat, wardCat] = await Promise.all([
      get('/lol-inventory/v2/inventory/EMOTE'),
      get('/lol-inventory/v2/inventory/WARD_SKIN'),
      get('/lol-game-data/assets/v1/summoner-emotes.json'),
      get('/lol-game-data/assets/v1/ward-skins.json'),
    ]);
    let wardInv = wardInv1;
    if (!Array.isArray(wardInv) && this._mySummonerId) wardInv = await get(`/lol-collections/v1/inventories/${this._mySummonerId}/ward-skins`);
    const path = (v) => (v && String(v).startsWith('/lol-game-data/assets/') ? '/lcu-asset' + v : '');
    const catalog = (arr, iconKeys) => {
      const m = new Map();
      (Array.isArray(arr) ? arr : Object.values(arr || {})).forEach((x) => {
        if (!x || x.id === undefined) return;
        let icon = '';
        for (const k of iconKeys) if (x[k]) { icon = path(x[k]); if (icon) break; }
        m.set(Number(x.id), { name: x.name || '', icon });
      });
      return m;
    };
    const ec = catalog(emCat, ['inventoryIcon', 'iconPath', 'imagePath']);
    const wc = catalog(wardCat, ['wardImagePath', 'inventoryIcon', 'iconPath']);
    const idsOf = (inv) => (Array.isArray(inv) ? inv.map((x) => Number(x.itemId !== undefined ? x.itemId : x.id)).filter((x) => x > 0) : []);
    const item = (id, cat) => ({ id, name: (cat.get(id) || {}).name || `#${id}`, icon: (cat.get(id) || {}).icon || '' });
    const ownedEmotes = [...new Set(idsOf(emInv).concat(Object.values(slots).filter(Boolean)))].map((i) => item(i, ec));
    const ownedWards = [...new Set(idsOf(wardInv).concat(ward ? [ward] : []))].map((i) => item(i, wc));
    if (this._diag) this._diag.cosmeticsTrail = { loadoutKeys: Object.keys(L.loadout), emInv: Array.isArray(emInv) ? emInv.slice(0, 2) : emInv, wardInv: Array.isArray(wardInv) ? wardInv.slice(0, 2) : wardInv, emCat: Array.isArray(emCat) ? emCat.slice(0, 2) : (emCat ? 'obj' : null), wardCat: Array.isArray(wardCat) ? wardCat.slice(0, 2) : (wardCat ? 'obj' : null) };
    return { ok: true, slots: Object.fromEntries(EMOTE_SLOTS.map((k) => [k, slots[k] ? item(slots[k], ec) : null])), ward: ward ? item(ward, wc) : null, ownedEmotes, ownedWards };
  }

  // Cambia un espacio del loadout (rueda de emotes o ward) y verifica que quedó.
  async _setLoadoutSlot(slot, inventoryType, itemId) {
    const L = await this._loadout();
    if (!L) return { ok: false, error: 'noLoadout' };
    const val = { contentId: '', data: {}, inventoryType, itemId: Number(itemId) };
    const full = JSON.parse(JSON.stringify(L));
    full.loadout[slot] = val;
    const tries = [
      ['PUT', `/lol-loadouts/v4/loadouts/${L.id}`, full],
      ['PATCH', `/lol-loadouts/v4/loadouts/${L.id}`, { loadout: { [slot]: val } }],
      ['PATCH', `/lol-loadouts/v4/loadouts/${L.id}`, full],
    ];
    const trail = [];
    for (const [m, u, b] of tries) {
      const r = await this.lcu.request(m, u, b);
      trail.push([m, r.status]);
      const chk = await this._loadout();
      if (chk && chk.loadout[slot] && chk.loadout[slot].itemId === Number(itemId)) { if (this._diag) this._diag.cosmeticsSet = trail; return { ok: true }; }
    }
    if (this._diag) this._diag.cosmeticsSet = trail;
    return { ok: false, error: 'notapplied' };
  }

  async setEmote(slot, itemId) {
    if (!EMOTE_SLOTS.includes(slot) || !Number(itemId)) return { ok: false, error: 'bad' };
    return this._setLoadoutSlot(slot, 'EMOTE', itemId);
  }

  async setWard(itemId) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: 'bad' };
    let applied = false;
    if (this.s.phase === 'ChampSelect') {
      const r = await this.lcu.request('PATCH', '/lol-champ-select/v1/session/my-selection', { wardSkinId: itemId });
      applied = r.status >= 200 && r.status < 300;
    }
    const l = await this._setLoadoutSlot('WARD_SKIN_SLOT', 'WARD_SKIN', itemId);
    return applied || l.ok ? { ok: true } : l;
  }

  async runeData(championId, position) {
    const valid = await this._loadValidPerks();
    this._lastValidSize = valid ? valid.size : 0;
    const isOk = (id) => !valid || (id >= 5000 && id < 6000) || valid.has(Number(id)); // los fragmentos de estadística (5xxx) no están en esa lista
    if (!this._styles) {
      const [st, pk] = await Promise.all([
        this.lcu.request('GET', '/lol-perks/v1/styles'),
        this.lcu.request('GET', '/lol-perks/v1/perks'),
      ]);
      if (st.status === 200 && Array.isArray(st.data)) {
        const perkInfo = {};
        (Array.isArray(pk.data) ? pk.data : []).forEach((p) => { perkInfo[p.id] = { name: p.name, icon: p.iconPath }; });
        const styles = st.data.map((s) => ({
          id: s.id, name: s.name, icon: s.iconPath,
          slots: (s.slots || []).map((sl) => ({ type: sl.type, perks: (sl.perks || []).filter(isOk) })),
        }));
        const perks = {};
        styles.forEach((s) => s.slots.forEach((sl) => sl.perks.forEach((id) => { if (perkInfo[id]) perks[id] = perkInfo[id]; })));
        this._styles = { styles, perks };
      }
    }
    let recommended = [];
    const champ = Number(championId) || 0;
    const trail = [];
    if (champ) {
      const POS = ['top', 'jungle', 'middle', 'bottom', 'utility'];
      const pos = POS.includes(position) ? position : '';
      const mapId = this.s.champSelect && this.s.champSelect.benchEnabled ? 12 : 11;
      // 1) Las 3 recomendadas que ofrece el juego para ese campeón y línea.
      const positions = pos ? [pos, 'none'] : ['none'];
      outer: for (const ps of positions) {
        for (const m of [11, mapId === 12 ? 12 : 11].filter((v, i, a) => a.indexOf(v) === i)) {
          const r = await this.lcu.request('GET', `/lol-perks/v1/recommended-pages/champion/${champ}/position/${ps}/map/${m}`);
          trail.push(['get', ps, m, r.status, Array.isArray(r.data) ? r.data.length : -1]);
          if (Array.isArray(r.data) && r.data.length && trail.filter((x) => x[0] === 'raw').length < 2) {
            // para el diagnóstico: qué runas trae cada recomendada y cuáles se descartan por no estar vigentes
            let raw = ''; try { raw = JSON.stringify(r.data[0]).slice(0, 1500); } catch (_) {}
            trail.push(['raw', ps, m, raw]);
          }
          if (r.status === 200 && Array.isArray(r.data) && r.data.length) {
            recommended = r.data.map((p) => this._normRec(p)).filter((p) => p && p.selectedPerkIds.every(isOk)).slice(0, 3);
            if (recommended.length) break outer;
          }
        }
      }
      // 2) Complemento: páginas temporales que el cliente ya generó para este campeón (si faltan o el endpoint no devolvió nada).
      await this._refreshRunes();
      const temps = this.s.runes.pages.filter((p) => p.temp && p.recChamp === champ && p.selectedPerkIds.length === 9 && p.selectedPerkIds.every(isOk))
        .sort((a, b) => (b.recIndex >= 0) - (a.recIndex >= 0) || a.recIndex - b.recIndex);
      trail.push(['temps', temps.length]);
      const key = (x) => JSON.stringify(x.selectedPerkIds);
      for (const tp of temps) {
        if (recommended.length >= 3) break;
        const dup = recommended.find((x) => key(x) === key(tp));
        if (dup) { dup.id = tp.id; continue; }
        recommended.push({ id: tp.id, name: tp.name, primaryStyleId: tp.primaryStyleId, subStyleId: tp.subStyleId, selectedPerkIds: tp.selectedPerkIds });
      }
      // 3) Última opción: pedirle al cliente que las genere.
      if (!recommended.length) {
        const ps = pos || 'none';
        const rq = await this.lcu.request('POST', `/lol-perks/v1/recommended-pages-position/champion/${champ}/position/${ps}`);
        trail.push(['post', ps, rq.status]);
        if (rq.status >= 200 && rq.status < 300) {
          for (let i = 0; i < 4 && !recommended.length; i++) { // el cliente tarda un momento en crear la página temporal
            await new Promise((r) => setTimeout(r, 400));
            await this._refreshRunes();
            recommended = this.s.runes.pages.filter((p) => p.temp && p.recChamp === champ && p.selectedPerkIds.length === 9 && p.selectedPerkIds.every(isOk)).slice(0, 3)
              .map((p) => ({ id: p.id, name: p.name, primaryStyleId: p.primaryStyleId, subStyleId: p.subStyleId, selectedPerkIds: p.selectedPerkIds }));
          }
        }
        trail.push(['post-pages', recommended.length, this.s.runes.pages.filter((p) => p.temp).map((p) => [p.recChamp, p.selectedPerkIds.length])]);
      }
    }
    trail.push(['validPerks', this._lastValidSize]);
    if (this._diag) this._diag.runeTrail = trail;
    this._emitState();
    if (!this._styles) return { ok: false, error: 'nostyles' };
    return { ok: true, styles: this._styles.styles, perks: this._styles.perks, recommended };
  }

  // Aplica una recomendada sin gastar una de tus páginas: reusa la página temporal del cliente (como hace el propio cliente).
  async useRunes(page, championId, opts) {
    const ids = Array.isArray(page && page.selectedPerkIds) ? page.selectedPerkIds.map(Number) : [];
    if (ids.length !== 9 || ids.some((n) => !n) || !page.primaryStyleId || !page.subStyleId) return { ok: false, error: 'invalid' };
    if (page.id) return this.selectRunePage(page.id);
    await this._refreshRunes();
    const champ = Number(championId) || 0;
    const temps = this.s.runes.pages.filter((p) => p.temp);
    const target = temps.find((p) => champ && p.recChamp === champ) || temps.find((p) => p.id === this.s.runes.currentId);
    if (target) {
      const body = { name: String(page.name || target.name || 'Open Queue').slice(0, 24), primaryStyleId: Number(page.primaryStyleId), subStyleId: Number(page.subStyleId), selectedPerkIds: ids, current: true };
      const r = await this.lcu.request('PUT', `/lol-perks/v1/pages/${target.id}`, body);
      if (r.status >= 200 && r.status < 300) {
        await this.lcu.request('PUT', '/lol-perks/v1/currentpage', Number(target.id));
        await this._refreshRunes();
        this._emitState();
        return { ok: true };
      }
      if (this._diag) this._diag.useRunesFail = { status: r.status, data: r.data, target: target.id, body };
    } else if (this._diag) this._diag.useRunesFail = { noTemp: true, pages: this.s.runes.pages, champ };
    if (opts && opts.tempOnly) return { ok: false, error: 'noTemp' };
    return this.saveRunes(Object.assign({}, page, { name: 'Open Queue' })); // sin página temporal: se guarda en una propia
  }

  // Guarda una página de runas armada por vos. Si ya tenés todas las páginas ocupadas, hay que elegir cuál reemplazar.
  async saveRunes(page, replaceId, newName) {
    const ids = Array.isArray(page && page.selectedPerkIds) ? page.selectedPerkIds.map(Number) : [];
    if (ids.length !== 9 || ids.some((n) => !n) || !page.primaryStyleId || !page.subStyleId) return { ok: false, error: 'invalid' };
    const wanted = String(newName || '').trim().slice(0, 24) || 'Open Queue';
    const body = {
      name: wanted,
      primaryStyleId: Number(page.primaryStyleId),
      subStyleId: Number(page.subStyleId),
      selectedPerkIds: ids,
      current: true,
    };
    const [pages, inv] = await Promise.all([this.lcu.request('GET', '/lol-perks/v1/pages'), this.lcu.request('GET', '/lol-perks/v1/inventory')]);
    const list = Array.isArray(pages.data) ? pages.data : [];
    const own = list.filter((p) => !p.isTemporary && p.isEditable !== false); // tus páginas de verdad
    const mine = own.find((p) => p.name === wanted); // si ya hay una con ese nombre se actualiza; si no, se crea una nueva
    const canAdd = inv.status === 200 && inv.data && typeof inv.data.canAddCustomPage === 'boolean' ? inv.data.canAddCustomPage : own.length < 3;
    let r; let savedId = null;
    const chosen = replaceId ? own.find((p) => p.id === Number(replaceId)) : null;
    if (replaceId && !chosen) return { ok: false, error: 'invalid' };
    if (chosen) { // sobrescribe la página que elegiste (se conserva su nombre)
      body.name = String(chosen.name || 'Open Queue').slice(0, 24);
      r = await this.lcu.request('PUT', `/lol-perks/v1/pages/${chosen.id}`, body); savedId = chosen.id;
    } else if (mine) { r = await this.lcu.request('PUT', `/lol-perks/v1/pages/${mine.id}`, body); savedId = mine.id; }
    else if (canAdd) {
      r = await this.lcu.request('POST', '/lol-perks/v1/pages', body);
      if (r.status >= 200 && r.status < 300 && r.data && r.data.id) savedId = r.data.id;
    } else {
      return { ok: false, error: 'full', pages: own.map((p) => ({ id: p.id, name: p.name })) };
    }
    if (savedId !== null && r.status >= 200 && r.status < 300) await this.lcu.request('PUT', '/lol-perks/v1/currentpage', Number(savedId));
    await this._refreshRunes();
    this._emitState();
    let okk = r.status >= 200 && r.status < 300;
    if (okk) { // comprobamos que el cliente realmente guardó esas runas (antes podía aceptar el pedido y no mostrarlo)
      const pg = this.s.runes.pages.find((p) => p.id === Number(savedId || (r.data && r.data.id)));
      if (!pg || JSON.stringify(pg.selectedPerkIds.slice().sort()) !== JSON.stringify(ids.slice().sort())) {
        return { ok: false, error: 'notapplied', status: r.status, message: 'El cliente no guardó la página' };
      }
    }
    return { ok: okk, error: okk ? undefined : 'rejected', status: r.status, message: okk ? undefined : lcuMessage(r) };
  }

  // ---------- diagnóstico (grabación de eventos del cliente para depurar modos nuevos) ----------
  _saveDiagSession(sess) { if (this._diag) this._diag.lastSession = sess; }

  // Anota lo que Open Queue le pide al cliente (solo escrituras y errores) para entender qué rechaza.
  _diagCall(c) {
    const d = this._diag;
    if (!d || d.calls.length > 400) return;
    if (/\/conversations|\/lol-chat\//.test(c.path)) return;
    if (c.method === 'GET' && c.status >= 200 && c.status < 300) return;
    const cut = (v) => { try { const t = typeof v === 'string' ? v : JSON.stringify(v); return t === undefined ? undefined : t.slice(0, 700); } catch (_) { return undefined; } };
    d.calls.push({ t: Date.now() - d.start, method: c.method, path: c.path, status: c.status, request: cut(c.req), response: cut(c.res) });
  }

  _diagEvent(ev) {
    const d = this._diag;
    if (!d) return;
    const uri = ev.uri || '';
    if (NOISY_URIS.some((p) => uri.startsWith(p))) return;
    let data = ev.data;
    try { const j = JSON.stringify(data); if (j && j.length > 6000) data = { _truncated: true, preview: j.slice(0, 6000) }; } catch (_) {}
    if (uri === '/lol-champ-select/v1/session' && ev.data) {
      // Se guardan completas las primeras fotos del champ select (ahí se ven las opciones iniciales de ARAM y los pedidos de cambio).
      try {
        const full = JSON.stringify(ev.data);
        if (full !== d.lastCs && d.csTimeline.length < 60) { d.csTimeline.push({ t: Date.now() - d.start, session: ev.data }); d.lastCs = full; }
      } catch (_) {}
    }
    d.events.push({ t: Date.now() - d.start, uri, eventType: ev.eventType, data });
    if (d.events.length > 4000) d.events.shift();
    this.s.diag.count = d.events.length;
  }

  async startDiag(dir) {
    const fs = require('fs');
    const path = require('path');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const file = path.join(dir, `diagnostico-${stamp}.json`);
    this._diag = { start: Date.now(), events: [], calls: [], csTimeline: [], lastCs: '', file, lastSession: null, fs, timer: null };
    this.lcu.onCall = (c) => this._diagCall(c);
    this.s.diag = { on: true, file, count: 0 };
    this._diag.timer = setInterval(() => this._flushDiag(), 5000);
    await this._flushDiag();
    this._emitState();
    return { ok: true, file };
  }

  async stopDiag() {
    if (!this._diag) return { ok: true };
    clearInterval(this._diag.timer);
    await this._flushDiag();
    const file = this._diag.file;
    this._diag = null;
    this.lcu.onCall = null;
    this.s.diag = { on: false, file, count: this.s.diag.count };
    this._emitState();
    return { ok: true, file };
  }

  async _flushDiag() {
    const d = this._diag;
    if (!d) return;
    const [lobby, flow, queues, ready, pgs, inv, help, sty] = await Promise.all([
      this.lcu.request('GET', '/lol-lobby/v2/lobby'),
      this.lcu.request('GET', '/lol-gameflow/v1/session'),
      this.lcu.request('GET', '/lol-game-queues/v1/queues'),
      this.lcu.request('GET', '/lol-champ-select/v1/session'),
      this.lcu.request('GET', '/lol-perks/v1/pages'),
      this.lcu.request('GET', '/lol-perks/v1/inventory'),
      this.lcu.request('GET', '/help'),
      this.lcu.request('GET', '/lol-perks/v1/styles'),
    ]);
    let helpSwap = null;
    try { const h = JSON.stringify(help.data || {}); helpSwap = (h.match(/"[^"]*(?:[Ss]wap|[Tt]rade)[^"]*"/g) || []).filter((x) => /champ/i.test(x)).slice(0, 40); } catch (_) {}
    let styleDump = null;
    try { styleDump = Array.isArray(sty.data) ? sty.data.filter((x) => x.id === 8100).map((x) => x.slots.map((sl) => sl.perks)) : null; } catch (_) {}
    const out = {
      note: 'Diagnóstico de Open Queue. No incluye contraseñas ni datos de tu cuenta.',
      version: APP_VERSION,
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      phase: this.s.phase,
      snapshots: {
        lobby: lobby.status === 200 ? redactLobby(lobby.data) : { status: lobby.status },
        gameflowSession: flow.status === 200 ? flow.data : { status: flow.status },
        champSelectSession: ready.status === 200 ? ready.data : d.lastSession,
        perks: {
          inventory: inv.status === 200 ? inv.data : null,
          pages: Array.isArray(pgs.data) ? pgs.data.map((p) => ({ id: p.id, name: p.name, isTemporary: p.isTemporary, isEditable: p.isEditable, isDeletable: p.isDeletable, current: p.current, recommendationChampionId: p.recommendationChampionId, recommendationIndex: p.recommendationIndex, quickPlayChampionIds: p.quickPlayChampionIds })) : null,
        },
        queues: Array.isArray(queues.data) ? queues.data.filter((q) => QUEUE_NAMES[q.id] || q.id === 480).slice(0, 30) : null,
      },
      calls: d.calls,
      champSelectTimeline: d.csTimeline,
      runeTrail: d.runeTrail || null,
      useRunesFail: d.useRunesFail || null,
      chatConvs: d.chatConvs || null,
      chatSample: d.chatSample || null,
      lobbyChat: d.lobbyChat || null,
      chatCells: d.chatCells || null,
      friendsSample: d.friendsSample || null,
      inviteTry: d.inviteTry || null,
      cosmeticsTrail: d.cosmeticsTrail || null,
      cosmeticsSet: d.cosmeticsSet || null,
      chatParticipants: d.chatParticipants || null,
      autoPick: d.autoPick || null,
      history: d.history || null,
      cellSummoners: d.cellSummoners || null,
      helpSwap,
      dominationSlots: styleDump,
      events: d.events,
    };
    try { d.fs.writeFileSync(d.file, JSON.stringify(out, null, 1)); } catch (_) {}
  }

  // ---------- chat del champ select ----------
  _startChat() {
    this._stopChat();
    this.s.chat = [];
    this._chatId = null;
    this._lastChatId = null;
    this._chatInterval = setInterval(() => this._chatPoll(), 2000);
    this._chatPoll();
  }

  _stopChat() {
    clearInterval(this._chatInterval);
    this._chatInterval = null;
    this._chatId = null;
    this.s.chat = [];
    this.s.chatReady = false;
    this._allyNums = null;
    this._cellAlias = null;
    this._chatMe = null;
  }

  async _findChat() {
    const r = await this.lcu.request('GET', '/lol-chat/v1/conversations');
    if (r.status === 200 && Array.isArray(r.data)) {
      if (this._diag) this._diag.chatConvs = r.data.map((x) => ({ id: x && x.id, type: x && x.type, name: x && x.name })); // para ajustar el chat de la sala
      let c;
      if (this.s.phase === 'ChampSelect') c = r.data.find((x) => x.type === 'championSelect');
      else {
        // chat de la sala (grupo/party). El tipo exacto depende del cliente: se prueban los conocidos.
        for (const ty of ['lobby', 'party', 'groupchat', 'customGame']) { c = r.data.find((x) => x && x.type === ty); if (c) break; }
        if (!c) c = r.data.find((x) => x && !['chat', 'championSelect', 'postGame', 'system'].includes(x.type)) || r.data.find((x) => x && /lobby|party|custom/i.test(String(x.id)));
      }
      if (!c && this.s.phase !== 'ChampSelect') c = await this._findLobbyMuc(r.data);
      if (c) this._chatId = c.id;
    }
    this._emitState();
  }

  // Chat de la sala en clientes nuevos: no aparece con un tipo conocido, así que se busca por el id de la sala
  // (multiUserChatId) con el dominio que da el cliente (por ejemplo "...@lol-pre-game.la2.pvp.net").
  async _findLobbyMuc(convs) {
    if (Date.now() - (this._mucTryAt || 0) < 8000) return null; // no se pregunta en cada vuelta
    this._mucTryAt = Date.now();
    const lr = await this.lcu.request('GET', '/lol-lobby/v2/lobby');
    const l = lr.status === 200 && lr.data ? lr.data : null;
    const muc = l && (l.multiUserChatId || (l.mucJwtDto && l.mucJwtDto.channelClaim) || l.partyId);
    const tries = [];
    if (!muc) { if (this._diag) this._diag.lobbyChat = { noMuc: true }; return null; }
    let c = convs.find((x) => x && String(x.id || '').startsWith(muc));
    if (!c) {
      const suffixes = new Set();
      convs.forEach((x) => { const at = String((x && x.id) || '').split('@')[1]; if (at) suffixes.add(at.replace(/^(champ-select|sec|lol-pre-game|post-game|lol-post-game|lol-champ-select)\./, '')); });
      const dom = (l.mucJwtDto && l.mucJwtDto.domain) || 'lol-pre-game';
      const cands = [];
      [...suffixes].forEach((sx) => { cands.push(`${muc}@${dom}.${sx}`, `${muc}@sec.${sx}`); });
      for (const id of cands) {
        const g = await this.lcu.request('GET', `/lol-chat/v1/conversations/${encodeURIComponent(id)}`);
        tries.push([id.replace(muc, '<sala>'), g.status]);
        if (g.status === 200) { c = Object.assign({ id }, g.data || {}); c.id = (g.data && g.data.id) || id; break; }
      }
    }
    if (this._diag) this._diag.lobbyChat = { found: !!c, type: c && c.type, tries };
    return c || null;
  }

  // Apodo anónimo de cada compañero en ranked (por ejemplo "Dagarraco Rocoso"), tal como lo muestra el cliente en tu idioma.
  // Nunca se usa el nombre real de alguien que el cliente oculta.
  async _loadCellAliases() {
    if (!this._cellAlias) this._cellAlias = new Map();
    const hidden = (this._csCells || []).filter((c) => c && c.nameVisibilityType === 'HIDDEN' && !c.playerAlias && !this._cellAlias.has(c.cellId));
    for (const c of hidden) {
      const r = await this.lcu.request('GET', `/lol-champ-select/v1/summoners/${Number(c.cellId)}`);
      const d = r.status === 200 && r.data ? r.data : {};
      if (this._diag) { this._diag.cellSummoners = this._diag.cellSummoners || {}; this._diag.cellSummoners[c.cellId] = d; }
      const nm = d.playerAlias || d.alias || d.anonymousName || '';
      this._cellAlias.set(c.cellId, nm); // se pregunta una sola vez por celda
    }
  }

  async _nameByPuuid(puuid) {
    if (!puuid) return '';
    if (!this._puuidNames) this._puuidNames = new Map();
    if (this._puuidNames.has(puuid)) return this._puuidNames.get(puuid);
    const r = await this.lcu.request('GET', `/lol-summoner/v2/summoners/puuid/${encodeURIComponent(puuid)}`);
    const nm = r.status === 200 && r.data ? (r.data.gameName || r.data.displayName || '') : '';
    if (nm) this._puuidNames.set(puuid, nm);
    return nm;
  }

  async _nameOf(summonerId) {
    if (!summonerId) return '?';
    if (this._nameCache.has(summonerId)) return this._nameCache.get(summonerId);
    const r = await this.lcu.request('GET', `/lol-summoner/v1/summoners/${summonerId}`);
    let name = String(summonerId);
    if (r.status === 200 && r.data) name = r.data.gameName || r.data.displayName || name;
    this._nameCache.set(summonerId, name);
    return name;
  }

  // Busca la celda del champ select de quien escribió (por varios identificadores; en ranked el cliente usa los "ofuscados").
  _cellOf(m) {
    return (this._csCells || []).find((c) =>
      (m.fromPuuid && c.puuid === m.fromPuuid) || (m.fromSummonerId && c.summonerId === m.fromSummonerId) ||
      (m.fromObfuscatedPuuid && c.obfuscatedPuuid === m.fromObfuscatedPuuid) || (m.fromObfuscatedSummonerId && c.obfuscatedSummonerId === m.fromObfuscatedSummonerId)) || null;
  }

  async _chatPoll() {
    if (!['Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect'].includes(this.s.phase)) return;
    if (!this._chatId) await this._findChat();
    if (!this._chatId) return;
    const r = await this.lcu.request('GET', `/lol-chat/v1/conversations/${encodeURIComponent(this._chatId)}/messages`);
    if (r.status !== 200 || !Array.isArray(r.data)) return;
    const msgs = r.data.filter((m) => (m.type === 'chat' || m.type === 'groupchat') && m.body).slice(-50);
    if (this._diag) { this._diag.chatSample = r.data.slice(-3); this._diag.chatCells = (this._csCells || []).map((c) => ({ cellId: c.cellId, vis: c.nameVisibilityType, alias: c.playerAlias, internal: c.internalName, hasPuuid: !!c.puuid, obf: !!(c.obfuscatedPuuid || c.obfuscatedSummonerId), champ: c.championId })); }
    // Chat de la sala: los nombres salen de los participantes de la conversación, de la sala o del perfil de chat.
    const pn = new Map();
    const rankedCs = this.s.phase === 'ChampSelect' && [420, 440].includes(this._csQueue || this.s.lobbyQueueId);
    // Participantes del chat. En ranked el chat del champ select ya viene con los apodos anónimos que muestra el cliente.
    if (this.s.phase !== 'ChampSelect' || rankedCs) {
      const pr = await this.lcu.request('GET', `/lol-chat/v1/conversations/${encodeURIComponent(this._chatId)}/participants`);
      if (pr.status === 200 && Array.isArray(pr.data)) {
        if (this._diag) this._diag.chatParticipants = pr.data;
        pr.data.forEach((x) => {
          const nm = x.playerAlias || x.alias || x.gameName || x.name || x.displayName;
          if (!nm) return;
          [x.pid, x.id, x.summonerId, x.puuid, x.obfuscatedPuuid, x.obfuscatedSummonerId].forEach((k) => { if (k) pn.set(String(k), nm); });
        });
      }
    }
    if (rankedCs) await this._loadCellAliases();
    if (this.s.phase !== 'ChampSelect') {
      if (!this._chatMe) {
        const mr = await this.lcu.request('GET', '/lol-chat/v1/me');
        if (mr.status === 200 && mr.data) this._chatMe = { id: mr.data.id, pid: mr.data.pid, name: mr.data.gameName || mr.data.name };
      }
    }
    const out = [];
    for (const m of msgs) {
      const me = this._chatMe || {};
      const cell = this.s.phase === 'ChampSelect' ? this._cellOf(m) : null;
      const mine = (cell && this.s.champSelect && cell.cellId === this.s.champSelect.localCell) || (this._mySummonerId && m.fromSummonerId === this._mySummonerId) || (!!this._myPuuid && m.fromPuuid === this._myPuuid) || (!!me.id && m.fromId === me.id) || (!!me.pid && m.fromPid === me.pid);
      // En ranked el propio cliente oculta los nombres del equipo: igual acá, se numeran como "Aliado N". En el resto se ven como en el cliente.
      const inParty = !!this._party && ((m.fromPuuid && this._party.puuids.has(m.fromPuuid)) || (m.fromSummonerId && this._party.sids.has(m.fromSummonerId)));
      const hide = !inParty && this.s.phase === 'ChampSelect' && [420, 440].includes(this._csQueue || this.s.lobbyQueueId);
      const who = m.fromPuuid || m.fromObfuscatedPuuid || m.fromSummonerId || m.fromObfuscatedSummonerId || m.fromId || m.fromPid;
      if (!this._allyNums) this._allyNums = new Map();
      const partName = [m.fromPid, m.fromId, m.fromPuuid, m.fromObfuscatedPuuid, m.fromSummonerId, m.fromObfuscatedSummonerId].map((k) => k && pn.get(String(k))).find(Boolean) || '';
      const alias = !mine && hide ? ((cell && (cell.playerAlias || (this._cellAlias && this._cellAlias.get(cell.cellId)))) || partName || '') : '';
      if (!mine && !inParty && !alias && !this._allyNums.has(who)) this._allyNums.set(who, this._allyNums.size + 1);
      let name = '';
      // En ranked el cliente muestra un apodo anónimo (playerAlias): se usa ese mismo en vez de "Aliado N".
      if (alias) name = alias;
      if (mine || !hide) {
        name = (m.fromPuuid && this._puuidNames && this._puuidNames.get(m.fromPuuid)) || (m.fromSummonerId && (this._lobbyNames && this._lobbyNames.get(m.fromSummonerId))) || pn.get(String(m.fromPid)) || pn.get(String(m.fromId)) || pn.get(String(m.fromSummonerId)) || '';
        if (!name && mine && me.name) name = me.name;
        if (!name && m.fromSummonerId) name = await this._nameOf(m.fromSummonerId);
        if (!name && m.fromPuuid) name = await this._nameByPuuid(m.fromPuuid);
      }
      out.push({
        id: m.id,
        champId: cell ? (cell.championId || cell.championPickIntent || 0) : 0,
        pos: cell ? (cell.assignedPosition || '') : '',
        allyN: mine || inParty || cell ? 0 : this._allyNums.get(who),
        name,
        body: String(m.body).slice(0, 500),
        mine: !!mine,
      });
    }
    const last = out.length ? out[out.length - 1] : null;
    if (last && last.id !== this._lastChatId) {
      if (this._lastChatId !== null && !last.mine) this._alert('chat');
      this._lastChatId = last.id;
    }
    this.s.chat = out;
    this.s.chatReady = true;
    this._emitState();
  }

  async sendChat(body) {
    body = String(body || '').trim().slice(0, 300);
    if (!body || !this._chatId) return { ok: false };
    const r = await this.lcu.request('POST', `/lol-chat/v1/conversations/${encodeURIComponent(this._chatId)}/messages`, { body, type: 'chat' });
    setTimeout(() => this._chatPoll(), 200);
    return { ok: r.status >= 200 && r.status < 300 };
  }
}

module.exports = { Engine, MAX_AUTO_DELAY };
