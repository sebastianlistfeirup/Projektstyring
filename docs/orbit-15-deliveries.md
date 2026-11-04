# Orbit: 15 forbedringer med acceptkriterier

Bestilt 4. november 2026. Tabellen viser de konkrete ændringer under hvert punkt og deres praktiske grænser. Slutkontrollerne og Windows-pakken fremgår af pull requestens CI-resultater. Denne liste erstatter ikke de tidligere 20 produktønsker.

| # | Leverance | Acceptkriterium | Implementeret og afgrænset |
|---|---|---|---|
| 1 | Transaktionelt joblager | Kø og kørsel kan genåbnes efter afbrydelse; migrering og backup bevarer data. | SQLite er autoritativt; migrering, claims, ejerproces, genstart og gendannelse er afprøvet. |
| 2 | Beskyttelse mod gentagelser | En ukendt ekstern indsendelse genbestilles ikke automatisk; samtidigt claim giver højst én ejer. | Gemte mediereservationer og kvitteringer forhindrer automatisk genbestilling, også efter gendannelse af gammel backup. Native CLI-sideeffekter er ikke generelt deduplikeret. |
| 3 | Uforanderlige resultater | Originalfilen kan overskrives, uden at et tidligere resultat ændres; kildejob og hash følger leverancen. | Streamet SHA-256-arkiv med versionsadresser, kildejob, commit og HTTP Range. 256 MB pr. fil, 512 MB pr. worktree-job. |
| 4 | Lokal fejlhåndtering | En fejl i Live eller preview kan genoprettes uden at kassere samtalens kladde. | Paneler og previews har lokal genopretning. Mislykket besked bevarer teksten; noteskladder gemmes lokalt. Nye ændringer under første indlæsning bevares uden at genoplive gamle data fra før en gendannelse. |
| 5 | Forståelig arbejdsstatus | Aktivitet, ventebegrundelse og brugerens næste handling fremgår i samme arbejdsflade. | Fælles vurdering af forbindelsen og heartbeat; ingen LIVE/ETA-påstand ved forældet status. Beslutning og næste handling vises. |
| 6 | Samlet visuelt design | Arbejdsflade og centrale kontroller følger fælles stil; smalle vinduer og tastatur afprøves. Brugervurdering af slutniveauet er særskilt. | Fælles overflader, tastatur/fokus, mobile paneler og forbedringer af projekter, noter, tavle, værksted og indstillinger. Ingen rigtig brugerundersøgelse eller endelig visuel godkendelse. |
| 7 | Kommandosøgning | Ctrl+K finder relevante projekter/samtaler/handlinger og kan betjenes med tastatur. | Ctrl+K søger projekter, samtaler, opgaver, handlinger og filnavne fra den seneste kørsel. Dialogen håndterer tastatur og fokus. |
| 8 | Projektviden med kilder | Kørsel gemmer grundlaget; ændrede krav opdages inden godkendelse/genoptagelse. | Indholdsfingeraftryk af bibel, beslutninger, arbejdsordre, repository og kontroller. Ændret grundlag afviser gammel plangodkendelse/genoptagelse. |
| 9 | Rammer for autonomi | Projektets grænser gemmes og håndhæves på serveren; forbrug og stopårsag vises. | Gemte projektgrænser for AI-kald, aktiv tid, rettelsesforsøg og fejl i træk; serveren håndhæver dem, også ved genoptagelse. |
| 10 | Håndtering af fastlåst arbejde | Begrænsede forsøg; adgangs-/kvotefejl gentages ikke blindt; årsag bevares. | Ingen blind genkørsel af fejlede skrivejobs. Begrænset genforsøg ved sikre læsefejl og rettelse efter faktiske fejlede kontroller. Ingen automatisk leverandørskift. |
| 11 | Integrationsoversigt | Installeret, tilsluttet og afprøvet skelnes; MCP-oplysninger vises uden hemmeligheder. Rigtige kontoprøver registreres særskilt. | Særskilt konfigurations-/leverancebevis. Eksplicit MCP initialize/tools-list-prøve for Claude/Gemini/Qwen JSON-stdio. Codex TOML/HTTP kræver native kontrol; ingen rigtig konto er prøvet her. |
| 12 | Medieværksted | Konkrete versioner kan åbnes, sammenlignes og kommenteres uden implicit godkendelse. | Billeder, lyd, video og 3D kan vises; to leverancer sammenlignes, og lokal feedback bindes til en bestemt version. Blender-leverancer kræver en rigtig tilsluttet produktionsvej. |
| 13 | Overskuelige komponenter | Fælles typer og moduler erstatter gentagne regler; relevante regressionstests består. | Arkiv, lager, autonomi, MCP, status, beskeder, noter og desktop er afgrænsede moduler med fælles typer og regler. Ingen total omskrivning af alle ældre visninger. |
| 14 | Komplet installation/opdatering | Produktionens frontend og Companion pakkes sammen med kompatibel runtime; helbredskontrol og tilbageførsel afprøves. | Komplet produktion i ZIP med per-user installation, bundlet Node/Companion, verificeret aktivering og kompatibel rollback. Windows-workflow bygger og afprøver pakken; ingen signeret MSI eller automatisk downloadopdatering. |
| 15 | Prøver af hele oplevelsen | Integrerede browser-, genstart- og fejlprøver består på samme commit; varighed og begrænsninger dokumenteres. | Browser-, HTTP-, proces-, lagrings- og fejlprøver. Målt lokal prøve med 60 processer/30 tvangsstop. Ingen 24-timers driftprøve eller prøve med nye brugere. |

## Prøver, der kræver den rigtige installation

- Brugerens Windows-maskine, eksisterende Orbit-data og aktive konti.
- Epoch Isles fra `C:\Users\compu\Orbit-projekter\Epoch-Isles`, inklusive gældende bibel og grafiske referencer.
- Betalt/inkluderet adgang og faktiske leverancer fra Meshy, ElevenLabs og øvrige tjenester.
- En rigtig Blender/MCP-produktion og nye brugeres oplevelse uden vejledning.
- En tidsmålt 24-timers driftprøve; korte fejlprøver må ikke rapporteres som døgnstabilitet.

Grønne tekniske tests udgør ikke brugerens godkendelse af grafik eller produktets visuelle kvalitet.


## Dokumentation og testkilder

- [Lager, kvitteringer, genoptagelse og backup](orbit-durable-storage.md).
- [Installation, opdatering og tilbageførsel](desktop.md).
- [Målt fejlprøve med kildehashes og afgrænsning](verification/orbit-reliability-2026-11-04.json).
- `npm run test:ai`: HTTP, procesgrænser, SQLite, mediekvitteringer, arkiver, MCP-protokol og desktopaktivering.
- `npm run test:browser`: faktiske browserforløb med isolerede Git-mapper og lokale tjenestefiksturer.
- `npm run build`, `npm run lint`, `npm run test:workspace` og `npm run test:imports`.

Den eksisterende JSON-workspacebackup har en samlet grænse på 256 MB. Den kan derfor afvise et workspace med flere store medieleverancer, selv om de enkelte filer er gyldige. Worktrees og leverandørcredentials følger ikke med denne backup.
