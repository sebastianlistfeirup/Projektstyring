# Realmread som første rigtige pilot

Denne fil er en indførelsesplan. Realmreads repository, bibel og spilbare build er ikke undersøgt som led i Orbit-ændringen. Områderne nedenfor er kontrolpunkter fra projektbeskrivelsen, ikke konstaterede fejl.

## Første gennemgang

Opret projektet **Realmread — version 1**. Tilknyt det lokale repository, upload den gældende spilbibel, og fastlæg bibelversionen. Klik **Kortlæg eksisterende projekt** i en ny chat. Skabelonen læser projektet og foreslår restarbejdet; den ændrer ikke kode.

Bed om konkrete filhenvisninger og fire adskilte tilstande: besluttet, implementeret, faktisk afprøvet og godkendt. Gennemgå især kamp, kompagnier/rekruttering/refill, verdenskort, byinteraktioner, Crown Seats/slutmål, save/load og det samlede spillerforløb. Senere godkendte beslutninger skal identificeres, hvis de afviger fra biblen.

Resultatet skal ende i en kort afgrænsning af version 1 og en prioriteret backlog. Importér ikke hele historikken over ønsker som obligatorisk arbejde. Gem senere idéer uden for det fastlagte scope.

Når gennemgangen leverer et gyldigt struktureret forslag, vises **Gennemse projektplan** i Orbit Live. Her kan du læse grundlag, acceptkriterier, kontroller og afhængigheder og vælge de relevante opgaver. **Opret valgte opgaver** opretter almindelige backlog-opgaver. Det særskilte scope-valg optager kun de valgte Version 1-opgaver i versionen; senere idéer forbliver udenfor. Samme forslag kan importeres igen uden dubletter. Et allerede godkendt versionsmål overskrives ikke.

## Den første arbejdsordre

Vælg ét konkret problem, som gennemgangen har dokumenteret. Et eksempel kunne være genopfyldning af et kompagni efter tab, men kun hvis den aktuelle kode faktisk har et problem dér.

- **Formål:** Hvilket spillerproblem skal være løst?
- **Gældende grundlag:** Bibelversion, beslutning og berørte kodefiler.
- **Afgrænsning:** Hvad ændres, og hvilke designvalg står fast?
- **Acceptkriterier:** Observerbar korrekt adfærd, inklusive fejltilstande.
- **Kontroller:** Faktiske kommandoer plus nødvendig manuel spiltest.
- **Leverance:** Commit, ændrede filer, testoutput, build og resterende problemer.

For et save/load-forløb skal testen mindst dokumentere det relevante forløb før gemning, efter indlæsning og efter næste handling. En headless Godot-import kan finde parse-/importfejl; den beviser ikke alene, at gameplay fungerer.

## Godkendelsesport

Kør én kodende kæde og få et uafhængigt review, hvor der er en anden egnet tjeneste. Kontrollér den producerede gren og den faktisk testede build. Flyt først arbejdsordren fra **Til gennemgang** til **Færdig**, når dens kriterier er dokumenteret opfyldt.

Pilotens succes måles på en fungerende leverance og en præcis restliste. Den måles ikke på antal agenter, tokens eller animerede aktiviteter. Efter den første godkendte opgave kan et sammenhængende spillerforløb være næste milepæl.
