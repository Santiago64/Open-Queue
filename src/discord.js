'use strict';
// Discord Rich Presence: muestra en tu perfil de Discord que estás en Open Queue (sala, campeón, nick) y un botón
// para unirse a tu canal de voz. Habla con la app de Discord de tu PC por su canal local (IPC), sin bots ni internet.
// Necesita el "Application ID" de una aplicación creada en https://discord.com/developers/applications
const net = require('net');
const path = require('path');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const REPO_URL = 'https://github.com/Santiago64/Open-Queue';
const VOICE_RE = /^https:\/\/(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[A-Za-z0-9-]{2,40}\/?$/;

function ipcPaths(i) {
  if (process.platform === 'win32') return [`\\\\?\\pipe\\discord-ipc-${i}`];
  const base = (process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp').replace(/\/$/, '');
  return [
    path.join(base, `discord-ipc-${i}`),
    path.join(base, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`), // Flatpak
    path.join(base, 'snap.discord', `discord-ipc-${i}`), // Snap
  ];
}

function encode(op, obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(data.length, 4);
  return Buffer.concat([head, data]);
}

class DiscordIpc {
  constructor(clientId, log) {
    this.clientId = String(clientId);
    this.sock = null;
    this.ready = false;
    this.buf = Buffer.alloc(0);
    this.log = log || (() => {});
    this.onReady = null;
    this.onClose = null;
  }

  async connect() {
    const all = [];
    for (let i = 0; i < 10; i++) all.push(...ipcPaths(i));
    for (const p of all) {
      const sock = await new Promise((resolve) => {
        const s = net.createConnection(p);
        s.once('connect', () => resolve(s));
        s.once('error', () => resolve(null));
      });
      if (sock) { this._attach(sock); return true; }
    }
    return false;
  }

  _attach(sock) {
    this.sock = sock;
    sock.on('data', (d) => this._data(d));
    sock.on('error', () => {});
    sock.on('close', () => { const was = this.sock; this.sock = null; this.ready = false; if (was && this.onClose) this.onClose(); });
    sock.write(encode(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));
  }

  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) return;
      let msg = null;
      try { msg = JSON.parse(this.buf.slice(8, 8 + len).toString('utf8')); } catch (_) {}
      this.buf = this.buf.slice(8 + len);
      if (op === OP_CLOSE) { this.log('discord: cerrado', msg && msg.message); this.close(); return; }
      if (msg && msg.evt === 'READY') { this.ready = true; if (this.onReady) this.onReady(); }
      else if (msg && msg.evt === 'ERROR') this.log('discord: error', msg.data && msg.data.message);
    }
  }

  setActivity(activity) {
    if (!this.sock || !this.ready) return false;
    this.sock.write(encode(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity || null }, nonce: String(Date.now()) + Math.random().toString(16).slice(2) }));
    return true;
  }

  close() {
    const s = this.sock;
    this.sock = null; this.ready = false;
    if (s) { try { s.end(); s.destroy(); } catch (_) {} }
  }
}

const TXT = {
  es: { lobby: 'En sala', queue: 'Buscando partida', ready: 'Partida encontrada', cs: 'Eligiendo campeón', game: 'Jugando', post: 'Fin de partida', voice: '🎧 Unirse al voice', app: 'Open Queue', party: 'Sala' },
  en: { lobby: 'In lobby', queue: 'In queue', ready: 'Match found', cs: 'Champion select', game: 'Playing', post: 'Post game', voice: '🎧 Join the voice', app: 'Open Queue', party: 'Lobby' },
};

// Arma la actividad a partir del estado de la app. Devuelve null si no hay nada que mostrar.
function buildActivity(engine, cfg) {
  const s = engine.s || {};
  const tx = TXT[cfg.lang] || TXT.es;
  const phases = { Lobby: 'lobby', Matchmaking: 'queue', ReadyCheck: 'ready', ChampSelect: 'cs', InProgress: 'game', GameStart: 'game', Reconnect: 'game', WaitingForStats: 'post', PreEndOfGame: 'post', EndOfGame: 'post' };
  const ph = phases[s.phase];
  if (!s.connected || !ph) return null;
  const queueId = (s.champSelect && s.champSelect.queueId) || (s.lobby && s.lobby.queueId) || engine._csQueue || null;
  const queue = queueId ? engine.queueName(queueId) : '';
  const me = s.champSelect && (s.champSelect.myTeam || []).find((p) => p.isMe);
  const champ = Number((me && (me.championId || me.intent)) || engine._gameChamp || 0) || 0;
  const champName = champ ? engine.champName(champ) : '';
  const act = { details: [tx[ph], ph === 'game' && champName ? champName : '', queue].filter(Boolean).join(' · ').slice(0, 128) };
  const nick = cfg.showNick !== false ? (engine._myName || '') : '';
  const members = (s.lobby && s.lobby.members) || 1;
  act.state = (nick ? `${nick}` : tx.app).slice(0, 128);
  if (['lobby', 'queue', 'ready'].includes(ph) && engine._partyId) act.party = { id: String(engine._partyId).slice(0, 64), size: [Math.max(1, members), 5] };
  act.assets = champ
    ? { large_image: `https://cdn.communitydragon.org/latest/champion/${champ}/square`, large_text: champName || 'League of Legends', small_image: 'logo', small_text: 'Open Queue' }
    : { large_image: 'logo', large_text: 'Open Queue' };
  if (engine._phaseSince) act.timestamps = { start: engine._phaseSince };
  const buttons = [];
  if (cfg.voiceLink && VOICE_RE.test(cfg.voiceLink)) buttons.push({ label: tx.voice, url: cfg.voiceLink });
  buttons.push({ label: tx.app, url: REPO_URL });
  act.buttons = buttons.slice(0, 2);
  act.instance = false;
  return act;
}

// Mantiene la presencia al día con poca frecuencia (Discord limita los cambios) y se reconecta si Discord se abre después.
class Presence {
  constructor(engine, store, opts) {
    this.engine = engine;
    this.store = store;
    this.opts = opts || {};
    this.ipc = null;
    this.status = 'off'; // off | noId | connecting | noDiscord | on
    this._last = '';
    this._timer = null;
    this._retry = null;
    this._lastSent = 0;
    engine.on('state', () => this.schedule());
    this.apply();
  }

  cfg() { return (this.store.settings && this.store.settings.discord) || {}; }

  clientId() { const c = this.cfg(); return String(c.clientId || this.opts.clientId || process.env.OQ_DISCORD_CLIENT_ID || '').trim(); }

  // Se llama al cambiar los ajustes.
  apply() {
    const c = this.cfg();
    const id = this.clientId();
    if (!c.rpc) return this._stop('off');
    if (!/^\d{15,22}$/.test(id)) return this._stop('noId');
    if (this.ipc && this.ipc.clientId === id) { this._last = ''; this.schedule(); return; }
    this._stop('connecting');
    this._connect();
  }

  async _connect() {
    clearTimeout(this._retry);
    const id = this.clientId();
    const ipc = new DiscordIpc(id);
    this.ipc = ipc;
    this.status = 'connecting'; this._emit();
    ipc.onReady = () => { if (this.ipc !== ipc) return; this.status = 'on'; this._last = ''; this._emit(); this.schedule(true); };
    ipc.onClose = () => { if (this.ipc !== ipc) return; this.status = 'noDiscord'; this._emit(); this._retry = setTimeout(() => this.cfg().rpc && this._connect(), 20000); };
    const ok = await ipc.connect();
    if (this.ipc !== ipc) { ipc.close(); return; }
    if (!ok) { this.status = 'noDiscord'; this._emit(); this._retry = setTimeout(() => this.cfg().rpc && this._connect(), 20000); }
  }

  _stop(status) {
    clearTimeout(this._retry); clearTimeout(this._timer);
    if (this.ipc) { try { this.ipc.setActivity(null); } catch (_) {} this.ipc.close(); }
    this.ipc = null; this._last = '';
    this.status = status; this._emit();
  }

  _emit() { this.engine.s.discordStatus = this.status; if (this.engine._emitState) this.engine._emitState(); }

  // Discord acepta pocos cambios seguidos: como mucho uno cada 5 segundos.
  schedule(now) {
    if (!this.ipc || !this.ipc.ready) return;
    clearTimeout(this._timer);
    const wait = now ? 0 : Math.max(0, 5000 - (Date.now() - this._lastSent));
    this._timer = setTimeout(() => this._send(), Math.max(wait, now ? 0 : 300));
  }

  _send() {
    if (!this.ipc || !this.ipc.ready) return;
    const act = buildActivity(this.engine, this.cfg());
    const key = JSON.stringify(act && Object.assign({}, act, { timestamps: undefined })) + (act && act.timestamps ? act.timestamps.start : '');
    if (key === this._last) return;
    this._last = key;
    this._lastSent = Date.now();
    this.ipc.setActivity(act);
  }

  stop() { this._stop('off'); }
}

module.exports = { Presence, DiscordIpc, buildActivity, VOICE_RE, ipcPaths };
