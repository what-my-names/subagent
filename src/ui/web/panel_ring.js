/* panel_ring.js — 环形通知轮盘（由 build_panel_html.js 拼在 panel_toast.js 之前）
 *
 * 用途：双击报错后，多条通知进中心排成一个 3D 圆柱。上下滑动旋转，
 *       中间那条最清晰，越上下越模糊越小。滑掉一条后其余自动补齐。
 * 为什么单独成文件：环形是一套独立的几何计算与手势，和堆叠通知不共用状态。
 */

/* 每条卡片在圆柱上的角度间隔（弧度）。16 度 ≈ 能同时看到 5~6 条 */
var RING_STEP = 0.28;
/* 圆柱半径（px）。越大越扁平，越小越弯 */
var RING_RADIUS = 210;
/* 滚动惯性衰减 */
var RING_FRICTION = 0.92;

var RING = {
  items: [],       // [{ el, rec }]
  pos: 0,          // 当前滚动位置（单位：卡片索引）
  vel: 0,          // 惯性速度
  raf: 0,
  dragging: false,
  startY: 0,
  startPos: 0,
  lastY: 0,
  lastT: 0
};

/* 取容器；不存在就建一个 */
function ringBox() {
  var b = document.getElementById("ringBox");
  if (b) return b;
  b = document.createElement("div");
  b.id = "ringBox";
  document.body.appendChild(b);
  return b;
}

/* 重排所有卡片。核心几何：
   每条卡片相对中心的位置决定它的角度，角度决定它往哪偏、多远、多模糊。
   translateZ 用「半径 - cos(角度)*半径」向后退，远的自然变小。
   为什么不用 scrollTop：卡片是绝对定位的，滚动要的是角度而不是位移，
   直接算角度比“先滚再读 scrollTop 再转角度”少一层误差。 */
function ringRender() {
  var n = RING.items.length;
  if (!n) return;
  for (var i = 0; i < n; i++) {
    var it = RING.items[i];
    if (!it || !it.el || it.rec.dead) continue;
    var d = i - RING.pos;
    var a = d * RING_STEP;
    /* 只渲染可视范围，超出就隐藏（避免远处卡片一字叠在中间） */
    if (Math.abs(d) > 4.2) {
      it.el.style.visibility = "hidden";
      continue;
    }
    it.el.style.visibility = "";
    var y = Math.sin(a) * RING_RADIUS * 0.55;
    var z = -RING_RADIUS * (1 - Math.cos(a));
    var sc = Math.max(0.62, 1 - Math.abs(d) * 0.14);
    var blurPx = Math.min(6, Math.abs(d) * 2.1);
    var op = Math.max(0.12, 1 - Math.abs(d) * 0.32);
    it.el.style.transform = "translate(-50%,-50%) translate3d(0," + y.toFixed(1) + "px," + z.toFixed(1) + "px) scale(" + sc.toFixed(3) + ")";
    it.el.style.opacity = op.toFixed(3);
    it.el.style.filter = blurPx > 0.2 ? "blur(" + blurPx.toFixed(1) + "px)" : "";
    /* 中间的才可交互，避免误点到背后那条 */
    it.el.style.pointerEvents = Math.abs(d) < 1.1 ? "auto" : "none";
    it.el.style.zIndex = String(100 - Math.abs(d));
  }
}

/* 惯性滚动：每帧衰减速度，位置越界就绕回（环形没有尽头） */
function ringTick() {
  if (RING.dragging) { RING.raf = 0; return; }
  if (Math.abs(RING.vel) < 0.0008) { RING.vel = 0; RING.raf = 0; ringRender(); return; }
  RING.pos += RING.vel;
  RING.vel *= RING_FRICTION;
  ringNormalize();
  ringRender();
  RING.raf = requestAnimationFrame(ringTick);
}

/* 位置绕回：pos 永远落在 [0, n) 区间，越界部分换算回来。
   这样从最后一条继续往下滑就是第一条，无缝。 */
function ringNormalize() {
  var n = RING.items.length;
  if (!n) { RING.pos = 0; return; }
  while (RING.pos < 0) RING.pos += n;
  while (RING.pos >= n) RING.pos -= n;
}

function ringKick() {
  if (RING.raf) return;
  RING.raf = requestAnimationFrame(ringTick);
}

/* 加入一条。第一条进来时把容器显示出来，并把它的定位改成交给 ringRender 管 */
function ringAdd(el, rec) {
  var box = ringBox();
  if (el.parentNode !== box) box.appendChild(el);
  el.classList.remove("open");
  el.classList.add("ring-item");
  /* 清掉堆叠时的定位，全部交给 transform */
  el.style.position = "absolute";
  el.style.left = "50%";
  el.style.top = "50%";
  el.style.width = "min(84vw, 400px)";
  el.style.maxHeight = "34vh";
  el.style.overflowY = "auto";
  el.style.transition = "transform .26s cubic-bezier(.22,.9,.3,1), opacity .22s, filter .22s";
  el.style.zIndex = "100";
  RING.items.push({ el: el, rec: rec });
  box.classList.add("on");
  /* 新条目放到当前视野中心 */
  if (RING.items.length === 1) RING.pos = 0;
  else RING.pos = RING.items.length - 1;
  ringNormalize();
  ringRender();
  return true;
}

/* 移除一条，并让剩下的自动补齐位置 */
function ringRemove(el) {
  var idx = -1;
  for (var i = 0; i < RING.items.length; i++) {
    if (RING.items[i].el === el) { idx = i; break; }
  }
  if (idx < 0) return;
  RING.items.splice(idx, 1);
  /* 删掉的那条如果就在光标之上，位置要往前挪一点，视觉上才不跳 */
  if (RING.pos > idx) RING.pos -= 1;
  ringNormalize();
  if (!RING.items.length) {
    var b = document.getElementById("ringBox");
    if (b) b.classList.remove("on");
  } else {
    ringRender();
  }
}

/* 给容器挂滚动手势（整个容器都能滑，不是只有卡片） */
function ringBind() {
  var box = ringBox();
  if (box.__bound) return;
  box.__bound = true;
  box.addEventListener("pointerdown", function (e) {
    /* 点卡片本身时交给卡片自己的关闭手势，不在这里接管 */
    if (e.target && e.target.closest && e.target.closest(".ring-item")) return;
    RING.dragging = true;
    RING.startY = e.clientY;
    RING.startPos = RING.pos;
    RING.lastY = e.clientY;
    RING.lastT = Date.now();
    RING.vel = 0;
    if (RING.raf) { cancelAnimationFrame(RING.raf); RING.raf = 0; }
    try { box.setPointerCapture(e.pointerId); } catch (eC) {}
  });
  box.addEventListener("pointermove", function (e) {
    if (!RING.dragging) return;
    var dy = e.clientY - RING.startY;
    /* 往上一像素 = 往后滑一格。除以卡片间距，手指滑多少内容转多少 */
    RING.pos = RING.startPos - dy / 96;
    ringNormalize();
    ringRender();
    var now = Date.now();
    var dt = now - RING.lastT;
    if (dt > 0) RING.vel = -((e.clientY - RING.lastY) / 96) * (16 / dt) * 0.9;
    RING.lastY = e.clientY;
    RING.lastT = now;
    try { e.preventDefault(); } catch (eP) {}
  });
  function endDrag() {
    if (!RING.dragging) return;
    RING.dragging = false;
    /* 松手后把位置吸附到最近一条，不然会停在两条中间看不清 */
    RING.pos = Math.round(RING.pos);
    ringNormalize();
    ringRender();
    ringKick();
  }
  box.addEventListener("pointerup", endDrag);
  box.addEventListener("pointercancel", endDrag);
  /* 滚轮（桌面/模拟器） */
  box.addEventListener("wheel", function (e) {
    RING.vel += (e.deltaY > 0 ? 1 : -1) * 0.06;
    ringKick();
    try { e.preventDefault(); } catch (eP) {}
  }, { passive: false });
  /* 点空白关闭整个轮盘 */
  box.addEventListener("click", function (e) {
    if (e.target && e.target.closest && e.target.closest(".ring-item")) return;
    ringCloseAll();
  });
}

function ringCloseAll() {
  var arr = RING.items.slice();
  RING.items = [];
  for (var i = 0; i < arr.length; i++) {
    try { arr[i].rec.dead = true; arr[i].el.remove(); } catch (e) {}
  }
  var b = document.getElementById("ringBox");
  if (b) b.classList.remove("on");
}

/* 把一条已有的通知搬进轮盘 */
function ringPush(el, rec) {
  ringBind();
  return ringAdd(el, rec);
}
