/* test/cases/semantic.js — 跨模块语义断言（第二十二轮）
 *
 * 与其它 case 的区别：这里不做「源码里有没有这行字」的静态匹配，
 * 而是 **真 require 模块、真调函数、真造临时目录**，验证行为一致性。
 *
 * 为什么需要它：前 297 条断言全是正则匹配，7 个真 bug 一条都没抓到 ——
 * 变量名写错（t.dataset）、两条路径对同一参数给出相反行为、路径穿越、
 * 只读工具被误判成写类，这些都不是「字符串在不在」能测出来的。
 */
var fs = require('fs');
var path = require('path');
var A = require('../lib/assert.js').group('跨模块语义');
var SRC = A.SRC;

/* 直接加载被测模块（纯函数，不依赖宿主 Tools） */
var TOOLS = require(SRC + '/packages/sb_tools.js');
var LLM = require(SRC + '/packages/sb_llm.js');

/* ── 1. openMail 变量名：必须用 el，不能用未声明的 t ── */
var P = A.src('ui/web/panel.js');
A.match('openMail 用 el.dataset.idx', P, /if \(act === 'openMail'\) return openMail\(Number\(el\.dataset\.idx\)\)/);
A.nomatch('openMail 不再引用裸 t', P, /if \(act === 'openMail'\) return openMail\(Number\(t\.dataset/);

/* ── 2. 路径穿越：inRoot 必须拒掉 .. 逃逸 ── */
A.eq('inRoot 拒 ../ 逃逸', TOOLS.inRoot('/sdcard/x/../etc/passwd', '/sdcard/x'), false);
A.eq('inRoot 拒多级 ../ 逃逸', TOOLS.inRoot('/sdcard/x/a/../../y', '/sdcard/x'), false);
A.eq('inRoot 允许根内路径', TOOLS.inRoot('/sdcard/x/a.txt', '/sdcard/x'), true);
A.eq('inRoot 允许深层根内路径', TOOLS.inRoot('/sdcard/x/a/b/c.txt', '/sdcard/x'), true);
A.eq('inRoot 允许根本身', TOOLS.inRoot('/sdcard/x', '/sdcard/x'), true);
A.eq('inRoot 拒前缀相同但不同目录', TOOLS.inRoot('/sdcard/xy/a', '/sdcard/x'), false);
A.eq('inRoot 拒纯相对逃逸', TOOLS.inRoot('../etc/passwd', '/sdcard/x'), false);
A.eq('inRoot 折叠重复斜杠', TOOLS.inRoot('/sdcard/x//a.txt', '/sdcard/x'), true);
A.eq('inRoot 忽略尾斜杠', TOOLS.inRoot('/sdcard/x/', '/sdcard/x'), true);
A.eq('normPath 折叠 .', TOOLS.normPath('/a/./b'), '/a/b');
A.eq('normPath 折叠 ..', TOOLS.normPath('/a/b/../c'), '/a/c');

/* ── 3. 只读工具不能被误判成写类 ── */
A.eq('terminal_wait 是只读', TOOLS.isWriteTool('terminal_wait'), false);
A.eq('terminal_getscreen 是只读', TOOLS.isWriteTool('terminal_getscreen'), false);
A.eq('terminal 是写类', TOOLS.isWriteTool('terminal'), true);
A.eq('shell 是写类', TOOLS.isWriteTool('shell'), true);
A.eq('create_file 是写类', TOOLS.isWriteTool('create_file'), true);
A.eq('edit_file 是写类', TOOLS.isWriteTool('edit_file'), true);
A.eq('delete_file 是写类', TOOLS.isWriteTool('delete_file'), true);
A.eq('read_file 是只读', TOOLS.isWriteTool('read_file'), false);
A.eq('file_grep 是只读', TOOLS.isWriteTool('file_grep'), false);

/* ── 4. allowed_tools 语义：留空 = 全拒，all=true 才全放开 ── */
/* 4.1 留空时 schema 为空数组（2026-11-07 改）：
   原来这里塞一个 run_tool 兜底，但执行层 matchAllowed(name, []) 直接 false，
   模型调什么都被拒 —— 给一个必然失败的入口比不给更糟。 */
var sEmpty = LLM.runToolSchema([]);
A.eq('allowed=[] schema 为空', sEmpty.length, 0);
/* 4.2 留空时白名单全拒 */
A.eq('allowed=[] 拒 read_file', TOOLS.matchAllowed('read_file', []), false);
A.eq('allowed=[] 拒任意工具', TOOLS.matchAllowed('create_file', []), false);
/* 4.3 "*" 全放开：schema 展开内置表 + 保留 run_tool 兜底 */
var sAll = LLM.runToolSchema(['*']);
A.chk('allowed=[*] schema > 10 个', sAll.length > 10, '实际 ' + sAll.length);
A.chk('allowed=[*] 含 read_file', sAll.some(function (x) { return x.function.name === 'read_file'; }));
A.chk('allowed=[*] 含 create_file', sAll.some(function (x) { return x.function.name === 'create_file'; }));
A.chk('allowed=[*] 含 terminal', sAll.some(function (x) { return x.function.name === 'terminal'; }));
A.chk('allowed=[*] 保留 run_tool 兜底', sAll.some(function (x) { return x.function.name === 'run_tool'; }));
/* 4.4 "*" 在白名单匹配层放行一切 */
A.eq('allowed=[*] 放行 read_file', TOOLS.matchAllowed('read_file', ['*']), true);
A.eq('allowed=[*] 放行包工具', TOOLS.matchAllowed('somepkg:some_tool', ['*']), true);
/* 4.5 "*" 不解除递归禁令（isRecursive 在 matchAllowed 之前判） */
A.eq('递归派子代理仍被识别', TOOLS.isRecursive('subagent_spawn'), true);
A.eq('递归包工具仍被识别', TOOLS.isRecursive('subagent:subagent_spawn'), true);

/* ── 5. 后端三处不再 fallback 到 default_allowed_tools ── */
var SUB = A.src('packages/subagent.js');
A.nomatch('tool_once 不再 fallback', SUB, /var allowed = \(task && task\.allowed_tools && task\.allowed_tools\.length\)[\s\S]{0,80}?cfg\.default_allowed_tools/);
A.match('spawn 支持 all 参数', SUB, /if \(params\.all === true\) allowed = \["\*"\]/);
A.match('METADATA 声明了 all', SUB, /"name": "all",\s*\n\s*"type": "boolean"/);
A.match('allowed_tools 描述已改', SUB, /留空 = 一个工具都用不了/);

/* ── 6. save_turn 必须记账（步数 / 用量 / 通知） ── */
A.match('save_turn 累加 step', SUB, /if \(addedAssistant\) task\.step = Number\(task\.step \|\| 0\) \+ 1;/);
A.match('save_turn 累加 usage', SUB, /task\.usage\.in = Number\(task\.usage\.in \|\| 0\) \+ uIn;/);
A.match('save_turn 调 bumpUsage', SUB, /await TASK\.bumpUsage\(cfgU/);
A.match('save_turn 调 notifyDone', SUB, /if \(params\.done === true \|\| task\.status === "failed"\) \{\s*\n\s*try \{ await notifyDone\(task\); \}/);
A.match('bumpUsage 已导出', A.src('packages/sb_task.js'), /bumpUsage: bumpUsage/);
/* 面板侧要把 usage 传下去 */
A.match('面板回传 usage', P, /if \(out\.usage\) _sv\.usage = out\.usage;/);
A.match('面板回传 finish_reason', P, /if \(out\.finishReason\) _sv\.finish_reason/);

/* ── 7. index.json 不能被当任务（幽灵条目） ── */
var T2 = A.src('packages/sb_task.js');
A.match('listTasks 跳过 index', T2, /if \(tid === "index"\) continue;/);
A.nomatch('refreshIndex 死代码已删', T2, /async function refreshIndex/);
A.nomatch('indexPath 死代码已删', T2, /function indexPath/);

/* ── 8. advanceTask 异常必须落 failed ── */
A.match('advanceTask 有 catch', T2, /catch \(e\) \{[\s\S]{0,400}?task\.status = "failed"/);
A.match('advanceTask 写 error', T2, /task\.error = "推进异常："/);

/* ── 9. stream_relay 必须有超时 ── */
A.match('relay 有 connect_timeout', SUB, /connect_timeout: 15000/);
A.match('relay 有 read_timeout', SUB, /read_timeout: Math\.max\(30000/);

/* ── 10. METADATA 参数与实现一致 ── */
A.match('config 声明 profile_id', SUB, /"name": "profile_id"/);
A.match('config action 描述含 set_active', SUB, /set_active/);

/* ── 11. BUS.clear 返回条数 ── */
A.match('clear 返回清空前条数', A.src('packages/sb_bus.js'), /function clear\(\) \{ var n = load\(\)\.length; save\(\[\]\); return n; \}/);

/* ── 12. setLive 轮询侧不许覆盖流式 ── */
A.match('setLive 有 fromPoll 守卫', P, /function setLive\(txt, fromPoll\) \{[\s\S]{0,160}?if \(fromPoll && STREAM\.busy && S\.streaming\) return;/);
A.match('syncDtBar 传 fromPoll', P, /if \(running \|\| queued\) setLive\(phaseText\(st\), true\);/);

/* ── 13. 块级公式类名 JS 与 CSS 必须一致 ── */
A.match('JS 输出 md-math blk', P, /'<span class="md-math' \+ \(it\.display \? ' blk' : ''\)/);
A.match('CSS 选择 .md-math.blk', A.src('ui/web/panel.css'), /\.md-body \.md-math\.blk\{/);
A.nomatch('CSS 不再用 .md-math.t-blk', A.src('ui/web/panel.css'), /\.md-body \.md-math\.t-blk\{/);

/* ── 14. 死代码清理 ── */
A.nomatch('streamMode 已删', P, /function streamMode\(/);
A.nomatch('THINK_CN 已删', P, /var THINK_CN =/);
A.nomatch('未使用的 var ui 已删', P, /var it = limited\[i\], ui =/);

/* ── 15. 文档与代码一致（baseUrl / 断言数） ── */
var WEBUI = A.src('ui/web_panel.ui.js');
A.match('web_panel 用 http://localhost', WEBUI, /baseUrl: "http:\/\/localhost\/subagent"/);
A.nomatch('web_panel 不再用 https://localhost', WEBUI, /baseUrl: "https:\/\/localhost\/subagent"/);

/* ── 16. 构建产物与源同步 ── */
var HTML = A.src('ui/web/panel_html.js');
A.chk('产物含 XHR 兜底超时', HTML.indexOf('_to + 30000') >= 0);
A.chk('产物含终态收流式', HTML.indexOf('if (STREAM.busy) {') >= 0);
A.chk('产物含 openMail 修正', HTML.indexOf('openMail(Number(el.dataset.idx))') >= 0);
A.chk('产物含 md-math.blk CSS', HTML.indexOf('.md-math.blk{') >= 0);
A.chk('产物不含旧 streamMode', HTML.indexOf('function streamMode(') < 0);

/* ── 第二十三轮：流式落盘（退出再进来内容还在、状态不是「待开始」） ── */
/* 真因：流式全程只在页面内存里跑，退出面板 = 内容全丢；
   且从不把 status 写成 running，退出再进来后端还是 queued → 提示「待开始」
   → 用户只能重新启动 → 重跑内容叠一层，越滚越大（实测 35KB 重复）。 */
A.match('后端有流式落盘工具', A.src('packages/subagent.js'), /exports\.subagent_stream_flush/);
A.match('落盘把状态置 running', A.src('packages/subagent.js'), /task\.status = "running";[\s\S]{0,200}?task\.pending = \{/);
A.match('落盘写 pending', A.src('packages/subagent.js'), /task\.pending = \{[\s\S]{0,160}?think: String\(params\.think/);
A.match('终态忽略落盘', A.src('packages/subagent.js'), /if \(st === "done" \|\| st === "failed" \|\| st === "cancelled" \|\| st === "closed"\) \{[\s\S]{0,120}?ignored: true/);
A.match('trace 返回 pending', A.src('packages/subagent.js'), /pending: t\.pending \? \{/);
A.match('save_turn 清 pending', A.src('packages/subagent.js'), /delete task\.pending/);
/* 前端 */
A.match('流式期间定时落盘', P, /function flushStream\(force\)/);
/* 【2026-11-07 改】落盘绝不能挂在 paint 上：flushStream 是同步桥调用，
   放在每 50ms 的绘制路径上会反复冻结主线程，流式看起来就是卡住。
   改由独立 setInterval 驱动，间隔 8 秒。 */
A.match('落盘由独立定时器驱动', P, /var flushTimer = setInterval\(function \(\) \{[\s\S]{0,200}?flushStream\(false\);[\s\S]{0,40}\}, 8000\);/);
A.nomatch('paint 里不许落盘', P, /doPaint\(\);[\s\S]{0,160}?flushStream\(false\)/);
/* 看门狗已删：固定秒数必然误杀长思考，连接死活交给 XHR 自身的 onerror/ontimeout */
A.nomatch('没有臆想的看门狗', P, /IDLE_MS|idleTimer/);
/* 【第二十八轮语义变更】原来锁「流式思考区不许限高」，理由是限高会让超出部分
   藏在滚动区、用户以为流式卡住。
   但真正的原因是「限高却不滚到底」，不是限高本身。
   用户定稿要的是：限高 120px + 自动贴底 = 小窗口跟手。
   相关断言已移到文件末尾第二十八轮段落，那里同时锁「有限高」+「有贴底」。 */
/* 落盘定时器必须被 abortStream 清掉，否则停止后 8 秒内还会把任务写回 running */
A.match('abortStream 清落盘定时器', P, /if \(STREAM\._flushTimer\) \{[\s\S]{0,80}?clearInterval\(STREAM\._flushTimer\)/);
A.match('退出时同步落盘', P, /SBNative\.call\(JSON\.stringify\(\{[\s\S]{0,120}?subagent:subagent_stream_flush/);
A.match('fillTrace 渲染 pending', P, /if \(d\.pending && \(d\.pending\.think \|\| d\.pending\.body\)\)/);
A.match('running 也显示继续推进', P, /st === 'queued' \|\| st === 'failed' \|\| st === 'cancelled' \|\| st === 'running'/);
A.match('running 时不直接拒绝', P, /if \(st === 'running' && !S\.streaming && !STREAM\.busy\)/);
A.match('重跑前先落 pending', P, /if \(pend && \(pend\.think \|\| pend\.body\)\)/);

/* ── 第二十五轮：提示词钩子按契约重写 ── */
var HOOK = A.src('packages/sb_hook.js');
/* 契约三条（以 moodlet 插件生产样本为准） */
A.match('钩子判 eventName', HOOK, /if \(String\(ev\.eventName \|\| ""\) !== EVENT_NAME\) return;/);
A.match('钩子拼原始 systemPrompt', HOOK, /var base = String\(payload\.systemPrompt \|\| ""\);/);
A.match('钩子返回原文+追加', HOOK, /return base \+ String\.fromCharCode\(10\) \+ String\.fromCharCode\(10\) \+ addon;/);
A.nomatch('钩子异常不返回空串', HOOK, /catch \(e\) \{[\s\S]{0,300}?return "";/);
/* 收件箱必须读 SharedPreferences，不能只读 globalThis（跨引擎不共享） */
A.match('钩子读 SharedPreferences', HOOK, /getSharedPreferences\(SP_NAME, 0\)/);
A.nomatch('钩子不再只读 globalThis', HOOK, /globalThis\.__SUBAGENT_INBOX__/);
/* 注入体积必须有上限 */
A.match('钩子限制条数', HOOK, /var MAX_ITEMS = 5;/);
A.match('钩子限制正文长度', HOOK, /var MAX_TEXT = 120;/);
/* 不能教 sync=true（桥 20 秒硬超时） */
A.nomatch('能力提示不再教 sync=true', HOOK, /sync=true\)/);
A.match('能力提示教 advance/wait', HOOK, /subagent_advance\(id=\.\.\.\)/);
/* 回调必须是模块导出函数 */
A.match('钩子是模块导出函数', HOOK, /exports\.subagentInboxHook = subagentInboxHook;/);
/* toolmeta 补齐两个只读终端工具 */
var TM = A.src('packages/sb_toolmeta.js');
A.match('toolmeta 有 terminal_wait', TM, /def\("terminal_wait"/);
A.match('toolmeta 有 terminal_getscreen', TM, /def\("terminal_getscreen"/);
/* 旧语义注释已清 */
A.nomatch('旧「空数组=不限制」注释已删', A.src('packages/subagent.js'), /空数组 = 不限制（只读工具可直接跑/);
/* main.js 注释与事实一致 */
A.match('main.js 注释说明注册了钩子', A.src('main.js'), /注册系统提示词钩子（after_compose_system_prompt）/);

/* ── 第二十六轮：第二版审计修复 ── */
/* 钩子必须有开关（上游 moodlet 是双开关设计）：关掉时 return undefined，不注入 */
A.match('钩子有开关', HOOK, /function hookEnabled\(\)/);
A.match('开关读环境变量', HOOK, /getEnv\(ENV_ENABLED\)/);
/* 【第二十七轮修正】原来锁「if (!hookEnabled()) return;」，但那样 calls 恒 0 分不清
   「宿主没调」和「开关关了」。改成锁「关闭时先记 skips 再 return」。 */
A.match('开关关掉时记跳过再 return', HOOK, /if \(!hookEnabled\(\)\) \{ bumpSkipped\(\); return; \}/);
/* 钩子必须有真埋点：写 SP 计数器，工具侧能读到（原 bump 是 globalThis 假指标） */
A.match('钩子埋点写 SP', HOOK, /p\.edit\(\)\.putInt\(SP_CALLS, n\)/);
A.match('埋点在事件名判断之后', HOOK, /!== EVENT_NAME\) return;[\s\S]{0,300}?bumpCalls\(\);/);
/* 工具侧报真指标 */
A.match('inbox 报 hook_calls', A.src('packages/subagent.js'), /hook_calls: calls/);
A.match('inbox 报 hook_enabled', A.src('packages/subagent.js'), /hook_enabled: enabled/);
/* ── 第二十七轮：三项 P2 改进的语义断言（真调函数，不是字符串匹配） ── */
var HK2 = require('../../src/packages/sb_hook.js');
/* P2-1 语言选择：三种输入都要对 */
A.chk('useEnglish=true 选英文提示词', HK2.pickHint({ useEnglish: true }) === HK2.CAPABILITY_HINT_EN);
A.chk('useEnglish=false 选中文提示词', HK2.pickHint({ useEnglish: false }) === HK2.CAPABILITY_HINT_ZH);
A.chk('useEnglish 缺失时默认中文（不能默认英文）', HK2.pickHint({}) === HK2.CAPABILITY_HINT_ZH);
A.chk('payload 为 null 时不抛异常且默认中文', HK2.pickHint(null) === HK2.CAPABILITY_HINT_ZH);
A.chk('useEnglish 是字符串 "true" 时不误判为英文', HK2.pickHint({ useEnglish: 'true' }) === HK2.CAPABILITY_HINT_ZH);
/* 中英两份内容不同，且英文版不含中文 */
A.chk('中英提示词内容不同', HK2.CAPABILITY_HINT_ZH !== HK2.CAPABILITY_HINT_EN);
A.chk('英文提示词不含中日韩字符', !/[\u4e00-\u9fa5]/.test(HK2.CAPABILITY_HINT_EN));
A.chk('中文提示词含中文', /[\u4e00-\u9fa5]/.test(HK2.CAPABILITY_HINT_ZH));
/* 两份都要教对用法：不能用 sync=true（桥 20 秒硬超时） */
A.chk('中文提示词警告 sync 超时', /sync=true/.test(HK2.CAPABILITY_HINT_ZH));
A.chk('英文提示词警告 sync 超时', /sync=true/.test(HK2.CAPABILITY_HINT_EN));
/* P2-2/P2-3 常量键名必须与 subagent_inbox 读的一致，写错就读不到 */
A.chk('时间戳键名一致', HK2.SP_LAST_AT === 'hook_last_at');
A.chk('跳过计数键名一致', HK2.SP_SKIPS === 'hook_disabled_skips');
/* 钩子行为：其它阶段必须 return undefined（不能返回空串） */
var r1 = HK2.subagentInboxHook({ eventName: 'before_compose_system_prompt', eventPayload: {} });
A.chk('其它阶段返回 undefined 而非空串', r1 === undefined);
/* 目标阶段必须返回「原文 + 追加」，且原文完整保留 */
var BASE = 'BASE-PROMPT-MUST-SURVIVE';
var r2 = HK2.subagentInboxHook({
    eventName: 'after_compose_system_prompt',
    eventPayload: { systemPrompt: BASE, useEnglish: false }
});
A.chk('目标阶段返回字符串', typeof r2 === 'string');
A.chk('原文完整保留在前', r2.indexOf(BASE) === 0);
A.chk('追加内容非空', r2.length > BASE.length);
/* 英文模式注入的必须是英文片段 */
var r3 = HK2.subagentInboxHook({
    eventName: 'after_compose_system_prompt',
    eventPayload: { systemPrompt: BASE, useEnglish: true }
});
A.chk('英文模式原文仍完整保留', typeof r3 === 'string' && r3.indexOf(BASE) === 0);
var tail3 = r3.slice(BASE.length);
A.chk('英文模式追加段不含中文（除收件箱条目本身）', !/子代理收件箱|子代理能力/.test(tail3));
/* conclusion 冗余字段已清（sb_bus 只存 text，传两份是误导） */
A.nomatch('notifyDone 不再传 conclusion', A.src('packages/subagent.js'), /text: text, conclusion: text/);
/* ── 第二十八轮：思考块三态（用户定稿，恢复 6df560b 的设计）── */
var CSS2 = A.src('ui/web/panel.css');
/* 三档高度必须都存在：基础=0档，h1=1档，h2=2档。缺一档就退化回两态。 */
A.match('0 档基础限高 120', CSS2, /\.thk-body\{[^}]*max-height:120px/);
A.match('1 档 h1 限高 320', CSS2, /\.thk-body\.h1\{max-height:320px\}/);
A.match('2 档 h2 不限高', CSS2, /\.thk-body\.h2\{max-height:none;overflow:visible\}/);
/* 基础态必须容器内滚（这是 0 档能跟手的前提） */
A.match('0 档容器内滚', CSS2, /\.thk-body\{[^}]*overflow-y:auto/);
/* 嵌套滚动必须 contain，否则「划到最下面」会突然跳到整页 */
A.match('防滚动穿透', CSS2, /\.thk-body\{[^}]*overscroll-behavior:contain/);
/* 流式区三态也要有 */
A.match('流式区 0 档限高', CSS2, /\.sb-think\{[^}]*max-height:120px/);
A.match('流式区 1 档 320', CSS2, /\.sb-think\[data-state="1"\]\{max-height:320px/);
A.match('流式区 2 档不限高', CSS2, /\.sb-think\[data-state="2"\]\{max-height:none/);
/* 角标文案三档 */
A.match('三档角标文案', P, /var THINK_TIPS = \['展开', '全部', '收起'\]/);
/* 高度 class 必须由 JS 挂上（只写 CSS 不挂 class 等于没生效） */
A.match('JS 挂 h1/h2 class', P, /body\.classList\.add\('h1'\)/);
A.match('JS 清 h1/h2 class', P, /body\.classList\.remove\('h1', 'h2'\)/);
/* 点击必须累进循环，不能是两态互换 */
A.match('点击累进到下一档', P, /setThinkState\(tb, \(st0 \+ 1\) % 3\)/);
/* 双击拦截必须删掉，否则第二次点击被吃掉，永远到不了 2 档 */
A.nomatch('不再拦截双击', P, /_thinkTapEl/);
/* setThinkState 必须接受 2 档（原来只认 0/1） */
A.match('setThinkState 接受三档', P, /var n = \(st === 1 \|\| st === 2\) \? st : 0/);
/* 悬浮按钮与全部收起要覆盖 1/2 两档，不能只看 1 */
A.match('悬浮按钮看非 0 档', P, /querySelector\('\.thinkbox:not\(\[data-state="0"\]\)'\)/);
A.match('全部收起覆盖非 0 档', P, /querySelectorAll\('\.thinkbox:not\(\[data-state="0"\]\)'\)/);
/* 流式区也要能被点到（原来只匹配 .thinkbox） */
A.match('点击同时匹配流式区', P, /if \(!tb\) tb = e\.target\.closest\('\.sb-think'\)/);
/* 历史块只认标题行，正文留给长按选词 —— 点正文换档会让用户选不了文字 */
A.match('历史块只认标题行触发', P, /var head = e\.target\.closest\('\.thk-head'\)/);
A.match('标题行再找所属 thinkbox', P, /if \(head\) tb = head\.closest\('\.thinkbox'\)/);
A.nomatch('整卡不再统一 pointer', CSS2, /\.thinkbox\{[^}]*cursor:pointer/);
A.match('流式区可点有 pointer', CSS2, /\.sb-think\{[^}]*cursor:pointer/);
/* 历史块重新渲染后必须把 0 档贴底，否则重建 DOM 滚动位置回到顶部 */
A.match('渲染后 0 档统一贴底', P, /function syncThinkScroll\(\)[\s\S]{0,400}?data-state'\) === '0'[\s\S]{0,160}?scrollTop = b\.scrollHeight/);
/* 流式结束后历史块要继承当前档位，不能跳回收起 */
A.match('历史块继承流式档位', P, /var _keepSt = parseInt\(\(thinkEl && thinkEl\.getAttribute\('data-state'\)\)/);
A.match('继承档位后补设状态', P, /if \(_keepSt !== 0\) setThinkState\(tb2, _keepSt\)/);
/* 重建 DOM 时必须保住用户展开的档位：轮询每 1.5s 一次，内容一变就重建，
   不保住的话用户刚展开的块立刻被弹回收起 */
A.match('重建前记录档位', P, /var _oldBoxes = \$\('dtChat'\) \? \$\('dtChat'\)\.querySelectorAll\('\.thinkbox'\)/);
A.match('重建后还原档位', P, /if \(_newBoxes\[_bi\]\) setThinkState\(_newBoxes\[_bi\], parseInt\(_keep\[_kj\], 10\) \|\| 0\)/);
/* 三处创建都要带 data-state=0，否则流式区三态选择器全不命中 */
var thinkCreate = (P.match(/sb-think" data-state="0"/g) || []).length;
A.chk('三处流式区创建都带 data-state', thinkCreate === 3);
/* 自动贴底必须只对 0 档生效，1/2 档不能抢用户滚动位置 */
A.match('setThinkState 只在 0 档贴底', P, /if \(n === 0\) thinkScrollBottom\(tb\)/);
A.match('流式绘制只在 0 档贴底', P, /if \(_st === 0\) \{[\s\S]{0,120}?thinkEl\.scrollTop = thinkEl\.scrollHeight/);
/* textContent 赋值会清空子节点导致 scrollTop 归零，1/2 档必须恢复用户位置 */
A.match('赋值前记下滚动位置', P, /var _prevTop = thinkEl\.scrollTop/);
A.match('1/2 档恢复用户滚动位置', P, /thinkEl\.scrollTop = _prevTop/);
A.finish();
