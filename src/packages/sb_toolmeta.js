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
        start_line: { type: "integer", description: "起始行号，从 1 开始" },
        end_line: { type: "integer", description: "结束行号（含），不传默认 start_line+99" }
    },
    ["path"]);

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

/* ── 写文件 ── */
def("create_file", "新建文件并写入完整内容。文件已存在会失败，改已有文件请用 edit_file。",
    {
        path: { type: "string", description: "文件绝对路径" },
        new: { type: "string", description: "完整文件内容" }
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
        timeoutMs: { type: "integer", description: "超时毫秒，建议显式传，默认 15000" },
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
        timeoutMs: { type: "integer", description: "超时毫秒，默认 300000" }
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