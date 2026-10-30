# Orbit på skrivebordet

Denne vejledning beskriver, hvordan Orbit køres som en næsten-native oplevelse på Windows: via genveje, som installeret PWA eller som Tauri-desktopapp.

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
- `public/sw.js` – service worker uden afhængigheder: app-skallen forud-caches, navigeringer er *network-first* med offline-fallback til cachen, og øvrige GET-forespørgsler er *cache-first* med opdatering fra netværket. Gamle caches ryddes automatisk (kun `orbit-v1` bruges).

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

Tauri-koden er en desktopskal. Den starter og pakker endnu ikke Companion som en administreret baggrundsproces; AI-kørsler kræver fortsat Companion. Der er ikke bygget eller installeret en ny desktoprelease på brugerens Windows-maskine i denne opfølgning. En kommende samlet installer skal også håndtere Node/Companion, opstart, opdatering uden afbrudte kørsler og migration af browserens lokale data. Browser og Tauri har forskellige lokale lagre; synkronisér og sikkerhedskopiér før skift.

I browserudgaven kan den konkrete maskine måles fra **Orbit Live → Mål visningens performance**. Start målingen under en rigtig AI-kørsel og gem JSON-resultatet. Windows-CI er et supplement til denne måling og beviser ikke performance på brugerens hardware.
