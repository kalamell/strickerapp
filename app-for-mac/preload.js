'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Printer
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Firebase
  connectFirebase: (config) => ipcRenderer.invoke('connect-firebase', config),
  disconnectFirebase: () => ipcRenderer.invoke('disconnect-firebase'),
  fetchAllJobs: (opts) => ipcRenderer.invoke('fetch-all-jobs', opts),
  markPrinted: (opts) => ipcRenderer.invoke('mark-printed', opts),
  deleteJob: (opts) => ipcRenderer.invoke('delete-job', opts),

  // Print
  printSticker: (opts) => ipcRenderer.invoke('print-sticker', opts),

  // File picker
  selectKeyFile: () => ipcRenderer.invoke('select-key-file'),

  // Events from main process
  onFirebaseStatus: (cb) => ipcRenderer.on('firebase-status', (_, data) => cb(data)),
  onJobEvent: (cb) => ipcRenderer.on('job-event', (_, data) => cb(data)),

  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
