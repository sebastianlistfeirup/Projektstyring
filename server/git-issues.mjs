export function repositoryIdentity({ provider = 'github', owner, repo }) {
  if (!['github', 'gitlab'].includes(provider) || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(owner ?? '') || !/^[\w.-]+$/.test(repo ?? '')) throw new Error('Angiv gyldig ejer/gruppe og repository.');
  return { provider, owner, repo };
}

export async function listRepositoryIssues(config, request = fetch) {
  const identity = repositoryIdentity(config), items = [];
  const { provider, owner, repo } = identity;
  const deadline = AbortSignal.timeout(110000);
  for (let page = 1; page <= 100; page++) {
    const path = provider === 'gitlab'
      ? `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/issues?state=opened&per_page=100&page=${page}`
      : `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open&per_page=100&page=${page}`;
    const headers = provider === 'gitlab' ? (config.token ? { 'PRIVATE-TOKEN': config.token } : {}) : { Accept: 'application/vnd.github+json', ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) };
    const response = await request(path, { headers, signal: AbortSignal.any([deadline, AbortSignal.timeout(15000)]) });
    if (!response.ok) throw new Error(`${provider === 'gitlab' ? 'GitLab' : 'GitHub'} svarede ${response.status}. Kontrollér adgang og repository.`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Repository returnerede en ugyldig issue-liste.');
    for (const issue of data) {
      if (issue.pull_request) continue;
      items.push({ id: provider === 'gitlab' ? issue.iid : issue.number, title: issue.title, description: issue.body ?? issue.description ?? '', state: issue.state, url: issue.html_url ?? issue.web_url, labels: (issue.labels ?? []).map(label => typeof label === 'string' ? label : label.name), updatedAt: issue.updated_at, ...identity });
    }
    if (data.length < 100) return { items, truncated: false };
  }
  return { items, truncated: true };
}
