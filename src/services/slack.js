// Detecta menciones recientes al usuario (@tu-usuario) en cualquier canal
// al que tenga acceso. Usa la API de búsqueda de Slack (search.messages),
// que solo funciona con un User Token (xoxp-...) con el scope search:read
// — un Bot Token (xoxb-...) no puede usar esta API.

// Los IDs de Slack (canales, usuarios, DMs) tienen este patrón: una letra
// mayúscula seguida de 8+ caracteres alfanuméricos en mayúsculas.
const RAW_SLACK_ID = /^[UDCGW][A-Z0-9]{6,}$/;

function humanizeText(text) {
  if (!text) return "";
  // Slack no traduce <@USERID> a un nombre legible en los resultados de
  // búsqueda — lo dejamos como una mención genérica.
  return text.replace(/<@[A-Z0-9]+>/g, "@mención").trim();
}

function humanizeChannel(channel) {
  if (!channel || !channel.name || RAW_SLACK_ID.test(channel.name)) {
    return "Mensaje directo";
  }
  return `#${channel.name}`;
}

async function fetchSlackMentions(config) {
  if (!config.slack || !config.slack.enabled) return [];

  const { userToken, mentionQuery } = config.slack;
  if (!userToken || !mentionQuery) return [];

  const headers = { Authorization: `Bearer ${userToken}` };

  // Solo nos interesan menciones de los últimos 15 minutos, para no
  // reprocesar historial viejo en cada sondeo.
  const cutoffSeconds = Date.now() / 1000 - 15 * 60;

  try {
    const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(
      mentionQuery
    )}&sort=timestamp&sort_dir=desc&count=20`;
    const res = await fetch(url, { headers });
    const data = await res.json();

    if (!data.ok) {
      console.error(`[slack] ${data.error}`);
      return [];
    }

    const matches = (data.messages && data.messages.matches) || [];
    const results = [];

    for (const msg of matches) {
      if (parseFloat(msg.ts) < cutoffSeconds) continue;

      results.push({
        id: `slack:${msg.channel ? msg.channel.id : "dm"}:${msg.ts}`,
        source: "Slack",
        repo: humanizeChannel(msg.channel),
        title: (humanizeText(msg.text) || "(mensaje sin texto)").slice(0, 140),
        author: msg.username || (msg.user && msg.user.name) || "desconocido",
        url: msg.permalink || "",
        updatedAt: new Date(parseFloat(msg.ts) * 1000).toISOString(),
        role: "otro",
      });
    }

    return results;
  } catch (err) {
    console.error("[slack] error consultando menciones:", err.message);
    return [];
  }
}

module.exports = { fetchSlackMentions };
