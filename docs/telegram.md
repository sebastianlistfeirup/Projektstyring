# Telegram-bot: opgaver direkte fra beskeder

Med Telegram-integrationen kan du oprette en opgave i Orbit blot ved at skrive en besked til en bot. Perfekt til hurtige indfald fra telefonen.

## 1. Opret en bot hos @BotFather

1. Åbn Telegram og søg efter **@BotFather** (den officielle bot-administrator – tjek det blå flueben).
2. Send kommandoen `/newbot`.
3. BotFather spørger efter et **navn** (fx "Orbit Opgaver") – det kan indeholde mellemrum.
4. Derefter et **brugernavn**, der skal ende på `bot` (fx `orbit_opgaver_bot`).

## 2. Kopiér tokenet

BotFather svarer med et token, fx:

```
7123456789:AAHfK9v2xQnT8rLz3pYbC1dE4fG5hI6jK7lM
```

**Del aldrig dette token** – det giver fuld adgang til bottet.

## 3. Sæt tokenet ind i Orbit

1. Åbn Orbit → fanen **Integrationer** → sektionen **Telegram-bot**.
2. Sæt tokenet ind i feltet **"Bot-token (fra @BotFather)"**.
3. Klik **Gem konfiguration**.
4. Status viser nu **"Bot kører"**.

## 4. Brug det

1. Find bottet i Telegram (søg efter det brugernavn, du valgte) og tryk **Start** eller send `/start`.
2. Skriv herefter en besked, fx:

```
Ring tilbage til kunden vedr. tilbud
```

3. Inden for få sekunder lander beskeden som en **ny opgave i Orbit** (i det aktive projekt).

## Tips

- **Grupper**: Tilføj bottet til en Telegram-gruppe, og alle beskeder i gruppen bliver til opgaver. Kør `/setprivacy` hos @BotFather og vælg **Disable**, så bottet også læser beskeder, der ikke nævner det direkte.
- **Flere beskeder = flere opgaver**: Hver besked opretter én opgave. Redigér titlen bagefter i Orbit, hvis du vil.
- Bottet kører via Orbit Companion – den skal køre, mens du bruger integrationen (`npm run companion`).
