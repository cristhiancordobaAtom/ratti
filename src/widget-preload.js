const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widgetAPI", {
  onPRsUpdated: (callback) => {
    ipcRenderer.on("prs-updated", (_event, prs) => callback(prs));
  },
  requestUpdate: () => ipcRenderer.send("widget:request-update"),
  openPR: (pr) => ipcRenderer.send("widget:open-pr", pr),
  close: () => ipcRenderer.send("widget:close"),
  refresh: () => ipcRenderer.send("widget:refresh"),
});
