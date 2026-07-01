/**
 * Parse the latest July 1, 2026 PTR filings to extract line items
 */
import { PDFParse } from 'pdf-parse';
import * as fs from 'fs';
import * as path from 'path';

const LATEST_FILINGS = [
  {
    name: 'Donald-J-Trump-06.25.2026-278T.pdf',
    url: 'https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/AC43530823BD60D485258E27002DDEF7/$FILE/Donald-J-Trump-06.25.2026-278T.pdf',
    filedDate: '2026-07-01',
    docDate: '2026-06-25',
  },
  {
    name: 'Donald-J-Trump-06.25.2026-278T (2).pdf',
    url: 'https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/F9CA13B970439E8F85258E27002DDF15/$FILE/Donald-J-Trump-06.25.2026-278T%20(2).pdf',
    filedDate: '2026-07-01',
    docDate: '2026-06-25',
  },
];

interface ParsedTransaction {
  date: string;
  type: 'Purchase' | 'Sale' | 'Exchange';
  description: string;
  amount: string;
  ticker?: string;
}

async function main() {
  console.log('=== Parsing Latest PTR Filings (July 1, 2026) ===\n');
  
  const allTransactions: ParsedTransaction[] = [];

  for (const filing of LATEST_FILINGS) {
    console.log(`\n--- Processing: ${filing.name} ---`);
    console.log(`    Document Date: ${filing.docDate}, Filed: ${filing.filedDate}`);
    
    try {
      const parser = new PDFParse({ url: filing.url });
      const result = await parser.getText();
      const text = result.text || '';
      console.log(`    Extracted ${text.length} characters`);
      await parser.destroy();
      
      // Parse transactions from the text
      const transactions = parseTransactionsFromText(text);
      console.log(`    Found ${transactions.length} transactions`);
      
      if (transactions.length > 0) {
        console.log('\n    LINE ITEMS:');
        transactions.forEach((tx, i) => {
          console.log(`    ${i + 1}. ${tx.date} | ${tx.type} | ${tx.ticker || ''} | ${tx.description.substring(0, 50)}... | ${tx.amount}`);
        });
        allTransactions.push(...transactions);
      }
      
      // Also output raw text sections for review
      console.log('\n    === RAW TEXT SAMPLE (Part 7: Transactions) ===');
      const part7Start = text.indexOf('Part 7');
      if (part7Start >= 0) {
        console.log(text.substring(part7Start, part7Start + 3000));
      } else {
        console.log('    Part 7 section not found. Full text sample:');
        console.log(text.substring(0, 2000));
      }
      
    } catch (error) {
      console.log(`    Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total transactions parsed: ${allTransactions.length}`);
  
  // Group by type
  const byType = allTransactions.reduce((acc, tx) => {
    acc[tx.type] = (acc[tx.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('By type:', byType);
  
  // Look for tech stocks
  const techTickers = ['AVGO', 'META', 'AMZN', 'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG'];
  const techTransactions = allTransactions.filter(tx => 
    techTickers.some(ticker => 
      tx.ticker === ticker || tx.description.toUpperCase().includes(ticker)
    )
  );
  if (techTransactions.length > 0) {
    console.log('\nTech stock transactions:');
    techTransactions.forEach(tx => {
      console.log(`  ${tx.date} | ${tx.type} | ${tx.ticker || tx.description.substring(0, 40)} | ${tx.amount}`);
    });
  }
  
  // Output as JSON for ingestion
  if (allTransactions.length > 0) {
    const outputPath = path.join(process.cwd(), 'data', 'oge', 'trump', 'parsed-july1-2026.json');
    fs.writeFileSync(outputPath, JSON.stringify(allTransactions, null, 2));
    console.log(`\nSaved to: ${outputPath}`);
  }
}

function parseTransactionsFromText(text: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  const lines = text.split(/\n/);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Pattern: "1 DESCRIPTION purchase/sale DATE [Yes] AMOUNT"
    // e.g., "1 	ABBOTT LABS INC COM 	purchase 	4/17/2026"
    // or "3 	Amazon Com Inc 	purchase 	5/5/2026 	Yes $1,000,001 - $5,000,000"
    
    const numberedMatch = line.match(/^(\d+)\s+(.+?)\s+(purchase|sale|exchange)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*(Yes|No)?\s*(\$[\d,]+\s*[-–]\s*\$[\d,]+)?/i);
    if (numberedMatch) {
      const [, num, desc, type, date, late, amount] = numberedMatch;
      transactions.push({
        date: normalizeDate(date),
        type: normalizeTransactionType(type),
        description: desc.trim(),
        amount: amount?.replace(/\s+/g, ' ') || '',
        ticker: extractTicker(desc),
      });
      continue;
    }
    
    // Alternative pattern without row number
    const directMatch = line.match(/(.+?)\s+(purchase|sale|exchange)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*(Yes|No)?\s*(\$[\d,]+\s*[-–]\s*\$[\d,]+)?/i);
    if (directMatch && directMatch[1].length > 3 && directMatch[1].length < 100) {
      const [, desc, type, date, late, amount] = directMatch;
      // Skip header-like lines
      if (/Description|Notification|Amount/i.test(desc)) continue;
      transactions.push({
        date: normalizeDate(date),
        type: normalizeTransactionType(type),
        description: desc.trim(),
        amount: amount?.replace(/\s+/g, ' ') || '',
        ticker: extractTicker(desc),
      });
    }
  }
  
  return transactions;
}

function extractTicker(description: string): string | undefined {
  // Known tickers to look for
  const knownTickers = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'META', 'NVDA', 'AVGO', 'TSLA', 'JPM', 'V', 'UNH', 'HD', 'PG', 'MA', 'CVX', 'MRK', 'ABBV', 'PFE', 'KO', 'PEP', 'COST', 'WMT', 'BAC', 'CRM', 'ADBE', 'NFLX', 'AMD', 'INTC', 'CSCO'];
  
  const upper = description.toUpperCase();
  
  // Check for exact ticker matches
  for (const ticker of knownTickers) {
    if (upper.includes(ticker)) return ticker;
  }
  
  // Map company names to tickers
  const nameMap: Record<string, string> = {
    'APPLE': 'AAPL',
    'MICROSOFT': 'MSFT',
    'AMAZON': 'AMZN',
    'ALPHABET': 'GOOGL',
    'GOOGLE': 'GOOGL',
    'META PLATFORMS': 'META',
    'NVIDIA': 'NVDA',
    'BROADCOM': 'AVGO',
    'TESLA': 'TSLA',
    'JPMORGAN': 'JPM',
    'VISA': 'V',
    'UNITEDHEALTH': 'UNH',
    'HOME DEPOT': 'HD',
    'PROCTER': 'PG',
    'MASTERCARD': 'MA',
    'CHEVRON': 'CVX',
    'MERCK': 'MRK',
    'ABBVIE': 'ABBV',
    'PFIZER': 'PFE',
    'COCA-COLA': 'KO',
    'COCA COLA': 'KO',
    'PEPSI': 'PEP',
    'COSTCO': 'COST',
    'WALMART': 'WMT',
    'BANK OF AMERICA': 'BAC',
    'SALESFORCE': 'CRM',
    'ADOBE': 'ADBE',
    'NETFLIX': 'NFLX',
  };
  
  for (const [name, ticker] of Object.entries(nameMap)) {
    if (upper.includes(name)) return ticker;
  }
  
  return undefined;
}

function parseTransactionContent(content: string, allLines: string[], lineIndex: number): ParsedTransaction | null {
  // Look for transaction type
  const typeMatch = content.match(/\b(Purchase|Sale|Exchange|Buy|Sell)\b/i);
  if (!typeMatch) return null;
  
  const type = normalizeTransactionType(typeMatch[1]);
  
  // Look for date (MM/DD/YYYY or M/D/YYYY or similar)
  const dateMatch = content.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  const date = dateMatch ? normalizeDate(dateMatch[1]) : '';
  
  // Look for amount range ($X,XXX - $X,XXX)
  const amountMatch = content.match(/(\$[\d,]+\s*-\s*\$[\d,]+|\$[\d,]+(?:\.\d{2})?)/);
  const amount = amountMatch ? amountMatch[1] : '';
  
  // Description is everything before type/date/amount
  let description = content;
  if (typeMatch.index !== undefined) {
    description = content.substring(0, typeMatch.index).trim();
  }
  
  // Try to extract ticker from description
  const tickerMatch = description.match(/\b([A-Z]{1,5})\b(?:\s|$)/);
  const ticker = tickerMatch && isLikelyTicker(tickerMatch[1]) ? tickerMatch[1] : undefined;
  
  if (!date && !amount) return null;
  
  return {
    date,
    type,
    description: description.replace(/^\d+\.\s*/, '').trim(),
    amount,
    ticker,
  };
}

function normalizeTransactionType(type: string): 'Purchase' | 'Sale' | 'Exchange' {
  const upper = type.toUpperCase();
  if (upper === 'BUY') return 'Purchase';
  if (upper === 'SELL') return 'Sale';
  if (upper === 'PURCHASE') return 'Purchase';
  if (upper === 'SALE') return 'Sale';
  if (upper === 'EXCHANGE') return 'Exchange';
  return 'Purchase';
}

function normalizeDate(dateStr: string): string {
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  let [month, day, year] = parts;
  if (year.length === 2) year = '20' + year;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function isLikelyTicker(str: string): boolean {
  // Common non-ticker words to exclude
  const nonTickers = ['THE', 'AND', 'FOR', 'INC', 'LLC', 'LTD', 'CO', 'CORP', 'REV', 'DUE', 'VAR'];
  if (nonTickers.includes(str)) return false;
  if (str.length < 1 || str.length > 5) return false;
  return true;
}

main().catch(console.error);