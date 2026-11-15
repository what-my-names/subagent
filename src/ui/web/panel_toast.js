/* panel_toast.js — 堆叠式通知（由 build_panel_html.js 拼在 panel_tex.js 之后）
 *
 * 用途：toast() 及其堆叠上限、计时、拖动关闭，以及 floatToast / killToast。
 * 为什么单独成文件：通知是一套自成一体的交互（堆叠、计时、手势），
 *       改它不该碰到列表与时间线；它也是被调用最多的一块，独立后好定位。
 * 拼接位置：在 panel.js 之后、同一 IIFE 内，err()/okMsg() 等仍在主文件里对外可见。
 */
/* ── 堆叠式通知 ──
   对齐宿主右侧聊天栏：多条同时存在，新的压在最上面，旧的被挤下去。
   上一版是单节点 #toast，textContent 直接覆盖 —— 连报两条时前一条被吃掉，
   用户只能看到「闪一下」，这就是「报错太快截不到」的真正原因。
   现在每条独立节点、独立计时，互不干扰。 */
var TST_MAX = 4;
/* 存在时长：用户反馈「有点不太长」，整体加长。
   info/ok 3.0/2.6 → 3.5/3.5，warn 4.0 → 5.0，err 6.5 → 8.0（错误要看清再关）。 */
/* 停留时长：用户要求报错停 5 秒，方便看清并截图上报。 */
var TST_LIFE = { info: 3500, ok: 3500, warn: 5000, err: 5000 };
var TST_SVG = {
  info: '<svg class="tst-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.6"/></svg>',
  ok: '<svg class="tst-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.6 2.6L16 9.6"/></svg>',
  warn: '<svg class="tst-ico" viewBox="0 0 24 24"><path d="M12 3.4L21 19.4H3z"/><path d="M12 9.6v4.6M12 17.2v.5"/></svg>',
  err: '<svg class="tst-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8"/></svg>'
};
/* 同级别、同文案的重复消息不叠加，只把已有那条刷新计时（避免连点时刷屏） */
var TST_NODES = [];

function toast(msg, level) {
  var txt = String(msg == null ? '' : msg);
  if (!txt) return;
  var lv = (level === 'ok' || level === 'warn' || level === 'err') ? level : 'info';
  var box = $('toastStack');
  if (!box) return;

  /* 去重：完全相同的文案仍在屏上时，不新增，只重置它的寿命 */
  for (var i = 0; i < TST_NODES.length; i++) {
    var nd = TST_NODES[i];
    if (nd && nd.el && nd.txt === txt && !nd.dead) {
      try { clearTimeout(nd.timer); } catch (eT) {}
      nd.timer = setTimeout(function () { killToast(nd); }, TST_LIFE[lv]);
      return;
    }
  }

  var el = document.createElement('div');
  el.className = 'tst' + (lv === 'info' ? '' : ' ' + lv);
  el.setAttribute('data-lv', lv);
  el.innerHTML = (TST_SVG[lv] || TST_SVG.info) + '<div class="tst-tx">' + esc(txt) + '</div>';

  var rec = { el: el, txt: txt, lv: lv, timer: null, dead: false };

  /* 报错条目的点击语义（用户定，两档）：
       单击 → 展开到上限（约 8 行），仍留在原位，再点收回。
       双击 → 解除限高看全部，并在屏幕中心悬浮；悬浮态可拖动，
              松手飞出最近边缘并消失。
       单击要延迟 250ms 才能确认不是双击，期间二次点击则取消单击。 */
  var onTapFn = null;
  var onDoubleFn = null;
  var tapTimer = 0;
  /* 【第九十七轮】双击进环不再只给 err。
     主人原话：「右上角有一些弹窗，就是已关闭这些的状态，弹窗为什么不能双击弹射到中间」。
     ok / warn / info 同样是通知，用户想凑到中间看、一起划掉，双击应该一样能用。
     单击展开仍然只给 err（其他级别没有长内容可展开，点了展开反而莫名其妙）。 */
  onDoubleFn = function () {
    /* 【第九十二轮】双击改为进环形轮盘。
       用户要的是「双击多个都能飞到中心，中心是一个上下滚动的圈」。
       所以不再单条悬浮，而是把这条搬进 #ringBox 的圆柱里，
       后面再双击别的就会一条条加进同一个圈。 */
    try { clearTimeout(tapTimer); } catch (eT) {}
    try { clearTimeout(rec.timer); } catch (eT2) {}
    /* 停掉自动消失：进了轮盘就由用户手动关 */
    rec.timer = null;
    if (typeof ringPush === 'function') {
      /* 先占住它，避免在堆叠里的计时器又把它杀掉 */
      rec.inRing = true;
      ringPush(el, rec);
    } else {
      /* 轮盘模块不在：退回旧行为 */
      floatToast(el, rec);
    }
  };
  if (lv === 'err') {
    onTapFn = function () {
      /* 已经在悬浮态：单击直接关掉（不用再展开/收回） */
      if (el.classList.contains('float')) { killToast(rec); return; }
      try { clearTimeout(tapTimer); } catch (eT) {}
      tapTimer = setTimeout(function () {
        el.classList.toggle('open');
        try { clearTimeout(rec.timer); } catch (eT2) {}
        if (el.classList.contains('open')) {
          rec.timer = setTimeout(function () { killToast(rec); }, 12000);
        } else {
          rec.timer = setTimeout(function () { killToast(rec); }, TST_LIFE.err);
        }
      }, 250);
    };
  }

  /* 手势区分：位移小于这个值算「点击」，大于算「滑动」 */
  var TST_TAP_SLOP = 8;
  /* 横向滑过这个距离就判定关闭（不要求特定方向，左右都行） */
  var TST_SWIPE_MIN = 46;

  /* 给一条通知挂上「划一下关闭」。
     用户原话：划一下就能关，划哪里都行。
     所以不做方向限制、也不要求从边缘起手 —— 整条任意位置都能拖，
     只按位移距离判定，左右滑都可以。 */
/* 通知条交互（2026-11-06 重写，用户定）：
     自由拖动 —— 不锁轴，x/y 都跟手；松手时三种结局：
     a) 位移很小 → 判点击（err 条目点开全文）
     b) 位移中等 → 弹回原位
     c) 位移超限 → 顺着拖动方向飞出屏幕并消失
     全程只动 transform/opacity，不触发布局。
     手感的两个关键点：
     1) pointermove 里先判方向再 preventDefault —— 竖直方向放行给页面滚动，
        否则通知条会抢走所有竖向滑动，整页感觉「阻塞」；
     2) 飞出时不能先 reset 再 killToast —— 那会让元素先弹回原位再飞，
        必须把当前位移原样交给 killToast 接力。 */
  function bindSwipeClose(el, rec, onTap, onDouble) {
    /* 所有级别都可拖（用户定：即使一下就走的也要能划掉）。
       单击/双击语义只给 err，其余级别拖动即关闭。
       float 态（双击后悬浮）拖动逻辑不同：不判点击，松手一律飞出。 */
    var startX = 0, startY = 0, curX = 0, curY = 0;
    var tracking = false, decided = false, horiz = false;
    var pid = null;

    function reset(spring) {
      tracking = false; decided = false; pid = null;
      if (spring) {
        /* 回弹：放开直接截断，用 transition 弹回去 */
        el.classList.remove('drag');
        el.style.transition = 'transform .24s cubic-bezier(.2,.9,.3,1), opacity .2s';
        el.style.transform = rec.floatBase || 'translate3d(0,0,0)';
        el.style.opacity = '';
        setTimeout(function () {
          if (!rec.dead) { el.style.transition = ''; el.style.transform = rec.floatBase || ''; }
        }, 260);
      } else {
        el.classList.remove('drag');
        el.style.transition = '';
        el.style.transform = rec.floatBase || '';
        el.style.opacity = '';
      }
      curX = 0; curY = 0;
    }

    el.addEventListener('pointerdown', function (e) {
      if (rec.dead) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      tracking = true; decided = false; horiz = false;
      pid = e.pointerId;
      startX = e.clientX; startY = e.clientY; curX = 0; curY = 0;
      /* 按下即清掉 transition 与动画，拖动全程跟手 */
      el.style.transition = '';
      el.style.animation = 'none';
      el.classList.add('drag');
      try { el.setPointerCapture(pid); } catch (eC) {}
    });

    el.addEventListener('pointermove', function (e) {
      if (!tracking || rec.dead) return;
      curX = e.clientX - startX;
      curY = e.clientY - startY;
      var ax = Math.abs(curX), ay = Math.abs(curY);
      /* 第一次超过 6px 时定方向：横向接管，纵向还给页面滚动 */
      if (!decided && (ax > 6 || ay > 6)) {
        decided = true;
        horiz = ax >= ay;
      }
      /* 【第六十二轮】用户要求：两个位置随便滑都能飞。
         以前竖向会还给页面滚动，导致往上/往下滑没反应。
         现在只在「没展开的长内容需要滚动」时才放行竖向，其余全接管。 */
      if (decided && !horiz) {
        var needScroll = !el.classList.contains('float') &&
                         el.scrollHeight > el.clientHeight + 2 &&
                         el.classList.contains('open');
        if (needScroll) {
          tracking = false;
          reset(true);
          return;
        }
      }
      /* 全方向跟手。悬浮态要保留居中基准 -50%，只叠加手指位移 */
      if (rec.floatBase) {
        el.style.transform = rec.floatBase + ' translate3d(' + curX + 'px,' + curY + 'px,0)';
      } else {
        el.style.transform = 'translate3d(' + curX + 'px,' + curY + 'px,0)';
      }
      var dist = Math.sqrt(curX * curX + curY * curY);
      el.style.opacity = String(Math.max(0.25, 1 - dist / 260));
      try { e.preventDefault(); } catch (eP) {}
    });

    function finish(e) {
      if (!tracking || rec.dead) return;
      var movedX = Math.abs(curX), movedY = Math.abs(curY);
      var dist = Math.sqrt(curX * curX + curY * curY);
      try { if (pid != null) el.releasePointerCapture(pid); } catch (eR) {}
      var isFloat = el.classList.contains('float');

      /* 悬浮态：任何位移超限都直接飞出（不判点击、不弹回） */
      if (isFloat) {
        if (dist >= TST_SWIPE_MIN) {
          var fdir;
          if (movedX >= movedY) fdir = curX < 0 ? 'left' : 'right';
          else fdir = curY < 0 ? 'up' : 'down';
          tracking = false; decided = false; pid = null;
          killToast(rec, fdir, curX, curY);
          return;
        }
        /* 没拖动就是单击：关闭 */
        reset();
        if (movedX < TST_TAP_SLOP && movedY < TST_TAP_SLOP) killToast(rec);
        return;
      }

      /* 超限：顺着拖动方向飞出。
         关键：这里不能 reset()，必须把「当前手指位置」原样交给 killToast 接力，
         由它从该位置继续推到屏外 —— 否则元素会先弹回原位再飞出去（闪一下）。 */
      if (dist >= TST_SWIPE_MIN) {
        var dir;
        if (movedX >= movedY) dir = curX < 0 ? 'left' : 'right';
        else dir = curY < 0 ? 'up' : 'down';
        tracking = false; decided = false; pid = null;
        killToast(rec, dir, curX, curY);
        return;
      }
      /* 没超限：位移极小算点击 */
      if (movedX < TST_TAP_SLOP && movedY < TST_TAP_SLOP) {
        reset();
        /* 双击判定：两次点击间隔小于 300ms 视为双击 */
        var now = Date.now();
        if (onDouble && rec.lastTap && (now - rec.lastTap) < 300) {
          rec.lastTap = 0;
          onDouble();
          return;
        }
        rec.lastTap = now;
        if (onTap) onTap();
        return;
      }
      reset(true);
    }
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', function () { reset(true); });
  }

  /* 双击：把通知条抬到屏幕中心悬浮，解除限高看全部。
   悬浮态下：单击关闭；拖动松手飞出最近边缘。
   用 fixed 定位 + 居中，z-index 压过容器。 */
function floatToast(el, rec) {
  if (!el || rec.dead) return;
  try { clearTimeout(rec.timer); } catch (eT) {}

  /* 两段式：先记下它现在的位置（right-top 的堆叠位），下一帧再过渡到屏幕中心。
     为什么要两段：同一个事件循环里连续写两次 transform，浏览器会合并成一帧，
     过渡根本没有起点，看起来就是瞬移。必须先让第一帧被渲染。 */
  var r0 = el.getBoundingClientRect();
  var startTf = 'translate3d(' + (r0.left + r0.width / 2 - window.innerWidth / 2) + 'px,' +
                (r0.top + r0.height / 2 - window.innerHeight / 2) + 'px,0)' +
                ' translate(-50%,-50%) scale(1)';

  el.classList.remove('open');
  el.classList.add('float');
  /* 从容器里摘出来挂到 body，避免被 #toastStack 的 overflow/层叠限制 */
  if (el.parentNode && el.parentNode !== document.body) {
    document.body.appendChild(el);
  }
  /* 第一帧：定位到原位，无过渡 */
  el.style.transition = 'none';
  el.style.position = 'fixed';
  el.style.left = '50%';
  el.style.top = '50%';
  el.style.width = Math.min(r0.width, 420) + 'px';
  el.style.maxHeight = '70vh';
  el.style.overflowY = 'auto';
  el.style.zIndex = '300';
  el.style.pointerEvents = 'auto';
  el.style.opacity = '1';
  el.style.transform = startTf;
  /* 记录基准位移，拖动时在此基础上叠加，避免覆盖掉居中用的 -50% */
  rec.floatBase = 'translate(-50%,-50%)';

  /* 第二帧：解禁过渡，过渡到屏幕中心 + 撑宽 */
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (!el.parentNode || rec.dead) return;
      el.style.transition = '';
      el.style.width = 'min(86vw, 420px)';
      el.style.transform = 'translate(-50%,-50%) scale(1)';
    });
  });
}

  /* 新的插到最前面：容器在右上角，最新一条在最上面，旧的往下推。
   与 TST_NODES 顺序保持一致（数组也是 unshift），超限时删最后一个（最旧、最靠下）。 */
  box.insertBefore(el, box.firstChild);
  TST_NODES.unshift(rec);
  bindSwipeClose(el, rec, onTapFn, onDoubleFn);

  /* 超出上限：最旧的那条（数组最后一个 = 屏幕最下方）立刻淡出 */
  while (TST_NODES.length > TST_MAX) {
    killToast(TST_NODES[TST_NODES.length - 1]);
  }

  rec.timer = setTimeout(function () { killToast(rec); }, TST_LIFE[lv]);
}

/* 淡出后移除节点；动画只跑 transform/opacity，不触发重绘。
   dir / fromX / fromY 可选：手动拖飞时传入，从手指松开的位置接着推到屏外，
   手感连续不跳变；自动消失不传，走默认的从右侧滑出。 */
function killToast(rec, dir, fromX, fromY) {
  if (!rec || rec.dead) return;
  rec.dead = true;
  try { clearTimeout(rec.timer); } catch (eT) {}
  var el = rec.el;
  /* 【第九十二轮】如果这条在环形轮盘里，先让它退圈并触发补齐，
     否则剩下的卡片会留一个空位、位置也不再居中。 */
  if (rec.inRing && el && typeof ringRemove === 'function') {
    try { ringRemove(el); } catch (eR) {}
    rec.inRing = false;
  }
  for (var i = 0; i < TST_NODES.length; i++) {
    if (TST_NODES[i] === rec) { TST_NODES.splice(i, 1); break; }
  }
  if (!el || !el.parentNode) return;
  if (dir) {
    /* 先把元素固定在手指松开的位置（无过渡），再解禁过渡推到屏外。
       注意：此时 el.style.animation 可能还是 'none'（pointerdown 里设的），
       必须显式清掉，否则 keyframes 与 transition 抢同一个 transform 属性。 */
    el.classList.remove('drag');
    var sx = Number(fromX || 0), sy = Number(fromY || 0);
    el.style.animation = 'none';
    el.style.transition = 'none';
    el.style.transform = 'translate3d(' + sx + 'px,' + sy + 'px,0)';
    /* 四方向：横飞出 130%，竖飞出 160%（上下留出通知条偏移） */
    var tx = '0%', ty = '0%';
    if (dir === 'left') tx = '-130%';
    else if (dir === 'right') tx = '130%';
    else if (dir === 'up') ty = '-160%';
    else if (dir === 'down') ty = '160%';
    /* 双延时代替双 rAF：rAF 在 WebView 被遮挡/悬浮窗时会被暂停，
       通知条就永远飞不出去、卡在屏幕上不消失。setTimeout 不受可见性影响。
       【延时不能省】两个 setTimeout 都必须带 ms，否则都是 0ms，
       会在同一轮事件循环里连续跑完，中间没有渲染帧 ——
       transform 初始值没被浏览器接受，transition 从终值起算，动画直接跳过去。
       16ms ≈ 一帧，作用等价于原来的双 rAF。 */
    setTimeout(function () {
      /* 再等一帧：确保上面那帧的 transform 已被浏览器接受，
         否则 transition 会从「初始值」起算，看起来就是闪回 */
      setTimeout(function () {
        if (!el.parentNode) return;
        el.style.transition = 'transform .22s cubic-bezier(.3,0,.8,.4), opacity .22s ease-out';
        el.style.transform = 'translate3d(' + tx + ',' + ty + ',0)';
        el.style.opacity = '0';
      }, 16);
    }, 16);
  } else if (el.classList.contains('float')) {
    /* 悬浮态自动消失：淡出 + 轻微缩小。
       不能走 .out → tstOut —— 那个 keyframes 用 translate3d(0,-110%)，
       会和居中用的 translate(-50%,-50%) 抢 transform，先跳左上角再飞。 */
    el.classList.add('gone');
  } else {
    el.classList.add('out');
  }
  setTimeout(function () {
    try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e2) {}
  }, dir ? 320 : 260);
}

/* ── 【第九十六轮】报错汇总卡 ──
   主人原话：「有哪些不行的、有哪些行的行的就不说了、不行的要全都在右上角出现，
             并且停留至少五秒」。
   之前一条失败弹一条，批量操作时右上角刷成一片，看不清到底哪几项坏了。
   现在提供 errBatch()：一次操作的所有失败项合成一张卡，卡内逐条列出。
   单条 err() 仍走原 toast 路径，行为不变。 */
var BATCH_LIFE = 8000;
function errBatch(title, items) {
  var box = $('toastStack');
  if (!box) return;
  var list = [];
  for (var i = 0; i < (items || []).length; i++) {
    var s = String(items[i] == null ? '' : items[i]).trim();
    if (s) list.push(s);
  }
  if (!list.length) return;
  /* 只有一条时退回普通 err，不为了凑格式而做卡片 */
  if (list.length === 1) { err(list[0]); return; }

  var key = String(title || '') + ' ' + list.join('');
  /* 同一批重复上报时刷新寿命，不叠卡 */
  for (var j = 0; j < TST_NODES.length; j++) {
    var nd = TST_NODES[j];
    if (nd && nd.el && nd.batchKey === key && !nd.dead) {
      try { clearTimeout(nd.timer); } catch (eT) {}
      nd.timer = setTimeout(function () { killToast(nd); }, BATCH_LIFE);
      return;
    }
  }

  var el = document.createElement('div');
  el.className = 'tst err batch';
  el.setAttribute('data-lv', 'err');
  var h = TST_SVG.err + '<div class="tst-tx"><div class="tst-batch-hd">'
    + esc(String(title || '有 ' + list.length + ' 项失败')) + '</div>';
  for (var k = 0; k < list.length; k++) {
    h += '<div class="tst-batch-row"><span class="tst-batch-n">' + (k + 1) + '.</span>'
      + '<span class="tst-batch-tx">' + esc(list[k]) + '</span></div>';
  }
  h += '</div>';
  el.innerHTML = h;

  var rec = { el: el, txt: key, lv: 'err', timer: null, dead: false, batchKey: key };
  /* 卡片默认展开（失败项要能直接看见，不让人再点一下） */
  el.classList.add('open');
  box.appendChild(el);
  TST_NODES.push(rec);
  /* 超出上限时从最旧的开始清 */
  while (TST_NODES.length > TST_MAX) {
    var old = TST_NODES.shift();
    if (old && !old.dead) { try { killToast(old); } catch (eO) {} }
  }
  bindSwipeClose(el, rec, null, null);
  rec.timer = setTimeout(function () { killToast(rec); }, BATCH_LIFE);
}

/* IIFE 收尾：panel.js 开的口子由最后一个分片关，
   这样 tex / toast 两片仍在同一作用域内，md() 才能直接调 mathHtml()。 */
  })();
})();
