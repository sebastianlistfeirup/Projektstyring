# Orbit på skrivebordet

Denne vejledning beskriver, hvordan Orbit køres som en næsten-native oplevelse på Windows: via genveje, som installeret PWA eller som Tauri-desktopapp.

## 1. Hurtig start med Start-Orbit.bat

Dobbeltklik på `scripts/Start-Orbit.bat`. Scriptet:

1. Tjekker med `netstat`, om dev-serveren (port 5173) kører – og starter den (`npm run dev:app`) minimalt, hvis porten er fri.
2. Tjekker på samme måde, om companion-serveren (port 4310) kører – og starter den (`node server/companion.mjs`) minimalt, hvis porten er fri.
3. Venter 2 sekunder og åbner http://localhost:5173 i standardbrowseren.

Kører `npm run dev` allerede, genbruger scriptet blot de kørende servere og åbner bare browseren.

## 2. Autostart ved login

- **Installér:** Kør `scripts/Install-Autostart.bat`. Den opretter en genvej til `Start-Orbit.bat` i din personlige opstartsmappe (`shell:startup` → `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`), så Orbit starter automatisk ved login.
- **Fjern:** Kør `scripts/Remove-Autostart.bat`. Den sletter genvejen igen.

## 3. Installer Orbit som PWA (anbefalet)

Når dev-serveren kører (eller appen er deployet), kan Orbit installeres som en selvstændig app med eget vindue, ikon og offline-understøttelse:

1. Åbn http://localhost:5173 i Chrome eller Edge.
2. Klik på installationsikonet i adresselinjen (eller menuen ⋮ → **Gem og del** → **Installer app** / **Apps** → **Installer Orbit**).
3. Bekræft. Orbit åbnes nu som et separat vindue ugen browserkant og finder du i startmenuen.

PWA-delen består af:

- `public/manifest.webmanifest` – app-navn, farver, `standalone`-visning og ikoner (inkl. maskable varianter til Android).
- `public/icons/` – app-ikoner i 192×192 og 512×512 (almindelige + maskable), tegnet med Orbit-logoet.
- `public/sw.js` – service worker uden afhængigheder: app-skallen forud-caches, navigeringer er *network-first* med offline-fallback til cachen, og øvrige GET-forespørgsler er *cache-first* med opdatering fra netværket. Gamle caches ryddes automatisk (kun `orbit-v1` bruges).

> Service workeren registreres kun i produktionsbuild (`import.meta.env.PROD`), så den forstyrrer ikke udviklingen.

## 4. Tauri-desktopapp (valgfri)

Se afsnittet *Tauri-status* nedenfor.

---

## Tauri-status

*(opdateres ved build – se nedenstående afsnit)*
