'use strict';
// Servidor local: sirve la web del celu, el WebSocket de control y la API del escritorio.
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');
const { Store } = require('./store');
const { Engine } = require('./engine');

const DEFAULT_PORT = 4747;

function localIps() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

function isLoopback(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

// ---------- datos estáticos (Data Dragon, el CDN oficial permitido para desarrolladores) ----------
const staticCache = new Map();
async function loadStatic(lang) {
  const locale = lang === 'es' ? 'es_MX' : 'en_US';
  const hit = staticCache.get(locale);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.data;
  try {
    const vers = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
    const v = vers[0];
    const [champs, spells] = await Promise.all([
      (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/${locale}/champion.json`)).json(),
      (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/${locale}/summoner.json`)).json(),
    ]);
    const data = {
      ok: true,
      version: v,
      champions: Object.values(champs.data).map((c) => ({ key: Number(c.key), id: c.id, name: c.name, tags: c.tags })),
      // Todos los hechizos; cada pantalla filtra por el modo de juego (antes se filtraba solo por CLASSIC y faltaba Marca).
      spells: Object.values(spells.data).map((s) => ({ key: Number(s.key), id: s.id, name: s.name, modes: s.modes || [] })),
    };
    staticCache.set(locale, { at: Date.now(), data });
    return data;
  } catch (_) {
    return hit ? hit.data : { ok: false, version: null, champions: [], spells: [] };
  }
}

async function startServer(opts = {}) {
  const store = new Store(opts.dataDir || process.env.OQ_DATA);
  const engine = opts.engine || new Engine(store);
  const app = express();
  app.disable('x-powered-by');

  const hostOk = (req) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '');
  const desktopOnly = (req, res, next) => {
    if (!isLoopback(req) || !hostOk(req)) return res.status(403).send('Forbidden');
    if (req.method === 'POST') {
      const o = req.headers.origin;
      if (o && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o)) return res.status(403).send('Forbidden');
    }
    next();
  };

  app.use(express.json({ limit: '10kb' }));
  const pub = path.join(__dirname, '..', 'public');
  app.get('/desktop', desktopOnly, (req, res) => res.sendFile(path.join(pub, 'desktop.html')));
  app.use(express.static(pub, { index: 'mobile.html', setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

  // Imágenes del juego (íconos de runas, skins) servidas desde el cliente local, solo rutas de assets.
  const assetCache = new Map();
  app.get(/^\/lcu-asset\/(.+)$/, async (req, res) => {
    const p = '/' + req.params[0];
    if (!/^\/lol-game-data\/assets\/[\w\-./]+$/.test(p) || p.includes('..')) return res.status(400).end();
    let hit = assetCache.get(p);
    if (!hit) {
      hit = await engine.lcu.requestRaw(p);
      if (!hit || hit.status !== 200) return res.status(404).end();
      if (assetCache.size > 600) assetCache.clear();
      assetCache.set(p, hit);
    }
    res.setHeader('Content-Type', hit.type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(hit.body);
  });

  app.get('/api/static', async (req, res) => {
    res.json(await loadStatic(req.query.lang === 'es' ? 'es' : 'en'));
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  let port = Number(opts.port || process.env.OQ_PORT || DEFAULT_PORT);
  const listen = () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); });
  });
  for (let i = 0; i < 10; i++) {
    try { await listen(); break; } catch (e) {
      if (e.code !== 'EADDRINUSE' || i === 9) throw e;
      port += 1;
    }
  }

  // ---------- vinculación ----------
  const fails = new Map(); // ip -> {n, until}
  const failedRecently = (ip) => { const f = fails.get(ip); return f && f.until > Date.now() && f.n >= 5; };
  const registerFail = (ip) => {
    const f = fails.get(ip) || { n: 0, until: 0 };
    f.n = f.until > Date.now() ? f.n + 1 : 1;
    f.until = Date.now() + 60000;
    fails.set(ip, f);
  };

  const pairingInfo = async () => {
    const ips = localIps();
    const ip = ips[0] || '127.0.0.1';
    const url = `http://${ip}:${port}/`;
    const qr = await QRCode.toDataURL(`${url}?c=${store.code}`, { margin: 1, width: 360, color: { dark: '#000000', light: '#ffffff' } });
    return { ips, ip, port, url, code: store.code, qr };
  };

  const phonesOnline = () => [...wss.clients].filter((c) => c.authed && c.readyState === 1).length;

  app.get('/api/status', desktopOnly, async (req, res) => {
    const st = engine.snapshot();
    res.json({
      lol: { connected: st.connected, phase: st.phase, readyCheck: st.readyCheck },
      settings: st.settings,
      diag: st.diag,
      maxAutoDelay: st.maxAutoDelay,
      phones: phonesOnline(),
      pairing: await pairingInfo(),
    });
  });
  app.post('/api/autoaccept', desktopOnly, (req, res) => {
    engine.setAutoAccept(req.body.enabled, req.body.delay);
    res.json({ ok: true });
  });
  app.post('/api/diag', desktopOnly, async (req, res) => {
    res.json(req.body.on ? await engine.startDiag(store.dir) : await engine.stopDiag());
  });
  app.post('/api/regen', desktopOnly, (req, res) => {
    store.regenerateCode();
    wss.clients.forEach((c) => { if (c.authed) { c.authed = false; try { c.send(JSON.stringify({ type: 'authRequired', reason: 'revoked' })); } catch (_) {} } });
    res.json({ ok: true });
  });

  // ---------- WebSocket ----------
  const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  engine.on('state', (state) => wss.clients.forEach((c) => { if (c.authed) send(c, { type: 'state', state }); }));
  engine.on('alert', (a) => wss.clients.forEach((c) => { if (c.authed) send(c, { type: 'alert', alert: a }); }));

  const commands = {
    accept: () => engine.acceptMatch('manual'),
    decline: () => engine.declineMatch(),
    setAutoAccept: (m) => { engine.setAutoAccept(m.enabled, m.delay); return { ok: true }; },
    search: (m) => engine.createLobbyAndSearch(m.queueId),
    createLobby: (m) => engine.createLobby(m.queueId),
    setLobbyQueue: (m) => engine.setLobbyQueue(m.queueId),
    cancelSearch: () => engine.cancelSearch(),
    leaveLobby: () => engine.leaveLobby(),
    hover: (m) => engine.hoverChampion(m.championId),
    lockIn: (m) => engine.lockIn(m.championId),
    setSpells: (m) => engine.setSpells(m.spell1Id, m.spell2Id),
    setAutoInvite: (m) => { engine.setAutoInvite(m.enabled); return { ok: true }; },
    answerInvite: (m) => engine.answerInvite(m.inviteId, !!m.accept),
    setPreBan: (m) => { engine.setPreBan(m.championId); return { ok: true }; },
    setPrePick: (m) => { engine.setPrePick(m.championId); return { ok: true }; },
    setFavorites: (m) => { engine.setFavorites({ ids: m.ids, autoPick: m.autoPick, useHistory: m.useHistory, when: m.when }); return { ok: true }; },
    selectRunePage: (m) => engine.selectRunePage(m.id),
    sendChat: (m) => engine.sendChat(m.body),
    selectSkin: (m) => engine.selectSkin(m.skinId),
    swap: (m) => engine.answerSwap(m.kind, m.swapId, m.action || (m.accept ? 'accept' : 'decline')),
    dodge: () => engine.dodge(),
    setRoles: (m) => engine.setRoles(m.first, m.second),
    useRunes: (m) => engine.useRunes(m.page, m.championId),
    benchSwap: (m) => engine.benchSwap(m.championId),
    reroll: () => engine.reroll(),
    friends: () => engine.friends(),
    inviteFriend: (m) => engine.inviteFriend(m.summonerId),
    cosmeticsData: () => engine.cosmeticsData(),
    setEmote: (m) => engine.setEmote(m.slot, m.itemId),
    setWard: (m) => engine.setWard(m.itemId),
    runeData: (m) => engine.runeData(m.championId, m.position),
    saveRunes: (m) => engine.saveRunes(m.page, m.replaceId, m.name),
    setQuickSlot: (m) => engine.setQuickSlot(m.index, m.patch),
    ownedSkins: (m) => engine.ownedSkins(m.championId),
  };

  wss.on('connection', (ws, req) => {
    const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
    ws.authed = false;
    send(ws, { type: 'authRequired' });

    ws.on('message', async (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      if (!m || typeof m.type !== 'string') return;

      if (m.type === 'auth') {
        if (failedRecently(ip)) return send(ws, { type: 'authError', reason: 'locked' });
        if (m.token && store.hasToken(m.token)) {
          ws.authed = true;
          send(ws, { type: 'authed', token: m.token });
        } else if (m.code && String(m.code) === store.code) {
          ws.authed = true;
          send(ws, { type: 'authed', token: store.newToken() });
        } else {
          registerFail(ip);
          return send(ws, { type: 'authError', reason: 'invalid' });
        }
        return send(ws, { type: 'state', state: engine.snapshot() });
      }

      if (!ws.authed) return send(ws, { type: 'authRequired' });
      if (m.type === 'ping') return send(ws, { type: 'pong' });
      const fn = commands[m.type];
      if (!fn) return;
      try {
        const result = await fn(m);
        send(ws, { type: 'result', id: m.id, cmd: m.type, result: result || { ok: true } });
      } catch (e) {
        send(ws, { type: 'result', id: m.id, cmd: m.type, result: { ok: false, error: 'internal' } });
      }
    });
  });

  engine.start();

  return {
    port,
    engine,
    store,
    close: () => new Promise((resolve) => { engine.stop(); wss.clients.forEach((c) => c.terminate()); server.close(() => resolve()); }),
  };
}

module.exports = { startServer };

if (require.main === module) {
  startServer().then(async (srv) => {
    const ips = localIps();
    console.log('\n  OPEN QUEUE corriendo');
    console.log('  Desktop : http://127.0.0.1:' + srv.port + '/desktop');
    console.log('  Celular : http://' + (ips[0] || '127.0.0.1') + ':' + srv.port + '/   código: ' + srv.store.code + '\n');
  });
}
