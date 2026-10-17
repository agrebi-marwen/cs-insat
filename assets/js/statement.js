// statement.js - Render challenge statements written in Markdown + LaTeX.
//
// Statements are authored like Codeforces/Polygon text: "# Title", "### Input",
// lists, **bold**, ```text sample blocks```, and math as \( inline \),
// \[ display \], $inline$ or $$display$$.
//
// renderStatement(el, text)  - full rendering (needs marked, DOMPurify, KaTeX
//                              loaded from cdn.jsdelivr.net); falls back to
//                              plain text if any library is missing.
// statementPlainText(text)   - a one-line plain-text summary for cards.

(function () {
  const MATH_RE = /\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\$([^\s$](?:[^$\n]*?[^\s$])?)\$/g;
  const FENCE_RE = /(```[\s\S]*?```|`[^`\n]+`)/g;

  // Plain-text statements (Codeforces copy/paste style) use bare section
  // lines and "Input:" sample labels instead of Markdown. Convert them so
  // every statement renders the same way:
  //   INPUT / Output / Constraints / Note ...   -> "### Input" headings
  //   Input: / Output: / Sample Input ...        -> labelled sample block
  const SECTION_RE = /^\s*(input|output|examples?|samples?|constraints?|notes?|explanation|interaction|scoring)\s*$/i;
  const SAMPLE_RE = /^\s*((?:sample|example)\s+)?(input|output)\s*(\d+)?\s*:\s*(.*)$/i;
  const SAMPLE_ONLY_RE = /^\s*(sample|example)\s+(input|output)\s*(\d+)?\s*$/i;
  const titleCase = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  function normalizePlainStatement(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inFence = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence || /^\s*```/.test(line)) { out.push(line); continue; }

      const sample = line.match(SAMPLE_RE) || line.match(SAMPLE_ONLY_RE);
      const isSample = sample && (SAMPLE_ONLY_RE.test(line) || /:\s*/.test(line));
      if (isSample) {
        const kind = titleCase(sample[2]);
        const rest = SAMPLE_RE.test(line) ? (line.match(SAMPLE_RE)[4] || '') : '';
        // Gather the data lines: until a blank line, another label or a section.
        const data = rest.trim() ? [rest] : [];
        let j = i + 1;
        while (j < lines.length && lines[j].trim() !== '' &&
               !SAMPLE_RE.test(lines[j]) && !SAMPLE_ONLY_RE.test(lines[j]) && !SECTION_RE.test(lines[j])) {
          data.push(lines[j]);
          j += 1;
        }
        if (data.length) {
          out.push('', `**${kind}**`, '```text', ...data, '```', '');
          i = j - 1;
          continue;
        }
      }

      if (SECTION_RE.test(line)) {
        out.push('', `### ${titleCase(line.trim())}`, '');
        continue;
      }
      out.push(line);
    }
    return out.join('\n');
  }

  // Replace math with placeholders outside code, so Markdown cannot mangle
  // backslashes or underscores inside formulas.
  function extractMath(text) {
    const math = [];
    const parts = String(text).split(FENCE_RE);
    const out = parts.map((part, i) => {
      if (i % 2 === 1) return part; // code: leave untouched
      return part.replace(MATH_RE, (_, dispA, dispB, inlA, inlB) => {
        const display = dispA != null || dispB != null;
        math.push({ tex: dispA ?? dispB ?? inlA ?? inlB, display });
        return `MATHTOKEN${math.length - 1}END`;
      });
    });
    return { text: out.join(''), math };
  }

  function renderMath(item) {
    try {
      return window.katex.renderToString(item.tex, { displayMode: item.display, throwOnError: false, output: 'html' });
    } catch {
      const span = document.createElement('span');
      span.textContent = item.tex;
      return span.outerHTML;
    }
  }

  // Turn every fenced block into a labelled panel with a copy button.
  function decorateCodeBlocks(el) {
    el.querySelectorAll('pre > code').forEach(code => {
      const pre = code.parentElement;
      const wrap = document.createElement('div');
      wrap.className = 'statement-io';

      // Label from a preceding "**Input**" / "**Output**" paragraph if present.
      const prev = pre.previousElementSibling;
      const label = prev && prev.tagName === 'P' && prev.children.length === 1 &&
        prev.firstElementChild.tagName === 'STRONG' && prev.textContent.trim().length < 24
        ? prev.textContent.trim() : '';
      if (label) prev.remove();

      const bar = document.createElement('div');
      bar.className = 'statement-io-bar';
      const name = document.createElement('span');
      name.textContent = label || 'Sample';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'statement-copy';
      copy.textContent = 'Copy';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code.textContent.replace(/\n$/, ''));
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = 'Select & copy';
        }
        setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
      });
      bar.append(name, copy);

      pre.replaceWith(wrap);
      wrap.append(bar, pre);
    });

    // Put consecutive Input/Output panels side by side.
    el.querySelectorAll('.statement-io + .statement-io').forEach(second => {
      const first = second.previousElementSibling;
      if (first.parentElement.classList.contains('statement-io-pair')) return;
      const pair = document.createElement('div');
      pair.className = 'statement-io-pair';
      first.replaceWith(pair);
      pair.append(first, second);
    });
  }

  window.renderStatement = function (el, text) {
    const source = String(text || '');
    el.classList.add('statement');
    if (!window.marked || !window.DOMPurify) {
      el.classList.add('statement-plain');
      el.textContent = source;
      return;
    }

    const { text: withTokens, math } = extractMath(normalizePlainStatement(source));
    const html = window.DOMPurify.sanitize(window.marked.parse(withTokens, { gfm: true, breaks: true }));
    el.innerHTML = window.katex
      ? html.replace(/MATHTOKEN(\d+)END/g, (_, i) => renderMath(math[Number(i)]))
      : html.replace(/MATHTOKEN(\d+)END/g, (_, i) => {
          const span = document.createElement('code');
          span.textContent = math[Number(i)].tex;
          return span.outerHTML;
        });

    // The challenge title is already the page heading: drop a leading "# Title".
    const first = el.firstElementChild;
    if (first && first.tagName === 'H1') first.remove();

    el.querySelectorAll('a').forEach(a => {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });
    decorateCodeBlocks(el);
  };

  window.statementPlainText = function (text) {
    return normalizePlainStatement(String(text || ''))
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^\s{0,3}#{1,6}\s+.*$/m, ' ')      // first heading = the title
      .replace(/\\\(|\\\)|\\\[|\\\]|\$\$?/g, '')   // math delimiters
      .replace(/\\(le|leq)\b/g, '≤').replace(/\\(ge|geq)\b/g, '≥')
      .replace(/\\cdot\b/g, '·').replace(/\\times\b/g, '×')
      .replace(/\\[a-zA-Z]+/g, '')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/[*_`>]/g, '')
      .replace(/^\s*[-+]\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  };
})();
