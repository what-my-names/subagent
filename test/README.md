# 测试套件

subagent 的断言测试。**全部是静态断言**：读源码文本做正则/结构匹配，
不联网、不装机、不写文件、不改 `src/`。目的是把「真机翻过车的每个点」钉住，防回归。

## 怎么跑

```bash
cd /sdcard/x/subagent/test
node e2e_all.js
```

只跑一组：

```bash
node e2e_all.js flow    # 主流程
node e2e_all.js md      # Markdown / LaTeX
node e2e_all.js tools   # 三工具 / 白名单
node e2e_all.js ui      # UI 逻辑
node e2e_all.js toast   # 通知条
```

退出码：全绿为 `0`，有失败为 `1`（方便串联到其他脚本）。

## 目录

```
test/
├── e2e_all.js          统一入口
├── lib/assert.js       断言库（group / chk / eq / match / nomatch / report）
└── cases/
    ├── flow.js         主流程：manifest / 29 工具 / 状态机 / 收件箱 / 配置
    ├── md.js           Markdown + LaTeX 内置渲染器 + KaTeX 外接
    ├── tools.js        三工具契约 + 工具名清洗 + 白名单规则
    ├── ui.js           UI 逻辑（8 个历史 bug）+ 欢迎页 + 黑屏防护 + 动效铁律
    └── toast.js        通知条语义 / 位置 / 手势 / 动画填充模式
```

## 断言数

| 组 | 条数 |
|---|---|
| 主流程 | 45 |
| Markdown/LaTeX | 53 |
| 三工具/白名单 | 35 |
| UI 逻辑 | 41 |
| 通知条 | 39 |
| **合计** | **213** |

## 写断言的规矩

1. **测代码实际怎么写，不测你以为怎么写。**
   每次加断言前先 `grep` 源码确认真实写法，别凭记忆。
   本轮就吃过 9 次亏：`notifyDone` 其实叫 `bump`、
   `getEnvValue` 是对象属性不是函数声明、
   `cleanToolName` 用 `slice(0, lt)` 不是 `indexOf('<')`……

2. **正则要防假阳性。**
   - 匹配 HTML 属性用 `[^>]*`，别用 `[\s\S]*`（会跨标签）
   - 匹配 CSS 块要做括号配平，别用 `\n\}` 收尾（单行关键帧会吞到下个选择器）
   - 「必须不存在」的检查用 `nomatch`，别写成 `chk(!/x/.test(...))` 漏掉可读性

3. **一条断言对应一次事故。**
   每条 `chk` 上面的注释写清「不加这条会怎样」，比如：
   `openTask 打开后重启轮询` —— 不加的话，运行中任务打开后进度永远冻结。

4. **不引入依赖。** 只用 `fs` + 正则。要动态测 DOM 得上 jsdom，为几条断言不值得。

## 与包体的关系

`test/` 在 `src/` 之外，**不会被打进 toolpkg**。
已实测：装机包内 16 个文件，无任何 test/e2e 文件。

## 已知局限

- 只做静态断言，**测不了运行时行为**（DOM 渲染、手势、网络请求）。
  这些要靠真机验证，见 `交接文档.md` 的验证清单。
- 正则断言对代码风格敏感：大规模重构（改名、拆函数）后需要同步更新断言。
