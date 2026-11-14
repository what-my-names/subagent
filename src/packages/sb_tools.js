/* sb_tools.js — 工具代理：白名单、写类校验、undo 备份、执行与序列化 */
"use strict";
/* 【第七十三轮】工具调用失败诊断：缺必填 / 参数名错 / 类型错。
   只用于失败分支拼错误信息，不影响正常路径。require 失败也不报错 */
var DIAG = null;
try { DIAG = require("./sb_diag.js"); } catch (eDiag) { DIAG = null; }
function _diag(toolName, args, errText) {
    try {
        if (!DIAG) return String(errText == null ? "" : errText);
        return DIAG.attach(toolName, args, errText);
    } catch (e) { return String(errText == null ? "" : errText); }
}

/* ── ctx 契约（由 sb_task.js 构造并传入 runOne / undoAll）──
   ctx = {
     allowed:   string[]  允许的工具名，支持通配与 包名:工具名；[] = 全拒
     workspace: string    写入根（旧字段，仍读）；roots 存在时优先用 roots
     roots:     string[]  写入根列表（workspace + productDir），写类工具任一命中即通过
     productDir:string    本任务产物目录，undo 备份落在 <productDir>/.undo/<seq>/
     maxChars:  number    工具结果截断上限，0 = 不截断
     nextSeq:   () => number      取下一个 undo 序号（自增，内存级）
     loadUndo:  () => object[]    读当前 undo 记录数组
     appendUndo:(recs) => void    追加 undo 记录
     clearUndo: () => void        清空 undo（撤销完成后调）
   }
   跨文件维护时注意：这几个成员只在 sb_task.js 里构造，其它地方不要自己造 ctx。 */

/* 写类工具分两组，因为「写」和「能提取出路径」不是一回事：
   - WRITE_TOOLS：写目标在参数里，必须过路径校验 + 备份
   - WRITE_NO_PATH_TOOLS：确实会写盘，但参数里没有可提取的路径（命令是自由文本）。
     这类不做路径校验，只要求任务有 workspace 作为 cwd 边界，并在结果里明确标注
     「不受写范围约束」——让上层知道这层防不住。
   为什么拆开：terminal / shell 原来放在 WRITE_TOOLS 里，而 PATH_KEYS 一个都不命中，
   于是 runOne 无条件报「写类工具无法确定路径参数」，只要进白名单就必挂。 */
var WRITE_TOOLS = {
    create_file: true, edit_file: true, write_file: true, delete_file: true,
    move_file: true, copy_file: true, apply_file: true, zip_files: true, unzip_files: true,
    download_file: true
};
/* 无路径写工具：会写，但没法从参数里确定目标路径。
   terminal_exec 是 terminal 的别名，一起归到这里。 */
var WRITE_NO_PATH_TOOLS = {
    terminal: true, shell: true, terminal_exec: true
};

var PATH_KEYS = ["path", "file", "file_path", "source", "src", "dest", "destination", "target"];
/* 明确只读的工具白名单：这些名字里带 terminal/shell 字样（terminal_wait、terminal_getscreen），
   但只读不写。不排除的话会被下面的正则判成写类，
   进而在 runOne 里走「写类必须能提取路径参数」分支 —— 而它们的参数里没有路径，
   结果就是这两个工具永远报「无法确定路径参数」，等于不可用。
   【第四十八轮】download_file 已从本名单移出：它的 destination 是实打实的写目标，
   留在这里会让写范围检查和 undo 备份全部被跳过（子代理可下载到任意可写路径）。 */
var READ_ONLY_TOOLS = {
    read_file: true, read_file_part: true, list_files: true, file_info: true, file_exists: true,
    file_grep: true, find_files: true, visit_web: true,
    terminal_wait: true, terminal_getscreen: true, terminal_read: true,
    web_search: true, chat: true
};
function isWriteTool(name) {
    var n = String(name || "");
    if (READ_ONLY_TOOLS[n]) return false;
    if (WRITE_TOOLS[n]) return true;
    if (WRITE_NO_PATH_TOOLS[n]) return true;
    var lower = n.toLowerCase();
    /* 兜底正则只认「写动词出现在词首或词尾」的形态，
       避免 terminal_wait 这类「写动词前缀 + 只读后缀」被误判 */
    return /(^|[_:-])(write|edit|create|delete|move|copy|apply|zip|unzip|terminal|shell|download)([_:-]|$)/.test(lower)
        && !/(_wait|_getscreen|_read|_status|_list|_info|_show|_get)$/.test(lower);
}
/* 是否是「无路径写工具」：不做路径提取，但要求有 workspace 作 cwd 边界 */
function isNoPathWriteTool(name) {
    var n = String(name || "");
    if (WRITE_NO_PATH_TOOLS[n]) return true;
    var lower = n.toLowerCase();
    return /(^|[_:-])(terminal|shell)([_:-]|$)/.test(lower)
        && !/(_wait|_getscreen|_read|_status|_list|_info|_show|_get)$/.test(lower);
}
/* 本包工具名形态：subagent_ + 已知动词/名词。
   为什么用白名单动词而不是 `subagent_` 前缀：
   subagent_helper 也是 subagent_ 开头，但 helper 不是本包工具。 */
var OWN_TOOL_RE = /^subagent_(spawn|advance|wait|status|result|undo|cancel|resume|steer|inbox|list|close|delete|config|templates|probe|version|check_update|download_update|download_status|install_update|open_mail|open_url|trace|workspace|list_dir|check_path|save_turn|stream_flush|tool_once|stream_ctx|stream_key|stream_relay|chats|tools|vendor_js|skill)$/;

function isRecursive(name) {
    var n = String(name || "");
    if (!n) return false;
    /* 【第四十九轮】原来是纯前缀匹配 `n.indexOf("subagent") === 0`，
       会把用户自己的 subagent_helper / subagent_tool / subagentx 全部误杀。
       收紧后要同时满足两件事：
         ① 本包自身与它的工具（subagent / subagent:* / subagent_xxx）必须拦
         ② 第三方同名包（subagent_helper）不能误杀
       区分点：本包工具名形如 subagent_spawn（下划线），
       第三方包名后面跟的是别的词。这里用「本包工具名清单」精确判定，
       不靠猜前缀。 */
    var low = n.toLowerCase();
    if (low === "subagent" || low === "subagent:*") return true;
    /* 【第七十三轮】间接递归：子代理调 workflow 触发一个会派活的工作流，
       工作流里再派子代理 -> 绕过了名字前缀拦截。
       这里拦「能派活的工作流类工具」：workflow 包里带 run / trigger / exec / start 的。
       保守起见不拦整个 workflow 包（读列表/看详情仍可用）。 */
    if (/workflow[:._-]/.test(low) && /(run|trigger|exec|start|invoke)/.test(low)) return true;
    if (low === "workflow:workflow_run" || low === "workflow:run") return true;
    if (low.indexOf("subagent:") === 0) return true;
    if (low === "*:subagent" || low === "*:subagent:*") return true;
    /* 通配符里带 subagent 也算（`*subagent*` 这种明显是冲本包来的） */
    if (low.indexOf("*") >= 0 && low.indexOf("subagent") >= 0) return true;
    /* 本包工具名：subagent_xxx 形式。用清单判定，避免误杀 subagent_helper。
       OWN_TOOLS 由 subagent.js 的 METADATA 提供，这里只做名字形态兜底：
       本包所有工具都是 subagent_ 开头且后面紧跟已知工具动词。 */
    if (OWN_TOOL_RE.test(low)) return true;
    return false;
}

/* 白名单 glob 匹配。
   为什么要转义：原来直接 p.split("*").join(".*") 丢进 new RegExp，
   白名单写 "a.b" 会匹配到 "axb"，写 "my(pkg):tool" 直接抛 SyntaxError
   把整个 runOne 崩掉。白名单是用户输入，不能假设干净。 */
function globToRegExp(p) {
    var s = String(p || "");
    var out = "^";
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (c === "*") { out += ".*"; continue; }
        /* 其它字符一律按字面量转义，只保留 * 作为通配 */
        if ("\\^$+.()[]{}|?/".indexOf(c) >= 0) out += "\\" + c;
        else out += c;
    }
    return out + "$";
}
function matchOne(name, pat) {
    var p = String(pat || "").trim();
    if (!p) return false;
    if (p === name) return true;
    if (p.indexOf("*") >= 0) {
        try {
            return new RegExp(globToRegExp(p)).test(name);
        } catch (e) {
            /* 兜底：正则构造失败就退回字面比较，绝不让异常冒到 runOne */
            return false;
        }
    }
    /* 【第四十八轮】原来这里是 `name.indexOf(p + ":") === 0`，
       会把「白名单写 read_file」当成「放行 read_file:任意后缀」，
       于是 read_file:evil 这类伪造名直接通过白名单。
       包工具的真实形态是 `包名:工具名`，只有「白名单本身就是包名」时
       才该放行它的下级工具。这里改成：p 不含冒号时，只放行 p 本身，
       要放行整包必须显式写 `pkg:*` 或 `pkg:具体工具`。 */
    return false;
}

function matchAllowed(name, allowed) {
    if (!allowed || !allowed.length) return false;
    for (var i = 0; i < allowed.length; i++) {
        if (matchOne(name, allowed[i])) return true;
    }
    return false;
}

function extractPaths(args) {
    var out = [];
    if (!args || typeof args !== "object") return out;
    /* 【第六十七轮】原来只读顶层键 + 递归 args/params 两个键。
       但转发型调用（run_tool）与部分包工具会把真正参数放在任意嵌套对象里，
       只认 args/params 会漏掉路径，写边界就等于没查 —— 后门。
       【第六十八轮】改为「递归所有对象类型的一层值」：
       顶层标量键按 PATH_KEYS 取；顶层每个对象值再递归调一次 extractPaths。
       仍只递归一层（递归函数自身不再往下），避免深层嵌套把栈打爆。
       上限：最多看 20 个嵌套键，防参数里塞一堆无用对象拖慢校验。 */
    var seen = 0;
    for (var key in args) {
        if (!Object.prototype.hasOwnProperty.call(args, key)) continue;
        var v0 = args[key];
        if (v0 && typeof v0 === "object" && !Array.isArray(v0)) {
            if (seen >= 20) continue;
            seen++;
            var sub0 = extractPaths(v0);
            for (var s0 = 0; s0 < sub0.length; s0++) out.push(sub0[s0]);
        }
    }
    for (var i = 0; i < PATH_KEYS.length; i++) {
        var k = PATH_KEYS[i];
        if (args[k] != null) {
            var v = String(args[k]);
            if (v) out.push(v);
        }
    }
    return out;
}

/* 路径规范化：折叠重复斜杠、去掉结尾斜杠、把 . 与 .. 段解掉。
   为什么必须做：原来只做字符串前缀比较，`/sdcard/x/../etc/passwd` 会因为
   字面以 `/sdcard/x` 开头而通过检查 —— 写类工具的边界形同虚设（实测可绕）。
   这里按 posix 规则逐段折叠；`..` 越出根就保留在栈顶，最终仍会被 inRoot 拒掉。 */
function normPath(p) {
    var s = String(p == null ? "" : p);
    if (!s) return "";
    /* 【第四十八轮】两个绕过面：
       ① URL 编码的 .. （%2e%2e）与斜杠（%2f）原样保留，
          检查时看着在根内，落到宿主文件 API 可能被解码成 .. 逃出去。
          → 先解码一轮再规范化。
       ② NUL 字节会被部分底层截断，导致「检查的是 A、写的是 B」。
          → 直接拒绝，不尝试清洗。 */
    if (s.indexOf("\u0000") >= 0) return "";
    try { s = decodeURIComponent(s); } catch (eD) { /* 非法编码保持原样，后面按字面判断 */ }
    if (s.indexOf("\u0000") >= 0) return "";
    s = s.replace(/\\/g, "/");
    var abs = s.charAt(0) === "/";
    var parts = s.split("/");
    var stack = [];
    for (var i = 0; i < parts.length; i++) {
        var seg = parts[i];
        if (!seg || seg === ".") continue;
        if (seg === "..") {
            if (stack.length && stack[stack.length - 1] !== "..") stack.pop();
            else if (!abs) stack.push("..");
            /* 绝对路径下 .. 越出根 = 丢弃，等价于被钳在 / */
            continue;
        }
        stack.push(seg);
    }
    return (abs ? "/" : "") + stack.join("/");
}

function inRoot(p, root) {
    var path = normPath(p);
    var r = normPath(root);
    if (!r) return false;
    /* 规范化后仍含 .. 的相对路径，一律判越界（宁可错杀） */
    if (path === ".." || path.indexOf("../") === 0) return false;
    if (!path) return false;
    /* root 就是 "/" 时不能走 r + "/" 拼前缀：那会变成 "//"，indexOf 永远 -1，
       除了根目录本身什么都过不了。根就是根，任意绝对路径都在里面。 */
    if (r === "/") return path.charAt(0) === "/";
    return path === r || path.indexOf(r + "/") === 0;
}
/* 注意：本函数只做字面路径规范化，**不解析 symlink**。
   如果 workspace 内存在指向外部的符号链接（如 /workspace/link -> /etc），
   字面上它仍在 root 内，实际写入会落到外面。Android 沙箱下 symlink 不常见，
   但 workspace 是用户可写目录时这是一条 TOCTOU 逃逸面。
   真要防需要 realpath 解析，宿主 Tools.Files 没有暴露该能力，此处明确不做。 */

function rootsOf(ctx) {
    if (ctx && Array.isArray(ctx.roots)) return ctx.roots.filter(function (x) { return !!x; });
    if (ctx && ctx.workspace) return [ctx.workspace];
    return [];
}

function inAnyRoot(p, roots) {
    for (var i = 0; i < roots.length; i++) {
        if (inRoot(p, roots[i])) return true;
    }
    return false;
}

function clip(text, n) {
    var s = String(text == null ? "" : text);
    if (!n || s.length <= n) return { text: s, truncated: false, chars: s.length };
    /* 【第四十八轮】按 UTF-16 code unit 直接 slice 可能切在代理对中间
       （emoji、部分 CJK 扩展区），产生半个字符（显示成乱码方块）。
       这里回退到代理对边界：若截断点落在高代理位后，往前挪一位。
       没用 Array.from 是为了不改 chars 语义（chars 仍报原始长度）。 */
    var cut = n;
    if (cut > 0) {
        var code = s.charCodeAt(cut - 1);
        if (code >= 0xD800 && code <= 0xDBFF) cut -= 1;
    }
    /* 【第五十六轮】不再往正文里拼「已截断，原长 N 字符」。
       用户反复要求「不要截断」，也不接受正文里出现这种提示。
       截断与否只放在 truncated 标志里，由调用方决定怎么处理。 */
    return { text: s.slice(0, cut), truncated: true, chars: s.length };
}

function serialize(value) {
    try {
        if (typeof value === "string") return value;
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
}

async function exists(path) {
    try {
        var r = await Tools.Files.exists(path, "android");
        return !!(r && r.exists);
    } catch (e) { return false; }
}

async function backupBeforeWrite(ctx, toolName, args, seq) {
    var names = [];
var paths = extractPaths(args);
    var undoDir = ctx.productDir + "/.undo/" + seq;
    var roots = rootsOf(ctx);
    for (var i = 0; i < paths.length; i++) {
        var p = paths[i];
        if (!inAnyRoot(p, roots)) continue;
        var ex = await exists(p);
        var base = p.split("/").pop() || "file";
        if (ex) {
            try {
                await Tools.Files.mkdir(undoDir, true, "android");
                var dst = undoDir + "/" + (i + 1) + "_" + base;
                await Tools.Files.copy(p, dst, false, "android", "android");
                names.push({ type: "restore", path: p, backup: dst, tool: toolName });
            } catch (e) {
                /* 【第四十八轮】原来这里是空 catch：copy 失败时这条记录压根不 push，
                   于是文件「没备份但被写了」，undo 也恢复不了，而且没有任何痕迹。
                   改成记一条 warn，让 undo 列表里能看到「这个文件没备份成功」。 */
                names.push({
                    type: "warn", path: p, backup: null, tool: toolName,
                    error: String((e && e.message) || e)
                });
            }
        } else {
            names.push({ type: "remove", path: p, backup: null, tool: toolName });
        }
    }
    return names;
}

/* 工具名清洗：模型有时把 Operit 内部传参编码串整段塞进 tool 字段，
   形如 "visit_web<tool_sep:xxx><arg_key:xxx>args</arg_key>..."，
   直接比对白名单必然失败（表现为「工具不在允许范围」但错误里又列出了该工具）。
   截断到第一个 '<' 之前，再去掉空白。 */
function cleanToolName(raw) {
    var name = String(raw || "").trim();
    var lt = name.indexOf("<");
    if (lt >= 0) name = name.slice(0, lt).trim();
    return name.replace(/\s+/g, "");
}

/* 对一次「真实要执行」的工具调用做写边界校验。
   抽成独立函数是因为 run_tool 要递归校验内层工具，逻辑必须复用同一份。
   in  : ctx, 工具名, 参数
   out : { ok:true, recs:[] } 或 { ok:false, error:"..." }
   recs 是备份记录，调用方负责 appendUndo。 */
/* ── 命令内容检测（第五十轮）──
   用户要求：后端在执行前检测参数内容，检测到危险就不调 ctx.callTool，直接拒。
   这是尽力而为的检测，不是完备沙箱——base64、变量拼接、外部脚本仍可绕过。
   但能挡住绝大多数直白误用与模型乱来，比「一个字符不查」强得多。
   in : 命令文本, 允许根目录数组
   out: { ok:true } 或 { ok:false, reason:"..." } */
/* ── 命令安全判定（第五十二轮，按用户拍板重做）──
   背景：宿主 AIToolHandler 只检查「主 agent 的权限模式 + 主 agent 的 workspace」，
   子代理任务的 workspace 宿主根本不知道。所以子代理这层的边界只能我们自己做。
   参考：TanStack AI Sandbox Policy、docker-agent permissions——两者都是
den>ask>allow + 未匹配走 default，且都明说「permissions 停意外，不是安全边界」。

   设计原则（用户定调）：
   1. 脚本执行默认禁止，建任务时显式开启（allowDanger=true）。
   2. 硬红线永远拒，不受 allowDanger 影响。
   3. 路径越界永远拒。
   4. 不做「只读命令白名单」那套——上一版把 sed/awk/find 当只读，
      实际上它们都能写（sed -i / awk system( / find -delete），自己做成了后门。 */

/* 硬红线：任何档位都拒，包括 allowDanger=true。
   这些命令在子代理任务里没有任何正当理由，放行了只会让用户事后问「为什么不拦」。 */
var CMD_HARD_DENY = [
    { re: /(^|[;&|(\s])(rm)\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)*(\/|\/\*|~|\$HOME)(\s|$)/, why: "rm 指向根目录或家目录" },
    { re: /(^|[;&|(\s])(mkfs|mke2fs|fdisk|parted|dd)\b/, why: "磁盘级破坏命令" },
    { re: /(^|[;&|(\s])(shutdown|reboot|halt|poweroff)\b/, why: "关机/重启" },
    { re: /(^|[;&|(\s])(chown|chmod)\s+(-[a-zA-Z]+\s+)*[0-7]{3,4}\s+\/(\s|$)/, why: "改根目录权限" },
    { re: /(^|[;&|(\s])(sudo|su|doas)\b/, why: "提权命令" },
    { re: />>?\s*(\/|\/\*|~\/|\$HOME\/?)(\s|$|;|&)/, why: "重定向到根目录" },
    { re: /(^|[;&|]\s*)cd\s+(\/|~|\$HOME)(\s|$|;|&)/, why: "cd 到根目录或家目录" }
];

/* 危险命令：脚本执行类。allowDanger=false 时拒，true 时放行。 */
var CMD_DANGER = [
    /* 直接调 shell 解释器：sh file.sh / bash -c "…" 都一样，内容不可静态判 */
    { re: /(^|[;&|(\s])(sh|bash|zsh|dash|ksh|fish|csh)\b/, why: "调用 shell 解释器执行脚本" },
    /* source / . 引入脚本 */
    { re: /(^|[;&|(\s])(source|\.)\s+[\w\.\/\-]+/, why: "source 引入脚本" },
    /* 解释器带 -c / -e 内联执行 */
    { re: /(^|[;&|(\s])(python3?|perl|ruby|node|php|lua)\s+-[a-zA-Z]*[ce]\s/, why: "内联脚本执行" },
    /* 参数里出现脚本文件扩展名 */
    { re: /[\w\-\.\/]+\.(sh|bash|zsh|ksh|py|pl|rb|php|lua|bat|ps1)(\s|$|;|&|\))/, why: "执行脚本文件" },
    /* 动态执行 */
    { re: /(^|[;&|(\s])(eval|exec)\s/, why: "动态执行" },
    /* 命令替换：内容不可静态判断 */
    { re: /\$\([^)]*\)/, why: "命令替换 $(...) 无法静态校验" },
    { re: /`[^`]*`/, why: "反引号命令替换无法静态校验" },
    /* 下载后直接执行 */
    { re: /\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh|python|perl|node)\b/, why: "下载后直接执行" },
    /* 解码后直接执行 */
    { re: /\|\s*(base64|xxd|uudecode|openssl)\b[^|]*\|\s*(sh|bash|zsh|python|perl|node)\b/, why: "解码后直接执行" }
];

/* 从命令里粗提绝对路径，用于校验是否越出 workspace。
   只看以 / 或 ~/ 开头的 token（相对路径按 cwd 算，cwd 已限定在 workspace）。 */
function extractCmdPaths(cmd) {
    var out = [];
    var s = String(cmd || "");
    var re = /(?:^|[\s'"=<>|;&(])((?:\/|~\/)[^\s'"|;&<>)]*)/g;
    var m;
    while ((m = re.exec(s)) !== null) {
        var p = String(m[1] || "").trim();
        if (p) out.push(p);
    }
    return out;
}

/* 命令安全判定。
   in : cmd 命令文本, roots 允许的写入根目录数组, allowDanger 是否允许危险命令
   out: { ok:true, paths } 或 { ok:false, reason }
   顺序：硬红线 → 路径越界 → 危险命令（allowDanger=false 时） */
function analyzeCommand(cmd, roots, allowDanger) {
    var s = String(cmd == null ? "" : cmd);
    if (!s.trim()) return { ok: false, reason: "命令为空" };

    /* ① 硬红线：始终执行，不看 allowDanger */
    for (var i = 0; i < CMD_HARD_DENY.length; i++) {
        if (CMD_HARD_DENY[i].re.test(s)) {
            return { ok: false, reason: "命令被拒绝：" + CMD_HARD_DENY[i].why };
        }
    }

    /* ② 路径越界：始终执行 */
    var paths = extractCmdPaths(s);
    for (var j = 0; j < paths.length; j++) {
        var p = paths[j];
        if (p === "/" || p === "~" || p === "~/") {
            return { ok: false, reason: "命令引用了根目录或家目录：" + p };
        }
        if (p.indexOf("~/") === 0) {
            return { ok: false, reason: "命令引用了家目录路径：" + p };
        }
        if (!inAnyRoot(p, roots)) {
            return { ok: false, reason: "命令里的路径越界：" + p + "，只允许操作 " + roots.join(" 或 ") };
        }
    }

    /* ③ 危险命令：默认拒，allowDanger=true 才放行 */
    if (allowDanger !== true) {
        for (var k = 0; k < CMD_DANGER.length; k++) {
            if (CMD_DANGER[k].re.test(s)) {
                return {
                    ok: false,
                    reason: "命令被拒绝：" + CMD_DANGER[k].why +
                        "。本任务未开启「允许危险命令」，如需执行请建任务时传 allow_danger=true 或在面板打开该开关"
                };
            }
        }
    }

    return { ok: true, paths: paths, allowDanger: allowDanger === true };
}

async function checkWriteBoundary(ctx, name, args) {
    var wroots = rootsOf(ctx);
    if (!wroots.length) {
        return { ok: false, error: "写类工具需要 workspace，但本任务没有可用的写入范围" };
    }
    /* 无路径写工具（terminal / shell）：命令是自由文本，不能提路径做精确校验，
       但【必须先做内容检测】——检测到危险就直接拒，绝不调 ctx.callTool。
       这是用户明确要求的行为：后端拦内容，不发给桥。
       检测范围见 analyzeCommand；这是尽力而为，不是完备沙箱。 */
    if (isNoPathWriteTool(name)) {
        var cmd = String(args && (args.command != null ? args.command : args.cmd) || "");
        var chk = analyzeCommand(cmd, wroots, ctx.allowDanger === true);
        if (!chk.ok) {
            return { ok: false, error: chk.reason };
        }
        return { ok: true, recs: [], noPathGuard: true, checkedPaths: chk.paths || [], allowDanger: chk.allowDanger === true };
    }
    var paths = extractPaths(args);
    if (!paths.length) {
        return { ok: false, error: "写类工具无法确定路径参数（支持键名：" + PATH_KEYS.join("/") + "）" };
    }
    for (var i = 0; i < paths.length; i++) {
        if (!inAnyRoot(paths[i], wroots)) {
            return { ok: false, error: "路径越界：" + paths[i] + "，只允许写在 " + wroots.join(" 或 ") };
        }
    }
    var recs = await backupBeforeWrite(ctx, name, args, ctx.nextSeq());
    return { ok: true, recs: recs };
}
async function runOne(ctx, request) {
    var rawName = String(request && request.tool ? request.tool : "").trim();
    var name = cleanToolName(rawName);
    var args = (request && request.args && typeof request.args === "object") ? request.args : {};
    if (!name) return { ok: false, tool: rawName, error: "缺少 tool" };
    if (isRecursive(name)) return { ok: false, tool: name, error: "禁止递归派子代理（名字以 subagent 开头的一律拒绝）" };
    if (!matchAllowed(name, ctx.allowed)) {
        return { ok: false, tool: name, error: "工具不在允许范围：" + name + "。允许：" + ctx.allowed.join(", ") };
    }
    var write = isWriteTool(name);
    var noPathGuard = false;
    /* 【第四十八轮·关键修复】run_tool 的特判必须在 if (write) 外面。
       原来写在里面，而 isWriteTool("run_tool") === false（它既不在 WRITE_TOOLS，
       名字里也没有写动词），所以整块代码永远不执行 —— 后门是完全敞开的。
       实测：node -e "require('./sb_tools').isWriteTool('run_tool')" → false。
       现在改成「先按名字判 run_tool，再判写类」，两条路互不依赖。 */
    if (name === "run_tool") {
        var innerRaw = String(args.tool || "").trim();
        var inner = cleanToolName(innerRaw);
        var innerArgs = (args.args && typeof args.args === "object") ? args.args
            : ((args.params && typeof args.params === "object") ? args.params : {});
        if (!inner) return { ok: false, tool: name, error: "run_tool 缺少内层 tool" };
        if (isRecursive(inner)) return { ok: false, tool: name, error: "禁止递归派子代理（内层 " + inner + "）" };
        /* 内层工具也必须在白名单里，否则 run_tool 就成了白名单后门 */
        if (!matchAllowed(inner, ctx.allowed)) {
            return { ok: false, tool: name, error: "内层工具不在允许范围：" + inner };
        }
        /* 内层是写类才需要过写边界；只读工具不必拦 */
        if (isWriteTool(inner)) {
            var r0 = await checkWriteBoundary(ctx, inner, innerArgs);
            if (!r0.ok) return { ok: false, tool: name, error: "run_tool 内层校验失败：" + r0.error };
            if (r0.recs && r0.recs.length) ctx.appendUndo(r0.recs);
            if (r0.noPathGuard) noPathGuard = true;
        }
    } else if (write) {
        var r1 = await checkWriteBoundary(ctx, name, args);
        if (!r1.ok) return { ok: false, tool: name, error: r1.error };
        if (r1.recs && r1.recs.length) ctx.appendUndo(r1.recs);
        if (r1.noPathGuard) noPathGuard = true;
    }
    var out, err = null;
    var tTool = Date.now();
    /* 【第四十九轮】把 workspace 作为 cwd 传下去。
       原来只把 workspace 放进 ctx，调用时却是 toolCall(name, args)，
       cwd 根本没传 —— 注释里写的「以 workspace 作 cwd 边界」是假的。
       这里补一个 cwd 字段；宿主若不认这个字段会忽略，不会报错。
       注意：这不是安全边界（terminal 仍可 cd 走），只是让默认落点正确。 */
    var callArgs = args;
    if (ctx.workspace && name !== "run_tool") {
        if (!callArgs || typeof callArgs !== "object") callArgs = {};
        else {
            /* 浅拷贝，避免改动调用方传进来的对象 */
            var copy = {};
            for (var ck in callArgs) { if (Object.prototype.hasOwnProperty.call(callArgs, ck)) copy[ck] = callArgs[ck]; }
            callArgs = copy;
        }
        if (callArgs.cwd == null) callArgs.cwd = ctx.workspace;
    }
    try {
        out = await _withTimeout(toolCall(name, callArgs), toolTimeoutOf(ctx), name);
    } catch (e) {
        err = String((e && e.message) || e);
    }
    var ms = Date.now() - tTool;
    /* 【第七十三轮】失败时补结构化诊断：缺必填 / 参数名错 / 类型错。
       只拼在 error 里，不改白名单与写边界任何行为。 */
    if (err) return { ok: false, tool: name, error: _diag(name, callArgs, err), ms: ms };
    var text = serialize(out);
    var c = clip(text, ctx.maxChars);
    var res = { ok: true, tool: name, chars: c.chars, ms: ms, truncated: c.truncated, result: c.text };
    /* 无路径写工具必须显式告知：这层只锁了 workspace 存在，没锁命令往哪写 */
    if (noPathGuard) {
        res.note = "该工具会写盘，但命令是自由文本，无法做路径校验，不受 workspace 写范围约束";
    }
    return res;
}

/* ── 【第七十四轮】工具级超时与循环检测 ──
 *
 * 为什么需要超时：
 *   原来 runOne 是裸 await，工具内部卡住就永久钉在那儿。
 *   super_admin:terminal 自己管 timeoutMs，但包工具五花八门，外层没有任何保险，
 *   用户点「停止」也拦不住（cancel 只在进循环前查一次）。
 *
 * 为什么 120 秒：
 *   单步模型请求超时是 90 秒，工具超时设得比它宽一点，
 *   避免「工具还在正常跑，模型那层先超时」这种互相打架。
 *   需要更长的工具自己在 args 里传 timeoutMs，由工具自己管。
 */
var DEFAULT_TOOL_TIMEOUT_MS = 120000;
function toolTimeoutOf(ctx) {
    var n = Number((ctx && ctx.tool_timeout_ms) || 0);
    return n > 0 ? n : DEFAULT_TOOL_TIMEOUT_MS;
}
/* 给一个 promise 套超时。超时抛错，由 runOne 的 catch 接住转成 ok:false。
   注意：Promise.race 不能真正取消底层操作，只是让上层不再等。
   底层工具若真卡死，线程仍占着 —— 这是 JS 的固有限制，至少不会把整个任务锁死。 */
function _withTimeout(p, ms, toolName) {
    var limit = Number(ms) > 0 ? Number(ms) : DEFAULT_TOOL_TIMEOUT_MS;
    return new Promise(function (resolve, reject) {
        var done = false;
        var t = setTimeout(function () {
            if (done) return;
            done = true;
            reject(new Error("工具 " + String(toolName || "") + " 执行超时（超过 " + Math.round(limit / 1000)
                + " 秒）。如果是长命令，请在该工具参数里显式传 timeoutMs，或拆成几步跑"));
        }, limit);
        p.then(function (v) {
            if (done) return;
            done = true;
            try { clearTimeout(t); } catch (e) {}
            resolve(v);
        }, function (e) {
            if (done) return;
            done = true;
            try { clearTimeout(t); } catch (e2) {}
            reject(e);
        });
    });
}

/* 循环检测：同工具 + 同参数连续出现太多次 = 模型在原地打转。
 *
 * 为什么只看「连续」：模型合理地连读两个不同文件不该被判；
 * 只有一模一样地重复才算问题。
 * 为什么阈值 3：两次可能是重试，三次基本确定是卡住了。
 * 为什么不直接失败：给模型一次纠错机会 —— 回一条提示，让它换路。
 *   直接 fail 会让本来能救的任务白费。
 *
 * 入：task（读 turns）、name、args（对象）
 * 出：null = 没重复；否则 { times: N, key: 归一化后的签名 }
 */
var LOOP_MAX_SAME = 3;
var LOOP_SCAN = 8;          /* 往回扫几条 tool 消息 */
function _sigOf(name, args) {
    var a = (args && typeof args === "object") ? args : {};
    var keys = Object.keys(a).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) parts.push(keys[i] + "=" + JSON.stringify(a[keys[i]]));
    return String(name || "") + "|" + parts.join("&");
}
function detectLoop(task, name, args) {
    try {
        var turns = (task && task.turns) || [];
        var want = _sigOf(name, args);
        var times = 1;                     /* 算上这一次 */
        var scanned = 0;
        for (var i = turns.length - 1; i >= 0 && scanned < LOOP_SCAN; i--) {
            var t = turns[i] || {};
            if (String(t.role || "") !== "tool") continue;
            scanned++;
            /* args 在 turn 里是 JSON 字符串，解析回来比对 */
            var ta = {};
            try { ta = JSON.parse(String(t.args || "{}")); } catch (e) { ta = {}; }
            if (_sigOf(t.name, ta) === want) times++;
            else break;                    /* 不连续了，停 */
        }
        return times >= LOOP_MAX_SAME ? { times: times, key: want } : null;
    } catch (e) {
        return null;
    }
}

async function undoAll(ctx, dryRun) {
    var list = ctx.loadUndo().slice().reverse();
    var plan = [];
    for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        plan.push({ type: it.type, path: it.path, backup: it.backup });
        if (dryRun) continue;
        try {
            if (it.type === "restore" && it.backup) {
                await Tools.Files.copy(it.backup, it.path, false, "android", "android");
            } else if (it.type === "remove") {
                await Tools.Files.deleteFile(it.path, false, "android");
            }
        } catch (e) {}
    }
    if (!dryRun) ctx.clearUndo();
    return plan;
}

module.exports = {
    isWriteTool: isWriteTool,
    isNoPathWriteTool: isNoPathWriteTool,
    isRecursive: isRecursive,
    matchAllowed: matchAllowed,
    matchOne: matchOne,
    globToRegExp: globToRegExp,
    cleanToolName: cleanToolName,
    extractPaths: extractPaths,
    inRoot: inRoot,
    normPath: normPath,
    clip: clip,
    checkWriteBoundary: checkWriteBoundary,
    analyzeCommand: analyzeCommand,
    extractCmdPaths: extractCmdPaths,
    CMD_HARD_DENY: CMD_HARD_DENY,
    CMD_DANGER: CMD_DANGER,
    runOne: runOne,
    undoAll: undoAll,
    detectLoop: detectLoop,
    _sigOf: _sigOf,
    DEFAULT_TOOL_TIMEOUT_MS: DEFAULT_TOOL_TIMEOUT_MS,
    toolTimeoutOf: toolTimeoutOf,
    PATH_KEYS: PATH_KEYS,
    WRITE_TOOLS: WRITE_TOOLS,
    WRITE_NO_PATH_TOOLS: WRITE_NO_PATH_TOOLS,
    READ_ONLY_TOOLS: READ_ONLY_TOOLS
};