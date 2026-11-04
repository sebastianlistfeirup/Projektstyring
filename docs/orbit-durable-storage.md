# Holdbart joblager

Orbit bruger `ai-runs/orbit-state.sqlite` til køtilstand, køclaims, snapshots af kørsler, kompakt historik og kvitteringer fra mediebestillinger. Lageret bruger Nodes indbyggede `node:sqlite` (Node 22.13 eller nyere; releasekontrollerne kører Node 24). Ingen ekstra databaseserver skal installeres.

## Hvad er autoritativt?

- Køændringer læser og skriver den seneste gemte tilstand i en `BEGIN IMMEDIATE`-transaktion. Dubletkontrol og claim sker under samme skrivelås. To køinstanser kan ikke begge reservere den samme ventende opgave eller overskrive hinandens nyeste opgaver.
- En kørsels fulde snapshot og dens kompakte historik gemmes i samme transaktion. Historik kræver ikke indlæsning af alle fulde resultater.
- De eksisterende JSON-filer er kompatibilitetseksporter. Ved opstart repareres eksporterne fra databasen, hvis processen stoppede efter databasecommit, men før fileksporten. En gammel JSON-fil erstatter ikke en nyere databasetilstand.
- Eksisterende kø-JSON importeres én gang, når databasen ikke har køen. Ældre kørsler læses fortsat fra JSON og flyttes til lageret ved næste gemning. En beskadiget database giver en fejl; Orbit falder ikke tilbage til en muligvis forældet eksport og starter arbejde derfra.
- Hændelsesjournaler og kompakte heartbeat-filer bevares. De er ikke flyttet ind i samme transaktion som hvert kørselssnapshot.

## Mediebestillinger

Før et eksternt mediekald reserveres en stabil operationsidentitet og en SHA-256-identitet for bestillingens grundlag. Leverandørens job-id og den afsluttede leverance gemmes i efterfølgende transaktioner. Identiteten følger den oprindelige arbejdsmappe/opgave ved genoptagelse.

Hvis reservationen findes uden en leverandørkvittering, kan bestillingen allerede være modtaget. Orbit sender den derfor ikke igen automatisk. Hvis et leverandør-id er gemt, kan adapteren fortsætte med det samme job. Et gemt færdigt resultat genbruges. Et ændret grundlag kan ikke genbruge samme operationsidentitet.

Dette giver ikke en garanti om præcis én udførelse hos en ekstern tjeneste. Det forhindrer en automatisk genbestilling ved ukendt udfald. Afklaring af en ukendt bestilling kræver fortsat leverandørens historik; der er ikke implementeret en generel automatisk afstemning for alle tjenester.

## Backup og gendannelse

Hver databaseoperation lukker forbindelsen, før den returnerer. `DELETE`-journal og `synchronous=FULL` undgår et separat levende WAL-lager, som kunne blive glemt i den eksisterende mappebackup. Backup og gendannelse kører synkront i den enkelte Companion-proces. Databasen følger med `ai-runs` i workspacebackuppen.

Ved gendannelse sættes køens autoritative databasetilstand på pause, før det gendannede workspace offentliggøres. En gammel backup uden database importeres fra JSON. Afbrudte claims gennemgås før fortsættelse. En nyere, ukendt databaseskemaversion afvises.

Kvitteringer fra eksterne mediebestillinger bevares på tværs af en tilbagerulning: en gammel backup må ikke slette viden om en senere bestilling og dermed udløse en ny betaling. De aktuelle kvitteringer indlæses før gendannelse og flettes ind i den gendannede database, før workspacet offentliggøres. Modstridende bestillingsgrundlag eller leverandør-id afbryder gendannelsen og ruller mapperne tilbage. En afsluttet bestilling, hvis filer er nyere end backuppen, markeres som krævende gendannelse af leverancen; den genbestilles ikke, og den præsenteres ikke som et tilgængeligt lokalt resultat. En nyere fuld backup kan gendanne den oprindelige leverance.

Rul ikke alene appkoden tilbage til en version fra før SQLite-lageret og arbejd videre dér: den ældre app vil skrive JSON, som den nyere app ikke bruger som autoritativt lager. En egentlig datatilbagerulning kræver en bevidst gendannelse af den sammenhørende workspacebackup. Bevar original backup og database.

## Kontroller og afgrænsning

`scripts/test-ai-durable-store.mjs` afprøver pludseligt procesexit med en åben transaktion, mistet JSON-eksport efter databasecommit, samtidige køinstanser, samme planlagte opgave fra separate processer, ukendt medieindsendelse efter procesexit, genbrug af kvittering/resultat, migration, gendannelsespause samt beskadigede og nyere databaser.

Orbit udfører fortsat én kodeopgave ad gangen i en arbejdsmappe. Et gemt ejer-PID for køclaims er en forsigtig lokal kontrol; det er ikke et distribueret lease- eller fencing-system. Parallelle workers, automatisk overtagelse af udløbne leases, transaktioner på tværs af Git og leverandører samt en 24-timers fejlindsprøjtningsprøve er ikke dokumenteret af disse tests.
