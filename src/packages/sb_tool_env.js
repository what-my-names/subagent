/*
 * 环境探测类工具（从 subagent.js 拆出）
 *
 * 用途：subagent_chats（列宿主对话）/ tools（列可授权工具）/ list_dir / workspace /
 *       check_path / vendor_js / skill —— 都是「读环境、看有什么」的只读工具。
 * 为什么单独成文件：这组工具只读不写、不参与任务状态机，是最独立的一块。
 * 入参：install(E, opts)
 *   E             —— subagent.js 的 exports
 *   opts.complete —— 宿主注入的 complete 回调，子模块拿不到全局，必须传
 * 出参：无，直接往 E 上挂七个工具。
 */
var CFG = require("./sb_config.js");
var SKILL = require("./sb_skill.js");

module.exports = function install(E, opts) {
    var complete = opts && opts.complete;
    if (typeof complete !== "function") throw new Error("installToolEnv: 缺 complete");

    /* 列出对话：面板要让用户自己选「附带哪个对话的上下文」，
       不能默认拿最近更新的那条——用户可能同时开了好几个对话。 */
    E.subagent_chats = async function (params) {
        var lim = Number(params && params.limit) || 30;
        if (lim < 1) lim = 30;
        if (lim > 100) lim = 100;
        var q = String((params && params.query) || "").trim().toLowerCase();
        var out = [], cur = "";
        try {
            /* 宿主对 listChats 会校验 query 必填（虽然 d.ts 标可选），
               这里优先用 listAll()——它不需要任何参数，也不会因缺 query 抛错。
               注意：listAll 恒返回 chats 数组（可能为空），不能用「空」判断失败。 */
            var r = null;
            try {
                if (Tools.Chat && typeof Tools.Chat.listAll === "function") r = await Tools.Chat.listAll();
            } catch (e0) { r = null; }
            if (!r) {
                /* listAll 不可用时才用 listChats，且必须带上 query 满足宿主校验 */
                r = await Tools.Chat.listChats({ query: "", match: "contains", sort_by: "updatedAt", sort_order: "desc", limit: lim });
            }
            cur = String((r && r.currentChatId) || "");
            var arr = (r && (r.chats || r.items || r.data)) || [];
            /* 按更新时间倒序 + 截断到 lim（listAll 不分页） */
            arr = arr.slice();
            arr.sort(function (a, b) {
                var ta = String((a && (a.updatedAt || a.updated_at || a.lastMessageTime)) || "");
                var tb = String((b && (b.updatedAt || b.updated_at || b.lastMessageTime)) || "");
                return tb < ta ? -1 : (tb > ta ? 1 : 0);
            });
            if (arr.length > lim) arr = arr.slice(0, lim);
            for (var i = 0; i < arr.length; i++) {
                var c = arr[i] || {};
                var id = String(c.id || c.chatId || "");
                if (!id) continue;
                var title = String(c.title || c.name || "").trim() || "未命名对话";
                if (q && title.toLowerCase().indexOf(q) < 0) continue;
                out.push({
                    id: id,
                    title: title,
                    updated: String(c.updatedAt || c.updated_at || c.lastMessageTime || ""),
                    messages: Number(c.messageCount || c.messages || 0) || 0,
                    current: id === cur
                });
            }
        } catch (e) {
            complete({ success: false, message: "读取对话列表失败：" + String((e && e.message) || e), data: { chats: [] } });
            return;
        }
        complete({
            success: true,
            message: "共 " + out.length + " 个对话",
            data: { chats: out, current: cur, total: out.length }
        });
    };

    E.subagent_tools = async function () {
        var builtin = [
            { name: "read_file", label: "读文件", write: false },
            { name: "read_file_part", label: "按行读文件", write: false },
            { name: "list_files", label: "列目录", write: false },
            { name: "file_info", label: "文件信息", write: false },
            { name: "file_exists", label: "文件是否存在", write: false },
            { name: "file_grep", label: "文件内容搜索", write: false },
            { name: "find_files", label: "按名找文件", write: false },
            { name: "create_file", label: "新建文件", write: true },
            { name: "edit_file", label: "编辑文件", write: true },
            { name: "delete_file", label: "删除文件", write: true },
            { name: "move_file", label: "移动文件", write: true },
            { name: "copy_file", label: "复制文件", write: true }
        ];
        var packs = [];
        var disabledCount = 0;
        try {
            var r = await Tools.SoftwareSettings.listSandboxPackages();
            var arr = (r && r.packages) ? r.packages : [];
            for (var i = 0; i < arr.length; i++) {
                var pk = arr[i] || {};
                if (pk.isBuiltIn === true) continue;
                if (String(pk.packageName || "").indexOf("subagent") >= 0) continue;
                if (pk.enabled !== true) { disabledCount++; continue; }
                var nm = String(pk.packageName || "");
                if (!nm) continue;
                /* 【第九十五轮】只列真能用的包。
                   踩过：宿主清单里同一个包会出现两条——长名（com.operit.on_air）
                   和短名（on_air）。长名那条 toolCount 恒为 0，是宿主自己的登记项，
                   列出来用户看到「0 工具」点进去什么也没有。
                   规则：toolCount 为 0 的直接跳过；同 display 只保留 toolCount 最大的那条。 */
                var cnt = Number(pk.toolCount || 0);
                if (cnt <= 0) { continue; }
                packs.push({ name: nm, display: String(pk.displayName || nm), tools: cnt, pattern: nm + ":*" });
            }
        } catch (e) {}
        /* 【第九十五轮】同名包去重：宿主会同时登记长名与短名，只留工具数多的那条。 */
        var _byDisp = {};
        var packsOut = [];
        for (var pi = 0; pi < packs.length; pi++) {
            var pz = packs[pi];
            var keyD = String(pz.display || pz.name || "").toLowerCase();
            if (!keyD) { packsOut.push(pz); continue; }
            if (_byDisp[keyD] == null) { _byDisp[keyD] = packsOut.length; packsOut.push(pz); }
            else if (Number(pz.tools || 0) > Number(packsOut[_byDisp[keyD]].tools || 0)) {
                packsOut[_byDisp[keyD]] = pz;
            }
        }
        packsOut.sort(function (a, b) { return Number(b.tools || 0) - Number(a.tools || 0); });
        complete({ success: true, message: "内置 " + builtin.length + " 项，已启用包 " + packsOut.length + " 个（另有 " + disabledCount + " 个包未启用）", data: { builtin: builtin, packages: packsOut, disabled_count: disabledCount } });
    };

    E.subagent_list_dir = async function (params) {
        params = params || {};
        var p = String(params.path == null ? "/sdcard" : params.path).trim() || "/sdcard";
        /* 注意：正则里不要直接写斜杠加星号那两个字，会被当成块注释开始，整个文件解析失败。
           改成字符类规避。 */
        if (p.charAt(0) !== "/") p = "/" + p.replace(/^\.+[/]*/, "");
        var r = null, errText = "";
        try { r = await Tools.Files.list(p, "android"); } catch (e) { errText = (e && e.message) ? e.message : String(e); }
        if (!r || !r.entries) { complete({ success: false, message: "列目录失败：" + (errText || "接口无返回"), data: { path: p } }); return; }
        var dirs = [], files = [];
        var totalSize = 0;
        for (var i = 0; i < r.entries.length; i++) {
            var e2 = r.entries[i];
            if (!e2) continue;
            var nm = String(e2.name || "");
            if (!nm) continue;
            if (e2.isDirectory) { dirs.push(nm); }
            else {
                var sz = Number(e2.size || 0);
                totalSize += sz;
                files.push({ name: nm, size: sz });
            }
        }
        dirs.sort();
        files.sort(function (a, b) { return b.size - a.size; });
        var norm = p.replace(/\/+$/, "") || "/";
        var idx = norm.lastIndexOf("/");
        var parent = idx > 0 ? norm.slice(0, idx) : "/";
        complete({
            success: true,
            message: dirs.length + " 个目录，" + files.length + " 个文件",
            data: { path: norm, parent: parent, dirs: dirs, files: files, file_count: files.length, total_size: totalSize }
        });
    };
    E.subagent_workspace = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var action = String(params.action || "info");
        /* 【第六十六轮】用户定为 B 方案：default_workspace 不再参与任何决策。
           这里固定用 CFG.workspaceDir()（= ROOT_DIR/workspace，即 subagent/workspace），
           老配置里指向旧 plugins 目录的值不再被读、也不再被写。
           为什么保留 action=init 还会 save：为了把老配置里那个脏值就地洗掉，
           洗成新路径后即便以后又有代码读它，也是对的。 */
        var defWs = CFG.workspaceDir();
        if (action === "init") {
            try { await Tools.Files.mkdir(defWs, true, "android"); } catch (e) {}
            var patch = { default_workspace: defWs };
            cfg.default_workspace = defWs;
            await CFG.save(cfg);
            complete({ success: true, message: "私有工作区已就绪：" + defWs, data: { workspace: defWs } });
            return;
        }

        /* info：列出工作区文件树与体积，供主/子代理找废弃文件 */
        var p = String(params.path || defWs);
        var depth = Math.max(1, Math.min(4, Number(params.depth || 2)));
        var maxFiles = Math.max(10, Math.min(400, Number(params.max_files || 120)));
        var out = [], total = 0, count = 0, over = false;

        async function walk(dir, level, prefix) {
            if (over || level > depth) return;
            var r = null;
            try { r = await Tools.Files.list(dir, "android"); } catch (e) { return; }
            var arr = (r && r.entries) ? r.entries : [];
            arr.sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
            for (var i = 0; i < arr.length; i++) {
                var e = arr[i] || {};
                var nm = String(e.name || "");
                if (!nm) continue;
                var full = (dir.replace(/\/+$/, "")) + "/" + nm;
                if (e.isDirectory) {
                    if (count < maxFiles) { out.push({ type: "dir", path: full, name: nm, size: 0, depth: level }); count++; }
                    await walk(full, level + 1, prefix);
                } else {
                    var sz = Number(e.size || 0);
                    total += sz;
                    if (count >= maxFiles) { over = true; }
                    else { out.push({ type: "file", path: full, name: nm, size: sz, depth: level }); count++; }
                }
            }
        }
        await walk(p, 1, "");
        out.sort(function (a, b) { return (b.size || 0) - (a.size || 0); });
        complete({
            success: true,
            message: count + " 项，共 " + (total / 1024).toFixed(1) + " KB" + (over ? "（已截断）" : ""),
            data: {
                workspace: defWs, path: p, items: out, count: count,
                total_size: total, truncated: over,
                hint: over ? "内容较多，缩小 depth 或指定子目录再看" : "按体积降序，最大的在最前面，便于挑废弃文件清理"
            }
        });
    };
    E.subagent_check_path = async function (params) {
        params = params || {};
        var p = String(params.path == null ? "" : params.path).trim();
        if (!p) { complete({ success: false, message: "缺少 path", data: {} }); return; }
        var r = null;
        try { r = await Tools.Files.exists(p); } catch (e) { r = null; }
        var norm = p.replace(/\/+$/, "");
        var slash = norm.lastIndexOf("/");
        var dirGuess = (r && r.isDirectory) ? norm : (slash > 0 ? norm.slice(0, slash) : norm);
        var dot = norm.lastIndexOf(".");
        var ext = (dot > slash) ? norm.slice(dot).toLowerCase() : "";
        complete({
            success: true,
            message: !r ? "无法检查（文件接口不可用）" : (r.exists ? (r.isDirectory ? "目录存在" : "文件存在") : "路径不存在"),
            data: {
                path: p, checked: !!r, exists: !!(r && r.exists), is_directory: !!(r && r.isDirectory),
                size: (r && r.size) || 0, ext: ext, workspace_guess: dirGuess
            }
        });
    };
    /* 外接资源读取（2026-11-05 第七轮）：用户把 katex.min.js 等放进数据目录 vendor/，
       面板启动时经桥读取并注入 window.katex —— 不进包体、不打 CDN、离线可用。
       安全面：只允许 vendor/ 下、js/css 扩展名、文件名白名单字符，防路径逃逸。 */
    E.subagent_vendor_js = async function (params) {
        params = params || {};
        var name = String(params.name || "").trim();
        if (!/^[A-Za-z0-9._-]+$/.test(name) || !/\.(js|css)$/.test(name)) {
            complete({ success: false, message: "文件名只允许字母数字点横杠下划线，且必须是 js/css", data: {} });
            return;
        }
        var path = CFG.baseDir() + "/vendor/" + name;
        try {
            var r = await Tools.Files.read(path, "android");
            /* Tools.Files.read 返回对象（实测）：{ content, path, size, env }——content 才是正文。
               兼容字符串直返与 text 字段，与 sb_task/sb_config 同一模式。 */
            var text = "";
            if (typeof r === "string") text = r;
            else if (r && typeof r === "object") text = String(r.content != null ? r.content : (r.text != null ? r.text : ""));
            if (!text) { complete({ success: false, message: "文件为空：" + path, data: {} }); return; }
            complete({ success: true, message: "已读取 " + name + "（" + text.length + " 字符）", data: { name: name, text: text } });
        } catch (e) {
            complete({ success: false, message: "读取失败（可把 katex.min.js 放到 " + CFG.baseDir() + "/vendor/ 后重试）：" + String(e && e.message || e), data: {} });
        }
    };
    /* skill 支持（第六十五轮）：用户要求「让子代理也能读主 agent 的 skill，或者给独立 skill」。
       两条路都做：
         1) /sdcard/Download/Operit/subagent/skills —— 子代理独立目录，优先
         2) /sdcard/Download/Operit/skills           —— 主 agent 共享，只读
       同名时独立目录覆盖主目录，这样想给某个 skill 加子代理专属说明，不用动主目录。
       为什么要这个工具而不是塞进系统提示词：单个 SKILL.md 几千到几万字，
       全部塞进去几十万字符直接拉爆上下文。提示词里只给 name + description，
       模型判断要用哪个，再调这个工具取全文。 */
    E.subagent_skill = async function (params) {
        params = params || {};
        var action = String(params.action || "list").trim().toLowerCase();
        if (action === "read") {
            var r = await SKILL.readSkill(String(params.name || ""));
            if (!r.ok) { complete({ success: false, message: r.error, data: {} }); return; }
            complete({
                success: true,
                message: "已读取 skill " + r.name + "（" + r.chars + " 字符" + (r.truncated ? "，已截断到 " + r.text.length : "") + "）",
                data: {
                    name: r.name, dir: r.dir,
                    chars: r.chars, truncated: r.truncated,
                    text: r.text
                }
            });
            return;
        }
        /* 默认 list */
        var all = [];
        try { all = await SKILL.listSkills(); } catch (e) { all = []; }
        var items = [];
        for (var i = 0; i < all.length; i++) {
            items.push({ name: all[i].name, description: all[i].description, dir: all[i].dir });
        }
        complete({
            success: true,
            message: "共 " + items.length + " 个 skill（扫 " + SKILL.SKILL_ROOTS.join(" 与 ") + "）",
            data: { items: items, total: items.length, roots: SKILL.SKILL_ROOTS }
        });
    };
};
