import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';

const sources = {
  claude: { relative: '.claude.json', format: 'json' },
  gemini: { relative: '.gemini/settings.json', format: 'json' },
  'qwen-code': { relative: '.qwen/settings.json', format: 'json' },
  codex: { relative: '.codex/config.toml', format: 'toml' },
};

// Internal configuration resolver. Never serialize this result into an API response.
export function nativeMcpConfiguration(serviceId, serverName, home = homedir()) {
  const source = sources[serviceId];
  if (!source || source.format !== 'json') throw new Error('Prøven understøtter kun stdio-servere i Claude, Gemini og Qwens JSON-brugerkonfiguration.');
  if (typeof serverName !== 'string' || !serverName || serverName.length > 100) throw new Error('Vælg en server fra den aflæste konfiguration.');
  const path = join(home, source.relative), stat = statSync(path);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Konfigurationen kan ikke aflæses.');
  const config = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  if (!config?.mcpServers || !Object.hasOwn(config.mcpServers, serverName)) throw new Error('Serveren findes ikke længere i brugerkonfigurationen.');
  return validateMcpSettings(config.mcpServers[serverName], home);
}

function validateMcpSettings(settings, home) {
  if (!settings || typeof settings !== 'object' || settings.disabled === true) throw new Error('Serveren er deaktiveret eller ugyldig.');
  if (typeof settings.command !== 'string' || !settings.command.trim() || settings.command.length > 4096 || settings.url || settings.httpUrl) throw new Error('Denne prøve understøtter kun lokale stdio-servere.');
  const args = settings.args ?? [];
  if (!Array.isArray(args) || args.length > 100 || args.some(value => typeof value !== 'string' || value.length > 16384 || value.includes('\0'))) throw new Error('Serverens argumenter kan ikke bruges til denne prøve.');
  if (settings.env && (typeof settings.env !== 'object' || Array.isArray(settings.env) || Object.entries(settings.env).some(([name, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== 'string' || value.length > 16384 || value.includes('\0')))) throw new Error('Serverens miljøvariabler kan ikke bruges til denne prøve.');
  if (settings.cwd !== undefined && (typeof settings.cwd !== 'string' || !isAbsolute(settings.cwd))) throw new Error('Serverens arbejdsmappe skal være en absolut sti.');
  if ([settings.command, ...args, ...Object.values(settings.env ?? {}), settings.cwd ?? ''].some(value => /\$\{|%[A-Za-z_][A-Za-z0-9_]*%|^~[\\/]|\0/.test(value))) throw new Error('Prøven understøtter konkrete stier og værdier; native variabeludvidelser skal afprøves i tjenestens CLI.');
  return { command: settings.command, args, env: settings.env ?? {}, cwd: settings.cwd ?? home, fingerprint: createHash('sha256').update(JSON.stringify(settings)).digest('hex') };
}

// Inventory only: never execute a configured command or expose arguments,
// URLs, environment values, headers or tokens from native configuration.
export function nativeMcpInventory(serviceId, home = homedir()) {
  const source = sources[serviceId];
  if (!source) return { status: 'unsupported', servers: [], note: 'Denne adapters native konfiguration aflæses ikke af Orbit endnu.' };
  const file = join(home, source.relative);
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return { status: 'unreadable', servers: [], note: 'Konfigurationen kunne ikke aflæses inden for størrelsesgrænsen.' };
    const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const servers = [];
    if (source.format === 'json') {
      const config = JSON.parse(text);
      const entries = config?.mcpServers;
      if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
        for (const [name, settings] of Object.entries(entries).slice(0, 100)) {
          if (!settings || typeof settings !== 'object') continue;
          let probeSupported = false;
          try { validateMcpSettings(settings, home); probeSupported = true; } catch { /* Unsupported configuration remains listed, never executed. */ }
          servers.push({ name: name.slice(0, 100), transport: typeof settings.command === 'string' ? 'stdio' : typeof settings.url === 'string' || typeof settings.httpUrl === 'string' ? 'http' : 'unknown', enabled: settings.disabled !== true, verification: 'unverified', probeSupported });
        }
      }
    } else {
      // Deliberately recognize only simple native server tables, not TOML values.
      // Unsupported names/complex tables remain unverified in the CLI itself.
      let current = null;
      for (const line of text.split(/\r?\n/)) {
        const section = line.match(/^\s*\[mcp_servers\.(?:([A-Za-z0-9_-]+)|"([A-Za-z0-9_. -]+)")\]\s*(?:#.*)?$/);
        if (section) {
          current = { name: (section[1] ?? section[2]).slice(0, 100), transport: 'unknown', enabled: true, verification: 'unverified' };
          if (servers.length < 100) servers.push(current);
        } else if (/^\s*\[/.test(line)) current = null;
        else if (current) {
          if (/^\s*command\s*=/.test(line)) current.transport = 'stdio';
          else if (/^\s*url\s*=/.test(line)) current.transport = 'http';
          else if (/^\s*enabled\s*=\s*false\s*(?:#.*)?$/.test(line)) current.enabled = false;
        }
      }
    }
    return { status: 'read', source: `~/${source.relative}`, servers, note: 'Brugerkonfiguration er aflæst. Konfiguration alene dokumenterer ikke forbindelse eller adgang; se den enkelte servers prøve. Projektkonfiguration aflæses ikke her.' };
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'not_found' : 'unreadable', servers: [], note: error.code === 'ENOENT' ? 'Ingen understøttet brugerkonfiguration fundet. Projektets egne MCP-servere kan stadig være tilgængelige i CLI’en.' : 'Native konfiguration kunne ikke aflæses. Kontrollér den i tjenestens CLI.' };
  }
}

export function integrationEvidence(report, mcp) {
  const current = report?.status === 'passed' && report.configurationChanged === false;
  return {
    checkedAt: new Date().toISOString(),
    delivery: current ? 'verified' : report?.configurationChanged ? 'outdated' : 'unverified',
    scope: current ? report.scope : null,
    repository: 'unverified',
    mcp,
    quota: { status: 'unknown', remaining: null, resetsAt: null },
  };
}
