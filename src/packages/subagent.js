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
          "description": "允许的工具，逗号分隔。留空=一个都没有；* = 放开全部；包工具写 包名:工具名。支持子命令级白名单：super_admin:terminal(ls,cat,cd) 只允许这几个命令，其它命令在本地直接拒、不调桥；不写括号=整条放开。支持前缀通配 ls*。",
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
          "description": "已有群组码：把本任务挂到这个群组下（需要 CREATE 权限）。不传则无群组",
          "required": false
        },
        {
          "name": "group_create",
          "type": "string",
          "description": "非必要。填群组名则新建群组并把本任务挂进去，返回时会给出群组码；不填照常建任务",
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
        },
        {
          "name": "all",
          "type": "boolean",
          "description": "true=不过滤，列全部任务（面板用）",
          "required": false
        },
        {
          "name": "group",
          "type": "string",
          "description": "群组码=只看该群组任务；\"list\"=列出我有权访问的群组",
          "required": false
        }
      ]
    },
    {
      "name": "subagent_wait",
      "description": {
        "zh": "等任务跑完再返回。指定 id/ids 等特定任务，或 all=true 等全部（任一返回就返回那个）。带 timeout_ms 上限与 need 凑数。",
        "en": "Wait until tasks finish, then return. Target specific ids or all=true (returns whichever finishes first). Supports timeout_ms and need."
      },
      "parameters": [
        { "name": "id", "type": "string", "description": "要等的任务 id（单个）", "required": false },
        { "name": "ids", "type": "string", "description": "要等的任务 id，逗号分隔多个", "required": false },
        { "name": "all", "type": "boolean", "description": "true=等全部任务，任一跑完就返回那一个", "required": false },
        { "name": "timeout_ms", "type": "integer", "description": "最长等待毫秒，默认 300000（5 分钟），最短 3000", "required": false },
        { "name": "need", "type": "integer", "description": "要凑够几个任务结束才返回，默认 1", "required": false },
        { "name": "detail", "type": "string", "description": "返回详细度 brief/standard/full，默认 standard", "required": false },
        { "name": "max_chars", "type": "integer", "description": "结论截断长度", "required": false }
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
      "name": "subagent_group",
      "description": "群组与权限管理：list=列我有权访问的群组 / info=看群组详情与成员权限 / kick=剔除成员（进黑名单，再输码也进不来）/ unkick=解禁 / perm=改某人权限位 / admit=邀请成员 / delete=删除群组（仅创始人，不可恢复，组内任务退回未归属）/ migrate=迁移老任务目录结构。权限位 READ=1 WRITE=2 CREATE=4 DELETE=8 KICK=16，创始人 31、受邀 3、路人 1。管理动作需要 KICK 位。",
      "parameters": [
        {
          "name": "action",
          "type": "string",
          "description": "list/info/kick/unkick/perm/admit/delete/migrate",
          "required": true
        },
        {
          "name": "code",
          "type": "string",
          "description": "群组码（6 位数字）；list 时可省",
          "required": false
        },
        {
          "name": "chat_id",
          "type": "string",
          "description": "目标对话 id（kick/unkick/perm/admit 必填）",
          "required": false
        },
        {
          "name": "mask",
          "type": "number",
          "description": "权限位数字：READ=1 WRITE=2 CREATE=4 DELETE=8 KICK=16，可相加",
          "required": false
        }
      ],
      "required": [
        "action"
      ]
    },
    {
      "name": "subagent_root",
      "description": "ROOT 权限窗口：给某个对话开一个限时的全量权限。action=open 开窗并返回 16 位识别码；close 提前收回；check 查状态；list 列所有窗口。ROOT 拥有全部权限位（63）：越权读写一切、跨群组可见、跳过写边界。有效期最长 1440 分钟，到期自动失效。",
      "parameters": [
        {
          "name": "action",
          "type": "string",
          "description": "open/close/check/list",
          "required": true
        },
        {
          "name": "chat_id",
          "type": "string",
          "description": "目标对话 id；不传则用当前对话",
          "required": false
        },
        {
          "name": "minutes",
          "type": "number",
          "description": "有效期分钟数，默认 30，最长 1440",
          "required": false
        },
        {
          "name": "code",
          "type": "string",
          "description": "16 位 ROOT 识别码，check 时可用来验证",
          "required": false
        },
        {
          "name": "reason",
          "type": "string",
          "description": "开窗用途说明（可选，写进记录便于事后审计）",
          "required": false
        }
      ],
      "required": [
        "action"
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
    },
    {
      "name": "subagent_ls",
      "description": "列目录。返回结构化条目（名字/类型/大小/修改时间），比读 ls 输出稳。只允许 /sdcard 与 外置存储根（STORAGE_ROOT） 之下。",
      "parameters": [
        { "name": "path", "type": "string", "description": "要列的目录，默认 /sdcard。支持 ~ 表示 /sdcard", "required": false },
        { "name": "all", "type": "boolean", "description": "true=连隐藏文件（以 . 开头）一起列，默认不列", "required": false },
        { "name": "limit", "type": "number", "description": "最多返回几项，默认 200，最大 500", "required": false }
      ]
    },
    {
      "name": "subagent_cat",
      "description": "读文本文件。默认前 200 行，可按 start_line/lines 取区间；单次返回不超 200KB。",
      "parameters": [
        { "name": "path", "type": "string", "description": "文件绝对路径，必须在 /sdcard 或 外置存储根（STORAGE_ROOT） 之下", "required": true },
        { "name": "start_line", "type": "number", "description": "从第几行开始读，从 1 开始，默认 1", "required": false },
        { "name": "lines", "type": "number", "description": "读多少行，默认 200，最大 2000", "required": false }
      ]
    },
    {
      "name": "subagent_pwd",
      "description": "看当前可操作范围与运行环境（包名/targetSdk/允许的根目录）。",
      "parameters": []
    },
    {
      "name": "subagent_find",
      "description": "按文件名找文件。pattern 支持 * 与 ?（如 *.js、panel*）。逐层 list 实现，不调 find 命令。",
      "parameters": [
        { "name": "path", "type": "string", "description": "从哪个目录开始找，默认 /sdcard", "required": false },
        { "name": "pattern", "type": "string", "description": "文件名通配符，必填，如 *.js", "required": true },
        { "name": "depth", "type": "number", "description": "最多往下几层，默认 3，最大 8", "required": false },
        { "name": "limit", "type": "number", "description": "最多返回几个，默认 50，最大 300", "required": false }
      ]
    },
    {
      "name": "subagent_grep",
      "description": "在文件内容里搜关键词。返回 文件:行号:内容。跳过 1MB 以上文件。",
      "parameters": [
        { "name": "path", "type": "string", "description": "从哪个目录开始搜，默认 /sdcard/x", "required": false },
        { "name": "keyword", "type": "string", "description": "要搜的关键词，必填，按子串匹配", "required": true },
        { "name": "glob", "type": "string", "description": "只搜匹配的文件名，如 *.js；不传=所有文件", "required": false },
        { "name": "case_sensitive", "type": "boolean", "description": "true=区分大小写，默认 false", "required": false },
        { "name": "depth", "type": "number", "description": "最多往下几层，默认 3，最大 8", "required": false },
        { "name": "limit", "type": "number", "description": "最多返回几行命中，默认 50，最大 300", "required": false }
      ]
    },
    {
      "name": "subagent_mkdir",
      "description": "建目录，自动建父级（等同 mkdir -p）。",
      "parameters": [
        { "name": "path", "type": "string", "description": "要创建的目录绝对路径，必须在 /sdcard 或 外置存储根（STORAGE_ROOT） 之下", "required": true }
      ]
    },
    {
      "name": "subagent_copy",
      "description": "复制或移动文件/目录。mode=copy 复制（含目录递归），mode=move 移动。",
      "parameters": [
        { "name": "from", "type": "string", "description": "源路径，必填", "required": true },
        { "name": "to", "type": "string", "description": "目标路径，必填", "required": true },
        { "name": "mode", "type": "string", "description": "copy=复制（默认）/ move=移动", "required": false }
      ]
    },
    {
      "name": "subagent_rm",
      "description": "删除文件或目录。必须传 confirm=true 才真删；拒绝删 /sdcard 与 外置存储根（STORAGE_ROOT） 本身。",
      "parameters": [
        { "name": "path", "type": "string", "description": "要删的路径，必填", "required": true },
        { "name": "confirm", "type": "boolean", "description": "必须传 true 才执行删除", "required": true }
      ]
    },
    {
      "name": "subagent_du",
      "description": "统计目录占用（递归累加文件大小），返回总字节/文件数/目录数。",
      "parameters": [
        { "name": "path", "type": "string", "description": "要统计的目录，默认 /sdcard/x", "required": false },
        { "name": "limit", "type": "number", "description": "最多扫多少个文件就停，默认 2000，最大 5000", "required": false }
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
var GRP = require("./sb_group.js");
var SKILL = require("./sb_skill.js");

var VERSION = "v1.0.0";
/* 模型列表磁盘缓存有效期：24 小时。600+ 模型一次拉取数秒，命中缓存直接返回 */
var MODELS_TTL_BACKEND = 24 * 60 * 60 * 1000;



function clip(s, n) { return TOOLS.clip(s, n).text; }

/* 共享上下文/可见性函数已抽到 sb_ctx.js。
   这里按名解构，保持原有调用点一个字都不用改。 */
/* 参数解析小工具已抽到 sb_parse.js */
var PARSE = require("./sb_parse.js");
var parseList = PARSE.parseList;
var parseJson = PARSE.parseJson;

var CTX = require("./sb_ctx.js");
var loadCtx = CTX.loadCtx;
var notifyDone = CTX.notifyDone;
var callerChatId = CTX.callerChatId;
var filterChatOf = CTX.filterChatOf;
var rootChatIdOf = CTX.rootChatIdOf;
var ancestorChatIdsOf = CTX.ancestorChatIdsOf;
var visibleTasks = CTX.visibleTasks;
var inboxSuffix = CTX.inboxSuffix;
var tsOf = CTX.tsOf;
var briefOf = CTX.briefOf;

/* 任务生命周期工具已抽到 sb_tool_task.js。 */
/* 配置与探测工具已抽到 sb_tool_cfg.js。 */
/* 面板流式通道工具已抽到 sb_tool_stream.js，见文件末尾 install 调用。 */
/* 环境探测类工具已抽到 sb_tool_env.js，见文件末尾 install 调用。 */
exports.subagent_version = async function () {
    /* tools 计数必须动态算，不能写死。
       曾经写死 21，工具涨到 29 后返回值仍说 21，装机验证时被这个假数字误导。 */
    var n = 0;
    for (var k in exports) {
        if (Object.prototype.hasOwnProperty.call(exports, k) && /^subagent_/.test(k)) n++;
    }
    /* 【第八十三轮】不再报 temp_root（.products 已弃用，任务是自足目录树） */
    complete({ success: true, message: VERSION, data: { version: VERSION, base_dir: CFG.baseDir(), tasks_dir: CFG.tasksDir(), groups_dir: CFG.baseDir() + "/groups", tools: n } });
};

/* 自更新与外部跳转工具已抽到 sb_tool_update.js，见文件末尾 install 调用。 */

/* 大类 dispatch 层已抽到 sb_tool_main.js，见文件末尾 install 调用。 */

require("./sb_tool_update.js")(exports, { version: VERSION, complete: complete });
require("./sb_tool_env.js")(exports, { complete: complete });
require("./sb_tool_stream.js")(exports, { complete: complete });
require("./sb_tool_task.js")(exports, { complete: complete, modelsTtl: MODELS_TTL_BACKEND });
require("./sb_tool_cfg.js")(exports, { complete: complete, modelsTtl: MODELS_TTL_BACKEND });
/* 必须最后：dispatch 层内部调 exports 上的旧名函数 */
require("./sb_tool_main.js")(exports, { complete: complete });
/* ROOT 权限窗口：独立工具，不依赖群组。放在最后，确保 callerChatId 已就绪。 */
require("./sb_tool_root.js")(exports, { complete: complete, callerChatId: callerChatId });
/* 【第一百零六轮】常用文件/目录动作细分（ls/cat/pwd/find/grep/mkdir/copy/rm/du） */
require("./sb_tool_shell.js")(exports, { complete: complete });
