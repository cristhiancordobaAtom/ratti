# Ratti 🐭

App de escritorio (macOS/Windows) que revisa periódicamente tus PRs abiertos
en **GitHub** y **Bitbucket**, tus issues asignados en **Jira**, y menciones
a ti en **Slack**, y te avisa con:

- Una mascota animada (Ratti, la ratita) flotando en el escritorio: quieta
  si no hay nada, bailando si hay novedades.
- Un ícono en la barra de menú (macOS) / bandeja (Windows) con contador.
- Notificaciones nativas del sistema.
- Un panel con el detalle, agrupado por fuente y por repo/canal.

Clic izquierdo en Ratti o en el ícono de la bandeja abre el panel. Clic
derecho abre el menú (actualizar, ocultar, iniciar con el sistema, salir).

## 1. Requisitos

- [Node.js](https://nodejs.org) 18 o superior instalado.

## 2. Instalación (modo desarrollo)

```bash
cd pr-notifier
npm install
```

## 3. Configuración

Copia el archivo de ejemplo y complétalo con tus datos:

```bash
cp config.example.json config.json
```

**Dónde vive `config.json` según cómo corras la app** (importante, es la
fuente de la mayoría de las confusiones):

- Corriendo con `npm start` (desarrollo): `config.json` junto al
  `package.json`, en la raíz del proyecto.
- Corriendo como app instalada (después de `npm run dist:mac`): la app crea
  su propio `config.json` en la carpeta de datos de usuario del sistema, la
  primera vez que abre. En Mac:
  `~/Library/Application Support/ratti/config.json`
  (el nombre de la carpeta es el `name` del `package.json`, en minúsculas —
  no "Ratti"). Puedes llegar ahí fácil sin recordar la ruta: clic
  derecho en el ícono de la bandeja → **"Abrir carpeta de configuración"**.

Son dos archivos **independientes** — si cambias uno, el otro no se entera.

### Dónde sacar cada token

| Servicio  | Dónde generarlo | Tipo |
|-----------|------------------|------|
| GitHub    | https://github.com/settings/tokens | Personal Access Token (classic o fine-grained) |
| Bitbucket | https://id.atlassian.com/manage-profile/security/api-tokens | API token **con scopes** → app **Bitbucket** |
| Jira      | https://id.atlassian.com/manage-profile/security/api-tokens | API token **clásico** (botón simple "Create API token") |
| Slack     | https://api.slack.com/apps | User Token (`xoxp-...`) de una app propia |

Los detalles de cada uno (scopes exactos, pasos) están más abajo, en la
sección de cada servicio.

### Campos de `config.json`

- **pollIntervalMinutes**: cada cuántos minutos se sondean las 3 fuentes
  (por defecto 5). Ojo: las menciones de Slack solo se detectan si llegaron
  en los **últimos 15 minutos** antes del sondeo (ver más abajo), así que no
  conviene poner un intervalo mayor a eso.

**GitHub**
- **github.token**: un Personal Access Token (classic o fine-grained) con
  permiso de lectura sobre `pull requests` de tus repos.
  Créalo en https://github.com/settings/tokens
- **github.username**: tu usuario de GitHub. Se notifican los PRs donde eres
  **autor** o **revisor solicitado**. Si lo dejas vacío, se notifican TODOS
  los PRs abiertos de los repos listados.
- **github.onlyReviewRequests**: *(opcional, boolean, por defecto `false`)*. Si está en `true`,
  filtra para mostrar únicamente los PRs donde eres revisor solicitado (excluyendo los que creaste).
- **github.repos**: lista de repos en formato `"organizacion/repo"`.

**Bitbucket**
- **bitbucket.apiToken**: Bitbucket ya NO usa App Passwords (Atlassian los
  descontinuó: dejaron de crearse en sept. 2025 y de funcionar en jun. 2026).
  Crea un **API token con scopes** en
  https://id.atlassian.com/manage-profile/security/api-tokens →
  "Create API token with scopes" → elige **Bitbucket** como app → marca los
  scopes `read:pullrequest:bitbucket`, `read:repository:bitbucket` y
  `read:account`.
- **bitbucket.email**: el correo de tu cuenta de Atlassian (para la API REST
  va con el email, no con tu username de Bitbucket).
- **bitbucket.displayName**: *(opcional)* tu nombre tal cual aparece en Bitbucket
  (ej. `"Tu Nombre"`), necesario para detectar si eres autor o revisor solicitado.
- **bitbucket.onlyReviewRequests**: *(opcional, boolean, por defecto `false`)*. Si está en `true`
  y se configuró `displayName`, solo muestra PRs donde figuras como revisor solicitado.
- **bitbucket.workspace** y **repoSlugs**: el workspace y los repos a
  monitorear (el slug es el nombre que aparece en la URL del repo).

**Slack**
- **slack.userToken**: para detectar menciones a ti en **cualquier** canal
  (no uno fijo), se usa la API de búsqueda de Slack, que solo funciona con
  un **User Token** (`xoxp-...`), no con un Bot Token (`xoxb-...`).
  1. Ve a https://api.slack.com/apps → "Create New App" → **"Blank app"**
     (no "AI agent" ni "Starter app").
  2. Menú lateral → "OAuth & Permissions".
  3. **No actives** la sección "Advanced token security via token
     rotation" — si la activas, Slack te da un token rotativo
     (`xoxe.xoxp-...`) que expira cada 12h y no sirve para esta app.
  4. Baja hasta "Scopes" → **"User Token Scopes"** (no "Bot Token Scopes")
     → agrega el scope `search:read`.
  5. Arriba, "Install to Workspace" → copia el **"User OAuth Token"**
     (debe empezar solo con `xoxp-`, sin `xoxe.` adelante).
- **slack.mentionQuery**: tu `@usuario` de Slack, tal cual te autocompleta
  cuando alguien escribe `@` y te selecciona (ej. `"@omar.hernandez"`). Lo
  encuentras en tu perfil de Slack → "Editar tu perfil" → campo "Username".
- Solo se muestran menciones de los **últimos 15 minutos** en cada sondeo,
  para no reprocesar historial viejo — es normal que una mención
  "desaparezca" sola pasado ese tiempo si no le hiciste clic.
- **Al hacer clic en una mención de Slack** (desde el panel o el menú), se
  abre el link y esa mención se quita de la lista al instante, aunque
  sigan sin cumplirse los 15 minutos. Esto es exclusivo de Slack — los PRs
  de GitHub/Bitbucket no se ocultan al hacerles clic, siguen apareciendo
  mientras sigan abiertos.

**Jira**
- **jira.baseUrl**: la URL de tu sitio de Jira Cloud, ej.
  `"https://tu-empresa.atlassian.net"`.
- **jira.apiToken**: usa un **API token clásico** (no el "with scopes"), en
  https://id.atlassian.com/manage-profile/security/api-tokens → botón simple
  **"Create API token"**. Los tokens "with scopes" (los que sí sirven para
  Bitbucket) exigen elegir el sitio y los scopes exactos al crearlos, y si
  eso no queda bien configurado, la API devuelve `200 OK` pero con listas
  vacías (sin error visible) aunque el usuario sí tenga acceso a esos
  proyectos desde el navegador — el token clásico evita ese problema porque
  hereda los mismos permisos que tu cuenta.
- **jira.email**: el correo de tu cuenta de Atlassian (igual que en
  Bitbucket).
- **jira.projectKeys**: lista de claves de proyecto a monitorear (la que
  aparece como prefijo en los issues, ej. `"PROJ"` en `PROJ-123`).
- **jira.groupByProject**: *(opcional, boolean, por defecto `false`)*. Si está en `true`,
  agrupa en el widget y en la bandeja con el formato `"CLAVE · Nombre completo del proyecto"`
  en vez de solo la clave.
- Se notifican los issues donde sos el **assignee** y que no están en una
  columna de tipo "Done" (según la categoría de estado del workflow).

Puedes desactivar cualquier servicio poniendo `"enabled": false` en su
sección.

## 4. Probar en desarrollo

```bash
npm start
```

Deberías ver a Ratti en la esquina inferior derecha del escritorio
(arrastra para moverlo) y el ícono en la barra de menú/bandeja.

### Si no te llegan notificaciones pop-up

Como en desarrollo la app corre sin firmar, macOS la registra como
**"Electron"**, no como "Ratti". Si no ves avisos:

1. Ve a **Ajustes del Sistema → Notificaciones**.
2. Busca **"Electron"** en la lista.
3. Actívale "Permitir notificaciones".

(Una vez empaquetada como app instalada, aparece con su propio nombre y
esto deja de ser un problema).

### Si macOS bloquea la app como "malware"

Esto puede pasar por versiones viejas/con bugs conocidos de Electron
detectadas erróneamente por XProtect — no por nada de este código. La
versión de Electron que usa este proyecto (43+) no tiene ese problema
reportado. Si aun así te pasa:

```bash
xattr -rc .        # o: find . -exec xattr -c {} \;  si tu xattr no soporta -r
rm -rf node_modules package-lock.json
npm install
```

## 5. Generar la app instalable

Para macOS (genera un `.dmg` en `dist/`):

```bash
npm run dist:mac
```

Para Windows (genera un instalador `.exe` en `dist/`; corre este comando
en Windows, o usa un runner de CI):

```bash
npm run dist:win
```

Luego, en macOS: abre el `.dmg` y arrastra **Ratti** a Aplicaciones.
Como no está firmada por Apple (firmar cuesta una membresía de desarrollador
paga), es probable que el primer intento de abrirla falle — clic derecho
sobre la app → **"Abrir"** → confirmar, en vez de doble clic normal.

**Primer arranque de la app instalada:**
- Se crea automáticamente un `config.json` de partida (copiado del
  `config.example.json` incluido) en la carpeta de datos de usuario — vas a
  tener que editarlo con tus datos reales aunque ya lo hubieras hecho en
  desarrollo, son archivos distintos (ver sección 3).
- Queda activado por defecto el arranque automático al iniciar sesión (lo
  puedes confirmar o desactivar desde el menú → "Iniciar con el sistema").

### Depurar la app instalada

Al abrirla con doble clic no hay ninguna terminal donde ver los logs. Para
verlos, corre el ejecutable directo:

```bash
/Applications/Ratti.app/Contents/MacOS/Ratti
```

Vas a ver ahí los mismos mensajes `[github]`, `[bitbucket]`, `[slack]` que
en desarrollo, útiles para diagnosticar errores de configuración o tokens.

## 6. Notas de seguridad

- `config.json` guarda tus tokens **en texto plano** en tu disco. No lo
  subas a ningún repositorio (ya está pensado para quedar fuera de
  `package.json > files` y del `.gitignore`).
- Si prefieres no guardar tokens en un archivo, se puede adaptar el
  proyecto para leerlos desde el llavero del sistema (`keytar`) — es un
  cambio adicional, avisa si lo quieres.

## 7. Personalización rápida

- **La mascota (Ratti)**: las imágenes están en `assets/pet-idle.png` y
  `assets/pet-dance-0.png` a `pet-dance-5.png` (120x120), y las versiones
  chicas para la bandeja en `assets/frames/tray-idle.png` y
  `tray-dance-0.png` a `tray-dance-5.png` (22x22). Reemplázalas por lo que
  quieras, manteniendo esos nombres y tamaños.
- **Ícono de la app** (el que se ve en Aplicaciones/Finder):
  `assets/icon.png` (1024x1024).
- **Frecuencia de sondeo**: `pollIntervalMinutes` en `config.json`.
- **Qué cuenta como "tu" PR en GitHub**: autor o revisor solicitado
  (`src/services/github.js`).
- **Tamaño/posición del panel o de Ratti**: `createWidgetWindow()` y
  `createPetWindow()` en `src/main.js`.
