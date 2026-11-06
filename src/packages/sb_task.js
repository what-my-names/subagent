/* sb_task.js — 任务存储与步进执行 */
"use strict";

var CFG = require("./sb_config.js");
var LLM = require("./sb_llm.js");
var TOOLS = require("./sb_tools.js");

/* 任务产物根：并入三目录约定，落在 workspace 下（config 注释里 workspace 就是「任务产物与可写根」）。
 * 惰性求值：不能写成 var TEMP_ROOT = CFG.workspaceDir() + ...，因为 require 阶段 CFG 可能还没就绪；
 * 而且用户改配置后新路径要立刻生效。老任务 json 里的 product_dir 是已写死的绝对路径，照旧使用，不做迁移。 */
function tempRoot() { return CFG.workspaceDir() + "/.products"; }
/* 列表级短缓存：3 秒内重复调用直接复用，避免同一轮点击反复读全部任务文件；写任务时失效 */
var _listCache = { at: 0, data: null };
var LIST_CACHE_MS = 3000;

function nowMs() { return Date.now(); }
function nowText() {
    var d = new Date();
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}
function newId() {
    return "sa_" + nowMs().toString(36) + "_" + Math.floor(Math.random() * 46656).toString(36).padStart(3, "0");
}

function tasksDir() { return CFG.tasksDir(); }
function taskPath(id) { return tasksDir() + "/" + id + ".json"; }
/* 索引跟任务放一起（它是任务的目录表，不是可丢缓存） */
function indexPath() { return CFG.tasksDir() + "/index.json"; }
/* 用量与请求日志是可再生的统计，放 cache */
function usagePath() { return CFG.cacheDir() + "/usage.json"; }
function reqLogPath() { return CFG.cacheDir() + "/reqlog.jsonl"; }
function undoPath(id) { return productDirOf(id) + "/undo.json"; }
function productDirOf(id) { return tempRoot() + "/" + id; }

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

async function loadTask(id) {
    var raw = await readText(taskPath(id));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}

async function saveTask(task) {
    await mkdirs(tasksDir());
    task.updated_at = nowMs();
    await writeJson(taskPath(task.id), task);
    _listCache.at = 0; _listCache.data = null;   // 写任务后列表缓存失效
    return true;
}

async function listTasks(force) {
    if (!force && _listCache.data && (nowMs() - _listCache.at) < LIST_CACHE_MS) return _listCache.data;
    var ids = [];
    try {
        var r = await Tools.Files.list(tasksDir(), "android");
        var arr = (r && r.entries) ? r.entries : [];
        for (var i = 0; i < arr.length; i++) {
            var n = String(arr[i].name || "");
            if (n.slice(-5) === ".json") ids.push(n.slice(0, -5));
        }
    } catch (e) {}
    var out = [];
    var CHUNK = 8;
    for (var j = 0; j < ids.length; j += CHUNK) {
        var batch = [];
        for (var k = j; k < Math.min(j + CHUNK, ids.length); k++) batch.push(loadTask(ids[k]));
        var rs = await Promise.all(batch);
        for (var m = 0; m < rs.length; m++) { if (rs[m]) out.push(rs[m]); }
    }
    out.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
    _listCache.at = nowMs(); _listCache.data = out;
    return out;
}

async function refreshIndex() {
    var all = await listTasks();
    var items = [];
    for (var i = 0; i < all.length; i++) {
        var t = all[i];
        items.push({
            id: t.id, title: t.title, status: t.status, step: t.step,
            max_steps: t.max_steps, group: t.group || null,
            created_at: t.created_at, updated_at: t.updated_at,
            usage: t.usage || { in: 0, out: 0, est_cost: 0 }
        });
    }
    try { await mkdirs(CFG.tasksDir()); await writeJson(indexPath(), { items: items, updated_at: nowMs() }); } catch (e) {}
    return items;
}

function nextFor(task) {
    if (task.status === "done") return "result";
    if (task.status === "failed" || task.status === "cancelled") return "stop";
    return "advance";
}

function stripThinking(text) {
    var t = String(text == null ? "" : text);
    t = t.replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, "");
    t = t.replace(/<details[^>]*>[\s\S]*?<\/details>/gi, "");
    t = t.replace(/^[\s\S]*?<\/think>/i, "");
    return t.trim();
}

function stripToolBlocks(text) {
    var t = String(text || "");
    var LT = String.fromCharCode(60);
    var GT = String.fromCharCode(62);
    var open = LT + "tool_[A-Za-z0-9_]*[^" + GT + "]*" + GT;
    var close = LT + "/tool_[A-Za-z0-9_]*" + GT;
    t = t.replace(new RegExp(open + "[^]*?" + close, "gi"), "");
    t = t.replace(new RegExp(open, "gi"), "");
    t = t.replace(new RegExp(close, "gi"), "");
    t = t.replace(new RegExp(LT + "/?content" + GT, "gi"), "");
    t = t.replace(/\n{3,}/g, "\n\n");
    return t.trim();
}

function clipText(t, n) {
    var s = String(t || "");
    if (!n || s.length <= n) return s;
    return s.slice(0, n) + "\n...(已截断，原长 " + s.length + " 字符)";
}

function buildSystemPrompt(task, cfg) {
    var kp = task.key_points || {};
    var lines = [];
    lines.push("你是一个独立子代理，只对下面这一件事负责。");
    lines.push("");
    lines.push("## 任务");
    lines.push("标题：" + (task.title || ""));
    lines.push("目标：" + (kp.goal || task.task || ""));
    if (kp.deliverable) lines.push("交付物：" + kp.deliverable);
    if (kp.constraints && kp.constraints.length) lines.push("约束：" + kp.constraints.join("；"));
    if (kp.acceptance && kp.acceptance.length) lines.push("验收：" + kp.acceptance.join("；"));
    lines.push("");
    /* 工具：只说"能用什么"。越权由执行层硬拒，不需要在这里威胁模型 */
    lines.push("## 可用工具");
    /* 2026-11-06：工具不再统一包 run_tool 壳 —— 每个工具都是独立的 function，
       直接用工具名调用，参数就是该工具自己的参数。这里只列名字，
       否则模型会以为必须包一层（实测会把工具名拼成 "visit_web<tool_sep:...>" 这种污染串）。 */
    var toolList = (task.allowed_tools && task.allowed_tools.length) ? task.allowed_tools.join(", ") : "（无）";
    lines.push("直接按工具名调用（不需要包 run_tool）。可用工具：" + toolList);
    lines.push("参数直接按该工具自己的字段传，例如 read_file({path:\"/sdcard/foo.txt\"})。");
    if (task.workspace_resolved) {
        lines.push("");
        lines.push("## 写入范围");
        lines.push("写类工具只能落在 " + task.workspace_resolved + " 内。");
    }
    if (task.context_text) {
        lines.push("");
        lines.push("## 背景");
        lines.push(clipText(task.context_text, cfg.inject_max_chars || 20000));
    }
    lines.push("");
    lines.push("## 输出格式");
    lines.push("直接给出可交付结论，分三块：");
    lines.push("- 结论：一句话给答案");
    lines.push("- 依据：文件路径 / 命令输出 / 计算过程");
    lines.push("- 遗留项：没有就写「无」");
    lines.push("");
    lines.push("信息不足时按最合理假设继续，并把假设写进依据。做完即停。");
    return lines.join("\n");
}

async function logRequest(cfg, entry) {
    if (!cfg.request_log) return;
    try {
        var p = reqLogPath();
        var old = await readText(p);
        var lines = old ? old.split("\n") : [];
        var keep = [];
        for (var i = 0; i < lines.length; i++) { if (lines[i] && lines[i].trim()) keep.push(lines[i]); }
        keep.push(JSON.stringify(entry));
        var limit = Number(cfg.log_limit || 200);
        if (keep.length > limit) keep = keep.slice(keep.length - limit);
        await mkdirs(CFG.cacheDir());
        await Tools.Files.write(p, keep.join("\n"), false, "android");
    } catch (e) {}
}

async function loadUsage() {
    var raw = await readText(usagePath());
    if (!raw) return { steps: 0, tasks: 0, in: 0, out: 0, est_cost: 0, first_at: null, last_at: null };
    try { return JSON.parse(raw); } catch (e) { return { steps: 0, tasks: 0, in: 0, out: 0, est_cost: 0, first_at: null, last_at: null }; }
}
async function saveUsage(u) {
    try { await mkdirs(CFG.cacheDir()); await writeJson(usagePath(), u); } catch (e) {}
}

async function bumpUsage(cfg, usage) {
    var u = await loadUsage();
    u.steps = Number(u.steps || 0) + 1;
    u.in = Number(u.in || 0) + Number(usage.in || 0);
    u.out = Number(u.out || 0) + Number(usage.out || 0);
    u.est_cost = Math.round((Number(u.est_cost || 0) + LLM.estimateCost(cfg, usage)) * 1000000) / 1000000;
    if (!u.first_at) u.first_at = nowText();
    u.last_at = nowText();
    await saveUsage(u);
    return u;
}

async function createTask(cfg, opts) {
    var id = newId();
    var task = {
        id: id,
        title: String(opts.title || (opts.task || "").slice(0, 20)),
        task: String(opts.task || ""),
        key_points: opts.key_points || {},
        status: "queued",
        step: 0,
        max_steps: Number(opts.max_steps || cfg.max_steps || 20),
        timeout_ms: Number(opts.timeout_ms || cfg.step_timeout_ms || 90000),
        thinking_level: String(opts.thinking_level || "medium"),
        context_mode: String(opts.context_mode || cfg.default_context_mode || "none"),
        context_text: String(opts.context_text || ""),
        allowed_tools: opts.allowed_tools || [],
        workspace_resolved: String(opts.workspace_resolved || ""),
        product_dir: productDirOf(id),
        profile_override: { base_url: opts.base_url || "", model: opts.model || "" },
        summary_level: String(opts.summary_level || cfg.summary_level || "t1"),
        result_level: String(opts.result_level || cfg.result_level || "standard"),
        group: opts.group ? String(opts.group) : null,
        turns: [],
        usage: { in: 0, out: 0, est_cost: 0 },
        last: null,
        result: null,
        error: null,
        cancel: false,
        origin: String(opts.origin || "agent"),
        max_depth: Number(opts.max_depth || 0),
        created_at: nowMs(),
        updated_at: nowMs()
    };
    await mkdirs(productDirOf(id) + "/reports");
    await mkdirs(productDirOf(id) + "/work");
    await mkdirs(tasksDir());
    task.turns.push({ role: "system", content: buildSystemPrompt(task, cfg) });
    task.turns.push({ role: "user", content: String(opts.task || "") });
    await saveTask(task);
    var u = await loadUsage();
    u.tasks = Number(u.tasks || 0) + 1;
    await saveUsage(u);
    return task;
}

function movesOf(toolResults) {
    var out = [];
    for (var i = 0; i < toolResults.length; i++) {
        var r = toolResults[i] || {};
        out.push({ tool: String(r.tool || ""), ok: !!r.ok, chars: Number(r.chars || 0), error: r.ok ? null : String(r.error || "") });
    }
    return out;
}

function buildSummary(task, level, last) {
    var lv = String(level || "t1").toLowerCase();
    var base = { status: task.status, step: task.step, steps_left: Math.max(0, task.max_steps - task.step), next: nextFor(task) };
    if (lv === "t0") return base;
    base.moves = (last && last.moves) ? last.moves : [];
    base.text_head = clipText((last && last.text) ? last.text : "", 200);
    if (last && last.error) base.error = String(last.error);
    if (lv === "t2") {
        base.moves = (base.moves || []).map(function (m) {
            var x = { tool: m.tool, ok: m.ok, chars: m.chars };
            return x;
        });
        base.text_head = clipText((last && last.text) ? last.text : "", 600);
        base.args = (last && last.args) ? last.args : [];
        base.result_heads = (last && last.resultHeads) ? last.resultHeads : [];
    }
    return base;
}

function pickBrief(text) {
    var t = String(text || "");
    var idx = t.indexOf("结论");
    if (idx >= 0) return clipText(t.slice(idx), 800);
    return clipText(t, 800);
}

function buildResult(task, level) {
    var lv = String(level || task.result_level || "standard").toLowerCase();
    var raw = String(task.result || "");
    if (lv === "brief") return pickBrief(stripThinking(raw));
    if (lv === "full") return clipText(stripThinking(raw), 20000);
    var body = stripToolBlocks(stripThinking(raw));
    return clipText(body || raw, 4000);
}

async function steerTask(cfg, task, text) {
    var t = String(text || "").trim();
    if (!t) return { ok: false, task: task, message: "消息为空" };
    if (task.status === "closed") return { ok: false, task: task, message: "任务已关闭，不能追加" };
    task.turns.push({ role: "user", content: t });
    if (task.status === "done" || task.status === "failed" || task.status === "cancelled") {
        task.status = "running";
        task.cancel = false;
        task.error = null;
        if (task.step >= task.max_steps) task.max_steps = task.step + 5;
    }
    await saveTask(task);
    return { ok: true, task: task, message: "已追加，下一次 advance 生效" };
}

/* 阶段标记：前端轮询靠它显示「正在调用模型 / 正在执行工具」，
   每步落盘，桥断开也不影响后端继续写。 */
async function setPhase(task, phase, extra) {
    task.phase = String(phase || "idle");
    task.phase_at = nowMs();
    if (extra && typeof extra === "object") {
        for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) task[k] = extra[k]; }
    }
    try { await saveTask(task); } catch (e) {}
}

async function advanceTask(cfg, task) {
    if (task.status === "done") return { ok: true, done: true, task: task, message: "任务已完成" };
    if (task.status === "cancelled") return { ok: false, task: task, message: "任务已取消" };
    if (task.cancel) { task.status = "cancelled"; await saveTask(task); return { ok: false, task: task, message: "任务已取消" }; }
    if (task.step >= task.max_steps) {
        task.status = "failed"; task.error = "超出步数上限 " + task.max_steps; await saveTask(task);
        return { ok: false, task: task, message: task.error };
    }
    var profile = LLM.resolveProfile(cfg, task.profile_override || {});
    var isMock = String(profile.base_url || "").indexOf("mock://") === 0;
    if (!isMock && !CFG.hasKey(cfg)) return { ok: false, task: task, message: "未配置密钥：请在环境变量填 " + CFG.keyEnvName(cfg) };
    if (!profile.base_url) return { ok: false, task: task, message: "未配置 base_url" };
    if (!profile.model) return { ok: false, task: task, message: "未配置 model" };

    var t0 = nowMs();
    task.status = "running";
    await setPhase(task, "llm", { step_at: nowMs() });
    var res = await LLM.callChat(cfg, profile, task.turns, task.allowed_tools, task.thinking_level, task.timeout_ms);
    var elapsed = nowMs() - t0;
    await logRequest(cfg, { t: nowText(), task: task.id, step: task.step + 1, status: res.ok ? 200 : (res.status || 0), ms: elapsed, in: (res.usage ? res.usage.in : 0), out: (res.usage ? res.usage.out : 0), ok: !!res.ok });
    if (!res.ok) {
        task.status = "failed"; task.error = res.error || "模型调用失败"; await saveTask(task);
        return { ok: false, task: task, message: task.error };
    }
    task.step = Number(task.step || 0) + 1;
    task.usage.in = Number(task.usage.in || 0) + Number(res.usage.in || 0);
    task.usage.out = Number(task.usage.out || 0) + Number(res.usage.out || 0);
    task.usage.est_cost = Math.round((Number(task.usage.est_cost || 0) + LLM.estimateCost(cfg, res.usage)) * 1000000) / 1000000;
    await bumpUsage(cfg, res.usage);

    var asst = { role: "assistant", content: res.content || "", reasoning: res.reasoning || "" };
    asst.elapsed_ms = elapsed;
    asst.finish_reason = res.finishReason || "";
    asst.usage = { in: Number(res.usage.in || 0), out: Number(res.usage.out || 0), model: res.model || profile.model || "" };
    if (res.toolCalls && res.toolCalls.length) {
        asst.tool_calls = res.toolCalls.map(function (tc) {
            return { id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } };
        });
    }
    task.turns.push(asst);
    /* 助手这一轮的思考与正文先落盘：前端轮询 trace 就能在工具执行前看到内容 */
    await saveTask(task);

    var moves = [];
    var argsOut = [];
    var resultHeads = [];
    if (res.toolCalls && res.toolCalls.length) {
        var undo = (await loadUndo(task.id));
        var seq = Number(undo.seq || 0);
        var ctx = {
            allowed: task.allowed_tools || [],
            workspace: task.workspace_resolved || "",
            productDir: task.product_dir,
            maxChars: Number(cfg.tool_result_max_chars || 8000),
            roots: [task.workspace_resolved || "", task.product_dir || ""].filter(Boolean),
            nextSeq: function () { seq = seq + 1; return seq; },
            loadUndo: function () { return undo.items || []; },
            appendUndo: function (recs) { undo.items = (undo.items || []).concat(recs || []); undo.seq = seq; },
            clearUndo: function () { undo.items = []; undo.seq = seq; }
        };
        for (var i = 0; i < res.toolCalls.length; i++) {
            var tc = res.toolCalls[i];
            var req = tc.args && tc.args.tool ? tc.args : { tool: tc.name, args: tc.args || {} };
            /* 工具执行前先标记阶段：前端能显示「正在跑 xxx」，不会像卡死 */
            await setPhase(task, "tool", { tool_now: String(req.tool || tc.name) });
            var out = await TOOLS.runOne(ctx, req);
            moves.push(out);
            argsOut.push({ tool: out.tool, args: clipText(JSON.stringify(req.args || {}), 120) });
            resultHeads.push({ tool: out.tool, head: clipText(out.ok ? out.result : ("ERROR: " + out.error), 150) });
            task.turns.push({
                role: "tool",
                tool_call_id: tc.id,
                name: String(req.tool || tc.name),
                args: JSON.stringify(req.args || {}),
                elapsed_ms: out.ms || 0,
                ok: !!out.ok,
                content: out.ok ? out.result : ("ERROR: " + out.error)
            });
            /* 每跑完一个工具就落盘：前端轮询随时能拿到最新一条 */
            await saveTask(task);
        }
        await saveUndo(task.id, undo);
        task.status = "running";
    } else {
        task.result = res.content || "";
        task.status = "done";
    }
    task.last = {
        moves: movesOf(moves),
        text: res.content || "",
        args: argsOut,
        resultHeads: resultHeads,
        elapsed_ms: elapsed,
        finish_reason: res.finishReason || ""
    };
    /* 阶段标记：让前端轮询能区分「模型在想」和「工具在跑」 */
    task.phase = "idle";
    task.phase_at = nowMs();
    await saveTask(task);
    return { ok: true, task: task, done: task.status === "done" };
}

async function loadUndo(id) {
    var raw = await readText(undoPath(id));
    if (!raw) return { items: [], seq: 0 };
    try { return JSON.parse(raw); } catch (e) { return { items: [], seq: 0 }; }
}

async function saveUndo(id, undo) {
    try {
        await mkdirs(productDirOf(id));
        await writeJson(undoPath(id), undo || { items: [], seq: 0 });
    } catch (e) {}
}

function dropCache(id) { _listCache.at = 0; _listCache.data = null; }

module.exports = {
    tempRoot: tempRoot,
    newId: newId,
    productDirOf: productDirOf,
    createTask: createTask,
    loadTask: loadTask,
    dropCache: dropCache,
    saveTask: saveTask,
    listTasks: listTasks,
    refreshIndex: refreshIndex,
    advanceTask: advanceTask,
    steerTask: steerTask,
    buildSummary: buildSummary,
    buildResult: buildResult,
    nextFor: nextFor,
    loadUndo: loadUndo,
    saveUndo: saveUndo,
    loadUsage: loadUsage
};
