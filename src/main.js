const { app, Tray, Menu, Notification, shell, nativeImage, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const { fetchGithubPRs } = require("./services/github");
const { fetchBitbucketPRs } = require("./services/bitbucket");
const { fetchSlackMentions } = require("./services/slack");
const { fetchJiraPRs } = require("./services/jira");

const WIDGET_WIDTH = 380;
const WIDGET_HEIGHT = 580;

let tray = null;
let widgetWindow = null;
let petWindow = null;
let pollTimer = null;
let idleImage = null;
let danceFrames = [];
let danceTimer = null;
let danceFrameIndex = 0;
let currentPRs = []; // últimos PRs conocidos (para pintar el menú)
let seenIds = new Set(); // IDs ya notificados, para no repetir avisos
let dismissedIds = new Set(); // IDs (solo de Slack) que el usuario ya abrió y quiere ocultar

const userDataDir = app.getPath("userData");
const seenFilePath = path.join(userDataDir, "seen.json");
// En desarrollo (npm start) usamos config.json junto al package.json, para
// que sea fácil de editar. Una vez empaquetada, el .app vive en una carpeta
// de solo lectura, así que usamos la carpeta de datos de usuario del
// sistema en su lugar.
const configPath = app.isPackaged
  ? path.join(userDataDir, "config.json")
  : path.join(app.getAppPath(), "config.json");

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("No se pudo leer config.json. Copia config.example.json a config.json y complétalo.", err.message);
    return null;
  }
}

function loadSeen() {
  try {
    const raw = fs.readFileSync(seenFilePath, "utf-8");
    seenIds = new Set(JSON.parse(raw));
  } catch {
    seenIds = new Set();
  }
}

function saveSeen() {
  try {
    fs.writeFileSync(seenFilePath, JSON.stringify([...seenIds]), "utf-8");
  } catch (err) {
    console.error("No se pudo guardar seen.json:", err.message);
  }
}

function isLoginItemEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function toggleLoginItem() {
  const current = isLoginItemEnabled();
  app.setLoginItemSettings({ openAtLogin: !current });
}

function loadTrayFrames() {
  const framesDir = path.join(__dirname, "..", "assets", "frames");
  idleImage = nativeImage.createFromPath(path.join(framesDir, "tray-idle.png"));
  danceFrames = [];
  for (let i = 0; i < 6; i++) {
    const p = path.join(framesDir, `tray-dance-${i}.png`);
    if (fs.existsSync(p)) danceFrames.push(nativeImage.createFromPath(p));
  }
}

function startDancing() {
  if (danceTimer || danceFrames.length === 0) return;
  danceFrameIndex = 0;
  danceTimer = setInterval(() => {
    tray.setImage(danceFrames[danceFrameIndex % danceFrames.length]);
    danceFrameIndex++;
  }, 140);
}

function stopDancing() {
  if (danceTimer) {
    clearInterval(danceTimer);
    danceTimer = null;
  }
  if (tray && idleImage) tray.setImage(idleImage);
}

function updateDanceState() {
  if (currentPRs.length > 0) startDancing();
  else stopDancing();
}

function getPetBounds() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow.getBounds();
  return null;
}

// Calcula dónde poner el panel: pegado a la mascota (Ratti) si se pasan sus
// bounds, o en la esquina inferior derecha por defecto (clic en la bandeja).
function computeWidgetPosition(anchorBounds) {
  const width = WIDGET_WIDTH;
  const height = WIDGET_HEIGHT;

  // Con varios monitores cada pantalla tiene su propio offset (x, y) — hay
  // que ubicar el mismo display donde está Ratti y recortar contra SUS
  // bordes, no contra los de la pantalla primaria (si no, el panel podía
  // terminar "cayendo" hacia otro monitor).
  const display = anchorBounds
    ? screen.getDisplayMatching(anchorBounds)
    : screen.getPrimaryDisplay();
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

  if (!anchorBounds) {
    return { x: dx + dw - width - 20, y: dy + dh - height - 20 };
  }

  const gap = 12;
  const spaceRight = dx + dw - (anchorBounds.x + anchorBounds.width);
  const spaceLeft = anchorBounds.x - dx;

  // Abrimos al costado con más espacio libre (derecha por defecto en caso
  // de empate), para que el panel nunca quede recortado contra un borde.
  let x;
  if (spaceRight >= width + gap || spaceRight >= spaceLeft) {
    x = anchorBounds.x + anchorBounds.width + gap;
  } else {
    x = anchorBounds.x - width - gap;
  }

  // Centramos verticalmente el panel respecto a la mascota.
  let y = anchorBounds.y + anchorBounds.height / 2 - height / 2;

  if (x < dx) x = dx + 10;
  if (x + width > dx + dw) x = dx + dw - width - 10;
  if (y < dy) y = dy + 10;
  if (y + height > dy + dh) y = dy + dh - height - 10;

  return { x, y };
}

function showWidget(pos) {
  if (widgetWindow) {
    if (pos) widgetWindow.setPosition(pos.x, pos.y);
    widgetWindow.show();
    widgetWindow.focus();
  } else {
    createWidgetWindow(pos);
    widgetWindow.webContents.once("did-finish-load", () => {
      widgetWindow.webContents.send("prs-updated", currentPRs);
    });
  }
}


function createPetWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const size = 110;

  petWindow = new BrowserWindow({
    width: size,
    height: size,
    x: sw - size - 30,
    y: sh - size - 30,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "pet-preload.js"),
      contextIsolation: true,
    },
  });

  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.loadFile(path.join(__dirname, "pet.html"));
  petWindow.on("closed", () => {
    petWindow = null;
  });
}

function sendStateToPet() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("pet:dance-state", currentPRs.length > 0);
    petWindow.webContents.send("pet:count", currentPRs.length);
  }
}


function createWidgetWindow(pos) {
  const width = WIDGET_WIDTH;
  const height = WIDGET_HEIGHT;
  const { x, y } = pos || computeWidgetPosition(null);

  widgetWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "widget-preload.js"),
      contextIsolation: true,
    },
  });

  // Se mantiene visible sobre todos los espacios/escritorios (macOS).
  widgetWindow.setAlwaysOnTop(true, "floating");
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  widgetWindow.loadFile(path.join(__dirname, "widget.html"));
  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });
}

function toggleWidget() {
  if (widgetWindow) {
    widgetWindow.close();
  } else {
    createWidgetWindow();
    // Le mandamos el estado actual apenas termine de cargar.
    widgetWindow.webContents.once("did-finish-load", () => {
      widgetWindow.webContents.send("prs-updated", currentPRs);
    });
  }
}

function sendPRsToWidget() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send("prs-updated", currentPRs);
  }
}


function dismissPR(pr) {
  if (!pr || pr.source !== "Slack") return; // solo aplica a Slack
  if (dismissedIds.has(pr.id)) return;
  dismissedIds.add(pr.id);
  currentPRs = currentPRs.filter((p) => p.id !== pr.id);
  updateTray();
  updateDanceState();
  sendPRsToWidget();
  sendStateToPet();
}

function notifyNewPR(pr) {
  const isSlack = pr.source === "Slack";
  const title = isSlack
    ? "Nuevo mensaje en Slack"
    : pr.source === "Jira"
    ? "Nuevo issue asignado en Jira"
    : `Nuevo PR en ${pr.source}`;

  const body = isSlack
    ? `${pr.author} (${pr.repo}):\n${pr.title}`
    : `${pr.title}\n${pr.repo} · ${pr.author}`;

  const n = new Notification({
    title,
    body,
  });
  n.on("click", () => {
    if (pr.url) shell.openExternal(pr.url);
    dismissPR(pr);
  });
  n.show();
}

function buildTrayMenu() {
  if (currentPRs.length === 0) {
    return Menu.buildFromTemplate([
      { label: "Sin PRs abiertos", enabled: false },
      { type: "separator" },
      { label: widgetWindow ? "Ocultar widget" : "Mostrar widget", click: () => toggleWidget() },
      {
        label: "Iniciar con el sistema",
        type: "checkbox",
        checked: isLoginItemEnabled(),
        click: () => toggleLoginItem(),
      },
      { label: "Abrir carpeta de configuración", click: () => shell.showItemInFolder(configPath) },
      { label: "Actualizar ahora", click: () => pollNow() },
      { label: "Salir", click: () => app.quit() },
    ]);
  }

  // Agrupamos por fuente y, dentro de cada fuente, por repo/proyecto — así
  // ninguna fuente ni ningún repo con muchos PRs tapa a los demás.
  const bySource = { GitHub: [], Bitbucket: [], Jira: [], Slack: [] };
  for (const pr of currentPRs) {
    if (!bySource[pr.source]) bySource[pr.source] = [];
    bySource[pr.source].push(pr);
  }

  const items = [];
  for (const source of Object.keys(bySource)) {
    const prs = bySource[source];
    if (prs.length === 0) continue;

    items.push({ label: `${source} (${prs.length})`, enabled: false });

    const byRepo = {};
    for (const pr of prs) {
      if (!byRepo[pr.repo]) byRepo[pr.repo] = [];
      byRepo[pr.repo].push(pr);
    }

    for (const repo of Object.keys(byRepo)) {
      const repoPRs = byRepo[repo];
      items.push({
        label: `  ${repo} (${repoPRs.length})`,
        submenu: repoPRs.slice(0, 50).map((pr) => ({
          label: pr.title.slice(0, 80),
          click: () => {
            if (pr.url) shell.openExternal(pr.url);
            dismissPR(pr);
          },
        })),
      });
    }
    items.push({ type: "separator" });
  }

  return Menu.buildFromTemplate([
    ...items,
    { label: widgetWindow ? "Ocultar widget" : "Mostrar widget", click: () => toggleWidget() },
    {
      label: "Iniciar con el sistema",
      type: "checkbox",
      checked: isLoginItemEnabled(),
      click: () => toggleLoginItem(),
    },
    { label: "Abrir carpeta de configuración", click: () => shell.showItemInFolder(configPath) },
    { label: "Actualizar ahora", click: () => pollNow() },
    { label: "Salir", click: () => app.quit() },
  ]);
}

function updateTray() {
  const count = currentPRs.length;
  tray.setToolTip(count > 0 ? `${count} PR(s) / mención(es)` : "Sin novedades");
  tray.setTitle(count > 0 ? String(count) : "");
}

async function pollNow() {
  const config = loadConfig();
  if (!config) return;

  const [ghPRs, bbPRs, slackMsgs, jiraIssues] = await Promise.all([
    fetchGithubPRs(config),
    fetchBitbucketPRs(config),
    fetchSlackMentions(config),
    fetchJiraPRs(config),
  ]);

  const fetched = [...ghPRs, ...bbPRs, ...slackMsgs, ...jiraIssues].sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );

  // Las notificaciones ("seen") se calculan sobre TODO lo que llegó, para
  // no volver a avisar aunque el usuario lo haya descartado de la vista.
  const newOnes = fetched.filter((pr) => !seenIds.has(pr.id));
  for (const pr of newOnes) {
    notifyNewPR(pr);
    seenIds.add(pr.id);
  }
  if (newOnes.length > 0) saveSeen();

  // La lista VISIBLE excluye lo que el usuario ya descartó con un clic.
  currentPRs = fetched.filter((pr) => !dismissedIds.has(pr.id));

  // Limpiamos del set de descartados lo que ya no existe en la fuente
  // (por ejemplo, un mensaje de Slack que salió de la ventana de 15 min),
  // para que ese set no crezca sin límite.
  const fetchedIds = new Set(fetched.map((pr) => pr.id));
  dismissedIds = new Set([...dismissedIds].filter((id) => fetchedIds.has(id)));

  updateTray();
  updateDanceState();
  sendPRsToWidget();
  sendStateToPet();
}

function startPolling(config) {
  const minutes = (config && config.pollIntervalMinutes) || 5;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollNow, minutes * 60 * 1000);
}

ipcMain.on("pet:request-state", () => {
  sendStateToPet();
});

ipcMain.on("pet:open-panel", () => {
  showWidget(computeWidgetPosition(getPetBounds()));
});

ipcMain.on("widget:close", () => {
  if (widgetWindow) widgetWindow.close();
});

ipcMain.on("widget:open-pr", (event, pr) => {
  if (pr && pr.url) shell.openExternal(pr.url);
  dismissPR(pr);
});

ipcMain.on("widget:request-update", () => {
  sendPRsToWidget();
});

ipcMain.on("widget:refresh", () => {
  pollNow();
});

app.whenReady().then(() => {
  if (app.dock) app.dock.hide(); // solo icono de bandeja, sin ícono en el dock (macOS)

  loadTrayFrames();
  tray = new Tray(idleImage);
  tray.setToolTip("Ratti");

  // En macOS el clic simple en la barra de menú suele abrirla directamente,
  // pero también capturamos double-click y el clic derecho con la opción de
  // "Mostrar widget" al tope del menú contextual, para que siempre haya una
  // forma de abrir el panel.
  tray.on("click", () => showWidget());
  tray.on("double-click", () => showWidget());
  tray.on("right-click", () => tray.popUpContextMenu(buildTrayMenu()));

  createPetWindow();

  // La primera vez que corre como app instalada (empaquetada), activamos
  // el arranque automático por defecto. Usamos un archivo marcador para
  // no volver a forzarlo si el usuario luego lo desactiva a mano.
  if (app.isPackaged) {
    const firstRunMarker = path.join(userDataDir, ".login-item-set");
    if (!fs.existsSync(firstRunMarker)) {
      app.setLoginItemSettings({ openAtLogin: true });
      fs.writeFileSync(firstRunMarker, "1", "utf-8");
    }
  }

  // Si no existe un config.json (en userData si está empaquetada o en la raíz en dev),
  // lo creamos a partir del example incluido en la app para que el usuario solo tenga que editarlo.
  if (!fs.existsSync(configPath)) {
    try {
      const exampleSrc = path.join(app.getAppPath(), "config.example.json");
      if (fs.existsSync(exampleSrc)) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.copyFileSync(exampleSrc, configPath);
      }
    } catch (err) {
      console.error("No se pudo crear config.json inicial:", err.message);
    }
  }

  loadSeen();
  const config = loadConfig();
  updateTray();
  pollNow();
  startPolling(config);
});

app.on("window-all-closed", (e) => {
  // La app vive en la bandeja; no se cierra al no haber ventanas.
  e.preventDefault?.();
});
