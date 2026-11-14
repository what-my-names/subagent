/* sb_hook.js — 系统提示词钩子（after_compose_system_prompt）
 *
 * 【铁律】钩子内禁止调用任何工具 API（Tools.Files / Tools.Net / Tools.Shell / Tools.Chat 等）。
 *   历史事故（2026-10-27）：钩子里用 Tools.Files.write 写调试日志，write_file 本身
 *   又是一次工具调用 → 再次触发同一钩子 → 无限回环 → ANR + 进程被杀。
 *   注意：`Java.getApplicationContext().getSharedPreferences(...)` 是直接 Java 调用，
 *   不经过工具层，不会回环，可以在钩子里用。这是跨 JS 引擎实例的唯一通道。
 *
 * 【契约】以生产在用的上游样本为准（moodlet 插件的 main.js）：
 *   ① 必须判 eventName === "after_compose_system_prompt"，其它阶段不处理
 *   ② 不处理时 return（undefined），绝不能 return ""（空串会顶掉整段系统提示词）
 *   ③ 处理时返回「原文 + 追加」的完整系统提示词，必须自己拼接 eventPayload.systemPrompt
 *   ④ 回调必须是模块导出函数（exports.xxx），否则报 must be exported from a toolpkg module
 *
 * 【为什么收件箱要读 SharedPreferences 而不是 globalThis】
 *   ToolPkg 工具函数一旦 return，宿主立刻弃用这个引擎实例；钩子侧与工具侧不是同一个
 *   JS 引擎，globalThis 不跨。2026-10-28 实测：改 globalThis 共享后 hits 仍恒 0、
 *   注入文本从未出现在上下文。sb_bus.save() 本来就双写（globalThis + SP），
 *   钩子必须读 SP 那份才拿得到。
 */

var EVENT_NAME = "after_compose_system_prompt";
var SP_NAME = "subagent_inbox";
var SP_KEY = "items";
/* 埋点键：钩子被调用一次就 +1。写在 SharedPreferences，工具侧能读到。
   为什么不用 globalThis：钩子与工具不在同一 JS 引擎，globalThis 不跨。
   为什么用 SP 不违反铁律：铁律禁的是「工具 API」（Tools.Files/Net/Shell 等，会回环），
   Java.getApplicationContext().getSharedPreferences 是直接 Java 调用，不经过工具层。 */
var SP_CALLS = "hook_calls";
/* 上次调用时间戳（毫秒）。
   为什么需要：只有累计次数时，calls=6 分不清是刚才调的还是三天前调的。
   排查「钩子是不是还活着」时，时间戳比累计值有用。 */
var SP_LAST_AT = "hook_last_at";
/* 因开关关闭而跳过的次数。
   为什么需要：calls 恒 0 有两种解释——宿主没调 / 开关关着，分不清。
   加上 skips 后三种情形可区分：
     calls=0, skips=0  → 宿主根本没调钩子（写法或注册有问题）
     calls>0, skips>0  → 钩子在调，但开关关着（用户主动关的）
     calls>0, skips=0  → 钩子在调，开关开着（正常） */
var SP_SKIPS = "hook_disabled_skips";
/* 开关：环境变量 SUBAGENT_HOOK_ENABLED，缺省为开。
   设为 0 / false / off 时钩子直接 return（undefined），系统提示词原样保留。
   为什么需要开关：能力提示每轮都注入，用户不需要子代理时（闲聊、做别的项目）
   这 5 行是纯浪费，还会诱导主代理去派活。上游 moodlet 也是双开关设计。 */
var ENV_ENABLED = "SUBAGENT_HOOK_ENABLED";

/* 注入上限：钩子每轮都跑，正文全带会把上下文撑爆。
   只给 id + 标题 + 摘要，正文由 subagent_result(id=...) 现取。 */
var MAX_ITEMS = 5;
var MAX_TEXT = 120;

/* 能力提示：只在没有未读结论时注入。
   【第七十八轮】按「大类 + 参数」重构后的口径重写。
   旧版有四个坑，都在这次修掉：
   1) 教的是 subagent_advance / subagent_wait / subagent_result / subagent_trace 四个工具，
      它们已合并成 run / get 两类 —— 旧名会让模型调到不存在的工具
   2) 写 allowed_tools=\\"read_file,edit_file\\"，现在参数名是 tools
   3) 说「没有 create_file」，已过时：宿主侧 create_file 早就可授权
   4) 「sync=true 只等 60 秒」——sync 已改名 wait，且语义改成「不填 budget 就等到完成」
   中英两份：官方 payload 有 useEnglish 字段，英文界面下塞中文会诱导模型混语言。 */
var CAPABILITY_HINT_ZH = [
  "[子代理能力] 可以把一整件独立的事派给子代理：它自己发模型请求、自己执行工具，回来只交结论。",
  "适合：多文件改造、大范围调研、需要反复试错的任务。",
  "派活：subagent_spawn(task=\"...\", tools=\"read_file,edit_file,create_file\", workspace=\"/sdcard/x/...\")",
  "【参数纪律】task 只写任务本身。tools 和 workspace 是独立参数，不要塞进 task 字符串——塞进去会把 JSON 撑坏，调用直接失败。",
  "【工具授权】tools 留空 = 一个工具都用不了；传 \"*\" 放开全部（派子代理仍被硬拦）。",
  "【长规格】要交代的细节多（规格、验收标准、代码片段），写进一个文件，用 files=\"/sdcard/x/tmp/spec.md\" 传，不要硬塞 task。",
  "【等结果两种姿势】spawn 时 wait=true 就当场跑完并返回结论，不传 budget 会一直等到结束；不等就用返回的 id 调 subagent_run(id=..., wait=true)。",
  "取产出：subagent_get(id=..., detail=brief|standard|full|trace)。detail=trace 才拿逐步明细。",
  "改状态：subagent_ctrl(id=..., action=cancel|resume|steer|close)。追加指令用 action=steer + message。",
  "未读：subagent_box()；删任务：subagent_del(id=..., confirm=true)。"
].join(String.fromCharCode(10));
var CAPABILITY_HINT_EN = [
  "[Subagent capability] You can delegate a whole self-contained job to a subagent: it issues its own model requests, runs its own tools, and returns only the conclusion.",
  "Good for: multi-file refactors, broad research, tasks that need repeated trial and error.",
  "Delegate: subagent_spawn(task=\"...\", tools=\"read_file,edit_file,create_file\", workspace=\"/sdcard/x/...\")",
  "[Parameter discipline] task holds the job only. tools and workspace are separate parameters; stuffing them into the task string breaks the JSON and the call fails.",
  "[Tool grants] Empty tools means no tools at all; pass \"*\" to allow everything (spawning subagents stays blocked).",
  "[Long specs] Put detailed specs/acceptance criteria/code snippets in a file and pass files=\"/sdcard/x/tmp/spec.md\" instead of cramming them into task.",
  "[Two ways to wait] spawn with wait=true runs it to completion and returns the conclusion; omit budget to wait until it finishes. Otherwise use the returned id with subagent_run(id=..., wait=true).",
  "Get output: subagent_get(id=..., detail=brief|standard|full|trace). Only detail=trace yields step-by-step detail.",
  "Change state: subagent_ctrl(id=..., action=cancel|resume|steer|close). Append instructions with action=steer plus message.",
  "Unread: subagent_box(); delete: subagent_del(id=..., confirm=true)."
].join(String.fromCharCode(10));

/* 语言选择：只有 payload.useEnglish === true 才用英文。
   为什么默认中文：useEnglish 缺失时必须退回中文，不能默认英文——
   中文用户占多数，默认英文会把绝大多数人的提示词搞坏。 */
function pickHint(payload) {
  return (payload && payload.useEnglish === true) ? CAPABILITY_HINT_EN : CAPABILITY_HINT_ZH;
}

/* 从 SharedPreferences 读收件箱。
   这是钩子侧唯一能拿到工具侧写入数据的通道（globalThis 不跨引擎）。
   全程 try/catch：机型差异或权限问题都不能让钩子抛异常。 */
function readInbox() {
  try {
    if (typeof Java === "undefined" || !Java) return [];
    var ctx = Java.getApplicationContext();
    if (!ctx) return [];
    var p = ctx.getSharedPreferences(SP_NAME, 0);
    if (!p) return [];
    var raw = String(p.getString(SP_KEY, "[]") || "[]");
    var arr = JSON.parse(raw);
    return (arr && arr.length) ? arr : [];
  } catch (e) {
    return [];
  }
}

/* 读开关：缺省开。任何异常都当开处理，不让钩子因为读不到环境变量就失效。 */
function hookEnabled() {
  try {
    if (typeof getEnv !== "function") return true;
    var v = String(getEnv(ENV_ENABLED) || "").trim().toLowerCase();
    if (!v) return true;
    if (v === "0" || v === "false" || v === "off" || v === "no") return false;
    return true;
  } catch (e) {
    return true;
  }
}

/* 埋点：钩子被真正调用时 +1，同时记下时间戳，写进 SharedPreferences。
   这是判断「钩子到底会不会被宿主调用」的唯一可观测手段。
   计数器恒 0 = 宿主根本没调这个钩子，写法再对也是空转。
   【注意调用位置】必须在开关判断之前调用，否则「没触发」和「开关关了」无法区分。 */
function bumpCalls() {
  try {
    if (typeof Java === "undefined" || !Java) return;
    var ctx = Java.getApplicationContext();
    if (!ctx) return;
    var p = ctx.getSharedPreferences(SP_NAME, 0);
    if (!p) return;
    var n = Number(p.getInt(SP_CALLS, 0)) + 1;
    p.edit().putInt(SP_CALLS, n).putLong(SP_LAST_AT, Date.now()).apply();
  } catch (e) {}
}

/* 埋点：钩子被调用但因开关关闭而跳过时 +1。
   为什么单独记：只有 calls 时，calls 恒 0 分不清是「宿主没调」还是「开关关了」。
   有了 skips，三种情形可区分（见 SP_SKIPS 注释）。 */
function bumpSkipped() {
  try {
    if (typeof Java === "undefined" || !Java) return;
    var ctx = Java.getApplicationContext();
    if (!ctx) return;
    var p = ctx.getSharedPreferences(SP_NAME, 0);
    if (!p) return;
    var n = Number(p.getInt(SP_SKIPS, 0)) + 1;
    p.edit().putInt(SP_SKIPS, n).apply();
  } catch (e) {}
}

function clipText(s, n) {
  var t = String(s == null ? "" : s);
  if (!n || t.length <= n) return t;
  return t.slice(0, n) + "…";
}

/* 收件箱片段：条数与正文都截断，避免撑爆上下文。
   按 useEnglish 分支：英文模式下不能混中文标题与提示语。 */
function buildInboxBlock(arr, en) {
  var list = arr.slice(0, MAX_ITEMS);
  var lines;
  if (en) {
    lines = ["[Subagent inbox] " + arr.length + " unread conclusion(s) (showing first " + list.length + ", each is removed once taken):"];
  } else {
    lines = ["[子代理收件箱] 有 " + arr.length + " 条未读结论（只列前 " + list.length + " 条，取完自动出箱）："];
  }
  for (var i = 0; i < list.length; i++) {
    var it = list[i] || {};
    lines.push("- " + String(it.id || "") + " | " + clipText(it.title || it.task_title || "", 60)
      + " | " + clipText(it.text || it.conclusion || "", MAX_TEXT));
  }
  if (arr.length > list.length) {
    if (en) lines.push("(" + (arr.length - list.length) + " more; call subagent_inbox for the full list)");
    else lines.push("（还有 " + (arr.length - list.length) + " 条，调 subagent_inbox 看全量）");
  }
  lines.push(en ? "Take one: subagent_result(id=...)." : "取用：subagent_result(id=...)。");
  return lines.join(String.fromCharCode(10));
}

/* 钩子主体：严格按契约实现 */
function subagentInboxHook(event) {
  try {
    var ev = event || {};

    /* ① 只处理 after_compose_system_prompt，其它阶段一律不插手 */
    if (String(ev.eventName || "") !== EVENT_NAME) return;

    /* ② 埋点放在开关判断【之前】。
       为什么：如果先判开关再埋点，calls 恒 0 有两种解释——宿主没调 / 开关关着，
       排查时分不清到底是哪种。前置后：
         calls=0, skips=0  → 宿主根本没调钩子
         calls>0, skips>0  → 钩子在调，但开关关着
         calls>0, skips=0  → 钩子在调，开关开着（正常） */
    bumpCalls();

    /* ③ 开关关掉时 return（undefined），系统提示词原样保留 */
    if (!hookEnabled()) { bumpSkipped(); return; }

    var payload = ev.eventPayload || {};
    /* ④ 原始系统提示词：必须原样保留，我们的内容只能追加在后面 */
    var base = String(payload.systemPrompt || "");

    var en = payload.useEnglish === true;
    var arr = readInbox();
    var addon = arr.length ? buildInboxBlock(arr, en) : pickHint(payload);

    /* 空 base 时也要返回 addon（有些调用方 systemPrompt 为空），
       但不能返回空串 —— 空串等于把系统提示词清空。 */
    if (!base) return addon;
    return base + String.fromCharCode(10) + String.fromCharCode(10) + addon;
  } catch (e) {
    /* ② 出错时 return（undefined），让宿主保留原系统提示词。
       绝不能 return ""，那会把整段提示词清空。
       钩子内不能调工具写日志（会回环），只能 console.error。 */
    try { console.error("[subagent] inboxHook error: " + ((e && e.message) || e)); } catch (e2) {}
    return;
  }
}

exports.subagentInboxHook = subagentInboxHook;
exports.CAPABILITY_HINT_ZH = CAPABILITY_HINT_ZH;
exports.CAPABILITY_HINT_EN = CAPABILITY_HINT_EN;
exports.pickHint = pickHint;
exports.EVENT_NAME = EVENT_NAME;
exports.SP_NAME = SP_NAME;
exports.SP_CALLS = SP_CALLS;
exports.SP_LAST_AT = SP_LAST_AT;
exports.SP_SKIPS = SP_SKIPS;
exports.ENV_ENABLED = ENV_ENABLED;
exports.hookEnabled = hookEnabled;