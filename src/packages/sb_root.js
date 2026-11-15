/*
 * sb_root.js — ROOT 临时授权窗口
 *
 * 用途：给指定对话开一个限时的 ROOT 窗口。窗口期内该对话拥有全部权限位（63），
 *       可越权读写、跨群组可见、跳过写边界。窗口到期自动失效，无需手动收回。
 *
 * 为什么用「窗口」而不是永久赋权：
 *       ROOT 能读能调一切东西，一旦泄漏影响面是全量的。给个明确到期时间，
 *       最坏情况也会自己结束，不靠人记得去关。
 *
 * 识别码格式：16 位十六进制 = hash16(年月日时分秒毫秒 + salt)。
 *       不可推导、不可枚举；写进对话和日志也能当凭证用。
 */
"use strict";
var CFG = require("./sb_config.js");
var GRP = require("./sb_group.js");

var FILE = "root_windows.json";

function pathOf() {
    return CFG.baseDir() + "/" + FILE;
}

/* 读全部窗口记录。文件不存在或损坏都返回空表，不抛错。 */
async function loadAll() {
    try {
        /* Tools.Files.read 可能返回字符串，也可能返回 {content|text} 对象。
           不做归一化就会出现「明明写进去了却读成空表」且不报错的情况。 */
        var raw = await Tools.Files.read(pathOf(), "android");
        var t = "";
        if (typeof raw === "string") t = raw;
        else if (raw && typeof raw === "object") t = String(raw.content != null ? raw.content : (raw.text != null ? raw.text : ""));
        if (!t) return { windows: [] };
        var o = JSON.parse(t);
        if (!o || !o.windows || !o.windows.length) return { windows: [] };
        return o;
    } catch (e) {
        return { windows: [] };
    }
}

async function saveAll(o) {
    var p = pathOf();
    var dir = String(p).replace(/\/[^\/]*$/, "");
    if (dir) { try { await Tools.Files.mkdir(dir, true, "android"); } catch (e) {} }
    await Tools.Files.write(p, JSON.stringify(o || { windows: [] }, null, 2), false, "android");
}

function nowMs() { return Date.now(); }

/* 清掉已过期的窗口，返回剩下有效的。读的时候顺手清，不需要定时任务。 */
function prune(o) {
    var t = nowMs();
    var keep = [];
    var w = (o && o.windows) || [];
    for (var i = 0; i < w.length; i++) {
        if (Number(w[i].expires_at || 0) > t) keep.push(w[i]);
    }
    o.windows = keep;
    return o;
}

/* 开一个窗口。
   入参：chatId 目标对话、minutes 有效分钟数、reason 用途说明（可选）
   出参：{ ok, code, expires_at, minutes } 或 { ok:false, error } */
async function openWindow(chatId, minutes, reason) {
    var cid = String(chatId || "").trim();
    if (!cid) return { ok: false, error: "缺 chat_id" };
    var m = Number(minutes || 0);
    if (!(m > 0)) return { ok: false, error: "minutes 必须是正数" };
    if (m > 1440) return { ok: false, error: "单次窗口最长 1440 分钟（24 小时）" };

    var o = prune(await loadAll());
    /* 同一对话只保留最新一个窗口，避免叠加后到期时间混乱 */
    var kept = [];
    for (var i = 0; i < o.windows.length; i++) {
        if (String(o.windows[i].chat_id || "") !== cid) kept.push(o.windows[i]);
    }
    var code = GRP.rootCodeNow(cid);
    var exp = nowMs() + Math.round(m * 60000);
    kept.push({
        code: code,
        chat_id: cid,
        opened_at: nowMs(),
        expires_at: exp,
        minutes: m,
        reason: String(reason || "")
    });
    o.windows = kept;
    await saveAll(o);
    return { ok: true, code: code, expires_at: exp, minutes: m, chat_id: cid };
}

/* 查某个对话当前有没有有效窗口。有就返回记录，没有返回 null。 */
async function findFor(chatId) {
    var cid = String(chatId || "").trim();
    if (!cid) return null;
    var o = prune(await loadAll());
    for (var i = 0; i < o.windows.length; i++) {
        if (String(o.windows[i].chat_id || "") === cid) return o.windows[i];
    }
    return null;
}

/* 凭识别码查窗口。UI 可以用它验证一个码是不是有效的 ROOT 凭证。 */
async function findByCode(code) {
    var c = String(code || "").trim();
    if (!c) return null;
    var o = prune(await loadAll());
    for (var i = 0; i < o.windows.length; i++) {
        if (String(o.windows[i].code || "") === c) return o.windows[i];
    }
    return null;
}

/* 主动收回某个对话的窗口（提前关闭用） */
async function closeWindow(chatId) {
    var cid = String(chatId || "").trim();
    var o = prune(await loadAll());
    var kept = [];
    var hit = 0;
    for (var i = 0; i < o.windows.length; i++) {
        if (String(o.windows[i].chat_id || "") === cid) { hit++; continue; }
        kept.push(o.windows[i]);
    }
    o.windows = kept;
    await saveAll(o);
    return { ok: true, closed: hit };
}

/* 列当前所有有效窗口 */
async function listWindows() {
    var o = prune(await loadAll());
    await saveAll(o);
    return o.windows;
}

module.exports = {
    openWindow: openWindow,
    findFor: findFor,
    findByCode: findByCode,
    closeWindow: closeWindow,
    listWindows: listWindows
};
