/* sb_skill.js — 子代理的 skill 支持（第六十五轮）
 *
 * 背景：主 agent 有一套 skill（/sdcard/Download/Operit/skills/，几十个），
 * 每个 skill 是一个目录，内含 SKILL.md，开头有 frontmatter：
 *   ---
 *   name: diagnosing-bugs
 *   description: "疑难 bug 与性能回归的诊断循环。..."
 *   ---
 * 子代理原来完全读不到。用户要求「让子代理也能读主 skill，或者给独立 skill」。
 *
 * 设计取舍：
 *   1) 不把全文塞系统提示词 —— 44 个 skill 全文几十万字，直接拉爆上下文。
 *      只给清单（name + description），要用再读全文。
 *   2) 两个根目录，子代理独立目录优先，同名覆盖主目录。
 *      这样用户想给某个 skill 加子代理专属说明，放子目录里即可，不动主目录。
 *   3) 主目录只读，不复制、不写、不污染。
 */

var SKILL_ROOTS = [
    "/sdcard/Download/Operit/subagent/skills",   // 子代理独立（优先）
    "/sdcard/Download/Operit/skills"             // 主 agent 共享（只读）
];

/* 单个 skill 全文上限。SKILL.md 正常几千到几万字，6 万足够；
   超了截断并告知，防某个异常大文件把上下文吃光。 */
var SKILL_MAX_CHARS = 60000;

/* name 合法性：只允许字母数字下划线点横杠中文和空格。
   为什么这么严：name 会被拼进路径，放行 `/` 或 `..` 就能逃到根目录读任意文件。 */
function safeName(n) {
    var s = String(n == null ? "" : n).trim();
    if (!s) return "";
    if (s.indexOf("..") >= 0) return "";
    if (!/^[A-Za-z0-9_.\-\u4e00-\u9fa5 ]+$/.test(s)) return "";
    return s;
}

function isDirEntry(e) {
    return e && (e.isDirectory === true || e.is_directory === true || e.type === "dir" || e.type === "directory");
}

/* 从 SKILL.md 抽 frontmatter 的 name / description。
   不引 yaml 依赖（包环境没有），用行解析。
   description 跨行时只取第一行 —— 宁可描述不全，不能抛错。 */
function parseFrontmatter(text) {
    var out = { name: "", description: "" };
    var s = String(text || "");
    /* 必须首行就是 ---，否则不是标准 frontmatter，直接返回空 */
    var lines = s.split("\n");
    if (!lines.length || lines[0].trim() !== "---") return out;
    for (var i = 1; i < lines.length; i++) {
        var ln = lines[i];
        if (ln.trim() === "---") break;   // 结束
        var m = ln.match(/^\s*([A-Za-z_-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        var key = m[1].toLowerCase();
        var val = String(m[2] || "").trim();
        /* 去引号：单双引号都剥一层；未闭合的引号也剥掉，反正只用来展示 */
        if ((val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
            (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")) {
            val = val.slice(1, -1);
        } else if (val.charAt(0) === '"' || val.charAt(0) === "'") {
            val = val.slice(1);
        }
        if (key === "name") out.name = val;
        else if (key === "description") out.description = val;
    }
    return out;
}

/* 扫一遍所有 skill 目录，返回 [{name, description, dir, root, hasSkill}] 
   同名时前面的根（子代理独立目录）优先，已存在的跳过。 */
async function listSkills() {
    var seen = {};
    var out = [];
    for (var r = 0; r < SKILL_ROOTS.length; r++) {
        var root = SKILL_ROOTS[r];
        var entries = null;
        try {
            entries = await Tools.Files.list(root, "android");
        } catch (e) { entries = null; }
        if (!entries) continue;
        /* 【第六十五轮】宿主 Tools.Files.list 的真实返回是 { entries: [...] }，
           不是 files/items（这一点踩过：只写 files 会一直扫到 0 个）。
           三种键名都兼容，再加裸数组兜底。 */
        var arr = entries.entries || entries.files || entries.items || entries.list || entries;
        if (!arr || !arr.length) continue;
        for (var i = 0; i < arr.length; i++) {
            var ent = arr[i] || {};
            var nm = String(ent.name || ent.path || "").replace(/\/$/, "");
            if (!nm) continue;
            /* 只认目录（有些实现把路径也返回） */
            /* 宿主 entries 里目录的标记可能叫 isDirectory / is_dir / type。
       没有任何标记时按「名字不带点」兜底（skill 目录名都不会带扩展名）。 */
            var looksDir = isDirEntry(ent) || (!ent.isFile && !ent.is_file && !isDirEntry(ent) && !/\./.test(nm));
            if (!looksDir) continue;
            var dir = root + "/" + nm;
            if (seen[nm]) continue;       // 子目录优先，主目录同名跳过
            var raw = "";
            try {
                var rd = await Tools.Files.read(dir + "/SKILL.md", "android");
                raw = typeof rd === "string" ? rd : String((rd && (rd.content || rd.text || rd.result)) || "");
            } catch (e2) { raw = ""; }
            if (!raw) continue;           // 没有 SKILL.md 的不是 skill 目录
            var fm = parseFrontmatter(raw);
            var key = fm.name || nm;
            if (seen[key]) continue;
            seen[key] = 1;
            seen[nm] = 1;
            out.push({
                name: key,
                description: fm.description || "",
                dir: dir,
                root: root
            });
        }
    }
    out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    return out;
}

/* 读指定 skill 的 SKILL.md 全文。
   入：name（skill 名或目录名）
   出：{ ok, name, text, chars, truncated, dir } 或 { ok:false, error } */
async function readSkill(name) {
    var n = safeName(name);
    if (!n) return { ok: false, error: "skill 名不合法：" + String(name == null ? "" : name) };
    var all = await listSkills();
    var hit = null;
    for (var i = 0; i < all.length; i++) {
        if (all[i].name === n) { hit = all[i]; break; }
    }
    if (!hit) {
        /* 名字对不上时，再按目录名兜底匹配一次（dir 末段） */
        for (var j = 0; j < all.length; j++) {
            var base = String(all[j].dir || "").split("/").pop();
            if (base === n) { hit = all[j]; break; }
        }
    }
    if (!hit) {
        var names = [];
        for (var k = 0; k < all.length && k < 60; k++) names.push(all[k].name);
        return { ok: false, error: "没有这个 skill：" + n + "。可用：" + names.join(", ") };
    }
    var raw = "";
    try {
        var rd = await Tools.Files.read(hit.dir + "/SKILL.md", "android");
        raw = typeof rd === "string" ? rd : String((rd && (rd.content || rd.text || rd.result)) || "");
    } catch (e) {
        return { ok: false, error: "读 SKILL.md 失败：" + String((e && e.message) || e) };
    }
    if (!raw) return { ok: false, error: "SKILL.md 是空的：" + hit.dir };
    var truncated = false;
    var text = raw;
    if (text.length > SKILL_MAX_CHARS) {
        text = text.slice(0, SKILL_MAX_CHARS);
        truncated = true;
    }
    return {
        ok: true,
        name: hit.name,
        dir: hit.dir,
        text: text,
        chars: raw.length,
        truncated: truncated
    };
}

/* 把清单格式化成给模型看的一段文本。
   入：list（listSkills 的返回）或 name 数组（只要这几个）
   出：字符串，无可用 skill 时返回空串 */
function formatSkillList(list, only) {
    var arr = list || [];
    var want = null;
    if (only && only.length) {
        want = {};
        for (var i = 0; i < only.length; i++) want[String(only[i]).trim()] = 1;
    }
    var picked = [];
    for (var j = 0; j < arr.length; j++) {
        if (want && !want[arr[j].name]) continue;
        picked.push(arr[j]);
    }
    if (!picked.length) return "";
    var lines = [];
    for (var k = 0; k < picked.length; k++) {
        var d = String(picked[k].description || "").replace(/\s+/g, " ").trim();
        lines.push("- " + picked[k].name + (d ? "：" + d : ""));
    }
    return lines.join("\n");
}

exports.SKILL_ROOTS = SKILL_ROOTS;
exports.safeName = safeName;
exports.parseFrontmatter = parseFrontmatter;
exports.listSkills = listSkills;
exports.readSkill = readSkill;
exports.formatSkillList = formatSkillList;
