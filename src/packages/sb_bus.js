/* sb_bus.js — 收件箱：内存 + SharedPreferences 双写（钩子与其他模块共享） */
var pending = [];
var hits = 0;
var SP_NAME = "subagent_inbox";
var SP_KEY = "items";
var SP_HITS = "hits";
function sp() {
    try { return Java.getApplicationContext().getSharedPreferences(SP_NAME, 0); } catch (e) { return null; }
}
function load() {
    var arr = [];
    try {
        var p = sp();
        if (p) { var raw = String(p.getString(SP_KEY, "[]") || "[]"); arr = JSON.parse(raw); }
    } catch (e) { arr = []; }
    if (!arr || !arr.length) arr = pending.slice();
    return arr;
}
function save(arr) {
    pending = arr.slice();
    try { globalThis.__SUBAGENT_INBOX__ = arr.slice(); } catch (e0) {}
    try {
        var p = sp();
        if (p) { p.edit().putString(SP_KEY, JSON.stringify(arr)).apply(); }
    } catch (e) {}
}
function add(rec) {
    try {
        if (!rec || !rec.id) return;
        var arr = load();
        var out = [];
        for (var i = 0; i < arr.length; i++) { if (arr[i].id !== rec.id) out.push(arr[i]); }
        /* 邮件化全字段（2026-11-05 第七轮）：前端 renderInbox/openMail 读这些字段渲染邮件列表。
           旧版只存 {id,title,text} 且 text 截 160 字，导致列表时间/标题空、正文打不开——
           字段断裂的根因。正文上限 20000 防 SP 膨胀，条数上限 40（原 20）。 */
        var body = String(rec.text || rec.conclusion || "");
        out.push({
            id: String(rec.id),
            title: String(rec.title || ""),
            task_id: String(rec.task_id || rec.id),
            task_title: String(rec.task_title || rec.title || ""),
            text: body.slice(0, 20000),
            conclusion: body.slice(0, 20000),
            finished_at: String(rec.finished_at || rec.created_at || Date.now()),
            created_at: String(rec.created_at || rec.finished_at || Date.now()),
            unread: true
        });
        if (out.length > 40) out = out.slice(out.length - 40);
        save(out);
    } catch (e) {}
}
function list() { return load(); }
function remove(id) {
    var arr = load();
    var out = [];
    for (var i = 0; i < arr.length; i++) { if (arr[i].id !== String(id)) out.push(arr[i]); }
    save(out);
}
function clear() { save([]); }
function bump() {
    hits = hits + 1;
    try { globalThis.__SUBAGENT_HITS__ = hits; } catch (e1) {}
    try {
        var p = sp();
        if (p) { var h = Number(p.getInt(SP_HITS, 0)) + 1; p.edit().putInt(SP_HITS, h).apply(); hits = h; }
    } catch (e) {}
    return hits;
}
function stat() {
    var h = hits;
    try { var p = sp(); if (p) h = Number(p.getInt(SP_HITS, 0)); } catch (e) {}
    return { hits: h, count: load().length };
}
module.exports = { add: add, list: list, remove: remove, clear: clear, bump: bump, stat: stat };
