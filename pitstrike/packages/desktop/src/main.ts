/**
 * main.ts — PitStrike Electron main process.
 *
 * Responsibilities:
 * 1. Spawn the backend SSE server as a child process
 * 2. Open a BrowserWindow that loads the frontend (dev: localhost:5173 / prod: dist/index.html)
 * 3. Handle app lifecycle (ready, window-all-closed, activate)
 * 4. Auto-updater integration via electron-updater
 * 5. Expose IPC channels to renderer (mute audio, get config)
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { autoUpdater } from 'electron-updater';

// ── Constants ──────────────────────────────────────────────────────────────

const IS_DEV = !app.isPackaged;
const FRONTEND_DEV_URL = 'http://localhost:5173';
const BACKEND_SCRIPT = IS_DEV
  ? path.join(__dirname, '../../backend/dist/index.js')
  : path.join(process.resourcesPath, 'backend', 'index.js');

// ── State ──────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;

// ── Backend spawn ──────────────────────────────────────────────────────────

function startBackend(): void {
  if (backendProcess) return;

  backendProcess = spawn(process.execPath, [BACKEND_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: IS_DEV ? 'development' : 'production' },
  });

  backendProcess.stdout?.on('data', (d: Buffer) => {
    console.log('[backend]', d.toString().trim());
  });

  backendProcess.stderr?.on('data', (d: Buffer) => {
    console.error('[backend:err]', d.toString().trim());
  });

  backendProcess.on('exit', (code) => {
    console.warn(`[backend] exited with code ${String(code)}`);
    backendProcess = null;
  });
}

function stopBackend(): void {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// ── Window factory ─────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0b', // pit-bg
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false, // show after ready-to-show to avoid flash
  });

  if (IS_DEV) {
    void mainWindow.loadURL(FRONTEND_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../frontend/dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC handlers ───────────────────────────────────────────────────────────

ipcMain.handle('get-config', () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfgPath = IS_DEV
      ? path.join(__dirname, '../../../config.json')
      : path.join(process.resourcesPath, 'config.json');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(cfgPath) as unknown;
  } catch {
    return null;
  }
});

ipcMain.on('set-title', (_event, title: string) => {
  mainWindow?.setTitle(`PitStrike — ${title}`);
});

// ── App lifecycle ──────────────────────────────────────────────────────────

app.on('ready', () => {
  startBackend();
  createWindow();

  if (!IS_DEV) {
    autoUpdater.checkForUpdatesAndNotify().catch(console.error);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopBackend();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  stopBackend();
});
