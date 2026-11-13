/* web_panel.ui.js — WebView 面板入口（SBNative 桥） */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Screen;
function Screen(ctx) {
    var HTML = require("./web/panel_html.js");
    var html = String(HTML || "").replace("__BOOT__", "{}");
    var ctrl = null;
    try { ctrl = ctx.createWebViewController("subagent_web"); } catch (e0) { ctrl = null; }
    if (ctrl) {
        try { ctrl.removeJavascriptInterface("SBNative"); } catch (eR) {}
        try {
            ctrl.addJavascriptInterface("SBNative", {
                call: async function (raw) {
                    var s = (typeof raw === "string") ? raw : (raw && raw.length ? String(raw[0]) : "");
                    var req = {};
                    try { req = JSON.parse(s || "{}"); } catch (eP) {}
                    var tool = String(req.tool || ""), kind = String(req.kind || ""), rid = Number(req.id || 0);
                    var params = req.params || {};
                    if (typeof params === "string") { try { params = JSON.parse(params); } catch (eQ) { params = {}; } }
                    try {
                        if (!tool) throw new Error("缺少 tool");
                        /* 【第四十九轮·架构级修复】桥必须限定只能调本包工具。
                           原来的实现是裸的 ctx.callTool(tool, params)，前端传什么就执行什么，
                           等于页面一旦能跑 JS 就拿到宿主全部工具的执行权（含 terminal）。
                           面板渲染的 Markdown / 工具结果都来自外部输入，这条口子是实打实的。
                           只放行 subagent 前缀；真要执行宿主工具走 subagent_tool_once，
                           那条路径经过 runOne，白名单 + 递归拦截 + 写边界全都在。 */
                        var lowTool = tool.toLowerCase();
                        if (lowTool.indexOf("subagent:") !== 0 && lowTool.indexOf("subagent_") !== 0) {
                            return JSON.stringify({
                                success: false,
                                message: "桥只允许调用本包工具，已拒绝：" + tool,
                                data: {},
                                denied: true
                            });
                        }
                        // ctx.callTool 是两参：工具名 + 参数对象，必须 await
                        var r = await ctx.callTool(tool, params || {});
                        return (typeof r === "string") ? r : JSON.stringify(r);
                    } catch (e1) {
                        var m1 = String(e1 && e1.message ? e1.message : e1);
                        // 页面销毁后 JsEngine 已回收，这类异常对用户无意义，静默即可
                        if (/JsEngine|destroyed|detached/i.test(m1)) {
                            return JSON.stringify({ success: false, message: "", data: {}, silent: true });
                        }
                        return JSON.stringify({ success: false, message: "桥异常：" + m1, data: {} });
                    }
                }
            });
        } catch (e4) {}
    }
    return ctx.UI.WebView({
        html: html,
        /* 页面 origin 决定能拉哪些端点，这是硬约束（实测 2026-11-04）：
             https://localhost  → 只能拉 https 端点，http 局域网被 mixed content 掐死
             http://localhost   → https 与 http 都能拉（http 页面拉 https 不算 mixed content）
           所以这里用 http，两种端点都能前端直连，不用中继回放。
           代价：http 是非安全上下文，localStorage / XHR 仍可用，我们只用这些。 */
        baseUrl: "http://localhost/subagent",
        controller: ctrl || undefined,
        javaScriptEnabled: true,
        domStorageEnabled: true,
        allowFileAccess: true,
        supportZoom: false,
        nestedScrollInterop: true,
        useWideViewPort: true,
        loadWithOverviewMode: true,
        fillMaxSize: true
    });
}

exports.default = Screen;