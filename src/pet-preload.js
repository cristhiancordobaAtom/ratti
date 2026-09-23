const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petAPI", {
  onDanceState: (callback) => {
    ipcRenderer.on("pet:dance-state", (_event, isDancing) => callback(isDancing));
  },
  onCount: (callback) => {
    ipcRenderer.on("pet:count", (_event, count) => callback(count));
  },
  requestState: () => ipcRenderer.send("pet:request-state"),
  openPanel: () => ipcRenderer.send("pet:open-panel"),
});
