/*
 * 面板流式通道工具（从 subagent.js 拆出）
 *
 * 用途：面板直连模型时需要的六个后端支撑——save_turn（落盘一轮）、stream_flush（增量落盘）、
 *       tool_once（执行单个工具）、stream_ctx（端点/模型/schema）、stream_key（下发密钥）、
 *       stream_relay（http 端点 SSE 中继）。
 * 为什么单独成文件：这块是「面板 ↔ 后端」的私有协议，与主代理的工具面无交集，
 *       拆出来改流式协议不会碰到任务状态机。
 * 依赖：sb_config / sb_llm / sb_task / sb_tools / sb_ctx。
 * 入参：install(E, opts)
 *   E             —— subagent.js 的 exports
 *   opts.complete —— 宿主注入的 complete 回调，子模块拿不到全局，必须传
 * 出参：无，直接往 E 上挂六个工具。
 */
var CFG = require("./sb_config.js");
var LLM = require("./sb_llm.js");
var TASK = require("./sb_task.js");
var TOOLS = require("./sb_tools.js");
var CTX = require("./sb_ctx.js");
var notifyDone = CTX.notifyDone;

module.exports = function install(E, opts) {
    var complete = opts && opts.complete;
    if (typeof complete !== "function") throw new Error("installToolStream: 缺 complete");

    /* 流式结果落盘：页面负责生成，后端只负责把这一轮存进任务文件。
       不做任何模型调用，避免两套逻辑打架。 */
    E.subagent_save_turn = async function (params) {
        params = params || {};
        var task = await TASK.loadTask(String(params.id || ""));
        if (!task) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        var list = Array.isArray(params.turns) ? params.turns : [];
        /* 面板流式路径原来完全不记账：step 永远 0、usage 永远 0、完成也不进收件箱。
           结果就是状态行永远「第 0/20 步 · 0 tok」，收件箱永远空。
           这里补上与 advanceTask 一致的三件事：步数、用量、完成通知。 */
        var addedAssistant = false;
        for (var i = 0; i < list.length; i++) {
            var m = list[i] || {};
            var role = String(m.role || "");
            if (role !== "assistant" && role !== "tool" && role !== "user") continue;
            var t = { role: role };
            if (role === "assistant") {
                addedAssistant = true;
                t.content = String(m.content || "");
                if (m.reasoning) t.reasoning = String(m.reasoning);
                if (m.tool_calls && m.tool_calls.length) t.tool_calls = m.tool_calls;
            } else if (role === "tool") {
                t.tool_call_id = String(m.tool_call_id || "");
                t.name = String(m.name || "");
                t.args = String(m.args || "{}");
                t.ok = (m.ok !== false);
                t.content = String(m.content || "");
                t.chars = String(m.content || "").length;
            } else {
                t.content = String(m.content || "");
            }
            task.turns.push(t);
            await TASK.saveTask(task);
        }
        /* 一轮 = 一步，与 advanceTask 的 task.step + 1 对齐 */
        if (addedAssistant) task.step = Number(task.step || 0) + 1;
        /* 落了正式 turn 就清掉流式临时落盘，避免 fillTrace 里 pending 与 turn 重复渲染 */
        if (addedAssistant && list.length) {
            try { delete task.pending; } catch (eP2) { task.pending = null; }
        }
        /* 用量：面板直接调端点，usage 由页面回传（OpenAI 字段名 prompt/completion） */
        var uIn = Number((params.usage && (params.usage.in != null ? params.usage.in : params.usage.prompt_tokens)) || 0);
        var uOut = Number((params.usage && (params.usage.out != null ? params.usage.out : params.usage.completion_tokens)) || 0);
        if (uIn || uOut) {
            task.usage = task.usage || { in: 0, out: 0, est_cost: 0 };
            task.usage.in = Number(task.usage.in || 0) + uIn;
            task.usage.out = Number(task.usage.out || 0) + uOut;
            var cfgU = null;
            try { cfgU = await CFG.load(); } catch (eU) { cfgU = null; }
            if (cfgU) {
                try { await TASK.bumpUsage(cfgU, { in: uIn, out: uOut }); } catch (eB) {}
                try {
                    task.usage.est_cost = Math.round((Number(task.usage.est_cost || 0) + LLM.estimateCost(cfgU, { in: uIn, out: uOut })) * 1000000) / 1000000;
                } catch (eC) {}
            }
        }
        if (params.finish_reason) task.last = Object.assign(task.last || {}, { finish_reason: String(params.finish_reason) });
        if (params.done === true) {
            task.status = "done";
            task.phase = "idle";
            var lastA = null;
            for (var j = task.turns.length - 1; j >= 0; j--) {
                if (task.turns[j].role === "assistant") { lastA = task.turns[j]; break; }
            }
            if (lastA) task.result = String(lastA.content || "");
            task.phase_at = Date.now();
            /* 收尾时清掉流式过程中的临时落盘，避免 pending 内容在刷新后重复显示 */
            try { delete task.pending; } catch (eP) { task.pending = null; }
        } else if (Number(task.step || 0) > Number(task.max_steps || 0) && Number(task.max_steps || 0) > 0) {
            /* 超步数：与 advanceTask 一致置 failed，别让任务无限跑下去。
               判 > 而不是 >= ：面板第 max_steps 步跑完仍允许收尾，只有真超出才终止。 */
            task.status = "failed";
            task.error = "超出步数上限 " + task.max_steps;
        }
        await TASK.saveTask(task);
        /* 完成/失败都要进收件箱，否则面板用户永远看不到结论 */
        if (params.done === true || task.status === "failed") {
            try { await notifyDone(task); } catch (eN) {}
        }
        complete({ success: true, message: "已保存", data: { count: list.length, status: task.status, step: task.step, usage: task.usage } });
    };

    /* 流式增量落盘：面板流式过程中每几秒调一次。
       【为什么必须有】原来流式全程只在页面内存里跑（thinkBuf/bodyBuf 是闭包变量），
       退出面板 = 页面销毁 = 内容全丢；而且从不把 task.status 写成 running，
       退出再进来后端还是 queued，面板显示「待开始」，用户只能重新点启动 ——
       重跑的内容又叠在旧的上面，越滚越大（实测出现过 35KB 的重复内容）。
       这个工具做两件事：
         1) 把 status 置 running（面板再进来时能正确判断「正在跑」）
         2) 把当前已生成的内容写进 task.pending（不追加 turns，避免重复）
       收尾时由 subagent_save_turn 用 done=true 落正式 turn 并清掉 pending。 */
    E.subagent_stream_flush = async function (params) {
        params = params || {};
        var task = await TASK.loadTask(String(params.id || ""));
        if (!task) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        /* 已经是终态就别再翻回 running，避免用户点了停止又被拉起来 */
        var st = String(task.status || "");
        if (st === "done" || st === "failed" || st === "cancelled" || st === "closed") {
            complete({ success: true, message: "终态，忽略", data: { status: st, ignored: true } });
            return;
        }
        task.status = "running";
        task.phase = "llm";
        task.phase_at = Date.now();
        task.pending = {
            think: String(params.think || ""),
            body: String(params.body || ""),
            at: Date.now()
        };
        await TASK.saveTask(task);
        complete({ success: true, message: "已落盘", data: { status: task.status, chars: (task.pending.think || "").length + (task.pending.body || "").length } });
    };

    /* 单个工具执行：流式循环在页面里跑，但工具必须由后端执行（页面没有文件/shell 能力）。
       白名单、写入范围、undo 备份全部复用同一套 sb_tools 逻辑，不另开旁路。 */
    E.subagent_tool_once = async function (params) {
        params = params || {};
        var tool = String(params.tool || "").trim();
        if (!tool) { complete({ success: false, message: "缺少 tool", data: { ok: false, error: "缺少 tool" } }); return; }
        var taskId = String(params.id || "");
        var cfg = await CFG.load();
        var task = taskId ? await TASK.loadTask(taskId) : null;
        var args = (params.args && typeof params.args === "object") ? params.args : {};
        var allowed = (task && task.allowed_tools && task.allowed_tools.length)
            ? task.allowed_tools
            : [];
        /* 注意（2026-11-07 定调）：allowed_tools 留空 = 一个工具都用不了，
           不再 fallback 到 default_allowed_tools。否则面板路径与 advanceTask 路径
           对同一条规矩给出相反结果（一个能跑 5 个只读工具，一个全拒）。
           要全放开请建任务时传 all=true。 */
        var roots = [];
        if (task) {
            if (task.workspace_resolved) roots.push(task.workspace_resolved);
            if (task.product_dir) roots.push(task.product_dir);
        }
        var undo = task ? await TASK.loadUndo(task.id) : { items: [], seq: 0 };
        var seq = Number(undo.seq || 0);
        var ctx = {
            allowed: allowed,
            workspace: (task && task.workspace_resolved) || "",
            productDir: (task && task.product_dir) || "",
            maxChars: Number(cfg.tool_result_max_chars || 0),
            allowDanger: (task && task.allow_danger === true) || cfg.allow_danger === true,
            tool_timeout_ms: Number((task && task.tool_timeout_ms) || cfg.tool_timeout_ms || 0),
            roots: roots.filter(Boolean),
            nextSeq: function () { seq = seq + 1; return seq; },
            loadUndo: function () { return undo.items || []; },
            appendUndo: function (recs) { undo.items = (undo.items || []).concat(recs || []); undo.seq = seq; },
            clearUndo: function () { undo.items = []; undo.seq = seq; }
        };
        var out = await TOOLS.runOne(ctx, { tool: tool, args: args });
        /* 写类工具跑完立刻存 undo，保证可撤回 */
        if (task && TOOLS.isWriteTool(tool)) {
            try { await TASK.saveUndo(task.id, undo); } catch (e) {}
        }
        complete({
            success: true,
            message: out.ok ? "ok" : "工具失败",
            data: {
                ok: !!out.ok,
                tool: tool,
                result: String(out.result || ""),
                error: String(out.error || ""),
                chars: Number(out.chars || 0),
                ms: Number(out.ms || 0),
                truncated: !!out.truncated
            }
        });
    };

    /* ── 流式直连支撑 ──
       架构：模型请求由页面 fetch 直连端点拿真 SSE；宿主工具仍走后端。
       这里只负责把「直连要用的参数」交给页面，以及暴露工具 schema。
       密钥单独用一个工具取，避免它跟着 ctx 一起出现在日志/对话里。 */
    E.subagent_stream_ctx = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var task = params.id ? await TASK.loadTask(String(params.id)) : null;
        var profile = LLM.resolveProfile(cfg, (task && task.profile_override) || {});
        var allowed = (task && task.allowed_tools && task.allowed_tools.length)
            ? task.allowed_tools
            : [];
        /* 留空 = 一个工具都用不了（2026-11-07 定调，见 subagent_spawn 注释） */
        var level = (task && task.thinking_level) || cfg.thinking_level || "medium";
        var protocol = String(profile.protocol || "chat");
        complete({
            success: true,
            message: "直连参数就绪",
            data: {
                endpoint: LLM.joinUrl(profile.base_url, "/chat/completions"),
                model: String(profile.model || ""),
                protocol: protocol,
                /* 只带非认证类请求头：Authorization 由页面用 key 自己拼，不走这里 */
                headers: (function () {
                    var h = { "Content-Type": "application/json" };
                    var ex = profile.custom_headers || {};
                    for (var k in ex) {
                        if (!Object.prototype.hasOwnProperty.call(ex, k)) continue;
                        if (/^authorization$/i.test(k)) continue;
                        h[k] = String(ex[k]);
                    }
                    return h;
                })(),
                key_env: String(profile.api_key_env || "SUBAGENT_API_KEY"),
                thinking: LLM.thinkingFields(cfg, level),
                extra_body: profile.extra_body || {},
                tool_schema: LLM.runToolSchema(allowed),
                allowed_tools: allowed,
                stream_supported: protocol === "chat"
            }
        });
    };

    /* 密钥按需下发：只有本机面板能拿到，且只落在页面内存里 */
    E.subagent_stream_key = async function () {
        var cfg = await CFG.load();
        var profile = LLM.resolveProfile(cfg, {});
        var envName = String(profile.api_key_env || "SUBAGENT_API_KEY");
        var key = "";
        try { key = String(CFG.getEnvValue(envName) || ""); } catch (e) { key = ""; }
        if (!key) { complete({ success: false, message: "未配置密钥", data: { key: "" } }); return; }
        complete({ success: true, message: "ok", data: { key: key, env: envName } });
    };

    /* ── 后端中继：给 http:// 局域网端点用的流式通道 ──
       为什么需要它：面板页面 origin 固定 https://localhost，浏览器按 mixed content 规则
       禁止页面向 http:// 发请求，请求连发都发不出去，改前端代码绕不过。
       但后端 Tools.Net.http 走的是原生 HTTP 栈，没有这个限制——实测能连局域网并拿到
       text/event-stream。所以在后端把整包 SSE 取回来、解析成 chunk 数组交给页面回放。
       代价：首字延迟 = 整包时间（不是真逐字）；换来的是局域网端点也能有接近流式的观感，
       而不是像以前那样直接报错或退化成一坨。
       页面侧按 endpoint 协议自动选路：https 走前端直连，http 走这里。 */
    E.subagent_stream_relay = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var task = params.id ? await TASK.loadTask(String(params.id)) : null;
        var profile = LLM.resolveProfile(cfg, (task && task.profile_override) || {});
        var url = LLM.joinUrl(profile.base_url, "/chat/completions");
        var envName = String(profile.api_key_env || "SUBAGENT_API_KEY");
        var key = "";
        try { key = String(CFG.getEnvValue(envName) || ""); } catch (e) { key = ""; }
        if (!key) { complete({ success: false, message: "未配置密钥", data: { content: "", reasoning: "", chunks: [], toolCalls: [] } }); return; }

        /* 请求头：页面传了 body 就用页面的，没传就按配置现拼一份 */
        var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + key };
        var ex = profile.custom_headers || {};
        for (var hk in ex) {
            if (!Object.prototype.hasOwnProperty.call(ex, hk)) continue;
            if (/^authorization$/i.test(hk)) continue;
            headers[hk] = String(ex[hk]);
        }
        var body = (params.body && typeof params.body === "object") ? params.body : null;
        if (!body) {
            var allowed = (task && task.allowed_tools && task.allowed_tools.length)
                ? task.allowed_tools
                : [];
            /* 留空 = 一个工具都用不了（2026-11-07 定调，见 subagent_spawn 注释） */
            var level = (task && task.thinking_level) || cfg.thinking_level || "medium";
            body = {
                model: String(profile.model || ""),
                messages: [],
                stream: true,
                stream_options: { include_usage: true }
            };
            var sch = LLM.runToolSchema(allowed);
            if (sch && sch.length) { body.tools = sch; body.tool_choice = "auto"; }
            var th = LLM.thinkingFields(cfg, level);
            for (var tk in (th || {})) if (Object.prototype.hasOwnProperty.call(th, tk)) body[tk] = th[tk];
            var eb = profile.extra_body || {};
            for (var ek in eb) if (Object.prototype.hasOwnProperty.call(eb, ek)) body[ek] = eb[ek];
        }

        var raw = "";
        try {
            var res = await Tools.Net.http({
                url: url,
                method: "POST",
                headers: headers,
                body: JSON.stringify(body),
                /* 超时必须显式给：不给的话端点连上却不发数据、也不关连接时，
                   后端线程会永久挂着（桥 20s 就断了，但后端不释放）。
                   与 sb_llm.postJsonOnce 保持一致。 */
                connect_timeout: 15000,
                read_timeout: Math.max(30000, Number((task && task.timeout_ms) || 90000) + 30000),
                responseType: "text",
                validateStatus: true
            });
            var sc = Number((res && res.statusCode) || 0);
            raw = String((res && (res.body != null ? res.body : res.content)) || "");
            if (sc && (sc < 200 || sc >= 300)) {
                complete({ success: false, message: "HTTP " + sc + "：" + raw.slice(0, 300), data: { content: "", reasoning: "", chunks: [], toolCalls: [] } });
                return;
            }
        } catch (e) {
            complete({ success: false, message: "中继请求失败：" + String((e && e.message) || e), data: { content: "", reasoning: "", chunks: [], toolCalls: [] } });
            return;
        }

        /* 解析 SSE：同时产出「累积结果」和「逐块数组」。
           逐块数组是给页面回放用的，累积结果是给页面收尾落盘用的，两者必须一致。 */
        var acc = { content: "", reasoning: "", byIdx: {}, finishReason: "", usage: {} };
        var chunks = [];
        var lines = raw.split("\n");
        for (var i = 0; i < lines.length; i++) {
            var ln = String(lines[i] || "").replace(/\r$/, "");
            if (!ln || ln.charAt(0) === ":") continue;
            if (ln.indexOf("data:") !== 0) continue;
            var payload = ln.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            var j = null;
            try { j = JSON.parse(payload); } catch (eJ) { continue; }
            if (j.usage) acc.usage = j.usage;
            var ch = (j.choices && j.choices[0]) || null;
            if (!ch) continue;
            var d = ch.delta || {};
            var c = String(d.content || "");
            var r = String(d.reasoning_content || d.reasoning || "");
            if (c) acc.content += c;
            if (r) acc.reasoning += r;
            /* 工具调用分片下发，按 index 累积 name 与 arguments 字符串 */
            var dtc = d.tool_calls || [];
            for (var t = 0; t < dtc.length; t++) {
                var one = dtc[t] || {};
                var ix = Number(one.index == null ? 0 : one.index);
                if (!acc.byIdx[ix]) acc.byIdx[ix] = { id: "", name: "", argsText: "" };
                var slot = acc.byIdx[ix];
                if (one.id) slot.id = String(one.id);
                var fn = one.function || {};
                if (fn.name) slot.name += String(fn.name);
                if (fn.arguments) slot.argsText += String(fn.arguments);
            }
            if (ch.finish_reason) acc.finishReason = String(ch.finish_reason);
            if (c || r) chunks.push({ content: c, reasoning: r });
        }
        /* 响应不是 SSE（有的端点即便 stream:true 也回整包 JSON）：按普通回复解一次 */
        if (!chunks.length && !acc.content && !acc.reasoning) {
            try {
                var jo = JSON.parse(raw);
                var m = (jo.choices && jo.choices[0] && jo.choices[0].message) || {};
                acc.content = String(m.content || "");
                acc.reasoning = String(m.reasoning_content || m.reasoning || "");
                if (jo.usage) acc.usage = jo.usage;
                var tcs0 = m.tool_calls || [];
                for (var q = 0; q < tcs0.length; q++) {
                    var tc = tcs0[q] || {}, fn2 = tc.function || {};
                    acc.byIdx[q] = { id: String(tc.id || ("call_" + q)), name: String(fn2.name || ""), argsText: String(fn2.arguments || "{}") };
                }
                if (acc.content || acc.reasoning) chunks.push({ content: acc.content, reasoning: acc.reasoning });
            } catch (eJ2) {
                complete({ success: false, message: "中继响应既不是 SSE 也不是 JSON", data: { content: "", reasoning: "", chunks: [], toolCalls: [] } });
                return;
            }
        }
        var toolCalls = [];
        for (var key0 in acc.byIdx) {
            if (!Object.prototype.hasOwnProperty.call(acc.byIdx, key0)) continue;
            var s0 = acc.byIdx[key0];
            var args = {};
            try { args = JSON.parse(s0.argsText || "{}"); } catch (eA) { args = { __unparsed: s0.argsText }; }
            toolCalls.push({ id: s0.id || ("call_" + key0), name: s0.name, args: args });
        }
        complete({
            success: true,
            message: "中继完成（" + chunks.length + " 块）",
            data: {
                content: acc.content,
                reasoning: acc.reasoning,
                toolCalls: toolCalls,
                finishReason: acc.finishReason || (toolCalls.length ? "tool_calls" : "stop"),
                usage: acc.usage,
                chunks: chunks,
                relayed: true
            }
        });
    };
};
