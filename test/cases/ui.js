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
    P, /call\('subagent:subagent_get', \{ id: id, detail: 'trace'[\s\S]{0,400}?if \(stNow === 'running' \|\| stNow === 'queued'\) startPoll\(\)/);
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
    P, /function saveCfg\(\)[\s\S]{0,700}?S\.formDirty = false;[\s\S]{0,90}?call\('subagent:subagent_cfg', \{ action: 'set'/);

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
/* 【2026-11-07 改】原来锁的是「双 rAF 延帧」，但 rAF 在 WebView 被遮挡/悬浮窗时
   可能不触发，桥调用就永远发不出去。现在统一用 setTimeout。
   断言方向反转：必须用 setTimeout，且不允许再退回 rAF。 */
A.match('桥调用用 setTimeout 延帧', P, /var fire0 = function \(\) \{ callRaw\(tool, params, kind, id, onOk\); \};\s*\n\s*setTimeout\(fire0, 16\);/);
A.nomatch('桥调用不再依赖 rAF', P, /requestAnimationFrame\(function \(\) \{ requestAnimationFrame\(fire0\)/);
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


/* ── 第十五轮：并发与重复渲染修复 ── */
/* 桥超时后必须清 advancing，否则「继续推进」按钮永久消失 */
A.match('桥超时后清 advancing', P, /else if \(S\.bridgeDropped > 0\) \{[\s\S]{0,300}?S\.advancing = false;/);
/* show() 内部已渲染，goList/backList 不得重复调 renderList */
A.nomatch('goList 不重复渲染', P, /function goList\(\) \{[^}]*renderList\(S\.items\)/);
A.nomatch('backList 不重复渲染', P, /backList'\] \{[^}]*show\('list'\); renderList/);
A.nomatch('删除后切列表不重复渲染', P, /S\.cur === id\) \{ S\.cur = null; show\('list'\); renderList/);
/* ── 第十八轮：流式期间不许重建 DOM ── */
/* 【第二十八轮】重建前要记录思考块展开档位，所以 if 到 innerHTML 之间多了约 600 字符，
   窗口从 120 放宽到 900。锁的仍然是「流式期间不重建 + 内容没变不重建」这个能力。 */
A.match('fillTrace 流式期间不重建 DOM', P, /if \(!STREAM\.busy && _h !== S\.chatSig\) \{[\s\S]{0,900}?dtChat'\)\.innerHTML/);
A.match('openTask 流式期间不清 DOM', P, /else if \(\$\('dtChat'\) && !STREAM\.busy\)/);
A.match('流式期间状态行显示 running', P, /if \(STREAM\.busy && \(d\.status === 'queued' \|\| !d\.status\)\) _stShown = 'running'/);
A.match('状态行显示通道诊断', P, /if \(STREAM && STREAM\.diag\) bits\.push\(STREAM\.diag\)/);
A.match('统计 chunk 数', P, /STREAM\.chunkCount = \(STREAM\.chunkCount \|\| 0\) \+ 1/);

/* ── 第十九轮：XHR 增量读 + 输入不打断 + 内容指纹 ── */
/* XHR 通道必须存在且被优先调用（fetch 的 getReader 在部分 WebView 攒包） */
A.match('存在 XHR 增量读通道', P, /function streamOnceXhr\(messages, onDelta\)/);
A.match('XHR 用 onprogress 增量取', P, /xhr\.onprogress = function \(\) \{ drain\(\); \}/);
A.match('XHR 处理 readyState 3', P, /if \(xhr\.readyState === 3\) drain\(\)/);
A.match('XHR 用 seen 只取增量', P, /var piece = raw\.slice\(seen\);/);
A.match('XHR 排在最前（优先于 fetch）', P, /return streamOnceXhr\(messages, onDelta\)\.then\(null, function \(eXhr\)/);
A.match('XHR 失败才退 fetch', P, /return streamOnceDirect\(messages, onDelta\)\.then\(null, function \(eDirect\)/);
A.match('XHR 能被停止按钮中断', P, /STREAM\.abort = \{ abort: function \(\) \{ try \{ xhr\.abort\(\); \}/);
/* 打字期间跳过轮询：桥是同步阻塞的，会打断输入并引起重建 */
A.match('打字时跳过轮询', P, /var typing = !!\(ae && \(ae\.tagName === 'INPUT' \|\| ae\.tagName === 'TEXTAREA'\)\)/);
A.match('打字时降频不空转', P, /if \(typing\) \{[\s\S]{0,80}?setTimeout\(pollOnce, 600\)/);
/* 内容指纹：内容没变不重建 DOM */
A.match('内容指纹比对后才重建', P, /if \(!STREAM\.busy && _h !== S\.chatSig\)/);
A.match('流式开始时指纹失效', P, /S\.streaming = true;[\s\S]{0,200}?S\.chatSig = null;/);

/* ── 第二十一轮：卡死自愈（终态必须收流式 + XHR 兜底超时） ── */
/* 终态时不仅停轮询，还要 abortStream，否则 STREAM.busy 永真 */
/* 原正则依赖「if (STREAM.busy) { abortStream() }」包块写法，实际代码是单行 if；
   改为断言三个关键动作都发生：停轮询、清 advancing、终态调 abortStream。 */
A.match('终态时收掉流式', P, /stopPoll\(\);\s*S\.advancing = false;[\s\S]{0,300}?abortStream\(\)/);
/* XHR 必须有兜底超时，否则端点挂住就永久卡 */
A.match('XHR 设置兜底超时', P, /xhr\.timeout = _to > 0 \? \(_to \+ 30000\) : 180000/);
/* abortStream 要清空占位块，否则时间线上留一块空白 */
A.match('abortStream 清空占位块', P, /querySelectorAll\('\.streambox'\)/);
A.match('abortStream 保留有内容的块', P, /if \(!hasThink && !hasBody\) \{[\s\S]{0,80}?removeChild/);
A.match('abortStream 清 abort 引用', P, /STREAM\.abort = null;[\s\S]{0,400}?STREAM\.busy = false;/);
/* runCur 遇终态残留标记要自愈，不能死拦 */
A.match('runCur 终态时自愈', P, /var terminal = \(st === 'done' \|\| st === 'failed' \|\| st === 'cancelled' \|\| st === 'closed' \|\| !st\);[\s\S]{0,150}?abortStream\(\)/);
/* openTask 进任务前自愈 */
A.match('openTask 进任务前自愈', P, /var termPre = \(stPre === 'done'[\s\S]{0,200}?abortStream\(\)/);
/* 【第九十四轮】叉号改发 close：关闭必须打断正在跑的那一轮，
   只发 cancel 时后端 status 仍是 running，切出去再进来又显示「继续推进」。 */
A.match('关闭后主动拉 trace', P, /call\('subagent:subagent_ctrl', \{ id: S\.cur, action: 'close', confirm: true \}, 'close', function \(\) \{[\s\S]{0,160}?subagent_get/);
A.match('已关闭任务禁止继续推进', P, /if \(st === 'closed'\) \{ err\('任务已关闭/);
A.finish();

/* ── 【第六十九轮】动画按需挂载：降常驻合成图层 ──
 * 这些断言防的是：有人把 animation/will-change 又写回列表项静态声明，
 * 导致图层数随卡片数线性增长，WebView 内存再度爆掉。
 */
A.match('chat-row 装饰动画下放到 .anim-on',
    C, /\.chat-row\.anim-on::before\{will-change:transform;animation:gpuFlowY/);
A.nomatch('chat-row::before 本体不得带 animation',
    C, /\.chat-row::before\{[^}]*?animation:/);
A.nomatch('chat-row::before 本体不得带 will-change',
    C, /\.chat-row::before\{[^}]*?will-change:/);
A.match('头像呼吸由行类控制',
    C, /\.chat-row\.anim-on \.cr-avatar::after\{will-change:opacity;animation:gpuFade/);
A.match('运行中状态呼吸由行类控制',
    C, /\.chat-row\.anim-on \.cr-status\.running\{/);
A.match('脉冲环由行类控制',
    C, /\.chat-row\.anim-on \.cr-avatar\.r::before\{/);
A.match('后台全局暂停动画',
    C, /\.page-hidden \*, \.page-hidden \*::before[^{]*\{/);
A.match('补了 prefers-reduced-motion 降级',
    C, /@media \(prefers-reduced-motion: reduce\)/);
A.match('IntersectionObserver 只给视口内行加类',
    P, /if \(ents\[i\]\.isIntersecting\) t\.classList\.add\('anim-on'\)/);
A.match('出视口移除动画类',
    P, /else t\.classList\.remove\('anim-on'\)/);
A.match('无 IntersectionObserver 时全量兜底',
    P, /typeof IntersectionObserver === 'undefined'[\s\S]{0,200}?classList\.add\('anim-on'\)/);
A.match('renderList 渲染后接入观察器',
    P, /target\.innerHTML = groupHtml\(src, !!kw\);[\s\S]{0,120}?watchRowAnim\(target\)/);
A.match('切后台加 page-hidden',
    P, /document\.body\.classList\.add\('page-hidden'\)/);
A.match('回前台移除 page-hidden',
    P, /document\.body\.classList\.remove\('page-hidden'\)/);
A.match('shutdown 解绑观察器',
    P, /function shutdown\(\)[\s\S]{0,300}?_animObs\.disconnect\(\)/);

/* ── 【第八十三轮补丁C】群组分类 + 陈旧 running 自愈 ── */
A.match('列表页走群组分类渲染',
    P, /target\.innerHTML = groupHtml\(src, !!kw\)/);
A.match('有群组按群组码归桶',
    P, /bucket\('g:' \+ gc, gname, gsub\)/);
A.match('无群组按父对话归桶',
    P, /bucketLite\('c:' \+ pc, '父对话 '/);
A.match('无归属单独成桶且走轻量头',
    P, /bucketLite\('c:_', '未归属任何对话'/);
A.match('轻量头带 lite 类',
    P, /b\.lite \? ' lite' : ''/);
A.match('分组头可折叠',
    P, /S\.grpClosed\[gk\] = !S\.grpClosed\[gk\]/);
A.match('群组清单随列表回传并保存',
    P, /S\.groupList = d\.groups \|\| r\.groups \|\| \[\]/);
/* 分组桶的存取键必须一致。踩过：写入用 gmap[key]，读取还拼 gmap['#'+key]，
   取到 undefined → continue → 整个列表空白。 */
A.match('分组桶读取键与写入一致',
    P, /var b = gmap\[order\[o\]\];/);
A.nomatch('分组桶不再拼 # 前缀',
    P, /gmap\['#' \+/);
/* 【第八十五轮】空群组也要显示：新建群组还没派任务时不能整块消失 */
A.match('空群组也建桶', P, /for \(var gk = 0; gk < \(S\.groupList \|\| \[\]\)\.length; gk\+\+\)/);
A.match('空群组不因无任务被跳过', P, /if \(!b\.items\.length && !isRealGroup\) continue;/);
A.match('空群组给占位说明', P, /class="grp-empty"/);
A.match('有群组时列表不判空', P, /var hasGroups = !!\(S\.groupList && S\.groupList\.length\)/);
A.match('陈旧 running 改判已中断',
    P, /if \(\(Date\.now\(\) - t0\) > STALE_MS\) return 'interrupted'/);
A.match('陈旧判定不动后端状态',
    P, /function effStatus\(it\)[\s\S]{0,400}?return st;/);
A.match('列表行走 effStatus 取展示状态',
    P, /var st = effStatus\(it\);/);

/* ── 群组详情（抽屉） ── */
A.match('分组头有群组详情入口',
    P, /data-act="grpInfo"/);
A.match('只有真群组桶显示详情按钮',
    P, /function gc0\(bucketKey\)[\s\S]{0,180}?k\.slice\(0, 2\) === 'g:'/);
A.match('详情取 onOk 第二参而非外层',
    P, /openGrpInfo[\s\S]{0,400}?function \(r0, d\)/);
A.match('权限位转中文短语',
    P, /function permCn\(mask\)/);
/* 【第九十二轮】角色名重写：创始人→群主、受邀→成员、只读→访客，并加超级权限 */
A.match('角色判定 群主/成员/访客',
    P, /if \(m === 31\) return '群主'/);
A.match('角色判定含超级权限',
    P, /if \(m >= 63\) return '超级权限'/);
A.match('群组码可长按选中复制',
    C, /\.gi-code-v\{[^}]*user-select:text/);
A.match('剔除按钮只在有 KICK 位时出现',
    P, /canManage && mid !== String\(g\.founder \|\| ''\)/);
A.match('剔除点击不冒泡成折叠',
    P, /act === 'grpInfo'\) \{ e\.stopPropagation\(\); return openGrpInfo\(val\)/);

/* ── 【第八十八轮】panel.js 拆片后 IIFE 作用域完整性 ──
   踩过的坑：panel.js 的 IIFE 在文件末尾就闭合了，panel_tex.js / panel_toast.js
   被拼到作用域外，运行时 md() 找不到 mathHtml() → fillTrace 抛异常 → 时间线整片空白。
   单文件 node --check 发现不了，因为每片语法各自合法。这里锁三件事：
     1) panel.js 自己不能收尾（要留给最后一个分片）
     2) 最后一片必须恰好收尾一次
     3) 三片拼起来必须是合法脚本 */
(function () {
    var main = A.src('ui/web/panel.js');
    var tex = A.src('ui/web/panel_tex.js');
    var toast = A.src('ui/web/panel_toast.js');

    A.chk('panel.js 不自行闭合 IIFE', !/^\}\)\(\);$/m.test(main));
    A.eq('最后一片恰好闭合一次 IIFE', (toast.match(/^\}\)\(\);$/gm) || []).length, 1);

    var joined = main + '\n' + tex + '\n' + toast;
    A.eq('拼接后 IIFE 收尾恰好一处', (joined.match(/^\}\)\(\);$/gm) || []).length, 1);

    var ok = true, msg = '';
    try { new Function(joined); } catch (e) { ok = false; msg = String(e && e.message); }
    A.chk('三片拼接后语法合法' + (ok ? '' : '：' + msg), ok);

    /* 跨片调用：md() 在 panel.js，mathHtml() 在 panel_tex.js，必须同作用域 */
    A.chk('md 与 mathHtml 分居两片', main.indexOf('function md(') >= 0 && tex.indexOf('function mathHtml') >= 0);
    A.chk('tex 片不重复声明 S', tex.indexOf('var S = {') < 0);
})();

/* ── 【第八十九轮】桥缺失与报错诊断 ──
   需求：用文件管理器直开 html 时没桥，要给明确提示（而不是永远转「正在加载」）；
   报错要带现场信息方便上报，成功则静默。 */
(function () {
    A.match('桥缺失走 bridgeMissing', P, /else bridgeMissing\(tool\)/);
    A.match('bridgeMissing 只报一次', P, /if \(S\.bridgeWarned\) return;/);
    A.match('桥缺失改欢迎页文案', P, /未连接宿主，无法加载任务/);
    A.match('报错带诊断信息', P, /diagText\(tool, params, r\.message\)/);
    A.match('诊断脱敏 api_key', P, /api_key', 'key', 'token', 'password', 'secret/);
    A.nomatch('成功不弹提示', P, /if \(r\.success === true\) \{ err/);
})();

/* ── 【第八十九轮】构建产物完整性（真机踩过，测试拦不住的那类）──
   事故链：panel.html 注释里写了 script 标签字样 → 构建正则贪婪匹配把注释吞进 js
   → 内联脚本 Invalid or unexpected token → 整段 script 不执行
   → toast 未定义、时间线空白、删除按钮全失效。
   另一条：三片 <script src> 只替换了 panel.js，tex/toast 残留外链，同样导致未定义。
   这里直接查构建产物，而不是查源文件。 */
(function () {
    /* panel_html.js 是 `module.exports = "..."` 形式的 JSON 字符串，
       要取到真实 HTML 必须先反序列化，否则读到的是带 \\n 转义的源码文本。 */
    var raw = A.src('ui/web/panel_html.js');
    var html = '';
    try {
        html = JSON.parse(raw.slice(raw.indexOf('module.exports = ') + 'module.exports = '.length).replace(/;\s*$/, ''));
    } catch (e) { html = ''; }
    A.chk('panel_html.js 可反序列化', !!html);

    /* 1) 不能残留任何分片外链 */
    A.chk('产物无残留分片外链', !/\.\/panel[\w]*\.(css|js)/.test(html));

    /* 2) 内联脚本里不能有 HTML 注释残留 */
    var m = html.match(/<script>([\s\S]*)<\/script>/);
    A.chk('产物能找到内联脚本', !!m);
    var js = m ? m[1] : '';
    A.chk('内联脚本无 HTML 注释残留', !/<!--|-->/.test(js));

    /* 3) 内联脚本必须语法合法（new Function 只解析不执行） */
    var ok = true, msg = '';
    try { new Function(js); } catch (e) { ok = false; msg = String(e && e.message); }
    A.chk('内联脚本语法合法' + (ok ? '' : '：' + msg), ok);

    /* 4) 关键函数必须都在同一个 script 里 */
    ['function toast(', 'function md(', 'function mathHtml', 'var S = {'].forEach(function (sig) {
        A.chk('内联脚本含 ' + sig, js.indexOf(sig) >= 0);
    });

    /* 5) 整个产物只能有一个 script 标签 */
    A.eq('产物只有一个 script 标签', (html.match(/<script/g) || []).length, 1);
})();

A.finish();
