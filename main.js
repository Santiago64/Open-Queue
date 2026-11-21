'use strict';
// App de escritorio de Open Queue (Electron). Abre una ventana y levanta el servidor local.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { startServer } = require('./src/server');

let win = null;
let server = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    try {
      server = await startServer({ dataDir: app.getPath('userData') });
    } catch (e) {
      console.error('No se pudo iniciar el servidor', e);
      app.quit();
      return;
    }
    Menu.setApplicationMenu(null);
    win = new BrowserWindow({
      width: 1000,
      height: 700,
      minWidth: 780,
      minHeight: 560,
      backgroundColor: '#0b0b0d',
      title: 'Open Queue',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    win.loadURL(`http://127.0.0.1:${server.port}/desktop`);
    win.on('closed', () => { win = null; });
  });

  app.on('window-all-closed', async () => {
    if (server) await server.close();
    app.quit();
  });
}
