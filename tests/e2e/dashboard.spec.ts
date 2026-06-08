import { expect, test } from '@playwright/test';

test('renders overview and switches dashboard views', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Trump OGE Filings' })).toBeVisible();
  await expect(page.getByText('Volume midpoint')).toBeVisible();
  await expect(page.getByText('Sector Exposure Map')).toBeVisible();
  await expect(page.getByText('Visible transactions are the rows left after the active filters.')).toBeVisible();
  await expect(page.getByText('Event overlay')).toBeVisible();
  await expect(page.locator('.recharts-reference-dot-dot').first()).toBeVisible();
  await expect(page.getByText('Selected chart event')).toBeVisible();
  await expect(page.getByText('Proximity analysis is a reporting prompt only')).toBeVisible();
  await expect(page.getByText('Equity Stocks Bought').first()).toBeVisible();

  await page.getByRole('button', { name: 'Holdings' }).click();
  await expect(page.getByText('Estimated Holdings')).toBeVisible();
  await expect(page.getByText('Stocks grouped by resolved ticker')).toBeVisible();
  await expect(page.getByText('No annual baseline').first()).toBeVisible();

  await page.getByRole('button', { name: 'Transactions' }).click();
  await expect(page.getByText('Transactions').first()).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
});

test('filters late filings without blanking the table', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Late only' }).click();
  await page.getByRole('button', { name: 'Transactions' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByText('Reported late').first()).toBeVisible();
});
