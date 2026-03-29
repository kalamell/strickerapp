'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const EventSource = require('eventsource');
const QRCode = require('qrcode');

let mainWindow = null;
let eventSource = null;
let currentConfig = null;
let cachedToken = null;
let tokenExpiry = 0;

// ─── App lifecycle ────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#F2F2F7',
    title: 'Sticker Print Station'
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopFirebase();
  if (process.platform !== 'darwin') app.quit();
});

// ─── Service account OAuth2 (no external deps) ───────────────────────────────

async function getAccessToken(keyFile) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiry > now + 60) return cachedToken;

  const key = JSON.parse(fs.readFileSync(keyFile, 'utf-8'));
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.private_key_id })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: key.client_email,
    sub: key.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'
  })).toString('base64url');

  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(key.private_key, 'base64url');
  const jwt = `${unsigned}.${signature}`;

  return new Promise((resolve, reject) => {
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.access_token) {
            cachedToken = result.access_token;
            tokenExpiry = now + (result.expires_in || 3600);
            resolve(cachedToken);
          } else {
            reject(new Error(result.error_description || 'Token exchange failed'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Firebase REST helpers ────────────────────────────────────────────────────

function dbUrl(base, dbPath, token) {
  const url = `${base.replace(/\/$/, '')}${dbPath}.json`;
  return token ? `${url}?access_token=${encodeURIComponent(token)}` : url;
}

function httpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function fbGet(path) {
  const token = currentConfig?.keyFile ? await getAccessToken(currentConfig.keyFile) : null;
  const res = await httpRequest(dbUrl(currentConfig.databaseUrl, path, token));
  return JSON.parse(res.body);
}

async function fbPatch(path, body) {
  const token = currentConfig?.keyFile ? await getAccessToken(currentConfig.keyFile) : null;
  const bodyStr = JSON.stringify(body);
  await httpRequest(dbUrl(currentConfig.databaseUrl, path, token), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    body: bodyStr
  });
}

async function fbDelete(path) {
  const token = currentConfig?.keyFile ? await getAccessToken(currentConfig.keyFile) : null;
  await httpRequest(dbUrl(currentConfig.databaseUrl, path, token), { method: 'DELETE' });
}

// ─── Firebase SSE listener ────────────────────────────────────────────────────

async function startFirebase(config) {
  stopFirebase();
  currentConfig = config;
  cachedToken = null;
  tokenExpiry = 0;

  try {
    const token = config.keyFile ? await getAccessToken(config.keyFile) : null;
    const sseUrl = dbUrl(config.databaseUrl, '/print_queue', token);

    eventSource = new EventSource(sseUrl);

    eventSource.addEventListener('put', async (e) => {
      try {
        const { path: ePath, data } = JSON.parse(e.data);
        if (data === null) return;

        if (ePath === '/') {
          // Initial snapshot — process unprinted jobs matching this station
          for (const [key, job] of Object.entries(data)) {
            if (!job.printed && job.printerId === config.stationId) {
              await handlePrintJob(key, job);
            }
          }
        } else {
          // New or updated single job
          const key = ePath.replace(/^\//, '');
          if (!data.printed && data.printerId === config.stationId) {
            await handlePrintJob(key, data);
          }
        }
      } catch (err) {
        log('error', `Event processing error: ${err.message}`);
      }
    });

    eventSource.addEventListener('keep-alive', () => { /* heartbeat */ });

    eventSource.addEventListener('cancel', () => {
      mainWindow?.webContents.send('firebase-status', { connected: false, error: 'Permission denied by Firebase rules' });
      stopFirebase();
    });

    eventSource.addEventListener('auth_revoked', async () => {
      // Token expired — reconnect with fresh token
      stopFirebase();
      await startFirebase(config);
    });

    eventSource.onerror = () => {
      mainWindow?.webContents.send('firebase-status', { connected: false, error: 'Connection lost' });
    };

    eventSource.onopen = () => {
      mainWindow?.webContents.send('firebase-status', { connected: true });
    };

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function stopFirebase() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  currentConfig = null;
}

// ─── Print job handler ────────────────────────────────────────────────────────

async function handlePrintJob(key, job) {
  mainWindow?.webContents.send('job-event', { key, job, status: 'printing' });
  try {
    await printSticker(job, currentConfig);
    await fbPatch(`/print_queue/${key}`, { printed: true });
    mainWindow?.webContents.send('job-event', { key, job, status: 'done' });
  } catch (err) {
    mainWindow?.webContents.send('job-event', { key, job, status: 'error', error: err.message });
  }
}

// ─── Sticker printing ─────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function printSticker(job, config) {
  // Generate QR code as base64 data URL
  const qrRaw = job.qrData || job.QrData || '';
  const qrDataUrl = await QRCode.toDataURL(qrRaw, {
    width: 250, margin: 1, errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#FFFFFF' }
  });

  // FAR-XXXXXX label
  const lastPart = qrRaw.split('-').pop();
  const farNum = parseInt(lastPart, 10);
  const farLabel = !isNaN(farNum) ? `FAR-${String(farNum).padStart(6, '0')}` : qrRaw;

  // Logo as base64
  const logoPath = path.join(__dirname, 'assets', 'logo.png');
  let logoDataUrl = '';
  if (fs.existsSync(logoPath)) {
    logoDataUrl = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
  }

  const fontsDir = path.join(__dirname, 'fonts').replace(/\\/g, '/');
  const stickerW = config.stickerWidth || 100;
  const stickerH = config.stickerHeight || 60;

  const events = Array.isArray(job.events || job.Events) ? (job.events || job.Events) : [];
  const eventsHtml = events.length > 0
    ? `<div class="events-section">
        <div class="events-label">ลงทะเบียน</div>
        ${events.map(e => `<div class="event-item">• ${escapeHtml(e)}</div>`).join('')}
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @font-face {
    font-family: 'IBM Plex Sans Thai';
    src: url('file://${fontsDir}/IBMPlexSansThai-Bold.ttf') format('truetype');
    font-weight: 700;
  }
  @font-face {
    font-family: 'IBM Plex Sans Thai';
    src: url('file://${fontsDir}/IBMPlexSansThai-Medium.ttf') format('truetype');
    font-weight: 500;
  }
  @font-face {
    font-family: 'IBM Plex Sans Thai';
    src: url('file://${fontsDir}/IBMPlexSansThai-Regular.ttf') format('truetype');
    font-weight: 400;
  }
  @page { size: ${stickerW}mm ${stickerH}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${stickerW}mm; height: ${stickerH}mm;
    font-family: 'IBM Plex Sans Thai', 'Helvetica Neue', sans-serif;
    background: white; overflow: hidden;
  }
  .sticker {
    width: ${stickerW}mm; height: ${stickerH}mm;
    display: flex; flex-direction: row;
    padding: 4mm; gap: 3mm;
  }
  .left {
    flex: 1; display: flex; flex-direction: column;
    justify-content: space-between; overflow: hidden;
  }
  .top { display: flex; flex-direction: column; }
  .name {
    font-size: 14pt; font-weight: 700;
    line-height: 1.25; color: #111;
    word-break: break-word;
  }
  .position {
    font-size: 9pt; font-weight: 400;
    color: #505050; margin-top: 1mm;
  }
  .events-section { margin-top: 2mm; overflow: hidden; }
  .events-label {
    font-size: 8pt; font-weight: 700;
    color: #111; margin-bottom: 0.8mm;
  }
  .event-item {
    font-size: 7.5pt; font-weight: 400;
    color: #333; line-height: 1.35;
  }
  .logo-area { margin-top: auto; }
  .logo-img { height: 7mm; width: auto; object-fit: contain; display: block; }
  .right {
    width: 26mm; flex-shrink: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 1.5mm;
  }
  .qr-img { width: 24mm; height: 24mm; display: block; }
  .far-label {
    font-size: 6.5pt; font-weight: 500;
    color: #333; text-align: center;
    letter-spacing: 0.3px;
  }
</style>
</head>
<body>
<div class="sticker">
  <div class="left">
    <div class="top">
      <div class="name">${escapeHtml((job.name || job.Name || '') + ' ' + (job.surname || job.Surname || ''))}</div>
      <div class="position">${escapeHtml(job.position || job.Position || '')}</div>
      ${eventsHtml}
    </div>
    ${logoDataUrl ? `<div class="logo-area"><img class="logo-img" src="${logoDataUrl}" /></div>` : ''}
  </div>
  <div class="right">
    <img class="qr-img" src="${qrDataUrl}" />
    <div class="far-label">${escapeHtml(farLabel)}</div>
  </div>
</div>
</body>
</html>`;

  // Write to temp file so file:// font URLs resolve correctly
  const tmpFile = path.join(os.tmpdir(), `sticker-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, 'utf-8');

  return new Promise((resolve, reject) => {
    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    printWin.webContents.on('did-finish-load', () => {
      // Wait for fonts to load before printing
      setTimeout(() => {
        printWin.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: config.printerName || '',
          pageSize: { width: stickerW * 1000, height: stickerH * 1000 },
          margins: { marginType: 'none' }
        }, (success, reason) => {
          printWin.close();
          fs.unlink(tmpFile, () => {});
          if (success) resolve();
          else reject(new Error(`Print failed: ${reason}`));
        });
      }, 800);
    });

    printWin.webContents.on('did-fail-load', (e, code, desc) => {
      printWin.close();
      fs.unlink(tmpFile, () => {});
      reject(new Error(`Failed to load sticker template: ${desc}`));
    });

    printWin.loadFile(tmpFile);
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-printers', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return [];
  return win.webContents.getPrintersAsync();
});

ipcMain.handle('connect-firebase', async (_, config) => {
  return startFirebase(config);
});

ipcMain.handle('disconnect-firebase', () => {
  stopFirebase();
  return { success: true };
});

ipcMain.handle('fetch-all-jobs', async (_, { databaseUrl, keyFile }) => {
  const prevConfig = currentConfig;
  currentConfig = { databaseUrl, keyFile };
  try {
    const data = await fbGet('/print_queue');
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    currentConfig = prevConfig;
  }
});

ipcMain.handle('mark-printed', async (_, { databaseUrl, keyFile, key }) => {
  const prevConfig = currentConfig;
  currentConfig = { databaseUrl, keyFile };
  try {
    await fbPatch(`/print_queue/${key}`, { printed: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    currentConfig = prevConfig;
  }
});

ipcMain.handle('delete-job', async (_, { databaseUrl, keyFile, key }) => {
  const prevConfig = currentConfig;
  currentConfig = { databaseUrl, keyFile };
  try {
    await fbDelete(`/print_queue/${key}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    currentConfig = prevConfig;
  }
});

ipcMain.handle('print-sticker', async (_, { job, config }) => {
  try {
    await printSticker(job, config);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('select-key-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Firebase Service Account Key',
    properties: ['openFile'],
    filters: [{ name: 'JSON Key File', extensions: ['json'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

function log(level, message) {
  mainWindow?.webContents.send('log', { level, message, time: new Date().toISOString() });
}
