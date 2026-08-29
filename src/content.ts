import { sendPrompt, snapshotFromDocument } from './chatgptAdapter';
import type { ContentRequest, RuntimeNotice } from './contracts';

let lastSerialized = '';
let publishTimer: number | undefined;

function snapshot() {
  return snapshotFromDocument(document, location.href);
}

async function publishChanged(): Promise<void> {
  const next = snapshot();
  const serialized = JSON.stringify(next);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  const notice: RuntimeNotice = { type: 'content:changed', snapshot: next };
  try {
    await chrome.runtime.sendMessage(notice);
  } catch {
    // Extension reloads can detach an old content script. A later page load
    // receives the new script, so no recovery mutation is safe here.
  }
}

function schedulePublish(): void {
  if (publishTimer !== undefined) window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => void publishChanged(), 180);
}

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (message.type === 'content:get-snapshot') {
    sendResponse({ ok: true, snapshot: snapshot() });
    return false;
  }
  if (message.type === 'content:send') {
    void (async () => {
      try {
        await sendPrompt(document, message.text);
        schedulePublish();
        sendResponse({ ok: true, snapshot: snapshot() });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true;
  }
  return false;
});

const observer = new MutationObserver(schedulePublish);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['disabled', 'aria-disabled'],
});

window.addEventListener('popstate', schedulePublish);
window.addEventListener('hashchange', schedulePublish);
document.addEventListener('visibilitychange', schedulePublish);
void publishChanged();
