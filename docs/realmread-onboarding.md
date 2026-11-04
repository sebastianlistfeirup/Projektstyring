# Epoch Isles som første rigtige pilot

Epoch Isles er projektet. Realmread er brugerens reference for byens udseende. Filnavnet er bevaret for eksisterende links. Projektets Windows-filer og spilbare build er ikke tilgængelige i Orbits cloud-testmiljø.

Den valgte lokale mappe er `%USERPROFILE%\Orbit-projekter\Epoch-Isles`. Brugeren har også oplyst `%USERPROFILE%\Documents\Cursor\projects\epoch_isles`; den er en anden kopi og er ikke valgt som arbejdsgrundlag. Dens relation til GitHub og indhold i forhold til den valgte mappe er ikke verificeret. Mappevalget skal ikke spørges igen.

## Kontrol før fortsættelse

Brug **Vis projektets Git-grundlag** i den valgte mappe. Kontrollér, at de rapporterede rute- og teksturrettelser faktisk indgår i den valgte gren. Tidligere screenshots viser separate rettelsesgrene; en rapport om en bestået kontrol beviser ikke, at rettelsen er integreret. Bevar lokale ændringer og rapporter. Kør derefter projektets import, testsuite og smokes fra det konkret valgte commit gennem Orbit, og gem output sammen med commit-id.

## Visuel accept er stadig åben

Brugeren har udtrykkeligt afvist den viste grafiske kvalitet. Referencebillederne og Realmread som byreference er fortsat grundlaget. En teksturreparation eller en bestået headless-kontrol opfylder ikke denne accept.

En visuel arbejdsordre skal vise før/efter fra det faktisk kørende spil med samme scene og kamera, sammenholdt med de gældende referencebilleder. Kontrollér materialer i spillet, ikke kun importerede modeller: den tidligere rapport beskrev materialer, der blev tilsidesat af kode, uændrede spilbilleder og fortsat lilla vegetation. Det er rapporterede observationer, som skal efterprøves på den aktuelle gren. Indhent brugerens visuelle vurdering af den konkrete leverance, før grafikken kaldes godkendt.

## Første gennemgang

Vælg det eksisterende **Epoch Isles**-projekt. Brug den valgte lokale mappe, den gældende masterbibel og de eksisterende referencebilleder. Dokumentér hvilken bibelversion og hvilke senere beslutninger der gælder; opret ikke et nyt, tomt projekt. Klik **Kortlæg eksisterende projekt** i en ny chat. Skabelonen læser projektet og foreslår restarbejdet; den ændrer ikke kode.

Bed om konkrete filhenvisninger og fire adskilte tilstande: besluttet, implementeret, faktisk afprøvet og godkendt. Gennemgå især de dokumenterede importfejl, ruter, scenariernes startdata, byvisningen og det samlede spillerforløb i forhold til masterbiblen. Senere godkendte beslutninger skal identificeres, hvis de afviger fra biblen.

Resultatet skal ende i en kort afgrænsning af version 1 og en prioriteret backlog. Importér ikke hele historikken over ønsker som obligatorisk arbejde. Gem senere idéer uden for det fastlagte scope.

Når gennemgangen leverer et gyldigt struktureret forslag, vises **Gennemse projektplan** i Orbit Live. Her kan du læse grundlag, acceptkriterier, kontroller og afhængigheder og vælge de relevante opgaver. **Opret valgte opgaver** opretter almindelige backlog-opgaver. Det særskilte scope-valg optager kun de valgte Version 1-opgaver i versionen; senere idéer forbliver udenfor. Samme forslag kan importeres igen uden dubletter. Et allerede godkendt versionsmål overskrives ikke.

## Den første arbejdsordre

Vælg ét konkret problem, som gennemgangen har dokumenteret. Prioritér de aktuelle blokeringer og den afviste visuelle kvalitet ud fra den valgte grens faktiske tilstand.

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
