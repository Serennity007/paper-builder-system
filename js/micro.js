/* =========================================================
 * 成都智慧象留学 - 国际课程组卷系统 · 动效与微交互层
 * 依赖：无（最后加载，纯渐进增强，失败不影响任何功能）
 * 能力：进场编排(.rv) / 数字滚动 / 分布条生长 / 按钮涟漪 / 页签过渡
 * 规约：尊重 prefers-reduced-motion；IntersectionObserver 不可用时整体退出
 * ========================================================= */
(function () {
  'use strict';
  if (typeof window.IntersectionObserver === 'undefined') { return; }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }

  var RV_SEL = [
    '.card', '.stat-card', '.paper-card', '.q-card', '.pq-card',
    '.dist-row', '.trend-row', '.paper-brief', '.ws-section',
    '.table-wrap', '.entry-head'
  ].join(',');

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) { return; }
      var el = en.target;
      io.unobserve(el);
      // 同父容器内的兄弟节点按序错峰
      var d = 0;
      try {
        var sibs = el.parentElement ? el.parentElement.children : [];
        var idx = Array.prototype.indexOf.call(sibs, el);
        if (idx > 0) { d = Math.min(320, idx * 55); }
      } catch (e) { /* 忽略 */ }
      el.style.setProperty('--rv-d', d + 'ms');
      el.classList.add('in');
      growBars(el);
      countUp(el);
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -3% 0px' });

  function scan(root) {
    if (!root || root.nodeType !== 1) { return; }
    if (root.matches && root.matches(RV_SEL) && !root.classList.contains('rv')) {
      root.classList.add('rv');
      io.observe(root);
    }
    if (root.querySelectorAll) {
      root.querySelectorAll(RV_SEL).forEach(function (el) {
        if (!el.classList.contains('rv')) {
          el.classList.add('rv');
          io.observe(el);
        }
      });
    }
  }

  /* 动态渲染（innerHTML / 页签切换）后的新节点自动纳入编排 */
  var mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (added[j].nodeType === 1) { scan(added[j]); }
      }
    }
  });

  function growBars(scope) {
    scope.querySelectorAll('.dist-fill, .trend-fill').forEach(function (f) {
      var w = f.style.width;
      if (!w) { return; }
      f.style.transition = 'none';
      f.style.width = '0%';
      void f.offsetWidth;
      f.style.transition = '';
      f.style.width = w;
    });
  }

  function countUp(scope) {
    scope.querySelectorAll('.stat-value').forEach(function (el) {
      if (el.children.length !== 0) { return; }
      var t = el.textContent.trim();
      if (!/^\d+(\.\d+)?$/.test(t)) { return; }
      var end = parseFloat(t);
      if (!isFinite(end) || end === 0) { return; }
      var dec = t.indexOf('.') >= 0 ? 1 : 0;
      var dur = 650 + Math.min(450, end * 2);
      var t0 = performance.now();
      (function step(now) {
        var p = Math.min(1, (now - t0) / dur);
        var v = end * (1 - Math.pow(1 - p, 3));
        el.textContent = v.toFixed(dec);
        if (p < 1) { requestAnimationFrame(step); } else { el.textContent = t; }
      })(t0);
    });
  }

  /* 按钮涟漪 */
  document.addEventListener('pointerdown', function (e) {
    var btn = e.target.closest ? e.target.closest('.btn') : null;
    if (!btn || btn.disabled) { return; }
    var rect = btn.getBoundingClientRect();
    var d = Math.max(rect.width, rect.height) * 1.1;
    var rp = document.createElement('i');
    rp.className = 'rp';
    rp.style.width = rp.style.height = d + 'px';
    rp.style.left = (e.clientX - rect.left - d / 2) + 'px';
    rp.style.top = (e.clientY - rect.top - d / 2) + 'px';
    btn.appendChild(rp);
    rp.addEventListener('animationend', function () { rp.remove(); });
  }, { passive: true });

  /* 页签切换：目标区块整体过渡进场 */
  document.addEventListener('click', function (e) {
    var tab = e.target.closest ? e.target.closest('.nav-tab') : null;
    if (!tab) { return; }
    setTimeout(function () {
      var sec = document.querySelector('.page > section:not([hidden])');
      if (!sec) { return; }
      sec.classList.remove('sec-enter');
      void sec.offsetWidth;
      sec.classList.add('sec-enter');
      scan(sec);
    }, 30);
  }, { passive: true, capture: true });

  function boot() {
    scan(document.body);
    mo.observe(document.body, { childList: true, subtree: true });
    /* 兜底：极端情况下（如元素始终未进入视口判定）2s 后全部放行，避免内容滞留透明 */
    setTimeout(function () {
      document.querySelectorAll('.rv:not(.in)').forEach(function (el) { el.classList.add('in'); });
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
