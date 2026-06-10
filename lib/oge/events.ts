import type { EventCategory, EventWindowSummary, OgeEvent, OgeTransaction } from './types';

interface FederalRegisterDocument {
  title?: string;
  publication_date?: string;
  html_url?: string;
  abstract?: string;
  document_number?: string;
  agencies?: Array<{ name?: string; raw_name?: string }>;
}

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  tariff: 'Tariffs / trade',
  fed: 'Fed',
  'white-house': 'White House',
  market: 'Market',
  'company-news': 'Company news',
  'truth-social': 'Trump social posts',
  interview: 'Interviews / transcripts',
  reuters: 'Reuters stories',
  manual: 'Manual',
};

export const EVENT_CATEGORY_COLORS: Record<EventCategory, string> = {
  tariff: '#e11d48',
  fed: '#2563eb',
  'white-house': '#059669',
  market: '#f97316',
  'company-news': '#8b5cf6',
  'truth-social': '#111827',
  interview: '#06b6d4',
  reuters: '#4f46e5',
  manual: '#ca8a04',
};

export function normalizeManualEvents(events: OgeEvent[]): OgeEvent[] {
  return events.map((event, index) => ({
    ...event,
    id: event.id || stableId(`manual-event|${event.date}|${event.title}|${index}`),
    endDate: event.endDate || null,
    tickers: uniqueUpper(event.tickers || []),
    sectors: uniqueClean(event.sectors || []),
    tags: uniqueClean(event.tags || []),
    importance: normalizeImportance(event.importance),
  }));
}

export function federalRegisterDocumentToEvent(document: FederalRegisterDocument): OgeEvent | null {
  const date = document.publication_date?.slice(0, 10);
  const title = cleanText(document.title || '');
  if (!date || !title || !document.html_url) return null;

  const summary = cleanText(document.abstract || agencySummary(document.agencies));
  const text = `${title} ${summary}`;
  const tags = tagsFromText(text);
  const sectors = sectorsFromText(text);
  const importance = importanceFromFederalRegisterText(text);
  if (importance < 2) return null;

  return {
    id: stableId(`federal-register|${document.document_number || title}|${date}`),
    date,
    endDate: null,
    category: 'tariff',
    title,
    summary: summary || 'Federal Register trade or tariff-related document.',
    sourceName: 'Federal Register',
    sourceUrl: document.html_url,
    tickers: [],
    sectors,
    tags,
    importance,
  };
}

export function buildFomcEvents(): OgeEvent[] {
  return FOMC_MEETINGS.map((meeting) => ({
    id: stableId(`fomc|${meeting.date}|${meeting.title}`),
    date: meeting.date,
    endDate: meeting.endDate,
    category: 'fed',
    title: meeting.title,
    summary: meeting.summary,
    sourceName: 'Federal Reserve',
    sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    tickers: [],
    sectors: [],
    tags: ['FOMC', meeting.sep ? 'SEP' : 'meeting'].filter(Boolean),
    importance: meeting.sep ? 3 : 2,
  }));
}

export function mergeEvents(...groups: OgeEvent[][]): OgeEvent[] {
  const byId = new Map<string, OgeEvent>();
  for (const event of groups.flat()) {
    byId.set(event.id, {
      ...event,
      tickers: uniqueUpper(event.tickers),
      sectors: uniqueClean(event.sectors),
      tags: uniqueClean(event.tags),
    });
  }

  return Array.from(byId.values())
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      b.importance - a.importance ||
      a.title.localeCompare(b.title)
    );
}

export function buildEventWindows(events: OgeEvent[], transactions: OgeTransaction[]): EventWindowSummary[] {
  const windows: EventWindowSummary[] = [];
  for (const event of events) {
    for (const windowDays of [7, 30] as const) {
      const rows = transactions.filter((tx) => transactionMatchesEventWindow(tx, event, windowDays));
      const purchases = rows.filter((tx) => tx.type === 'Purchase');
      const sales = rows.filter((tx) => tx.type === 'Sale');
      const purchaseMidpoint = purchases.reduce((sum, tx) => sum + tx.amount.midpoint, 0);
      const saleMidpoint = sales.reduce((sum, tx) => sum + tx.amount.midpoint, 0);
      const dates = rows.map((tx) => tx.date).sort();

      windows.push({
        eventId: event.id,
        windowDays,
        transactionCount: rows.length,
        purchaseMidpoint,
        saleMidpoint,
        netMidpoint: purchaseMidpoint - saleMidpoint,
        matchedTickers: uniqueUpper(rows.map((tx) => tx.resolvedTicker || tx.ticker || '').filter(Boolean)),
        matchedSectors: uniqueClean(rows.map((tx) => tx.sector).filter(Boolean)),
        firstTransactionDate: dates[0] || null,
        lastTransactionDate: dates.at(-1) || null,
      });
    }
  }
  return windows;
}

export function eventWindowBounds(event: OgeEvent, windowDays: number): { startDate: string; endDate: string } {
  return {
    startDate: addDays(event.date, -windowDays),
    endDate: addDays(event.endDate || event.date, windowDays),
  };
}

export function eventMonth(event: OgeEvent): string {
  return event.date.slice(0, 7);
}

export function eventCategoryLabel(category: EventCategory): string {
  return EVENT_CATEGORY_LABELS[category] || category;
}

function transactionMatchesEventWindow(tx: OgeTransaction, event: OgeEvent, windowDays: number): boolean {
  const bounds = eventWindowBounds(event, windowDays);
  if (tx.date < bounds.startDate || tx.date > bounds.endDate) return false;

  const hasTargeting = event.tickers.length > 0 || event.sectors.length > 0;
  if (!hasTargeting) return true;

  const txTicker = (tx.resolvedTicker || tx.ticker || '').toUpperCase();
  if (txTicker && event.tickers.includes(txTicker)) return true;
  return event.sectors.includes(tx.sector);
}

export function tagsFromText(text: string): string[] {
  const normalized = text.toLowerCase();
  const tags: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/section 232|steel|aluminum/g, 'Section 232'],
    [/reciprocal/g, 'reciprocal tariffs'],
    [/automobile|auto parts|vehicles?/g, 'autos'],
    [/aircraft|aerospace/g, 'aircraft'],
    [/pharmaceutical|drug|generic/g, 'pharmaceuticals'],
    [/lumber|timber|wood/g, 'lumber'],
    [/semiconductor|chips?/g, 'semiconductors'],
    [/dairy|tuna|agricultural/g, 'food/agriculture'],
    [/harmonized tariff|htsus|hts/g, 'HTS'],
    [/china|eu|european union|korea|switzerland|mexico|canada/g, 'country/trade partner'],
  ];
  for (const [pattern, label] of patterns) {
    if (pattern.test(normalized)) tags.push(label);
  }
  return uniqueClean(tags);
}

export function sectorsFromText(text: string): string[] {
  const normalized = text.toLowerCase();
  const sectors: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/automobile|auto parts|vehicles?|retail/g, 'Consumer Discretionary'],
    [/steel|aluminum|lumber|timber|wood|chemical|metals?/g, 'Materials'],
    [/aircraft|aerospace|machinery|industrial/g, 'Industrials'],
    [/semiconductor|chips?|software|technology/g, 'Information Technology'],
    [/pharmaceutical|drug|generic|medical/g, 'Health Care'],
    [/dairy|tuna|agricultural|food/g, 'Consumer Staples'],
    [/oil|gas|energy|solar/g, 'Energy'],
    [/bank|financial|insurance/g, 'Financials'],
  ];
  for (const [pattern, sector] of patterns) {
    if (pattern.test(normalized)) sectors.push(sector);
  }
  return uniqueClean(sectors);
}

function importanceFromFederalRegisterText(text: string): 1 | 2 | 3 {
  if (/\b(executive order|proclamation|section 232|reciprocal|tariff-related|adjusting imports|trade and investment deal)\b/i.test(text)) return 3;
  if (/\b(harmonized tariff|htsus|hts|tariff-rate quota|customs|trade representative|commerce|international trade commission)\b/i.test(text)) return 2;
  return 1;
}

function normalizeImportance(value: number): 1 | 2 | 3 {
  if (value >= 3) return 3;
  if (value <= 1) return 1;
  return 2;
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function agencySummary(agencies: FederalRegisterDocument['agencies']): string {
  const names = (agencies || []).map((agency) => agency.name || agency.raw_name || '').filter(Boolean);
  return names.length > 0 ? `Agency: ${names.join(', ')}` : '';
}

function uniqueUpper(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))).sort();
}

function uniqueClean(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function stableId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const FOMC_MEETINGS: Array<{ date: string; endDate: string; title: string; summary: string; sep?: boolean }> = [
  { date: '2025-01-28', endDate: '2025-01-29', title: 'FOMC meeting', summary: 'Federal Open Market Committee scheduled meeting.' },
  { date: '2025-03-18', endDate: '2025-03-19', title: 'FOMC meeting with projections', summary: 'Federal Open Market Committee scheduled meeting associated with Summary of Economic Projections.', sep: true },
  { date: '2025-05-06', endDate: '2025-05-07', title: 'FOMC meeting', summary: 'Federal Open Market Committee scheduled meeting.' },
  { date: '2025-06-17', endDate: '2025-06-18', title: 'FOMC meeting with projections', summary: 'Federal Open Market Committee scheduled meeting associated with Summary of Economic Projections.', sep: true },
  { date: '2025-07-29', endDate: '2025-07-30', title: 'FOMC meeting', summary: 'Federal Open Market Committee scheduled meeting.' },
  { date: '2025-09-16', endDate: '2025-09-17', title: 'FOMC meeting with projections', summary: 'Federal Open Market Committee scheduled meeting associated with Summary of Economic Projections.', sep: true },
  { date: '2025-10-28', endDate: '2025-10-29', title: 'FOMC meeting', summary: 'Federal Open Market Committee scheduled meeting.' },
  { date: '2025-12-09', endDate: '2025-12-10', title: 'FOMC meeting with projections', summary: 'Federal Open Market Committee scheduled meeting associated with Summary of Economic Projections.', sep: true },
  { date: '2026-01-27', endDate: '2026-01-28', title: 'FOMC meeting', summary: 'Federal Open Market Committee scheduled meeting.' },
  { date: '2026-03-17', endDate: '2026-03-18', title: 'FOMC meeting with projections', summary: 'Federal Open Market Committee scheduled meeting associated with Summary of Economic Projections.', sep: true },
  { date: '2026-04-28', endDate: '2026-04-29', title: 'FOMC meeting', summary: 'Federal Open Market Committee scheduled meeting.' },
  { date: '2026-06-16', endDate: '2026-06-17', title: 'FOMC meeting with projections', summary: 'Federal Open Market Committee scheduled meeting associated with Summary of Economic Projections.', sep: true },
  { date: '2026-07-28', endDate: '2026-07-29', title: 'FOMC meeting', summary: 'Federal Open Market Committee scheduled meeting.' },
  { date: '2026-09-15', endDate: '2026-09-16', title: 'FOMC meeting with projections', summary: 'Federal Open Market Committee scheduled meeting associated with Summary of Economic Projections.', sep: true },
  { date: '2026-10-27', endDate: '2026-10-28', title: 'FOMC meeting', summary: 'Federal Open Market Committee scheduled meeting.' },
  { date: '2026-12-08', endDate: '2026-12-09', title: 'FOMC meeting with projections', summary: 'Federal Open Market Committee scheduled meeting associated with Summary of Economic Projections.', sep: true },
];
