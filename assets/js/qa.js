// Matches a question the student said out loud against the questions written ahead
// of time for a lesson. Word-based (TF-IDF over words and word pairs, with a
// small synonym list), runs instantly on the iPad, and never invents an answer:
// it either finds a written answer, offers the closest few to choose from, or
// says it has none.

const STOP = new Set(`a an the is are am was were be been i im i'm you your it its it's this that these those
do does did doing to of in on at for with and or so if then than just really very can could would should will
me my we our they them he she there here what whats what's how hows why whys which who when where please
um uh like okay ok hey hi mean means get got gets go goes going know thing things one ones about`.split(/\s+/));

const NUMBER_WORDS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
  nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
  sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
};

// Words a 10-year-old might use -> one shared form.
const SYNONYMS = {
  minus: 'subtract', subtraction: 'subtract', subtracting: 'subtract', subtracted: 'subtract', takeaway: 'subtract',
  plus: 'add', adding: 'add', added: 'add', addition: 'add', sum: 'add', total: 'add',
  times: 'multiply', multiplying: 'multiply', multiplication: 'multiply', product: 'multiply',
  divide: 'divide', dividing: 'divide', division: 'divide', quotient: 'divide',
  bigger: 'greater', larger: 'greater', more: 'greater', higher: 'greater', biggest: 'greater', largest: 'greater',
  smaller: 'less', lower: 'less', fewer: 'less', smallest: 'less', least: 'less',
  negatives: 'negative', neg: 'negative',
  positives: 'positive',
  opposites: 'opposite',
  wrong: 'mistake', incorrect: 'mistake', mistakes: 'mistake',
  confused: 'confuse', confusing: 'confuse', understand: 'confuse',
  answer: 'answer', answers: 'answer',
  backwards: 'left', backward: 'left',
  forwards: 'right', forward: 'right',
  mic: 'microphone', microphone: 'microphone', talk: 'microphone', speak: 'microphone',
  video: 'video', movie: 'video',
  hint: 'hint', hints: 'hint', help: 'hint', stuck: 'hint',
};

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[−–—]/g, ' negative ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  const isNum = (x) => x !== undefined && (/^\d+$/.test(x) || NUMBER_WORDS[x] !== undefined);
  for (let i = 0; i < words.length; i++) {
    let w = words[i].replace(/'s$/, '').replace(/'/g, '');
    // "minus 2" with no number before it means "negative 2"
    if (w === 'minus' && isNum(words[i + 1]) && !isNum(words[i - 1])) w = 'negative';
    if (NUMBER_WORDS[w]) w = NUMBER_WORDS[w];
    if (STOP.has(w)) continue;
    w = SYNONYMS[w] || stem(w);
    w = SYNONYMS[w] || w;
    out.push(w);
  }
  return out;
}

function features(text) {
  const toks = tokenize(text);
  const f = new Map();
  for (const t of toks) f.set(t, (f.get(t) || 0) + 1);
  for (let i = 0; i + 1 < toks.length; i++) {
    const bg = `${toks[i]}_${toks[i + 1]}`;
    f.set(bg, (f.get(bg) || 0) + 1);
  }
  return f;
}

/**
 * entries: [{ id, q: [phrasings...], keywords?: [...], a: answer }]
 * Returns a matcher with .match(text) -> { status, best, choices }
 *   status 'answer'  -> best is confident
 *   status 'choose'  -> show `choices` (closest few) and let her pick
 *   status 'none'    -> nothing close enough
 */
export function buildMatcher(entries, opts = {}) {
  const confident = opts.confident ?? 0.42;
  const minShow = opts.minShow ?? 0.12;
  const docs = [];
  for (const e of entries) {
    const phr = [...(e.q || [])];
    if (e.keywords?.length) phr.push(e.keywords.join(' '));
    for (const p of phr) docs.push({ entry: e, f: features(p) });
  }
  const df = new Map();
  for (const d of docs) for (const k of d.f.keys()) df.set(k, (df.get(k) || 0) + 1);
  const N = docs.length || 1;
  const idf = (k) => Math.log(1 + N / (df.get(k) || 0.5));
  const weigh = (f) => {
    const v = new Map();
    let norm = 0;
    for (const [k, c] of f) {
      const w = (1 + Math.log(c)) * idf(k) * (k.includes('_') ? 0.6 : 1);
      v.set(k, w);
      norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) || 1 };
  };
  for (const d of docs) Object.assign(d, weigh(d.f));

  function scoreAll(text) {
    const q = weigh(features(text));
    const byEntry = new Map();
    for (const d of docs) {
      let dot = 0;
      for (const [k, w] of q.v) {
        const dw = d.v.get(k);
        if (dw) dot += w * dw;
      }
      const s = dot / (q.norm * d.norm);
      if (s > (byEntry.get(d.entry) ?? 0)) byEntry.set(d.entry, s);
    }
    return [...byEntry.entries()]
      .map(([entry, score]) => ({ entry, score }))
      .sort((a, b) => b.score - a.score);
  }

  function match(text) {
    if (!tokenize(text).length) return { status: 'none', best: null, choices: [] };
    const ranked = scoreAll(text);
    const top = ranked[0];
    const second = ranked[1];
    const choices = ranked.filter((r) => r.score >= minShow).slice(0, 3);
    const clearWinner = top && top.score >= 0.3 && (!second || second.score * 2 <= top.score);
    if (top && ((top.score >= confident && (!second || second.score < top.score * 0.8)) || clearWinner)) {
      return { status: 'answer', best: top, choices };
    }
    if (choices.length) return { status: 'choose', best: null, choices };
    return { status: 'none', best: null, choices: [] };
  }

  return { match, scoreAll };
}
