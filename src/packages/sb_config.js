/* sb_config.js — 配置与环境变量
 * 目录约定（用户定）：/sdcard/Download/Operit/subagent/
 *   workspace/  任务产物与可写根
 *   tasks/      任务本体（每任务一个 json）
 *   cache/      可再生的缓存与日志（探测结果、模型列表、用量、请求日志）
 *
 * 为什么这么分：之前所有东西都堆在 plugins/com.operit.subagent/ 一个目录，
 * 30KB 的 config.json 里混着 profiles 与 probe_cache，probe.json 存着域名与模型，
 * 删缓存会动到配置，删配置又会丢缓存。分成三目录后职责单一，清理互不影响。
 *
 * 兼容：老目录 plugins/com.operit.subagent 仍会被识别，只用于迁移读取。
 */
"use strict";

var LEGACY_DIR = "/sdcard/Download/Operit/plugins/com.operit.subagent";
var ROOT_DIR = "/sdcard/Download/Operit/subagent";
var KEY_ENV = "SUBAGENT_API_KEY";
var URL_ENV = "SUBAGENT_BASE_URL";
var MODEL_ENV = "SUBAGENT_MODEL";

/* 根目录：优先用宿主给的位置，但统一收拢到 ROOT_DIR，保持三目录约定 */
function baseDir() {
    return ROOT_DIR;
}
function legacyDir() { return LEGACY_DIR; }
function workspaceDir() { return ROOT_DIR + "/workspace"; }
function tasksDirPath() { return ROOT_DIR + "/tasks"; }
function cacheDir() { return ROOT_DIR + "/cache"; }

function cfgPath() { return baseDir() + "/config.json"; }

var DEFAULTS = {
    profile: {
        id: "default",
        name: "默认",
        base_url: "",
        model: "",
        api_key_env: KEY_ENV,
        protocol: "chat",
        custom_headers: {},
        extra_body: {}
    },
    thinking_map: {
        off: {},
        low: {},
        medium: {},
        high: {}
    },
    pricing: { in_per_million: 0, out_per_million: 0 },
    default_workspace: "",
    default_allowed_tools: ["read_file", "list_files", "file_info", "file_exists", "file_grep"],
    default_context_mode: "none",
    notice_mode: "agent",
    max_steps: 20,
    step_timeout_ms: 90000,
    wait_max_ms: 60000,
    inject_max_chars: 20000,
    tool_result_max_chars: 8000,
    summary_level: "t1",
    result_level: "standard",
    request_log: false,
    log_limit: 200,
    retries: 1,
    retry_backoff_ms: 600,
    templates: []
};

function deepMerge(base, over) {
    var out = {};
    var k;
    for (k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k]; }
    if (over && typeof over === "object") {
        for (k in over) {
            if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
            var bv = out[k];
            var ov = over[k];
            if (bv && ov && typeof bv === "object" && typeof ov === "object" && !Array.isArray(bv) && !Array.isArray(ov)) {
                out[k] = deepMerge(bv, ov);
            } else {
                out[k] = ov;
            }
        }
    }
    return out;
}

async function readText(path) {
    try {
        var r = await Tools.Files.read(path, "android");
        if (typeof r === "string") return r;
        if (r && typeof r === "object") return String(r.content != null ? r.content : (r.text != null ? r.text : ""));
    } catch (e) {}
    return "";
}

async function writeText(path, text) {
    /* 建目录要建「目标文件所在目录」，不能只建 baseDir，
       否则写 cache/xxx.json、tasks/xxx.json 这类子目录会失败。 */
    var dir = String(path).replace(/\/[^\/]*$/, "");
    if (dir) { try { await Tools.Files.mkdir(dir, true, "android"); } catch (e) {} }
    try { await Tools.Files.mkdir(baseDir(), true, "android"); } catch (e) {}
    await Tools.Files.write(path, text, false, "android");
    var back = await readText(path);
    if (String(back || "").length !== String(text || "").length) {
        throw new Error("写回校验失败：" + path);
    }
    return true;
}
/* 确保三目录存在：workspace / tasks / cache */
async function ensureDirs() {
    try { await Tools.Files.mkdir(workspaceDir(), true, "android"); } catch (e) {}
    try { await Tools.Files.mkdir(tasksDirPath(), true, "android"); } catch (e) {}
    try { await Tools.Files.mkdir(cacheDir(), true, "android"); } catch (e) {}
}
/* 模型列表这类可再生的缓存单独落文件，不再塞进 config.json。
   原因：config.json 是用户配置，缓存混进去会让它涨到 30KB，
   而且清缓存会误伤配置、清配置又会丢缓存。 */
function modelsCachePath() { return cacheDir() + "/models.json"; }
async function readModelsCache() {
    var raw = await readText(modelsCachePath());
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}
async function writeModelsCache(obj) {
    try {
        await Tools.Files.mkdir(cacheDir(), true, "android");
        await Tools.Files.write(modelsCachePath(), JSON.stringify(obj || {}, null, 2), false, "android");
    } catch (e) {}
}

/* 一次性迁移：老目录的 config.json 搬到新目录。
   背景：目录改成 workspace/tasks/cache 三分离后，config.json 落到新根下，
   但老用户的配置还在 plugins/com.operit.subagent/config.json。
   不做迁移的话 load() 读到空文件就用 DEFAULTS，base_url 为空，
   表现为「桥异常：未配置 base_url」，任务一步都跑不动。
   只在新路径没有配置时才搬；老文件保留，绝不删用户数据。 */
async function migrateLegacyConfig() {
    var exists = await readText(cfgPath());
    if (exists) return false;
    var oldPath = legacyDir() + "/config.json";
    var raw = await readText(oldPath);
    if (!raw) return false;
    try {
        var probe = JSON.parse(raw);
        if (!probe || typeof probe !== "object") return false;
    } catch (e) { return false; }
    try { await writeText(cfgPath(), raw); } catch (e) { return false; }
    return true;
}

/* 配置缓存：config.json 约 30KB，advanceTask 每步都 load 一次，
   20 步任务就是 20 次读盘 + 20 次迁移尝试，明显浪费。
   TTL 800ms：够覆盖一次工具调用链内的多次读取，又不至于让面板改完配置后读不到。
   save() 会主动清缓存，所以自己写完立刻能读到新值。 */
var _cfgCache = null, _cfgCacheAt = 0;
var CFG_TTL_MS = 800;
function invalidateCache() { _cfgCache = null; _cfgCacheAt = 0; _envCache = {}; _envCacheAt = {}; }
var _envCache = {}, _envCacheAt = {};

async function load(force) {
    var _now = Date.now();
    if (!force && _cfgCache && (_now - _cfgCacheAt) < CFG_TTL_MS) {
        /* 返回深拷贝，避免调用方改到缓存本体 */
        try { return JSON.parse(JSON.stringify(_cfgCache)); } catch (eC) { return _cfgCache; }
    }
    /* 先尝试一次性迁移，失败不影响后续读默认值 */
    try { await migrateLegacyConfig(); } catch (e) {}
    var raw = await readText(cfgPath());
    var user = {};
    if (raw) { try { user = JSON.parse(raw); } catch (e) { user = {}; } }
    var cfg = deepMerge(DEFAULTS, user);
    try {
        var u = getEnv(URL_ENV);
        if (u && !String(cfg.profile.base_url || "").trim()) cfg.profile.base_url = String(u).trim();
    } catch (e) {}
    try {
        var m = getEnv(MODEL_ENV);
        if (m && !String(cfg.profile.model || "").trim()) cfg.profile.model = String(m).trim();
    } catch (e) {}
    try { applyActive(cfg); } catch (e) {}
    _cfgCache = cfg; _cfgCacheAt = Date.now();
    try { return JSON.parse(JSON.stringify(cfg)); } catch (eD) { return cfg; }
}

async function save(cfg) {
    var body = JSON.stringify(cfg, null, 2);
    await writeText(cfgPath(), body);
    invalidateCache();   /* 写完立刻失效，下一次 load 读到新值 */
    return true;
}

function keyEnvName(cfg) {
    var n = cfg && cfg.profile && cfg.profile.api_key_env ? String(cfg.profile.api_key_env) : KEY_ENV;
    return n || KEY_ENV;
}

function hasKey(cfg) {
    try {
        var v = getEnv(keyEnvName(cfg));
        return !!(v && String(v).trim());
    } catch (e) { return false; }
}

async function setKey(value) {
    var v = String(value == null ? "" : value).trim();
    if (!v) throw new Error("key 不能为空");
    if (typeof Tools.SoftwareSettings.writeEnvironmentVariable !== "function") {
        throw new Error("当前版本不支持写环境变量");
    }
    await Tools.SoftwareSettings.writeEnvironmentVariable(KEY_ENV, v);
    /* 立刻清环境变量缓存：否则刚写完 key 的 3 秒内 getEnvValue 还返回旧值（空），
       表现为「保存了密钥但马上测试连通性仍报未配置」。 */
    try { invalidateCache(); } catch (e) {}
    return true;
}

function redact(v) {
    var s = String(v == null ? "" : v);
    if (!s) return "";
    if (s.length <= 8) return "****";
    return s.slice(0, 4) + "****" + s.slice(-2);
}


/* ---- 多套模型配置（profiles） ---- */
function ensureProfiles(cfg) {
    if (!cfg || typeof cfg !== "object") return cfg;
    if (!Array.isArray(cfg.profiles) || !cfg.profiles.length) {
        var base = cfg.profile && cfg.profile.id ? cfg.profile : DEFAULTS.profile;
        cfg.profiles = [JSON.parse(JSON.stringify(base))];
    }
    for (var i = 0; i < cfg.profiles.length; i++) {
        var p = cfg.profiles[i] || {};
        if (!p.id) p.id = "p" + (i + 1);
        if (!p.name) p.name = p.id;
        if (!p.api_key_env) p.api_key_env = KEY_ENV;
        if (!p.protocol) p.protocol = "chat";
        cfg.profiles[i] = p;
    }
    if (!cfg.active_profile) cfg.active_profile = cfg.profiles[0].id;
    return cfg;
}
function applyActive(cfg) {
    ensureProfiles(cfg);
    var id = String(cfg.active_profile || "");
    for (var i = 0; i < cfg.profiles.length; i++) {
        if (String(cfg.profiles[i].id) === id) { cfg.profile = cfg.profiles[i]; return cfg.profile; }
    }
    cfg.active_profile = cfg.profiles[0].id;
    cfg.profile = cfg.profiles[0];
    return cfg.profile;
}
function upsertProfile(cfg, prof) {
    ensureProfiles(cfg);
    prof = prof || {};
    var id = String(prof.id || "").trim();
    if (!id) id = "p" + (cfg.profiles.length + 1);
    var found = -1;
    for (var i = 0; i < cfg.profiles.length; i++) if (String(cfg.profiles[i].id) === id) found = i;
    var merged = { id: id };
    var base = found >= 0 ? cfg.profiles[found] : {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) merged[k] = base[k];
    for (var k2 in prof) if (Object.prototype.hasOwnProperty.call(prof, k2)) merged[k2] = prof[k2];
    merged.id = id;
    if (!merged.name) merged.name = id;
    if (!merged.api_key_env) merged.api_key_env = KEY_ENV;
    if (!merged.protocol) merged.protocol = "chat";
    if (found >= 0) cfg.profiles[found] = merged; else cfg.profiles.push(merged);
    if (!cfg.active_profile) cfg.active_profile = id;
    applyActive(cfg);
    return merged;
}
function removeProfile(cfg, id) {
    ensureProfiles(cfg);
    id = String(id || "");
    if (cfg.profiles.length <= 1) throw new Error("至少保留一套配置");
    var out = [];
    for (var i = 0; i < cfg.profiles.length; i++) if (String(cfg.profiles[i].id) !== id) out.push(cfg.profiles[i]);
    if (out.length === cfg.profiles.length) throw new Error("没有这个配置：" + id);
    cfg.profiles = out;
    if (String(cfg.active_profile) === id) cfg.active_profile = out[0].id;
    applyActive(cfg);
    return cfg.profiles;
}

function status(cfg) {
    var p = cfg.profile || {};
    return {
        base_url: String(p.base_url || ""),
        model: String(p.model || ""),
        key_env: keyEnvName(cfg),
        key_configured: hasKey(cfg),
        default_workspace: String(cfg.default_workspace || ""),
        config_path: cfgPath(),
        base_dir: baseDir()
    };
}

module.exports = {
    KEY_ENV: KEY_ENV,
    baseDir: baseDir,
    legacyDir: legacyDir,
    migrateLegacyConfig: migrateLegacyConfig,
    workspaceDir: workspaceDir,
    tasksDir: tasksDirPath,
    cacheDir: cacheDir,
    ensureDirs: ensureDirs,
    modelsCachePath: modelsCachePath,
    readModelsCache: readModelsCache,
    writeModelsCache: writeModelsCache,
    cfgPath: cfgPath,
    DEFAULTS: DEFAULTS,
    load: load,
    save: save,
    hasKey: hasKey,
    /* 环境变量读缓存：getEnv 走宿主 API，每次都有跨进程开销。
       advanceTask 每步都要读 key/url/model，20 步就是 60 次。
       TTL 3s + 空值不缓存（避免刚填完 key 读不到）。
       setKey 会主动清空缓存。 */
    getEnvValue: function (name) {
        var k = String(name || "");
        var now = Date.now();
        if (_envCache[k] && (now - _envCacheAt[k]) < 3000) return _envCache[k];
        var v = "";
        try { v = String(getEnv(k) || ""); } catch (e) { v = ""; }
        if (v) { _envCache[k] = v; _envCacheAt[k] = now; }
        return v;
    },
    setKey: setKey,
    keyEnvName: keyEnvName,
    redact: redact,
    ensureProfiles: ensureProfiles,
    applyActive: applyActive,
    upsertProfile: upsertProfile,
    removeProfile: removeProfile,
    status: status
};
