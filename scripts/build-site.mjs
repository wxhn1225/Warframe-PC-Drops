import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseCsvLine(line) {
  // very small CSV: code,native name,english name (no quoted commas in current file)
  return line.split(',').map((s) => s.trim());
}

async function readLanguagesCsv(repoRoot) {
  const csvPath = path.join(
    repoRoot,
    'warframe-public-export-plus',
    'supplementals',
    'languages.csv',
  );
  const csv = await fs.readFile(csvPath, 'utf8');
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0] ?? '');
  const codeIdx = header.indexOf('code');
  const nativeIdx = header.indexOf('native name');
  const englishIdx = header.indexOf('english name');
  if (codeIdx === -1) throw new Error(`languages.csv missing 'code' column: ${csvPath}`);

  const langs = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const code = cols[codeIdx];
    if (!code) continue;
    langs.push({
      code,
      nativeName: nativeIdx >= 0 ? cols[nativeIdx] : code,
      englishName: englishIdx >= 0 ? cols[englishIdx] : code,
    });
  }
  return langs;
}

class AhoCorasick {
  constructor(patterns) {
    this.patterns = patterns;
    /** @type {{next: Record<string, number>, link: number, out: number[]}[]} */
    this.nodes = [{ next: Object.create(null), link: 0, out: [] }];

    for (let i = 0; i < patterns.length; i++) this.#add(patterns[i], i);
    this.#buildLinks();
  }

  #add(pat, idx) {
    let v = 0;
    for (let i = 0; i < pat.length; i++) {
      const ch = pat[i];
      const nxt = this.nodes[v].next[ch];
      if (nxt === undefined) {
        const nn = this.nodes.length;
        this.nodes.push({ next: Object.create(null), link: 0, out: [] });
        this.nodes[v].next[ch] = nn;
        v = nn;
      } else {
        v = nxt;
      }
    }
    this.nodes[v].out.push(idx);
  }

  #buildLinks() {
    const q = [];
    // init depth-1 links
    for (const ch of Object.keys(this.nodes[0].next)) {
      const v = this.nodes[0].next[ch];
      this.nodes[v].link = 0;
      q.push(v);
    }

    while (q.length) {
      const v = q.shift();
      const next = this.nodes[v].next;
      for (const ch of Object.keys(next)) {
        const u = next[ch];
        q.push(u);

        let j = this.nodes[v].link;
        while (j !== 0 && this.nodes[j].next[ch] === undefined) j = this.nodes[j].link;
        const link = this.nodes[j].next[ch] ?? 0;
        this.nodes[u].link = link;
        if (this.nodes[link].out.length) this.nodes[u].out.push(...this.nodes[link].out);
      }
    }
  }

  /**
   * Finds all matches as best (longest) match starting at each position.
   * Returns arrays bestLenAtStart and bestPatIdxAtStart.
   */
  scanForBestStarts(text) {
    const bestLen = new Array(text.length).fill(0);
    const bestPat = new Array(text.length).fill(-1);

    let v = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      while (v !== 0 && this.nodes[v].next[ch] === undefined) v = this.nodes[v].link;
      v = this.nodes[v].next[ch] ?? 0;

      const outs = this.nodes[v].out;
      if (!outs.length) continue;
      for (let k = 0; k < outs.length; k++) {
        const patIdx = outs[k];
        const len = this.patterns[patIdx].length;
        const start = i - len + 1;
        if (start < 0) continue;
        if (len > bestLen[start]) {
          bestLen[start] = len;
          bestPat[start] = patIdx;
        }
      }
    }

    return { bestLen, bestPat };
  }
}

function isUsefulPattern(s) {
  if (typeof s !== 'string') return false;
  if (!s) return false;
  if (s.length < 2) return false;
  if (s.length > 80) return false; // skip long descriptions; drops page mostly uses short names
  if (s.includes('\r') || s.includes('\n')) return false;
  // Must contain a letter (Unicode)
  if (!/\p{L}/u.test(s)) return false;
  // Avoid single-letter / pure roman numerals etc.
  if (/^[A-Z]$/.test(s)) return false;
  if (/^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/.test(s)) return false;
  return true;
}

function replaceWithAutomaton(text, ac, getReplacement) {
  const { bestLen, bestPat } = ac.scanForBestStarts(text);
  let out = '';
  for (let i = 0; i < text.length; ) {
    const len = bestLen[i];
    if (len > 0) {
      const pat = ac.patterns[bestPat[i]];
      // Prevent partial replacements inside larger ASCII words
      if (/^[A-Za-z]+$/.test(pat)) {
        const before = i > 0 ? text[i - 1] : '';
        const after = i + len < text.length ? text[i + len] : '';
        if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) {
          out += text[i];
          i += 1;
          continue;
        }
      }
      const rep = getReplacement(pat);
      if (typeof rep === 'string' && rep.length) {
        out += rep;
        i += len;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

function transformHtmlTextOnly(html, transformText, opts) {
  const allowedTags = opts?.allowedTags ?? new Set(['th', 'td', 'a', 'h3', 'b']);

  let i = 0;
  let out = '';
  /** @type {string[]} */
  const stack = [];

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      const tail = html.slice(i);
      out += stack.some((t) => allowedTags.has(t)) ? transformText(tail) : tail;
      break;
    }

    // text before tag
    if (lt > i) {
      const text = html.slice(i, lt);
      out += stack.some((t) => allowedTags.has(t)) ? transformText(text) : text;
    }

    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) {
      // malformed, append rest
      out += html.slice(lt);
      break;
    }

    const tag = html.slice(lt, gt + 1);
    out += tag;

    const m = tag.match(/^<\s*(\/)?\s*([a-zA-Z0-9]+)/);
    if (m) {
      const isClose = Boolean(m[1]);
      const tagName = m[2].toLowerCase();
      const selfClosing =
        /\/\s*>$/.test(tag) ||
        ['br', 'meta', 'link', 'img', 'input', 'hr'].includes(tagName);

      if (!selfClosing) {
        if (isClose) {
          if (stack.length && stack[stack.length - 1] === tagName) {
            stack.pop();
          } else {
            // try to recover: pop until found
            const idx = stack.lastIndexOf(tagName);
            if (idx !== -1) stack.splice(idx, 1);
          }
        } else {
          stack.push(tagName);
        }
      }
    }

    i = gt + 1;
  }

  return out;
}

function buildIndexHtml(languages) {
  const links = languages
    .map((l) => `<li><a href="droptables-${l.code}.html">${l.nativeName}</a></li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0; url=droptables-zh.html">
<title>Warframe PC Drops (Languages)</title>
</head>
<body>
<p>Language / 语言：</p>
<ul>
${links}
</ul>
</body>
</html>
`;
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function buildSite({ repoRoot = process.cwd(), outputDir = 'site' } = {}) {
  const languages = await readLanguagesCsv(repoRoot);
  const htmlPath = path.join(repoRoot, 'droptables-en.html');
  const htmlEn = await fs.readFile(htmlPath, 'utf8');

  const dictEnPath = path.join(repoRoot, 'warframe-public-export-plus', 'dict.en.json');
  const dictEn = await loadJson(dictEnPath);

  // Patterns from EN dict values (filtered)
  const patterns = [];
  for (const v of Object.values(dictEn)) if (isUsefulPattern(v)) patterns.push(v);
  // Longest first helps reduce overlaps bias in "best match at start"
  patterns.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  const ac = new AhoCorasick(patterns);

  const outDirAbs = path.join(repoRoot, outputDir);
  await fs.mkdir(outDirAbs, { recursive: true });

  // index.html (default zh)
  await fs.writeFile(path.join(outDirAbs, 'index.html'), buildIndexHtml(languages), 'utf8');
  await fs.writeFile(path.join(outDirAbs, '.nojekyll'), '', 'utf8');

  for (const lang of languages) {
    const code = lang.code;
    const outPath = path.join(outDirAbs, `droptables-${code}.html`);

    let html = htmlEn.replace('<html lang="en">', `<html lang="${code}">`);
    if (code === 'en') {
      await fs.writeFile(outPath, html, 'utf8');
      continue;
    }

    const dictLangPath = path.join(
      repoRoot,
      'warframe-public-export-plus',
      `dict.${code}.json`,
    );
    const dictLang = await loadJson(dictLangPath);

    /** @type {Map<string, string>} */
    const enToLang = new Map();
    for (const [k, enVal] of Object.entries(dictEn)) {
      if (typeof enVal !== 'string' || !enVal) continue;
      const langVal = dictLang[k];
      if (typeof langVal !== 'string' || !langVal) continue;
      if (langVal === enVal) continue;
      // keep first if duplicates
      if (!enToLang.has(enVal)) enToLang.set(enVal, langVal);
    }

    html = transformHtmlTextOnly(
      html,
      (text) => replaceWithAutomaton(text, ac, (pat) => enToLang.get(pat)),
      { allowedTags: new Set(['th', 'td', 'a', 'h3', 'b']) },
    );

    await fs.writeFile(outPath, html, 'utf8');
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  await buildSite();
}

