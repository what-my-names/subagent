/* test/cases/ui.js — 面板 UI 逻辑断言
 *
 * 覆盖第十轮查出的 8 个逻辑错误 + 欢迎页/黑屏防护 + 收件箱窗口化。
 * 这些断言的意义：**防回归**。每个都对应一次真机翻车。
 */
var A = require('../lib/assert.js').group('UI 逻辑');
var P = A.src('ui/web/panel.js');
var C = A.src('ui/web/panel.css');
var H = A.src('ui/web/panel.html');

/* ── 1. openTask 必须重启轮询（否则运行中任务打开后进度冻结） ── */
A.match('openTask 打开后重启轮询',
    P, /call\('subagent:subagent_trace'[\s\S]{0,300}?if \(stNow === 'running' \|\| stNow === 'queued'\) startPoll\(\)/);
A.match('openTask 走 show(detail)', P, /S\.cur = id; show\('detail'\)/);
A.match('pollOnce 有 page 守卫', P, /if \(!S\.cur \|\| S\.page !== 'detail'\) return;/);

/* ── 2. goHome 不能清 S.cur（否则丢掉正在跑的任务） ── */
A.match('goHome 会 stopPoll', P, /function goHome\(\)[\s\S]{0,200}?stopPoll\(\);/);
A.nomatch('goHome 内不得 S.cur = null', P, /function goHome\(\)[^}]*S\.cur = null/);

/* ── 3. refreshList 定时器必须存引用 + ALIVE 检查 ── */
A.match('listUnlockT 存引用', P, /S\.listUnlockT = setTimeout/);
A.match('解锁定时器有 ALIVE 检查', P, /S\.listUnlockT[\s\S]{0,140}?if \(!ALIVE\) return/);
A.match('成功返回清掉解锁定时器', P, /S\.listBusy = false; try \{ clearTimeout\(S\.listUnlockT\)/);
A.match('S 里声明 listUnlockT', P, /listBusy: false, listUnlockT: null/);
A.nomatch('解锁定时器不再误重置 listAt', P, /if \(S\.listBusy\) \{ S\.listBusy = false; S\.listAt = 0; \}/);

/* ── 4. cfgset 失败必须 return（否则误报「已保存」） ── */
A.match('cfgset 失败分支 return',
    P, /if \(kind === 'cfgset'\) \{[\s\S]{0,220}?if \(r && r\.success === false\) return;/);

/* ── 5. saveCfg 不能在发请求前清 formDirty ── */
A.nomatch('saveCfg 发请求前不清 formDirty',
    P, /function saveCfg\(\)[\s\S]{0,700}?S\.formDirty = false;[\s\S]{0,90}?call\('subagent:subagent_config', \{ action: 'set'/);

/* ── 6. 连通性判断不能靠文案匹配 ── */
A.nomatch('不再用 /连通正常/ 文案判断', P, /\/连通正常\/\.test\(/);
A.match('改用 S.probed 布尔量', P, /S\.probed/);
A.match('S 里声明 probed', P, /page: 'welcome', probed: false/);
A.match('probe 开始清 probed', P, /S\.probed = false;/);
A.match('renderProbe 置 probed', P, /S\.probed = true;/);

/* ── 7. cfgConn 三态 ── */
A.match('cfgConn 三态判定', P, /anyOk && anyBad \? 'warn'/);
A.match('CSS 有 .cfg-val.warn', C, /\.cfg-val\.warn\{/);

/* ── 8. 欢迎页 + 黑屏防护 ── */
A.match('HTML 有 welcome 页', H, /id="page-welcome"/);
A.match('HTML 首页默认 display:none', H, /id="page-home"[^>]*display:none/);
A.match('启动段走 show(welcome)', P, /show\('welcome'\);[\s\S]{0,200}?refreshList\(true\)/);
A.match('有 1.2s 动画门', P, /setTimeout\(function \(\) \{ S\.initAnim = true; if \(S\.initLoaded\) show\('home'\); \}, 1200\)/);
A.match('有 3s 硬兜底', P, /if \(S\.page === 'welcome'\) show\('home'\); \}, 3000\)/);
A.match('renderList 双条件门', P, /if \(fromTool && S\.page === 'welcome'\) \{ S\.initLoaded = true; if \(S\.initAnim\) show\('home'\); \}/);
A.match('有 visibilitychange 兜底', P, /addEventListener\('visibilitychange'/);
A.match('可见时兜底 show(home)', P, /visibilityState === 'visible'[\s\S]{0,200}?show\('home'\)/);

/* ── 收件箱窗口化 ── */
A.match('收件箱批次 ITEMS_BATCH', P, /ITEMS_BATCH/);
A.match('收件箱 DOM 上限 ITEMS_MAX_DOM', P, /ITEMS_MAX_DOM/);
A.match('收件箱兼容 task_title/title', P, /task_title\s*\|\|\s*.*title|title\s*\|\|\s*.*task_title/);
A.match('收件箱兼容 conclusion/text', P, /conclusion\s*\|\|\s*.*text|text\s*\|\|\s*.*conclusion/);
A.match('有 fmtMailTime 时间格式化', P, /function fmtMailTime/);

/* ── 生命周期守卫 ── */
A.match('有 ALIVE 守卫', P, /var ALIVE = true/);
A.match('setTimeout 被包装', P, /window\.setTimeout = function/);
A.match('setInterval 被包装', P, /window\.setInterval = function/);
A.match('有定时器登记表', P, /_timers|_ivals/);

/* ── 桥调用：不能阻塞渲染 ── */
A.match('桥调用延迟到下一帧', P, /requestAnimationFrame\(function \(\) \{[\s\S]{0,60}?requestAnimationFrame\(fire0\)/);
A.match('桥无返回有兜底 err', P, /桥无返回 tool=/);
A.match('页面销毁期静默', P, /silent/);

/* ── 页面清单完整 ── */
var pages = ['welcome', 'home', 'list', 'new', 'full', 'detail', 'cfg', 'inbox', 'mail'];
var missP = [];
for (var i = 0; i < pages.length; i++) {
    if (P.indexOf("'" + pages[i] + "'") < 0) missP.push(pages[i]);
}
A.eq('show() 页面清单 9 个齐全', missP.length, 0);
if (missP.length) console.log('    缺失：' + missP.join(', '));

/* ── 不改用户样式的承诺：@keyframes 内部只动 transform/opacity ──
   不能简单 grep "animation…width"（width 常在声明前面，会误报）；
   也不能用 /@keyframes\s+\w+\s*\{([\s\S]*?)\n\}/ —— 单行关键帧
   （如 @keyframes pop{from{…}to{…}}）匹配不到结尾，会一路吞到下一个
   选择器，把 .bubble.ai 的 padding 也算进去（假阳性）。
   正确做法：从 @keyframes 起点做括号配平，取出真正的块。 */
var kfBad = [];
var kfStart = /@keyframes\s+[A-Za-z0-9_]+\s*\{/g;
var ks;
while ((ks = kfStart.exec(C)) !== null) {
    /* 从 { 之后开始配平，直到深度归零 */
    var depth = 1, idx = ks.index + ks[0].length;
    while (idx < C.length && depth > 0) {
        var ch = C.charAt(idx);
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        idx++;
    }
    var body = C.slice(ks.index + ks[0].length, idx - 1);
    var layoutHit = /\b(width|height|top|left|right|bottom|margin[-\w]*|padding[-\w]*|font-size|line-height)\s*:/.exec(body);
    if (layoutHit) kfBad.push(layoutHit[1] + ' @ ' + ks[0].replace(/@keyframes\s+/,'').replace('{',''));
}
A.eq('关键帧不动布局属性', kfBad.length, 0);
if (kfBad.length) console.log('    违规：' + kfBad.join(' | '));

A.finish();