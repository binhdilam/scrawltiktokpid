// Background service worker — chỉ lo mở window và gửi notification
// Batch logic chạy trong popup.js (window context ổn định hơn service worker)

let toolWindowId = null;

chrome.action.onClicked.addListener(() => {
  if (toolWindowId !== null) {
    chrome.windows.get(toolWindowId, (win) => {
      if (chrome.runtime.lastError || !win) {
        toolWindowId = null;
        openWindow();
      } else {
        chrome.windows.update(toolWindowId, { focused: true });
      }
    });
  } else {
    openWindow();
  }
});

function openWindow() {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 700,
    height: 680,
    focused: true,
  }, (win) => {
    toolWindowId = win.id;
  });
}

chrome.windows.onRemoved.addListener((winId) => {
  if (winId === toolWindowId) toolWindowId = null;
});

// Popup gửi message khi xong để hiện notification
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'notify') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'TikTok PID Extractor — Xong!',
      message: `✅ ${msg.ok} có PID   ❌ ${msg.err} không có   (${msg.total} video)`,
    });
  }
});
