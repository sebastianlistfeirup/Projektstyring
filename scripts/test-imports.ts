// Test af importparserne mod eksempelfilerne i docs/samples/.
// Køres med: npm run test:imports
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseImportFile, UNKNOWN_FILE } from '../src/lib/importers';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` – forventede ${JSON.stringify(expected)}, fik ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

// ---------- Trello ----------
const trello = parseImportFile(readFileSync(join(root, 'docs/samples/trello-eksempel.json'), 'utf8'), 'trello.json');
check('Trello: genkendt', typeof trello === 'object' && (trello as { source: string }).source, 'Trello');
if (typeof trello === 'object') {
  check('Trello: antal', trello.items.length, 5);
  check('Trello: første titel', trello.items[0].title, 'Bestil domæne og hosting');
  check('Trello: frist ISO', trello.items[0].dueDate, '2026-10-20');
  check('Trello: afsluttet kort (dueComplete)', trello.items.find((i) => i.title.startsWith('Afhold kickoff'))?.status, 'done');
  check('Trello: åbent kort', trello.items.find((i) => i.title.startsWith('Bestil'))?.status, 'todo');
  check('Trello: beskrivelse', trello.items[0].description.includes('leverandører'), true);
}

// ---------- Monday ----------
const monday = parseImportFile(readFileSync(join(root, 'docs/samples/monday-eksempel.csv'), 'utf8'), 'monday.csv');
check('Monday: genkendt', typeof monday === 'object' && (monday as { source: string }).source, 'Monday');
if (typeof monday === 'object') {
  check('Monday: antal', monday.items.length, 5);
  check('Monday: "Working on it" → inprogress', monday.items[0].status, 'inprogress');
  check('Monday: "Done" → done', monday.items[1].status, 'done');
  check('Monday: frist', monday.items[0].dueDate, '2026-10-24');
  check('Monday: fjerde række-frist', monday.items[3].dueDate, '2026-11-02');
}

// ---------- Jira ----------
const jira = parseImportFile(readFileSync(join(root, 'docs/samples/jira-eksempel.csv'), 'utf8'), 'jira.csv');
check('Jira: genkendt', typeof jira === 'object' && (jira as { source: string }).source, 'Jira');
if (typeof jira === 'object') {
  check('Jira: antal', jira.items.length, 3);
  check('Jira: dd/MMM/yy → 2026-11-10', jira.items[0].dueDate, '2026-11-10');
  check('Jira: High → high', jira.items[0].priority, 'high');
  check('Jira: Critical → urgent', jira.items[2].priority, 'urgent');
  check('Jira: In Progress → inprogress', jira.items[0].status, 'inprogress');
  check('Jira: ISO-dato', jira.items[1].dueDate, '2026-10-30');
  check('Jira: citationstegn i beskrivelse', jira.items[0].description.includes('bilag'), true);
}

// ---------- Ukendt format ----------
const unknown = parseImportFile('helt almindelig tekst', 'noter.txt');
check('Ukendt fil → fejlbesked', unknown, UNKNOWN_FILE);

if (failures > 0) {
  console.log(`\n${failures} FEJL`);
  process.exit(1);
}
console.log('\nALLE IMPORT-TEST BESTÅET');
