'use strict';
// Quinta prueba: Discord. Link del voice al chat y Rich Presence contra un Discord falso (su canal local IPC).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');
const { startMock } = require('./mock-lcu');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (_) {} await sleep(50); }
  throw new Error('Timeout esperando: ' + label);
}

// Discord falso: responde READY al saludo y guarda cada SET_ACTIVITY.
function fakeDiscord(dir) {
  const frames = []; let hello = null;
  const enc = (op, o) => { const d = Buffer.from(JSON.stringify(o)); const h = Buffer.alloc(8); h.writeInt32LE(op, 0); h.writeInt32LE(d.length, 4); return Buffer.concat([h, d]); };
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0); const len = buf.readInt32LE(4);
        if (buf.length < 8 + len) return;
        const msg = JSON.parse(buf.slice(8, 8 + len).toString());
        buf = buf.slice(8 + len);
        if (op === 0) { hello = msg; sock.write(enc(1, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } })); }
        else if (op === 1 && msg.cmd === 'SET_ACTIVITY') frames.push(msg.args.activity);
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((r) => server.listen(path.join(dir, 'discord-ipc-0'), () => r({ server, frames, hello: () => hello })));
}

(async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-ipc-'));
  process.env.XDG_RUNTIME_DIR = runDir;
  const dc = await fakeDiscord(runDir);
  const mock = await startMock();
  process.env.OQ_LOCKFILE = mock.lockfile;
  process.env.OQ_NO_KILL = '1';
  process.env.OQ_NO_DDRAGON = '1';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-data5-'));
  const { startServer } = require('../src/server');
  const srv = await startServer({ dataDir, port: 4971 });
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

  // 1) Link del voice: solo invitaciones de Discord.
  assert.strictEqual((await ask('setDiscord', { voiceLink: 'https://evil.example.com/x' })).error, 'badLink');
  assert((await ask('setDiscord', { voiceLink: 'discord.gg/abcXYZ12', voiceMsg: 'Entren al voice: {link} ¡vamos!' })).ok);
  await waitFor(() => state.settings.discord.voiceLink === 'https://discord.gg/abcXYZ12', 'link guardado');
  ok('link del voice: solo acepta invitaciones de Discord (y completa el https)');

  // 2) Se manda al chat de la sala con el mensaje elegido.
  mock.st.chat = [];
  await ask('search', { queueId: 400 }); mock.setPhase('Lobby');
  await waitFor(() => state.phase === 'Lobby' && state.chatReady, 'chat de la sala');
  const n0 = mock.calls.length;
  assert((await ask('sendVoice', { msg: 'Entren al voice: {link} ¡vamos!' })).ok);
  const post = mock.calls.slice(n0).find((c) => c.method === 'POST' && /\/messages$/.test(c.url));
  assert.strictEqual(post.body.body, 'Entren al voice: https://discord.gg/abcXYZ12 ¡vamos!');
  assert((await ask('sendVoice', { msg: 'Voice 🎧' })).ok);
  assert.strictEqual(mock.calls.filter((c) => c.method === 'POST' && /\/messages$/.test(c.url)).pop().body.body, 'Voice 🎧 https://discord.gg/abcXYZ12', 'sin {link} va al final');
  ok('botón del voice: manda tu mensaje con el link al chat de la sala');

  // 3) Rich Presence: sin Application ID no se conecta; con ID se conecta y muestra la sala.
  await ask('setDiscord', { rpc: true, lang: 'es' });
  await waitFor(() => state.discordStatus === 'noId', 'falta id');
  assert.strictEqual((await ask('setDiscord', { clientId: 'abc' })).error, 'badId');
  await ask('setDiscord', { clientId: '123456789012345678' });
  await waitFor(() => state.discordStatus === 'on', 'conectado a discord');
  assert.strictEqual(dc.hello().client_id, '123456789012345678');
  const lobbyAct = await waitFor(() => dc.frames.filter(Boolean).find((a) => /En sala/.test(a.details)), 'actividad de sala');
  assert(/Normal Draft/.test(lobbyAct.details), 'con la cola');
  assert.strictEqual(lobbyAct.state, 'Yo', 'tu nick');
  assert.deepStrictEqual(lobbyAct.buttons[0], { label: '🎧 Unirse al voice', url: 'https://discord.gg/abcXYZ12' });
  assert.strictEqual(lobbyAct.buttons[1].url, 'https://github.com/Santiago64/Open-Queue');
  ok('Rich Presence: con tu Application ID se ve "En sala · Normal Draft", tu nick y el botón para unirse al voice');

  // 4) En el champ select: el ícono del campeón que elegiste.
  mock.startChampSelect();
  mock.updateSession((s) => { s.myTeam[0].championId = 103; });
  const csAct = await waitFor(() => dc.frames.filter(Boolean).find((a) => /Eligiendo/.test(a.details) && a.assets && /champion\/103\//.test(a.assets.large_image)), 'actividad champ select');
  assert(csAct.assets.large_image.startsWith('https://'));
  ok('Rich Presence: en el champ select se ve el ícono del campeón que elegiste');

  // 5) Sin nick y apagado.
  await ask('setDiscord', { showNick: false });
  await waitFor(() => dc.frames.filter(Boolean).some((a) => a.state === 'Open Queue'), 'sin nick');
  await ask('setDiscord', { rpc: false });
  await waitFor(() => state.discordStatus === 'off' && dc.frames[dc.frames.length - 1] === null, 'presencia borrada');
  ok('Rich Presence: podés ocultar tu nick, y al apagarlo se borra de tu perfil');

  // 6) Lo mismo desde la ventana de la PC (sin celular).
  const pc = async (url, body) => (await fetch(`http://127.0.0.1:${srv.port}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  assert.strictEqual((await pc('/api/discord', { voiceLink: 'https://nope.com/a' })).error, 'badLink');
  assert((await pc('/api/discord', { voiceLink: 'https://discord.com/invite/PcLink99', voiceMsg: 'Desde la PC: {link}' })).ok);
  const stPc = await (await fetch(`http://127.0.0.1:${srv.port}/api/status`)).json();
  assert.strictEqual(stPc.settings.discord.voiceLink, 'https://discord.com/invite/PcLink99');
  assert.strictEqual(stPc.discordStatus, 'off');
  mock.setPhase('None'); await sleep(300);
  await ask('search', { queueId: 400 }); mock.setPhase('Lobby');
  await waitFor(async () => (await (await fetch(`http://127.0.0.1:${srv.port}/api/status`)).json()).lol.chatReady, 'chat listo (PC)');
  const n1 = mock.calls.length;
  assert((await pc('/api/sendVoice', { msg: 'Desde la PC: {link}' })).ok);
  assert.strictEqual(mock.calls.slice(n1).find((c) => c.method === 'POST' && /\/messages$/.test(c.url)).body.body, 'Desde la PC: https://discord.com/invite/PcLink99');
  ok('desde la ventana de la PC: se guarda el link y el mensaje, y se manda al chat de la sala sin usar el celular');

  mock.setPhase('None'); await sleep(200);
  ws.close(); await srv.close(); mock.close(); dc.server.close();
  console.log(`\nTODO OK (${n} comprobaciones)`);
  process.exit(0);
})().catch((e) => { console.error('\nFALLÓ:', e.message); process.exit(1); });
