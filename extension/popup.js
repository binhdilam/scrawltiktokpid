function parseInput(raw) {
  raw = raw.trim();
  const m = raw.match(/\/video\/(\d+)/);
  if (m) return m[1];
  if (/^\d{15,20}$/.test(raw)) return raw;
  return null;
}

function extractPids(item) {
  const pids = [];

  // Path 1: commerce.commerceInfo.productItems
  for (const p of item?.commerce?.commerceInfo?.productItems || []) {
    const pid = String(p.productId || p.id || '');
    if (pid && !pids.includes(pid)) pids.push(pid);
  }

  // Path 2: anchors[].extra — array of product objects with "id" field
  for (const anchor of item?.anchors || []) {
    let extra = anchor.extra || anchor.anchorExtra || {};
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch { extra = {}; }
    }
    const items = Array.isArray(extra) ? extra : [extra];
    for (const ex of items) {
      if (typeof ex !== 'object' || !ex) continue;
      const pid = String(ex.productId || ex.product_id || ex.id || '');
      if (pid && /^\d{10,20}$/.test(pid) && !pids.includes(pid)) pids.push(pid);
    }
  }

  // Path 3: stickersOnItem type=2
  for (const sticker of item?.stickersOnItem || []) {
    if (sticker.stickerType === 2) {
      for (const text of sticker.stickerText || []) {
        const t = String(text);
        if (/^\d{10,20}$/.test(t) && !pids.includes(t)) pids.push(t);
      }
    }
  }

  return pids;
}

// Mở tab thật của Chrome, đợi TikTok load xong, đọc data từ DOM, đóng tab
function fetchVideoViaTab(videoId) {
  return new Promise((resolve) => {
    const url = `https://www.tiktok.com/@x/video/${videoId}`;

    chrome.tabs.create({ url, active: false }, (tab) => {
      const tabId = tab.id;
      const timeout = setTimeout(() => {
        chrome.tabs.remove(tabId).catch(() => {});
        resolve({ video_id: videoId, status: 'error', pids: [], error: 'Timeout' });
      }, 20000);

      function onUpdated(updatedId, info) {
        if (updatedId !== tabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timeout);

        // Đợi thêm 800ms để JS TikTok render xong
        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const el = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
              return el ? el.textContent : null;
            },
          }, (results) => {
            chrome.tabs.remove(tabId).catch(() => {});

            const raw = results?.[0]?.result;
            if (!raw) {
              resolve({ video_id: videoId, status: 'error', pids: [], error: 'Không lấy được data (đăng nhập TikTok chưa?)' });
              return;
            }

            try {
              const data = JSON.parse(raw);
              const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
              if (!item) {
                resolve({ video_id: videoId, status: 'error', pids: [], error: 'Không tìm thấy video' });
                return;
              }
              resolve({
                video_id: videoId,
                status: 'ok',
                pids: extractPids(item),
                author: item.author?.uniqueId || '',
                desc: (item.desc || '').slice(0, 100),
              });
            } catch (e) {
              resolve({ video_id: videoId, status: 'error', pids: [], error: 'Parse error' });
            }
          });
        }, 800);
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}

// ── UI ──────────────────────────────────────────────────────────────

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
    ? `<a class="link-btn" href="https://www.tiktok.com/@${author || 'x'}/video/${vid}" target="_blank" title="Mở video">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>`
    : '';

  return `<td>${authorCell}</td><td><span class="mono">${vid}</span></td><td>${pidCell}</td><td>${badge}</td><td>${linkCell}</td>`;
}

tbody.addEventListener('click', e => {
  const btn = e.target.closest('.btn-copy');
  if (btn) copyText(btn.dataset.pid, btn);
});

async function startExtract() {
  const inputs = getLines();
  if (!inputs.length) return;

  allResults = [];
  btnRun.disabled = true;
  btnExport.disabled = true;
  spinner.classList.add('active');
  progressWrap.classList.add('active');
  progressBar.style.width = '0%';
  setMetrics(0, 0, 0);

  tbody.innerHTML = inputs.map((raw, i) => {
    const guessId = raw.match(/\d{15,20}/)?.[0] || raw;
    return `<tr id="row-${i}">${renderRow({ video_id: guessId, pids: [], status: 'processing' }, true)}</tr>`;
  }).join('');

  let processed = 0, okCount = 0, errCount = 0;

  // Xử lý từng video tuần tự (tránh mở quá nhiều tab cùng lúc)
  for (let i = 0; i < inputs.length; i++) {
    const raw = inputs[i];
    const videoId = parseInput(raw);
    let result;

    if (!videoId) {
      result = { input: raw, video_id: '—', status: 'error', pids: [], error: 'Không parse được ID' };
    } else {
      result = await fetchVideoViaTab(videoId);
      result.input = raw;
    }

    allResults.push(result);
    processed++;

    if (result.status === 'ok' && result.pids.length > 0) okCount++;
    else errCount++;

    setMetrics(processed, okCount, errCount);
    progressBar.style.width = `${Math.round((processed / inputs.length) * 100)}%`;

    const row = document.getElementById(`row-${i}`);
    if (row) row.innerHTML = renderRow(result);
  }

  spinner.classList.remove('active');
  progressWrap.classList.remove('active');
  btnRun.disabled = false;
  if (allResults.length) btnExport.disabled = false;
}

function exportCSV() {
  const rows = [['input', 'video_id', 'author', 'product_id', 'desc', 'status', 'error']];
  for (const r of allResults) {
    if (r.pids && r.pids.length > 0) {
      for (const pid of r.pids) {
        rows.push([r.input || '', r.video_id || '', r.author || '', pid, r.desc || '', r.status, '']);
      }
    } else {
      rows.push([r.input || '', r.video_id || '', r.author || '', '', r.desc || '', r.status, r.error || '']);
    }
  }

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `tiktok_pids_${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

btnRun.addEventListener('click', startExtract);
btnExport.addEventListener('click', exportCSV);
