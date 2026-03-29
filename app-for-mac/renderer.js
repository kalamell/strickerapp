'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  isConnected: false,
  printed: 0,
  skipped: 0,
  allJobs: {},        // key → job
  logEntries: [],
  MAX_LOG: 500
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const dbUrlInput     = $('dbUrl');
const keyFileInput   = $('keyFilePath');
const stationSelect  = $('stationId');
const printerSelect  = $('printerName');
const stickerW       = $('stickerW');
const stickerH       = $('stickerH');
const btnConnect     = $('btnConnect');
const btnDisconnect  = $('btnDisconnect');
const btnBrowse      = $('btnBrowse');
const btnClearKey    = $('btnClearKey');
const btnRefresh     = $('btnRefreshPrinters');
const btnClearLog    = $('btnClearLog');
const btnFetchAll    = $('btnFetchAll');
const btnSelectAll   = $('btnSelectAll');
const btnUnprinted   = $('btnSelectUnprinted');
const btnBatchPrint  = $('btnBatchPrint');
const btnBatchDelete = $('btnBatchDelete');
const searchInput    = $('searchInput');
const checkAll       = $('checkAll');
const logList        = $('logList');
const queueBody      = $('queueBody');

// Stats
const statStation  = $('statStation');
const statStatus   = $('statStatus');
const statPrinted  = $('statPrinted');
const statSkipped  = $('statSkipped');
const titleText    = $('titleText');

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  await loadPrinters();
  stationSelect.dispatchEvent(new Event('change'));

  // Restore saved settings (only override default URL if user has previously saved one)
  const saved = loadSettings();
  if (saved.dbUrl)       dbUrlInput.value   = saved.dbUrl;
  else if (!dbUrlInput.value) dbUrlInput.value = 'https://ace-mile-133504.firebaseio.com';
  if (saved.keyFile)     keyFileInput.value = saved.keyFile;
  if (saved.stationId)   stationSelect.value = saved.stationId;
  if (saved.printerName) printerSelect.value = saved.printerName;
  if (saved.stickerW)    stickerW.value = saved.stickerW;
  if (saved.stickerH)    stickerH.value = saved.stickerH;

  // Firebase events from main process
  window.api.onFirebaseStatus((data) => {
    setConnected(data.connected);
    if (!data.connected && data.error) {
      addLog('error', data.error);
    }
  });

  window.api.onJobEvent((data) => {
    const { key, job, status, error } = data;
    const name = `${job.name || job.Name || ''} ${job.surname || job.Surname || ''}`.trim();
    if (status === 'printing') {
      addLog('info', `MATCH — Printing: ${name}`);
    } else if (status === 'done') {
      state.printed++;
      statPrinted.textContent = state.printed;
      addLog('done', `DONE — Printed: ${name}`);
    } else if (status === 'error') {
      addLog('error', `ERROR — ${name}: ${error}`);
    }
  });

  updateStationLabel();
})();

// ─── Settings persistence ─────────────────────────────────────────────────────
function saveSettings() {
  localStorage.setItem('settings', JSON.stringify({
    dbUrl: dbUrlInput.value,
    keyFile: keyFileInput.value,
    stationId: stationSelect.value,
    printerName: printerSelect.value,
    stickerW: stickerW.value,
    stickerH: stickerH.value
  }));
}
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('settings') || '{}'); }
  catch { return {}; }
}

// ─── Printers ─────────────────────────────────────────────────────────────────
async function loadPrinters() {
  const printers = await window.api.getPrinters();
  const current = printerSelect.value;
  printerSelect.innerHTML = '';
  if (printers.length === 0) {
    printerSelect.innerHTML = '<option value="">No printers found</option>';
    return;
  }
  printers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.displayName || p.name;
    printerSelect.appendChild(opt);
  });
  if (current) printerSelect.value = current;
}

// ─── Connection ───────────────────────────────────────────────────────────────
btnConnect.addEventListener('click', async () => {
  const url = dbUrlInput.value.trim();
  if (!url) { alert('Please enter a Firebase Database URL.'); return; }

  saveSettings();
  addLog('info', 'Connecting to Firebase…');
  btnConnect.disabled = true;

  const config = buildConfig();
  const result = await window.api.connectFirebase(config);

  if (!result.success) {
    addLog('error', `Connection failed: ${result.error}`);
    btnConnect.disabled = false;
  }
  // Status update comes via onFirebaseStatus event
});

btnDisconnect.addEventListener('click', async () => {
  await window.api.disconnectFirebase();
  setConnected(false);
  addLog('info', 'Disconnected from Firebase.');
});

function setConnected(connected) {
  state.isConnected = connected;
  btnConnect.disabled = connected;
  btnDisconnect.disabled = !connected;

  if (connected) {
    statStatus.innerHTML = '<span class="dot dot-online"></span> Online';
  } else {
    statStatus.innerHTML = '<span class="dot dot-offline"></span> Offline';
  }
}

// ─── Key file ─────────────────────────────────────────────────────────────────
btnBrowse.addEventListener('click', async () => {
  const file = await window.api.selectKeyFile();
  if (file) keyFileInput.value = file;
});
btnClearKey.addEventListener('click', () => {
  keyFileInput.value = '';
  saveSettings();
});

// ─── Station label ────────────────────────────────────────────────────────────
stationSelect.addEventListener('change', updateStationLabel);
function updateStationLabel() {
  const id = stationSelect.value;
  statStation.textContent = `#${id}`;
  titleText.textContent = `Sticker Print Station — Printer #${id}`;
  document.title = `Sticker Print Station — Printer #${id}`;
}

// ─── Printer refresh ──────────────────────────────────────────────────────────
btnRefresh.addEventListener('click', loadPrinters);

// ─── Log ──────────────────────────────────────────────────────────────────────
function addLog(level, message) {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  const badges = { done: 'DONE', skip: 'SKIP', error: 'ERR', info: 'INFO' };
  const entry = document.createElement('div');
  entry.className = `log-entry log-${level}`;
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-badge">[${badges[level] || 'LOG'}]</span>
    <span class="log-msg">${escapeHtml(message)}</span>`;

  const empty = logList.querySelector('.log-empty');
  if (empty) empty.remove();

  logList.appendChild(entry);

  state.logEntries.push(entry);
  if (state.logEntries.length > state.MAX_LOG) {
    state.logEntries.shift().remove();
  }

  logList.scrollTop = logList.scrollHeight;
}

btnClearLog.addEventListener('click', () => {
  logList.innerHTML = '<div class="log-empty">No activity yet.</div>';
  state.logEntries = [];
});

// ─── Queue browser ────────────────────────────────────────────────────────────
btnFetchAll.addEventListener('click', async () => {
  const url = dbUrlInput.value.trim();
  if (!url) { alert('Please enter a Firebase Database URL first.'); return; }

  addLog('info', 'Fetching all jobs…');
  btnFetchAll.disabled = true;

  const result = await window.api.fetchAllJobs({
    databaseUrl: url,
    keyFile: keyFileInput.value || null
  });

  btnFetchAll.disabled = false;

  if (!result.success) {
    addLog('error', `Fetch failed: ${result.error}`);
    return;
  }

  state.allJobs = result.data || {};
  const count = Object.keys(state.allJobs).length;
  addLog('info', `Fetched ${count} job(s).`);
  renderQueue();
});

function renderQueue(filter = '') {
  const lf = filter.toLowerCase();
  const rows = Object.entries(state.allJobs)
    .filter(([, j]) => {
      if (!lf) return true;
      const text = [j.name, j.Name, j.surname, j.Surname, j.qrData, j.QrData].join(' ').toLowerCase();
      return text.includes(lf);
    });

  if (rows.length === 0) {
    queueBody.innerHTML = `<tr><td colspan="7" class="table-empty">${filter ? 'No matching jobs.' : 'No jobs found.'}</td></tr>`;
    return;
  }

  queueBody.innerHTML = rows.map(([key, j]) => {
    const name = `${j.name || j.Name || ''} ${j.surname || j.Surname || ''}`.trim();
    const pos = j.position || j.Position || '—';
    const qr = j.qrData || j.QrData || '—';
    const events = (j.events || j.Events || []).join(', ') || '—';
    const pid = j.printerId || j.PrinterId || '—';
    const printed = j.printed || j.Printed;
    const badge = printed
      ? `<span class="badge badge-printed">Printed</span>`
      : `<span class="badge badge-pending">Pending</span>`;

    return `<tr data-key="${escapeAttr(key)}">
      <td class="col-check"><input type="checkbox" class="row-check" /></td>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(pos)}</td>
      <td>${escapeHtml(qr)}</td>
      <td>${escapeHtml(events)}</td>
      <td>${escapeHtml(String(pid))}</td>
      <td>${badge}</td>
    </tr>`;
  }).join('');
}

searchInput.addEventListener('input', () => renderQueue(searchInput.value));

checkAll.addEventListener('change', () => {
  document.querySelectorAll('.row-check').forEach(cb => cb.checked = checkAll.checked);
});

btnSelectAll.addEventListener('click', () => {
  document.querySelectorAll('.row-check').forEach(cb => cb.checked = true);
});

btnUnprinted.addEventListener('click', () => {
  document.querySelectorAll('#queueBody tr[data-key]').forEach(row => {
    const key = row.dataset.key;
    const job = state.allJobs[key];
    const isPrinted = job?.printed || job?.Printed;
    row.querySelector('.row-check').checked = !isPrinted;
  });
});

// ─── Batch print ─────────────────────────────────────────────────────────────
btnBatchPrint.addEventListener('click', async () => {
  const selected = getSelectedRows();
  if (selected.length === 0) { alert('No jobs selected.'); return; }

  const config = buildConfig();
  btnBatchPrint.disabled = true;
  addLog('info', `Batch printing ${selected.length} job(s)…`);

  let ok = 0, fail = 0;
  for (const { key, job } of selected) {
    try {
      const res = await window.api.printSticker({ job, config });
      if (res.success) {
        await window.api.markPrinted({ databaseUrl: config.databaseUrl, keyFile: config.keyFile, key });
        job.printed = true;
        state.allJobs[key] = job;
        ok++;
        addLog('done', `Printed: ${(job.name || job.Name || '')} ${(job.surname || job.Surname || '')}`);
      } else {
        fail++;
        addLog('error', `Print failed: ${res.error}`);
      }
    } catch (e) {
      fail++;
      addLog('error', e.message);
    }
  }

  btnBatchPrint.disabled = false;
  addLog('info', `Batch done — ${ok} printed, ${fail} failed.`);
  renderQueue(searchInput.value);
  saveSettings();
});

// ─── Batch delete ─────────────────────────────────────────────────────────────
btnBatchDelete.addEventListener('click', async () => {
  const selected = getSelectedRows();
  if (selected.length === 0) { alert('No jobs selected.'); return; }
  if (!confirm(`Delete ${selected.length} job(s) from Firebase? This cannot be undone.`)) return;

  const config = buildConfig();
  btnBatchDelete.disabled = true;
  addLog('info', `Deleting ${selected.length} job(s)…`);

  let ok = 0, fail = 0;
  for (const { key } of selected) {
    try {
      await window.api.deleteJob({ databaseUrl: config.databaseUrl, keyFile: config.keyFile, key });
      delete state.allJobs[key];
      ok++;
    } catch (e) {
      fail++;
      addLog('error', e.message);
    }
  }

  btnBatchDelete.disabled = false;
  addLog('info', `Deleted ${ok} job(s), ${fail} failed.`);
  renderQueue(searchInput.value);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getSelectedRows() {
  const result = [];
  document.querySelectorAll('#queueBody tr[data-key]').forEach(row => {
    if (row.querySelector('.row-check')?.checked) {
      const key = row.dataset.key;
      result.push({ key, job: state.allJobs[key] });
    }
  });
  return result;
}

function buildConfig() {
  return {
    databaseUrl: dbUrlInput.value.trim(),
    keyFile: keyFileInput.value || null,
    stationId: parseInt(stationSelect.value, 10),
    printerName: printerSelect.value,
    stickerWidth: parseInt(stickerW.value, 10) || 100,
    stickerHeight: parseInt(stickerH.value, 10) || 60
  };
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(str) { return escapeHtml(str); }

// Save settings on any input change
[dbUrlInput, stationSelect, printerSelect, stickerW, stickerH].forEach(el => {
  el?.addEventListener('change', saveSettings);
});
