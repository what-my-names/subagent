/*
METADATA
{
  "name": "subagent",
  "display_name": {
    "zh": "子代理",
    "en": "Subagent"
  },
  "description": {
    "zh": "自建模型通道的子代理：自己发请求、自己执行宿主工具、白名单硬拒绝、写前备份可撤回。",
    "en": "Own-model subagent with hard tool whitelist and undoable writes."
  },
  "enabledByDefault": true,
  "category": "TOOL",
  "tools": [
    {
      "name": "subagent_spawn",
      "description": {
        "zh": "建任务并派给子代理：只有 task 必填。tools 留空=无工具、传 * 放开全部（派子代理仍硬拦）；含写类工具必须给 workspace。wait=true 当场跑完并返回结论，不传 budget 会等到结束（失败除外）。",
        "en": "建任务并派给子代理：只有 task 必填。tools 留空=无工具、传 * 放开全部（派子代理仍硬拦）；含写类工具必须给 workspace。wait=true 当场跑完并返回结论，不传 budget 会等到结束（失败除外）。"
      },
      "parameters": [
        {
          "name": "task",
          "type": "string",
          "description": "任务描述：只写任务本身，工具名与路径不要塞进来",
          "required": true
        },
        {
          "name": "tools",
          "type": "string",
          "description": "允许的工具，逗号分隔，支持 * 通配与 包名:工具名。留空=一个都没有；传 * 放开全部",
          "required": false
        },
        {
          "name": "workspace",
          "type": "string",
          "description": "写入根目录，含写类工具时必填",
          "required": false
        },
        {
          "name": "wait",
          "type": "boolean",
          "description": "true=本次调用等任务完成再返回结论",
          "required": false
        },
        {
          "name": "budget",
          "type": "number",
          "description": "wait=true 时最长等待毫秒；不传=等到完成（失败除外）",
          "required": false
        },
        {
          "name": "detail",
          "type": "string",
          "description": "返回详细度 brief/standard/full/trace（wait=true 时生效）",
          "required": false
        },
        {
          "name": "max_steps",
          "type": "number",
          "description": "步数上限，默认 20",
          "required": false
        },
        {
          "name": "timeout_ms",
          "type": "number",
          "description": "单步超时毫秒，默认 90000",
          "required": false
        },
        {
          "name": "thinking_level",
          "type": "string",
          "description": "off/low/medium/high",
          "required": false
        },
        {
          "name": "context_mode",
          "type": "string",
          "description": "none/chat_tail/summary/fork",
          "required": false
        },
        {
          "name": "context_turns",
          "type": "number",
          "description": "带几条历史 1-120",
          "required": false
        },
        {
          "name": "context_text",
          "type": "string",
          "description": "背景注入文本",
          "required": false
        },
        {
          "name": "context_files",
          "type": "string",
          "description": "逗号分隔文件路径，内容读入注入",
          "required": false
        },
        {
          "name": "key_points",
          "type": "string",
          "description": "要点 JSON: goal/deliverable/constraints/acceptance",
          "required": false
        },
        {
          "name": "skills",
          "type": "string",
          "description": "给子代理看的 skill 清单，逗号分隔或 all",
          "required": false
        },
        {
          "name": "allow_danger",
          "type": "boolean",
          "description": "允许脚本执行等危险命令，默认 false",
          "required": false
        },
        {
          "name": "model",
          "type": "string",
          "description": "覆盖模型",
          "required": false
        },
        {
          "name": "base_url",
          "type": "string",
          "description": "覆盖端点",
          "required": false
        },
        {
          "name": "group",
          "type": "string",
          "description": "分组，fan-out 用",
          "required": false
        },
        {
          "name": "template_id",
          "type": "string",
          "description": "套用配置里的模板",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_run",
      "description": {
        "zh": "推进已有任务：wait=false 推 max_steps 步（上限3）；wait=true 在 budget 内推到完成。返回 unfinished/next 时任务没失败，继续调本工具即可。",
        "en": "推进已有任务：wait=false 推 max_steps 步（上限3）；wait=true 在 budget 内推到完成。返回 unfinished/next 时任务没失败，继续调本工具即可。"
      },
      "parameters": [
        {
          "name": "id",
          "type": "string",
          "description": "任务 id（spawn 返回的）",
          "required": true
        },
        {
          "name": "wait",
          "type": "boolean",
          "description": "true=推到完成再返回；false=推 max_steps 步就返回",
          "required": false
        },
        {
          "name": "budget",
          "type": "number",
          "description": "wait=true 时最长等待毫秒，默认 30000 最大 60000",
          "required": false
        },
        {
          "name": "max_steps",
          "type": "number",
          "description": "wait=false 时最多推几步 1-3，默认 1",
          "required": false
        },
        {
          "name": "detail",
          "type": "string",
          "description": "brief/standard/full/trace",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_get",
      "description": {
        "zh": "取任务产出：不传 id 列全部任务概览；传 id 按 detail 返回——brief=只留结论800字 / standard=4000字 / full=20000字 / trace=逐步明细（配合 limit）。取结论会顺带清掉收件箱未读。",
        "en": "取任务产出：不传 id 列全部任务概览；传 id 按 detail 返回——brief=只留结论800字 / standard=4000字 / full=20000字 / trace=逐步明细（配合 limit）。取结论会顺带清掉收件箱未读。"
      },
      "parameters": [
        {
          "name": "id",
          "type": "string",
          "description": "任务 id；不传则列全部任务概览",
          "required": false
        },
        {
          "name": "ids",
          "type": "string",
          "description": "逗号分隔多个 id，合并返回",
          "required": false
        },
        {
          "name": "detail",
          "type": "string",
          "description": "brief/standard/full/trace，默认 standard",
          "required": false
        },
        {
          "name": "limit",
          "type": "number",
          "description": "detail=trace 时取最近几步，默认 10",
          "required": false
        },
        {
          "name": "max_chars",
          "type": "number",
          "description": "结论截断长度",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_ctrl",
      "description": {
        "zh": "改任务状态：action=cancel(请求停止)/resume(拉回可推)/steer(追加指令,配 message)/close(关闭,可 rollback 先恢复写入、drop_product 删产物)。各 action 的参数严格校验，传错直接报错。",
        "en": "改任务状态：action=cancel(请求停止)/resume(拉回可推)/steer(追加指令,配 message)/close(关闭,可 rollback 先恢复写入、drop_product 删产物)。各 action 的参数严格校验，传错直接报错。"
      },
      "parameters": [
        {
          "name": "id",
          "type": "string",
          "description": "任务 id",
          "required": true
        },
        {
          "name": "action",
          "type": "string",
          "description": "cancel/resume/steer/close",
          "required": true
        },
        {
          "name": "message",
          "type": "string",
          "description": "action=steer 时必填：追加的指令",
          "required": false
        },
        {
          "name": "confirm",
          "type": "boolean",
          "description": "action=close 时 true 才真关",
          "required": false
        },
        {
          "name": "rollback",
          "type": "boolean",
          "description": "action=close 时先恢复写入",
          "required": false
        },
        {
          "name": "drop_product",
          "type": "boolean",
          "description": "action=close 时删产物目录",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_del",
      "description": {
        "zh": "删任务：任务文件+产物目录+快照+收件箱条目。confirm=true 才真删。",
        "en": "删任务：任务文件+产物目录+快照+收件箱条目。confirm=true 才真删。"
      },
      "parameters": [
        {
          "name": "id",
          "type": "string",
          "description": "任务 id",
          "required": true
        },
        {
          "name": "confirm",
          "type": "boolean",
          "description": "true 才真删",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_undo",
      "description": {
        "zh": "【Beta】列出或恢复该任务写过的文件（写前状态备份）。dry_run=true 只看不改。注意：terminal 命令的写入不备份，路径提取失败会漏备，重要文件先 dry_run 看计划再执行。",
        "en": "【Beta】列出或恢复该任务写过的文件（写前状态备份）。dry_run=true 只看不改。terminal writes are not backed up; run dry_run first."
      },
      "parameters": [
        {
          "name": "id",
          "type": "string",
          "description": "任务 id",
          "required": true
        },
        {
          "name": "dry_run",
          "type": "boolean",
          "description": "默认 true 只列不改",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_box",
      "description": {
        "zh": "收件箱：未读子代理结论（只有 agent 产出且成功的任务才入箱；删任务自动出箱）。action=read 清空。",
        "en": "收件箱：未读子代理结论（只有 agent 产出且成功的任务才入箱；删任务自动出箱）。action=read 清空。"
      },
      "parameters": [
        {
          "name": "action",
          "type": "string",
          "description": "read=清空收件箱；不传=list",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_update",
      "description": {
        "zh": "自更新：step=check(查新版)/download(下载包)/status(下载进度)/install(安装,配 path)。",
        "en": "自更新：step=check(查新版)/download(下载包)/status(下载进度)/install(安装,配 path)。"
      },
      "parameters": [
        {
          "name": "step",
          "type": "string",
          "description": "check/download/status/install",
          "required": true
        },
        {
          "name": "force",
          "type": "boolean",
          "description": "跳过缓存",
          "required": false
        },
        {
          "name": "path",
          "type": "string",
          "description": "install 的包路径",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_cfg",
      "description": {
        "zh": "配置与模板：target=profile（action: status/set/key/models/list/add/use/rm；payload 改配置、api_key 写密钥、base 测端点、force 跳缓存）或 target=template（action: list/add/remove）。name 指定目标 profile 或模板。",
        "en": "配置与模板：target=profile（action: status/set/key/models/list/add/use/rm；payload 改配置、api_key 写密钥、base 测端点、force 跳缓存）或 target=template（action: list/add/remove）。name 指定目标 profile 或模板。"
      },
      "parameters": [
        {
          "name": "target",
          "type": "string",
          "description": "profile（默认）/template",
          "required": false
        },
        {
          "name": "action",
          "type": "string",
          "description": "profile: status/set/key/models/list/add/use/rm；template: list/add/remove",
          "required": true
        },
        {
          "name": "name",
          "type": "string",
          "description": "目标 profile 或模板名（add/use/rm 时用）",
          "required": false
        },
        {
          "name": "payload",
          "type": "string",
          "description": "JSON 配置或模板定义",
          "required": false
        },
        {
          "name": "api_key",
          "type": "string",
          "description": "写入密钥，不回显",
          "required": false
        },
        {
          "name": "base",
          "type": "string",
          "description": "refresh_models 用哪个端点测",
          "required": false
        },
        {
          "name": "force",
          "type": "boolean",
          "description": "跳过模型缓存",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_env",
      "description": {
        "zh": "环境探测：what=probe(分层测连通)/version/chats(列对话)/tools(列可授权工具)/workspace(info/init)/dir(列目录)/path(查路径)。",
        "en": "环境探测：what=probe(分层测连通)/version/chats(列对话)/tools(列可授权工具)/workspace(info/init)/dir(列目录)/path(查路径)。"
      },
      "parameters": [
        {
          "name": "what",
          "type": "string",
          "description": "probe/version/chats/tools/workspace/dir/path",
          "required": true
        },
        {
          "name": "deep",
          "type": "boolean",
          "description": "probe: 是否真发一次最小对话",
          "required": false
        },
        {
          "name": "model",
          "type": "string",
          "description": "probe: 只测该模型",
          "required": false
        },
        {
          "name": "base",
          "type": "string",
          "description": "probe: 只测该端点",
          "required": false
        },
        {
          "name": "limit",
          "type": "number",
          "description": "chats: 条数",
          "required": false
        },
        {
          "name": "query",
          "type": "string",
          "description": "chats: 标题过滤",
          "required": false
        },
        {
          "name": "action",
          "type": "string",
          "description": "workspace: info/init",
          "required": false
        },
        {
          "name": "path",
          "type": "string",
          "description": "dir/path/workspace: 目录",
          "required": false
        },
        {
          "name": "depth",
          "type": "number",
          "description": "workspace: 深度 1-4",
          "required": false
        },
        {
          "name": "max_files",
          "type": "number",
          "description": "workspace: 上限条数",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_skill",
      "description": {
        "zh": "看可用 skill 与读全文：action=list 列清单 / read 读 SKILL.md。",
        "en": "看可用 skill 与读全文：action=list 列清单 / read 读 SKILL.md。"
      },
      "parameters": [
        {
          "name": "action",
          "type": "string",
          "description": "list（默认）/read",
          "required": false
        },
        {
          "name": "name",
          "type": "string",
          "description": "read 时必填，skill 名",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_open_mail",
      "description": {
        "zh": "调起系统邮件应用写反馈信（WebView 不支持 mailto）。",
        "en": "调起系统邮件应用写反馈信（WebView 不支持 mailto）。"
      },
      "parameters": [
        {
          "name": "email",
          "type": "string",
          "description": "收件邮箱",
          "required": true
        },
        {
          "name": "subject",
          "type": "string",
          "description": "主题，缺省按类型生成",
          "required": false
        },
        {
          "name": "kind",
          "type": "string",
          "description": "bug/feature",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_open_url",
      "description": {
        "zh": "系统浏览器打开本仓库相关链接。",
        "en": "系统浏览器打开本仓库相关链接。"
      },
      "parameters": [
        {
          "name": "url",
          "type": "string",
          "description": "https 链接（限本仓库相关）",
          "required": true
        }
      ]
    },
    {
      "name": "subagent_vendor_js",
      "description": {
        "zh": "读 vendor/ 下 js/css（如 katex），供面板注入，防路径逃逸。",
        "en": "读 vendor/ 下 js/css（如 katex），供面板注入，防路径逃逸。"
      },
      "parameters": [
        {
          "name": "name",
          "type": "string",
          "description": "文件名，如 katex.min.js",
          "required": true
        }
      ]
    },
    {
      "name": "subagent_save_turn",
      "description": {
        "zh": "【面板内部】流式结束后落盘一轮消息并累计用量。",
        "en": "【面板内部】流式结束后落盘一轮消息并累计用量。"
      },
      "parameters": [
        {
          "name": "id",
          "type": "string",
          "description": "任务 id",
          "required": true
        },
        {
          "name": "turns",
          "type": "array",
          "description": "消息数组",
          "required": true
        },
        {
          "name": "done",
          "type": "boolean",
          "description": "是否结束",
          "required": true
        },
        {
          "name": "usage",
          "type": "object",
          "description": "token 用量",
          "required": false
        },
        {
          "name": "finish_reason",
          "type": "string",
          "description": "stop/tool_calls/length",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_stream_flush",
      "description": {
        "zh": "【面板内部】流式增量落盘，保状态与草稿。",
        "en": "【面板内部】流式增量落盘，保状态与草稿。"
      },
      "parameters": [
        {
          "name": "id",
          "type": "string",
          "description": "任务 id",
          "required": true
        },
        {
          "name": "think",
          "type": "string",
          "description": "累计思考",
          "required": true
        },
        {
          "name": "body",
          "type": "string",
          "description": "累计正文",
          "required": true
        }
      ]
    },
    {
      "name": "subagent_tool_once",
      "description": {
        "zh": "【面板内部】执行单个工具（白名单与写边界与后端一致）。",
        "en": "【面板内部】执行单个工具（白名单与写边界与后端一致）。"
      },
      "parameters": [
        {
          "name": "id",
          "type": "string",
          "description": "任务 id",
          "required": true
        },
        {
          "name": "tool",
          "type": "string",
          "description": "工具名",
          "required": true
        },
        {
          "name": "args",
          "type": "object",
          "description": "参数对象",
          "required": true
        }
      ]
    },
    {
      "name": "subagent_stream_ctx",
      "description": {
        "zh": "【面板内部】返回端点/模型/请求头/工具 schema。",
        "en": "【面板内部】返回端点/模型/请求头/工具 schema。"
      },
      "parameters": [
        {
          "name": "id",
          "type": "string",
          "description": "任务 id",
          "required": true
        }
      ]
    },
    {
      "name": "subagent_stream_key",
      "description": {
        "zh": "【面板内部】取密钥（不回显）。",
        "en": "【面板内部】取密钥（不回显）。"
      },
      "parameters": []
    },
    {
      "name": "subagent_stream_relay",
      "description": {
        "zh": "【面板内部】http 端点 SSE 中继。",
        "en": "【面板内部】http 端点 SSE 中继。"
      },
      "parameters": [
        {
          "name": "id",
          "type": "string",
          "description": "任务 id",
          "required": true
        },
        {
          "name": "body",
          "type": "object",
          "description": "预构建请求体",
          "required": false
        }
      ]
    }
  ]
}
*/

"use strict";

var CFG = require("./sb_config.js");
var BUS = require("./sb_bus.js");
/* 所有子代理工具的回执都附带未读提示：主代理每次调用就会看到，不靠钩子 */

var LLM = require("./sb_llm.js");
var TOOLS = require("./sb_tools.js");
var TASK = require("./sb_task.js");
var SKILL = require("./sb_skill.js");

var VERSION = "v1.0.0";
/* 模型列表磁盘缓存有效期：24 小时。600+ 模型一次拉取数秒，命中缓存直接返回 */
var MODELS_TTL_BACKEND = 24 * 60 * 60 * 1000;

function parseList(raw) {
    var out = [];
    if (raw == null) return out;
    if (Object.prototype.toString.call(raw) === "[object Array]") {
        for (var i = 0; i < raw.length; i++) { var v = String(raw[i] == null ? "" : raw[i]).trim(); if (v) out.push(v); }
        return out;
    }
    var t = String(raw);
    t = t.split("，").join(",").split(";").join(",");
    t = t.split(String.fromCharCode(10)).join(",").split(String.fromCharCode(13)).join(",");
    t = t.split(String.fromCharCode(9)).join(",").split(" ").join(",");
    var arr = t.split(",");
    for (var j = 0; j < arr.length; j++) { var x = arr[j].trim(); if (x) out.push(x); }
    return out;
}

function parseJson(raw, def) {
    if (raw == null || raw === "") return def;
    if (typeof raw === "object") return raw;
    try { return JSON.parse(String(raw)); } catch (e) { return def; }
}

function clip(s, n) { return TOOLS.clip(s, n).text; }

async function loadCtx(cfg, task) {
    var undo = await TASK.loadUndo(task.id);
    var seq = Number(undo.seq || 0);
    return {
        allowed: task.allowed_tools || [],
        workspace: task.workspace_resolved || "",
        productDir: task.product_dir,
        maxChars: Number(cfg.tool_result_max_chars || 0),
        allowDanger: (task && task.allow_danger === true) || cfg.allow_danger === true,
        tool_timeout_ms: Number((task && task.tool_timeout_ms) || cfg.tool_timeout_ms || 0),
        roots: [task.workspace_resolved || "", task.product_dir || ""].filter(Boolean),
        nextSeq: function () { seq = seq + 1; return seq; },
        loadUndo: function () { return undo.items || []; },
        appendUndo: function (recs) { undo.items = (undo.items || []).concat(recs || []); undo.seq = seq; },
        clearUndo: function () { undo.items = []; undo.seq = seq; },
        save: async function () { await TASK.saveUndo(task.id, undo); }
    };
}

async function notifyDone(task) {
    try {
        if (!task) return;
        if (task.status !== "done" && task.status !== "failed") return;
        /* 【第七十七轮】两个不该入箱的情况，按用户定义「用户建立以及查看的不算」：
           1) origin=ui —— 用户自己在面板建的任务，结论就在面板里，不用额外提醒
           2) failed —— 失败不是「产出了结论」，进箱只是噪音（例如端点连不上）
           注意：这两个条件只挡收件箱，系统通知照旧，别把故障信息也吞了。 */
        var origin = String(task.origin || "");
        var skipInbox = (origin === "ui") || (task.status === "failed");
        var cfg = await CFG.load();
        var mode = String(cfg.notice_mode || "inbox");
        var title = String(task.title || task.id);
        /* 全文入库（第七轮）：旧版截 160 字，邮件正文打不开——现在存全量，
           由 sb_bus 的 20000 上限统一兜底 */
        var text = task.result ? String(task.result) : String(task.error || "已结束");
        if (mode !== "off" && !skipInbox) {
            try { BUS.add({ id: task.id, title: title, task_id: task.id, task_title: task.title || title, text: text, finished_at: Date.now(), created_at: Date.now() }); } catch (e0) {}
        }
        if (mode === "system" && Tools && Tools.System && Tools.System.sendNotification) {
            Tools.System.sendNotification(text.slice(0, 120), "子代理：" + title);
        }
    } catch (e) {}
}

function inboxSuffix() {
    try { var n = BUS.list().length; return n > 0 ? ("｜收件箱 " + n + " 条未读结论（subagent_inbox 查看）") : ""; } catch (e) { return ""; }
}

function tsOf(ms) {
    try {
        var d = new Date(Number(ms) || 0);
        function z(n) { return (n < 10 ? "0" : "") + n; }
        return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes());
    } catch (e) { return ""; }
}
function briefOf(task, unreadCache) {
    /* phase 是「此刻在干什么」：llm=正在调模型，tool=正在跑工具，idle=空闲。
       面板靠它显示「思考中」而不是干等一个「运行中」。
       phase_at 是进入该阶段的时刻，前端用来算已思考多少秒。 */
    return {
        id: task.id, title: task.title, status: task.status, step: task.step,
        max_steps: task.max_steps, next: TASK.nextFor(task),
        phase: String(task.phase || "idle"),
        phase_at: Number(task.phase_at || 0),
        tool_now: String(task.tool_now || ""),
        usage: task.usage || { in: 0, out: 0, est_cost: 0 },
        workspace_resolved: task.workspace_resolved || "",
        product_dir: task.product_dir || "",
        label: task.title || "",
        mode: "continuable",
        agent_status: (task.status === "running" || task.status === "queued") ? "running" : "inactive",
        inbox_unread: (typeof unreadCache === "number") ? unreadCache
            : (function () { try { return BUS.list().length; } catch (e) { return 0; } })(),
        last_text: (task.last && task.last.text) ? String(task.last.text).slice(0, 80) : "",
        result_preview: task.result ? String(task.result).slice(0, 80) : "",
        created_at: tsOf(task.created_at),
        last_at: tsOf(task.updated_at || task.last_at),
        origin: task.origin || "",
        max_depth: task.max_depth || 0,
        tokens: ((task.usage || {}).in || 0) + ((task.usage || {}).out || 0),
        error: task.error || null
    };
}

exports.subagent_spawn = async function (params) {
    params = params || {};
    var cfg = await CFG.load();
    var taskText = String(params.task == null ? "" : params.task).trim();
    /* 【第七十九轮】新参数名 tools 和旧名 allowed_tools 都认。
       METADATA 已改成 tools，但面板与老的外部调用还在用 allowed_tools，
       只认新名会让「按新声明传参」的调用拿到空白名单 —— 任务一个工具都没有。 */
    var allowed = parseList(params.tools != null ? params.tools : params.allowed_tools);
    /* all=true：放开全部工具。语义定调（2026-11-07 用户拍板）：
       留空 = 一个工具都用不了（空数组，白名单全拒）；
       要全放开必须显式传 all=true → 内部变成 ["*"]。
       "*" 在 sb_llm.runToolSchema 里会展开 sb_toolmeta 全表 + 留 run_tool 兜底表外包；
       在 sb_tools.matchAllowed 里匹配一切；但 isRecursive 仍会硬拦递归派子代理。 */
    if (params.all === true) allowed = ["*"];
    /* 【第七十九轮】tools="*" 等同于 old all=true。
       METADATA 里 all 已删掉，改由 tools 传 * 表达「全放开」，
       但面板与老调用仍可能传 all=true —— 两条都认。 */
    for (var ai = 0; ai < allowed.length; ai++) {
        if (String(allowed[ai]).trim() === "*") { allowed = ["*"]; break; }
    }
    var template = null;
    if (params.template_id) {
        var tpls = cfg.templates || [];
        for (var i = 0; i < tpls.length; i++) { if (tpls[i] && tpls[i].id === String(params.template_id)) { template = tpls[i]; break; } }
        if (!template) { complete({ success: false, message: "没有这个模板：" + params.template_id, data: {} }); return; }
        if (!taskText && template.task_template) taskText = String(template.task_template);
        if (!allowed.length && template.allowed_tools) allowed = parseList(template.allowed_tools);
    }
    if (!taskText) { complete({ success: false, message: "task 不能为空", data: {} }); return; }
    /* allowed_tools 不是必填，但语义是「留空 = 一个工具都用不了」（2026-11-07 用户拍板）。
       要放开全部必须显式传 all=true → 内部变成 ["*"]。
       注意：空数组不会 fallback 到 default_allowed_tools，否则面板路径与 advanceTask 路径
       对同一条规矩给出相反结果。 */
    if (allowed.length > 40) { complete({ success: false, message: "allowed_tools 过多（上限 40）", data: {} }); return; }
    var bad = [];
    for (var j = 0; j < allowed.length; j++) { if (TOOLS.isRecursive(allowed[j])) bad.push(allowed[j]); }
    if (bad.length) { complete({ success: false, message: "禁止递归派子代理：" + bad.join(", "), data: {} }); return; }

    var writeTools = [];
    for (var k = 0; k < allowed.length; k++) { if (TOOLS.isWriteTool(allowed[k])) writeTools.push(allowed[k]); }
    /* 【第六十六轮 · 用户定 B 方案】不再静默回落到 cfg.default_workspace。
       用户原话：「我在创建时并没有选择工作目录，你为什么还要去选择添加一个东西进去？」
       旧行为：不传 workspace 就自动拿 default_workspace（那个值还是早期插件旧路径），
       于是用户没选过目录，界面里却冒出一个 plugins/com.operit.subagent/workspace。
       现在：只认调用方显式传的 workspace / 模板里的 workspace，否则留空。
       留空时含写类工具会被下面拦下 —— 这就是要的效果（没选就不给写）。
       注：cfg.default_workspace 字段保留在配置文件里不删，老配置不会因此报错，
       但代码不再读它。 */
    var ws = String(params.workspace || template && template.workspace || "").trim();
    if (ws) {
        var wsInfo = null;
        try { wsInfo = await Tools.Files.exists(ws); } catch (e2) { wsInfo = null; }
        if (wsInfo && wsInfo.exists === false) {
            complete({ success: false, message: "workspace 不存在：" + ws, data: { workspace: ws } });
            return;
        }
        if (wsInfo && wsInfo.isDirectory === false) {
            complete({ success: false, message: "workspace 是文件不是目录：" + ws + "（请改填它所在目录）", data: { workspace: ws } });
            return;
        }
    }
    if (writeTools.length && !ws) {
        complete({ success: false, message: "含写类工具（" + writeTools.join(", ") + "），必须提供 workspace", data: { write_tools: writeTools } });
        return;
    }

    var ctxText = String(params.context_text || "");
    /* 【第六十五轮】skill 清单：逗号分隔或 all。all 展开成全部名字。
       为什么只传名字不传全文：全文几十万字会把上下文吃光，模型要用哪个自己读。 */
    var skillsArg = String(params.skills || "").trim();
    var skillsList = [];
    if (skillsArg) {
        if (skillsArg.toLowerCase() === "all") {
            try {
                var _allSk = await SKILL.listSkills();
                for (var _si = 0; _si < _allSk.length; _si++) skillsList.push(_allSk[_si].name);
            } catch (eSk2) { skillsList = []; }
        } else {
            var _parts = skillsArg.split(",");
            for (var _pi = 0; _pi < _parts.length; _pi++) {
                var _one = String(_parts[_pi] || "").trim();
                if (_one) skillsList.push(_one);
            }
        }
    }
    var ctxModeEarly = String(params.context_mode || "");
    if (!ctxText && (ctxModeEarly === "chat_tail" || ctxModeEarly === "fork" || ctxModeEarly === "summary")) {
        try {
            var pcid = String(params.parent_chat_id || "");
            /* 【自动取当前对话】ToolPkg API 1.2.0 的 getToolExecutionContext().chatId
               就是发起本次工具调用的对话 id，比下面「取最近更新的对话」准得多：
               用户在 A 对话里派活、B 对话刚好更新过，取最近会拿错。
               老宿主没这个 API，所以 typeof 判存在 + 回退到原逻辑。 */
            if (!pcid) {
                try {
                    if (typeof getToolExecutionContext === "function") {
                        var ec0 = getToolExecutionContext();
                        pcid = String((ec0 && ec0.chatId) || "");
                    }
                } catch (eEc) { pcid = ""; }
            }
            if (!pcid) {
                /* 同 subagent_chats：宿主校验 query 必填，优先 listAll */
                var lr = null;
                try {
                    if (Tools.Chat && typeof Tools.Chat.listAll === "function") lr = await Tools.Chat.listAll();
                } catch (eLA) { lr = null; }
                if (!lr) {
                    lr = await Tools.Chat.listChats({ query: "", match: "contains", sort_by: "updatedAt", sort_order: "desc", limit: 20 });
                }
                pcid = String((lr && lr.currentChatId) || "");
                if (!pcid) {
                    var arr0 = (lr && (lr.chats || lr.items || lr.data)) || [];
                    if (arr0.length) pcid = String(arr0[0].id || arr0[0].chatId || "");
                }
            }
            if (pcid) {
                var need = ctxModeEarly === "chat_tail" ? 8 : (ctxModeEarly === "fork" ? 24 : 60);
                /* 用户可指定带入条数，缺省按模式默认 */
                var wantTurns = Number(params.context_turns || 0);
                if (wantTurns > 0) need = Math.min(wantTurns, 120);
                var mr = await Tools.Chat.getMessages(pcid, { order: "desc", limit: need });
                var ms = (mr && (mr.messages || mr.items || mr.data)) || [];
                var lines = [];
                for (var mi = ms.length - 1; mi >= 0; mi--) {
                    var m = ms[mi] || {};
                    var role = String(m.sender || m.role || "");
                    if (role !== "user" && role !== "ai" && role !== "assistant") continue;
                    var tx = String(m.content || "").replace(/<[^>]+>/g, " ").trim();
                    if (!tx) continue;
                    lines.push((role === "user" ? "我：" : "AI：") + tx.slice(0, 600));
                }
                ctxText = lines.join("\n");
            }
        } catch (e) {}
    }
    var files = parseList(params.context_files);
    for (var f = 0; f < files.length; f++) {
        try {
            var r = await Tools.Files.read(files[f], "android");
            var body = (typeof r === "string") ? r : String((r && (r.content != null ? r.content : r.text)) || "");
            if (body) ctxText += "\n\n[文件] " + files[f] + "\n" + body;
        } catch (e) {}
    }
    if (ctxText.length > Number(cfg.inject_max_chars || 20000)) {
        complete({ success: false, message: "注入内容过长（" + ctxText.length + " 字符），上限 " + cfg.inject_max_chars, data: {} });
        return;
    }

    var kp = parseJson(params.key_points, template && template.key_points ? template.key_points : {});
    var task = await TASK.createTask(cfg, {
        origin: String(params.origin || "agent"),
        max_depth: Number(params.max_depth || 0),
        task: taskText, title: params.title || template && template.name || "",
        key_points: kp,
        allowed_tools: allowed,
        allow_danger: params.allow_danger === true,
        thinking_level: params.thinking_level || template && template.thinking_level || "medium",
        workspace_resolved: ws,
        context_mode: params.context_mode || template && template.context_mode || cfg.default_context_mode,
        context_text: ctxText,
        skills: skillsList,
        max_steps: params.max_steps, timeout_ms: params.timeout_ms,
        model: params.model, base_url: params.base_url,
        summary_level: params.summary_level, result_level: params.result_level,
        group: params.group
    });

    /* 【第七十九轮】新名 wait / budget 与旧名 sync / wait_ms 都认。
       wait 不传 budget 时不再用默认 30 秒，而是「一直等到结束（失败除外）」，
       用 deadline=0 表示不限。旧调用传了 sync+wait_ms 仍按老规矩跑，不会变慢。 */
    var wantWait = (params.wait === true) || (params.sync === true);
    var rawBudget = (params.budget != null) ? Number(params.budget) : ((params.wait_ms != null) ? Number(params.wait_ms) : 0);
    var waitMs = rawBudget > 0 ? Math.min(rawBudget, Number(cfg.wait_max_ms || 60000)) : 0;
    /* 建完立刻置 running + phase=queued_next：
       用户看到的「待开始」是因为 createTask 写的是 queued，要等第一次 advance 才变 running。
       但任务实际上马上要跑，所以这里直接标成 running，面板立刻显示「思考中」而不是「待开始」。
       注意：不写 phase=llm，因为还没真发请求；用 queued_next 表示「已排上，马上开跑」。 */
    if (!wantWait) {
        task.status = "running";
        task.phase = "queued_next";
        task.phase_at = Date.now();
        try { await TASK.saveTask(task); } catch (eSP) {}
    }
    if (wantWait) {
        /* waitMs=0 表示不设上限：一直推到 done/failed 或用户取消。
           上限预算时到点返回中途结果 + unfinished 引导。 */
        var deadline = waitMs > 0 ? (Date.now() + waitMs) : 0;
        var last = null;
        var lastMsg = "";
        var busyHits = 0;
        while (!deadline || Date.now() < deadline) {
            var r2 = await TASK.advanceTask(cfg, task);
            notifyDone(r2 && r2.task);
            /* 【第七十五轮】busy 单独处理。
               并发时 advanceTask 返回 {ok:false, busy:true}，但任务本身在正常跑。
               旧代码 if (!r2.ok) break; 会把它当失败跳出，
               把「别人正在推」报成「没在预算内完成」——两件完全不同的事。 */
            if (r2 && r2.busy) {
                busyHits++;
                if (busyHits > 60) { lastMsg = String(r2.message || "任务持续被其他处推进"); break; }
                await new Promise(function (rr) { setTimeout(rr, 800); });
                continue;
            }
            last = r2;
            lastMsg = String(r2.message || lastMsg || "");
            if (r2.task && (r2.task.status === "done" || r2.task.status === "failed" || r2.task.status === "cancelled")) break;
            if (!r2.ok) break;
        }
        var cur = (last && last.task) ? last.task : task;
        /* 【第七十五轮】把「还在跑」和「真失败」分开。
           旧版 success 只看 status === "done"，中途返回也是 false，
           data.result 是 null，也没有 task_id / next ——
           调用方拿到 success:false 完全分不清是哪种情况。 */
        var stCur = String(cur.status || "");
        var unfinished = (stCur !== "done" && stCur !== "failed" && stCur !== "cancelled");
        var msgOut;
        if (stCur === "done") msgOut = "子代理完成（" + cur.step + " 步）";
        else if (unfinished) {
            msgOut = "任务还在跑（已 " + cur.step + "/" + cur.max_steps + " 步），未在等待预算内完成。"
                + "继续推进：subagent_run(id=\"" + cur.id + "\", wait=true)";
        } else msgOut = (cur.error || lastMsg || "任务未完成");
        complete({
            success: stCur === "done",
            message: msgOut + inboxSuffix(),
            data: {
                task: briefOf(cur),
                task_id: cur.id,
                unfinished: unfinished,
                next: unfinished ? "run" : null,
                summary: TASK.buildSummary(cur, params.detail || params.result_level || params.summary_level || cur.summary_level, cur.last),
                result: stCur === "done" ? TASK.buildResult(cur, params.detail || params.result_level || cur.result_level) : null
            }
        });
        return;
    }

    /* 【第七十三轮】allowed_tools 为空时把后果说清楚。
       旧文案只有「已建任务 xxx」，用户以为能跑，advance 才撞「工具不在允许范围」。
       与 sb_hook.js 的「参数纪律」提示保持一致。 */
    var emptyTip = "";
    if (!allowed.length) {
        emptyTip = "（注意：tools 为空，这个子代理没有任何工具可用，只能凭上下文空想。"
            + "要让它读文件请传 tools=\"read_file\"，要全放开传 tools=\"*\"）";
    }
    complete({ success: true, message: "已建任务 " + task.id + emptyTip + inboxSuffix(), data: { task: briefOf(task), next: "run", allowed_count: allowed.length } });
};

exports.subagent_advance = async function (params) {
    params = params || {};
    var cfg = await CFG.load();
    var task = await TASK.loadTask(String(params.id || ""));
    if (!task) { complete({ success: false, message: "找不到任务", data: {} }); return; }
    var n = Math.max(1, Math.min(3, Number(params.steps || 1)));
    var last = null;
    for (var i = 0; i < n; i++) {
        last = await TASK.advanceTask(cfg, task);
        task = last.task || task;
        if (task.status === "done" || task.status === "failed" || task.status === "cancelled") break;
    }
    notifyDone(task);
    complete({
        success: !!last && !!last.ok,
        message: (last ? (last.message || "已推进") : "无变化") + inboxSuffix(),
        data: {
            task: briefOf(task),
            summary: TASK.buildSummary(task, params.summary_level || task.summary_level, task.last),
            result: task.status === "done" ? TASK.buildResult(task, task.result_level) : null
        }
    });
};

exports.subagent_wait = async function (params) {
    params = params || {};
    var cfg = await CFG.load();
    var task = await TASK.loadTask(String(params.id || ""));
    if (!task) { complete({ success: false, message: "找不到任务", data: {} }); return; }
    var t = Math.min(Number(params.timeout_ms || 30000), Number(cfg.wait_max_ms || 60000));
    var deadline = Date.now() + t;
    while (Date.now() < deadline) {
        if (task.status === "done" || task.status === "failed" || task.status === "cancelled") break;
        var r = await TASK.advanceTask(cfg, task);
        task = r.task || task;
        if (!r.ok) break;
        try { await Tools.System.sleep(200); } catch (e) {}
    }
    notifyDone(task);
    complete({
        success: task.status === "done",
        message: task.status === "done" ? "已完成" : (task.error || "仍在运行"),
        data: {
            task: briefOf(task),
            summary: TASK.buildSummary(task, params.summary_level || task.summary_level, task.last),
            result: task.status === "done" ? TASK.buildResult(task, params.result_level || task.result_level) : null
        }
    });
};

exports.subagent_status = async function (params) {
    params = params || {};
    var id = String(params.id || "");
    if (!id) {
        var all = await TASK.listTasks();
        var items = [];
        for (var i = 0; i < all.length; i++) items.push(briefOf(all[i]));
        complete({ success: true, message: "共 " + items.length + " 个任务", data: { items: items, total: items.length } });
        return;
    }
    var t = await TASK.loadTask(id);
    if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
    complete({
        success: true, message: t.status,
        data: {
            task: briefOf(t),
            summary: t.last || null,
            usage: t.usage, undo_count: (await TASK.loadUndo(id)).items ? (await TASK.loadUndo(id)).items.length : 0
        }
    });
};

exports.subagent_result = async function (params) {
    if (params && params.id) { try { BUS.remove(String(params.id)); } catch (e0) {} }
    params = params || {};
    var ids = parseList(params.task_ids);
    if (!ids.length && params.id) ids = [String(params.id)];
    if (!ids.length) { complete({ success: false, message: "需要 id 或 task_ids", data: {} }); return; }
    var outs = [];
    var allDone = true;
    for (var i = 0; i < ids.length; i++) {
        var t = await TASK.loadTask(ids[i]);
        if (!t) { outs.push({ id: ids[i], ok: false, error: "找不到任务" }); allDone = false; continue; }
        if (t.status !== "done") allDone = false;
        var text = t.status === "done" ? TASK.buildResult(t, params.result_level || t.result_level) : null;
        if (text && params.max_chars) text = clip(text, Number(params.max_chars));
        outs.push({ id: t.id, ok: t.status === "done", status: t.status, steps: t.step, usage: t.usage, result: text });
    }
    var merged = ids.length > 1 ? outs.map(function (o) { return "== " + o.id + " ==\n" + (o.result || "（未完成：" + o.status + "）"); }).join("\n\n") : null;
    complete({ success: true, message: allDone ? ("已取回 " + outs.length + " 个任务结论") : "有任务未完成（结果仍返回）", data: { all_done: allDone, items: outs, merged: merged } });
};

exports.subagent_undo = async function (params) {
    params = params || {};
    var cfg = await CFG.load();
    var t = await TASK.loadTask(String(params.id || ""));
    if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
    var ctx = await loadCtx(cfg, t);
    var dry = params.dry_run === undefined ? true : !!params.dry_run;
    /* 【第八十轮】undoAll 现在返回 { plan, warns }：
       warns 是「备份失败/越界未备份」条数，恢复不了的要明说。 */
    var res = await TOOLS.undoAll(ctx, dry);
    if (ctx.save) await ctx.save();
    var plan = res.plan || [];
    var warns = res.warns || 0;
    var msg = "【Beta】" + (dry ? ("将恢复 " + plan.length + " 项（未执行）") : ("已恢复 " + plan.length + " 项"));
    if (warns > 0) msg += "，其中 " + warns + " 项未备份成功、恢复不了（见 plan 里 error 字段）";
    msg += "（undo 为 Beta 功能：terminal 命令的写入不会备份，路径提取失败也会漏备，重要文件请先用 dry_run=true 看计划再执行）";
    complete({ success: true, message: msg, data: { dry_run: dry, plan: plan, warns: warns, beta: true } });
};

exports.subagent_cancel = async function (params) {
    params = params || {};
    var t = await TASK.loadTask(String(params.id || ""));
    if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
    t.cancel = true; t.status = "cancelled";
    await TASK.saveTask(t);
    complete({ success: true, message: "已取消", data: { id: t.id } });
};

/* 恢复任务：把 cancelled / failed / done 拉回 queued，清掉取消标记。
   面板「继续推进」在非 running 状态下会先走这里，否则 advanceTask 见到
   cancelled 会直接返回，永远推不动。 */
exports.subagent_resume = async function (params) {
    params = params || {};
    var t = await TASK.loadTask(String(params.id || ""));
    if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
    if (t.status === "running") { complete({ success: true, message: "任务正在运行", data: { id: t.id, status: t.status } }); return; }
    var was = t.status;
    t.cancel = false;
    t.error = null;
    t.status = "queued";
    /* 已用完步数时给一次新预算，否则一推就报「超出步数上限」 */
    if (Number(t.step || 0) >= Number(t.max_steps || 0)) {
        t.max_steps = Number(t.step || 0) + Number(t.max_steps || 20);
    }
    await TASK.saveTask(t);
    complete({ success: true, message: "已恢复（" + (was || "未知") + " → 待开始）", data: { id: t.id, status: t.status, step: t.step, max_steps: t.max_steps } });
};

exports.subagent_steer = async function (params) {
    params = params || {};
    var cfg = await CFG.load();
    var t = await TASK.loadTask(String(params.id || ""));
    if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
    var r = await TASK.steerTask(cfg, t, String(params.message || ""));
    complete({ success: r.ok, message: r.message, data: { id: t.id, step: t.step, status: t.status, next: r.ok ? "advance" : null } });
};
exports.subagent_inbox = async function (params) {
    params = params || {};
    if (String(params.action || "") === "read") {
        var n = 0;
        try { n = BUS.clear ? BUS.clear() : 0; } catch (e) { n = 0; }
        complete({ success: true, message: "已清空收件箱（" + n + " 条）", data: { cleared: n } });
        return;
    }
    /* 只报真实可观测的数据：
       - count：收件箱未读条数
       - hook_calls：钩子被宿主真正调用的次数（写在 SharedPreferences，跨引擎可读）
         这个数是判断「提示词钩子到底会不会被触发」的唯一依据。
         恒 0 且 skips 也为 0 = 宿主没调这个钩子，写法再对也是空转。
       - hook_disabled_skips：钩子被调了但开关关着而跳过的次数
         calls>0 且 skips>0 = 钩子在调，是用户主动关掉的，不是坏了
       - hook_last_at：上次钩子被调用的时间戳（毫秒，0 = 从未调用）
       - hook_enabled：钩子开关当前状态 */
    var st = BUS.stat();
    /* 【第七十六轮】自愈：收件箱里对应任务已不存在的，自动出箱。
       为什么：未读的本质是「子代理产出了结论、用户还没取走」，
       任务（对话）都不在了，这条结论无从取起，留着只会让未读数永远不降。
       用户原话：「我在删除对话之后，这个未读消息它不会减少，
       这个未读消息应当是检测对话状态的」。
       覆盖场景：任务文件被外部删掉、装了新包丢了 tasks 目录、
       或者早期版本删除时没清理收件箱。 */
    var pruned = 0;
    try {
        var allMails = BUS.list();
        for (var pi = 0; pi < allMails.length; pi++) {
            var mid = String((allMails[pi] || {}).id || "");
            if (!mid) continue;
            var mt = await TASK.loadTask(mid);
            /* 任务已不存在 → 出箱 */
            if (!mt) { try { BUS.remove(mid); pruned++; } catch (eP) {} continue; }
            /* 【第七十七轮】任务还在但不该在箱里的旧数据也顺手清掉：
               origin=ui（用户自己建的）+ failed（失败不是结论）。
               这两条是新的入箱判据，装包前积下的旧邮件靠这里自愈。 */
            var mo = String(mt.origin || "");
            if (mo === "ui" || String(mt.status || "") === "failed") {
                try { BUS.remove(mid); pruned++; } catch (eP2) {}
            }
        }
        if (pruned > 0) st = BUS.stat();
    } catch (ePr) {}
    var calls = 0, skips = 0, lastAt = 0, enabled = true;
    try {
        var p = Java.getApplicationContext().getSharedPreferences("subagent_inbox", 0);
        if (p) {
            calls = Number(p.getInt("hook_calls", 0)) || 0;
            skips = Number(p.getInt("hook_disabled_skips", 0)) || 0;
            lastAt = Number(p.getLong("hook_last_at", 0)) || 0;
        }
    } catch (eC) { calls = 0; skips = 0; lastAt = 0; }
    try {
        var HK = require("./sb_hook.js");
        enabled = HK.hookEnabled();
    } catch (eH) { enabled = true; }
    /* 上次调用距今多久：比裸时间戳直观，排查时一眼能看出钩子是不是还活着 */
    var agoTxt = "从未";
    if (lastAt > 0) {
        var sec = Math.floor((Date.now() - lastAt) / 1000);
        if (sec < 60) agoTxt = sec + " 秒前";
        else if (sec < 3600) agoTxt = Math.floor(sec / 60) + " 分钟前";
        else if (sec < 86400) agoTxt = Math.floor(sec / 3600) + " 小时前";
        else agoTxt = Math.floor(sec / 86400) + " 天前";
    }
    complete({
success: true,
        message: "未读 " + st.count + " 条；钩子调用 " + calls + " 次（上次 " + agoTxt
            + "，开关" + (enabled ? "已开启" : "已关闭") + (skips > 0 ? "，关闭期间跳过 " + skips + " 次" : "")
            + (pruned > 0 ? "；已清掉 " + pruned + " 条对应任务已删除的" : "") + "）",
        data: {
            count: st.count,
            hook_calls: calls,
            hook_disabled_skips: skips,
            hook_last_at: lastAt,
            hook_enabled: enabled,
            items: BUS.list()
        }
    });
};
exports.subagent_list = async function (params) {
    var all = await TASK.listTasks();
    var unread = 0;
    try { unread = BUS.list().length; } catch (eU) { unread = 0; }
    var items = [];
    for (var i = 0; i < all.length; i++) items.push(briefOf(all[i], unread));
    var u = await TASK.loadUsage();
    complete({ success: true, message: "共 " + items.length + " 个任务", data: { items: items, total: items.length, usage: u } });
};

exports.subagent_close = async function (params) {
    params = params || {};
    var cfg = await CFG.load();
    var t = await TASK.loadTask(String(params.id || ""));
    if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
    if (params.confirm !== true) {
        var undo0 = await TASK.loadUndo(t.id);
        complete({
            success: true,
            message: "未关闭：已返回当前进度。确认关闭传 confirm=true；要丢弃产物再传 delete_product=true",
            data: {
                need_confirm: true,
                task: briefOf(t),
                last: t.last || null,
                undo_count: (undo0.items || []).length,
                result_preview: t.result ? String(t.result).slice(0, 500) : null
            }
        });
        return;
    }
    var restored = null;
    var rollbackWarn = 0;
    if (params.rollback === true) {
        var ctx = await loadCtx(cfg, t);
        restored = await TOOLS.undoAll(ctx, false);
        if (ctx.save) await ctx.save();
        rollbackWarn = (restored && restored.warns) || 0;
    }
    if (params.delete_product === true) {
        try { await Tools.Files.deleteFile(t.product_dir, true, "android"); } catch (e) {}
    }
    t.status = "closed";
    await TASK.saveTask(t);
    var closeMsg = "已关闭" + (params.rollback === true ? "并回滚" : "");
    if (rollbackWarn > 0) closeMsg += "（" + rollbackWarn + " 项未备份成功、恢复不了）";
    complete({ success: true, message: closeMsg, data: { id: t.id, restored: restored } });
};

exports.subagent_delete = async function (params) {
    params = params || {};
    var id = String(params.id || "");
    if (!id) { complete({ success: false, message: "缺少 id", data: {} }); return; }
    var t = await TASK.loadTask(id);
    if (!t) {
        try { await Tools.Files.deleteFile(CFG.baseDir() + "/tasks/" + id + ".json", false, "android"); } catch (e) {}
        /* 任务文件已不在，收件箱里若还留着这条也要一并出箱 ——
           否则会变成「点删除没反应，未读数也不降」的死角。 */
        try { BUS.remove(id); } catch (eB) {}
        complete({ success: true, message: "任务文件已删除", data: { id: id } });
        return;
    }
    if (params.confirm !== true) {
        complete({
            success: true,
            message: "未删除：确认请传 confirm=true（会同时删掉任务记录、产物目录与快照）",
            data: { need_confirm: true, task: briefOf(t), turns: (t.turns || []).length }
        });
        return;
    }
    /* 1. 任务定义文件 */
    try { await Tools.Files.deleteFile(CFG.baseDir() + "/tasks/" + id + ".json", false, "android"); } catch (e) {}
    /* 2. 产物目录 + undo 快照 */
    try { await Tools.Files.deleteFile(t.product_dir || TASK.productDirOf(id), true, "android"); } catch (e) {}
    /* 3. 收件箱里这条结论一并出箱。
       为什么：未读的本质是「子代理产出了结论、用户还没取走」。
       对话（任务）都删了，那条结论也就无从取起，留着只会让未读数永远不降。
       用户原话：「我在删除对话之后，这个未读消息它不会减少，
       这个未读消息应当是检测对话状态的」。 */
    try { BUS.remove(id); } catch (eB) {}
    TASK.dropCache(id);
    complete({ success: true, message: "已删除任务", data: { id: id, deleted: true } });
};
exports.subagent_config = async function (params) {
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
        /* 端点/模型/协议/请求头属于 profile，必须写进 cfg.profile，否则 status() 读不到 */
        var profKeys = ["base_url", "model", "protocol", "custom_headers", "extra_body", "api_key_env", "name", "api_provider"];
        var rest = {};
        for (var k in patch) {
            if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
            if (k === "api_key") continue;
            if (profKeys.indexOf(k) >= 0) { cfg.profile[k] = patch[k]; }
            else { rest[k] = patch[k]; }
        }
        for (var k2 in rest) {
            if (!Object.prototype.hasOwnProperty.call(rest, k2)) continue;
            cfg[k2] = rest[k2];
        }
        /* 让 cfg.profile 指向 profiles 数组中的活动项；之后的写入会直接落到该对象上 */
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

exports.subagent_templates = async function (params) {
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
exports.subagent_probe = async function (params) {
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

exports.subagent_trace = async function (params) {
    params = params || {};
    var t = await TASK.loadTask(String(params.id || ""));
    if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
    var limit = Math.max(1, Math.min(50, Number(params.limit || 10)));
    var turns = t.turns || [];
    var start = Math.max(0, turns.length - limit);
    /* 面板传 compact=true 时压小单条正文，首次打开更快；点开详情再单独取全文 */
    var cap = params.compact === true ? 1200 : 4000;
    var capRes = params.compact === true ? 1800 : 6000;
    var out = [];
    /* system 不在 limit 窗口里也要单独补在最前：它是子代理全部指令来源，
       面板流式直连拿不到它就只能瞎猜，等于功能失效。 */
    for (var si = 0; si < turns.length; si++) {
        var sm = turns[si] || {};
        if (String(sm.role || "") !== "system") continue;
        out.push({ role: "system", content: clip(String(sm.content || ""), 6000) });
        break;
    }
    for (var i = start; i < turns.length; i++) {
        var m = turns[i] || {};
        var role = String(m.role || "");
        /* 上面已单独补过 system，这里跳过避免重复 */
        if (role === "system") continue;
        var item = { role: role, chars: String(m.content || "").length, at: m.at || null, elapsed_ms: Number(m.elapsed_ms || 0) };
        if (role === "assistant") {
            item.content = clip(String(m.content || ""), cap);
            if (m.reasoning) item.reasoning = clip(String(m.reasoning), cap);
            if (m.finish_reason) item.finish_reason = String(m.finish_reason);
            if (m.usage) item.usage = { in: Number(m.usage.in || 0), out: Number(m.usage.out || 0), model: String(m.usage.model || "") };
            if (m.tool_calls && m.tool_calls.length) {
                item.tool_calls = m.tool_calls.map(function (tc) {
                    var fn = tc.function || {};
                    return { id: String(tc.id || ""), name: String(fn.name || ""), args: clip(String(fn.arguments || ""), cap) };
                });
            }
        } else if (role === "tool") {
            item.name = String(m.name || "");
            item.args = clip(String(m.args || ""), 2000);
            item.ok = (m.ok !== false);
            item.calls_id = String(m.tool_call_id || "");
            item.result = clip(String(m.content || ""), capRes);
        } else {
            item.content = clip(String(m.content || ""), 2000);
        }
        out.push(item);
    }
    complete({
        success: true,
        message: "最近 " + out.length + " 条",
        data: {
            id: t.id, title: t.title, status: t.status, step: t.step,
            max_steps: t.max_steps, usage: t.usage,
            /* 阶段：idle / llm / tool，前端靠它显示「模型在生成」或「正在跑某工具」 */
            phase: String(t.phase || "idle"),
            phase_at: Number(t.phase_at || 0),
            tool_now: String(t.tool_now || ""),
            step_at: Number(t.step_at || 0),
            /* 流式过程中的临时落盘：面板退出再进来时用它恢复已生成的内容，
               不用重新跑一遍（重跑会叠出 35KB 的重复内容）。 */
            pending: t.pending ? {
                think: String(t.pending.think || ""),
                body: String(t.pending.body || ""),
                at: Number(t.pending.at || 0)
            } : null,
            created_at: tsOf(t.created_at), updated_at: tsOf(t.updated_at || t.last_at),
            workspace_resolved: t.workspace_resolved || "", product_dir: t.product_dir || "",
            total_turns: turns.length, shown: out.length,
            last: t.last || null,
            thinking_note: "思考内容取决于端点是否返回 reasoning_content；未返回时这里看不到",
            turns: out
        }
    });
};

/* 流式结果落盘：页面负责生成，后端只负责把这一轮存进任务文件。
   不做任何模型调用，避免两套逻辑打架。 */
exports.subagent_save_turn = async function (params) {
    params = params || {};
    var task = await TASK.loadTask(String(params.id || ""));
    if (!task) { complete({ success: false, message: "找不到任务", data: {} }); return; }
    var list = Array.isArray(params.turns) ? params.turns : [];
    /* 面板流式路径原来完全不记账：step 永远 0、usage 永远 0、完成也不进收件箱。
       结果就是状态行永远「第 0/20 步 · 0 tok」，收件箱永远空。
       这里补上与 advanceTask 一致的三件事：步数、用量、完成通知。 */
    var addedAssistant = false;
    for (var i = 0; i < list.length; i++) {
        var m = list[i] || {};
        var role = String(m.role || "");
        if (role !== "assistant" && role !== "tool" && role !== "user") continue;
        var t = { role: role };
        if (role === "assistant") {
            addedAssistant = true;
            t.content = String(m.content || "");
            if (m.reasoning) t.reasoning = String(m.reasoning);
            if (m.tool_calls && m.tool_calls.length) t.tool_calls = m.tool_calls;
        } else if (role === "tool") {
            t.tool_call_id = String(m.tool_call_id || "");
            t.name = String(m.name || "");
            t.args = String(m.args || "{}");
            t.ok = (m.ok !== false);
            t.content = String(m.content || "");
            t.chars = String(m.content || "").length;
        } else {
            t.content = String(m.content || "");
        }
        task.turns.push(t);
        await TASK.saveTask(task);
    }
    /* 一轮 = 一步，与 advanceTask 的 task.step + 1 对齐 */
    if (addedAssistant) task.step = Number(task.step || 0) + 1;
    /* 落了正式 turn 就清掉流式临时落盘，避免 fillTrace 里 pending 与 turn 重复渲染 */
    if (addedAssistant && list.length) {
        try { delete task.pending; } catch (eP2) { task.pending = null; }
    }
    /* 用量：面板直接调端点，usage 由页面回传（OpenAI 字段名 prompt/completion） */
    var uIn = Number((params.usage && (params.usage.in != null ? params.usage.in : params.usage.prompt_tokens)) || 0);
    var uOut = Number((params.usage && (params.usage.out != null ? params.usage.out : params.usage.completion_tokens)) || 0);
    if (uIn || uOut) {
        task.usage = task.usage || { in: 0, out: 0, est_cost: 0 };
        task.usage.in = Number(task.usage.in || 0) + uIn;
        task.usage.out = Number(task.usage.out || 0) + uOut;
        var cfgU = null;
        try { cfgU = await CFG.load(); } catch (eU) { cfgU = null; }
        if (cfgU) {
            try { await TASK.bumpUsage(cfgU, { in: uIn, out: uOut }); } catch (eB) {}
            try {
                task.usage.est_cost = Math.round((Number(task.usage.est_cost || 0) + LLM.estimateCost(cfgU, { in: uIn, out: uOut })) * 1000000) / 1000000;
            } catch (eC) {}
        }
    }
    if (params.finish_reason) task.last = Object.assign(task.last || {}, { finish_reason: String(params.finish_reason) });
    if (params.done === true) {
        task.status = "done";
        task.phase = "idle";
        var lastA = null;
        for (var j = task.turns.length - 1; j >= 0; j--) {
            if (task.turns[j].role === "assistant") { lastA = task.turns[j]; break; }
        }
        if (lastA) task.result = String(lastA.content || "");
        task.phase_at = Date.now();
        /* 收尾时清掉流式过程中的临时落盘，避免 pending 内容在刷新后重复显示 */
        try { delete task.pending; } catch (eP) { task.pending = null; }
    } else if (Number(task.step || 0) > Number(task.max_steps || 0) && Number(task.max_steps || 0) > 0) {
        /* 超步数：与 advanceTask 一致置 failed，别让任务无限跑下去。
           判 > 而不是 >= ：面板第 max_steps 步跑完仍允许收尾，只有真超出才终止。 */
        task.status = "failed";
        task.error = "超出步数上限 " + task.max_steps;
    }
    await TASK.saveTask(task);
    /* 完成/失败都要进收件箱，否则面板用户永远看不到结论 */
    if (params.done === true || task.status === "failed") {
        try { await notifyDone(task); } catch (eN) {}
    }
    complete({ success: true, message: "已保存", data: { count: list.length, status: task.status, step: task.step, usage: task.usage } });
};

/* 流式增量落盘：面板流式过程中每几秒调一次。
   【为什么必须有】原来流式全程只在页面内存里跑（thinkBuf/bodyBuf 是闭包变量），
   退出面板 = 页面销毁 = 内容全丢；而且从不把 task.status 写成 running，
   退出再进来后端还是 queued，面板显示「待开始」，用户只能重新点启动 ——
   重跑的内容又叠在旧的上面，越滚越大（实测出现过 35KB 的重复内容）。
   这个工具做两件事：
     1) 把 status 置 running（面板再进来时能正确判断「正在跑」）
     2) 把当前已生成的内容写进 task.pending（不追加 turns，避免重复）
   收尾时由 subagent_save_turn 用 done=true 落正式 turn 并清掉 pending。 */
exports.subagent_stream_flush = async function (params) {
    params = params || {};
    var task = await TASK.loadTask(String(params.id || ""));
    if (!task) { complete({ success: false, message: "找不到任务", data: {} }); return; }
    /* 已经是终态就别再翻回 running，避免用户点了停止又被拉起来 */
    var st = String(task.status || "");
    if (st === "done" || st === "failed" || st === "cancelled" || st === "closed") {
        complete({ success: true, message: "终态，忽略", data: { status: st, ignored: true } });
        return;
    }
    task.status = "running";
    task.phase = "llm";
    task.phase_at = Date.now();
    task.pending = {
        think: String(params.think || ""),
        body: String(params.body || ""),
        at: Date.now()
    };
    await TASK.saveTask(task);
    complete({ success: true, message: "已落盘", data: { status: task.status, chars: (task.pending.think || "").length + (task.pending.body || "").length } });
};

/* 单个工具执行：流式循环在页面里跑，但工具必须由后端执行（页面没有文件/shell 能力）。
   白名单、写入范围、undo 备份全部复用同一套 sb_tools 逻辑，不另开旁路。 */
exports.subagent_tool_once = async function (params) {
    params = params || {};
    var tool = String(params.tool || "").trim();
    if (!tool) { complete({ success: false, message: "缺少 tool", data: { ok: false, error: "缺少 tool" } }); return; }
    var taskId = String(params.id || "");
    var cfg = await CFG.load();
    var task = taskId ? await TASK.loadTask(taskId) : null;
    var args = (params.args && typeof params.args === "object") ? params.args : {};
    var allowed = (task && task.allowed_tools && task.allowed_tools.length)
        ? task.allowed_tools
        : [];
    /* 注意（2026-11-07 定调）：allowed_tools 留空 = 一个工具都用不了，
       不再 fallback 到 default_allowed_tools。否则面板路径与 advanceTask 路径
       对同一条规矩给出相反结果（一个能跑 5 个只读工具，一个全拒）。
       要全放开请建任务时传 all=true。 */
    var roots = [];
    if (task) {
        if (task.workspace_resolved) roots.push(task.workspace_resolved);
        if (task.product_dir) roots.push(task.product_dir);
    }
    var undo = task ? await TASK.loadUndo(task.id) : { items: [], seq: 0 };
    var seq = Number(undo.seq || 0);
    var ctx = {
        allowed: allowed,
        workspace: (task && task.workspace_resolved) || "",
        productDir: (task && task.product_dir) || "",
        maxChars: Number(cfg.tool_result_max_chars || 0),
        allowDanger: (task && task.allow_danger === true) || cfg.allow_danger === true,
        tool_timeout_ms: Number((task && task.tool_timeout_ms) || cfg.tool_timeout_ms || 0),
        roots: roots.filter(Boolean),
        nextSeq: function () { seq = seq + 1; return seq; },
        loadUndo: function () { return undo.items || []; },
        appendUndo: function (recs) { undo.items = (undo.items || []).concat(recs || []); undo.seq = seq; },
        clearUndo: function () { undo.items = []; undo.seq = seq; }
    };
    var out = await TOOLS.runOne(ctx, { tool: tool, args: args });
    /* 写类工具跑完立刻存 undo，保证可撤回 */
    if (task && TOOLS.isWriteTool(tool)) {
        try { await TASK.saveUndo(task.id, undo); } catch (e) {}
    }
    complete({
        success: true,
        message: out.ok ? "ok" : "工具失败",
        data: {
            ok: !!out.ok,
            tool: tool,
            result: String(out.result || ""),
            error: String(out.error || ""),
            chars: Number(out.chars || 0),
            ms: Number(out.ms || 0),
            truncated: !!out.truncated
        }
    });
};

/* ── 流式直连支撑 ──
   架构：模型请求由页面 fetch 直连端点拿真 SSE；宿主工具仍走后端。
   这里只负责把「直连要用的参数」交给页面，以及暴露工具 schema。
   密钥单独用一个工具取，避免它跟着 ctx 一起出现在日志/对话里。 */
exports.subagent_stream_ctx = async function (params) {
    params = params || {};
    var cfg = await CFG.load();
    var task = params.id ? await TASK.loadTask(String(params.id)) : null;
    var profile = LLM.resolveProfile(cfg, (task && task.profile_override) || {});
    var allowed = (task && task.allowed_tools && task.allowed_tools.length)
        ? task.allowed_tools
        : [];
    /* 留空 = 一个工具都用不了（2026-11-07 定调，见 subagent_spawn 注释） */
    var level = (task && task.thinking_level) || cfg.thinking_level || "medium";
    var protocol = String(profile.protocol || "chat");
    complete({
        success: true,
        message: "直连参数就绪",
        data: {
            endpoint: LLM.joinUrl(profile.base_url, "/chat/completions"),
            model: String(profile.model || ""),
            protocol: protocol,
            /* 只带非认证类请求头：Authorization 由页面用 key 自己拼，不走这里 */
            headers: (function () {
                var h = { "Content-Type": "application/json" };
                var ex = profile.custom_headers || {};
                for (var k in ex) {
                    if (!Object.prototype.hasOwnProperty.call(ex, k)) continue;
                    if (/^authorization$/i.test(k)) continue;
                    h[k] = String(ex[k]);
                }
                return h;
            })(),
            key_env: String(profile.api_key_env || "SUBAGENT_API_KEY"),
            thinking: LLM.thinkingFields(cfg, level),
            extra_body: profile.extra_body || {},
            tool_schema: LLM.runToolSchema(allowed),
            allowed_tools: allowed,
            stream_supported: protocol === "chat"
        }
    });
};

/* 密钥按需下发：只有本机面板能拿到，且只落在页面内存里 */
exports.subagent_stream_key = async function () {
    var cfg = await CFG.load();
    var profile = LLM.resolveProfile(cfg, {});
    var envName = String(profile.api_key_env || "SUBAGENT_API_KEY");
    var key = "";
    try { key = String(CFG.getEnvValue(envName) || ""); } catch (e) { key = ""; }
    if (!key) { complete({ success: false, message: "未配置密钥", data: { key: "" } }); return; }
    complete({ success: true, message: "ok", data: { key: key, env: envName } });
};

/* ── 后端中继：给 http:// 局域网端点用的流式通道 ──
   为什么需要它：面板页面 origin 固定 https://localhost，浏览器按 mixed content 规则
   禁止页面向 http:// 发请求，请求连发都发不出去，改前端代码绕不过。
   但后端 Tools.Net.http 走的是原生 HTTP 栈，没有这个限制——实测能连局域网并拿到
   text/event-stream。所以在后端把整包 SSE 取回来、解析成 chunk 数组交给页面回放。
   代价：首字延迟 = 整包时间（不是真逐字）；换来的是局域网端点也能有接近流式的观感，
   而不是像以前那样直接报错或退化成一坨。
   页面侧按 endpoint 协议自动选路：https 走前端直连，http 走这里。 */
exports.subagent_stream_relay = async function (params) {
    params = params || {};
    var cfg = await CFG.load();
    var task = params.id ? await TASK.loadTask(String(params.id)) : null;
    var profile = LLM.resolveProfile(cfg, (task && task.profile_override) || {});
    var url = LLM.joinUrl(profile.base_url, "/chat/completions");
    var envName = String(profile.api_key_env || "SUBAGENT_API_KEY");
    var key = "";
    try { key = String(CFG.getEnvValue(envName) || ""); } catch (e) { key = ""; }
    if (!key) { complete({ success: false, message: "未配置密钥", data: { content: "", reasoning: "", chunks: [], toolCalls: [] } }); return; }

    /* 请求头：页面传了 body 就用页面的，没传就按配置现拼一份 */
    var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + key };
    var ex = profile.custom_headers || {};
    for (var hk in ex) {
        if (!Object.prototype.hasOwnProperty.call(ex, hk)) continue;
        if (/^authorization$/i.test(hk)) continue;
        headers[hk] = String(ex[hk]);
    }
    var body = (params.body && typeof params.body === "object") ? params.body : null;
    if (!body) {
        var allowed = (task && task.allowed_tools && task.allowed_tools.length)
            ? task.allowed_tools
            : [];
        /* 留空 = 一个工具都用不了（2026-11-07 定调，见 subagent_spawn 注释） */
        var level = (task && task.thinking_level) || cfg.thinking_level || "medium";
        body = {
            model: String(profile.model || ""),
            messages: [],
            stream: true,
            stream_options: { include_usage: true }
        };
        var sch = LLM.runToolSchema(allowed);
        if (sch && sch.length) { body.tools = sch; body.tool_choice = "auto"; }
        var th = LLM.thinkingFields(cfg, level);
        for (var tk in (th || {})) if (Object.prototype.hasOwnProperty.call(th, tk)) body[tk] = th[tk];
        var eb = profile.extra_body || {};
        for (var ek in eb) if (Object.prototype.hasOwnProperty.call(eb, ek)) body[ek] = eb[ek];
    }

    var raw = "";
    try {
        var res = await Tools.Net.http({
            url: url,
            method: "POST",
            headers: headers,
            body: JSON.stringify(body),
            /* 超时必须显式给：不给的话端点连上却不发数据、也不关连接时，
               后端线程会永久挂着（桥 20s 就断了，但后端不释放）。
               与 sb_llm.postJsonOnce 保持一致。 */
            connect_timeout: 15000,
            read_timeout: Math.max(30000, Number((task && task.timeout_ms) || 90000) + 30000),
            responseType: "text",
            validateStatus: true
        });
        var sc = Number((res && res.statusCode) || 0);
        raw = String((res && (res.body != null ? res.body : res.content)) || "");
        if (sc && (sc < 200 || sc >= 300)) {
            complete({ success: false, message: "HTTP " + sc + "：" + raw.slice(0, 300), data: { content: "", reasoning: "", chunks: [], toolCalls: [] } });
            return;
        }
    } catch (e) {
        complete({ success: false, message: "中继请求失败：" + String((e && e.message) || e), data: { content: "", reasoning: "", chunks: [], toolCalls: [] } });
        return;
    }

    /* 解析 SSE：同时产出「累积结果」和「逐块数组」。
       逐块数组是给页面回放用的，累积结果是给页面收尾落盘用的，两者必须一致。 */
    var acc = { content: "", reasoning: "", byIdx: {}, finishReason: "", usage: {} };
    var chunks = [];
    var lines = raw.split("\n");
    for (var i = 0; i < lines.length; i++) {
        var ln = String(lines[i] || "").replace(/\r$/, "");
        if (!ln || ln.charAt(0) === ":") continue;
        if (ln.indexOf("data:") !== 0) continue;
        var payload = ln.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        var j = null;
        try { j = JSON.parse(payload); } catch (eJ) { continue; }
        if (j.usage) acc.usage = j.usage;
        var ch = (j.choices && j.choices[0]) || null;
        if (!ch) continue;
        var d = ch.delta || {};
        var c = String(d.content || "");
        var r = String(d.reasoning_content || d.reasoning || "");
        if (c) acc.content += c;
        if (r) acc.reasoning += r;
        /* 工具调用分片下发，按 index 累积 name 与 arguments 字符串 */
        var dtc = d.tool_calls || [];
        for (var t = 0; t < dtc.length; t++) {
            var one = dtc[t] || {};
            var ix = Number(one.index == null ? 0 : one.index);
            if (!acc.byIdx[ix]) acc.byIdx[ix] = { id: "", name: "", argsText: "" };
            var slot = acc.byIdx[ix];
            if (one.id) slot.id = String(one.id);
            var fn = one.function || {};
            if (fn.name) slot.name += String(fn.name);
            if (fn.arguments) slot.argsText += String(fn.arguments);
        }
        if (ch.finish_reason) acc.finishReason = String(ch.finish_reason);
        if (c || r) chunks.push({ content: c, reasoning: r });
    }
    /* 响应不是 SSE（有的端点即便 stream:true 也回整包 JSON）：按普通回复解一次 */
    if (!chunks.length && !acc.content && !acc.reasoning) {
        try {
            var jo = JSON.parse(raw);
            var m = (jo.choices && jo.choices[0] && jo.choices[0].message) || {};
            acc.content = String(m.content || "");
            acc.reasoning = String(m.reasoning_content || m.reasoning || "");
            if (jo.usage) acc.usage = jo.usage;
            var tcs0 = m.tool_calls || [];
            for (var q = 0; q < tcs0.length; q++) {
                var tc = tcs0[q] || {}, fn2 = tc.function || {};
                acc.byIdx[q] = { id: String(tc.id || ("call_" + q)), name: String(fn2.name || ""), argsText: String(fn2.arguments || "{}") };
            }
            if (acc.content || acc.reasoning) chunks.push({ content: acc.content, reasoning: acc.reasoning });
        } catch (eJ2) {
            complete({ success: false, message: "中继响应既不是 SSE 也不是 JSON", data: { content: "", reasoning: "", chunks: [], toolCalls: [] } });
            return;
        }
    }
    var toolCalls = [];
    for (var key0 in acc.byIdx) {
        if (!Object.prototype.hasOwnProperty.call(acc.byIdx, key0)) continue;
        var s0 = acc.byIdx[key0];
        var args = {};
        try { args = JSON.parse(s0.argsText || "{}"); } catch (eA) { args = { __unparsed: s0.argsText }; }
        toolCalls.push({ id: s0.id || ("call_" + key0), name: s0.name, args: args });
    }
    complete({
        success: true,
        message: "中继完成（" + chunks.length + " 块）",
        data: {
            content: acc.content,
            reasoning: acc.reasoning,
            toolCalls: toolCalls,
            finishReason: acc.finishReason || (toolCalls.length ? "tool_calls" : "stop"),
            usage: acc.usage,
            chunks: chunks,
            relayed: true
        }
    });
};
/* 列出对话：面板要让用户自己选「附带哪个对话的上下文」，
   不能默认拿最近更新的那条——用户可能同时开了好几个对话。 */
exports.subagent_chats = async function (params) {
    var lim = Number(params && params.limit) || 30;
    if (lim < 1) lim = 30;
    if (lim > 100) lim = 100;
    var q = String((params && params.query) || "").trim().toLowerCase();
    var out = [], cur = "";
    try {
        /* 宿主对 listChats 会校验 query 必填（虽然 d.ts 标可选），
           这里优先用 listAll()——它不需要任何参数，也不会因缺 query 抛错。
           注意：listAll 恒返回 chats 数组（可能为空），不能用「空」判断失败。 */
        var r = null;
        try {
            if (Tools.Chat && typeof Tools.Chat.listAll === "function") r = await Tools.Chat.listAll();
        } catch (e0) { r = null; }
        if (!r) {
            /* listAll 不可用时才用 listChats，且必须带上 query 满足宿主校验 */
            r = await Tools.Chat.listChats({ query: "", match: "contains", sort_by: "updatedAt", sort_order: "desc", limit: lim });
        }
        cur = String((r && r.currentChatId) || "");
        var arr = (r && (r.chats || r.items || r.data)) || [];
        /* 按更新时间倒序 + 截断到 lim（listAll 不分页） */
        arr = arr.slice();
        arr.sort(function (a, b) {
            var ta = String((a && (a.updatedAt || a.updated_at || a.lastMessageTime)) || "");
            var tb = String((b && (b.updatedAt || b.updated_at || b.lastMessageTime)) || "");
            return tb < ta ? -1 : (tb > ta ? 1 : 0);
        });
        if (arr.length > lim) arr = arr.slice(0, lim);
        for (var i = 0; i < arr.length; i++) {
            var c = arr[i] || {};
            var id = String(c.id || c.chatId || "");
            if (!id) continue;
            var title = String(c.title || c.name || "").trim() || "未命名对话";
            if (q && title.toLowerCase().indexOf(q) < 0) continue;
            out.push({
                id: id,
                title: title,
                updated: String(c.updatedAt || c.updated_at || c.lastMessageTime || ""),
                messages: Number(c.messageCount || c.messages || 0) || 0,
                current: id === cur
            });
        }
    } catch (e) {
        complete({ success: false, message: "读取对话列表失败：" + String((e && e.message) || e), data: { chats: [] } });
        return;
    }
    complete({
        success: true,
        message: "共 " + out.length + " 个对话",
        data: { chats: out, current: cur, total: out.length }
    });
};

exports.subagent_tools = async function () {
    var builtin = [
        { name: "read_file", label: "读文件", write: false },
        { name: "read_file_part", label: "按行读文件", write: false },
        { name: "list_files", label: "列目录", write: false },
        { name: "file_info", label: "文件信息", write: false },
        { name: "file_exists", label: "文件是否存在", write: false },
        { name: "file_grep", label: "文件内容搜索", write: false },
        { name: "find_files", label: "按名找文件", write: false },
        { name: "create_file", label: "新建文件", write: true },
        { name: "edit_file", label: "编辑文件", write: true },
        { name: "delete_file", label: "删除文件", write: true },
        { name: "move_file", label: "移动文件", write: true },
        { name: "copy_file", label: "复制文件", write: true }
    ];
    var packs = [];
    var disabledCount = 0;
    try {
        var r = await Tools.SoftwareSettings.listSandboxPackages();
        var arr = (r && r.packages) ? r.packages : [];
        for (var i = 0; i < arr.length; i++) {
            var pk = arr[i] || {};
            if (pk.isBuiltIn === true) continue;
            if (String(pk.packageName || "").indexOf("subagent") >= 0) continue;
            if (pk.enabled !== true) { disabledCount++; continue; }
            var nm = String(pk.packageName || "");
            if (!nm) continue;
            packs.push({ name: nm, display: String(pk.displayName || nm), tools: Number(pk.toolCount || 0), pattern: nm + ":*" });
        }
    } catch (e) {}
    complete({ success: true, message: "内置 " + builtin.length + " 项，已启用包 " + packs.length + " 个（另有 " + disabledCount + " 个包未启用）", data: { builtin: builtin, packages: packs, disabled_count: disabledCount } });
};

exports.subagent_list_dir = async function (params) {
    params = params || {};
    var p = String(params.path == null ? "/sdcard" : params.path).trim() || "/sdcard";
    /* 注意：正则里不要直接写斜杠加星号那两个字，会被当成块注释开始，整个文件解析失败。
       改成字符类规避。 */
    if (p.charAt(0) !== "/") p = "/" + p.replace(/^\.+[/]*/, "");
    var r = null, errText = "";
    try { r = await Tools.Files.list(p, "android"); } catch (e) { errText = (e && e.message) ? e.message : String(e); }
    if (!r || !r.entries) { complete({ success: false, message: "列目录失败：" + (errText || "接口无返回"), data: { path: p } }); return; }
    var dirs = [], files = [];
    var totalSize = 0;
    for (var i = 0; i < r.entries.length; i++) {
        var e2 = r.entries[i];
        if (!e2) continue;
        var nm = String(e2.name || "");
        if (!nm) continue;
        if (e2.isDirectory) { dirs.push(nm); }
        else {
            var sz = Number(e2.size || 0);
            totalSize += sz;
            files.push({ name: nm, size: sz });
        }
    }
    dirs.sort();
    files.sort(function (a, b) { return b.size - a.size; });
    var norm = p.replace(/\/+$/, "") || "/";
    var idx = norm.lastIndexOf("/");
    var parent = idx > 0 ? norm.slice(0, idx) : "/";
    complete({
        success: true,
        message: dirs.length + " 个目录，" + files.length + " 个文件",
        data: { path: norm, parent: parent, dirs: dirs, files: files, file_count: files.length, total_size: totalSize }
    });
};
exports.subagent_workspace = async function (params) {
    params = params || {};
    var cfg = await CFG.load();
    var action = String(params.action || "info");
    /* 【第六十六轮】用户定为 B 方案：default_workspace 不再参与任何决策。
       这里固定用 CFG.workspaceDir()（= ROOT_DIR/workspace，即 subagent/workspace），
       老配置里指向旧 plugins 目录的值不再被读、也不再被写。
       为什么保留 action=init 还会 save：为了把老配置里那个脏值就地洗掉，
       洗成新路径后即便以后又有代码读它，也是对的。 */
    var defWs = CFG.workspaceDir();
    if (action === "init") {
        try { await Tools.Files.mkdir(defWs, true, "android"); } catch (e) {}
        var patch = { default_workspace: defWs };
        cfg.default_workspace = defWs;
        await CFG.save(cfg);
        complete({ success: true, message: "私有工作区已就绪：" + defWs, data: { workspace: defWs } });
        return;
    }

    /* info：列出工作区文件树与体积，供主/子代理找废弃文件 */
    var p = String(params.path || defWs);
    var depth = Math.max(1, Math.min(4, Number(params.depth || 2)));
    var maxFiles = Math.max(10, Math.min(400, Number(params.max_files || 120)));
    var out = [], total = 0, count = 0, over = false;

    async function walk(dir, level, prefix) {
        if (over || level > depth) return;
        var r = null;
        try { r = await Tools.Files.list(dir, "android"); } catch (e) { return; }
        var arr = (r && r.entries) ? r.entries : [];
        arr.sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
        for (var i = 0; i < arr.length; i++) {
            var e = arr[i] || {};
            var nm = String(e.name || "");
            if (!nm) continue;
            var full = (dir.replace(/\/+$/, "")) + "/" + nm;
            if (e.isDirectory) {
                if (count < maxFiles) { out.push({ type: "dir", path: full, name: nm, size: 0, depth: level }); count++; }
                await walk(full, level + 1, prefix);
            } else {
                var sz = Number(e.size || 0);
                total += sz;
                if (count >= maxFiles) { over = true; }
                else { out.push({ type: "file", path: full, name: nm, size: sz, depth: level }); count++; }
            }
        }
    }
    await walk(p, 1, "");
    out.sort(function (a, b) { return (b.size || 0) - (a.size || 0); });
    complete({
        success: true,
        message: count + " 项，共 " + (total / 1024).toFixed(1) + " KB" + (over ? "（已截断）" : ""),
        data: {
            workspace: defWs, path: p, items: out, count: count,
            total_size: total, truncated: over,
            hint: over ? "内容较多，缩小 depth 或指定子目录再看" : "按体积降序，最大的在最前面，便于挑废弃文件清理"
        }
    });
};
exports.subagent_check_path = async function (params) {
    params = params || {};
    var p = String(params.path == null ? "" : params.path).trim();
    if (!p) { complete({ success: false, message: "缺少 path", data: {} }); return; }
    var r = null;
    try { r = await Tools.Files.exists(p); } catch (e) { r = null; }
    var norm = p.replace(/\/+$/, "");
    var slash = norm.lastIndexOf("/");
    var dirGuess = (r && r.isDirectory) ? norm : (slash > 0 ? norm.slice(0, slash) : norm);
    var dot = norm.lastIndexOf(".");
    var ext = (dot > slash) ? norm.slice(dot).toLowerCase() : "";
    complete({
        success: true,
        message: !r ? "无法检查（文件接口不可用）" : (r.exists ? (r.isDirectory ? "目录存在" : "文件存在") : "路径不存在"),
        data: {
            path: p, checked: !!r, exists: !!(r && r.exists), is_directory: !!(r && r.isDirectory),
            size: (r && r.size) || 0, ext: ext, workspace_guess: dirGuess
        }
    });
};
/* 外接资源读取（2026-11-05 第七轮）：用户把 katex.min.js 等放进数据目录 vendor/，
   面板启动时经桥读取并注入 window.katex —— 不进包体、不打 CDN、离线可用。
   安全面：只允许 vendor/ 下、js/css 扩展名、文件名白名单字符，防路径逃逸。 */
exports.subagent_vendor_js = async function (params) {
    params = params || {};
    var name = String(params.name || "").trim();
    if (!/^[A-Za-z0-9._-]+$/.test(name) || !/\.(js|css)$/.test(name)) {
        complete({ success: false, message: "文件名只允许字母数字点横杠下划线，且必须是 js/css", data: {} });
        return;
    }
    var path = CFG.baseDir() + "/vendor/" + name;
    try {
        var r = await Tools.Files.read(path, "android");
        /* Tools.Files.read 返回对象（实测）：{ content, path, size, env }——content 才是正文。
           兼容字符串直返与 text 字段，与 sb_task/sb_config 同一模式。 */
        var text = "";
        if (typeof r === "string") text = r;
        else if (r && typeof r === "object") text = String(r.content != null ? r.content : (r.text != null ? r.text : ""));
        if (!text) { complete({ success: false, message: "文件为空：" + path, data: {} }); return; }
        complete({ success: true, message: "已读取 " + name + "（" + text.length + " 字符）", data: { name: name, text: text } });
    } catch (e) {
        complete({ success: false, message: "读取失败（可把 katex.min.js 放到 " + CFG.baseDir() + "/vendor/ 后重试）：" + String(e && e.message || e), data: {} });
    }
};
/* skill 支持（第六十五轮）：用户要求「让子代理也能读主 agent 的 skill，或者给独立 skill」。
   两条路都做：
     1) /sdcard/Download/Operit/subagent/skills —— 子代理独立目录，优先
     2) /sdcard/Download/Operit/skills           —— 主 agent 共享，只读
   同名时独立目录覆盖主目录，这样想给某个 skill 加子代理专属说明，不用动主目录。
   为什么要这个工具而不是塞进系统提示词：单个 SKILL.md 几千到几万字，
   全部塞进去几十万字符直接拉爆上下文。提示词里只给 name + description，
   模型判断要用哪个，再调这个工具取全文。 */
exports.subagent_skill = async function (params) {
    params = params || {};
    var action = String(params.action || "list").trim().toLowerCase();
    if (action === "read") {
        var r = await SKILL.readSkill(String(params.name || ""));
        if (!r.ok) { complete({ success: false, message: r.error, data: {} }); return; }
        complete({
            success: true,
            message: "已读取 skill " + r.name + "（" + r.chars + " 字符" + (r.truncated ? "，已截断到 " + r.text.length : "") + "）",
            data: {
                name: r.name, dir: r.dir,
                chars: r.chars, truncated: r.truncated,
                text: r.text
            }
        });
        return;
    }
    /* 默认 list */
    var all = [];
    try { all = await SKILL.listSkills(); } catch (e) { all = []; }
    var items = [];
    for (var i = 0; i < all.length; i++) {
        items.push({ name: all[i].name, description: all[i].description, dir: all[i].dir });
    }
    complete({
        success: true,
        message: "共 " + items.length + " 个 skill（扫 " + SKILL.SKILL_ROOTS.join(" 与 ") + "）",
        data: { items: items, total: items.length, roots: SKILL.SKILL_ROOTS }
    });
};
exports.subagent_version = async function () {
    /* tools 计数必须动态算，不能写死。
       曾经写死 21，工具涨到 29 后返回值仍说 21，装机验证时被这个假数字误导。 */
    var n = 0;
    for (var k in exports) {
        if (Object.prototype.hasOwnProperty.call(exports, k) && /^subagent_/.test(k)) n++;
    }
    complete({ success: true, message: VERSION, data: { version: VERSION, base_dir: CFG.baseDir(), temp_root: TASK.tempRoot(), tools: n } });
};

/* ── 自更新（第三十轮，仿 on_air）──
   为什么走工具而不是只在面板里做：面板可以调工具，主代理也能调，
   这样「派个任务让子代理自己更新」也可行。 */
var UPD = require("./sb_update.js");

exports.subagent_check_update = async function (params) {
    params = params || {};
    var r = await UPD.checkUpdate({ force: !!params.force });
    if (!r.ok) {
        complete({ success: false, message: r.msg, data: { error: r.msg } });
        return;
    }
    complete({ success: true, message: r.msg, data: r.data });
};

exports.subagent_download_update = async function (params) {
    params = params || {};
    var r = await UPD.downloadUpdate({ force: !!params.force });
    complete({ success: !!r.ok, message: r.msg, data: r.data || {} });
};

exports.subagent_download_status = async function () {
    var r = await UPD.downloadStatus();
    complete({ success: true, message: r.msg, data: r.data });
};

exports.subagent_install_update = async function (params) {
    params = params || {};
    var r = await UPD.installUpdate({ path: params.path });
    complete({ success: !!r.ok, message: r.msg, data: r.data || {} });
};
/* 反馈邮箱：WebView 不能直接跳 mailto:，走后端发 SENDTO intent */
exports.subagent_open_mail = async function (params) {
    params = params || {};
    var r = await UPD.openMail({ email: params.email, subject: params.subject, kind: params.kind, version: VERSION });
    complete({ success: !!r.ok, message: r.msg, data: r.data || {} });
};
/* 外链：同样不能 location.href，走后端 VIEW intent */
exports.subagent_open_url = async function (params) {
    params = params || {};
    var r = await UPD.openUrl({ url: params.url });
complete({ success: !!r.ok, message: r.msg, data: r.data || {} });
};

/* ─────────────────────────────────────────────────────────────
   【第七十九轮】大类 dispatch 层（37 → 16，用户定的 MC 指令风格）

   设计（plan 第七十九轮）：
   - 不重写函数体：旧 exports 函数是验证过的正确实现，新工具解析大类
     参数后调用旧函数（经内部包装，绕过 complete 的重复调用）。
   - 新旧并存：METADATA 只列 16 个新名（宿主按 METADATA 给模型暴露工具）；
     面板走 callTool 直接调旧名，不经 METADATA，不受影响。
   - 参数白名单：ctrl 等多 action 工具，传了不属于该 action 的参数
     必须明确报错（用户定过：不能静默忽略，否则模型以为生效了）。

   注意：这里复用旧函数的方式是「直接调用 exports 函数并拦截 complete」。
   complete 是宿主注入的全局，无法拦截 —— 因此旧函数需要可以无副作用地
   被调用，返回值经由 complete 输出。dispatch 层不能这样复用。
   替代方案：把旧函数体里 complete 前的「计算部分」没有抽出来过，
   所以 dispatch 层改为【转发参数 + 信任旧函数】不可行。
   最终方案：dispatch 层自带核心逻辑（ advance 循环 / get 分流 / ctrl 分流），
   直接调 TASK / BUS / TOOLS 等底层模块 —— 与旧函数同源但不经过旧 exports。
   旧 exports 保持原名不动（面板用）。
   ───────────────────────────────────────────────────────────── */
var ADV = require("./sb_task.js");
var CFGM = require("./sb_config.js");

/* 通用：参数白名单校验
   入：params 对象, 允许的参数名数组, action 名（用于报错文案）
   出：null = 通过；字符串 = 错误信息 */
function _wlCheck(params, allowed, actionName) {
    var extra = [];
    for (var k in params) {
        if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
        /* 【第八十一轮】路由参数统一放行：这些参数是用来「选分支」的，
           每个分支的白名单不必各自重复列，否则会出现
           「step="check" 被 update(check) 自己拦掉」这类自伤。
           id/action/target/what/step/wait/ids/dry_run 一律放行。 */
        if (k === "id" || k === "action" || k === "target" || k === "what"
            || k === "step" || k === "wait" || k === "ids" || k === "dry_run") continue;
        /* 【第七十九轮】宿主注入的内部键放行：每次工具调用 Operit 都会自动带上
           __operit_* 系列与 containerPackageName/toolPkgId 等，这些不是模型传的，
           不能拦。以 __operit_ 前缀或已知宿主键名识别。 */
        if (k.indexOf("__operit_") === 0) continue;
        if (k === "containerPackageName" || k === "toolPkgId") continue;
        if (allowed.indexOf(k) < 0) extra.push(k);
    }
    if (extra.length) {
        return "action=" + actionName + " 不接受参数：" + extra.join(", ")
            + "（该 action 只接受：" + allowed.join(", ") + "）。参数传错会被忽略造成误解，所以这里直接报错。";
    }
    return null;
}

/* ── run：推进任务（原 advance + wait 合并） ──
   id 必填。wait=false 推 max_steps 步（上限 3）；wait=true 在 budget 内推到终态。
   budget 缺省 30000、最大 60000（wait=true 时生效）。detail 控制进度摘要。 */
exports.subagent_run = async function (params) {
    params = params || {};
    var cfg = await CFG.load();
    var id = String(params.id || "");
    if (!id) { complete({ success: false, message: "缺少 id（先从 spawn 的返回里拿）", data: {} }); return; }
    var wait = params.wait === true;
    var detail = String(params.detail || "standard");
    if (!wait) {
        var wl = _wlCheck(params, ["steps", "detail", "max_steps"], "run(wait=false)");
        if (wl) { complete({ success: false, message: wl, data: {} }); return; }
        /* 复用旧 advance 逻辑：直接走 exports（它内部会 complete）——不可行，
           所以这里手动做一轮 advance 的等价物：调 TASK.advanceTask 后自己 complete。 */
        var task = await TASK.loadTask(id);
        if (!task) { complete({ success: false, message: "找不到任务 " + id, data: {} }); return; }
        var n = Math.max(1, Math.min(3, Number(params.max_steps || 1)));
        var last = null;
        for (var i = 0; i < n; i++) {
            last = await TASK.advanceTask(cfg, task);
            task = last.task || task;
            if (task.status === "done" || task.status === "failed" || task.status === "cancelled") break;
        }
        notifyDone(task);
        complete({
            success: !!last && !!last.ok,
            message: (last ? (last.message || "已推进") : "无变化") + inboxSuffix(),
            data: {
                task: briefOf(task),
                summary: TASK.buildSummary(task, detail === "brief" ? "t0" : (detail === "full" ? "t2" : "t1"), task.last),
                result: task.status === "done" ? TASK.buildResult(task, detail) : null
            }
        });
        return;
    }
    /* wait=true：循环推到终态或 budget 尽 */
    var wl2 = _wlCheck(params, ["budget", "detail"], "run(wait=true)");
    if (wl2) { complete({ success: false, message: wl2, data: {} }); return; }
    var budget = Math.min(Number(params.budget || 30000), Number((await CFG.load()).wait_max_ms || 60000));
    var deadline = Date.now() + budget;
    var taskW = await TASK.loadTask(id);
    if (!taskW) { complete({ success: false, message: "找不到任务 " + id, data: {} }); return; }
    var lastW = null, lastMsg = "", busyHits = 0;
    while (Date.now() < deadline) {
        var r = await TASK.advanceTask(cfg, taskW);
        notifyDone(r && r.task);
        if (r && r.busy) {
            busyHits++;
            if (busyHits > 60) { lastMsg = String(r.message || "任务持续被其他处推进"); break; }
            await new Promise(function (rr) { setTimeout(rr, 800); });
            continue;
        }
        lastW = r;
        lastMsg = String(r.message || lastMsg || "");
        taskW = r.task || taskW;
        if (taskW.status === "done" || taskW.status === "failed" || taskW.status === "cancelled") break;
        if (!r.ok) break;
    }
    var cur = (lastW && lastW.task) ? lastW.task : taskW;
    var stCur = String(cur.status || "");
    var unfinished = (stCur !== "done" && stCur !== "failed" && stCur !== "cancelled");
    var msgOut;
    if (stCur === "done") msgOut = "子代理完成（" + cur.step + " 步）";
    else if (unfinished) {
        msgOut = "任务还在跑（已 " + cur.step + "/" + cur.max_steps + " 步），未在预算内完成。"
            + "继续：subagent_run(id=\"" + cur.id + "\", wait=true)";
    } else msgOut = (cur.error || lastMsg || "任务未完成");
    complete({
        success: stCur === "done",
        message: msgOut + inboxSuffix(),
        data: {
            task: briefOf(cur),
            task_id: cur.id,
            unfinished: unfinished,
            next: unfinished ? "run" : null,
            summary: TASK.buildSummary(cur, detail === "brief" ? "t0" : (detail === "full" ? "t2" : "t1"), cur.last),
            result: stCur === "done" ? TASK.buildResult(cur, detail) : null
        }
    });
};

/* ── get：取产出（原 result + trace + status + list） ──
   不传 id/ids → 列全部任务概览（原 status 无 id / list）。
   传 id → detail 决定：brief/standard/full = 结论；trace = 逐步明细（limit 生效）。 */
exports.subagent_get = async function (params) {
    params = params || {};
    var ids = [];
    if (params.ids) ids = parseList(params.ids);
    if (!ids.length && params.id) ids = [String(params.id)];
    var detail = String(params.detail || "standard");
    /* 分支一：列全部 */
    if (!ids.length) {
        var wl0 = _wlCheck(params, [], "get(列表)");
        if (wl0) { complete({ success: false, message: wl0, data: {} }); return; }
        var all = await TASK.listTasks();
        var unreadN = 0;
        try { unreadN = BUS.list().length; } catch (eU) { unreadN = 0; }
        var items = [];
        for (var i = 0; i < all.length; i++) items.push(briefOf(all[i], unreadN));
        complete({ success: true, message: "共 " + items.length + " 个任务", data: { items: items, total: items.length } });
        return;
    }
    /* 分支二：trace */
    if (detail === "trace") {
        var wlT = _wlCheck(params, ["detail", "limit", "max_chars"], "get(detail=trace)");
        if (wlT) { complete({ success: false, message: wlT, data: {} }); return; }
        var t = await TASK.loadTask(ids[0]);
        if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        var lim = Math.max(1, Math.min(50, Number(params.limit || 10)));
        /* 【第七十九轮】clipText：旧 subagent_trace 有、合并后丢了。简单截断带省略号。 */
        function clipText(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; }
        var turns = (t.turns || []).slice(-lim * 3);
        var steps = [];
        for (var k = 0; k < turns.length; k++) {
            var m = turns[k] || {};
            if (m.role === "assistant") steps.push({ kind: "text", head: clipText(String(m.content || ""), 200) });
            else if (m.role === "tool") steps.push({ kind: "tool", tool: m.name, ok: !!m.ok, head: clipText(String(m.content || ""), 150) });
        }
        complete({ success: true, message: "最近 " + steps.length + " 条明细", data: { task: briefOf(t), steps: steps } });
        return;
    }
    /* 分支三：结论（单个或多个） */
    var wlR = _wlCheck(params, ["max_chars"], "get(结论)");
    if (wlR) { complete({ success: false, message: wlR, data: {} }); return; }
    var outs = [];
    var allDone = true;
    for (var j = 0; j < ids.length; j++) {
        var tid = ids[j];
        if (params.id) { try { BUS.remove(tid); } catch (eR) {} }
        var tt = await TASK.loadTask(tid);
        if (!tt) { outs.push({ id: tid, ok: false, error: "找不到任务" }); allDone = false; continue; }
        if (tt.status !== "done") allDone = false;
        var text = tt.status === "done" ? TASK.buildResult(tt, detail) : null;
        if (text && params.max_chars) text = clip(text, Number(params.max_chars));
        outs.push({ id: tt.id, ok: tt.status === "done", status: tt.status, steps: tt.step, usage: tt.usage, result: text, task: briefOf(tt) });
    }
    var merged = ids.length > 1 ? outs.map(function (o) { return "== " + o.id + " ==\n" + (o.result || "（未完成：" + o.status + "）"); }).join("\n\n") : null;
    complete({ success: true, message: allDone ? ("已取回 " + outs.length + " 个任务结论") : "有任务未完成（结果仍返回）", data: { all_done: allDone, items: outs, merged: merged } });
};

/* ── ctrl：改运行状态（原 cancel + resume + steer + close） ──
   action 四值，参数白名单严格校验。 */
exports.subagent_ctrl = async function (params) {
    params = params || {};
    var cfg = await CFG.load();
    var id = String(params.id || "");
    if (!id) { complete({ success: false, message: "缺少 id", data: {} }); return; }
    var action = String(params.action || "");
    var t = await TASK.loadTask(id);
    if (!t && action !== "resume") { complete({ success: false, message: "找不到任务 " + id, data: {} }); return; }
    if (action === "cancel") {
        var wlC = _wlCheck(params, [], "ctrl(cancel)");
        if (wlC) { complete({ success: false, message: wlC, data: {} }); return; }
        if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        t.cancel = true;
        await TASK.saveTask(t);
        complete({ success: true, message: "已请求停止（下一步生效）", data: { id: t.id, status: t.status, next: "run" } });
        return;
    }
    if (action === "resume") {
        var wlRs = _wlCheck(params, [], "ctrl(resume)");
        if (wlRs) { complete({ success: false, message: wlRs, data: {} }); return; }
        if (!t) { complete({ success: false, message: "找不到任务 " + id, data: {} }); return; }
        t.status = "queued"; t.cancel = false; t.error = null;
        await TASK.saveTask(t);
        complete({ success: true, message: "已恢复", data: { id: t.id, status: t.status, next: "run" } });
        return;
    }
    if (action === "steer") {
        var wlSt = _wlCheck(params, ["message"], "ctrl(steer)");
        if (wlSt) { complete({ success: false, message: wlSt, data: {} }); return; }
        if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        var r = await TASK.steerTask(cfg, t, String(params.message || ""));
        complete({ success: r.ok, message: r.message, data: { id: t.id, step: t.step, status: t.status, next: r.ok ? "run" : null } });
        return;
    }
    if (action === "close") {
        var wlCl = _wlCheck(params, ["confirm", "rollback", "drop_product"], "ctrl(close)");
        if (wlCl) { complete({ success: false, message: wlCl, data: {} }); return; }
        if (!t) { complete({ success: false, message: "找不到任务", data: {} }); return; }
        if (params.confirm !== true) {
            var undo0 = await TASK.loadUndo(t.id);
            complete({
                success: true,
                message: "未关闭：已返回当前进度。确认关闭传 confirm=true",
                data: { need_confirm: true, task: briefOf(t), undo_count: (undo0.items || []).length }
            });
            return;
        }
        var restored = null;
        if (params.rollback === true) {
            var ctx = await loadCtx(cfg, t);
            restored = await TOOLS.undoAll(ctx, false);
            if (ctx.save) await ctx.save();
        }
        if (params.drop_product === true) {
            try { await Tools.Files.deleteFile(t.product_dir, true, "android"); } catch (eD) {}
        }
        t.status = "closed";
        await TASK.saveTask(t);
        complete({ success: true, message: "已关闭" + (params.rollback === true ? "并回滚" : ""), data: { id: t.id, restored: restored } });
        return;
    }
    complete({ success: false, message: "action 只支持 cancel / resume / steer / close，收到：" + action, data: {} });
};

/* ── box：收件箱（原 inbox） ── */
exports.subagent_box = async function (params) {
    params = params || {};
    var wl = _wlCheck(params, ["action"], "box");
    if (wl) { complete({ success: false, message: wl, data: {} }); return; }
    return await exports.subagent_inbox(params);
};

/* ── undo：恢复写入（原 undo） ── */
exports.subagent_undo = exports.subagent_undo;  // 原名保留，语义未变
/* ── del：删任务（原 delete） —— dispatch 转发，逻辑在旧函数 ── */
exports.subagent_del = async function (params) {
    params = params || {};
    var wl = _wlCheck(params, ["confirm"], "del");
    if (wl) { complete({ success: false, message: wl, data: {} }); return; }
    return await exports.subagent_delete({ id: params.id, confirm: params.confirm });
};

/* ── update：更新（原 check_update + download_update + download_status + install_update） ── */
exports.subagent_update = async function (params) {
    params = params || {};
    var step = String(params.step || "check");
    /* 【第八十一轮】step 是路由参数，四个分支的白名单都必须放行它本身：
       原先把 step 当普通参数检查，导致用 step="check" 调用时
       直接报「update(check) 不接受参数：step」——路由参数把自己拦了。 */
    if (step === "check") {
        var wl1 = _wlCheck(params, ["step", "force"], "update(check)");
        if (wl1) { complete({ success: false, message: wl1, data: {} }); return; }
        return await exports.subagent_check_update({ force: params.force === true });
    }
    if (step === "download") {
        var wl2 = _wlCheck(params, ["step", "force"], "update(download)");
        if (wl2) { complete({ success: false, message: wl2, data: {} }); return; }
        return await exports.subagent_download_update({ force: params.force === true });
    }
    if (step === "status") {
        var wl3 = _wlCheck(params, ["step"], "update(status)");
        if (wl3) { complete({ success: false, message: wl3, data: {} }); return; }
        return await exports.subagent_download_status();
    }
    if (step === "install") {
        var wl4 = _wlCheck(params, ["step", "path"], "update(install)");
        if (wl4) { complete({ success: false, message: wl4, data: {} }); return; }
        return await exports.subagent_install_update({ path: params.path });
    }
    complete({ success: false, message: "step 只支持 check / download / status / install，收到：" + step, data: {} });
};

/* ── cfg：配置与模板（原 config + templates，target 消歧） ── */
exports.subagent_cfg = async function (params) {
    params = params || {};
    var target = String(params.target || "profile");
    if (target === "profile") {
        /* 旧 config 的 action 映射：add_profile/set_profile/set_active/del_profile/list_profiles 简写 */
        var a = String(params.action || "status");
        var map = { list: "list_profiles", add: "add_profile", use: "set_active", rm: "del_profile", models: "refresh_models", set: "set", key: "key", status: "status" };
        var oldA = map[a] || a;
        var valid = ["status", "set", "key", "refresh_models", "list_profiles", "add_profile", "set_profile", "set_active", "del_profile"];
        if (valid.indexOf(oldA) < 0) {
            complete({ success: false, message: "cfg(target=profile) action 只支持 " + valid.join("/") + "（或简写 list/add/use/rm/models），收到：" + a, data: {} });
            return;
        }
        var wlP = _wlCheck(params, ["payload", "api_key", "base", "force"], "cfg(profile)");
        if (wlP) { complete({ success: false, message: wlP, data: {} }); return; }
        return await exports.subagent_config({
            action: oldA,
            profile_id: params.name || "",
            payload: params.payload,
            api_key: params.api_key,
            base_url: params.base,
            force: params.force === true
        });
    }
    if (target === "template") {
        var ta = String(params.action || "list");
        if (["list", "add", "remove"].indexOf(ta) < 0) {
            complete({ success: false, message: "cfg(target=template) action 只支持 list/add/remove，收到：" + ta, data: {} });
            return;
        }
        var wlT = _wlCheck(params, ["payload"], "cfg(template)");
        if (wlT) { complete({ success: false, message: wlT, data: {} }); return; }
        return await exports.subagent_templates({ action: ta, payload: params.payload, id: params.name || "" });
    }
    complete({ success: false, message: "target 只支持 profile / template，收到：" + target, data: {} });
};

/* ── env：环境探测（原 probe + version + chats + tools + workspace + list_dir + check_path） ── */
exports.subagent_env = async function (params) {
    params = params || {};
    var what = String(params.what || "version");
    if (what === "probe") {
        var wl1 = _wlCheck(params, ["deep", "model", "base"], "env(probe)");
        if (wl1) { complete({ success: false, message: wl1, data: {} }); return; }
        return await exports.subagent_probe({ deep: params.deep !== false, model: params.model, base_url: params.base });
    }
    if (what === "version") {
        var wl2 = _wlCheck(params, [], "env(version)");
        if (wl2) { complete({ success: false, message: wl2, data: {} }); return; }
        return await exports.subagent_version();
    }
    if (what === "chats") {
        var wl3 = _wlCheck(params, ["limit", "query"], "env(chats)");
        if (wl3) { complete({ success: false, message: wl3, data: {} }); return; }
        return await exports.subagent_chats({ limit: params.limit, query: params.query });
    }
    if (what === "tools") {
        var wl4 = _wlCheck(params, [], "env(tools)");
        if (wl4) { complete({ success: false, message: wl4, data: {} }); return; }
        return await exports.subagent_tools();
    }
    if (what === "workspace") {
        var wl5 = _wlCheck(params, ["action", "path", "depth", "max_files"], "env(workspace)");
        if (wl5) { complete({ success: false, message: wl5, data: {} }); return; }
        return await exports.subagent_workspace({ action: params.action || "info", path: params.path, depth: params.depth, max_files: params.max_files });
    }
    if (what === "dir") {
        var wl6 = _wlCheck(params, ["path"], "env(dir)");
        if (wl6) { complete({ success: false, message: wl6, data: {} }); return; }
        if (!params.path) { complete({ success: false, message: "env(what=dir) 需要 path", data: {} }); return; }
        return await exports.subagent_list_dir({ path: params.path });
    }
    if (what === "path") {
        var wl7 = _wlCheck(params, ["path"], "env(path)");
        if (wl7) { complete({ success: false, message: wl7, data: {} }); return; }
        if (!params.path) { complete({ success: false, message: "env(what=path) 需要 path", data: {} }); return; }
        return await exports.subagent_check_path({ path: params.path });
    }
    complete({ success: false, message: "what 只支持 probe / version / chats / tools / workspace / dir / path，收到：" + what, data: {} });
};
