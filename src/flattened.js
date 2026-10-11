import { PDFTextField, PDFCheckBox } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { FORM8_FIELD_PAGES, FORM8_PAGE_ANCHORS } from './field-layout.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_TICK_INK = 48;
const UNCERTAIN_TICK_INK = 15;

// PDF.js text coordinates have a bottom-left origin, whilst the field rectangles
// below use a top-left origin (as produced by pdf-lib widget measurements).
function visibleTextItems(content, pageHeight) {
  return content.items.filter(i => typeof i.str === 'string' && i.str.trim())
    .map(i => {
      const height = Math.abs(i.height || i.transform[3] || 10);
      const ascent = content.styles[i.fontName]?.ascent ?? 0.82;
      const top = pageHeight - i.transform[5] - height * ascent;
      return {
        text: i.str,
        x: i.transform[4],
        y: top + height * 0.5,
        height,
        width: Math.abs(i.width || 0),
      };
    });
}

function rectTopLeft(widget, height) {
  const { x, y, width, height: boxHeight } = widget.getRectangle();
  return { x0: x, y0: height - y - boxHeight, x1: x + width, y1: height - y };
}

function fieldText(items, rect) {
  // Centre-based matching excludes the page's labels, even when those labels
  // are immediately adjacent to an editable answer area.
  const included = items.filter(i =>
    i.x + Math.min(i.width, 20) * 0.5 >= rect.x0 - 1.5 &&
    i.x + Math.min(i.width, 20) * 0.5 <= rect.x1 + 1.5 &&
    i.y >= rect.y0 - 1.5 && i.y <= rect.y1 + 1.5
  ).sort((a, b) => a.y - b.y || a.x - b.x);

  if (!included.length) return '';
  const lines = [];
  for (const item of included) {
    const current = lines.at(-1);
    if (current && Math.abs(current.y - item.y) < Math.max(2.4, item.height * 0.38)) {
      current.parts.push(item);
    } else {
      lines.push({ y: item.y, height: item.height, parts: [item] });
    }
  }
  const built = [];
  for (const line of lines) {
    line.parts.sort((a,b) => a.x - b.x);
    let text = '';
    let right = -Infinity;
    for (const item of line.parts) {
      const gap = item.x - right;
      if (text && gap > 1.6 && !/\s$/.test(text) && !/^\s/.test(item.text)) text += ' ';
      text += item.text;
      right = Math.max(right, item.x + item.width);
    }
    const previous = built.at(-1);
    if (previous && line.y - previous.y > Math.max(previous.height, line.height) * 1.65) {
      built.push({ text: '', y: line.y - line.height, height: line.height });
    }
    built.push({ text: text.trim(), y: line.y, height: line.height });
  }
  return built.map(x => x.text).join('\n').trim();
}

function checkboxInk(imageData, rect, scale) {
  // Exclude the drawn square border; count only dark pixels in the interior.
  const padX = 4, padY = 3.5;
  const x0 = Math.ceil((rect.x0 + padX) * scale);
  const x1 = Math.floor((rect.x1 - padX) * scale);
  const y0 = Math.ceil((rect.y0 + padY) * scale);
  const y1 = Math.floor((rect.y1 - padY) * scale);
  const rgba = imageData.data;
  let dark = 0, total = 0;
  for (let y = Math.max(0,y0); y < Math.min(imageData.height,y1); y++) {
    for (let x = Math.max(0,x0); x < Math.min(imageData.width,x1); x++) {
      const k = (y * imageData.width + x) * 4;
      if (rgba[k+3] < 210) continue;
      total++;
      const grey = 0.2126*rgba[k] + 0.7152*rgba[k+1] + 0.0722*rgba[k+2];
      if (grey < 115) dark++;
    }
  }
  return { dark, total };
}

async function renderPage(page) {
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser cannot inspect PDF checkboxes.');
  await page.render({ canvasContext: context, viewport }).promise;
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = 0; canvas.height = 0;
  return { data, scale };
}

export async function extractFlattened(sourceBytes, destination) {
  const loading = pdfjs.getDocument({
    data: new Uint8Array(sourceBytes),
    useSystemFonts: true,
    isEvalSupported: false
  });
  const source = await loading.promise;
  try {
    if (source.numPages !== 12 || destination.getPageCount() !== 12) {
      throw new Error('Flattened PDF has the wrong number of pages (expected 12).');
    }
    const form = destination.getForm();
    const warnings = [];
    const missing = [];
    let populated = 0;
    let ticks = 0;

    // Always clear every sample entry in the supplied master, including checkboxes.
    for (const field of form.getFields()) {
      if (field instanceof PDFTextField) field.setText('');
      if (field instanceof PDFCheckBox) field.uncheck();
    }

    for (let p = 0; p < 12; p++) {
      const page = await source.getPage(p+1);
      const size = destination.getPage(p).getSize();
      const { width, height } = page.getViewport({ scale: 1 });
      if (page.rotate !== 0 ||
          Math.abs(width - size.width) > 0.5 || Math.abs(height - size.height) > 0.5) {
        throw new Error('Flattened PDF page ' + (p+1) + ' does not match the approved master size/orientation.');
      }
      const content = await page.getTextContent();
      const items = visibleTextItems(content, height);
      if (items.length < 2) throw new Error('Page ' + (p+1) + ' has insufficient selectable text.');
      const plain = items.map(i => i.text).join(' ').replace(/\s+/g,' ').toLowerCase();
      const anchor = FORM8_PAGE_ANCHORS[p].toLowerCase();
      if (!plain.includes(anchor)) {
        throw new Error('Page '+ (p+1) +' does not match the expected JCQ Form 8 layout (' + FORM8_PAGE_ANCHORS[p] + ').');
      }

      const boxes = [];
      for (const name of FORM8_FIELD_PAGES[p]) {
        const field = form.getField(name);
        const widget = field.acroField.getWidgets()[0];
        if (!widget) throw new Error('Master is missing widget for ' + name);
        const rect = rectTopLeft(widget, size.height);
        if (name.startsWith('Check Box')) {
          boxes.push({ name, rect });
        } else {
          const text = fieldText(items, rect);
          if (text) {
            try { form.getTextField(name).setText(text); }
            catch (e) { throw new Error('Could not copy ' + name + ': ' + e.message); }
            populated++;
          } else if (p === 0 && name === 'Text 50.Page 1') {
            missing.push('Candidate name on page 1');
          }
        }
      }
      if (boxes.length) {
        const { data, scale } = await renderPage(page);
        for (const {name,rect} of boxes) {
          const {dark,total} = checkboxInk(data,rect,scale);
          const proportion = total ? dark/total : 0;
          if (dark >= MIN_TICK_INK && proportion >= 0.025) {
            form.getCheckBox(name).check();
            ticks++;
          } else if (dark >= UNCERTAIN_TICK_INK) {
            warnings.push('Page '+(p+1)+': '+name+' tick needs manual verification.');
          }
        }
      }
      page.cleanup();
    }

    if (missing.length) {
      throw new Error('Could not reliably extract: '+missing.join(', ')+'.');
    }
    if (!populated) throw new Error('No text found in the expected answer fields.');
    warnings.push('Flattened PDF: compare every page, tick box and signature with the original before use.');
    // Names or signatures printed in ordinary content are NOT proof of a valid signature.
    warnings.push('Assessor and final declaration signatures must be checked; a fresh signature may be needed.');
    return { transferred: populated + ticks, warnings, method: 'flattened' };
  } finally {
    await loading.destroy();
  }
}
