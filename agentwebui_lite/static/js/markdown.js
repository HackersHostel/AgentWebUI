// Markdown for replies. Everything is escaped first; only the tags made here reach the page, and links and
// images must be http(s). Code fences come back as their own blocks so the reply can draw the code header.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function safeUrl(url) {
  const u = url.trim().replace(/^<|>$/g, '');
  return /^(https?:|mailto:)/i.test(u) ? esc(u) : null;
}

function inline(text) {
  const codes = [];
  let s = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, code) => {
    codes.push(`<code>${esc(code.trim() ? code.replace(/^ (.*) $/, '$1') : code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, alt, url) => {
    const u = safeUrl(url.replace(/&amp;/g, '&'));
    return u ? `<img src="${u}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">` : m;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, label, url) => {
    const u = safeUrl(url.replace(/&amp;/g, '&'));
    return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${label}</a>` : m;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (m, pre, url) =>
    `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)|(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g,
    (_, p1, a, p2, b) => `${p1 ?? p2 ?? ''}<em>${a ?? b}</em>`);
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\$\$([^$]+)\$\$|\\\((.+?)\\\)/g, (_, a, b) => `<code class="math">${a || b}</code>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
}

function table(lines) {
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(lines[0]);
  const align = cells(lines[1]).map((c) => (c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : ''));
  const th = head.map((c, i) => `<th${align[i] ? ` style="text-align:${align[i]}"` : ''}>${inline(c)}</th>`).join('');
  const rows = lines.slice(2).map((l) => `<tr>${cells(l).map((c, i) =>
    `<td${align[i] ? ` style="text-align:${align[i]}"` : ''}>${inline(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="tablewrap"><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function list(lines) {
  // Items start with -, *, + or 1. ; deeper indentation nests one level per two spaces.
  const out = [];
  const stack = [];
  for (const line of lines) {
    const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!m) {
      if (out.length) out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
      continue;
    }
    const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
    const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
    while (stack.length > depth + 1) out.push(`</${stack.pop()}>`);
    if (stack.length < depth + 1) {
      const start = tag === 'ol' && parseInt(m[2], 10) !== 1 ? ` start="${parseInt(m[2], 10)}"` : '';
      out.push(`<${tag}${start}>`);
      stack.push(tag);
    }
    let body = m[3];
    const task = body.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) body = `${task[1] === ' ' ? '☐' : '☑'} ${task[2]}`;
    out.push(`<li>${inline(body)}</li>`);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('');
}

// -> [{ type: 'html', html } | { type: 'code', lang, code, open }]
export function parse(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let buf = [];
  const flush = () => { if (buf.length) blocks.push({ type: 'html', html: buf.join('') }); buf = []; };
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/);
    if (fence) {
      flush();
      const close = new RegExp(`^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      const code = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) code.push(lines[i++]);
      const open = i >= lines.length;
      i++;
      blocks.push({ type: 'code', lang: fence[2] || '', code: code.join('\n'), open });
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 4);
      buf.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { buf.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      buf.push(`<blockquote>${parse(quote.join('\n')).map((b) => (b.type === 'html' ? b.html : `<pre><code>${esc(b.code)}</code></pre>`)).join('')}</blockquote>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(lines[i++]);
      buf.push(table(rows));
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~)/.test(lines[i])) {
        if (!/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) && !/^\s{2,}/.test(lines[i]) && items.length && /^\S/.test(lines[i])) break;
        items.push(lines[i++]);
      }
      buf.push(list(items));
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    buf.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  flush();
  return blocks;
}

// A light highlighter for the palette on the design boards: keywords, strings, functions, tags, comments.
const KEYWORDS = new Set(('as async await break case catch class const continue def default del do elif else enum ' +
  'export extends false finally fn for from func function go if impl import in interface is lambda let match mod ' +
  'mut new nil none null of package pass pub raise return self static struct super switch this throw true try type ' +
  'typeof undefined use var void while with yield True False None').split(' '));
const TOKEN = /(\/\/[^\n]*|#(?![{\w-]*\s*[:{])[^\n]*|\/\*[\s\S]*?\*\/|--[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(<\/?[A-Za-z][\w.-]*)|\b([A-Za-z_$][\w$]*)(?=\s*\()|\b([A-Za-z_]\w*)\b/g;
const HASH_COMMENTS = new Set(['py', 'python', 'sh', 'bash', 'zsh', 'shell', 'yaml', 'yml', 'toml', 'rb', 'ruby', 'r', 'dockerfile', 'make', 'conf', 'ini', 'env']);
const DASH_COMMENTS = new Set(['sql', 'lua', 'hs', 'haskell']);

export function highlight(code, lang = '') {
  const l = lang.toLowerCase();
  let out = '';
  let last = 0;
  code.replace(TOKEN, (m, comment, string, tag, fn, word, offset) => {
    out += esc(code.slice(last, offset));
    last = offset + m.length;
    if (comment) {
      const isHash = comment.startsWith('#'), isDash = comment.startsWith('--');
      if ((isHash && !HASH_COMMENTS.has(l)) || (isDash && !DASH_COMMENTS.has(l))) {
        out += esc(m);
        return m;
      }
      out += `<span class="c">${esc(m)}</span>`;
    } else if (string) out += `<span class="s">${esc(m)}</span>`;
    else if (tag) out += `&lt;${tag.startsWith('</') ? '/' : ''}<span class="tg">${esc(tag.replace(/^<\/?/, ''))}</span>`;
    else if (fn) out += KEYWORDS.has(fn) ? `<span class="k">${esc(fn)}</span>` : `<span class="fn">${esc(fn)}</span>`;
    else if (word && KEYWORDS.has(word)) out += `<span class="k">${esc(word)}</span>`;
    else out += esc(m);
    return m;
  });
  return out + esc(code.slice(last));
}

export function plain(source) {
  return String(source || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>[\]()!|-]/g, '').replace(/\s+/g, ' ').trim();
}
