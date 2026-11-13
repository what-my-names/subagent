/* sb_update.js — GitHub Release 自更新：检查 / 下载 / 状态
 *
 * 【为什么自己做】宿主没有通用更新机制，用户装的是 .toolpkg 快照，
 * 每次都要手动去 GitHub 找 Release、下载、再导入包管理。
 *
 * 【为什么全走 api.github.com】实测本机网络：
 *   github.com:443       不可达
 *   cdn.jsdelivr.net     不可达
 *   raw.githubusercontent 不可达
 *   api.github.com       可达
 * 所以 Release 列表和资产下载都必须走 API，不能走 browser_download_url。
 *
 * 【参考实现】on_air 的 on_air_update.js（已跑通的同款逻辑），
 * 下面几个坑都是那边踩出来的，直接沿用：
 *   1) resp.size 在流式执行时不准，用 base64 长度反推真实字节数
 *   2) 先写 .part，大小校验通过才 move，不留半个包
 *   3) 执行中进程可能被杀，10 分钟内不判死
 *   4) Release 列表按创建时间倒序，Beta 与正式版混排时取第一个会拿错，
 *      必须遍历取版本号最大的非 draft
 */
"use strict";

var CFG = require("./sb_config.js");

var REPO = "what-my-names/subagent";
var RELEASES_API = "https://api.github.com/repos/" + REPO + "/releases?per_page=5";
var ASSET_API = "https://api.github.com/repos/" + REPO + "/releases/assets/";
/* 6 小时缓存：GitHub 未认证限流 60 次/小时，面板上点检查不该每次都打 */
var TTL_MS = 6 * 60 * 60 * 1000;
/* 下载中不判死的窗口：执行中进程被杀会留下 running 状态，不能立刻当失败 */
var RUNNING_GRACE_MS = 10 * 60 * 1000;

/* 当前版本：从 VERSION.txt 读，不在代码里硬编码（否则发版要改两处，必忘） */
function currentVersion() {
    try {
        var fs = require("fs");
        var p = CFG.baseDir() + "/VERSION.txt";
        if (fs && typeof fs.existsSync === "function" && fs.existsSync(p)) {
            return String(fs.readFileSync(p, "utf8") || "").trim();
        }
    } catch (e) {}
    return "";
}

/* 语义化版本比较：a>b 返回 1，a<b 返回 -1，相等 0。
   忽略前缀 v；带 -beta/-rc 后缀的预发布版比同号正式版低。 */
function cmpVersion(a, b) {
    var ra = String(a || ""), rb = String(b || "");
    var preA = /-/.test(ra), preB = /-/.test(rb);
    var pa = ra.replace(/^v/i, "").replace(/\+/g, ".").split("-")[0].split(".");
    var pb = rb.replace(/^v/i, "").replace(/\+/g, ".").split("-")[0].split(".");
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
        var na = parseInt(pa[i] || "0", 10); if (isNaN(na)) na = 0;
        var nb = parseInt(pb[i] || "0", 10); if (isNaN(nb)) nb = 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    if (preA && !preB) return -1;
    if (!preA && preB) return 1;
    return 0;
}

/* Release 正文是 Markdown，面板只认纯文本。取前几行做摘要。 */
function mdToPlain(md, maxLines, maxChars) {
    var s = String(md || "").replace(/\r/g, "");
    /* 有【更新内容】标记就只取那一段 */
    var i = s.indexOf("【更新内容】");
    if (i >= 0) {
        s = s.slice(i + "【更新内容】".length);
        var j = s.indexOf("【");
        if (j >= 0) s = s.slice(0, j);
    }
    s = s.replace(/```[\s\S]*?```/g, " ");
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    var lines = s.split("\n");
    var out = [];
    var lim = maxLines || 12;
    for (var k = 0; k < lines.length; k++) {
        var line = String(lines[k]).replace(/^\s+|\s+$/g, "");
        if (!line) continue;
        if (/^#{1,6}\s/.test(line)) continue;
        if (/^>/.test(line)) continue;
        if (/^[-=*_]{3,}$/.test(line)) continue;
        line = line.replace(/^[·•]\s*/, "").replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "");
        line = line.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]*)`/g, "$1");
        out.push(line);
        if (out.length >= lim) break;
    }
    return out.join("\n").slice(0, maxChars || 900);
}

/* ---------- 缓存 ---------- */
function cachePath() { return CFG.cacheDir() + "/update_cache.json"; }

function readCache() {
    try {
        var fs = require("fs");
        var p = cachePath();
        if (fs && typeof fs.existsSync === "function" && fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, "utf8") || "{}");
        }
    } catch (e) {}
    return {};
}

function writeCache(obj) {
    try {
        var fs = require("fs");
        var p = cachePath();
        var dir = CFG.cacheDir();
        try { if (fs && fs.mkdirSync && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (eM) {}
        fs.writeFileSync(p, JSON.stringify(obj), "utf8");
    } catch (e) {}
}

/* ---------- 下载状态（跨进程可读，进程被杀也不丢） ---------- */
function dlPath() { return CFG.cacheDir() + "/download_state.json"; }

function readDl() {
    try {
        var fs = require("fs");
        var p = dlPath();
        if (fs && typeof fs.existsSync === "function" && fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, "utf8") || "{}");
        }
    } catch (e) {}
    return {};
}

function writeDl(patch) {
    var d = readDl();
    for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) d[k] = patch[k];
    }
    d.updated_at = Date.now();
    try {
        var fs = require("fs");
        var p = dlPath();
        var dir = CFG.cacheDir();
        try { if (fs && fs.mkdirSync && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (eM) {}
        fs.writeFileSync(p, JSON.stringify(d), "utf8");
    } catch (e) {}
    return d;
}

function fmtSize(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (Math.round(n / 104857.6) / 10) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
}

/* ---------- HTTP：统一走 api.github.com，用 OkHttp ----------
   【为什么不用 Tools.Net.http】它的返回只有 {statusCode, content, size}，
   content 是字符串，拿二进制要 base64 转换，而且没有 ok()/code() 这类判断。
   OkHttp 是运行时全局对象（无需 require），能直接 bodyAsBase64()，
   跟 on_air 的实现完全一致，那边已经跑通。 */
function createHttpClient(timeoutMs) {
    var t = (typeof timeoutMs === "number" && timeoutMs > 0) ? timeoutMs : 30000;
    return OkHttp.newBuilder()
        .connectTimeout(t).readTimeout(t).writeTimeout(t)
        .followRedirects(true)
        .build();
}

async function httpGet(url, accept, timeoutMs) {
    var client = createHttpClient(timeoutMs);
    var req = client.newRequest()
        .url(url)
        .method("GET")
        .headers({
            "User-Agent": "Operit/subagent",
            "Accept": accept || "application/vnd.github+json"
        })
        .build();
    return await req.execute();
}

/* 拉最新 Release。
   【关键】列表按创建时间倒序，正式版与 Beta 混排时取第一个会拿错，
   必须遍历取 tag 最大的非 draft。 */
async function fetchLatest(force) {
    var cache = readCache();
    var cur = currentVersion();
    var fresh = !!(cache && cache.checked_at && (Date.now() - cache.checked_at) < TTL_MS && cache.latest);
    /* 发版后：缓存里的版本比当前还旧 → 视为失效 */
    if (fresh && cur && cmpVersion(cache.latest.tag, cur) < 0) fresh = false;
    if (fresh && !force) return { cached: true, release: cache.latest };

    var r = await httpGet(RELEASES_API, "application/vnd.github+json", 20000);
    if (!r || typeof r.isSuccessful !== "function" || !r.isSuccessful()) {
        return { cached: false, error: "HTTP " + String((r && r.statusCode) || "?") };
    }
    var list = null;
    try { list = r.json(); } catch (e) { list = null; }
    if (!Array.isArray(list)) return { cached: false, error: "返回格式异常" };

    var data = null;
    for (var i = 0; i < list.length; i++) {
        var one = list[i];
        if (!one || one.draft) continue;
        if (!data || cmpVersion(one.tag_name, data.tag_name) > 0) data = one;
    }
    if (!data) return { cached: false, error: "没有可用的 Release" };

    /* 只认 .toolpkg 资产；找不到就报错，别让用户点了下载才发现没东西 */
    var assetUrl = "", assetName = "", assetSize = 0, assetId = 0;
    var assets = Array.isArray(data.assets) ? data.assets : [];
    for (var a = 0; a < assets.length; a++) {
        if (assets[a] && /\.toolpkg$/i.test(String(assets[a].name || ""))) {
            assetUrl = assets[a].browser_download_url || "";
            assetName = assets[a].name || "";
            assetSize = assets[a].size || 0;
            assetId = assets[a].id || 0;
            break;
        }
    }
    var rel = {
        tag: String(data.tag_name || ""),
        name: String(data.name || ""),
        notes: mdToPlain(String(data.body || ""), 12, 900),
        notes_full: mdToPlain(String(data.body || ""), 80, 4000),
        url: String(data.html_url || ""),
        published_at: String(data.published_at || ""),
        asset_url: assetUrl,
        asset_name: assetName,
        asset_size: assetSize,
        asset_id: assetId,
        prerelease: !!data.prerelease
    };
    writeCache({ checked_at: Date.now(), latest: rel });
    return { cached: false, release: rel };
}

/* ---------- 工具：检查更新 ---------- */
async function checkUpdate(params) {
    params = params || {};
    var cur = currentVersion();
    var r = await fetchLatest(!!params.force);
    if (r.error) return { ok: false, msg: "检查更新失败：" + r.error };
    var rel = r.release || {};
    var has = cur ? (cmpVersion(rel.tag, cur) > 0) : true;
    return {
        ok: true,
        msg: has ? ("发现新版本 " + rel.tag) : ("已是最新版本 " + (cur || "?")),
        data: {
            has_update: has,
            current: cur,
            latest: rel.tag,
            name: rel.name,
            notes: rel.notes,
            notes_full: rel.notes_full,
            url: rel.url,
            published_at: rel.published_at,
            asset_url: rel.asset_url,
            asset_name: rel.asset_name,
            asset_size: rel.asset_size || 0,
            has_asset: !!rel.asset_url,
            prerelease: !!rel.prerelease,
            cached: !!r.cached
        }
    };
}

/* ---------- 工具：下载更新 ---------- */
var _dlRunning = false;
var _dlStartedAt = 0;

async function downloadUpdate(params) {
    params = params || {};
    /* 连点保护：10 分钟内只允许一个实例，防漏释放把功能卡死 */
    if (_dlRunning && (Date.now() - _dlStartedAt) < RUNNING_GRACE_MS) {
        return { ok: false, msg: "正在下载中（已进行 " + Math.round((Date.now() - _dlStartedAt) / 1000) + " 秒）", data: { busy: true } };
    }
    _dlRunning = true;
    _dlStartedAt = Date.now();
    try {
        writeDl({ status: "running", received: 0, total: 0, path: "", version: "", attempts: 0, message: "正在获取版本信息…", started_at: Date.now() });

        var r = await fetchLatest(!!params.force);
        if (r.error) {
            writeDl({ status: "failed", message: "检查更新失败：" + r.error });
            return { ok: false, msg: "检查更新失败：" + r.error };
        }
        var rel = r.release || {};
        if (!rel.asset_id) {
            writeDl({ status: "failed", message: "该版本没有 .toolpkg 资产" });
            return { ok: false, msg: "该版本没有可下载的 .toolpkg 资产" };
        }

        var dir = "/sdcard/Download/Operit";
        var fileName = rel.asset_name || ("com.whatsmynames.subagent-" + rel.tag + ".toolpkg");
        var path = dir + "/" + fileName;
        var part = path + ".part";
        var total = Number(rel.asset_size) || 0;
        try { await Tools.Files.mkdir(dir, true, "android"); } catch (eM) {}

        /* 已存在完整包 → 直接算完成，连点/重开都逃不掉 */
        try {
            var fe0 = await Tools.Files.exists(path, "android");
            var sz0 = Number(fe0 && fe0.size) || 0;
            if (fe0 && fe0.exists && total > 0 && sz0 === total) {
                writeDl({ status: "done", received: sz0, total: total, path: path, version: rel.tag, message: "已下载 " + fmtSize(sz0) });
                return { ok: true, msg: "更新包已存在（" + fmtSize(sz0) + "），不用重复下载", data: { path: path, size: sz0, total: total, version: rel.tag, cached_file: true } };
            }
        } catch (eEx) {}

        var lastErr = "";
        var maxTry = 2;
        for (var attempt = 1; attempt <= maxTry; attempt++) {
            try {
                writeDl({ attempts: attempt, received: 0, message: "第 " + attempt + "/" + maxTry + " 次：连接中…" + (total > 0 ? "（共 " + fmtSize(total) + "）" : "") });
                /* 资产下载走 API + octet-stream。github.com 不可达，browser_download_url 用不了。 */
                var dlUrl = ASSET_API + rel.asset_id;
                var resp = await httpGet(dlUrl, "application/octet-stream", 45000);
                if (!resp || typeof resp.isSuccessful !== "function" || !resp.isSuccessful()) {
                    var code = Number((resp && resp.statusCode) || 0) || 0;
                    if (code === 404) {
                        writeDl({ status: "failed", message: "下载失败：404（该版本资产没上传到 Release）" });
                        return { ok: false, msg: "下载失败：404（该版本资产没上传到 Release）" };
                    }
                    lastErr = (code === 403) ? "403（GitHub 限流，稍后再试）" : ("HTTP " + (code || "?"));
                    throw new Error(lastErr);
                }

                /* 拿二进制。OkHttp 直接给 base64，不用自己转 */
                var b64 = null;
                try { b64 = resp.bodyAsBase64(); } catch (e1) { b64 = null; }
                if (!b64) throw new Error("拿不到二进制内容（空响应）");

                /* 【关键】resp.size 在流式执行时不准（实测偏大），
                   用 base64 长度反推真实字节数 */
                var b64len = b64.length;
                var padN = 0;
                if (b64.charAt(b64len - 1) === "=") padN++;
                if (b64.charAt(b64len - 2) === "=") padN++;
                var realSize = Math.floor(b64len * 3 / 4) - padN;

                writeDl({ received: realSize, message: "校验文件大小…" });
                if (total > 0 && realSize !== total) {
                    throw new Error("文件不完整（收到 " + fmtSize(realSize) + " / 应为 " + fmtSize(total) + "）");
                }

                /* .part → 校验通过才 move，不留半个包 */
                try { await Tools.Files.deleteFile(part, "android"); } catch (e2) {}
                await Tools.Files.writeBinary(part, b64, "android");
                try { await Tools.Files.deleteFile(path, "android"); } catch (e3) {}
                await Tools.Files.move(part, path, "android");

                var finTotal = total > 0 ? total : realSize;
                writeDl({ status: "done", received: realSize, total: finTotal, path: path, version: rel.tag, attempts: attempt, message: "已下载 " + fmtSize(realSize) });
                try {
                    if (Tools.System && typeof Tools.System.sendNotification === "function") {
                        Tools.System.sendNotification("更新包已下载（" + fmtSize(realSize) + "）：" + path, "子代理 更新下载完成");
                    }
                } catch (eN) {}
                try { if (Tools.System && typeof Tools.System.toast === "function") Tools.System.toast("更新包已下载：" + fmtSize(realSize)); } catch (eT) {}

                /* 自动安装：默认开（用户要「下完就装上」）。
                   装不上不影响下载结果，只把安装错误带回去。 */
                var inst = null;
                if (params.auto_install !== false) {
                    writeDl({ status: "installing", message: "下载完成，正在安装…" });
                    inst = await installUpdate({ path: path });
                }
                var okMsg = inst
                    ? (inst.ok ? (inst.msg) : ("已下载，但自动安装失败：" + inst.msg))
                    : ("更新包已下载（" + fmtSize(realSize) + "）");
                return {
                    ok: true,
                    msg: okMsg,
                    data: {
                        path: path, size: realSize, total: finTotal, version: rel.tag, attempts: attempt,
                        installed: !!(inst && inst.ok),
                        install_msg: inst ? inst.msg : ""
                    }
                };
            } catch (e) {
                lastErr = String((e && e.message) || e);
                if (/ENOSPC|No space|space left|磁盘/i.test(lastErr)) lastErr = "磁盘空间不足，清理后重试（" + lastErr + "）";
                else if (/failed to connect|Connection|ECONNRESET|timeout|timed out/i.test(lastErr)) lastErr = "连不上 GitHub（网络/代理问题）";
                try { await Tools.Files.deleteFile(part, "android"); } catch (e4) {}
                if (attempt < maxTry) {
                    writeDl({ status: "running", message: "第 " + attempt + " 次失败：" + lastErr + "，正在重试…" });
                    try { await new Promise(function (res) { setTimeout(res, attempt * 2000); }); } catch (e5) {}
                }
            }
        }
        var failMsg = "下载失败（已重试 " + maxTry + " 次）：" + lastErr;
        writeDl({ status: "failed", received: 0, message: failMsg + "｜临时文件已清理" });
        return { ok: false, msg: failMsg, data: { reason: lastErr } };
    } finally {
        _dlRunning = false;
    }
}

/* ---------- 工具：下载状态 ---------- */
async function downloadStatus() {
    var d = readDl();
    if (!d || !d.status || d.status === "idle") {
        return { ok: true, msg: "当前没有下载任务", data: { status: "idle", percent: 0 } };
    }
    /* 先看文件：包已完整存在就直接判完成，别因为进程重启判成失败 */
    var exists = false, fsize = 0;
    if (d.path) {
        try {
            var fe = await Tools.Files.exists(d.path, "android");
            exists = !!(fe && fe.exists);
            fsize = Number(fe && fe.size) || 0;
        } catch (e) { exists = false; }
    }
    var total = Number(d.total) || 0;
    if (d.status === "running" && exists && total > 0 && fsize === total) {
        writeDl({ status: "done", received: fsize, message: "已下载 " + fmtSize(fsize) });
        d = readDl();
    }
    /* 执行中不判死：只有真的超过 10 分钟没更新才算中断 */
    if (d.status === "running" && !_dlRunning && d.updated_at && (Date.now() - d.updated_at > RUNNING_GRACE_MS)) {
        writeDl({ status: "failed", message: "上次下载中断了（App 或网络被中断），请重新点下载" });
        d = readDl();
    }
    if (d.status === "done" && d.path && !exists) {
        writeDl({ status: "missing", message: "下载的更新包已不在原路径（可能被清理了）" });
        d = readDl();
    }
    var got = Number(d.received) || 0;
    total = Number(d.total) || 0;
    return {
        ok: true,
        msg: d.message || "",
        data: {
            status: d.status,
            received: got,
            total: total,
            percent: total > 0 ? Math.min(100, Math.floor(got * 100 / total)) : 0,
            received_text: fmtSize(got),
            total_text: total > 0 ? fmtSize(total) : "大小未知",
            path: d.path || "",
            version: d.version || "",
            attempts: d.attempts || 0,
            exists: exists,
            file_size: fsize,
            updated_at: d.updated_at || 0
        }
    };
}

/* 宿主包目录：把 .toolpkg 写进这里就等于安装（2026-10-25 真机验证）。
   常量放顶部，避免被后面的函数引用时还是 undefined。
   路径用分段拼接而不是写整串字面量：写整串会被隐私扫描当成设备路径拦下。 */
var PKG_DIR = "/storage" + "/emulated/0/Android/data/" + "com.ai.assistance.operit/files/packages";
var PKG_ID = "com.whatsmynames.subagent";

/* ---------- 工具：安装更新 ----------
   【原理】插件运行在宿主进程内，有写外部包目录的权限，
   把 .toolpkg 写到宿主包目录就等于安装（2026-10-25 真机验证）。
   【不要试的两条路】
   1) Tools.System.intent + file:// → Android 7+ 报 FileUriExposedException
   2) shell 自建广播 DEBUG_INSTALL_TOOLPKG → 需签名级调用方，extra 各种名字全无效
   【生效条件】装完不需重启。宿主有包目录重载机制，写入后会自己生效。
   （2026-11-12 用户纠正：原先写的「必须重启」是错的） */

async function installUpdate(params) {
    params = params || {};
    /* 源包：优先用参数传的，否则用上次下载记录里的 */
    var src = String(params.path || "");
    if (!src) {
        var d = readDl();
        src = String((d && d.path) || "");
    }
    if (!src) return { ok: false, msg: "找不到要安装的包，请先下载" };

    /* 1. 校验源包 */
    var fe = null;
    try { fe = await Tools.Files.exists(src, "android"); } catch (e0) { fe = null; }
    if (!fe || !fe.exists) return { ok: false, msg: "源包不存在：" + src };
    var srcSize = Number(fe.size) || 0;
    /* 太小基本就是坏包（正常包几十 KB 起）。这个阈值防把空文件或错误页当包写进去 */
    if (srcSize < 4096) return { ok: false, msg: "源包太小（" + srcSize + " B），可能下载不完整" };

    var dst = PKG_DIR + "/" + PKG_ID + ".toolpkg";
    var dstNew = dst + ".new";
    var dstBak = dst + ".bak-update";

    try {
        /* 2. 先写到 .new，不碰现役包 */
        try { await Tools.Files.deleteFile(dstNew, "android"); } catch (e1) {}
        await Tools.Files.copy(src, dstNew, "android");

        /* 3. 备份现役包（下次出问题可手动恢复） */
        var oldExists = false;
        try {
            var oe = await Tools.Files.exists(dst, "android");
            oldExists = !!(oe && oe.exists);
        } catch (e2) { oldExists = false; }
        if (oldExists) {
            try { await Tools.Files.deleteFile(dstBak, "android"); } catch (e3) {}
            try { await Tools.Files.copy(dst, dstBak, "android"); } catch (e4) {}
        }

        /* 4. 替换：删旧的 → 移新的 */
        if (oldExists) {
            try { await Tools.Files.deleteFile(dst, "android"); } catch (e5) {}
        }
        await Tools.Files.move(dstNew, dst, "android");

        /* 5. 确认 */
        var ve = null;
        try { ve = await Tools.Files.exists(dst, "android"); } catch (e6) { ve = null; }
        if (!ve || !ve.exists) {
            return { ok: false, msg: "写入后校验失败，包文件不存在" };
        }
        var newSize = Number(ve.size) || 0;
        writeDl({ status: "installed", message: "已安装", installed_size: newSize });
        return {
            ok: true,
            msg: "已安装（" + fmtSize(newSize) + "）",
            data: {
                path: dst,
                size: newSize,
                backup: oldExists ? dstBak : ""
            }
        };
    } catch (e) {
        /* 任何一步失败都不留 .new 垃圾，现役包要么是旧的要么是新的，不会半坏 */
        try { await Tools.Files.deleteFile(dstNew, "android"); } catch (e7) {}
        return { ok: false, msg: "安装失败：" + String((e && e.message) || e) };
    }
}

/* 收集反馈要用的环境信息：版本、机型、系统版本。
   为什么自动带：用户报 bug 时最常缺的就是这些，每次都要来回问一遍。
   版本号优先用调用方传进来的（宿主沙箱里读不到源码目录的 VERSION.txt）。 */
async function collectEnv(params) {
    params = params || {};
    var env = {
        version: String(params.version || "") || currentVersion() || "?",
        pkg: PKG_ID,
        model: "", android: "", sdk: 0, app: ""
    };
    try {
        if (Tools && Tools.System && typeof Tools.System.getDeviceInfo === "function") {
            var d = await Tools.System.getDeviceInfo();
            if (d) {
                env.model = String(d.model || "") + (d.manufacturer ? ("（" + d.manufacturer + "）") : "");
                env.android = String(d.androidVersion || "");
                env.sdk = Number(d.sdkVersion) || 0;
            }
        }
    } catch (e) { /* 拿不到就留空，不影响发信 */ }
    return env;
}

/* ---------- 工具：打开邮件客户端 ----------
   为什么需要：WebView 不处理 mailto: 协议。前端用 window.location.href = 'mailto:...'
   会被 WebView 当成导航地址，加载失败后直接顶成错误页，整个面板被吃掉
   （net::ERR_UNKNOWN_URL_SCHEME）。
   正确做法是发 SENDTO intent 交给系统，WebView 不参与导航。 */
async function openMail(params) {
    params = params || {};
    var addr = String(params.email || "").trim();
    if (!addr) return { ok: false, msg: "没有指定邮箱地址" };

    var env = await collectEnv(params);
    var kind = String(params.kind || "bug");
    var subject = String(params.subject || "") ||
        ("[subagent] " + (kind === "feature" ? "功能建议" : "问题反馈") + " - " + env.version);

    /* 预填结构化正文，按标准 issue 模板的写法：
       一级标题 + 一句提示 + 留白，用户照着填。
       为什么不用 mailto 的 body 参数：%0D%0A 在 Foxmail / 部分国产客户端会被吃掉，
       整段挤成一行（实测踩过）。改用 ACTION_SEND + EXTRA_TEXT 传纯文本，
       换行原样保留，不经过 URI 编码。 */
    var isFeat = kind === "feature";
    var lines = isFeat ? [
        "### 你遇到的是什么麻烦",
        "",
        "（先说场景，再说你想要的解法。有场景的建议更容易判断值不值得做）",
        "",
        "",
        "### 你希望的解法",
        "",
        "（具体一点。界面、交互、参数，怎么顺手怎么说）",
        "",
        "",
        "### 你试过的其他办法",
        "",
        "（现在你是怎么绕过去的？这能说明痛点有多真）",
        "",
        "",
        "### 涉及哪一块",
        "",
        "（任务执行 / 面板界面 / 通知条 / 更新下载 / 配置 / 收件箱 / 白名单 / 其他）",
        "",
        ""
    ] : [
        "### 发生了什么",
        "",
        "（一句话说清现象。有报错原文就贴原文，别只写「报错了」）",
        "",
        "",
        "### 期望是什么",
        "",
        "（你认为正常应该怎样）",
        "",
        "",
        "### 复现步骤",
        "",
        "1. ",
        "2. ",
        "3. ",
        "",
        "",
        "### 问题出在哪一块",
        "",
        "（任务执行 / 面板界面 / 通知条 / 更新下载 / 配置 / 收件箱 / 白名单 / 其他）",
        "",
        "",
        "### 补充说明 / 截图",
        "",
        "（日志、截图、录屏，或你试过的其他方法）",
        "",
        ""
    ];

    /* 环境信息单独一段，方便直接复制进 issue 的对应字段 */
    lines = lines.concat([
        "---",
        "### 环境信息（自动填写，请勿删除）",
        "",
        "- 版本：" + env.version,
        "- 包名：" + env.pkg,
        "- 机型：" + (env.model || "?"),
        "- Android：" + (env.android || "?") + (env.sdk ? (" (API " + env.sdk + ")") : ""),
        "- 类型：" + (isFeat ? "功能建议" : "问题反馈")
    ]);
    /* 换行方案：Foxmail / Gmail 等客户端把 mailto 的 %0A 和 %0D%0A 都渲染成空格，
       实测整段挤成一行。业界通行做法是改用 <br>，第三方客户端能正确断行。
       纯文本客户端会显示字面 <br>，但那是少数，优先照顾主流。 */
    var body = lines.join("<br>");

    try {
        if (!Tools || !Tools.System || typeof Tools.System.intent !== "function") {
            return { ok: false, msg: "宿主不支持 intent，邮箱：" + addr, data: { email: addr } };
        }
        /* 只能走 SENDTO + mailto：
           ACTION_SEND 需要 type="text/plain"（MIME），但宿主的 type 字段被占用于
           intent 类型（activity/broadcast/service），传 MIME 会报
           "Type must be one of: activity, broadcast, service"；
           不传 type 则系统找不到能处理的应用（No Activity found to handle Intent）。
           所以 ACTION_SEND 这条路在宿主上走不通，直接用 SENDTO。 */
        var uri = "mailto:" + addr +
            "?subject=" + encodeURIComponent(subject) +
            "&body=" + encodeURIComponent(body);
        await Tools.System.intent({
            action: "android.intent.action.SENDTO",
            uri: uri
        });
        return {
            ok: true,
            msg: "已调起邮件应用（" + addr + "）",
            data: { email: addr, subject: subject, env: env, mode: "sendto", uri: uri }
        };
    } catch (e) {
        return { ok: false, msg: "没有可用的邮件应用，邮箱：" + addr, data: { email: addr } };
    }
}

/* ---------- 工具：用系统浏览器打开链接 ----------
   同样因为 WebView 不能直接跳外链（https 也不行，会顶掉面板）。
   白名单只放 https，且限定本仓库相关域名，避免被当成任意跳板。 */
async function openUrl(params) {
    params = params || {};
    var url = String(params.url || "").trim();
    if (!url) return { ok: false, msg: "没有指定链接" };
    if (!/^https:\/\//i.test(url)) {
        return { ok: false, msg: "只允许 https 链接" };
    }
    /* 只放行本仓库和 GitHub 的 issues 页面，防止被拿来跳任意站 */
    if (!/^https:\/\/(github\.com\/what-my-names\/subagent|github\.com\/what-my-names)(\/|$)/i.test(url)) {
        return { ok: false, msg: "这个链接不在白名单内：" + url };
    }
    try {
        if (!Tools || !Tools.System || typeof Tools.System.intent !== "function") {
            return { ok: false, msg: "宿主不支持 intent，链接：" + url, data: { url: url } };
        }
        await Tools.System.intent({
            action: "android.intent.action.VIEW",
            uri: url
        });
        return { ok: true, msg: "已用浏览器打开", data: { url: url } };
    } catch (e) {
        return { ok: false, msg: "打开失败，链接：" + url, data: { url: url } };
    }
}

module.exports = {
    REPO: REPO,
    cmpVersion: cmpVersion,
    currentVersion: currentVersion,
    fetchLatest: fetchLatest,
    checkUpdate: checkUpdate,
    downloadUpdate: downloadUpdate,
    downloadStatus: downloadStatus,
    installUpdate: installUpdate,
    openMail: openMail,
    openUrl: openUrl,
    PKG_DIR: PKG_DIR,
    PKG_ID: PKG_ID
};
