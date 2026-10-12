// Fælles importparsere til Trello JSON, Monday CSV og Jira CSV.
// Bruges af ImportView og af scripts/test-imports.ts.
import { format, isValid, parseISO } from 'date-fns';
import type { ImportItem, Priority } from './types';

export const UNKNOWN_FILE = 'Kunne ikke genkende filen – understøtter Trello JSON, Monday CSV og Jira CSV.';

export interface ParsedImport {
  items: ImportItem[];
  source: 'Trello' | 'Monday' | 'Jira';
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, may: 5, jun: 6, jul: 7,
  aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12,
};

function normalizeDate(raw?: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Jira: dd/MMM/yy fx "11/Oct/26"
  const jira = /^(\d{1,2})[/-]([A-Za-z]{3,})[/-](\d{2,4})$/.exec(v);
  if (jira) {
    const day = Number(jira[1]);
    const month = MONTHS[jira[2].toLowerCase()];
    const yearRaw = Number(jira[3]);
    if (!month || day < 1 || day > 31) return null;
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // dd/mm/yyyy (dansk)
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const yearRaw = Number(dmy[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const parsed = parseISO(v);
  return isValid(parsed) ? format(parsed, 'yyyy-MM-dd') : null;
}

function mapStatus(raw: string | undefined, workingLabels: string[]): 'todo' | 'inprogress' | 'done' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'done' || v === 'completed' || v === 'complete' || v === 'færdig') return 'done';
  if (workingLabels.includes(v)) return 'inprogress';
  return 'todo';
}

function mapPriority(raw: string | undefined): Priority | undefined {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'critical' || v === 'highest' || v === 'urgent') return 'urgent';
  if (v === 'high') return 'high';
  if (v === 'medium') return 'medium';
  if (v === 'low' || v === 'lowest') return 'low';
  return undefined;
}

function parseCSV(text: string): string[][] {
  const cleaned = text.replace(/^﻿/, '');
  const firstLine = cleaned.slice(0, cleaned.indexOf('\n') === -1 ? undefined : cleaned.indexOf('\n'));
  const delimiter = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inQuotes) {
      if (c === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && cleaned[i + 1] === '\n') i++;
      row.push(field.replace(/\r$/, ''));
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function colIndex(headers: string[], ...names: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const name of names) {
    const i = norm.indexOf(name.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function parseTrello(json: unknown): ImportItem[] | null {
  if (typeof json !== 'object' || json === null) return null;
  const root = json as Record<string, unknown>;
  const collected: Record<string, unknown>[] = [];
  const collect = (cards: unknown) => {
    if (!Array.isArray(cards)) return;
    for (const c of cards) {
      if (typeof c === 'object' && c !== null && 'name' in c) collected.push(c as Record<string, unknown>);
    }
  };
  const collectFromLists = (lists: unknown) => {
    if (!Array.isArray(lists)) return;
    for (const l of lists) collect((l as Record<string, unknown>).cards);
  };
  if (Array.isArray(root.boards)) {
    for (const b of root.boards) {
      const board = b as Record<string, unknown>;
      collect(board.cards);
      collectFromLists(board.lists);
    }
  }
  collect(root.cards);
  collectFromLists(root.lists);
  if (collected.length === 0) return null;
  const items: ImportItem[] = [];
  for (const card of collected) {
    const title = typeof card.name === 'string' ? card.name.trim() : '';
    if (!title) continue;
    const dueRaw = typeof card.due === 'string' ? card.due.slice(0, 10) : null;
    const done = card.dueComplete === true || card['due complete'] === true;
    items.push({
      title,
      dueDate: dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null,
      status: done ? 'done' : 'todo',
      description: typeof card.desc === 'string' ? card.desc : '',
    });
  }
  return items.length > 0 ? items : null;
}

function parseCsvRows(rows: string[][]): ParsedImport | null {
  if (rows.length < 2) return null;
  const headers = rows[0];
  const summaryIdx = colIndex(headers, 'Summary');
  if (summaryIdx >= 0) {
    const statusIdx = colIndex(headers, 'Status');
    const dueIdx = colIndex(headers, 'Due Date');
    const descIdx = colIndex(headers, 'Description');
    const prioIdx = colIndex(headers, 'Priority');
    const items: ImportItem[] = [];
    for (const row of rows.slice(1)) {
      const title = (row[summaryIdx] ?? '').trim();
      if (!title) continue;
      items.push({
        title,
        status: mapStatus(row[statusIdx], ['in progress']),
        dueDate: dueIdx >= 0 ? normalizeDate(row[dueIdx]) : null,
        description: descIdx >= 0 ? (row[descIdx] ?? '').trim() : undefined,
        priority: prioIdx >= 0 ? mapPriority(row[prioIdx]) : undefined,
      });
    }
    return items.length > 0 ? { items, source: 'Jira' } : null;
  }
  const titleIdx = colIndex(headers, 'Item', 'Item Name', 'Name');
  if (titleIdx >= 0) {
    const statusIdx = colIndex(headers, 'Status');
    const dateIdx = colIndex(headers, 'Date', 'Due Date');
    const prioIdx = colIndex(headers, 'Priority');
    const items: ImportItem[] = [];
    for (const row of rows.slice(1)) {
      const title = (row[titleIdx] ?? '').trim();
      if (!title) continue;
      items.push({
        title,
        status: mapStatus(row[statusIdx], ['working on it', 'in progress']),
        dueDate: dateIdx >= 0 ? normalizeDate(row[dateIdx]) : null,
        priority: prioIdx >= 0 ? mapPriority(row[prioIdx]) : undefined,
      });
    }
    return items.length > 0 ? { items, source: 'Monday' } : null;
  }
  return null;
}

export function parseImportFile(text: string, fileName: string): ParsedImport | string {
  const trimmed = text.trim();
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[') || fileName.toLowerCase().endsWith('.json');
  if (looksJson) {
    try {
      const items = parseTrello(JSON.parse(trimmed));
      if (items) return { items, source: 'Trello' };
    } catch {
      // Ikke gyldig JSON – falder igennem til fejlbesked
    }
    return UNKNOWN_FILE;
  }
  const parsed = parseCsvRows(parseCSV(text));
  return parsed ?? UNKNOWN_FILE;
}
