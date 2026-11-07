/*
 * subagent - ToolPkg 入口：WebView 面板 + 侧边栏导航
 * 包 id：com.whatsmynames.subagent
 *
 * 只注册一个用户可见入口：WebView 面板（subagent_web）+ 侧边栏导航。
 * 旧的 Compose DSL 页面（panel/settings/detail/create/tools/diag，共 916 行）
 * 已被 Web 面板完全取代，不再注册路由——它们仍在 src/ui/ 下但属于待清理资产，
 * 保留只是为了让历史 git 记录可查，运行期不参与。
 */
var panelMod = null, webMod = null;

try { webMod = require("./ui/web_panel.ui.js"); } catch (e) { webMod = null; }
/* 兜底：WebView 入口缺失时退回旧 Compose 面板，避免整个包没有可见入口 */
try { panelMod = require("./ui/panel.ui.js"); } catch (e) { panelMod = null; }

var Panel = panelMod ? (panelMod.default || panelMod) : null;
var WebPanel = webMod ? (webMod.default || webMod.Screen || webMod) : Panel;

var PKG_ID = "com.whatsmynames.subagent";

function registerToolPkg() {
    var Screen = WebPanel || Panel;
    if (Screen) {
        try {
            ToolPkg.registerUiRoute({
                id: "subagent_web",
                route: "toolpkg:" + PKG_ID + ":ui:subagent_web",
                runtime: "compose_dsl",
                screen: Screen,
                params: {},
                title: { zh: "子代理", en: "Subagent" }
            });
        } catch (e) {}
        try {
            ToolPkg.registerNavigationEntry({
                id: "subagent_sidebar",
                route: "toolpkg:" + PKG_ID + ":ui:subagent_web",
                surface: "main_sidebar_plugins",
                title: { zh: "子代理", en: "Subagent" },
                order: 2
            });
        } catch (e) {}
    }
    /* 收件箱钩子：注册系统提示词钩子（after_compose_system_prompt）。
   回调内只读 SharedPreferences + 内存，不调用任何工具 API —— 钩子里调工具会无限回环
   （2026-10-27 事故：钩子内 Tools.Files.write 触发自身 → ANR + 进程被杀）。
   Java.getApplicationContext().getSharedPreferences 是直接 Java 调用，不经过工具层，安全。 */
    try {
        var hookMod = require("./packages/sb_hook.js");
        ToolPkg.registerSystemPromptComposeHook({
            id: "subagent_inbox",
            function: hookMod.subagentInboxHook
        });
    } catch (e) { try { console.error("[subagent] hookRegisterFailed " + e); } catch (eL2) {} }
    return true;
}

exports.registerToolPkg = registerToolPkg;
