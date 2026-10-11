import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { FORM8_FIELD_PAGES, FORM8_PAGE_ANCHORS } from '../src/field-layout.js';

const PAGE_HEIGHT = 842;
async function syntheticFlatExample() {
  const source = await PDFDocument.create();
  const master = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  const form = master.getForm();

  for (let pageNo=0; pageNo<12; pageNo++) {
    const srcPage = source.addPage([595, PAGE_HEIGHT]);
    const dstPage = master.addPage([595, PAGE_HEIGHT]);
    srcPage.drawText('JCQ/AA/LD Form 8', {x:400, y:PAGE_HEIGHT-30,size:10,font});
    srcPage.drawText(FORM8_PAGE_ANCHORS[pageNo], {x:30, y:PAGE_HEIGHT-82,size:12,font});

    for (const [index,name] of FORM8_FIELD_PAGES[pageNo].entries()) {
      const top = 160 + index*33;
      const box = { x:185, y:PAGE_HEIGHT-top-28, width: name.startsWith('Check')?27:340, height:28 };
      const value = name.startsWith('Check Box')
        ? form.createCheckBox(name) : form.createTextField(name);
      value.addToPage(dstPage, box);
      if (name === 'Text 50.Page 1' || name === 'Text Field 2') {
        const text = name === 'Text Field 2' ? 'Synthetic evidence only' : 'TEST STUDENT';
        srcPage.drawText(text, { x:box.x+5, y:box.y+10,size:10,font });
      }
      if (name === 'Check Box 50') {
        // A native drawn check, NOT a PDF checkbox widget.
        srcPage.drawLine({
          start:{x:box.x+6,y:box.y+12},
          end:{x:box.x+12,y:box.y+5},
          thickness:3, color:rgb(0,0,0)
        });
        srcPage.drawLine({
          start:{x:box.x+12,y:box.y+5},
          end:{x:box.x+23,y:box.y+22},
          thickness:3, color:rgb(0,0,0)
        });
      }
    }
  }
  return {source:Array.from(await source.save()),master:Array.from(await master.save())};
}

test('flattened Form 8: text and printed ticks become editable master values', async ({page}) => {
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const fixture = await syntheticFlatExample();
  await page.goto('e2e/flattened-smoke.html');
  await page.waitForFunction(() => typeof window.runSynthetic==='function',{timeout:15000});
  const result = await page.evaluate(({source,master})=>window.runSynthetic(source,master),fixture);
  expect(result.candidate).toBe('TEST STUDENT');
  expect(result.evidence).toBe('Synthetic evidence only');
  expect(result.checked).toBe(true);
  expect(result.notChecked).toBe(false);
  expect(result.report.method).toBe('flattened');
  expect(result.report.transferred).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});
