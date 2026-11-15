/*
 * 参数解析小工具（从 subagent.js 抽出）
 *
 * 用途：parseList 把逗号/分号/换行/空格分隔的字符串拆成数组；parseJson 安全 JSON 解析（失败返回默认值）。
 * 为什么单独成文件：拆模块时这两个函数留在主文件，子模块拿不到 → 真机一跑就抛
 *       parseList is not defined / parseJson is not defined。抽成公共模块，谁都能 require。
 */

function parseList(raw) {
    var out = [];
    if (raw == null) return out;
    if (Object.prototype.toString.call(raw) === "[object Array]") {
        for (var i = 0; i < raw.length; i++) { var v = String(raw[i] == null ? "" : raw[i]).trim(); if (v) out.push(v); }
        return out;
    }
    var t = String(raw);
    t = t.split("，").join(",").split(";").join(",");
    t = t.split(String.fromCharCode(10)).join(",").split(String.fromCharCode(13)).join(",");
    t = t.split(String.fromCharCode(9)).join(",").split(" ").join(",");
    var arr = t.split(",");
    for (var j = 0; j < arr.length; j++) { var x = arr[j].trim(); if (x) out.push(x); }
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
