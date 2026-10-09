import JSZip from 'jszip';
import { verifyMaster, convertForm } from './converter.js';
import './styles.css';

const $ = id => document.getElementById(id);
const el = {
  master: $('masterFile'), masterStatus: $('masterStatus'),
  sources: $('sourceFiles'), drop: $('dropZone'),
  run: $('convertAll'), zip: $('downloadAll'),
  clear: $('clearFiles'), list: $('fileList'), counts: $('counts')
};
let masterData = null;
let items = [];
let busy = false;
let nextId = 1;

const statuses = {
  pending: 'Ready to convert', working: 'Converting…',
  complete: 'Converted · review required', error: 'Conversion failed', invalid: 'Duplicate filename'
};
const setMasterStatus = (message, type = '') => {
  el.masterStatus.textContent = message;
  el.masterStatus.dataset.kind = type;
};
const readBytes = async file => new Uint8Array(await file.arrayBuffer());

el.master.addEventListener('change', async () => {
  masterData = null;
  const file = el.master.files?.[0];
  if (!file) { setMasterStatus('No master selected'); render(); return; }
  setMasterStatus('Checking original PDF fingerprint…');
  try {
    const bytes = await readBytes(file);
    await verifyMaster(bytes);
    masterData = bytes;
    setMasterStatus('Verified: exact approved Form 8 master', 'success');
  } catch (error) {
    setMasterStatus(error.message || 'Master verification failed', 'error');
  }
  render();
});

function addFiles(files) {
  for (const file of files) {
    if (!/\.pdf$/i.test(file.name)) continue;
    if (items.some(item => item.name.toLowerCase() === file.name.toLowerCase())) {
      items.push({ id: nextId++, name: file.name, file, status: 'invalid',
        error: 'Duplicate filename. Remove an earlier entry or rename this file; identical names must not overwrite each other.' });
    } else {
      items.push({ id: nextId++, name: file.name, file, status: 'pending', warnings: [] });
    }
  }
  el.sources.value = '';
  render();
}
el.sources.addEventListener('change', () => addFiles(Array.from(el.sources.files || [])));
el.drop.addEventListener('dragover', event => { event.preventDefault(); el.drop.classList.add('drag-over'); });
el.drop.addEventListener('dragleave', () => el.drop.classList.remove('drag-over'));
el.drop.addEventListener('drop', event => {
  event.preventDefault(); el.drop.classList.remove('drag-over');
  addFiles(Array.from(event.dataTransfer.files || []));
});
el.drop.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target === el.drop) {
    event.preventDefault(); el.sources.click();
  }
});
el.drop.addEventListener('click', event => {
  if (!event.target.closest('label,input')) el.sources.click();
});

function triggerDownload(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a);
  a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 90000);
}
function downloadOne(item) {
  if (item.output) triggerDownload(item.output, item.name, 'application/pdf');
}
function preview(item) {
  if (!item.output) return;
  const url = URL.createObjectURL(new Blob([item.output], { type: 'application/pdf' }));
  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) downloadOne(item);
  setTimeout(() => URL.revokeObjectURL(url), 300000);
}

async function processItem(item) {
  item.status = 'working'; item.error = null; item.output = null; item.warnings = [];
  render();
  try {
    const result = await convertForm(await readBytes(item.file), masterData);
    item.output = result.bytes;
    item.transferred = result.transferred;
    item.warnings = result.warnings;
    item.status = 'complete';
  } catch (error) {
    item.error = error?.message || 'Unexpected PDF conversion error.';
    item.status = 'error';
  }
  render();
  await new Promise(resolve => setTimeout(resolve, 0));
}
async function convertOne(item) {
  if (!masterData || busy) return;
  busy = true;
  await processItem(item);
  busy = false; render();
}
el.run.addEventListener('click', async () => {
  if (!masterData || busy) return;
  busy = true;
  for (const item of items.filter(x => x.status === 'pending' || x.status === 'error')) {
    await processItem(item);
  }
  busy = false; render();
});

el.zip.addEventListener('click', async () => {
  if (busy) return;
  const completed = items.filter(x => x.status === 'complete' && x.output);
  if (!completed.length) return;
  busy = true; render();
  try {
    const archive = new JSZip();
    const report = [
      'JCQ Form 8 local conversion report',
      'Files were processed in this browser, without a document upload.',
      'All generated forms require manual review in Adobe Acrobat.',
      ''
    ];
    for (const item of items) {
      if (item.status === 'complete' && item.output) archive.file(item.name, item.output);
      report.push(item.name + ' | ' + item.status + (item.status === 'complete' ? ' | ' + item.transferred + ' filled values' : ''));
      for (const warning of item.warnings || []) report.push('  REVIEW: ' + warning);
      if (item.error) report.push('  ERROR: ' + item.error);
    }
    archive.file('conversion-report.txt', report.join('\n'));
    const zip = await archive.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    triggerDownload(zip, 'Form8-converted.zip', 'application/zip');
  } catch (error) {
    alert('ZIP could not be generated: ' + (error?.message || 'Unknown error'));
  }
  busy = false; render();
});
el.clear.addEventListener('click', () => {
  if (busy) return;
  items = [];
  el.sources.value = '';
  render();
});

function button(label, handler, style = '', disabled = false) {
  const el = document.createElement('button');
  el.type = 'button'; el.textContent = label;
  el.className = (style || 'secondary') + ' small-button';
  el.disabled = disabled; el.addEventListener('click', handler);
  return el;
}

function render() {
  const complete = items.filter(x => x.status === 'complete').length;
  const pending = items.filter(x => x.status === 'pending').length;
  const failed = items.filter(x => x.status === 'error' || x.status === 'invalid').length;
  el.run.disabled = busy || !masterData || !(pending + failed);
  el.zip.disabled = busy || !complete;
  el.clear.disabled = busy || !items.length;
  el.counts.textContent = items.length ?
    items.length + ' selected · ' + complete + ' converted · ' + failed + ' errors' : 'No PDFs selected';
  el.list.replaceChildren();

  for (const item of items) {
    const card = document.createElement('article'); card.className = 'file-item';
    const top = document.createElement('div'); top.className = 'file-top';
    const ident = document.createElement('div'); ident.className = 'file-ident';
    const name = document.createElement('strong'); name.textContent = item.name;
    const state = document.createElement('span');
    state.className = 'file-status ' + item.status;
    state.textContent = statuses[item.status];
    ident.append(name, state); top.append(ident);

    const controls = document.createElement('div'); controls.className = 'file-buttons';
    if (item.status === 'pending' || item.status === 'error')
      controls.append(button('Convert', () => convertOne(item), 'secondary', busy || !masterData));
    if (item.status === 'complete') {
      controls.append(button('Preview', () => preview(item), 'secondary', busy));
      controls.append(button('Download PDF', () => downloadOne(item), 'secondary', busy));
    }
    controls.append(button('Remove', () => {
      if (!busy) { items = items.filter(x => x.id !== item.id); render(); }
    }, 'quiet', busy));
    top.append(controls); card.append(top);

    if (item.error) {
      const problem = document.createElement('p'); problem.className = 'file-error';
      problem.textContent = item.error; card.append(problem);
    }
    if (item.status === 'complete') {
      const summary = document.createElement('p'); summary.className = 'hint';
      summary.textContent = item.transferred + ' populated field values copied; original master page layout retained.';
      card.append(summary);
    }
    if (item.warnings?.length) {
      const details = document.createElement('details');
      const heading = document.createElement('summary');
      heading.textContent = item.warnings.length + ' notes to review';
      const list = document.createElement('ul');
      for (const warning of item.warnings) {
        const li = document.createElement('li'); li.textContent = warning; list.append(li);
      }
      details.append(heading, list); card.append(details);
    }
    el.list.append(card);
  }
}
render();
