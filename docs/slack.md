# Slack: /orbit-kommandoen

Lav en opgave i Orbit direkte fra Slack med en slash-kommando – uden at forlade samtalen.

## 1. Opret en Slack-app

1. Gå til [api.slack.com/apps](https://api.slack.com/apps) og log ind.
2. Klik **Create New App** → **From scratch**.
3. Giv appen et navn (fx "Orbit") og vælg dit workspace.

## 2. Opret slash-kommandoen

1. I appens menu til venstre vælger du **Slash Commands** → **Create New Command**.
2. Udfyld:

| Felt | Værdi |
|---|---|
| Command | `/orbit` |
| Request URL | `http://<din-pc>:4310/api/slack/command` |
| Short description | `Opret en opgave i Orbit` |
| Usage hint | `fx /orbit Ring tilbage til kunden` |

Erstat `<din-pc>` med det værtsnavn eller den IP, kolleger kan nå din PC på (fx `http://172.16.0.24:4310/...`). Din PC og Slack skal kunne nå hinanden – på tværs af internettet kræver det en tunnel eller en server.

3. Klik **Save**.

## 3. Kopiér Verification Token

1. Gå til **Basic Information** → afsnittet **App Credentials**.
2. Kopiér **Verification Token**.

## 4. Sæt tokenet ind i Orbit

1. Åbn Orbit → **Integrationer** → sektionen **Slack**.
2. Sæt tokenet ind i feltet **"Kommando-token (Verification Token fra din Slack-app)"**.
3. Klik **Gem konfiguration**.

## 5. Brug det

Skriv i en hvilken som helst kanal:

```
/orbit Lav mockups til nyt logo
```

Besked efter kommandoen bliver opgavens titel, og opgaven lander i det aktive projekt i Orbit.

## Fejlfinding

- **"invalid_token"** – Verification Token i Orbit matcher ikke Slack-appen.
- **Ingen reaktion** – tjek at Request URL peger på den PC, hvor Companion kører, og at `npm run companion` kører.
