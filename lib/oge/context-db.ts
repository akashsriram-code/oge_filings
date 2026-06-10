import { Client } from 'pg';
import { stableId } from './analytics';
import { sectorsFromText, tagsFromText } from './events';
import type { EventCategory, OgeEvent } from './types';

const DEFAULT_TOTAL_LIMIT = 1200;
const DEFAULT_SOCIAL_LIMIT = 500;
const DEFAULT_DOCUMENT_LIMIT = 450;
const DEFAULT_REUTERS_LIMIT = 350;

interface ContextDbOptions {
  minDate: string;
  maxDate?: string;
  totalLimit?: number;
  socialLimit?: number;
  documentLimit?: number;
  reutersLimit?: number;
}

interface TaDocumentRow {
  id: string;
  source: string | null;
  doc_type: string | null;
  title: string | null;
  doc_date: string | Date | null;
  speaker: string | null;
  url: string | null;
  full_text: string | null;
}

interface ReutersStoryRow {
  uri: string;
  headline: string | null;
  slug: string | null;
  fragment: string | null;
  body_text: string | null;
  first_created: string | Date | null;
  reuters_url: string | null;
  topic_codes: string[] | null;
}

export async function fetchTrumpContextDbEvents(options: ContextDbOptions): Promise<OgeEvent[]> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return [];

  const client = new Client({
    connectionString: normalizeConnectionString(connectionString),
  });

  await client.connect();
  try {
    const maxDate = options.maxDate || new Date().toISOString().slice(0, 10);
    const socialLimit = positiveInt(options.socialLimit, DEFAULT_SOCIAL_LIMIT);
    const documentLimit = positiveInt(options.documentLimit, DEFAULT_DOCUMENT_LIMIT);
    const reutersLimit = positiveInt(options.reutersLimit, DEFAULT_REUTERS_LIMIT);
    const totalLimit = positiveInt(options.totalLimit, DEFAULT_TOTAL_LIMIT);

    const socialRows = await queryTrumpSocialDocuments(client, options.minDate, maxDate, socialLimit);
    const documentRows = await queryTrumpOfficialDocuments(client, options.minDate, maxDate, documentLimit);
    const reutersRows = await queryReutersStories(client, options.minDate, maxDate, reutersLimit);

    return dedupeEvents([
      ...socialRows.map(documentRowToEvent),
      ...documentRows.map(documentRowToEvent),
      ...reutersRows.map(reutersRowToEvent),
    ])
      .filter((event): event is OgeEvent => Boolean(event))
      .sort((a, b) =>
        b.importance - a.importance ||
        b.date.localeCompare(a.date) ||
        a.title.localeCompare(b.title)
      )
      .slice(0, totalLimit)
      .sort((a, b) =>
        a.date.localeCompare(b.date) ||
        b.importance - a.importance ||
        a.title.localeCompare(b.title)
      );
  } finally {
    await client.end();
  }
}

function normalizeConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.searchParams.get('sslmode') === 'require') {
      url.searchParams.set('sslmode', 'verify-full');
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

function queryTrumpSocialDocuments(client: Client, minDate: string, maxDate: string, limit: number) {
  return client.query<TaDocumentRow>(`
    select id, source, doc_type, title, doc_date, speaker, url, left(coalesce(full_text, ''), 2800) as full_text
    from ta_documents
    where doc_date >= $1::date
      and doc_date <= $2::date
      and source in ('truth_social', 'twitter')
      and speaker ilike '%Trump%'
      and not coalesce(title, '') ilike 'RT:%'
      and (
        coalesce(title, '') ~* $3
        or coalesce(full_text, '') ~* $3
      )
    order by doc_date desc, id desc
    limit $4
  `, [minDate, maxDate, contextRegex(), limit]).then((result) => result.rows);
}

function queryTrumpOfficialDocuments(client: Client, minDate: string, maxDate: string, limit: number) {
  return client.query<TaDocumentRow>(`
    select id, source, doc_type, title, doc_date, speaker, url, left(coalesce(full_text, ''), 3200) as full_text
    from ta_documents
    where doc_date >= $1::date
      and doc_date <= $2::date
      and (
        source in ('app', 'factbase')
        or doc_type in ('remarks', 'statement', 'memorandum', 'executive_order', 'proclamation', 'transcript', 'pool_report')
      )
      and (
        coalesce(speaker, '') ilike '%Trump%'
        or coalesce(title, '') ilike '%Trump%'
      )
      and (
        coalesce(title, '') ~* $3
        or coalesce(full_text, '') ~* $3
        or doc_type in ('executive_order', 'proclamation', 'memorandum')
      )
    order by doc_date desc, id desc
    limit $4
  `, [minDate, maxDate, contextRegex(), limit]).then((result) => result.rows);
}

function queryReutersStories(client: Client, minDate: string, maxDate: string, limit: number) {
  return client.query<ReutersStoryRow>(`
    select uri, headline, slug, fragment, left(coalesce(body_text, ''), 3600) as body_text, first_created, reuters_url, topic_codes
    from ia_reuters_stories
    where first_created >= $1::date
      and first_created < ($2::date + interval '1 day')
      and (
        coalesce(headline, '') ~* $3
        or coalesce(slug, '') ~* $3
        or coalesce(fragment, '') ~* $3
        or coalesce(body_text, '') ~* $3
        or topic_codes && array['N2:POTUS', 'N2:WASH', 'N2:POL']
      )
    order by first_created desc, uri desc
    limit $4
  `, [minDate, maxDate, contextRegex(), limit]).then((result) => result.rows);
}

function documentRowToEvent(row: TaDocumentRow): OgeEvent | null {
  const date = isoDate(row.doc_date);
  const title = cleanText(row.title || row.full_text || '');
  if (!date || !title) return null;

  const text = `${title} ${row.full_text || ''}`;
  const category = categoryForDocument(row, text);
  const tags = tagsFromText(text);
  const sectors = sectorsFromText(text);
  const importance = importanceForContextText(text, row.doc_type || '', row.source || '');
  const sourceName = sourceNameForDocument(row);

  return {
    id: stableId(`context-db|ta|${row.id}|${date}`),
    date,
    endDate: null,
    category,
    title: title.slice(0, 180),
    summary: summaryFromText(row.full_text || title, sourceName),
    sourceName,
    sourceUrl: row.url || '',
    tickers: tickersFromText(text),
    sectors,
    tags: uniqueClean([...(tags || []), row.doc_type || '', row.source || '']),
    importance,
  };
}

function reutersRowToEvent(row: ReutersStoryRow): OgeEvent | null {
  const date = isoDate(row.first_created);
  const title = cleanText(row.headline || row.slug || '');
  if (!date || !title) return null;

  const text = `${title} ${row.slug || ''} ${row.fragment || ''} ${row.body_text || ''}`;
  const topicTags = (row.topic_codes || []).filter((code) =>
    /^N2:|^R:|^MCC:|^subj:/i.test(code)
  );

  return {
    id: stableId(`context-db|reuters|${row.uri}|${date}`),
    date,
    endDate: null,
    category: 'reuters',
    title: title.slice(0, 180),
    summary: summaryFromText(row.fragment || row.body_text || title, 'Reuters'),
    sourceName: 'Reuters',
    sourceUrl: row.reuters_url || '',
    tickers: tickersFromText(text, topicTags),
    sectors: sectorsFromText(text),
    tags: uniqueClean([...tagsFromText(text), ...(row.slug ? [row.slug] : []), ...topicTags.slice(0, 12)]),
    importance: importanceForContextText(text, 'reuters_story', 'reuters'),
  };
}

function categoryForDocument(row: TaDocumentRow, text: string): EventCategory {
  if (row.source === 'truth_social' || row.source === 'twitter') return 'truth-social';
  if (/\b(interview|q&a|transcript|podcast|fox|cnbc|nbc|abc|cbs|cnn|town hall)\b/i.test(`${row.doc_type || ''} ${row.title || ''} ${text}`)) return 'interview';
  if (/\b(stock market|market|nasdaq|dow|s&p|wall street|yield|bond|rates?)\b/i.test(text)) return 'market';
  return 'white-house';
}

function sourceNameForDocument(row: TaDocumentRow): string {
  if (row.source === 'truth_social') return 'Truth Social';
  if (row.source === 'twitter') return 'Twitter/X';
  if (row.source === 'factbase') return 'Factbase transcript';
  if (row.doc_type === 'executive_order') return 'White House executive order';
  if (row.doc_type === 'proclamation') return 'White House proclamation';
  if (row.doc_type === 'memorandum') return 'White House memorandum';
  return 'Trump Archive';
}

function importanceForContextText(text: string, docType: string, source: string): 1 | 2 | 3 {
  const normalized = text.toLowerCase();
  if (/\b(executive order|proclamation|tariff|sanction|federal reserve|interest rates?|stock market|semiconductor|steel|aluminum|pharma|drug prices?|bank|crypto|bitcoin|oil|gas|energy|defense|ai|china|trade deal)\b/.test(normalized)) return 3;
  if (['executive_order', 'proclamation', 'memorandum'].includes(docType)) return 3;
  if (source === 'reuters' && /\b(update|exclusive|explainer|tariff|trade|markets?|stocks?)\b/i.test(text)) return 3;
  if (source === 'truth_social' || source === 'twitter') return 2;
  return 2;
}

function contextRegex(): string {
  return [
    'tariff',
    'trade',
    'stock(s)?',
    'market(s)?',
    'nasdaq',
    'dow',
    's&p',
    'wall street',
    'bank(s)?',
    'bond(s)?',
    'yield(s)?',
    'interest rate(s)?',
    'fed(eral reserve)?',
    'inflation',
    'crypto',
    'bitcoin',
    'oil',
    'gas',
    'energy',
    'semiconductor(s)?',
    'chip(s)?',
    'steel',
    'aluminum',
    'pharma(ceutical)?',
    'drug(s)?',
    'health care',
    'defense',
    'airline(s)?',
    'auto(s)?',
    'electric vehicle(s)?',
    'ai',
    'technology',
    'real estate',
    'china',
    'canada',
    'mexico',
    'european union',
    'tax(es)?',
    'regulation(s)?',
  ].join('|');
}

function tickersFromText(text: string, topicTags: string[] = []): string[] {
  const tickers = new Set<string>();
  for (const tag of topicTags) {
    const match = tag.match(/^R:([A-Z0-9.:-]+)/i);
    if (match) tickers.add(match[1].replace(/\..*$/, '').toUpperCase());
  }
  for (const match of text.matchAll(/\$([A-Z]{1,5})(?:\b|[.,;:])/g)) {
    tickers.add(match[1].toUpperCase());
  }
  return Array.from(tickers).sort();
}

function summaryFromText(value: string, fallback: string): string {
  const cleaned = cleanText(value);
  if (!cleaned) return `${fallback} context item from Trump timing database.`;
  return cleaned.length > 260 ? `${cleaned.slice(0, 257).trim()}...` : cleaned;
}

function cleanText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
}

function isoDate(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
}

function dedupeEvents(events: Array<OgeEvent | null>): OgeEvent[] {
  const byId = new Map<string, OgeEvent>();
  for (const event of events) {
    if (!event) continue;
    byId.set(event.id, event);
  }
  return Array.from(byId.values());
}

function uniqueClean(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.floor(value);
}
