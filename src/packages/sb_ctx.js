/*
 * 共享上下文与可见性（从 subagent.js 拆出）
 *
 * 用途：读对话上下文、算祖先链、按归属过滤可见任务、生成任务摘要 briefOf、
 *       收件箱后缀与时间戳格式化。
 * 为什么单独成文件：这些函数被 spawn/run/get/list/stream 多段共用，
 *       留在主文件里任何一处改动都要往上翻两千行；抽出来只有一处真相。
 * 依赖：sb_config / sb_task / sb_group / sb_bus，无环。
 * 出参：module.exports 暴露全部函数，主文件按名解构使用。
 */
var CFG = require("./sb_config.js");
var TASK = require("./sb_task.js");
var GRP = require("./sb_group.js");
var BUS = require("./sb_bus.js");

async function loadCtx(cfg, task) {
    var undo = await TASK.loadUndo(task.id);
    var seq = Number(undo.seq || 0);
    return {
        allowed: task.allowed_tools || [],
        workspace: task.workspace_resolved || "",
        productDir: task.product_dir,
        maxChars: Number(cfg.tool_result_max_chars || 0),
        allowDanger: (task && task.allow_danger === true) || cfg.allow_danger === true,
        tool_timeout_ms: Number((task && task.tool_timeout_ms) || cfg.tool_timeout_ms || 0),
        roots: [task.workspace_resolved || "", task.product_dir || ""].filter(Boolean),
        nextSeq: function () { seq = seq + 1; return seq; },
        loadUndo: function () { return undo.items || []; },
        appendUndo: function (recs) { undo.items = (undo.items || []).concat(recs || []); undo.seq = seq; },
        clearUndo: function () { undo.items = []; undo.seq = seq; },
        save: async function () { await TASK.saveUndo(task.id, undo); }
    };
}

async function notifyDone(task) {
    try {
        if (!task) return;
        if (task.status !== "done" && task.status !== "failed") return;
        /* 【第七十七轮】两个不该入箱的情况，按用户定义「用户建立以及查看的不算」：
           1) origin=ui —— 用户自己在面板建的任务，结论就在面板里，不用额外提醒
           2) failed —— 失败不是「产出了结论」，进箱只是噪音（例如端点连不上）
           注意：这两个条件只挡收件箱，系统通知照旧，别把故障信息也吞了。 */
        var origin = String(task.origin || "");
        var skipInbox = (origin === "ui") || (task.status === "failed");
        var cfg = await CFG.load();
        var mode = String(cfg.notice_mode || "inbox");
        var title = String(task.title || task.id);
        /* 全文入库（第七轮）：旧版截 160 字，邮件正文打不开——现在存全量，
           由 sb_bus 的 20000 上限统一兜底 */
        var text = task.result ? String(task.result) : String(task.error || "已结束");
        if (mode !== "off" && !skipInbox) {
            try { BUS.add({ id: task.id, title: title, task_id: task.id, task_title: task.title || title, text: text, finished_at: Date.now(), created_at: Date.now(), chat_id: String(task.parent_chat_id || "") }); } catch (e0) {}
        }
        if (mode === "system" && Tools && Tools.System && Tools.System.sendNotification) {
            Tools.System.sendNotification(text.slice(0, 120), "子代理：" + title);
        }
    } catch (e) {}
}

/* 【第八十二轮】取发起本次工具调用的对话 id。
   拿不到就返回空串——空串意味着“不过滤”（老宿主 / 面板无对话上下文），
   宁可多给也不能误藏。 */
/* 最近一次成功拿到的对话 id。
   面板（WebView）调用时 getToolExecutionContext() 常常返回空，
   导致群组判定落到「路人 mask=1」，创始人自己看自己的群组也显示只读。
   这里做两级兜底：内存缓存 → 宿主最近对话。 */
var _LAST_CID = "";

function callerChatId() {
    try {
        if (typeof getToolExecutionContext === "function") {
            var ec = getToolExecutionContext();
            var v = String((ec && ec.chatId) || "");
            if (v) { _LAST_CID = v; return v; }
        }
    } catch (e) {}
    return _LAST_CID;
}

/* 异步兜底版：同步拿不到时去问宿主「当前是哪个对话」。
   和上面同步版分开，是因为同步版被几十处调用，不能整体改 async。 */
async function callerChatIdAsync() {
    var v = callerChatId();
    if (v) return v;
    try {
        var r = null;
        try {
            if (Tools.Chat && typeof Tools.Chat.listAll === "function") r = await Tools.Chat.listAll();
        } catch (e0) { r = null; }
        if (!r) {
            r = await Tools.Chat.listChats({ query: "", match: "contains", sort_by: "updatedAt", sort_order: "desc", limit: 20 });
        }
        var cur = String((r && r.currentChatId) || "");
        if (!cur) {
            var arr = (r && (r.chats || r.items || r.data)) || [];
            if (arr.length) cur = String(arr[0].id || arr[0].chatId || "");
        }
        if (cur) _LAST_CID = cur;
        return cur;
    } catch (e) { return _LAST_CID; }
}
/* 【第八十二轮】决定本次列表要不要按对话过滤。
   all=true → 不过滤（用户/面板要看全部）；否则用调用方 chatId。
   返回空串 = 不过滤。 */
function filterChatOf(params) {
    if (params && params.all === true) return "";
    return callerChatId();
}

/* 【第八十三轮】取血缘根 chatId：沿宿主 chats 表的 parentChatId 一路往上爬。
 * 为什么要它：分支对话换 uuid，但「谁派的活」这件事应该跟根走。
 * 用户在父对话派的任务，分支对话也要能看见（B 策略：分支看得到父的全部，父看不到分支的）。
 *
 * 拿不到血缘信息时返回自己，退化成「只看自己」——不会因为查不到就更宽。 */
async function rootChatIdOf(chatId) {
    var cid = String(chatId || "");
    if (!cid) return "";
    try {
        var r = null;
        try {
            if (Tools.Chat && typeof Tools.Chat.listAll === "function") r = await Tools.Chat.listAll();
        } catch (e0) { r = null; }
        if (!r) {
            r = await Tools.Chat.listChats({ query: "", match: "contains", sort_by: "updatedAt", sort_order: "desc", limit: 200 });
        }
        var arr = (r && (r.chats || r.items || r.data)) || [];
        /* 建 id -> parent 映射 */
        var parentOf = {};
        for (var i = 0; i < arr.length; i++) {
            var c = arr[i] || {};
            var id = String(c.id || c.chatId || "");
            if (!id) continue;
            parentOf[id] = String(c.parentChatId || c.parent_chat_id || "");
        }
        /* 爬到顶，防环 */
        var cur = cid;
        var guard = 0;
        while (parentOf[cur] && guard < 50) {
            cur = parentOf[cur];
            guard++;
        }
        return cur || cid;
    } catch (e) { return cid; }
}

/* 【第八十三轮】收集「我这条血缘链上所有祖先的 chatId」。
 * B 策略：我能看到祖先派的任务，看不到后代（分支）派的。 */
async function ancestorChatIdsOf(chatId) {
    var cid = String(chatId || "");
    if (!cid) return [];
    var out = [cid];
    try {
        var r = null;
        try {
            if (Tools.Chat && typeof Tools.Chat.listAll === "function") r = await Tools.Chat.listAll();
        } catch (e0) { r = null; }
        if (!r) {
            r = await Tools.Chat.listChats({ query: "", match: "contains", sort_by: "updatedAt", sort_order: "desc", limit: 200 });
        }
        var arr = (r && (r.chats || r.items || r.data)) || [];
        var parentOf = {};
        for (var i = 0; i < arr.length; i++) {
            var c = arr[i] || {};
            var id = String(c.id || c.chatId || "");
            if (!id) continue;
            parentOf[id] = String(c.parentChatId || c.parent_chat_id || "");
        }
        var cur = parentOf[cid] || "";
        var guard = 0;
        while (cur && guard < 50) {
            if (out.indexOf(cur) < 0) out.push(cur);
            cur = parentOf[cur] || "";
            guard++;
        }
    } catch (e) {}
    return out;
}

/* 【第八十三轮】统一的任务可见性判定。
 * 返回过滤后的任务数组。
 *
 * 规则（用户定稿）：
 *   1) 显式传群组码 → 该群组全部任务（凭码即成员，只读）
 *   2) 否则按血缘链：自己 + 所有祖先派的任务（B 策略）
 *   3) 再并上「我有权访问的群组」里的任务
 */
async function visibleTasks(params, force) {
    var cid = callerChatId();
    var wantGroup = String((params && params.group) || "");
    /* 1) 显式凭码看某群组 */
    if (wantGroup && wantGroup !== "list") {
        var g = await GRP.loadGroup(wantGroup);
        if (!g) return { items: [], err: "群组不存在：" + wantGroup };
        var mem = GRP.resolveMember(g, cid);
        if (!mem.ok) return { items: [], err: mem.reason };
        /* 路人首次访问登记为成员（只读）。被踢的人上面已经拦掉了。 */
        if (mem.guest && cid) { try { await GRP.admit(g, cid, GRP.PERM.GUEST); } catch (eA) {} }
        var gTasks = await TASK.listTasks(force, "", wantGroup);
        return { items: gTasks, group: g, mask: mem.mask };
    }
    /* 2) 血缘链 + 3) 有权群组 */
    var chain = await ancestorChatIdsOf(cid);
    var myGroups = await GRP.listGroupsFor(cid, chain.length ? chain[chain.length - 1] : cid);
    var allowedCodes = {};
    for (var gi = 0; gi < myGroups.length; gi++) allowedCodes[String(myGroups[gi].code || "")] = 1;
    var all = await TASK.listTasks(force);
    var out = [];
    for (var i = 0; i < all.length; i++) {
        var t = all[i] || {};
        var pcid = String(t.parent_chat_id || "");
        /* 无归属的老任务：只在自己没有血缘信息时给出，避免全串 */
        if (!pcid) {
            if (!cid) out.push(t);
            continue;
        }
        /* 血缘链命中（自己或任一代祖先） */
        if (chain.indexOf(pcid) >= 0) { out.push(t); continue; }
        /* 群组命中 */
        var tg = String(t.group || "");
        if (tg && allowedCodes[tg]) { out.push(t); continue; }
    }
    return { items: out, groups: myGroups };
}
/* 【第九十八轮】收件箱提示要能直接照做。
   旧文案只说了「有几条」+ 一个早就不存在的工具名，主代理看到当噪音直接忽略。
   现在带上具体 id 与标题，并给出一条能直接复制的调用。 */
function inboxSuffix(chatId) {
    try {
        var arr = BUS.list(chatId) || [];
        var n = arr.length;
        if (!n) return "";
        var head = arr[0] || {};
        var id = String(head.id || "");
        var tt = String(head.title || head.task_title || "");
        if (tt.length > 30) tt = tt.slice(0, 30) + "…";
        var s = "｜收件箱 " + n + " 条未读";
        if (id) s += "，最新 " + id + (tt ? "《" + tt + "》" : "") + "，取：subagent_get(id=\"" + id + "\")";
        else s += "，全部取：subagent_get(ids=\"...\")";
        return s;
    } catch (e) { return ""; }
}

function tsOf(ms) {
    try {
        var d = new Date(Number(ms) || 0);
        function z(n) { return (n < 10 ? "0" : "") + n; }
        return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes());
    } catch (e) { return ""; }
}
function briefOf(task, unreadCache) {
    /* phase 是「此刻在干什么」：llm=正在调模型，tool=正在跑工具，idle=空闲。
       面板靠它显示「思考中」而不是干等一个「运行中」。
       phase_at 是进入该阶段的时刻，前端用来算已思考多少秒。 */
    return {
        id: task.id, title: task.title, status: task.status, step: task.step,
        max_steps: task.max_steps, next: TASK.nextFor(task),
        phase: String(task.phase || "idle"),
        phase_at: Number(task.phase_at || 0),
        tool_now: String(task.tool_now || ""),
        usage: task.usage || { in: 0, out: 0, est_cost: 0 },
        workspace_resolved: task.workspace_resolved || "",
        product_dir: task.product_dir || "",
        label: task.title || "",
        mode: "continuable",
        agent_status: (task.status === "running" || task.status === "queued") ? "running" : "inactive",
        inbox_unread: (typeof unreadCache === "number") ? unreadCache
            : (function () { try { return BUS.list().length; } catch (e) { return 0; } })(),
        last_text: (task.last && task.last.text) ? String(task.last.text).slice(0, 80) : "",
        result_preview: task.result ? String(task.result).slice(0, 80) : "",
        created_at: tsOf(task.created_at),
        last_at: tsOf(task.updated_at || task.last_at),
        /* 【第八十三轮补丁C】原始毫秒时间戳必须透给面板。
           面板只拿到格式化字符串没法算「多久没动静」，只能干等一个永久的「运行中」。
           陈旧 running 自愈靠这个字段判断（>3 分钟无更新 = 已中断，仅改展示）。 */
        updated_at_ms: Number(task.updated_at || task.last_at || task.created_at || 0),
        origin: task.origin || "",
        /* 【第八十二轮】归属可见：面板能看出这个任务是哪个对话派的 */
        parent_chat_id: String(task.parent_chat_id || ""),
        /* 【第八十三轮】群组归属必须透给面板：不然 UI 没法按群组分类。
           group=明文群组码（面展示用），group_dir=哈希目录名（不展示），
           group_created_at 用于重算目录名。 */
        group: task.group ? String(task.group) : "",
        group_dir: String(task.group_dir || ""),
        group_created_at: Number(task.group_created_at || 0),
        max_depth: task.max_depth || 0,
        tokens: ((task.usage || {}).in || 0) + ((task.usage || {}).out || 0),
        error: task.error || null
    };
}

module.exports = {
    loadCtx: loadCtx,
    notifyDone: notifyDone,
    callerChatId: callerChatId,
    callerChatIdAsync: callerChatIdAsync,
    filterChatOf: filterChatOf,
    rootChatIdOf: rootChatIdOf,
    ancestorChatIdsOf: ancestorChatIdsOf,
    visibleTasks: visibleTasks,
    inboxSuffix: inboxSuffix,
    tsOf: tsOf,
    briefOf: briefOf
};
