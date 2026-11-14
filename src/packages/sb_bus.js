/* sb_bus.js — 收件箱：内存 + SharedPreferences 双写（钩子与其他模块共享）
 *
 * 【为什么必须双写】工具侧与钩子侧不是同一个 JS 引擎实例（ToolPkg 工具函数一旦 return，
 * 宿主立刻弃用这个引擎），globalThis 不跨。所以 SharedPreferences 才是真正能跨的通道，
 * globalThis 只是同引擎内的快路径。sb_hook.js 直接读 SP。
 *
 * 【已删除 hits / bump】钩子与工具不在同一引擎，钩子侧自增的计数工具侧天然读不到，
 * SP 里的 hits 又因为 bump 零调用恒为 0。与其报一个恒 0 的假指标，不如不报。
 */
var pending = [];
var SP_NAME = "subagent_inbox";
var SP_KEY = "items";
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
    /* globalThis 只是同一引擎内的快路径（工具侧自己读）。
       钩子侧不读这个 —— 它与工具不在同一 JS 引擎，globalThis 不跨，
       必须走下面的 SharedPreferences。 */
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
            字段断裂的根因。正文上限 20000 防 SP 膨胀，条数上限 40（原 20）。
            【2026-11-07】不再同时存 text 与 conclusion：两者内容完全相同，
            40 条 × 20000 × 2 = 160 万字符白占 SP。统一存 text，读侧兼容 conclusion。 */
        var body = String(rec.text || rec.conclusion || "").slice(0, 20000);
        out.push({
            id: String(rec.id),
            title: String(rec.title || ""),
            task_id: String(rec.task_id || rec.id),
            task_title: String(rec.task_title || rec.title || ""),
            text: body,
            finished_at: String(rec.finished_at || rec.created_at || Date.now()),
            created_at: String(rec.created_at || rec.finished_at || Date.now()),
            /* 【第八十二轮】邮件归属：这条结论属于哪个对话派的任务。
               空串 = 无归属（老数据）。父级对话只读自己的，面板读全部。 */
            chat_id: String(rec.chat_id || ""),
            unread: true
        });
        if (out.length > 40) out = out.slice(out.length - 40);
        save(out);
    } catch (e) {}
}
/* 【第八十二轮】chatId 非空时只返回该对话的邮件。不传 = 全部（面板用）。
   无归属的老邮件不返回——它们不知道属于哪个对话，给了会串到别的对话里。 */
function list(chatId) {
    var arr = load();
    var fid = String(chatId || "");
    if (!fid) return arr;
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        if (String((arr[i] && arr[i].chat_id) || "") === fid) out.push(arr[i]);
    }
    return out;
}
function listAll() { return load(); }
function remove(id) {
    var arr = load();
    var out = [];
    for (var i = 0; i < arr.length; i++) { if (arr[i].id !== String(id)) out.push(arr[i]); }
    save(out);
}
function clear() { var n = load().length; save([]); return n; }
/* stat 只报真实可观测的条数。
   原来的 hits 是假指标：钩子侧自增的 globalThis 工具侧读不到，SP 里的 hits 又因为
   bump() 零调用恒为 0，等于永远报「命中 0 次」，连「真的是 0」都无法判断。 */
function stat() {
    return { count: load().length };
}
module.exports = { add: add, list: list, listAll: listAll, remove: remove, clear: clear, stat: stat };
