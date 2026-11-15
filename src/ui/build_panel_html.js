/* build_panel_html.js — 把 panel.html/css/js 合成 panel_html.js（构建工具，不随包分发）
 * 用法：cd /sdcard/x/subagent/src && node ui/build_panel_html.js
 */
var fs = require("fs");
var path = require("path");
var dir = __dirname; // ui/
var web = path.join(dir, "web");
var html = fs.readFileSync(path.join(web, "panel.html"), "utf8");
var css = fs.readFileSync(path.join(web, "panel.css"), "utf8");
/* 【第八十八轮】panel.js 拆成多片后按固定顺序拼接。
   为什么要拼：panel.js 整体被一个 IIFE 包裹，函数之间靠闭包共享 S / call 等状态，
   不能改成 ES module（WebView 里是内联 script）。拼接等价于原来的单文件，
   顺序即执行顺序，S 等全局状态在最前面的 panel.js 里先建好。
   新增分片时必须加进这个数组，否则构建出来缺少对应逻辑。 */
var JS_PARTS = [
    "panel.js",          /* 主体：状态、桥、列表、时间线、事件 */
    "panel_tex.js",      /* 数学公式渲染（KaTeX 优先 + 内置降级） */
    "panel_toast.js"     /* 堆叠式通知 */
];
var js = JS_PARTS.map(function (f) {
    var fp = path.join(web, f);
    if (!fs.existsSync(fp)) {
        console.error("FAIL: 缺少分片 " + f);
        process.exit(1);
    }
    return fs.readFileSync(fp, "utf8");
}).join("\n");

/* panel.html 里可能是占位符或外链两种形态，都内联 */
html = html.replace("<!--STYLE-->", function () { return "<style>" + css + "</style>"; });
html = html.replace('<script>/*SCRIPT*/</script>', function () { return "<script>" + js + "</script>"; });
html = html.replace(/<link[^>]*panel\.css[^>]*>/i, function () { return "<style>" + css + "</style>"; });
/* 【第八十九轮】三片 script 标签必须整体换成一段内联，否则构建后还残留外链引用，
   浏览器会去找不存在的 panel_tex.js / panel_toast.js，toast 与 mathHtml 全部未定义。
   用 [\s\S]*? 非贪婪匹配从第一个 src 到最后一个 </script> 的整块。 */
html = html.replace(/<script[^>]*src="\.\/panel[^"]*"[^>]*><\/script>(\s*<script[^>]*src="\.\/panel[^"]*"[^>]*><\/script>)*/i,
    function () { return "<script>" + js + "</script>"; });

/* 防呆：占位符和外链都不许残留 */
if (html.indexOf("/*STYLE*/") >= 0 || html.indexOf("/*SCRIPT*/") >= 0 ||
    /\.\/panel[\w]*\.(css|js)"/.test(html)) {
    console.error("FAIL: 仍有未内联的占位符或外部引用（检查 JS_PARTS 里的每个分片是否都被替换）");
    process.exit(1);
}
if (html.length < 25000) {
    console.error("FAIL: 产物过小(" + html.length + ")，css/js 未内联");
    process.exit(1);
}

/* 【第八十八轮】分片拼接自检。
   踩过的坑：panel.js 的 IIFE 在文件末尾就闭合了，tex/toast 两片被拼到作用域外，
   运行时 md() 找不到 mathHtml() → fillTrace 抛异常 → 时间线整片空白。
   单文件 node --check 发现不了（每片语法各自合法），必须对拼好的整体做检查。
   检查项：1) 整体语法可解析（用 new Function 做轻量语法校验，不执行）
           2) IIFE 收尾恰好一处
           3) 跨片调用的关键函数都还在 */
(function () {
    var iifeEnd = (js.match(/^\}\)\(\);$/gm) || []).length;
    if (iifeEnd !== 1) {
        console.error("FAIL: IIFE 收尾应恰好 1 处，实际 " + iifeEnd + " 处。" +
            "拆片后收尾必须放在最后一个分片，否则后续分片落在作用域外。");
        process.exit(1);
    }
    var must = ["function md(", "function texParse", "function mathHtml", "function toast(", "var S = {"];
    for (var i = 0; i < must.length; i++) {
        if (js.indexOf(must[i]) < 0) {
            console.error("FAIL: 拼接结果缺少 " + must[i]);
            process.exit(1);
        }
    }
    /* 踩过：html 注释里写了 script 标签字样，被贪婪正则吞进 js，造成 Invalid or unexpected token，
       整段脚本不执行 → toast 未定义、时间线空白、按钮全失效。 */
    if (/<!--|-->/.test(js)) {
        console.error("FAIL: 内联脚本里出现 HTML 注释残留，构建正则把注释吞进了 js");
        process.exit(1);
    }
    try { new Function(js); }
    catch (e) {
        console.error("FAIL: 拼接后的脚本语法错误：" + (e && e.message));
        process.exit(1);
    }
})();

var out = "/* panel_html.js — 由 build_panel_html.js 生成 */\n"
    + "module.exports = " + JSON.stringify(html) + ";\n";
fs.writeFileSync(path.join(web, "panel_html.js"), out, "utf8");
console.log("OK bytes=", out.length);
