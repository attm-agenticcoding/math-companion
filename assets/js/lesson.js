// One lesson: Read → Review → Ask → Practice.
// All hints, answers and replies were written ahead of time for this lesson;
// this page only decides which one fits, and checks answers with exact math.
import { h, btn, clear, rootPath, fetchJSON, fetchBytes, pretty, rich, plain, praise, announce } from './ui.js';
import { loadSite, getKey, loadPrivateIndex } from './common.js';
import { decryptJSON, decryptFile, labels } from './crypto.js';
import { progress, saveProgress, saveQuestion, settings } from './store.js';
import { createTalkBox, canTalk } from './voice.js';
import { createKeypad } from './keypad.js';
import { checkAnswer, matchPhrase, speechToMath, parseMath, formatMath } from './mathcheck.js';
import { buildMatcher } from './qa.js';

const app = document.getElementById('app');
const lessonId = document.body.dataset.lesson;
const root = rootPath();

let site;
let lesson;
let key = null;
let help = [];
let prog;
const mediaCache = new Map();
const pstate = new Map(); // per-problem state for this visit

// ------------------------------------------------------------ loading
async function main() {
  try {
    site = await loadSite();
  } catch {
    return fail('The lesson couldn’t load. Check the Wi-Fi and reload the page.');
  }
  const isPublic = (site.public || []).some((l) => l.id === lessonId);
  try {
    if (isPublic) {
      lesson = await fetchJSON(`${root}data/${lessonId}.json`);
    } else {
      if (!site.check) return fail('This lesson isn’t available.');
      const box = h('div');
      clear(app).append(topbar(), box);
      key = await getKey(site, box, 'Unlock this lesson');
      const enc = await fetchJSON(`${root}data/${lessonId}.enc.json`);
      lesson = await decryptJSON(key, enc, labels.lesson(lessonId));
      help = (await loadPrivateIndex(site, key)).help || [];
    }
  } catch (e) {
    return fail(e.status === 404 ? 'This lesson isn’t available.' : 'The lesson couldn’t load. Check the Wi-Fi and reload the page.');
  }
  document.title = `${lesson.title} · ${site.title}`;
  prog = progress(lessonId);
  prog.steps ||= {};
  prog.problems ||= {};
  window.addEventListener('hashchange', route);
  route();
}

function fail(message) {
  clear(app).append(topbar(), h('div', { class: 'card' }, h('p', {}, message)));
}

const save = () => saveProgress(lessonId, prog);

function steps() {
  const s = [['read', 'Read'], ['review', 'Review']];
  if (lesson.visibility !== 'public') s.push(['ask', 'Ask']);
  s.push(['practice', 'Practice']);
  return s;
}

// ------------------------------------------------------------ layout
function topbar() {
  return h('div', { class: 'topbar' },
    h('a', { class: 'back', href: root }, '‹ All lessons'),
    lesson?.demo ? h('span', { class: 'badge' }, 'Demo lesson') : null,
  );
}

function header() {
  const where = lesson.chapter ? `${lesson.book} · Chapter ${lesson.chapter}` : lesson.chapterTitle || '';
  return [topbar(), h('h1', {}, lesson.title), where ? h('p', { class: 'muted' }, where) : null];
}

function stepBar(current) {
  const list = steps();
  const ol = h('ol', { class: 'steps', style: { '--n': list.length } });
  list.forEach(([id, label], i) => {
    ol.append(h('li', {},
      h('button', {
        type: 'button',
        class: prog.steps[id] ? 'done' : '',
        'aria-current': current === id ? 'step' : null,
        onclick: () => go(`#${id}`),
      }, h('span', { class: 'num' }, `Step ${i + 1}`), label)));
  });
  return ol;
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
  const hash = location.hash.slice(1);
  const m = /^p\/(.+)$/.exec(hash);
  const problem = m && (lesson.practice?.problems || []).find((p) => p.id === decodeURIComponent(m[1]));
  const valid = steps().map(([id]) => id);
  const step = problem ? 'practice' : valid.includes(hash) ? hash : valid.find((id) => !prog.steps[id]) || 'read';
  const body = h('div');
  clear(app).append(...header(), stepBar(step), body);
  if (problem) renderProblem(body, problem);
  else ({ read: renderRead, review: renderReview, ask: renderAsk, practice: renderPractice })[step](body);
  window.scrollTo(0, 0);
}

function finishStep(id) {
  prog.steps[id] = true;
  save();
  const list = steps().map(([s]) => s);
  go(`#${list[list.indexOf(id) + 1] || id}`);
}

// ------------------------------------------------------------ Step 1: Read
function renderRead(body) {
  body.append(h('div', { class: 'card' },
    h('h2', {}, 'Read'),
    h('p', { class: 'problem-text', style: { fontSize: '24px' } }, lesson.read.pages),
    lesson.read.tip ? h('p', { class: 'muted' }, lesson.read.tip) : null,
    h('div', { class: 'row' }, btn('I finished reading', () => finishStep('read'), 'primary')),
  ));
}

// ------------------------------------------------------------ Step 2: Review
async function mediaUrl(name, type) {
  if (lesson.visibility === 'public') return `${root}media/${lessonId}/${name}`;
  if (!mediaCache.has(name)) {
    mediaCache.set(name, (async () => {
      const bytes = await fetchBytes(`${root}media/${lessonId}/${name}.enc`);
      const plain = await decryptFile(key, bytes, labels.media(lessonId, name));
      return URL.createObjectURL(new Blob([plain], { type }));
    })());
  }
  return mediaCache.get(name);
}

function renderReview(body) {
  const r = lesson.review;
  const videoBox = h('div');
  body.append(h('div', { class: 'card' },
    h('h2', {}, 'Key points'),
    h('ul', { class: 'keypoints' }, ...r.keyPoints.map((k) => h('li', {}, rich(k)))),
  ));
  if (r.video) {
    body.append(h('div', { class: 'card' }, h('h2', {}, 'Watch the video'), videoBox));
    videoBox.append(h('p', { class: 'muted' }, 'Loading the video…'));
    (async () => {
      try {
        const video = h('video', { controls: true, playsinline: true, preload: 'metadata' });
        video.src = await mediaUrl(r.video, 'video/mp4');
        if (r.poster) video.poster = await mediaUrl(r.poster, 'image/jpeg');
        if (r.captions) {
          video.append(h('track', { kind: 'captions', srclang: 'en', label: 'English', default: true, src: await mediaUrl(r.captions, 'text/vtt') }));
        }
        clear(videoBox).append(video, h('p', { class: 'muted small' }, 'When the video says “pause and think,” you can tap pause and figure it out first.'));
      } catch {
        clear(videoBox).append(h('p', {}, 'The video couldn’t load. Check the Wi-Fi and reload the page.'));
      }
    })();
  }
  body.append(h('div', { class: 'row' }, btn('Got it — next step', () => finishStep('review'), 'primary')));
}

// ------------------------------------------------------------ Step 3: Ask
function mailtoHref(question, ctx = {}) {
  const to = settings().dadEmail || '';
  const subject = `${site.askDadSubjectTag || '[Math Companion]'} ${lesson.title}${ctx.problem ? ` · ${ctx.problem.ref}` : ''}`;
  const lines = [
    `My question: ${question}`,
    '',
    `Lesson: ${lesson.title} (${lesson.id})`,
  ];
  if (ctx.problem) {
    const st = pstate.get(ctx.problem.id);
    lines.push(`Problem: ${ctx.problem.ref}${ctx.problem.text ? ` — ${plain(ctx.problem.text)}` : ''}`);
    const last = st?.attempts?.at(-1);
    lines.push(`My last answer: ${last ? last.heard || last.text : '(none yet)'}`);
    lines.push(`Hints I've seen: ${st?.level || 0}`);
  }
  lines.push('', 'Sent from Math Companion');
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

function askWidget(ctx = {}) {
  const out = h('div', { 'aria-live': 'polite' });
  const entries = [...(ctx.problem?.ask || []), ...(lesson.ask || []), ...help];
  const matcher = buildMatcher(entries);
  const talk = createTalkBox({
    prompt: 'Tap the button and ask your question.',
    confirmLabel: 'Ask it',
    compact: !!ctx.problem,
    onConfirm: (text) => { talk.reset(); answer(text); },
  });

  function again() {
    clear(out);
    talk.reset();
  }

  function showEntry(entry, asked) {
    clear(out).append(h('p', { class: 'muted small' }, `You asked: “${asked}”`), h('div', { class: 'note' },
      h('span', { class: 'label' }, rich(entry.q[0])),
      h('div', {}, rich(entry.a)),
    ), h('div', { class: 'row' },
      btn('Ask another question', again, 'quiet'),
      btn('That didn’t answer it', () => noAnswer(asked), 'quiet'),
    ));
    announce(out);
  }

  function noAnswer(text) {
    saveQuestion({ lessonId, ref: ctx.problem?.ref || null, text });
    clear(out).append(h('p', { class: 'muted small' }, `You asked: “${text}”`), h('div', { class: 'feedback info' },
      'I don’t have a ready answer for that one.',
      h('span', { class: 'sub' }, 'Dad can help! Tap below — your email app opens with the question already written. Then tap send.'),
    ), h('div', { class: 'row' },
      h('a', { class: 'btn primary', href: mailtoHref(text, ctx) }, 'Send to Dad'),
      btn('Ask something else', again, 'quiet'),
    ));
    announce(out);
  }

  function answer(text) {
    const r = matcher.match(text);
    if (r.status === 'answer') return showEntry(r.best.entry, text);
    if (r.status === 'choose') {
      clear(out).append(
        h('p', { class: 'muted small' }, `You asked: “${text}”`),
        h('p', { class: 'feedback info' }, 'Did you mean one of these?'),
        h('div', { class: 'choice-list' },
          ...r.choices.map((c) => btn(plain(c.entry.q[0]), () => showEntry(c.entry, text), 'quiet')),
          btn('None of these', () => noAnswer(text), 'quiet'),
        ),
      );
      return announce(out);
    }
    return noAnswer(text);
  }

  const parts = [talk.el, out];
  if (!canTalk()) {
    parts.push(h('p', { class: 'muted small' }, 'You can also pick a question from the list.'));
  }
  return h('div', {}, ...parts);
}

function qaBrowser(list) {
  return h('div', {}, ...list.map((e) => {
    const a = h('div', { class: 'a hidden' }, rich(e.a));
    const b = h('button', {
      type: 'button', 'aria-expanded': 'false',
      onclick: () => {
        const open = a.classList.toggle('hidden') === false;
        b.setAttribute('aria-expanded', String(open));
      },
    }, rich(e.q[0]));
    return h('div', { class: 'qa-item' }, b, a);
  }));
}

function renderAsk(body) {
  body.append(
    h('div', { class: 'card' },
      h('h2', {}, 'Ask'),
      h('p', {}, 'Is anything confusing? Ask about it here.'),
      askWidget(),
      h('p', { class: 'disclaimer' }, 'These answers were written ahead of time for this lesson.'),
    ),
    (lesson.ask || []).length ? h('div', { class: 'card' }, h('h2', {}, 'Questions other kids ask'), qaBrowser(lesson.ask)) : null,
    h('div', { class: 'row' }, btn('No more questions — let’s practice', () => finishStep('ask'), 'primary')),
  );
}

// ------------------------------------------------------------ Step 4: Practice
function problemStatus(p) {
  return prog.problems[p.id]?.status || '';
}

function renderPractice(body) {
  const problems = lesson.practice?.problems || [];
  body.append(h('div', { class: 'card' },
    h('h2', {}, 'Practice'),
    h('p', { class: 'problem-text', style: { fontSize: '24px' } }, lesson.practice?.pages || ''),
    lesson.visibility === 'public' || !problems.length
      ? h('p', { class: 'muted' }, 'Check your answers with the answer pages in the back of your Practice book.')
      : h('p', { class: 'muted' }, 'Tap a problem to check your answer or get help with it.'),
  ));
  if (!problems.length || lesson.visibility === 'public') return;
  const solved = problems.filter((p) => problemStatus(p) === 'solved').length;
  body.append(
    h('ul', { class: 'problem-list' }, ...problems.map((p) => h('li', {},
      h('button', { type: 'button', onclick: () => go(`#p/${encodeURIComponent(p.id)}`) },
        h('span', {}, h('strong', {}, p.ref), p.text ? h('span', { class: 'muted' }, ` · ${shorten(plain(p.text), 48)}`) : null),
        h('span', {
          class: `status-dot ${problemStatus(p)}`,
          'aria-label': problemStatus(p) === 'solved' ? 'done' : problemStatus(p) === 'tried' ? 'started' : 'not started',
        }),
      )))),
    h('p', { class: 'muted', style: { marginTop: '14px' } },
      solved === problems.length ? 'You finished every problem in this lesson. Great work!' : `${solved} of ${problems.length} done.`),
  );
  if (solved === problems.length && !prog.steps.practice) {
    prog.steps.practice = true;
    save();
  }
}

const shorten = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function headingFor(spec, text) {
  if (!spec || spec.kind === 'choice' || spec.kind === 'text') return text;
  const ph = matchPhrase(text, spec);
  if (ph) return ph.button || ph.say[0];
  try {
    return pretty(formatMath(parseMath(speechToMath(text, spec.variables || ''), spec.variables)));
  } catch {
    return text;
  }
}

/** Answer input: option buttons, or talk + keypad. onText(text) is called with what she chose. */
function answerInput(spec, onText, { compact = false } = {}) {
  if (!spec || spec.kind === 'none') {
    return h('p', { class: 'muted' }, 'I can’t check this one. Use the answer pages in the back of your Practice book.');
  }
  if (spec.options?.length) {
    return h('div', { class: 'row' }, ...spec.options.map((o) => btn(String(o), () => onText(String(o)), 'quiet')));
  }
  const wrap = h('div');
  const pad = createKeypad({
    kind: spec.kind === 'equation' ? 'equation' : spec.kind === 'expression' ? 'expression' : 'number',
    variables: spec.variables || 'x',
    onSubmit: (t) => { pad.clear(); onText(t); },
  });
  const padBox = h('div', { class: canTalk() ? 'hidden' : '' }, pad.el);
  const talk = createTalkBox({
    prompt: 'Tap the button and say your answer.',
    confirmLabel: 'Check it',
    compact,
    format: (t) => headingFor(spec, t),
    onConfirm: (t) => { talk.reset(); onText(t); },
  });
  wrap.append(talk.el);
  if (canTalk()) {
    const toggle = h('button', {
      type: 'button', class: 'linklike',
      onclick: () => {
        const nowHidden = padBox.classList.toggle('hidden');
        toggle.textContent = nowHidden ? 'Use the keypad instead' : 'Hide the keypad';
      },
    }, 'Use the keypad instead');
    wrap.append(h('div', { style: { textAlign: 'center' } }, toggle));
  }
  wrap.append(padBox);
  const phraseButtons = (spec.phrases || []).filter((ph) => ph.button);
  if (phraseButtons.length) {
    wrap.append(h('div', { class: 'row' }, ...phraseButtons.map((ph) => btn(ph.button, () => onText(ph.button), 'quiet phrase'))));
  }
  return wrap;
}

const FEEDBACK = {
  'not-simplified': ['info', 'That’s equal to the answer, but it can be simpler.', 'Can you simplify it some more?'],
  wrong: ['try', 'Not quite yet.', 'Check your work and try again — or tap “I’m stuck” for a hint.'],
  'need-number': ['info', 'Almost — can you finish working it out?', 'Tell me just the final number.'],
  unparsed: ['info', 'I couldn’t tell which answer that was.', 'Try saying it again, or use the keypad.'],
  empty: ['info', 'I didn’t get an answer.', 'Try again.'],
};

function feedbackEl(kind, main, sub) {
  return h('div', { class: `feedback ${kind}`, role: 'status' }, main, sub ? h('span', { class: 'sub' }, sub) : null);
}

/** A small question inside a hint, with its own checking. */
function miniQuestion({ text, answer, hint }, onDone) {
  let wrongs = 0;
  const fb = h('div');
  const box = h('div', { class: 'mini' }, h('p', { class: 'q' }, rich(text)));
  const input = answerInput(answer, (t) => {
    const r = checkAnswer(t, answer);
    clear(fb);
    if (r.status === 'correct') {
      fb.append(feedbackEl('good', praise()));
      input.classList.add('hidden');
      onDone(false);
    } else if (r.status === 'known-wrong' || r.status === 'wrong') {
      wrongs += 1;
      fb.append(feedbackEl('try', 'Not quite.', r.feedback || (wrongs === 1 ? 'Give it another try.' : null)));
      if (wrongs === 2 && hint) fb.append(h('div', { class: 'note' }, h('span', { class: 'label' }, 'Hint'), rich(hint)));
      if (wrongs >= 3) {
        fb.append(h('div', { class: 'note' }, h('span', { class: 'label' }, 'Here’s the answer'), `It’s ${pretty(String(answer.answers[0]))}.`));
        input.classList.add('hidden');
        onDone(true);
      }
    } else {
      const [k, m, s] = FEEDBACK[r.status] || FEEDBACK.unparsed;
      fb.append(feedbackEl(k, m, s));
    }
    announce(fb);
  }, { compact: true });
  box.append(input, fb);
  return box;
}

function ladderFor(p) {
  const L = [];
  if (p.hints?.condition) L.push({ type: 'note', label: 'Look closely', text: p.hints.condition });
  if (p.hints?.idea) L.push({ type: 'note', label: 'Remember', text: p.hints.idea });
  if (p.example) L.push({ type: 'example' });
  if (p.steps?.length) L.push({ type: 'steps' });
  if (p.solution) L.push({ type: 'solution' });
  return L;
}

function renderProblem(body, p) {
  const st = pstate.get(p.id) || { level: 0, attempts: [], askedTried: false };
  pstate.set(p.id, st);
  const levels = ladderFor(p);
  const record = (status) => {
    const cur = prog.problems[p.id] || {};
    prog.problems[p.id] = { status: cur.status === 'solved' ? 'solved' : status, hints: Math.max(cur.hints || 0, st.level) };
    save();
  };

  const problems = lesson.practice.problems;
  const next = problems[problems.indexOf(p) + 1];
  const nextBtn = () => btn(next ? `Next: ${next.ref}` : 'Back to all problems', () => go(next ? `#p/${encodeURIComponent(next.id)}` : '#practice'), 'primary');

  const feedback = h('div', { 'aria-live': 'polite' });
  const ladder = h('div');
  const ladderActions = h('div', { class: 'row' });
  const askBox = h('div', { class: 'card hidden' }, h('h2', {}, `Ask about ${p.ref}`), askWidget({ problem: p }));

  const answerCard = h('div', { class: 'card' }, h('h2', {}, 'Your answer'));
  const input = answerInput(p.answer, (text) => {
    const r = checkAnswer(text, p.answer);
    st.attempts.push({ text, heard: r.heard, status: r.status });
    clear(feedback);
    if (r.status === 'correct') {
      record('solved');
      feedback.append(
        feedbackEl('good', praise(), st.level === 0 ? 'You did it all by yourself.' : 'You worked through it step by step. That’s how math gets easier.'),
        h('div', { class: 'row' }, nextBtn()),
      );
    } else if (r.status === 'known-wrong') {
      record('tried');
      feedback.append(feedbackEl('try', 'Not quite.', r.feedback));
    } else {
      if (r.status === 'wrong') record('tried');
      const [k, m, s] = FEEDBACK[r.status] || FEEDBACK.unparsed;
      feedback.append(feedbackEl(k, m, s));
    }
    announce(feedback);
  });
  answerCard.append(input, feedback);
  if (p.answer?.kind === 'none') {
    const done = problemStatus(p) === 'solved';
    answerCard.append(h('div', { class: 'row' }, btn(done ? 'Checked ✓' : 'I checked it in the book', () => {
      record('solved');
      clear(feedback).append(
        feedbackEl('good', 'Nice work checking it yourself.', 'If your answer was different, look at how the book did it — that’s how you learn the trick.'),
        h('div', { class: 'row' }, nextBtn()),
      );
      announce(feedback);
    }, 'quiet')));
  }

  function renderLevel(item) {
    const card = h('div', { class: 'card' });
    if (item.type === 'note') {
      card.append(h('div', { class: 'note' }, h('span', { class: 'label' }, item.label), rich(item.text)));
    } else if (item.type === 'example') {
      card.append(h('h2', {}, 'Try an easier one first'));
      card.append(miniQuestion(p.example, () => {
        if (p.example.after) card.append(h('div', { class: 'note' }, h('span', { class: 'label' }, 'Now back to the problem'), rich(p.example.after)));
        announce(card);
      }));
    } else if (item.type === 'steps') {
      card.append(h('h2', {}, 'Let’s go one step at a time'));
      let i = 0;
      const nextStep = () => {
        if (i >= p.steps.length) {
          card.append(h('div', { class: 'note' }, h('span', { class: 'label' }, 'You did every step!'), 'Now say your answer to the whole problem up top.'));
          return announce(card);
        }
        const s = p.steps[i++];
        card.append(miniQuestion(s, nextStep));
        announce(card);
      };
      nextStep();
    } else if (item.type === 'solution') {
      card.append(h('h2', {}, 'Here’s how it works'), h('p', { class: 'solution' }, rich(p.solution)));
      if (p.similar) {
        card.append(h('p', { class: 'muted' }, 'Now you try one like it:'));
        card.append(miniQuestion(p.similar, (revealed) => {
          card.append(h('div', { class: 'note' }, h('span', { class: 'label' }, revealed ? 'Keep going' : 'Great!'),
            revealed ? 'Read the explanation once more, then try the problem up top.' : 'You’ve got the idea. Now put your answer for the problem up top.'));
          announce(card);
        }));
      }
    }
    ladder.append(card);
    announce(card);
  }

  function updateLadderActions() {
    clear(ladderActions);
    if (!levels.length) {
      ladderActions.append(h('p', { class: 'muted' }, 'There are no hints for this one. Ask about it below, or send it to Dad.'));
      return;
    }
    if (st.level < levels.length) {
      ladderActions.append(btn(st.level === 0 ? 'I’m stuck' : 'Still stuck? Next hint', stuck, 'quiet'));
    } else {
      ladderActions.append(h('p', { class: 'muted' }, 'That’s all my hints. You can ask about it, or send it to Dad.'));
    }
    ladderActions.append(btn('Ask about this problem', () => { askBox.classList.remove('hidden'); announce(askBox); }, 'quiet'));
  }

  function stuck() {
    const triedSomething = st.attempts.some((a) => ['wrong', 'known-wrong', 'not-simplified'].includes(a.status));
    if (!triedSomething && !st.askedTried && st.level === 0) {
      st.askedTried = true;
      const card = h('div', { class: 'card' },
        h('p', {}, 'What have you tried so far? If you have an answer — even one you’re not sure about — say it up top, and I’ll help from there.'),
        h('div', { class: 'row' },
          btn('I have an answer', () => { card.remove(); announce(answerCard); }, 'quiet'),
          btn('I haven’t started yet', () => { card.remove(); stuck(); }, 'quiet'),
        ));
      ladder.append(card);
      announce(card);
      return;
    }
    if (st.level < levels.length) {
      renderLevel(levels[st.level]);
      st.level += 1;
      record(prog.problems[p.id]?.status || 'tried');
    }
    updateLadderActions();
  }

  // re-show hints already opened during this visit
  const shown = st.level;
  st.level = 0;
  body.append(
    h('a', { class: 'back', href: '#practice' }, '‹ All problems'),
    h('div', { class: 'card', style: { marginTop: '10px' } },
      h('p', { class: 'muted', style: { marginBottom: '4px' } }, p.ref),
      p.text ? h('p', { class: 'problem-text' }, rich(p.text)) : h('p', {}, `Look at ${p.ref} in your Practice book.`),
      p.note ? h('p', { class: 'muted' }, rich(p.note)) : null,
    ),
    answerCard,
    ladder,
    ladderActions,
    askBox,
    h('div', { class: 'row' }, next ? btn(`Skip to ${next.ref}`, () => go(`#p/${encodeURIComponent(next.id)}`), 'quiet') : null),
  );
  while (st.level < shown) { renderLevel(levels[st.level]); st.level += 1; }
  updateLadderActions();
}

main();
