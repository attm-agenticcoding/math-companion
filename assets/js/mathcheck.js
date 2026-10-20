// mathcheck.js — turn what a student says or types into math, and check it
// against the answers prepared for a problem.
//
// Shared by the browser (answer checking), the build (validating authored
// answers) and the tests. No DOM access in this file.
//
// Design rules:
//  * Exact arithmetic (BigInt rationals) — never judge a right answer wrong
//    because of floating point.
//  * If we are not sure what she said, we say so ("unparsed") instead of
//    marking it wrong.

export class MathError extends Error {}

// ---------------------------------------------------------------- rationals
const absBig = (a) => (a < 0n ? -a : a);
function gcdBig(a, b) {
  a = absBig(a);
  b = absBig(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export class Q {
  constructor(n, d = 1n) {
    n = BigInt(n);
    d = BigInt(d);
    if (d === 0n) throw new MathError('division by zero');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcdBig(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  static parse(text) {
    // integer or decimal literal, e.g. "12", "3.25"
    const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!m) throw new MathError(`bad number ${text}`);
    if (!m[2]) return new Q(BigInt(m[1]));
    const scale = 10n ** BigInt(m[2].length);
    return new Q(BigInt(m[1] + m[2]), scale);
  }
  add(o) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Q(this.n * o.n, this.d * o.d); }
  div(o) {
    if (o.n === 0n) throw new MathError('division by zero');
    return new Q(this.n * o.d, this.d * o.n);
  }
  neg() { return new Q(-this.n, this.d); }
  isZero() { return this.n === 0n; }
  isInt() { return this.d === 1n; }
  eq(o) { return this.n === o.n && this.d === o.d; }
  toNumber() { return Number(this.n) / Number(this.d); }
  toString() { return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`; }
}

const ONE = new Q(1n);

// ------------------------------------------------------------- polynomials
// A polynomial is a Map from monomial key ("" for constants, "x^2*y") to
// { c: Q, p: {x: 2, y: 1} }. Zero coefficients are never stored.
function monoKey(p) {
  return Object.keys(p)
    .filter((v) => p[v] !== 0)
    .sort()
    .map((v) => (p[v] === 1 ? v : `${v}^${p[v]}`))
    .join('*');
}

export class Poly {
  constructor(terms = new Map()) { this.terms = terms; }
  static constant(q) {
    const t = new Map();
    if (!q.isZero()) t.set('', { c: q, p: {} });
    return new Poly(t);
  }
  static variable(name) {
    return new Poly(new Map([[name, { c: ONE, p: { [name]: 1 } }]]));
  }
  clone() {
    const t = new Map();
    for (const [k, v] of this.terms) t.set(k, { c: v.c, p: { ...v.p } });
    return new Poly(t);
  }
  addTerm(c, p) {
    const k = monoKey(p);
    const cur = this.terms.get(k);
    const next = cur ? cur.c.add(c) : c;
    if (next.isZero()) this.terms.delete(k);
    else this.terms.set(k, { c: next, p: { ...p } });
  }
  add(o) {
    const r = this.clone();
    for (const v of o.terms.values()) r.addTerm(v.c, v.p);
    return r;
  }
  neg() {
    const r = new Poly();
    for (const v of this.terms.values()) r.addTerm(v.c.neg(), v.p);
    return r;
  }
  sub(o) { return this.add(o.neg()); }
  mul(o) {
    const r = new Poly();
    for (const a of this.terms.values()) {
      for (const b of o.terms.values()) {
        const p = { ...a.p };
        for (const [v, e] of Object.entries(b.p)) p[v] = (p[v] || 0) + e;
        r.addTerm(a.c.mul(b.c), p);
      }
    }
    return r;
  }
  pow(k) {
    let r = Poly.constant(ONE);
    for (let i = 0; i < k; i++) r = r.mul(this);
    return r;
  }
  isConstant() { return [...this.terms.keys()].every((k) => k === ''); }
  constantValue() {
    if (!this.isConstant()) throw new MathError('not a constant');
    const t = this.terms.get('');
    return t ? t.c : new Q(0n);
  }
  divConst(q) {
    const r = new Poly();
    for (const v of this.terms.values()) r.addTerm(v.c.div(q), v.p);
    return r;
  }
  size() { return this.terms.size; }
  equals(o) {
    if (this.terms.size !== o.terms.size) return false;
    for (const [k, v] of this.terms) {
      const w = o.terms.get(k);
      if (!w || !w.c.eq(v.c)) return false;
    }
    return true;
  }
  // Is this polynomial a nonzero constant multiple of o?
  isMultipleOf(o) {
    if (this.terms.size !== o.terms.size || this.terms.size === 0) return false;
    let ratio = null;
    for (const [k, v] of this.terms) {
      const w = o.terms.get(k);
      if (!w) return false;
      const r = v.c.div(w.c);
      if (ratio && !ratio.eq(r)) return false;
      ratio = r;
    }
    return true;
  }
}

// ------------------------------------------------------------ speech → math
const SMALL = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const SCALES = { hundred: 100n, thousand: 1000n, million: 1000000n };
const DENOMS = {
  half: 2, halves: 2, third: 3, thirds: 3, fourth: 4, fourths: 4,
  quarter: 4, quarters: 4, fifth: 5, fifths: 5, sixth: 6, sixths: 6,
  seventh: 7, sevenths: 7, eighth: 8, eighths: 8, ninth: 9, ninths: 9,
  tenth: 10, tenths: 10, eleventh: 11, elevenths: 11, twelfth: 12,
  twelfths: 12, hundredth: 100, hundredths: 100,
};
const ORDINAL_POWERS = {
  second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5,
  '6th': 6, '7th': 7, '8th': 8, '9th': 9, '10th': 10,
};
// Words speech recognition sometimes produces for a spoken variable name.
const VARIABLE_WORDS = { ex: 'x', eggs: 'x', why: 'y', zee: 'z', zed: 'z' };
// Spelled-out letter names. These are also ordinary words ("see", "you",
// "are"), so they only count as a letter when the problem uses that letter.
const LETTER_NAMES = {
  ay: 'a', bee: 'b', be: 'b', see: 'c', sea: 'c', cee: 'c', dee: 'd', ee: 'e',
  eff: 'f', gee: 'g', aitch: 'h', jay: 'j', kay: 'k', el: 'l', em: 'm', en: 'n',
  pee: 'p', pea: 'p', cue: 'q', queue: 'q', are: 'r', ar: 'r', ess: 's', es: 's',
  tee: 't', tea: 't', you: 'u', vee: 'v',
};
const UNIT_WORDS = new Set([
  'dollar', 'dollars', 'cent', 'cents', 'cm', 'centimeter', 'centimeters',
  'meter', 'meters', 'inch', 'inches', 'foot', 'feet', 'yard', 'yards',
  'mile', 'miles', 'degree', 'degrees', 'unit', 'units', 'square', 'cubic',
  'minutes', 'minute', 'hours', 'hour', 'seconds', 'points',
]);
const FILLER = /^(?:(?:um+|uh+|er+|so|well|okay|ok|hmm+)\b[\s,]*)+/;
const LEAD_IN =
  /^(?:i think (?:it'?s|it is|the answer is)?|i got|i get|i have|my answer is|the answer is|answer is|answer|it'?s|it is|is it|that'?s|that is)\b\s*/;

function isNumberWord(w) {
  return w in SMALL || w in TENS || w in SCALES || w === 'a';
}

// Parse a run of number words starting at i. Returns {value, next} or null.
function readNumberWords(words, i) {
  let total = 0n;
  let current = 0n;
  let used = false;
  let j = i;
  while (j < words.length) {
    const w = words[j];
    if (w in SMALL) { current += BigInt(SMALL[w]); used = true; j++; continue; }
    if (w in TENS) { current += BigInt(TENS[w]); used = true; j++; continue; }
    if (/^\d+$/.test(w) && used && current % 100n === 0n && current > 0n) {
      // "one hundred 5" style mixtures
      current += BigInt(w); j++; continue;
    }
    if (w in SCALES) {
      if (!used) { current = 1n; used = true; }
      if (SCALES[w] === 100n) current *= 100n;
      else { total += current * SCALES[w]; current = 0n; }
      j++;
      continue;
    }
    if (w === 'a' && !used && words[j + 1] in SCALES) { j++; continue; }
    if (w === 'and' && used && j + 1 < words.length &&
        (words[j + 1] in SMALL || words[j + 1] in TENS) &&
        !(words[j + 2] in DENOMS)) {
      // "one hundred and five" (but not "two and three fourths")
      j++;
      continue;
    }
    break;
  }
  if (!used) return null;
  return { value: total + current, next: j };
}

// Convert recognized speech (or typed text) into a math string the parser
// understands, e.g. "the answer is eight x" -> "8 x".
export function speechToMath(input, variables = '') {
  let s = String(input || '').toLowerCase();
  s = s
    .replace(/[−–—]/g, '-')
    .replace(/×/g, ' * ')
    .replace(/÷/g, ' / ')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[“”"?!;:]/g, ' ')
    .replace(/(\d)\.(?!\d)/g, '$1 ')
    .replace(/\.(\s|$)/g, ' ')
    .trim();
  let prev;
  do {
    prev = s;
    s = s.replace(FILLER, '').replace(LEAD_IN, '').trim();
  } while (s !== prev);

  const words = s.match(/\d+(?:\.\d+)?(?:st|nd|rd|th)?|[a-z]+'?[a-z]*|[+\-*/^=()]/g) || [];
  const out = [];
  let i = 0;
  const peek = (k = 0) => words[i + k];

  const pushNumber = (n) => out.push(String(n));
  const readNumberAt = () => {
    // digits or number words at i; returns string or null and advances i
    const w = peek();
    if (w !== undefined && /^\d+(?:\.\d+)?$/.test(w)) { i++; return w; }
    const r = readNumberWords(words, i);
    if (r) {
      i = r.next;
      // decimals: "three point five"
      if (peek() === 'point') {
        let digits = '';
        let k = i + 1;
        while (k < words.length && (words[k] in SMALL) && SMALL[words[k]] < 10) {
          digits += String(SMALL[words[k]]);
          k++;
        }
        if (digits) { i = k; return `${r.value}.${digits}`; }
      }
      return String(r.value);
    }
    return null;
  };

  while (i < words.length) {
    const w = peek();

    // exponents: "to the power of 3", "to the 3rd power", "to the fifth"
    if (w === 'to' && peek(1) === 'the') {
      if (peek(2) === 'power' && peek(3) === 'of') {
        i += 4;
        const n = readNumberAt();
        if (n) { out.push('^', n); continue; }
      }
      const ord = ORDINAL_POWERS[peek(2)];
      if (ord) {
        i += 3;
        if (peek() === 'power') i++;
        out.push('^', String(ord));
        continue;
      }
      i += 2;
      const n = readNumberAt();
      if (n) {
        if (peek() === 'power') i++;
        out.push('^', n);
        continue;
      }
      continue;
    }
    if (w === 'raised' && peek(1) === 'to') {
      i += 2;
      if (peek() === 'the') i++;
      const ord = ORDINAL_POWERS[peek()];
      if (ord) { i++; out.push('^', String(ord)); if (peek() === 'power') i++; continue; }
      const n = readNumberAt();
      if (n) { out.push('^', n); if (peek() === 'power') i++; }
      continue;
    }
    if (w === 'squared') { out.push('^', '2'); i++; continue; }
    if (w === 'cubed') { out.push('^', '3'); i++; continue; }

    // numbers (digits or words), fractions and mixed numbers
    if (/^\d+(?:\.\d+)?$/.test(w) || (isNumberWord(w) && (w !== 'a' || peek(1) in DENOMS || peek(1) in SCALES))) {
      let num;
      if (w === 'a' && peek(1) in DENOMS) {
        num = '1';
        i++;
      } else {
        num = readNumberAt();
        if (num === null) { out.push(w); i++; continue; }
      }
      // "three fourths", "one half"
      if (peek() in DENOMS) {
        out.push(num, '/', String(DENOMS[peek()]));
        i++;
        continue;
      }
      // "two and a half", "three and three fourths"
      if (peek() === 'and') {
        const save = i;
        i++;
        let n2 = null;
        if (peek() === 'a' && peek(1) in DENOMS) { n2 = '1'; i++; }
        else n2 = readNumberAt();
        if (n2 !== null && peek() in DENOMS) {
          out.push('(', num, '+', n2, '/', String(DENOMS[peek()]), ')');
          i++;
          continue;
        }
        i = save;
      }
      pushNumber(num);
      continue;
    }

    // operators and words for operators
    if (w === 'plus' || w === 'add' || w === '+') { out.push('+'); i++; continue; }
    if (w === 'and') { out.push('+'); i++; continue; }
    if (w === 'minus' || w === 'negative' || w === '-' || w === 'subtract') { out.push('-'); i++; continue; }
    if (w === 'take' && peek(1) === 'away') { out.push('-'); i += 2; continue; }
    if (w === 'times' || w === '*') { out.push('*'); i++; continue; }
    if (w === 'multiplied' && peek(1) === 'by') { out.push('*'); i += 2; continue; }
    if (w === 'divided' && peek(1) === 'by') { out.push('/'); i += 2; continue; }
    if (w === 'over' || w === '/') { out.push('/'); i++; continue; }
    if (w === 'equals' || w === 'equal' || w === '=') {
      out.push('=');
      i++;
      if (peek() === 'to') i++;
      continue;
    }
    if (w === 'is' && peek(1) === 'equal' && peek(2) === 'to') { out.push('='); i += 3; continue; }
    if (w === 'is' && out.length > 0) { out.push('='); i++; continue; }
    if (w === '^' || w === '(' || w === ')') { out.push(w); i++; continue; }

    if (w in VARIABLE_WORDS) { out.push(VARIABLE_WORDS[w]); i++; continue; }
    if (w in LETTER_NAMES && variables.includes(LETTER_NAMES[w])) { out.push(LETTER_NAMES[w]); i++; continue; }
    if (w === 'double' && (peek(1) === 'you' || peek(1) === 'u') && variables.includes('w')) { out.push('w'); i += 2; continue; }
    if (UNIT_WORDS.has(w)) { i++; continue; }
    if (w === 'the' || w === 'of' || w === 'um' || w === 'uh') { i++; continue; }

    out.push(w);
    i++;
  }

  // "3 x 4" spoken as "three times four" sometimes comes back as "3 x 4"
  for (let k = 1; k + 1 < out.length; k++) {
    if (out[k] === 'x' && /^\d/.test(out[k - 1]) && /^\d/.test(out[k + 1])) out[k] = '*';
  }
  while (out[0] === '=' ) out.shift();
  return out.join(' ').trim();
}

// --------------------------------------------------------------- tokenizer
const DEFAULT_VARIABLES = 'abcdkmnpqrstuvwxyz';

function tokenize(src, variables = DEFAULT_VARIABLES) {
  const toks = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([a-z]+)|([+\-*/^=()]))/gy;
  let m;
  let pos = 0;
  const s = src.trim();
  re.lastIndex = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    m = re.exec(s);
    if (!m) throw new MathError(`unexpected "${s.slice(pos, pos + 8)}"`);
    pos = re.lastIndex;
    if (m[1]) toks.push({ t: 'num', v: m[1] });
    else if (m[2]) {
      const word = m[2];
      if (word.length > 3 || [...word].some((ch) => !variables.includes(ch))) {
        throw new MathError(`word "${word}"`);
      }
      for (const ch of word) toks.push({ t: 'var', v: ch });
    } else toks.push({ t: 'op', v: m[3] });
    if (/^\s*$/.test(s.slice(pos))) break;
  }
  return toks;
}

// ------------------------------------------------------------------ parser
// AST nodes: num {q, raw}, var {name}, neg {a}, add/sub/mul/div/pow {a, b},
// eq {a, b}. mul has `implicit` when written without a sign (8x).
export function parseMath(src, variables) {
  const toks = tokenize(src, variables);
  if (toks.length === 0) throw new MathError('empty');
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;

  function equation() {
    const a = expr();
    if (isOp('=')) {
      take();
      const b = expr();
      if (isOp('=')) throw new MathError('two equals signs');
      return { t: 'eq', a, b };
    }
    return a;
  }
  function expr() {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = take().v;
      const b = term();
      a = { t: op === '+' ? 'add' : 'sub', a, b };
    }
    return a;
  }
  function startsPrimary(tok) {
    return tok && (tok.t === 'var' || (tok.t === 'op' && tok.v === '('));
  }
  function term() {
    let a = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = take().v;
        const b = unary();
        a = { t: op === '*' ? 'mul' : 'div', a, b };
      } else if (startsPrimary(peek())) {
        const b = power();
        a = { t: 'mul', a, b, implicit: true };
      } else if (peek() && peek().t === 'num') {
        throw new MathError('number after a term');
      } else break;
    }
    return a;
  }
  function unary() {
    if (isOp('-')) { take(); return { t: 'neg', a: unary() }; }
    if (isOp('+')) { take(); return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (isOp('^')) {
      take();
      const exp = unary();
      return { t: 'pow', a: base, b: exp };
    }
    return base;
  }
  function primary() {
    const tok = take();
    if (!tok) throw new MathError('incomplete');
    if (tok.t === 'num') return { t: 'num', q: Q.parse(tok.v), raw: tok.v };
    if (tok.t === 'var') return { t: 'var', name: tok.v };
    if (tok.v === '(') {
      const e = expr();
      if (!isOp(')')) throw new MathError('missing )');
      take();
      return { t: 'paren', a: e };
    }
    throw new MathError(`unexpected ${tok.v}`);
  }
  const ast = equation();
  if (i < toks.length) throw new MathError(`unexpected ${toks[i].v}`);
  return ast;
}

// --------------------------------------------------------------- evaluation
class NotPolynomial extends Error {}

export function toPoly(ast) {
  switch (ast.t) {
    case 'num': return Poly.constant(ast.q);
    case 'var': return Poly.variable(ast.name);
    case 'paren': return toPoly(ast.a);
    case 'neg': return toPoly(ast.a).neg();
    case 'add': return toPoly(ast.a).add(toPoly(ast.b));
    case 'sub': return toPoly(ast.a).sub(toPoly(ast.b));
    case 'mul': return toPoly(ast.a).mul(toPoly(ast.b));
    case 'div': {
      const d = toPoly(ast.b);
      if (!d.isConstant()) throw new NotPolynomial();
      return toPoly(ast.a).divConst(d.constantValue());
    }
    case 'pow': {
      const e = toPoly(ast.b);
      if (!e.isConstant()) throw new NotPolynomial();
      const k = e.constantValue();
      if (!k.isInt() || k.n < 0n || k.n > 12n) throw new NotPolynomial();
      return toPoly(ast.a).pow(Number(k.n));
    }
    default: throw new MathError(`cannot evaluate ${ast.t}`);
  }
}

function evalNumeric(ast, env) {
  switch (ast.t) {
    case 'num': return ast.q.toNumber();
    case 'var': return env[ast.name] ?? 1.618;
    case 'paren': return evalNumeric(ast.a, env);
    case 'neg': return -evalNumeric(ast.a, env);
    case 'add': return evalNumeric(ast.a, env) + evalNumeric(ast.b, env);
    case 'sub': return evalNumeric(ast.a, env) - evalNumeric(ast.b, env);
    case 'mul': return evalNumeric(ast.a, env) * evalNumeric(ast.b, env);
    case 'div': return evalNumeric(ast.a, env) / evalNumeric(ast.b, env);
    case 'pow': return evalNumeric(ast.a, env) ** evalNumeric(ast.b, env);
    default: throw new MathError(`cannot evaluate ${ast.t}`);
  }
}

function variablesIn(ast, set = new Set()) {
  if (!ast) return set;
  if (ast.t === 'var') set.add(ast.name);
  for (const k of ['a', 'b']) if (ast[k]) variablesIn(ast[k], set);
  return set;
}

// Are two expressions equal for every value of the variables?
export function equivalent(astA, astB) {
  try {
    return toPoly(astA).equals(toPoly(astB));
  } catch (e) {
    if (!(e instanceof NotPolynomial)) throw e;
  }
  const vars = new Set([...variablesIn(astA), ...variablesIn(astB)]);
  const samples = [1.37, 2.71, -0.83, 5.19];
  for (let k = 0; k < 3; k++) {
    const env = {};
    [...vars].forEach((v, idx) => { env[v] = samples[(idx + k) % samples.length] + idx * 0.11; });
    const x = evalNumeric(astA, env);
    const y = evalNumeric(astB, env);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (Math.abs(x - y) > 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))) return false;
  }
  return true;
}

// A number she might write as an answer: 12, -12, 3/4, -3/4, 2 1/2 (as 2+1/2)
function plainNumberValue(ast) {
  const lit = (n) => n.t === 'num';
  if (lit(ast)) return { q: ast.q, fraction: null };
  if (ast.t === 'neg') {
    const r = plainNumberValue(ast.a);
    return r && { q: r.q.neg(), fraction: r.fraction };
  }
  if (ast.t === 'div' && lit(ast.a) && lit(ast.b) && ast.a.q.isInt() && ast.b.q.isInt()) {
    if (ast.b.q.isZero()) return null;
    return { q: ast.a.q.div(ast.b.q), fraction: [ast.a.q.n, ast.b.q.n] };
  }
  if (ast.t === 'paren' && ast.a.t === 'add' && lit(ast.a.a) && ast.a.a.q.isInt()) {
    const f = plainNumberValue(ast.a.b);
    if (f && f.fraction) return { q: ast.a.a.q.add(f.q), fraction: f.fraction, mixed: true };
  }
  return null;
}

// Is the expression written as a sum of distinct, simplified monomials?
function isMonomial(ast) {
  switch (ast.t) {
    case 'num': return true;
    case 'var': return true;
    case 'pow': return ast.a.t === 'var' && ast.b.t === 'num' && ast.b.q.isInt();
    case 'mul': return isMonomial(ast.a) && isMonomial(ast.b) && !(ast.a.t === 'num' && ast.b.t === 'num');
    case 'div': return ast.a.t === 'num' && ast.b.t === 'num';
    case 'neg': return isMonomial(ast.a);
    default: return false;
  }
}
function topTerms(ast, out = []) {
  if (ast.t === 'add' || ast.t === 'sub') {
    topTerms(ast.a, out);
    topTerms(ast.b, out);
  } else out.push(ast);
  return out;
}
export function isStandardForm(ast) {
  const terms = topTerms(ast);
  if (!terms.every(isMonomial)) return false;
  let poly;
  try { poly = toPoly(ast); } catch { return false; }
  // everything cancels: only a plain 0 is fully simplified
  if (poly.size() === 0) return terms.length === 1 && terms[0].t === 'num';
  const nonzero = terms.filter((t) => {
    try { return toPoly(t).size() > 0; } catch { return true; }
  });
  return nonzero.length === poly.size() && nonzero.length === terms.length;
}

// ------------------------------------------------------------- formatting
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export function formatMath(ast) {
  const f = (n, parentPrec = 0) => {
    let s;
    let prec;
    switch (n.t) {
      case 'num': s = n.raw ?? n.q.toString(); prec = 9; break;
      case 'var': s = n.name; prec = 9; break;
      case 'paren': s = `(${f(n.a)})`; prec = 9; break;
      case 'neg': s = `−${f(n.a, 6)}`; prec = 6; break;
      case 'add': s = `${f(n.a, 1)} + ${f(n.b, 2)}`; prec = 1; break;
      case 'sub': s = `${f(n.a, 1)} − ${f(n.b, 2)}`; prec = 1; break;
      case 'mul':
        s = n.implicit ? `${f(n.a, 3)}${f(n.b, 4)}` : `${f(n.a, 3)} × ${f(n.b, 4)}`;
        prec = 3;
        break;
      case 'div': s = `${f(n.a, 3)}/${f(n.b, 4)}`; prec = 3; break;
      case 'pow': {
        const e = n.b.t === 'num' && /^\d+$/.test(n.b.raw ?? '')
          ? [...n.b.raw].map((d) => SUP[d]).join('')
          : `^${f(n.b, 9)}`;
        s = `${f(n.a, 8)}${e}`;
        prec = 7;
        break;
      }
      case 'eq': s = `${f(n.a)} = ${f(n.b)}`; prec = 0; break;
      default: s = '?'; prec = 9;
    }
    return prec < parentPrec ? `(${s})` : s;
  };
  return f(ast);
}

// -------------------------------------------------------------- checking
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

function parseInput(text, spec) {
  const math = speechToMath(text, spec.variables || '');
  if (!math) return { error: 'empty' };
  try {
    return { ast: parseMath(math, spec.variables), math };
  } catch (e) {
    if (e instanceof MathError) return { error: 'unparsed', math };
    throw e;
  }
}

// For "solve" problems she may say "x equals 7": keep just the value side.
function valueSide(ast) {
  if (ast.t !== 'eq') return ast;
  if (ast.a.t === 'var') return ast.b;
  if (ast.b.t === 'var') return ast.a;
  // "ten times three is thirty": the number at the end is her answer
  if (plainNumberValue(ast.b)) return ast.b;
  return ast;
}

function compareNumber(ast, answerText, spec) {
  const a = parseMath(speechToMath(answerText, spec.variables || ''), spec.variables);
  const want = toPoly(valueSide(a)).constantValue();
  const got = plainNumberValue(valueSide(ast));
  if (!got) return 'not-a-number';
  if (!got.q.eq(want)) return 'different';
  if (spec.simplify && got.fraction) {
    const [n, d] = got.fraction;
    if (gcdBig(n, d) !== 1n) return 'not-simplified';
  }
  return 'same';
}

function compareExpression(ast, answerText, spec) {
  const a = parseMath(speechToMath(answerText, spec.variables || ''), spec.variables);
  if (a.t === 'eq' || ast.t === 'eq') {
    if (!(a.t === 'eq' && ast.t === 'eq')) return 'different';
    const pa = toPoly(a.a).sub(toPoly(a.b));
    const pb = toPoly(ast.a).sub(toPoly(ast.b));
    return pb.isMultipleOf(pa) ? 'same' : 'different';
  }
  if (!equivalent(ast, a)) return 'different';
  if (spec.simplify && !isStandardForm(ast)) return 'not-simplified';
  return 'same';
}

function compareWords(text, answerText) {
  const t = ` ${norm(text)} `;
  const a = norm(answerText);
  return a && t.includes(` ${a} `) ? 'same' : 'different';
}

/** The word answer (spec.phrases) she gave, if any. */
export function matchPhrase(text, spec) {
  const said = ` ${norm(text)} `;
  return (spec?.phrases || []).find((ph) => (ph.say || []).some((w) => norm(w) && said.includes(` ${norm(w)} `))) || null;
}

/**
 * Check a spoken or typed answer.
 * spec = { kind: 'number'|'expression'|'equation'|'choice'|'text',
 *          answers: [...], simplify?: bool, wrong?: [{answer, feedback}],
 *          variables?: 'xy',
 *          phrases?: [{say: ["can't be simplified", ...], button?, correct?, feedback?}] }
 * Returns { status, heard, feedback? } where status is one of
 *   'correct' | 'not-simplified' | 'known-wrong' | 'wrong' |
 *   'need-number' | 'unparsed' | 'empty'
 */
export function checkAnswer(text, spec) {
  const kind = spec.kind || 'number';
  if (!String(text || '').trim()) return { status: 'empty', heard: '' };

  // Answers in words, e.g. "it can't be simplified".
  const ph = matchPhrase(text, spec);
  if (ph) {
    const heard = ph.button || ph.say[0];
    if (ph.correct) return { status: 'correct', heard };
    return ph.feedback ? { status: 'known-wrong', heard, feedback: ph.feedback } : { status: 'wrong', heard };
  }

  if (kind === 'choice' || kind === 'text') {
    const heard = norm(text);
    const cmp = (ans) => {
      if (kind === 'choice') {
        const letter = /^(?:option |choice |letter )?([a-e])$/.exec(heard);
        if (letter && norm(ans) === letter[1]) return 'same';
      }
      return compareWords(text, ans);
    };
    const right = (spec.answers || []).some((ans) => cmp(ans) === 'same');
    const knownWrong = (spec.wrong || []).find((w) => cmp(w.answer) === 'same');
    // "left or right" mentions both: don't guess which one she meant.
    if (right && knownWrong) return { status: 'unparsed', heard };
    if (right) return { status: 'correct', heard };
    if (knownWrong) return { status: 'known-wrong', heard, feedback: knownWrong.feedback };
    return { status: 'wrong', heard };
  }

  const parsed = parseInput(text, spec);
  if (parsed.error) return { status: parsed.error, heard: parsed.math || '' };
  const { ast } = parsed;
  const heard = formatMath(ast);
  const compare = kind === 'number' ? compareNumber : compareExpression;

  const results = (spec.answers || []).map((ans) => {
    try { return compare(ast, ans, spec); } catch { return 'different'; }
  });
  if (results.includes('same')) return { status: 'correct', heard };
  if (results.includes('not-simplified')) return { status: 'not-simplified', heard };
  if (kind === 'number' && results.every((r) => r === 'not-a-number')) {
    return { status: 'need-number', heard };
  }
  for (const w of spec.wrong || []) {
    let r;
    try { r = compare(ast, w.answer, spec); } catch { r = 'different'; }
    if (r === 'same' || r === 'not-simplified') return { status: 'known-wrong', heard, feedback: w.feedback };
  }
  return { status: 'wrong', heard };
}

// Used by the build: make sure every authored answer can be read back, and
// that no "wrong answer" is secretly equal to a right one.
export function validateAnswerSpec(spec) {
  const problems = [];
  const kind = spec.kind || 'number';
  if (kind === 'choice' || kind === 'text') return problems;
  for (const ans of spec.answers || []) {
    try {
      const ast = parseMath(speechToMath(ans, spec.variables || ''), spec.variables);
      if (kind === 'number') toPoly(valueSide(ast)).constantValue();
      const self = checkAnswer(ans, { ...spec, wrong: [] });
      if (self.status !== 'correct') problems.push(`answer "${ans}" does not check as correct (${self.status})`);
    } catch (e) {
      problems.push(`answer "${ans}" cannot be read: ${e.message}`);
    }
  }
  for (const w of spec.wrong || []) {
    const r = checkAnswer(w.answer, { ...spec, wrong: [] });
    if (r.status === 'correct') problems.push(`wrong answer "${w.answer}" is actually accepted as correct`);
    if (r.status === 'unparsed' || r.status === 'empty') problems.push(`wrong answer "${w.answer}" cannot be read`);
  }
  return problems;
}
