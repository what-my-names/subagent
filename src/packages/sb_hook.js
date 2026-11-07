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
   注意不要教 sync=true —— 桥有 20 秒硬超时，sync 会等几十秒导致界面假死。
   正确路径是「建任务 → advance 推进 / wait 等结果」。 */
var CAPABILITY_HINT = [
  "[子代理能力] 可以把一整件独立的事派给子代理：它自己发模型请求、自己执行工具，回来只交结论。",
  "适合：多文件改造、大范围调研、需要反复试错的任务。",
  "派活：subagent_spawn(task=\"...\", allowed_tools=\"read_file,edit_file\", workspace=\"/sdcard/x/...\")",
  "推进：subagent_advance(id=...)；等结果：subagent_wait(id=...)。不要用 sync=true（桥 20 秒会超时）。",
  "取结论：subagent_result(id=...)；看进度：subagent_trace(id=...)。"
].join(String.fromCharCode(10));

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

/* 埋点：钩子被真正调用（且通过开关）时 +1，写进 SharedPreferences。
   这是判断「钩子到底会不会被宿主调用」的唯一可观测手段。
   计数器恒 0 = 宿主根本没调这个钩子，写法再对也是空转。 */
function bumpCalls() {
  try {
    if (typeof Java === "undefined" || !Java) return;
    var ctx = Java.getApplicationContext();
    if (!ctx) return;
    var p = ctx.getSharedPreferences(SP_NAME, 0);
    if (!p) return;
    var n = Number(p.getInt(SP_CALLS, 0)) + 1;
    p.edit().putInt(SP_CALLS, n).apply();
  } catch (e) {}
}

function clipText(s, n) {
  var t = String(s == null ? "" : s);
  if (!n || t.length <= n) return t;
  return t.slice(0, n) + "…";
}

/* 收件箱片段：条数与正文都截断，避免撑爆上下文 */
function buildInboxBlock(arr) {
  var list = arr.slice(0, MAX_ITEMS);
  var lines = ["[子代理收件箱] 有 " + arr.length + " 条未读结论（只列前 " + list.length + " 条，取完自动出箱）："];
  for (var i = 0; i < list.length; i++) {
    var it = list[i] || {};
    lines.push("- " + String(it.id || "") + " | " + clipText(it.title || it.task_title || "", 60)
      + " | " + clipText(it.text || it.conclusion || "", MAX_TEXT));
  }
  if (arr.length > list.length) lines.push("（还有 " + (arr.length - list.length) + " 条，调 subagent_inbox 看全量）");
  lines.push("取用：subagent_result(id=...)。");
  return lines.join(String.fromCharCode(10));
}

/* 钩子主体：严格按契约实现 */
function subagentInboxHook(event) {
  try {
    var ev = event || {};

    /* ① 只处理 after_compose_system_prompt，其它阶段一律不插手 */
    if (String(ev.eventName || "") !== EVENT_NAME) return;

    /* ② 开关关掉时 return（undefined），系统提示词原样保留。
       注意：这一步在埋点之前 —— 关掉是用户主动行为，不该算进「钩子被调用」。
       但这样也意味着「开关关着 + 计数器 0」无法区分「没触发」和「关掉了」，
       所以计数放在开关判断之后、事件名判断之后：
       事件名对 = 宿主确实调了这个钩子；开关关 = 我们主动不注入。 */
    if (!hookEnabled()) return;

    /* 埋点：走到这里说明宿主确实调用了这个钩子，且开关是开的 */
    bumpCalls();

    var payload = ev.eventPayload || {};
    /* ③ 原始系统提示词：必须原样保留，我们的内容只能追加在后面 */
    var base = String(payload.systemPrompt || "");

    var arr = readInbox();
    var addon = arr.length ? buildInboxBlock(arr) : CAPABILITY_HINT;

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
exports.CAPABILITY_HINT = CAPABILITY_HINT;
exports.EVENT_NAME = EVENT_NAME;
exports.SP_NAME = SP_NAME;
exports.SP_CALLS = SP_CALLS;
exports.ENV_ENABLED = ENV_ENABLED;
exports.hookEnabled = hookEnabled;