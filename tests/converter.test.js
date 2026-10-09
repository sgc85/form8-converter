import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { compareStructure, copyFields, sha256 } from '../src/converter.js';

async function fakeForm({ evidence = '', marked = false, oldDeclaration = false } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  const text = form.createTextField('Text Field 2');
  text.addToPage(page, { x: 40, y: 600, width: 250, height: 85 });
  text.setText(evidence);
  const declaration = form.createTextField('Text Field 109');
  declaration.addToPage(page, { x: 40, y: 500, width: 250, height: 25 });
  if (oldDeclaration) declaration.setText('EXAMPLE DECLARATION');
  const names = ['Check Box 44', 'Check Box 45', 'Check Box 46', 'Check Box 47', 'Check Box 48', 'Check Box 103', 'Check Box 52'];
  names.forEach((name, idx) => {
    const field = form.createCheckBox(name);
    field.addToPage(page, { x: 480, y: 550 - 28 * idx, width: 17, height: 17 });
    if (marked && name === 'Check Box 52') field.check();
    if (oldDeclaration && name === 'Check Box 44') field.check();
  });
  return doc;
}

test('clears master examples, moves entered text and checkboxes', async () => {
  const original = await fakeForm({ evidence: 'Specific teacher feedback', marked: true });
  const master = await fakeForm({ evidence: 'MASTER EXAMPLE', oldDeclaration: true });
  assert.deepEqual(compareStructure(original, master), []);
  const result = copyFields(original, master);
  assert.equal(result.transferred, 2);
  assert.equal(master.getForm().getTextField('Text Field 2').getText(), 'Specific teacher feedback');
  assert.equal(master.getForm().getTextField('Text Field 109').getText(), '');
  assert.equal(master.getForm().getCheckBox('Check Box 52').isChecked(), true);
  assert.equal(master.getForm().getCheckBox('Check Box 44').isChecked(), false);
  const reopened = await PDFDocument.load(await master.save());
  assert.equal(reopened.getForm().getTextField('Text Field 2').getText(), 'Specific teacher feedback');
});

test('moves blank source values over prefilled master values', async () => {
  const original = await fakeForm();
  const master = await fakeForm({ evidence: 'DO NOT COPY', oldDeclaration: true });
  copyFields(original, master);
  assert.equal(master.getForm().getTextField('Text Field 2').getText(), '');
  assert.equal(master.getForm().getTextField('Text Field 109').getText(), '');
  assert.equal(master.getForm().getCheckBox('Check Box 44').isChecked(), false);
});

test('rejects a moved field rather than guessing its destination', async () => {
  const original = await fakeForm();
  const master = await fakeForm();
  master.getForm().getTextField('Text Field 2').acroField.getWidgets()[0]
    .setRectangle({ x: 41, y: 600, width: 250, height: 85 });
  assert.match(compareStructure(original, master).join(' '), /Field position differs/);
});

test('computes accurate SHA-256 for master-fingerprint verification', async () => {
  const digest = await sha256(new TextEncoder().encode('abc'));
  assert.equal(digest, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
