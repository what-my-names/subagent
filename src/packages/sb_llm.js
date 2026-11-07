/* sb_llm.js — 自建模型调用（OpenAI 兼容）
 * 只做三件事：拼请求、发请求、解析响应。不碰工具执行。
 */
"use strict";
var RUN_TOOL = "run_tool";
/* 工具参数元数据表：宿主拿不到每个工具的 schema，只能自己维护一份，
   才能把 read_file / create_file 这些真实工具直接暴露给模型（而不是包一层 run_tool） */
var TOOLMETA = null;
try { TOOLMETA = require("./sb_toolmeta.js"); } catch (eTM) { TOOLMETA = null; }
function joinUrl(base, path) {
    var b = String(base || "").replace(/\/+$/, "");
    return b + path;
}

function clone(o) {
    try { return JSON.parse(JSON.stringify(o == null ? {} : o)); } catch (e) { return {}; }
}

function resolveProfile(cfg, overrides) {
    var p = clone((cfg && cfg.profile) || {});
    overrides = overrides || {};
    if (overrides.base_url) p.base_url = String(overrides.base_url).trim();
    if (overrides.model) p.model = String(overrides.model).trim();
    p.base_url = String(p.base_url || "").trim().replace(/\/+$/, "");
    if (/\/responses$/i.test(p.base_url)) p.protocol = "responses";
    if (/\/messages$/i.test(p.base_url)) p.protocol = "anthropic";
    p.base_url = p.base_url.replace(/\/chat\/completions$/i, "").replace(/\/responses$/i, "").replace(/\/messages$/i, "");
    p.model = String(p.model || "").trim();
    p.protocol = String(p.protocol || "chat").toLowerCase();
    return p;
}

function headersOf(cfg, profile) {
    var h = { "Content-Type": "application/json" };
    var extra = (profile && profile.custom_headers) ? profile.custom_headers : {};
    var k;
    for (k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = String(extra[k]); }
    var keyName = (profile && profile.api_key_env) ? String(profile.api_key_env) : "SUBAGENT_API_KEY";
    var key = "";
    try { key = String(getEnv(keyName) || ""); } catch (e) { key = ""; }
    if (key) h["Authorization"] = "Bearer " + key;
    return h;
}

/* 工具 schema 生成（2026-11-06 改：从 run_tool 壳改为每个工具独立 function）
 *
 * 旧设计只返回一个 run_tool({tool, args})，模型看不到每个工具的真实参数，
 * 只能靠 description 里的文字列表猜；实测还会把工具名污染成
 * "visit_web<tool_sep:...><arg_key:...>args</arg_key>..."（第九轮那个 bug 的诱因）。
 *
 * 新设计：allowed 里的每个工具，只要 sb_toolmeta 表里有定义，就暴露成一个独立 function，
 * 模型直接写 read_file({path:"..."})。表外工具（用户自己的包工具 `包名:工具名`）走 run_tool 兜底，
 * 两条路并存 —— 解析层本来就是通用的（toolCalls.push({name: fn.name, args})），不用改。
 */
function runToolSchema(allowed) {
    var list = (allowed && allowed.length) ? allowed : [];
    var out = [];
    var fallback = [];   /* 表外工具，收进 run_tool 的说明里 */
    var allOpen = false; /* allowed 里有 "*" = 全放开 */

    for (var i = 0; i < list.length; i++) {
        var name = String(list[i] || "").trim();
        if (!name) continue;
        /* 纯 * = 全放开：不是「通配收进兜底」，而是把内置表整表展开 */
        if (name === "*") { allOpen = true; continue; }
        /* 其它通配（如 pkg:*）无法逐一定义，收进兜底 */
        if (name.indexOf("*") >= 0) { fallback.push(name); continue; }
        var meta = null;
        try { meta = TOOLMETA.get(name); } catch (e) { meta = null; }
        if (!meta) { fallback.push(name); continue; }
        out.push({
            type: "function",
            function: {
                name: meta.name,
                description: meta.description,
                parameters: meta.parameters
            }
        });
    }

    /* 全放开：把 sb_toolmeta 表里的内置工具全部展开成独立 function。
       表外工具（用户自己的包工具）走下面的 run_tool 兜底。
       注意：递归派子代理仍被 sb_tools.isRecursive 硬拦，* 不解除这条。 */
    if (allOpen) {
        var allNames = [];
        try { allNames = TOOLMETA.names(); } catch (eN) { allNames = []; }
        for (var ai = 0; ai < allNames.length; ai++) {
            var am = null;
            try { am = TOOLMETA.get(allNames[ai]); } catch (eA) { am = null; }
            if (!am) continue;
            out.push({
                type: "function",
                function: {
                    name: am.name,
                    description: am.description,
                    parameters: am.parameters
                }
            });
        }
    }

    /* 有表外工具时，额外给一个 run_tool 兜底入口。
       没有表外工具就不给 —— 免得模型误以为必须包一层。
       全放开时也必须给：包工具（`包名:工具名`）不在内置表里，只能走这个入口。 */
    if (fallback.length || allOpen) {
        var fbDesc = allOpen
            ? "执行一个没有独立定义的工具（如包工具，写成 包名:工具名）。args 是该工具自己的参数对象。"
            : ("执行一个没有独立定义的工具（包工具或通配）。tool 必须是允许列表中的名字；args 是该工具自己的参数对象。这些工具只能通过本入口调用：" + fallback.join(", "));
        out.push({
            type: "function",
            function: {
                name: RUN_TOOL,
                description: fbDesc,
                parameters: {
                    type: "object",
                    properties: {
                        tool: { type: "string", description: "工具名，来自上面的列表；包工具写成 包名:工具名" },
                        args: { type: "object", description: "传给该工具的参数对象，键名与该工具本身一致", additionalProperties: true }
                    },
                    required: ["tool"],
                    additionalProperties: true
                }
            }
        });
    }

    /* 兜底：allowed 为空（= 全拒，第二十二轮用户拍板）时，不再给 run_tool。
   原来这里塞一个 run_tool 是因为「tools 为空数组某些端点会报错」，
   但执行层 matchAllowed(name, []) 直接 false，模型调什么都被拒 ——
   等于给模型一个必然失败的入口，比不给更糟。
   正确做法：返回空数组，调用方（callChat / callResponses / callAnthropic）
   发现 schema 为空就不带 tools 字段，而不是带一个空的 tools:[]。 */
    return out;
}

function thinkingFields(cfg, level) {
    var lv = String(level || "medium").toLowerCase();
    var map = (cfg && cfg.thinking_map) || {};
    var f = map[lv];
    return (f && typeof f === "object") ? clone(f) : {};
}

function errorHint(statusCode, bodyText) {
    var body = String(bodyText || "");
    var short = body.length > 300 ? body.slice(0, 300) + "…" : body;
    if (statusCode === 401) return "密钥无效或无权限（401）。检查 key 与端点是否配套。原文：" + short;
    if (statusCode === 402) return "额度不足（402）。原文：" + short;
    if (statusCode === 403) return "被拒绝（403）。可能地区限制或账户限制。原文：" + short;
    if (statusCode === 404) return "路径或模型名不存在（404）。检查 base_url 是否以 /v1 结尾、model 是否正确。原文：" + short;
    if (statusCode === 429) return "限流（429）。稍后重试。原文：" + short;
    if (statusCode >= 500) return "端点故障（" + statusCode + "）。原文：" + short;
    if (statusCode === 400) return "请求被拒（400）。常见原因：tools 不兼容、max_tokens 字段名不对、思考参数不支持。原文：" + short;
    return "HTTP " + statusCode + "。原文：" + short;
}

/* 可重试的错误：限流 / 网关 / 服务端临时故障。
   429 限流、500/502/503/504 是临时性的，重试大概率成功；
   400/401/403/404 是配置或权限问题，重试没意义（还会浪费配额）。 */
function isRetryable(status, text) {
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
    /* 网络层失败（status=0）也重试：连不上、超时、连接被重置 */
    if (!status) return true;
    /* 部分中转把限流包在 200 里 */
    var t = String(text || "");
    if (/rate.?limit|too many requests|overloaded/i.test(t)) return true;
    return false;
}

/* 单次请求（不重试）。callChat / callAnthropic / callResponses 都走这里。 */
async function postJsonOnce(url, headers, bodyObj, timeoutMs) {
    var res = await Tools.Net.http({
        url: url,
        method: "POST",
        headers: headers,
        body: JSON.stringify(bodyObj),
        connect_timeout: Math.min(15000, Number(timeoutMs) || 15000),
        read_timeout: Math.max(5000, Number(timeoutMs) || 90000),
        responseType: "text",
        validateStatus: true
    });
    var status = res && res.statusCode ? Number(res.statusCode) : 0;
    var text = res && res.content != null ? String(res.content) : "";
    var json = null;
    if (text) { try { json = JSON.parse(text); } catch (e) { json = null; } }
    return { status: status, text: text, json: json };
}

/* 带重试的请求：最多 3 次（1 次原始 + 2 次重试），退避 800ms / 2000ms。
   只重试可恢复错误；配置类错误（400/401/403/404）立刻返回，不浪费配额。 */
async function postJson(url, headers, bodyObj, timeoutMs) {
    var waits = [800, 2000];
    var last = null;
    for (var attempt = 0; attempt <= waits.length; attempt++) {
        try {
            last = await postJsonOnce(url, headers, bodyObj, timeoutMs);
        } catch (e) {
            /* 网络层抛异常：当作 status=0，可重试 */
            last = { status: 0, text: String((e && e.message) || e), json: null };
        }
        if (!isRetryable(last.status, last.text)) return last;
        if (attempt < waits.length) {
            try { await Tools.System.sleep(waits[attempt]); } catch (eS) {}
        }
    }
    return last;
}

function toResponsesInput(messages) {
    var input = [];
    for (var i = 0; i < messages.length; i++) {
        var m = messages[i] || {};
        var role = String(m.role || "user");
        if (role === "tool") {
            input.push({ type: "function_call_output", call_id: String(m.tool_call_id || ""), output: String(m.content || "") });
            continue;
        }
        if (role === "assistant") {
            var txt = String(m.content || "");
            if (txt) input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: txt }] });
            var tcs = m.tool_calls || [];
            for (var j = 0; j < tcs.length; j++) {
                var tc = tcs[j] || {};
                var fn = tc.function || {};
                input.push({ type: "function_call", call_id: String(tc.id || ""), name: String(fn.name || ""), arguments: String(fn.arguments || "{}") });
            }
            continue;
        }
        input.push({ type: "message", role: role === "system" ? "system" : "user", content: [{ type: "input_text", text: String(m.content || "") }] });
    }
    for (var k = 0; k < input.length; k++) {
        if (input[k].type === undefined) { input[k] = { type: "message", role: input[k].role, content: String(input[k].content || "") }; }
        if (input[k].type === "message" && typeof input[k].content === "string") input[k].content = [{ type: "input_text", text: input[k].content }];
    }
    return input;
}
async function callResponses(cfg, profile, messages, allowed, level, timeoutMs) {
    var url = joinUrl(profile.base_url, "/responses");
    var tools = [];
    var schema = runToolSchema(allowed);
    for (var i = 0; i < schema.length; i++) {
        var f = schema[i].function || {};
        tools.push({ type: "function", name: f.name, description: f.description, parameters: f.parameters });
    }
    var body = { model: profile.model, input: toResponsesInput(messages), stream: false };
    /* 空白名单 = 全拒：不带 tools */
    if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }
    var eb = (profile && profile.extra_body) ? profile.extra_body : {};
    for (var k in eb) { if (Object.prototype.hasOwnProperty.call(eb, k)) body[k] = eb[k]; }
    var res = await postJson(url, headersOf(cfg, profile), body, timeoutMs);
    if (!res.status || res.status < 200 || res.status >= 300) {
        return { ok: false, status: res.status, error: errorHint(res.status, res.text), raw: String(res.text || "").slice(0, 2000) };
    }
    var j = res.json || {};
    var out = j.output || [];
    var content = "", reasoning = "", toolCalls = [];
    for (var oi = 0; oi < out.length; oi++) {
        var item = out[oi] || {};
        if (item.type === "message") {
            var cs = item.content || [];
            for (var ci = 0; ci < cs.length; ci++) {
                var c = cs[ci] || {};
                if (c.type === "output_text") content += String(c.text || "");
            }
        } else if (item.type === "reasoning") {
            var rs = item.summary || item.content || [];
            for (var ri = 0; ri < rs.length; ri++) reasoning += String((rs[ri] || {}).text || "");
        } else if (item.type === "function_call") {
            var args = {};
            try { args = JSON.parse(String(item.arguments || "{}")); } catch (e) { args = { __unparsed: String(item.arguments || "") }; }
            toolCalls.push({ id: String(item.call_id || item.id || ("call_" + oi)), name: String(item.name || ""), args: args });
        }
    }
    if (!content && !toolCalls.length && j.output_text) content = String(j.output_text);
    var u = j.usage || {};
    return {
        ok: true, content: content, reasoning: reasoning, toolCalls: toolCalls,
        finishReason: toolCalls.length ? "tool_calls" : "stop",
        usage: { in: Number(u.input_tokens || 0), out: Number(u.output_tokens || 0), total: Number(u.total_tokens || 0) || (Number(u.input_tokens || 0) + Number(u.output_tokens || 0)) },
        model: String(j.model || profile.model)
    };
}
function toAnthropicMessages(messages) {
    var sys = "", arr = [];
    for (var i = 0; i < messages.length; i++) {
        var m = messages[i] || {};
        var role = String(m.role || "user");
        if (role === "system") { sys += (sys ? "\n" : "") + String(m.content || ""); continue; }
        if (role === "tool") {
            arr.push({ role: "user", content: [{ type: "tool_result", tool_use_id: String(m.tool_call_id || ""), content: String(m.content || "") }] });
            continue;
        }
        if (role === "assistant") {
            var blocks = [];
            var txt = String(m.content || "");
            if (txt) blocks.push({ type: "text", text: txt });
            var tcs = m.tool_calls || [];
            for (var j = 0; j < tcs.length; j++) {
                var tc = tcs[j] || {};
                var fn = tc.function || {};
                var input = {};
                try { input = JSON.parse(String(fn.arguments || "{}")); } catch (e) { input = {}; }
                blocks.push({ type: "tool_use", id: String(tc.id || ""), name: String(fn.name || ""), input: input });
            }
            if (blocks.length) arr.push({ role: "assistant", content: blocks });
            continue;
        }
        arr.push({ role: "user", content: [{ type: "text", text: String(m.content || "") }] });
    }
    return { system: sys, messages: arr };
}
async function callAnthropic(cfg, profile, messages, allowed, level, timeoutMs) {
    var url = joinUrl(profile.base_url, "/messages");
    var conv = toAnthropicMessages(messages);
    var schema = runToolSchema(allowed), tools = [];
    for (var i = 0; i < schema.length; i++) {
        var f = schema[i].function || {};
        tools.push({ name: f.name, description: f.description, input_schema: f.parameters });
    }
    var body = { model: profile.model, max_tokens: 4096, messages: conv.messages, stream: false };
    /* 空白名单 = 全拒：不带 tools */
    if (tools && tools.length) { body.tools = tools; }
    if (conv.system) body.system = conv.system;
    var eb = (profile && profile.extra_body) ? profile.extra_body : {};
    for (var k in eb) { if (Object.prototype.hasOwnProperty.call(eb, k)) body[k] = eb[k]; }
    var h = headersOf(cfg, profile);
    h["anthropic-version"] = "2023-06-01";
    var key = "";
    try { key = String(getEnv(profile.api_key_env || "SUBAGENT_API_KEY") || ""); } catch (e) { key = ""; }
    if (key) { h["x-api-key"] = key; delete h["Authorization"]; }
    var res = await postJson(url, h, body, timeoutMs);
    if (!res.status || res.status < 200 || res.status >= 300) {
        return { ok: false, status: res.status, error: errorHint(res.status, res.text), raw: String(res.text || "").slice(0, 2000) };
    }
    var j = res.json || {};
    var blocks = j.content || [];
    var content = "", toolCalls = [];
    for (var bi = 0; bi < blocks.length; bi++) {
        var b = blocks[bi] || {};
        if (b.type === "text") content += String(b.text || "");
        else if (b.type === "tool_use") toolCalls.push({ id: String(b.id || ("call_" + bi)), name: String(b.name || ""), args: (b.input && typeof b.input === "object") ? b.input : {} });
    }
    var u = j.usage || {};
    return {
        ok: true, content: content, reasoning: "", toolCalls: toolCalls,
        finishReason: toolCalls.length ? "tool_calls" : String(j.stop_reason || "stop"),
        usage: { in: Number(u.input_tokens || 0), out: Number(u.output_tokens || 0), total: Number(u.input_tokens || 0) + Number(u.output_tokens || 0) },
        model: String(j.model || profile.model)
    };
}

async function callChat(cfg, profile, messages, allowed, level, timeoutMs) {
    if (String(profile.base_url || "").indexOf("mock://") === 0) {
        var seenTool = false;
        for (var mi = 0; mi < messages.length; mi++) {
            if (String((messages[mi] || {}).role || "") === "tool") seenTool = true;
        }
        var canRead = false;
        for (var ai = 0; ai < (allowed || []).length; ai++) {
            var nm = String(allowed[ai] || "");
            if (nm === "read_file" || nm === "*" || nm === "read*") canRead = true;
        }
        if (!seenTool && canRead) {
            return { ok: true, content: "（mock）先读一下文件。", reasoning: "mock：需要先拿内容", toolCalls: [{ id: "call_mock_1", name: "read_file", args: { path: "/sdcard/x/subagent/PLAN.md" } }], finishReason: "tool_calls", usage: { in: 12, out: 8, total: 20 }, model: "mock-model" };
        }
        return { ok: true, content: "（mock）链路通：已拿到工具结果并给出结论。", reasoning: "mock：收尾", toolCalls: [], finishReason: "stop", usage: { in: 30, out: 10, total: 40 }, model: "mock-model" };
    }
    if (String(profile.protocol || "chat") === "anthropic") {
        return await callAnthropic(cfg, profile, messages, allowed, level, timeoutMs);
    }
    if (String(profile.protocol || "chat") === "responses") {
        return await callResponses(cfg, profile, messages, allowed, level, timeoutMs);
    }
    var url = joinUrl(profile.base_url, "/chat/completions");
    var body = {
        model: profile.model,
        messages: messages,
        stream: false
    };
    /* 空白名单 = 全拒（用户拍板），这时不带 tools 字段。
       带一个空的 tools:[] 或一个必然失败的 run_tool 都比不带更糟。 */
    var _sch = runToolSchema(allowed);
    if (_sch && _sch.length) {
        body.tools = _sch;
        body.tool_choice = "auto";
    }
    var th = thinkingFields(cfg, level);
    var k;
    for (k in th) { if (Object.prototype.hasOwnProperty.call(th, k)) body[k] = th[k]; }
    var eb = (profile && profile.extra_body) ? profile.extra_body : {};
    for (k in eb) { if (Object.prototype.hasOwnProperty.call(eb, k)) body[k] = eb[k]; }

    var res = await postJson(url, headersOf(cfg, profile), body, timeoutMs);
    if (!res.status || res.status < 200 || res.status >= 300) {
        var hint = errorHint(res.status, res.text);
        /* 503 / upstream 报错时，最常见的原因是模型名不存在（中转站查不到这个 model）。
           直接把「用了哪个 model」写进错误里，省得对着原始 JSON 猜。 */
        if (res.status >= 500 || /upstream|No local upstream|model/i.test(String(res.text || ""))) {
            hint = "端点拒绝了这个模型名（" + String(profile.model || "(空)") + "）。" + hint;
        }
        return { ok: false, status: res.status, error: hint, raw: res.text.slice(0, 2000) };
    }
    if (!res.json || !res.json.choices || !res.json.choices.length) {
        return { ok: false, status: res.status, error: "响应里没有 choices：" + res.text.slice(0, 300) };
    }
    var msg = res.json.choices[0].message || {};
    var toolCalls = [];
    var tcs = msg.tool_calls || [];
    for (var i = 0; i < tcs.length; i++) {
        var tc = tcs[i] || {};
        var fn = tc.function || {};
        var name = String(fn.name || "");
        var argsText = fn.arguments;
        var args = {};
        if (typeof argsText === "string" && argsText) {
            try { args = JSON.parse(argsText); } catch (e) { args = { __unparsed: argsText }; }
        } else if (argsText && typeof argsText === "object") {
            args = argsText;
        }
        toolCalls.push({ id: String(tc.id || ("call_" + i)), name: name, args: args });
    }
    var usage = res.json.usage || {};
    return {
        ok: true,
        content: String(msg.content || ""),
        reasoning: String(msg.reasoning_content || msg.reasoning || ""),
        toolCalls: toolCalls,
        finishReason: String((res.json.choices[0] || {}).finish_reason || ""),
        usage: {
            in: Number(usage.prompt_tokens || 0),
            out: Number(usage.completion_tokens || 0),
            total: Number(usage.total_tokens || 0)
        },
        model: String(res.json.model || profile.model || "")
    };
}

async function listModels(cfg, profile, timeoutMs) {
    var url = joinUrl(profile.base_url, "/models");
    try {
        var res = await Tools.Net.http({
            url: url, method: "GET", headers: headersOf(cfg, profile),
            connect_timeout: 5000, read_timeout: Math.max(5000, Number(timeoutMs) || 20000),
            responseType: "text", validateStatus: true
        });
        var status = Number(res.statusCode || 0);
        var text = String(res.content || "");
        var json = null;
        if (text) { try { json = JSON.parse(text); } catch (e) { json = null; } }
        if (status !== 200) return { ok: false, status: status, error: errorHint(status, text) };
        if (!json || !Array.isArray(json.data)) return { ok: false, status: status, error: "响应里没有 data 数组" };
        var ids = [];
        for (var i = 0; i < json.data.length; i++) {
            var it = json.data[i] || {};
            var id = String(it.id || it.name || "");
            if (id) ids.push(id);
        }
        ids.sort();
        return { ok: true, models: ids, count: ids.length };
    } catch (e) {
        return { ok: false, status: 0, error: String((e && e.message) || e) };
    }
}

function estimateCost(cfg, usage) {
    try {
        var p = (cfg && cfg.pricing) || {};
        var inP = Number(p.in_per_million || 0);
        var outP = Number(p.out_per_million || 0);
        if (!inP && !outP) return 0;
        var cost = (Number(usage.in || 0) / 1000000) * inP + (Number(usage.out || 0) / 1000000) * outP;
        return Math.round(cost * 1000000) / 1000000;
    } catch (e) { return 0; }
}

module.exports = {
    RUN_TOOL: RUN_TOOL,
    resolveProfile: resolveProfile,
    headersOf: headersOf,
    joinUrl: joinUrl,
    thinkingFields: thinkingFields,
    callChat: callChat,
    listModels: listModels,
    estimateCost: estimateCost,
    errorHint: errorHint,
    runToolSchema: runToolSchema
};
