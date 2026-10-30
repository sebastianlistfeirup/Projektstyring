import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listRepositoryIssues, repositoryIdentity } from '../server/git-issues.mjs';

test('GitHub import paginates, excludes PRs and retains repository identity and body', async () => {
  const urls = [];
  const result = await listRepositoryIssues({ owner: 'owner', repo: 'game', provider: 'github', token: 'test' }, async url => {
    urls.push(url);
    const page = new URL(url).searchParams.get('page');
    return Response.json(page === '1' ? Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `Issue ${i}`, body: 'Acceptance criteria', labels: [{ name: 'bug' }], ...(i === 0 ? { pull_request: {} } : {}) })) : [{ number: 101, title: 'Last', body: 'Details', html_url: 'https://github.com/owner/game/issues/101' }]);
  });
  assert.equal(urls.length, 2); assert.equal(result.items.length, 100); assert.equal(result.truncated, false);
  assert.equal(result.items[0].id, 2); assert.equal(result.items[0].description, 'Acceptance criteria');
  assert.deepEqual(result.items[0].labels, ['bug']);
  assert.equal(result.items.at(-1).repo, 'game'); assert.equal(result.items.at(-1).owner, 'owner');
});

test('GitLab nested groups use encoded project paths and invalid identities never fetch', async () => {
  const result = await listRepositoryIssues({ provider: 'gitlab', owner: 'group/subgroup', repo: 'game' }, async url => {
    assert.ok(url.includes('group%2Fsubgroup%2Fgame'));
    return Response.json([{ iid: 9, title: 'Fix', description: 'Body', labels: ['bug'] }]);
  });
  assert.equal(result.items[0].id, 9); assert.equal(result.items[0].description, 'Body');
  assert.throws(() => repositoryIdentity({ owner: 'https://wrong', repo: 'x' }), /gyldig/);
});
