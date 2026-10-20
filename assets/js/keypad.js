// On-screen keypads (no system keyboard): one for math answers, one for the passcode.
import { h, clear, pretty } from './ui.js';

/**
 * kind: 'number' | 'expression' | 'equation'
 * variables: e.g. 'x' or 'xy'
 */
export function createKeypad({ kind = 'number', variables = 'x', onSubmit, submitLabel = 'Check it' }) {
  let value = '';
  const display = h('div', { class: 'pad-display empty', role: 'status', 'aria-live': 'polite' });
  const pad = h('div', { class: 'pad' });
  const el = h('div', { class: 'keypad' }, display, pad);

  const render = () => {
    display.textContent = value ? pretty(value.replace(/\*/g, '×')) : 'Tap the keys to type your answer';
    display.classList.toggle('empty', !value);
  };
  const key = (label, insert, cls = '', aria) =>
    h('button', {
      type: 'button', class: cls, 'aria-label': aria || label,
      onclick: () => { value += insert; render(); },
    }, label);

  const keys = [
    key('7', '7'), key('8', '8'), key('9', '9'), key('⌫', '', 'op', 'Delete'),
    key('4', '4'), key('5', '5'), key('6', '6'), key('−', '-', 'op', 'Minus or negative'),
    key('1', '1'), key('2', '2'), key('3', '3'), key('/', '/', 'op', 'Fraction bar'),
    key('0', '0'), key('.', '.', 'op', 'Point'),
  ];
  keys[3].onclick = () => { value = value.slice(0, -1); render(); };
  if (kind !== 'number') {
    keys.push(key('+', '+', 'op', 'Plus'), key('×', '*', 'op', 'Times'));
    for (const v of (variables || 'x').split('')) keys.push(key(v, v, 'op'));
    keys.push(key('(', '(', 'op'), key(')', ')', 'op'), key('^', '^', 'op', 'To the power'));
  }
  if (kind === 'equation') keys.push(key('=', '=', 'op', 'Equals'));
  keys.push(h('button', {
    type: 'button', class: 'go',
    onclick: () => { if (value) onSubmit(value); },
  }, submitLabel));
  pad.append(...keys);
  render();
  return { el, clear: () => { value = ''; render(); } };
}

/** Number-only passcode pad. onSubmit(code) may return a promise. */
export function createPasscodePad({ onSubmit, minLength = 8 }) {
  let code = '';
  const dots = h('div', { class: 'dots', 'aria-hidden': 'true' });
  const msg = h('p', { class: 'muted', 'aria-live': 'polite' }, 'Type the passcode Dad gave you.');
  const pad = h('div', { class: 'pad' });
  const el = h('div', {}, msg, dots, pad);
  let busy = false;

  const render = () => {
    clear(dots);
    for (let i = 0; i < code.length; i++) dots.append(h('span'));
  };
  const press = (d) => () => { if (!busy && code.length < 32) { code += d; render(); } };
  for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) pad.append(h('button', { type: 'button', onclick: press(d) }, d));
  pad.append(
    h('button', { type: 'button', class: 'op', 'aria-label': 'Delete', onclick: () => { code = code.slice(0, -1); render(); } }, '⌫'),
    h('button', { type: 'button', onclick: press('0') }, '0'),
  );
  const go = h('button', {
    type: 'button', class: 'go',
    onclick: async () => {
      if (busy) return;
      if (code.length < minLength) { msg.textContent = `The passcode has at least ${minLength} numbers.`; return; }
      busy = true;
      msg.textContent = 'Checking…';
      const ok = await onSubmit(code);
      busy = false;
      if (!ok) {
        code = '';
        render();
        msg.textContent = 'That passcode didn’t work. Try again.';
      }
    },
  }, 'Unlock');
  // 4 columns: put the digits in the first three, controls on the right
  pad.style.gridTemplateColumns = 'repeat(3, 1fr)';
  go.style.gridColumn = 'span 1';
  pad.append(go);
  render();
  return { el };
}
