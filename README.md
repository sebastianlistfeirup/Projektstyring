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
- **AI-assistent** – foreslå underopgaver og opsummér kommentarer (OpenAI-kompatibel, nøglen gemmes kun lokalt)
- **Morgen-påmindelser** + **automatisk uge-rapport** på valgte tidspunkter

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

- [ ] Cloud-sync over internettet (i dag: samme netværk)
- [ ] To-vejs-sync med Microsoft To Do
- [ ] PDF-eksport
- [ ] Kommentarer med @mention og notifikationer
