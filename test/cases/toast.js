/* test/cases/toast.js — 通知条语义 + 位置 + 手势断言
 *
 * 通知条是用户反复吐槽的地方，每条断言都对应一次真机反馈：
 *   - 「右上角全是反的」→ 成功事件用了 err()，红叉
 *   - 「太高挡住导航」→ 容器 top:10px 压在搜索栏上
 *   - 「滑动太阻塞」→ 竖向手势被 preventDefault 吞掉
 *   - 「先闪回去才消失」→ animation both + 飞出前 reset
 */
var A = require('../lib/assert.js').group('通知条');
var P = A.src('ui/web/panel.js');
var C = A.src('ui/web/panel.css');

/* ── 级别函数语义（成功不能用 err） ── */
A.match('err 定义为 err 级', P, /function err\(m\) \{ toast\(m, 'err'\); \}/);
A.match('okMsg 定义为 ok 级', P, /function okMsg\(m\) \{ toast\(m, 'ok'\); \}/);
A.match('warnMsg 定义为 warn 级', P, /function warnMsg\(m\) \{ toast\(m, 'warn'\); \}/);

/* ── 成功文案必须走 okMsg（本轮修的红叉问题） ── */
A.match('共 N 个模型 用 okMsg', P, /okMsg\('共 ' \+ list\.length/);
A.match('任务已停止 用 okMsg', P, /okMsg\('任务已停止'\)/);
A.match('已请求停止 用 okMsg', P, /okMsg\(\(r && r\.message\) \|\| '已请求停止'\)/);
A.match('已载入 N 个模型 用 okMsg', P, /okMsg\('已载入 ' \+ S\.allModels\.length/);
A.nomatch('不得 err(共 N 个模型', P, /err\('共 /);
A.nomatch('不得 err(任务已停止', P, /err\('任务已停止'\)/);
A.nomatch('不得 err(已请求停止', P, /err\('已请求停止'\)/);

/* ── 连通性按 connected 分流（不能一律红） ── */
A.match('连通正常走 okMsg', P, /pr\.connected === true[\s\S]{0,60}?okMsg\(pr\.verdict\)/);

/* ── 进行中提示走 info 级 ── */
A.match('正在拉取走 info', P, /toast\('还没有模型列表，正在拉取…', 'info'\)/);

/* ── 图标：ok 是勾、err 是叉 ── */
A.match('TST_SVG.ok 是勾形', P, /ok: '<svg[^']*M8 12\.4l2\.6 2\.6L16 9\.6/);
A.match('TST_SVG.err 是叉形', P, /err: '<svg[^']*M8\.6 8\.6l6\.8 6\.8/);
A.match('toast level 白名单正确', P, /level === 'ok' \|\| level === 'warn' \|\| level === 'err'/);

/* ── 位置：右下角，不压导航 ── */
A.match('容器在右下角', C, /#toastStack\{position:fixed;bottom:calc\(78px/);
A.nomatch('容器不再 top:10px', C, /#toastStack\{position:fixed;top:10px/);
A.match('有 safe-area 适配', C, /bottom:calc\(78px \+ env\(safe-area-inset-bottom/);

/* ── 动画填充模式（闪回根因） ── */
A.match('入场动画用 backwards', C, /animation:tstIn[^}]*backwards\}/);
A.nomatch('入场动画不得用 both', C, /animation:tstIn[^}]*both\}/);
A.match('退场动画用 forwards', C, /\.tst\.out\{animation:tstOut[^}]*forwards\}/);
A.match('pointerdown 清 animation', P, /el\.style\.animation = 'none';/);
A.match('killToast 飞出前清 animation', P, /el\.style\.animation = 'none';[\s\S]{0,140}?el\.style\.transition = 'none';/);

/* ── 飞出时不能先 reset（闪回第二根因） ── */
A.nomatch('飞出前不调 reset', P, /if \(dist >= TST_SWIPE_MIN\) \{[\s\S]{0,200}?reset\(\);[\s\S]{0,110}?killToast/);
A.match('飞出把当前位置交给 killToast', P, /killToast\(rec, dir, curX, curY\)/);
A.match('飞出用双 rAF', P, /raf\(function \(\) \{[\s\S]{0,200}?raf\(function \(\) \{/);
A.match('飞出移除延时 320ms', P, /\}, dir \? 320 : 260\);/);

/* ── 竖向手势还给页面（阻塞根因） ── */
A.match('有方向判定', P, /decided = true;[\s\S]{0,60}?horiz = ax >= ay;/);
A.match('竖向放弃接管', P, /if \(decided && !horiz\) \{[\s\S]{0,140}?tracking = false;[\s\S]{0,60}?reset\(true\);/);
A.match('只在横向 preventDefault', P, /if \(horiz\) \{ try \{ e\.preventDefault\(\)/);

/* ── 顺序：右下角容器，新的追加到末尾 ── */
A.match('新条目 append 到末尾', P, /box\.appendChild\(el\);[\s\S]{0,40}?TST_NODES\.push\(rec\);/);
A.match('超限淘汰最旧（数组头）', P, /killToast\(TST_NODES\[0\]\)/);

/* ── 去重与寿命 ── */
A.match('同文案去重', P, /nd\.txt === txt/);
A.match('有 TST_LIFE 分级别寿命', P, /var TST_LIFE = \{/);
A.match('有 TST_MAX 条数上限', P, /var TST_MAX = /);
A.match('err 可点开看全文', P, /classList\.toggle\('open'\)/);

/* ── 性能铁律：只动 transform/opacity ── */
A.match('tst 有 will-change', C, /will-change:transform,opacity/);
A.match('tst 用 translate3d', P, /translate3d\(/);
A.match('拖动时有 drag 类禁用动画', C, /\.tst\.drag\{animation:none;transition:none\}/);

A.finish();