# Orbit – Projektstyring

Et moderne, dansksproget projektstyringsværktøj til Windows – inspireret af Monday, Microsoft Teams og Azure DevOps, med direkte integration til operativsystemet, Teams og Microsoft 365.

## Funktioner

### Kerne

- **Tavle** – Kanban med træk-og-slip mellem kolonner og inline oprettelse
- **Tabel** – sorterbar og filtrerbar oversigt med gruppeéringer
- **Tidslinje** – Gantt-lignende planlægning med sprint-bånd og "i dag"-markør
- **Backlog & Sprints** – sprint-planlægning med træk-og-slip mellem sprints
- **Min arbejdsliste** – personligt overblik med forsinkelser og kommende frister
- **Dashboard** – statusdiagrammer, burndown og arbejdsbelastning
- **Aktivitet** – levende aktivitetsfeed for hele arbejdsområdet
- **Kommandopalette** – `Ctrl+K`: søg, opret og naviger på tastaturet
- **Opgavedetalje** – kommentarer, delopgaver, etiketter, frister, points m.m.
- **Mørkt/lyst tema** og fuld persistence i browseren (localStorage)

### Integrationer (Orbit Companion)

Appen snakker med en lokal companion-server, der åbner døren til Windows:

- **Windows-notifikationer** – toast ved afsluttede opgaver (via PowerShell-modulet BurntToast)
- **Teams-webhooks** – besked til en Teams-kanal, hver gang en opgave markeres færdig
- **Eksport** – CSV (Excel), JSON og auto-genereret uge-rapport (Markdown) gemmes i `Documents/Orbit`
- **Microsoft 365 / Outlook** – login med din Microsoft-konto (device code) og hent åbne opgaver fra Microsoft To Do direkte ind på tavlen, eller se kommende møder med deltagerlinks

## Kom i gang

```bash
npm install
npm run dev        # starter både appen (5173) og companion-serveren (4310)
```

Eller separat:

```bash
npm run dev:app        # kun appen
npm run companion      # kun companion-serveren
```

Byg til produktion: `npm run build`

## Opsætning af Teams-beskeder

1. I Teams: vælg kanal → ⋯ → **Tilføjelser** → **Indgående webhook**
2. Kopér webhook-URL'en
3. I Orbit: **Integrationer** → sæt URL'en ind → **Gem**

## Opsætning af Microsoft 365 / Outlook

Integrationen bruger Microsofts officielle login (device code) – Orbit kan **aldrig se din adgangskode**, og alt kører lokalt.

1. Gå til [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Navn: "Orbit" · kontotype: *Accounts in any organizational directory and personal Microsoft accounts*
3. Efter oprettelse: **Authentication → Allow public client flows → Yes** (påkrævet til device code)
4. Kopiér **Application (client) ID**
5. I Orbit: **Outlook & Microsoft 365** → indsæt klient-id → **Tilslut** → indtast koden på [microsoft.com/devicelogin](https://microsoft.com/devicelogin)

Herefter kan du hente opgaver fra Microsoft To Do ind på tavlen og se dine kommende møder.

## Teknologi

React 19 · TypeScript · Vite · Tailwind CSS · Zustand · dnd-kit · Recharts · Express · WebSocket · MSAL · Microsoft Graph

## Roadmap

- [ ] Synkronisering mellem maskiner (cloud-lag)
- [ ] To-vejs-sync med Microsoft To Do
- [ ] Eksport til PDF
- [ ] Tema-tilpasning
