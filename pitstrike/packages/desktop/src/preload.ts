/**
 * preload.ts — Electron preload script.
 *
 * Exposes a minimal, typed API surface to the renderer via contextBridge.
 * The renderer (frontend React app) can call window.pitstrike.* safely.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface PitStrikeAPI {
  getConfig: () => Promise<unknown>;
  setTitle: (title: string) => void;
  platform: NodeJS.Platform;
}

contextBridge.exposeInMainWorld('pitstrike', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setTitle: (title: string) => ipcRenderer.send('set-title', title),
  platform: process.platform,
} satisfies PitStrikeAPI);
