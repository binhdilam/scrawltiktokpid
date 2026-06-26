// Background service worker — mở Side Panel và gửi notification

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
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
