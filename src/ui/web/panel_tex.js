/* panel_tex.js — LaTeX 公式渲染（由 build_panel_html.js 拼在 panel.js 之后）
 *
 * 用途：TEX_SYM/TEX_FONT/TEX_BIGOP 三张符号表 + texEsc/texParse/mathHtml，
 *       把模型输出里的 LaTeX 转成 HTML。有 window.katex 时优先用它，否则走内置渲染器。
 * 为什么单独成文件：这整块是纯函数，不碰 DOM 状态、不碰桥、不读 S；
 *       主文件里 md() 才是 Markdown 结构渲染，两者职责不同，不该混在一起。
 * 拼接位置：紧跟 panel.js，仍在同一个 IIFE 作用域内，可直接用 esc() / unesc()。
 */
  /* ── 数学公式渲染 ──
   两套引擎：
   1) KaTeX（可选）：页面里若存在 window.katex 就用它，效果最好
   2) 内置轻量渲染器（默认）：不依赖网络，覆盖数学证明常用子集，
      绝不会因为 CDN 挂掉而把公式显示成一堆反斜杠。
   识别三种写法：$$ 包裹 / $ 包裹 / 裸 LaTeX（比如 \frac{a}{b}，模型常这么写）*/

/* 单字符/命令 → HTML 片段 */
var TEX_SYM = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', ast: '∗',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝',
  ll: '≪', gg: '≫', lt: '<', gt: '>',
  infty: '∞', partial: '∂', nabla: '∇', ell: 'ℓ', hbar: 'ℏ',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', Leftrightarrow: '⇔', mapsto: '↦', implies: '⟹', iff: '⟺',
  uparrow: '↑', downarrow: '↓', longrightarrow: '⟶',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃',
  supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
  sum: '∑', prod: '∏', int: '∫', oint: '∮',
  cdots: '⋯', ldots: '…', dots: '…', vdots: '⋮', ddots: '⋱',
  therefore: '∴', because: '∵', angle: '∠', perp: '⊥', parallel: '∥',
  circ: '∘', prime: '′', degree: '°',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', langle: '⟨', rangle: '⟩',
  quad: '\u2003', qquad: '\u2003\u2003', ' ': '\u00a0', ',': '\u2009', ';': '\u2005',
  '{': '{', '}': '}', '%': '%', '#': '#', '&': '&', '_': '_',
  '|': '|', backslash: '∖', star: '⋆', bullet: '•', oplus: '⊕', otimes: '⊗'
};
/* 需要特殊排版的命令（上下标、分数、根号等），在解析器里单独处理 */
var TEX_FONT = {
  mathbb: 'font-family:"Times New Roman",serif;font-weight:600;',
  mathbf: 'font-weight:700;', mathit: 'font-style:italic;',
  mathrm: 'font-style:normal;', text: '', operatorname: '', mathscr: 'font-style:italic;'
};
var TEX_BIGOP = { sum: 1, prod: 1, int: 1, oint: 1, lim: 1, max: 1, min: 1, sup: 1, inf: 1 };

function texEsc(s) { return esc(s); }

/* 递归下降：把一段 TeX 转成 HTML。ctx 里带 i 指针与源串 */
function texParse(src) {
  var i = 0, n = src.length;
  /* 读一个「原子」：命令、{组}、单字符 */
  function readAtom() {
    skipSpace();
    if (i >= n) return { html: '', big: false };
    var c = src.charAt(i);
    if (c === '{') {
      i++;
      var inner = readGroup();
      return { html: inner, big: false };
    }
    if (c === '\\') {
      i++;
      var name = '';
      while (i < n && /[a-zA-Z]/.test(src.charAt(i))) { name += src.charAt(i); i++; }
      if (!name) { /* \{ \} \% 这类单符号命令 */
        var sym0 = src.charAt(i); i++;
        return { html: texEsc(TEX_SYM[sym0] || sym0), big: false };
      }
      return readCommand(name);
    }
    i++;
    if (c === '^' || c === '_') { i--; return { html: '', big: false }; }
    if (c === ' ') return { html: '\u00a0', big: false };
    return { html: texEsc(c), big: false };
  }
  function readGroup() {
    var depth = 1, start = i;
    while (i < n && depth > 0) {
      var c = src.charAt(i);
      if (c === '\\') { i += 2; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) break; }
      i++;
    }
    var raw = src.slice(start, i);
    i++;   /* 吃掉 } */
    return texParse(raw);
  }
  function skipSpace() { while (i < n && src.charAt(i) === ' ') i++; }
  /* 上下标：^ 与 _ 后面统一跟一个原子 */
  function readScript() {
    var sup = '', sub = '';
    for (var guard = 0; guard < 2; guard++) {
      skipSpace();
      var c = src.charAt(i);
      if (c === '^') { i++; sup = readAtom().html; }
      else if (c === '_') { i++; sub = readAtom().html; }
      else break;
    }
    if (!sup && !sub) return '';
    if (sup && sub) return '<span class="t-ss"><span class="t-su">' + sub + '</span><span class="t-sd">' + sup + '</span></span>';
    if (sup) return '<sup class="t-sup">' + sup + '</sup>';
    return '<sub class="t-sub">' + sub + '</sub>';
  }
  function readCommand(name) {
    /* 字体命令：后面跟一个组，整组套字体 */
    if (TEX_FONT.hasOwnProperty(name)) {
      var g = readAtom().html;
      var st = TEX_FONT[name];
      return { html: st ? '<span style="' + st + '">' + g + '</span>' : g, big: false };
    }
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      var a = readAtom().html, b = readAtom().html;
      return { html: '<span class="t-frac"><span class="t-num">' + a + '</span><span class="t-den">' + b + '</span></span>', big: false };
    }
    if (name === 'binom') {
      var a2 = readAtom().html, b2 = readAtom().html;
      return { html: '<span class="t-bin"><span>' + a2 + '</span><span>' + b2 + '</span></span>', big: false };
    }
    if (name === 'sqrt') {
      var idx = '';
      skipSpace();
      if (src.charAt(i) === '[') {
        var close = src.indexOf(']', i);
        if (close > 0) { idx = texParse(src.slice(i + 1, close)); i = close + 1; }
      }
      var body = readAtom().html;
      return { html: '<span class="t-sqrt">' + (idx ? '<span class="t-rad">' + idx + '</span>' : '') + '<span class="t-radsym">√</span><span class="t-radbody">' + body + '</span></span>', big: false };
    }
    if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' || name === 'bigl' || name === 'bigr') {
      skipSpace();
      var d = src.charAt(i);
      if (d) { i++; }
      var map0 = { '.': '', '(': '(', ')': ')', '[': '[', ']': ']', '|': '|' };
      var ch = map0.hasOwnProperty(d) ? map0[d] : (TEX_SYM[d] || d);
      return { html: texEsc(ch), big: false };
    }
    if (name === 'begin') {
      /* 环境：align/aligned/gather → 多行对齐；cases → 左花括号；matrix 系 → 矩阵；
         array → 通用表格。共同点：按 \\\\ 分行、按 & 分列。
         以前这里直接 readAtom() 吞掉环境名，整段内容被丢弃 —— 这是 LaTeX「显示不全」的根因。 */
      var envName = '';
      skipSpace();
      if (src.charAt(i) === '{') {
        var closeE = src.indexOf('}', i);
        if (closeE > 0) { envName = src.slice(i + 1, closeE).trim(); i = closeE + 1; }
      }
      /* 收集到匹配的 \\end{同名} */
      var depth = 1, startE = i, endE = -1;
      while (i < n) {
        var nx = src.indexOf('\\begin', i);
        var ex = src.indexOf('\\end', i);
        if (ex < 0) break;
        if (nx >= 0 && nx < ex) { depth++; i = nx + 6; continue; }
        /* 检查 \\end{envName} 是否同名 */
        var braceA = src.indexOf('{', ex);
        var braceB = braceA > 0 ? src.indexOf('}', braceA) : -1;
        var nm = braceB > 0 ? src.slice(braceA + 1, braceB).trim() : '';
        if (nm === envName) {
          depth--;
          if (depth === 0) { endE = ex; i = braceB + 1; break; }
        }
        i = ex + 4;
      }
      if (endE < 0) { endE = n; i = n; }
      var innerSrc = src.slice(startE, endE);
      /* 按 \\ 切行，按 & 切列 */
      var rows = innerSrc.split(/\\\\/);
      var outRows = [];
      for (var ri = 0; ri < rows.length; ri++) {
        var rowTxt = rows[ri];
        if (!rowTxt || !rowTxt.trim()) continue;
        var cols = rowTxt.split('&');
        var cells = [];
        for (var ci = 0; ci < cols.length; ci++) {
          cells.push('<span class="t-tcell">' + texParse(cols[ci]) + '</span>');
        }
        outRows.push(cells.join(''));
      }
      var bodyHtml = outRows.join('<span class="t-tnl"></span>');
      var isMatrix = /^(matrix|pmatrix|bmatrix|vmatrix|Vmatrix|smallmatrix|array)$/.test(envName);
      var isCases = /^(cases|dcases)$/.test(envName);
      if (isCases) {
        return { html: '<span class="t-cases"><span class="t-cbrace">{</span><span class="t-cbody">' + bodyHtml + '</span></span>', big: false };
      }
      if (isMatrix) {
        var l = envName === 'pmatrix' ? '(' : (envName === 'bmatrix' ? '[' : (envName === 'vmatrix' ? '|' : ''));
        var r = envName === 'pmatrix' ? ')' : (envName === 'bmatrix' ? ']' : (envName === 'vmatrix' ? '|' : ''));
        return { html: '<span class="t-mat">' + (l ? '<span class="t-mbr">' + l + '</span>' : '')
          + '<span class="t-mbody">' + bodyHtml + '</span>' + (r ? '<span class="t-mbr">' + r + '</span>' : '') + '</span>', big: false };
      }
      /* align / aligned / gather / split / eqnarray：多行块。
         big:false —— 环境是整块，不能再套 t-bigop 放大字号。 */
      return { html: '<span class="t-align">' + bodyHtml + '</span>', big: false };
    }
    if (name === 'end') {
      /* 单独的 \\end（已由 begin 消费掉成对的情况）：吞掉环境名即可 */
      readAtom();
      return { html: '', big: false };
    }
    if (name === 'color') { readAtom(); return { html: '', big: false }; }
    if (name === 'tag' || name === 'label') {
      var t = readAtom().html;
      return { html: '<span class="t-tag">(' + t + ')</span>', big: false };
    }
    if (name === 'overline' || name === 'bar') {
      return { html: '<span class="t-ovl">' + readAtom().html + '</span>', big: false };
    }
    if (name === 'underline') {
      return { html: '<span class="t-udl">' + readAtom().html + '</span>', big: false };
    }
    if (name === 'hat' || name === 'vec' || name === 'tilde' || name === 'dot') {
      var mark = (name === 'vec') ? '→' : (name === 'hat') ? '^' : (name === 'tilde') ? '~' : '·';
      return { html: '<span class="t-acc"><span>' + readAtom().html + '</span><span class="t-accm">' + mark + '</span></span>', big: false };
    }
    if (TEX_SYM.hasOwnProperty(name)) {
      return { html: texEsc(TEX_SYM[name]), big: !!TEX_BIGOP[name] };
    }
    /* 不认识的命令：原样显示命令名，不吞内容 */
    return { html: '<span class="t-unk">\\' + texEsc(name) + '</span>', big: false };
  }
  var out = '', pendingBig = null;
  while (i < n) {
    skipSpace();
    if (i >= n) break;
    var c0 = src.charAt(i);
    /* 上下标直接跟在原子后，这里单独收 */
    if (c0 === '^' || c0 === '_') { out += readScript(); continue; }
    var atom = readAtom();
    if (!atom.html) continue;
    if (atom.big) { pendingBig = atom.html; out += '<span class="t-bigop">' + atom.html + '</span>'; }
    else out += atom.html;
    if (i < n) {
      var c1 = src.charAt(i);
      if (c1 === '^' || c1 === '_') {
        var sc = readScript();
        /* 大运算符的上下限做成上下叠放 */
        if (pendingBig) { out = out.replace(/<span class="t-bigop">[\s\S]*?<\/span>$/, '<span class="t-bigop">' + pendingBig + '<span class="t-limits">' + sc + '</span></span>'); }
        else out += sc;
      }
    }
    pendingBig = null;
  }
  return out;
  }
/* 公式入口：tex 是已 esc 的串。优先 KaTeX，没有就用内置渲染器 */
function mathHtml(texEsc, display) {
  var raw = unesc(texEsc);
  var k = (typeof window !== 'undefined') ? window.katex : null;
  if (k && typeof k.renderToString === 'function') {
    try {
      return k.renderToString(raw, { displayMode: !!display, throwOnError: false, strict: 'ignore' });
    } catch (e) { /* 落到内置渲染器 */ }
  }
  var inner;
  try { inner = texParse(raw); } catch (e2) { inner = texEsc(raw); }
  return '<span class="t-math' + (display ? ' t-blk' : '') + '">' + inner + '</span>';
}
