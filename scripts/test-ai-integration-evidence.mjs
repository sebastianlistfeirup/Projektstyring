import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeMcpInventory, integrationEvidence } from '../server/ai-integration-evidence.mjs';

test('MCP inventory reports config only and never returns credentials or executable arguments', () => {
  const home = mkdtempSync(join(tmpdir(), 'orbit-mcp-evidence-'));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { blender: { command: 'secret-command', args: ['private-argument'], env: { TOKEN: 'secret-token' } }, remote: { url: 'https://user:password@example.com/?key=secret', headers: { Authorization: 'private' }, disabled: true } } }));
  const inventory = nativeMcpInventory('claude', home);
  assert.equal(inventory.status, 'read');
  assert.deepEqual(inventory.servers, [{ name: 'blender', transport: 'stdio', enabled: true, verification: 'unverified', probeSupported: true }, { name: 'remote', transport: 'http', enabled: false, verification: 'unverified', probeSupported: false }]);
  assert.doesNotMatch(JSON.stringify(inventory), /secret|password|private|example\.com/);
  assert.equal(nativeMcpInventory('gemini', home).status, 'not_found');
  assert.equal(nativeMcpInventory('kimi', home).status, 'unsupported');
});

test('Codex native inventory reads simple table names but not TOML values', () => {
  const home = mkdtempSync(join(tmpdir(), 'orbit-codex-mcp-'));
  mkdirSync(join(home, '.codex'));
  writeFileSync(join(home, '.codex/config.toml'), '[mcp_servers.blender]\ncommand = "secret-command"\n[mcp_servers.remote]\nurl = "https://secret.example"\nenabled = false\n[mcp_servers.remote.env]\nTOKEN = "private"\n');
  const inventory = nativeMcpInventory('codex', home);
  assert.deepEqual(inventory.servers.map(server => [server.name, server.transport, server.enabled]), [['blender', 'stdio', true], ['remote', 'http', false]]);
  assert.doesNotMatch(JSON.stringify(inventory), /secret|private/);
});

test('delivery evidence expires on configuration change and never establishes repository or MCP readiness', () => {
  const mcp = { status: 'read', servers: [{ name: 'blender', verification: 'unverified' }] };
  assert.equal(integrationEvidence(null, mcp).delivery, 'unverified');
  assert.equal(integrationEvidence({ status: 'passed', configurationChanged: true, scope: 'one_text_response' }, mcp).delivery, 'outdated');
  const verified = integrationEvidence({ status: 'passed', configurationChanged: false, scope: 'one_text_response' }, mcp);
  assert.equal(verified.delivery, 'verified');
  assert.equal(verified.scope, 'one_text_response');
  assert.equal(verified.repository, 'unverified');
  assert.equal(verified.mcp.servers[0].verification, 'unverified');
  assert.equal(verified.quota.status, 'unknown');
});
