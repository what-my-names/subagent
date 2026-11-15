/*
 * 参数解析小工具（从 subagent.js 抽出）
 *
 * 用途：parseList 把逗号/分号/换行/空格分隔的字符串拆成数组；parseJson 安全 JSON 解析（失败返回默认值）。
 * 为什么单独成文件：拆模块时这两个函数留在主文件，子模块拿不到 → 真机一跑就抛
 *       parseList is not defined / parseJson is not defined。抽成公共模块，谁都能 require。
 */

/* 【第一百零九轮】括号内的逗号/空格不能当分隔符。
   踩过：`super_admin:terminal(cd,ls,head)` 被 split(",") 切成
   ["super_admin:terminal(cd", "ls", "head)"],于是 allowed_count=3，模型看到三个乱名字，
   调什么都被拒。
   现在：先把括号段（含逗号）整体保护起来，切分后再还原。 */
function parseList(raw) {
    var out = [];
    if (raw == null) return out;
    if (Object.prototype.toString.call(raw) === "[object Array]") {
        for (var i = 0; i < raw.length; i++) { var v = String(raw[i] == null ? "" : raw[i]).trim(); if (v) out.push(v); }
        return out;
    }
    var t = String(raw);

    /* 1) 把所有 `xxx(...)` 段替换成占位符，避免括号内逗号被切 */
    var kept = [];
    t = t.replace(/[^\s,;]+\([^)]*\)/g, function (m) {
        kept.push(m.replace(/\s+/g, ""));   /* 括号内空格也去掉，统一成 (a,b,c) */
        return "\u0001" + (kept.length - 1) + "\u0001";
    });

    /* 2) 正常切分（此时字符串里已没有括号段） */
    t = t.split("，").join(",").split(";").join(",");
    t = t.split(String.fromCharCode(10)).join(",").split(String.fromCharCode(13)).join(",");
    t = t.split(String.fromCharCode(9)).join(",").split(" ").join(",");
    var arr = t.split(",");
    for (var j = 0; j < arr.length; j++) {
        var x = arr[j].trim();
        if (!x) continue;
        /* 3) 还原占位符 */
        x = x.replace(/\u0001(\d+)\u0001/g, function (_m, idx) { return kept[Number(idx)] || ""; });
        if (x) out.push(x);
    }
    return out;
}

function parseJson(raw, def) {
    if (raw == null || raw === "") return def;
    if (typeof raw === "object") return raw;
    try { return JSON.parse(String(raw)); } catch (e) { return def; }
}

module.exports = {
    parseList: parseList,
    parseJson: parseJson
};
