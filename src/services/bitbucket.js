// Consulta PRs abiertos en los repos configurados del workspace de Bitbucket,
// filtrando únicamente los donde el usuario aparece como REVISOR solicitado.
// Usa la API REST 2.0 con autenticación básica (email + API token con scopes).
// Los App Passwords de Bitbucket fueron descontinuados por Atlassian en 2026.

async function fetchBitbucketPRs(config) {
  if (!config.bitbucket || !config.bitbucket.enabled) return [];

  const { email, displayName, apiToken, workspace, repoSlugs } = config.bitbucket;
  if (!email || !apiToken || !workspace || !repoSlugs || repoSlugs.length === 0) {
    return [];
  }

  const authHeader =
    "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64");
  const headers = { Authorization: authHeader, Accept: "application/json" };

  const results = [];

  for (const slug of repoSlugs) {
    try {
      // Pedimos los campos de reviewers para poder filtrar localmente.
      const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${slug}/pullrequests?state=OPEN&pagelen=50&fields=values.id,values.title,values.author.display_name,values.reviewers.display_name,values.links.html,values.updated_on`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.error(`[bitbucket] ${slug}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const prs = data.values || [];

      for (const pr of prs) {
        const isAuthor = displayName && pr.author && pr.author.display_name === displayName;
        const isReviewer =
          displayName &&
          Array.isArray(pr.reviewers) &&
          pr.reviewers.some((r) => r.display_name === displayName);

        const onlyReviewRequests = Boolean(
          config.bitbucket.onlyReviewRequests || config.bitbucket.onlyReviewer
        );

        // Si onlyReviewRequests está activo y se configuró displayName,
        // solo incluimos PRs donde el usuario figura como revisor solicitado — y excluimos los que él mismo abrió.
        if (onlyReviewRequests) {
          if (displayName && (!isReviewer || isAuthor)) continue;
        }

        const role = isAuthor ? "autor" : isReviewer ? "revisor" : "otro";

        results.push({
          id: `bitbucket:${slug}:${pr.id}`,
          source: "Bitbucket",
          repo: `${workspace}/${slug}`,
          title: pr.title,
          author: pr.author ? pr.author.display_name : "desconocido",
          url: pr.links && pr.links.html ? pr.links.html.href : "",
          updatedAt: pr.updated_on,
          role,
        });
      }
    } catch (err) {
      console.error(`[bitbucket] error consultando ${slug}:`, err.message);
    }
  }

  return results;
}

module.exports = { fetchBitbucketPRs };
