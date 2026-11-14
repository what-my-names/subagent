/* panel.js — 子代理面板（对话时间线） */
(function () {
'use strict';

  /* ── 生命周期守卫 ──
     页面被销毁（宿主切走 / 关闭 WebView）后，JsEngine 就没了，
     此时任何定时器再回调 SBNative 都会抛「JsEngine already destroyed」。
     这里包装定时器 + 挂销毁钩子，页面一死全部停手。 */
  var ALIVE = true, _timers = [], _ivals = [];
  var _rawST = window.setTimeout, _rawSI = window.setInterval;
  window.setTimeout = function (fn, ms) {
    var id = _rawST.call(window, function () {
      if (!ALIVE) return;
      try { fn(); } catch (e) {}
    }, ms);
    _timers.push(id);
    return id;
  };
  window.setInterval = function (fn, ms) {
    var id = _rawSI.call(window, function () {
      if (!ALIVE) { try { clearInterval(id); } catch (e) {} return; }
      try { fn(); } catch (e) {}
    }, ms);
    _ivals.push(id);
    return id;
  };
  function shutdown() {
    if (!ALIVE) return;
    /* 【第六十九轮】页面销毁时解绑观察器，避免悬空引用 */
    try { if (_animObs) { _animObs.disconnect(); _animObs = null; } } catch (eAO) {}
    /* 先置 false：后面的桥调用如果因为引擎已死而抛异常，
       也不会有其它定时器趁这个窗口再发请求。 */
    ALIVE = false;
    /* 【关键】页面销毁前必须把流式内容落盘，否则退出面板 = 内容全丢。
       这里用同步桥调用（SBNative.call 本身是同步的），保证在 JsEngine 回收前发出。
       不用 call() 是因为它走 setTimeout，页面一死定时器就不跑了。
       注意：如果引擎已经被宿主回收，这次调用会抛异常，catch 掉即可
       （那种情况下内容早就随引擎一起没了，救不回来）。 */
    try {
      /* STREAM 声明在文件后面，这里是函数体执行期，已经初始化过了；
         但为防极端时序，用 typeof 兜一层。 */
      var _st = (typeof STREAM !== 'undefined' && STREAM) ? STREAM : null;
      if (_st && _st.busy && _st.curId && (_st.curThink || _st.curBody)) {
        if (window.SBNative && typeof SBNative.call === 'function') {
          SBNative.call(JSON.stringify({
            tool: 'subagent:subagent_stream_flush',
            params: { id: _st.curId, think: _st.curThink, body: _st.curBody },
            kind: 'streamFlush', id: 0
          }));
        }
      }
    } catch (eSF) {}
    for (var i = 0; i < _ivals.length; i++) { try { clearInterval(_ivals[i]); } catch (e) {} }
    for (var j = 0; j < _timers.length; j++) { try { clearTimeout(_timers[j]); } catch (e) {} }
    _ivals.length = 0; _timers.length = 0;
    try { S.advancing = false; } catch (e) {}
  }
  function on(ev, fn) {
    try { if (window.addEventListener) window.addEventListener(ev, fn); } catch (e) {}
  }
on('pagehide', shutdown);
  on('beforeunload', shutdown);
  on('unload', shutdown);

  /* ── 可视高度同步 ──
     Android WebView 里 100vh 不随键盘变化，键盘收起后常留一条空白。
     用 visualViewport 实时把高度写进 --vh，布局立刻跟着还原。 */
  function syncViewport() {
    var vv = window.visualViewport;
    var h = vv ? vv.height : (window.innerHeight || 0);
    if (!h) return;
    try { document.documentElement.style.setProperty('--vh', h + 'px'); } catch (e) {}
    /* 键盘收起后再补一帧，处理部分机型延迟上报 */
    setTimeout(function () {
      var v2 = window.visualViewport;
      var h2 = v2 ? v2.height : (window.innerHeight || 0);
      if (h2) { try { document.documentElement.style.setProperty('--vh', h2 + 'px'); } catch (e2) {} }
    }, 120);
  }
  on('resize', syncViewport);
  on('orientationchange', syncViewport);
  if (window.visualViewport && window.visualViewport.addEventListener) {
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
  }

  window.onerror = function (msg, src, line, col) {
    try {
      var b = document.getElementById('booterr');
      if (!b) { b = document.createElement('div'); b.id = 'booterr'; b.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#e06c5a;color:#fff;font:11px monospace;padding:6px 8px;max-height:40%;overflow:auto;white-space:pre-wrap;word-break:break-all'); if (document.body) document.body.appendChild(b); }
      b.textContent = '[ERR] ' + msg + ' @' + line + ':' + col + '\n' + (b.textContent.split('\n')[1] || '');
    } catch (e) {}
  };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).split('&').join('&' + 'amp;').split('<').join('&' + 'lt;').split('>').join('&' + 'gt;').split('\x22').join('&' + 'quot;'); }
  /* 反向还原 esc（&amp; 必须最后还原，否则 &amp;lt; 会被拆错） */
  function unesc(s) {
    var AMP = '\x26', LT = '\x26lt;', GT = '\x26gt;', QT = '\x26quot;';
    return String(s == null ? '' : s)
      .split(LT).join('<').split(GT).join('>').split(QT).join('\x22').split(AMP).join('&');
  }
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
  /* 轻量 markdown 渲染：先转义再做结构，防 XSS。
     支持：围栏代码块、行内代码、粗体、斜体、标题、无序/有序列表、
           引用、分割线、链接、表格（简单两列以上）。 */
  function md(src) {
    var s = esc(src);
    var blocks = [];
    /* 1. 先抽出围栏代码块，避免里面的符号被后续规则误伤 */
    s = s.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      var i = blocks.length;
      blocks.push('<pre class="md-code"><code>' + code.replace(/\n$/, '') + '</code></pre>');
      return '\u0000B' + i + '\u0000';
    });
    /* 2. 行内代码同样先抽出来 */
    var inls = [];
    s = s.replace(/`([^`\n]+)`/g, function (_, c) {
      var i = inls.length;
      inls.push('<code class="md-ic">' + c + '</code>');
      return '\u0000I' + i + '\u0000';
    });
    /* 2.5 数学公式：先抽成占位，渲染后交给 KaTeX。
       块级 $$...$$ 优先，避免被行内规则吃掉；
       行内 $...$ 要求两侧不是 \ 且不跨行，减少误伤正文里的美元符号。 */
    var maths = [];
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, function (_, tex) {
      var i = maths.length;
      maths.push({ tex: tex.trim(), display: true });
      return '\u0000M' + i + '\u0000';
    });
    s = s.replace(/(^|[^\\$])\$([^$\n]+?)\$/g, function (_, pre, tex) {
      var i = maths.length;
      maths.push({ tex: tex.trim(), display: false });
      return pre + '\u0000M' + i + '\u0000';
    });
    /* 2.6 裸 LaTeX：模型经常直接写 \frac{a}{b}、a^{2}+b^{2} 而不加 $ 包裹。
       识别策略必须保守，只吃「确定是公式」的片段，避免把正文里的反斜杠当公式：
       - \( ... \) 与 \[ ... \] 明确定界符
       - 含 \命令 的一段（到括号/逗号/中文/行尾为止）
       - 纯上下标表达式 a^{2}、x_{1}
       普通英文和中文正文不受影响。 */
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, function (_, tex) {
      var i = maths.length; maths.push({ tex: tex.trim(), display: false });
      return '\u0000M' + i + '\u0000';
    });
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, function (_, tex) {
      var i = maths.length; maths.push({ tex: tex.trim(), display: true });
      return '\u0000M' + i + '\u0000';
    });
    /* 裸反斜杠命令串：以 \命令 开头，一直吃到明显的正文边界 */
    s = s.replace(/(^|[^\\\w])((?:\\[a-zA-Z]+(?:\{[^{}\n]*\}|\[[^\]\n]*\])*[\s{}^_0-9a-zA-Z+\-*/=<>()|.,:'!]*)+)/g, function (m, pre, body) {
      if (!/\\[a-zA-Z]{2,}/.test(body)) return m;          /* 不像公式，放过 */
      if ((body.match(/\\[a-zA-Z]+/g) || []).length > 60) return m;   /* 太长多半误判 */
      if (/[\u4e00-\u9fa5]/.test(body)) return m;          /* 混中文，放过 */
      var t = body.replace(/[\s.,:'!]+$/, '');             /* 收尾标点还回去 */
      var tail = body.slice(t.length);
      var i = maths.length;
      maths.push({ tex: t, display: false });
      return pre + '\u0000M' + i + '\u0000' + tail;
    });
    /* 纯上下标：a^{2}、x_i、b^2（没有反斜杠也要认） */
    s = s.replace(/(^|[^\w\\])([xyabkmnpqrstuvwzABKMNPQRSTUVWZ][a-zA-Z0-9]*\s*(?:[\^_]\s*(?:\{[^{}\n]{1,12}\}|[a-zA-Z0-9]{1,3}))+)/g, function (m, pre, body) {
      var i = maths.length;
      maths.push({ tex: body.trim(), display: false });
      return pre + '\u0000M' + i + '\u0000';
    });
    /* 3. 按行处理块级结构 */
    var lines = s.split('\n');
    var out = [], listBuf = null, tblBuf = null;
    function flushList() {
      if (!listBuf) return;
      out.push('<' + listBuf.tag + '>' + listBuf.items.join('') + '</' + listBuf.tag + '>');
      listBuf = null;
    }
    function flushTable() {
      if (!tblBuf) return;
      out.push('<table class="md-tbl"><thead><tr>' + tblBuf.head + '</tr></thead><tbody>' + tblBuf.rows.join('') + '</tbody></table>');
      tblBuf = null;
    }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      /* 表格：| a | b |  下一行是 |---|---| */
      if (/^\s*\|.*\|\s*$/.test(ln) && lines[i + 1] && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        flushList();
        var cells = ln.trim().replace(/^\||\|$/g, '').split('|');
        var head = cells.map(function (c) { return '<th>' + c.trim() + '</th>'; }).join('');
        tblBuf = { head: head, rows: [] };
        i++;   // 跳过分隔行
        /* 继续吃后续表格行 */
        while (lines[i + 1] && /^\s*\|.*\|\s*$/.test(lines[i + 1])) {
          i++;
          var cs = lines[i].trim().replace(/^\||\|$/g, '').split('|');
          tblBuf.rows.push('<tr>' + cs.map(function (c) { return '<td>' + c.trim() + '</td>'; }).join('') + '</tr>');
        }
        flushTable();
        continue;
      }
      if (/^\s*[-*+]\s+/.test(ln)) {
        flushTable();
        if (!listBuf || listBuf.tag !== 'ul') { flushList(); listBuf = { tag: 'ul', items: [] }; }
        listBuf.items.push('<li>' + ln.replace(/^\s*[-*+]\s+/, '') + '</li>');
        continue;
      }
      if (/^\s*\d+\.\s+/.test(ln)) {
        flushTable();
        if (!listBuf || listBuf.tag !== 'ol') { flushList(); listBuf = { tag: 'ol', items: [] }; }
        listBuf.items.push('<li>' + ln.replace(/^\s*\d+\.\s+/, '') + '</li>');
        continue;
      }
      flushList(); flushTable();
      var m;
      if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(ln))) {
        var lv = Math.min(m[1].length + 2, 6);   // h1/h2/h3 起步降两级，避免气泡里字号过大
        out.push('<h' + lv + ' class="md-h">' + m[2] + '</h' + lv + '>');
      } else if (/^\s*(---|\*\*\*|___)\s*$/.test(ln)) {
        out.push('<hr class="md-hr">');
      } else if ((m = /^\s*&gt;\s?(.*)$/.exec(ln))) {
        out.push('<blockquote class="md-q">' + m[1] + '</blockquote>');
      } else if (/^\s*$/.test(ln)) {
        out.push('<div class="md-gap"></div>');
      } else {
        out.push('<div class="md-p">' + ln + '</div>');
      }
    }
    flushList(); flushTable();
    var html = out.join('');
    /* 4. 行内样式：粗体 → 斜体 → 删除线 → 链接 */
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    html = html.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a class="md-a" href="$2" target="_blank" rel="noopener">$1</a>');
    /* 5. 放回代码块与行内代码 */
    html = html.replace(/\u0000I(\d+)\u0000/g, function (_, n) { return inls[Number(n)] || ''; });
    html = html.replace(/\u0000B(\d+)\u0000/g, function (_, n) { return blocks[Number(n)] || ''; });
    /* 6. 最后回填数学公式：此时其它规则都已跑完，公式里的 * _ \ 不会被误当成 markdown */
    if (maths.length) {
      html = html.replace(/\u0000M(\d+)\u0000/g, function (_, n) {
        var it = maths[Number(n)];
        if (!it) return '';
        return '<span class="md-math' + (it.display ? ' blk' : '') + '">' + mathHtml(it.tex, it.display) + '</span>';
      });
    }
    return html;
  }
  var LIST_TTL = 8000;
  var S = { items: [], cur: null, sel: [], tools: null, dlg: null, think: 'medium', seq: 0, lastId: {}, keyOk: null, cfgModel: '', cfgProv: '', listAt: 0, listBusy: false, listUnlockT: null, allModels: [], modelsAt: 0, keySaving: false, keyFilled: false, curStatus: '', advancing: false, advT: null, taskDraft: '', streaming: false, curPhase: 'idle', curToolNow: '', bridgeDropped: 0, pollT: null, cfmYes: null, multi: false, selIds: {}, initAnim: false, initLoaded: false, page: 'welcome', probed: false };
  var WRITE_RE = /(create_file|edit_file|delete_file|move_file|copy_file|write)/;
  /* 【第八十三轮补丁C】群组展示状态：
     groupList = 后端返回的群组清单（code/name/readonly/mask）
     grpClosed = 列表页手动折叠过的分组 key 集合，刷新后保持折叠 */
  S.groupList = [];
  S.grpClosed = {};
  var HIGH = /(delete_file|move_file|terminal|shell)/;
  var FALLBACK = [
    ['read_file', '读文件', 0], ['read_file_part', '读文件片段', 0], ['list_files', '列目录', 0],
    ['file_info', '文件信息', 0], ['file_exists', '文件存在', 0], ['file_grep', '文件搜索', 0], ['find_files', '找文件', 0],
    ['create_file', '新建文件', 1], ['edit_file', '编辑文件', 1], ['delete_file', '删除文件', 1], ['move_file', '移动文件', 1], ['copy_file', '复制文件', 1]
  ];
  var ST_CN = { queued: '待开始', running: '运行中', done: '已完成', failed: '失败', closed: '已关闭', cancelled: '已停止' };
  /* 阶段文案：running 时不能只写「运行中」，用户要知道它此刻在干什么。
     llm=正在调模型（思考中），tool=正在跑工具，queued_next=已排上马上开跑。 */
  var PH_CN = { llm: '思考中', tool: '执行工具', queued_next: '即将开始', idle: '运行中' };
  /* 思考等级的英文标签：面板上显示英文，和后端档位名一致，也更好看 */
  var THINK_EN = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High' };
  function stCn(s) { return ST_CN[s] || (s || '-'); }
  /* 【第八十三轮补丁C】陈旧 running 自愈判定。
     问题：_advanceTaskInner 只在被推时改状态。进程重启/被系统杀掉后，
     running 标记留在 task.json 里没人清，面板就永久显示「运行中」，
     用户既等不到结果也点不了「继续推进」。
     做法：running/queued 且 updated_at_ms 距今超过 STALE_MS → 展示成「已中断」。
     只改前端展示，不动后端状态 —— 真在跑的长任务最多显示延迟，不会被写坏。
     一点「继续推进」或刷新拉回新状态，eff 自然恢复。 */
  var STALE_MS = 3 * 60 * 1000;
  function effStatus(it) {
    var st = String((it && it.status) || '');
    if (st !== 'running' && st !== 'queued') return st;
    var t0 = Number((it && it.updated_at_ms) || 0);
    if (!t0) return st;
    if ((Date.now() - t0) > STALE_MS) return 'interrupted';
    return st;
  }
  /* 状态文案：running 时按 phase 细分，让用户知道它此刻在思考还是在跑工具。
     it 是任务对象，带 phase / phase_at / tool_now。 */
  function stLabel(it) {
    if (!it) return '-';
    var st = effStatus(it);
    if (st === 'interrupted') return '已中断';
    if (st !== 'running' && st !== 'queued') return stCn(st);
    var ph = String(it.phase || 'idle');
    var base = PH_CN[ph] || '运行中';
    /* 工具阶段带上工具名，比干说「执行工具」有用 */
    if (ph === 'tool' && it.tool_now) base = '执行 ' + String(it.tool_now).slice(0, 18);
    /* 思考超过 3 秒才显示秒数，短任务加秒数反而闪 */
    var t0 = Number(it.phase_at || 0);
    if (t0 > 0) {
      var sec = Math.floor((Date.now() - t0) / 1000);
      if (sec >= 3) base += ' ' + sec + 's';
    }
    return base;
  }

/* ── 堆叠式通知 ──
   对齐宿主右侧聊天栏：多条同时存在，新的压在最上面，旧的被挤下去。
   上一版是单节点 #toast，textContent 直接覆盖 —— 连报两条时前一条被吃掉，
   用户只能看到「闪一下」，这就是「报错太快截不到」的真正原因。
   现在每条独立节点、独立计时，互不干扰。 */
var TST_MAX = 4;
/* 存在时长：用户反馈「有点不太长」，整体加长。
   info/ok 3.0/2.6 → 3.5/3.5，warn 4.0 → 5.0，err 6.5 → 8.0（错误要看清再关）。 */
var TST_LIFE = { info: 3500, ok: 3500, warn: 5000, err: 8000 };
var TST_SVG = {
  info: '<svg class="tst-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.6"/></svg>',
  ok: '<svg class="tst-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.6 2.6L16 9.6"/></svg>',
  warn: '<svg class="tst-ico" viewBox="0 0 24 24"><path d="M12 3.4L21 19.4H3z"/><path d="M12 9.6v4.6M12 17.2v.5"/></svg>',
  err: '<svg class="tst-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8"/></svg>'
};
/* 同级别、同文案的重复消息不叠加，只把已有那条刷新计时（避免连点时刷屏） */
var TST_NODES = [];

function toast(msg, level) {
  var txt = String(msg == null ? '' : msg);
  if (!txt) return;
  var lv = (level === 'ok' || level === 'warn' || level === 'err') ? level : 'info';
  var box = $('toastStack');
  if (!box) return;

  /* 去重：完全相同的文案仍在屏上时，不新增，只重置它的寿命 */
  for (var i = 0; i < TST_NODES.length; i++) {
    var nd = TST_NODES[i];
    if (nd && nd.el && nd.txt === txt && !nd.dead) {
      try { clearTimeout(nd.timer); } catch (eT) {}
      nd.timer = setTimeout(function () { killToast(nd); }, TST_LIFE[lv]);
      return;
    }
  }

  var el = document.createElement('div');
  el.className = 'tst' + (lv === 'info' ? '' : ' ' + lv);
  el.setAttribute('data-lv', lv);
  el.innerHTML = (TST_SVG[lv] || TST_SVG.info) + '<div class="tst-tx">' + esc(txt) + '</div>';

  var rec = { el: el, txt: txt, lv: lv, timer: null, dead: false };

  /* 报错条目的点击语义（用户定，两档）：
       单击 → 展开到上限（约 8 行），仍留在原位，再点收回。
       双击 → 解除限高看全部，并在屏幕中心悬浮；悬浮态可拖动，
              松手飞出最近边缘并消失。
       单击要延迟 250ms 才能确认不是双击，期间二次点击则取消单击。 */
  var onTapFn = null;
  var onDoubleFn = null;
  var tapTimer = 0;
  if (lv === 'err') {
    onTapFn = function () {
      /* 已经在悬浮态：单击直接关掉（不用再展开/收回） */
      if (el.classList.contains('float')) { killToast(rec); return; }
      try { clearTimeout(tapTimer); } catch (eT) {}
      tapTimer = setTimeout(function () {
        el.classList.toggle('open');
        try { clearTimeout(rec.timer); } catch (eT2) {}
        if (el.classList.contains('open')) {
          rec.timer = setTimeout(function () { killToast(rec); }, 12000);
        } else {
          rec.timer = setTimeout(function () { killToast(rec); }, TST_LIFE.err);
        }
      }, 250);
    };
    onDoubleFn = function () {
      /* 双击：取消挂起的单击，直接进悬浮态 */
      try { clearTimeout(tapTimer); } catch (eT) {}
      floatToast(el, rec);
    };
  }

  /* 手势区分：位移小于这个值算「点击」，大于算「滑动」 */
  var TST_TAP_SLOP = 8;
  /* 横向滑过这个距离就判定关闭（不要求特定方向，左右都行） */
  var TST_SWIPE_MIN = 46;

  /* 给一条通知挂上「划一下关闭」。
     用户原话：划一下就能关，划哪里都行。
     所以不做方向限制、也不要求从边缘起手 —— 整条任意位置都能拖，
     只按位移距离判定，左右滑都可以。 */
/* 通知条交互（2026-11-06 重写，用户定）：
     自由拖动 —— 不锁轴，x/y 都跟手；松手时三种结局：
     a) 位移很小 → 判点击（err 条目点开全文）
     b) 位移中等 → 弹回原位
     c) 位移超限 → 顺着拖动方向飞出屏幕并消失
     全程只动 transform/opacity，不触发布局。
     手感的两个关键点：
     1) pointermove 里先判方向再 preventDefault —— 竖直方向放行给页面滚动，
        否则通知条会抢走所有竖向滑动，整页感觉「阻塞」；
     2) 飞出时不能先 reset 再 killToast —— 那会让元素先弹回原位再飞，
        必须把当前位移原样交给 killToast 接力。 */
  function bindSwipeClose(el, rec, onTap, onDouble) {
    /* 所有级别都可拖（用户定：即使一下就走的也要能划掉）。
       单击/双击语义只给 err，其余级别拖动即关闭。
       float 态（双击后悬浮）拖动逻辑不同：不判点击，松手一律飞出。 */
    var startX = 0, startY = 0, curX = 0, curY = 0;
    var tracking = false, decided = false, horiz = false;
    var pid = null;

    function reset(spring) {
      tracking = false; decided = false; pid = null;
      if (spring) {
        /* 回弹：放开直接截断，用 transition 弹回去 */
        el.classList.remove('drag');
        el.style.transition = 'transform .24s cubic-bezier(.2,.9,.3,1), opacity .2s';
        el.style.transform = rec.floatBase || 'translate3d(0,0,0)';
        el.style.opacity = '';
        setTimeout(function () {
          if (!rec.dead) { el.style.transition = ''; el.style.transform = rec.floatBase || ''; }
        }, 260);
      } else {
        el.classList.remove('drag');
        el.style.transition = '';
        el.style.transform = rec.floatBase || '';
        el.style.opacity = '';
      }
      curX = 0; curY = 0;
    }

    el.addEventListener('pointerdown', function (e) {
      if (rec.dead) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      tracking = true; decided = false; horiz = false;
      pid = e.pointerId;
      startX = e.clientX; startY = e.clientY; curX = 0; curY = 0;
      /* 按下即清掉 transition 与动画，拖动全程跟手 */
      el.style.transition = '';
      el.style.animation = 'none';
      el.classList.add('drag');
      try { el.setPointerCapture(pid); } catch (eC) {}
    });

    el.addEventListener('pointermove', function (e) {
      if (!tracking || rec.dead) return;
      curX = e.clientX - startX;
      curY = e.clientY - startY;
      var ax = Math.abs(curX), ay = Math.abs(curY);
      /* 第一次超过 6px 时定方向：横向接管，纵向还给页面滚动 */
      if (!decided && (ax > 6 || ay > 6)) {
        decided = true;
        horiz = ax >= ay;
      }
      /* 【第六十二轮】用户要求：两个位置随便滑都能飞。
         以前竖向会还给页面滚动，导致往上/往下滑没反应。
         现在只在「没展开的长内容需要滚动」时才放行竖向，其余全接管。 */
      if (decided && !horiz) {
        var needScroll = !el.classList.contains('float') &&
                         el.scrollHeight > el.clientHeight + 2 &&
                         el.classList.contains('open');
        if (needScroll) {
          tracking = false;
          reset(true);
          return;
        }
      }
      /* 全方向跟手。悬浮态要保留居中基准 -50%，只叠加手指位移 */
      if (rec.floatBase) {
        el.style.transform = rec.floatBase + ' translate3d(' + curX + 'px,' + curY + 'px,0)';
      } else {
        el.style.transform = 'translate3d(' + curX + 'px,' + curY + 'px,0)';
      }
      var dist = Math.sqrt(curX * curX + curY * curY);
      el.style.opacity = String(Math.max(0.25, 1 - dist / 260));
      try { e.preventDefault(); } catch (eP) {}
    });

    function finish(e) {
      if (!tracking || rec.dead) return;
      var movedX = Math.abs(curX), movedY = Math.abs(curY);
      var dist = Math.sqrt(curX * curX + curY * curY);
      try { if (pid != null) el.releasePointerCapture(pid); } catch (eR) {}
      var isFloat = el.classList.contains('float');

      /* 悬浮态：任何位移超限都直接飞出（不判点击、不弹回） */
      if (isFloat) {
        if (dist >= TST_SWIPE_MIN) {
          var fdir;
          if (movedX >= movedY) fdir = curX < 0 ? 'left' : 'right';
          else fdir = curY < 0 ? 'up' : 'down';
          tracking = false; decided = false; pid = null;
          killToast(rec, fdir, curX, curY);
          return;
        }
        /* 没拖动就是单击：关闭 */
        reset();
        if (movedX < TST_TAP_SLOP && movedY < TST_TAP_SLOP) killToast(rec);
        return;
      }

      /* 超限：顺着拖动方向飞出。
         关键：这里不能 reset()，必须把「当前手指位置」原样交给 killToast 接力，
         由它从该位置继续推到屏外 —— 否则元素会先弹回原位再飞出去（闪一下）。 */
      if (dist >= TST_SWIPE_MIN) {
        var dir;
        if (movedX >= movedY) dir = curX < 0 ? 'left' : 'right';
        else dir = curY < 0 ? 'up' : 'down';
        tracking = false; decided = false; pid = null;
        killToast(rec, dir, curX, curY);
        return;
      }
      /* 没超限：位移极小算点击 */
      if (movedX < TST_TAP_SLOP && movedY < TST_TAP_SLOP) {
        reset();
        /* 双击判定：两次点击间隔小于 300ms 视为双击 */
        var now = Date.now();
        if (onDouble && rec.lastTap && (now - rec.lastTap) < 300) {
          rec.lastTap = 0;
          onDouble();
          return;
        }
        rec.lastTap = now;
        if (onTap) onTap();
        return;
      }
      reset(true);
    }
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', function () { reset(true); });
  }

  /* 双击：把通知条抬到屏幕中心悬浮，解除限高看全部。
   悬浮态下：单击关闭；拖动松手飞出最近边缘。
   用 fixed 定位 + 居中，z-index 压过容器。 */
function floatToast(el, rec) {
  if (!el || rec.dead) return;
  try { clearTimeout(rec.timer); } catch (eT) {}

  /* 两段式：先记下它现在的位置（right-top 的堆叠位），下一帧再过渡到屏幕中心。
     为什么要两段：同一个事件循环里连续写两次 transform，浏览器会合并成一帧，
     过渡根本没有起点，看起来就是瞬移。必须先让第一帧被渲染。 */
  var r0 = el.getBoundingClientRect();
  var startTf = 'translate3d(' + (r0.left + r0.width / 2 - window.innerWidth / 2) + 'px,' +
                (r0.top + r0.height / 2 - window.innerHeight / 2) + 'px,0)' +
                ' translate(-50%,-50%) scale(1)';

  el.classList.remove('open');
  el.classList.add('float');
  /* 从容器里摘出来挂到 body，避免被 #toastStack 的 overflow/层叠限制 */
  if (el.parentNode && el.parentNode !== document.body) {
    document.body.appendChild(el);
  }
  /* 第一帧：定位到原位，无过渡 */
  el.style.transition = 'none';
  el.style.position = 'fixed';
  el.style.left = '50%';
  el.style.top = '50%';
  el.style.width = Math.min(r0.width, 420) + 'px';
  el.style.maxHeight = '70vh';
  el.style.overflowY = 'auto';
  el.style.zIndex = '300';
  el.style.pointerEvents = 'auto';
  el.style.opacity = '1';
  el.style.transform = startTf;
  /* 记录基准位移，拖动时在此基础上叠加，避免覆盖掉居中用的 -50% */
  rec.floatBase = 'translate(-50%,-50%)';

  /* 第二帧：解禁过渡，过渡到屏幕中心 + 撑宽 */
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (!el.parentNode || rec.dead) return;
      el.style.transition = '';
      el.style.width = 'min(86vw, 420px)';
      el.style.transform = 'translate(-50%,-50%) scale(1)';
    });
  });
}

  /* 新的插到最前面：容器在右上角，最新一条在最上面，旧的往下推。
   与 TST_NODES 顺序保持一致（数组也是 unshift），超限时删最后一个（最旧、最靠下）。 */
  box.insertBefore(el, box.firstChild);
  TST_NODES.unshift(rec);
  bindSwipeClose(el, rec, onTapFn, onDoubleFn);

  /* 超出上限：最旧的那条（数组最后一个 = 屏幕最下方）立刻淡出 */
  while (TST_NODES.length > TST_MAX) {
    killToast(TST_NODES[TST_NODES.length - 1]);
  }

  rec.timer = setTimeout(function () { killToast(rec); }, TST_LIFE[lv]);
}

/* 淡出后移除节点；动画只跑 transform/opacity，不触发重绘。
   dir / fromX / fromY 可选：手动拖飞时传入，从手指松开的位置接着推到屏外，
   手感连续不跳变；自动消失不传，走默认的从右侧滑出。 */
function killToast(rec, dir, fromX, fromY) {
  if (!rec || rec.dead) return;
  rec.dead = true;
  try { clearTimeout(rec.timer); } catch (eT) {}
  var el = rec.el;
  for (var i = 0; i < TST_NODES.length; i++) {
    if (TST_NODES[i] === rec) { TST_NODES.splice(i, 1); break; }
  }
  if (!el || !el.parentNode) return;
  if (dir) {
    /* 先把元素固定在手指松开的位置（无过渡），再解禁过渡推到屏外。
       注意：此时 el.style.animation 可能还是 'none'（pointerdown 里设的），
       必须显式清掉，否则 keyframes 与 transition 抢同一个 transform 属性。 */
    el.classList.remove('drag');
    var sx = Number(fromX || 0), sy = Number(fromY || 0);
    el.style.animation = 'none';
    el.style.transition = 'none';
    el.style.transform = 'translate3d(' + sx + 'px,' + sy + 'px,0)';
    /* 四方向：横飞出 130%，竖飞出 160%（上下留出通知条偏移） */
    var tx = '0%', ty = '0%';
    if (dir === 'left') tx = '-130%';
    else if (dir === 'right') tx = '130%';
    else if (dir === 'up') ty = '-160%';
    else if (dir === 'down') ty = '160%';
    /* 双延时代替双 rAF：rAF 在 WebView 被遮挡/悬浮窗时会被暂停，
       通知条就永远飞不出去、卡在屏幕上不消失。setTimeout 不受可见性影响。
       【延时不能省】两个 setTimeout 都必须带 ms，否则都是 0ms，
       会在同一轮事件循环里连续跑完，中间没有渲染帧 ——
       transform 初始值没被浏览器接受，transition 从终值起算，动画直接跳过去。
       16ms ≈ 一帧，作用等价于原来的双 rAF。 */
    setTimeout(function () {
      /* 再等一帧：确保上面那帧的 transform 已被浏览器接受，
         否则 transition 会从「初始值」起算，看起来就是闪回 */
      setTimeout(function () {
        if (!el.parentNode) return;
        el.style.transition = 'transform .22s cubic-bezier(.3,0,.8,.4), opacity .22s ease-out';
        el.style.transform = 'translate3d(' + tx + ',' + ty + ',0)';
        el.style.opacity = '0';
      }, 16);
    }, 16);
  } else if (el.classList.contains('float')) {
    /* 悬浮态自动消失：淡出 + 轻微缩小。
       不能走 .out → tstOut —— 那个 keyframes 用 translate3d(0,-110%)，
       会和居中用的 translate(-50%,-50%) 抢 transform，先跳左上角再飞。 */
    el.classList.add('gone');
  } else {
    el.classList.add('out');
  }
  setTimeout(function () {
    try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e2) {}
  }, dir ? 320 : 260);
}

/* 兼容旧调用点：err() 语义是「出问题了」，走 err 级；setMsg 保持原行为 */
function err(m) { toast(m, 'err'); }
var setMsg = err;
/* 成功 / 提醒两条便捷入口 */
function okMsg(m) { toast(m, 'ok'); }
function warnMsg(m) { toast(m, 'warn'); }
  /* 触感反馈：能震就震，震不了静默 */
  function hf() { try { if (navigator && typeof navigator.vibrate === 'function') navigator.vibrate(8); } catch (e) {} }

  /* ── 桥调用 ── */
  /* 桥是同步阻塞接口，直接调用会卡住 WebView 主线程导致界面不重绘。
     统一延迟到下一帧再发，保证点击后界面立刻有反馈。
     【注意】这里用 setTimeout 而不是 requestAnimationFrame：
     rAF 在 WebView 被遮挡/悬浮窗/后台时会被暂停，一旦暂停桥调用就永远发不出去，
     表现为「点了按钮没任何反应」。setTimeout 只依赖主线程，不受可见性影响。 */
  function call(tool, params, kind, onOk) {
    var id = ++S.seq;
    if (kind) S.lastId[kind] = id;
    var fire0 = function () { callRaw(tool, params, kind, id, onOk); };
    setTimeout(fire0, 16);
  }
  function callRaw(tool, params, kind, id, onOk) {
    /* 页面已销毁：直接放弃，不发桥调用（否则报 JsEngine already destroyed） */
    if (!ALIVE) return;
    try {
      if (window.SBNative && typeof SBNative.call === 'function') {
        var ret = SBNative.call(JSON.stringify({ tool: tool, params: params || {}, kind: kind || '', id: id }));
        var fire = function (v) {
          if (!ALIVE) return;
          if (kind && S.lastId[kind] > id) return;
          var r = null; try { r = JSON.parse(v); } catch (eP) {}
          if (!r) { err('返回解析失败'); return; }
          /* silent：页面销毁期的桥调用，不打扰用户 */
          if (r.silent) return;
          if (r.success === false) { err(r.message || '工具返回失败'); }
          if (onOk) onOk(r, r.data || r); else window.__sbResult(v, kind, id);
        };
        if (ret && typeof ret.then === 'function') ret.then(fire, function (eE) {
          if (!ALIVE) return;
          onBridgeDrop(kind, eE);
        });
        else if (typeof ret === 'string' && ret) fire(ret);
        else err('桥无返回 tool=' + tool);
      } else err('桥未注入');
    } catch (e) {
      if (!ALIVE) return;
      onBridgeDrop(kind, e);
    }
  }
  /* 桥超时（20 秒硬上限）不代表后端停了：实测后端会继续跑完并把结果落盘。
     所以这里不弹错误、不把 advancing 置假，交给 trace 轮询接管。 */
  function onBridgeDrop(kind, e) {
    var m = String(e && e.message ? e.message : e);
    /* 【关键】JsEngine 已被宿主回收：页面还活着但桥死了，任何后续调用都会继续失败。
       这种情况不能弹红框吓用户 —— 他切回来页面自然会重建。
       同时立刻把 ALIVE 置 false，停掉所有定时器和轮询，不再继续撞桥。
       实测场景：游戏悬浮窗把 WebView 挂起，pagehide 没触发，但 JsEngine 被回收。 */
    if (/JsEngine|destroyed|detached|already/i.test(m)) {
      try { shutdown(); } catch (eS) {}
      return;
    }
    if (/timed? ?out|timeout/i.test(m)) {
      S.bridgeDropped = (S.bridgeDropped || 0) + 1;
      /* advance 桥断了：清掉 in-flight 标记，让轮询在读到 idle 后自动补推下一步 */
      if (kind === 'advance') S.advT = 0;
      setLive('桥已超时，后端仍在运行，等结果…');
      return;
    }
    if (kind === 'advance') S.advT = 0;
    err('桥调用失败：' + m);
  }
  window.__sbResult = function (json, kind, id) {
    var r; try { r = JSON.parse(json); } catch (e) { return; }
    var d = r.data || r;
    if (kind === 'list') {
      /* 【第八十三轮补丁C】群组清单跟列表一起回来，先存进 S.groupList，
         分组渲染时用来把 6 位群组码翻译成群组名。 */
      S.groupList = d.groups || r.groups || [];
      return renderList(d.items || r.items || d, true);
    }
    if (kind === 'tools') { d.loaded = true; S.tools = d; if (S.dlg) renderDlg($('dlgSearch').value || ''); return; }
    /* kind === 'chats' 分支已随「附带主对话上下文」功能一并移除：
       页面不再有对话选择入口，也就没有调用方会发 subagent_chats。 */
    if (kind === 'cfg') return renderCfg(d);
    if (kind === 'updCheck') return renderUpdCheck(r);
    if (kind === 'updDownload') return renderUpdDownload(r);
    if (kind === 'updStatus') return renderUpdStatus(d);
    if (kind === 'updInstall') return renderUpdInstall(r);
    /* 主页彩蛋的版本号：只写 eggVer，不碰配置页的 updCur */
    if (kind === 'eggVer') {
      var ev0 = (r && (r.data || r)) || {};
      if ($('eggVer')) $('eggVer').textContent = String(ev0.version || '');
      return;
    }
    if (kind === 'profiles') { return; }
    if (kind === 'inbox') return renderInbox(d);
    if (kind === 'inboxClear') { okMsg('已清空'); openInbox(); return; }
    if (kind === 'closeTask') { return; }
    if (kind === 'resume') {
      if (r && r.success === false) { err(r.message || '恢复失败'); return; }
      S.curStatus = 'running';
      toast((r && r.message) || '已恢复，开始生成', 'ok');
      /* 恢复后优先走流式（真逐字）；不通会自动降级到后端推进 */
      if (S.cur) setTimeout(function () {
        if (!ALIVE) return;
        startRun(S.cur);
      }, 160);
      return;
    }
    if (kind === 'cancel') {
      S.advancing = false;
      okMsg((r && r.message) || '已请求停止');
      if (S.cur) {
        /* 停止后立刻拉一次 trace：把已经产出的思考、正文、工具块都留在页面上，
           不能让用户觉得「点了停止，内容就没了」 */
        call('subagent:subagent_get', { id: S.cur, detail: 'trace', limit: 40 }, 'trace');
        /* 取消是异步生效的（后端下一步才认标记），再过一会儿补拉一次终态 */
        setTimeout(function () {
          if (S.cur && ALIVE) call('subagent:subagent_get', { id: S.cur, detail: 'trace', limit: 40 }, 'trace');
        }, 900);
      }
      refreshList(false);
      return;
    }
    if (kind === 'spawn') {
      if (d.task) {
        S.formDirty = false;
        S.curStatus = String(d.task.status || 'queued');
        refreshList(true);
        openTask(d.task.id);
        setLive('已创建，正在启动…');
        okMsg('任务已创建，正在推进…');
        /* 建完立刻走流式（真逐字）；任何不通都自动降级到后端推进，
           所以任务绝不会卡在 queued —— 这条保底就是上一轮删流式时缺的那块。 */
        setTimeout(function () {
          if (!ALIVE) return;
          startRun(d.task.id);
        }, 120);
      }
      else err(r.message || '创建失败');
      return;
    }
    if (kind === 'advance') {
      S.advancing = false;
      var at2 = (d && d.task) || {};
      var st2 = String(at2.status || '');
      if (st2) S.curStatus = st2;
      if (r && r.success === false) err(r.message || '推进失败');
      /* 拉最新明细回填（真源） */
      if (S.cur) call('subagent:subagent_get', { id: S.cur, detail: 'trace', limit: 40 }, 'trace');
      /* 只有 queued/running 才继续推；done/failed/cancelled 一律停手，
         绝不在这里调 resume，否则会把刚跑完的任务重置回 queued */
      if (st2 === 'queued' || st2 === 'running') {
        startPoll();
        /* 一次 advance 只跑一步；还有下一步就排一个短延迟续推。
           用 S.advT 统一管理这个定时器，切换任务/停止时能一次清干净 */
        try { clearTimeout(S.advT); } catch (e) {}
        S.advT = setTimeout(function () {
          if (!S.cur || S.page !== 'detail') return;
          advanceTask(S.cur, 1);
        }, 700);
      } else if (st2 === 'done') {
        stopPoll();
        setLive('');
        S.streaming = false;
        okMsg('任务已完成');
        refreshList(true);
      } else if (st2 === 'failed') {
        stopPoll();
        setLive('');
        S.streaming = false;
        err(at2.error || '任务失败');
        refreshList(true);
      } else if (st2 === 'cancelled') {
        stopPoll();
        setLive('');
        S.streaming = false;
        okMsg('任务已停止');
        refreshList(true);
      }
      return;
    }
    if (kind === 'steer') { okMsg('已发送'); setTimeout(function () { if (S.cur) call('subagent:subagent_get', { id: S.cur, detail: 'trace', limit: 40 }, 'trace'); }, 1200); return; }
    if (kind === 'trace' && d.turns) return renderTrace(d);
    if (kind === 'modelsRefreshed') {
      var mm = d.models || {};
      if (mm.ok === false) { err(mm.error || '拉取模型列表失败'); return; }
      fillModels(mm.models || [], !!mm.cached, mm.at || 0);
      if (mm.count) okMsg(mm.cached ? ('已载入 ' + mm.count + ' 个模型（缓存）') : ('已拉取 ' + mm.count + ' 个模型'));
      return;
    }
    if (kind === 'probe') {
      renderProbe(d);
      var pr = (d && d.probe) || {};
      var m = pr.models;
      if (pr.verdict) { if (pr.connected === true) okMsg(pr.verdict); else err(pr.verdict); }
      /* 探测顺带把模型列表拿回来，缓存进内存供下拉用 */
      if (m && m.models && m.models.length) fillModels(m.models, false, 0);
      return;
    }
    if (kind === 'privateWs') {
      var ws = (d && d.workspace) || '';
      if (ws) {
        $('inWs').value = ws;
        /* 工作目录文案要同步，否则按钮右边还写着「未选择」，看起来像没生效 */
        if ($('vWs')) $('vWs').textContent = '私有';
        okMsg('私有工作区已就绪');
      } else err('私有工作区创建失败');
      return;
    }
    if (kind === 'ls') return renderBrowse(d);
    if (kind === 'checkpath') {
      if (d.checked && !d.exists) { err('路径不存在：' + d.path); return; }
      if (d.workspace_guess) $('inWs').value = d.workspace_guess;
      doCreate();
      return;
    }
    if (kind === 'cfgset') {
      /* 失败分支已在 callRaw 里 err 过，这里必须拦住，否则会误报「已保存」
         并把 formDirty 清掉，让用户的输入被旧值覆盖 */
      if (r && r.success === false) return;
      okMsg('已保存'); S.formDirty = false;
      /* 【关键】配置变了必须清流式环境缓存。
         STREAM.ctx/key 一旦加载就永不失效，改完端点（比如 7878→9191 加了 CORS）
         不刷新页面还会一直用旧端点 → 旧端点没 CORS → 一直走中继 → 用户看到
         「明明配了 CORS 还不是流式」。 */
      try { STREAM.ctx = null; STREAM.key = ''; STREAM.relay = false; STREAM.fellBack = false; } catch (eS) {}
      call('subagent:subagent_cfg', { action: 'status' }, 'cfg');
      return;
    }
    /* 密钥写入后：不清空输入框、不重载表单，避免把用户正在填的端点/模型覆盖回旧值 */
    if (kind === 'cfgkey') {
      S.keySaving = false;
      if (r && r.success === false) { err(r.message || '写入失败'); return; }
      okMsg('密钥已保存');
      S.keyOk = true;
      S.keyFilled = true;
      if ($('cfgKey')) { $('cfgKey').textContent = '已配置'; $('cfgKey').className = 'cfg-val ok'; }
      syncCfgTip();
      return;
    }
  };

  /* ── 主页：会话列表 ── */
  /* 列表只在必要时向工具层要一次；TTL 内直接复用缓存，避免每次进/退都重读全部任务文件 */
  function refreshList(force) {
    var now = Date.now();
    if (!force && S.listAt && (now - S.listAt) < LIST_TTL) return;
    if (S.listBusy) return;
    S.listBusy = true;
    /* 桥无返回时解锁，避免永久卡死。定时器必须存引用：
       1) 成功返回后要清掉，否则它会误把 listAt 重置为 0（缓存永远失效）
       2) 页面销毁后不能再触发 */
    try { clearTimeout(S.listUnlockT); } catch (e) {}
    S.listUnlockT = setTimeout(function () {
      S.listUnlockT = null;
      if (!ALIVE) return;
      if (S.listBusy) { S.listBusy = false; }
    }, 5000);
    call('subagent:subagent_get', { all: true }, 'list');
  }
  /* ── 【第六十九轮】列表动画按需挂载 ──
     问题：.chat-row 的流光、头像呼吸、运行中脉冲都是无限循环动画，
     且写在伪元素上，每个卡片各一份。50 个卡片 = 200 个无限动画
     + 200 个常驻合成图层，WebView 内存直接爆。
     
     做法：动画声明移到 .chat-row.anim-on 下，这里用 IntersectionObserver
     只给进入视口（含 80px 预加载边）的行加类。出视口立刻移除，
     浏览器回收图层。视觉完全一样，图层数从「随行数增长」变「固定几个」。 */
  var _animObs = null;
  function _rowsOf(root) {
    var out = [];
    if (!root) return out;
    var all = root.querySelectorAll('.chat-row');
    for (var i = 0; i < all.length; i++) out.push(all[i]);
    return out;
  }
  function watchRowAnim(root) {
    var rows = _rowsOf(root);
    if (!rows.length) return;
    /* 兜底：老 WebView 没有 IntersectionObserver，直接全量开动画（等同旧行为） */
    if (typeof IntersectionObserver === 'undefined') {
      for (var k = 0; k < rows.length; k++) rows[k].classList.add('anim-on');
      return;
    }
    if (!_animObs) {
      _animObs = new IntersectionObserver(function (ents) {
        for (var i = 0; i < ents.length; i++) {
          var t = ents[i].target;
          if (!t || !t.classList) continue;
          if (ents[i].isIntersecting) t.classList.add('anim-on');
          else t.classList.remove('anim-on');
        }
      }, { root: null, rootMargin: '80px 0px', threshold: 0 });
    }
    /* 旧节点已随 innerHTML 重建而失效，先解绑再逐个观察 */
    try { _animObs.disconnect(); } catch (eOD) {}
    for (var j = 0; j < rows.length; j++) _animObs.observe(rows[j]);
  }

  function renderList(list, fromTool) {
    S.items = list || [];
    if (fromTool) { S.listAt = Date.now(); S.listBusy = false; try { clearTimeout(S.listUnlockT); S.listUnlockT = null; } catch (eLU) {} }
    /* 欢迎页：列表返回即记为已加载；动画完毕后进入主页 */
    if (fromTool && S.page === 'welcome') { S.initLoaded = true; if (S.initAnim) show('home'); }
    var box = $('homeList');
    var rbox = $('homeRecent');
    var boxUse = box && S.page === 'list' ? box : null;   // 列表页容器
    var target = boxUse || rbox;                          // 首屏只画最近任务
    if (!target) return;
    var kw = ($('listSearch') ? String($('listSearch').value || '').trim().toLowerCase() : '');
    var src = S.items;
    if (kw) {
      src = [];
      for (var q = 0; q < S.items.length; q++) {
        var it0 = S.items[q];
        var hay = ((it0.title || '') + ' ' + (it0.id || '') + ' ' + stCn(it0.status) + ' ' + (it0.last_text || '') + ' ' + (it0.group_name || it0.group || '') + ' ' + (it0.parent_chat_id || '')).toLowerCase();
        if (hay.indexOf(kw) >= 0) src.push(it0);
      }
    }
    if (!src.length) { target.innerHTML = '<div class="empty small">' + (kw ? '没有匹配的任务。' : '还没有任务，点右下 ＋ 新建一个。') + '</div>'; return; }
    /* 首屏（最近任务）保持平铺：只有 6 条，分组反而切割视线。
       列表页才是「按群组 / 按父 agent 分类」的完整视图。 */
    if (target === rbox) {
      var lim0 = src.slice(0, 6), h0 = '';
      for (var i0 = 0; i0 < lim0.length; i0++) h0 += taskRow(lim0[i0]);
      target.innerHTML = h0;
      watchRowAnim(target);
      syncMultiBar();
      return;
    }
    target.innerHTML = groupHtml(src, !!kw);
    watchRowAnim(target);   /* 【第六十九轮】只给视口内的行开装饰动画 */
    syncMultiBar();
  }

  /* 单条任务的 HTML。抽出来是因为分组渲染与首屏平铺共用同一套行结构，
     复制两份迟早会改花一份。 */
  function taskRow(it) {
    var picked = !!(S.multi && S.selIds && S.selIds[it.id]);
    var st = effStatus(it);
    /* 多选模式下整行点击 = 勾选，不进详情；勾选框只在多选时出现 */
    return '<div class="chat-row' + (S.multi ? ' multi' : '') + (picked ? ' picked' : '') + (st === 'interrupted' ? ' stale' : '') + '" data-act="' + (S.multi ? 'toggleSel' : 'open') + '" data-val="' + esc(it.id) + '">'
      + (S.multi ? '<span class="selbox">' + (picked ? '<svg><use href="#i-check"/></svg>' : '') + '</span>' : '')
      + '<div class="cr-avatar ' + (st === 'failed' ? 'f' : (st === 'running' ? 'r' : 'o')) + '">' + esc(String(it.title || it.id || '·').slice(0, 1)) + '</div>'
      + '<div class="cr-main"><div class="cr-top"><span class="cr-title">' + esc(it.title || it.id) + '</span><span class="cr-time">' + esc((it.last_at || it.created_at || '').slice(5, 16)) + '</span></div>'
      + '<div class="cr-sub"><span class="cr-status ' + st + '">' + stLabel(it) + '</span>'
      + (it.last_text || it.result_preview ? '<span class="cr-pv">' + esc(String(it.last_text || it.result_preview).slice(0, 50)) + '</span>' : '')
      + '</div></div>'
      + (S.multi ? '' : '<span class="cr-go"><svg><use href="#i-chev-r"/></svg></span>') + '</div>';
  }

  /* 【第八十三轮补丁C】群组分级渲染 + 群组详情 */
  /* 分组 key 形如 "g:263142" / "c:<chatId>" / "c:_"；
     只有 "g:" 前缀才是真群组，能查详情。 */
  function gc0(bucketKey) {
    var k = String(bucketKey || '');
    return k.slice(0, 2) === 'g:' ? k.slice(2) : '';
  }

  /* 权限位 → 中文短语。后端给的是数字掩码，直接显示数字用户看不懂。 */
  function permCn(mask) {
    var m = Number(mask || 0), out = [];
    if (m & 1) out.push('读');
    if (m & 2) out.push('写');
    if (m & 4) out.push('建');
    if (m & 8) out.push('删');
    if (m & 16) out.push('管');
    return out.length ? out.join(' ') : '无';
  }
  function permRole(mask) {
    var m = Number(mask || 0);
    if (m === 31) return '创始人';
    if (m === 3) return '受邀';
    if (m === 1) return '只读';
    return '自定义';
  }

  /* 群组详情：点分组头右侧的信息图标打开，走底部抽屉。
     里面给：群组码（可长按复制）、成员与权限位、黑名单、
     当前我的权限；有 KICK 位的还给剔除/解禁入口。 */
  function openGrpInfo(code) {
    var c = String(code || '');
    if (!c) return;
    call('subagent:subagent_group', { action: 'info', code: c }, 'grpInfo', function (r0, d) {
      /* callRaw 的 onOk 签名是 (r, d)。必须用第二参 d —— 第一参是外层
         {success, message, data}，直接读 r0.members 永远拿不到成员。 */
      var g = (d && (d.group || d)) || {};
      var mem = g.members || [], kicked = g.kicked || [];
      var mine = Number(g.my_mask != null ? g.my_mask : (g.mask || 0));
      var canManage = !!(mine & 16);
      var g0 = '<div class="gi-code"><div class="gi-code-k">群组码（长按复制给别的 agent）</div>'
        + '<input class="gi-code-v" readonly value="' + esc(c) + '"></div>'
        + '<div class="mi-grid">'
        + cell('名称', g.name || '-', true)
        + cell('我的权限', permCn(mine) + '（' + permRole(mine) + '）', true)
        + cell('状态', g.readonly ? '只读（无人可建）' : '正常', false)
        + cell('成员', String(mem.length) + ' 人', false)
        + '</div>';
      g0 += '<div class="mi-sec">成员</div>';
      for (var i = 0; i < mem.length; i++) {
        var m = mem[i] || {}, mid = String(m.chat_id || ''), mm = Number(m.mask || 0);
        g0 += '<div class="gi-row"><div class="gi-row-main"><div class="gi-row-t">'
          + esc(mid ? mid.slice(-12) : '（空）') + '</div><div class="gi-row-s">'
          + esc(permRole(mm)) + ' · ' + esc(permCn(mm)) + '</div></div>'
          + (canManage && mid !== String(g.founder || '')
            ? '<button class="gi-btn" data-act="grpKick" data-val="' + esc(c + '|' + mid) + '">剔除</button>' : '')
          + '</div>';
      }
      if (kicked.length) {
        g0 += '<div class="mi-sec">已剔除</div>';
        for (var j = 0; j < kicked.length; j++) {
          var kid = String(kicked[j] || '');
          g0 += '<div class="gi-row"><div class="gi-row-main"><div class="gi-row-t">'
            + esc(kid ? kid.slice(-12) : '（空）') + '</div><div class="gi-row-s">输入群组码也进不来</div></div>'
            + (canManage ? '<button class="gi-btn" data-act="grpUnkick" data-val="' + esc(c + '|' + kid) + '">解禁</button>' : '')
            + '</div>';
        }
      }
      if (!canManage) g0 += '<div class="gi-tip">你没有管理权限（KICK 位），只能查看。</div>';
      S.grpCur = c;
      openSheet('群组 ' + c, g0);
    });
  }

  /* 【第八十三轮补丁C】群组一级分类 + 无群组按父 agent 分组。
     规则（用户定）：
       1) 有群组的任务归到该群组，群组标题带群组名 + 码 + 成员权限提示
       2) 无群组的任务按 parent_chat_id 分组，标题只显示父对话原 ID 后 8 位
       3) 群组还没建对应任务时也显示（空群组不渲染，避免噪音）
     搜索时退化成平铺：结果跨组散落，分组反而难找。 */
  function groupHtml(src, searching) {
    if (searching || S.multi) {
      var hl = '';
      for (var i = 0; i < src.length; i++) hl += taskRow(src[i]);
      return hl;
    }
    var gmap = {}, order = [];
    function bucket(key, title, sub) {
      if (!gmap[key]) { gmap[key] = { key: key, title: title, sub: sub || '', items: [] }; order.push(key); }
      return gmap[key];
    }
    for (var j = 0; j < src.length; j++) {
      var it = src[j];
      var gc = String(it.group || '');
      if (gc) {
        var gi = null;
        for (var k = 0; k < (S.groupList || []).length; k++) { if (String(S.groupList[k].code || '') === gc) { gi = S.groupList[k]; break; } }
        var gname = gi && gi.name ? gi.name : ('群组 ' + gc);
        var gsub = gc + (gi && gi.readonly ? '｜只读' : '');
        bucket('g:' + gc, gname, gsub).items.push(it);
      } else {
        var pc = String(it.parent_chat_id || '');
        bucket('c:' + (pc || '_'), pc ? ('父对话 ' + pc.slice(-8)) : '无归属', pc ? pc : '').items.push(it);
      }
    }
    var html = '';
    for (var o = 0; o < order.length; o++) {
      var b = gmap['#' + order[o]];
      if (!b || !b.items.length) continue;
      html += '<div class="grp-head" data-act="foldGrp" data-val="' + esc(order[o]) + '">'
        + '<svg class="grp-chv' + (S.grpClosed && S.grpClosed[order[o]] ? ' closed' : '') + '" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>'
        + '<span class="grp-name">' + esc(b.title) + '</span>'
        + (b.sub ? '<span class="grp-code">' + esc(b.sub) + '</span>' : '')
        + '<span class="grp-n">' + b.items.length + '</span>'
        /* 群组头右侧的「详情」：只有真群组才给（父对话桶没有码可查） */
        + (gc0(order[o]) ? '<button class="grp-info" data-act="grpInfo" data-val="' + esc(gc0(order[o])) + '" title="群组详情"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.5"/></svg></button>' : '')
        + '</div>';
      if (!(S.grpClosed && S.grpClosed[order[o]])) {
        for (var m = 0; m < b.items.length; m++) html += taskRow(b.items[m]);
      }
    }
    return html;
  }

  /* ── 详情页：对话时间线 ── */
  function openTask(id) {
    S.cur = id; show('detail');
    var hit = null;
    for (var i = 0; i < S.items.length; i++) { if (S.items[i].id === id) { hit = S.items[i]; break; } }
    /* 【关键】进任务前先自愈：状态是终态但流式标记还挂着 = 上一轮没收尾。
       不清掉的话，下面所有 !STREAM.busy 判断都会跳过，内容区永远空白，
       而且「继续推进」会被 runCur 拦掉，用户只能刷新页面。 */
    var stPre = hit ? String(hit.status || '') : '';
    var termPre = (stPre === 'done' || stPre === 'failed' || stPre === 'cancelled' || stPre === 'closed');
    if (termPre && (STREAM.busy || S.streaming)) {
      abortStream();
      S.streaming = false;
    }
    /* 标题优先用任务描述；编号只是内部标识，不放到最上面给人看 */
    var ti = hit ? String(hit.title || '') : '';
    $('dtTitle').textContent = ti || '任务详情';
    $('dtStatus').textContent = hit ? stCn(hit.status) : '加载中…';
    if (ti) $('dtStatus').title = id;   // 编号挂在状态行 tooltip 上，需要时可查
    /* 刚创建的任务列表还没刷新回来时，别把已经设好的 queued/running 覆盖成空 */
    S.curStatus = hit ? String(hit.status || '') : String(S.curStatus || '');
    /* 有缓存先秒显，同时在后台刷新。
       注意：流式进行中不能清 dtChat —— holder 就在里面，清掉等于把正在输出的内容抹了。
       这是「创建任务后内容一直空白」的直接原因：spawn 后 120ms 启动流式，
       而 openTask 的 trace 回包常常晚于 120ms，一回包就 innerHTML 覆盖。 */
    if (S.traceCache && S.traceCache[id]) {
      if (!STREAM.busy) fillTrace(S.traceCache[id], true);
    } else if ($('dtChat') && !STREAM.busy) {
      $('dtChat').innerHTML = '<div class="scanline"></div>';
    }
    syncDtBar();
    call('subagent:subagent_get', { id: id, detail: 'trace', limit: 40 }, 'trace');
    /* 运行中/排队中的任务必须重启轮询：从主页、列表、收件箱切回来时
       pollOnce 早已因 page 不是 detail 而退出，不重启就永远停在拉取那一刻 */
    var stNow = String(S.curStatus || '');
    if (stNow === 'running' || stNow === 'queued') startPoll();
    /* 【关键】状态是 running 说明上一轮流式还没收尾（面板退出时后端仍是 running）。
       这时不能提示「待开始 / 请重新启动」—— 用户看到的就是「每次回来都让我重新启动」。
       正确做法：直接恢复界面，让用户看到已生成的部分，按钮显示「继续推进」即可。
       注意：不能把 S.advancing 置 true，那会让 syncDtBar 的
       canRun = !ended && !S.advancing && ... 恒为假，「继续推进」按钮直接消失。 */
    if (stNow === 'running') {
      setLive('上次的生成被中断，已保存已生成内容，点「继续推进」接着跑', true);
    }
  }
  /* 操作条：根据状态决定显示「继续推进」还是「停止」 */
  function syncDtBar() {
    var st = String(S.curStatus || '');
    var running = (st === 'running');
    var queued = (st === 'queued');
    var ended = (st === 'done' || st === 'closed');
    /* 结束（done/closed）就彻底收尾：不显示推进、不显示停止、不显示输入框。
       子代理产出结论即任务终止；追问由主代理调用 subagent_resume 完成。 */
    /* 【关键】running 也要允许「继续推进」：面板退出时后端停在 running，
       用户回来看到的应该是「继续推进」而不是死等。真正的流式进行中会被
       runCur 的 STREAM.busy 守卫挡住，不会重复启动。 */
    var canRun = !ended && !S.advancing && (st === 'queued' || st === 'failed' || st === 'cancelled' || st === 'running');
    if ($('btnRun')) $('btnRun').style.display = canRun ? '' : 'none';
    if ($('btnStop')) $('btnStop').style.display = (running || queued) ? '' : 'none';
    /* 输入框：用户可手发消息的入口整个移除，追问走主代理 */
    if ($('dtCompose')) $('dtCompose').style.display = 'none';
    if (running || queued) setLive(phaseText(st), true);
    else setLive('', true);
    if ($('dtBar')) $('dtBar').style.display = (canRun || running || queued) ? '' : 'none';
    /* 状态行同步刷新：运行中立刻显示「运行中」，不会停在「待开始」 */
    syncDtStatusText(st);
  }
  /* 状态行文案：标题栏下方那一行，和按钮状态保持一致 */
  function syncDtStatusText(st) {
    var el = $('dtStatus'); if (!el) return;
    var bits = [stCn(st || S.curStatus || '')];
    var d = S.trace || null;
    if (d && (d.step || d.max_steps)) bits.push('第 ' + (d.step || 0) + '/' + (d.max_steps || '?') + ' 步');
    if (S.advancing && (st === 'running' || st === 'queued')) bits.push(phaseText(st));
    /* 通道诊断：把「走的直连还是中继、读到几块」显示出来。
       用户排查流式时最需要这一行 —— 之前全靠猜。
       chunks=1 就是假流式（整包一次到）；reader=no 就是 WebView 不支持 response.body。 */
    if (STREAM && STREAM.diag) bits.push(STREAM.diag);
    el.textContent = bits.join(' · ');
    if (STREAM && STREAM.lastDirectErr) el.title = '直连错误：' + STREAM.lastDirectErr;
  }
  /* 阶段文案：后端每步都会写 phase，轮询拿到的就是真实进度 */
  function phaseText(st) {
    if (st === 'queued') return '已创建，准备开始…';
    var ph = String(S.curPhase || 'idle');
    if (ph === 'llm') return '模型生成中…';
    if (ph === 'tool') return '正在执行 ' + (S.curToolNow || '工具') + '…';
    if (ph === 'idle') return S.advancing ? '模型生成中…' : '等待下一步…';
    return '运行中…';
  }
/* 统一运行入口：优先流式，流式不通自动降级到后端推进。
     所有「开始跑」的地方都必须走这里，不要直接调 advanceTask ——
     直接调会绕过流式；只走流式又会因端点限制卡死。走这里两头都有保底。 */
  function startRun(id) {
    id = String(id || S.cur || '');
    if (!id) { err('没有选中的任务'); return; }
    /* 已经在流式中就不重复起 */
    if (STREAM.busy) return;
    streamChat({ taskId: id });
  }

  /* 手动点「继续推进」：优先流式，不通则降级后端推进 */
   function runCur() {
     if (!S.cur) { err('没有选中的任务'); return; }
     var st = String(S.curStatus || '');
     /* 【关键】running 不再直接拒绝。面板退出时后端会停在 running（流式没走完），
        用户回来点「继续推进」应该能接着跑，而不是被一句「任务正在运行」挡死。
        真正的流式进行中由下面 STREAM.busy 守卫拦住，不会重复启动。 */
     if (st === 'running' && !S.streaming && !STREAM.busy) {
       /* 后端说 running 但前端没有流式在跑 = 上一轮被中断。
          有 pending（已生成一部分）时先把它落成正式 turn，再重开新一轮，
          否则重跑会从头发一遍，和已生成的内容叠起来越滚越大。 */
       var pend = (S.trace && S.trace.pending) ? S.trace.pending : null;
       if (pend && (pend.think || pend.body)) {
         var keep = { role: 'assistant', content: String(pend.body || '') };
         if (pend.think) keep.reasoning = String(pend.think);
         call('subagent:subagent_save_turn', { id: S.cur, turns: [keep], done: false }, 'saveTurn', function () {
           startRun(S.cur);
         });
         return;
       }
       startRun(S.cur);
       return;
     }
     /* 【关键】状态已是终态但 streaming 标记还挂着 = 上一轮流式没正常收尾。
         这时不能直接拦，否则用户点多少次都没反应，只能刷新页面。
         判据：后端状态是终态（不在 running/queued），前端却还认为在流式 → 标记已失效。
         强制收掉残留，让本次点击能正常走。 */
     if (S.streaming || STREAM.busy) {
       var terminal = (st === 'done' || st === 'failed' || st === 'cancelled' || st === 'closed' || !st);
       if (terminal) {
         abortStream();
         S.streaming = false;
       } else {
         err('正在生成中');
         return;
       }
     }
     /* 先把任务拉回可推进的状态（后端只改状态，不跑模型），再开跑 */
     var start = function () {
       startRun(S.cur);
     };
     if (st === 'cancelled' || st === 'failed' || st === 'done' || st === 'queued') {
       call('subagent:subagent_ctrl', { id: S.cur, action: 'resume' }, 'resume', function () {
         start();
       });
     } else {
       start();
     }
   }
  /* 实时提示条：告诉用户在等模型，不是在卡死。
   fromPoll=true 表示这次是轮询侧（syncDtBar）写进来的，流式进行中一律忽略 ——
   否则流式正在输出时，trace 回包会把「模型生成中…」改成「等待下一步…」
   （S.advancing 在流式路径是 false）。流式自己的写入不传这个参数，永远生效。 */
  function setLive(txt, fromPoll) {
    if (!$('dtLive')) return;
    if (fromPoll && STREAM.busy && S.streaming) return;
    if (txt) {
      $('dtLive').style.display = '';
      if ($('dtLiveTxt')) $('dtLiveTxt').textContent = txt;
    } else {
      $('dtLive').style.display = 'none';
    }
  }
  /* 停止：给任务打取消标记，下一轮 advance 会把它置为 cancelled */
  function stopCur() {
    if (!S.cur) return;
    /* 一次性清干净：续推定时器、轮询、流式都要停，否则取消后又被推起来 */
    try { clearTimeout(S.advT); } catch (e) {}
    S.advT = null;
    stopPoll();
    abortStream();
    S.advancing = false;
    okMsg('已请求停止');
    /* 停止后主动拉一次 trace：把后端真实状态（cancelled）取回来。
       不这么做的话，界面会停在「模型生成中…」，因为轮询已经停了，
       没有任何东西再去读后端状态。 */
    call('subagent:subagent_ctrl', { id: S.cur, action: 'cancel' }, 'cancel', function () {
      if (S.cur) call('subagent:subagent_get', { id: S.cur, detail: 'trace', limit: 40 }, 'trace');
    });
  }
var SVG_CHEV = '<svg class="chv" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
  var SVG_OK = '<svg class="okmark" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg>';
  var SVG_CORNER = '<svg class="corner" viewBox="0 0 24 24"><path d="M6 4v9a3 3 0 0 0 3 3h9"/><path d="M14 12l4 4-4 4"/></svg>';
  var SVG_BAD = '<svg class="okmark bad" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  function fmtMs(ms) {
    var n = Number(ms || 0);
    if (!n) return '-';
    if (n < 1000) return n + ' ms';
    return (n / 1000).toFixed(n < 10000 ? 2 : 1) + ' s';
  }
  function fmtTime(t) {
    var n = Number(t || 0);
    if (!n) return '-';
    var d = new Date(n);
    function p(x) { return x < 10 ? '0' + x : '' + x; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function fmtJson(s) {
    var v = String(s == null ? '' : s);
    if (!v) return '';
    try { return JSON.stringify(JSON.parse(v), null, 2); } catch (e) { return v; }
  }
  function briefJson(s, n) {
    var v = String(s == null ? '' : s);
    if (!v) return '';
    var line = v.replace(/\s+/g, ' ');
    if (line.length > (n || 60)) line = line.slice(0, n || 60) + '…';
    return line;
  }

  /* 折叠行 + 展开体 */
  function foldRow(cls, text, bodyHtml, idx) {
    return '<div class="fold ' + cls + '" data-act="fold"><svg class="chv" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg><div class="fold-tx">' + text + '</div></div>'
      + '<div class="fold-body" data-fold-body="' + idx + '">' + bodyHtml + '</div>';
  }
  function kv(k, v) { return '<div class="kv"><b>' + esc(k) + '</b><span>' + esc(v) + '</span></div>'; }

  /* 三态切换（2026-11-07 用户定稿，第二十八轮）
   【历史】这个三态 6df560b 做过并能用，4ddd34a 被我删成两态。现在恢复。
   0 = 收起 / 流式中：限高 120px，容器内滚，自动贴底（跟手）
   1 = 部分展开：限高 320px，容器内滚，不自动滚
   2 = 全部展开：不限高，滚动交给整页，不自动滚
   高度挂在 .thk-body 的 h1/h2 class（沿用原版，与 data-state 解耦），
   data-state 只管箭头与角标文案。 */
  /* 【第五十八轮】单击在 0/1 之间切（收起/展开）；双击直接进 2（全展开） */
  var THINK_TIPS = ['展开', '收起', '收起'];
  function setThinkState(tb, st) {
    if (!tb) return;
    var n = (st === 1 || st === 2) ? st : 0;
    /* 【第七十一轮】先取旧档位，thk-in 只在「从 0 升起」时播。
       之前每次切档都 remove 再 add thk-in，1↔2 之间也重播淡入上浮，
       观感就像整块内容重新加载了一遍（用户说「再点一下会重新刷新一次页面」）。 */
    var prev = parseInt(tb.getAttribute('data-state') || '0', 10) || 0;
    tb.setAttribute('data-state', String(n));
    /* 高度 class：0 档两个都不加，1 档 h1，2 档 h2 */
    var body = tb.querySelector('.thk-body');
    if (body && body.classList) {
      if (n === 0) body.classList.remove('h1', 'h2');
      else if (n === 1) { body.classList.remove('h2'); body.classList.add('h1'); }
      else { body.classList.add('h2'); }
    }
    var tip = tb.querySelector('.thk-tip');
    if (tip) tip.textContent = THINK_TIPS[n];
    /* 【第六十三轮】展开浮入：不再用 void offsetWidth 强制同步回流。
       强制回流会让每次点击都触发一次全文档布局，内容多时明显卡。
       改用双 rAF：下一帧再加类，浏览器自然分帧，不用同步取布局。 */
    if (body && body.classList) {
      body.classList.remove('thk-in');
      /* 只在 0 → 非0 的首次升起时播浮入；1↔2 互切、收起都不播 */
      if (n !== 0 && prev === 0) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (body.isConnected) body.classList.add('thk-in');
          });
        });
      }
    }
    /* 只有 0 档自动跟到底；1/2 档是用户主动展开的，不抢他的滚动位置 */
    if (n === 0) thinkScrollBottom(tb);
    syncThinkFloat();
  }
  /* 把思考容器滚到底。0 档可滚（限高 120px）；1/2 档不抢位置。 */
  function thinkScrollBottom(tb) {
    try {
      var body = tb.querySelector('.thk-body');
      if (body) body.scrollTop = body.scrollHeight;
      else if (tb.classList && tb.classList.contains('sb-think')) tb.scrollTop = tb.scrollHeight;
    } catch (e) {}
  }
  /* 悬浮按钮在有任何非收起档（1 或 2）的思考块时显示，方便滑到深处一键收回 */
  function syncThinkFloat() {
    var host = $('dtChat');
    if (!host) return;
    var box = $('thinkFloat');
    if (!box) return;
    var any1 = host.querySelector ? host.querySelector('.thinkbox:not([data-state="0"])') : null;
    box.style.display = any1 ? '' : 'none';
  }
  /* 收起所有非收起档的思考块（悬浮按钮入口） */
  function collapseThinkAll() {
    var host = $('dtChat');
    if (!host || !host.querySelectorAll) return;
    var boxes = host.querySelectorAll('.thinkbox:not([data-state="0"])');
    for (var i = 0; i < boxes.length; i++) setThinkState(boxes[i], 0);
  }
  /* 渲染后统一把 0 档思考块滚到底部 + 刷新悬浮按钮显隐。
   【为什么必须有】历史消息每次重新渲染（切换任务、轮询刷新）都会重建 DOM，
   重建后的 .thk-body 滚动位置回到顶部。0 档只有 120px 高，
   不贴底就永远看到最上面那几行，用户会以为内容没写完。 */
  function syncThinkScroll() {
    try {
      var host = $('dtChat');
      if (host && host.querySelectorAll) {
        var boxes = host.querySelectorAll('.thinkbox');
        for (var i = 0; i < boxes.length; i++) {
          if (boxes[i].getAttribute('data-state') === '0') {
            var b = boxes[i].querySelector('.thk-body');
            if (b) b.scrollTop = b.scrollHeight;
          }
        }
      }
    } catch (e) {}
    try { syncThinkFloat(); } catch (e2) {}
  }
  /* 【第五十七轮】工具行：两个可点区域，两个不同行为。
     用户要求：
       - 点「工具调用文本」→ 看 agent 是怎么调用的（参数）
       - 点「工具返回预览」→ 屏幕中心弹窗看返回全文（可下滑）
     失败的工具：名称、参数、返回预览全部红字提示。 */
  /* 【第六十四轮】工具行唯一序号。
     为什么不用 tc.id / tc.name 当键：同一轮里可以有两条同名工具（比如两次 read_file 都失败），
     用名字做键会互相覆盖，后者把前者顶掉 —— 用户点第一条，弹出来的却是第二条的内容。
     用递增序号做键，再写到节点的 data-tsq 上，点击时按序号精确取。 */
  var TOOL_SEQ = 0;
  function toolRow(tc, res) {
    var okk = !res || (res.ok !== false);
    var tsq = ++TOOL_SEQ;
    var key = String(tc.id || tc.name || '');
    S._toolBySeq = S._toolBySeq || {};
    S._toolBySeq[String(tsq)] = { call: tc, res: res || null };
    var brief = tc.args ? briefJson(tc.args, 56) : '';
    var peek = '';
    if (res) {
      var txt = res.result != null ? String(res.result) : (res.error != null ? String(res.error) : '');
      var flat = txt.replace(/\s+/g, ' ').trim();
      /* 返回预览：弯折箭头 + 首行摘要。点它开返回弹窗。 */
      peek = '<div class="tb-peek" data-act="retOpen" data-tool="' + esc(key) + '" data-tsq="' + tsq + '">'
        + '<svg class="tb-corner" viewBox="0 0 24 24"><path d="M5 3v9a3 3 0 0 0 3 3h10"/><path d="M14 11l4 4-4 4"/></svg>'
        + '<span class="tb-peektxt">' + esc(flat) + '</span>'
        + '</div>';
    }
    /* 调用行：点它看参数（agent 怎么调用的） */
    return '<div class="trowc' + (okk ? '' : ' bad') + '" data-tool="' + esc(key) + '" data-tsq="' + tsq + '">'
      + '<div class="trow" data-act="callShow" data-tool="' + esc(key) + '" data-tsq="' + tsq + '">'
      + '<svg class="trow-ico" viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-2.1 2.6-2.4z"/></svg>'
      + '<span class="trow-name">' + esc(tc.name) + '</span>'
      + (brief ? '<span class="trow-args">' + esc(brief) + '</span>' : '')
      + '<span class="trow-st">' + (res ? (okk ? SVG_OK : SVG_BAD) : '<span class="trow-dot"></span>') + '</span>'
      + '</div>'
      + (res ? peek : '')
      + '</div>';
  }

  var FOLD_SEQ = 0;
  function renderTrace(d) {
    S.cur = d.id || S.cur;
    S.trace = d;
    S.curStatus = String(d.status || '');
    S.curPhase = String(d.phase || 'idle');
    S.curToolNow = String(d.tool_now || '');
    /* 缓存一份，二次进入秒显 */
    if (!S.traceCache) S.traceCache = {};
    if (d.id) {
      S.traceCache[d.id] = d;
      /* 缓存上限：每个 trace 含全部轮次+工具结果，不设上限会持续吃内存。
         只留最近 5 个任务，超出的按插入顺序淘汰最旧的。 */
      var _keys = Object.keys(S.traceCache);
      if (_keys.length > 5) {
        for (var _i = 0; _i < _keys.length - 5; _i++) {
          if (_keys[_i] !== d.id) delete S.traceCache[_keys[_i]];
        }
      }
    }
    fillTrace(d, false);
    syncDtBar();
    /* 轮询读到终态就停手：避免 advance 回包和轮询各推一次造成重复推进 */
    var st = String(d.status || '');
    if (st === 'done' || st === 'failed' || st === 'cancelled' || st === 'closed') {
      stopPoll();
      S.advancing = false;
      /* 【关键】终态必须无条件收干净，不能只在 STREAM.busy 时收。
         原来写成 if (STREAM.busy) { abortStream(); S.streaming = false; }，
         当流式早已退出（busy 已 false）但 S.streaming 还是 true 时，
         这个 if 不成立 → setLive('') 永远不执行 → live 停在「模型生成中…」，
         而状态行已经显示「已停止」。用户看到的就是自相矛盾的僵尸界面。 */
      if (STREAM.busy) abortStream();
      S.streaming = false;
      setLive('');
      /* 终态后清指纹，确保下一次进入能重绘 */
      S.chatSig = null;
    } else if (S.bridgeDropped > 0) {
      /* 桥已超时（20s 硬限）→ 这轮 advance 请求已不可达，后端还在跑由轮询盯着。
         必须清 advancing，否则 syncDtBar 的
         canRun = !ended && !S.advancing && (queued|failed|cancelled)
         永远为假 → 「继续推进」按钮永久消失，只能刷新页面才恢复。
         清掉是安全的：真在跑时 status 仍是 running，canRun 也不会亮。 */
      S.advancing = false;
    }
  }
  function fillTrace(d, fromCache) {
    FOLD_SEQ = 0;
    /* 标题：优先任务描述；没有就显示「任务详情」，绝不把编号顶在最上面 */
    var ti = String(d.title || '').trim();
    $('dtTitle').textContent = ti || '任务详情';
    $('dtStatus').title = d.id || '';
    /* 状态行：状态 · 步数 · 时间，编号只在 tooltip 里 */
    var bits = [stCn(d.status)];
    if (d.step || d.max_steps) bits.push('第 ' + (d.step || 0) + '/' + (d.max_steps || '?') + ' 步');
    if (d.updated_at) bits.push(d.updated_at.slice(5, 16));
    if (fromCache) bits.push('缓存');
    $('dtStatus').textContent = bits.join(' · ');
    var turns = d.turns || [], h = '';
    /* 先把 tool 结果按 tool_call_id 建索引，保证返回紧跟调用 */
    var resById = {}, resQueue = [];
    /* 【第六十四轮】重渲染前清空工具序号表，否则每刷新一次就累积 */
    S._toolBySeq = {};
    for (var r0 = 0; r0 < turns.length; r0++) {
      if (turns[r0].role === 'tool') {
        resQueue.push(turns[r0]);
        var cid = String(turns[r0].tool_call_id || turns[r0].calls_id || '');
        if (cid) resById[cid] = turns[r0];
      }
    }
    var usedRes = {};

    /* 【第六十轮】整段连续的 AI 输出合成一个卡片。
       用户原话（连喊十几个「一个」）：「工具调用，思考内容全没了，一个卡片」
       之前每条 turn 各自生成一个 .agent-block，一轮 25 步就被切成 25 个卡片。
       现在：从第一条 assistant 到最后一个 tool，共用一个 .agent-block，
       内部依次排列「思考过程」段 → 工具调用段 → 正文段，全部同一张卡。 */
    /* 【第六十一轮】按任务状态决定默认展开还是收起。
       用户原话：「这个是一个已经完成的任务，为什么不收起？」
       运行中要展开看实时进展；已结束就收起来，别撑满一屏。 */
    var live = (d.status === 'running' || d.status === 'queued');
    var stInit = live ? '1' : '0';
    var blkOpen = false;
    function openBlk() {
      if (!blkOpen) { h += '<div class="agent-block">'; blkOpen = true; }
    }
    function closeBlk() {
      if (blkOpen) { h += '</div>'; blkOpen = false; }
    }
    for (var i = 0; i < turns.length; i++) {
      var m = turns[i];
      if (m.role === 'assistant') {
        var hasThink = !!m.reasoning;
        var t = m.tool_calls || [];
        var hasTool = t.length > 0;

        /* 有思考或工具 → 先开卡（已在卡内就复用） */
        if (hasThink || hasTool) openBlk();

        if (hasThink) {
          var tid = ++FOLD_SEQ;
          h += '<div class="thinkbox thk-sec" data-think="' + tid + '" data-state="' + stInit + '">'
            + '<div class="thk-head"><svg class="chv" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>'
            + '<span class="thk-tx">思考过程</span>'
            + '<span class="thk-tip">展开</span>'
            + '</div>'
            + '<div class="thk-body" data-thk-body="' + tid + '">'
            + '<div class="agent-think">' + esc(m.reasoning) + '</div>'
            + '</div>'
            + '</div>';
        }
        if (hasTool) {
          var tid2 = ++FOLD_SEQ;
          h += '<div class="thinkbox toolcard thk-sec" data-think="' + tid2 + '" data-state="' + stInit + '">'
            + '<div class="thk-head"><svg class="chv" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>'
            + '<span class="thk-tx">工具调用</span>'
            + '<span class="tool-count">(' + t.length + ')</span>'
            + '<span class="thk-tip">展开</span>'
            + '</div>'
            + '<div class="thk-body" data-thk-body="' + tid2 + '">';
          for (var j = 0; j < t.length; j++) {
            var tc = t[j];
            var res = resById[String(tc.id || '')];
            if (!res) {
              for (var q = 0; q < resQueue.length; q++) {
                if (!usedRes[q]) { res = resQueue[q]; usedRes[q] = 1; break; }
              }
            } else {
              for (var q2 = 0; q2 < resQueue.length; q2++) if (resQueue[q2] === res) usedRes[q2] = 1;
            }
            S._toolMap = S._toolMap || {};
            S._toolMap[String(tc.id || tc.name)] = { call: tc, res: res || null };
            h += toolRow(tc, res);
          }
          h += '</div></div>';
        }

        /* 正文也放进同一张卡：不再单独用 .bubble */
        if (m.content) {
          openBlk();
          h += '<div class="agent-text">' + md(m.content) + '</div>';
        }
        /* 这一条什么都没产出（空 assistant）就收卡，避免残留空壳 */
        if (!hasThink && !hasTool && !m.content) closeBlk();
      } else if (m.role === 'tool') {
        /* 已被调用块吸收的不再单独渲染 */
        var idx = resQueue.indexOf(m);
        if (idx >= 0 && usedRes[idx]) continue;
        openBlk();
        h += '<div class="thinkbox toolcard thk-sec" data-state="' + stInit + '">'
          + '<div class="thk-body">'
          + toolRow({ name: m.name || 'tool', args: null }, m)
          + '</div></div>';
        S._toolMap = S._toolMap || {};
        S._toolMap[String(m.name || 'tool')] = { call: null, res: m };
      } else if (m.role === 'user') {
        closeBlk();
        h += '<div class="bubble mine"><div class="b-body">' + esc(m.content) + '</div></div>';
      }
    }
    /* 【第六十轮】循环结束，把未收的卡片收掉 */
    closeBlk();
    /* 【关键】pending = 流式过程中临时落盘、还没收尾的内容。
       用户退出面板再进来时，这些内容不在 turns 里（还没落正式 turn），
       不补的话界面上就什么都没有，用户以为丢了、只能重新点启动 —— 这就是
       「每次回来都让我重新启动、内容越叠越大」的根源。
       这里把 pending 渲染成一条「生成中」的临时气泡，只显示不落盘。 */
    if (d.pending && (d.pending.think || d.pending.body)) {
      if (d.pending.think) {
        h += '<div class="thinkbox" data-think="p1" data-state="0">'
          + '<div class="thk-head"><svg class="chv" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>'
          + '<span class="thk-tx">思考过程（生成中）</span><span class="thk-tip">展开</span></div>'
          + '<div class="thk-body" data-thk-body="p1">' + esc(d.pending.think) + '</div>'
          + '</div>';
      }
      if (d.pending.body) {
        h += '<div class="bubble ai"><div class="b-body md-body" data-type="1">' + md(d.pending.body) + '</div></div>';
      }
      h += '<div class="streambox" data-pending="1"><div class="sb-think" data-state="0" style="display:none"></div>'
        + '<div class="sb-body md-body" style="opacity:.55">（已暂停，点「继续推进」接着生成）</div></div>';
    }
    /* 【关键】流式进行中绝不能重建 dtChat。
       原逻辑每次轮询（1.5s）都 innerHTML = h 全量重建整个消息区：
       1) 流式气泡就在 dtChat 里，被一起清掉 → 用户看不到流式，只有结束才突然出现
       2) 每次重建导致滚动位置、输入框焦点、思考块展开状态全丢 → 用户看到「一直跳动」
       所以流式期间只更新状态行，DOM 交给流式自己增量维护。

       另外：内容没变化时也不重建。轮询 1.5s 一次，任务可能好几分钟没新内容，
       每次都重写 DOM 就是纯浪费，还会把用户手动展开的思考块弹回去。
       用整串 HTML 做等值比较（几 KB 字符串比较，比 DOM 重建便宜几个量级）。 */
    var _h = h || '<div class="empty">还没有内容。点「继续推进」开始。</div>';
    if (!STREAM.busy && _h !== S.chatSig) {
      /* 【展开态保持】重建前按「第几个思考块」记录档位，重建后还原。
         内容一变就重建（新增一步、工具返回），不记录的话用户刚展开的块立刻被弹回收起。
         用序号而不是内容做 key：同一任务里思考块顺序稳定，内容会变（流式追加）。 */
      var _keep = {};
      try {
        var _oldBoxes = $('dtChat') ? $('dtChat').querySelectorAll('.thinkbox') : [];
        for (var _ki = 0; _ki < _oldBoxes.length; _ki++) {
          var _ks = _oldBoxes[_ki].getAttribute('data-state') || '0';
          if (_ks !== '0') _keep[_ki] = _ks;
        }
      } catch (eK) {}
      S.chatSig = _h;
      $('dtChat').innerHTML = _h;
      /* 还原：只对非 0 档调用 setThinkState，0 档交给 syncThinkScroll 统一贴底 */
      try {
        if (_keep) {
          var _newBoxes = $('dtChat') ? $('dtChat').querySelectorAll('.thinkbox') : [];
          for (var _kj in _keep) {
            if (!Object.prototype.hasOwnProperty.call(_keep, _kj)) continue;
            var _bi = parseInt(_kj, 10);
            if (_newBoxes[_bi]) setThinkState(_newBoxes[_bi], parseInt(_keep[_kj], 10) || 0);
          }
        }
      } catch (eR) {}
    }
    /* 思考块默认 0 档，渲染后统一滚到底跟随最新输出 */
    syncThinkScroll();
    var u = d.usage || {};
    /* 流式期间状态行以后端 trace 为准会显示「待开始」——
       因为流式是前端在跑，后端任务还没推进。这时用流式状态覆盖。 */
    var _stShown = d.status;
    if (STREAM.busy && (d.status === 'queued' || !d.status)) _stShown = 'running';
    var st = '<span class="chip ' + (_stShown || '') + '">' + stCn(_stShown) + '</span><span class="chip">step ' + esc(d.step) + '</span><span class="chip" title="累计输入+输出 token">' + ((u.in || 0) + (u.out || 0)) + ' tok</span>';
    $('dtStatus').innerHTML = st;
    $('dtClose').style.display = (d.status === 'queued' || d.status === 'running' || d.status === 'failed') ? '' : 'none';
    S.dStatus = d.status;
    S.dFailed = (d.status === 'failed');
  }

  /* ══ 非流式推进说明 ══
    早期版本让页面 fetch 直连模型端点做 SSE 流式。放弃它的原因（实测）：
    1) 页面 origin 是 https://localhost，端点若是 http 会被混合内容策略直接拦；
    2) 端点 https 但没回 access-control-allow-origin 时同样被 CORS 拦。
    这两条一旦命中，请求根本没发出去，任务就永远停在 queued，模型一次都不会被调用
    —— 这正是「1+1 要思考好久」的真相：它不是慢，是从来没跑。
    现在统一走后端 subagent_advance：模型调用、工具执行、逐步落盘全在后端完成，
    页面只用 trace 轮询显示。牺牲逐字效果，换来确定能跑起来。 */

/* 停止生成：清掉续推定定时器与轮询，并给任务打取消标记。
     注意：这里还有一份完整版在文件后面（含清占位块、清 STREAM.abort），
     由于函数声明提升，实际生效的是后面那份。保留这一行是为了不破坏调用顺序。 */

  function sendMsg() {
    var inp = $('dtInput'); var v = (inp.value || '').trim(); if (!v) return;
    if (!S.cur) { err('先选一个任务'); return; }
    if (S.dFailed) { err('任务已失败，无法继续对话'); return; }
    inp.value = '';
    call('subagent:subagent_ctrl', { id: S.cur, action: 'steer', message: v }, 'steer');
  }

  /* ── 详情抽屉（消息信息：模型/时间/耗时/用量） ── */
  function cell(k, v, wide, mono) {
    return '<div class="mi-cell' + (wide ? ' wide' : '') + '"><div class="mi-k">' + esc(k) + '</div><div class="mi-v' + (mono ? ' mono' : '') + '">' + esc(v == null || v === '' ? '-' : v) + '</div></div>';
  }
  function openSheet(title, html) {
    $('sheetTitle').textContent = title;
    $('sheetBody').innerHTML = html;
    $('sheet-mask').classList.add('on');
    $('sheet').classList.add('on');
  }
  function closeSheet() { $('sheet-mask').classList.remove('on'); $('sheet').classList.remove('on'); }

  /* 工具调用弹窗：一次点开就看到参数 + 完整返回，不做二级展开 */
  /* 【第五十六轮】返回详情：屏幕正中弹窗。
     用户要「整个屏幕中心出现一个弹窗，告诉你返回了什么东西」。
     入：name 工具名，body 返回全文原文
     出：无（直接操作 DOM） */
  function openRetDlg(name, body) {
    var m = $('retMask'), d = $('retDlg');
    if (!m || !d) return;
    var nm = $('retName');
    if (nm) nm.textContent = String(name || '返回');
    var bd = $('retBody');
    if (bd) { bd.textContent = String(body == null ? '' : body); bd.scrollTop = 0; }
    m.classList.add('on'); d.classList.add('on');
  }
  /* 【第五十七轮】工具调用参数：屏幕中心弹窗，看 agent 是怎么调用的。
     入：name 工具名，args 参数（对象或 JSON 字符串）
     出：无 */
  function openCallDlg(name, args) {
    var m = $('retMask'), d = $('retDlg');
    if (!m || !d) return;
    var nm = $('retName');
    if (nm) nm.textContent = String(name || '工具') + ' · 调用参数';
    var bd = $('retBody');
    if (bd) {
      var t = '';
      try {
        if (args == null) t = '(无参数)';
        else if (typeof args === 'string') {
          try { t = JSON.stringify(JSON.parse(args), null, 2); } catch (e1) { t = args; }
        } else t = JSON.stringify(args, null, 2);
      } catch (e2) { t = String(args); }
      bd.textContent = t;
      bd.scrollTop = 0;
    }
    m.classList.add('on'); d.classList.add('on');
  }
  function closeRetDlg() {
    var m = $('retMask'), d = $('retDlg');
    if (m) m.classList.remove('on');
    if (d) d.classList.remove('on');
  }

  function openToolDlg(key) {
    var rec = (S._toolMap || {})[String(key || '')];
    if (!rec) { err('找不到该调用记录'); return; }
    var c = rec.call || {}, r = rec.res || null;
    var g = '';
    g += '<div class="mi-grid">'
      + cell('工具', c.name || (r && r.name) || '-', false, true)
      + cell('状态', r ? (r.ok === false ? '失败' : '成功') : '无返回', false, false)
      + cell('耗时', fmtMs(r && r.elapsed_ms), false, true)
      + '</div>';
    if (c.args) g += '<div class="mi-sec">参数</div><div class="mi-block">' + esc(fmtJson(c.args)) + '</div>';
    if (r && r.result) g += '<div class="mi-sec">返回</div><div class="mi-block">' + esc(r.result) + '</div>';
    if (!r) g += '<div class="mi-sec">返回</div><div class="mi-block">（尚无返回）</div>';
    openSheet((c.name || (r && r.name) || '工具') + ' 调用', g);
  }

  function openMeta(val) {
    var m = /^step:(\d+)$/.exec(String(val || ''));
    if (!m) return;
    var idx = parseInt(m[1], 10);
    var d = S.trace || {}, turns = d.turns || [], turn = turns[idx];
    if (!turn) { err('找不到该步骤'); return; }
    var u = turn.usage || {};
    var tokTxt = u.in || u.out ? (u.in + ' / ' + u.out) : '-';
    var g = '<div class="mi-grid">'
      + cell('角色', turn.role === 'assistant' ? 'AI' : (turn.role === 'tool' ? '工具' : '用户'), false, false)
      + cell('模型', u.model || (S.cfgModel || '-'), false, true)
      + cell('发送时间', fmtTime(turn.at || d.last_at || 0), false, true)
      + cell('耗时', fmtMs(turn.elapsed_ms), false, true)
      + cell('Token（入/出）', tokTxt, false, true)
      + cell('字符数', String(turn.chars || 0), false, true)
      + (turn.finish_reason ? cell('结束原因', turn.finish_reason, true, true) : '')
      + '</div>';

    if (turn.role === 'tool') {
      g += '<div class="mi-sec">工具</div>' + cell('名称', turn.name, true, true);
      if (turn.args) g += '<div class="mi-sec">参数</div><div class="mi-block">' + esc(fmtJson(turn.args)) + '</div>';
      g += '<div class="mi-sec">返回</div><div class="mi-block">' + esc(turn.result || '(空)') + '</div>';
    } else {
      if (turn.reasoning) g += '<div class="mi-sec">思考过程</div><div class="mi-block">' + esc(turn.reasoning) + '</div>';
      if (turn.content) g += '<div class="mi-sec">正文</div><div class="mi-block">' + esc(turn.content) + '</div>';
      var tcs = turn.tool_calls || [];
      for (var i = 0; i < tcs.length; i++) {
        g += '<div class="mi-sec">工具调用 · ' + esc(tcs[i].name) + '</div><div class="mi-block">' + esc(fmtJson(tcs[i].args)) + '</div>';
      }
    }
    openSheet('步骤信息', g);
  }

  /* ── 关闭（把任务标记为已关闭，不消失）/ 删除（彻底删掉） ── */
  var DEL_Q = [], DEL_BUSY = false;
  function runDelQueue() {
    if (DEL_BUSY || !DEL_Q.length) return;
    DEL_BUSY = true;
    var job = DEL_Q.shift();
    var done = function () { DEL_BUSY = false; setTimeout(runDelQueue, 0); };
    try {
      callRaw(job.tool, job.params, '', ++S.seq, function (r) {
        if (r && r.success === false) { err(r.message || '操作失败'); dropRollback(job); }
        else if (job.tool === 'subagent:subagent_del') dropRow(job.params.id);
        else if (job.tool === 'subagent:subagent_ctrl') markClosed(job.params.id);
        done();
      });
    } catch (e) { done(); }
  }
  /* 关闭：只把状态改成「已关闭」，行留在列表里（这才是叉号该干的事） */
  function markClosed(id) {
    for (var i = 0; i < S.items.length; i++) {
      if (S.items[i].id === id) { S.items[i].status = 'closed'; break; }
    }
    renderList(S.items);
  }
  function dropRow(id) {
    var keep = [];
    for (var i = 0; i < S.items.length; i++) { if (S.items[i].id !== id) keep.push(S.items[i]); }
    S.items = keep;
    renderList(S.items);
  }
  function dropRollback() { refreshList(true); }   // 失败时回拉一次真实状态
  /* 叉号 = 关闭任务（不删） */
  function closeTask(id) {
    markClosed(id);                       // 界面立刻变「已关闭」
    hf();
    okMsg('已关闭');
    DEL_Q.push({ tool: 'subagent:subagent_ctrl', params: { id: id, action: 'close', confirm: true, drop_product: false } });
    runDelQueue();
  }
  /* 详情页 / 列表长按 = 彻底删除，用是/否确认框，不再复用带搜索的选择器弹窗 */
  function deleteTask(id) {
    var it = null;
    for (var i = 0; i < S.items.length; i++) { if (S.items[i].id === id) { it = S.items[i]; break; } }
    openCfm('删除任务', (it ? (it.title || it.id) : id) + '\n连同产物目录与快照一起删，不可恢复。', function () {
      dropRow(id);                        // 秒删：DOM 立刻没了
      if (S.cur === id) { S.cur = null; show('list'); }
      okMsg('已删除');
      DEL_Q.push({ tool: 'subagent:subagent_del', params: { id: id, confirm: true } });
      runDelQueue();
    });
  }
  /* 列表页批量删除：进入选择模式后勾选多个，一次确认全部删掉 */
  function enterMulti() {
    S.multi = true;
    S.selIds = {};
    syncMultiBar();
    renderList(S.items);
  }
  function exitMulti() {
    S.multi = false;
    S.selIds = {};
    syncMultiBar();
    renderList(S.items);
  }
  function toggleSel(id) {
    if (!S.selIds) S.selIds = {};
    if (S.selIds[id]) delete S.selIds[id]; else S.selIds[id] = 1;
    syncMultiBar();
    renderList(S.items);
  }
  function selCount() {
    var n = 0;
    if (S.selIds) for (var k in S.selIds) if (Object.prototype.hasOwnProperty.call(S.selIds, k)) n++;
    return n;
  }
  function syncMultiBar() {
    if ($('multiBar')) $('multiBar').style.display = S.multi ? '' : 'none';
    if ($('multiCount')) $('multiCount').textContent = '已选 ' + selCount() + ' 项';
    if ($('multiDel')) $('multiDel').disabled = (selCount() === 0);
    if ($('multiBtn')) $('multiBtn').style.display = (S.multi || !S.items || !S.items.length) ? 'none' : '';
  }
  /* 批量删除：一次确认，逐个入队（后端按队列串行删，前端 DOM 秒删） */
  function deleteSelected() {
    var ids = [];
    if (S.selIds) for (var k in S.selIds) if (Object.prototype.hasOwnProperty.call(S.selIds, k)) ids.push(k);
    if (!ids.length) { err('还没选任务'); return; }
    openCfm('删除 ' + ids.length + ' 个任务', '连同各自产物目录与快照一起删，不可恢复。', function () {
      for (var i = 0; i < ids.length; i++) {
        dropRow(ids[i]);
        DEL_Q.push({ tool: 'subagent:subagent_del', params: { id: ids[i], confirm: true } });
      }
      okMsg('已删除 ' + ids.length + ' 个');
      if (S.cur && S.selIds && S.selIds[S.cur]) { S.cur = null; }
      exitMulti();
      runDelQueue();
    });
  }

  /* ── 新建页 ── */
  function show(id) { var p = ['welcome', 'home', 'list', 'new', 'full', 'detail', 'cfg', 'inbox', 'mail']; for (var i = 0; i < p.length; i++) { var el = $('page-' + p[i]); if (el) el.style.display = (p[i] === id) ? '' : 'none'; } S.page = id; if (id === 'home' || id === 'list') renderList(S.items); }
  /* show('list') 内部已调 renderList，这里不再重复（列表大时白渲染两遍） */
  function goList() { show('list'); refreshList(false); if ($('listSearch')) $('listSearch').value = ''; }
  function goHome() {
    /* 不清 S.cur：任务可能还在后端跑，清掉会让轮询与「继续推进」都失去目标。
       详情页的返回列表才真正切换上下文（goList / backList）。 */
    stopPoll();
    show('home');
  }

 /* 首次进入：欢迎页 + 后台刷新最近任务；1.2s 后与列表就绪二者都满足再进主页 */
 /* 可见性恢复：从主对话返回时若当前页不可见，兜底显示主页并刷新最近列表（防黑屏） */
document.addEventListener('visibilitychange', function () {
  /* 【第六十九轮】页面切后台时全局暂停动画，零开销；回前台自动继续。
     放在原有逻辑外面，两个状态都要处理。 */
  try {
    var hid = (document.visibilityState === 'hidden');
    if (document.body && document.body.classList) {
      if (hid) document.body.classList.add('page-hidden');
      else document.body.classList.remove('page-hidden');
    }
  } catch (ePH) {}
  try {
    if (document.visibilityState === 'visible') {
      var pid = S && S.page ? 'page-' + S.page : null;
      var el = pid ? $(pid) : null;
      if (!el || el.style.display === 'none') show('home');
      refreshList(false);
    }
  } catch (e) {}
});

  /* ── 弹窗 ── */
  function openDlg(title, groups, multi, onOk, showSearch) {
    S.dlg = { groups: groups, multi: multi, onOk: onOk, search: showSearch !== false };
    $('dlgTitle').textContent = title;
    $('dlgSearch').value = '';
    $('dlgSearch').placeholder = '搜索…';
    $('dlgSearch').style.display = (showSearch === false) ? 'none' : '';
    /* 底部按钮按场景给：多选给「确定/取消」，其余给「取消」 */
    if ($('dlgFoot')) {
      $('dlgFoot').innerHTML = multi
        ? '<button class="btn" data-act="dlgCancel">取消</button><button class="btn pri" data-act="dlgOk">确定</button>'
        : '<button class="btn" data-act="dlgCancel">取消</button>';
    }
    renderDlg('');
    $('mask').classList.add('on'); $('dlg').classList.add('on');
  }
  function closeDlg() { $('mask').classList.remove('on'); $('dlg').classList.remove('on'); S.dlg = null; }
  /* 是/否确认框：删除这类不可逆操作专用，不带搜索、不带勾选 */
  function openCfm(title, body, onYes) {
    S.cfmYes = onYes || null;
    if ($('cfmTitle')) $('cfmTitle').textContent = String(title || '确认');
    if ($('cfmBody')) $('cfmBody').textContent = String(body || '');
    if ($('mask')) $('mask').classList.add('on');
    if ($('cfm')) $('cfm').classList.add('on');
  }
  function closeCfm() {
    S.cfmYes = null;
    if ($('mask')) $('mask').classList.remove('on');
    if ($('cfm')) $('cfm').classList.remove('on');
  }
  function renderDlg(q) {
    if (!S.dlg) return;
    q = (q || '').toLowerCase();
    var h = '';
    for (var g = 0; g < S.dlg.groups.length; g++) {
      var grp = S.dlg.groups[g], items = grp.items || [], rows = '';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.val === '__loading') { rows += '<div class="dlg-hint">' + esc(it.label) + '</div>'; continue; }
        if (q && (it.label + ' ' + (it.desc || '')).toLowerCase().indexOf(q) < 0) continue;
        var on = (S.dlg.multi ? (S.sel.indexOf(it.val) >= 0) : !!it.on);
        var tick = on ? '<span class="' + (S.dlg.multi ? 'dlg-check' : 'm-pick') + '"><svg><use href="#i-check"/></svg></span>' : (S.dlg.multi ? '' : '<span class="m-pick"></span>');
        rows += '<div class="dlg-row' + (on ? ' on' : '') + '" data-act="dlgPick" data-val="' + esc(it.val) + '"><div><div class="dlg-lb">' + esc(it.label) + (it.hi ? ' <span class="dlg-hi">高危</span>' : '') + '</div><div class="dlg-ds">' + esc(it.desc || '') + '</div></div>' + tick + '</div>';
      }
      if (rows) h += '<div class="dlg-sec">' + esc(grp.title || '') + '</div>' + rows;
    }
    $('dlgBody').innerHTML = h || '<div class="dlg-hint">没有匹配项</div>';
  }
  function toolGroups() {
    var bi = [], pk = [], t = S.tools || {};
    var arr = (t.builtin && t.builtin.length) ? t.builtin : null;
    if (arr) { for (var i = 0; i < arr.length; i++) { var b = arr[i]; bi.push({ val: b.name, label: b.label || b.name, hi: HIGH.test(b.name), desc: b.name + (b.write ? ' · 写类' : ' · 只读') }); } }
    else if (!t.loaded) bi.push({ val: '__loading', label: '正在读取工具清单…', desc: '' });
    else { for (var k = 0; k < FALLBACK.length; k++) { var f = FALLBACK[k]; bi.push({ val: f[0], label: f[1], hi: HIGH.test(f[0]), desc: f[0] + (f[2] ? ' · 写类' : ' · 只读') }); } }
    var pa = t.packages || [];
    for (var j = 0; j < pa.length; j++) { var p = pa[j]; pk.push({ val: p.pattern, label: p.display || p.name, desc: p.pattern + ' · ' + (p.tools || 0) + ' 工具' }); }
    return [{ title: '宿主内置', items: bi }, { title: '外部包', items: pk }];
  }

  /* ── 新建表单逻辑 ── */
  function createTask() {
    var task = ($('inTask').value || '').trim();
    if (!task) { err('请填写任务描述'); return; }
    /* 工具不再必选：空数组 = 不限制。只读工具能直接跑，
       写类工具仍会被后端按目录做边界校验，所以放开是安全的。 */
    var need = false;
    for (var i = 0; i < S.sel.length; i++) if (WRITE_RE.test(S.sel[i].toLowerCase())) need = true;
    if (need && !($('inWs').value || '').trim()) { err('含写类工具，必须选择目录'); return; }
    if (need) { call('subagent:subagent_env', { what: 'path', path: ($('inWs').value || '').trim() }, 'checkpath'); return; }
    doCreate();
  }
  function doCreate() {
    if (S.keyOk === false) { err('还没写入 API 密钥——到配置页填 Key'); return; }
    var taskText = ($('inTask').value || '').trim();
    if (!taskText) { err('请填写任务描述'); return; }
    /* 记住本次填写，下次进新建页自动回填 */
    saveNewForm();
    var p = {
      task: taskText, allowed_tools: S.sel.join(','),
      workspace: ($('inWs').value || '').trim() || undefined,
      max_steps: parseInt($('inSteps').value || '20', 10),
      timeout_ms: parseInt($('inTimeout').value || '90000', 10),
      thinking_level: S.think, max_depth: parseInt($('inDepth').value || '0', 10) || 0, origin: 'ui'
    };
    /* 【允许危险命令】只在开启时才传，保持默认语义干净（后端默认 false）。 */
    if ($('inDanger') && $('inDanger').value === '1') p.allow_danger = true;
/* 附带主对话上下文已移除：不再传 context_mode / parent_chat_id，
       子代理只看任务描述本身，避免把主对话内容带进独立通道。 */
    /* 不用 sync：sync 会把桥阻塞几十秒，WebView 会卡成假死。
       改成「建任务 → 立刻进详情并自动推进」，推进由详情页的轮询驱动。 */
    call('subagent:subagent_spawn', p, 'spawn');
  }

  /* ── 新建页设置记忆 ──
     把用户填过的内容存到 localStorage，下次进新建页回填。
     key 只存非敏感项；任务描述默认也回填（用户可一键清空）。 */
  var NEWFORM_KEY = 'sb.newform.v1';
  function saveNewForm() {
    try {
      /* 用户明确要求：保留上一次设置，但不保留任务描述。
         所以 task 故意不写进 localStorage。 */
      var o = {
        ws: ($('inWs').value || ''),
        steps: ($('inSteps').value || ''),
        timeout: ($('inTimeout').value || ''),
        depth: ($('inDepth').value || ''),
        think: S.think,
        sel: S.sel || [],
        /* 危险命令开关也记住：用户这次开了，下次进新建页保持开着 */
        danger: ($('inDanger') && $('inDanger').value === '1') ? 1 : 0
      };
      localStorage.setItem(NEWFORM_KEY, JSON.stringify(o));
    } catch (e) {}
  }
  function loadNewForm() {
    var o = null;
    try { o = JSON.parse(localStorage.getItem(NEWFORM_KEY) || 'null'); } catch (e) { o = null; }
    /* 没有记忆也要先按默认值重绘一次，否则第一次进新建页开关样式是空的 */
    if (!o) { paintDanger(); return; }
    try {
      if ($('inWs') && o.ws) { $('inWs').value = o.ws; var vw = $('vWs'); if (vw) vw.textContent = o.ws; }
      if ($('inSteps') && o.steps) $('inSteps').value = o.steps;
      if ($('inTimeout') && o.timeout) $('inTimeout').value = o.timeout;
      if ($('inDepth') && o.depth !== undefined) $('inDepth').value = o.depth;
      if (o.think && THINK_CN[o.think]) setThinkSlider(o.think);
      if (o.sel && o.sel.length) { S.sel = o.sel.slice(); syncSelLabel(); }
      /* 危险命令开关回填：先写真实值再重绘，两条路径共用 paintDanger */
      if ($('inDanger') && o.danger) { $('inDanger').value = o.danger ? '1' : '0'; }
      paintDanger();
      syncDepthFromSlider();
    } catch (e) {}
  }
  function syncSelLabel() {
    var v = $('vTools');
    if (v) v.textContent = (S.sel && S.sel.length) ? (S.sel.length + ' 个') : '不限制';
    syncCardSubs();
  }
  /* 全屏编辑：任务描述写长了在这里写。输入即存到内存草稿，不用点保存。
     退出时把内容写回新建页的 #inTask，保持两边同源。 */
  function openFullEdit() {
    var src = $('inTask'), dst = $('inTaskFull');
    if (dst && src) { dst.value = src.value || ''; }
    closeSheet();
    show('full');
    if (dst) {
      setTimeout(function () { try { dst.focus(); } catch (e) {} }, 80);
    }
    if ($('fullTip')) $('fullTip').textContent = '自动保存';
  }
  function closeFullEdit() {
    var dst = $('inTaskFull'), src = $('inTask');
    if (dst && src) src.value = dst.value || '';
    syncTaskDraft();
    show('new');
  }
  /* 任务描述草稿：输入即存，但只在「本次未创建」时回填。
     用户明确要求「保留上一次设置，但不保留任务描述」，
     所以 task 只存在会话内存 S.taskDraft，不进 localStorage。 */
  function syncTaskDraft() {
    var v = '';
    if ($('inTask')) v = $('inTask').value || '';
    else if ($('inTaskFull')) v = $('inTaskFull').value || '';
    S.taskDraft = v;
    var tip = $('fullTip');
    if (tip) tip.textContent = '已自动保存';
  }
  /* 【允许危险命令】开关：真实值存在 #inDanger（0/1），UI 只跟着它走。
       为什么用 hidden 存值而不是直接读 class：saveNewForm / loadNewForm 都靠 value，
       这样两条路径（用户点击 / 记忆回填）走同一份真相。 */
  function toggleDanger() {
    var h = $('inDanger');
    if (!h) return;
    var on = h.value !== '1';
    h.value = on ? '1' : '0';
    paintDanger();
    hf();
  }
  function paintDanger() {
    var h = $('inDanger');
    var on = !!(h && h.value === '1');
    var sw = $('swDanger');
    if (sw) { if (on) sw.classList.add('on'); else sw.classList.remove('on'); }
    var v = $('vDanger');
    if (v) v.textContent = on ? '已开启 · 可执行脚本' : '关闭 · 不能执行脚本';
  }
  /* 卡片折叠：点卡片展开/收起下面的面板，箭头跟着转 */
  function togglePanel(boxId, cardId) {
    var box = $(boxId), card = $(cardId);
    if (!box) return;
    var open = box.style.display === 'none';
    box.style.display = open ? '' : 'none';
    if (card) card.classList.toggle('open', open);
  }
  /* 权限卡 / 运行参数卡的副标题：把当前值摘要出来，不用展开也能看见 */
  function syncCardSubs() {
    var t = $('vTools'), w = $('vWs'), ps = $('vPermSub');
    if (ps && t && w) ps.textContent = (t.textContent || '不限制') + ' · ' + (w.textContent || '未选目录');
    var st = $('inSteps'), to = $('inTimeout'), dp = $('inDepth'), rs = $('vRunSub');
    if (rs && st) {
      var d = parseInt((dp && dp.value) || '0', 10) || 0;
      rs.textContent = (st.value || '20') + ' 步 · ' + ((to && to.value) || '90') + ' 秒 · '
        + (d ? ('深度 ' + d) : '深度不限') + ' · ' + (THINK_EN[S.think] || 'Medium');
    }
  }
  /* ══ 流式双通道 ══
   问题本质（实测 2026-11-04）：
     面板页面 origin 固定为 https://localhost（宿主写死，改不了）。
     · https 端点：官方/三方都回 access-control-allow-origin，fetch 可直连，拿真 SSE。
     · http  端点（局域网自建）：页面是 https，浏览器按 mixed content 把请求掐死，
       请求根本不发出去 —— 这条改代码绕不过，只能换通道。
   但后端 Tools.Net.http 不受 mixed content 约束（已实测能通局域网并拿到 text/event-stream），
   所以 http 端点走后端中继：后端拿整包 SSE → 解析成 chunks → 前端按块回放。
   两条路都保留，谁用谁的。任何一条失败都静默降级到 advanceTask，绝不让任务卡住。
   为什么绕开桥做真流式：桥是同步阻塞 + 20 秒硬超时，拿不到流。 */
  /* 端点选路策略（实测 2026-11-05）：
     页面 origin 是 http://localhost，理论上 http/https 端点都能直连。
     但很多自建端点（new-api/one-api 类）不回 access-control-allow-origin，
     前端跨域 fetch 照样被 CORS 拦 —— 所以不能只看协议。
     策略：一律先试直连（direct），fetch 失败自动落中继（relay），
     中继再失败落 advanceTask。三层保底，用户零配置。 */
  var STREAM = { key: '', ctx: null, busy: false, abort: null, fellBack: false, relay: false,
    curId: '', curThink: '', curBody: '', lastFlush: 0 };

  /* 端点协议决定走哪条路。
     页面 origin 已经是 http://localhost（见 web_panel.ui.js baseUrl 注释），
     http 页面拉 https 与 http 端点都不受 mixed content 限制 → 全部走前端直连拿真流式。
     中继只在前端 fetch 失败时由 sinkToAdvance 兜底，不再按协议预判。 */
  /* 取直连参数 + 密钥（各一次，缓存到内存） */
  function loadStreamEnv(taskId, done) {
    /* 缓存必须按任务 id 校验：ctx 里含该任务的白名单与思考等级，
       换了任务还复用旧 ctx 会把上一个任务的工具白名单带过去。 */
    var _tid = String(taskId || S.cur || '');
    if (STREAM.key && STREAM.ctx && STREAM.ctxFor === _tid) { done(null); return; }
    call('subagent:subagent_stream_ctx', { id: _tid }, 'streamCtx', function (r1) {
      var d1 = (r1 && r1.data) || {};
      if (!d1.endpoint) { done(new Error('未配置端点')); return; }
      call('subagent:subagent_stream_key', {}, 'streamKey', function (r2) {
        var d2 = (r2 && r2.data) || {};
        if (!d2.key) { done(new Error('未配置密钥')); return; }
        STREAM.ctx = d1;
        STREAM.key = d2.key;
        STREAM.ctxFor = _tid;
        done(null);
      });
    });
  }

  /* 把 messages 数组转成端点要的格式（这里已经是 OpenAI chat 格式） */
  function buildStreamBody(messages, ctx, opts) {
    var body = {
      model: ctx.model,
      messages: messages,
      stream: true,
      stream_options: { include_usage: true }
    };
    if (ctx.tool_schema && ctx.tool_schema.length) {
      body.tools = ctx.tool_schema;
      body.tool_choice = 'auto';
    }
    if (ctx.thinking) { for (var k in ctx.thinking) if (Object.prototype.hasOwnProperty.call(ctx.thinking, k)) body[k] = ctx.thinking[k]; }
    if (ctx.extra_body) { for (var k2 in ctx.extra_body) if (Object.prototype.hasOwnProperty.call(ctx.extra_body, k2)) body[k2] = ctx.extra_body[k2]; }
    if (opts && opts.model) body.model = opts.model;
    return body;
  }

  /* 把 fetch 层的失败翻译成用户能听懂、能动手的结论。
     `Failed to fetch` 有且只有两种成因（HTTP 报错不会走到这里，那条会带状态码）：
     1) mixed content —— 页面是 https://localhost，端点若是 http:// 会被浏览器直接拦，
        请求根本没发出去；
     2) CORS —— 端点 https，但服务端没回 access-control-allow-origin。
     区分两者的唯一依据是端点协议，所以这里直接看 URL 协议。 */
  function explainFetchErr(url, e) {
    var msg = String((e && e.message) || e || '');
    if (!/failed to fetch|networkerror|load failed/i.test(msg)) return msg;
    var u = String(url || '');
    var isHttp = /^http:\/\//i.test(u);
    var host = '';
    try { host = u.replace(/^https?:\/\//i, '').split('/')[0]; } catch (eH) { host = ''; }
    if (isHttp) {
      return '端点 ' + host + ' 走的是 http，而面板本身是 https 页面，浏览器按混合内容策略直接拦截。';
    }
    return '端点 ' + host + ' 没有返回跨域许可（CORS），浏览器拦下了请求。'
      + '这不是密钥或模型的问题：需要在服务端加上 access-control-allow-origin，或改用支持跨域的网关。';
  }

  /* 把 SSE 原文解析成累积结果；onDelta 存在时逐块回调（用于回放） */
  function parseSSE(text, onDelta) {
    var acc = { content: '', reasoning: '', byIdx: {}, finishReason: '', usage: {} };
    var lines = String(text || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].replace(/\r$/, '');
      if (!ln || ln.charAt(0) === ':') continue;
      if (ln.indexOf('data:') !== 0) continue;
      var payload = ln.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      var j = null;
      try { j = JSON.parse(payload); } catch (e) { continue; }
      if (j.usage) acc.usage = j.usage;
      var ch = (j.choices && j.choices[0]) || null;
      if (!ch) continue;
      var d = ch.delta || {};
      var c = String(d.content || '');
      var r = String(d.reasoning_content || d.reasoning || '');
      if (c) acc.content += c;
      if (r) acc.reasoning += r;
      /* 工具调用是分片下发的：按 index 累积 name 与 arguments 字符串 */
      var dtc = d.tool_calls || [];
      for (var t = 0; t < dtc.length; t++) {
        var one = dtc[t] || {};
        var ix = Number(one.index == null ? 0 : one.index);
        if (!acc.byIdx[ix]) acc.byIdx[ix] = { id: '', name: '', argsText: '' };
        var slot = acc.byIdx[ix];
        if (one.id) slot.id = String(one.id);
        var fn = one.function || {};
        if (fn.name) slot.name += String(fn.name);
        if (fn.arguments) slot.argsText += String(fn.arguments);
      }
      if (ch.finish_reason) acc.finishReason = String(ch.finish_reason);
      if (onDelta && (c || r)) onDelta({ content: c, reasoning: r });
    }
    var tcs = [];
    for (var key in acc.byIdx) {
      if (!Object.prototype.hasOwnProperty.call(acc.byIdx, key)) continue;
      var s = acc.byIdx[key];
      var args = {};
      try { args = JSON.parse(s.argsText || '{}'); } catch (e) { args = { __unparsed: s.argsText }; }
      tcs.push({ id: s.id || ('call_' + key), name: s.name, args: args });
    }
    return {
      content: acc.content,
      reasoning: acc.reasoning,
      toolCalls: tcs,
      finishReason: acc.finishReason || (tcs.length ? 'tool_calls' : 'stop'),
      usage: acc.usage
    };
  }

  /* ── 通道 A0：XHR 增量读（WebView 里最可靠的流式路径） ──
     为什么不用 fetch：实测端点 curl -N 每 20~60ms 一块（3586→11542→18945→28768→37219），
     响应头 Content-Type: text/event-stream + X-Accel-Buffering: no + 无 Content-Encoding，
     CORS 头齐全（ACAO: *），前端诊断也能拿到 reader=yes。
     但页面依然看不到逐字 —— 因为部分 Android WebView 里 response.body.getReader()
     能拿到对象、read() 却攒到整包结束才 resolve。
     XHR 的 onprogress 是宿主侧事件，每收到一段就触发，不经过 ReadableStream，绕开这个坑。
     解析逻辑与 fetch 版一致：按行切 data: → JSON.parse → 累加 content/reasoning/tool_calls。 */
  function streamOnceXhr(messages, onDelta) {
    var ctx = STREAM.ctx;
    var url = ctx.endpoint;
    var headers = {};
    for (var hk in (ctx.headers || {})) if (Object.prototype.hasOwnProperty.call(ctx.headers, hk)) headers[hk] = ctx.headers[hk];
    var hasAuth = false;
    for (var hk2 in headers) if (/^authorization$/i.test(hk2)) hasAuth = true;
    if (!hasAuth) headers['Authorization'] = 'Bearer ' + STREAM.key;
    var body = buildStreamBody(messages, ctx);
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var seen = 0;          /* 已解析到的 responseText 长度，用来只取增量 */
      var buf = '';          /* 未闭合的行缓冲 */
      var finished = false;
      var acc = { content: '', reasoning: '', byIdx: {}, finishReason: '', usage: {} };
      STREAM.chunkCount = 0;

      /* 把一条 SSE 的 JSON 增量合并进 acc，并回调给渲染层 */
      function applyChunk(j) {
        if (j.usage) acc.usage = j.usage;
        var ch = (j.choices && j.choices[0]) || null;
        if (!ch) return;
        var d = ch.delta || {};
        var c = String(d.content || '');
        var r = String(d.reasoning_content || d.reasoning || '');
        if (c) acc.content += c;
        if (r) acc.reasoning += r;
        var dtc = d.tool_calls || [];
        for (var i = 0; i < dtc.length; i++) {
          var one = dtc[i] || {};
          var ix = Number(one.index == null ? 0 : one.index);
          if (!acc.byIdx[ix]) acc.byIdx[ix] = { id: '', name: '', argsText: '' };
          var slot = acc.byIdx[ix];
          if (one.id) slot.id = String(one.id);
          var fn = one.function || {};
          if (fn.name) slot.name += String(fn.name);
          if (fn.arguments) slot.argsText += String(fn.arguments);
        }
        if (ch.finish_reason) acc.finishReason = String(ch.finish_reason);
        if (onDelta) onDelta({ content: c, reasoning: r });
      }

      /* 按换行切 SSE：只认 data: 开头，跳过注释行与空行 */
      function feed(chunk) {
        buf += chunk;
        var idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (!line || line.charAt(0) === ':') continue;
          if (line.indexOf('data:') !== 0) continue;
          var payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          var j = null;
          try { j = JSON.parse(payload); } catch (e) { continue; }
          applyChunk(j);
        }
      }

      function collect() {
        var tcs = [];
        for (var key in acc.byIdx) {
          if (!Object.prototype.hasOwnProperty.call(acc.byIdx, key)) continue;
          var s = acc.byIdx[key];
          var args = {};
          try { args = JSON.parse(s.argsText || '{}'); } catch (e) { args = { __unparsed: s.argsText }; }
          tcs.push({ id: s.id || ('call_' + key), name: s.name, args: args });
        }
        return {
          content: acc.content,
          reasoning: acc.reasoning,
          toolCalls: tcs,
          finishReason: acc.finishReason || (tcs.length ? 'tool_calls' : 'stop'),
          usage: acc.usage
        };
      }

      /* 把 responseText 里新增的那一段喂进解析器。
         必须用 seen 记录位置：onprogress 给的是累计全文，不是增量。 */
      function drain() {
        var raw = '';
        try { raw = xhr.responseText || ''; } catch (eR) { raw = ''; }
        if (raw.length <= seen) return;
        var piece = raw.slice(seen);
        seen = raw.length;
        STREAM.chunkCount = (STREAM.chunkCount || 0) + 1;
        try {
          feed(piece);
        } catch (eF) {
          /* feed 里任何一步抛异常都会让这次 onprogress 中断：
             块数已 +1，但 onDelta 不触发，缓冲区不增长，画面冻结。
             以前这里完全静默，现在至少留痕到 console。 */
          try { console.error('[subagent] feed error: ' + ((eF && eF.message) || eF)); } catch (eL) {}
        }
      }

      try {
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        for (var h in headers) {
          if (!Object.prototype.hasOwnProperty.call(headers, h)) continue;
          try { xhr.setRequestHeader(h, headers[h]); } catch (eH) {}
        }
      } catch (eO) {
        reject(new Error('XHR 打开失败：' + String((eO && eO.message) || eO)));
        return;
      }
      xhr.onprogress = function () { drain(); };
      /* 兜底超时：端点如果连上但不发数据、也不关连接，XHR 会永远挂着。
         STREAM.busy 就一直为 true，整个面板卡死（用户看到「模型生成中…」转圈不动）。
         取任务配置的超时（默认 90s）再加一点余量，给推理模型留足思考时间。 */
      var _to = Number((STREAM.ctx && STREAM.ctx.timeout_ms) || 0);
      xhr.timeout = _to > 0 ? (_to + 30000) : 180000;
      /* readyState 3 = 正在接收，部分 WebView 不触发 onprogress 但会触发这个 */
      xhr.onreadystatechange = function () { if (xhr.readyState === 3) drain(); };
      xhr.onload = function () {
        if (finished) return;
        finished = true;
        drain();
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error('HTTP ' + xhr.status + '：' + String(xhr.responseText || '').slice(0, 300)));
          return;
        }
        if (buf) feed('\n');
        var out = collect();
        STREAM.diag = 'xhr=yes ctype=' + String(xhr.getResponseHeader('content-type') || '?')
          + ' chunks=' + (STREAM.chunkCount || 0);
        try { syncDtStatusText(S.curStatus || 'done'); } catch (eDg) {}
        resolve(out);
      };
      xhr.onerror = function () {
        if (finished) return;
        finished = true;
        reject(new Error('XHR 网络失败（端点不可达或被 CORS 拦）'));
      };
      xhr.ontimeout = function () {
        if (finished) return;
        finished = true;
        reject(new Error('XHR 超时'));
      };
      xhr.onabort = function () {
        if (finished) return;
        finished = true;
        reject(new Error('aborted'));
      };
      /* 停止按钮走 STREAM.abort，两种通道都要能中断 */
      STREAM.abort = { abort: function () { try { xhr.abort(); } catch (eA) {} } };
      try {
        xhr.send(JSON.stringify(body));
      } catch (eSend) {
        finished = true;
        reject(new Error('XHR 发送失败：' + String((eSend && eSend.message) || eSend)));
      }
    });
  }

  /* ── 通道 A：前端 fetch 直连（https 端点） ── */
  function streamOnceDirect(messages, onDelta) {
    var ctx = STREAM.ctx;
    var url = ctx.endpoint;
    var headers = {};
    for (var hk in (ctx.headers || {})) if (Object.prototype.hasOwnProperty.call(ctx.headers, hk)) headers[hk] = ctx.headers[hk];
    /* 自定义头里可能有别的认证方式；默认用 Bearer */
    var hasAuth = false;
    for (var hk2 in headers) if (/^authorization$/i.test(hk2)) hasAuth = true;
    if (!hasAuth) headers['Authorization'] = 'Bearer ' + STREAM.key;

    var body = buildStreamBody(messages, ctx);
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    STREAM.abort = ctrl;

    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error('HTTP ' + res.status + '：' + String(t || '').slice(0, 300));
          });
        }
        var reader = null;
        try { reader = res.body && res.body.getReader ? res.body.getReader() : null; } catch (eR) { reader = null; }
        /* 诊断：记录这条通道到底能不能逐块读。用户看不到流式时，第一个要区分的就是
           「reader 拿不到（WebView 不支持 response.body）」还是「reader 有但只来一块」。 */
        STREAM.diag = 'reader=' + (reader ? 'yes' : 'no')
          + ' ctype=' + String((res.headers && res.headers.get && res.headers.get('content-type')) || '?')
          + ' clen=' + String((res.headers && res.headers.get && res.headers.get('content-length')) || '?');
        STREAM.chunkCount = 0;
        /* 拿不到 reader：整包读回来按 SSE 解析，仍逐条回调 */
        if (!reader) {
          return res.text().then(function (raw) {
            var out = parseSSE(raw, onDelta);
            if (!out.content && !out.reasoning && !out.toolCalls.length) {
              throw new Error('响应既不是 SSE 也不是 JSON：' + String(raw || '').slice(0, 200));
            }
            return out;
          });
        }
        var dec = new TextDecoder('utf-8');
        var buf = '';
        var acc = { content: '', reasoning: '', byIdx: {}, finishReason: '', usage: {} };
        function applyChunk(j, cb) {
          if (j.usage) acc.usage = j.usage;
          var ch = (j.choices && j.choices[0]) || null;
          if (!ch) return;
          var d = ch.delta || {};
          var c = String(d.content || '');
          var r = String(d.reasoning_content || d.reasoning || '');
          if (c) acc.content += c;
          if (r) acc.reasoning += r;
          var dtc = d.tool_calls || [];
          for (var i = 0; i < dtc.length; i++) {
            var one = dtc[i] || {};
            var ix = Number(one.index == null ? 0 : one.index);
            if (!acc.byIdx[ix]) acc.byIdx[ix] = { id: '', name: '', argsText: '' };
            var slot = acc.byIdx[ix];
            if (one.id) slot.id = String(one.id);
            var fn = one.function || {};
            if (fn.name) slot.name += String(fn.name);
            if (fn.arguments) slot.argsText += String(fn.arguments);
          }
          if (ch.finish_reason) acc.finishReason = String(ch.finish_reason);
          if (cb) cb({ content: c, reasoning: r });
        }
        function finish() {
          var tcs = [];
          for (var key in acc.byIdx) {
            if (!Object.prototype.hasOwnProperty.call(acc.byIdx, key)) continue;
            var s = acc.byIdx[key];
            var args = {};
            try { args = JSON.parse(s.argsText || '{}'); } catch (e) { args = { __unparsed: s.argsText }; }
            tcs.push({ id: s.id || ('call_' + key), name: s.name, args: args });
          }
          return {
            content: acc.content,
            reasoning: acc.reasoning,
            toolCalls: tcs,
            finishReason: acc.finishReason || (tcs.length ? 'tool_calls' : 'stop'),
            usage: acc.usage
          };
        }
        function feed(chunk) {
          buf += chunk;
          var idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            var line = buf.slice(0, idx).replace(/\r$/, '');
            buf = buf.slice(idx + 1);
            if (!line || line.charAt(0) === ':') continue;
            if (line.indexOf('data:') !== 0) continue;
            var payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            var j = null;
            try { j = JSON.parse(payload); } catch (e) { continue; }
            applyChunk(j, onDelta);
          }
        }
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) {
              if (buf) feed('\n');
              return finish();
            }
            /* 每块立刻渲染：流式的「逐字」来自这里，不是靠定时器攒批 */
            STREAM.chunkCount = (STREAM.chunkCount || 0) + 1;
            feed(dec.decode(r.value, { stream: true }));
            return pump();
          });
        }
        return pump().then(function (r) {
          /* 收尾时把通道诊断写进状态行：块数 = 1 说明「假流式」（整包一次到），
             块数 > 10 说明真逐块；reader=no 说明 WebView 不支持 response.body。 */
          STREAM.diag = (STREAM.diag || '') + ' chunks=' + (STREAM.chunkCount || 0);
          /* 立刻把诊断刷到状态行（不等下一轮 trace） */
          try { syncDtStatusText(S.curStatus || 'done'); } catch (eDg) {}
          return r;
        });
      }).then(function (r) {
        STREAM.abort = null;
        return r;
      }, function (e) {
        STREAM.abort = null;
        throw e;
      });
  }

  /* ── 通道 B：后端中继（http 局域网端点） ──
     后端 Tools.Net.http 不受 mixed content 约束，能拿到整包 SSE。
     拿回来按块回放，观感接近真流式；reasoning / content 分开回放。 */
  function streamOnceRelay(messages, onDelta) {
    var ctx = STREAM.ctx;
    var body = buildStreamBody(messages, ctx);
    return new Promise(function (resolve, reject) {
      call('subagent:subagent_stream_relay', { id: S.cur || '', body: body }, 'streamRelay', function (r) {
        var d = (r && r.data) || {};
        if (r && r.success === false) { reject(new Error(String(r.message || '中继失败'))); return; }
        if (!d || (!d.content && !d.reasoning && !(d.toolCalls || []).length)) {
          reject(new Error('中继未返回内容'));
          return;
        }
        var chunks = d.chunks || [];
        if (!onDelta || !chunks.length) { resolve(d); return; }
        /* 按块回放：总时长不好预估，用固定间隔，块多就慢一点、块少就快一点 */
        var gap = chunks.length > 120 ? 8 : (chunks.length > 40 ? 12 : 16);
        var i = 0;
        function tick() {
          if (!ALIVE) { resolve(d); return; }
          if (i >= chunks.length) { resolve(d); return; }
          var c = chunks[i++] || {};
          if (c.content || c.reasoning) onDelta({ content: c.content || '', reasoning: c.reasoning || '' });
          setTimeout(tick, gap);
        }
        tick();
      });
    });
  }

  /* 统一入口：XHR 优先（WebView 最可靠），失败再 fetch 直连，再失败落中继，
     中继失败交给上层降级 advanceTask。
     为什么 XHR 排第一：部分 Android WebView 的 fetch + response.body.getReader()
     能拿到 reader（诊断显示 reader=yes），但 read() 攒到整包结束才 resolve，
     用户就看不到逐字。XHR 的 onprogress 由宿主触发，每段都回调，绕开这个坑。 */
  function streamOnce(messages, onDelta) {
    return streamOnceXhr(messages, onDelta).then(null, function (eXhr) {
      /* XHR 这条路不通（被拦/端点不可达）→ 再试 fetch 直连 */
      STREAM.lastDirectErr = String((eXhr && eXhr.message) || eXhr || '');
      return streamOnceDirect(messages, onDelta).then(null, function (eDirect) {
        /* 两条直连都失败 → 换后端中继，不让用户看见报错。
           但必须留痕：之前完全静默，用户根本不知道自己在走中继，
           以为「配了 CORS 还是没流式」是代码问题。现在把原因写进 live 状态行。 */
        if (STREAM.ctx && STREAM.ctx.endpoint) STREAM.relay = true;
        STREAM.lastDirectErr = String((eDirect && eDirect.message) || eDirect || STREAM.lastDirectErr || '');
        setLive('直连失败，走中继回放…');
        /* 只在本次会话第一次失败时提示，避免每轮刷屏。
           这条提示是排障关键：能直接看到 CORS 拦 / 网络不通 / HTTP 4xx 的真实文案。 */
        if (!STREAM.warnedDirect) {
          STREAM.warnedDirect = true;
          try { err('直连失败：' + STREAM.lastDirectErr.slice(0, 160)); } catch (eW) {}
        }
        return streamOnceRelay(messages, onDelta).then(function (r) { return r; }, function (eRelay) {
          throw /abort/i.test(String((eDirect && eDirect.message) || eDirect || '')) ? eDirect : eRelay;
        });
      });
    });
  }

  /* ── 流式主循环 ──
     严格串行：模型 → 若返回 tool_calls → 逐个执行（等回包）→ 把结果塞回 messages → 再问模型。
     一步都不抢跑。页面负责显示，工具执行仍在后端。 */
  function streamChat(opts) {
    opts = opts || {};
    if (STREAM.busy) { err('上一轮还在生成'); return; }
    var id = String(opts.taskId || S.cur || '');
    if (!id) { err('没有选中的任务'); return; }
    STREAM.busy = true;
    S.streaming = true;
    /* 流式会自己往 dtChat 里画，指纹必须失效：否则流式结束后 trace 重建时
       算出的 h 若与流式前的旧指纹相同，会被误判成「没变化」而不渲染。 */
    S.chatSig = null;
    setLive('连接中…');
    /* 占位气泡：后续 delta 直接往里追加，不重建整棵 DOM */
    var host = $('dtChat');
    if (!host) { STREAM.busy = false; S.streaming = false; return; }
    var holder = document.createElement('div');
    holder.className = 'streambox';
    holder.innerHTML = '<div class="sb-think" data-state="0" style="display:none"></div>'
      + '<div class="sb-body md-body"></div>';
    host.appendChild(holder);
    var thinkEl = holder.querySelector('.sb-think');
    var bodyEl = holder.querySelector('.sb-body');
    var thinkBuf = '', bodyBuf = '';
    /* 【第五十七轮】当前流式工具卡容器：一批工具共用一个卡，换轮时置空 */
    var _streamToolCard = null;
    /* 【第五十八轮】当前流式卡片容器，思考段与工具段共用它 */
    var _streamBlock = null;

    /* 逐帧渲染：每块 delta 到达后下一帧就刷，不再攒 60ms 批。
       长文本靠 md() 只在正文变化时重算，滚动用 rAF 合并，避免每块都触发重排。 */
    /* 渲染节流：用时间戳代替 requestAnimationFrame。
       【为什么必须换】WebView 在悬浮窗/被遮挡/后台时，requestAnimationFrame 会被
       暂停或极度降频。原来写成：
         if (paintPending) return;
         paintPending = true;
         rAF(function () { paintPending = false; doPaint(); });
       rAF 一旦不触发，paintPending 就永远停在 true，后续每一次 paint() 都在
       第一行 return —— 一个字节都不再画。用户看到的就是「输出一会儿停住，
       等流结束一下子全部蹦出来」。
       实测证据：状态行 rs/seen/cd 三个数字一直在涨（数据在收、在解析），
       但画面完全不动，FPS 59，页面不卡。
       换成时间戳节流后不依赖 rAF，主线程活着就一定会画。 */
    var lastPaintAt = 0;
    function paint(force) {
      var now = Date.now();
      if (!force && (now - lastPaintAt) < 50) return;
      lastPaintAt = now;
      doPaint();
      /* 注意：这里绝不能调 flushStream。
         flushStream → call() → SBNative.call 是同步阻塞的，后端还要写文件 + 读回校验。
         把它放在每 50ms 的绘制路径上，等于流式过程中反复冻结主线程，
         画面看起来就是「卡住 / 不动」。
         落盘改由独立的定时器驱动（见下面的 flushTimer）。 */
    }
    function doPaint() {
      if (thinkBuf) {
        thinkEl.style.display = '';
        /* 【滚动位置保持】textContent 赋值会清空子节点，scrollTop 归零。
           0 档要贴底（跟手），1/2 档要保住用户当前翻到的位置。
           所以先记下旧位置，赋值后按档位恢复。 */
        var _st = parseInt(thinkEl.getAttribute('data-state') || '0', 10) || 0;
        var _prevTop = thinkEl.scrollTop;
        thinkEl.textContent = thinkBuf;
        if (_st === 0) {
          /* 0 档：始终贴底，看最新思考 */
          thinkEl.scrollTop = thinkEl.scrollHeight;
        } else {
          /* 1/2 档：恢复用户位置，不抢他的滚动 */
          thinkEl.scrollTop = _prevTop;
        }
      }
      if (bodyBuf) bodyEl.innerHTML = md(bodyBuf);
      var c = $('dtChat');
      if (c) c.scrollTop = c.scrollHeight;
    }
    /* 流式增量落盘：独立定时器驱动，不挂在绘制路径上。
        【为什么必须有】原来 thinkBuf/bodyBuf 只活在页面内存里，
        用户退出面板再进来，内容全丢、后端状态还是 queued（显示「待开始」），
        只能重新点启动 → 重跑的内容又叠一层，越滚越大。
        【为什么用定时器而不是跟着 paint 走】flushStream 最终是同步桥调用，
        挂在每 50ms 的绘制路径上会反复冻结主线程，流式看起来就是卡住。
        间隔 8 秒足够：落盘只为了「退出不丢」，不需要实时。 */
    function flushStream(force) {
      if (!id || (!thinkBuf && !bodyBuf)) return;
      STREAM.curId = id;
      STREAM.curThink = thinkBuf;
      STREAM.curBody = bodyBuf;
      call('subagent:subagent_stream_flush', {
        id: id, think: thinkBuf, body: bodyBuf
      }, 'streamFlush');
    }
    var flushTimer = setInterval(function () {
      if (!ALIVE || !STREAM.busy) {
        try { clearInterval(flushTimer); } catch (eFT) {}
        return;
      }
      flushStream(false);
    }, 8000);
    STREAM._flushTimer = flushTimer;
    /* 立刻落一次：把 status 置 running。
       不然前 8 秒后端还是 queued，状态行显示「待开始」，
       用户会以为没跑起来。这次不带内容，只为了让状态立刻正确。 */
    call('subagent:subagent_stream_flush', { id: id, think: '', body: '' }, 'streamFlush');

    loadStreamEnv(id, function (e0) {
      if (e0) {
        /* 环境取不到（无端点/无密钥）→ 降级后端推进，不报死 */
        sinkToAdvance(id, holder, String(e0.message || e0));
        return;
      }
      /* 从后端拿任务的消息历史作为起点 */
      call('subagent:subagent_get', { id: id, detail: 'trace', limit: 60 }, 'trace', function (r) {
        var d = (r && r.data) || {};
        var turns = d.turns || [];
        var msgs = [];
        for (var i = 0; i < turns.length; i++) {
          var m = turns[i] || {};
          var role = String(m.role || '');
          if (role === 'system') {
            /* system 是子代理的全部指令来源（任务/工具/输出格式），绝不能丢 */
            msgs.push({ role: 'system', content: String(m.content || '') });
            continue;
          }
          if (role === 'assistant') {
            var a = { role: 'assistant', content: String(m.content || '') };
            if (m.reasoning) a.reasoning_content = String(m.reasoning);
            if (m.tool_calls && m.tool_calls.length) {
              a.tool_calls = m.tool_calls.map(function (tc) {
                return {
                  id: String(tc.id || ''), type: 'function',
                  function: { name: String(tc.name || ''), arguments: String(tc.args || '{}') }
                };
              });
            }
            msgs.push(a);
          } else if (role === 'tool') {
            msgs.push({ role: 'tool', tool_call_id: String(m.calls_id || ''), content: String(m.result || '') });
          } else if (role === 'user') {
            msgs.push({ role: 'user', content: String(m.content || '') });
          }
        }
        runRound(msgs, 0);
      });
    });

    function runRound(msgs, depth) {
      if (!ALIVE) { STREAM.busy = false; S.streaming = false; return; }
      if (depth > 8) {
        STREAM.busy = false; S.streaming = false;
        err('工具调用层数过多，已停止');
        setLive('');
        return;
      }
      thinkBuf = ''; bodyBuf = '';
      /* 【第六十轮】_streamBlock 整轮复用不重置，_streamToolCard 每轮重开段 */
      _streamToolCard = null;
      setLive(depth === 0 ? '模型生成中…' : '继续推理…');
      streamOnce(msgs, function (delta) {
        if (!ALIVE) return;
        if (delta.reasoning) thinkBuf += delta.reasoning;
        if (delta.content) bodyBuf += delta.content;
        paint(false);
      }).then(function (out) {
        paint(true);
        if (!ALIVE) return;
        /* 没有工具调用 → 这一轮就是答案，落盘并收尾 */
        if (!out.toolCalls || !out.toolCalls.length) {
          STREAM.busy = false; S.streaming = false;
          S.advancing = false;
          setLive('');
          /* 内容为空但只有思考：明确告知，不静默返回空 */
          if (!out.content && out.reasoning) {
            err('模型只输出了思考、没有正文（可把思考等级调低或提高 max_tokens）');
          }
          /* 先把前端状态置成已完成，别等后端回包才更新——否则会一直停在「待开始」 */
          S.curStatus = 'done';
          if (S.cur) {
            for (var qi = 0; qi < S.items.length; qi++) {
              if (S.items[qi].id === S.cur) { S.items[qi].status = 'done'; break; }
            }
          }
          /* 立刻在页面上补最终内容（思考在前、正文在后），不靠等 trace */
          if (out.reasoning) {
            var tb2 = document.createElement('div');
            tb2.className = 'thinkbox';
            /* 继承流式区的当前档位：用户流式时展开了，结束后不该跳回收起 */
            var _keepSt = parseInt((thinkEl && thinkEl.getAttribute('data-state')) || '0', 10) || 0;
            tb2.setAttribute('data-state', String(_keepSt));
            tb2.innerHTML = '<div class="thk-head">' + SVG_CHEV
              + '<span class="thk-tx">思考过程</span><span class="thk-tip">展开</span></div>'
              + '<div class="thk-body">' + esc(out.reasoning) + '</div>';
            host.appendChild(tb2);
            /* 档位非 0 时补上高度 class 与角标（HTML 里默认写的是 0 档） */
            if (_keepSt !== 0) setThinkState(tb2, _keepSt);
          }
          if (out.content) {
            var fin = document.createElement('div');
            fin.className = 'bubble ai';
            fin.innerHTML = '<div class="b-body md-body">' + md(out.content) + '</div>';
            host.appendChild(fin);
          }
          /* 把自己这个临时流式块清掉，避免和落盘内容重复显示 */
          holder.remove();
          syncDtBar();
          /* 落盘：刷新页面后内容仍在；页面只管显示，持久化交给后端 */
          var saved = { role: 'assistant', content: out.content || '' };
          if (out.reasoning) saved.reasoning = out.reasoning;
          /* usage 与 finish_reason 一起回传：后端靠它累计 token/花费，否则状态行永远 0 tok */
          var _sv = { id: id, turns: [saved], done: true };
          if (out.usage) _sv.usage = out.usage;
          if (out.finishReason) _sv.finish_reason = String(out.finishReason);
          call('subagent:subagent_save_turn', _sv, 'saveTurn', function () {
            if (S.cur) call('subagent:subagent_get', { id: S.cur, detail: 'trace', limit: 40 }, 'trace');
          });
          refreshList(false);
          return;
        }
        /* 有工具调用：先把这一轮的助手消息入 messages，再逐个执行 */
        var asst = { role: 'assistant', content: out.content || '' };
        if (out.reasoning) asst.reasoning_content = out.reasoning;
        asst.tool_calls = out.toolCalls.map(function (tc) {
          return { id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || '{}') } };
        });
        msgs.push(asst);
        /* 【关键修复 2026-11-07】工具调用这一轮结束后，必须把当前流式 holder「定格」：
           1) 把本轮已流出的思考/正文转成正式气泡，留在时间线里
           2) 清空 holder 内容并给下一轮 runRound 用新 holder
           不这么做的话：runRound 里 thinkBuf/bodyBuf 清零但 holder DOM 还留着旧内容，
           下一轮流式又往同一个 holder 里画 → 视觉上「先显示一段、突然消失、再重新出现」。
           用户实测就是这个现象：先冒出 list_files 工具块，然后整块消失变成正文。 */
        try {
          if (thinkBuf || bodyBuf) {
            /* 【第六十轮】正文也进同一个卡片 */
            if (bodyBuf) {
              var _txt = document.createElement('div');
              _txt.className = 'agent-text';
              _txt.innerHTML = md(bodyBuf);
              if (!_blk) { _blk = document.createElement('div'); _blk.className = 'agent-block'; }
              _blk.appendChild(_txt);
            }
            /* 【第六十轮】整轮共用一个 agent-block，不再每条新建 */
            var _blk = _streamBlock;
            if (!_blk || !_blk.parentNode) {
              _blk = document.createElement('div');
              _blk.className = 'agent-block';
              host.insertBefore(_blk, holder);
              _streamBlock = _blk;
            }
            if (thinkBuf) {
              var _th = document.createElement('div');
              _th.className = 'thinkbox thk-sec';
              _th.setAttribute('data-state', '1');
              _th.innerHTML = '<div class="thk-head">' + SVG_CHEV
                + '<span class="thk-tx">思考过程</span><span class="thk-tip">展开</span></div>'
                + '<div class="thk-body">' + esc(thinkBuf) + '</div>';
              _blk.appendChild(_th);
            }
            if (_blk.childNodes.length) host.insertBefore(_blk, holder);
            thinkBuf = ''; bodyBuf = '';
            holder.innerHTML = '<div class="sb-think" data-state="0" style="display:none"></div>'
              + '<div class="sb-body md-body"></div>';
            thinkEl = holder.querySelector('.sb-think');
            bodyEl = holder.querySelector('.sb-body');
          }
        } catch (eHist) {}
        var queue = out.toolCalls.slice();
        var idx = 0;
        function nextTool() {
          if (!ALIVE) { STREAM.busy = false; S.streaming = false; return; }
          if (idx >= queue.length) { runRound(msgs, depth + 1); return; }
          var tc = queue[idx++];
          setLive('正在执行 ' + tc.name + '…');
          /* 串行铁律：调一个、等一个、再下一个 */
          call('subagent:subagent_tool_once', {
            id: id, tool: tc.name, args: tc.args || {}
          }, 'toolOnce', function (rr) {
            var dd = (rr && rr.data) || {};
            var content = dd.ok ? String(dd.result || '') : ('ERROR: ' + String(dd.error || '工具失败'));
            msgs.push({ role: 'tool', tool_call_id: tc.id, content: content });
            /* 工具结果立刻显示在时间线里，用户能看到进展 */
            /* 【第五十六轮】工具结果用 toolRow 渲染，跟思考同一张卡同一外观。
               旧路径用 .tblock（青边半透明底），背景跟思考卡不一致，
               用户原话「连背景都不一样，怎么是一个卡片」。 */
            S._toolMap = S._toolMap || {};
            S._toolMap[String(tc.name)] = {
              call: { name: tc.name, args: JSON.stringify(tc.args || {}) },
              res: { ok: dd.ok, result: content, chars: content.length }
            };
            var rowHtml = toolRow({ name: tc.name, args: tc.args || null },
                                  { ok: dd.ok, result: content, error: dd.ok ? null : content });
            /* 【第五十七轮】工具独立成卡，跟思考卡并排不合并。
               流式期间这张卡保持展开（data-state=1）看着跑；
               整批调用结束后由 nextTool 收尾收敛。 */
            var cur = _streamToolCard;
            if (!cur || !cur.parentNode) {
              /* 【第五十八轮】工具段放进当前 agent-block；没有就新建一个 */
              var blk = _streamBlock;
              if (!blk || !blk.parentNode) {
                blk = document.createElement('div');
                blk.className = 'agent-block';
                host.insertBefore(blk, holder);
                _streamBlock = blk;
              }
              cur = document.createElement('div');
              cur.className = 'thinkbox toolcard thk-sec';
              cur.setAttribute('data-state', '1');
              cur.innerHTML = '<div class="thk-head">'
                + '<svg class="chv" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>'
                + '<span class="thk-tx">工具调用</span>'
                + '<span class="tool-count"></span>'
                + '<span class="thk-tip">收起</span></div>'
                + '<div class="thk-body"></div>';
              blk.appendChild(cur);
              _streamToolCard = cur;
            }
            var tbody = cur.querySelector('.thk-body');
            if (tbody) tbody.insertAdjacentHTML('beforeend', rowHtml);
            /* 计数：本卡里工具行数量 */
            try {
              var cntEl = cur.querySelector('.tool-count');
              var nrows = cur.querySelectorAll('.trowc').length;
              if (cntEl) cntEl.textContent = '(' + nrows + ')';
            } catch (eC) {}
            syncThinkFloat();
            nextTool();
          });
        }
        nextTool();
      }).then(null, function (e1) {
        if (!ALIVE) return;
        var m1 = String((e1 && e1.message) || e1);
        if (/abort/i.test(m1)) {
          STREAM.busy = false; S.streaming = false;
          setLive('');
          toast('已中断生成', 'warn');
          return;
        }
        /* 已生成的内容不丢：先落盘，避免用户白等一场 */
        if (bodyBuf || thinkBuf) {
          var keep = { role: 'assistant', content: String(bodyBuf || '') };
          if (thinkBuf) keep.reasoning = String(thinkBuf);
          call('subagent:subagent_save_turn', { id: id, turns: [keep], done: false }, 'saveTurn', function () {});
        }
        /* 关键：任何流式失败都降级到后端推进，绝不把任务晾在 queued。
           上一轮删掉整个流式就是因为漏了这一步。 */
        sinkToAdvance(id, holder, explainFetchErr((STREAM.ctx && STREAM.ctx.endpoint) || '', e1), bodyBuf, thinkBuf);
      });
    }
  }

  /* 流式走不通时的统一兜底：收起占位块 → 提示能看懂的原因 → 转后端推进。
     降级只提示一次，同一任务反复失败不刷屏。 */
  function sinkToAdvance(id, holder, reason, bodyBuf, thinkBuf) {
    STREAM.busy = false;
    S.streaming = false;
    setLive('');
    if (holder && holder.parentNode) holder.remove();
    if (!STREAM.fellBack) {
      STREAM.fellBack = true;
      warnMsg('该端点不支持流式，已切后端推进（无逐字效果，功能不受影响）');
    }
    if (reason && /HTTP \d{3}/.test(String(reason))) warnMsg(String(reason).slice(0, 200));
    /* 已经有内容就先留住，别让用户白等 */
    if (bodyBuf || thinkBuf) {
      var keep = { role: 'assistant', content: String(bodyBuf || '') };
      if (thinkBuf) keep.reasoning = String(thinkBuf);
      call('subagent:subagent_save_turn', { id: id, turns: [keep], done: false }, 'saveTurn', function () {});
    }
    advanceTask(id, 1);
  }

  /* 停止流式 */
  function abortStream() {
    if (STREAM.abort) { try { STREAM.abort.abort(); } catch (e) {} }
    STREAM.abort = null;
    /* 【必须清】流式落盘定时器。不清的话它要等下一个 8 秒才自己发现 busy=false，
       这 8 秒里会继续把内容写回后端，把刚取消的任务又写成 running。 */
    if (STREAM._flushTimer) {
      try { clearInterval(STREAM._flushTimer); } catch (eFT2) {}
      STREAM._flushTimer = null;
    }
    STREAM.busy = false;
    S.streaming = false;
    setLive('');
    /* 【关键】清掉空的流式占位块。
       中断时 holder 里通常只有骨架（空的 .sb-think + .sb-body），
       留在时间线上就是一块空白，用户以为界面卡死。
       有内容的才保留（那是已经生成的部分，不能丢）。 */
    try {
      var host = $('dtChat');
      if (host) {
        var boxes = host.querySelectorAll('.streambox');
        for (var i = 0; i < boxes.length; i++) {
          var bx = boxes[i];
          var th = bx.querySelector('.sb-think');
          var bd = bx.querySelector('.sb-body');
          var hasThink = th && String(th.textContent || '').trim();
          var hasBody = bd && String(bd.textContent || '').trim();
          if (!hasThink && !hasBody) {
            bx.parentNode.removeChild(bx);
          }
        }
      }
    } catch (eCl) {}
    /* 指纹失效，下一次 trace 能正常重绘 */
    S.chatSig = null;
  }

  /* 推进任务：steps 默认 1，一次最多 3（后端限制）
   注意 桥 20 秒会超时，但后端不受影响会继续跑完。
   所以这里不等回包判定结果，启动了就交给轮询（startPoll）盯进度。 */
  function advanceTask(id, steps) {
    if (!id) return;
    S.advancing = true;
    S.curStatus = 'running';
    setLive('模型生成中…');
    startPoll();
    call('subagent:subagent_run', { id: id, wait: false, max_steps: Math.min(3, Math.max(1, steps || 1)) }, 'advance');
  }
  /* 轮询：整个界面的进度真源。每 1.5 秒读一次 trace，
     桥超时也不停——后端还在跑，trace 会一直变化。 */
  function startPoll() {
    stopPoll();
    pollOnce();
  }
  function stopPoll() {
    try { clearTimeout(S.pollT); } catch (e) {}
    S.pollT = null;
  }
  function pollOnce() {
    if (!ALIVE) return;
    try { clearTimeout(S.pollT); } catch (e) {}
    S.pollT = null;
    if (!S.cur || S.page !== 'detail') return;
    var st = String(S.curStatus || '');
    if (st !== 'running' && st !== 'queued') return;
    /* 【关键】用户在输入框打字时跳过这一轮轮询。
       桥调用是同步阻塞的（addJavascriptInterface），一次 trace 回来就卡住 JS 线程，
       用户每敲一个字符，正好撞上轮询 → 输入卡顿 + 下方内容跟着重建跳动。
       跳过不丢信息：下一轮（1.5s 后）照常拉，任务本身在后端跑不受影响。 */
    var ae = document.activeElement;
    var typing = !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA'));
    if (typing) {
      S.pollT = setTimeout(pollOnce, 600);
      return;
    }
    call('subagent:subagent_get', { id: S.cur, detail: 'trace', limit: 40 }, 'trace');
    /* 桥已超时说明后端还在跑，这时把轮询降频：原来 1.5s 一次会让整页发烫变卡。
       恢复正常后再回到高频，保证有进展时界面跟得上。 */
    var gap = S.bridgeDropped ? 2200 : 1500;
    S.pollT = setTimeout(pollOnce, gap);
  }
  /* 兼容旧调用点：tickDetail 已并入 pollOnce */
  function tickDetail() {
    if (!S.cur || S.page !== 'detail') return;
    var st = String(S.curStatus || '');
    if (st !== 'running' && st !== 'queued') return;
    startPoll();
  }
  function openTools() {
    if (!S.tools) call('subagent:subagent_env', { what: 'tools' }, 'tools');
    /* 多选：点选即时改 S.sel，右下的「确定」只是关闭并回读，不会丢选择 */
    openDlg('允许工具', toolGroups(), true, function (picked) {
      if (picked && picked.length) S.sel = picked.slice();
      if ($('vTools')) $('vTools').textContent = S.sel.length ? (S.sel.length + ' 项') : '未选择';
    });
  }

  /* ── 配置 ── */
  var PROVIDERS = {
    'DeepSeek 官方': { ep: 'https://api.deepseek.com/v1' },
    'OpenAI 官方': { ep: 'https://api.openai.com/v1' },
    'Gemini 兼容': { ep: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    'OpenRouter': { ep: 'https://openrouter.ai/api/v1' },
    'Anthropic 兼容': { ep: '' },
    '自定义中转': { ep: '' }
  };
  /* ── 端点后缀自动补全 ──
 * 规则（严格按用户要求，绝不做多余推断）：
 *   1. 不写协议 → 补 https://
 *   2. 路径为空或只有 /         → 补 /v1/chat/completions
 *   3. 路径正好是 /v1（或 /v1/）  → 补 /chat/completions
 *   4. 其它任何路径（/v1/models、/openai、/api/v3…）→ 原样不动
 *   5. 已经是 /chat/completions 或 /responses 或 /messages → 原样不动
 * 用户自己填了后缀，绝不会再叠加。 */
  function epNorm(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    s = s.replace(/\s+/g, '');
    var m = s.match(/^(https?:\/\/[^\/]+)(\/.*)?$/i);
    if (!m) return s;
    var host = m[1];
    var p = (m[2] || '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');   /* 折叠多斜杠 + 去尾斜杠 */
    /* 已经有完整协议后缀 → 原样返回（大小写不敏感，输出用小写标准名） */
    if (/\/chat\/completions$/i.test(p)) return host + p.replace(/\/chat\/completions$/i, '/chat/completions');
    if (/\/responses$/i.test(p)) return host + p.replace(/\/responses$/i, '/responses');
    if (/\/messages$/i.test(p)) return host + p;
    /* 空路径 → 补整段 */
    if (p === '') return host + '/v1/chat/completions';
    /* 只有 /v1（任意版本号）→ 补 chat/completions */
    if (/^\/v\d+$/i.test(p)) return host + p + '/chat/completions';
    /* 其它路径原样不动 */
    return host + p;
  }
  /* 判断补全动了什么，返回一句人话给预览行 */
  function epExplain(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { text: '填写 API 端点后自动补全', warn: false };
    /* 用户自己已经写全了 → 明确告知不会再动 */
    if (/\/chat\/completions\/?$/i.test(s) || /\/responses\/?$/i.test(s) || /\/messages\/?$/i.test(s)) {
      return { text: '已完整，按原样使用 ' + s.replace(/\/+$/, ''), warn: false, full: s };
    }
    var full = epNorm(s);
    var sFull = full.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(full)) {
      return { text: '将补全为 ' + sFull, warn: false, full: sFull };
    }
    /* 有非 v1 的路径 → 不补，但要说明 */
    var m = full.match(/^(https?:\/\/[^\/]+)(\/.*)$/i);
    if (m && m[2]) {
      return { text: '自定义路径，按原样使用 ' + sFull, warn: true, full: sFull };
    }
    return { text: '将补全为 ' + sFull, warn: false, full: sFull };
  }
  function syncEpPreview() {
    var el = $('inEp'), pre = $('epPre');
    if (!el || !pre) return;
    var r = epExplain(el.value);
    pre.className = 'ep-pre' + (r.warn ? ' warn' : '');
    pre.textContent = r.text;
    syncCfgTip();
  }
  /* 三项齐了才提示测试 */
  function syncCfgTip() {
    var tip = $('cfgTip');
    if (!tip) return;
    var ep = $('inEp') ? String($('inEp').value || '').trim() : '';
    var model = $('inModel') ? String($('inModel').value || '').trim() : '';
    var keyOn = !!S.keyOk;
    var ok = !!(ep && model && keyOn);
    tip.style.display = ok ? '' : 'none';
    if (ok && $('cfgTipTxt')) {
      /* 连通性判断不能靠文案匹配（verdict 可能是「连通正常 · 198 个模型」等变体）：
       用 S.probed 这个布尔量记「是否测过」，测过就换提示文案 */
      $('cfgTipTxt').textContent = S.probed
        ? '配置完整，再测一次可刷新结果'
        : '端点、密钥、模型都齐了，点这里测试连通性';
    }
  }
  function renderCfg(d) {
    var p = (d && d.profile) || {}, st = (d && d.status) || {};
    S.cfgProv = p.api_provider || '';
    S.cfgModel = p.model || (st.model || '');
    S.keyOk = !!st.key_configured;
    if ($('cfgProv')) $('cfgProv').textContent = S.cfgProv ? String(S.cfgProv).replace(/通用$/, '') : '未点选择';
    if ($('cfgKey')) {
      $('cfgKey').textContent = st.key_configured ? '已配置' : '未配置';
      $('cfgKey').className = 'cfg-val ' + (st.key_configured ? 'ok' : 'bad');
    }
    /* 用户已经手动填过东西时，不要用后端旧值覆盖输入框 */
    if (!S.formDirty) {
      if ($('inEp')) $('inEp').value = p.base_url || st.base_url || '';
      if ($('inModel')) $('inModel').value = p.model || st.model || '';
    }
    /* 模型块副标题：显示缓存到的模型数量 */
    if ($('cbModelSub')) {
      var n = (d && d.models_count) || 0;
      $('cbModelSub').textContent = n ? ('共 ' + n + ' 个可选模型，点右侧列表选一个') : '从列表里选一个，或直接手填';
    }
    syncEpPreview();
    syncCfgTip();
    /* 密钥不回填明文（只写不读）。已配置时给占位提示，让用户知道不用重填；
       输入框里用户已经打的字绝不覆盖 */
    if ($('inKey') && !S.keyFilled) {
      $('inKey').placeholder = st.key_configured ? '已保存（不显示，需要更换时重新输入）' : 'sk-…';
    }
    /* 模型列表：进页面直接吃后端 24h 磁盘缓存，不用等网络 */
    if (!S.allModels.length && (d && d.cached_models) && d.cached_models.length) {
      fillModels(d.cached_models, true, d.models_at || 0);
    }
    /* 版本号：后端 status 里带 version 就直接显示，没有就拉一次 */
    if (d && d.version && $('updCur')) $('updCur').textContent = d.version;
    if ($('updCur') && (!$('updCur').textContent || $('updCur').textContent === '—')) {
      call('subagent:subagent_env', { what: 'version' }, 'updStatus');
    }
    /* 进页面时拉一次下载状态：上次没下完的话进度要能续上显示 */
    call('subagent:subagent_update', { step: 'status' }, 'updStatus');
  }

  /* ── 版本更新（第三十轮，仿 on_air）──
     只做「检查 → 下载 → 提示去包管理导入」，不做自动安装：
     .toolpkg 的安装要宿主介入，插件层没有这个权限。 */
  var UPD = { release: null, timer: 0, checking: false };

  function updMsg(text, cls) {
    var el = $('updMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'upd-msg' + (cls ? (' ' + cls) : '');
  }

  /* 检查更新 */
  function updCheck(force) {
    if (UPD.checking) return;
    UPD.checking = true;
    var btn = document.querySelector('[data-act="updCheck"]');
    if (btn) btn.classList.add('spin');
    updMsg('正在检查…');
    call('subagent:subagent_update', { step: 'check', force: !!force }, 'updCheck', function () {
      UPD.checking = false;
      if (btn) btn.classList.remove('spin');
    });
  }

  function renderUpdCheck(r) {
    UPD.checking = false;
    var btn = document.querySelector('[data-act="updCheck"]');
    if (btn) btn.classList.remove('spin');
    if (!r || r.success === false) {
      updMsg((r && r.message) || '检查失败', 'err');
      return;
    }
    var d = r.data || {};
    if (d.current && $('updCur')) $('updCur').textContent = d.current;
    UPD.release = d;
    if (!d.has_update) {
      updMsg('已是最新版本' + (d.latest ? ('（' + d.latest + '）') : ''), 'ok');
      if ($('updNew')) $('updNew').style.display = 'none';
      return;
    }
    /* 有新版本：填卡片 */
    updMsg('发现新版本 ' + d.latest, 'ok');
    if ($('updTag')) $('updTag').textContent = d.latest || '';
    /* 更新说明默认折起：超过 3 行的才给「展开」按钮 */
    if ($('updNotes')) {
      var noteEl = $('updNotes');
      var txt = d.notes || d.notes_full || '（该版本没有写更新说明）';
      noteEl.textContent = txt;
      noteEl.classList.remove('open');
      /* 判断是否超长：临时撑开量高度，超过 3 行才显示展开按钮 */
      var needMore = false;
      try {
        var wasOpen = noteEl.classList.contains('open');
        noteEl.classList.add('open');
        var fullH = noteEl.scrollHeight;
        noteEl.classList.remove('open');
        needMore = fullH > (noteEl.clientHeight + 4);
        if (wasOpen) noteEl.classList.add('open');
      } catch (eN) { needMore = String(txt).length > 90; }
      if ($('updMore')) {
        $('updMore').style.display = needMore ? '' : 'none';
        $('updMore').textContent = '展开更新说明';
      }
    }
    if ($('updSize')) {
      var sz = Number(d.asset_size) || 0;
      $('updSize').textContent = d.has_asset
        ? ('更新包 ' + (sz > 0 ? fmtBytes(sz) : '大小未知') + (d.prerelease ? ' · 预发布版' : ''))
        : '该版本没有上传 .toolpkg 资产，无法下载';
    }
    if ($('updDlBtn')) {
      $('updDlBtn').style.display = d.has_asset ? '' : 'none';
      $('updDlBtn').textContent = '下载更新包';
    }
    if ($('updNew')) $('updNew').style.display = '';
  }

  /* 展开 / 收起更新说明 */
  function updToggleNotes() {
    var el = $('updNotes'), btn = $('updMore');
    if (!el) return;
    var open = el.classList.toggle('open');
    if (btn) btn.textContent = open ? '收起' : '展开更新说明';
  }

  /* 打开官网下载页：本机 github.com 不可达，但系统浏览器可以，交给系统打开。
       后端字段是 url（对应 Release 的 html_url），不是 html_url。 */
  function updOpenSite() {
    var url = (UPD.release && UPD.release.url) || 'https://github.com/what-my-names/subagent/releases';
    try {
      window.open(url, '_blank');
    } catch (e1) {
      try { window.location.href = url; } catch (e2) { toast('官网：' + url, 'ok'); }
    }
  }

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (Math.round(n / 104857.6) / 10) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  /* 下载更新 */
  function updDownload() {
    if ($('updDlBtn')) { $('updDlBtn').disabled = true; $('updDlBtn').textContent = '下载中…'; }
    if ($('updProg')) $('updProg').style.display = '';
    if ($('updProgLb')) $('updProgLb').textContent = '下载中';
    if ($('updProgMsg')) $('updProgMsg').textContent = '正在连接 GitHub…';
    if ($('updBarIn')) $('updBarIn').style.width = '0%';
    if ($('updPath')) $('updPath').textContent = '';
    call('subagent:subagent_update', { step: 'download' }, 'updDownload');
    /* 轮询状态：下载是后端阻塞的，页面只能靠轮询看进度 */
    if (UPD.timer) { try { clearInterval(UPD.timer); } catch (e0) {} }
    UPD.timer = setInterval(function () {
      if (!ALIVE) { try { clearInterval(UPD.timer); } catch (e1) {} return; }
      call('subagent:subagent_update', { step: 'status' }, 'updStatus');
    }, 1500);
  }

  function renderUpdDownload(r) {
    if (UPD.timer) { try { clearInterval(UPD.timer); } catch (e0) {} UPD.timer = 0; }
    if ($('updDlBtn')) { $('updDlBtn').disabled = false; $('updDlBtn').textContent = '下载更新包'; }
    var ok = !!(r && r.success !== false);
    var msg = (r && r.message) || (ok ? '下载完成' : '下载失败');
    updMsg(msg, ok ? 'ok' : 'err');
    if ($('updProg')) $('updProg').style.display = '';
    var d = (r && r.data) || {};
    var installed = !!d.installed;
    if ($('updProgLb')) {
      $('updProgLb').textContent = !ok ? '下载失败' : (installed ? '已安装' : '下载完成');
    }
    if ($('updProgMsg')) $('updProgMsg').textContent = msg;
    if ($('updBarIn') && ok) $('updBarIn').style.width = '100%';
    if ($('updPath')) {
      if (installed) {
        $('updPath').textContent = '已写入 ' + (d.path || '') + '　→ 已生效';
      } else if (d.path) {
        $('updPath').textContent = '文件：' + d.path + '（未自动安装，可点「立即安装」）';
      } else {
        $('updPath').textContent = '';
      }
    }
    /* 下载成功但没装上时，给个手动安装入口 */
    if ($('updInstall')) {
      $('updInstall').style.display = (ok && !installed) ? '' : 'none';
    }
    call('subagent:subagent_update', { step: 'status' }, 'updStatus');
  }

  /* 手动安装（下载完成但自动安装失败时用） */
  function updInstall() {
    if ($('updInstall')) { $('updInstall').disabled = true; $('updInstall').textContent = '安装中…'; }
    call('subagent:subagent_update', { step: 'install' }, 'updInstall');
  }

  function renderUpdInstall(r) {
    if ($('updInstall')) { $('updInstall').disabled = false; $('updInstall').textContent = '立即安装'; }
    var ok = !!(r && r.success !== false);
    var msg = (r && r.message) || (ok ? '已安装' : '安装失败');
    updMsg(msg, ok ? 'ok' : 'err');
    if ($('updProgLb')) $('updProgLb').textContent = ok ? '已安装' : '安装失败';
    if ($('updProgMsg')) $('updProgMsg').textContent = msg;
    var d = (r && r.data) || {};
    if ($('updPath') && d.path) {
      $('updPath').textContent = '已写入 ' + d.path;
    }
    if (ok && $('updInstall')) $('updInstall').style.display = 'none';
  }

  /* 下载状态（轮询入口） */
  function renderUpdStatus(d) {
    if (!d) return;
    /* 版本号顺便刷新 */
    if (d.version && $('updCur') && $('updCur').textContent === '—') $('updCur').textContent = d.version;
    var st = d.status || 'idle';
    if (st === 'idle') return;
    if ($('updProg')) $('updProg').style.display = '';
    var pct = Number(d.percent) || 0;
    if ($('updBarIn')) $('updBarIn').style.width = pct + '%';
    if ($('updProgLb')) {
      $('updProgLb').textContent =
        st === 'done' ? '下载完成' :
        st === 'failed' ? '下载失败' :
        st === 'missing' ? '文件已不在' :
        ('下载中 ' + pct + '%');
    }
    if ($('updProgMsg')) {
      $('updProgMsg').textContent = d.message || (d.received_text ? (d.received_text + ' / ' + d.total_text) : '');
    }
    if ($('updPath') && d.path) {
      $('updPath').textContent = '文件：' + d.path;
    }
    /* 终态停轮询 */
    if ((st === 'done' || st === 'failed' || st === 'missing') && UPD.timer) {
      try { clearInterval(UPD.timer); } catch (e1) {}
      UPD.timer = 0;
      if ($('updDlBtn')) { $('updDlBtn').disabled = false; $('updDlBtn').textContent = '下载更新包'; }
    }
  }
  /* 密钥显示切换：默认密码态，点一下变明文 */
  function toggleKey() {
    var el = $('inKey'); if (!el) return;
    var show = el.type === 'password';
    el.type = show ? 'text' : 'password';
    if ($('btnEye')) {
      $('btnEye').innerHTML = '<svg><use href="#' + (show ? 'i-eye-off' : 'i-eye') + '"/></svg>';
      $('btnEye').setAttribute('title', show ? '隐藏密钥' : '显示密钥');
    }
    hf();
  }
  function applyCaps(caps) {
    if (!caps || !$('cfgCaps')) return;
    var on = [];
    var names = { tool_call: '工具调用', reasoning: '推理' };
    for (var k in names) {
      if (!Object.prototype.hasOwnProperty.call(names, k)) continue;
      if (caps[k]) on.push(names[k]);
    }
    $('cfgCaps').textContent = on.length ? ('支持：' + on.join(' / ')) : '（未探测到）';
    $('cfgCaps').className = 'cfg-val ' + (on.length ? 'ok' : '');
  }
  /* 渲染分层连通性结果：端点可达 / 密钥有效 / 模型可生成 */
  function renderProbe(d) {
    var pr = (d && d.probe) || d || {};
    var layers = pr.layers || [];
    var ok = pr.connected === true;
    S.probed = true;
    if ($('cfgConn')) {
      $('cfgConn').textContent = pr.verdict || (ok ? '连通正常' : '未测试');
      /* 三态：全通 ok、全不通 bad、部分通过 warn（不能把「端点可达但密钥无效」显示成全绿或全红） */
      var anyBad = false, anyOk = false;
      for (var li = 0; li < layers.length; li++) {
        var LL = layers[li] || {};
        if (LL.ok === false) anyBad = true;
        if (LL.ok === true) anyOk = true;
      }
      var cls = ok ? 'ok' : (anyOk && anyBad ? 'warn' : 'bad');
      $('cfgConn').className = 'cfg-val ' + cls;
    }
    if ($('probeLayers')) {
      if (!layers.length) { $('probeLayers').innerHTML = ''; return; }
      var names = { tool_call: '工具调用', reasoning: '推理' };
      var h = '<div class="probe-card">';
      for (var i = 0; i < layers.length; i++) {
        var L = layers[i] || {};
        var cc = L.ok === true ? 'ok' : (L.ok === false ? 'bad' : 'skip');
        var mark = L.ok === true ? '<svg><use href="#i-check"/></svg>'
          : (L.ok === false ? '<svg><use href="#i-x"/></svg>' : '<span class="dot"></span>');
        h += '<div class="probe-row ' + cc + '">'
          + '<span class="pv-mark">' + mark + '</span>'
          + '<span class="pv-name">' + esc(L.name || '') + '</span>'
          + (L.ms ? '<span class="pv-ms">' + fmtMs(L.ms) + '</span>' : '')
          + '</div>'
          + '<div class="pv-detail">' + esc(L.detail || '') + '</div>';
      }
      var caps = pr.capabilities;
      if (caps) {
        var on = [];
        for (var k in names) { if (Object.prototype.hasOwnProperty.call(names, k) && caps[k]) on.push(names[k]); }
        if (on.length) h += '<div class="pv-detail">推断能力：' + esc(on.join(' / ')) + '</div>';
      }
      if (pr.total_ms) h += '<div class="pv-detail">总耗时 ' + fmtMs(pr.total_ms) + '</div>';
      h += '</div>';
      $('probeLayers').innerHTML = h;
    }
    /* 模型能力行同步 */
    applyCaps(pr.capabilities);
  }
  function pickProv() {
    var rows = [];
    for (var k in PROVIDERS) rows.push({ val: k, label: k, desc: PROVIDERS[k].ep || '端点手填' });
    openDlg('选择 API 提供商', [{ title: '提供商', items: rows }], false, function (v) {
      if (!v || v === '__ro') return;
      var pr = PROVIDERS[v] || {};
      var ep = pr.ep || '';
      S.cfgProv = v;
      if ($('cfgProv')) $('cfgProv').textContent = String(v).replace(/通用$/, '');
      /* 只记录提供商本身。
         端点：有预置值且用户框里还是空的才填，否则一律不动。
         模型：**永远不自动填**。模型名必须由用户自己写，或从「拉取到的模型列表」里选。
         曾经这里会塞 models[0]，导致「自定义中转」被塞进 deepseek-flash，
         还只写了 model 没写端点，配置里留下 base_url 空 + model 有值的脏数据。 */
      var payload = { api_provider: v };
      if (ep) {
        var cur = ($('inEp') ? $('inEp').value : '').trim();
        if (!cur) { if ($('inEp')) $('inEp').value = ep; payload.base_url = ep; }
      }
      call('subagent:subagent_cfg', { action: 'set', payload: payload }, 'cfgset');
    }, false);
  }
  /* API 端点右侧下拉：只给「协议后缀」两个选项，不是常用端点列表。
     主机名由用户自己填，这里只决定末尾补什么。 */
  function pickEp() {
    var base = ($('inEp') ? String($('inEp').value || '').trim() : '');
    /* 先剥掉已有的协议后缀，拿到纯根 */
    var root = base.replace(/\/chat\/completions\/?$/i, '').replace(/\/responses\/?$/i, '').replace(/\/+$/, '');
    root = root.replace(/^https?:\/\//i, '');
    var host = /^[^\/]+/.test(root) ? root.match(/^[^\/]+/)[0] : '';
    var pre = host ? ('https://' + host) : '';
    var rows = [
      { val: 'chat', label: 'v1 / chat / completions', desc: pre ? (pre + '/v1/chat/completions') : 'OpenAI 兼容对话（最常用）' },
      { val: 'responses', label: 'v1 / responses', desc: pre ? (pre + '/v1/responses') : 'OpenAI Responses 协议' },
      { val: 'none', label: '不补后缀', desc: '我已填完整地址，或协议不属于上面两种' }
    ];
    openDlg('端点后缀', [{ title: '补什么', items: rows }], false, function (v) {
      if (!v || v === '__ro') return;
      var cur = ($('inEp') ? String($('inEp').value || '').trim() : '');
      var r = cur.replace(/\/chat\/completions\/?$/i, '').replace(/\/responses\/?$/i, '').replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(r)) r = 'https://' + r;
      if (v === 'chat') r = r.replace(/\/v\d+$/i, '') + '/v1/chat/completions';
      else if (v === 'responses') r = r.replace(/\/v\d+$/i, '') + '/v1/responses';
      if ($('inEp')) $('inEp').value = r;
      S.formDirty = true;
      syncEpPreview();
      hf();
      okMsg('已设为 ' + r);
    }, false);
  }
  /* 模型列表：本地过滤，单选。600 个模型也扛得住。命中缓存直接开，未命中才拉 */
  function pickModel() {
    var list = S.allModels || [];
    var stamp = S.modelsAt ? ('　·　更新于 ' + fmtAgo(S.modelsAt)) : '';
    openDlg('选择模型', [{ title: '', items: modelRows(list) }], false, selectModel);
    if ($('dlgSearch')) $('dlgSearch').placeholder = '搜索模型（共 ' + list.length + ' 个）';
    if (!list.length) {
      toast('还没有模型列表，正在拉取…', 'info');
      pullModels(false);
    } else {
      okMsg('共 ' + list.length + ' 个模型' + stamp);
    }
  }
  /* 距上次刷新多久 */
  function fmtAgo(ts) {
    var s = Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 1000));
    if (s < 60) return s + ' 秒前';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  }
  /* 拉模型列表：带当前输入框端点；force=false 时后端会走 24h 磁盘缓存 */
  function pullModels(force) {
    var ep = ($('inEp') ? String($('inEp').value || '').trim() : '');
    var p = { action: 'refresh_models' };
    if (ep) p.base_url = epNorm(ep);
    if (force === true) p.force = true;
    call('subagent:subagent_cfg', p, 'modelsRefreshed');
  }
  function modelRows(list) {
    var cur = (($('inModel') ? $('inModel').value : '') || '').trim();
    var rows = [];
    for (var i = 0; i < list.length; i++) {
      rows.push({ val: list[i], label: list[i], desc: '', on: list[i] === cur });
    }
    if (!rows.length) rows.push({ val: '__ro', label: '还没有模型列表', desc: '先点右上角刷新，或直接手填模型名' });
    return rows;
  }
  function selectModel(v) {
    if (!v || v === '__ro') return;
    if ($('inModel')) $('inModel').value = v;
    S.cfgModel = v;
    S.formDirty = true;
    hf();
    okMsg('已选 ' + v + '，记得保存');
  }
  /* 拉回的模型列表：填进弹窗 + 记进内存 */
  function fillModels(list, fromCache, at) {
    S.allModels = list || [];
    if (at) S.modelsAt = Number(at) || 0;
    else if (!S.modelsAt || !fromCache) S.modelsAt = Date.now();
    if (S.dlg) {
      S.dlg.groups = [{ title: '', items: modelRows(S.allModels) }];
      renderDlg($('dlgSearch') ? $('dlgSearch').value : '');
      if ($('dlgSearch')) $('dlgSearch').placeholder = '搜索模型（共 ' + S.allModels.length + ' 个）';
    }
    if ($('cbModelSub')) {
      $('cbModelSub').textContent = S.allModels.length
        ? ('共 ' + S.allModels.length + ' 个可选模型，点右侧列表换一个')
        : '从列表里选一个，或直接手填';
    }
    if (!list.length) return;
    /* fromCache 才提示（用户点列表时看到「已载入」）；网络拉取由调用方 toast，避免重复 */
    if (fromCache) okMsg('已载入 ' + S.allModels.length + ' 个模型（' + fmtAgo(S.modelsAt) + '）');
  }
  /* 思考等级滑块：0..3 → off/low/medium/high
   滑块端点最省、右端最深，比下拉更有「科技感」，也少一次点击。 */
  var THINK_ORDER = ['off', 'low', 'medium', 'high'];
  /* 思考等级：滑块 → 档位 + 英文标签 + 填充进度 + 刻度高亮 */
  function syncThinkFromSlider() {
    var el = $('inThink'); if (!el) return;
    var i = Math.max(0, Math.min(3, parseInt(el.value || '1', 10) || 0));
    S.think = THINK_ORDER[i];
    var v = $('vThink'); if (v) v.textContent = THINK_EN[S.think] || 'Medium';
    var fill = $('thinkFill');
    if (fill) {
      /* 填充条必须停在「滑块圆心」上，不能按 0-100% 直接算。
         滑钮直径 20px，圆心行程是从 10px 到 (宽度-10px)。
         从两端各让出 10px 的可用行程，再用 calc 把圆心位置换算成宽度：
         宽度 = 半径 + 行程 × 比例。
         只算百分比会让 high 档填充条顶到边框外，低档又落后于圆心。 */
      var pct = i / 3;
      fill.style.width = 'calc(10px + (100% - 20px) * ' + pct.toFixed(4) + ')';
    }
    /* 刻度文字高亮：让用户知道现在停在哪一档 */
    var lab = el.parentNode && el.parentNode.parentNode ? el.parentNode.parentNode.querySelector('.slines') : null;
    if (lab) {
      var ss = lab.querySelectorAll('span');
      for (var k = 0; k < ss.length; k++) ss[k].classList.toggle('on', k === i);
    }
  }
  function setThinkSlider(level) {
    var i = THINK_ORDER.indexOf(String(level || ''));
    if (i < 0) i = 2;
    var el = $('inThink'); if (el) el.value = String(i);
    syncThinkFromSlider();
  }
  /* 最大深度已改输入框：只做取值规范化（0 = 不限制，上限 5） */
  function syncDepthFromSlider() {
    var el = $('inDepth'); if (!el) return;
    var n = parseInt(el.value || '0', 10);
    if (!(n >= 0)) n = 0;
    if (n > 5) n = 5;
    el.value = String(n);
  }
  function saveKey() {
    var k = ($('inKey').value || '').trim();
    if (!k) return;
    if (S.keySaving) return;
    S.keySaving = true;
    call('subagent:subagent_cfg', { action: 'key', api_key: k }, 'cfgkey');
  }
  /* 保存端点 + 模型：从输入框读，端点会做后缀补全 */
  function saveCfg() {
    var raw = ($('inEp') ? $('inEp').value : '').trim();
    var model = ($('inModel') ? $('inModel').value : '').trim();
    if (!raw) { err('请填写 API 端点'); return; }
    var ep = epNorm(raw);
    /* 把补全结果写回输入框，让用户看见最终地址 */
    if ($('inEp') && ep !== raw) $('inEp').value = ep;
    /* formDirty 不能在发请求前清：后端拒绝（如模型名像密钥）时要保持「有未保存改动」，
       否则回包渲染会把用户的输入覆盖成旧值。清标志由 cfgset 成功分支负责。 */
    call('subagent:subagent_cfg', { action: 'set', payload: { base_url: ep, model: model } }, 'cfgset');
  }
  function probe() {
    /* 测的是眼前输入框里的值，不是已保存的值：用户改完端点/模型直接点测试也能测对 */
    var ep = ($('inEp') ? String($('inEp').value || '').trim() : '');
    var md = ($('inModel') ? String($('inModel').value || '').trim() : '');
    var p = { deep: true };
    if (ep) p.base_url = epNorm(ep);
    if (md) p.model = md;
    if ($('cfgConn')) { $('cfgConn').textContent = '测试中…'; $('cfgConn').className = 'cfg-val'; }
    if ($('probeLayers')) $('probeLayers').innerHTML = '<div class="probe-card"><div class="pv-detail">正在测试端点 / 密钥 / 模型…</div></div>';
    S.probed = false;
    call('subagent:subagent_env', Object.assign({ what: 'probe' }, p), 'probe');
  }
  /* 模型右侧放大镜：只探测当前这个模型能不能真跑起来 */
  function probeModel() {
    /* 以输入框为准：用户可能刚改过还没保存 */
    var m = (($('inModel') ? $('inModel').value : '') || S.cfgModel || '').trim();
    if (!m) { err('先填一个模型名'); return; }
    hf();
    var ep = ($('inEp') ? String($('inEp').value || '').trim() : '');
    var p = { deep: true, model: m };
    if (ep) p.base_url = epNorm(ep);
    if ($('cfgConn')) { $('cfgConn').textContent = '测试中…'; $('cfgConn').className = 'cfg-val'; }
    if ($('probeLayers')) $('probeLayers').innerHTML = '<div class="probe-card"><div class="pv-detail">正在探测模型 ' + esc(m) + '…</div></div>';
    S.probed = false;
    call('subagent:subagent_env', Object.assign({ what: 'probe' }, p), 'probe');
  }

  /* ── 收件箱 ── */
  /* ── 收件箱（邮件式，用户定 2026-11-05）──
     不再复用通用弹窗：列表页 + 阅读页两级，正文 Markdown 渲染。 */
  function openInbox() {
    show('inbox');
    var box = $('inboxList');
    if (box) box.innerHTML = '<div class="mail-empty">读取中…</div>';
    call('subagent:subagent_box', {}, 'inbox');
  }
  /* 时间戳格式化：毫秒数 → "MM-DD HH:mm"；非数字原样截断 */
  function fmtMailTime(v) {
    var s = String(v || '');
    if (/^\d{10,}$/.test(s)) {
      var d = new Date(Number(s));
      if (!isNaN(d.getTime())) {
        function z(n) { return (n < 10 ? '0' : '') + n; }
        return (d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
      }
    }
    return s.slice(5, 16);
  }
  function renderInbox(d) {
    var items = (d && d.items) || [];
    S.inboxItems = items;
    var box = $('inboxList');
    if (!box) return;
    if (!items.length) {
      box.innerHTML = '<div class="mail-empty">收件箱是空的<br><span>子代理完成任务的结论会出现在这里</span></div>';
      return;
    }
    /* 窗口化（第七轮）：初始 30 条；滚到底部加载下一批 30，DOM 始终 ≤150 条。
       items 全量存 S.inboxItems，idx 用全局下标，不因加载批次漂移。 */
    var ITEMS_BATCH = 30, ITEMS_MAX_DOM = 150;
    S.inboxShown = Math.min(ITEMS_BATCH, items.length);
    box.innerHTML = inboxSliceHtml(items, 0, S.inboxShown, true);
    /* 批次入场错峰：每批次 30 条，延迟 0~(29*20)ms */
    var kids = box.children || [];
    for (var k = 0; k < kids.length; k++) { kids[k].style.animation = 'gpuFade .18s ease-out ' + (k * 20) + 'ms both'; }
    /* 向下滚动加载：仅当还有未显示的条目时追加 */
    box.onscroll = function () {
      var left = items.length - (S.inboxShown || 0);
      if (left <= 0) return;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 48) {
        var add = Math.min(ITEMS_BATCH, left);
        var frag = document.createElement('div');
        frag.innerHTML = inboxSliceHtml(items, S.inboxShown, S.inboxShown + add, false);
        while (frag.firstChild) box.appendChild(frag.firstChild);
        S.inboxShown = (S.inboxShown || 0) + add;
        /* DOM 上限 150：超过就把最早的批移出（邮件列表按最新在前，尾部是旧件） */
        if (box.children.length > ITEMS_MAX_DOM) {
          var cut = box.children.length - ITEMS_MAX_DOM;
          while (cut-- > 0) box.removeChild(box.lastChild);
        }
      }
    };
  }
  /* 生成邮件列表片段：兼容新旧字段（title/task_title、text/conclusion） */
  function inboxSliceHtml(items, from, to, withEmpty) {
    var html = '';
    for (var i = from; i < to; i++) {
      var it = items[i] || {};
      var title = String(it.task_title || it.title || it.task_id || '未命名任务');
      var body = String(it.conclusion || it.text || '').replace(/^#.*\n+/, '').slice(0, 120);
      var tm = fmtMailTime(it.finished_at || it.created_at || '');
      var unread = it.unread !== false ? ' unread' : '';
      html += '<div class="mail-item' + unread + '" data-act="openMail" data-idx="' + i + '">'
        + '<div class="mi-row1"><span class="mi-from">' + esc(title) + '</span>'
        + '<span class="mi-time">' + esc(tm) + '</span></div>'
        + '<div class="mi-sub">' + esc(String(it.task_title || it.title || '').slice(0, 40) || '子代理结论') + '</div>'
        + '<div class="mi-prev">' + esc(body) + '</div>'
        + '</div>';
    }
    return html;
  }
  function openMail(idx) {
    var it = (S.inboxItems || [])[idx];
    if (!it) return;
    var title = String(it.task_title || it.task_id || '结论');
    if ($('mailTitle')) $('mailTitle').textContent = title.slice(0, 18);
    var body = $('mailBody');
    if (body) {
      var full = String(it.conclusion || it.text || '（无内容）');
      var head = it.finished_at || it.created_at ? '<div class="mail-meta">' + esc(it.finished_at || it.created_at || '') + '</div>' : '';
      body.innerHTML = head + md(full);
      body.scrollTop = 0;
    }
    show('mail');
  }
  /* ── 目录选择器：真正的文件树（目录可进、文件显示体积） ── */
  function lsGroups(d) {
    var dirs = d.dirs || [], files = d.files || [];
    var items = [];
    var cur = String(d.path || '/');
    if (cur !== '/') {
      items.push({ val: '__up', label: '.. 上一级', desc: '返回上级目录', up: d.parent || '/' });
    }
    for (var i = 0; i < dirs.length; i++) {
      var sub = (cur.replace(/\/+$/, '')) + '/' + dirs[i];
      items.push({ val: sub + '/', label: dirs[i] + '/', desc: '目录 · 点击进入', isDir: true });
    }
    for (var j = 0; j < files.length; j++) {
      var f = files[j];
      items.push({ val: '__file', label: f.name, desc: fmtSize(f.size) + ' · 文件', isFile: true });
    }
    if (!items.length) items.push({ val: '__ro', label: '（空目录）', desc: '这里没有子目录' });
    return [{ title: cur + '  ·  ' + dirs.length + ' 目录 / ' + files.length + ' 文件 / ' + fmtSize(d.total_size), items: items }];
  }
  function fmtSize(n) {
    var v = Number(n || 0);
    if (v < 1024) return v + ' B';
    if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
    if (v < 1073741824) return (v / 1048576).toFixed(2) + ' MB';
    return (v / 1073741824).toFixed(2) + ' GB';
  }
  function renderBrowse(d) {
    S._browsePath = d.path || '/';
    if (!S.dlg) {   // 兜底：弹窗没打开时自己开一个
      S.dlg = { groups: [], multi: false, onOk: null };
      if ($('mask')) $('mask').classList.add('on');
      if ($('dlg')) $('dlg').classList.add('on');
    }
    S.dlg.groups = lsGroups(d);
    S.dlg.multi = false;
    S.dlg.browsing = true;                 // 标记：这是目录浏览模式
    S.dlg.onOk = function (v) {
      if (v === '__file' || v === '__ro') return;
      $('inWs').value = v;
      $('vWs').textContent = v;
      okMsg('已选：' + v);
    };
    if ($('dlgTitle')) $('dlgTitle').textContent = '选择目录';
    /* 目录浏览：点目录=进入，右下角「选择此目录」才确认 */
    if ($('dlgFoot')) {
      $('dlgFoot').innerHTML = '<span class="dlg-cnt">' + esc(S._browsePath) + '</span>'
        + '<button class="btn" data-act="dlgCancel">取消</button>'
        + '<button class="btn pri" data-act="pickHere">选择此目录</button>';
    }
    renderDlg($('dlgSearch') ? $('dlgSearch').value : '');
  }
  function browseTo(p) {
    openDlg('选择目录', [{ title: '', items: [{ val: '__loading', label: '读取中…', desc: '' }] }], false, null, false);
    call('subagent:subagent_env', { what: 'dir', path: p || '/sdcard' }, 'ls');
  }

  /* ── 事件绑定 ── */
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act'), val = el.getAttribute('data-val') || '';
    if (act === 'open') { hf(); return openTask(val); }
    if (act === 'closeTask') { e.stopPropagation(); return closeTask(val); }
    if (act === 'deleteTask') { e.stopPropagation(); return deleteTask(val); }
    if (act === 'goHome') return goHome();
    if (act === 'goList') return goList();
    /* 【第八十三轮补丁C】列表页分组折叠：只切 S.grpClosed，重渲染一次。
       走重渲染而不是直接改 DOM —— 分组内行还有动画观察者，直接藏节点会残留观察。 */
    if (act === 'foldGrp') {
      var gk = val;
      S.grpClosed[gk] = !S.grpClosed[gk];
      renderList(S.items);
      return;
    }
    /* 群组详情入口。注意 e.stopPropagation()：这个按钮在可折叠的分组头里，
       不拦会把点击冒泡成折叠，等于点详情顺手把列表收起来。 */
    if (act === 'grpInfo') { e.stopPropagation(); return openGrpInfo(val); }
    /* 剔除 / 解禁：val 是 "群组码|chatId" */
    if (act === 'grpKick' || act === 'grpUnkick') {
      e.stopPropagation();
      var gp = String(val || '').split('|');
      var gc1 = gp[0], gt = gp[1] || '';
      if (!gc1 || !gt) return;
      var isKick = (act === 'grpKick');
      openCfm(isKick ? '剔除成员' : '解禁成员',
        (isKick ? '剔除后 ' : '解禁后 ') + gt.slice(-12) + (isKick ? ' 输群组码也进不来。' : ' 可以凭群组码重新访问。'),
        function () {
          call('subagent:subagent_group', {
            action: isKick ? 'kick' : 'unkick', code: gc1, chat_id: gt
          }, 'grpAct', function (r1, d1) {
            if (r1 && r1.success === false) { err(r1.message || '操作失败'); return; }
            okMsg(isKick ? '已剔除' : '已解禁');
            /* 详情抽屉内容已过期，重开一次刷成最新成员列表 */
            closeSheet();
            openGrpInfo(gc1);
            refreshList(true);
          });
        });
      return;
    }
    if (act === 'backList') { S.cur = null; show('list'); return; }
    if (act === 'fold') {
      var f = el;
      f.classList.toggle('open');
      var nb = f.nextElementSibling;
      if (nb && nb.classList && nb.classList.contains('fold-body')) nb.style.display = f.classList.contains('open') ? 'block' : 'none';
      return;
    }
    /* 思考块的单击/双击统一在文档末尾的 .thk-head 委托里处理，
       这里不再拦截（旧 data-act=think 分支已删除，避免两套逻辑打架） */

    if (act === 'meta') return openMeta(val);
    if (act === 'toolDlg') return openToolDlg(val);
    /* 【第五十六轮】点工具行/返回预览 → 中心弹窗展示返回全文 */
    if (act === 'callShow') {
      /* 【第六十四轮】优先按唯一序号取，避开同名工具互相覆盖 */
      var sqc = el.dataset.tsq || '';
      var rec2 = sqc ? (S._toolBySeq || {})[String(sqc)] : null;
      var kc = el.dataset.tool || val || '';
      if (!rec2) rec2 = (S._toolMap || {})[String(kc)];
      if (!rec2 || !rec2.call) { toast('找不到调用记录', 'warn'); return; }
      return openCallDlg(rec2.call.name || kc, rec2.call.args);
    }
    if (act === 'retOpen') {
      /* 【第六十四轮】优先按唯一序号取，避开同名工具互相覆盖 */
      var sqr = el.dataset.tsq || '';
      var rec = sqr ? (S._toolBySeq || {})[String(sqr)] : null;
      var k = el.dataset.tool || val || '';
      if (!rec) rec = (S._toolMap || {})[String(k)];
      var r = rec && rec.res;
      var nm2 = (rec && rec.call && rec.call.name) || k || '返回';
      if (!r) { toast('还没有返回', 'warn'); return; }
      var bt = r.result != null ? String(r.result) : (r.error != null ? String(r.error) : '');
      return openRetDlg(nm2, bt);
    }
    if (act === 'retClose') return closeRetDlg();
    if (act === 'sheetClose') return closeSheet();
    if (act === 'goNew') { show('new'); if (!S.tools) call('subagent:subagent_env', { what: 'tools' }, 'tools'); loadNewForm(); return; }
    if (act === 'goCfg') {
      S.formDirty = false;
      S.keyFilled = false;
      /* 每次进配置页都清空密钥框：密钥只写不读，靠 placeholder 告知「已保存」 */
      if ($('inKey')) { $('inKey').value = ''; $('inKey').type = 'password'; }
      if ($('btnEye')) { $('btnEye').innerHTML = '<svg><use href="#i-eye"/></svg>'; $('btnEye').setAttribute('title', '显示密钥'); }
      show('cfg');
      call('subagent:subagent_cfg', { action: 'status' }, 'cfg');
      /* 有磁盘缓存的话进页面就有模型数，不必等用户点列表 */
      return;
    }
    if (act === 'openInboxBtn') return openInbox();
    if (act === 'openMail') return openMail(Number(el.dataset.idx));
    if (act === 'backToInbox') return openInbox();
    if (act === 'inboxClearAll') { call('subagent:subagent_box', { action: 'read' }, 'inboxClear'); return; }
    if (act === 'deleteCur') { if (S.cur) deleteTask(S.cur); return; }
    if (act === 'closeCur') { if (S.cur) closeTask(S.cur); return; }
    /* 确认框 */
    if (act === 'cfmNo') return closeCfm();
    if (act === 'cfmYes') { var fY = S.cfmYes; closeCfm(); if (fY) fY(); return; }
    /* 列表页批量删除 */
    if (act === 'enterMulti') return enterMulti();
    if (act === 'exitMulti') return exitMulti();
    if (act === 'toggleSel') return toggleSel(val);
    if (act === 'deleteSelected') return deleteSelected();
    if (act === 'doSaveCfg') return saveCfg();
    if (act === 'toggleKey') return toggleKey();
    if (act === 'dlgPick') {
      if (!S.dlg || val === '__ro') return;
      /* 目录浏览模式：点目录 = 进入下一级（不关窗），文件只展示 */
      if (S.dlg.browsing) {
        if (val === '__file') { err('这是文件，不是目录'); return; }
        if (val === '__up') {
          hf();
          var ups = '';
          for (var gi = 0; gi < S.dlg.groups.length; gi++) {
            var its = S.dlg.groups[gi].items || [];
            for (var hj = 0; hj < its.length; hj++) { if (its[hj].val === '__up') ups = its[hj].up || '/'; }
          }
          browseTo(ups || '/');
          return;
        }
        if (/\/$/.test(val)) { hf(); browseTo(val); return; }
        return;
      }
      if (S.dlg.multi) {
        var ix = S.sel.indexOf(val);
        if (ix >= 0) S.sel.splice(ix, 1); else S.sel.push(val);
        if ($('vTools')) $('vTools').textContent = S.sel.length ? (S.sel.length + ' 项') : '未选择';
        hf();
        renderDlg($('dlgSearch') ? ($('dlgSearch').value || '') : '');
        if ($('dlgFoot')) $('dlgFoot').innerHTML = '<span class="dlg-cnt">已选 ' + S.sel.length + ' 项</span><button class="btn" data-act="dlgCancel">取消</button><button class="btn pri" data-act="dlgOk">确定</button>';
      } else {
        var f = S.dlg.onOk; closeDlg(); if (f) f(val);
      }
      return;
    }
    if (act === 'dlgOk') {
      if (!S.dlg) return;
      var cb = S.dlg.onOk;
      closeDlg();
      if (cb) cb(S.sel.slice());
      /* 空选是合法状态（= 不限制），不是错误，所以用中性提示而不是红叉 */
      if (S.sel.length) okMsg('已选 ' + S.sel.length + ' 个工具');
      else toast('未选工具 = 不限制', 'info');
      return;
    }
    if (act === 'runCur') return runCur();
    if (act === 'stopCur') return stopCur();
    if (act === 'dlgCancel') return closeDlg();
    if (act === 'pickHere') {
      /* 目录浏览模式下确认"当前所在目录" */
      var here = S._browsePath || '/sdcard';
      if (S.dlg && S.dlg.onOk) { var f2 = S.dlg.onOk; closeDlg(); f2(here); }
      else closeDlg();
      return;
    }
    if (act === 'inboxClear') { call('subagent:subagent_box', { action: 'read' }, 'inboxClear'); return; }
    if (act === 'pickProv') return pickProv();
    if (act === 'pickEp') return pickEp();
    if (act === 'pickModel') return pickModel();
    if (act === 'probeModel') return probeModel();
    if (act === 'doProbe') return probe();
    /* 版本更新（第三十轮） */
    if (act === 'updCheck') { hf(); return updCheck(true); }
    if (act === 'updDownload') { hf(); return updDownload(); }
    if (act === 'updInstall') { hf(); return updInstall(); }
    if (act === 'updToggleNotes') { hf(); return updToggleNotes(); }
    if (act === 'updOpenSite') { hf(); return updOpenSite(); }
    if (act === 'saveKey') return saveKey();
    if (act === 'doCreate') return createTask();
    if (act === 'openTools') return openTools();
    if (act === 'usePrivateWs') {
      call('subagent:subagent_env', { what: 'workspace', action: 'init' }, 'privateWs');
      return;
    }
    if (act === 'pickWs') {
      browseTo(($('inWs').value || '').trim() || '/sdcard');
      return;
    }
    if (act === 'sendMsg') return sendMsg();
    if (act === 'collapseThink') { hf(); collapseThinkAll(); return; }
    if (act === 'togglePerm') { hf(); togglePanel('permBox', 'btnPerm'); return; }
    if (act === 'toggleDanger') { toggleDanger(); return; }
    /* 【第五十六轮】原位展开已取消，工具行点击统一走 retOpen 开中心弹窗 */
    if (act === 'toggleRun') { hf(); togglePanel('runBox', 'cardRun'); return; }
    if (act === 'editFull') return openFullEdit();
    if (act === 'closeFull') return closeFullEdit();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'dtInput') { e.preventDefault(); sendMsg(); }
  });
  $('dlgSearch').addEventListener('input', function () { renderDlg(this.value); });
  /* ── 新建页交互：滑块、分段选择器、上下文轮数 ── */
  if ($('inThink')) $('inThink').addEventListener('input', function () {
    syncThinkFromSlider(); saveNewForm(); syncCardSubs();
  });
  if ($('inDepth')) $('inDepth').addEventListener('input', function () {
    syncDepthFromSlider(); saveNewForm(); syncCardSubs();
  });
  /* 步数/超时改动也要刷新卡片摘要 */
  ['inSteps', 'inTimeout'].forEach(function (id) {
    if ($(id)) $(id).addEventListener('input', function () { saveNewForm(); syncCardSubs(); });
  });
  /* 任务描述：输入即存内存草稿（不写 localStorage，避免下次带出旧任务） */
  if ($('inTask')) $('inTask').addEventListener('input', function () { syncTaskDraft(); });
  if ($('inTaskFull')) $('inTaskFull').addEventListener('input', function () {
    syncTaskDraft();
    /* 全屏编辑时同步回新建页，退出时不丢内容 */
    if ($('inTask')) $('inTask').value = this.value;
  });
  /* 分段按钮事件已随「附带上下文」移除 */
  /* 进入新建页时把滑块与卡片同步到当前状态 */
  setThinkSlider(S.think);
  syncDepthFromSlider();
  syncCardSubs();
  /* 用户改过端点/模型后，标记 dirty，避免后续 status 回包把内容覆盖回旧值 */
  ['inEp', 'inModel'].forEach(function (id) {
    if ($(id)) $(id).addEventListener('input', function () { S.formDirty = true; if (id === 'inEp') syncEpPreview(); else syncCfgTip(); });
  });
  /* 密钥框输完（失焦）自动保存：不需要按钮，也不清空、不重载表单 */
  if ($('inKey')) $('inKey').addEventListener('blur', function () {
    setTimeout(syncCfgTip, 0);
    var v = String(this.value || '').trim();
    if (v) saveKey();
  });
  /* 密钥框：聚焦时显示明文，失焦立刻恢复星号（顺手也支持右侧小眼睛手动切） */
  if ($('inKey')) {
    $('inKey').addEventListener('input', function () { syncCfgTip(); });
    $('inKey').addEventListener('focus', function () {
      if (this.type !== 'text') {
        this.type = 'text';
        if ($('btnEye')) { $('btnEye').innerHTML = '<svg><use href="#i-eye-off"/></svg>'; $('btnEye').setAttribute('title', '隐藏密钥'); }
      }
    });
    $('inKey').addEventListener('blur', function () {
      if (this.type !== 'password') {
        this.type = 'password';
        if ($('btnEye')) { $('btnEye').innerHTML = '<svg><use href="#i-eye"/></svg>'; $('btnEye').setAttribute('title', '显示密钥'); }
      }
    });
  }
  if ($('listSearch')) $('listSearch').addEventListener('input', function () { renderList(S.items); });
  if ($('homeSearch')) {
    $('homeSearch').addEventListener('input', function () {
      var v = String(this.value || '').trim();
      if (!v) { renderList(S.items); return; }
      if (!(S.listAt && (Date.now() - S.listAt) < LIST_TTL)) refreshList(false);
      var hit = [];
      for (var i = 0; i < S.items.length; i++) {
        var it = S.items[i];
        var hay = ((it.title || '') + ' ' + (it.id || '') + ' ' + stCn(it.status) + ' ' + (it.last_text || '')).toLowerCase();
        if (hay.indexOf(v.toLowerCase()) >= 0) hit.push(it);
      }
      renderList(hit);
    });
    $('homeSearch').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { goList(); if ($('listSearch')) { $('listSearch').value = this.value; renderList(S.items); } }
    });
  }
/* 删除只在详情页做：列表页不提供删除入口（长按也不行），避免误删 */
  if ($('sheet-mask')) $('sheet-mask').addEventListener('click', closeSheet);
  if ($('mask')) $('mask').addEventListener('click', function () { closeDlg(); closeCfm(); });
  /* 【第五十六轮】返回详情弹窗：点遮罩或叉关闭 */
  if ($('retMask')) $('retMask').addEventListener('click', closeRetDlg);

  /* 思考块交互（2026-11-07 用户定稿第二十八轮；第七十轮修复累进断链）：
       单击前进一档 0 → 1 → 2 → 0（累进循环，立即响应不等待）
       0 = 收起/流式中（限高 120px，自动滚到底）
       1 = 部分展开（限高 320px）
       2 = 全部展开（不限高）
       双击 = 抄近路，从任何档位一步到 2（全展开）。
       【第七十轮】单击必须能自己走到 2 档，不能只靠双击；
       否则单击到 1 档后停手再点会变回收起，永远看不到全部内容。
   【触发范围】历史块只认 .thk-head（标题行），不认正文。
   正文区域要留给长按选词复制，点一下就换档会让用户没法选文字。
   流式区 .sb-think 没有标题行，整块可点。 */
  document.addEventListener('click', function (e) {
    if (!e.target || typeof e.target.closest !== 'function') return;
    /* 【第四十七轮】整卡可点：用户要求「单击双击在整个思考展开里面点，
       而不是只有在最上面的思考过程」。
       所以从 .thk-head 扩展到整张 .thinkbox。
       但要留两个例外：
         1) 工具行（.tblock）自己有点击动作（打开工具详情），不能抢
         2) 正文选中文字时不触发（长按选词复制） */
    /* 【第五十三轮】工具行（.trow）自己有点击动作（打开工具详情），不能抢。
       旧类名 .tblock 已废弃，这里一并兼容，避免遗留节点点不开。 */
    /* 【第五十六轮】工具行与返回预览自己有点击（开中心弹窗），不能抢 */
    if (e.target.closest('.trow')) return;
    if (e.target.closest('.tb-peek')) return;
    var tb = e.target.closest('.thinkbox');
    if (!tb) tb = e.target.closest('.sb-think');
    if (!tb) return;
    /* 双保险：正文选中文字时不触发 */
    try {
      var sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length) return;
    } catch (eS) {}
    /* 【第七十一轮】用户定稿的语义：
       单击 = 「半展开 ↔ 收起」二元往返（0↔1），不跨到 2 档；
       双击 = 一步到 2（全展开）；2 档上单击 = 收回 0。
       第七十轮试过 0→1→2→0 三态累进，用户明确否决：那样点两下就全展开了，
       失去「双击才全展开」的区分度。 */
    var st0 = parseInt(tb.getAttribute('data-state') || '0', 10) || 0;
    var now = Date.now();
    if (S._tapEl === tb && now - (S._tapAt || 0) < 260) {
      /* 第二击（双击）：从任何状态一步到全展开 2 档 */
      S._tapEl = null; S._tapAt = 0;
      setThinkState(tb, 2);
      return;
    }
    S._tapEl = tb;
    S._tapAt = now;
    /* 单击：0→1，1→0（二元往返）；已在 2 档则收回 0 */
    setThinkState(tb, st0 === 0 ? 1 : 0);
  });
  /* 思考块点击已统一到上面的累进循环处理 */

  /* ── 上滑彩蛋（第三十七轮改版：整页上推）──
     用户要的是：主页滚到底后继续上滑，整个内容往上推走，露出下面一屏彩蛋。
     顶部搜索栏在 viewport 外，钉住不动。

     结构：#homeViewport（裁切）> #homeTrack（200% 高，两屏）> homescroll + eggPanel
     打开 = track 上移 50%。

     判据（四条同时满足才接管）：
       1. 已滚到底 —— scrollTop + clientHeight >= scrollHeight - 1
       2. ddy < 0  —— 手指往上走（内容往上推）
       3. |ddy| > |ddx| —— 竖向为主，排除横滑
       4. 未在打开态（打开态走反向收回逻辑）
     不接管时页面滚动完全原生，不抢手势。 */
  (function () {
    var track = $('homeTrack'), host = $('homescroll'), home = $('page-home');
    if (!track || !host || !home) return;

    var START_Y = 0, START_X = 0;
    var dragging = false;      /* 是否已确认是「整页上推」手势 */
    var decided = false;       /* 是否已判定过方向 */
    var atBottom = false;      /* 按下时是否已滚到底 */
    var dy = 0;                /* 累计位移（负 = 往上推 = 打开方向） */
var THRESHOLD = 56;        /* 兜底阈值（屏高拿不到时用） */
    var DECIDE_PX = 8;         /* 位移超过它才判方向 */
    var opened = false;        /* 当前是否已打开彩蛋 */
    /* 容器实际可见高度 = 一屏。track 是它的 200%。 */
    function screenH() {
      var vp = $('homeViewport');
      return (vp && vp.offsetHeight) || 0;
    }
    /* 切换阈值 = 半屏。用户要求「滑到一半就自动回主页面」，
       所以无论打开还是关闭，过中点就切，不再等固定 56px。 */
    function halfH() {
      var h = screenH();
      return h > 0 ? h * 0.5 : THRESHOLD;
    }

    /* 打开：track 归位露出彩蛋屏，同时让内部元素依次上弹入场。
       为什么要延时加 .egg-in：类名和 transform 同帧加，浏览器合并成一帧，动画不播。 */
    function openEgg() {
      opened = true;
      home.classList.add('home-open');
      home.classList.remove('home-closing');
      track.style.transform = '';
      var ep = $('eggPanel');
      if (ep) {
        ep.classList.remove('egg-out');
        ep.classList.remove('egg-in');
        setTimeout(function () { if (opened) ep.classList.add('egg-in'); }, 30);
      }
    }
    /* 关闭：先播超新星散开，散完再收 track。
       为什么要等 460ms：散开动画是 .46s，立刻收 track 会把动画遮住看不见。 */
    function closeEgg() {
      opened = false;
      home.classList.remove('home-open', 'home-drag');
      var ep = $('eggPanel');
      if (ep) {
        ep.classList.remove('egg-in');
        ep.classList.add('egg-out');
      }
      /* 先把 track 归位（视觉上回到主页），动画在彩蛋屏上继续播完再清理 */
      track.style.transform = '';
      setTimeout(function () {
        if (!opened && ep) ep.classList.remove('egg-out');
      }, 480);
    }

    /* 打开态下在彩蛋屏上往下滑，收回 */
    function bindClose(hostEl) {
      if (!hostEl) return;
      hostEl.addEventListener('touchstart', function (e) {
        if (!e.touches || e.touches.length !== 1) return;
        if (!opened) return;
        START_Y = e.touches[0].clientY;
        START_X = e.touches[0].clientX;
        dragging = false;
        decided = false;
        dy = 0;
      }, { passive: true });

      hostEl.addEventListener('touchmove', function (e) {
        if (!opened || !e.touches || e.touches.length !== 1) return;
        var ddy = e.touches[0].clientY - START_Y;
        var ddx = e.touches[0].clientX - START_X;

        if (!decided) {
          if (Math.abs(ddy) < DECIDE_PX && Math.abs(ddx) < DECIDE_PX) return;
          decided = true;
          /* 打开态只接管「往下拉（ddy > 0）且竖向为主」 */
          if (ddy > 0 && Math.abs(ddy) > Math.abs(ddx)) {
            dragging = true;
            home.classList.add('home-drag');
          }
        }
        if (!dragging) return;
        try { e.preventDefault(); } catch (eP) {}
        dy = Math.max(0, ddy);
        var h = screenH() || 1;
        var move = Math.min(dy, h);
        /* 从 -50% 位置往回退，按拖拽距离换算成百分比 */
        track.style.transform = 'translate3d(0,' + (-50 + (move / h) * 50) + '%,0)';
      }, { passive: false });

      hostEl.addEventListener('touchend', function () {
        if (!dragging) { decided = false; return; }
        dragging = false;
        home.classList.remove('home-drag');
        if (dy >= halfH()) closeEgg();
        else openEgg();   /* 没拉够，回弹到打开态 */
        decided = false;
        dy = 0;
      }, { passive: true });

      hostEl.addEventListener('touchcancel', function () {
        if (dragging) openEgg();
        dragging = false;
        decided = false;
        dy = 0;
      }, { passive: true });
    }

    host.addEventListener('touchstart', function (e) {
      if (!e.touches || e.touches.length !== 1) return;
      START_Y = e.touches[0].clientY;
      START_X = e.touches[0].clientX;
      dragging = false;
      decided = false;
      dy = 0;
      /* 容差 1px：某些 WebView 的 scrollHeight 取整会差一点 */
      atBottom = (host.scrollTop + host.clientHeight) >= (host.scrollHeight - 1);
    }, { passive: true });

    host.addEventListener('touchmove', function (e) {
      if (!e.touches || e.touches.length !== 1) return;
      var ddy = e.touches[0].clientY - START_Y;
      var ddx = e.touches[0].clientX - START_X;

      if (!decided) {
        if (Math.abs(ddy) < DECIDE_PX && Math.abs(ddx) < DECIDE_PX) return;
        decided = true;
        /* 只有「已到底 + 往上滑 + 竖向为主」才接管 */
        if (atBottom && ddy < 0 && Math.abs(ddy) > Math.abs(ddx)) {
          dragging = true;
          home.classList.add('home-drag');
        }
      }
      if (!dragging) return;

      /* 接管后阻止页面继续滚，否则先滚再推，手感割裂 */
      try { e.preventDefault(); } catch (eP) {}
      dy = Math.min(0, ddy);
      var h = screenH() || 1;
      var move = Math.min(-dy, h);
      /* 跟手：从 0 往 -50% 走 */
      track.style.transform = 'translate3d(0,' + (-(move / h) * 50) + '%,0)';
    }, { passive: false });

    host.addEventListener('touchend', function () {
      if (!dragging) { decided = false; return; }
      dragging = false;
      home.classList.remove('home-drag');
      if (-dy >= halfH()) openEgg();
      else closeEgg();   /* 没推够，回弹 */
      decided = false;
      dy = 0;
    }, { passive: true });

    host.addEventListener('touchcancel', function () {
      if (dragging) closeEgg();
      dragging = false;
      decided = false;
      dy = 0;
    }, { passive: true });

    /* 打开态：在彩蛋屏上下滑可以收回 */
    bindClose($('eggPanel'));

    /* 邮箱入口：WebView 不能直接跳 mailto:（会被当成导航地址，加载失败顶成白页）。
       改走后端发 SENDTO intent，由系统交给邮件应用；失败则把地址显示出来让用户复制。 */
    var mail = $('eggMail');
    if (mail) {
      mail.addEventListener('click', function (ev) {
        ev.preventDefault();
        var addr = 'whoiscui@foxmail.com';
        call('subagent:subagent_open_mail', { email: addr, kind: 'bug' }, 'eggMail',
          function (r) {
            var ok = !!(r && r.success !== false);
            var msg = (r && r.message) || (ok ? '已调起邮件应用' : '邮箱：' + addr);
            toast(msg, ok ? 'ok' : 'warn');
          });
      });
    }

    /* GitHub Issue 入口：同样不能 location.href（WebView 会白页），走后端开链接 */
    var issue = $('eggIssue');
    if (issue) {
      issue.addEventListener('click', function (ev) {
        ev.preventDefault();
        call('subagent:subagent_open_url', { url: 'https://github.com/what-my-names/subagent/issues/new/choose' }, 'eggIssue',
          function (r) {
            var ok = !!(r && r.success !== false);
            toast((r && r.message) || (ok ? '已打开 Issue 页面' : '打开失败'), ok ? 'ok' : 'warn');
          });
      });
    }

    /* 头像：base64 内联，不依赖外部文件。
       为什么内联：头像只有 8.5KB（缩到 160x160），比多一个资源文件 + manifest 声明简单。
       注意：容器从 $('eggPanel') 取，不能再用已删除的 panel 变量。 */
    var av = $('eggPanel') && $('eggPanel').querySelector('.egg-avatar');
    if (av) {
      var img = new Image();
      img.alt = '';
      img.src = 'data:image/jpeg;base64,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';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      av.textContent = '';
      av.appendChild(img);
    }

    /* 版本号：复用已有的 updStatus 处理（那里会把 version 写进 updCur），
       这里单独写一份，因为 eggVer 在主页而不是配置页 */
    if ($('eggVer')) {
      call('subagent:subagent_env', { what: 'version' }, 'eggVer');
    }
  })();

  /* ── 启动 ── */
show('welcome');
  refreshList(true);
  setTimeout(function () { S.initAnim = true; if (S.initLoaded) show('home'); }, 1200);
  /* 兜底：3 秒后无论如何都进主页，避免桥不回导致永远停在欢迎页 */
  setTimeout(function () { if (S.page === 'welcome') show('home'); }, 3000);
  call('subagent:subagent_cfg', { action: 'status' }, 'cfg');
  /* KaTeX 外接（第七轮）：用户把 katex.min.js 放到
     /sdcard/Download/Operit/subagent/vendor/ 后，这里经桥读入并注入。
     失败静默走内置渲染器，不打扰用户。仅尝试一次。 */
  (function () {
    if (window.__katexTried) return;
    window.__katexTried = true;
    call('subagent:subagent_vendor_js', { name: 'katex.min.js' }, 'vendor', function (r) {
      var d = (r && r.data) || {};
      if (!d || !d.text) return;
      try {
        /* new Function 隔离作用域：katex.min.js 是 UMD，会自己挂 window.katex */
        (new Function(d.text))();
        if (window.katex && typeof window.katex.renderToString === 'function') {
          /* css 也顺带注入（KaTeX 排版必需，字体缺失时会退化到系统字体，仍可用） */
          call('subagent:subagent_vendor_js', { name: 'katex.min.css' }, 'vendor', function (r2) {
            var d2 = (r2 && r2.data) || {};
            if (d2 && d2.text) {
              var st = document.createElement('style');
              st.textContent = d2.text;
              document.head.appendChild(st);
            }
          });
        }
      } catch (e) { /* 注入失败：保持 window.katex 未定义，内置渲染器兜底 */ }
    });
  })();
})();
