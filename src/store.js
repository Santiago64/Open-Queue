'use strict';
// Guarda ajustes y vinculación en un JSON dentro de la carpeta de datos del usuario.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULTS = {
  settings: {
    autoAccept: { enabled: false, delay: 0 }, // delay en segundos (0..8)
    prePick: { championId: null },
    preBan: { championId: null },
    autoInvite: { enabled: false }, // aceptar solo las invitaciones a sala
    roles: { first: '', second: '' }, // rol principal y secundario para Normal y Clasificatoria
    // Hasta 3 favoritos. autoPick: si llega el final de tu turno sin pick, se elige uno solo.
    // useHistory: ordena y recomienda según tus partidas (y la línea que te tocó).
    favorites: { ids: [], autoPick: false, useHistory: false, when: 'end', autoRunes: false, runePageId: 0, rules: [], autoSpells: false, runeSets: {} }, // runeSets: { championId: página de runas armada en las reglas } // when: 'end' (segundo 0) | 'start' (apenas te toca)
  },
  pairing: { code: null, tokens: [] },
};

class Store {
  constructor(dir) {
    this.dir = dir || path.join(os.homedir(), '.open-queue');
    this.file = path.join(this.dir, 'config.json');
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this._load();
    if (!this.data.pairing.code) this.regenerateCode();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.settings = Object.assign({}, DEFAULTS.settings, raw.settings || {});
      this.data.settings.autoAccept = Object.assign({}, DEFAULTS.settings.autoAccept, (raw.settings || {}).autoAccept || {});
      this.data.settings.prePick = Object.assign({}, DEFAULTS.settings.prePick, (raw.settings || {}).prePick || {});
      this.data.settings.autoInvite = Object.assign({}, DEFAULTS.settings.autoInvite, (raw.settings || {}).autoInvite || {});
      this.data.settings.preBan = Object.assign({}, DEFAULTS.settings.preBan, (raw.settings || {}).preBan || {});
      this.data.settings.favorites = Object.assign({}, DEFAULTS.settings.favorites, (raw.settings || {}).favorites || {});
      if (!Array.isArray(this.data.settings.favorites.ids)) this.data.settings.favorites.ids = [];
      this.data.settings.roles = Object.assign({}, DEFAULTS.settings.roles, (raw.settings || {}).roles || {});
      this.data.pairing = Object.assign({}, DEFAULTS.pairing, raw.pairing || {});
    } catch (_) { /* primera vez */ }
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (_) { /* no es crítico */ }
  }

  get settings() { return this.data.settings; }

  regenerateCode() {
    this.data.pairing.code = String(crypto.randomInt(100000, 1000000));
    this.data.pairing.tokens = []; // desvincula los dispositivos anteriores
    this.save();
    return this.data.pairing.code;
  }

  get code() { return this.data.pairing.code; }

  newToken() {
    const t = crypto.randomBytes(24).toString('hex');
    this.data.pairing.tokens.push(t);
    if (this.data.pairing.tokens.length > 20) this.data.pairing.tokens.shift();
    this.save();
    return t;
  }

  hasToken(t) { return !!t && this.data.pairing.tokens.includes(t); }
}

module.exports = { Store };
