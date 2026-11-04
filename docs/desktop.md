# Orbit på skrivebordet

Orbit kan nu pakkes som en selvstændig Windows-release med Node, Companion, produktionsbuild og start/stop-genveje. Udviklingsinstallationen og Tauri-skallen er stadig separate muligheder.

## Samlet Windows-release

Byg fra et kontrolleret checkout med Node 24:

```bash
npm ci
npm run build
npm run desktop:package
```

Pakningen opretter `desktop-build/Orbit` til **den platform, som bygger den**. Windows-workflowet **Orbit Windows release** bygger Windows-versionen, starter hele den pakkede app med isolerede testdata, kontrollerer release-identitet og webindhold, lukker den via dens eget kontrolendpoint og gemmer en ZIP som CI-artifact. Kun en bestået workflow-kørsel er dokumentation for denne pakkes Windows-start.

På den grønne GitHub Actions-kørsel vælges artifactet `Orbit-Windows-x64-<commit>`. ZIP-filen pakkes helt ud én gang; **Install-Orbit.cmd** ligger direkte i den udpakkede mappe. Dobbeltklik på den. Den kopierer en verificeret version til `%LOCALAPPDATA%\Programs\Orbit\releases`, opretter startmenu-/skrivebordsgenvejen **Orbit** og åbner appen. Administratorrettigheder, systeminstalleret Node, npm og Vite er ikke nødvendige for at køre den. Git og de valgte AI-CLI'er skal stadig være installeret for kodearbejde. **Start-Orbit.cmd** kan også starte direkte fra den udpakkede release; **Stop-Orbit.cmd** lukker kun dens egen inaktive runtime.

App og Companion serveres fra samme produktionsruntime på `http://127.0.0.1:4310`. Den bindes kun til loopback. Hver start har en tilfældig kontrolidentitet; starteren genbruger kun samme bekræftede release og stopper aldrig en fremmed proces på porten. API-resultater bliver ikke gemt i serviceworkerens offline-cache. Processen fortsætter, når browservinduet lukkes, så en igangværende opgave ikke afbrydes; brug **Orbit - Stop**, når arbejdet er afsluttet.

### Opdatering og tilbageførsel

Baggrundskontroller, Git og AI-processer starter med skjult konsol på Windows. En tidligere pakket udgave kunne vise kortvarige terminalvinduer, når AI-værktøjerne blev fundet igen efter cirka 30 sekunder. Den fejl kræver en opdatering og genstart af Companion; en genindlæsning af browseren er ikke nok. Orbit behøver ikke et fast terminalvindue åbent. Stifinder, browser og meddelelser, som brugeren beder om, vises fortsat normalt.

Kør **Install-Orbit.cmd** fra den nye release. Installationen foretager følgende:

1. Kontrollerer alle releasefiler mod manifestets SHA-256-hashes og afviser ekstra filer, manglende filer og symbolske links.
2. Kopierer releasen til en midlertidig mappe og aktiverer først den komplette verificerede kopi.
3. Starter den nye runtime med tomme, isolerede data **før** den eksisterende installation berøres.
4. Afviser lukning, hvis den eksisterende Orbit-kørsel arbejder eller afventer en beslutning.
5. Starter den nye version med de eksisterende data og skifter først startgenvejen, når både Companion og appen svarer med korrekt identitet.
6. Ved mislykket start forsøger den at genstarte den tidligere pakkede release, når begge angiver samme understøttede lagerformat. Den eksisterende genvej og brugerdata bevares. Et fejlet forsøg registreres i `last-update-error.json`.

Node-programfiler ligger i hver sin release-mappe og bliver ikke overskrevet, mens de kører. En installationslås hindrer samtidige opdateringer; en lås fra en afsluttet proces kan genoprettes. Tidligere releases slettes ikke automatisk. Manifestet angiver både kildecommit og `sourceDirty`; et lokalt build med ændringer bliver ikke præsenteret som et uændret commit.

Data ligger fortsat i `%USERPROFILE%\.orbit` og eksportmappen `Documents\Orbit`. `stateFormat: 2` angiver den pakkede version med SQLite-joblager. **Tilbageførsel af kode er ikke tilbageførsel af data.** Starteren gendanner aldrig gamle data oven på nyere beslutninger. En gammel Git-version før SQLite må ikke bruges som automatisk rollback; nyere SQLite-data kan ellers blive ignoreret. Ved et fremtidigt inkompatibelt lagerformat skal migrations-/backupforløbet afprøves, og formatnummeret ændres.

### Overgang fra udviklingsinstallationen

Afslut arbejdet og brug den gamle installations **Stop-Orbit.bat**, før den pakkede version startes. En fremmed eller gammel server på port 4310 bliver ikke tvangslukket af den nye installer. Kontrollér, at den gamle browser har synkroniseret samtaler, kladder og projektdata til Companion, og tag en backup i Orbit. Browserlagret for port 5173 og port 4310 er forskelligt; usynkroniserede lokale data flyttes ikke af installeren.

### Hvad pakken endnu ikke dokumenterer

Dette er en verificerbar ZIP med en per-user installer og browser/PWA-vindue. Det er endnu ikke en signeret MSI/EXE, en samlet native Tauri-app eller automatisk download af nye releases inde fra Orbit. Hash-manifestet opdager beskadigede eller ændrede filer; det erstatter ikke en digital udgiversignatur. Installation på brugerens egen pc, rigtige konti og flere døgns drift skal stadig afprøves. Kørsel af Windows-CI og faktisk installation er forskellige kontroller.

## Udviklingsinstallation: start, opdater og kontrollér

Når den nye Orbit-version er installeret og startet, sørger `scripts/Ensure-Shortcut.ps1` for to genveje på skrivebordet: **Orbit** starter appen; **Orbit - Opdater** henter den aftalte udviklingsversion, installerer afhængigheder og starter Orbit igen. Du kan også dobbeltklikke på `scripts/Install-Orbit-Preview.bat` eller `scripts/Check-Orbit.bat` direkte i Orbit-mappen.

Opdateringsgenvejen bruger grenen `codex/orbit-reliable-autonomy`. Den kontrollerer lokale ændringer og commits før grenvalg og afviser opdatering, mens en AI-kørsel er aktiv. Dit Epoch Isles-repository vælges ikke som installationsmappe. **Check-Orbit** viser, om Node.js, Git, appen og Companion svarer, hvilken Orbit-gren der er valgt, og om en kørsel afventer en beslutning. Kontrollen foretager ingen modelkald.

Hvis arbejdskøen kørte før en bevidst opdatering, fortsætter den efter genstart, når Companion svarer, og køens indhold er uændret uden afbrudt arbejde eller ventende tilladelser. En kø, du havde sat på pause, bliver på pause. Hvis den tidligere køtilstand ikke kan kontrolleres, viser opdateringen, at køen skal gennemgås og genoptages i Orbit Live.

### Første opdatering fra en ældre Orbit-installation

Den gamle installation har endnu ikke **Orbit - Opdater**. Find først **Orbit-kodens mappe**: Højreklik på den eksisterende Orbit-genvej, vælg **Egenskaber**, og find `Start-Orbit.bat` under **Destination**. Åbn mappen med filen, gå ét niveau op, og vælg **Åbn i Terminal/PowerShell her** fra Stifinder. Hvis genvejen mangler, find `Start-Orbit.bat` i din Orbit-installation og gør det samme. Mappen skal indeholde `scripts` og `.git`; vælg ikke Epoch Isles-projektmappen.

Indsæt derefter blokken samlet i PowerShell. Den stopper med en forklaring ved lokale ændringer, egne commits uden for opdateringen eller en aktiv AI-kørsel. Den bruger hverken `reset`, `clean` eller tvungen grenændring.

```powershell
& {
$orbitRepo = (Get-Location).ProviderPath
$orbitBranch = 'codex/orbit-reliable-autonomy'
if (-not (Test-Path -LiteralPath (Join-Path $orbitRepo '.git'))) { throw "Orbit-mappen blev ikke fundet: $orbitRepo" }
$dirty = @(& git -C $orbitRepo status --porcelain --untracked-files=normal)
if ($LASTEXITCODE -ne 0 -or $dirty.Count) { throw 'Orbit-mappen har lokale ændringer eller kunne ikke læses. Intet er overskrevet.' }
& git -C $orbitRepo fetch origin "refs/heads/${orbitBranch}:refs/remotes/origin/${orbitBranch}"
if ($LASTEXITCODE -ne 0) { throw 'Opdateringsgrenen kunne ikke hentes. Ingen lokale filer er ændret.' }
$before = (& git -C $orbitRepo rev-parse HEAD).Trim()
& git -C $orbitRepo merge-base --is-ancestor $before "origin/$orbitBranch"
if ($LASTEXITCODE -ne 0) { throw 'Den nuværende gren har egne commits uden for opdateringen. Ingen gren er skiftet.' }
& git -C $orbitRepo show-ref --verify --quiet "refs/heads/$orbitBranch"
$hasBranch = $LASTEXITCODE -eq 0
if ($hasBranch) {
  & git -C $orbitRepo merge-base --is-ancestor $orbitBranch "origin/$orbitBranch"
  if ($LASTEXITCODE -ne 0) { throw 'Den lokale opdateringsgren har egne commits. Ingen gren er skiftet.' }
}
& (Join-Path $orbitRepo 'scripts/Stop-Orbit.ps1') -RefuseActive
if ($LASTEXITCODE -ne 0) { throw 'Orbit arbejder stadig. Stop eller afslut kørslen i Orbit før opdatering.' }
$dirty = @(& git -C $orbitRepo status --porcelain --untracked-files=normal)
$after = (& git -C $orbitRepo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $dirty.Count -or $after -ne $before) { throw 'Orbit-mappen ændrede sig under opdateringen. Ingen gren er skiftet.' }
if ($hasBranch) { & git -C $orbitRepo switch $orbitBranch }
else { & git -C $orbitRepo switch -c $orbitBranch --track "origin/$orbitBranch" }
if ($LASTEXITCODE -ne 0) { throw 'Grenen kunne ikke vælges. Dine filer er bevaret.' }
& (Join-Path $orbitRepo 'scripts/Install-Orbit-Preview.bat')
}
```

Efter den første start ligger **Orbit - Opdater** på skrivebordet. Denne engangsovergang kan ikke aflæse den gamle køtilstand efter stop; gennemgå arbejdskøen i Orbit Live og vælg **Fortsæt køen**, hvis opgaverne stadig er aktuelle. Hvis blokken stopper, står forklaringen i PowerShell; den eksisterende Orbit-mappe og Git-historik bevares.

## 1. Hurtig start med Start-Orbit.bat

Dobbeltklik på `scripts/Start-Orbit.bat`. Scriptet:

1. Tjekker med `netstat`, om dev-serveren (port 5173) kører – og starter den (`npm run dev:app`) minimalt, hvis porten er fri.
2. Tjekker på samme måde, om companion-serveren (port 4310) kører – og starter den (`node server/companion.mjs`) minimalt, hvis porten er fri.
3. Venter på, at både frontend og Companion svarer korrekt, og åbner derefter http://localhost:5173 i standardbrowseren.

Kører `npm run dev` allerede, genbruger scriptet blot de kørende servere og åbner bare browseren.

## 2. Autostart ved login

- **Installér:** Kør `scripts/Install-Autostart.bat`. Den opretter en genvej til `Start-Orbit.bat` i din personlige opstartsmappe (`shell:startup` → `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`), så Orbit starter automatisk ved login.
- **Fjern:** Kør `scripts/Remove-Autostart.bat`. Den sletter genvejen igen.

## 3. Installer Orbit som PWA (anbefalet)

Når dev-serveren kører (eller appen er deployet), kan Orbit installeres som en selvstændig app med eget vindue, ikon og offline-understøttelse:

1. Åbn http://localhost:5173 i Chrome eller Edge.
2. Klik på installationsikonet i adresselinjen (eller menuen ⋮ → **Gem og del** → **Installer app** / **Apps** → **Installer Orbit**).
3. Bekræft. Orbit åbnes nu som et separat vindue uden browserkant og finder du i startmenuen.

PWA-delen består af:

- `public/manifest.webmanifest` – app-navn, farver, `standalone`-visning og ikoner (inkl. maskable varianter til Android).
- `public/icons/` – app-ikoner i 192×192 og 512×512 (almindelige + maskable), tegnet med Orbit-logoet.
- `public/sw.js` – service worker uden afhængigheder: app-skallen forud-caches, navigeringer er *network-first* med offline-fallback til cachen, og øvrige GET-forespørgsler er *cache-first* med opdatering fra netværket. Gamle caches ryddes automatisk (den aktuelle cache hedder `orbit-shell-v2`).

> Service workeren registreres kun i produktionsbuild (`import.meta.env.PROD`), så den forstyrrer ikke udviklingen.

## 4. Tauri-desktopapp (valgfri)

Orbit kan bygges som en rigtig Windows-desktopapp med [Tauri](https://tauri.app/) (kræver [Rust](https://rustup.rs/) – installeres med `winget install Rustlang.Rustup`).

Konfigurationen ligger i `src-tauri/tauri.conf.json` (app-id `dk.orbit.projektstyring`, version 1.4.0, vindue 1480×940, mørkt baggrundsfarve `#17181c`). Byg og installer:

```bash
npm run tauri build      # bygger frontend + Rust-app + installere
```

Installerene lander i `src-tauri/target/release/bundle/`:

- `msi/Orbit_1.4.0_x64_en-US.msi` – klassisk Windows-installer
- `nsis/Orbit_1.4.0_x64-setup.exe` – NSIS-installer

Tauri-appen indlejrer produktionsbuildet fra `dist/`, så den kører uden dev-server og uden browser. Bemærk at companion-serveren (`server/companion.mjs`, port 4310) stadig skal køre, hvis appen skal bruge dens funktioner (Teams-integration m.m.).

> `src-tauri/target/` er gitignoreret – kun konfiguration, Rust-kilde og ikoner ligger i git.


## Status for den aktuelle ændring

Tauri-koden er fortsat en separat desktopskal. Den samlede runtime er implementeret i ZIP/per-user-installationen ovenfor; Tauri pakker endnu ikke denne runtime. Browser og Tauri har forskellige lokale lagre; synkronisér og sikkerhedskopiér før skift. Der er ikke installeret en ny release på brugerens Windows-maskine fra dette miljø.

I browserudgaven kan den konkrete maskine måles fra **Orbit Live → Mål visningens performance**. Start målingen under en rigtig AI-kørsel og gem JSON-resultatet. Windows-CI er et supplement til denne måling og beviser ikke performance på brugerens hardware.
