/* =========================================================
 * 成都智慧象留学 - 国际课程组卷系统 · 公共工具层
 * 依赖：无（最先加载）。命名空间 window.ZJ
 * ========================================================= */
(function () {
  'use strict';

  var QTYPE_CATALOG = ['单选题', '多选题', '判断题', '填空题', '简答题', '写作题', '口语题'];
  var DIFFICULTY_LABELS = { 1: '基础', 2: '较易', 3: '中等', 4: '较难', 5: '挑战' };
  var SUBJECT_CATALOG = [
    { group: '雅思', items: ['雅思听力', '雅思口语', '雅思阅读', '雅思写作'] },
    { group: '托福', items: ['托福阅读', '托福听力', '托福口语', '托福写作'] },
    { group: 'A-Level', items: ['A-Level 数学', 'A-Level 物理', 'A-Level 化学', 'A-Level 经济'] },
    { group: 'AP', items: ['AP 微积分', 'AP 物理', 'AP 化学', 'AP 经济学', 'AP 计算机科学A'] }
  ];
  var AVATAR_COLORS = ['#3E5C76', '#12233A', '#6B7B8C', '#A9853B', '#4A7A5E', '#7A6A54', '#31465E', '#54636F'];

  var ZJ = {
    QTYPE_CATALOG: QTYPE_CATALOG,
    DIFFICULTY_LABELS: DIFFICULTY_LABELS,
    SUBJECT_CATALOG: SUBJECT_CATALOG,
    VER: 'v=20261001d',

    /** HTML 转义 */
    esc: function (s) {
      return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    todayStr: function () {
      var d = new Date();
      var m = d.getMonth() + 1, day = d.getDate();
      return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
    },

    fmtDateTime: function (iso) {
      if (!iso) { return ''; }
      var d = new Date(String(iso).replace(' ', 'T'));
      if (isNaN(d.getTime())) { return String(iso).slice(0, 16).replace('T', ' '); }
      var p = function (n) { return n < 10 ? '0' + n : n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    },

    fmtDate: function (iso) {
      return String(iso || '').slice(0, 10);
    },

    diffLabel: function (d) { return DIFFICULTY_LABELS[d] || '中等'; },
    diffClass: function (d) { return 'tag-d' + d; },

    /** 头像底色（姓名哈希） */
    avatarColor: function (name) {
      var h = 0;
      var s = String(name || '?');
      for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
      return AVATAR_COLORS[h % AVATAR_COLORS.length];
    },

    avatarHtml: function (name) {
      var n = String(name || '?');
      return '<span class="avatar" style="background:' + ZJ.avatarColor(n) + '">' + ZJ.esc(n.charAt(0)) + '</span>';
    },

    /** Toast 提示（2.6s 自动消退） */
    toast: function (msg, warn) {
      var el = document.getElementById('zj-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'zj-toast';
        el.className = 'toast';
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.className = 'toast' + (warn ? ' toast-warn' : '');
      // 触发重绘后加 show
      void el.offsetWidth;
      el.className = 'toast toast-show' + (warn ? ' toast-warn' : '');
      clearTimeout(ZJ._toastTimer);
      ZJ._toastTimer = setTimeout(function () {
        el.className = 'toast' + (warn ? ' toast-warn' : '');
      }, 2600);
    },

    /** 确认弹窗（Promise），替代原生 confirm，风格统一 */
    confirm: function (title, text, okLabel) {
      return new Promise(function (resolve) {
        var mask = document.getElementById('zj-confirm-mask');
        if (!mask) {
          mask = document.createElement('div');
          mask.id = 'zj-confirm-mask';
          mask.className = 'modal-mask';
          mask.innerHTML =
            '<div class="modal modal-sm">' +
            '  <div class="modal-head"><div class="m-title" id="zj-cf-title"></div></div>' +
            '  <div class="modal-body">' +
            '    <p id="zj-cf-text" style="color:var(--c-text-sub);font-size:14px;line-height:1.7;white-space:pre-wrap;"></p>' +
            '    <div class="form-actions">' +
            '      <button class="btn btn-ghost" id="zj-cf-no">取消</button>' +
            '      <button class="btn btn-primary" id="zj-cf-yes">确定</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';
          document.body.appendChild(mask);
        }
        mask.querySelector('#zj-cf-title').textContent = title || '请确认';
        mask.querySelector('#zj-cf-text').textContent = text || '';
        mask.querySelector('#zj-cf-yes').textContent = okLabel || '确定';
        mask.classList.add('open');
        var done = function (val) {
          mask.classList.remove('open');
          mask.querySelector('#zj-cf-yes').onclick = null;
          mask.querySelector('#zj-cf-no').onclick = null;
          mask.onclick = null;
          resolve(val);
        };
        mask.querySelector('#zj-cf-yes').onclick = function () { done(true); };
        mask.querySelector('#zj-cf-no').onclick = function () { done(false); };
        mask.onclick = function (e) { if (e.target === mask) { done(false); } };
      });
    },

    /** 打开/关闭弹窗（.modal-mask 直接子级 .modal） */
    openModal: function (id) {
      var m = document.getElementById(id);
      if (m) { m.classList.add('open'); }
    },
    closeModal: function (id) {
      var m = document.getElementById(id);
      if (m) { m.classList.remove('open'); }
    },

    debounce: function (fn, wait) {
      var t = null;
      return function () {
        var args = arguments, self = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(self, args); }, wait || 250);
      };
    },

    /** 题型选项 HTML */
    qtypeOptions: function (selected) {
      return QTYPE_CATALOG.map(function (t) {
        return '<option value="' + t + '"' + (t === selected ? ' selected' : '') + '>' + t + '</option>';
      }).join('');
    },

    /** 科目选项 HTML（groups: [{group, items}]） */
    subjectOptions: function (groups, selected, allLabel) {
      var html = allLabel ? '<option value="' + allLabel + '">' + allLabel + '</option>' : '';
      (groups || ZJ.SUBJECT_CATALOG).forEach(function (g) {
        html += '<optgroup label="' + ZJ.esc(g.group) + '">';
        g.items.forEach(function (s) {
          html += '<option value="' + ZJ.esc(s) + '"' + (s === selected ? ' selected' : '') + '>' + ZJ.esc(s) + '</option>';
        });
        html += '</optgroup>';
      });
      return html;
    },

    /** 题目配图（预览卡内） */
    questionImageHtml: function (q) {
      return q.imagePath ? '<div class="qc-image"><img src="/' + ZJ.esc(q.imagePath) + '" alt="题目配图"></div>' : '';
    },

    /** 听力音频播放器（在线答题/预览用） */
    questionAudioHtml: function (q) {
      return q.audioPath
        ? '<div class="qc-audio"><audio controls preload="metadata" src="/' + ZJ.esc(q.audioPath) + '"></audio>' +
          '<span class="qa-note">听力音频（可反复播放）</span></div>'
        : '';
    },

    /** KaTeX 公式渲染：动态加载 vendor 本地包，失败静默（显示原文） */
    loadKatex: function () {
      if (ZJ._katexPromise) { return ZJ._katexPromise; }
      ZJ._katexPromise = new Promise(function (resolve) {
        if (window.renderMathInElement) { resolve(true); return; }
        var css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'vendor/katex/katex.min.css';
        document.head.appendChild(css);
        var load = function (src, cb) {
          var s = document.createElement('script');
          s.src = src;
          s.onload = cb;
          s.onerror = function () { cb(false); };
          document.head.appendChild(s);
        };
        load('vendor/katex/katex.min.js', function (ok1) {
          if (!ok1) { resolve(false); return; }
          load('vendor/katex/auto-render.min.js', function (ok2) { resolve(!!ok2); });
        });
      });
      return ZJ._katexPromise;
    },
    renderMath: function (el) {
      return ZJ.loadKatex().then(function (ok) {
        if (ok && window.renderMathInElement && el) {
          try {
            renderMathInElement(el, {
              delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
                { left: '\\[', right: '\\]', display: true }
              ],
              ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
              throwOnError: false
            });
          } catch (e) { /* 渲染失败保留原文 */ }
        }
        return ok;
      });
    },

    /** 单题预览 HTML（题干+选项；不含答案，用于学生视角预览） */
    questionBodyHtml: function (q) {
      var html = '';
      if (q.passage) { html += '<div class="qc-passage">' + ZJ.esc(q.passage) + '</div>'; }
      html += '<div class="qc-stem">' + ZJ.esc(q.stem) + '</div>';
      html += ZJ.questionAudioHtml(q);
      html += ZJ.questionImageHtml(q);
      if ((q.qtype === '单选题' || q.qtype === '多选题') && q.options && q.options.length) {
        html += '<ul class="qc-options">';
        q.options.forEach(function (opt, i) {
          html += '<li data-letter="' + String.fromCharCode(65 + i) + '">' + ZJ.esc(String(opt).replace(/^[A-Za-z][.、．]\s*/, '')) + '</li>';
        });
        html += '</ul>';
      }
      return html;
    },

    /** 题目卡（组卷预览/组卷篮用，含答案与解析，供教师核对） */
    questionCardHtml: function (q, no, toolsHtml) {
      var tags =
        '<span class="tag tag-subject">' + ZJ.esc(q.subject) + '</span>' +
        '<span class="tag tag-type">' + ZJ.esc(q.qtype) + '</span>' +
        '<span class="tag ' + ZJ.diffClass(q.difficulty) + '">难度' + q.difficulty + ' · ' + ZJ.diffLabel(q.difficulty) + '</span>' +
        (q.source ? '<span class="tag tag-off">' + ZJ.esc(q.source) + '</span>' : '');
      var html =
        '<div class="q-card" data-qid="' + q.id + '">' +
        '  <div class="qc-head">' +
        '    <span class="qc-no">' + no + '.</span>' +
        '    <div class="qc-tags">' + tags + '</div>' +
        '    <div class="qc-tools">' + (toolsHtml || '') + '</div>' +
        '  </div>' +
        ZJ.questionBodyHtml(q);
      if (q.answer) {
        html += '<div class="qc-answer"><b>答案：</b>' + ZJ.esc(q.answer) + '</div>';
      }
      if (q.explanation) {
        html += '<div class="qc-explain"><b>解析：</b>' + ZJ.esc(q.explanation) + '</div>';
      }
      html += '</div>';
      return html;
    },

    /** 全站水印：左下角 made by Jessie（勿删除，交付约定） */
    injectWatermark: function () {
      if (document.querySelector('.wm-credit')) { return; }
      var wm = document.createElement('div');
      wm.className = 'wm-credit';
      wm.textContent = 'made by Jessie';
      document.body.appendChild(wm);
    },

    /** 未登录守卫：跳回登录页 */
    requireLogin: function () {
      var auth = null;
      try { auth = JSON.parse(sessionStorage.getItem('zhxx_zj_auth_v1') || 'null'); } catch (e) { auth = null; }
      if (!auth || !auth.name) {
        location.replace('index.html');
        return null;
      }
      return auth;
    },

    saveAuth: function (profile) {
      try { sessionStorage.setItem('zhxx_zj_auth_v1', JSON.stringify(profile)); } catch (e) { /* 忽略 */ }
    },

    loadAuth: function () {
      try { return JSON.parse(sessionStorage.getItem('zhxx_zj_auth_v1') || 'null'); } catch (e) { return null; }
    },

    clearAuth: function () {
      try { sessionStorage.removeItem('zhxx_zj_auth_v1'); } catch (e) { /* 忽略 */ }
    },

    /** 通用下载（Blob） */
    downloadBlob: function (blob, filename) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    },

    /** 难度分布归一化提示文本 */
    distSummary: function (basic, boost, sprint) {
      var b = Number(basic) || 0, o = Number(boost) || 0, s = Number(sprint) || 0;
      var total = b + o + s;
      if (total <= 0) { return '未填写：默认以中等难度为主'; }
      var r = function (v) { return Math.round(v / total * 100); };
      return '实际比例：基础 ' + r(b) + '% · 强化 ' + r(o) + '% · 冲刺 ' + r(s) + '%';
    }
  };

  window.ZJ = ZJ;
})();
