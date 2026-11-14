/* sb_diag.js — 工具调用失败诊断（第七十三轮）
 *
 * 为什么需要它：
 *   原来工具失败只回一句 "ERROR: xxx"，模型不知道是自己参数写错了还是工具本身失败，
 *   只能瞎猜重试，往往撞三四次 400 才放弃。
 *   用户原话：「示例应当是他哪错了，哪个调用少了，哪个参数不对了」——
 *   要的不是范例抄写，是**指着鼻子说哪一处错**。
 *
 * 三件事：
 *   1) 缺哪个必填参数（对比 sb_toolmeta 的 required）
 *   2) 哪个参数名不对（不在 schema 里，且能猜到想问哪个）
 *   3) 哪个参数类型不对（schema 要 integer 传了 string 之类）
 *
 * 设计约束：
 *   - 全程 try/catch，拿不到 schema 或算错了都不许抛 —— 诊断模块挂了不能把工具本身也拖塌
 *   - 表外工具（包工具走 run_tool）没有 schema，只能做「有没有传 args」这种粗检查
 *   - 只描述问题，不代填值（代填等于是替模型做决定）
 */
var META = null;
try { META = require("./sb_toolmeta.js"); } catch (e) { META = null; }

/* 归一化参数名：去下划线、横线、大小写、复数尾。
   目的：把 user_name / userName / username 归到同一个 key 上比较。 */
function normKey(k) {
    return String(k || "").toLowerCase().replace(/[_\-\s]/g, "");
}

/* 简易编辑距离，只用来找「最像的那个参数名」。
   参数名都很短（<20 字符），O(n*m) 完全够用。 */
function editDist(a, b) {
    var s = String(a || ""), t = String(b || "");
    var n = s.length, m = t.length;
    if (!n) return m;
    if (!m) return n;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= m; j++) prev[j] = j;
    for (i = 1; i <= n; i++) {
        cur = [i];
        for (j = 1; j <= m; j++) {
            var cost = (s.charAt(i - 1) === t.charAt(j - 1)) ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = cur;
    }
    return prev[m];
}

/* 在候选里找最接近的一个。阈值按长度放宽：短名要求几乎一样，长名允许差两三个字符。 */
function closest(want, cands) {
    var w = normKey(want);
    var best = null, bestD = 1e9;
    for (var i = 0; i < cands.length; i++) {
        var d = editDist(w, normKey(cands[i]));
        if (d < bestD) { bestD = d; best = cands[i]; }
    }
    if (!best) return null;
    var bl = String(best).length;
    /* 子串包含直接算命中：filepath ⊃ path、user_name ⊃ name。
       这类「多套了一层前缀」的错最常见，靠编辑距离反而判不出来。 */
    if (w && (w.indexOf(normKey(best)) >= 0 || normKey(best).indexOf(w) >= 0)) return best;
    var limit = bl <= 6 ? 3 : Math.max(2, Math.floor(bl / 3));
    return bestD <= limit ? best : null;
}

/* 类型检查。JSON Schema 里常见类型：string / integer / number / boolean / array / object。
   注意：integer 允许纯数字字符串（模型常把数字写成 \"3\"），这不算错，不报。 */
function typeOk(expect, val) {
    if (val === null || val === undefined) return true;
    var t = String(expect || "").toLowerCase();
    if (!t) return true;
    if (t === "string") return typeof val === "string" || typeof val === "number" || typeof val === "boolean";
    if (t === "integer") return (typeof val === "number" && isFinite(val) && Math.floor(val) === val)
        || (typeof val === "string" && /^-?\d+$/.test(val.trim()));
    if (t === "number") return (typeof val === "number" && isFinite(val))
        || (typeof val === "string" && /^-?\d+(\.\d+)?$/.test(val.trim()));
    if (t === "boolean") return typeof val === "boolean" || val === "true" || val === "false";
    if (t === "array") return Array.isArray(val);
    if (t === "object") return !!val && typeof val === "object" && !Array.isArray(val);
    return true;
}

/* 主入口：产出给人读的诊断字串（中文），拿不到 schema 返回空串。
 *
 * 入：toolName（工具名）、args（模型实际传的参数对象）
 * 出：多行文本，每行一条问题；没问题返回空串
 *
 * 为什么不返回对象：这段文本最终拼到工具结果里喂给模型，结构化对象还得再序列化一次，
 * 而且模型对人读的短句理解更准。
 */
function diagnose(toolName, args) {
    try {
        if (!META) return "";
        var name = String(toolName || "").trim();
        if (!name) return "";
        var meta = META.get(name);
        /* 表外工具（包工具）没有 schema，只能提醒最常见的一种错：忘了传参数 */
        if (!meta) {
            var a0 = (args && typeof args === "object") ? args : {};
            if (!Object.keys(a0).length) {
                return "参数问题：没有传任何参数。这个工具至少需要它自己的必填项。";
            }
            return "";
        }
        var params = meta.parameters || {};
        var props = params.properties || {};
        var required = params.required || [];
        var a = (args && typeof args === "object") ? args : {};
        var propNames = Object.keys(props);
        var givenNorm = {};
        for (var g in a) { if (Object.prototype.hasOwnProperty.call(a, g)) givenNorm[normKey(g)] = g; }
        var issues = [];

        /* 1) 缺必填 */
        var missing = [];
        for (var i = 0; i < required.length; i++) {
            var req = required[i];
            if (!Object.prototype.hasOwnProperty.call(givenNorm, normKey(req))) missing.push(req);
        }
        if (missing.length) {
            issues.push("缺少必填参数：" + missing.join("、") + "。这个工具必须有它才能跑。");
        }

        /* 2) 给了不存在的参数名 */
        var unknown = [];
        for (var k in a) {
            if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
            if (props[k]) continue;
            /* 归一化后能对上也算认识（user_name ≈ userName） */
            if (Object.prototype.hasOwnProperty.call(givenNorm, normKey(k))) {
                var real = null;
                for (var pi = 0; pi < propNames.length; pi++) {
                    if (normKey(propNames[pi]) === normKey(k)) { real = propNames[pi]; break; }
                }
                if (real) continue;
            }
            unknown.push(k);
        }
        if (unknown.length) {
            for (var u = 0; u < unknown.length; u++) {
                var guess = closest(unknown[u], propNames);
                if (guess) {
                    issues.push("参数名不对：传了 " + unknown[u] + "，这个工具不认识它。你是不是想传 " + guess + "？");
                } else {
                    issues.push("参数名不对：传了 " + unknown[u] + "，这个工具不认识它。可用参数：" + propNames.join("、"));
                }
            }
        }

        /* 3) 类型不对 */
        for (var p2 in props) {
            if (!Object.prototype.hasOwnProperty.call(props, p2)) continue;
            if (!Object.prototype.hasOwnProperty.call(a, p2)) continue;
            var expect = (props[p2] || {}).type;
            if (!expect) continue;
            if (!typeOk(expect, a[p2])) {
                var got = Array.isArray(a[p2]) ? "array" : (a[p2] === null ? "null" : typeof a[p2]);
                issues.push("参数类型不对：" + p2 + " 要 " + expect + "，你传的是 " + got + "。");
            }
        }

        return issues.join("\n");
    } catch (e) {
        return "";
    }
}

/* 把诊断拼进错误信息。用于 runOne 的失败返回值。
 * 入：toolName、args、原错误串
 * 出：原错误 + 诊断（诊断空时原样返回原错误） */
function attach(toolName, args, errText) {
    var base = String(errText == null ? "" : errText);
    var d = diagnose(toolName, args);
    if (!d) return base;
    return base + "\n——\n诊断：\n" + d;
}

module.exports = { diagnose: diagnose, attach: attach, typeOk: typeOk, normKey: normKey, closest: closest };
