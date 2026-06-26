// Background service worker — runs independently of popup

function parseInput(raw) {
  raw = raw.trim();
  const m = raw.match(/\/video\/(\d+)/);
  if (m) return m[1];
  if (/^\d{15,20}$/.test(raw)) return raw;
  return null;
}

function extractPids(item) {
  const pids = [];

  for (const p of item?.commerce?.commerceInfo?.productItems || []) {
    const pid = String(p.productId || p.id || '');
    if (pid && !pids.includes(pid)) pids.push(pid);
  }

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

function pollTabForData(tabId) {
  return new Promise((resolve) => {
    const POLL_MS = 600;
    const MAX_MS  = 15000;
    const start   = Date.now();

    function poll() {
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const el = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
          if (!el) return null;
          try {
            const data = JSON.parse(el.textContent);
            const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
            return item ? el.textContent : null;
          } catch { return null; }
        },
      }, (results) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        const raw = results?.[0]?.result;
        if (raw) { resolve(raw); return; }
        if (Date.now() - start > MAX_MS) { resolve(null); return; }
        setTimeout(poll, POLL_MS);
      });
    }

    poll();
  });
}

function fetchVideo(videoId) {
  return new Promise((resolve) => {
    const url = `https://www.tiktok.com/@x/video/${videoId}`;

    chrome.tabs.create({ url, active: false }, (tab) => {
      const tabId = tab.id;

      const hard = setTimeout(() => {
        chrome.tabs.remove(tabId).catch(() => {});
        resolve({ video_id: videoId, status: 'error', pids: [], error: 'Timeout (30s)' });
      }, 30000);

      function onUpdated(id, info) {
        if (id !== tabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onUpdated);

        pollTabForData(tabId).then((raw) => {
          clearTimeout(hard);
          chrome.tabs.remove(tabId).catch(() => {});

          if (!raw) {
            resolve({ video_id: videoId, status: 'error', pids: [], error: 'Không lấy được data' });
            return;
          }
          try {
            const data = JSON.parse(raw);
            const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
            if (!item) { resolve({ video_id: videoId, status: 'error', pids: [], error: 'Không tìm thấy video' }); return; }
            resolve({ video_id: videoId, status: 'ok', pids: extractPids(item), author: item.author?.uniqueId || '', desc: (item.desc || '').slice(0, 100) });
          } catch {
            resolve({ video_id: videoId, status: 'error', pids: [], error: 'Parse error' });
          }
        });
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}

// Broadcast result to popup (if open) AND save to storage
async function emit(type, payload) {
  // Save state to storage so popup can restore when reopened
  if (type === 'progress') {
    const { results = [] } = await chrome.storage.session.get('results');
    results.push(payload);
    await chrome.storage.session.set({ results });
  }
  if (type === 'done') {
    await chrome.storage.session.set({ running: false });
  }

  // Try to message popup (may not be open — ignore error)
  chrome.runtime.sendMessage({ type, ...payload }).catch(() => {});
}

async function runBatch(inputs) {
  await chrome.storage.session.set({ running: true, inputs, results: [] });

  for (let i = 0; i < inputs.length; i++) {
    const raw     = inputs[i];
    const videoId = parseInput(raw);
    let result;

    if (!videoId) {
      result = { input: raw, video_id: '—', status: 'error', pids: [], error: 'Không parse được ID' };
    } else {
      result = await fetchVideo(videoId);
      result.input = raw;
    }

    await emit('progress', { index: i, total: inputs.length, result });
  }

  await emit('done', {});
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'start') {
    runBatch(msg.inputs);
    sendResponse({ ok: true });
  }
  if (msg.action === 'getState') {
    chrome.storage.session.get(['running', 'inputs', 'results']).then(sendResponse);
    return true; // async
  }
  if (msg.action === 'clear') {
    chrome.storage.session.set({ running: false, inputs: [], results: [] });
    sendResponse({ ok: true });
  }
});
