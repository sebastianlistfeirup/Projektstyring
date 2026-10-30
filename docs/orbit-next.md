# Næste leverancer for Orbit

Målet er, at et eksisterende projekt kan gå fra gældende grundlag til afprøvet leverance med få, tydelige beslutninger fra ejeren. Arbejdet den 30. oktober 2026 etablerer denne kæde, men dokumenterer endnu ikke alle konti, Realmreads spil eller flere døgns modelarbejde. [Implementeret adfærd og kontroller](orbit-autonomy.md) er det aktuelle udgangspunkt.

Opfølgningen tilføjer kontoprøver i Orbits tilslutningspanel og en lokal performancemåling. Én rigtig HeyGen-pluginlevering er verificeret, mens de øvrige konti og den separate Orbit-adapter stadig mangler kontoprøver. Se [kontorapporten](verification/accounts-2026-10-30.json).

## Prioriteret restarbejde

| Prioritet | Konkret leverance | Hvornår er den færdig? |
|---|---|---|
| 1 | **Realmread: én rigtig opgave fra start til slut.** Tilknyt kode, gældende bibel og eksisterende build. Kortlæg restarbejde, fastlæg version 1 og vælg ét dokumenteret problem. | En ændring er gennemført på en isoleret gren, kontrolleret med projektets rigtige test/build, gennemgået af en anden egnet agent og spiltestet. Det oprindelige checkout er bevaret. Følg [pilotplanen](realmread-onboarding.md). |
| 2 | **Kontrolleret tilslutning af hver rigtig AI-konto.** Gem versionsspecifikke resultater for læsning, kodning, billeder, hændelser, MCP og betalingsadgang. | En lille relevant opgave består pr. kapabilitet. Orbit viser særskilt: installeret, logget ind, kapabilitet afprøvet og abonnement bekræftet. Ukendt bliver ikke vist som klar. |
| 3 | **Kvote og ventetid.** Understøt leverandørens dokumenterede kvote/reset, hvor den kan aflæses. Vis ventebegrundelse og mulighed for en anden allerede tilsluttet, egnet tjeneste. | En udtømt kvote starter ingen særskilt betalt fallback. Gentagne kald begrænses. Forløbet kan genoptages med samme grundlag, når adgang faktisk er tilbage. En ukendt kvote forbliver ukendt. |
| 4 | **Vedvarende transaktioner for længere autonomi.** Flyt kø, forsøg og kontrolpunkter til et transaktionelt joblager før flere workers. Bevar de eksisterende journaler som evidens. | Nedbrud før/efter claim, ekstern indsendelse, commit og kontrol kan genoprettes uden dobbeltleverancer. Leases har udløb og fencing. En 24-timers prøve med fejlindsprøjtning består på den konkrete release. |
| 5 | **Søgning i den versionerede bibel.** Indeksér dokumentafsnit med kilde, side/overskrift, hash og gyldighed. Skeln mellem gældende beslutninger, kladder og historik. | Svar og arbejdsordrer peger på de anvendte afsnit. En ændret bibel gør berørte planer synligt forældede. Store dokumenter kan findes uden lydløs afskæring. Hele originalen kan stadig åbnes. |
| 6 | **Fælles MCP-administration.** Vis server, værktøj, konto, adgangsområde og seneste resultat. Genbrug native konfiguration, hvor det er den understøttede vej. | En afgrænset prøve med en rigtig MCP-server består. Eksterne sideeffekter kræver passende mandat og en dokumenteret strategi for gentagelse; en læseopgave får ikke skriveadgang ved et adaptervalg. |
| 7 | **Medier som rigtige projektleverancer.** Lad Meshy, ElevenLabs og HeyGen returnere preview, kildejob, parametergrundlag og filer knyttet til arbejdsordren. | En 3D-, lyd- eller videofil kan produceres, åbnes, versionsmærkes og genskabes fra sit grundlag, inden for dokumenteret inkluderet forbrug. Ukendt indsendelsesstatus medfører ikke et nyt betalt job. |
| 8 | **Parallelt kodearbejde med kontrolleret integration.** Én worktree og afgrænset fil-/opgaveansvar pr. skriver; integration i en særskilt kø. | To uafhængige opgaver kan samles med konflikthåndtering og fuld kontrol af det samlede resultat. En bestået enkeltgren bliver ikke sidestillet med en bestået integration. |
| 9 | **Samtaleoplevelse på tværs af arbejdsformer.** Tilføj samtaleforgrening, tydelige sammenligninger, stemmeinput og bedre forhåndsvisning af dokumenter/medier. | Kladder, bilag, kildehenvisninger og relationen til arbejdsordren bevares ved skift og genindlæsning. Tastatur og mobil fungerer. Et almindeligt spørgsmål kræver ingen projektadministration. |
| 10 | **Udgivelsesklarhed frem for aktivitetstal.** Saml nødvendige spillerforløb, dokumenterede blokeringer, testet build og ændringer i scope. | Orbit kan vise, hvilket konkret spillerforløb der virker i hvilken build, hvad der mangler, og hvilke nye ønsker der flyttede målet. Antal agenter eller tekstmængde bliver ikke brugt som kvalitetsbevis. |

Punkt 1–3 giver først værdi med brugerens rigtige installation og konti. Punkt 4 er en forudsætning for at love robust drift i flere døgn; punkt 8 må ikke springe den forudsætning over.

## Tjenesterne skal have hver sin dokumenterede rolle

Alle ni ønskede tjenester skal kunne indgå, når de tilbyder en egnet, understøttet adgang. Det betyder ikke, at alle ni skal kaldes til hver opgave. Routing skal følge kapabilitet, tidligere dokumenteret resultat, tilgængelighed og brugerens betalingskrav.

| Tjeneste | Nuværende integrationsvej | Det manglende bevis før rigtig autonom brug |
|---|---|---|
| ChatGPT / Codex | Native lokal Codex CLI | Brugerens login, inkluderede kvote, faktisk kodeopgave og eventuelle MCP-servere. ChatGPT-appens fulde funktioner følger ikke automatisk med CLI-adgangen. |
| Claude | Native Claude Code CLI | Konto, tilladelser, kode/review og faktiske Agent-/MCP-hændelser i den installerede version. |
| Gemini | Native Gemini CLI | Konto, modeladgang og relevant arbejde med de konkrete værktøjstilladelser. |
| Kimi | Native Kimi Code CLI | Konto, inkluderet adgang og rigtig udførelse; analyseprofilens begrænsninger skal passe til opgaven. |
| Qwen | Native Qwen Code eller lokal Ollama | Adskilt prøve af coding-adapteren og tekst/vision via Ollama. Lokal tekstgenerering giver ikke i sig selv filværktøjer. |
| Grok Build | Native officiel CLI; transport afprøvet med 1.0.70 og lokal model-fixture | Windows-login, kontotest og inkluderet Build-kvote skal verificeres på brugerens konto. |
| Meshy | Medie-API med gemt indsendelsesstatus | Faktisk konto og om API-kald trækker på de ønskede inkluderede credits, plus validering af en rigtig 3D-leverance. |
| HeyGen | Medie-API med gemt indsendelsesstatus | Faktisk konto, API-adgangens forhold til abonnementet og gennemført video med download. |
| ElevenLabs | Medie-API og lokal lagring af lyd | Faktisk konto, inkluderede credits, stemmeadgang og gennemført lydleverance. |

Orbit må ikke erstatte manglende inkluderet adgang med særskilt usage-betaling. Hvis en leverandør ikke tilbyder den ønskede abonnementsvej, skal forbindelsen være utilgængelig under den betalingsregel. En indtastet API-nøgle er ikke dokumentation for et inkluderet produkt.

## Arbejdskortets næste visuelle trin

Det aktuelle kort viser jobs, afhængigheder, underagenter, værktøjshændelser og evidens. Næste udvidelse bør være klikbar sporbarhed:

**Versionsmål → beslutning → arbejdsordre → agentforsøg → fil/medie → kontrol → godkendt build.**

Ved valg af et element skal de relevante forbindelser fremhæves. Brugeren skal kunne svare på: Hvorfor udføres dette? Hvad venter det på? Hvad ændrede sig? Hvad er faktisk afprøvet? En tidsmarkør skal kunne vise den registrerede situation på et tidligere tidspunkt uden at vise senere evidens for tidligt.

En særskilt oversigt over version 1 bør vise leverancer og blokeringer. Livekortet viser udførelsen. Nye eksperimentelle visninger bør ligge bag et tilvalg, så chat, næste arbejde og projektets aktuelle mål fortsat er lette at finde.

## Mål, der kan afgøre om Orbit bliver bedre

- Andel arbejdsordrer, der består de aftalte kontroller ved første levering.
- Antal nødvendige brugerafbrydelser pr. godkendt leverance og årsagen til dem.
- Tid fra arbejdsordre til afprøvet resultat, inklusive kvoteventetid og review.
- Andel af genoptagelser, der bevarer færdigt arbejde uden gentagelse eller konteksttab.
- Antal aktive blokeringer og afprøvede spillerforløb frem mod Realmread version 1.
- Ændringer i scope sammenholdt med afsluttede, godkendte leverancer.

Sammenlign samme afgrænsede opgaver med det eksisterende Codex/Cursor-forløb. Kravet om at blive bedre skal afgøres af resultat, færre afbrydelser og kortere vej til en fungerende build.
