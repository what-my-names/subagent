/*
 * 大类 dispatch 层（从 subagent.js 拆出）
 *
 * 用途：run / get / ctrl / group / box / del / update / cfg / env 九个「大类」工具。
 *       每个大类按 action 或参数分流，参数白名单由 _wlCheck 硬校验。
 * 为什么单独成文件：这是模型实际看到的工具面，改分流规则最频繁；
 *       抽出来以后调参数不再受 METADATA 注释块体积影响。
 * 重要：内部调用的 subagent_trace / _inbox / _delete / _config 等旧名，
 *       由其他模块 install 到同一个 exports 对象上；本模块必须最后 install，
 *       否则 E 上还没有那些函数（调用时才报 undefined）。
 * 入参：install(E, opts)
 *   E             —— subagent.js 的 exports
 *   opts.complete —— 宿主注入的 complete 回调，必须传
 * 出参：无，直接往 E 上挂九个大类工具。
 */
var CFG = require("./sb_config.js");
var BUS = require("./sb_bus.js");
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
var CTX = require("./sb_ctx.js");
var loadCtx = CTX.loadCtx;
var notifyDone = CTX.notifyDone;
var callerChatId = CTX.callerChatId;
var callerChatIdAsync = CTX.callerChatIdAsync;
var ancestorChatIdsOf = CTX.ancestorChatIdsOf;
var visibleTasks = CTX.visibleTasks;
var inboxSuffix = CTX.inboxSuffix;
var briefOf = CTX.briefOf;

module.exports = function install(E, opts) {
    var complete = opts && opts.complete;
    if (typeof complete !== "function") throw new Error("installToolMain: 缺 complete");

    /* ─────────────────────────────────────────────────────────────
       【第七十九轮】大类 dispatch 层（37 → 16，用户定的 MC 指令风格）

       设计（plan 第七十九轮）：
       - 不重写函数体：旧 exports 函数是验证过的正确实现，新工具解析大类
         参数后调用旧函数（经内部包装，绕过 complete 的重复调用）。
       - 新旧并存：METADATA 只列 16 个新名（宿主按 METADATA 给模型暴露工具）；
         面板走 callTool 直接调旧名，不经 METADATA，不受影响。
       - 参数白名单：ctrl 等多 action 工具，传了不属于该 action 的参数
         必须明确报错（用户定过：不能静默忽略，否则模型以为生效了）。

       注意：这里复用旧函数的方式是「直接调用 exports 函数并拦截 complete」。
       complete 是宿主注入的全局，无法拦截 —— 因此旧函数需要可以无副作用地
       被调用，返回值经由 complete 输出。dispatch 层不能这样复用。
       替代方案：把旧函数体里 complete 前的「计算部分」没有抽出来过，
       所以 dispatch 层改为【转发参数 + 信任旧函数】不可行。
       最终方案：dispatch 层自带核心逻辑（ advance 循环 / get 分流 / ctrl 分流），
       直接调 TASK / BUS / TOOLS 等底层模块 —— 与旧函数同源但不经过旧 exports。
       旧 exports 保持原名不动（面板用）。
       ───────────────────────────────────────────────────────────── */
    var ADV = require("./sb_task.js");
    var CFGM = require("./sb_config.js");

    /* 通用：参数白名单校验
       入：params 对象, 允许的参数名数组, action 名（用于报错文案）
       出：null = 通过；字符串 = 错误信息 */
    function _wlCheck(params, allowed, actionName) {
        var extra = [];
        for (var k in params) {
            if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
            /* 【第八十一轮】路由参数统一放行：这些参数是用来「选分支」的，
               每个分支的白名单不必各自重复列，否则会出现
               「step="check" 被 update(check) 自己拦掉」这类自伤。
               id/action/target/what/step/wait/ids/dry_run 一律放行。 */
            /* 【第八十七轮·修 P0】name 也加入路由参数放行。
               踩坑：METADATA 里 subagent_cfg 的 name 写着「目标 profile 或模板名」，
               模型按 schema 传了，但白名单没放行 → 直接被拒「不接受参数：name」，
               use/rm/add 三个动作全废。name 和 step/action 一样是选分支用的，
               属于同一类，不该让每个分支各列一遍。 */
            if (k === "id" || k === "action" || k === "target" || k === "what"
                || k === "step" || k === "wait" || k === "ids" || k === "dry_run"
                || k === "name") continue;
            /* 【第七十九轮】宿主注入的内部键放行：每次工具调用 Operit 都会自动带上
               __operit_* 系列与 containerPackageName/toolPkgId 等，这些不是模型传的，
               不能拦。以 __operit_ 前缀或已知宿主键名识别。 */
            if (k.indexOf("__operit_") === 0) continue;
            if (k === "containerPackageName" || k === "toolPkgId") continue;
            if (allowed.indexOf(k) < 0) extra.push(k);
        }
        if (extra.length) {
            return "action=" + actionName + " 不接受参数：" + extra.join(", ")
                + "（该 action 只接受：" + allowed.join(", ") + "）。参数传错会被忽略造成误解，所以这里直接报错。";
        }
        return null;
    }

    /* ── run：推进任务（原 advance + wait 合并） ──
       id 必填。wait=false 推 max_steps 步（上限 3）；wait=true 在 budget 内推到终态。
       budget 缺省 30000、最大 60000（wait=true 时生效）。detail 控制进度摘要。 */
    E.subagent_run = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var id = String(params.id || "");
        if (!id) { complete({ success: false, message: "缺少 id（先从 spawn 的返回里拿）", data: {} }); return; }
        var wait = params.wait === true;
        var detail = String(params.detail || "standard");
        if (!wait) {
            var wl = _wlCheck(params, ["steps", "detail", "max_steps"], "run(wait=false)");
            if (wl) { complete({ success: false, message: wl, data: {} }); return; }
            /* 复用旧 advance 逻辑：直接走 exports（它内部会 complete）——不可行，
               所以这里手动做一轮 advance 的等价物：调 TASK.advanceTask 后自己 complete。 */
            var task = await TASK.loadTask(id);
            if (!task) { complete({ success: false, message: "找不到任务 " + id, data: {} }); return; }
            /* 【第八十七轮·修 P0】steps 与 max_steps 统一。
               历史原因：旧 subagent_advance 读 params.steps，新 subagent_run 读 params.max_steps，
               而两者的参数白名单都同时放行了 steps 和 max_steps —— 结果是
               调用方传 steps 给 run 时被静默忽略（死参数），传 max_steps 给旧 advance 也一样。
               这里两个都认，max_steps 优先（新名），保证新旧调用方行为一致。 */
            var n = Math.max(1, Math.min(3, Number(params.max_steps || params.steps || 1)));
            var last = null;
            for (var i = 0; i < n; i++) {
                last = await TASK.advanceTask(cfg, task);
                task = last.task || task;
                if (task.status === "done" || task.status === "failed" || task.status === "cancelled" || task.status === "closed") break;
            }
            notifyDone(task);
            complete({
                success: !!last && !!last.ok,
                message: (last ? (last.message || "已推进") : "无变化") + inboxSuffix(callerChatId()),
                data: {
                    task: briefOf(task),
                    summary: TASK.buildSummary(task, detail === "brief" ? "t0" : (detail === "full" ? "t2" : "t1"), task.last),
                    result: task.status === "done" ? TASK.buildResult(task, detail) : null
                }
            });
            return;
        }
        /* wait=true：循环推到终态或 budget 尽 */
        var wl2 = _wlCheck(params, ["budget", "detail"], "run(wait=true)");
        if (wl2) { complete({ success: false, message: wl2, data: {} }); return; }
        var budget = Math.min(Number(params.budget || 30000), Number((await CFG.load()).wait_max_ms || 60000));
        var deadline = Date.now() + budget;
        var taskW = await TASK.loadTask(id);
        if (!taskW) { complete({ success: false, message: "找不到任务 " + id, data: {} }); return; }
        var lastW = null, lastMsg = "", busyHits = 0;
        while (Date.now() < deadline) {
            var r = await TASK.advanceTask(cfg, taskW);
            notifyDone(r && r.task);
            if (r && r.busy) {
                busyHits++;
                if (busyHits > 60) { lastMsg = String(r.message || "任务持续被其他处推进"); break; }
                await new Promise(function (rr) { setTimeout(rr, 800); });
                continue;
            }
            lastW = r;
            lastMsg = String(r.message || lastMsg || "");
            taskW = r.task || taskW;
            if (taskW.status === "done" || taskW.status === "failed" || taskW.status === "cancelled" || taskW.status === "closed") break;
            if (!r.ok) break;
        }
        var cur = (lastW && lastW.task) ? lastW.task : taskW;
        var stCur = String(cur.status || "");
        var unfinished = (stCur !== "done" && stCur !== "failed" && stCur !== "cancelled" && stCur !== "closed");
        var msgOut;
        if (stCur === "done") msgOut = "子代理完成（" + cur.step + " 步）";
        else if (unfinished) {
            msgOut = "任务还在跑（已 " + cur.step + "/" + cur.max_steps + " 步），未在预算内完成。"
                + "继续：subagent_run(id=\"" + cur.id + "\", wait=true)";
        } else msgOut = (cur.error || lastMsg || "任务未完成");
        complete({
            success: stCur === "done",
            message: msgOut + inboxSuffix(callerChatId()),
            data: {
                task: briefOf(cur),
                task_id: cur.id,
                unfinished: unfinished,
                next: unfinished ? "run" : null,
                summary: TASK.buildSummary(cur, detail === "brief" ? "t0" : (detail === "full" ? "t2" : "t1"), cur.last),
                result: stCur === "done" ? TASK.buildResult(cur, detail) : null
            }
        });
    };

    /* ── get：取产出（原 result + trace + status + list） ──
       不传 id/ids → 列全部任务概览（原 status 无 id / list）。
       传 id → detail 决定：brief/standard/full = 结论；trace = 逐步明细（limit 生效）。 */
    E.subagent_get = async function (params) {
        params = params || {};
        var ids = [];
        if (params.ids) ids = parseList(params.ids);
        if (!ids.length && params.id) ids = [String(params.id)];
        var detail = String(params.detail || "standard");
        /* 分支一：列全部 */
        if (!ids.length) {
            var wl0 = _wlCheck(params, ["all", "group"], "get(列表)");
            if (wl0) { complete({ success: false, message: wl0, data: {} }); return; }
            /* 【第八十三轮】可见范围走 visibleTasks：血缘链 + 有权群组。
               group="list" 时改列「我有权访问的群组」而不是任务。 */
            if (String(params.group || "") === "list") {
                var cidL = callerChatId();
                var chainL = await ancestorChatIdsOf(cidL);
                var gs = await GRP.listGroupsFor(cidL, chainL.length ? chainL[chainL.length - 1] : cidL);
                complete({
                    success: true,
                    message: "共 " + gs.length + " 个群组",
                    data: { groups: gs, total: gs.length }
                });
                return;
            }
            /* 【第八十三轮】all=true 不过滤，直接列全量（面板用） */
            var vis;
            if (params.all === true) {
                /* 面板要按群组分组显示，必须知道「群组码 → 群组名」。
                   单给任务列表只能显示一串 6 位数字，用户看不出这是哪个项目。
                   all=true 是面板专用通道，顺手把群组清单一起带回去，省一次往返。 */
                var cidA = callerChatId();
                var chainA = await ancestorChatIdsOf(cidA);
                var gsA = await GRP.listGroupsFor(cidA, chainA.length ? chainA[chainA.length - 1] : cidA);
                vis = { items: await TASK.listTasks(false), groups: gsA };
            } else {
                vis = await visibleTasks(params, false);
            }
            if (vis.err) { complete({ success: false, message: vis.err, data: {} }); return; }
            var unreadN = 0;
            try { unreadN = BUS.list(callerChatId()).length; } catch (eU) { unreadN = 0; }
            var items = [];
            for (var i = 0; i < vis.items.length; i++) items.push(briefOf(vis.items[i], unreadN));
            var msg0 = "共 " + items.length + " 个任务";
            if (vis.group) msg0 += "（群组 " + String(vis.group.code || "") + (vis.group.readonly ? "，只读" : "") + "）";
            if (vis.groups && vis.groups.length) msg0 += "｜可见群组 " + vis.groups.length + " 个";
            complete({
                success: true, message: msg0,
                data: {
                    items: items, total: items.length,
                    group: vis.group ? { code: String(vis.group.code || ""), name: String(vis.group.name || ""), readonly: !!vis.group.readonly } : null,
                    mask: vis.mask != null ? vis.mask : null,
                    groups: vis.groups || []
                }
            });
            return;
        }
        /* 分支二：trace
           【第八十三轮】面板统一走 get(detail=trace)。为保证面板渲染不返工，
           这里直接把请求转给 subagent_trace —— 返回结构与旧 trace 完全一致
           （含 turns / phase / pending / last 等全套字段）。 */
        if (detail === "trace") {
            var wlT = _wlCheck(params, ["detail", "limit", "max_chars", "compact"], "get(detail=trace)");
            if (wlT) { complete({ success: false, message: wlT, data: {} }); return; }
            return await E.subagent_trace({ id: ids[0], limit: params.limit, compact: params.compact });
        }
        /* 分支三：结论（单个或多个） */
        var wlR = _wlCheck(params, ["max_chars"], "get(结论)");
        if (wlR) { complete({ success: false, message: wlR, data: {} }); return; }
        var outs = [];
        var allDone = true;
        for (var j = 0; j < ids.length; j++) {
            var tid = ids[j];
            if (params.id) { try { BUS.remove(tid); } catch (eR) {} }
            var tt = await TASK.loadTask(tid);
            if (!tt) { outs.push({ id: tid, ok: false, error: "找不到任务" }); allDone = false; continue; }
            if (tt.status !== "done") allDone = false;
            var text = tt.status === "done" ? TASK.buildResult(tt, detail) : null;
            if (text && params.max_chars) text = clip(text, Number(params.max_chars));
            outs.push({ id: tt.id, ok: tt.status === "done", status: tt.status, steps: tt.step, usage: tt.usage, result: text, task: briefOf(tt) });
        }
        var merged = ids.length > 1 ? outs.map(function (o) { return "== " + o.id + " ==\n" + (o.result || "（未完成：" + o.status + "）"); }).join("\n\n") : null;
        complete({ success: true, message: allDone ? ("已取回 " + outs.length + " 个任务结论") : "有任务未完成（结果仍返回）", data: { all_done: allDone, items: outs, merged: merged } });
    };

    /* ── ctrl：改运行状态（原 cancel + resume + steer + close） ──
       action 四值，参数白名单严格校验。 */
    E.subagent_ctrl = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var id = String(params.id || "");
        if (!id) { complete({ success: false, message: "缺少 id", data: {} }); return; }
        var action = String(params.action || "");
        var t = await TASK.loadTask(id);
        if (!t && action !== "resume") { complete({ success: false, message: "找不到任务 " + id, data: {} }); return; }
        if (action === "cancel") {
            var wlC = _wlCheck(params, [], "ctrl(cancel)");
            if (wlC) { complete({ success: false, message: wlC, data: {} }); return; }
            if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
            t.cancel = true;
            await TASK.saveTask(t);
            complete({ success: true, message: "已请求停止（下一步生效）", data: { id: t.id, status: t.status, next: "run" } });
            return;
        }
        if (action === "resume") {
            var wlRs = _wlCheck(params, [], "ctrl(resume)");
            if (wlRs) { complete({ success: false, message: wlRs, data: {} }); return; }
            if (!t) { complete({ success: false, message: "找不到任务 " + id, data: {} }); return; }
            /* 【第九十四轮】已关闭的任务默认不许复活。
               关闭的语义就是「这个对话结束了」，要再跑必须显式重新建任务。
               否则面板点「继续推进」会自动 resume，关闭等于没关。 */
            if (String(t.status || "") === "closed") {
                complete({ success: false, message: "任务已关闭，不能恢复。需要继续请新建任务。", data: { id: t.id, status: t.status } });
                return;
            }
            /* 【第九十七轮】running 的任务不能无条件重置成 queued。
               踩过：面板把「running 超 3 分钟」显示成「已中断」，用户点继续推进，
               前端先发 resume，后端不看状态直接改成 queued —— 正在跑的那一轮被覆盖，
               结果变成两个推进循环打架（双份计费 + 丢步骤）。
               规则：running 时只有「确实没有锁在跑」才允许重置；
               锁还在说明真在跑，直接告诉调用方「正在跑，别重复推」。 */
            var _stRs = String(t.status || "");
            if (_stRs === "running") {
                var _busyRs = await TASK.isAdvancing(t.id);
                if (_busyRs) {
                    complete({
                        success: false,
                        message: "任务正在推进中（后端锁未释放），不要重复推。若确认已卡死，等 90 秒锁过期后再试。",
                        data: { id: t.id, status: t.status, busy: true }
                    });
                    return;
                }
            }
            t.status = "queued"; t.cancel = false; t.error = null;
            t.phase = "idle"; t.phase_at = Date.now();
            await TASK.saveTask(t);
            complete({ success: true, message: "已恢复", data: { id: t.id, status: t.status, next: "run" } });
            return;
        }
        if (action === "steer") {
            var wlSt = _wlCheck(params, ["message"], "ctrl(steer)");
            if (wlSt) { complete({ success: false, message: wlSt, data: {} }); return; }
            if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
            var r = await TASK.steerTask(cfg, t, String(params.message || ""));
            complete({ success: r.ok, message: r.message, data: { id: t.id, step: t.step, status: t.status, next: r.ok ? "run" : null } });
            return;
        }
        if (action === "close") {
            var wlCl = _wlCheck(params, ["confirm", "rollback", "drop_product"], "ctrl(close)");
            if (wlCl) { complete({ success: false, message: wlCl, data: {} }); return; }
            if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
            if (params.confirm !== true) {
                var undo0 = await TASK.loadUndo(t.id);
                complete({
                    success: true,
                    message: "未关闭：已返回当前进度。确认关闭传 confirm=true",
                    data: { need_confirm: true, task: briefOf(t), undo_count: (undo0.items || []).length }
                });
                return;
            }
            var restored = null;
            if (params.rollback === true) {
                var ctx = await loadCtx(cfg, t);
                restored = await TOOLS.undoAll(ctx, false);
                if (ctx.save) await ctx.save();
            }
            if (params.drop_product === true) {
                try { await Tools.Files.deleteFile(t.product_dir, true, "android"); } catch (eD) {}
            }
            /* 【第九十四轮】关闭必须同时打断推进循环。
               踩过：只写 status=closed，正在 _advanceTaskInner 里跑模型的那一轮不知道要停，
               它跑完 saveTask 时把内存里的 running 写回盘，closed 被覆盖，
               面板切出去再进来就看到「模型生成中」+「继续推进」+ 秒数一路涨。
               cancel=true 是推进循环唯一认的中断信号，先打信号再定终态。 */
            t.cancel = true;
            t.status = "closed";
            await TASK.saveTask(t);
            complete({ success: true, message: "已关闭" + (params.rollback === true ? "并回滚" : ""), data: { id: t.id, status: t.status, restored: restored } });
            return;
        }
        complete({ success: false, message: "action 只支持 cancel / resume / steer / close，收到：" + action, data: {} });
    };

    /* ── box：收件箱（原 inbox） ── */
    /* ── 【第八十三轮】群组管理 ──────────────────────────
     * 权限位：READ=1 WRITE=2 CREATE=4 DELETE=8 KICK=16
     * 创始人 31 / 受邀 3 / 路人 1
     * 只有 KICK 位的人能剔除成员、改他人权限、解禁。
     */
    E.subagent_group = async function (params) {
        params = params || {};
        var action = String(params.action || "info");
        var code = String(params.code || "");
        /* 面板（WebView）调用时同步拿不到 chatId 会落到「路人 mask=1」，
           创始人自己看群组也显示只读。这里用异步兜底。 */
        var cid = await callerChatIdAsync();
        var wl = _wlCheck(params, ["action", "code", "chat_id", "mask", "name"], "group(" + action + ")");
        if (wl) { complete({ success: false, message: wl, data: {} }); return; }

        /* list：列我有权访问的群组 */
        if (action === "list") {
            var chain = await ancestorChatIdsOf(cid);
            var gs = await GRP.listGroupsFor(cid, chain.length ? chain[chain.length - 1] : cid);
            complete({ success: true, message: "共 " + gs.length + " 个群组", data: { groups: gs, total: gs.length } });
            return;
        }

        /* migrate 是全局动作，不需要群组码 */
        if (action === "migrate") {
            var res = await TASK.migrateLegacy();
            complete({ success: true, message: "迁移完成：成功 " + res.migrated + "，失败 " + res.failed + "，跳过 " + res.skipped, data: res });
            return;
        }

        if (!code) { complete({ success: false, message: "缺 code（群组码）", data: {} }); return; }
        var g = await GRP.loadGroup(code);
        if (!g) { complete({ success: false, message: "群组不存在：" + code, data: {} }); return; }
        /* 拿不到 cid = 本机主人在面板上亲手操作（WebView 里 getToolExecutionContext 常为空）。
           主人的身份不靠群组权限约束，直接按创始人级权限处理。
           AI 的工具调用一定能拿到 chatId（callerChatIdAsync 已兜底），不会被误放。 */
        var mem = cid ? GRP.resolveMember(g, cid) : { ok: true, mask: GRP.PERM.FOUNDER, reason: "", isOwner: true };
        if (!mem.ok) { complete({ success: false, message: mem.reason, data: {} }); return; }

        /* info：看群组详情（READ 位即可） */
        if (action === "info") {
            if (!GRP.hasPerm(mem.mask, GRP.PERM.READ)) {
                complete({ success: false, message: "无权查看该群组", data: {} }); return;
            }
            complete({
                success: true,
                message: "群组 " + code + (g.readonly ? "（只读：无人具备 CREATE）" : ""),
                data: {
                    code: String(g.code || ""), name: String(g.name || ""),
                    founder: String(g.founder || ""), root_chat_id: String(g.root_chat_id || ""),
                    readonly: !!g.readonly, created_at: Number(g.created_at || 0),
                    members: g.members || [], kicked: g.kicked || [],
                    my_mask: mem.mask
                }
            });
            return;
        }

        /* 删群组：在 KICK 校验之前单独处理 —— 判据是「创始人」，不是权限位。
           理由：群组可能因为无人具备 CREATE 而转只读，权限位会被改；
           但创始人不该因为被改权限就删不掉自己的群组。 */
        if (action === "delete") {
            if (cid && String(g.founder || "") !== String(cid || "")) {
                complete({ success: false, message: "只有群组创始人可以删除群组", data: { founder: String(g.founder || "") } });
                return;
            }
            var freedD = 0;
            try {
                var allD = await TASK.listTasks(false);
                for (var di = 0; di < allD.length; di++) {
                    var tD = allD[di];
                    if (String(tD.group || "") !== code) continue;
                    tD.group = "";
                    tD.group_dir = "";
                    tD.group_created_at = 0;
                    await TASK.saveTask(tD);
                    freedD++;
                }
            } catch (eFreeD) {}
            await GRP.delGroup(g);
            complete({
                success: true,
                message: "已删除群组 " + code + (freedD ? "，其中 " + freedD + " 个任务退回未归属" : ""),
                data: { code: code, freed: freedD }
            });
            return;
        }

        /* 以下都要求 KICK 位（管理动作） */
        if (!GRP.hasPerm(mem.mask, GRP.PERM.KICK)) {
            complete({ success: false, message: "无权管理该群组（需要 KICK 位）", data: { my_mask: mem.mask } });
            return;
        }
        var target = String(params.chat_id || "");

        if (action === "kick") {
            if (!target) { complete({ success: false, message: "缺 chat_id", data: {} }); return; }
            if (target === String(g.founder || "")) {
                complete({ success: false, message: "创始人不可被剔除", data: {} }); return;
            }
            await GRP.kick(g, target);
            complete({ success: true, message: "已剔除 " + target + "（再次输入群组码也无法访问）", data: { kicked: g.kicked || [] } });
            return;
        }
        if (action === "unkick") {
            if (!target) { complete({ success: false, message: "缺 chat_id", data: {} }); return; }
            await GRP.unkick(g, target);
            complete({ success: true, message: "已解禁 " + target + "（需重新授权权限位）", data: { kicked: g.kicked || [] } });
            return;
        }
        if (action === "perm") {
            if (!target) { complete({ success: false, message: "缺 chat_id", data: {} }); return; }
            var m = Number(params.mask);
            if (isNaN(m) || m < 0) { complete({ success: false, message: "mask 必须是非负整数（READ=1 WRITE=2 CREATE=4 DELETE=8 KICK=16）", data: {} }); return; }
            await GRP.setPerm(g, target, m);
            complete({ success: true, message: "已设置 " + target + " 权限位为 " + m, data: { members: g.members || [] } });
            return;
        }
        if (action === "admit") {
            if (!target) { complete({ success: false, message: "缺 chat_id", data: {} }); return; }
            var am = Number(params.mask);
            if (isNaN(am)) am = GRP.PERM.MEMBER;
            await GRP.admit(g, target, am);
            complete({ success: true, message: "已邀请 " + target + "（权限位 " + am + "）", data: { members: g.members || [] } });
            return;
        }
        complete({ success: false, message: "未知 action：" + action + "（支持 list/info/kick/unkick/perm/admit/migrate）", data: {} });
    };

    E.subagent_box = async function (params) {
        params = params || {};
        var wl = _wlCheck(params, ["action"], "box");
        if (wl) { complete({ success: false, message: wl, data: {} }); return; }
        return await E.subagent_inbox(params);
    };

    /* ── undo：恢复写入（原 undo） ── */
    E.subagent_undo = E.subagent_undo;  // 原名保留，语义未变
    /* ── del：删任务（原 delete） —— dispatch 转发，逻辑在旧函数 ── */
    E.subagent_del = async function (params) {
        params = params || {};
        var wl = _wlCheck(params, ["confirm"], "del");
        if (wl) { complete({ success: false, message: wl, data: {} }); return; }
        return await E.subagent_delete({ id: params.id, confirm: params.confirm });
    };

    /* ── update：更新（原 check_update + download_update + download_status + install_update） ── */
    E.subagent_update = async function (params) {
        params = params || {};
        var step = String(params.step || "check");
        /* 【第八十一轮】step 是路由参数，四个分支的白名单都必须放行它本身：
           原先把 step 当普通参数检查，导致用 step="check" 调用时
           直接报「update(check) 不接受参数：step」——路由参数把自己拦了。 */
        if (step === "check") {
            var wl1 = _wlCheck(params, ["step", "force"], "update(check)");
            if (wl1) { complete({ success: false, message: wl1, data: {} }); return; }
            return await E.subagent_check_update({ force: params.force === true });
        }
        if (step === "download") {
            var wl2 = _wlCheck(params, ["step", "force"], "update(download)");
            if (wl2) { complete({ success: false, message: wl2, data: {} }); return; }
            return await E.subagent_download_update({ force: params.force === true });
        }
        if (step === "status") {
            var wl3 = _wlCheck(params, ["step"], "update(status)");
            if (wl3) { complete({ success: false, message: wl3, data: {} }); return; }
            return await E.subagent_download_status();
        }
        if (step === "install") {
            var wl4 = _wlCheck(params, ["step", "path"], "update(install)");
            if (wl4) { complete({ success: false, message: wl4, data: {} }); return; }
            return await E.subagent_install_update({ path: params.path });
        }
        complete({ success: false, message: "step 只支持 check / download / status / install，收到：" + step, data: {} });
    };

    /* ── cfg：配置与模板（原 config + templates，target 消歧） ── */
    E.subagent_cfg = async function (params) {
        params = params || {};
        var target = String(params.target || "profile");
        if (target === "profile") {
            /* 旧 config 的 action 映射：add_profile/set_profile/set_active/del_profile/list_profiles 简写 */
            var a = String(params.action || "status");
            var map = { list: "list_profiles", add: "add_profile", use: "set_active", rm: "del_profile", models: "refresh_models", set: "set", key: "key", status: "status" };
            var oldA = map[a] || a;
            var valid = ["status", "set", "key", "refresh_models", "list_profiles", "add_profile", "set_profile", "set_active", "del_profile"];
            if (valid.indexOf(oldA) < 0) {
                complete({ success: false, message: "cfg(target=profile) action 只支持 " + valid.join("/") + "（或简写 list/add/use/rm/models），收到：" + a, data: {} });
                return;
            }
            var wlP = _wlCheck(params, ["payload", "api_key", "base", "force"], "cfg(profile)");
            if (wlP) { complete({ success: false, message: wlP, data: {} }); return; }
            return await E.subagent_config({
                action: oldA,
                profile_id: params.name || "",
                payload: params.payload,
                api_key: params.api_key,
                base_url: params.base,
                force: params.force === true
            });
        }
        if (target === "template") {
            var ta = String(params.action || "list");
            if (["list", "add", "remove"].indexOf(ta) < 0) {
                complete({ success: false, message: "cfg(target=template) action 只支持 list/add/remove，收到：" + ta, data: {} });
                return;
            }
            var wlT = _wlCheck(params, ["payload"], "cfg(template)");
            if (wlT) { complete({ success: false, message: wlT, data: {} }); return; }
            return await E.subagent_templates({ action: ta, payload: params.payload, id: params.name || "" });
        }
        complete({ success: false, message: "target 只支持 profile / template，收到：" + target, data: {} });
    };

    /* ── env：环境探测（原 probe + version + chats + tools + workspace + list_dir + check_path） ── */
    E.subagent_env = async function (params) {
        params = params || {};
        var what = String(params.what || "version");
        if (what === "probe") {
            var wl1 = _wlCheck(params, ["deep", "model", "base"], "env(probe)");
            if (wl1) { complete({ success: false, message: wl1, data: {} }); return; }
            return await E.subagent_probe({ deep: params.deep !== false, model: params.model, base_url: params.base });
        }
        if (what === "version") {
            var wl2 = _wlCheck(params, [], "env(version)");
            if (wl2) { complete({ success: false, message: wl2, data: {} }); return; }
            return await E.subagent_version();
        }
        if (what === "chats") {
            var wl3 = _wlCheck(params, ["limit", "query"], "env(chats)");
            if (wl3) { complete({ success: false, message: wl3, data: {} }); return; }
            return await E.subagent_chats({ limit: params.limit, query: params.query });
        }
        if (what === "tools") {
            var wl4 = _wlCheck(params, [], "env(tools)");
            if (wl4) { complete({ success: false, message: wl4, data: {} }); return; }
            return await E.subagent_tools();
        }
        if (what === "workspace") {
            var wl5 = _wlCheck(params, ["action", "path", "depth", "max_files"], "env(workspace)");
            if (wl5) { complete({ success: false, message: wl5, data: {} }); return; }
            return await E.subagent_workspace({ action: params.action || "info", path: params.path, depth: params.depth, max_files: params.max_files });
        }
        if (what === "dir") {
            var wl6 = _wlCheck(params, ["path"], "env(dir)");
            if (wl6) { complete({ success: false, message: wl6, data: {} }); return; }
            if (!params.path) { complete({ success: false, message: "env(what=dir) 需要 path", data: {} }); return; }
            return await E.subagent_list_dir({ path: params.path });
        }
        if (what === "path") {
            var wl7 = _wlCheck(params, ["path"], "env(path)");
            if (wl7) { complete({ success: false, message: wl7, data: {} }); return; }
            if (!params.path) { complete({ success: false, message: "env(what=path) 需要 path", data: {} }); return; }
            return await E.subagent_check_path({ path: params.path });
        }
        complete({ success: false, message: "what 只支持 probe / version / chats / tools / workspace / dir / path，收到：" + what, data: {} });
    };

    /* 拆出模块安装：把 sb_tool_update.js 的工具挂回 exports。
       放在文件末尾，保证 VERSION 与 exports 都已就绪。 */
};
