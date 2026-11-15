/*
 * 任务生命周期工具（从 subagent.js 拆出）
 *
 * 用途：spawn（建任务）/ advance / wait / status / result / undo / cancel / resume / steer /
 *       inbox / list / close / delete / trace —— 一个任务从创建到删除的全过程。
 * 为什么单独成文件：这是主代理最常用的一组工具，改动频率高；
 *       抽出来以后改任务流程不用在 METADATA 注释块之后翻几百行。
 * 依赖：sb_config / sb_task / sb_group / sb_bus / sb_llm / sb_tools / sb_skill / sb_ctx。
 * 入参：install(E, opts)
 *   E                    —— subagent.js 的 exports
 *   opts.complete        —— 宿主注入的 complete 回调，子模块拿不到全局，必须传
 *   opts.modelsTtl       —— 模型列表缓存 TTL（主文件常量）
 * 出参：无，直接往 E 上挂工具。
 */
var CFG = require("./sb_config.js");
var BUS = require("./sb_bus.js");
var LLM = require("./sb_llm.js");
var TOOLS = require("./sb_tools.js");
/* parseList/parseJson 原先在 subagent.js 顶层，拆分后拿不到；统一从 sb_parse.js 取。 */
var PARSE = require("./sb_parse.js");
var parseList = PARSE.parseList;
var parseJson = PARSE.parseJson;

/* clip 原先定义在 subagent.js 顶层，拆分后子模块拿不到。sb_tools 已导出同名函数，
   这里直接取用；否则 max_chars 分支一跑就抛 clip is not defined。 */
var clip = TOOLS.clip ? function (s, n) { return TOOLS.clip(s, n).text; } : function (s) { return String(s == null ? "" : s); };

var TASK = require("./sb_task.js");
var GRP = require("./sb_group.js");
var SKILL = require("./sb_skill.js");
var CTX = require("./sb_ctx.js");
var loadCtx = CTX.loadCtx;
var notifyDone = CTX.notifyDone;
var callerChatId = CTX.callerChatId;
var filterChatOf = CTX.filterChatOf;
var rootChatIdOf = CTX.rootChatIdOf;
var ancestorChatIdsOf = CTX.ancestorChatIdsOf;
var visibleTasks = CTX.visibleTasks;
var inboxSuffix = CTX.inboxSuffix;
var tsOf = CTX.tsOf;
var briefOf = CTX.briefOf;

module.exports = function install(E, opts) {
    var complete = opts && opts.complete;
    if (typeof complete !== "function") throw new Error("installToolTask: 缺 complete");
    var MODELS_TTL_BACKEND = (opts && opts.modelsTtl) || 0;

    /* 【第一百零二轮】收件箱硬拦截：未读 >=3 时，除 get/box/wait 外一律拒绝。
       主人要求：「收件箱有三个以上的、没读的，就强制让他读，不然不允许他执行任何工具」。
       只在 hook 写提示词不够——主代理会当噪音忽略，实测积到 11 条还在派新活。
       允许放行：get（取结论=读）、box（看清单）、wait（等已有任务）。 */
    function inboxGate(toolName) {
        try {
            var arr = BUS.list(callerChatId()) || [];
            if (arr.length < 3) return null;
            if (toolName === "get" || toolName === "box" || toolName === "wait") return null;
            var head = arr[0] || {};
            var hid = String(head.id || "");
            var Q2 = String.fromCharCode(34);
            return "收件箱积压 " + arr.length + " 条未读结论，先读完再干活（这不是建议，是强制）。"
                + (hid ? ("先取：subagent_get(id=" + Q2 + hid + Q2 + ")") : "先取：subagent_get(id=...)")
                + "。读完自动解除。";
        } catch (e) { return null; }
    }

    E.subagent_spawn = async function (params) {
        params = params || {};
        var _g0 = inboxGate("spawn");
        if (_g0) { complete({ success: false, message: _g0, data: { inbox_blocked: true } }); return; }
        var cfg = await CFG.load();
        var taskText = String(params.task == null ? "" : params.task).trim();
        /* 【第七十九轮】新参数名 tools 和旧名 allowed_tools 都认。
           METADATA 已改成 tools，但面板与老的外部调用还在用 allowed_tools，
           只认新名会让「按新声明传参」的调用拿到空白名单 —— 任务一个工具都没有。 */
        var allowed = parseList(params.tools != null ? params.tools : params.allowed_tools);
        /* all=true：放开全部工具。语义定调（2026-11-07 用户拍板）：
           留空 = 一个工具都用不了（空数组，白名单全拒）；
           要全放开必须显式传 all=true → 内部变成 ["*"]。
           "*" 在 sb_llm.runToolSchema 里会展开 sb_toolmeta 全表 + 留 run_tool 兜底表外包；
           在 sb_tools.matchAllowed 里匹配一切；但 isRecursive 仍会硬拦递归派子代理。 */
        if (params.all === true) allowed = ["*"];
        /* 【第七十九轮】tools="*" 等同于 old all=true。
           METADATA 里 all 已删掉，改由 tools 传 * 表达「全放开」，
           但面板与老调用仍可能传 all=true —— 两条都认。 */
        for (var ai = 0; ai < allowed.length; ai++) {
            if (String(allowed[ai]).trim() === "*") { allowed = ["*"]; break; }
        }
        var template = null;
        if (params.template_id) {
            var tpls = cfg.templates || [];
            for (var i = 0; i < tpls.length; i++) { if (tpls[i] && tpls[i].id === String(params.template_id)) { template = tpls[i]; break; } }
            if (!template) { complete({ success: false, message: "没有这个模板：" + params.template_id, data: {} }); return; }
            if (!taskText && template.task_template) taskText = String(template.task_template);
            if (!allowed.length && template.allowed_tools) allowed = parseList(template.allowed_tools);
        }
        if (!taskText) { complete({ success: false, message: "task 不能为空", data: {} }); return; }
        /* allowed_tools 不是必填，但语义是「留空 = 一个工具都用不了」（2026-11-07 用户拍板）。
           要放开全部必须显式传 all=true → 内部变成 ["*"]。
           注意：空数组不会 fallback 到 default_allowed_tools，否则面板路径与 advanceTask 路径
           对同一条规矩给出相反结果。 */
        if (allowed.length > 40) { complete({ success: false, message: "allowed_tools 过多（上限 40）", data: {} }); return; }
        var bad = [];
        for (var j = 0; j < allowed.length; j++) { if (TOOLS.isRecursive(allowed[j])) bad.push(allowed[j]); }
        if (bad.length) { complete({ success: false, message: "禁止递归派子代理：" + bad.join(", "), data: {} }); return; }

        var writeTools = [];
        for (var k = 0; k < allowed.length; k++) { if (TOOLS.isWriteTool(allowed[k])) writeTools.push(allowed[k]); }
        /* 【第六十六轮 · 用户定 B 方案】不再静默回落到 cfg.default_workspace。
           用户原话：「我在创建时并没有选择工作目录，你为什么还要去选择添加一个东西进去？」
           旧行为：不传 workspace 就自动拿 default_workspace（那个值还是早期插件旧路径），
           于是用户没选过目录，界面里却冒出一个 plugins/com.operit.subagent/workspace。
           现在：只认调用方显式传的 workspace / 模板里的 workspace，否则留空。
           留空时含写类工具会被下面拦下 —— 这就是要的效果（没选就不给写）。
           注：cfg.default_workspace 字段保留在配置文件里不删，老配置不会因此报错，
           但代码不再读它。 */
        var ws = String(params.workspace || template && template.workspace || "").trim();
        if (ws) {
            var wsInfo = null;
            try { wsInfo = await Tools.Files.exists(ws); } catch (e2) { wsInfo = null; }
            if (wsInfo && wsInfo.exists === false) {
                complete({ success: false, message: "workspace 不存在：" + ws, data: { workspace: ws } });
                return;
            }
            if (wsInfo && wsInfo.isDirectory === false) {
                complete({ success: false, message: "workspace 是文件不是目录：" + ws + "（请改填它所在目录）", data: { workspace: ws } });
                return;
            }
        }
        if (writeTools.length && !ws) {
            complete({ success: false, message: "含写类工具（" + writeTools.join(", ") + "），必须提供 workspace", data: { write_tools: writeTools } });
            return;
        }

        var ctxText = String(params.context_text || "");
        /* 【第六十五轮】skill 清单：逗号分隔或 all。all 展开成全部名字。
           为什么只传名字不传全文：全文几十万字会把上下文吃光，模型要用哪个自己读。 */
        var skillsArg = String(params.skills || "").trim();
        var skillsList = [];
        if (skillsArg) {
            if (skillsArg.toLowerCase() === "all") {
                try {
                    var _allSk = await SKILL.listSkills();
                    for (var _si = 0; _si < _allSk.length; _si++) skillsList.push(_allSk[_si].name);
                } catch (eSk2) { skillsList = []; }
            } else {
                var _parts = skillsArg.split(",");
                for (var _pi = 0; _pi < _parts.length; _pi++) {
                    var _one = String(_parts[_pi] || "").trim();
                    if (_one) skillsList.push(_one);
                }
            }
        }
        var ctxModeEarly = String(params.context_mode || "");
        if (!ctxText && (ctxModeEarly === "chat_tail" || ctxModeEarly === "fork" || ctxModeEarly === "summary")) {
            try {
                var pcid = String(params.parent_chat_id || "");
                /* 【自动取当前对话】ToolPkg API 1.2.0 的 getToolExecutionContext().chatId
                   就是发起本次工具调用的对话 id，比下面「取最近更新的对话」准得多：
                   用户在 A 对话里派活、B 对话刚好更新过，取最近会拿错。
                   老宿主没这个 API，所以 typeof 判存在 + 回退到原逻辑。 */
                if (!pcid) {
                    try {
                        if (typeof getToolExecutionContext === "function") {
                            var ec0 = getToolExecutionContext();
                            pcid = String((ec0 && ec0.chatId) || "");
                        }
                    } catch (eEc) { pcid = ""; }
                }
                if (!pcid) {
                    /* 同 subagent_chats：宿主校验 query 必填，优先 listAll */
                    var lr = null;
                    try {
                        if (Tools.Chat && typeof Tools.Chat.listAll === "function") lr = await Tools.Chat.listAll();
                    } catch (eLA) { lr = null; }
                    if (!lr) {
                        lr = await Tools.Chat.listChats({ query: "", match: "contains", sort_by: "updatedAt", sort_order: "desc", limit: 20 });
                    }
                    pcid = String((lr && lr.currentChatId) || "");
                    if (!pcid) {
                        var arr0 = (lr && (lr.chats || lr.items || lr.data)) || [];
                        if (arr0.length) pcid = String(arr0[0].id || arr0[0].chatId || "");
                    }
                }
                if (pcid) {
                    var need = ctxModeEarly === "chat_tail" ? 8 : (ctxModeEarly === "fork" ? 24 : 60);
                    /* 用户可指定带入条数，缺省按模式默认 */
                    var wantTurns = Number(params.context_turns || 0);
                    if (wantTurns > 0) need = Math.min(wantTurns, 120);
                    var mr = await Tools.Chat.getMessages(pcid, { order: "desc", limit: need });
                    var ms = (mr && (mr.messages || mr.items || mr.data)) || [];
                    var lines = [];
                    for (var mi = ms.length - 1; mi >= 0; mi--) {
                        var m = ms[mi] || {};
                        var role = String(m.sender || m.role || "");
                        if (role !== "user" && role !== "ai" && role !== "assistant") continue;
                        var tx = String(m.content || "").replace(/<[^>]+>/g, " ").trim();
                        if (!tx) continue;
                        lines.push((role === "user" ? "我：" : "AI：") + tx.slice(0, 600));
                    }
                    ctxText = lines.join("\n");
                }
            } catch (e) {}
        }
        var files = parseList(params.context_files);
        for (var f = 0; f < files.length; f++) {
            try {
                var r = await Tools.Files.read(files[f], "android");
                var body = (typeof r === "string") ? r : String((r && (r.content != null ? r.content : r.text)) || "");
                if (body) ctxText += "\n\n[文件] " + files[f] + "\n" + body;
            } catch (e) {}
        }
        if (ctxText.length > Number(cfg.inject_max_chars || 20000)) {
            complete({ success: false, message: "注入内容过长（" + ctxText.length + " 字符），上限 " + cfg.inject_max_chars, data: {} });
            return;
        }

        var kp = parseJson(params.key_points, template && template.key_points ? template.key_points : {});
        /* 【第八十二轮】任务归属：显式传的 parent_chat_id 优先，否则取当前调用对话。
           不能直接复用上面的 pcid —— 它只在 context_mode 命中时才赋值，
           分支外拿不到，直接用会把归属丢成空串。 */
        var ownerChat = String(params.parent_chat_id || "") || callerChatId();

        /* 【第八十三轮】群组处理。
         * group_create 是「非必要」参数：不写照常建任务，写了才建群组。
         * group 传群组码则是「加入已有群组」。
         *
         * 建群组要三样东西：
         *   code       6 位数字，由 hash(创始人 + 任务内容 + 时间) 得来
         *   group_dir  哈希目录名，路径用
         *   root_chat  血缘根，分支对话靠它认出同一个项目
         */
        var grpCode = "", grpDir = "", grpCreatedAt = 0, grpObj = null, grpCreated = false;
        var wantCreate = params.group_create != null ? String(params.group_create) : "";
        var wantJoin = params.group != null ? String(params.group) : "";
        if (wantCreate !== "" && wantCreate !== "false") {
            /* 建新群组。名字可以空（空就用任务标题前 20 字） */
            var founder = ownerChat;
            var rootCid = founder ? await rootChatIdOf(founder) : "";
            grpCreatedAt = Date.now();
            grpCode = await GRP.genCode(founder, String(taskText || ""), grpCreatedAt, GRP.codeExists);
            grpDir = GRP.hash6("g" + grpCode + String(grpCreatedAt));
            grpObj = await GRP.createGroup({
                code: grpCode,
                name: wantCreate === "true" ? String(taskText || "").slice(0, 20) : wantCreate,
                root_chat_id: rootCid || founder,
                founder_chat_id: founder,
                created_at: grpCreatedAt
            });
            grpCreated = true;
        } else if (wantJoin) {
            /* 加入已有群组：先校验权限，没 CREATE 位的人不能往里塞任务 */
            grpObj = await GRP.loadGroup(wantJoin);
            if (!grpObj) {
                complete({ success: false, message: "群组不存在：" + wantJoin, data: {} });
                return;
            }
            var memJ = GRP.resolveMember(grpObj, ownerChat);
            if (!memJ.ok) { complete({ success: false, message: memJ.reason, data: {} }); return; }
            if (!GRP.hasPerm(memJ.mask, GRP.PERM.CREATE)) {
                complete({ success: false, message: "你在该群组没有建子代理的权限（需要 CREATE 位）", data: { mask: memJ.mask } });
                return;
            }
            grpCode = String(grpObj.code || "");
            grpCreatedAt = Number(grpObj.created_at || 0);
            grpDir = GRP.hash6("g" + grpCode + String(grpCreatedAt));
        }

        var task = await TASK.createTask(cfg, {
            origin: String(params.origin || "agent"),
            parent_chat_id: ownerChat,
            group: grpCode || null,
            group_dir: grpDir || "",
            group_created_at: grpCreatedAt || 0,
            max_depth: Number(params.max_depth || 0),
            task: taskText, title: params.title || template && template.name || "",
            key_points: kp,
            allowed_tools: allowed,
            allow_danger: params.allow_danger === true,
            thinking_level: params.thinking_level || template && template.thinking_level || "medium",
            workspace_resolved: ws,
            context_mode: params.context_mode || template && template.context_mode || cfg.default_context_mode,
            context_text: ctxText,
            skills: skillsList,
            max_steps: params.max_steps, timeout_ms: params.timeout_ms,
            model: params.model, base_url: params.base_url,
            summary_level: params.summary_level, result_level: params.result_level
        });

        /* 【第七十九轮】新名 wait / budget 与旧名 sync / wait_ms 都认。
           wait 不传 budget 时不再用默认 30 秒，而是「一直等到结束（失败除外）」，
           用 deadline=0 表示不限。旧调用传了 sync+wait_ms 仍按老规矩跑，不会变慢。 */
        var wantWait = (params.wait === true) || (params.sync === true);
        var rawBudget = (params.budget != null) ? Number(params.budget) : ((params.wait_ms != null) ? Number(params.wait_ms) : 0);
        var waitMs = rawBudget > 0 ? Math.min(rawBudget, Number(cfg.wait_max_ms || 60000)) : 0;
        /* 建完立刻置 running + phase=queued_next：
           用户看到的「待开始」是因为 createTask 写的是 queued，要等第一次 advance 才变 running。
           但任务实际上马上要跑，所以这里直接标成 running，面板立刻显示「思考中」而不是「待开始」。
           注意：不写 phase=llm，因为还没真发请求；用 queued_next 表示「已排上，马上开跑」。 */
        /* 【第九十七轮】wait=false 必须真的在后台跑起来。
           踩过：这里只把 status 写成 running、phase 写成 queued_next，然后直接返回，
           根本没调 advanceTask —— 任务停在「已排上」原地不动，
           调用方看到「已建任务」以为在跑，实际永远不动，除非再手动 subagent_run。
           现在：先落盘状态，再起一个不 await 的后台推进循环。
           循环自己管步数上限与终态，异常一律落 failed，绝不静默。 */
        if (!wantWait) {
            task.status = "running";
            task.phase = "queued_next";
            task.phase_at = Date.now();
            try { await TASK.saveTask(task); } catch (eSP) {}
            /* 后台跑：不 await，不阻塞本次返回。
               用 setTimeout 0 让当前工具调用先返回，再开始推进。 */
            var bgTaskId = String(task.id || "");
            var bgMax = Number(task.max_steps || 20);
            setTimeout(function () {
                (async function () {
                    var cur2 = await TASK.loadTask(bgTaskId);
                    if (!cur2) return;
                    var guard = 0;
                    while (guard < bgMax) {
                        guard++;
                        var rr = await TASK.advanceTask(cfg, cur2);
                        notifyDone(rr && rr.task);
                        cur2 = (rr && rr.task) ? rr.task : cur2;
                        var stB = String(cur2.status || "");
                        if (stB === "done" || stB === "failed" || stB === "cancelled" || stB === "closed") break;
                        /* 被别处推进（busy）时等一会儿再看，不重复推 */
                        if (rr && rr.busy) { await new Promise(function (z) { setTimeout(z, 800); }); continue; }
                        if (!rr || !rr.ok) break;
                    }
                })().catch(function (eBg) {
                    try {
                        TASK.loadTask(bgTaskId).then(function (tk) {
                            if (!tk) return;
                            var stE = String(tk.status || "");
                            if (stE === "closed" || stE === "cancelled") return;
                            tk.status = "failed";
                            tk.error = "后台推进异常：" + String((eBg && eBg.message) || eBg);
                            tk.phase = "idle";
                            TASK.saveTask(tk);
                        });
                    } catch (e2) {}
                });
            }, 0);
        }
        if (wantWait) {
            /* waitMs=0 表示不设上限：一直推到 done/failed 或用户取消。
               上限预算时到点返回中途结果 + unfinished 引导。 */
            var deadline = waitMs > 0 ? (Date.now() + waitMs) : 0;
            var last = null;
            var lastMsg = "";
            var busyHits = 0;
            while (!deadline || Date.now() < deadline) {
                var r2 = await TASK.advanceTask(cfg, task);
                notifyDone(r2 && r2.task);
                /* 【第七十五轮】busy 单独处理。
                   并发时 advanceTask 返回 {ok:false, busy:true}，但任务本身在正常跑。
                   旧代码 if (!r2.ok) break; 会把它当失败跳出，
                   把「别人正在推」报成「没在预算内完成」——两件完全不同的事。 */
                if (r2 && r2.busy) {
                    busyHits++;
                    if (busyHits > 60) { lastMsg = String(r2.message || "任务持续被其他处推进"); break; }
                    await new Promise(function (rr) { setTimeout(rr, 800); });
                    continue;
                }
                last = r2;
                lastMsg = String(r2.message || lastMsg || "");
                if (r2.task && (r2.task.status === "done" || r2.task.status === "failed" || r2.task.status === "cancelled")) break;
                if (!r2.ok) break;
            }
            var cur = (last && last.task) ? last.task : task;
            /* 【第七十五轮】把「还在跑」和「真失败」分开。
               旧版 success 只看 status === "done"，中途返回也是 false，
               data.result 是 null，也没有 task_id / next ——
               调用方拿到 success:false 完全分不清是哪种情况。 */
            var stCur = String(cur.status || "");
            var unfinished = (stCur !== "done" && stCur !== "failed" && stCur !== "cancelled");
            var msgOut;
            if (stCur === "done") msgOut = "子代理完成（" + cur.step + " 步）";
            else if (unfinished) {
                msgOut = "任务还在跑（已 " + cur.step + "/" + cur.max_steps + " 步），未在等待预算内完成。"
                    + "继续推进：subagent_run(id=\"" + cur.id + "\", wait=true)";
            } else msgOut = (cur.error || lastMsg || "任务未完成");
            complete({
                success: stCur === "done",
                message: msgOut + inboxSuffix(callerChatId()),
                data: {
                    task: briefOf(cur),
                    task_id: cur.id,
                    unfinished: unfinished,
                    next: unfinished ? "run" : null,
                    summary: TASK.buildSummary(cur, params.detail || params.result_level || params.summary_level || cur.summary_level, cur.last),
                    result: stCur === "done" ? TASK.buildResult(cur, params.detail || params.result_level || cur.result_level) : null
                }
            });
            return;
        }

        /* 【第七十三轮】allowed_tools 为空时把后果说清楚。
           旧文案只有「已建任务 xxx」，用户以为能跑，advance 才撞「工具不在允许范围」。
           与 sb_hook.js 的「参数纪律」提示保持一致。 */
        var emptyTip = "";
        if (!allowed.length) {
            emptyTip = "（注意：tools 为空，这个子代理没有任何工具可用，只能凭上下文空想。"
                + "要让它读文件请传 tools=\"read_file\"，要全放开传 tools=\"*\"）";
        }
        /* 【第八十三轮】建了群组要把码告诉用户 —— 这是他们复制给别的 agent 的唯一凭证 */
        var grpTip = "";
        if (grpCreated && grpCode) {
            /* 【第九十六轮】群组码文案写完整。
               主人要求「应当出现在对话用户可以复制」「要提示用户这个是干什么的」。
               只写一句「复制给别的 agent」太含糊：不知道复制到哪、复制给谁、给了能干什么。
               这里按「是什么 / 给谁 / 给了能干什么 / 怎么收回」四件事写清楚。 */
            grpTip = ""
                + "\n\n【群组码 " + grpCode + "】"
                + "\n· 这是什么：本群组的识别码，6 位数字。"
                + "\n· 给谁用：复制给别的对话里的 agent，或粘贴到它们的提示词里。"
                + "\n· 给了能干什么：拿到码的 agent 能看见本组全部子代理的调用与从属关系，"
                + "可以往里派新任务（按权限位决定能不能推进、删除、管成员）。"
                + "\n· 怎么收回：subagent_group(action=kick, code=" + grpCode + ", chat_id=<对方对话id>)，"
                + "踢掉后对方再输码也进不来。"
                + "\n· 想作废整个群组：subagent_group(action=delete, code=" + grpCode + ")。";
        } else if (grpCode) {
            grpTip = "｜已加入群组 " + grpCode;
        }
        complete({ success: true, message: "已建任务 " + task.id + grpTip + emptyTip + inboxSuffix(callerChatId()), data: { task: briefOf(task), next: "run", allowed_count: allowed.length, group: grpCode || "", group_dir: grpDir || "", group_created: grpCreated } });
    };

    E.subagent_advance = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var task = await TASK.loadTask(String(params.id || ""));
        if (!task) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        /* 与 subagent_run 一致：两个参数名都认，max_steps 优先 */
        var n = Math.max(1, Math.min(3, Number(params.max_steps || params.steps || 1)));
        var last = null;
        for (var i = 0; i < n; i++) {
            last = await TASK.advanceTask(cfg, task);
            task = last.task || task;
            if (task.status === "done" || task.status === "failed" || task.status === "cancelled") break;
        }
        notifyDone(task);
        complete({
            success: !!last && !!last.ok,
            message: (last ? (last.message || "已推进") : "无变化") + inboxSuffix(callerChatId()),
            data: {
                task: briefOf(task),
                summary: TASK.buildSummary(task, params.summary_level || task.summary_level, task.last),
                result: task.status === "done" ? TASK.buildResult(task, task.result_level) : null
            }
        });
    };

    E.subagent_wait = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var task = await TASK.loadTask(String(params.id || ""));
        if (!task) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        var t = Math.min(Number(params.timeout_ms || 30000), Number(cfg.wait_max_ms || 60000));
        var deadline = Date.now() + t;
        while (Date.now() < deadline) {
            if (task.status === "done" || task.status === "failed" || task.status === "cancelled") break;
            var r = await TASK.advanceTask(cfg, task);
            task = r.task || task;
            if (!r.ok) break;
            try { await Tools.System.sleep(200); } catch (e) {}
        }
        notifyDone(task);
        complete({
            success: task.status === "done",
            message: task.status === "done" ? "已完成" : (task.error || "仍在运行"),
            data: {
                task: briefOf(task),
                summary: TASK.buildSummary(task, params.summary_level || task.summary_level, task.last),
                result: task.status === "done" ? TASK.buildResult(task, params.result_level || task.result_level) : null
            }
        });
    };

    E.subagent_status = async function (params) {
        params = params || {};
        var id = String(params.id || "");
        if (!id) {
            /* 【第八十三轮】可见范围走 visibleTasks */
            var visS = await visibleTasks(params, false);
            var items = [];
            for (var i = 0; i < visS.items.length; i++) items.push(briefOf(visS.items[i]));
            complete({ success: true, message: "共 " + items.length + " 个任务", data: { items: items, total: items.length, groups: visS.groups || [] } });
            return;
        }
        var t = await TASK.loadTask(id);
        if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        complete({
            success: true, message: t.status,
            data: {
                task: briefOf(t),
                summary: t.last || null,
                usage: t.usage, undo_count: (await TASK.loadUndo(id)).items ? (await TASK.loadUndo(id)).items.length : 0
            }
        });
    };

    E.subagent_result = async function (params) {
        if (params && params.id) { try { BUS.remove(String(params.id)); } catch (e0) {} }
        params = params || {};
        var ids = parseList(params.task_ids);
        if (!ids.length && params.id) ids = [String(params.id)];
        if (!ids.length) { complete({ success: false, message: "需要 id 或 task_ids", data: {} }); return; }
        var outs = [];
        var allDone = true;
        for (var i = 0; i < ids.length; i++) {
            var t = await TASK.loadTask(ids[i]);
            if (!t) { outs.push({ id: ids[i], ok: false, error: "找不到任务" }); allDone = false; continue; }
            if (t.status !== "done") allDone = false;
            var text = t.status === "done" ? TASK.buildResult(t, params.result_level || t.result_level) : null;
            if (text && params.max_chars) text = clip(text, Number(params.max_chars));
            outs.push({ id: t.id, ok: t.status === "done", status: t.status, steps: t.step, usage: t.usage, result: text });
        }
        var merged = ids.length > 1 ? outs.map(function (o) { return "== " + o.id + " ==\n" + (o.result || "（未完成：" + o.status + "）"); }).join("\n\n") : null;
        complete({ success: true, message: allDone ? ("已取回 " + outs.length + " 个任务结论") : "有任务未完成（结果仍返回）", data: { all_done: allDone, items: outs, merged: merged } });
    };

    E.subagent_undo = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var t = await TASK.loadTask(String(params.id || ""));
        if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        var ctx = await loadCtx(cfg, t);
        var dry = params.dry_run === undefined ? true : !!params.dry_run;
        /* 【第八十轮】undoAll 现在返回 { plan, warns }：
           warns 是「备份失败/越界未备份」条数，恢复不了的要明说。 */
        var res = await TOOLS.undoAll(ctx, dry);
        if (ctx.save) await ctx.save();
        var plan = res.plan || [];
        var warns = res.warns || 0;
        var msg = "【Beta】" + (dry ? ("将恢复 " + plan.length + " 项（未执行）") : ("已恢复 " + plan.length + " 项"));
        if (warns > 0) msg += "，其中 " + warns + " 项未备份成功、恢复不了（见 plan 里 error 字段）";
        msg += "（undo 为 Beta 功能：terminal 命令的写入不会备份，路径提取失败也会漏备，重要文件请先用 dry_run=true 看计划再执行）";
        complete({ success: true, message: msg, data: { dry_run: dry, plan: plan, warns: warns, beta: true } });
    };

    E.subagent_cancel = async function (params) {
        params = params || {};
        var t = await TASK.loadTask(String(params.id || ""));
        if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        t.cancel = true; t.status = "cancelled";
        await TASK.saveTask(t);
        complete({ success: true, message: "已取消", data: { id: t.id } });
    };

    /* 恢复任务：把 cancelled / failed / done 拉回 queued，清掉取消标记。
       面板「继续推进」在非 running 状态下会先走这里，否则 advanceTask 见到
       cancelled 会直接返回，永远推不动。 */
    E.subagent_resume = async function (params) {
        params = params || {};
        var t = await TASK.loadTask(String(params.id || ""));
        if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        if (t.status === "running") { complete({ success: true, message: "任务正在运行", data: { id: t.id, status: t.status } }); return; }
        var was = t.status;
        t.cancel = false;
        t.error = null;
        t.status = "queued";
        /* 已用完步数时给一次新预算，否则一推就报「超出步数上限」 */
        if (Number(t.step || 0) >= Number(t.max_steps || 0)) {
            t.max_steps = Number(t.step || 0) + Number(t.max_steps || 20);
        }
        await TASK.saveTask(t);
        complete({ success: true, message: "已恢复（" + (was || "未知") + " → 待开始）", data: { id: t.id, status: t.status, step: t.step, max_steps: t.max_steps } });
    };

    E.subagent_steer = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var t = await TASK.loadTask(String(params.id || ""));
        if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        var r = await TASK.steerTask(cfg, t, String(params.message || ""));
        complete({ success: r.ok, message: r.message, data: { id: t.id, step: t.step, status: t.status, next: r.ok ? "advance" : null } });
    };
    E.subagent_inbox = async function (params) {
        params = params || {};
        if (String(params.action || "") === "read") {
            /* 【第一百零一轮】清空不等于读过。
               踩过：主人要求「收件箱 ≥3 条必须先逐条读完」，结果我用 action=read
               一键清空 11 条，等于把 11 条结论全绕过——内容一条没看，未读数归零。
               这跟直接删收件箱没区别。
               现在：清空前先看这一轮有没有真读过（BUS 记 readIds），
               没读过的条数 > 0 就拒绝清空，并列出该读哪些。 */
            var unread = [];
            try { unread = BUS.list(callerChatId()) || []; } catch (e) { unread = []; }
            var readIds = {};
            try { readIds = BUS.readIds ? (BUS.readIds(callerChatId()) || {}) : {}; } catch (e) { readIds = {}; }
            var notRead = [];
            for (var i = 0; i < unread.length; i++) {
                var uid = String((unread[i] || {}).id || "");
                if (uid && !readIds[uid]) notRead.push(uid);
            }
            if (notRead.length) {
                complete({
                    success: false,
                    message: "不能直接清空：还有 " + notRead.length + " 条没读过（清空不等于读过）。"
                        + "请先逐条取：subagent_get(id=\"" + notRead[0] + "\")"
                        + (notRead.length > 1 ? ("，其余 " + (notRead.length - 1) + " 条同理") : ""),
                    data: { blocked: true, not_read: notRead, total: unread.length }
                });
                return;
            }
            var n = 0;
            try { n = BUS.clear ? BUS.clear() : 0; } catch (e) { n = 0; }
            complete({ success: true, message: "已清空收件箱（" + n + " 条，均已读过）", data: { cleared: n } });
            return;
        }
        /* 只报真实可观测的数据：
           - count：收件箱未读条数
           - hook_calls：钩子被宿主真正调用的次数（写在 SharedPreferences，跨引擎可读）
             这个数是判断「提示词钩子到底会不会被触发」的唯一依据。
             恒 0 且 skips 也为 0 = 宿主没调这个钩子，写法再对也是空转。
           - hook_disabled_skips：钩子被调了但开关关着而跳过的次数
             calls>0 且 skips>0 = 钩子在调，是用户主动关掉的，不是坏了
           - hook_last_at：上次钩子被调用的时间戳（毫秒，0 = 从未调用）
           - hook_enabled：钩子开关当前状态 */
        var st = BUS.stat();
        /* 【第七十六轮】自愈：收件箱里对应任务已不存在的，自动出箱。
           为什么：未读的本质是「子代理产出了结论、用户还没取走」，
           任务（对话）都不在了，这条结论无从取起，留着只会让未读数永远不降。
           用户原话：「我在删除对话之后，这个未读消息它不会减少，
           这个未读消息应当是检测对话状态的」。
           覆盖场景：任务文件被外部删掉、装了新包丢了 tasks 目录、
           或者早期版本删除时没清理收件箱。 */
        var pruned = 0;
        try {
            /* 【第八十二轮】清理必须看全量：别的对话的邮件对应任务删了也要出箱，
               否则那些对话的未读数永远不降。 */
            var allMails = BUS.listAll();
            for (var pi = 0; pi < allMails.length; pi++) {
                var mid = String((allMails[pi] || {}).id || "");
                if (!mid) continue;
                var mt = await TASK.loadTask(mid);
                /* 任务已不存在 → 出箱 */
                if (!mt) { try { BUS.remove(mid); pruned++; } catch (eP) {} continue; }
                /* 【第七十七轮】任务还在但不该在箱里的旧数据也顺手清掉：
                   origin=ui（用户自己建的）+ failed（失败不是结论）。
                   这两条是新的入箱判据，装包前积下的旧邮件靠这里自愈。 */
                var mo = String(mt.origin || "");
                if (mo === "ui" || String(mt.status || "") === "failed") {
                    try { BUS.remove(mid); pruned++; } catch (eP2) {}
                }
            }
            if (pruned > 0) st = BUS.stat();
        } catch (ePr) {}
        var calls = 0, skips = 0, lastAt = 0, enabled = true;
        try {
            var p = Java.getApplicationContext().getSharedPreferences("subagent_inbox", 0);
            if (p) {
                calls = Number(p.getInt("hook_calls", 0)) || 0;
                skips = Number(p.getInt("hook_disabled_skips", 0)) || 0;
                lastAt = Number(p.getLong("hook_last_at", 0)) || 0;
            }
        } catch (eC) { calls = 0; skips = 0; lastAt = 0; }
        try {
            var HK = require("./sb_hook.js");
            enabled = HK.hookEnabled();
        } catch (eH) { enabled = true; }
        /* 上次调用距今多久：比裸时间戳直观，排查时一眼能看出钩子是不是还活着 */
        var agoTxt = "从未";
        if (lastAt > 0) {
            var sec = Math.floor((Date.now() - lastAt) / 1000);
            if (sec < 60) agoTxt = sec + " 秒前";
            else if (sec < 3600) agoTxt = Math.floor(sec / 60) + " 分钟前";
            else if (sec < 86400) agoTxt = Math.floor(sec / 3600) + " 小时前";
            else agoTxt = Math.floor(sec / 86400) + " 天前";
        }
        complete({
    success: true,
            message: "未读 " + st.count + " 条；钩子调用 " + calls + " 次（上次 " + agoTxt
                + "，开关" + (enabled ? "已开启" : "已关闭") + (skips > 0 ? "，关闭期间跳过 " + skips + " 次" : "")
                + (pruned > 0 ? "；已清掉 " + pruned + " 条对应任务已删除的" : "") + "）",
            data: {
                count: st.count,
                hook_calls: calls,
                hook_disabled_skips: skips,
                hook_last_at: lastAt,
                hook_enabled: enabled,
                items: BUS.list(filterChatOf(params))
            }
        });
    };
    E.subagent_list = async function (params) {
        params = params || {};
        /* 【第八十三轮】面板传 all=true 时拿全集（不过滤）；
           否则走 visibleTasks（血缘链 + 有权群组）。 */
        var vis = (params.all === true)
            ? { items: await TASK.listTasks(false) }
            : await visibleTasks(params, false);
        var unread = 0;
        try { unread = BUS.list(callerChatId()).length; } catch (eU) { unread = 0; }
        var items = [];
        for (var i = 0; i < vis.items.length; i++) items.push(briefOf(vis.items[i], unread));
        var u = await TASK.loadUsage();
        complete({ success: true, message: "共 " + items.length + " 个任务", data: { items: items, total: items.length, usage: u, groups: vis.groups || [], group: vis.group ? String(vis.group.code || "") : "" } });
    };

    E.subagent_close = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var t = await TASK.loadTask(String(params.id || ""));
        if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        if (params.confirm !== true) {
            var undo0 = await TASK.loadUndo(t.id);
            complete({
                success: true,
                message: "未关闭：已返回当前进度。确认关闭传 confirm=true；要丢弃产物再传 delete_product=true",
                data: {
                    need_confirm: true,
                    task: briefOf(t),
                    last: t.last || null,
                    undo_count: (undo0.items || []).length,
                    result_preview: t.result ? String(t.result).slice(0, 500) : null
                }
            });
            return;
        }
        var restored = null;
        var rollbackWarn = 0;
        if (params.rollback === true) {
            var ctx = await loadCtx(cfg, t);
            restored = await TOOLS.undoAll(ctx, false);
            if (ctx.save) await ctx.save();
            rollbackWarn = (restored && restored.warns) || 0;
        }
        if (params.delete_product === true) {
            try { await Tools.Files.deleteFile(t.product_dir, true, "android"); } catch (e) {}
        }
        t.status = "closed";
        await TASK.saveTask(t);
        var closeMsg = "已关闭" + (params.rollback === true ? "并回滚" : "");
        if (rollbackWarn > 0) closeMsg += "（" + rollbackWarn + " 项未备份成功、恢复不了）";
        complete({ success: true, message: closeMsg, data: { id: t.id, restored: restored } });
    };

    E.subagent_delete = async function (params) {
        params = params || {};
        var id = String(params.id || "");
        if (!id) { complete({ success: false, message: "缺少 id", data: {} }); return; }
        var t = await TASK.loadTask(id);
        if (!t) {
            try { await Tools.Files.deleteFile(CFG.baseDir() + "/tasks/" + id + ".json", false, "android"); } catch (e) {}
            /* 任务文件已不在，收件箱里若还留着这条也要一并出箱 ——
               否则会变成「点删除没反应，未读数也不降」的死角。 */
            try { BUS.remove(id); } catch (eB) {}
            complete({ success: true, message: "任务文件已删除", data: { id: id } });
            return;
        }
        if (params.confirm !== true) {
            complete({
                success: true,
                message: "未删除：确认请传 confirm=true（会同时删掉任务记录、产物目录与快照）",
                data: { need_confirm: true, task: briefOf(t), turns: (t.turns || []).length }
            });
            return;
        }
        /* 【第八十三轮】新结构：任务是一棵自足目录树，一次删干净。
           TASK.deleteTask 内部会处理新旧两种格式 + 清 index.json。 */
        try { await TASK.deleteTask(t || id); } catch (eDel) {}
        /* 3. 收件箱里这条结论一并出箱。
           为什么：未读的本质是「子代理产出了结论、用户还没取走」。
           对话（任务）都删了，那条结论也就无从取起，留着只会让未读数永远不降。
           用户原话：「我在删除对话之后，这个未读消息它不会减少，
           这个未读消息应当是检测对话状态的」。 */
        try { BUS.remove(id); } catch (eB) {}
        TASK.dropCache(id);
        complete({ success: true, message: "已删除任务", data: { id: id, deleted: true } });
    };
    E.subagent_trace = async function (params) {
        params = params || {};
        var t = await TASK.loadTask(String(params.id || ""));
        if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        var limit = Math.max(1, Math.min(50, Number(params.limit || 10)));
        var turns = t.turns || [];
        var start = Math.max(0, turns.length - limit);
        /* 面板传 compact=true 时压小单条正文，首次打开更快；点开详情再单独取全文 */
        var cap = params.compact === true ? 1200 : 4000;
        var capRes = params.compact === true ? 1800 : 6000;
        var out = [];
        /* system 不在 limit 窗口里也要单独补在最前：它是子代理全部指令来源，
           面板流式直连拿不到它就只能瞎猜，等于功能失效。 */
        for (var si = 0; si < turns.length; si++) {
            var sm = turns[si] || {};
            if (String(sm.role || "") !== "system") continue;
            out.push({ role: "system", content: clip(String(sm.content || ""), 6000) });
            break;
        }
        for (var i = start; i < turns.length; i++) {
            var m = turns[i] || {};
            var role = String(m.role || "");
            /* 上面已单独补过 system，这里跳过避免重复 */
            if (role === "system") continue;
            var item = { role: role, chars: String(m.content || "").length, at: m.at || null, elapsed_ms: Number(m.elapsed_ms || 0) };
            if (role === "assistant") {
                item.content = clip(String(m.content || ""), cap);
                if (m.reasoning) item.reasoning = clip(String(m.reasoning), cap);
                if (m.finish_reason) item.finish_reason = String(m.finish_reason);
                if (m.usage) item.usage = { in: Number(m.usage.in || 0), out: Number(m.usage.out || 0), model: String(m.usage.model || "") };
                if (m.tool_calls && m.tool_calls.length) {
                    item.tool_calls = m.tool_calls.map(function (tc) {
                        var fn = tc.function || {};
                        return { id: String(tc.id || ""), name: String(fn.name || ""), args: clip(String(fn.arguments || ""), cap) };
                    });
                }
            } else if (role === "tool") {
                item.name = String(m.name || "");
                item.args = clip(String(m.args || ""), 2000);
                item.ok = (m.ok !== false);
                item.calls_id = String(m.tool_call_id || "");
                item.result = clip(String(m.content || ""), capRes);
            } else {
                item.content = clip(String(m.content || ""), 2000);
            }
            out.push(item);
        }
        complete({
            success: true,
            message: "最近 " + out.length + " 条",
            data: {
                id: t.id, title: t.title, status: t.status, step: t.step,
                max_steps: t.max_steps, usage: t.usage,
                /* 阶段：idle / llm / tool，前端靠它显示「模型在生成」或「正在跑某工具」 */
                phase: String(t.phase || "idle"),
                phase_at: Number(t.phase_at || 0),
                tool_now: String(t.tool_now || ""),
                step_at: Number(t.step_at || 0),
                /* 流式过程中的临时落盘：面板退出再进来时用它恢复已生成的内容，
                   不用重新跑一遍（重跑会叠出 35KB 的重复内容）。 */
                pending: t.pending ? {
                    think: String(t.pending.think || ""),
                    body: String(t.pending.body || ""),
                    at: Number(t.pending.at || 0)
                } : null,
                created_at: tsOf(t.created_at), updated_at: tsOf(t.updated_at || t.last_at),
                workspace_resolved: t.workspace_resolved || "", product_dir: t.product_dir || "",
                total_turns: turns.length, shown: out.length,
                last: t.last || null,
                thinking_note: "思考内容取决于端点是否返回 reasoning_content；未返回时这里看不到",
                turns: out
            }
        });
    };
};
