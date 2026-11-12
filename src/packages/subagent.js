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
                "zh": "建任务：只有 task 必填。allowed_tools 留空 = 一个工具都用不了；要放开全部传 all=true（递归派子代理仍硬拦）。含写类工具时必须给 workspace。sync=true 时直接跑完并返回结论。",
                "en": "Create a task. Only task required. Empty allowed_tools means no tools; pass all=true to allow everything (recursive subagents still blocked). workspace required if write tools allowed."
            },
            "parameters": [
                {
                    "name": "task",
                    "type": "string",
                    "description": "任务描述",
                    "required": true
                },
                {
                    "name": "allowed_tools",
                    "type": "string",
                    "description": "允许的工具，逗号分隔，支持通配与 包名:工具名。留空 = 一个工具都用不了；要放开全部请传 all=true",
                    "required": false
                },
                {
                    "name": "all",
                    "type": "boolean",
                    "description": "true = 放开全部工具（内置工具全展开 + 包工具走 run_tool）。递归派子代理仍被硬拦。默认 false",
                    "required": false
                },
                {
                    "name": "key_points",
                    "type": "string",
                    "description": "任务要点 JSON：goal/deliverable/constraints/acceptance",
                    "required": false
                },
                {
                    "name": "thinking_level",
                    "type": "string",
                    "description": "off/low/medium/high",
                    "required": false
                },
                {
                    "name": "workspace",
                    "type": "string",
                    "description": "写入根，含写类工具时必填",
                    "required": false
                },
                {
                    "name": "context_mode",
                    "type": "string",
                    "description": "none/chat_tail/summary/fork：是否附带主对话上下文",
                    "required": false
                },
                {
                    "name": "context_turns",
                    "type": "number",
                    "description": "带入主对话的条数（1-120），不传按模式默认（chat_tail 8 / fork 24 / summary 60）",
                    "required": false
                },
                {
                    "name": "context_text",
                    "type": "string",
                    "description": "背景注入文本",
                    "required": false
                },
                {
                    "name": "parent_chat_id",
                    "type": "string",
                    "description": "可选：fork/chat_tail 读哪条对话的历史；不传取最近更新的对话",
                    "required": false
                },
                {
                    "name": "context_files",
                    "type": "string",
                    "description": "逗号分隔的文件路径，读入注入",
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
                    "name": "max_steps",
                    "type": "number",
                    "description": "步数上限，默认 20",
                    "required": false
                },
                {
                    "name": "timeout_ms",
                    "type": "number",
                    "description": "单步超时，默认 90000",
                    "required": false
                },
                {
                    "name": "summary_level",
                    "type": "string",
                    "description": "t0/t1/t2",
                    "required": false
                },
                {
                    "name": "result_level",
                    "type": "string",
                    "description": "brief/standard/full",
                    "required": false
                },
                {
                    "name": "group",
                    "type": "string",
                    "description": "分组，用于 fan-out",
                    "required": false
                },
                {
                    "name": "template_id",
                    "type": "string",
                    "description": "使用 config 里的模板",
                    "required": false
                },
                {
                    "name": "sync",
                    "type": "boolean",
                    "description": "true=一次调用内跑完",
                    "required": false
                },
                {
                    "name": "wait_ms",
                    "type": "number",
                    "description": "sync 总预算，最大 60000",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_advance",
            "description": {
                "zh": "推进一步或 N 步（上限 3）",
                "en": "Advance one or N steps"
            },
            "parameters": [
                {
                    "name": "id",
                    "type": "string",
                    "description": "任务 id",
                    "required": true
                },
                {
                    "name": "steps",
                    "type": "number",
                    "description": "1-3，默认 1",
                    "required": false
                },
                {
                    "name": "summary_level",
                    "type": "string",
                    "description": "t0/t1/t2",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_wait",
            "description": {
                "zh": "等待任务完成（最大 60 秒）",
                "en": "Wait for completion up to 60s"
            },
            "parameters": [
                {
                    "name": "id",
                    "type": "string",
                    "description": "任务 id",
                    "required": true
                },
                {
                    "name": "timeout_ms",
                    "type": "number",
                    "description": "默认 30000，最大 60000",
                    "required": false
                },
                {
                    "name": "result_level",
                    "type": "string",
                    "description": "brief/standard/full",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_status",
            "description": {
                "zh": "任务状态；不传 id 列全部",
                "en": "Task status"
            },
            "parameters": [
                {
                    "name": "id",
                    "type": "string",
                    "description": "任务 id，可选",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_result",
            "description": {
                "zh": "取最终结论，支持多个 id 合并",
                "en": "Get final result"
            },
            "parameters": [
                {
                    "name": "id",
                    "type": "string",
                    "description": "任务 id",
                    "required": false
                },
                {
                    "name": "task_ids",
                    "type": "string",
                    "description": "逗号分隔多个 id",
                    "required": false
                },
                {
                    "name": "result_level",
                    "type": "string",
                    "description": "brief/standard/full",
                    "required": false
                },
                {
                    "name": "max_chars",
                    "type": "number",
                    "description": "截断长度",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_undo",
            "description": {
                "zh": "列出或恢复写操作（默认只看不改）",
                "en": "List or roll back writes"
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
                    "description": "默认 true",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_cancel",
            "description": {
                "zh": "等同 DSH 的 interrupt_agent：请求停止当前工作，不等待停止；之后仍可用 steer 继续",
                "en": "Request the subagent to stop (same as interrupt_agent)"
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
            "name": "subagent_resume",
            "description": {
                "zh": "恢复任务：把已停止/失败/已完成的任务拉回待开始，清掉取消标记，可继续推进",
                "en": "Resume a stopped/failed/done task back to queued"
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
            "name": "subagent_steer",
            "description": {
                "zh": "等同 DSH 的 send_message：给子代理发消息。运行中在下一步生效，空闲则开新一轮；只回投递确认，不回答案",
                "en": "Append an instruction to a task"
            },
            "parameters": [
                {
                    "name": "id",
                    "type": "string",
                    "description": "任务 id",
                    "required": true
                },
                {
                    "name": "message",
                    "type": "string",
                    "description": "追加的指令",
                    "required": true
                }
            ]
        },
        {
            "name": "subagent_inbox",
            "description": { "zh": "看收件箱：未读子代理结论列表（action=read 可清空）。每次派活前或主对话开始前建议先查一次", "en": "Inspect inbox (action=read clears)" },
            "parameters": [
                {
                    "name": "action",
                    "type": "string",
                    "description": "传 read 清空收件箱；不传为查看",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_list",
            "description": {
                "zh": "任务列表",
                "en": "List tasks"
            },
            "parameters": []
        },
        {
            "name": "subagent_close",
            "description": {
                "zh": "关闭任务（两段式）：默认只返回当前进度不关闭；confirm=true 才关；可选回滚与丢弃产物",
                "en": "Two-step close: default returns progress only"
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
                    "description": "true 才真正关闭；不传只返回当前进度",
                    "required": false
                },
                {
                    "name": "rollback",
                    "type": "boolean",
                    "description": "回滚写操作",
                    "required": false
                },
                {
                    "name": "delete_product",
                    "type": "boolean",
                    "description": "删除产物目录",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_delete",
            "description": {
                "zh": "彻底删除任务：任务文件 + 产物目录 + 快照。默认只返回预览；confirm=true 才删",
                "en": "Permanently delete a task with its product dir and snapshots"
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
                    "description": "true 才真正删除；不传只返回预览",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_config",
            "description": {
                "zh": "读写配置；key 只写不读",
                "en": "Read/write config; key write-only"
            },
            "parameters": [
                {
                    "name": "action",
                    "type": "string",
                    "description": "status / set / key / refresh_models / list_profiles / add_profile / set_profile / set_active / del_profile",
                    "required": true
                },
                {
                    "name": "profile_id",
                    "type": "string",
                    "description": "set_active / del_profile 时的目标配置 id",
                    "required": false
                },
                {
                    "name": "payload",
                    "type": "string",
                    "description": "set 时的 JSON",
                    "required": false
                },
                {
                    "name": "api_key",
                    "type": "string",
                    "description": "写入的 key（不回显）",
                    "required": false
                },
                {
                    "name": "base_url",
                    "type": "string",
                    "description": "refresh_models 时可选：按这个端点拉模型（面板测未保存的输入框值用）",
                    "required": false
                },
                {
                    "name": "force",
                    "type": "boolean",
                    "description": "refresh_models 时可选：true 跳过 24 小时缓存强制重拉",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_templates",
            "description": {
                "zh": "任务模板：list/add/remove",
                "en": "Task templates"
            },
            "parameters": [
                {
                    "name": "action",
                    "type": "string",
                    "description": "list/add/remove",
                    "required": true
                },
                {
                    "name": "payload",
                    "type": "string",
                    "description": "模板 JSON",
                    "required": false
                },
                {
                    "name": "id",
                    "type": "string",
                    "description": "模板 id",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_probe",
            "description": {
                "zh": "分层测试连通性：端点可达 / 密钥有效 / 模型可生成。可指定模型单独探测",
                "en": "Layered connectivity probe: reachable / key valid / model can generate"
            },
            "parameters": [
                {
                    "name": "deep",
                    "type": "boolean",
                    "description": "默认就会真发一次最小对话；传 false 可跳过实测只做可达性检查",
                    "required": false
                },
                {
                    "name": "model",
                    "type": "string",
                    "description": "只探测这个模型（临时覆盖配置里的模型）",
                    "required": false
                },
                {
                    "name": "base_url",
                    "type": "string",
                    "description": "只探测这个端点（临时覆盖配置里的端点，面板测未保存的输入框值用）",
                    "required": false
                }
]
        },
        {
            "name": "subagent_version",
            "description": {
                "zh": "版本与配置路径",
                "en": "Version info"
            },
            "parameters": []
        },
        {
            "name": "subagent_check_update",
            "description": {
                "zh": "检查 GitHub Release 是否有新版本（带 6 小时缓存）。返回当前版本、最新版本、更新说明、下载地址",
                "en": "Check GitHub releases for a newer version (6h cache)"
            },
            "parameters": [
                {
                    "name": "force",
                    "type": "boolean",
                    "required": false,
                    "description": {
                        "zh": "true = 跳过 6 小时缓存强制重新拉取",
                        "en": "Bypass the 6h cache"
                    }
                }
            ]
        },
        {
            "name": "subagent_download_update",
            "description": {
                "zh": "下载最新版本的 .toolpkg 到数据目录 updates/。走 api.github.com（github.com 在本机网络不可达）",
                "en": "Download the latest .toolpkg into updates/"
            },
            "parameters": [
                {
                    "name": "force",
                    "type": "boolean",
                    "required": false,
                    "description": {
                        "zh": "true = 跳过缓存重新检查版本",
                        "en": "Bypass the version cache"
                    }
                }
            ]
        },
        {
            "name": "subagent_download_status",
            "description": {
                "zh": "查询下载进度与结果（已下载/总大小/百分比/失败原因），面板重开后仍可读",
                "en": "Query download progress and result"
            },
            "parameters": []
        },
        {
            "name": "subagent_install_update",
            "description": {
                "zh": "把已下载的 .toolpkg 写入宿主包目录完成安装，装完即生效（不需重启）。会备份旧包到 .bak-update",
                "en": "Install the downloaded .toolpkg into the host package dir. Takes effect immediately, no restart needed"
            },
            "parameters": [
                {
                    "name": "path",
                    "type": "string",
                    "required": false,
                    "description": {
                        "zh": "要安装的包路径。不传则用上次下载记录里的路径",
                        "en": "Package path; defaults to the last downloaded file"
                    }
                }
            ]
        },
        {
            "name": "subagent_open_mail",
            "description": {
                "zh": "调起系统邮件应用写一封信（发 SENDTO intent）。WebView 不支持 mailto: 直接跳转，必须走后端 intent",
                "en": "Open the system mail app with a draft (SENDTO intent). WebView cannot navigate mailto: directly"
            },
            "parameters": [
                {
                    "name": "email",
                    "type": "string",
                    "required": true,
                    "description": {
                        "zh": "收件邮箱地址",
                        "en": "Recipient email address"
                    }
                },
                {
                    "name": "subject",
                    "type": "string",
                    "required": false,
                    "description": {
                        "zh": "邮件主题，默认「反馈」",
                        "en": "Subject, defaults to feedback"
                    }
                }
            ]
        },
        {
            "name": "subagent_trace",
            "description": {
                "zh": "看任务逐步明细：思考、正文、工具调用与结果摘要",
                "en": "Step-by-step trace"
            },
            "parameters": [
                {
                    "name": "id",
                    "type": "string",
                    "description": "任务 id",
                    "required": true
                },
                {
                    "name": "limit",
                    "type": "number",
                    "description": "最近 N 步，默认 10",
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_workspace",
            "description": {
                "zh": "私有工作区：action=init 建好工作区目录；action=info 列出文件树与体积（按大小降序），方便主/子代理清理废弃文件",
                "en": "Private workspace: init or list files with sizes for cleanup"
            },
            "parameters": [
                { "name": "action", "type": "string", "description": "info（默认）/ init", "required": false },
                { "name": "path", "type": "string", "description": "要列的子目录，默认工作区根", "required": false },
                { "name": "depth", "type": "number", "description": "递归深度 1-4，默认 2", "required": false },
                { "name": "max_files", "type": "number", "description": "最多返回条目数 10-400，默认 120", "required": false }
            ]
        },
        {
            "name": "subagent_list_dir",
            "description": {
                "zh": "列出一个目录下的子目录与文件（含各自体积），供面板做文件树",
                "en": "List dirs and files with sizes for the folder picker"
            },
            "parameters": [
                { "name": "path", "type": "string", "description": "目录路径", "required": true }
            ]
        },
        {
            "name": "subagent_check_path",
            "description": {
                "zh": "检查路径是否存在、是文件还是目录，并给出可作为 workspace 的目录",
                "en": "Check whether a path exists / is dir, and suggest workspace dir"
            },
            "parameters": [
                { "name": "path", "type": "string", "description": "要检查的路径", "required": true }
            ]
        },
        {
            "name": "subagent_save_turn",
            "description": {
                "zh": "面板流式结束后把这一轮助手/工具消息落盘，保证刷新后不丢；同时累计步数与用量，done=true 时进收件箱",
                "en": "Persist a streamed turn so it survives reload"
            },
            "parameters": [
                {
                    "name": "id",
                    "type": "string",
                    "description": { "zh": "任务 id", "en": "task id" }
                },
                {
                    "name": "turns",
                    "type": "array",
                    "description": { "zh": "要追加的消息数组", "en": "turns to append" }
                },
                {
                    "name": "done",
                    "type": "boolean",
                    "description": { "zh": "这一轮是否已结束（true 则置 done）", "en": "mark task done" }
                },
                {
                    "name": "usage",
                    "type": "object",
                    "description": { "zh": "本步用量 {in,out} 或 {prompt_tokens,completion_tokens}，用于累计 token 与花费", "en": "token usage of this step" },
                    "required": false
                },
                {
                    "name": "finish_reason",
                    "type": "string",
                    "description": { "zh": "本步结束原因（stop / tool_calls / length）", "en": "finish reason" },
                    "required": false
                }
            ]
        },
        {
            "name": "subagent_stream_flush",
            "description": {
                "zh": "流式增量落盘：把 status 置 running 并保存当前已生成的思考/正文。面板流式过程中定时调用，保证退出再进来内容还在、状态不是「待开始」",
                "en": "Persist in-progress stream so it survives panel reload"
            },
            "parameters": [
                {
                    "name": "id",
                    "type": "string",
                    "description": { "zh": "任务 id", "en": "task id" }
                },
                {
                    "name": "think",
                    "type": "string",
                    "description": { "zh": "当前累计的思考文本", "en": "accumulated reasoning" }
                },
                {
                    "name": "body",
                    "type": "string",
                    "description": { "zh": "当前累计的正文文本", "en": "accumulated content" }
                }
            ]
        },
        {
            "name": "subagent_tool_once",
            "description": {
                "zh": "面板流式循环用：执行单个工具（白名单与写入范围校验与后端一致）",
                "en": "Run a single tool for the panel streaming loop"
            },
            "parameters": [
                {
                    "name": "id",
                    "type": "string",
                    "description": { "zh": "任务 id，用于取白名单与写入根", "en": "task id" }
                },
                {
                    "name": "tool",
                    "type": "string",
                    "description": { "zh": "工具名", "en": "tool name" }
                },
                {
                    "name": "args",
                    "type": "object",
                    "description": { "zh": "该工具的参数对象", "en": "tool args" }
                }
            ]
        },
        {
            "name": "subagent_stream_ctx",
            "description": {
                "zh": "给面板流式直连用：返回端点、模型、请求头、思考字段与工具 schema（密钥单独取）",
                "en": "Return endpoint/model/headers/tool schema for panel streaming"
            },
            "parameters": [
                {
                    "name": "id",
                    "type": "string",
                    "description": { "zh": "任务 id，用于取该任务的白名单与思考等级", "en": "task id" }
                }
            ]
        },
        {
            "name": "subagent_stream_key",
            "description": {
                "zh": "仅本机面板直连时取密钥（不回显给对话，只在页面内存里用）",
                "en": "Hand api key to the local panel for direct streaming"
            },
            "parameters": []
        },
        {
            "name": "subagent_stream_relay",
            "description": {
                "zh": "http 局域网端点的流式中继：后端取整包 SSE 并解析成块，供面板回放（https 端点走前端直连，不用它）",
                "en": "Relay SSE for http LAN endpoints: fetch whole SSE and split into replayable chunks"
            },
            "parameters": [
                {
                    "name": "id",
                    "type": "string",
                    "description": { "zh": "任务 id，用于取该任务的模型配置", "en": "task id" }
                },
                {
                    "name": "body",
                    "type": "object",
                    "description": { "zh": "可选：页面已拼好的请求体；不传则后端按配置现拼", "en": "optional prebuilt request body" }
                }
            ]
        },
        {
            "name": "subagent_chats",
            "description": {
                "zh": "列出 Operit 里的对话（按最近更新），供面板选择「附带哪个对话的上下文」",
                "en": "List Operit chats for context injection selection"
            },
            "parameters": [
                {
                    "name": "limit",
                    "type": "number",
                    "description": { "zh": "返回条数，默认 30，最多 100", "en": "Max chats, default 30" }
                },
                {
                    "name": "query",
                    "type": "string",
                    "description": { "zh": "按标题过滤（不区分大小写）", "en": "Filter by title" }
                }
            ]
        },
        {
            "name": "subagent_tools",
            "description": {
                "zh": "列出可授权的宿主工具与已启用包（供面板选择）",
                "en": "List host tools and enabled packages"
            },
            "parameters": []
        },
        {
            "name": "subagent_vendor_js",
            "description": {
                "zh": "外接资源读取：读数据目录 vendor/ 下的 js/css 文件文本（如 katex.min.js），供面板注入。仅限 base_dir/vendor/ 内、扩展名 js/css，防路径逃逸",
                "en": "Read vendored js/css from data dir vendor/"
            },
            "parameters": [
                {
                    "name": "name",
                    "type": "string",
                    "description": "文件名，如 katex.min.js / katex.min.css；只允许字母数字点横杠下划线",
                    "required": true
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
        maxChars: Number(cfg.tool_result_max_chars || 8000),
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
        var cfg = await CFG.load();
        var mode = String(cfg.notice_mode || "inbox");
        if (mode === "off") return;
        var title = String(task.title || task.id);
        /* 全文入库（第七轮）：旧版截 160 字，邮件正文打不开——现在存全量，
           由 sb_bus 的 20000 上限统一兜底 */
        var text = task.result ? String(task.result) : String(task.error || "已结束");
        try { BUS.add({ id: task.id, title: title, task_id: task.id, task_title: task.title || title, text: text, finished_at: Date.now(), created_at: Date.now() }); } catch (e0) {}
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
    return {
        id: task.id, title: task.title, status: task.status, step: task.step,
        max_steps: task.max_steps, next: TASK.nextFor(task),
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
    var allowed = parseList(params.allowed_tools);
    /* all=true：放开全部工具。语义定调（2026-11-07 用户拍板）：
       留空 = 一个工具都用不了（空数组，白名单全拒）；
       要全放开必须显式传 all=true → 内部变成 ["*"]。
       "*" 在 sb_llm.runToolSchema 里会展开 sb_toolmeta 全表 + 留 run_tool 兜底表外包；
       在 sb_tools.matchAllowed 里匹配一切；但 isRecursive 仍会硬拦递归派子代理。 */
    if (params.all === true) allowed = ["*"];
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
    var ws = String(params.workspace || template && template.workspace || cfg.default_workspace || "").trim();
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
        thinking_level: params.thinking_level || template && template.thinking_level || "medium",
        workspace_resolved: ws,
        context_mode: params.context_mode || template && template.context_mode || cfg.default_context_mode,
        context_text: ctxText,
        max_steps: params.max_steps, timeout_ms: params.timeout_ms,
        model: params.model, base_url: params.base_url,
        summary_level: params.summary_level, result_level: params.result_level,
        group: params.group
    });

    var waitMs = Math.min(Number(params.wait_ms || 30000), Number(cfg.wait_max_ms || 60000));
    if (params.sync === true) {
        var deadline = Date.now() + waitMs;
        var last = null;
        var lastMsg = "";
        while (Date.now() < deadline) {
            var r2 = await TASK.advanceTask(cfg, task);
            notifyDone(r2 && r2.task);
            last = r2;
            lastMsg = String(r2.message || lastMsg || "");
            if (r2.task && (r2.task.status === "done" || r2.task.status === "failed" || r2.task.status === "cancelled")) break;
            if (!r2.ok) break;
        }
        var cur = (last && last.task) ? last.task : task;
        complete({
            success: cur.status === "done",
            message: (cur.status === "done" ? "子代理完成（" + cur.step + " 步）" : (cur.error || lastMsg || "未在等待预算内完成")) + inboxSuffix(),
            data: {
                task: briefOf(cur),
                summary: TASK.buildSummary(cur, params.summary_level || cur.summary_level, cur.last),
                result: cur.status === "done" ? TASK.buildResult(cur, params.result_level || cur.result_level) : null
            }
        });
        return;
    }

    complete({ success: true, message: "已建任务 " + task.id + inboxSuffix(), data: { task: briefOf(task), next: "advance" } });
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
    var plan = await TOOLS.undoAll(ctx, dry);
    if (ctx.save) await ctx.save();
    complete({ success: true, message: dry ? ("将恢复 " + plan.length + " 项（未执行）") : ("已恢复 " + plan.length + " 项"), data: { dry_run: dry, plan: plan } });
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
            + "，开关" + (enabled ? "已开启" : "已关闭") + (skips > 0 ? "，关闭期间跳过 " + skips + " 次" : "") + "）",
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
    if (params.rollback === true) {
        var ctx = await loadCtx(cfg, t);
        restored = await TOOLS.undoAll(ctx, false);
        if (ctx.save) await ctx.save();
    }
    if (params.delete_product === true) {
        try { await Tools.Files.deleteFile(t.product_dir, true, "android"); } catch (e) {}
    }
    t.status = "closed";
    await TASK.saveTask(t);
    complete({ success: true, message: "已关闭" + (params.rollback === true ? "并回滚" : ""), data: { id: t.id, restored: restored } });
};

exports.subagent_delete = async function (params) {
    params = params || {};
    var id = String(params.id || "");
    if (!id) { complete({ success: false, message: "缺少 id", data: {} }); return; }
    var t = await TASK.loadTask(id);
    if (!t) {
        try { await Tools.Files.deleteFile(CFG.baseDir() + "/tasks/" + id + ".json", false, "android"); } catch (e) {}
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
        maxChars: Number(cfg.tool_result_max_chars || 8000),
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
    if (p.charAt(0) !== "/") p = "/" + p.replace(/^\.+\/*/, "");
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
    var defWs = String(cfg.default_workspace || "").trim() || CFG.workspaceDir();

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
    var r = await UPD.openMail({ email: params.email, subject: params.subject });
    complete({ success: !!r.ok, message: r.msg, data: r.data || {} });
};
