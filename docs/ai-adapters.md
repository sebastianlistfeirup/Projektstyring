# Native AI-adaptere

Referencer kontrolleret 30. oktober 2026. Adapterstøtte er ikke det samme som verificeret login, kvote eller en gennemført rigtig modelopgave. Brug **Kontrollér installation** i forbindelsespanelet til en lokal versionskontrol uden modelkald. Login foretages i leverandørens eget værktøj; inkluderet abonnement og stop for ekstraforbrug bekræftes særskilt.

| Adapter | Udførelse | Analyse | Hændelser |
|---|---|---|---|
| Codex | `exec`, `workspace-write` | `read-only` | Codex JSONL: tekst, kommando, fil, MCP, underagent |
| Claude Code | `-p`, `acceptEdits` | `plan` | Claude stream-json: tekst, værktøj, underagent |
| Gemini CLI | `-p`, `auto_edit` | `plan` | Gemini stream-json: beskeder og værktøjer |
| Kimi Code | `-p` med native headless-policy | Eksplicit agentfil med kun Read, Grep og Glob | Kimi stream-json: assistant/tool-meddelelser |
| Qwen Code | `-p`, `auto-edit` | `plan` | Qwen stream-json i Claude-lignende format |
| Grok Build | `-p`, `acceptEdits` | `dontAsk`, kun Read/Grep/Glob; shell, edits, MCP og delegation afvises | `streaming-messages-json`: tekst, værktøjer og underagentreferencer |
| Qwen via Ollama | Tekstgenerering | Tekstgenerering | Tekstdelta; ingen fil-/værktøjsløkke |

Native MCP-konfiguration bevares. Kimi-analyseprofilen har bevidst kun læse- og søgeværktøjer; vilkårlige MCP-kald kan have sideeffekter. De øvrige værktøjers tilladelser og eventuelle shell-regler gælder fortsat. Orbit slår ikke deres generelle beskyttelser fra for at få et job gennemført. En separat kontrolkommando kan køres af Orbit efter kodning, og dens faktiske exitkode dokumenteres.

Qwen Code er en selvstændig forbindelse ved siden af lokal Qwen/Ollama. Den bruger den konfigurerede native konto; API-adgang er ikke automatisk inkluderet i et Qwen-chatabonnement. Grok Build har nu en native adapter: tom argumentskabelon vælger denne. Den tidligere blokering, der krævede en egen Grok-skabelon, er fjernet efter kontrol af den officielle CLI.

Grok Build installeres fra [leverandørens Windows-vejledning](https://docs.x.ai/build/overview), hvorefter `grok login` åbner browserlogin. Genstart Companion efter installation, så PATH opdateres, eller gem den fulde programsti under Grok Build. Kør derefter **Kontrollér installation** og **Kør én kontotest**. Der installeres ikke en tilfældig npm-pakke med navnet grok.

[Groks FAQ](https://docs.x.ai/grok/faq) beskriver Build i den fælles ugentlige brugspulje. Kontoplan, adgang og ekstraforbrug skal stadig kontrolleres på brugerens konto. Orbit fjerner `XAI_API_KEY`, `GROK_API_KEY` og `GROK_DEPLOYMENT_KEY` fra CLI-processens miljø; der er ingen automatisk overgang til xAI API-adapteren. Brugerdefinerede modeller med nøgler i Groks egen konfiguration er ikke dækket af denne miljøfiltrering og må ikke antages at være abonnementsdækkede. Grok-opdateringer og langtidshukommelse er slået fra i Orbit-processen. Skrivejobs bruger `acceptEdits`, ikke generel automatisk godkendelse; kommandoer, der kræver yderligere tilladelser, kan blive afvist.

Egne argumentskabeloner indeholder `{prompt}` og køres uden shell-fortolkning. De overtager selv tilladelser og outputformat; Orbit tilføjer ikke native adapterflag til dem. Tom skabelon gendanner standardadapteren. Programstier og modelvalg kan gemmes i forbindelsespanelet. Modelnavnet sendes med den native `--model`-indstilling.

## Upstream-grundlag

- [Gemini headless](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md), [CLI-indstillinger](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md) og [hændelsestyper](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/output/types.ts).
- [Kimi Code kommandoreference](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/reference/kimi-command.md), [agentprofiler](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/agents.md) og [JSON-skriver](https://github.com/MoonshotAI/kimi-code/blob/main/apps/kimi-code/src/cli/prompt-render.ts). Den gamle Python-baserede `kimi-cli` er arkiveret. Den aktuelle reference kan ikke kombinere `-p` med `--plan`; derfor bruger Orbit en eksplicit læseprofil i analysefasen.
- [Qwen Code headless](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/headless.md) beskriver promptflag, JSONL og `auto-edit`/`plan`. Installer den aktuelle Qwen Code separat, hvis den skal kode; Ollama-adapteren ændrer ikke karakter ved at vælge en større model.
- [Grok Build CLI](https://docs.x.ai/build/cli/reference), [headless](https://docs.x.ai/build/cli/headless-scripting), [tilladelser](https://docs.x.ai/build/features/permissions) og [indstillinger](https://docs.x.ai/build/settings/reference). `streaming-messages-json`, `--add-dir` og `--permission-mode` er også kontrolleret i den faktiske 1.0.70-binærs hjælp.

Ukendte hændelser ignoreres frem for at blive fremstillet som opfundne handlinger. En afsluttet `spawn_agent`-kommando betyder, at underagenten er oprettet; Orbit markerer først Codex-underagenten som færdig, når en terminal agentstatus modtages. En CLI-version med et andet outputformat skal afprøves og kan kræve en adapteropdatering.

## Afprøvet kommandogrænseflade

Den 30. oktober 2026 blev følgende rigtige npm-distributioner installeret isoleret på Linux og kørt med `--version` og `--help`: Codex 0.166.0, Claude Code 2.1.314, Gemini CLI 0.66.0, Kimi Code 2.4.1 og Qwen Code 0.26.4. Alle de flag, Orbit bygger til adapterne, findes i disse versioners hjælp. [Maskinlæsbar rapport](verification/native-cli-2026-10-30.json).

Kør `npm run test:cli` for samme kontrol af programmer på PATH. En særskilt installationsmappe kan vælges med `ORBIT_CLI_BIN`. Kontrollen sender ingen prompt og foretager hverken login, modelkald, MCP-kald eller kreditkontrol. Den er valgfri og installerer ikke programmer. Kimi 2.4.1 kræver Node.js 22.19 eller nyere; Node.js 24 anbefales til den samlede opsætning. Installerede Windows-versioner og egne CLI-skabeloner skal kontrolleres på den pågældende maskine.

Grok Build 1.0.70 er desuden kørt gennem Orbits `runChat` mod en lokal model-fixture med rigtig filadgang. Den særskilte kontrol kan gentages med `ORBIT_GROK_BIN=/sti/til/grok node --test scripts/test-ai-grok.mjs`. Den afprøver transport og tilladelser, ikke en rigtig Grok-konto, abonnementskvote eller Windows-installation. [Rapport](verification/grok-build-2026-10-30.json).

## Medier: fejlsøgning

Meshy bruger nu den dokumenterede `https://api.meshy.ai/openapi/v2/text-to-3d` til oprettelse og status, jf. [Text to 3D API](https://docs.meshy.ai/en/api/text-to-3d). Status-HTTP-fejl vises straks; en gemt kvittering genbruges uden ny bestilling. Den tidligere `/v1/text-to-3d` gav `NoMatchingRoute`/404.

ElevenLabs' `invalid_api_key` ved brug af et nøgle-ID forklares nu direkte: indsæt selve den hemmelige API-nøgle, som vises ved oprettelse, i Orbits ElevenLabs-felt. Nye nøgler starter med `sk_`; nøglens navn/ID kan ikke bruges som nøgle. Gemning bekræfter kun lokal lagring, og en særskilt kontotest skal bekræfte levering. Ingen rigtige Meshy-/ElevenLabs-kald er udført i denne rettelses testmiljø.
