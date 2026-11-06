/* sb_hook.js — 系统提示词钩子
 *
 * 【铁律】钩子内禁止调用任何工具 API（文件/网络/shell/chat），只能读内存后 return。
 *   历史事故（2026-10-27）：钩子里用 Tools.Files.write 写调试日志，write_file 本身
 *   又是一次工具调用 → 再次触发同一钩子 → 无限回环 → ANR + 进程被杀。
 *   详见记忆库「事故与铁律：生命周期钩子内禁止调用工具 API」。
 *
 * 两个职责：
 *   1) 有未读结论时，把收件箱列出来（原有行为）
 *   2) 没有未读结论时，注入一段「子代理能力提示」，让主代理知道有这个工具可用
 *      —— 之前只在有未读消息时才注入，导致主代理平时完全看不到这个能力，
 *      从来不会主动派活（用户反馈：「你根本就没有自己调用过你的东西」）。
 */

/* 能力提示：只在没有未读消息时注入，避免和收件箱列表重复占字数 */
var CAPABILITY_HINT = [
  "[子代理能力] 你可以把一整件独立的事派给子代理去做，它自己发模型请求、自己执行工具，",
  "回来只交结论。适合：多文件改造、大范围调研、需要反复试错的任务。",
  "派活：subagent_spawn(task=\"...\", allowed_tools=\"read_file,edit_file\", workspace=\"/sdcard/x/...\", sync=true)",
  "取结论：subagent_result(id=...)；看进度：subagent_trace(id=...)。",
  "先看有没有已完成的：subagent_inbox()。"
].join(String.fromCharCode(10));

function subagentInboxHook(event) {
  try {
    var arr = (globalThis.__SUBAGENT_INBOX__ || []).slice();

    /* 有未读：列出来（这是最高优先级信息，排在前面） */
    if (arr.length) {
      try { globalThis.__SUBAGENT_HITS__ = (Number(globalThis.__SUBAGENT_HITS__) || 0) + 1; } catch (e1) {}
      var lines = ["[子代理收件箱] 有 " + arr.length + " 条未读结论，取完自动出箱："];
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i] || {};
        lines.push("- " + String(it.id || "") + " | " + String(it.title || "") + " | " + String(it.text || ""));
      }
      lines.push("取用：subagent_result(id=...)。");
      return lines.join(String.fromCharCode(10));
    }

    /* 没有未读：注入能力提示，让主代理知道能派活 */
    return CAPABILITY_HINT;
  } catch (e) {
    /* 钩子出错不能静默 —— 但也不能在钩子里调工具写日志（会回环），
       只能 console.error，靠 logcat 看 */
    try { console.error("[subagent] inboxHook error: " + ((e && e.message) || e)); } catch (e2) {}
    return "";
  }
}

exports.subagentInboxHook = subagentInboxHook;
exports.CAPABILITY_HINT = CAPABILITY_HINT;