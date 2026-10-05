// Desktop shell: the game is a browser build, so Electron serves it over the same
// zero-dependency static server instead of file:// (ES module imports need an origin).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startServer } = require('../server.cjs');

// 窗口图标用盘上那张 512 的真 PNG（assets/gen/gen_art.py 产，test/shape.test.mjs 钉着它
// 必须存在且解得出 IHDR）。不传这个 option 的话 taskbar/dock 一律退回 Electron 默认图标。
const WINDOW_ICON = path.join(__dirname, '..', 'icons', 'icon-512.png');

async function createWindow() {
  const server = await startServer({ port: 0 });
  const { port } = server.address();
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 780,
    minHeight: 600,
    backgroundColor: '#101217',
    title: '倒水量 Pour',
    icon: WINDOW_ICON,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  win.on('closed', () => server.close());
}

app.whenReady().then(() => {
  // macOS 的 dock 图标读的是 bundle，不是 BrowserWindow；setApplicationIconMask 不存在，
  // 但 dock 可用时在非打包态（electron .）里补一张，至少开发运行不再显示默认图标。
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(WINDOW_ICON);
  return createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
