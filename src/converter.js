import { PDFDocument, PDFTextField, PDFCheckBox, PDFSignature, PDFRadioGroup, PDFDropdown, PDFOptionList } from 'pdf-lib';

export const MASTER_SHA256 = '4681e7f98db75a78603b47758b2e1dc25016e3fae8f12d0f5ab2e8c3faf78df7';
export const MASTER_PAGE_COUNT = 12;
export const MASTER_FIELD_COUNT = 102;
export const MASTER_WIDGET_COUNT = 124;

const CHARACTER_LIMITS = new Map([
  ['Text Field 2', 1500], ['Text Field 3', 1500],
  ['Text Field 4', 1500], ['Text Field 5', 1500],
  ['Text Field 6', 650], ['Text Field 7', 3000],
  ['Text Field 1012', 3000], ['Text Field 1015', 3000]
]);

function kind(field) {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'options';
  if (field instanceof PDFSignature) return 'signature';
  return 'unsupported';
}

function value(field) {
  const type = kind(field);
  if (type === 'text') return (field.getText() ?? '').replace(/\r\n?/g, '\n');
  if (type === 'checkbox') return field.isChecked();
  if (type === 'radio' || type === 'dropdown') return field.getSelected() ?? '';
  if (type === 'options') return field.getSelected() ?? [];
  return null;
}

function rectangles(field) {
  return field.acroField.getWidgets().map(widget => {
    const rect = widget.getRectangle();
    return [rect.x, rect.y, rect.width, rect.height].map(n => Math.round(n * 10) / 10).join(',');
  }).sort().join('|');
}

export function compareStructure(source, master, required = {}) {
  const errors = [];
  if (source.getPageCount() !== master.getPageCount()) errors.push('Page counts differ.');
  if (required.pages && (source.getPageCount() !== required.pages || master.getPageCount() !== required.pages)) {
    errors.push('Not the expected 12-page Form 8.');
  }
  for (let i = 0; i < Math.min(source.getPageCount(), master.getPageCount()); i++) {
    const a = source.getPage(i).getSize(), b = master.getPage(i).getSize();
    if (Math.abs(a.width - b.width) > 0.2 || Math.abs(a.height - b.height) > 0.2) {
      errors.push('Page size differs on page ' + (i + 1) + '.');
    }
  }
  const a = source.getForm().getFields(), b = master.getForm().getFields();
  const sourceFields = new Map(a.map(f => [f.getName(), f]));
  const masterFields = new Map(b.map(f => [f.getName(), f]));
  if (sourceFields.size !== a.length || masterFields.size !== b.length) errors.push('Duplicate field names.');
  if (sourceFields.size !== masterFields.size) errors.push('Number of fields differs.');
  if (required.fields && (sourceFields.size !== required.fields || masterFields.size !== required.fields)) {
    errors.push('Unexpected total field count.');
  }
  const widgetTotal = fields => fields.reduce((sum, field) => sum + field.acroField.getWidgets().length, 0);
  if (widgetTotal(a) !== widgetTotal(b)) errors.push('Widget count differs.');
  if (required.widgets && (widgetTotal(a) !== required.widgets || widgetTotal(b) !== required.widgets)) {
    errors.push('Unexpected total widget count.');
  }
  for (const [name, field] of sourceFields) {
    const target = masterFields.get(name);
    if (!target) { errors.push('Missing field in master: ' + name); continue; }
    if (kind(field) !== kind(target)) errors.push('Field type differs: ' + name);
    if (rectangles(field) !== rectangles(target)) errors.push('Field position differs: ' + name);
  }
  for (const name of masterFields.keys()) if (!sourceFields.has(name)) errors.push('Missing field in original: ' + name);
  return errors;
}

export function copyFields(source, master) {
  const errors = compareStructure(source, master);
  if (errors.length) throw new Error('Incompatible template: ' + errors.join(' '));
  const warnings = [];
  const form = master.getForm();

  // Remove ALL prefilled master examples, including names, checkboxes and declarations.
  for (const field of form.getFields()) {
    const type = kind(field);
    if (type === 'text') field.setText('');
    else if (type === 'checkbox') field.uncheck();
    else if (type === 'radio' || type === 'dropdown' || type === 'options') field.clear();
    else if (type !== 'signature') throw new Error('Unsupported field type: ' + field.getName());
  }

  let transferred = 0;
  for (const input of source.getForm().getFields()) {
    const name = input.getName(), output = form.getField(name), type = kind(input);
    if (type === 'text') {
      const text = value(input);
      output.setText(text);
      if (text) transferred++;
      const limit = CHARACTER_LIMITS.get(name);
      if (limit && text.length > limit) {
        warnings.push(name + ' exceeds its ' + limit + '-character form limit.');
      }
      if (text.length > 5000) warnings.push(name + ': unusually long text; inspect for clipping.');
    } else if (type === 'checkbox') {
      if (input.isChecked()) { output.check(); transferred++; }
    } else if (type === 'radio' || type === 'dropdown') {
      const selected = input.getSelected();
      if (selected) { output.select(selected); transferred++; }
    } else if (type === 'options') {
      const selected = input.getSelected();
      if (selected.length) { output.select(selected); transferred++; }
    } else if (type === 'signature') {
      // Changing PDF bytes invalidates digital signatures. Never copy signed objects.
      if (input.acroField.getValue()) warnings.push('Digital signature cannot be transferred: ' + name + '. Re-sign as required.');
    } else {
      throw new Error('Unsupported source field: ' + name);
    }
  }

  const arrangementBoxes = ['Check Box 44','Check Box 45','Check Box 46','Check Box 47','Check Box 48','Check Box 103'];
  if (!arrangementBoxes.some(name => form.getCheckBox(name).isChecked())) {
    warnings.push('Part 3: no access arrangements selected.');
  }
  if (!form.getTextField('Text Field 109').getText()?.trim()) {
    warnings.push('Part 3: declaration name is blank.');
  }
  warnings.push('Check all 12 pages in Adobe Acrobat, especially long paragraphs, signatures and the final declaration.');
  return { transferred, warnings };
}

export async function sha256(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

export async function verifyMaster(bytes) {
  if (await sha256(bytes) !== MASTER_SHA256) {
    throw new Error('Not the EXACT project master. Please choose the original Form 8 Master.pdf (not a resaved copy).');
  }
  const doc = await PDFDocument.load(bytes);
  if (doc.getPageCount() !== MASTER_PAGE_COUNT || doc.getForm().getFields().length !== MASTER_FIELD_COUNT) {
    throw new Error('The chosen master has the wrong structure.');
  }
  return true;
}

export async function convertForm(originalBytes, masterBytes) {
  await verifyMaster(masterBytes);
  const source = await PDFDocument.load(originalBytes);
  const master = await PDFDocument.load(masterBytes, { updateMetadata: false });
  const errors = compareStructure(source, master, {
    pages: MASTER_PAGE_COUNT, fields: MASTER_FIELD_COUNT, widgets: MASTER_WIDGET_COUNT
  });
  if (errors.length) throw new Error('Conversion blocked: ' + errors.join(' '));

  const result = copyFields(source, master);
  // Retain every static page from the authentic template and all its editable fields.
  master.getForm().updateFieldAppearances();
  const bytes = await master.save({ useObjectStreams: false, updateFieldAppearances: false });
  const saved = await PDFDocument.load(bytes);
  for (const field of source.getForm().getFields()) {
    if (kind(field) === 'signature') continue;
    if (JSON.stringify(value(field)) !== JSON.stringify(value(saved.getForm().getField(field.getName())))) {
      throw new Error('Output verification failed: ' + field.getName());
    }
  }
  if (saved.getPageCount() !== MASTER_PAGE_COUNT) throw new Error('Output page count changed.');
  return { bytes, ...result };
}
