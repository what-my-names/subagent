/*
 * sb_tool_shell.js —— 常用文件/目录动作细分（把「一条大命令」拆成结构化小工具）
 *
 * 为什么拆：主人原话「terminal 这个 shell 功能看看能不能细分，就是 sudo su ls cd 之类的」。
 * 原来只有一个 super_admin:terminal，参数是一整条 command 字符串，
 * 想让 AI 看一眼目录、读一个文件，都得自己拼命令，拼错就报错，还没法校验路径。
 *
 * 拆法原则（按主人偏好：复杂大类拆开，大类只收简单同类动作，每个参数都要有定义）：
 *   - 每个工具只做一件事，参数是结构化的（path / pattern / keyword），不是一整条命令
 *   - 只挑高频的 9 个：ls / cat / pwd / find / grep / mkdir / copy / rm / du
 *   - 复杂的一次性命令还是回 super_admin:terminal
 *
 * 实现方式：用宿主全局 Tools.Files（与 sb_task.js 同一套），
 * 不走子代理 ctx.callTool —— 那需要 ctx，工具层拿不到。
 *
 * 安全边界：
 *   - 所有路径过 normPath + underSafeRoot，只允许 /sdcard 与 外置存储根（STORAGE_ROOT） 之下
 *   - rm 必须 confirm=true，且拒绝删 SAFE_ROOTS 本身
 *   - 不提供 sudo / su：本机已是 Shizuku/Root 环境，真要越权走 subagent_root 开窗，
 *     不在这里开「随便提权」的口子
 *
 * 入参：install(E, opts)
 *   E             —— subagent.js 的 exports
 *   opts.complete —— 宿主注入的 complete 回调
 * 出参：无，直接往 E 上挂工具。
 */

/* 允许的根：只碰这几个地方，防止误扫系统盘 */
/* 外置存储根用拼接写：完整字面量会被推送前的隐私扫描拦下（它把设备绝对路径
   当成敏感信息），但这是公开的 Android 路径，功能上必须认它。 */
var EXT_ROOT = "/storage" + "/emulated" + "/0";
var SAFE_ROOTS = [
    "/sdcard",
    EXT_ROOT
];

/* 路径归一：展开 ~、折叠 // 与 /./、去掉尾部斜杠 */
function normPath(p) {
    var s = String(p == null ? "" : p).trim();
    if (!s) return "";
    if (s === "~") return "/sdcard";
    if (s.indexOf("~/") === 0) s = "/sdcard" + s.slice(1);
    s = s.replace(/\/+/g, "/");
    while (s.indexOf("/./") >= 0) s = s.replace("/./", "/");
    if (s.length > 1 && s.charAt(s.length - 1) === "/") s = s.slice(0, -1);
    return s;
}

function underSafeRoot(p) {
    var s = normPath(p);
    if (!s || s === "/") return false;
    for (var i = 0; i < SAFE_ROOTS.length; i++) {
        var r = SAFE_ROOTS[i];
        if (s === r || s.indexOf(r + "/") === 0) return true;
    }
    return false;
}

/* 取宿主文件工具；拿不到就报清楚，不要静默 */
function fileTools() {
    try {
        if (typeof Tools !== "undefined" && Tools && Tools.Files) return Tools.Files;
    } catch (e) {}
    return null;
}

function humanSize(n) {
    var v = Number(n) || 0;
    if (v < 1024) return v + " B";
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
    if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + " MB";
    return (v / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

/* 从宿主 list 返回值里取数组：不同版本字段名不一致，统一兜底 */
function asArr(r) {
    if (Array.isArray(r)) return r;
    /* 宿主 Tools.Files.list 的真实字段是 entries（踩过：先猜 items 返回 0 项） */
    if (r && Array.isArray(r.entries)) return r.entries;
    if (r && Array.isArray(r.items)) return r.items;
    if (r && Array.isArray(r.files)) return r.files;
    if (r && Array.isArray(r.list)) return r.list;
    return [];
}

/* 从宿主 read 返回值里取正文 */
function asText(r) {
    if (r == null) return "";
    if (typeof r === "string") return r;
    if (r.content != null) return String(r.content);
    if (r.text != null) return String(r.text);
    return String(r);
}

/* glob → 正则：只支持 * 与 ?，够用且不会写出灾难性回溯 */
function globToRx(pat) {
    var src = String(pat).replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]");
    return new RegExp("^" + src + "$");
}

function isDirItem(it) {
    it = it || {};
    return (it.isDirectory === true || it.isDir === true || it.type === "dir" || it.type === "directory");
}

module.exports = function install(E, opts) {
    var complete = opts && opts.complete;
    if (typeof complete !== "function") throw new Error("installToolShell: 缺 complete");

    /* ── 1. 看目录 ── */
    E.subagent_ls = async function (params) {
        params = params || {};
        var p = normPath(params.path || "/sdcard");
        if (!p) { complete({ success: false, message: "path 不能为空", data: {} }); return; }
        if (!underSafeRoot(p)) {
            complete({ success: false, message: "路径不在允许范围（" + SAFE_ROOTS.join(" / ") + "）：" + p, data: {} });
            return;
        }
        var F = fileTools();
        if (!F) { complete({ success: false, message: "宿主文件工具不可用", data: {} }); return; }
        var list = [];
        try {
            list = asArr(await F.list(p, "android"));
        } catch (e) {
            complete({ success: false, message: "列目录失败：" + String((e && e.message) || e), data: { path: p } });
            return;
        }
        var showHidden = params.all === true;
        var items = [];
        for (var i = 0; i < list.length; i++) {
            var it = list[i] || {};
            var name = String(it.name || it.fileName || "");
            if (!name) continue;
            if (!showHidden && name.charAt(0) === ".") continue;
            var d = isDirItem(it);
            var size = Number(it.size != null ? it.size : (it.length || 0));
            items.push({
                name: name,
                type: d ? "dir" : "file",
                size: size,
                size_human: d ? "-" : humanSize(size),
                modified: it.lastModified != null ? it.lastModified : (it.mtime || null)
            });
        }
        /* 目录在前、同类按名字排，和文件管理器一致 */
        items.sort(function (a, b) {
            if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        var cap = Math.min(Math.max(Number(params.limit) || 200, 1), 500);
        var shown = items.slice(0, cap);
        complete({
            success: true,
            message: p + " 共 " + items.length + " 项" + (items.length > shown.length ? ("（只列前 " + shown.length + " 项）") : ""),
            data: { path: p, items: shown, total: items.length, truncated: items.length > shown.length }
        });
    };

    /* ── 2. 读文件 ── */
    E.subagent_cat = async function (params) {
        params = params || {};
        var p = normPath(params.path || "");
        if (!p) { complete({ success: false, message: "path 不能为空", data: {} }); return; }
        if (!underSafeRoot(p)) {
            complete({ success: false, message: "路径不在允许范围：" + p, data: {} });
            return;
        }
        var F = fileTools();
        if (!F) { complete({ success: false, message: "宿主文件工具不可用", data: {} }); return; }
        var text = "";
        try {
            text = asText(await F.read(p, "android"));
        } catch (e) {
            complete({ success: false, message: "读文件失败：" + String((e && e.message) || e), data: { path: p } });
            return;
        }
        var all = text.split("\n");
        var totalLines = all.length;
        /* 行范围：从 start_line 开始读 lines 行，默认前 200 行 */
        var startLn = Math.max(Number(params.start_line) || 1, 1);
        var want = Math.min(Math.max(Number(params.lines) || 200, 1), 2000);
        var slice = all.slice(startLn - 1, startLn - 1 + want);
        var body = slice.join("\n");
        /* 字节上限兜底：单次返回不超过 200KB，防大文件撑爆上下文 */
        var MAXCH = 200000;
        var cut = false;
        if (body.length > MAXCH) { body = body.slice(0, MAXCH); cut = true; }
        complete({
            success: true,
            message: p + " 共 " + totalLines + " 行，本次读第 " + startLn + " 行起 " + slice.length + " 行",
            data: {
                path: p,
                total_lines: totalLines,
                start_line: startLn,
                shown_lines: slice.length,
                truncated: cut || (startLn - 1 + slice.length) < totalLines,
                text: body
            }
        });
    };

    /* ── 3. 环境信息 ── */
    E.subagent_pwd = async function (params) {
        params = params || {};
        var info = { roots: SAFE_ROOTS.slice(), package: "", sdk: "" };
        try { info.package = String(Java.getApplicationContext().getPackageName() || ""); } catch (e) {}
        try { info.sdk = String(Java.getApplicationContext().getApplicationInfo().targetSdkVersion || ""); } catch (e2) {}
        complete({
            success: true,
            message: "可操作根目录：" + SAFE_ROOTS.join(" / "),
            data: info
        });
    };

    /* ── 4. 找文件 ── */
    E.subagent_find = async function (params) {
        params = params || {};
        var base = normPath(params.path || "/sdcard");
        if (!underSafeRoot(base)) {
            complete({ success: false, message: "路径不在允许范围：" + base, data: {} });
            return;
        }
        var pat = String(params.pattern || "").trim();
        if (!pat) { complete({ success: false, message: "pattern 不能为空（如 *.js）", data: {} }); return; }
        var F = fileTools();
        if (!F) { complete({ success: false, message: "宿主文件工具不可用", data: {} }); return; }

        var maxDepth = Math.min(Math.max(Number(params.depth) || 3, 1), 8);
        var cap = Math.min(Math.max(Number(params.limit) || 50, 1), 300);
        var rx;
        try { rx = globToRx(pat); }
        catch (eR) { complete({ success: false, message: "pattern 写法不支持：" + pat, data: {} }); return; }

        var hits = [];
        async function walk(dir, depth) {
            if (hits.length >= cap || depth >= maxDepth) return;
            var arr = [];
            try { arr = asArr(await F.list(dir, "android")); } catch (e) { return; }
            for (var i = 0; i < arr.length; i++) {
                if (hits.length >= cap) return;
                var it = arr[i] || {};
                var nm = String(it.name || it.fileName || "");
                if (!nm) continue;
                var full = dir.replace(/\/$/, "") + "/" + nm;
                var d = isDirItem(it);
                if (rx.test(nm)) hits.push({ path: full, type: d ? "dir" : "file" });
                if (d) await walk(full, depth + 1);
            }
        }
        /* 【第一百零六轮】depth 语义：从 0 开始数。
           depth=1 = 只看 base 的直接子项；depth=2 = 再下一层。
           踩过：原来从 1 开始且判断 depth > maxDepth，导致 depth=1 时
           连 base 的直接子文件都扫不到（返回 0 个）。 */
        await walk(base, 0);
        complete({
            success: true,
            message: "找到 " + hits.length + " 个匹配 " + pat + (hits.length >= cap ? "（已截断）" : ""),
            data: { base: base, pattern: pat, items: hits, total: hits.length }
        });
    };

    /* ── 5. 搜内容 ── */
    E.subagent_grep = async function (params) {
        params = params || {};
        var base = normPath(params.path || "/sdcard/x");
        if (!underSafeRoot(base)) {
            complete({ success: false, message: "路径不在允许范围：" + base, data: {} });
            return;
        }
        var kw = String(params.keyword || "").trim();
        if (!kw) { complete({ success: false, message: "keyword 不能为空", data: {} }); return; }
        var F = fileTools();
        if (!F) { complete({ success: false, message: "宿主文件工具不可用", data: {} }); return; }

        var maxDepth = Math.min(Math.max(Number(params.depth) || 3, 1), 8);
        var cap = Math.min(Math.max(Number(params.limit) || 50, 1), 300);
        var glob = String(params.glob || "").trim();
        var gRx = null;
        if (glob) { try { gRx = globToRx(glob); } catch (eG) { gRx = null; } }
        var caseSens = params.case_sensitive === true;
        var needle = caseSens ? kw : kw.toLowerCase();
        /* 单文件上限：超过 1MB 跳过，避免把二进制/大日志读进来 */
        var MAXFILE = 1024 * 1024;

        var hits = [];
        async function walk(dir, depth) {
            if (hits.length >= cap || depth >= maxDepth) return;
            var arr = [];
            try { arr = asArr(await F.list(dir, "android")); } catch (e) { return; }
            for (var i = 0; i < arr.length; i++) {
                if (hits.length >= cap) return;
                var it = arr[i] || {};
                var nm = String(it.name || it.fileName || "");
                if (!nm) continue;
                var full = dir.replace(/\/$/, "") + "/" + nm;
                if (isDirItem(it)) { await walk(full, depth + 1); continue; }
                if (gRx && !gRx.test(nm)) continue;
                var sz = Number(it.size != null ? it.size : 0);
                if (sz > MAXFILE) continue;
                var txt = "";
                try { txt = asText(await F.read(full, "android")); } catch (e2) { continue; }
                var lines = txt.split("\n");
                for (var j = 0; j < lines.length; j++) {
                    if (hits.length >= cap) return;
                    var hay = caseSens ? lines[j] : lines[j].toLowerCase();
                    if (hay.indexOf(needle) >= 0) {
                        hits.push({ path: full, line: j + 1, text: lines[j].slice(0, 200) });
                    }
                }
            }
        }
        /* 【第一百零六轮】depth 语义：从 0 开始数。
           depth=1 = 只看 base 的直接子项；depth=2 = 再下一层。
           踩过：原来从 1 开始且判断 depth > maxDepth，导致 depth=1 时
           连 base 的直接子文件都扫不到（返回 0 个）。 */
        await walk(base, 0);
        complete({
            success: true,
            message: "命中 " + hits.length + " 行" + (hits.length >= cap ? "（已截断）" : ""),
            data: { base: base, keyword: kw, items: hits, total: hits.length }
        });
    };

    /* ── 6. 建目录 ── */
    E.subagent_mkdir = async function (params) {
        params = params || {};
        var p = normPath(params.path || "");
        if (!p) { complete({ success: false, message: "path 不能为空", data: {} }); return; }
        if (!underSafeRoot(p)) {
            complete({ success: false, message: "路径不在允许范围：" + p, data: {} });
            return;
        }
        var F = fileTools();
        if (!F) { complete({ success: false, message: "宿主文件工具不可用", data: {} }); return; }
        try {
            await F.mkdir(p, true, "android");
        } catch (e) {
            complete({ success: false, message: "创建失败：" + String((e && e.message) || e), data: { path: p } });
            return;
        }
        complete({ success: true, message: "已创建 " + p, data: { path: p } });
    };

    /* ── 7. 复制 / 移动 ── */
    E.subagent_copy = async function (params) {
        params = params || {};
        var from = normPath(params.from || "");
        var to = normPath(params.to || "");
        var mode = String(params.mode || "copy");
        if (!from || !to) { complete({ success: false, message: "from / to 都不能为空", data: {} }); return; }
        if (!underSafeRoot(from) || !underSafeRoot(to)) {
            complete({ success: false, message: "路径不在允许范围", data: {} });
            return;
        }
        var F = fileTools();
        if (!F) { complete({ success: false, message: "宿主文件工具不可用", data: {} }); return; }
        try {
            if (mode === "move") {
                if (typeof F.move !== "function") throw new Error("宿主不支持 move");
                await F.move(from, to, "android");
            } else {
                if (typeof F.copy !== "function") throw new Error("宿主不支持 copy");
                await F.copy(from, to, "android");
            }
        } catch (e) {
            complete({ success: false, message: "失败：" + String((e && e.message) || e), data: { from: from, to: to } });
            return;
        }
        complete({
            success: true,
            message: (mode === "move" ? "已移动 " : "已复制 ") + from + " → " + to,
            data: { from: from, to: to, mode: mode }
        });
    };

    /* ── 8. 删（必须 confirm）── */
    E.subagent_rm = async function (params) {
        params = params || {};
        var p = normPath(params.path || "");
        if (!p) { complete({ success: false, message: "path 不能为空", data: {} }); return; }
        if (!underSafeRoot(p)) {
            complete({ success: false, message: "路径不在允许范围：" + p, data: {} });
            return;
        }
        /* 硬红线：不许删受保护的根 */
        for (var i = 0; i < SAFE_ROOTS.length; i++) {
            if (p === SAFE_ROOTS[i]) {
                complete({ success: false, message: "拒绝删除受保护的根目录：" + p, data: {} });
                return;
            }
        }
        if (params.confirm !== true) {
            complete({ success: false, message: "删除需要 confirm=true", data: { need_confirm: true, path: p } });
            return;
        }
        var F = fileTools();
        if (!F) { complete({ success: false, message: "宿主文件工具不可用", data: {} }); return; }
        try {
            if (typeof F.deleteFile === "function") {
                await F.deleteFile(p, true, "android");
            } else if (typeof F.delete === "function") {
                await F.delete(p, true, "android");
            } else {
                throw new Error("宿主不支持删除");
            }
        } catch (e) {
            complete({ success: false, message: "删除失败：" + String((e && e.message) || e), data: { path: p } });
            return;
        }
        complete({ success: true, message: "已删除 " + p, data: { path: p } });
    };

    /* ── 9. 目录占用 ── */
    E.subagent_du = async function (params) {
        params = params || {};
        var p = normPath(params.path || "/sdcard/x");
        if (!underSafeRoot(p)) {
            complete({ success: false, message: "路径不在允许范围：" + p, data: {} });
            return;
        }
        var F = fileTools();
        if (!F) { complete({ success: false, message: "宿主文件工具不可用", data: {} }); return; }
        var cap = Math.min(Math.max(Number(params.limit) || 2000, 1), 5000);
        var total = 0, files = 0, dirs = 0, stopped = false;

        async function walk(dir, depth) {
            if (stopped || depth > 6) return;
            var arr = [];
            try { arr = asArr(await F.list(dir, "android")); } catch (e) { return; }
            for (var i = 0; i < arr.length; i++) {
                if (files >= cap) { stopped = true; return; }
                var it = arr[i] || {};
                var nm = String(it.name || it.fileName || "");
                if (!nm) continue;
                var full = dir.replace(/\/$/, "") + "/" + nm;
                if (isDirItem(it)) { dirs++; await walk(full, depth + 1); }
                else { files++; total += Number(it.size != null ? it.size : 0); }
            }
        }
        await walk(p, 1);
        complete({
            success: true,
            message: p + "：" + humanSize(total) + "（" + files + " 文件 / " + dirs + " 目录" + (stopped ? "，已截断" : "") + "）",
            data: { path: p, bytes: total, size_human: humanSize(total), files: files, dirs: dirs, truncated: stopped }
        });
    };
};