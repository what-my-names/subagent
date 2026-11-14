/* subagent 首页：API 写入 + 子代理对话列表 */
function Screen(ctx) {
    var cs = (ctx.MaterialTheme && ctx.MaterialTheme.colorScheme) ? ctx.MaterialTheme.colorScheme : {};
    var onSurface = cs.onSurface || "#222222";
    var onSurfaceVariant = cs.onSurfaceVariant || "#666666";
    var surfaceVariant = cs.surfaceVariant || "#F2F2F2";
    var cardBg = cs.surfaceContainerHigh || surfaceVariant;
    var primary = cs.primary || "#222222";
    var onPrimary = cs.onPrimary || "#FFFFFF";
    var outline = cs.outline || "#C9C9C9";

    var listS = ctx.useState("sbh_list", "[]");
    var busyS = ctx.useState("sbh_busy", "");
    var provS = ctx.useState("sbh_prov", "DeepSeek");
    var urlS = ctx.useState("sbh_url", "https://api.deepseek.com/v1");
    var modelS = ctx.useState("sbh_model", "deepseek-chat");
    var keyS = ctx.useState("sbh_key", "");
    var msgS = ctx.useState("sbh_msg", "");
    var showS = ctx.useState("sbh_show", false);
    var list = listS[0], setList = listS[1];
    var busy = busyS[0], setBusy = busyS[1];
    var prov = provS[0], setProv = provS[1];
    var url = urlS[0], setUrl = urlS[1];
    var model = modelS[0], setModel = modelS[1];
    var keyText = keyS[0], setKey = keyS[1];
    var msg = msgS[0], setMsg = msgS[1];
    var showProv = showS[0], setShowProv = showS[1];
    var items = [];
    try { items = JSON.parse(list || "[]"); } catch (e) { items = []; }

    function toast(t) { try { if (ctx.showToast) ctx.showToast(String(t)); } catch (e) {} }
    function unwrap(o) {
        if (!o || typeof o !== "object") return o;
        var ks = [];
        for (var k in o) { ks.push(k); }
        if (ks.length === 1 && (ks[0] === "result" || ks[0] === "content" || ks[0] === "text")) {
            var v = o[ks[0]];
            if (typeof v === "string") { try { return JSON.parse(v); } catch (e2) { return v; } }
            return v;
        }
        return o;
    }
    function parse(raw) {
        raw = unwrap(raw);
        if (typeof raw === "string") { try { return JSON.parse(raw); } catch (e3) { return { success: false, message: raw }; } }
        if (raw && typeof raw === "object") {
            if (raw.success !== undefined) return raw;
            if (raw.data !== undefined) return { success: true, data: raw.data, message: raw.message };
            return { success: true, data: raw };
        }
        return { success: false, message: "空返回" };
    }
    async function call(name, params) {
        /* 【第四十九轮】与 web_panel.ui.js 对齐：只允许调本包工具。
           这里是 Compose 兜底面板（WebView 挂掉时用），同样不接受任意工具名，
           否则面板一换实现，白名单就漏一个口子。 */
        var lowName = String(name || "").toLowerCase();
        if (lowName.indexOf("subagent:") !== 0 && lowName.indexOf("subagent_") !== 0) {
            return { success: false, message: "只允许调用本包工具，已拒绝：" + name };
        }
        try { return parse(await ctx.callTool(name, params || {})); }
        catch (e4) { return { success: false, message: String((e4 && e4.message) || e4) }; }
    }
    async function load() {
        var r = await call("subagent:subagent_list", { all: true });
        if (r.success) setList(JSON.stringify((r.data && r.data.items) ? r.data.items : []));
        var c = await call("subagent:subagent_config", { action: "status" });
        if (c.success) {
            var p = (c.data && c.data.profile) ? c.data.profile : {};
            var st = (c.data && c.data.status) ? c.data.status : {};
            if (p.base_url) setUrl(String(p.base_url));
            if (p.model) setModel(String(p.model));
            setMsg(st.key_configured ? "密钥已配置" : "密钥未配置");
        }
    }
    async function writeKey() {
        var v = String(keyText || "").trim();
        if (!v) { toast("密钥不能为空"); return; }
        setBusy("key");
        var r = await call("subagent:subagent_config", { action: "key", api_key: v });
        setBusy("");
        if (!r.success) { toast("写入失败：" + (r.message || "")); return; }
        setKey("");
        setMsg("密钥已写入");
        toast("密钥已写入");
    }
    async function saveCfg() {
        setBusy("save");
        var payload = { profile: { id: "default", name: prov, api_provider: prov, base_url: String(url || "").trim(), model: String(model || "").trim(), protocol: "chat", api_key_env: "SUBAGENT_API_KEY", custom_headers: {}, extra_body: {} } };
        var r = await call("subagent:subagent_config", { action: "set", payload: JSON.stringify(payload) });
        setBusy("");
        toast(r.success ? "已保存" : ("保存失败：" + (r.message || "")));
        if (r.success) setMsg("已保存");
    }
    async function openTask(id) {
        try { if (ctx.setEnv) await ctx.setEnv("SUBAGENT_UI_SELECT", String(id)); } catch (e) {}
        if (ctx.navigate) ctx.navigate("toolpkg:com.whatsmynames.subagent:ui:subagent_detail");
    }

    function card(title, body) {
        var box = [];
        box.push(ctx.UI.Text({ text: title, style: "titleSmall", fontWeight: "bold", color: primary }));
        for (var i = 0; i < body.length; i++) { box.push(body[i]); }
        return ctx.UI.Card({ containerColor: cardBg, border: { width: 1, color: outline }, backgroundColor: cardBg, shape: { cornerRadius: 14, type: "rounded" }, padding: 0, elevation: 0, fillMaxWidth: true }, [
            ctx.UI.Column({ backgroundColor: cardBg, fillMaxWidth: true, padding: 12, spacing: 8 }, box)
        ]);
    }
    function note(t) { return ctx.UI.Text({ text: t, style: "bodySmall", color: onSurfaceVariant }); }
    function input(label, value, onChange, ph) {
        return ctx.UI.Column({ fillMaxWidth: true, spacing: 4 }, [
            note(label),
            ctx.UI.TextField({ value: value, onValueChange: onChange, singleLine: true, placeholder: ctx.UI.Text({ text: ph || "", color: onSurfaceVariant }), style: { color: onSurface } })
        ]);
    }
    function mainBtn(label, onTap) {
        return ctx.UI.Button({ contentColor: onPrimary, color: onPrimary, textColor: onPrimary, containerColor: primary, shape: { cornerRadius: 10, type: "rounded" }, text: label, fillMaxWidth: true, onClick: onTap });
    }
    function softBtn(label, onTap) {
        return ctx.UI.Button({ contentColor: onSurface, color: onSurface, textColor: onSurface, containerColor: surfaceVariant, border: { width: 1, color: outline }, shape: { cornerRadius: 10, type: "rounded" }, text: label, fillMaxWidth: true, onClick: onTap });
    }

    var children = [];
    children.push(ctx.UI.Text({ text: "子代理", fontSize: 24, fontWeight: "bold", color: primary }));
    if (msg) children.push(note(msg));

    var g0 = [];
    g0.push(note("API 提供商：" + prov));
    g0.push(softBtn("选择提供商", function () { setShowProv(!showProv); }));
    if (showProv) {
        var provs = ["DeepSeek", "OpenAI", "OpenRouter", "自定义中转"];
        for (var pi = 0; pi < provs.length; pi++) {
            (function (name) {
                g0.push(softBtn(name + (name === prov ? "（当前）" : ""), function () {
                    setProv(name);
                    if (name === "DeepSeek") { setUrl("https://api.deepseek.com/v1"); setModel("deepseek-chat"); }
                    else if (name === "OpenAI") { setUrl("https://api.openai.com/v1"); setModel("gpt-4o-mini"); }
                    else if (name === "OpenRouter") { setUrl("https://openrouter.ai/api/v1"); }
                    setShowProv(false);
                    toast("已选 " + name);
                }));
            })(provs[pi]);
        }
    }
    g0.push(input("API 密钥（只写不读）", keyText, setKey, "sk-..."));
    g0.push(mainBtn(busy === "key" ? "写入中..." : "写入密钥", function () { writeKey(); }));
    g0.push(input("API 端点", url, setUrl, "https://api.deepseek.com/v1"));
    g0.push(input("模型", model, setModel, "deepseek-chat"));
    g0.push(softBtn(busy === "save" ? "保存中..." : "保存配置", function () { saveCfg(); }));
    children.push(card("API 写入", g0));

    children.push(ctx.UI.Row({ spacing: 12, fillMaxWidth: true, verticalAlignment: "center" }, [
        ctx.UI.IconButton({ icon: "Add", onClick: function () { if (ctx.navigate) ctx.navigate("toolpkg:com.whatsmynames.subagent:ui:subagent_create"); } }),
        ctx.UI.IconButton({ icon: "Refresh", onClick: function () { load(); } })
    ]));

    if (!items.length) {
        children.push(card("还没有子代理对话", [note("点加号新建一个任务。")]));
    } else {
        for (var i = 0; i < items.length; i++) {
            var it = items[i] || {};
            var id = String(it.id || "");
            var title = String(it.title || "未命名");
            var st = String(it.status || "-");
            var stTxt = st;
            if (st === "queued") stTxt = "待启动";
            else if (st === "running") stTxt = "运行中";
            else if (st === "done") stTxt = "已完成";
            else if (st === "failed") stTxt = "失败";
            else if (st === "cancelled") stTxt = "已取消";
            else if (st === "closed") stTxt = "已关闭";
            var body = [];
            body.push(note("[" + stTxt + "]  步数 " + String(it.step || 0) + "/" + String(it.max_steps || 0)));
            body.push(note(String(it.last_text || it.result_preview || "点开看工具轨迹与子代理对话")));
            body.push(ctx.UI.Row({ spacing: 12, fillMaxWidth: true, verticalAlignment: "center" }, [
                ctx.UI.IconButton({ icon: "ChatBubble", onClick: function () { openTask(id); } })
            ]));
            children.push(ctx.UI.Card({ containerColor: cardBg, backgroundColor: cardBg, shape: { cornerRadius: 14, type: "rounded" }, padding: 0, elevation: 0, fillMaxWidth: true, onClick: function () { openTask(id); } }, [
                ctx.UI.Column({ backgroundColor: cardBg, fillMaxWidth: true, padding: 12, spacing: 6 }, body)
            ]));
        }
    }

    return ctx.UI.LazyColumn({ onLoad: async function () { await load(); }, fillMaxHeight: true, fillMaxWidth: true, padding: 14, spacing: 10 }, children);
}
module.exports = Screen;
module.exports.default = Screen;
module.exports.Screen = Screen;
