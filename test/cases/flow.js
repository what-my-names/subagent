/* test/cases/flow.js — 主流程断言
 *
 * 覆盖「建任务 → 推进 → 查状态 → 取结论 → 收件箱 → 删除」整条链，
 * 全部为静态断言（读源码 + 读 manifest），不联网、不装机、不改文件。
 *
 * 断言原则（来自记忆库「配置页输入不被回包覆盖」专篇）：
 *   测「代码里实际怎么写的」，不测「我以为它怎么写的」。
 */
var A = require('../lib/assert.js').group('主流程');

var M = A.src('manifest.json');
var SUB = A.src('packages/subagent.js');
var TASK = A.src('packages/sb_task.js');
var BUS = A.src('packages/sb_bus.js');
var LLM = A.src('packages/sb_llm.js');
var CFG = A.src('packages/sb_config.js');

/* ── manifest 完整性 ── */
A.match('manifest 是合法 JSON', M, /^\s*\{/);
A.chk('manifest 有 toolpkg_id', /"toolpkg_id"\s*:\s*"com\.whatsmynames\.subagent"/.test(M));
A.chk('manifest 有 main 入口', /"main"\s*:\s*"main\.js"/.test(M));
A.chk('manifest 有 subpackages', /"subpackages"\s*:\s*\[/.test(M));
A.chk('manifest 声明 api_version', /"api_version"/.test(M));
A.chk('manifest 三个 resources 齐全', (M.match(/"key"\s*:/g) || []).length >= 3);
A.chk('resources 指向真实文件 panel.html', /ui\/web\/panel\.html/.test(M));
A.chk('resources 指向真实文件 panel.css', /ui\/web\/panel\.css/.test(M));
A.chk('resources 指向真实文件 panel.js', /ui\/web\/panel\.js/.test(M));

/* ── 29 个工具全部注册 ── */
var TOOL_NAMES = [
    'subagent_spawn', 'subagent_advance', 'subagent_wait', 'subagent_status',
    'subagent_result', 'subagent_undo', 'subagent_cancel', 'subagent_resume',
    'subagent_steer', 'subagent_inbox', 'subagent_list', 'subagent_close',
    'subagent_delete', 'subagent_config', 'subagent_templates', 'subagent_probe',
    'subagent_version', 'subagent_trace', 'subagent_workspace', 'subagent_list_dir',
    'subagent_check_path', 'subagent_save_turn', 'subagent_tool_once',
    'subagent_stream_ctx', 'subagent_stream_key', 'subagent_stream_relay',
    'subagent_chats', 'subagent_tools', 'subagent_vendor_js'
];
var missing = [];
for (var i = 0; i < TOOL_NAMES.length; i++) {
    var n = TOOL_NAMES[i];
    if (SUB.indexOf('exports.' + n) < 0) missing.push(n);
}
A.eq('29 个工具全部导出', missing.length, 0);
if (missing.length) console.log('    缺失：' + missing.join(', '));

/* 每个工具都要有 name 声明（供 AI 调用） */
var declared = (SUB.match(/"name"\s*:\s*"subagent_/g) || []).length;
A.chk('工具声明数量 >= 29', declared >= 29, '实际 ' + declared);

/* ── spawn 参数契约 ── */
A.match('spawn 有 task 必填', SUB, /"name"\s*:\s*"task"/);
A.match('spawn 有 allowed_tools', SUB, /"name"\s*:\s*"allowed_tools"/);
A.match('spawn 有 workspace', SUB, /"name"\s*:\s*"workspace"/);
A.match('spawn 有 sync 参数', SUB, /"name"\s*:\s*"sync"/);
A.match('spawn 有 max_steps 参数', SUB, /"name"\s*:\s*"max_steps"/);

/* ── 状态机：6 个状态齐全 ── */
var STATES = ['queued', 'running', 'done', 'failed', 'closed', 'cancelled'];
var missSt = [];
for (var s = 0; s < STATES.length; s++) {
    if (TASK.indexOf("'" + STATES[s] + "'") < 0 && TASK.indexOf('"' + STATES[s] + '"') < 0) missSt.push(STATES[s]);
}
A.eq('状态机 6 个状态齐全', missSt.length, 0);
if (missSt.length) console.log('    缺失：' + missSt.join(', '));

/* ── 任务落盘：save / load 成对 ── */
A.chk('TASK 有 loadTask', /function loadTask|exports\.loadTask/.test(TASK));
A.chk('TASK 有 saveTask', /function saveTask|exports\.saveTask/.test(TASK));
A.chk('任务文件用 json 后缀', /\.json/.test(TASK));

/* ── 收件箱数据结构（第七轮修复核心） ── */
A.match('收件箱 add 写入 title', BUS, /title/);
A.match('收件箱 add 写入 task_id', BUS, /task_id/);
A.match('收件箱 add 写入 task_title', BUS, /task_title/);
A.match('收件箱 add 写入 conclusion', BUS, /conclusion/);
A.match('收件箱 add 写入 finished_at', BUS, /finished_at/);
A.match('收件箱 add 写入 unread', BUS, /unread/);
A.match('收件箱正文有 20000 字符上限', BUS, /20000/);
A.match('收件箱数组有 40 条上限', BUS, /40/);
/* 【2026-11-07 改】bump 已删：钩子与工具不在同一 JS 引擎，钩子侧自增的计数
   工具侧天然读不到，SP 里的计数又因为 bump 零调用恒为 0，是假指标。
   断言方向反转：必须没有 bump，stat 只报真实可观测的条数。 */
A.nomatch('收件箱不再有假诊断 bump', BUS, /function bump/);
A.match('stat 只报条数', BUS, /return \{ count: load\(\)\.length \};/);
A.chk('收件箱有 stat（未读统计）', /function stat/.test(BUS));
A.chk('收件箱导出 add/list/remove/clear', /module\.exports = \{ add/.test(BUS));

/* ── 白名单硬拒绝 ── */
A.chk('sb_tools 有 matchAllowed', /function matchAllowed|exports\.matchAllowed/.test(A.src('packages/sb_tools.js')));
A.match('sb_tools 有 cleanToolName', A.src('packages/sb_tools.js'), /function cleanToolName/);
A.match('runOne 先清洗再校验', A.src('packages/sb_tools.js'), /cleanToolName\(rawName\)[\s\S]{0,400}?matchAllowed/);

/* ── 写前备份可撤回 ── */
A.chk('TASK 有 undo 相关', /undo/i.test(TASK) || /undo/i.test(SUB));
A.match('delete 是两段式（默认只预览）', SUB, /confirm/);

/* ── 端点解析：不能双重后缀 ── */
A.chk('LLM 有 joinUrl', /function joinUrl/.test(LLM));
A.chk('LLM 有 resolveProfile', /function resolveProfile/.test(LLM));
A.match('joinUrl 剥掉已有后缀', LLM, /chat\/completions|replace.*completions/);

/* ── 配置：密钥只写不读 ── */
A.chk('CFG 有 setKey', /function setKey|exports\.setKey/.test(CFG));
A.chk('CFG 有 getEnvValue', /getEnvValue: function|function getEnvValue/.test(CFG));
A.chk('配置里不存明文密钥字段', !/"api_key"\s*:\s*"[^"]{20,}"/.test(CFG));
A.match('set 拒绝模型名像密钥', SUB, /看起来像密钥/);

/* ── 私有工作区 ── */
A.chk('有 workspaceDir', /function workspaceDir/.test(CFG));
A.chk('数据目录固定 Download/Operit/subagent', /Download\/Operit\/subagent|Operit\/subagent/.test(CFG));

/* ── 发布体检：写死的计数与文档一致性 ── */
/* version 里的 tools 计数不能写死（曾写死 21，工具涨到 29 后被装机验证误导） */
A.nomatch('subagent_version 不写死 tools 计数', SUB, /tools:\s*\d+\s*\}/);
A.match('subagent_version 动态统计 tools', SUB, /var n = 0;[\s\S]{0,400}?tools: n/);

/* README 必须与实际一致 */
var RD = A.src('../README.md');
if (RD) {
    A.nomatch('README 不再说 allowed_tools 必填', RD, /`allowed_tools` 必填/);
    /* 【2026-11-07 反转】这条原来锁的是「留空 = 不限制」，而实现是「留空 = 全拒」。
       断言把错误说法锁死了：谁改 README 谁测试红。第二十二轮用户拍板「留空 = 全拒」，
       第二十六轮审计把它列为 P0（给外部用户看的 README 说反了）。
       现在方向反转，锁正确语义。 */
    A.match('README 说明留空 = 一个工具都用不了', RD, /allowed_tools.*留空.*一个工具都用不了/);
    A.match('README 说明 all=true 全放开', RD, /all=true/);
    A.nomatch('README 不再说留空 = 不限制', RD, /留空 = 不限制/);
    A.match('README 工具表覆盖 29 个', RD, /## 工具（29 个）/);
    A.match('README 提到 CORS 判据', RD, /access-control-allow-origin/);
    A.match('README 有测试章节', RD, /node e2e_all\.js/);
    A.nomatch('README 不再提 selfcheck_v025', RD, /selfcheck_v025/);
}

/* ── 系统提示词钩子 ── */
var HOOK = A.src('packages/sb_hook.js');
A.match('hook 导出 subagentInboxHook', HOOK, /exports\.subagentInboxHook/);
A.match('无未读时注入能力提示', HOOK, /CAPABILITY_HINT/);
A.match('能力提示含 subagent_spawn 用法', HOOK, /subagent_spawn\(task=/);
A.match('能力提示含 subagent_result 用法', HOOK, /subagent_result\(id=/);
A.match('有未读时列收件箱', HOOK, /\[子代理收件箱\] 有 /);
/* 铁律：钩子内禁止调工具 API（会回环导致 ANR）——检查代码行，排除注释。
   注意：不能只按行首星号或斜杠过滤，块注释的续行（如「为什么用 SP...」）不以星号开头，
   会被漏掉造成假阳性。这里先把整段块注释剥掉，再按行注释过滤。 */
var hookCode = HOOK.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(function (l) { return !/^\s*\/\//.test(l); })
    .join('\n');
A.nomatch('hook 代码里不调 Tools 系列（铁律）', hookCode, /Tools\.\w+/);
A.match('hook 注册在 main.js', A.src('main.js'), /registerSystemPromptComposeHook/);


/* ── 第十五轮：可靠性修复 ── */
var LLM2 = A.src('packages/sb_llm.js');
var CFG2 = A.src('packages/sb_config.js');
var TASK2 = A.src('packages/sb_task.js');

/* LLM 重试：429/5xx/网络失败要重试，配置类错误不重试 */
A.match('有 isRetryable 判定', LLM2, /function isRetryable\(status, text\)/);
A.match('重试覆盖 429', LLM2, /status === 429/);
A.match('重试覆盖 5xx', LLM2, /502.*503.*504|500.*502.*503/);
A.match('网络失败 status=0 也重试', LLM2, /if \(!status\) return true/);
A.match('有 postJsonOnce 单次请求', LLM2, /async function postJsonOnce/);
A.match('postJson 带重试循环', LLM2, /for \(var attempt = 0; attempt <= waits\.length/);
A.match('重试有退避等待', LLM2, /Tools\.System\.sleep\(waits\[attempt\]\)/);

/* 配置缓存 */
A.match('CFG 有 _cfgCache', CFG2, /var _cfgCache = null/);
A.match('CFG load 支持 force 参数', CFG2, /async function load\(force\)/);
A.match('CFG save 后失效缓存', CFG2, /writeText\(cfgPath\(\), body\)[\s\S]{0,60}?invalidateCache\(\)/);
A.match('setKey 后失效缓存', CFG2, /writeEnvironmentVariable\(KEY_ENV, v\)[\s\S]{0,300}?invalidateCache\(\)/);
A.match('环境变量有缓存', CFG2, /var _envCache = \{\}/);
A.match('空值不缓存', CFG2, /if \(v\) \{ _envCache\[k\] = v;/);

/* 任务推进锁 */
A.match('advanceTask 有互斥锁', TASK2, /var _advancing = \{\}/);
A.match('锁在 finally 释放', TASK2, /finally \{[\s\S]{0,80}?delete _advancing\[_lk\]/);
A.match('重复推进返回 busy', TASK2, /busy: true/);

/* ── 第十六轮：流式与渲染修复 ── */
var P2 = A.src('ui/web/panel.js');
/* 改配置后必须清流式环境缓存，否则一直用旧端点（旧端点没 CORS 就永远走中继） */
A.match('cfgset 后清 STREAM 缓存', P2, /if \(r && r\.success === false\) return;[\s\S]{0,400}?STREAM\.ctx = null/);
/* 流式 ctx 缓存要按任务 id 校验，换任务不能复用旧白名单 */
A.match('loadStreamEnv 按任务 id 校验', P2, /STREAM\.ctxFor === _tid/);
A.match('loadStreamEnv 记录 ctxFor', P2, /STREAM\.ctxFor = _tid/);
/* 工具调用轮次结束后必须定格 holder，否则下一轮流式覆盖造成「内容消失又出现」 */
A.match('工具轮结束后定格流式 holder', P2, /工具调用这一轮结束后，必须把当前流式 holder/);
A.match('定格时把已流出内容转成正式气泡', P2, /host\.insertBefore\(_hist, holder\)/);
A.match('定格后清空 holder 内容', P2, /holder\.innerHTML = '<div class="sb-think"/);

A.finish();