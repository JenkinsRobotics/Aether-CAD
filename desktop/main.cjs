const { app, BrowserWindow, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { startServer } = require('./server.cjs');

let runtime;
if (process.env.AETHER_DESKTOP_TEST_PROFILE) app.setPath('userData', process.env.AETHER_DESKTOP_TEST_PROFILE);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const win = BrowserWindow.getAllWindows()[0]; if (win) { win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
    const serviceRoot = app.isPackaged ? path.join(resources, 'cad-service') : path.join(resources, 'build/desktop-service/cad-service');
    // A stable origin retains IndexedDB file grants and crash recovery between launches.
    const settingsFile = path.join(app.getPath('userData'), 'runtime-port.json');
    let port = 0;
    try { port = JSON.parse(await fs.readFile(settingsFile, 'utf8')).port; } catch {}
    runtime = await startServer({ root: path.join(resources, 'dist'), service: path.join(serviceRoot, process.platform === 'win32' ? 'cad-service.exe' : 'cad-service'), node: process.execPath, port });
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(settingsFile, JSON.stringify({ port: Number(new URL(runtime.origin).port) }));
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents.getURL().startsWith(runtime.origin + '/') && permission === 'fileSystem'));
    const win = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 600, title: 'Aether CAD', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== runtime.origin) event.preventDefault(); });
    await win.loadURL(runtime.origin);
  }).catch(error => { dialog.showErrorBox('Aether CAD could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => runtime?.close());
}
