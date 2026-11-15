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

## 工具（23 个：23 大类）

所有工具名都是大类，具体动作用参数区分。

**任务主线**

| 工具 | 作用 |
|---|---|
| `subagent_spawn` | 建任务并派给子代理。只有 `task` 必填；`tools` 留空＝无工具、传 `*` 放开全部；含写类工具必须给 `workspace` |
| `subagent_run` | 推进已有任务。`wait=false` 推 1-3 步；`wait=true` 在 budget 内推到完成 |
| `subagent_get` | 取任务产出。不传 id 列全部；传 id 按 `detail` 返回 brief/standard/full/trace |
| `subagent_wait` | 等任务跑完再返回。id/ids 指定任务，all=true 等全部（任一返回即返回）；timeout_ms 上限，need 凑几个，detail 控详细度 |
| `subagent_ctrl` | 改状态。`action` = cancel / resume / steer / close |
| `subagent_del` | 删任务（任务文件 + 产物 + 快照 + 收件箱）。`confirm=true` 才真删 |
| `subagent_undo` | 列出或恢复该任务写过的文件。`dry_run` 默认 true 只看不改 |

**群组与权限**

| 工具 | 作用 |
|---|---|
| `subagent_group` | 群组管理。`action` = list / info / kick / unkick / perm / admit / delete / migrate |
| `subagent_root` | ROOT 权限窗口。`action` = open / close / check / list。开窗返回 16 位识别码，拥有全部权限位（63），有效期最长 1440 分钟 |

> 权限位：`READ=1` 读 / `WRITE=2` 推进 / `CREATE=4` 建子代理 / `DELETE=8` 删任务 / `KICK=16` 管成员 / `ROOT=32` 全量。
> 预设：创始人 31、受邀 3、路人 1、ROOT 窗口 63。

**配置与环境**

| 工具 | 作用 |
|---|---|
| `subagent_cfg` | 配置与模板。`target` = profile / template |
| `subagent_env` | 环境探测。`what` = probe / version / chats / tools / workspace / dir / path |
| `subagent_skill` | 看可用 skill 与读全文。`action` = list / read |
| `subagent_update` | 自更新。`step` = check / download / status / install |

**收件箱与外部**

| 工具 | 作用 |
|---|---|
| `subagent_box` | 收件箱：未读子代理结论（`action=read` 清空） |
| `subagent_open_mail` | 调起系统邮件应用写反馈信（WebView 不支持 mailto） |
| `subagent_open_url` | 系统浏览器打开本仓库相关链接 |
| `subagent_vendor_js` | 读 vendor/ 下 js/css（如 katex），供面板注入 |

**面板流式支撑**（内部用途）

| 工具 | 作用 |
|---|---|
| `subagent_stream_ctx` | 返回端点、模型、请求头、思考字段与工具 schema |
| `subagent_stream_key` | 仅本机面板直连时取密钥（不回显给对话） |
| `subagent_stream_relay` | 无 CORS 端点的流式中继 |
| `subagent_save_turn` | 面板流式结束后把这一轮消息落盘 |
| `subagent_stream_flush` | 流式增量落盘，保状态与草稿 |
| `subagent_tool_once` | 面板内部执行单个工具（白名单与写边界与后端一致） |

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
    subagent.js          23 个声明（23 大类），导出实现分散在 sb_tool_*.js
    sb_config.js         配置读写、密钥环境变量、模型缓存
    sb_task.js           任务状态机与落盘
    sb_llm.js            端点解析、请求构造、模型列表
   sb_skill.js          skill 扫描与读取（子代理自身目录优先，主 agent 共享目录只读）
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