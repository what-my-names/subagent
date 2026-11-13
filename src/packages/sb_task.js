/* sb_task.js — 任务存储与步进执行 */
"use strict";

var CFG = require("./sb_config.js");
var LLM = require("./sb_llm.js");
var TOOLS = require("./sb_tools.js");
var SKILL = require("./sb_skill.js");

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
/* 任务 id。
   【为什么优先用 getToolSessionId】ToolPkg API 1.2.0 新增，官方注释：
   「Host-assigned tool session identity; distinct for every delegated subtask run」
   宿主保证每次委派都不同。原来用「时间戳 + 随机数」，同一毫秒内并发派两个任务
   有撞号风险（随机数只有 46656 种，同毫秒撞概率不低）。
   【为什么还要拼时间戳】session id 只在同一次工具调用内稳定，跨调用可能重复，
   拼上时间戳保证全局唯一。
   【为什么要 typeof 判存在】这是 1.2.0 新增 API，老版本宿主没有，
   直接调会抛 ReferenceError。 */
function newId() {
    var sid = "";
    try {
        if (typeof getToolSessionId === "function") {
            sid = String(getToolSessionId() || "");
        }
    } catch (e) { sid = ""; }
    /* session id 可能含非法文件名字符，只留字母数字，截断防过长 */
    if (sid) {
        sid = sid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
    }
    var tail = nowMs().toString(36) + Math.floor(Math.random() * 46656).toString(36).padStart(3, "0");
    return sid ? ("sa_" + sid + "_" + tail) : ("sa_" + tail);
}

function tasksDir() { return CFG.tasksDir(); }
function taskPath(id) { return tasksDir() + "/" + id + ".json"; }
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
            if (n.slice(-5) !== ".json") continue;
            var tid = n.slice(0, -5);
            /* index.json 是任务目录表，不是任务本体。不排除的话它会被当任务解析，
               得到一个没有 id 字段的对象塞进列表 → 前端渲染出 data-val="undefined"
               的幽灵行，点进去 loadTask("undefined") 又找不到。 */
            if (tid === "index") continue;
            ids.push(tid);
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
    return s.slice(0, n);   /* 【第五十六轮】不再拼截断字样 */
}

/* 系统提示词（2026-11-07 极简化，用户定调）
 *
 * 设计原则：只放事实，不放角色扮演、不放行为告诫、不放输出格式。
 *   1) 不写「你是子代理」—— 模型会先自我定位、多绕一圈（用户实测）
 *   2) 不写「不要假装调用工具」—— 反而诱导它去权衡「要不要调」
 *   3) 不规定输出格式 —— 用户自己能看懂，模板只会束缚
 *   4) 工具定义由 API 的 tools 字段给，这里不重复
 *
 * 保留的只有：工作区（能用 cd 表达的就用路径）、调用方显式传的 key_points、背景文本。
 * 要加限制由用户指定，不自作主张。
 */
function buildSystemPrompt(task, cfg) {
    var kp = task.key_points || {};
    var lines = [];
    /* 工作区：直接给路径，等于告诉它「你在这儿干活」 */
    if (task.workspace_resolved) lines.push("工作目录：" + task.workspace_resolved);
    /* 调用方显式给的要求，原样带上，不加壳 */
    if (kp.goal) lines.push(kp.goal);
    if (kp.deliverable) lines.push("交付物：" + kp.deliverable);
    if (kp.constraints && kp.constraints.length) lines.push("约束：" + kp.constraints.join("；"));
    if (kp.acceptance && kp.acceptance.length) lines.push("验收：" + kp.acceptance.join("；"));
    /* 背景文本（对话历史 / 文件内容等），原样注入 */
    if (task.context_text) lines.push(clipText(task.context_text, cfg.inject_max_chars || 20000));
    /* 【第六十五轮】skill 清单：只注 name + description，不注全文。
       为什么不全注：单个 SKILL.md 几千到几万字，几十个就是几十万字符，直接拉爆上下文。
       模型看到清单后，需要哪个用 subagent_skill(action=read, name=xxx) 自己取。 */
    if (task.skills && task.skills.length) {
        var skillTxt = "";
        try {
            var all = task._skillList || null;
            if (all) skillTxt = SKILL.formatSkillList(all, task.skills);
        } catch (eS) { skillTxt = ""; }
        if (skillTxt) {
            lines.push("可用 skill：");
            lines.push(skillTxt);
            lines.push("需要某个 skill 的完整内容时，调 subagent_skill（action=read, name=skill名）。");
        }
    }
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
        /* 【第六十五轮】要注入哪些 skill 的清单。存数组，空数组=不注入。
           传 all 时由调用方展开成全部名字。 */
        skills: Array.isArray(opts.skills) ? opts.skills : [],
        allowed_tools: opts.allowed_tools || [],
        /* 【第五十二轮】允许危险命令（建任务时可覆盖全局） */
        allow_danger: opts.allow_danger === true,
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
    /* 【第六十五轮】有 skill 需求时先扫一遍目录，把清单缓存到 _skillList，
       供 buildSystemPrompt 拼提示词。扫不到不报错，只是清单为空。 */
    if (task.skills && task.skills.length) {
        try { task._skillList = await SKILL.listSkills(); } catch (eSk) { task._skillList = null; }
    }
    task.turns.push({ role: "system", content: buildSystemPrompt(task, cfg) });
    delete task._skillList;
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
    /* 【第六十七轮】自动加步数上限要明说，不能偷偷加。
       原来悄悄改 max_steps，用户以为自己在 20 步内，其实已经 25 了。 */
    var extended = 0;
    if (task.status === "done" || task.status === "failed" || task.status === "cancelled") {
        task.status = "running";
        task.cancel = false;
        task.error = null;
        if (task.step >= task.max_steps) {
            var before = Number(task.max_steps || 0);
            task.max_steps = task.step + 5;
            extended = task.max_steps - before;
            task.steer_extended = Number(task.steer_extended || 0) + extended;
        }
    }
    await saveTask(task);
    return {
        ok: true, task: task,
        message: extended > 0
            ? "已追加，下一次 advance 生效（步数上限已从 " + (task.max_steps - extended) + " 提到 " + task.max_steps + "）"
            : "已追加，下一次 advance 生效"
    };
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

/* 同一任务的推进锁（内存级）：
   面板流式 + 后端 advance 可能同时推同一个任务 → 双份 LLM 请求（双倍计费）
   + 两个 saveTask 互相覆盖（丢步骤）。
   ToolPkg 后端是单进程单事件循环，用 Set 做互斥就够，不需要文件锁。 */
var _advancing = {};

/* 【第六十七轮】加磁盘锁，补上内存锁的缺口。
   内存锁只在「同一个 JS 引擎实例」里有效：
   面板在 WebView 的 JsEngine 里跑，主 agent 调 subagent_advance 在另一个执行上下文，
   两边各有一份 _advancing，互相看不见 —— 同一个任务会被两边同时推进，
   结果就是双份 LLM 请求（双倍计费）+ 两个 saveTask 互相覆盖（丢步骤）。
   磁盘锁跨上下文可见。
   【僵死锁】带时间戳，超过 STALE_LOCK_MS 视为上一次推进已崩，允许抢占。
   万一真锁死了，删掉 cache/lock_<id>.json 即可解开。 */
var STALE_LOCK_MS = 10 * 60 * 1000;
function lockPath(id) { return CFG.cacheDir() + "/lock_" + String(id || "x") + ".json"; }
async function tryDiskLock(id) {
    if (!id) return { ok: true, stale: false };
    var p = lockPath(id);
    var now = nowMs();
    var old = null;
    try { var raw = await readText(p); if (raw) old = JSON.parse(raw); } catch (e) { old = null; }
    if (old && old.at && (now - Number(old.at)) < STALE_LOCK_MS) {
        return { ok: false, at: Number(old.at), stale: false };
    }
    try {
        await mkdirs(CFG.cacheDir());
        await Tools.Files.write(p, JSON.stringify({ at: now }), false, "android");
    } catch (e) {
        /* 写不进锁文件时不阻塞任务 —— 宁可能并发也不要永远推不动 */
        return { ok: true, stale: false, degraded: true };
    }
    return { ok: true, stale: !!old };
}
async function releaseDiskLock(id) {
    if (!id) return;
    try { await Tools.Files.deleteFile(lockPath(id), "android"); } catch (e) {}
}

async function advanceTask(cfg, task) {
    var _lk = String(task.id || "");
    if (_lk && _advancing[_lk]) return { ok: false, busy: true, task: task, message: "该任务正在推进中，请稍后" };
    var dk = await tryDiskLock(_lk);
    if (!dk.ok) {
        return { ok: false, busy: true, task: task, message: "该任务正在推进中（另一处正在跑），请稍后" };
    }
    if (_lk) _advancing[_lk] = true;
    try {
        return await _advanceTaskInner(cfg, task);
    } catch (e) {
        /* 【关键】异常必须落盘成 failed，否则任务会永久钉在 running：
           saveTask 的「写回校验失败」等异常抛出后，status 仍是 running，
           而 subagent_resume 见到 running 直接返回「任务正在运行」不重置，
           用户只能手改 json 才能救回来。 */
        var msg = String((e && e.message) || e);
        try {
            task.status = "failed";
            task.error = "推进异常：" + msg;
            task.phase = "idle";
            task.phase_at = nowMs();
            await saveTask(task);
        } catch (e2) {}
        return { ok: false, task: task, message: task.error };
    } finally {
        if (_lk) delete _advancing[_lk];
        await releaseDiskLock(_lk);
    }
}

/* 【第六十七轮】上下文超限 → 转存文件。
 *
 * 背景：用户早先定「工具结果不截断」，落盘保留全量没问题；
 * 但 task.turns 全量发给模型，跑十几步后几十万字符，模型直接 400 context_length_exceeded。
 * 用户新决定：不砍内容，改成「超限就转存成文件，让子代理自己去读」。
 *
 * 做法：
 *   1. 只处理 tool 角色的消息（正文/思考通常短，且是叙事主线，不能动）
 *   2. 单条低于 EXTRACT_MIN_CHARS(4000) 的不动 —— 短的转存反而增加往返
 *   3. 从最老的开始转存，直到总量降到 CTX_SOFT_LIMIT 以下
 *   4. 原文写进 CFG.tmpDir()/<taskId>_<n>.txt，消息里换成一行引用
 *   5. **只返回副本，不改 task.turns** —— 落盘仍是全量，随时可回溯
 *
 * 入：task, cfg
 * 出：可直接喂给 LLM.callChat 的 messages 数组（副本）
 */
var EXTRACT_MIN_CHARS = 4000;      /* 单条低于这个值不转存，转存反而多一次往返 */
var CTX_SOFT_LIMIT = 180000;       /* 总字符软上限，约 45k token，留足余量给模型输出 */

async function prepareTurnsForModel(task, cfg) {
    var turns = task.turns || [];
    /* 先算总量 */
    var total = 0;
    for (var i = 0; i < turns.length; i++) {
        total += String((turns[i] || {}).content || "").length;
    }
    /* 没超就直接返回原数组（不复制，省开销） */
    if (total <= CTX_SOFT_LIMIT) return turns;

    var out = [];
    var copied = 0;
    var lastIdx = turns.length - 1;
    /* 从最老的开始找可转存的 tool 消息。
       跳过最后一条（最新工具结果，模型马上要用，转存等于白跑一步） */
    for (var j = 0; j < turns.length; j++) {
        var m = turns[j] || {};
        var c = String(m.content || "");
        if (m.role !== "tool" || j === lastIdx || c.length < EXTRACT_MIN_CHARS) {
            out.push(m);
            continue;
        }
        if (total <= CTX_SOFT_LIMIT) { out.push(m); continue; }
        /* 需要转存这一条 */
        var path = CFG.tmpDir() + "/" + String(task.id || "task") + "_" + j + ".txt";
        try {
            await mkdirs(CFG.tmpDir());
            await Tools.Files.write(path, c, false, "android");
        } catch (e) {
            /* 写不进去就原样保留 —— 宁可超限也不要丢内容 */
            out.push(m);
            continue;
        }
        var cp = {};
        for (var k in m) { if (Object.prototype.hasOwnProperty.call(m, k)) cp[k] = m[k]; }
        cp.content = "[内容过长已转存] 这段工具返回共 " + c.length
            + " 字符，全文在 " + path
            + "，需要细节时用 read_file 读它。";
        out.push(cp);
        total -= (c.length - cp.content.length);
        copied++;
    }
    if (copied > 0) {
        try { task.ctx_spilled = Number(task.ctx_spilled || 0) + copied; } catch (e2) {}
    }
    return out;
}

async function _advanceTaskInner(cfg, task) {
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
    var res = await LLM.callChat(cfg, profile, await prepareTurnsForModel(task, cfg), task.allowed_tools, task.thinking_level, task.timeout_ms);
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
/* 【第四十七轮】默认不截断：用户明确要求「再长也不要截断」。
   以前默认 8000 字符，长文件读一半就被砍，模型看不到全文只能重复读。
   cfg.tool_result_max_chars 显式配了正数才截断；0 或缺失 = 全量。
   注意 clip() 本身对 0/缺失已经是不截断，这里只改默认值。 */
            maxChars: Number(cfg.tool_result_max_chars || 0),
        /* 【第五十二轮】allowDanger 透传给 analyzeCommand。
           task 级优先（建任务时指定），否则用全局配置。 */
        allowDanger: task.allow_danger === true || cfg.allow_danger === true,
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
    advanceTask: advanceTask,
    steerTask: steerTask,
    buildSummary: buildSummary,
    buildResult: buildResult,
    nextFor: nextFor,
    loadUndo: loadUndo,
    saveUndo: saveUndo,
    loadUsage: loadUsage,
    bumpUsage: bumpUsage,
    prepareTurnsForModel: prepareTurnsForModel
};
