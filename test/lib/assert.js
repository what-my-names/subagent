/* test/lib/assert.js — 统一断言库
 *
 * 所有测试用例都通过这个模块出结果，保证：
 *   1) 输出格式统一（PASS | xxx / FAIL | xxx | 原因）
 *   2) 计数统一（按分组累加，最后给总表）
 *   3) 失败不中断（跑完所有断言再退出，方便一次看到全部问题）
 *
 * 用法：
 *   var A = require('./lib/assert.js').group('UI 逻辑');
 *   A.chk('名称', 条件表达式, '失败时的原因');
 *   A.eq('名称', 实际值, 期望值);
 *   A.match('名称', 字符串, /正则/);
 *   A.finish();   // 返回 {pass, fail}
 */

var fs = require('fs');
var path = require('path');

/* 源码目录：默认取本文件相对路径（test/lib/assert.js → ../../src），
   这样别人 clone 到任意路径都能跑；可用环境变量 SUBAGENT_SRC 覆盖。 */
var SRC = process.env.SUBAGENT_SRC || path.resolve(__dirname, '../../src');

/* 只读一次源码，所有用例共享缓存（避免每个 case 都重复读 200KB） */
var _cache = {};
function readSrc(rel) {
    if (_cache[rel] == null) {
        try { _cache[rel] = fs.readFileSync(SRC + '/' + rel, 'utf8'); }
        catch (e) { _cache[rel] = ''; }
    }
    return _cache[rel];
}

/* 全局汇总 */
var ALL = [];

function group(name) {
    var pass = 0, fail = 0, lines = [];
    var g = {
        name: name,

        /* 基础断言：条件为真即通过 */
        chk: function (label, cond, reason) {
            if (cond) { pass++; lines.push('  PASS | ' + label); }
            else { fail++; lines.push('  FAIL | ' + label + (reason ? ' | ' + reason : '')); }
            return !!cond;
        },

        /* 相等断言：给出期望值与实际值，失败信息更可读 */
        eq: function (label, actual, expect) {
            var ok = (actual === expect);
            return g.chk(label, ok, ok ? '' : '期望 ' + JSON.stringify(expect) + '，实际 ' + JSON.stringify(actual));
        },

        /* 正则断言：字符串必须匹配 */
        match: function (label, str, re) {
            var ok = re.test(String(str == null ? '' : str));
            return g.chk(label, ok, ok ? '' : '不匹配 ' + re);
        },

        /* 反向正则断言：字符串不得匹配（用于「必须不存在」类检查） */
        nomatch: function (label, str, re) {
            var ok = !re.test(String(str == null ? '' : str));
            return g.chk(label, ok, ok ? '' : '仍匹配 ' + re);
        },

        /* 源码断言快捷方式 */
        src: function (rel) { return readSrc(rel); },

        /* 源码根目录（供用例拼绝对路径 require 用） */
        SRC: SRC,

        finish: function () {
            ALL.push({ name: name, pass: pass, fail: fail, lines: lines });
            return { pass: pass, fail: fail };
        }
    };
    return g;
}

/* 打印全部结果并返回总计。全部跑完才退出，方便一次看全。 */
function report() {
    var tp = 0, tf = 0;
    console.log('');
    for (var i = 0; i < ALL.length; i++) {
        var g = ALL[i];
        tp += g.pass; tf += g.fail;
        console.log('【' + g.name + '】 ' + g.pass + ' 通过 / ' + g.fail + ' 失败');
        for (var j = 0; j < g.lines.length; j++) console.log(g.lines[j]);
        console.log('');
    }
    console.log('══════════════════════════════════');
    console.log('总计：PASS ' + tp + ' / FAIL ' + tf);
    console.log('══════════════════════════════════');
    return { pass: tp, fail: tf };
}

module.exports = { group: group, report: report, readSrc: readSrc, SRC: SRC };