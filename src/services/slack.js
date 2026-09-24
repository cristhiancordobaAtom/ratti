// Detecta mensajes directos (DMs) y menciones recientes al usuario en cualquier
// canal al que tenga acceso. Usa la API de búsqueda de Slack (search.messages),
// que solo funciona con un User Token (xoxp-...) con el scope search:read
// — un Bot Token (xoxb-...) no puede usar esta API.

// Los IDs de Slack (canales, usuarios, DMs) tienen este patrón: una letra
// mayúscula seguida de 8+ caracteres alfanuméricos en mayúsculas.
const RAW_SLACK_ID = /^[UDCGW][A-Z0-9]{6,}$/;

let cachedUserId = null;
let cachedUsername = null;
let cachedTeamId = null;

async function getSlackUserInfo(token) {
  if (cachedUserId) return { userId: cachedUserId, username: cachedUsername, teamId: cachedTeamId };
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.ok) {
      cachedUserId = data.user_id;
      cachedUsername = data.user;
      cachedTeamId = data.team_id;
      return { userId: cachedUserId, username: cachedUsername, teamId: cachedTeamId };
    }
  } catch (err) {
    console.error("[slack] error obteniendo info de usuario:", err.message);
  }
  return { userId: null, username: null, teamId: null };
}

function humanizeText(text) {
  if (!text) return "";
  // Slack no traduce <@USERID> a un nombre legible en los resultados de búsqueda.
  return text.replace(/<@[A-Z0-9]+>/g, "@mención").trim();
}

function extractText(msg) {
  if (msg.text) return humanizeText(msg.text);
  if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
    const att = msg.attachments[0];
    return humanizeText(att.fallback || att.text || att.title || "");
  }
  return "(mensaje)";
}

function humanizeChannel(channel, author) {
  if (!channel || channel.is_im || !channel.name || RAW_SLACK_ID.test(channel.name)) {
    return author && author !== "desconocido" ? `@${author} (MD)` : "Mensaje directo";
  }
  return `#${channel.name}`;
}

function buildSlackDeepLink(msg, defaultTeamId) {
  const teamId = msg.team || defaultTeamId;
  const channelId = msg.channel ? msg.channel.id : null;
  if (teamId && channelId && msg.ts) {
    return `slack://channel?team=${teamId}&id=${channelId}&message=${msg.ts}`;
  }
  return msg.permalink || "";
}

async function fetchSlackMentions(config) {
  if (!config.slack || !config.slack.enabled) return [];

  const { userToken, mentionQuery } = config.slack;
  if (!userToken) return [];

  const headers = { Authorization: `Bearer ${userToken}` };
  const { userId, teamId } = await getSlackUserInfo(userToken);

  // Consultamos tanto mensajes directos ("to:me") como menciones explícitas en canales
  const queries = ["to:me"];
  if (userId) queries.push(`<@${userId}>`);
  if (mentionQuery && !queries.includes(mentionQuery)) {
    queries.push(mentionQuery);
  }

  // Ventana de tiempo (por defecto 30 minutos, configurable vía config.slack.cutoffMinutes)
  const cutoffMinutes = (config.slack && config.slack.cutoffMinutes) || 30;
  const cutoffSeconds = Date.now() / 1000 - cutoffMinutes * 60;

  try {
    const matchesMap = new Map();

    await Promise.all(
      queries.map(async (q) => {
        try {
          const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(
            q
          )}&sort=timestamp&sort_dir=desc&count=20`;
          const res = await fetch(url, { headers });
          const data = await res.json();
          if (data.ok && data.messages && Array.isArray(data.messages.matches)) {
            for (const msg of data.messages.matches) {
              // Excluimos mensajes enviados por el propio usuario
              if (userId && msg.user === userId) continue;

              const key = `${msg.channel ? msg.channel.id : "dm"}:${msg.ts}`;
              if (!matchesMap.has(key)) {
                matchesMap.set(key, msg);
              }
            }
          }
        } catch (err) {
          console.error(`[slack] error buscando query "${q}":`, err.message);
        }
      })
    );

    const results = [];
    for (const msg of matchesMap.values()) {
      if (parseFloat(msg.ts) < cutoffSeconds) continue;

      const author = msg.username || (msg.user && msg.user.name) || "desconocido";
      const isDM = !msg.channel || msg.channel.is_im || RAW_SLACK_ID.test(msg.channel.name);
      const repo = humanizeChannel(msg.channel, author);
      const deepLink = buildSlackDeepLink(msg, teamId);

      results.push({
        id: `slack:${msg.channel ? msg.channel.id : "dm"}:${msg.ts}`,
        source: "Slack",
        repo,
        title: extractText(msg).slice(0, 140),
        author,
        url: deepLink,
        webUrl: msg.permalink || "",
        updatedAt: new Date(parseFloat(msg.ts) * 1000).toISOString(),
        role: isDM ? "mensaje directo" : "mención",
      });
    }

    return results;
  } catch (err) {
    console.error("[slack] error consultando menciones:", err.message);
    return [];
  }
}

module.exports = { fetchSlackMentions };
