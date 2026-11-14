/* sb_task.js — 任务存储与步进执行 */
"use strict";

var CFG = require("./sb_config.js");
var LLM = require("./sb_llm.js");
var TOOLS = require("./sb_tools.js");
var SKILL = require("./sb_skill.js");
var GRP = require("./sb_group.js");

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
/* 【第八十三轮】任务 id 全新规则。
 *
 * 【为什么弃用 getToolSessionId】它是「一次委派」的票号，不是对话身份，
 * 每次委派都换，名字长得像 UID 实际是流水号，用户实测会变。
 *
 * 【现在的规则】全哈希，路径上不出现明文群组码：
 *   有群组：sa_<hash6>_<hash6>
 *           前段 = hash6(群组创建时间 + 当前时间 + 群组码)
 *           后段 = hash6(子代理创建时间 + 当前时间 + 子代理码)
 *   无群组：sa_<hash6>
 *           = hash6(创建时间 + 当前时间 + 子代理码)
 *
 * 【为什么掺「当前时间」】用户定：创建时间与当前时间一起。
 * 代价是同群组的任务 ID 前缀不一致；归属靠目录与 index.json 判定，不靠前缀。
 * 好处是同一个群组不同批次建的任务看不出规律。
 *
 * 【不加盐】用户拍板：威胁模型是同设备几个 agent 互相别串，不是公网对抗。
 * 防暴力枚举是给公网 API 操的心，这里加盐只增复杂度、没有对应攻击者。
 */
function newTaskId(nowMsVal, groupCode, groupCreatedAt) {
    var now = Number(nowMsVal || Date.now());
    var sub = GRP.rand6();
    var subSeg = GRP.hash6(String(now) + String(now) + sub);
    var gc = String(groupCode || "");
    if (!gc) return "sa_" + subSeg;
    var gSeg = GRP.hash6(String(groupCreatedAt || 0) + String(now) + gc);
    return "sa_" + gSeg + "_" + subSeg;
}

function tasksDir() { return CFG.tasksDir(); }
function groupsRoot() { return CFG.baseDir() + "/groups"; }
/* 用量与请求日志是可再生的统计，放 cache */
function usagePath() { return CFG.cacheDir() + "/usage.json"; }
function reqLogPath() { return CFG.cacheDir() + "/reqlog.jsonl"; }

/* 【第八十三轮】任务目录解析。
 * 新结构：一个任务一棵自足目录树，路径不再靠 id 拼接猜出来，
 * 而是由 task 里的 group 字段决定它住在 tasks/ 还是 groups/<hash>/。
 *
 * 优先级：
 *   1) task 对象给了 group → groups/<哈希目录>/<id>/
 *   2) 只有 id（不知道 group）→ 双树查找 _findTaskDir
 *   3) 老任务（tasks/<id>.json 单文件）→ 兼容返回 tasks/ 根，由 loadTask 走旧路
 */
function taskDirOf(task) {
    if (!task) return "";
    var id = String(task.id || "");
    var g = task.group;
    if (g && task.group_created_at) {
        /* 【遗留】group 字段存群组码，group_created_at 存群组创建时间（定位哈希目录要用） */
        var cfgNew = String(task.group);
        if (String(task.group_dir || "")) {
            return groupsRoot() + "/" + String(task.group_dir) + "/" + id;
        }
        return GRP.groupDirOf(cfgNew, task.group_created_at) + "/" + id;
    }
    return tasksDir() + "/" + String(id || "");
}
/* 老接口保留：调用方还很多，语义改为「该任务的目录」 */
function productDirOf(id) { return tasksDir() + "/" + String(id || ""); }

/* 任务本体 / undo 都进任务目录 */
function taskFilePath(task) { return taskDirOf(task) + "/task.json"; }
function undoPathOf(task) { return taskDirOf(task) + "/undo.json"; }

/* 按 id 在双树里找任务目录。找不到返回空串。
 * 目录名就是任务 id，所以列目录即可，不用读文件内容。 */
async function _findTaskDir(id) {
    var want = String(id || "");
    if (!want) return "";
    /* 先在 tasks 根目录下找 */
    var p1 = tasksDir() + "/" + want;
    try {
        var raw1 = await readText(p1 + "/task.json");
        if (raw1) return p1;
    } catch (e1) {}
    /* 群组目录下的同名子目录 */
    try {
        var gr = await Tools.Files.list(groupsRoot(), "android");
        var garr = (gr && gr.entries) ? gr.entries : [];
        for (var i = 0; i < garr.length; i++) {
            var gname = String(garr[i].name || "");
            if (!gname) continue;
            var p2 = groupsRoot() + "/" + gname + "/" + want;
            var raw2 = await readText(p2 + "/task.json");
            if (raw2) return p2;
        }
    } catch (e2) {}
    return "";
}

/* 索引文件路径：tasks/index.json 与 groups/<hash>/index.json */
function rootIndexPath() { return tasksDir() + "/index.json"; }
function groupIndexPathOf(taskOrNil, groupDir) {
    if (groupDir) return groupsRoot() + "/" + String(groupDir) + "/index.json";
    return rootIndexPath();
}

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

/* 【第八十三轮】读任务：先按新结构找目录，找不到再回退老单文件。
 * 老任务（tasks/<id>.json）优先迁移，迁移完成前双读保证不丢。 */
async function loadTask(id) {
    var want = String(id || "");
    if (!want) return null;
    /* 1) 新结构 */
    var dir = await _findTaskDir(want);
    if (dir) {
        var raw = await readText(dir + "/task.json");
        if (raw) { try { return JSON.parse(raw); } catch (e) {} }
    }
    /* 2) 老单文件（迁移前兼容） */
    var rawOld = await readText(tasksDir() + "/" + want + ".json");
    if (rawOld) { try { return JSON.parse(rawOld); } catch (e) {} }
    return null;
}

/* 【第八十三轮】写任务：按新结构落到任务目录，并同步 index.json。
 * 若任务还是老单文件格式（没有 task.json 目录），这里会顺手建目录并迁移，
 * 调用方无需关心。 */
async function saveTask(task) {
    if (!task || !task.id) return false;
    task.updated_at = nowMs();
    var dir = taskDirOf(task);
    await mkdirs(dir + "/reports");
    await mkdirs(dir + "/work");
    await writeJson(dir + "/task.json", task);
    /* 老单文件若还存在，删掉避免双份 */
    try { await Tools.Files.deleteFile(tasksDir() + "/" + task.id + ".json", false, "android"); } catch (eD) {}
    await _syncIndex(task);
    _listCache.at = 0; _listCache.data = null;
    return true;
}

/* 把一条任务摘要写进它所属的 index.json。条目已存在则更新，否则追加。 */
async function _syncIndex(task) {
    try {
        var isGroup = !!task.group;
        var ip = isGroup
            ? groupIndexPathOf(task, task.group_dir || GRP.hash6("g" + String(task.group) + String(task.group_created_at || 0)))
            : rootIndexPath();
        var raw = await readText(ip);
        var idx = null;
        try { idx = raw ? JSON.parse(raw) : null; } catch (e) { idx = null; }
        if (!idx || !Array.isArray(idx.tasks)) idx = isGroup ? { code: String(task.group || ""), tasks: [] } : { tasks: [] };
        var hit = false;
        for (var i = 0; i < idx.tasks.length; i++) {
            if (String((idx.tasks[i] || {}).id || "") === String(task.id)) {
                idx.tasks[i] = _indexEntry(task);
                hit = true;
                break;
            }
        }
        if (!hit) idx.tasks.push(_indexEntry(task));
        await mkdirs(ip.slice(0, ip.lastIndexOf("/")));
        await writeJson(ip, idx);
    } catch (e) {}
}
function _indexEntry(task) {
    return {
        id: String(task.id || ""),
        title: String(task.title || ""),
        status: String(task.status || ""),
        group: task.group ? String(task.group) : "",
        parent_chat_id: String(task.parent_chat_id || ""),
        created_at: Number(task.created_at || 0)
    };
}

/* 从 index.json 移除一条。删任务时调。 */
async function _dropFromIndex(task) {
    try {
        var isGroup = !!task.group;
        var ip = isGroup
            ? groupIndexPathOf(task, task.group_dir || GRP.hash6("g" + String(task.group) + String(task.group_created_at || 0)))
            : rootIndexPath();
        var raw = await readText(ip);
        if (!raw) return;
        var idx = null;
        try { idx = JSON.parse(raw); } catch (e) { return; }
        if (!idx || !Array.isArray(idx.tasks)) return;
        var out = [];
        for (var i = 0; i < idx.tasks.length; i++) {
            if (String((idx.tasks[i] || {}).id || "") !== String(task.id)) out.push(idx.tasks[i]);
        }
        idx.tasks = out;
        await writeJson(ip, idx);
    } catch (e) {}
}

/* 【第八十二轮】filterChatId 非空时只返回该对话创建的任务。
   缓存永远存全量：按对话过滤在返回时做，否则 A 对话查过之后
   B 对话会拿到 A 的缓存结果——比不过滤更糟。
   【第八十三轮】加了 groupFilter：给了群组码就只返回该群组的任务。 */
async function listTasks(force, filterChatId, groupFilter) {
    var all = await _listTasksAll(force);
    var fid = String(filterChatId || "");
    var gf = String(groupFilter || "");
    if (!fid && !gf) return all;
    var out = [];
    for (var i = 0; i < all.length; i++) {
        var t = all[i] || {};
        if (fid && String(t.parent_chat_id || "") !== fid) continue;
        if (gf && String(t.group || "") !== gf) continue;
        out.push(t);
    }
    return out;
}

/* 扫全量任务：走 index.json 拿 id 列表，读不到的靠目录扫兜底。
 * 【为什么优先 index】任务多了以后读每个 task.json 太慢；
 * index 里已有 id/title/status，够列表用。但 index 可能损坏或缺失，
 * 所以最后一步永远是「扫目录比对」，保证不丢。 */
async function _listTasksAll(force) {
    if (!force && _listCache.data && (nowMs() - _listCache.at) < LIST_CACHE_MS) return _listCache.data;
    var ids = [];
    var seen = {};
    function push(id) {
        var k = String(id || "");
        if (!k || seen[k]) return;
        seen[k] = 1;
        ids.push(k);
    }
    /* 1) tasks/ 目录：新结构是子目录，老结构是 .json 文件 */
    try {
        var r = await Tools.Files.list(tasksDir(), "android");
        var arr = (r && r.entries) ? r.entries : [];
        for (var i = 0; i < arr.length; i++) {
            var n = String(arr[i].name || "");
            if (!n) continue;
            if (n === "index.json") continue;
            if (n.slice(-5) === ".json") { push(n.slice(0, -5)); continue; }   // 老单文件
            push(n);                                                          // 新目录
        }
    } catch (e) {}
    /* 2) groups/<hash>/ 下每个群组的任务子目录 */
    try {
        var gr = await Tools.Files.list(groupsRoot(), "android");
        var garr = (gr && gr.entries) ? gr.entries : [];
        for (var gi = 0; gi < garr.length; gi++) {
            var gname = String(garr[gi].name || "");
            if (!gname) continue;
            var tr = await Tools.Files.list(groupsRoot() + "/" + gname, "android");
            var tarr = (tr && tr.entries) ? tr.entries : [];
            for (var ti = 0; ti < tarr.length; ti++) {
                var tn = String(tarr[ti].name || "");
                if (!tn || tn === "index.json" || tn === "group.json") continue;
                push(tn);
            }
        }
    } catch (e2) {}
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
            if (all) skillTxt = SKILL.formatSkillList(all, task.skills, String(task.task || "") + " " + String((kp.goal || "")));
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
    var createdAt = nowMs();
    /* 【第八十三轮】id 由群组码 + 时间哈希生成，不再用 getToolSessionId */
    var grpCode = String(opts.group || "");
    var grpCreatedAt = Number(opts.group_created_at || 0);
    var id = newTaskId(createdAt, grpCode, grpCreatedAt);
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
        /* 【第八十三轮】product_dir 指向任务自己的目录（不再有 .products）。
           自足目录树：task.json / undo.json / reports / work 都在这一个盒子里。 */
        product_dir: "",
        profile_override: { base_url: opts.base_url || "", model: opts.model || "" },
        summary_level: String(opts.summary_level || cfg.summary_level || "t1"),
        result_level: String(opts.result_level || cfg.result_level || "standard"),
        /* 【第八十三轮】群组归属。group 存群组码（6 位数字），
           group_dir 存哈希目录名（路径用），group_created_at 用于重算目录名。
           三个一起存，任何一个丢了都能从另外两个恢复。 */
        group: grpCode ? String(grpCode) : null,
        group_dir: grpCode ? String(opts.group_dir || GRP.hash6("g" + grpCode + String(grpCreatedAt))) : "",
        group_created_at: grpCode ? grpCreatedAt : 0,
        turns: [],
        usage: { in: 0, out: 0, est_cost: 0 },
        last: null,
        result: null,
        error: null,
        cancel: false,
        origin: String(opts.origin || "agent"),
        /* 【第八十二轮】任务归属：创建它的对话 id。空串 = 无归属（老任务或非对话来源）。
           用于让父级对话只看自己派的子代理，避免多对话并行时互相干扰。 */
        parent_chat_id: String(opts.parent_chat_id || ""),
        max_depth: Number(opts.max_depth || 0),
        created_at: nowMs(),
        updated_at: nowMs()
    };
    /* 【第八十三轮】目录树在 saveTask 里建（那时才知道 group），
       这里只把 product_dir 定下来 */
    task.product_dir = taskDirOf(task);
    await mkdirs(task.product_dir + "/reports");
    await mkdirs(task.product_dir + "/work");
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

/* 【第七十三轮】结果提取不再死找「结论」两个字。
   旧行为：只认「结论」，模型没写这两字就取开头 800 字 ——
   而模型的收尾总结通常在**末尾**，取开头等于把过程当结论。
   新行为：按优先缀找标记词，找不到则取末尾 800 字（不是开头）。 */
var BRIEF_MARKS = ["结论", "总结", "完成情况", "完成后", "结果如下", "综上", "已全部", "已完成",
                   "Summary", "Conclusion", "Done", "Result"];
function pickBrief(text) {
    var t = String(text || "");
    var best = -1;
    for (var i = 0; i < BRIEF_MARKS.length; i++) {
        var idx = t.indexOf(BRIEF_MARKS[i]);
        if (idx >= 0 && (best < 0 || idx < best)) best = idx;
    }
    if (best >= 0) return clipText(t.slice(best), 800);
    /* 没标记词：取末尾 —— 收尾总结在后面，不在开头 */
    if (t.length <= 800) return t;
    return "…" + t.slice(t.length - 800);
}

/* 【第七十三轮】结果末尾附产物目录。
   旧行为：只给文字结论，主 agent 不知道子代理写了哪些文件，还得自己去 ls。 */
function buildResult(task, level) {
    var lv = String(level || task.result_level || "standard").toLowerCase();
    var raw = String(task.result || "");
    var body;
    if (lv === "brief") body = pickBrief(stripThinking(raw));
    else if (lv === "full") body = clipText(stripThinking(raw), 20000);
    else {
        var b2 = stripToolBlocks(stripThinking(raw));
        body = clipText(b2 || raw, 4000);
    }
    /* 产物目录：只列实际存在的路径，不凭空造 */
    var pd = String(task.product_dir || "");
    if (pd) {
        body = body + "\n\n产物目录：" + pd + "\n（写过的文件都在这里，reports/ 存报告，work/ 存中间结果）";
    }
    return body;
}

async function steerTask(cfg, task, text) {
    var t = String(text || "").trim();
    if (!t) return { ok: false, task: task, message: "消息为空" };
    if (task.status === "closed") return { ok: false, task: task, message: "任务已关闭，不能追加" };
    task.turns.push({ role: "user", content: t });
    /* 【第七十三轮】system prompt 跟着刷新。
       为什么：key_points / context_text / skills 改了之后，turns[0] 里那份 system 还是老的，
       模型下一轮看到的仍是旧要求 —— 用户以为改好了，实际没生效。
       做法：重算一遍，有变化才替换；永远只改 turns[0]，不新增 system 轮。 */
    try {
        var sysNew = buildSystemPrompt(task, cfg);
        var si = -1;
        for (var qi = 0; qi < task.turns.length; qi++) {
            if (String((task.turns[qi] || {}).role || "") === "system") { si = qi; break; }
        }
        if (si >= 0) {
            if (String(task.turns[si].content || "") !== sysNew) task.turns[si].content = sysNew;
        } else if (sysNew) {
            task.turns.unshift({ role: "system", content: sysNew });
        }
    } catch (eSys) {}
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
        /* 【第七十四轮】转存范围从「只有 tool」扩到「tool + assistant 的正文」。
           原因：模型自己写一篇 5 万字分析时，旧逻辑完全不转存，下一轮照样超限。
           为什么不转 reasoning：思考是叙事主线，且多数端点不回传，转了也读不回来。
           为什么跳过最后一条：最新的工具结果/正文模型马上要用，转存等于白跑一步。 */
        var canSpill = (m.role === "tool" || m.role === "assistant") && j !== lastIdx && c.length >= EXTRACT_MIN_CHARS;
        if (!canSpill) {
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
        var what = (m.role === "tool") ? "这段工具返回共 " : "这段正文共 ";
        cp.content = "[内容过长已转存] " + what + c.length
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
            /* 【第七十四轮】单工具超时，缺省 120 秒（sb_tools 内部兜底） */
            tool_timeout_ms: Number(task.tool_timeout_ms || cfg.tool_timeout_ms || 0),
            roots: [task.workspace_resolved || "", task.product_dir || ""].filter(Boolean),
            nextSeq: function () { seq = seq + 1; return seq; },
            loadUndo: function () { return undo.items || []; },
            appendUndo: function (recs) { undo.items = (undo.items || []).concat(recs || []); undo.seq = seq; },
            clearUndo: function () { undo.items = []; undo.seq = seq; }
        };
        for (var i = 0; i < res.toolCalls.length; i++) {
            var tc = res.toolCalls[i];
            var req = tc.args && tc.args.tool ? tc.args : { tool: tc.name, args: tc.args || {} };
            /* 【第七十四轮】每次迭代都查取消。
               旧行为只在进循环前查一次（见 _advanceTaskInner 开头），
               模型一次返回 5 个工具时，用户点停止要等 5 个全跑完才生效。
               跳过的工具必须补一条 tool 消息 —— 否则下一轮模型看到 tool_calls
               没有对应的 tool 回复，端点直接 400。 */
            if (task.cancel) {
                for (var ci = i; ci < res.toolCalls.length; ci++) {
                    var tcC = res.toolCalls[ci] || {};
                    task.turns.push({
                        role: "tool",
                        tool_call_id: tcC.id,
                        name: String((tcC.args && tcC.args.tool) || tcC.name || ""),
                        args: "{}",
                        elapsed_ms: 0,
                        ok: false,
                        content: "已取消，未执行"
                    });
                }
                task.status = "cancelled";
                await saveUndo(task.id, undo);
                await saveTask(task);
                return { ok: false, task: task, message: "任务已取消（已执行的工具保留结果）" };
            }
            /* 【第七十四轮】循环检测：同工具同参数连续 3 次 = 原地打转。
               不直接失败，回一条提示让模型换路 —— 直接 fail 会让本来能救的任务白费。 */
            var dup = TOOLS.detectLoop(task, String(req.tool || tc.name), req.args || {});
            if (dup) {
                var loopMsg = "检测到重复调用：工具 " + String(req.tool || tc.name)
                    + " 用完全相同的参数已连续调用 " + dup.times + " 次，本次未执行。"
                    + "请换一个思路：换参数、换工具，或直接基于已有结果收尾。";
                moves.push({ tool: String(req.tool || tc.name), ok: false, chars: 0, error: loopMsg, ms: 0 });
                argsOut.push({ tool: String(req.tool || tc.name), args: clipText(JSON.stringify(req.args || {}), 120) });
                resultHeads.push({ tool: String(req.tool || tc.name), head: clipText(loopMsg, 150) });
                task.turns.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    name: String(req.tool || tc.name),
                    args: JSON.stringify(req.args || {}),
                    elapsed_ms: 0,
                    ok: false,
                    content: loopMsg
                });
                await saveTask(task);
                continue;
            }
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

/* 【第八十三轮】undo 落进任务自己的目录。id 找不到目录时退回 tasks/<id>。 */
async function _undoPathById(id) {
    var dir = await _findTaskDir(String(id || ""));
    if (!dir) dir = tasksDir() + "/" + String(id || "");
    return dir + "/undo.json";
}
async function loadUndo(id) {
    var raw = await readText(await _undoPathById(id));
    if (!raw) return { items: [], seq: 0 };
    try { return JSON.parse(raw); } catch (e) { return { items: [], seq: 0 }; }
}

async function saveUndo(id, undo) {
    try {
        var p = await _undoPathById(id);
        await mkdirs(p.slice(0, p.lastIndexOf("/")));
        await writeJson(p, undo || { items: [], seq: 0 });
    } catch (e) {}
}

/* 【第八十三轮】删任务：整个目录树一次删干净（任务本体 + undo + 产物）。
   同时从 index.json 移除条目。老单文件格式也一并清理。 */
async function deleteTask(taskOrId) {
    var t = null;
    if (taskOrId && typeof taskOrId === "object") t = taskOrId;
    else t = await loadTask(String(taskOrId || ""));
    var id = String((t && t.id) || taskOrId || "");
    if (!id) return false;
    /* 1) 新结构：整目录删 */
    var dir = await _findTaskDir(id);
    if (dir) { try { await Tools.Files.deleteFile(dir, true, "android"); } catch (e1) {} }
    /* 2) 老单文件 */
    try { await Tools.Files.deleteFile(tasksDir() + "/" + id + ".json", false, "android"); } catch (e2) {}
    /* 3) 老产物目录（迁移前留下的） */
    try { await Tools.Files.deleteFile(tempRoot() + "/" + id, true, "android"); } catch (e3) {}
    /* 4) 索引 */
    if (t) await _dropFromIndex(t);
    _listCache.at = 0; _listCache.data = null;
    return true;
}

/* 【第八十三轮】老数据迁移：tasks/<id>.json 单文件 + .products/<id>/ 目录
 * → tasks/<id>/task.json + 同目录下的 reports/work/undo。
 *
 * 【为什么要迁移】新结构 loadTask 优先找目录，老单文件只能兜底读。
 * 不迁移的话老任务的产物还在 .products（已弃用），undo 路径也对不上。
 *
 * 【安全】迁移前先把老 json 备份成 .bak，迁移失败可人工恢复。
 * 返回 { migrated, failed, skipped }。 */
async function migrateLegacy() {
    var res = { migrated: 0, failed: 0, skipped: 0, backup: "" };
    var legacyIds = [];
    try {
        var r = await Tools.Files.list(tasksDir(), "android");
        var arr = (r && r.entries) ? r.entries : [];
        for (var i = 0; i < arr.length; i++) {
            var n = String(arr[i].name || "");
            if (n === "index.json") continue;
            if (n.slice(-5) === ".json" && n.indexOf(".bak") < 0) legacyIds.push(n.slice(0, -5));
        }
    } catch (e) { return res; }
    if (!legacyIds.length) return res;
    for (var j = 0; j < legacyIds.length; j++) {
        var id = legacyIds[j];
        try {
            var rawOld = await readText(tasksDir() + "/" + id + ".json");
            if (!rawOld) { res.skipped++; continue; }
            var t = null;
            try { t = JSON.parse(rawOld); } catch (eP) { res.failed++; continue; }
            if (!t || !t.id) { res.failed++; continue; }
            /* 已迁移过（目录已存在）就跳过 */
            var exist = await readText(tasksDir() + "/" + id + "/task.json");
            if (exist) { res.skipped++; continue; }
            /* 建目录、搬产物、写 task.json */
            var dir = tasksDir() + "/" + id;
            await mkdirs(dir + "/reports");
            await mkdirs(dir + "/work");
            /* 老产物目录：能搬就搬，搬不了不影响任务本体 */
            try {
                var oldPD = String(t.product_dir || (tempRoot() + "/" + id));
                var pr = await Tools.Files.list(oldPD + "/reports", "android");
                var parr = (pr && pr.entries) ? pr.entries : [];
                for (var pi = 0; pi < parr.length; pi++) {
                    var pn = String(parr[pi].name || "");
                    if (!pn) continue;
                    try {
                        var content = await readText(oldPD + "/reports/" + pn);
                        if (content) await Tools.Files.write(dir + "/reports/" + pn, content, false, "android");
                    } catch (eRC) {}
                }
            } catch (eRep) {}
            /* undo：老的在 product_dir/undo.json */
            try {
                var uRaw = await readText(String(t.product_dir || (tempRoot() + "/" + id)) + "/undo.json");
                if (uRaw) await Tools.Files.write(dir + "/undo.json", uRaw, false, "android");
            } catch (eU) {}
            /* 改字段：product_dir 指向新目录 */
            t.product_dir = dir;
            await writeJson(dir + "/task.json", t);
            /* 备份老文件后删除 */
            try {
                await Tools.Files.write(tasksDir() + "/" + id + ".json.bak", rawOld, false, "android");
                await Tools.Files.deleteFile(tasksDir() + "/" + id + ".json", false, "android");
            } catch (eDel) {}
            /* 同步 index */
            await _syncIndex(t);
            res.migrated++;
        } catch (eOne) { res.failed++; }
    }
    _listCache.at = 0; _listCache.data = null;
    return res;
}

function dropCache(id) { _listCache.at = 0; _listCache.data = null; }

module.exports = {
    tempRoot: tempRoot,
    groupsRoot: groupsRoot,
    newTaskId: newTaskId,
    taskDirOf: taskDirOf,
    taskFilePath: taskFilePath,
    deleteTask: deleteTask,
    migrateLegacy: migrateLegacy,
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
