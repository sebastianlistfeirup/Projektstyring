# Power Automate: forbind Orbit uden kode

Der er to veje til at bygge flows omkring Orbit: **webhook-triggeren** (hændelser *fra* Orbit) og **custom connectoren** (læs data *fra* Orbit i flows).

## 1. Trigger: "When an HTTP request is received"

Hver gang en opgave afsluttes i Orbit, kan et Power Automate-flow køre (fx sende en Teams-besked eller opdatere et Excel-ark).

1. I Orbit: **Integrationer → Webhooks & åbent API** → tilføj din Power Automate-URL som webhook. Se også sektionen **Power Automate** på samme side.
2. I Power Automate: opret et flow med triggeren **"When an HTTP request is received"** (HTTP-anmodning modtages).
3. Kopiér den genererede URL tilbage til Orbit som webhook.
4. Tilføj en handling bagefter – fx **"Post message in a chat or channel"** (Teams):

```
Opgave færdig: @{triggerBody()?['task']?['title']} (nr. @{triggerBody()?['task']?['number']})
```

Payload fra Orbit ser sådan ud:

```json
{
  "event": "task.completed",
  "task": { "id": "t-abc", "title": "Tilbagemelding til kunde", "number": 12, "projectId": "p-app" },
  "source": "orbit",
  "time": "2026-10-13T09:00:00.000Z"
}
```

## 2. Custom connector: læs opgaver, projekter og sprints

Filen `docs/power-automate-connector.json` er en færdig **OpenAPI 2.0**-definition med tre operationer:

| Operation | Endpoint |
|---|---|
| HentOpgaver | `GET /api/v1/tasks` |
| HentProjekter | `GET /api/v1/projects` |
| HentSprints | `GET /api/v1/sprints` |

Alle kald sikres med headeren `X-Orbit-Api-Token` (opret tokenet i Orbit under **Webhooks & åbent API → Opret API-token**).

### Importér connector'en

1. Gå til [make.powerautomate.com](https://make.powerautomate.com) → **Data → Custom connectors**.
2. Klik **Import** → vælg filen `docs/power-automate-connector.json` fra Orbit-mappen.
3. Gennemgå guiden:
   - **Generelt**: behøver ikke ændres (host sættes dynamisk).
   - **Sikkerhed**: vælg API-nøgle-tilstanden (allerede sat til `X-Orbit-Api-Token` i header) – indsæt dit token som nøgle, når du opretter forbindelsen.
   - **Definition**: de tre handlinger vises – klik **Opret connector**.
4. Erstat host `DIN-PC` med den adresse, Companion kører på (fx `172.16.0.24:4310`), eller opret forbindelsen med den samme værdi og ret den senere under forbindelsesindstillingerne.

### Brug connector'en i et flow

1. Opret et nyt flow – fx **Planlagt sky** (kører hver morgen).
2. Tilføj handlingen **HentOpgaver** (under din custom connector).
3. Tilføj fx **"Create HTML table"** + **"Send an email (V2)"** for at maile dagens åbne opgaver til teamet.

## Bemærkninger

- API'et afspejler seneste synkroniserede data – app'en skubber automatisk til Companion.
- Sæt aldrig Companion direkte på internettet; brug en reverse proxy med TLS, hvis flows skal køre fra skyen.
