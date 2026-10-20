import { h, btn, clear, rootPath } from './ui.js';
import { loadSite, getKey, loadPrivateIndex } from './common.js';
import { progress, lock, settings, saveSettings, savedQuestions, clearQuestions, clearAllProgress } from './store.js';

const app = document.getElementById('app');

function lessonLink(l) {
  const p = progress(l.id);
  const solved = Object.values(p.problems || {}).filter((x) => x.status === 'solved').length;
  const sub = l.problems ? `${solved} of ${l.problems} problems done` : l.visibility === 'public' ? 'Key points and video' : '';
  return h('li', {},
    h('a', { href: `${rootPath()}l/${l.id}/` },
      h('span', {},
        h('span', { class: 't' }, l.title),
        h('span', { class: 'muted small' }, sub),
      ),
      l.demo ? h('span', { class: 'badge' }, 'Demo') : null,
    ),
  );
}

function renderLessons(container, lessons) {
  const sorted = [...lessons].sort((a, b) =>
    String(a.book).localeCompare(String(b.book)) || a.chapter - b.chapter || a.order - b.order);
  let lastGroup = '';
  let list;
  for (const l of sorted) {
    const group = l.chapter ? `${l.book} · Chapter ${l.chapter}${l.chapterTitle ? `: ${l.chapterTitle}` : ''}` : `${l.chapterTitle || 'Other'}`;
    if (group !== lastGroup) {
      container.append(h('h2', { class: 'chapter-title' }, group));
      list = h('ul', { class: 'lesson-list' });
      container.append(list);
      lastGroup = group;
    }
    list.append(lessonLink(l));
  }
}

function parentPanel(site) {
  const s = settings();
  const email = h('input', { class: 'text', type: 'email', id: 'dad-email', value: s.dadEmail || '', autocomplete: 'email', placeholder: 'name@example.com' });
  const saved = h('span', { class: 'muted small', 'aria-live': 'polite' });
  const qs = savedQuestions();
  return h('div', { class: 'card', id: 'parents' },
    h('h2', {}, 'For parents'),
    h('label', { class: 'field', for: 'dad-email' }, '“Send to Dad” email address'),
    h('p', { class: 'muted small' }, 'Saved only on this iPad. Questions open in the iPad’s mail app, addressed here.'),
    email,
    h('div', { class: 'row' },
      btn('Save', () => { saveSettings({ ...s, dadEmail: email.value.trim() }); saved.textContent = 'Saved.'; }, 'primary'),
      saved,
    ),
    h('h2', { style: { marginTop: '24px' } }, `Questions the site couldn’t answer (${qs.length})`),
    qs.length
      ? h('div', {}, ...qs.slice(0, 50).map((q) => h('div', { class: 'saved-q' },
        h('div', {}, `“${q.text}”`),
        h('div', { class: 'muted small' }, `${new Date(q.when).toLocaleString()} · ${q.lessonId}${q.ref ? ` · ${q.ref}` : ''}`))))
      : h('p', { class: 'muted small' }, 'None yet.'),
    h('div', { class: 'row' },
      qs.length ? btn('Clear questions', () => { clearQuestions(); location.reload(); }, 'quiet') : null,
      btn('Reset all progress', () => { if (confirmTwice()) { clearAllProgress(); location.reload(); } }, 'quiet'),
      site.check ? btn('Lock this iPad', () => { lock(); location.reload(); }, 'quiet') : null,
    ),
  );
}

let resetArmed = false;
function confirmTwice() {
  // No browser dialogs: the first tap arms, the second tap within 4 s resets.
  if (resetArmed) return true;
  resetArmed = true;
  setTimeout(() => { resetArmed = false; }, 4000);
  const b = [...document.querySelectorAll('#parents .btn')].find((x) => x.textContent.startsWith('Reset'));
  if (b) b.textContent = 'Tap again to reset';
  return false;
}

async function main() {
  let site;
  try {
    site = await loadSite();
  } catch {
    clear(app).append(h('div', { class: 'card' }, h('p', {}, 'The lessons couldn’t load. Check the Wi-Fi and reload the page.')));
    return;
  }
  document.title = site.title;
  const lessonsBox = h('div');
  const unlockBox = h('div');
  const showParents = location.hash === '#parents';
  clear(app).append(...[
    h('h1', {}, site.title),
    h('p', { class: 'muted' }, 'Read, watch, ask, then practice.'),
    unlockBox,
    lessonsBox,
    showParents ? parentPanel(site) : null,
    h('p', { class: 'disclaimer' },
      h('a', { href: showParents ? '#' : '#parents' }, showParents ? 'Hide parent settings' : 'For parents')),
  ].filter(Boolean));

  const lessons = [...(site.public || [])];
  renderLessons(lessonsBox, lessons);
  if (site.check) {
    const key = await getKey(site, unlockBox);
    clear(unlockBox);
    const idx = await loadPrivateIndex(site, key);
    lessons.push(...idx.lessons);
    renderLessons(clear(lessonsBox), lessons);
  }
  if (!lessons.length) lessonsBox.append(h('p', {}, 'No lessons yet.'));
}

window.addEventListener('hashchange', main);
main();
