# Orbit: pålidelig projektudførelse

Denne ændring samler projektets arbejdsordre, AI-kørsel, isoleret Git-gren og dokumentation i chatten. `done` på en kørsel betyder leveret til gennemgang. En almindelig opgave bliver ikke automatisk godkendt som færdig.

## Kom i gang

1. Brug Node.js 22.13 eller nyere (24 LTS anbefales), Git og `npm ci`.
2. Start Companion og app med `npm run dev`. Windows: `scripts/Start-Orbit.bat`.
3. Åbn Orbit-chatten og tilslut dine lokale coding-værktøjer. Login foretages med leverandørens eget værktøj.
4. Bekræft kun inkluderet abonnementsforbrug, når du har kontrolleret kontoen og deaktiveret ekstraforbrug hos leverandøren. Et almindeligt chatabonnement dokumenterer ikke i sig selv API-adgang.
5. Opret/vælg projektet og en chat. Tilknyt en ren, lokal Git-mappe under **Repository og kvalitetskontroller**. Gem egne ændringer først.
6. Upload bibel, dokumenter eller screenshots. Tekst fra PDF/DOCX kan bruges som bibelkladde. Vælg **Gør kladden gældende** for at fastlægge en version.
7. Vælg en arbejdsordre og kør Auto. Orbit viser jobs, afhængigheder, underagenter, værktøjshændelser, commit og faktiske testresultater.

Direkte chat med én tjeneste er til læsning/rådgivning. Repositoryændringer køres gennem Auto, så arbejdet har en isoleret arbejdsgren og en gemt leverance. Codex, Claude, Gemini og Qwen Code bruger native læsetilstand i analysefaser; Kimi bruger en eksplicit profil med læse-/søgeværktøjer. Brugerdefinerede CLI-skabeloner og andre værktøjers egne tilladelser skal også være korrekt konfigureret.

## Hvad kørselsmotoren garanterer i den implementerede sti

- Planer valideres for dublerede id'er, ugyldige afhængigheder og cykler før udførelse.
- Afhængige jobs starter kun efter vellykkede forgængere. Fejl kan give `partial`, `blocked` eller `error`; de bliver ikke skjult som succes.
- En plan, der afventer godkendelse, starter aldrig på grund af timeout.
- Lukning af fanen aflyser ikke Auto. **Stop** sender en særskilt afbrydelse til serveren og den lokale proces.
- Companion opdaterer arbejdsordrens status og leverancebevis, selv når browseren er lukket. Projektets gemte scope, afhængigheder, WIP-grænse, repository, kontroller og gældende bibel bruges som grundlag.
- Præciseringer og nye vedhæftninger kan sendes fra den samme chat under arbejdet. De gemmes og gælder fra næste job; en allerede startet agent får ikke efterfølgende instruktioner ind i sin oprindelige prompt.
- Status og strukturelle hændelser gemmes på disk, med heartbeat hvert tiende sekund. En afbrudt Companion-kørsel markeres som afbrudt ved næste opstart.
- Genoptagelse bevarer bibel, instruktioner, tidligere resultater, dependencygraf og arbejdsmappe. Der startes ikke et nyt tomt projekt. Genoptagelse er eksplicit, fordi en ekstern handling kan være sket før nedbruddet.
- Hver repository-kørsel bruger `orbit/<run-id>` i en separat Git-worktree. Den oprindelige mappe bliver ikke ændret af Orbits Git-operationer.
- Der er én skrivende jobkæde ad gangen. Flere kodere skriver ikke parallelt i samme checkout.
- Fejlede kodeforsøg bevares på `orbit-attempt/<run-id>/<job-id>`, før arbejdsgrenen føres tilbage. Uafhængigt arbejde arver derfor ikke fejlens kodeændringer.
- Konfigurerede kontroller udføres som faktiske programmer med argumentlister, uden shell-fortolkning. Exitkoder og output gemmes. Fejlede kontroller blokerer den samlede leverance.
- Hvis en kontrol ændrer versionsstyrede filer, kan den ikke godkende det allerede gemte commit. Det vises som en fejl.
- Med afgrænsede rettelsesforsøg aktiveret kan en faktisk fejlet kontrol udløse ét ekstra coding-job inden for den oprindelige arbejdsordre. De samme kontrolkommandoer køres igen; begge gennemløb gemmes med commit og output. Manglende programmer, ændringer fra selve kontrollen og fortsatte fejl blokerer leverancen. Genoptagelse nulstiller ikke reparationsgrænsen.
- En models kvalitetsscore er et review-signal. Den erstatter ikke tests, build eller spiltest.

Grænser: højst 100 jobs i en plan, én CLI-proces højst 60 minutter, hver konfigureret kontrol højst 10 minutter og højst 20 MB stdout pr. CLI-job. Store opgaver skal opdeles. Der er ikke implementeret en generel døgnkørende multiworker-platform, automatisk kvotefornyelse eller automatisk merge/deploy.

## Tjenester og betaling

Alle eksterne transports kræver `billingMode: included` og `noExtraCharges: true`. Ukendt og særskilt forbrugsbetaling afvises. Den tidligere `allowPaidApis`-genvej giver ikke længere adgang, heller ikke i den ældre opgaveassistent.

Ollama regnes kun som lokal ved en loopback-adresse og en model uden kendt cloudmarkering. Eksterne endpoints, cloudnavne og modeller med `remote_host` kræver samme abonnementsbekræftelse. Dette er ikke en aflæsning af leverandørens faktura eller en kontrol af en vilkårlig lokal proxy.

| Forbindelse | Implementeret transport | Begrænsning |
|---|---|---|
| Codex / ChatGPT | Lokal Codex CLI | Eget login og faktisk abonnement skal fungere; dette er ikke en kopi af alle ChatGPT-funktioner. |
| Claude | Lokal Claude Code CLI | Native værktøjer/MCP og Agent-hændelser. |
| Gemini | Lokal Gemini CLI | Installeret, konfigureret CLI kræves. |
| Kimi | Lokal Kimi CLI | Installeret, konfigureret CLI kræves. |
| Qwen Code | Lokal Qwen Code CLI | Repositoryværktøjer og native MCP; egen konto og betaling skal valideres. |
| Qwen lokal | Lokal Ollama | Tekstgenerering; ingen generel fil-/kommando-værktøjsløkke. |
| Grok | Konfigurerbar CLI / særskilt xAI API-adapter | Katalogposten er ikke dokumentation for en officiel abonnementsdækket CLI. Skal valideres konkret; API er ikke automatisk inkluderet i Grok-abonnementet. |
| Meshy | API-job med gemt provider-id og GLB | Inkluderede API-credits og stop for ekstraforbrug skal kontrolleres på kontoen. |
| HeyGen | API-job med avatar-/stemme-id og lokal MP4 | Kontoens API-adgang og credits skal kontrolleres. |
| ElevenLabs | API-lydproduktion | Kontoens inkluderede credits og overage-indstillinger skal kontrolleres. |

Orbit måler ikke leverandørernes faktiske resterende kvoter. UI viser brugerens bekræftelse og aktivitetsantal, aldrig et opdigtet beløb på 0 kr. Arvede standardmiljøvariable til forbrugsbetalte model-API'er fjernes ved start af CLI-processer; native CLI-konfiguration kan stadig påvirke konto/betaling og skal kontrolleres hos leverandøren.

Meshy/HeyGen gemmer hensigt og jobkvittering. Efter genoptagelse bruges det eksisterende job-id. Hvis forbindelsen forsvandt før kvitteringen, stopper Orbit med en forklaring frem for at indsende samme produktion igen. En afbrudt lokal kørsel annullerer ikke nødvendigvis et allerede accepteret job hos leverandøren.

## MCP og livevisning

De fem native coding-adaptere bevarer deres egen MCP-konfiguration ved udførelse. Kimis analyseprofil begrænser værktøjer til læsning og søgning. Codex JSONL samt Claude, Gemini, Kimi og Qwen Code stream-json oversættes til offentlige værktøjs- og agenthændelser i Orbit Live. [Adapterkontrakter og installation](ai-adapters.md) beskriver flag og begrænsninger. Ukendte eventtyper ignoreres; eventformater fra andre CLI-versioner skal afprøves.

Arbejdskortet grupperer opgaver efter deres afhængigheder. En valgt opgave viser registrerede værktøjshændelser, underagenter, ventebegrundelse og leverance; tjenester kan fremhæves på tværs af forløbet. Kodecommit og faktisk udførte kontroller står særskilt. Heartbeat dokumenterer en svarende kørselsmotor, ikke model-fremdrift. Historik bevarer registrerede tidspunkter, og genafspilning viser først evidens ved den relevante hændelse. Den tidligere konstellation kan stadig vælges.

Der er endnu ikke en fælles MCP-servermanager eller en universal tool-calling-loop for alle modeller. Livekortet viser de strukturerede hændelser, adapteren modtager. Det opfinder ikke underagenter, og det viser ikke modellernes interne ræsonnementer.

## Bibel, billeder og beslutninger

- Hver projektkørsel gemmer identiteten på bibelversion, arbejdsordre og projektets beslutningsnoter med SHA-256, versionsmål og scope. Beslutningsnoter medsendes i fuld længde; øvrige notetyper bliver ikke automatisk til krav. Genoptagelse bevarer dette grundlag.
- Jobkontekstfiler læses kun fra kørselsmappen, inklusive kontrol af symlinks. Hele UTF-8-filer medsendes inden for dokumenterede grænser (20 filer, 1 MB pr. fil, 4 MB i alt); manglende, binære og større filer forklares eksplicit til agenten og vises på arbejdskortet.
- Den komplette bibel gemmes med kørslen. Tidligere hårde afskæringer på 6.000 tegn er fjernet fra kørselskonteksten.
- Kørsels- og tjenestehukommelse er adskilt pr. projekt. Ældre global hukommelse importeres ikke automatisk til et projekt.
- Lange CLI-instruktioner gemmes i en kontekstfil, som agenten instrueres i at læse, så Windows' argumentgrænse ikke skærer teksten af.
- Bibelkladde og gældende version er adskilt. De seneste 30 publicerede versioner bevares.
- PDF udtrækkes med sidehenvisninger; DOCX udtrækkes som tekst. Billedbaserede PDF'er kræver OCR, som endnu ikke er implementeret.
- Vedhæftninger gemmes på serveren og rehydreres ved senere ture. Browserens vilkårlige lokale filstier accepteres ikke som uploadreferencer.
- Markdown vises med lister, tabeller og kodeblokke. Modeloutput får ikke lov at indsætte rå HTML. Store jobresultater vises som tydeligt markerede uddrag med link til fuld eksport.

## Data og gendannelse

Companion gemmer seneste workspace i `~/.orbit/workspace.json` med atomisk filudskiftning. Også chat, bibler, noter og øvrige vedvarende store-felter udløser synkronisering. Ekstra samlinger har særskilte ændringstider, så en gammel fane ikke overskriver en nyere bibel med en ældre kopi. Dette er stadig ikke et transaktionelt flerbruger-dokumentredigeringssystem: samtidige ændringer i samme ekstra samling bruger seneste ændringstid.

Opgaver, projekter og sprints flettes pr. id og ændringstid. Sletninger har særskilte tidsstempler, så en gammel fane hverken fjerner nye serveropgaver eller genopretter allerede slettede opgaver. En nyere gendannelse kan genoprette elementet. Ældre klienter uden sletningsmetadata kan fortsat tilføje og opdatere, men skal opgraderes for at synkronisere sletninger.

Backupformat v2 inkluderer workspace, AI-historik, leverancedokumenter, hukommelse, uploads, producerede medier og almindelige vedhæftninger. Filer har SHA-256-kontrol. Alle stier og hashes valideres før filgendannelse, som stages og rulles tilbage ved fejl under mappeudskiftningen. Gendannelse er en erstatning, ikke almindelig tidsstempel-fletning. Den aktuelle servertilstand sikkerhedskopieres først.

Backup **udelader** credentials, native OAuth-caches, Companion-konfiguration (herunder integrationsopsætning, promptbibliotek og triggere), eksterne repositories og Git-worktrees. Worktrees på samme maskine bevares ved gendannelse. Flytning til en anden maskine kræver separat Git-backup og ny tilslutning af konti. En historisk kørsel uden sin oprindelige mappe kan læses, men ikke genoptages. Backup har en grænse på 256 MB; store mediebiblioteker kræver separat filbackup. Den er ikke en automatisk komplet maskinbackup.

AI-kontrol, backup og Companion-konfiguration kræver lokal adgang fra en lokal Orbit-origin. Remote AI-webhooks er derfor ikke åbne fra internettet. Netværksdeling af andre projektfunktioner findes fortsat, men er ikke en erstatning for en komplet sikkerhedsrevision af alle legacy-integrationer.

## Kontrol før brug til rigtigt projekt

```sh
npm ci
npm run build
npm run lint
npm run test:imports
npm run test:workspace
npm run test:ai
```

AI-tests bruger lokale falske agenter og mockede mediesvar. De afprøver faktisk Git, filændringer, subprocesser, HTTP, genstart, backup og kontrolkommandoer uden betalte kald. De dokumenterer ikke kvaliteten af en rigtig model eller gyldigheden af dit abonnement.

En særskilt varighedstest holder godkendelsespausen åben og kontrollerer heartbeat, ingen jobstart og bevaret bibel, før den sender en eksplicit godkendelse:

```sh
ORBIT_SOAK_MINUTES=12 node scripts/soak-ai.mjs
```

På Windows sættes miljøvariablen med PowerShell: `$env:ORBIT_SOAK_MINUTES='12'`. CI kører build og tests på Linux og Windows. Native provider-login, Windows-launcherens faktiske proceshåndtering, Godot og Realmread kræver afprøvning på den rigtige installation.

## Næste arkitekturtrin

1. Verificér en rigtig Realmread-opgave fra arbejdsordre til build og manuel spiltest.
2. Indfør et vedvarende joblager med leases, idempotens og kontrolleret recovery, før flere workers eller maskiner tilføjes.
3. Verificér adapterkatalogets kapabiliteter mod de installerede versioner og konti: filadgang, tests, billeder, browser, MCP, 3D, lyd og video.
4. Tilføj versionsbaseret dokumentsøgning med kildehenvisninger og kontekstbudget; bevar hele biblen som autoritativ kilde.
5. Tilføj leverandørspecifik kvote-/reset-aflæsning, hvor der findes understøttede interfaces. Ukendt må fortsat være ukendt.
6. Udvid først parallel kodning med separat worktree pr. job og en integration-/testkø. Flere samtidige svar er ikke det samme som verificeret fremdrift.
7. Byg fælles MCP-konfiguration og værktøjstilladelser samt bedre mediepreview, samtaleforgrening og stemmeinput. Funktionerne findes ikke fuldt ud i denne ændring.

## Verifikation udført under udviklingen

30. oktober 2026: Linux-build, lint uden fejl (eksisterende React-advarsler), 21 importkontroller, 4 workspace-tests og 47 server-/AI-tests bestod. Otte Playwright-forløb er afprøvet med rigtig Chromium: upload af bibel på over 6.000 tegn, offentliggørelse af bibelversion, repositorytilknytning, reel filkontrol, genindlæsning under udførelse, bevaret kilde-checkout, status til gennemgang, et fejlet forløb, der forblev fejlet i chatten, præcisering og filupload efter genindlæsning, serverafslutning med lukket browser, projektoprettelse på mobil, projektgennemgang med import uden dubletter samt sletning og gendannelse på tværs af åbne faner samt arbejdskortets afhængigheder, historik, tastatur og mobilvisning samt en reel testfejl med afgrænset automatisk rettelse og bevaret kontrolhistorik. Det tidligere checkpoint bestod også GitHub-kontrollerne på Windows efter en rettelse af absolutte programstier.

Godkendelsespausen blev desuden afprøvet i 12 faktiske minutter med 144 stikprøver. Ingen jobstart skete før eksplicit godkendelse. Dette er en afgrænset varighedstest med en lokal prøveagent, ikke dokumentation for flere døgns autonomi med rigtige udbydere.

Browserkontroller: `npx playwright install chromium` efterfulgt af `npm run test:browser`. De starter isolerede testservere på 5173/4310 og kræver ledige porte. Lokale testdata ligger i en separat midlertidig mappe.
