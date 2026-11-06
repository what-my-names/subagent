/* sb_tools.js — 工具代理：白名单、写类校验、undo 备份、执行与序列化 */
"use strict";

var WRITE_TOOLS = {
    create_file: true, edit_file: true, write_file: true, delete_file: true,
    move_file: true, copy_file: true, apply_file: true, zip_files: true, unzip_files: true,
    terminal: true, shell: true, terminal_exec: true
};

var PATH_KEYS = ["path", "file", "file_path", "source", "src", "dest", "destination", "target"];

function isWriteTool(name) {
    var n = String(name || "");
    if (WRITE_TOOLS[n]) return true;
    var lower = n.toLowerCase();
    return /(^|[_:-])(write|edit|create|delete|move|copy|apply|zip|unzip|terminal|shell)([_:-]|$)/.test(lower);
}

function isRecursive(name) {
    var n = String(name || "");
    if (!n) return false;
    if (n === "subagent" || n === "subagent:*") return true;
    if (n.indexOf("subagent") === 0) return true;
    if (n.indexOf(":subagent") >= 0) return true;
    if (n.indexOf("*subagent") >= 0) return true;
    return false;
}

function matchOne(name, pat) {
    var p = String(pat || "").trim();
    if (!p) return false;
    if (p === name) return true;
    if (p.indexOf("*") >= 0) {
        var rx = new RegExp("^" + p.split("*").join(".*") + "$");
        return rx.test(name);
    }
    if (name.indexOf(p + ":") === 0) return true;
    return false;
}

function matchAllowed(name, allowed) {
    if (!allowed || !allowed.length) return false;
    for (var i = 0; i < allowed.length; i++) {
        if (matchOne(name, allowed[i])) return true;
    }
    return false;
}

function extractPaths(args) {
    var out = [];
    if (!args || typeof args !== "object") return out;
    for (var i = 0; i < PATH_KEYS.length; i++) {
        var k = PATH_KEYS[i];
        if (args[k] != null) {
            var v = String(args[k]);
            if (v) out.push(v);
        }
    }
    return out;
}

function inRoot(p, root) {
    var path = String(p || "");
    var r = String(root || "").replace(/\/+$/, "");
    if (!r) return false;
    return path === r || path.indexOf(r + "/") === 0;
}

function rootsOf(ctx) {
    if (ctx && Array.isArray(ctx.roots)) return ctx.roots.filter(function (x) { return !!x; });
    if (ctx && ctx.workspace) return [ctx.workspace];
    return [];
}

function inAnyRoot(p, roots) {
    for (var i = 0; i < roots.length; i++) {
        if (inRoot(p, roots[i])) return true;
    }
    return false;
}

function clip(text, n) {
    var s = String(text == null ? "" : text);
    if (!n || s.length <= n) return { text: s, truncated: false, chars: s.length };
    return { text: s.slice(0, n) + "\n...(已截断，原长 " + s.length + " 字符)", truncated: true, chars: s.length };
}

function serialize(value) {
    try {
        if (typeof value === "string") return value;
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
}

async function exists(path) {
    try {
        var r = await Tools.Files.exists(path, "android");
        return !!(r && r.exists);
    } catch (e) { return false; }
}

async function backupBeforeWrite(ctx, toolName, args, seq) {
    var names = [];
    var paths = extractPaths(args);
    var undoDir = ctx.productDir + "/.undo/" + seq;
    var roots = rootsOf(ctx);
    for (var i = 0; i < paths.length; i++) {
        var p = paths[i];
        if (!inAnyRoot(p, roots)) continue;
        var ex = await exists(p);
        var base = p.split("/").pop() || "file";
        if (ex) {
            try {
                await Tools.Files.mkdir(undoDir, true, "android");
                var dst = undoDir + "/" + (i + 1) + "_" + base;
                await Tools.Files.copy(p, dst, false, "android", "android");
                names.push({ type: "restore", path: p, backup: dst, tool: toolName });
            } catch (e) {}
        } else {
            names.push({ type: "remove", path: p, backup: null, tool: toolName });
        }
    }
    return names;
}

/* 工具名清洗：模型有时把 Operit 内部传参编码串整段塞进 tool 字段，
   形如 "visit_web<tool_sep:xxx><arg_key:xxx>args</arg_key>..."，
   直接比对白名单必然失败（表现为「工具不在允许范围」但错误里又列出了该工具）。
   截断到第一个 '<' 之前，再去掉空白。 */
function cleanToolName(raw) {
    var name = String(raw || "").trim();
    var lt = name.indexOf("<");
    if (lt >= 0) name = name.slice(0, lt).trim();
    return name.replace(/\s+/g, "");
}

async function runOne(ctx, request) {
    var rawName = String(request && request.tool ? request.tool : "").trim();
    var name = cleanToolName(rawName);
    var args = (request && request.args && typeof request.args === "object") ? request.args : {};
    if (!name) return { ok: false, tool: rawName, error: "缺少 tool" };
    if (isRecursive(name)) return { ok: false, tool: name, error: "禁止递归派子代理" };
    if (!matchAllowed(name, ctx.allowed)) {
        return { ok: false, tool: name, error: "工具不在允许范围：" + name + "。允许：" + ctx.allowed.join(", ") };
    }
    var write = isWriteTool(name);
    if (write) {
        var wroots = rootsOf(ctx);
        if (!wroots.length) {
            return { ok: false, tool: name, error: "写类工具需要 workspace，但本任务没有可用的写入范围" };
        }
        var paths = extractPaths(args);
        if (!paths.length) {
            return { ok: false, tool: name, error: "写类工具无法确定路径参数（支持键名：" + PATH_KEYS.join("/") + "）" };
        }
        for (var i = 0; i < paths.length; i++) {
            if (!inAnyRoot(paths[i], wroots)) {
                return { ok: false, tool: name, error: "路径越界：" + paths[i] + "，只允许写在 " + wroots.join(" 或 ") };
            }
        }
        var recs = await backupBeforeWrite(ctx, name, args, ctx.nextSeq());
        if (recs.length) {
            ctx.appendUndo(recs);
        }
    }
    var out, err = null;
    var tTool = Date.now();
    try {
        out = await toolCall(name, args);
    } catch (e) {
        err = String((e && e.message) || e);
    }
    var ms = Date.now() - tTool;
    if (err) return { ok: false, tool: name, error: err, ms: ms };
    var text = serialize(out);
    var c = clip(text, ctx.maxChars);
    return { ok: true, tool: name, chars: c.chars, ms: ms, truncated: c.truncated, result: c.text };
}

async function undoAll(ctx, dryRun) {
    var list = ctx.loadUndo().slice().reverse();
    var plan = [];
    for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        plan.push({ type: it.type, path: it.path, backup: it.backup });
        if (dryRun) continue;
        try {
            if (it.type === "restore" && it.backup) {
                await Tools.Files.copy(it.backup, it.path, false, "android", "android");
            } else if (it.type === "remove") {
                await Tools.Files.deleteFile(it.path, false, "android");
            }
        } catch (e) {}
    }
    if (!dryRun) ctx.clearUndo();
    return plan;
}

module.exports = {
    isWriteTool: isWriteTool,
    isRecursive: isRecursive,
    matchAllowed: matchAllowed,
    cleanToolName: cleanToolName,
    extractPaths: extractPaths,
    inRoot: inRoot,
    clip: clip,
    runOne: runOne,
    undoAll: undoAll,
    PATH_KEYS: PATH_KEYS
};
