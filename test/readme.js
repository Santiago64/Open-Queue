'use strict';
// Control del README: los videos de demo no se pueden perder (ya pasó una vez al subir archivos desde una copia vieja).
const fs = require('fs');
const path = require('path');
const md = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const need = ['https://youtu.be/WY_2kIYpCiA', 'https://youtu.be/uzNA9uWtmXg'];
const missing = need.filter((u) => !md.includes(u));
if (missing.length || /VIDEO_(PARTIDA|PRACTICE)_URL/.test(md)) {
  console.error('\nFALLÓ: el README perdió los videos de demo. Faltan: ' + (missing.join(', ') || '(quedó un VIDEO_..._URL de plantilla)'));
  process.exit(1);
}
console.log('  ✓ README: los dos videos de demo están en su lugar\n\nTODO OK (1 comprobaciones)');
