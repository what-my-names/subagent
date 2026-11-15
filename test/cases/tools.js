/* test/cases/tools.js — 三工具 + 工具名清洗 + 白名单断言
 *
 * 三工具（subagent_stream_ctx / _key / _relay）是面板流式的支撑层，
 * 用户已拍板保留（2026-11-05）。这里验证：
 *   1) 三个工具都真实导出且声明完整
 *   2) ctx 返回页面直连所需字段
 *   3) relay 只给 http 端点用（https 走前端直连）
 *   4) 工具名污染清洗（cleanToolName）—— 这是第九轮修的真 bug
 */
var A = require('../lib/assert.js').group('三工具/白名单');
var SUB = A.src('packages/subagent.js');
/* 【第八十八轮】六个流式工具实现已拆到 sb_tool_stream.js；
   声明（METADATA）仍在 subagent.js，实现断言改用 STR。 */
var STR = A.src('packages/sb_tool_stream.js');
var T = A.src('packages/sb_tools.js');

/* ── 三工具存在性 ── */
A.chk('导出 subagent_stream_ctx', /E\.subagent_stream_ctx/.test(STR));
A.chk('导出 subagent_stream_key', /E\.subagent_stream_key/.test(STR));
A.chk('导出 subagent_stream_relay', /E\.subagent_stream_relay/.test(STR));

/* ── 三工具声明（AI 可见的 name / description） ── */
A.match('ctx 有 name 声明', SUB, /"name"\s*:\s*"subagent_stream_ctx"/);
A.match('key 有 name 声明', SUB, /"name"\s*:\s*"subagent_stream_key"/);
A.match('relay 有 name 声明', SUB, /"name"\s*:\s*"subagent_stream_relay"/);
A.match('ctx 描述提到端点/模型/请求头', SUB, /端点|模型/);
A.match('key 描述说明只本机用', SUB, /仅本机|不回显/);
A.match('relay 描述说明 http 局域网', SUB, /http|局域网/);

/* ── ctx 返回字段契约（页面直连必需） ── */
A.match('ctx 返回 endpoint', STR, /endpoint/);
A.match('ctx 返回 model', STR, /model/);
A.match('ctx 返回 headers', STR, /headers/);
A.match('ctx 返回工具 schema', STR, /schema|tools/);
A.match('ctx 按任务取白名单', STR, /allowed_tools/);

/* ── key 只写不读 ── */
A.match('key 从环境变量取值', STR, /getEnvValue/);
/* 描述文案在 METADATA 里，属声明层，仍看 SUB */
A.match('key 不回显明文', SUB, /不回显|只写不读/);

/* ── relay 是整包 SSE 拆块（不是真流式） ── */
A.match('relay 用 Tools.Net.http', STR, /Tools\.Net\.http/);
A.match('relay 解析 SSE data: 行', STR, /data:/);
A.match('relay 产出 chunks 数组', STR, /chunks/);
A.match('relay 同时给累积结果', STR, /content.*reasoning|reasoning.*content/);
A.match('relay 处理 tool_calls 分片', STR, /tool_calls/);
A.match('relay 按 index 累积参数', STR, /byIdx|index/);

/* ── 工具名清洗（第九轮真 bug） ── */
A.match('有 cleanToolName 函数', T, /function cleanToolName/);
A.match('cleanToolName 按 < 截断', T, /slice\(0, lt\)|indexOf\('<'\s*\)|split\('<'\)/);
A.match('runOne 先清洗再校验', T, /cleanToolName\(rawName\)/);
A.match('cleanToolName 导出供测试', T, /cleanToolName:\s*cleanToolName|cleanToolName,/);

/* ── 白名单匹配规则 ── */
A.match('matchAllowed 支持包名:工具名', T, /:\s*/);
A.match('matchAllowed 支持通配 *', T, /\*|wildcard/);
A.match('空白名单 = 不限制', T, /length\s*===?\s*0|!\s*allowed/);
A.match('写类工具需要 workspace', SUB, /workspace/);
A.match('写类工具识别正则', T, /WRITE_RE|create_file|edit_file|delete_file/);
A.match('高危工具识别', T, /HIGH|terminal|shell/);

/* ── 工具调用串行（不抢跑） ── */
A.match('tool_once 单个工具执行', STR, /E\.subagent_tool_once/);
A.match('tool_once 取任务白名单', STR, /loadTask|allowed_tools/);

/* ── 工具名清洗的行为断言（纯函数，可动态测） ── */
var TOOLS = null;
try { TOOLS = require(A.SRC + '/packages/sb_tools.js'); } catch (e) { TOOLS = null; }
if (TOOLS && typeof TOOLS.cleanToolName === 'function') {
    var cases = [
        ['read_file', 'read_file'],
        ['visit_web<tool_sep:6124c78e>\n<arg_key:6124c78e>args</arg_key:6124c78e>\n<arg_value:6124c78e>{"url":"x"}', 'visit_web'],
        ['list_files<tool_sep:abc><arg_key:abc>args</arg_key:abc>', 'list_files'],
        ['  read_file  ', 'read_file'],
        ['', '']
    ];
    var bad = [];
    for (var i = 0; i < cases.length; i++) {
        var got = TOOLS.cleanToolName(cases[i][0]);
        if (got !== cases[i][1]) bad.push(cases[i][0].slice(0, 30) + ' → ' + got);
    }
    A.eq('cleanToolName 5 组样例全部正确', bad.length, 0);
    if (bad.length) console.log('    不符：' + bad.join(' | '));
} else {
    A.chk('cleanToolName 可被 require 加载', false, '模块加载失败或函数缺失');
}

/* ── 工具 schema：每个工具独立 function，不包 run_tool 壳 ── */
var LLM = A.src('packages/sb_llm.js');
A.match('有 sb_toolmeta 参数表模块', A.src('packages/sb_toolmeta.js'), /function def\(name, desc, props, required\)/);
A.match('sb_llm 引入 TOOLMETA', LLM, /require\("\.\/sb_toolmeta\.js"\)/);
A.match('runToolSchema 按 allowed 逐项生成', LLM, /for \(var i = 0; i < list\.length; i\+\+\)/);
A.match('表内工具用 meta.name 作 function 名', LLM, /name: meta\.name/);
A.match('表外工具收进 fallback', LLM, /fallback\.push\(name\)/);
A.match('有表外工具时才给 run_tool', LLM, /if \(fallback\.length \|\| allOpen\) \{[\s\S]{0,1500}?name: RUN_TOOL/);
/* 【2026-11-07 改】空白名单不再给 run_tool 兜底：执行层 matchAllowed 全拒，
   给一个必然失败的入口比不给更糟。改为返回空数组，调用方不带 tools 字段。 */
A.nomatch('空白名单不再给 run_tool 兜底', LLM, /if \(!out\.length\) \{[\s\S]{0,300}?name: RUN_TOOL/);
A.match('空 schema 时调用方不带 tools', LLM, /if \(_sch && _sch\.length\) \{[\s\S]{0,80}?body\.tools = _sch/);
A.match('系统提示词含工作目录', A.src('packages/sb_task.js'), /工作目录：/);
A.nomatch('系统提示词不再有「通过 run_tool 调用」', A.src('packages/sb_task.js'), /通过 run_tool 调用/);
/* 第十七轮：提示词极简化 —— 只留事实 */
var TASKSRC = A.src('packages/sb_task.js');
/* 只检查代码行（排除注释），注释里提到这些词是设计说明 */
var TASKCODE = TASKSRC.split('\n').filter(function (l) {
  var t = String(l || '').replace(/^\s+/, '');
  return !(t.indexOf('*') === 0 || t.indexOf('//') === 0 || t.indexOf('/*') === 0);
}).join('\n');
A.nomatch('提示词不含角色声明', TASKCODE, /你是一个独立子代理/);
A.nomatch('提示词不含输出格式模板', TASKCODE, /## 输出格式/);
A.nomatch('提示词不含工具告诫', TASKCODE, /不要假装调用工具/);
A.nomatch('提示词不重复工具列表', TASKCODE, /## 可用工具/);
A.nomatch('提示词不含写入范围小节', TASKCODE, /## 写入范围/);

/* 动态验证：schema 生成结果符合预期 */
var L = null;
try { L = require('/sdcard/x/subagent/src/packages/sb_llm.js'); } catch (e) { L = null; }
if (L && typeof L.runToolSchema === 'function') {
    var s1 = L.runToolSchema(['read_file', 'create_file', 'terminal']);
    A.eq('表内 3 工具生成 3 个独立 function', s1.length, 3);
    var names1 = s1.map(function (x) { return x.function.name; }).join(',');
    A.eq('function 名就是真实工具名', names1, 'read_file,create_file,terminal');

    var s2 = L.runToolSchema(['read_file', 'my_pkg:do_thing']);
    var hasFallback = s2.some(function (x) { return x.function.name === 'run_tool'; });
    A.chk('有表外工具时附带 run_tool 兜底', hasFallback);

    var s3 = L.runToolSchema([]);
    /* 【2026-11-07 改】空白名单 = 全拒（用户拍板）。原来这里塞一个 run_tool 兜底，
       但执行层 matchAllowed(name, []) 直接 false，模型调什么都被拒 ——
       给一个必然失败的入口比不给更糟。现在返回空数组，调用方不带 tools 字段。 */
    A.eq('空白名单返回空数组', s3.length, 0);

    /* 每个 function 必须带 parameters，否则端点会拒 */
    var allHaveParams = s1.every(function (x) { return x.function.parameters && x.function.parameters.type === 'object'; });
    A.chk('每个 function 都有 object 型 parameters', allHaveParams);
} else {
    A.chk('sb_llm 可 require 且导出 runToolSchema', false, '模块加载失败');
}

/* ── 第一百零八轮：纯白名单（留空全拒，all 全开）+ 零工具结果打标 ── */
(function () {
    var T = require('../../src/packages/sb_tools.js');
    var TK = A.src('packages/sb_task.js');
    A.chk('留空全拒', T.matchAllowed('read_file', []) === false);
    A.chk('具体工具放行', T.matchAllowed('read_file', ['read_file']) === true);
    A.chk('未列出的拒', T.matchAllowed('super_admin:terminal', ['read_file']) === false);
    A.chk('* 全开', T.matchAllowed('super_admin:terminal', ['*']) === true);
    A.chk('包工具精确匹配', T.matchAllowed('super_admin:terminal', ['super_admin:terminal']) === true);
    A.chk('包工具通配', T.matchAllowed('super_admin:terminal', ['super_admin:*']) === true);
    A.chk('零工具结果加警告', TK.indexOf('本任务没有任何工具') >= 0);
    A.chk('零工具打 no_tools 标', TK.indexOf('task.no_tools = true') >= 0);

    /* 被拒时 toolCall 不能被调（不传桥） */
    var called = 0;
    var ctx = { allowed: ['read_file'], workspace: '/sdcard/x', roots: ['/sdcard/x'],
        nextSeq: function () { return 1; }, loadUndo: function () { return []; },
        appendUndo: function () {}, clearUndo: function () {}, toolCall: function () { called++; return { ok: true }; } };
    T.runOne(ctx, { tool: 'super_admin:terminal', args: { command: 'ls' } })
        .then(function (r) {
            A.chk('白名单外 runOne 返回失败', r.ok === false);
            A.chk('白名单外 toolCall 零调用（不传桥）', called === 0);
        })
        .catch(function (e) { A.chk('白名单外不应抛异常', false, String(e)); });
})();

A.finish();