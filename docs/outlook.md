# Outlook-hurtigtilføjelse

Opret en opgave i Orbit direkte fra Outlook – via det samme indsamlingslink som formularerne bruger.

## Sådan virker det

Linket peger på Orbits åbne indsamlingsformular for **første projekt** i arbejdsområdet:

```
http://<din-pc>:4310/public/intake/<token>
```

Når linket åbnes, vises en lille formular: udfyld titel (og gerne beskrivelse), klik **Opret** – opgaven lander med det samme på tavlen i Orbit. Ingen login, ingen app – derfor er linket også en genvej fra Outlook.

## 1. Kopiér linket

1. Åbn Orbit → **Integrationer** → sektionen **Formularer & portal** → klik **Aktivér formular** for det projekt, du vil oprette opgaver i.
2. Nederst på Integrationer-siden finder du sektionen **Outlook-hurtigtilføjelse** → **Kopiér link**.
   (Hvis sektionen siger "Aktivér først en formular", er punktet ovenfor ikke gjort endnu.)

## 2. Lav genvejen i Outlook

Vælg det, der passer din Outlook-version:

**Bogmærke i browser (nemmest)**
- Bruger du Outlook på web (OWA): åbn linket, gem det som bogmærke i browserværktøjslinjen. Én klik fra mailen → opgave oprettet.

**Genvej på proceslinjen (Windows)**
1. Højreklik på skrivebordet → **Nyt → Genvej**.
2. Indsæt linket som placering, navngiv den "Ny Orbit-opgave".
3. Træk genvejen til proceslinjen eller Start-menuen.

**WebView2 / tilføjelsesprogram**
- Bygger I et Outlook-tilføjelsesprogram, kan linket åbnes med `Office.context.ui.openBrowserWindow(url)` eller vises i en opgavepane, så opgaven oprettes uden at forlade mailen.

## 3. Brug det

1. Du sidder med en mail, der indeholder en opgave ("Kan du ringe til kunden?").
2. Klik genvejen/bogmærket, skriv fx **"Ring tilbage til kunden vedr. tilbud"**, klik **Opret**.
3. Opgaven står nu i Orbit – med projekt og nummer som alle andre opgaver.

## Bemærk

- Linket giver alle, der har det, mulighed for at oprette opgaver i det pågældende projekt – del det kun med dem, der må.
- Linket ændres, hvis formular-delingen slås fra og til igen; genvejen skal så oprettes på ny.
