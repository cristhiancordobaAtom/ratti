// Consulta issues de Jira asignados al usuario en los proyectos configurados.
// Usa la API REST v3 de Jira Cloud con autenticación básica (email + API
// token con scopes) — el mismo tipo de token que usa Bitbucket, creado en
// https://id.atlassian.com/manage-profile/security/api-tokens eligiendo
// "Jira" como app.

async function fetchJiraPRs(config) {
  if (!config.jira || !config.jira.enabled) return [];

  const { baseUrl, email, apiToken, projectKeys } = config.jira;
  const groupByProject = Boolean(
    config.jira.groupByProject || config.jira.groupByProjectName
  );
  if (!baseUrl || !email || !apiToken || !projectKeys || projectKeys.length === 0) {
    return [];
  }

  const authHeader =
    "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64");
  const headers = { Authorization: authHeader, Accept: "application/json" };

  const jql = `assignee = currentUser() AND project in (${projectKeys.join(
    ","
  )}) AND statusCategory != Done ORDER BY updated DESC`;

  try {
    const url = `${baseUrl.replace(/\/$/, "")}/rest/api/3/search/jql?jql=${encodeURIComponent(
      jql
    )}&maxResults=50&fields=summary,assignee,status,updated,project`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`[jira] HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    const issues = data.issues || [];

    return issues.map((issue) => {
      const projectKey = issue.fields.project ? issue.fields.project.key : "desconocido";
      const projectName = issue.fields.project ? issue.fields.project.name : "";
      // Si groupByProject está activo, mostramos "KEY · Nombre del proyecto" para que el widget agrupe con nombre legible.
      // Si está desactivado (false por defecto), dejamos solo projectKey ("KEY").
      const repoLabel =
        groupByProject && projectName
          ? `${projectKey} · ${projectName}`
          : projectKey;
      return {
        id: `jira:${issue.key}`,
        source: "Jira",
        repo: repoLabel,
        title: `[${issue.key}] ${issue.fields.summary}`,
        author: issue.fields.assignee ? issue.fields.assignee.displayName : "desconocido",
        url: `${baseUrl.replace(/\/$/, "")}/browse/${issue.key}`,
        updatedAt: issue.fields.updated,
        role: "asignado",
      };
    });
  } catch (err) {
    console.error("[jira] error consultando issues:", err.message);
    return [];
  }
}

module.exports = { fetchJiraPRs };
