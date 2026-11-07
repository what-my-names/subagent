/* test/e2e_all.js — 统一测试入口
 *
 * 一条命令跑全部断言：
 *   cd /sdcard/x/subagent/test && node e2e_all.js
 *
 * 也可以只跑一组：
 *   node e2e_all.js flow        # 主流程
 *   node e2e_all.js md          # Markdown/LaTeX
 *   node e2e_all.js tools       # 三工具/白名单
 *   node e2e_all.js ui          # UI 逻辑
 *   node e2e_all.js toast       # 通知条
 *
 * 全部是静态断言（读源码文本做正则匹配），不联网、不装机、不写文件。
 * 目的：把「真机翻过车的每个点」钉成一条断言，防止改坏。
 */
var path = require('path');
var A = require('./lib/assert.js');

var ALL_CASES = ['flow', 'md', 'tools', 'ui', 'toast', 'semantic'];

var only = process.argv[2];
if (only && ALL_CASES.indexOf(only) < 0) {
    console.log('未知用例：' + only);
    console.log('可用：' + ALL_CASES.join(' / '));
    process.exit(2);
}

var run = only ? [only] : ALL_CASES;
var crashed = [];

console.log('══════════════════════════════════');
console.log('subagent 测试套件 · ' + (only ? ('仅 ' + only) : ('全部 ' + run.length + ' 组')));
console.log('源码目录：' + A.SRC);
console.log('══════════════════════════════════');

for (var i = 0; i < run.length; i++) {
    var name = run[i];
    try {
        require('./cases/' + name + '.js');
    } catch (e) {
        crashed.push(name + '：' + String((e && e.message) || e));
    }
}

var result = A.report();

if (crashed.length) {
    console.log('');
    console.log('⚠ 用例执行异常：');
    for (var c = 0; c < crashed.length; c++) console.log('  - ' + crashed[c]);
}

/* 退出码：有失败或崩溃就非 0，方便脚本串联 */
process.exit((result.fail > 0 || crashed.length > 0) ? 1 : 0);