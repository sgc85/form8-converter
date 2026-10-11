import JSZip from 'jszip';
import { verifyMaster, convertForm } from './converter.js';
import './styles.css';

const $ = id => document.getElementById(id);
const ui = {
  masterInput: $('masterFile'),
  masterDrop: $('masterDrop'),
  masterStatus: $('masterStatus'),
  filesInput: $('sourceFiles'),
  filesDrop: $('sourceDrop'),
  filesCount: $('sourceCount'),
  filesList: $('fileList'),
  clear: $('clearFiles'),
  convert: $('convertAll'),
  download: $('downloadAll'),
  message: $('message'),
  appStatus: $('appStatus')
};

let masterBytes = null;
let entries = [];
let running = false;
let masterRequest = 0;
let nextId = 1;

function notify(message, state = '') {
  ui.message.textContent = message;
  ui.message.className = 'message ' + state;
}

function masterMessage(message, state = '') {
  ui.masterStatus.textContent = message;
  ui.masterStatus.className = 'selection ' + state;
}

const readBytes = async file => new Uint8Array(await file.arrayBuffer());
const pdfFile = file => Boolean(file && /\.pdf$/i.test(file.name));

function attachDropZone(zone, handler) {
  zone.addEventListener('dragover', event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', event => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove('over');
  });
  zone.addEventListener('drop', event => {
    event.preventDefault();
    zone.classList.remove('over');
    handler(Array.from(event.dataTransfer?.files || []));
  });
}

async function selectMaster(file) {
  if (running) return;
  const request = ++masterRequest;
  masterBytes = null;
  if (!file) {
    masterMessage('No master selected');
    render();
    return;
  }
  if (!pdfFile(file)) {
    masterMessage('Please choose a PDF file.', 'error');
    notify('The master must be a PDF.', 'error');
    render();
    return;
  }

  // Display the chosen filename immediately, before any async parsing.
  masterMessage(file.name + ' · Checking…');
  notify('Checking the master form…');
  render();

  try {
    const bytes = await readBytes(file);
    await verifyMaster(bytes);
    if (request !== masterRequest) return;
    masterBytes = bytes;
    masterMessage(file.name + ' · Ready', 'success');
    notify('Master ready. Add the forms you want to convert.', 'success');
  } catch (error) {
    if (request !== masterRequest) return;
    masterMessage(file.name + ' · ' + (error?.message || 'Unable to open master'), 'error');
    notify('Could not use the master PDF. See the message above.', 'error');
  }
  render();
}

ui.masterInput.addEventListener('change', () => {
  void selectMaster(ui.masterInput.files?.[0]);
});
attachDropZone(ui.masterDrop, files => {
  if (files.length !== 1) {
    notify('Drop one master PDF at a time.', 'error');
    return;
  }
  void selectMaster(files[0]);
});

function addFiles(files) {
  if (running) return;
  let added = 0, duplicates = 0, invalid = 0;

  for (const file of files) {
    if (!pdfFile(file)) {
      invalid++;
      continue;
    }
    if (entries.some(entry => entry.name.toLowerCase() === file.name.toLowerCase())) {
      duplicates++;
      continue;
    }
    entries.push({
      id: nextId++,
      name: file.name,
      file,
      status: 'pending',
      warnings: [],
      output: null
    });
    added++;
  }

  render();
  if (added) notify(added + (added === 1 ? ' form added.' : ' forms added.') + ' Ready to convert.', 'success');
  if (duplicates || invalid) {
    notify((duplicates ? duplicates + ' duplicate filename(s) skipped. ' : '') +
      (invalid ? invalid + ' non-PDF file(s) skipped.' : ''), 'error');
  }
}

ui.filesInput.addEventListener('change', () => addFiles(Array.from(ui.filesInput.files || [])));
attachDropZone(ui.filesDrop, addFiles);
ui.clear.addEventListener('click', () => {
  if (running) return;
  entries = [];
  ui.filesInput.value = '';
  render();
  notify('Choose one or more forms to convert.');
});

function saveFile(bytes, filename, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function action(label, callback, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.disabled = running;
  button.addEventListener('click', callback);
  return button;
}

async function convertOne(entry) {
  entry.status = 'working';
  entry.output = null;
  entry.error = null;
  entry.warnings = [];
  render();

  try {
    const result = await convertForm(await readBytes(entry.file), masterBytes);
    entry.output = result.bytes;
    entry.warnings = result.warnings;
    entry.status = 'complete';
  } catch (error) {
    entry.status = 'error';
    entry.error = error?.message || 'Unable to convert this PDF.';
  }
  render();
}

ui.convert.addEventListener('click', async () => {
  if (running) return;
  if (!masterBytes) {
    notify('First, select the master Form 8 PDF.', 'error');
    ui.masterInput.focus();
    return;
  }
  if (!entries.length) {
    notify('Add at least one completed PDF.', 'error');
    ui.filesInput.focus();
    return;
  }

  const pending = entries.filter(entry => entry.status === 'pending' || entry.status === 'error');
  if (!pending.length) {
    notify('All selected files are already converted. Download them below.', 'success');
    return;
  }

  running = true;
  notify('Converting ' + pending.length + (pending.length === 1 ? ' PDF…' : ' PDFs…'));
  render();

  try {
    for (const entry of pending) {
      await convertOne(entry);
      // Yield to the UI between documents during large batches.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally {
    running = false;
  }

  const good = pending.filter(entry => entry.status === 'complete').length;
  const bad = pending.length - good;
  notify(good + ' converted' + (bad ? ' · ' + bad + ' need attention.' : '. Download below.'), bad ? 'error' : 'success');
  render();
});

ui.download.addEventListener('click', async () => {
  if (running) return;
  const done = entries.filter(entry => entry.status === 'complete' && entry.output);
  if (!done.length) return;

  if (done.length === 1) {
    saveFile(done[0].output, done[0].name, 'application/pdf');
    return;
  }

  running = true;
  render();
  try {
    const zip = new JSZip();
    for (const entry of done) zip.file(entry.name, entry.output);

    // No personal names or PDF contents are sent to an external service.
    const result = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    saveFile(result, 'Form8-converted.zip', 'application/zip');
    notify('ZIP downloaded. Review the PDFs before use.', 'success');
  } catch (error) {
    notify('Could not create ZIP: ' + (error?.message || 'Unknown error'), 'error');
  } finally {
    running = false;
    render();
  }
});

function render() {
  const complete = entries.filter(entry => entry.status === 'complete').length;
  const failures = entries.filter(entry => entry.status === 'error').length;
  ui.convert.disabled = running;
  ui.clear.disabled = running || !entries.length;
  ui.download.hidden = complete === 0;
  ui.download.disabled = running;
  ui.download.textContent = complete === 1 ? 'Download PDF' : 'Download ' + complete + ' PDFs (ZIP)';
  ui.filesCount.textContent = !entries.length ? 'No forms selected' :
    entries.length + (entries.length === 1 ? ' form' : ' forms') + ' selected' +
    (complete ? ' · ' + complete + ' ready' : '') +
    (failures ? ' · ' + failures + ' failed' : '');
  ui.filesList.replaceChildren();

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const left = document.createElement('div');
    left.className = 'file-description';
    const filename = document.createElement('div');
    filename.className = 'file-name';
    filename.textContent = entry.name;
    const state = document.createElement('div');
    state.className = 'file-state ' + entry.status;
    state.textContent = ({
      pending: 'Ready',
      working: 'Converting…',
      complete: 'Converted',
      error: 'Needs attention'
    })[entry.status];
    left.append(filename, state);
    if (entry.error) {
      const errorLine = document.createElement('p');
      errorLine.className = 'file-error';
      errorLine.textContent = entry.error;
      left.append(errorLine);
    }
    if (entry.status === 'complete' && entry.warnings?.length) {
      const detail = document.createElement('details');
      detail.className = 'warning-toggle';
      const summary = document.createElement('summary');
      summary.textContent = 'Review notes (' + entry.warnings.length + ')';
      const list = document.createElement('ul');
      for (const warning of entry.warnings) {
        const item = document.createElement('li');
        item.textContent = warning;
        list.append(item);
      }
      detail.append(summary, list);
      left.append(detail);
    }
    row.append(left);

    const controls = document.createElement('div');
    controls.className = 'file-actions';
    if (entry.status === 'complete') {
      controls.append(action('Download', () =>
        saveFile(entry.output, entry.name, 'application/pdf')));
    }
    controls.append(action('×', () => {
      entries = entries.filter(item => item.id !== entry.id);
      render();
    }, 'remove'));
    row.append(controls);
    ui.filesList.append(row);
  }
}

try {
  if (!globalThis.crypto?.subtle || !globalThis.File || !globalThis.Blob) {
    throw new Error('Your browser does not support this converter. Use an up-to-date Edge or Chrome.');
  }
  ui.appStatus.textContent = 'Ready';
  render();
} catch (error) {
  ui.appStatus.className = 'app-status error';
  ui.appStatus.textContent = error?.message || 'The converter failed to load.';
  notify('The converter could not start.', 'error');
}
