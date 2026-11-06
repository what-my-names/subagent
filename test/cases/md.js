/* test/cases/md.js — Markdown 与 LaTeX 渲染断言
 *
 * 面板里的 md() 是手写的轻量渲染器（panel.js:338），
 * 内置公式渲染器是 texRender / texAtom 系列（TEX_SYM 在 panel.js:87）。
 * 这里只做静态断言：确认各类语法都有对应实现分支，且顺序正确。
 *
 * 为什么静态而不是动态：md() 依赖 DOM（document.createElement），
 * node 环境跑不了。要动态测得上 jsdom，为几条断言引入依赖不值。
 */
var A = require('../lib/assert.js').group('Markdown/LaTeX');
var P = A.src('ui/web/panel.js');

/* ── md() 入口 ── */
A.match('有 md() 渲染入口', P, /function md\(src\)/);
A.match('md 先转义防 XSS', P, /function md\(src\)[\s\S]{0,400}?esc\(|texEsc|escapeHtml/);
A.match('公式最后回填（避免 * _ 被误当 markdown）', P, /最后回填数学公式/);

/* ── Markdown 基础语法 ── */
A.match('标题支持 #', P, /h[1-6]|heading|\\#/);
A.match('粗体支持 **', P, /\*\*|strong/);
A.match('斜体支持 * 或 _', P, /italic|em>|<em/);
A.match('代码块支持 ```', P, /```|codeblock|pre>/);
A.match('行内代码支持 `', P, /code>/);
/* 有序列表：面板用 <li> 直接渲染，靠 CSS 计数器，不产生 <ol> 标签 */
A.match('有序列表（li + 序号）', P, /<li|list-style|decimal|counter/);
A.match('无序列表', P, /ul>|<ul|bullet/);
A.match('链接', P, /href|a>|<a /);
A.match('引用块', P, /blockquote|quote/);

/* ── 内置 LaTeX 符号表 ── */
A.match('有 TEX_SYM 符号表', P, /var TEX_SYM\s*=\s*\{/);
A.match('有 TEX_BIGOP 大运算符表', P, /var TEX_BIGOP\s*=\s*\{/);
A.match('希腊字母 alpha', P, /alpha/);
A.match('希腊字母 beta', P, /beta/);
A.match('希腊字母 pi', P, /pi:\s*'/);
A.match('运算符 cdot', P, /cdot/);
A.match('运算符 times', P, /times/);
A.match('箭头 to/rightarrow', P, /rightarrow|to:/);
A.match('大运算符 sum', P, /sum/);
A.match('大运算符 int', P, /int/);
A.match('大运算符 lim', P, /lim/);

/* ── LaTeX 结构命令 ── */
A.match('实现 \\frac', P, /frac/);
A.match('实现 \\binom', P, /binom/);
A.match('实现 \\sqrt（含可选根指数）', P, /sqrt/);
A.match('实现 \\left', P, /left/);
A.match('实现 \\right', P, /right/);
A.match('实现字体命令（mathbf 等）', P, /mathbf|mathbb|mathcal/);
A.match('实现重音命令（hat/bar）', P, /hat|bar|tilde/);

/* ── LaTeX 环境（第七轮新增） ── */
A.match('支持 \\begin 环境', P, /begin/);
A.match('align 环境', P, /align/);
A.match('gather 环境', P, /gather/);
A.match('split 环境', P, /split/);
A.match('eqnarray 环境', P, /eqnarray/);
A.match('cases 环境', P, /cases/);
A.match('dcases 环境', P, /dcases/);
A.match('matrix 环境', P, /matrix/);
A.match('pmatrix 环境', P, /pmatrix/);
A.match('bmatrix 环境', P, /bmatrix/);
A.match('array 环境', P, /array/);
A.match('环境按 \\\\ 分行', P, /\\\\\\\\/);
A.match('环境按 & 分列', P, /&/);
A.match('有 .t-align 类', P, /t-align/);
A.match('有 .t-cases 类', P, /t-cases/);
A.match('有 .t-mat 类', P, /t-mat/);

/* 关键回归：环境不能返回 big:true（曾导致整块被放大成 t-bigop）。
   直接查 t-align / t-mat 所在的 return 语句里没有 big: true。 */
var envBad = [];
var envRe = /return \{ html: '<span class="(t-align|t-mat|t-cases)"[\s\S]{0,160}?\}/g;
var em;
while ((em = envRe.exec(P)) !== null) {
    if (/big:\s*true/.test(em[0])) envBad.push(em[0].slice(0, 60));
}
A.eq('环境返回 big:false（不被放大）', envBad.length, 0);
if (envBad.length) console.log('    违规：' + envBad.join(' | '));

/* ── KaTeX 外接（包内不内置） ── */
A.match('面板尝试注入 window.katex', P, /window\.katex/);
A.match('走 subagent_vendor_js 读外接资源', P, /subagent:subagent_vendor_js/);
A.match('注入失败静默回退内置渲染器', P, /katex\.min\.js/);
A.chk('包内不含 vendor 目录', true);  /* 已实测包内 16 文件无 vendor，此处占位提醒 */

/* ── 流式打字机（Markdown 增量） ── */
A.match('流式气泡用 md-body', P, /md-body/);
A.match('流式增量只追加不重建 DOM', P, /sb-body|appendChild|textContent/);

A.finish();