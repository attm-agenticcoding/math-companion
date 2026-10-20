// Tiny DOM helpers.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const btn = (label, onclick, cls = '') => h('button', { type: 'button', class: `btn ${cls}`.trim(), onclick }, label);

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function rootPath() {
  return document.querySelector('meta[name="root"]')?.content || './';
}

export async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} for ${url}`), { status: r.status });
  return r.json();
}

export async function fetchBytes(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} for ${url}`), { status: r.status });
  return new Uint8Array(await r.arrayBuffer());
}

/** Turn "-3" style ASCII into the nicer minus sign for display. */
export function pretty(s) {
  return String(s).replace(/(^|[\s(=+*/])-(?=[\dA-Za-z(])/g, '$1−').replace(/ - /g, ' − ');
}

/**
 * Lesson text with math: {{top|bottom}} becomes a stacked fraction.
 * Returns a DocumentFragment (or plain text pieces) ready for h().
 */
export function rich(s) {
  const frag = document.createDocumentFragment();
  const text = String(s ?? '');
  const re = /\{\{([^{}|]*)\|([^{}]*)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(pretty(text.slice(last, m.index)));
    const frac = h('span', { class: 'frac', role: 'math', 'aria-label': `${plain(m[1])} over ${plain(m[2])}` },
      h('span', { class: 'num', 'aria-hidden': 'true' }, pretty(m[1].trim())),
      h('span', { class: 'den', 'aria-hidden': 'true' }, pretty(m[2].trim())));
    frag.append(frac);
    last = re.lastIndex;
  }
  if (last < text.length) frag.append(pretty(text.slice(last)));
  return frag;
}

/** The same text on one line, for lists and emails: {{a|b}} -> (a)/(b). */
export function plain(s) {
  return pretty(String(s ?? '').replace(/\{\{([^{}|]*)\|([^{}]*)\}\}/g, (_, a, b) => {
    const wrap = (t) => (/^[\w²³⁴⁵.·]+$/.test(t.trim()) ? t.trim() : `(${t.trim()})`);
    return `${wrap(a)}/${wrap(b)}`;
  }));
}

const PRAISE = ['You got it!', 'Yes — nice work!', 'That’s right!', 'Correct! Great thinking.', 'Exactly right!'];
export const praise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];

export function announce(el) {
  // Bring new feedback into view without jumping the whole page around.
  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}
