# Orbit – Projektstyring

Et moderne, dansksproget projektstyringsværktøj til Windows – inspireret af Monday, Microsoft Teams og Azure DevOps, med direkte integration til operativsystemet, Teams, Microsoft 365 og AI. Lokalt, hurtigt og uden abonnement.

![Tavle](docs/screenshots/tavle.png)

## Funktioner

### Planlægning

- **Tavle** – Kanban med træk-og-slip, inline oprettelse og klikbar prioritet på kortene
- **Tabel** – sorterbar og filtrerbar oversigt med gruppeéringer
- **Tidslinje** – Gantt-lignende planlægning med sprint-bånd og "i dag"-markør
- **Backlog & Sprints** – træk opgaver mellem sprints, start/afslut sprints, points
- **Team & kapacitet** – belastning vs. kapacitet pr. medlem, ferie, "hvem har plads?"
- **Min arbejdsliste** – personligt overblik med forsinkelser og ugens frister
- **Dashboard** – status, prioritet, burndown og arbejdsbelastning
- **Tilbagevendende opgaver** – daglige/ugentlige/månedlige opgaver opretter selv næste instans
- **Kommandopalette** – `Ctrl+K`: søg, opret og naviger uden mus

### Samarbejde & data

- **Teamsync** – del arbejdsområdet med kolleger på samme netværk (WebSocket, tilstedeværelse)
- **Projektskabeloner** – opret fx et helt hjemmesideprojekt med 10 opgaver på ét klik
- **Import** – Trello JSON, Monday CSV og Jira CSV (se `docs/samples/`), Microsoft Planner via Graph
- **Eksport** – CSV, JSON og uge-rapport (Markdown) til `Documents/Orbit`
- **Aktivitet** – levende feed over alt der sker

### Integrationer (Orbit Companion)

- **Windows-notifikationer** – toast ved afsluttede opgaver og morgen-overblik
- **Teams-webhooks** – besked til kanal ved afsluttede opgaver + automatisk uge-rapport
- **Microsoft 365 / Outlook** – officielt device-code-login: hent To Do-opgaver, se møder, lav opgaver direkte fra mails
- **AI-assistent** – foreslå underopgaver, opsummér kommentarer og foreslå din næste opgave (OpenAI-kompatibel, nøglen gemmes kun lokalt)
- **Morgen-påmindelser** + **automatisk uge-rapport** på valgte tidspunkter
- **Synkronisering & team** – del arbejdsområdet på netværket, eller kør `server/sync-server.mjs` på din egen server med token-auth og sync over internettet
- **Kunde-statusside** – read-only delingslink pr. projekt med live status (`/public/status/<token>`)
- **Backup** – daglig automatisk sikkerhedskopi med ét klik gendannelse
- **Automatisering** – Teams-besked ved afsluttede opgaver, notifikation til ansvarlig, auto-tildeling ved kritisk prioritet
- **Papirkurv** – slettede opgaver kan gendannes i 30 dage

### Samarbejde & struktur

- **I dag-visning** – intelligent kø: "Fortsæt", "Skynd dig" og AI-forslag til næste opgave
- **Tidsregistrering** – start/stop-timer på opgaver med dagssum
- **Afhængigheder** – "blokeret af"-relationer, auto-forskydning og kritisk sti på tidslinjen
- **Tilpasselige felter** – egne felter pr. projekt (tekst/tal/valgliste) som kolonner i tabellen
- **Gemte visninger** – filtre du kan genbruge og dele
- **Notifikationscenter** – @mentions og hændelser med udlæst/ulæst
- **Dansk/engelsk** – sprog-skift i hele app-skallen

| Team & kapacitet | Integrationer | Outlook & Microsoft 365 |
|---|---|---|
| ![Team](docs/screenshots/team.png) | ![Integrationer](docs/screenshots/integrationer.png) | ![Outlook](docs/screenshots/outlook.png) |

| Dashboard | Min arbejdsliste | Opgavedetalje |
|---|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Min arbejdsliste](docs/screenshots/min-arbejdsliste.png) | ![Opgave](docs/screenshots/opgave.png) |

## Kom i gang

```bash
npm install
npm run dev        # app (5173) + companion-server (4310)
```

Andre kommandoer:

```bash
npm run companion      # kun companion-serveren
npm run build          # produktionsbuild
npm run test:smoke     # automatiseret test af alle companion-endpoints
npm run tauri build    # Windows-desktopapp (MSI/EXE) – se docs/desktop.md
```

## Platforme

- **Web/PWA** – installerbar i Chrome/Edge, virker offline (service worker)
- **Desktop** – Tauri-app med MSI/NSIS-installer (`src-tauri/`, se docs/desktop.md)
- **Windows-genveje** – `scripts/Start-Orbit.bat` + autostart (Install-Autostart.bat)

## Opsætning

- **Teams-beskeder**: kanal → ⋯ → Tilføjelser → Indgående webhook → indsæt URL under Integrationer.
- **Microsoft 365**: opret gratis app-registrering (2 min – guide i appen under Outlook-fanen), indsæt klient-id, tilslut med din konto.
- **AI**: indsæt API-nøgle under Integrationer → AI-assistent (virker med OpenAI og alle OpenAI-kompatible udbydere).

## Teknologi

React 19 · TypeScript · Vite · Tailwind CSS · Zustand · dnd-kit · Recharts · Express · WebSocket · MSAL · Microsoft Graph · Tauri · date-fns · lucide-react

## Roadmap

- [ ] To-vejs-sync med Microsoft To Do
- [ ] PDF-eksport og rapportdesigner
- [ ] Kommentar-redigering og svar-tråde
- [ ] Oversættelse af alle views til engelsk (skallen er klar)
- [ ] Mobilapp (PWA er installerbar i dag)
