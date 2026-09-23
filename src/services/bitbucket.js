// Consulta PRs abiertos en los repos configurados del workspace de Bitbucket.
// Usa la API REST 2.0 de Bitbucket con autenticación básica (email + API token
// con scopes). Los App Passwords de Bitbucket fueron descontinuados por
// Atlassian en 2026: https://support.atlassian.com/bitbucket-cloud/docs/api-tokens/

async function fetchBitbucketPRs(config) {
  if (!config.bitbucket || !config.bitbucket.enabled) return [];

  const { email, apiToken, workspace, repoSlugs } = config.bitbucket;
  if (!email || !apiToken || !workspace || !repoSlugs || repoSlugs.length === 0) {
    return [];
  }

  const authHeader =
    "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64");
  const headers = { Authorization: authHeader, Accept: "application/json" };

  const results = [];

  for (const slug of repoSlugs) {
    try {
      const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${slug}/pullrequests?state=OPEN&pagelen=50`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.error(`[bitbucket] ${slug}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const prs = data.values || [];

      for (const pr of prs) {
        results.push({
          id: `bitbucket:${slug}:${pr.id}`,
          source: "Bitbucket",
          repo: `${workspace}/${slug}`,
          title: pr.title,
          author: pr.author ? pr.author.display_name : "desconocido",
          url: pr.links && pr.links.html ? pr.links.html.href : "",
          updatedAt: pr.updated_on,
          role: "otro",
        });
      }
    } catch (err) {
      console.error(`[bitbucket] error consultando ${slug}:`, err.message);
    }
  }

  return results;
}

module.exports = { fetchBitbucketPRs };
