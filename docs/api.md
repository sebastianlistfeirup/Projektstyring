# Orbit åbent API & webhooks

Companion-serveren (port 4310) eksponerer et lille åbent API, så andre systemer – fx **Power Automate**, Zapier-lignende tjenester eller jeres egne scripts – kan læse fra Orbit og reagere på hændelser.

## Autentificering

1. Opret et token i appen: **Integrationer → Webhooks & åbent API → Opret API-token**.
2. Send tokenet med i headeren på alle kald:

```
X-Orbit-Api-Token: <dit-token>
```

## Endpoints (læs)

| Endpoint | Beskrivelse |
|---|---|
| `GET /api/v1/tasks` | Alle opgaver (nyeste synkroniserede data) |
| `GET /api/v1/projects` | Alle projekter |
| `GET /api/v1/sprints` | Alle sprints |

Eksempel:

```bash
curl -H "X-Orbit-Api-Token: <token>" http://localhost:4310/api/v1/tasks
```

## Webhooks (hændelser ud)

Tilføj en webhook-URL under **Integrationer → Webhooks & åbent API**. Companion sender en `POST` med JSON, hver gang en opgave markeres færdig:

```json
{
  "event": "task.completed",
  "task": { "id": "t-abc", "title": "...", "number": 7, "projectId": "p-app" },
  "source": "orbit",
  "time": "2026-10-12T09:00:00.000Z"
}
```

## Eksempel: Power Automate

1. Opret et flow med trigger **"When an HTTP request is received"** (HTTP-webhook).
2. Kopiér den genererede URL til Orbit som webhook.
3. Tilføj handlingen **"Post message in a chat or channel"** (Teams) og brug dynamisk indhold fra triggeren, fx:

```
Opgave færdig: @{triggerBody()?['task']?['title']}
```

Nu lander der en besked i Teams, hver gang en opgave afsluttes i Orbit – uden yderligere kode.

## Bemærkninger

- API'et afspejler seneste synkroniserede data (app'en skubber automatisk).
- Webhooks afsendes best-effort (fejl logges ikke).
- Sæt aldrig serveren direkte på internettet uden reverse proxy med TLS og token.
