# Native AI-adaptere

Referencer kontrolleret 30. oktober 2026. Adapterstøtte er ikke det samme som verificeret login, kvote eller en gennemført rigtig modelopgave. Brug **Kontrollér installation** i forbindelsespanelet til en lokal versionskontrol uden modelkald. Login foretages i leverandørens eget værktøj; inkluderet abonnement og stop for ekstraforbrug bekræftes særskilt.

| Adapter | Udførelse | Analyse | Hændelser |
|---|---|---|---|
| Codex | `exec`, `workspace-write` | `read-only` | Codex JSONL: tekst, kommando, fil, MCP, underagent |
| Claude Code | `-p`, `acceptEdits` | `plan` | Claude stream-json: tekst, værktøj, underagent |
| Gemini CLI | `-p`, `auto_edit` | `plan` | Gemini stream-json: beskeder og værktøjer |
| Kimi Code | `-p` med native headless-policy | Eksplicit agentfil med kun Read, Grep og Glob | Kimi stream-json: assistant/tool-meddelelser |
| Qwen Code | `-p`, `auto-edit` | `plan` | Qwen stream-json i Claude-lignende format |
| Qwen via Ollama | Tekstgenerering | Tekstgenerering | Tekstdelta; ingen fil-/værktøjsløkke |

Native MCP-konfiguration bevares. Kimi-analyseprofilen har bevidst kun læse- og søgeværktøjer; vilkårlige MCP-kald kan have sideeffekter. De øvrige værktøjers tilladelser og eventuelle shell-regler gælder fortsat. Orbit slår ikke deres generelle beskyttelser fra for at få et job gennemført. En separat kontrolkommando kan køres af Orbit efter kodning, og dens faktiske exitkode dokumenteres.

Qwen Code er en selvstændig forbindelse ved siden af lokal Qwen/Ollama. Den bruger den konfigurerede native konto; API-adgang er ikke automatisk inkluderet i et Qwen-chatabonnement. Grok-posten kræver en eksplicit, fungerende CLI-skabelon. En xAI API-nøgle alene dokumenterer heller ikke abonnementsdækning.

Egne argumentskabeloner indeholder `{prompt}` og køres uden shell-fortolkning. De overtager selv tilladelser og outputformat; Orbit tilføjer ikke native adapterflag til dem. Tom skabelon gendanner standardadapteren. Programstier og modelvalg kan gemmes i forbindelsespanelet. Modelnavnet sendes med den native `--model`-indstilling.

## Upstream-grundlag

- [Gemini headless](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md), [CLI-indstillinger](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md) og [hændelsestyper](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/output/types.ts).
- [Kimi Code kommandoreference](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/reference/kimi-command.md), [agentprofiler](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/agents.md) og [JSON-skriver](https://github.com/MoonshotAI/kimi-code/blob/main/apps/kimi-code/src/cli/prompt-render.ts). Den gamle Python-baserede `kimi-cli` er arkiveret. Den aktuelle reference kan ikke kombinere `-p` med `--plan`; derfor bruger Orbit en eksplicit læseprofil i analysefasen.
- [Qwen Code headless](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/headless.md) beskriver promptflag, JSONL og `auto-edit`/`plan`. Installer den aktuelle Qwen Code separat, hvis den skal kode; Ollama-adapteren ændrer ikke karakter ved at vælge en større model.

Ukendte hændelser ignoreres frem for at blive fremstillet som opfundne handlinger. En afsluttet `spawn_agent`-kommando betyder, at underagenten er oprettet; Orbit markerer først Codex-underagenten som færdig, når en terminal agentstatus modtages. En CLI-version med et andet outputformat skal afprøves og kan kræve en adapteropdatering.

## Afprøvet kommandogrænseflade

Den 30. oktober 2026 blev følgende rigtige npm-distributioner installeret isoleret på Linux og kørt med `--version` og `--help`: Codex 0.166.0, Claude Code 2.1.314, Gemini CLI 0.66.0, Kimi Code 2.4.1 og Qwen Code 0.26.4. Alle de flag, Orbit bygger til adapterne, findes i disse versioners hjælp. [Maskinlæsbar rapport](verification/native-cli-2026-10-30.json).

Kør `npm run test:cli` for samme kontrol af programmer på PATH. En særskilt installationsmappe kan vælges med `ORBIT_CLI_BIN`. Kontrollen sender ingen prompt og foretager hverken login, modelkald, MCP-kald eller kreditkontrol. Den er valgfri og installerer ikke programmer. Kimi 2.4.1 kræver Node.js 22.19 eller nyere; Node.js 24 anbefales til den samlede opsætning. Installerede Windows-versioner og egne CLI-skabeloner skal kontrolleres på den pågældende maskine.
