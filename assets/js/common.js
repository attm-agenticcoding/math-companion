// Loading the site settings and unlocking private lessons, shared by every page.
import { h, clear, fetchJSON, rootPath } from './ui.js';
import { decryptJSON, labels } from './crypto.js';
import { savedKey, unlock } from './store.js';
import { createPasscodePad } from './keypad.js';

let sitePromise;
export function loadSite() {
  sitePromise ??= fetchJSON(`${rootPath()}data/site.json`);
  return sitePromise;
}

/** Shows the passcode pad inside `container` until unlocked. Resolves with the key. */
export function askPasscode(container, site, title = 'Unlock your lessons') {
  return new Promise((resolve) => {
    const pad = createPasscodePad({
      onSubmit: async (code) => {
        const key = await unlock(site, code);
        if (key) resolve(key);
        return !!key;
      },
    });
    clear(container).append(h('div', { class: 'card' }, h('h2', {}, title), pad.el));
  });
}

export async function getKey(site, container, title) {
  if (!site.check) return null;
  return (await savedKey(site)) || askPasscode(container, site, title);
}

export async function loadPrivateIndex(site, key) {
  const box = await fetchJSON(`${rootPath()}data/private-index.enc.json`);
  return decryptJSON(key, box, labels.index);
}
