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
/* 【第八十六轮】manifest 不再声明 resources。
   原因：代码早就不用 readResource（真机永久 pending），改成 html 字符串内联；
   声明留着会让宿主去争资源所有权，别人装包即报
   "Bad state: Module read requires an active resource owner"。
   这里改成反向断言，防止有人好心再加回来。 */
A.chk('manifest 不声明 resources（否则装包报 resource owner）', !/"resources"\s*:/.test(M));

/* ── 37 个实现函数全保留（面板直接调旧名），10 个大类新声明 ── */
var TOOL_NAMES = [
    'subagent_spawn', 'subagent_advance', 'subagent_wait', 'subagent_status',
    'subagent_result', 'subagent_undo', 'subagent_cancel', 'subagent_resume',
    'subagent_steer', 'subagent_inbox', 'subagent_list', 'subagent_close',
    'subagent_delete', 'subagent_config', 'subagent_templates', 'subagent_probe',
    'subagent_version', 'subagent_trace', 'subagent_workspace', 'subagent_list_dir',
    'subagent_check_path', 'subagent_save_turn', 'subagent_tool_once',
    'subagent_stream_ctx', 'subagent_stream_key', 'subagent_stream_relay',
    'subagent_chats', 'subagent_tools', 'subagent_vendor_js',
    'subagent_run', 'subagent_get', 'subagent_ctrl', 'subagent_box',
    'subagent_del', 'subagent_update', 'subagent_cfg', 'subagent_env'
];
/* 【第八十八轮】工具实现已按功能拆分到 sb_tool_*.js 模块，
   用 install(E, opts) 把工具挂回 exports，所以这里不能再只看 subagent.js 单文件。
   检查口径：源码里出现 `exports.subagent_x =` 或 `E.subagent_x =` 任一种都算已实现。 */
var SPLIT_SRC = '';
['packages/sb_tool_update.js', 'packages/sb_tool_env.js', 'packages/sb_tool_stream.js',
    'packages/sb_tool_task.js', 'packages/sb_tool_cfg.js', 'packages/sb_tool_main.js',
    'packages/sb_tool_root.js'].forEach(function (f) {
    SPLIT_SRC += A.src(f);
});
var ALL_IMPL = SUB + '\n' + SPLIT_SRC;
var missing = [];
for (var i = 0; i < TOOL_NAMES.length; i++) {
    var n = TOOL_NAMES[i];
    if (ALL_IMPL.indexOf('exports.' + n) < 0 && ALL_IMPL.indexOf('E.' + n) < 0) missing.push(n);
}
A.eq('实现函数全部导出（含拆出模块）', missing.length, 0);
if (missing.length) console.log('    缺失：' + missing.join(', '));

/* METADATA 只声明 10 个大类 + 10 个面板保留名 = 20 */
var declared = (SUB.match(/"name"\s*:\s*"subagent_/g) || []).length;
A.eq('METADATA 声明数量 = 22', declared, 22);

/* ── spawn 参数契约（合并后：tools/wait/budget/detail 替代旧三件） ── */
A.match('spawn 有 task 必填', SUB, /"name"\s*:\s*"task"/);
A.match('spawn 有 tools（替代 allowed_tools/all）', SUB, /"name"\s*:\s*"tools"/);
A.match('spawn 有 workspace', SUB, /"name"\s*:\s*"workspace"/);
A.match('spawn 有 wait（替代 sync）', SUB, /"name"\s*:\s*"wait"/);
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
/* 【第八十二轮】父子对话从属：邮件带 chat_id，list 按对话过滤 */
A.match('收件箱 add 写入 chat_id', BUS, /chat_id/);
A.match('收件箱 list 支持按对话过滤', BUS, /function list\(chatId\)/);
A.match('收件箱提供 listAll 全集入口', BUS, /function listAll\(\)/);
A.match('listAll 已导出', BUS, /listAll: listAll/);
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
A.match('set 拒绝模型名像密钥', A.src('packages/sb_tool_cfg.js'), /看起来像密钥/);

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
    /* 参数已从 allowed_tools/all 合并为 tools/*，断言跟着新口径走 */
    A.match('README 说明 tools 留空 = 无工具', RD, /tools` 留空＝无工具/);
    A.match('README 说明 tools=* 全放开', RD, /传 `\*` 放开全部/);
    A.nomatch('README 不再说留空 = 不限制', RD, /留空 = 不限制/);
    /* 【第四十二轮】原来锁死 34，加工具就要改。改为动态比对代码里的实际数量。 */
    var _tc = (A.src('packages/subagent.js').match(/"name": "subagent_/g) || []).length;
    A.chk('README 工具表与代码一致（' + _tc + ' 个）', RD.indexOf('## 工具（' + _tc + ' 个') >= 0);
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
/* ── 第二十七轮：钩子三项 P2 改进 ── */
/* P2-1 英文模式：中英双份提示词，按 payload.useEnglish 选 */
A.match('提示词拆中英两份', HOOK, /CAPABILITY_HINT_ZH/);
A.match('英文提示词存在', HOOK, /CAPABILITY_HINT_EN/);
A.match('有 pickHint 按语言选', HOOK, /function pickHint\(payload\)/);
A.match('pickHint 只在 useEnglish===true 时用英文', HOOK, /payload\.useEnglish === true\) \? CAPABILITY_HINT_EN : CAPABILITY_HINT_ZH/);
A.nomatch('英文提示词不含中文标题', HOOK, /\[Subagent capability\][^\n]*[子代理]/);
A.match('收件箱块支持英文分支', HOOK, /function buildInboxBlock\(arr, en\)/);
A.match('英文收件箱标题', HOOK, /\[Subagent inbox\] /);
/* P2-2 时间戳：只记次数分不清「刚调的」还是「三天前调的」 */
A.match('埋点记时间戳键', HOOK, /var SP_LAST_AT = "hook_last_at"/);
A.match('bumpCalls 写时间戳', HOOK, /putLong\(SP_LAST_AT, Date\.now\(\)\)/);
/* P2-3 埋点位置：必须在开关判断之前，否则「没触发」和「开关关了」分不清 */
A.match('有跳过计数键', HOOK, /var SP_SKIPS = "hook_disabled_skips"/);
A.match('有 bumpSkipped 函数', HOOK, /function bumpSkipped\(\)/);
A.match('开关关闭时记跳过', HOOK, /if \(!hookEnabled\(\)\) \{ bumpSkipped\(\); return; \}/);
/* 顺序断言：bumpCalls() 必须出现在 hookEnabled() 判断之前 */
var posBump = HOOK.indexOf('bumpCalls();');
var posSw = HOOK.indexOf('if (!hookEnabled())');
A.chk('埋点在开关判断之前（顺序正确）', posBump > 0 && posSw > 0 && posBump < posSw);
/* 观测字段：subagent_inbox 要把三个新指标都报出来 */
var SA = A.src('packages/subagent.js');
A.match('inbox 报 hook_disabled_skips', A.src('packages/sb_tool_task.js'), /hook_disabled_skips: skips/);
A.match('inbox 报 hook_last_at', A.src('packages/sb_tool_task.js'), /hook_last_at: lastAt/);
A.match('inbox 读 hook_last_at 用 getLong', A.src('packages/sb_tool_task.js'), /p\.getLong\("hook_last_at", 0\)/);
A.match('inbox message 含上次调用时间', A.src('packages/sb_tool_task.js'), /上次 " \+ agoTxt/);


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
/* 【第八十八轮】panel.js 已按功能拆片（tex / toast），构建时按 JS_PARTS 顺序拼成一个 script。
   断言测「页面里真正跑的脚本」，所以这里按同样顺序拼接。 */
var P2 = A.src('ui/web/panel.js') + '\n' + A.src('ui/web/panel_tex.js') + '\n' + A.src('ui/web/panel_toast.js');
/* 改配置后必须清流式环境缓存，否则一直用旧端点（旧端点没 CORS 就永远走中继） */
A.match('cfgset 后清 STREAM 缓存', P2, /if \(r && r\.success === false\) return;[\s\S]{0,400}?STREAM\.ctx = null/);
/* 流式 ctx 缓存要按任务 id 校验，换任务不能复用旧白名单 */
A.match('loadStreamEnv 按任务 id 校验', P2, /STREAM\.ctxFor === _tid/);
A.match('loadStreamEnv 记录 ctxFor', P2, /STREAM\.ctxFor = _tid/);
/* 工具调用轮次结束后必须定格 holder，否则下一轮流式覆盖造成「内容消失又出现」 */
/* 注释已压缩，改为断言代码行为：定格即清空 holder 并重建 sb-think 容器 */
A.match('工具轮结束后定格流式 holder', P2, /holder\.innerHTML = '<div class="sb-think"/);
A.match('定格时把已流出内容落进同一张卡', P2, /_blk.appendChild\(_txt\)/);
A.match('定格后清空 holder 内容', P2, /holder\.innerHTML = '<div class="sb-think"/);

/* ── 【第八十八轮】拆分模块的解构完整性 ──
   背景：工具实现按功能拆到 sb_tool_*.js 后，子模块拿不到主文件的顶层函数，
   必须显式 require + 解构。漏一个解构，node --check 不报错、静态断言也不报错，
   只有真机跑到那条分支才抛 "xxx is not defined"。
   （真例：sb_tool_main.js 漏解构 ancestorChatIdsOf，subagent_get 一调就挂。）
   这里把所有拆分模块扫一遍：凡是用到 sb_ctx 导出函数却没解构的，直接判失败。 */
(function () {
    var ctxSrc = A.src('packages/sb_ctx.js');
    var ctxFns = [];
    var re = /^    ([A-Za-z_][A-Za-z0-9_]*): [A-Za-z_]+,?$/gm;
    var m;
    while ((m = re.exec(ctxSrc)) !== null) ctxFns.push(m[1]);
    A.chk('sb_ctx 导出函数可解析', ctxFns.length >= 10);

    var mods = [
        'packages/sb_tool_task.js', 'packages/sb_tool_stream.js',
        'packages/sb_tool_cfg.js', 'packages/sb_tool_env.js',
        'packages/sb_tool_update.js', 'packages/sb_tool_main.js'
    ];
    var missing = [];
    for (var i = 0; i < mods.length; i++) {
        var src = A.src(mods[i]);
        for (var j = 0; j < ctxFns.length; j++) {
            var fn = ctxFns[j];
            var used = new RegExp('\\b' + fn + '\\(').test(src);
            var declared = src.indexOf('var ' + fn + ' = CTX.' + fn + ';') >= 0;
            if (used && !declared) missing.push(mods[i] + ' → ' + fn);
        }
    }
    A.eq('拆分模块用到 CTX 函数必须解构', missing.length, 0);
    if (missing.length) console.log('    漏解构：' + missing.join(', '));

    /* 【第八十九轮补】不只 CTX：主文件顶层任何函数/变量，子模块用到就必须自己声明或 require。
       真例：clip / parseList / parseJson 留在 subagent.js，sb_tool_* 直接调用 →
       真机一跑就抛 xxx is not defined，任务详情整页空白。 */
    var mainSrc = A.src('packages/subagent.js');
    var mainTop = [];
    var reTop = /^(?:function|var) ([A-Za-z_][A-Za-z0-9_]*)/gm;
    var m2;
    while ((m2 = reTop.exec(mainSrc)) !== null) mainTop.push(m2[1]);
    A.chk('主文件顶层符号可解析', mainTop.length > 0);

    var leak = [];
    for (var a = 0; a < mods.length; a++) {
        var s2 = A.src(mods[a]);
        for (var b = 0; b < mainTop.length; b++) {
            var sym = mainTop[b];
            if (new RegExp('(?:var|function|async function)\\s+' + sym + '\\b').test(s2)) continue;
            if (new RegExp('\\b' + sym + '\\s*\\(').test(s2)) leak.push(mods[a] + ' → ' + sym);
        }
    }
    A.eq('拆分模块不得直接使用主文件顶层符号', leak.length, 0);
    if (leak.length) console.log('    未声明：' + leak.join(', '));
})();


/* ── 【第九十轮】ROOT 权限窗口 ── */
(function () {
    var ROOT = A.src('packages/sb_root.js');
    var GRP = A.src('packages/sb_group.js');
    var TOOL = A.src('packages/sb_tool_root.js');

    A.match('sb_group 有 hash16', GRP, /function hash16\(/);
    A.match('sb_group 有 rootCodeNow', GRP, /function rootCodeNow\(/);
    A.match('hash16 已导出', GRP, /hash16:\s*hash16/);

    A.match('PERM 含 ROOT=32', GRP, /ROOT:\s*32/);
    A.match('PERM 含 ROOT_ALL=63', GRP, /ROOT_ALL:\s*63/);

    A.match('窗口有 expires_at', ROOT, /expires_at/);
    A.match('窗口时长上限 1440', ROOT, /1440/);
    A.match('过期自动清理', ROOT, /function prune\(/);
    A.match('读取做了 object/string 归一化', ROOT, /typeof raw === "string"/);

    ['open', 'close', 'check', 'list'].forEach(function (act) {
        A.match('subagent_root 支持 ' + act, TOOL, new RegExp('action === "' + act + '"'));
    });

    A.match('METADATA 声明 subagent_root', A.src('packages/subagent.js'), /"name": "subagent_root"/);
})();


/* ── 【第九十一轮】主人默认 root + 可点性高亮 ── */
(function () {
    var MAIN = A.src('packages/sb_tool_main.js');
    var CTX = A.src('packages/sb_ctx.js');
    var CSS = A.src('ui/web/panel.css');

    /* 拿不到 chatId = 本机主人亲手操作，给创始人级权限 */
    A.match('主人无 cid 时按创始人权限', MAIN, /cid \? GRP\.resolveMember\(g, cid\) : \{ ok: true, mask: GRP\.PERM\.FOUNDER/);
    A.match('删除群组对主人放行', MAIN, /if \(cid && String\(g\.founder/);

    /* callerChatId 两级兜底 */
    A.match('callerChatId 有内存缓存', CTX, /_LAST_CID/);
    A.match('callerChatIdAsync 存在', CTX, /async function callerChatIdAsync/);
    A.match('callerChatIdAsync 已导出', CTX, /callerChatIdAsync: callerChatIdAsync/);

    /* 可点性：hover 高亮 */
    A.match('群组头 hover 高亮', CSS, /\.grp-head:hover\{background/);
    A.match('轻量头 hover 高亮', CSS, /\.grp-head\.lite:hover\{background/);
    A.match('任务行 hover 高亮', CSS, /\.chat-row:hover\{background/);
    A.match('信息按钮 hover 高亮', CSS, /\.grp-info:hover\{/);
    A.match('箭头 hover 变主色', CSS, /\.grp-head:hover \.grp-chv\{stroke:var\(--acc\)/);
})();


/* ── 【第九十二轮】环形轮盘 + 右键浮窗 + 文案 + 配色 ── */
(function () {
    var RING = A.src('ui/web/panel_ring.js');
    var TOAST = A.src('ui/web/panel_toast.js');
    var P = A.src('ui/web/panel.js');
    var C = A.src('ui/web/panel.css');
    var BUILD = A.src('ui/build_panel_html.js');

    /* 1) toast 未定义免疫 */
    A.match('_say 安全转发存在', P, /function _say\(msg, lv\)/);
    A.match('_say 检查 toast 类型', P, /typeof toast === 'function'/);
    A.match('_say 有 DOM 兜底', P, /getElementById\('toastStack'\)/);

    /* 2) 环形轮盘 */
    A.match('环形按角度算位移', RING, /var y = Math\.sin\(a\)/);
    A.match('环形按角度算深度', RING, /var z = -RING_RADIUS/);
    A.match('环形越远越模糊', RING, /blurPx/);
    A.match('环形位置绕回（无缝循环）', RING, /while \(RING\.pos >= n\) RING\.pos -= n/);
    A.match('环形移除后补齐', RING, /function ringRemove/);
    A.match('环形只有中间可交互', RING, /pointerEvents = Math\.abs\(d\) < 1\.1/);

    /* 3) 双击进轮盘 */
    A.match('双击改为 ringPush', TOAST, /ringPush\(el, rec\)/);
    A.match('进轮盘后停掉自动消失', TOAST, /rec\.timer = null/);
    A.match('killToast 通知轮盘移除', TOAST, /ringRemove\(el\)/);

    /* 4) 构建顺序：ring 在 toast 之前（toast 负责收尾） */
    A.chk('构建含 panel_ring', BUILD.indexOf('panel_ring.js') >= 0);
    var ri = BUILD.indexOf('"panel_ring.js"'), ti = BUILD.indexOf('"panel_toast.js"');
    A.chk('ring 拼在 toast 之前', ri > 0 && ti > ri);

    /* 5) 右键浮窗 */
    A.match('openCfm 接收 anchor', P, /function openCfm\(title, body, onYes, anchor\)/);
    A.match('openCfm 贴合触发点', P, /getBoundingClientRect/);
    A.match('浮窗无遮罩', P, /function closeCfm\(\) \{[\s\S]{0,120}\}/);
    A.match('浮窗锚右上缩放', C, /transform-origin:top right/);

    /* 6) 文案重写 */
    A.match('权限文案用动词短语', P, /派新任务/);
    A.match('角色名群主', P, /return '群主'/);

    /* 7) 配色 */
    A.match('配色新增 bg4', C, /--bg4:#2a3140/);
    A.match('配色阴影变量', C, /--shadow:/);

    /* 8) 环形容器样式 */
    A.match('ringBox 存在', C, /#ringBox\{/);
    A.match('ringBox 透视', C, /perspective:900px/);
})();


/* ── 【第九十三轮】停止后不能说停不停 + 秒数不能无限涨 ── */
(function () {
    var P = A.src('ui/web/panel.js');

    /* 停止锁：本地立刻锁 cancelled，trace 回包不许改回 running */
    A.match('停止时置 stopping 锁', P, /S\.stopping = true/);
    /* 【第九十四轮】右下角叉号语义改成「关闭」：立刻锁 closed，
       不许再降级成 cancelled（降级后面板又会把它当可推进）。 */
    A.match('关闭时立刻置 closed', P, /S\.curStatus = 'closed'/);
    A.match('关闭后同步列表状态', P, /markClosed\(S\.cur\)/);
    A.match('trace 回包绕过 running', P, /if \(S\.stopping && d\.id === S\.cur/);
    A.match('非运行态解除锁', P, /if \(d\.status !== 'running' && d\.status !== 'queued'\) S\.stopping = false/);
    A.match('stopping 有初值', P, /stopping: false/);

    /* 秒数三道闸 */
    A.match('秒数受 STALE_MS 约束', P, /if \(upd > 0 && \(Date\.now\(\) - upd\) > STALE_MS\) return base/);
    A.match('秒数上限 3600', P, /sec >= 3 && sec < 3600/);
})();

/* ── 【第九十四轮】关闭必须真正打断推进循环（后端 + 前端双向） ── */
(function () {
    var MAIN = A.src('packages/sb_tool_main.js');
    var T2 = A.src('packages/sb_task.js');
    var P = A.src('ui/web/panel.js');

    /* 后端 ctrl(close) 必须打 cancel 信号，否则跑着的那一轮不知道要停 */
    A.match('close 打 cancel 信号', MAIN, /t\.cancel = true;\s*\n\s*t\.status = "closed";/);
    /* resume 不许复活已关闭任务 */
    A.match('resume 拒绝 closed', MAIN, /任务已关闭，不能恢复/);
    /* run 循环认 closed */
    A.match('run 循环认 closed', MAIN, /taskW\.status === "closed"\) break/);

    /* 状态机：closed 短路、next 为 stop、异常不改写终态 */
    A.match('advance 短路 closed', T2, /if \(task\.status === "closed"\) return \{ ok: false, done: true/);
    A.match('nextFor 认 closed', T2, /task\.status === "cancelled" \|\| task\.status === "closed"\) return "stop"/);
    A.match('模型返回后重新读盘', T2, /var fresh = await loadTask\(task\.id\)/);
    A.match('关闭不降级 cancelled', T2, /task\.status = \(task\.status === "closed"\) \? "closed" : "cancelled"/);

    /* 前端：关闭后禁推进、同步本地列表 */
    A.match('前端禁推进 closed', P, /if \(st === 'closed'\) \{ err\('任务已关闭/);
})();

/* ── 【第九十五轮】回包无人接 / 列表页版本号 / 轮询闪烁 / 外部包重复 ── */
(function () {
    var P = A.src('ui/web/panel.js');
    var ENV = A.src('packages/sb_tool_env.js');

    /* ① 检查更新：onOk 里必须调 renderUpdCheck，否则永远停在「正在检查…」 */
    A.match('检查更新回包有渲染', P, /'updCheck', function \(r\) \{[\s\S]{0,200}?renderUpdCheck\(r\)/);

    /* ② 列表页拉版本号 */
    A.match('列表页拉版本', P, /'list'\);\s*\/\*[\s\S]{0,300}?subagent_env', \{ what: 'version' \}/);

    /* ③ 运行中不整页重建：用 turns 条数做指纹 */
    A.match('轮询用 turns 指纹', P, /_turnsLen === S\.turnsLen/);
    A.match('turnsLen 有初值', P, /turnsLen: -1/);

    /* ④ 外部包过滤 0 工具 + 同 display 去重 */
    A.match('过滤 0 工具包', ENV, /if \(cnt <= 0\) \{ continue; \}/);
    A.match('同 display 去重', ENV, /_byDisp\[keyD\]/);
})();

A.finish();
