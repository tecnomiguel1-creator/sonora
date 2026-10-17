'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nube', {
  guardar: (url) => ipcRenderer.invoke('nube:guardar', url),
  cerrar: () => ipcRenderer.send('nube:cerrar')
});
