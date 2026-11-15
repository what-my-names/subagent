/*
 * sb_tool_root.js — ROOT 权限窗口工具
 *
 * 用途：给指定对话开一个限时的 ROOT 窗口。窗口期内该对话拥有全部权限位（63），
 *       可越权读写一切、跨群组可见、跳过写边界，用于需要全量能力的排障与验证。
 *
 * 为什么单独成工具而不是塞进 subagent_group：
 *       ROOT 不是群组内的角色，它是全局开关。混进 group 会让人误以为要先有群组。
 *
 * 安全约束：
 *       必须有明确的 minutes，最长 1440 分钟（24 小时），不做永久授权。
 *       识别码 16 位十六进制，由开窗时刻的时间戳哈希得出，不可推导。
 */
"use strict";
var ROOT = require("./sb_root.js");

module.exports = function install(E, opts) {
    var complete = opts && opts.complete;
    var callerChatId = opts && opts.callerChatId;

    E.subagent_root = async function (params) {
        params = params || {};
        var action = String(params.action || "list");
        if (typeof complete !== "function") return;

        /* open：开窗口。minutes 默认 30，最长 1440 */
        if (action === "open") {
            var cid = String(params.chat_id || "").trim();
            if (!cid && typeof callerChatId === "function") cid = String(callerChatId() || "");
            if (!cid) { complete({ success: false, message: "缺 chat_id，无法确定给哪个对话开窗", data: {} }); return; }
            var minutes = Number(params.minutes || 30);
            var r = await ROOT.openWindow(cid, minutes, params.reason);
            if (!r.ok) { complete({ success: false, message: r.error, data: {} }); return; }
            var expTxt = new Date(r.expires_at).toLocaleString();
            complete({
                success: true,
                message: "已为对话 " + cid + " 开启 ROOT 窗口，有效 " + r.minutes + " 分钟（至 " + expTxt + "）。" + "\n"
                    + "ROOT 识别码：" + r.code + "\n"
                    + "这个码可以验证身份、写进日志上报。到期自动失效，也可用 action=close 提前关闭。",
                data: r
            });
            return;
        }

        /* close：提前收回 */
        if (action === "close") {
            var cid2 = String(params.chat_id || "").trim();
            if (!cid2 && typeof callerChatId === "function") cid2 = String(callerChatId() || "");
            if (!cid2) { complete({ success: false, message: "缺 chat_id", data: {} }); return; }
            var cr = await ROOT.closeWindow(cid2);
            complete({ success: true, message: cr.closed ? ("已收回 " + cid2 + " 的 ROOT 窗口") : (cid2 + " 当前没有 ROOT 窗口"), data: cr });
            return;
        }

        /* check：查某个对话或某个码 */
        if (action === "check") {
            var c3 = String(params.chat_id || "").trim();
            if (!c3 && typeof callerChatId === "function") c3 = String(callerChatId() || "");
            var w = null;
            if (params.code) w = await ROOT.findByCode(params.code);
            else if (c3) w = await ROOT.findFor(c3);
            if (!w) { complete({ success: true, message: "没有有效的 ROOT 窗口", data: { active: false } }); return; }
            var left = Math.max(0, Math.round((Number(w.expires_at) - Date.now()) / 60000));
            complete({
                success: true,
                message: "ROOT 窗口有效，还剩约 " + left + " 分钟（识别码 " + w.code + "）",
                data: { active: true, window: w, minutes_left: left }
            });
            return;
        }

        /* list：列所有有效窗口 */
        if (action === "list") {
            var ws = await ROOT.listWindows();
            var rows = [];
            for (var i = 0; i < ws.length; i++) {
                var x = ws[i];
                var mLeft = Math.max(0, Math.round((Number(x.expires_at) - Date.now()) / 60000));
                rows.push({ code: x.code, chat_id: x.chat_id, minutes_left: mLeft, expires_at: x.expires_at, reason: x.reason || "" });
            }
            complete({ success: true, message: "当前 " + rows.length + " 个 ROOT 窗口", data: { windows: rows, total: rows.length } });
            return;
        }

        complete({ success: false, message: "未知 action：" + action + "（可用 open/close/check/list）", data: {} });
    };
};
