# subagent

自建模型通道的子代理：**自己发模型请求、自己执行宿主工具、白名单硬拒绝、写前备份可撤回**。

Operit ToolPkg 插件，面板为 WebView 单文件（无外部依赖）。

## 安装

1. 从插件市场安装，或将本仓库 `src/` 目录用 `debug_install_toolpkg` 烧录。
2. 工具箱进入「子代理」→ 右上齿轮进入设置页。

## 配置

1. 选「提供商」，或手动填 `base_url` 与 `model`。
2. 存 API Key（写入环境变量 `SUBAGENT_API_KEY`，只写不读，面板不回显）。
3. 点「测试连通性」：能拿到模型列表说明端点与 key 正常。

> **端点与流式**：面板在 `http://localhost/subagent` 下运行，前端直连需要端点返回 CORS 头
> （`Access-Control-Allow-Origin`）。端点不带 CORS 头时自动降级为后端中继（首字延迟 = 整包时间）；
> 带了 CORS 头则是真逐字流式。判断方法：
> `curl -sI -X OPTIONS -H 'Origin: http://localhost/subagent' <你的端点>`，看有没有 `access-control-allow-origin`。

## 工具（36 个）

**任务生命周期**

| 工具 | 作用 |
|---|---|
| `subagent_spawn` | 建任务（只有 `task` 必填；**`allowed_tools` 留空 = 一个工具都用不了**，要放开全部传 `all=true`；含写类工具时必须给 `workspace`） |
| `subagent_advance` | 推进一步或 N 步（上限 3） |
| `subagent_wait` | 等完成（默认最多 60s） |
| `subagent_status` | 查状态；不传 id 列全部 |
| `subagent_result` | 取结论（支持多个 id 合并） |
| `subagent_trace` | 逐步明细（思考 / 正文 / 工具调用 / 结果） |
| `subagent_steer` | 给子代理发消息（运行中下一步生效） |
| `subagent_cancel` | 请求停止，不等待停止；之后仍可 `resume` |
| `subagent_resume` | 把已停止 / 失败 / 已完成的任务拉回待开始 |
| `subagent_list` | 任务列表 |
| `subagent_close` | 两段式关闭：默认只返回进度，`confirm:true` 才关；可选回滚与丢弃产物 |
| `subagent_delete` | 彻底删除（任务文件 + 产物 + 快照）；默认只预览，`confirm:true` 才删 |

**数据与工作区**

| 工具 | 作用 |
|---|---|
| `subagent_inbox` | 收件箱：未读子代理结论（`action:read` 清空） |
| `subagent_undo` | 列出或恢复写操作（默认只看不改） |
| `subagent_workspace` | 私有工作区：`init` 建目录 / `info` 列文件树与体积 |
| `subagent_list_dir` | 列目录（含各自体积），供面板做文件树 |
| `subagent_check_path` | 校验路径是否存在、是文件还是目录 |

**配置与探测**

| 工具 | 作用 |
|---|---|
| `subagent_config` | 读 / 写配置；key 只写不读 |
| `subagent_templates` | 模板 `list` / `add` / `remove` |
| `subagent_probe` | 分层探测：端点可达 / 密钥有效 / 模型可生成 |
| `subagent_tools` | 列出可授权的宿主工具与已启用包 |
| `subagent_chats` | 列出 Operit 对话（供选择附带哪个对话的上下文） |
| `subagent_version` | 版本与配置路径（`tools` 计数动态统计） |

**面板流式支撑**（内部用途，description 已写明）

| 工具 | 作用 |
|---|---|
| `subagent_stream_ctx` | 返回端点、模型、请求头、思考字段与工具 schema（密钥单独取） |
| `subagent_stream_key` | 仅本机面板直连时取密钥（不回显给对话，只在页面内存里用） |
| `subagent_stream_relay` | 无 CORS 端点的流式中继：后端取整包 SSE 解析成块供面板回放 |
| `subagent_save_turn` | 面板流式结束后把这一轮消息落盘，保证刷新后不丢 |
| `subagent_tool_once` | 面板流式循环用：执行单个工具（白名单与写入范围校验与后端一致） |
| `subagent_vendor_js` | 外接资源读取：读数据目录 `vendor/` 下的 js/css（如 katex.min.js） |

短任务用 `sync: true` 一次跑完；长任务用步进。

> **工具怎么调**：`allowed_tools` 里的每个工具都会作为**独立的 function** 暴露给模型，
> 模型直接写 `read_file({path:"..."})`，不需要包一层。只有表外工具（你自己的包工具 `包名:工具名`、
> 或通配 `pkg:*`）才通过 `run_tool({tool, args})` 兜底调用。

## 安全边界

- **白名单硬拒绝**：不在 `allowed_tools` 里的工具直接返回错误给模型，不执行。
  工具名会先清洗（剥离宿主内部编码串）再比对，避免误拒。
- **写入必须有范围**：含写类工具时不给 `workspace` 直接拒绝建任务。
- **产物与 undo** 放私有工作区，不污染用户目录。
- **禁止递归**：`subagent_*` 出现在白名单里直接拒绝。
- `terminal` 类写操作无法撤回，建议不开。

## 已知限制

- 独立计费，不继承 Operit 里配的额度。
- 不继承角色卡、记忆、世界书、上下文总结。
- 思考内容是否可见取决于端点是否返回 `reasoning_content`。
- 工具执行走宿主 `toolCall`，包被禁用时调不到其工具。
- 面板只做静态渲染，公式渲染器为内置轻量实现；需要完整 LaTeX 支持时把
  `katex.min.js` / `katex.min.css` 放到 `/sdcard/Download/Operit/subagent/vendor/`，
  面板会经 `subagent_vendor_js` 读取并注入（包内不内置，避免体积与离线问题）。

## 目录结构

```
src/
  manifest.json          ToolPkg 清单
  main.js                入口：注册 UI 路由 + 收件箱钩子
  packages/              后端（配置 / 任务 / LLM / 工具 / 钩子 / 消息总线）
    subagent.js          36 个工具的导出与声明
    sb_config.js         配置读写、密钥环境变量、模型缓存
    sb_task.js           任务状态机与落盘
    sb_llm.js            端点解析、请求构造、模型列表
    sb_tools.js          白名单校验、工具名清洗、写范围检查
    sb_bus.js            收件箱（内存队列 + 落盘）
    sb_hook.js           系统提示词钩子（只读内存，不调工具）
  ui/web/                面板源码（html / css / js，唯一真相源）
    panel.html
    panel.css
    panel.js
    panel_html.js        构建产物（内联单文件，由 build_panel_html.js 生成）
  ui/web_panel.ui.js     WebView 入口（活入口）
  ui/panel.ui.js         兜底 Compose 面板（WebView 加载失败时退回）
  ui/build_panel_html.js 构建工具（不随包分发）

test/                    断言测试（不在包内，见下）
  e2e_all.js             统一入口
  lib/assert.js          断言库
  cases/                 5 组用例
```

构建面板：`cd src && node ui/build_panel_html.js`

## 测试

```bash
cd test && node e2e_all.js        # 全部 404 条断言
cd test && node e2e_all.js ui     # 只跑一组：flow / md / tools / ui / toast
```

全部是静态断言（读源码做正则 / 结构匹配），不联网、不装机、不写文件。
写断言的规矩见 [`test/README.md`](test/README.md)。

## License

MIT，见 [LICENSE](LICENSE)。