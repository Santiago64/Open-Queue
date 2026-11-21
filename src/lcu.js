'use strict';
// Conexión con el cliente local de League of Legends (League Client API / LCU).
// Solo habla con 127.0.0.1: nunca sale a internet.
const https = require('https');
const fs = require('fs');
const { execFile } = require('child_process');
const WebSocket = require('ws');
const EventEmitter = require('events');

const agent = new https.Agent({ rejectUnauthorized: false }); // el LCU usa certificado propio

function parseLockfile(txt) {
  const [, , port, password, protocol] = String(txt).trim().split(':');
  if (!port || !password) return null;
  return { port: Number(port), password, protocol: protocol || 'https' };
}

function fromLockfiles() {
  const candidates = [
    'C:\\Riot Games\\League of Legends\\lockfile',
    '/Applications/League of Legends.app/Contents/LoL/lockfile',
  ];
  for (const f of candidates) {
    try {
      const c = parseLockfile(fs.readFileSync(f, 'utf8'));
      if (c) return c;
    } catch (_) { /* siguiente */ }
  }
  return null;
}

function findCredentials() {
  return new Promise((resolve) => {
    if (process.env.OQ_LOCKFILE) {
      try { return resolve(parseLockfile(fs.readFileSync(process.env.OQ_LOCKFILE, 'utf8'))); }
      catch (_) { return resolve(null); }
    }
    if (process.platform === 'win32') {
      const ps = "Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine";
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
        { windowsHide: true, timeout: 6000 }, (err, stdout) => {
          if (!err && stdout) {
            const port = /--app-port=(\d+)/.exec(stdout);
            const tok = /--remote-auth-token=([\w-]+)/.exec(stdout);
            if (port && tok) return resolve({ port: Number(port[1]), password: tok[1], protocol: 'https' });
          }
          resolve(fromLockfiles());
        });
    } else {
      resolve(fromLockfiles());
    }
  });
}

class LCU extends EventEmitter {
  constructor() {
    super();
    this.creds = null;
    this.ws = null;
    this.connected = false;
    this._timer = null;
    this._connecting = false;
  }

  start() {
    this._tick();
    this._timer = setInterval(() => this._tick(), 3000);
  }

  stop() {
    clearInterval(this._timer);
    if (this.ws) { try { this.ws.close(); } catch (_) {} }
  }

  _auth() {
    return 'Basic ' + Buffer.from('riot:' + this.creds.password).toString('base64');
  }

  async _tick() {
    if (this.connected || this._connecting) return;
    this._connecting = true;
    try {
      const creds = await findCredentials();
      if (!creds) return;
      this.creds = creds;
      const r = await this.request('GET', '/lol-gameflow/v1/gameflow-phase');
      if (r.status !== 200) return;
      await this._openWs();
      this.connected = true;
      this.emit('connected');
    } catch (_) {
      /* reintenta en el próximo ciclo */
    } finally {
      this._connecting = false;
    }
  }

  _openWs() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://127.0.0.1:${this.creds.port}/`, {
        headers: { Authorization: this._auth() },
        rejectUnauthorized: false,
      });
      let opened = false;
      ws.on('open', () => {
        opened = true;
        this.ws = ws;
        ws.send(JSON.stringify([5, 'OnJsonApiEvent']));
        resolve();
      });
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        if (Array.isArray(msg) && msg[0] === 8 && msg[2]) this.emit('event', msg[2]);
      });
      ws.on('close', () => {
        if (!opened) return reject(new Error('ws closed'));
        if (this.connected) {
          this.connected = false;
          this.ws = null;
          this.emit('disconnected');
        }
      });
      ws.on('error', (e) => { if (!opened) reject(e); });
    });
  }

  // Descarga binaria (imágenes del juego) desde el cliente local.
  requestRaw(path) {
    return new Promise((resolve) => {
      if (!this.creds) return resolve(null);
      const req = https.request(
        { host: '127.0.0.1', port: this.creds.port, path, method: 'GET', agent, headers: { Authorization: this._auth() }, timeout: 8000 },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || 'application/octet-stream', body: Buffer.concat(chunks) }));
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => req.destroy());
      req.end();
    });
  }

  request(method, path, body) {
    return new Promise((resolve) => {
      if (!this.creds) return resolve({ status: 0, data: null });
      const data = body === undefined ? null : JSON.stringify(body);
      const headers = {
        Authorization: this._auth(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (data) headers['Content-Length'] = Buffer.byteLength(data);
      const req = https.request(
        { host: '127.0.0.1', port: this.creds.port, path, method, agent, headers, timeout: 5000 },
        (res) => {
          let buf = '';
          res.on('data', (c) => { buf += c; });
          res.on('end', () => {
            let parsed = null;
            try { parsed = buf ? JSON.parse(buf) : null; } catch (_) { parsed = buf; }
            const out = { status: res.statusCode, data: parsed };
            if (this.onCall) { try { this.onCall({ method, path, status: res.statusCode, req: body, res: parsed }); } catch (_) {} }
            resolve(out);
          });
        }
      );
      req.on('error', () => resolve({ status: 0, data: null }));
      req.on('timeout', () => req.destroy());
      if (data) req.write(data);
      req.end();
    });
  }
}

module.exports = { LCU, parseLockfile };
