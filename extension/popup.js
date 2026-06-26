// Popup chỉ hiển thị UI và giao tiếp với background.js

function parseInputPreview(raw) {
  raw = raw.trim();
  const m = raw.match(/\d{15,20}/);
  return m ? m[0] : raw;
}

function copyIcon() {
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}

function checkIcon() {
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = checkIcon();
    setTimeout(() => { btn.innerHTML = copyIcon(); }, 1200);
  });
}

function renderRow(r, placeholder = false) {
  const vid    = r.video_id || '—';
  const pids   = r.pids || [];
  const author = r.author || '';

  const authorCell = placeholder
    ? `<div class="cell-author"><div class="author" style="color:#d1d5db">Đang tải...</div></div>`
    : author
      ? `<div class="cell-author"><div class="author">@${author}</div><div class="desc">${r.desc || ''}</div></div>`
      : `<div class="cell-author"><div class="desc" style="color:#9ca3af">${r.error || '—'}</div></div>`;

  const pidCell = placeholder
    ? `<span class="mono" style="color:#d1d5db">—</span>`
    : pids.length === 0
      ? `<span class="mono" style="color:#d1d5db">—</span>`
      : pids.map(pid => `
          <div class="pid-cell">
            <span class="pid-val">${pid}</span>
            <button class="btn-copy" data-pid="${pid}" title="Copy">${copyIcon()}</button>
          </div>`).join('');

  const badge = placeholder
    ? `<span class="status-badge status-processing">Đang xử lý</span>`
    : r.status === 'ok' && pids.length > 0
      ? `<span class="status-badge status-ok">OK</span>`
      : r.status === 'ok'
        ? `<span class="status-badge status-warn">Không có SP</span>`
        : `<span class="status-badge status-error" title="${r.error || ''}">Lỗi</span>`;

  const linkCell = vid !== '—'
    ? `<a class="link-btn" href="https://www.tiktok.com/@${author || 'x'}/video/${vid}" target="_blank">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>` : '';

  return `<td>${authorCell}</td><td><span class="mono">${vid}</span></td><td>${pidCell}</td><td>${badge}</td><td>${linkCell}</td>`;
}

// ── State ────────────────────────────────────────────────────────────
const textarea     = document.getElementById('input-area');
const countLabel   = document.getElementById('count-label');
const btnRun       = document.getElementById('btn-run');
const btnExport    = document.getElementById('btn-export');
const tbody        = document.getElementById('tbody');
const spinner      = document.getElementById('spinner');
const progressWrap = document.getElementById('progress-wrap');
const progressBar  = document.getElementById('progress-bar');
const mTotal = document.getElementById('m-total');
const mOk    = document.getElementById('m-ok');
const mErr   = document.getElementById('m-err');

let allResults = [];
let isRunning  = false;

function getLines() {
  return textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
}

textarea.addEventListener('input', () => {
  const n = getLines().length;
  countLabel.textContent = n ? `${n} video` : '0 video';
});

function setMetrics(total, ok, err) {
  const blank = total === 0 && ok === 0 && err === 0;
  mTotal.textContent = blank ? '—' : total;
  mOk.textContent    = blank ? '—' : ok;
  mErr.textContent   = blank ? '—' : err;
}

function setRunning(running, total) {
  isRunning = running;
  btnRun.disabled = running;
  spinner.classList.toggle('active', running);
  progressWrap.classList.toggle('active', running);
  if (!running) {
    progressBar.style.width = '100%';
    setTimeout(() => progressWrap.classList.remove('active'), 600);
  }
}

// Rebuild table from stored results (when popup reopens mid-batch)
function restoreTable(inputs, results) {
  const total = inputs.length;
  tbody.innerHTML = inputs.map((raw, i) => {
    const guessId = parseInputPreview(raw);
    const r = results[i];
    if (!r) return `<tr id="row-${i}">${renderRow({ video_id: guessId, pids: [], status: 'processing' }, true)}</tr>`;
    return `<tr id="row-${i}">${renderRow(r)}</tr>`;
  }).join('');

  let ok = 0, err = 0;
  for (const r of results) {
    if (r.status === 'ok' && r.pids?.length > 0) ok++;
    else err++;
  }
  setMetrics(results.length, ok, err);
  progressBar.style.width = `${Math.round((results.length / total) * 100)}%`;
  allResults = [...results];
  if (allResults.length) btnExport.disabled = false;
}

// Handle live progress messages from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'progress') {
    const { index, total, result } = msg;
    allResults[index] = result;

    let ok = 0, err = 0;
    for (const r of allResults) {
      if (!r) continue;
      if (r.status === 'ok' && r.pids?.length > 0) ok++;
      else err++;
    }
    const processed = allResults.filter(Boolean).length;
    setMetrics(processed, ok, err);
    progressBar.style.width = `${Math.round(((index + 1) / total) * 100)}%`;

    const row = document.getElementById(`row-${index}`);
    if (row) row.innerHTML = renderRow(result);
    if (allResults.filter(Boolean).length) btnExport.disabled = false;
  }

  if (msg.type === 'done') {
    setRunning(false);
  }
});

// On popup open: restore state if background is running
chrome.runtime.sendMessage({ action: 'getState' }, (state) => {
  if (!state) return;
  const { running, inputs = [], results = [] } = state;

  if (inputs.length) {
    textarea.value = inputs.join('\n');
    countLabel.textContent = `${inputs.length} video`;
    restoreTable(inputs, results);
  }

  if (running) {
    setRunning(true, inputs.length);
  }
});

// Start batch
async function startExtract() {
  const inputs = getLines();
  if (!inputs.length || isRunning) return;

  allResults = [];
  btnExport.disabled = true;
  setMetrics(0, 0, 0);
  setRunning(true, inputs.length);
  progressBar.style.width = '0%';

  tbody.innerHTML = inputs.map((raw, i) => {
    const guessId = parseInputPreview(raw);
    return `<tr id="row-${i}">${renderRow({ video_id: guessId, pids: [], status: 'processing' }, true)}</tr>`;
  }).join('');

  chrome.runtime.sendMessage({ action: 'start', inputs });
}

function exportCSV() {
  const rows = [['input', 'video_id', 'author', 'product_id', 'desc', 'status', 'error']];
  for (const r of allResults) {
    if (!r) continue;
    if (r.pids?.length > 0) {
      for (const pid of r.pids)
        rows.push([r.input || '', r.video_id || '', r.author || '', pid, r.desc || '', r.status, '']);
    } else {
      rows.push([r.input || '', r.video_id || '', r.author || '', '', r.desc || '', r.status, r.error || '']);
    }
  }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `tiktok_pids_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

tbody.addEventListener('click', e => {
  const btn = e.target.closest('.btn-copy');
  if (btn) copyText(btn.dataset.pid, btn);
});

btnRun.addEventListener('click', startExtract);
btnExport.addEventListener('click', exportCSV);
