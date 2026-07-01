/**
 * Parse August 19, 2025 PTR PDFs to find July 23, 2025 tech stock purchases
 */
import { promises as fs } from 'fs';
import path from 'path';

const AUG19_PTRS = [
  {
    id: 'c640df51',
    url: 'https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/E9C024E25C9E4B2085258CEB006E7E23/$FILE/Donald-J-Trump-08.12.2025-278T.pdf',
    name: 'Donald-J-Trump-08.12.2025-278T.pdf',
  },
  {
    id: '342f9181',
    url: 'https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/024D876AAE518C5085258CEB006E7E2E/$FILE/Donald-J-Trump-08.12.2025-278T(2)%20AMENDED.pdf',
    name: 'Donald-J-Trump-08.12.2025-278T(2)-AMENDED.pdf',
  },
  {
    id: '3a318e1f',
    url: 'https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/5315A095A2EE1B9185258CEB006E7E36/$FILE/Donald-J-Trump-08.12.2025-278T(3).pdf',
    name: 'Donald-J-Trump-08.12.2025-278T(3).pdf',
  },
];

const TECH_TICKERS = ['AVGO', 'META', 'AMZN', 'AAPL', 'MSFT', 'NVDA'];
const TECH_NAMES = [
  'BROADCOM',
  'META PLATFORMS',
  'AMAZON',
  'APPLE',
  'MICROSOFT',
  'NVIDIA',
];

const TARGET_DATE = '07/23/2025';
const TARGET_DATE_ALT = '7/23/2025';
const TARGET_DATE_ISO = '2025-07-23';

async function main() {
  console.log('=== Parsing August 19, 2025 PTR PDFs ===\n');
  console.log('Looking for purchases dated 2025-07-23 of:');
  console.log('  AVGO, META, AMZN, AAPL, MSFT, NVDA ($1M-$5M range)\n');

  // Import PDFParse class
  const { PDFParse } = await import('pdf-parse');

  for (const ptr of AUG19_PTRS) {
    console.log(`\n--- Processing: ${ptr.name} ---`);
    
    try {
      // Parse PDF using URL directly
      const parser = new PDFParse({ url: ptr.url });
      const result = await parser.getText();
      const text = result.text || '';
      console.log(`  Extracted ${text.length} characters of text`);
      await parser.destroy();
      
      // Search for July 23 transactions
      searchForJuly23Transactions(text, ptr.name);
      
    } catch (error) {
      console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function parseWithFetch() {
  for (const ptr of AUG19_PTRS) {
    console.log(`\n--- Fetching: ${ptr.name} ---`);
    
    try {
      const response = await fetch(ptr.url);
      if (!response.ok) {
        console.log(`  Failed to fetch: ${response.status}`);
        continue;
      }
      
      const buffer = Buffer.from(await response.arrayBuffer());
      console.log(`  Downloaded: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
      
      // Convert to string and search for patterns
      const rawText = buffer.toString('utf-8', 0, Math.min(buffer.length, 500000));
      
      // Look for date patterns
      const hasJuly23 = rawText.includes('07/23/2025') || 
                        rawText.includes('7/23/2025') ||
                        rawText.includes('07-23-2025') ||
                        rawText.includes('2025-07-23');
      
      console.log(`  Contains July 23, 2025 references: ${hasJuly23}`);
      
      // Look for tech stock names
      for (const name of TECH_NAMES) {
        if (rawText.toUpperCase().includes(name)) {
          console.log(`  Found reference to: ${name}`);
        }
      }
      
    } catch (error) {
      console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function searchForJuly23Transactions(text: string, filename: string) {
  const lines = text.split(/\n/);
  const found: string[] = [];
  
  // Look for lines containing July 23 date
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const context = [lines[i-2], lines[i-1], line, lines[i+1], lines[i+2]]
      .filter(Boolean)
      .join(' ');
    
    if (
      line.includes(TARGET_DATE) || 
      line.includes(TARGET_DATE_ALT) ||
      line.includes(TARGET_DATE_ISO) ||
      line.includes('07/23/25') ||
      line.includes('7/23/25')
    ) {
      // Check if this line or nearby lines mention tech stocks
      const contextUpper = context.toUpperCase();
      for (const name of TECH_NAMES) {
        if (contextUpper.includes(name)) {
          found.push(`  FOUND: ${name} on July 23 - Context: ${context.substring(0, 200)}...`);
        }
      }
      for (const ticker of TECH_TICKERS) {
        if (context.includes(ticker) && !TECH_NAMES.some(n => contextUpper.includes(n))) {
          found.push(`  FOUND: ${ticker} on July 23 - Context: ${context.substring(0, 200)}...`);
        }
      }
      
      // Also log generic July 23 finds
      if (found.length === 0) {
        console.log(`  July 23 reference found: ${line.substring(0, 100)}`);
      }
    }
  }
  
  // Search for tech stock names with Purchase type
  const purchasePattern = /Purchase/gi;
  const techPattern = new RegExp(TECH_NAMES.join('|'), 'gi');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const context = [lines[i-3], lines[i-2], lines[i-1], line, lines[i+1], lines[i+2], lines[i+3]]
      .filter(Boolean)
      .join(' ');
    
    if (techPattern.test(line) && /Purchase/i.test(context)) {
      const dateMatch = context.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      if (dateMatch) {
        const date = dateMatch[1];
        if (date.includes('7/23') || date.includes('07/23')) {
          found.push(`  TECH PURCHASE: ${line.substring(0, 150)} [Date: ${date}]`);
        }
      }
    }
  }
  
  if (found.length > 0) {
    console.log('\n  === MATCHES FOUND ===');
    found.forEach(f => console.log(f));
  } else {
    console.log('  No July 23 tech stock purchases found in this PDF');
    
    // Show what dates ARE present
    const dateMatches = text.match(/\b(\d{1,2}\/\d{1,2}\/202[45])\b/g) || [];
    const uniqueDates = [...new Set(dateMatches)].sort();
    if (uniqueDates.length > 0) {
      console.log(`  Dates found in PDF: ${uniqueDates.slice(0, 20).join(', ')}${uniqueDates.length > 20 ? '...' : ''}`);
    }
    
    // Show tech stock mentions
    for (const name of TECH_NAMES) {
      const count = (text.toUpperCase().match(new RegExp(name, 'g')) || []).length;
      if (count > 0) {
        console.log(`  ${name} mentioned ${count} times`);
      }
    }
  }
}

main().catch(console.error);