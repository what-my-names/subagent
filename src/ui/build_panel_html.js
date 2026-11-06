/* build_panel_html.js — 把 panel.html/css/js 合成 panel_html.js（构建工具，不随包分发）
 * 用法：cd /sdcard/x/subagent/src && node ui/build_panel_html.js
 */
var fs = require("fs");
var path = require("path");
var dir = __dirname; // ui/
var web = path.join(dir, "web");
var html = fs.readFileSync(path.join(web, "panel.html"), "utf8");
var css = fs.readFileSync(path.join(web, "panel.css"), "utf8");
var js = fs.readFileSync(path.join(web, "panel.js"), "utf8");

/* panel.html 里可能是占位符或外链两种形态，都内联 */
html = html.replace("<!--STYLE-->", function () { return "<style>" + css + "</style>"; });
html = html.replace('<script>/*SCRIPT*/</script>', function () { return "<script>" + js + "</script>"; });
html = html.replace(/<link[^>]*panel\.css[^>]*>/i, function () { return "<style>" + css + "</style>"; });
html = html.replace(/<script[^>]*src="\.\/panel\.js"[^>]*><\/script>/i, function () { return "<script>" + js + "</script>"; });

/* 防呆：占位符和外链都不许残留 */
if (html.indexOf("/*STYLE*/") >= 0 || html.indexOf("/*SCRIPT*/") >= 0 ||
    html.indexOf("./panel.css") >= 0 || html.indexOf("./panel.js") >= 0) {
    console.error("FAIL: 仍有未内联的占位符或外部引用");
    process.exit(1);
}
if (html.length < 25000) {
    console.error("FAIL: 产物过小(" + html.length + ")，css/js 未内联");
    process.exit(1);
}

var out = "/* panel_html.js — 由 build_panel_html.js 生成 */\n"
    + "module.exports = " + JSON.stringify(html) + ";\n";
fs.writeFileSync(path.join(web, "panel_html.js"), out, "utf8");
console.log("OK bytes=", out.length);
