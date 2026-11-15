/*
 * 配置与探测工具（从 subagent.js 拆出）
 *
 * 用途：subagent_config（端点/模型/密钥/思考档位/上下文策略）、subagent_templates（模板增删查）、
 *       subagent_probe（分层连通性探测）。
 * 为什么单独成文件：配置是用户最常改的一块，改错会影响所有任务；
 *       单独成文件后可以在一个地方看清「配置怎么落盘、怎么生效」。
 * 依赖：sb_config / sb_llm / sb_skill / sb_ctx。
 * 入参：install(E, opts)
 *   E                    —— subagent.js 的 exports
 *   opts.complete        —— 宿主注入的 complete 回调，必须传
 *   opts.modelsTtl       —— 模型列表缓存 TTL（主文件常量）
 * 出参：无，直接往 E 上挂三个工具。
 */
var CFG = require("./sb_config.js");
/* parseJson 原先在 subagent.js 顶层，拆分后拿不到；统一从 sb_parse.js 取。 */
var PARSE = require("./sb_parse.js");
var parseJson = PARSE.parseJson;

var LLM = require("./sb_llm.js");
var SKILL = require("./sb_skill.js");

module.exports = function install(E, opts) {
    var complete = opts && opts.complete;
    if (typeof complete !== "function") throw new Error("installToolCfg: 缺 complete");
    var MODELS_TTL_BACKEND = (opts && opts.modelsTtl) || 0;

    E.subagent_config = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var action = String(params.action || "status");
        if (action === "key") {
            try {
                await CFG.setKey(params.api_key);
                complete({ success: true, message: "密钥已写入环境变量 " + CFG.KEY_ENV + "（不回显）", data: { key_configured: true } });
            } catch (e) {
                complete({ success: false, message: String((e && e.message) || e), data: {} });
            }
            return;
        }
        if (action === "set") {
            var patch = parseJson(params.payload, null);
            if (!patch || typeof patch !== "object") { complete({ success: false, message: "payload 不是合法 JSON", data: {} }); return; }
            /* 防御：model 位置绝不允许出现密钥。历史上曾把 key 误写进 profile.model，
               结果点「测试连通性」变成拿密钥当模型名去请求端点，报 503 No local upstream。 */
            if (patch.model != null) {
                var mv = String(patch.model).trim();
                if (/^(sk-|sk_|Bearer\s)/i.test(mv) || mv.length > 160) {
                    complete({ success: false, message: "模型名看起来像密钥（以 sk- 开头或过长），已拒绝写入。请填真实模型 ID", data: {} });
                    return;
                }
            }
            /* 【第八十七轮·修 P0】改动必须写回 profiles 数组，不能只写 cfg.profile。
               踩坑：旧代码先 `cfg.profile[k] = patch[k]`，再调 `applyActive(cfg)`，
               而 applyActive 会按 active_profile 从 profiles 里重新取一项赋给 cfg.profile
               —— 刚写进去的值立刻被覆盖回旧值，保存实际不生效。
               正确顺序：先确保 profile 在 profiles 里有对应项，把改动写进那一项，
               再 applyActive 让它指向同一对象，这样写和读才对得上。 */
            var profKeys = ["base_url", "model", "protocol", "custom_headers", "extra_body", "api_key_env", "name", "api_provider"];
            CFG.ensureProfiles(cfg);
            var actId = String(cfg.active_profile || "");
            var actProf = null;
            for (var ai = 0; ai < cfg.profiles.length; ai++) {
                if (String(cfg.profiles[ai].id) === actId) { actProf = cfg.profiles[ai]; break; }
            }
            if (!actProf) { actProf = cfg.profiles[0]; cfg.active_profile = actProf.id; }
            var rest = {};
            for (var k in patch) {
                if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
                if (k === "api_key") continue;
                if (profKeys.indexOf(k) >= 0) { actProf[k] = patch[k]; }
                else { rest[k] = patch[k]; }
            }
            /* profiles 数组里的那一项已经改完，现在才让 cfg.profile 指过去 */
            cfg.profile = actProf;
            for (var k2 in rest) {
                if (!Object.prototype.hasOwnProperty.call(rest, k2)) continue;
                cfg[k2] = rest[k2];
            }
            /* 若 patch 里显式给了 profiles 数组（面板可能整包提交），合并进来再对齐 */
            try { if (patch.profiles && patch.profiles.length) cfg.profiles = patch.profiles; } catch (eP) {}
            try { CFG.applyActive(cfg); } catch (e) {}
            await CFG.save(cfg);
            complete({ success: true, message: "配置已保存", data: CFG.status(cfg) });
            return;
        }
        if (action === "list_profiles") {
            CFG.ensureProfiles(cfg);
            var items = [];
            for (var pi = 0; pi < cfg.profiles.length; pi++) {
                var pp = cfg.profiles[pi] || {};
                items.push({ id: pp.id, name: pp.name, base_url: pp.base_url || "", model: pp.model || "", protocol: pp.protocol || "chat", active: String(pp.id) === String(cfg.active_profile) });
            }
            complete({ success: true, message: "共 " + items.length + " 套配置", data: { profiles: items, active: cfg.active_profile } });
            return;
        }
        if (action === "add_profile" || action === "set_profile") {
            var prof = parseJson(params.payload, null);
            if (!prof || typeof prof !== "object") { complete({ success: false, message: "payload 不是合法 JSON", data: {} }); return; }
            try {
                var saved = CFG.upsertProfile(cfg, prof);
                if (prof.active === true) cfg.active_profile = saved.id;
                CFG.applyActive(cfg);
                await CFG.save(cfg);
                complete({ success: true, message: "配置已保存：" + saved.name, data: { profile: saved, active: cfg.active_profile } });
            } catch (e) { complete({ success: false, message: String((e && e.message) || e), data: {} }); }
            return;
        }
        if (action === "set_active") {
            var id = String(params.profile_id || "");
            CFG.ensureProfiles(cfg);
            var found = false;
            for (var qi = 0; qi < cfg.profiles.length; qi++) if (String(cfg.profiles[qi].id) === id) found = true;
            if (!found) { complete({ success: false, message: "没有这个配置：" + id, data: {} }); return; }
            cfg.active_profile = id;
            CFG.applyActive(cfg);
            await CFG.save(cfg);
            complete({ success: true, message: "已切换到 " + id, data: { profile: cfg.profile, active: id } });
            return;
        }
        if (action === "del_profile") {
            try {
                CFG.removeProfile(cfg, params.profile_id);
                CFG.applyActive(cfg);
                await CFG.save(cfg);
                complete({ success: true, message: "已删除，当前 " + cfg.active_profile, data: { profiles: cfg.profiles, active: cfg.active_profile } });
            } catch (e) { complete({ success: false, message: String((e && e.message) || e), data: {} }); }
            return;
        }
        if (action === "refresh_models") {
            /* 支持 base_url 覆盖：用户改了端点还没保存时，也按眼前的值拉模型
               ttl_ms 内且端点没变 → 直接用磁盘缓存，不重复拉 600+ 模型 */
            var ov = {};
            if (params.base_url) ov.base_url = String(params.base_url).trim();
            var prof = LLM.resolveProfile(cfg, ov);
            if (!prof.base_url) { complete({ success: false, message: "未配置 base_url", data: {} }); return; }
            var cache = await CFG.readModelsCache();
            var fresh = cache.models && cache.models.length && cache.at
                && (Date.now() - Number(cache.at)) < MODELS_TTL_BACKEND
                && String(cache.base_url || "") === prof.base_url;
            if (fresh && params.force !== true) {
                complete({ success: true, message: "共 " + cache.models.length + " 个模型（缓存）", data: { models: { ok: true, models: cache.models, count: cache.models.length, cached: true, at: cache.at } } });
                return;
            }
            var mr = await LLM.listModels(cfg, prof, 20000);
            if (mr && mr.ok) {
                await CFG.writeModelsCache({ at: Date.now(), models: mr.models, base_url: prof.base_url });
                complete({ success: true, message: "共 " + mr.count + " 个模型", data: { models: { ok: true, models: mr.models, count: mr.count, at: Date.now() } } });
            } else {
                complete({ success: false, message: (mr && mr.error) ? mr.error : "拉取失败", data: { models: { ok: false, error: (mr && mr.error) || "", status: (mr && mr.status) || 0 } } });
            }
            return;
        }
        var mc = await CFG.readModelsCache();
        complete({ success: true, message: "配置状态", data: { status: CFG.status(cfg), profile: cfg.profile, active_profile: cfg.active_profile, pricing: cfg.pricing, request_log: cfg.request_log, templates: (cfg.templates || []).length, models_count: (mc.models ? mc.models.length : 0), models_at: mc.at || 0, models_base: mc.base_url || "", cached_models: mc.models || [], dirs: { workspace: CFG.workspaceDir(), tasks: CFG.tasksDir(), cache: CFG.cacheDir() } } });
    };

    E.subagent_templates = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        var action = String(params.action || "list");
        if (action === "add") {
            var tpl = parseJson(params.payload, null);
            if (!tpl || !tpl.id) { complete({ success: false, message: "payload 需要 id", data: {} }); return; }
            var list = cfg.templates || [];
            var replaced = false;
            for (var i = 0; i < list.length; i++) { if (list[i] && list[i].id === tpl.id) { list[i] = tpl; replaced = true; } }
            if (!replaced) list.push(tpl);
            cfg.templates = list;
            await CFG.save(cfg);
            complete({ success: true, message: "模板已保存：" + tpl.id, data: { count: list.length } });
            return;
        }
        if (action === "remove") {
            var id = String(params.id || "");
            var arr = [];
            for (var j = 0; j < (cfg.templates || []).length; j++) { if (cfg.templates[j].id !== id) arr.push(cfg.templates[j]); }
            cfg.templates = arr;
            await CFG.save(cfg);
            complete({ success: true, message: "已删除模板：" + id, data: { count: arr.length } });
            return;
        }
        complete({ success: true, message: "共 " + (cfg.templates || []).length + " 个模板", data: { templates: cfg.templates || [] } });
    };
    E.subagent_probe = async function (params) {
        params = params || {};
        var cfg = await CFG.load();
        /* 允许探测时临时覆盖模型 / 端点（面板用，测的是用户眼前填的值，不是已存的值）。
           注意：覆盖进来的 base_url 可能是「完整地址」（带 /chat/completions），
           必须再走一次 resolveProfile 的剥壳+协议识别，否则 joinUrl 会拼出双重后缀。 */
        var overrides = {};
        if (params.model) overrides.model = String(params.model);
        if (params.base_url) overrides.base_url = String(params.base_url).trim();
        var profile = LLM.resolveProfile(cfg, overrides);
        if (!profile.base_url) { complete({ success: false, message: "未配置 base_url", data: {} }); return; }


        var layers = [];
        var t0 = Date.now();

        /* ── 第 1 层：端点可达（只发 HEAD 级探测，不问模型） ── */
        var models = await LLM.listModels(cfg, profile, 12000);
        var reach = { name: "端点可达", ok: false, detail: "", ms: Date.now() - t0 };
        if (models && models.ok) {
            reach.ok = true;
            reach.detail = "HTTP 200，模型列表 " + models.count + " 个";
        } else if (models && models.status) {
            /* 有状态码说明网络是通的，只是这个接口不被支持或鉴权失败 */
            reach.ok = true;
            reach.detail = "HTTP " + models.status + "（网络可达，/models 接口不可用）";
        } else {
            reach.detail = (models && models.error) ? String(models.error) : "无法连接";
        }
        layers.push(reach);

        /* 若拿到了模型列表，缓存起来给面板的下拉用 */
        if (models && models.ok && models.models && models.models.length) {
            await CFG.writeModelsCache({ at: Date.now(), models: models.models });
        } else {
            var mc2 = await CFG.readModelsCache();
            var cached = mc2.models;
            if (cached && cached.length) models = { ok: true, count: cached.length, models: cached, cached: true, error: (models ? models.error : "") };
        }

        /* ── 第 2 层：密钥校验（/models 是否 200；401/403 直接判死） ── */
        var keyLayer = { name: "密钥有效", ok: false, detail: "", ms: 0 };
        var keyOk = CFG.hasKey(cfg);
        if (!keyOk) {
            keyLayer.detail = "未写入 API 密钥";
        } else if (models && models.ok) {
            keyLayer.ok = true;
            keyLayer.detail = "端点接受当前密钥";
        } else if (models && (models.status === 401 || models.status === 403)) {
            keyLayer.detail = "密钥被拒绝：" + LLM.errorHint(models.status, "");
        } else {
            keyLayer.detail = "无法判定（/models 不可用，跳过）";
            keyLayer.ok = true;   /* 不能判定就往下走第 3 层 */
        }
        layers.push(keyLayer);

        /* ── 第 3 层：真发一次最小对话，验证「这个模型真的能用」 ── */
        var chatLayer = { name: "模型可生成", ok: false, detail: "", ms: 0, model: String(profile.model || "") };
        var doChat = params.deep !== false || !!params.model;   /* 默认实测；传 deep:false 才跳过 */
        if (!profile.model) {
            chatLayer.detail = "未填写模型名";
        } else if (!keyOk) {
            chatLayer.detail = "缺少密钥，跳过";
        } else if (doChat) {
            var tc0 = Date.now();
            var r = await LLM.callChat(cfg, profile, [{ role: "user", content: "只回 OK" }], [], "off", 45000);
            chatLayer.ms = Date.now() - tc0;
            if (r.ok) {
                chatLayer.ok = true;
                chatLayer.detail = "已返回内容：" + String(r.content || "").slice(0, 40);
                chatLayer.usage = r.usage || null;
                chatLayer.reasoning = !!r.reasoning;
            } else {
                chatLayer.detail = String(r.error || "调用失败");
            }
        } else {
            chatLayer.detail = "未实测（点模型右侧放大镜可实测）";
            chatLayer.ok = null;
        }
        layers.push(chatLayer);

        /* 总判定：第 1 层不通直接算不通；否则看第 2、3 层 */
        var allOk = reach.ok && keyOk && chatLayer.ok !== false;
        var firstBad = null;
        for (var li = 0; li < layers.length; li++) { if (layers[li].ok === false) { firstBad = layers[li]; break; } }

        var probe = {
            at: Date.now(),
            total_ms: Date.now() - t0,
            base_url: profile.base_url,
            model: profile.model,
            key_configured: keyOk,
            connected: !!allOk,
            verdict: allOk ? "连通正常" : ("不通：" + (firstBad ? firstBad.name + " —— " + firstBad.detail : "未知原因")),
            layers: layers,
            models: models,
            /* 能力矩阵：按模型名保守推断，实测结果仅供参考 */
            capabilities: {
                vision: /(vl|vision|4o|gemini|claude|gpt-4\.1|o3|o4|qvq)/i.test(String(profile.model || "")),
                audio: /(audio|realtime|omni)/i.test(String(profile.model || "")),
                video: /(video|omni)/i.test(String(profile.model || "")),
                tool_call: /(deepseek|gpt|claude|gemini|qwen|glm|llama|mistral)/i.test(String(profile.model || "")),
                reasoning: /(r1|reason|think|o1|o3|o4|qvq)/i.test(String(profile.model || ""))
            },
            note: "分层探测：端点可达 / 密钥有效 / 模型可生成；能力为按模型名保守推断"
        };
        try {
            await Tools.Files.write(CFG.cacheDir() + "/probe.json", JSON.stringify(probe, null, 2), false, "android");
        } catch (e) {}
        complete({
            success: allOk,
            message: probe.verdict + "（" + probe.total_ms + " ms）",
            data: { probe: probe, key_configured: keyOk, connected: !!allOk, verdict: probe.verdict }
        });
    };
};
