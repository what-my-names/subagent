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
/* 【第四十八轮】原来这里是同步 A.report() 后立刻 process.exit()，
   于是用例里「等 Promise 才有结果」的异步断言永远来不及登记，
   等于白写（run_tool 后门就是这样漏掉的）。
   改成：先等所有挂起的微任务跑完（setImmediate 排到 I/O 之后），
   再 report 并退出。 */
setImmediate(function () {
    var result = A.report();
    /* 【第一百零一轮】用例崩溃必须算失败，不能只在底部打一行小字。
       踩过：flow.js 里一个正则写错导致整个文件语法错，require 抛异常被 catch 吞进 crashed，
       report 仍打「PASS 1068 / FAIL 0」——219 条断言根本没跑，看起来全绿。
       现在：崩溃数计入 FAIL 行，并在总计里明写。 */
    if (crashed.length) {
        console.log('');
        console.log('⚠ 用例执行异常（这些文件里的断言全部没跑）：');
        for (var c = 0; c < crashed.length; c++) console.log('  - ' + crashed[c]);
        console.log('');
        console.log('═══ 总计：PASS ' + result.pass + ' / FAIL ' + (result.fail + crashed.length)
            + '（其中 ' + crashed.length + ' 个用例文件整体崩溃）═══');
    } else {
        console.log('');
        console.log('═══ 总计：PASS ' + result.pass + ' / FAIL ' + result.fail + ' ═══');
    }
    /* 退出码：有失败或崩溃就非 0，方便脚本串联 */
    process.exit((result.fail > 0 || crashed.length > 0) ? 1 : 0);
});