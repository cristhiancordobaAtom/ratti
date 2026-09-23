// Consulta PRs abiertos en los repos configurados donde el usuario es
// autor o revisor solicitado. Usa la API REST de GitHub.

async function fetchGithubPRs(config) {
  if (!config.github || !config.github.enabled) return [];

  const { token, username, repos } = config.github;
  if (!token || !repos || repos.length === 0) return [];

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const results = [];

  for (const repo of repos) {
    try {
      const url = `https://api.github.com/repos/${repo}/pulls?state=open&per_page=50`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.error(`[github] ${repo}: HTTP ${res.status}`);
        continue;
      }
      const prs = await res.json();

      for (const pr of prs) {
        const isAuthor = username && pr.user && pr.user.login === username;
        const isRequestedReviewer =
          username &&
          Array.isArray(pr.requested_reviewers) &&
          pr.requested_reviewers.some((r) => r.login === username);

        // Si no se configuró username, se incluyen todos los PRs del repo.
        if (username && !isAuthor && !isRequestedReviewer) continue;

        results.push({
          id: `github:${repo}:${pr.number}`,
          source: "GitHub",
          repo,
          title: pr.title,
          author: pr.user ? pr.user.login : "desconocido",
          url: pr.html_url,
          updatedAt: pr.updated_at,
          role: isAuthor ? "autor" : isRequestedReviewer ? "revisor" : "otro",
        });
      }
    } catch (err) {
      console.error(`[github] error consultando ${repo}:`, err.message);
    }
  }

  return results;
}

module.exports = { fetchGithubPRs };
