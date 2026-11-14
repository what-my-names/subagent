/* sb_group.js — 群组与权限（第八十三轮）
 *
 * 【为什么需要】一个项目常有多个子代理分工（一个写代码、一个写文案、一个发布）。
 * 它们需要互相看得见，但别的项目的 agent 不该看见。
 * 群组码就是这把钥匙：谁拿到码，谁能看这一组。
 *
 * 【命名规则】
 *   群组码（对外凭证）  6 位数字，如 "834721"
 *   = fnv1a(创始人chatId + 任务内容 + 创建时间) % 1000000
 *   群组目录名          6 位十六进制，如 "a3f9c1"
 *   = hash6("g" + 群组码 + 群组创建时间)
 * 目录名也哈希：明文码只存在于 group.json 内部，不挂在路径上。
 * 挡的是「顺着路径直接读出码」这条捷径；有文件读权限仍能翻到，这是插件权限模型的固有边界。
 *
 * 【权限位】仿 Linux，另加剔除
 *   1 READ    看列表与结论
 *   2 WRITE   推进、steer
 *   4 CREATE  在该群组建子代理
 *   8 DELETE  删任务
 *  16 KICK    剔除成员、改他人权限、解禁
 * 预设：创始人 31 / 受邀 3 / 路人（凭码首次访问）1
 *
 * 【剔除】用黑名单而不是删成员
 * 只拿到码的人不进成员表，无从"删除"。所以判定顺序是：
 *   kicked 命中 → 拒绝（再输码也进不来）
 *   在 members → 按 mask
 *   都没有 → 登记为路人，mask=1
 */
"use strict";
var CFG = require("./sb_config.js");

/* ── 哈希 ─────────────────────────────────────────────── */

/* FNV-1a 32 位。纯 JS，不引依赖。
   为什么用它：够散、够快、十行写完，对「防止路径上出现明文码」这个目的足够。 */
function fnv1a(str) {
    var h = 0x811c9dc5;
    var s = String(str == null ? "" : str);
    for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        /* 乘 16777619，用移位拆开避免 JS 30 位溢出丢精度 */
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h >>> 0;
}

/* 6 位十六进制：群组目录名、任务 id 的两段都用它 */
function hash6(str) {
    var h = fnv1a(str);
    var s = h.toString(16);
    while (s.length < 6) s = "0" + s;
    return s.slice(-6);
}

/* 6 位十进制：群组码，给人看的凭证 */
function code6(str) {
    var n = fnv1a(str) % 1000000;
    var s = String(n);
    while (s.length < 6) s = "0" + s;
    return s;
}

/* 子代理码：纯随机 6 位数字。只作为哈希输入，不直接当 ID 用。 */
function rand6() {
    return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

/* ── 权限位 ────────────────────────────────────────────── */
var PERM = {
    READ: 1,
    WRITE: 2,
    CREATE: 4,
    DELETE: 8,
    KICK: 16,
    FOUNDER: 31,
    MEMBER: 3,
    GUEST: 1
};
function hasPerm(mask, bit) { return (Number(mask || 0) & Number(bit || 0)) === Number(bit || 0); }

/* ── 路径 ─────────────────────────────────────────────── */
function groupsDir() { return CFG.baseDir() + "/groups"; }
/* 目录名用哈希，不用明文码 */
function groupDirOf(code, createdAt) {
    return groupsDir() + "/" + hash6("g" + String(code) + String(createdAt || 0));
}
function groupJsonPath(code, createdAt) { return groupDirOf(code, createdAt) + "/group.json"; }
function groupIndexPath(code, createdAt) { return groupDirOf(code, createdAt) + "/index.json"; }

/* ── 文件读写 ─────────────────────────────────────────── */
async function readText(path) {
    try {
        var r = await Tools.Files.read(path, "android");
        if (typeof r === "string") return r;
        if (r && typeof r === "object") return String(r.content != null ? r.content : (r.text != null ? r.text : ""));
    } catch (e) {}
    return "";
}
async function writeJson(path, obj) {
    var text = JSON.stringify(obj, null, 2);
    await Tools.Files.write(path, text, false, "android");
    var back = await readText(path);
    if (String(back || "").length !== text.length) throw new Error("写回校验失败：" + path);
    return true;
}
async function mkdirs(p) { try { await Tools.Files.mkdir(p, true, "android"); } catch (e) {} }

/* ── 群组码生成 ───────────────────────────────────────── */
/* 撞号检查：算出来的码若已存在同名 group.json（按不同 createdAt 可能是不同目录），
   就时间戳 +1 重算，最多 10 次。6 位数字一百万种，单设备撞号概率极低，
   但撞了会串组，必须查。
   查法是扫 groups/ 下所有目录读 group.json 的 code —— 群组数量远小于任务数量，可接受。 */
async function genCode(founderChatId, taskText, createdAt, existsFn) {
    var base = String(createdAt || Date.now());
    for (var i = 0; i < 10; i++) {
        var c = code6(String(founderChatId || "") + String(taskText || "") + String(base) + (i ? String(i) : ""));
        var hit = false;
        try { hit = existsFn ? await existsFn(c) : false; } catch (e) { hit = false; }
        if (!hit) return c;
    }
    /* 10 次都撞：退回随机码，避免整个 spawn 失败 */
    return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

/* 群组码是否已被占用：扫 groups/ 目录，读每个 group.json 的 code 比对 */
async function codeExists(code) {
    var want = String(code || "");
    if (!want) return false;
    try {
        var r = await Tools.Files.list(groupsDir(), "android");
        var arr = (r && r.entries) ? r.entries : [];
        for (var i = 0; i < arr.length; i++) {
            var name = String(arr[i].name || "");
            if (!name) continue;
            var raw = await readText(groupsDir() + "/" + name + "/group.json");
            if (!raw) continue;
            var g = null;
            try { g = JSON.parse(raw); } catch (e) { continue; }
            if (g && String(g.code || "") === want) return true;
        }
    } catch (e) {}
    return false;
}

/* ── 群组读写 ─────────────────────────────────────────── */
async function createGroup(opts) {
    opts = opts || {};
    var createdAt = Number(opts.created_at || Date.now());
    var code = String(opts.code || "");
    var g = {
        code: code,
        name: String(opts.name || ""),
        /* 血缘根：沿 chats.parentChatId 爬到顶。分支对话换 uuid 但根不变，
           判定归属时用根比对，分支才能看见父对话的子代理。 */
        root_chat_id: String(opts.root_chat_id || opts.founder_chat_id || ""),
        founder: String(opts.founder_chat_id || ""),
        members: [],
        kicked: [],
        created_at: createdAt,
        readonly: false
    };
    /* 创始人全权限 */
    if (g.founder) g.members.push({ chat_id: g.founder, mask: PERM.FOUNDER });
    /* 受邀成员 */
    if (Array.isArray(opts.members)) {
        for (var i = 0; i < opts.members.length; i++) {
            var m = opts.members[i] || {};
            var cid = String(m.chat_id || "");
            if (!cid || cid === g.founder) continue;
            g.members.push({ chat_id: cid, mask: Number(m.mask || PERM.MEMBER) });
        }
    }
    await mkdirs(groupDirOf(code, createdAt));
    await writeJson(groupJsonPath(code, createdAt), g);
    await writeJson(groupIndexPath(code, createdAt), { code: code, tasks: [] });
    return g;
}

/* 读群组。createdAt 拿不到时扫目录找（凭码访问时只知道码，不知道创建时间）。 */
async function loadGroup(code, createdAt) {
    var want = String(code || "");
    if (!want) return null;
    /* 有 createdAt 直接定位 */
    if (createdAt) {
        var raw = await readText(groupJsonPath(want, createdAt));
        if (raw) { try { return JSON.parse(raw); } catch (e) {} }
    }
    /* 没有就扫 */
    try {
        var r = await Tools.Files.list(groupsDir(), "android");
        var arr = (r && r.entries) ? r.entries : [];
        for (var i = 0; i < arr.length; i++) {
            var name = String(arr[i].name || "");
            if (!name) continue;
            var t = await readText(groupsDir() + "/" + name + "/group.json");
            if (!t) continue;
            var g = null;
            try { g = JSON.parse(t); } catch (e) { continue; }
            if (g && String(g.code || "") === want) return g;
        }
    } catch (e) {}
    return null;
}

async function saveGroup(g) {
    if (!g || !g.code) return false;
    /* members 里没有任何人具备 CREATE → 群组转只读，码作废 */
    var canCreate = false;
    for (var i = 0; i < (g.members || []).length; i++) {
        if (hasPerm((g.members[i] || {}).mask, PERM.CREATE)) { canCreate = true; break; }
    }
    g.readonly = !canCreate;
    await mkdirs(groupDirOf(g.code, g.created_at));
    await writeJson(groupJsonPath(g.code, g.created_at), g);
    return true;
}

/* ── 权限判定 ─────────────────────────────────────────── */

/* 返回 { ok, mask, reason }
   ok=false 的 reason 只有两种：被剔除 / 群组只读且无 CREATE。
   注意：只读群组仍可读，ok 仍是 true，mask 照给。 */
function resolveMember(g, chatId) {
    var cid = String(chatId || "");
    if (!g) return { ok: false, mask: 0, reason: "群组不存在" };
    /* 黑名单优先：剔除的人再输码也进不来 */
    var kicked = g.kicked || [];
    for (var i = 0; i < kicked.length; i++) {
        if (String(kicked[i] || "") === cid) return { ok: false, mask: 0, reason: "已被移出该群组" };
    }
    var ms = g.members || [];
    for (var j = 0; j < ms.length; j++) {
        var m = ms[j] || {};
        if (String(m.chat_id || "") === cid) return { ok: true, mask: Number(m.mask || 0), reason: "" };
    }
    /* 都不是 → 路人，凭码访问时由调用方决定要不要登记 */
    return { ok: true, mask: PERM.GUEST, reason: "", guest: true };
}

/* 登记路人 / 追加成员。mask 取并集，不会降权。 */
async function admit(g, chatId, mask) {
    var cid = String(chatId || "");
    if (!g || !cid) return g;
    var ms = g.members || [];
    for (var i = 0; i < ms.length; i++) {
        if (String((ms[i] || {}).chat_id || "") === cid) {
            ms[i].mask = Number(ms[i].mask || 0) | Number(mask || PERM.GUEST);
            g.members = ms;
            await saveGroup(g);
            return g;
        }
    }
    g.members = ms.concat([{ chat_id: cid, mask: Number(mask || PERM.GUEST) }]);
    await saveGroup(g);
    return g;
}

/* 剔除：写黑名单 + 从成员表移除 */
async function kick(g, chatId) {
    var cid = String(chatId || "");
    if (!g || !cid) return g;
    if (cid === String(g.founder || "")) return g;   // 创始人不可被踢
    var ms = [];
    var arr = g.members || [];
    for (var i = 0; i < arr.length; i++) {
        if (String((arr[i] || {}).chat_id || "") !== cid) ms.push(arr[i]);
    }
    g.members = ms;
    var kk = g.kicked || [];
    var found = false;
    for (var j = 0; j < kk.length; j++) { if (String(kk[j] || "") === cid) found = true; }
    if (!found) kk.push(cid);
    g.kicked = kk;
    await saveGroup(g);
    return g;
}

/* 解禁：从黑名单移除。重新访问时按路人处理，权限需创始人再授。 */
async function unkick(g, chatId) {
    var cid = String(chatId || "");
    if (!g || !cid) return g;
    var kk = [];
    var arr = g.kicked || [];
    for (var i = 0; i < arr.length; i++) {
        if (String(arr[i] || "") !== cid) kk.push(arr[i]);
    }
    g.kicked = kk;
    await saveGroup(g);
    return g;
}

/* 改某人权限。只有 KICK 位的人能调（调用方自行校验）。 */
async function setPerm(g, chatId, mask) {
    var cid = String(chatId || "");
    if (!g || !cid) return g;
    var ms = g.members || [];
    var hit = false;
    for (var i = 0; i < ms.length; i++) {
        if (String((ms[i] || {}).chat_id || "") === cid) { ms[i].mask = Number(mask || 0); hit = true; }
    }
    if (!hit) ms.push({ chat_id: cid, mask: Number(mask || 0) });
    g.members = ms;
    await saveGroup(g);
    return g;
}

/* 列出某个 chatId 有权访问的群组。
   - 是 founder 或 root_chat_id 相同的对话（含分支）→ 可见
   - 在 members 里 → 可见
   - 其余不可见（凭码访问是显式传码，不走这里） */
async function listGroupsFor(chatId, rootChatId) {
    var out = [];
    var cid = String(chatId || "");
    var rid = String(rootChatId || cid);
    try {
        var r = await Tools.Files.list(groupsDir(), "android");
        var arr = (r && r.entries) ? r.entries : [];
        for (var i = 0; i < arr.length; i++) {
            var name = String(arr[i].name || "");
            if (!name) continue;
            var raw = await readText(groupsDir() + "/" + name + "/group.json");
            if (!raw) continue;
            var g = null;
            try { g = JSON.parse(raw); } catch (e) { continue; }
            if (!g) continue;
            var rootOk = rid && String(g.root_chat_id || "") === rid;
            var mem = resolveMember(g, cid);
            var inMembers = false;
            var ms = g.members || [];
            for (var j = 0; j < ms.length; j++) {
                if (String((ms[j] || {}).chat_id || "") === cid) { inMembers = true; break; }
            }
            if (rootOk || inMembers) {
                out.push({
                    code: String(g.code || ""),
                    name: String(g.name || ""),
                    founder: String(g.founder || ""),
                    readonly: !!g.readonly,
                    created_at: Number(g.created_at || 0),
                    mask: mem.ok ? mem.mask : 0
                });
            }
        }
    } catch (e) {}
    out.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
    return out;
}

module.exports = {
    fnv1a: fnv1a,
    hash6: hash6,
    code6: code6,
    rand6: rand6,
    PERM: PERM,
    hasPerm: hasPerm,
    groupsDir: groupsDir,
    groupDirOf: groupDirOf,
    groupJsonPath: groupJsonPath,
    groupIndexPath: groupIndexPath,
    genCode: genCode,
    codeExists: codeExists,
    createGroup: createGroup,
    loadGroup: loadGroup,
    saveGroup: saveGroup,
    resolveMember: resolveMember,
    admit: admit,
    kick: kick,
    unkick: unkick,
    setPerm: setPerm,
    listGroupsFor: listGroupsFor
};
