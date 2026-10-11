import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('PDF uploads are visible and the convert action explains missing master', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#appStatus')).toHaveText('Ready');

  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const bytes = Buffer.from(await pdf.save());

  // The sample is deliberately not the approved master: it must be visibly rejected,
  // not silently ignored or leave the button inert.
  await page.locator('#masterFile').setInputFiles({
    name: 'Test Master.pdf',
    mimeType: 'application/pdf',
    buffer: bytes
  });
  await expect(page.locator('#masterStatus')).toContainText('Test Master.pdf');
  await expect(page.locator('#masterStatus')).toContainText('Not the EXACT project master');

  await page.locator('#sourceFiles').setInputFiles({
    name: '001.pdf',
    mimeType: 'application/pdf',
    buffer: bytes
  });
  await expect(page.locator('#sourceCount')).toContainText('1 form selected');
  await expect(page.locator('#fileList')).toContainText('001.pdf');

  // Never keep the main action silently disabled.
  const convert = page.getByRole('button', { name: /Convert forms/ });
  await expect(convert).toBeEnabled();
  await convert.click();
  await expect(page.locator('#message')).toContainText('First, select the master');
  expect(errors).toEqual([]);
});

test('PDF drop area accepts a file without a picker', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#appStatus')).toHaveText('Ready');

  await page.locator('#sourceDrop').evaluate(drop => {
    const file = new File(['%PDF-1.4 test'], '002.pdf', { type: 'application/pdf' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    drop.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });

  await expect(page.locator('#sourceCount')).toContainText('1 form selected');
  await expect(page.locator('#fileList')).toContainText('002.pdf');
});
