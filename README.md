# Orbit – Projektstyring

Et moderne, dansksproget projektstyringsværktøj bygget som en hurtig lokal web-app. Inspireret af Monday, Microsoft Teams og Azure DevOps – med fokus på en lækker, hurtig brugeroplevelse.

## Funktioner

- **Tavle** – Kanban med træk-og-slip mellem kolonner og inline oprettelse
- **Tabel** – Sorterbar og filtrerbar oversigt med gruppeéringer
- **Tidslinje** – Gantt-lignende planlægning med sprint-bånd og "i dag"-markør
- **Backlog & Sprints** – Sprint-planlægning med træk-og-slip mellem sprints
- **Min arbejdsliste** – Personligt overblik med forsinkelser og kommende frister
- **Dashboard** – Statusdiagrammer, burndown og arbejdsbelastning
- **Aktivitet** – Levende aktivitetsfeed for hele arbejdsområdet
- **Kommandopalette** – `Ctrl+K`: søg, opret og naviger på tastaturet
- **Opgavedetalje** – Kommentarer, delopgaver, etiketter, frister, points m.m.
- **Mørkt/lyst tema** og fuld persistence i browseren (localStorage)

## Teknologi

React 18 · TypeScript · Vite · Tailwind CSS · Zustand (persistence) · dnd-kit · Recharts · date-fns · lucide-react

## Kom i gang

```bash
npm install
npm run dev
```

Byg til produktion:

```bash
npm run build
```

## Roadmap

- [ ] Integration: Outlook (opgaver fra mails/kalender)
- [ ] Integration: Microsoft Teams (notifikationer, tabs)
- [ ] Bag om appen: lokal database + synkronisering
- [ ] Eksport (CSV/PDF) og rapporter
