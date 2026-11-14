/* sb_toolmeta.js — 内置工具的参数元数据表
 *
 * 为什么需要这张表：
 *   宿主 Tools.SoftwareSettings.listSandboxPackages() 只返回每个包的 toolCount，
 *   拿不到「每个工具的参数 schema」。而要让模型直接调 read_file({path:"..."}) 而不是
 *   包一层 run_tool({tool,args})，就必须给端点一份真实的 function 定义。
 *
 * 设计取舍：
 *   1) 只覆盖常用内置工具；表外工具（如用户自己的包工具 `包名:工具名`）走 run_tool 兜底。
 *   2) parameters 一律 additionalProperties:true，required 只标真正必填的 —— 宁松不严，
 *      宁可让模型多传一个无用参数，也不要因为 schema 过严导致调用被端点拒。
 *   3) 描述写「什么时候用」，不写实现细节 —— 模型靠这个选工具。
 *   4) 有默认值的参数，除了在 description 里写，还要写 JSON Schema 的 default 字段：
 *      描述是给人读的，default 才是给端点和模型读的，少一个模型就要猜。
 */

var T = {};

function def(name, desc, props, required) {
    T[name] = {
        name: name,
        description: desc,
        parameters: {
            type: "object",
            properties: props || {},
            required: required || [],
            additionalProperties: true
        }
    };
}

/* ── 读文件 ── */
def("read_file", "读整个文件内容。适合已知路径且文件不大的场景；大文件请用 read_file_part 按行读。",
    { path: { type: "string", description: "文件绝对路径，如 /sdcard/x/foo.txt" } },
    ["path"]);

def("read_file_part", "按行号范围读文件片段。大文件、日志、只想看某几行时用这个，别整读。",
    {
        path: { type: "string", description: "文件绝对路径" },
        start_line: { type: "integer", description: "起始行号，从 1 开始，必填" },
        end_line: { type: "integer", description: "结束行号（含），不传默认 start_line+99" }
    },
    /* 【第四十八轮】start_line 原来不在 required 里，描述又说「从 1 开始」，
       不传时行为未定义（宿主按 1 处理还是报错取决于实现）。标成必填，少一层歧义。 */
    ["path", "start_line"]);

def("file_info", "查文件或目录的大小、修改时间、类型。",
    { path: { type: "string", description: "目标路径" } },
    ["path"]);

def("file_exists", "判断路径是否存在。改文件前先查一下，避免误判。",
    { path: { type: "string", description: "目标路径" } },
    ["path"]);

def("file_grep", "在文件内容里搜正则，返回带行号的匹配结果。找代码、找关键词用这个。",
    {
        path: { type: "string", description: "要搜的目录或文件路径" },
        pattern: { type: "string", description: "正则表达式" },
        file_pattern: { type: "string", description: "文件名过滤，如 *.js" },
        context_lines: { type: "integer", description: "匹配行前后各带几行上下文，默认 3" },
        max_results: { type: "integer", description: "最多返回多少条匹配，默认 100" },
        case_insensitive: { type: "boolean", description: "是否忽略大小写" }
    },
    ["path", "pattern"]);

def("find_files", "按文件名模式找文件（递归）。",
    {
        path: { type: "string", description: "搜索起点目录" },
        pattern: { type: "string", description: "文件名模式，如 *.jpg" },
        max_depth: { type: "integer", description: "递归深度，-1 表示不限" },
        case_insensitive: { type: "boolean", description: "是否忽略大小写" },
        use_path_pattern: { type: "boolean", description: "pattern 是否按完整路径匹配" }
    },
    ["path", "pattern"]);

def("list_files", "列一个目录下的直接子项（不递归）。",
    { path: { type: "string", description: "目录绝对路径" } },
    ["path"]);

/* 【第八十三轮补丁C】grep_code / grep_context 之前不在表里，
   子代理任务里调用它们会被 sb_llm 包成 run_tool({tool,args})，
   面板上显示成「执行 run_tool」而不是「执行 grep_code」，看不出在干什么。
   补进表里让它们变成独立 function。 */
def("grep_code", "按正则搜代码内容，返回带上下文的匹配。找函数定义、找字符串出现在哪用这个。",
    {
        path: { type: "string", description: "搜索的目录或文件路径" },
        pattern: { type: "string", description: "正则表达式" },
        file_pattern: { type: "string", description: "文件名过滤，如 *.js，默认 *" },
        context_lines: { type: "integer", description: "匹配行前后上下文行数，默认 3" },
        max_results: { type: "integer", description: "最多返回多少条匹配，默认 100" },
        case_insensitive: { type: "boolean", description: "是否忽略大小写" }
    },
    ["path", "pattern"]);

def("grep_context", "按语义相关性搜内容（不是正则）。目录模式找出最相关文件，文件模式找出最相关代码段。",
    {
        path: { type: "string", description: "目录或文件路径" },
        intent: { type: "string", description: "想找什么，用自然语言描述" },
        max_results: { type: "integer", description: "返回条数，默认 10" },
        file_pattern: { type: "string", description: "目录模式下的文件名过滤" }
    },
    ["path", "intent"]);

/* ── 写文件 ── */
/* 【第四十八轮】create_file 用 new、write_file 用 content，同一语义两个键名，
   模型很容易把 content 传给 create_file。这里两个键都声明（new 仍必填，与宿主一致），
   并在描述里点明别名，减少「传了 content 但 new 缺失」被端点拒的情况。 */
def("create_file", "新建文件并写入完整内容。文件已存在会失败，改已有文件请用 edit_file。内容参数名是 new（不是 content）。",
    {
        path: { type: "string", description: "文件绝对路径" },
        new: { type: "string", description: "完整文件内容（必填，键名就是 new）" },
        content: { type: "string", description: "content 是 write_file 的键名，create_file 请改用 new" }
    },
    ["path", "new"]);

def("edit_file", "对已存在文件做局部替换。old 必须能在文件里唯一匹配到，否则会失败。",
    {
        path: { type: "string", description: "文件绝对路径" },
        old: { type: "string", description: "要被替换的原文片段（需唯一匹配）" },
        new: { type: "string", description: "替换成的新内容" }
    },
    ["path", "old", "new"]);

def("write_file", "写整个文件（覆盖或新建）。整文件重写用这个。",
    {
        path: { type: "string", description: "文件绝对路径" },
        content: { type: "string", description: "完整内容" }
    },
    ["path", "content"]);

def("delete_file", "删除文件或目录。目录需 recursive=true。不可恢复，动手前先确认路径。",
    {
        path: { type: "string", description: "目标路径" },
        recursive: { type: "boolean", description: "目录是否递归删除，默认 false" }
    },
    ["path"]);

def("move_file", "移动或重命名文件/目录。",
    {
        path: { type: "string", description: "源路径" },
        destination: { type: "string", description: "目标路径" }
    },
    ["path", "destination"]);

def("copy_file", "复制文件/目录。",
    {
        path: { type: "string", description: "源路径" },
        destination: { type: "string", description: "目标路径" }
    },
    ["path", "destination"]);

/* ── 执行命令 ── */
def("terminal", "在持久终端会话里执行命令，同一会话内上下文连贯（cd 会保持）。适合需要连续多步的场景。",
    {
        command: { type: "string", description: "要执行的命令" },
        timeoutMs: { type: "integer", default: 15000, description: "超时毫秒，建议显式传，默认 15000" },
        background: { type: "boolean", description: "true 则后台执行并立即返回，适合启动服务" }
    },
    ["command"]);

def("shell", "一次性执行 shell 命令，无会话状态。单条短命令用这个。",
    { command: { type: "string", description: "要执行的命令" } },
    ["command"]);

/* 这两个是只读工具，但名字里带 terminal，曾被 isWriteTool 误判成写类而永久不可用。
   第二十二轮在 sb_tools 的 READ_ONLY_TOOLS 里救回来了；这里补上 schema，
   否则 all=true 时模型根本看不见它们（runToolSchema 按 TOOLMETA.names() 展开）。 */
def("terminal_wait", "等待持久终端里上一条命令执行完成，返回它的输出。适合长命令分步取结果。",
    {
        sessionId: { type: "string", description: "目标会话 id，不传用当前对话的默认会话" },
        timeoutMs: { type: "integer", default: 300000, description: "超时毫秒，默认 300000" }
    },
    []);

def("terminal_getscreen", "获取持久终端当前可见屏幕内容（一屏，不含历史滚动缓冲）。命令卡住时用它看现场。",
    { sessionId: { type: "string", description: "目标会话 id，不传用当前对话的默认会话" } },
    []);

/* ── 网络 ── */
def("visit_web", "访问网页并提取正文信息。需要读取某个 URL 的内容时用。",
    {
        url: { type: "string", description: "网页地址" },
        include_image_links: { type: "boolean", description: "是否同时返回图片链接" }
    },
    ["url"]);

def("download_file", "从 URL 下载文件到本地。",
    {
        url: { type: "string", description: "文件 URL" },
        destination: { type: "string", description: "保存到的本地路径" }
    },
    ["url", "destination"]);

/* ── 包工具（`包名:工具名` 形式，第六十八轮补）──
 *
 * 为什么补这些：包工具不在内置表里，只能走 run_tool 转发，
 * 模型看不到它们的参数 schema，只能照 description 猜 —— 猜错就调失败。
 * 把常用的补进来，让它们也变成独立 function，模型能直接写
 * terminal({command:"ls", timeoutMs:30000}) 而不必包一层 run_tool。
 *
 * 覆盖原则：只补「高频 + 参数少但必须传对」的。
 * 参数特别多的（如 subagent_spawn 有 20 多个）不补，包 run_tool 反而清爽。
 */

/* super_admin:terminal —— 用户最常用的一条 */
def("super_admin:terminal", "在 Ubuntu 环境执行命令并收集输出。已挂载 sdcard 与 storage，可直接访问 Android 存储。建议每次显式传 timeoutMs，避免命令卡住。禁止用 set -e / set -o errexit，会让终端会话直接退出。",
    {
        command: { type: "string", description: "要执行的命令" },
        timeoutMs: { type: "integer", description: "超时毫秒，最低 3000。建议显式传，不传前台默认 15 秒", default: 15000 },
        background: { type: "boolean", description: "true = 后台执行立即返回，适合启动服务器这类长任务。默认 false" }
    },
    ["command"]);

def("super_admin:shell", "用 Shizuku/Root 权限直接执行 Android 系统命令（pm / am / settings 等）。系统级操作，慎用。",
    { command: { type: "string", description: "要执行的 shell 命令" } },
    ["command"]);

/* subagent 自己的工具里，子代理最常回调用这两个 */
def("subagent:subagent_skill", "看可用 skill 清单或读某个 SKILL.md 全文。action=list 列清单，action=read 配 name 读全文。",
    {
        action: { type: "string", description: "list（默认）看清单 / read 读全文" },
        name: { type: "string", description: "skill 名，action=read 时必填" }
    },
    []);

/* deepseek 搜索三件套 */
def("deepseek_search:deepseek_search", "用 DeepSeek 搜索引擎搜网页，返回标题/链接/摘要/发布时间/权威度。支持 site: / lang: / after: / before: / \"精确短语\" / -排除 等算子。",
    {
        query: { type: "string", description: "搜索词，支持算子" },
        count: { type: "integer", description: "返回条数 1-50，默认 10" },
        site: { type: "string", description: "限定站点，多个用 OR" },
        after: { type: "string", description: "发布日期下限，如 2025-01-01" },
        before: { type: "string", description: "发布日期上限" },
        lang: { type: "string", description: "语言，可多个如 zh,en" }
    },
    ["query"]);

def("deepseek_fetch:deepseek_fetch", "抓取单个网页并返回 Markdown 正文。适合在搜索后深入阅读某一篇。",
    { url: { type: "string", description: "网页地址，http/https" } },
    ["url"]);

/* 网页访问（内置表已有 visit_web，这里补 download 之外常用的） */
def("extended_http_tools:http_get", "直接发 HTTP GET 请求并返回响应体。要看接口原始返回时用。",
    {
        url: { type: "string", description: "请求地址" },
        headers: { type: "string", description: "请求头 JSON 字符串，如 {\"Referer\":\"...\"}" }
    },
    ["url"]);

/* ── 查表接口 ── */

/* 按名字取一个工具的元数据；表里没有返回 null。 */
function get(name) {
    return Object.prototype.hasOwnProperty.call(T, name) ? T[name] : null;
}

/* 名字是否在表里。 */
function has(name) {
    return Object.prototype.hasOwnProperty.call(T, name);
}

/* 全部已收录的工具名（供诊断/文档用）。 */
function names() {
    var out = [];
    for (var k in T) if (Object.prototype.hasOwnProperty.call(T, k)) out.push(k);
    return out;
}

module.exports = { get: get, has: has, names: names, table: T };