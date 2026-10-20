// Tap-to-talk using Safari's built-in speech recognition (Apple's dictation).
// She controls start and stop. Every state is shown in words, and she always
// sees what was heard before anything is checked, so a mishearing can never
// be judged as right or wrong.
import { h, btn, clear } from './ui.js';

const Rec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const canTalk = () => !!Rec;

const MIC = () => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path fill="currentColor" d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4Zm7-4a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-3.08A7 7 0 0 0 19 11Z"/>';
  return svg;
};

const ERRORS = {
  'not-allowed': 'The microphone is turned off for this website. Ask a grown-up to allow the microphone for Safari.',
  'service-not-allowed': 'Talking isn’t available right now. A grown-up can turn on Dictation in Settings › General › Keyboard.',
  'audio-capture': 'I can’t find a microphone. Check that nothing else is using it.',
  network: 'Talking needs the internet. Check the Wi-Fi and try again.',
};

/**
 * opts: {
 *   prompt:       what to say, e.g. "Tell me your answer"
 *   confirmLabel: button text after hearing, e.g. "Check it"
 *   format(text): how to show what was heard (optional)
 *   onConfirm(text)
 * }
 */
export function createTalkBox(opts) {
  const status = h('div', { class: 'talk-status', 'aria-live': 'polite' });
  const live = h('div', { class: 'live', 'aria-hidden': 'true' });
  const button = h('button', { type: 'button', class: 'talk-btn', 'data-state': 'ready' });
  const heardBox = h('div', { class: 'heard hidden', 'aria-live': 'polite' });
  const el = h('div', { class: opts.compact ? 'talk compact' : 'talk' }, button, status, live, heardBox);

  let rec = null;
  let transcript = '';
  let errorCode = '';
  let finished = true;
  let timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function show(state, label, message) {
    button.dataset.state = state;
    clear(button).append(MIC(), h('span', {}, label));
    button.setAttribute('aria-label', label);
    status.textContent = message || '';
  }

  function ready(message) {
    heardBox.classList.add('hidden');
    button.classList.remove('hidden');
    live.textContent = '';
    show('ready', 'Tap to talk', message ?? opts.prompt ?? '');
  }

  function start() {
    if (!Rec) return;
    transcript = '';
    errorCode = '';
    finished = false;
    live.textContent = '';
    heardBox.classList.add('hidden');
    try {
      rec = new Rec(); // a fresh one every time: Safari sometimes stalls if reused
      rec.lang = 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onstart = () => show('listening', 'Tap when done', 'Listening… tap the button when you’re done.');
      rec.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        transcript = t.trim();
        live.textContent = transcript;
      };
      rec.onerror = (e) => { errorCode = e.error || 'unknown'; };
      rec.onend = finish;
      rec.start();
    } catch {
      errorCode = 'start-failed';
      finish();
      return;
    }
    show('listening', 'Tap when done', 'Getting ready…');
    later(5000, () => { // never started
      if (!finished && button.dataset.state === 'listening' && status.textContent === 'Getting ready…') {
        errorCode = errorCode || 'start-timeout';
        try { rec.abort(); } catch { /* ignore */ }
        finish();
      }
    });
    later(45000, stop); // nobody talks for 45 seconds straight
  }

  function stop() {
    if (finished || !rec) return;
    show('busy', 'Wait…', 'Thinking about what you said…');
    try { rec.stop(); } catch { /* ignore */ }
    later(6000, () => { // Safari didn't finish: give up cleanly
      if (!finished) {
        try { rec.abort(); } catch { /* ignore */ }
        finish();
      }
    });
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimers();
    rec = null;
    live.textContent = '';
    if (transcript) {
      button.classList.add('hidden');
      status.textContent = '';
      const shown = opts.format ? opts.format(transcript) : transcript;
      clear(heardBox).append(
        h('span', { class: 'muted' }, 'I heard:'),
        h('span', { class: 'said' }, shown),
        h('div', { class: 'row' },
          btn(opts.confirmLabel || 'Use this', () => opts.onConfirm(transcript), 'primary'),
          btn('Say it again', () => { ready(); start(); }, 'quiet'),
        ),
      );
      heardBox.classList.remove('hidden');
      heardBox.querySelector('.btn')?.focus();
      return;
    }
    ready(ERRORS[errorCode] || 'I didn’t hear anything. Tap the button and try again.');
  }

  button.addEventListener('click', () => {
    if (button.dataset.state === 'ready') start();
    else if (button.dataset.state === 'listening') stop();
  });

  if (!Rec) {
    button.classList.add('hidden');
    status.textContent = 'Talking only works when this page is open in Safari. You can use the buttons below instead.';
  } else {
    ready();
  }

  return {
    el,
    reset: () => { if (rec) { try { rec.abort(); } catch { /* ignore */ } } finished = true; clearTimers(); if (Rec) ready(); },
  };
}
