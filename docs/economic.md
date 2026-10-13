# e-conomic: fakturakladde af registreret tid

Med ét klik samler Orbit al registreret tid til fakturakladder i e-conomic – grupperet pr. opgave, med jeres timesats.

## 1. Opret en dataaftale i e-conomic

AgreementGrantToken hentes fra e-conomics udvikleradgang:

1. Log ind i **e-conomic** (som administrator).
2. Gå til **Indstillinger (tandhjul) → Dataaftaler / Udviklere** (Engelsk: *Settings → Developer → Add app*).
3. Opret en ny aftale med jeres egen app (eller søg "Orbit"/egen intern app) og giv den adgang.
4. Når aftalen godkendes, får I en **AgreementGrantToken** – en lang streng, der kun vises én gang. Gem den et sikkert sted.

> Bruger I e-conomics REST API med en public app, hedder flowet "Request access" → kunden godkender → tokenet udleveres. Tokenet her er det samme, Orbit skal bruge.

## 2. Find kundenummeret

- Åbn kundekortet i e-conomic – **kundenummeret** (debitornummeret) står øverst, fx `101`.

## 3. Sæt det ind i Orbit

1. Åbn Orbit → **Integrationer** → sektionen **e-conomic**.
2. Sæt **AgreementGrantToken** ind i første felt.
3. Skriv **kundenummeret** i andet felt.
4. Klik **Gem konfiguration**.

Timesatsen styrer prisen pr. time og findes på **dashboardet** i Orbit (standard 950 DKK/time).

## 4. Opret fakturakladde

1. Sørg for, at der er **registreret tid** på opgaverne (start/stop-timeren på opgavekortet).
2. Klik **"Opret fakturakladde fra registreret tid"**.

Orbit bygger linjerne sådan:

- Tid **grupperes pr. opgave** (alle tidsregistreringer på samme opgave lægges sammen).
- **Antal** = samlet tid i timer (minutter ÷ 60, afrundet til 2 decimaler).
- **Enhedspris** = jeres timesats fra dashboardet.
- **Beskrivelse** = opgavens reference og titel, fx `APP-12 – Tilbagemelding til kunde`.

3. Kladde-nummeret vises i Orbit, når kladden er oprettet.

## 5. Gennemgang og bogføring

1. Åbn **e-conomic → Fakturering → Kladder**.
2. Find kladden (nummeret fra Orbit), tjek linjer og moms.
3. Bogfør, når den ser rigtig ud.

## Fejlfinding

- **"Ugyldig aftale/token"** – tokenet er forkert eller aftalen er udløbet; opret den igen i e-conomic.
- **"Kunden findes ikke"** – tjek at kundenummeret er et tal uden bogstaver.
- **Tom kladde-knap** – der skal være mindst én *afsluttet* tidsregistrering (en kørende timer tæller ikke med).
