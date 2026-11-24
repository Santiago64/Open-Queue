#!/usr/bin/env node
'use strict';
// Verifica que el binario de Electron esté instalado antes de arrancar la app y lo repara si falta.
//
// Por qué existe: en una instalación nueva el binario puede no quedar instalado por dos motivos:
//  1. npm 11+ no ejecuta los scripts de instalación (postinstall) de los paquetes sin aprobarlos,
//     así que Electron nunca descarga su binario.
//  2. Con versiones de Node muy nuevas (no LTS), el descompresor que usa Electron puede cortar
//     la extracción después del primer archivo y deja la carpeta dist/ incompleta.
// Este script corre en cada `npm start`; si todo está bien termina en milisegundos.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const distDir = path.join(electronDir, 'dist');
const exeName = { win32: 'electron.exe', darwin: 'Electron.app/Contents/MacOS/Electron' }[process.platform] || 'electron';

function fail(msg) {
  console.error(`\n[Open Queue] ${msg}\n`);
  process.exit(1);
}

function isInstalled() {
  try {
    const version = require(path.join(electronDir, 'package.json')).version;
    const distVersion = fs.readFileSync(path.join(distDir, 'version'), 'utf8').replace(/^v/, '').trim();
    const pathTxt = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim();
    return distVersion === version && pathTxt === exeName && fs.existsSync(path.join(distDir, exeName));
  } catch {
    return false;
  }
}

function extractZip(zipPath) {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  if (process.platform === 'win32') {
    // Windows 10+ trae tar.exe (bsdtar), que sabe abrir .zip. Usamos la ruta completa para no
    // tomar otro tar del PATH (por ejemplo el de Git Bash, que no entiende rutas C:\).
    const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    try {
      execFileSync(sysTar, ['-xf', zipPath, '-C', distDir], { stdio: 'inherit' });
    } catch {
      const q = (s) => `'${s.replace(/'/g, "''")}'`;
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath ${q(zipPath)} -DestinationPath ${q(distDir)} -Force`], { stdio: 'inherit' });
    }
  } else {
    execFileSync('unzip', ['-oq', zipPath, '-d', distDir], { stdio: 'inherit' });
  }
  fs.writeFileSync(path.join(electronDir, 'path.txt'), exeName);
}

async function main() {
  if (!fs.existsSync(electronDir)) {
    fail('Faltan las dependencias. Ejecutá "npm install" en la carpeta de Open Queue y volvé a intentar.');
  }
  if (isInstalled()) return;

  console.log('[Open Queue] Preparando Electron (solo la primera vez, puede tardar un minuto)...');
  let zipPath;
  try {
    const { downloadArtifact } = require(require.resolve('@electron/get', { paths: [electronDir] }));
    const version = require(path.join(electronDir, 'package.json')).version;
    zipPath = await downloadArtifact({
      version,
      artifactName: 'electron',
      platform: process.platform,
      arch: process.arch,
      checksums: require(path.join(electronDir, 'checksums.json')),
    });
  } catch (e) {
    fail(`No se pudo descargar Electron (${e.message}). Revisá tu conexión a internet y probá de nuevo.`);
  }

  try {
    extractZip(zipPath);
  } catch (e) {
    fail(`No se pudo descomprimir Electron (${e.message}). Borrá la carpeta node_modules y volvé a abrir Open Queue.`);
  }

  if (!isInstalled()) {
    fail('Electron sigue sin instalarse. Borrá la carpeta node_modules, instalá Node.js LTS desde https://nodejs.org y volvé a abrir Open Queue.');
  }
  console.log('[Open Queue] Electron listo.');
}

main();
