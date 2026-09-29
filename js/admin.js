/* =========================================================
 * 成都智慧象留学 - 国际课程组卷系统 · 教研工作台
 *
 * 页签：组卷台（双栏工作区，核心，默认）/ 题库 / 试卷库 / 总览 / 考试 / 审计
 * 说明：所有列表事件用容器级事件委托（避免弹窗重渲染丢监听的老坑）；
 *       组卷台逻辑在 js/builder.js；旧「组卷篮」数据首次加载自动并入工作区。
 * ========================================================= */
(function () {
  'use strict';

  var Data = window.ZJ_Data;
  var ZJ = window.ZJ;
  var CART_KEY = 'zhxx_zj_cart_v1';

  var state = {
    subjects: null,        // [{group, items}] 服务端科目库（演示模式由 bootstrap 提供）
    tags: [],
    editId: null,          // 当前编辑的题目 id
    genQuestions: [],      // 智能组卷预览
    lastGenParams: null,   // 重新生成用
    paperEdit: null,       // 试卷编辑工作副本
    paperEditOrigin: null, // 原始试卷（判断新建/编辑）
    pickFor: 'paper'       // 选题弹窗目标：paper（加卷）
  };

  /* ================= 顶部栏与导航 ================= */

  var auth = ZJ.requireLogin();
  if (!auth) { return; }

  function initTopbar() {
    document.getElementById('user-name').textContent = auth.name;
    document.getElementById('user-role').textContent = auth.role === 'admin' ? '教学总监' : '教师';
    var av = document.getElementById('user-avatar');
    av.innerHTML = ZJ.avatarHtml(auth.name);
    document.getElementById('btn-logout').addEventListener('click', function () {
      Data.logout();
      ZJ.clearAuth();
      location.replace('index.html');
    });
    document.getElementById('btn-password').addEventListener('click', function () {
      document.getElementById('pw-old').value = '';
      document.getElementById('pw-new').value = '';
      ZJ.openModal('modal-password');
    });
  }

  function initModeChip() {
    ZJ_READY.then(function (mode) {
      var chip = document.getElementById('mode-chip');
      chip.textContent = mode === 'server' ? '服务端模式 · 数据持久化' : '演示模式 · 关闭即重置';
      chip.title = mode === 'server' ? 'Flask + SQLite，端口 8687' : '无后端，sessionStorage 演示';
    });
  }

  /* 页签切换 */
  document.getElementById('nav-tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.nav-tab');
    if (!btn) { return; }
    switchTab(btn.dataset.tab);
  });

  function switchTab(name) {
    document.querySelectorAll('.nav-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    ['overview', 'bank', 'builder', 'papers', 'exams', 'audit'].forEach(function (tab) {
      document.getElementById('tab-' + tab).hidden = tab !== name;
    });
    if (name === 'overview') { refreshOverview(); }
    if (name === 'bank') { loadBank(); }
    if (name === 'papers') { loadPapers(); }
    if (name === 'audit') { loadAudit(); }
    if (name === 'builder' && window.ZJ_Builder) { window.ZJ_Builder.refresh(); }
    if (name === 'exams' && window.ZJ_Exams) { window.ZJ_Exams.refresh(); }
  }

  /* ================= 总览 ================= */

  function statCard(icon, value, label, navy) {
    return '<div class="stat-card">' +
      '<div class="stat-icon' + (navy ? ' navy' : '') + '">' + icon + '</div>' +
      '<div class="stat-meta"><div class="stat-value">' + value + '</div>' +
      '<div class="stat-label">' + label + '</div></div></div>';
  }

  function distRows(items, total, gold) {
    if (!items.length) { return '<div class="empty-tip">暂无数据</div>'; }
    return items.map(function (it) {
      var pct = total ? Math.max(2, Math.round(it.n / total * 100)) : 0;
      return '<div class="dist-row' + (gold ? ' gold' : '') + '">' +
        '<span class="dist-label">' + ZJ.esc(it.label) + '</span>' +
        '<span class="dist-track"><span class="dist-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="dist-num">' + it.n + '</span></div>';
    }).join('');
  }

  function refreshOverview() {
    Data.stats().then(function (stats) {
      document.getElementById('stat-cards').innerHTML =
        statCard('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z"/><path d="M9 7h6M9 11h6"/></svg>', stats.totalQuestions, '题库总题数', true) +
        statCard('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 6L9 17l-5-5"/></svg>', stats.enabledQuestions, '启用中（可被组卷抽取）') +
        statCard('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6"/></svg>', stats.totalPapers, '已组试卷', true) +
        statCard('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>', stats.weekNew, '近 7 天新增题目');

      var typeItems = Object.keys(stats.byType).map(function (k) { return { label: k, n: stats.byType[k] }; })
        .sort(function (a, b) { return b.n - a.n; });
      document.getElementById('type-dist-note').textContent = '共 ' + stats.totalQuestions + ' 题';
      document.getElementById('dist-type').innerHTML = distRows(typeItems, stats.totalQuestions);

      var diffItems = Object.keys(stats.byDifficulty).map(function (k) {
        return { label: k + ' · ' + ZJ.diffLabel(Number(k)), n: stats.byDifficulty[k], d: Number(k) };
      }).sort(function (a, b) { return a.d - b.d; });
      document.getElementById('dist-diff').innerHTML = distRows(diffItems, stats.totalQuestions, true);

      document.getElementById('dist-subject').innerHTML = distRows(
        stats.bySubject.slice(0, 8).map(function (s) { return { label: s.subject, n: s.n }; }),
        stats.totalQuestions
      );

      /* 近 8 周趋势（录题/组卷双条形） */
      var wq = stats.weeklyQuestions || [], wp = stats.weeklyPapers || [];
      var wmax = Math.max(1, Math.max.apply(null, wq.map(function (w) { return w.n; })
        .concat(wp.map(function (w) { return w.n; }))));
      var trend = document.getElementById('trend-bars');
      trend.innerHTML = wq.map(function (w, i) {
        var p = wp[i] || { n: 0 };
        return '<div class="trend-row">' +
          '<span class="trend-label">' + ZJ.esc(w.label) + '</span>' +
          '<span class="trend-tracks">' +
          '<span class="trend-track"><span class="trend-fill q" style="width:' + Math.round(w.n / wmax * 100) + '%"></span><i>' + w.n + '</i></span>' +
          '<span class="trend-track"><span class="trend-fill p" style="width:' + Math.round(p.n / wmax * 100) + '%"></span><i>' + p.n + '</i></span>' +
          '</span></div>';
      }).join('');

      /* 高频使用题目 */
      var top = stats.topUsed || [];
      document.getElementById('top-used').innerHTML = top.length
        ? top.map(function (t) {
          return '<div class="paper-brief"><div class="pb-main">' +
            '<div class="pb-name" style="font-size:13.5px;">' + ZJ.esc(t.stem) + '…</div>' +
            '<div class="pb-meta">' + ZJ.esc(t.subject) + '</div></div>' +
            '<span class="tag tag-draft">入卷 ' + t.n + ' 次</span></div>';
        }).join('')
        : '<div class="empty-tip">还没有题目被组卷使用</div>';

      /* 回收站角标 */
      var badge = document.getElementById('trash-badge');
      badge.hidden = !stats.trashCount;
      badge.textContent = stats.trashCount;

      var recent = stats.recentPapers || [];
      document.getElementById('recent-papers').innerHTML = recent.length
        ? recent.map(function (p) {
          return '<div class="paper-brief">' +
            '<div class="pb-main"><div class="pb-name">' + ZJ.esc(p.name) + '</div>' +
            '<div class="pb-meta">' + ZJ.esc(p.subjectLine || '未设科目行') + ' · ' + p.questionCount + ' 题 · 总分 <b>' + p.totalScore + '</b> · ' + ZJ.fmtDateTime(p.updatedAt) + '</div></div>' +
            '<span class="tag ' + (p.status === '定稿' ? 'tag-final' : 'tag-draft') + '">' + p.status + '</span>' +
            '<a class="btn-mini" href="print.html?id=' + p.id + '&ver=student" target="_blank">学生卷</a>' +
            '<a class="btn-mini" href="print.html?id=' + p.id + '&ver=teacher" target="_blank">教师卷</a>' +
            '</div>';
        }).join('')
        : '<div class="empty-tip"><div class="et-icon">📄</div>还没有试卷，去「组卷台」生成第一套吧</div>';
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  /* ================= 题库 ================= */

  var bankFilters = { q: '', subject: '全部科目', qtype: '全部题型', difficulty: '全部难度', status: '全部状态' };

  function fillSubjectSelects() {
    var groups = state.subjects || ZJ.SUBJECT_CATALOG;
    document.getElementById('q-subject').innerHTML = ZJ.subjectOptions(groups, '全部科目', '全部科目');
    document.getElementById('e-subject').innerHTML = ZJ.subjectOptions(groups) +
      '<option value="__new__">＋ 新增科目…</option>';
  }

  function fillTypeSelects() {
    ['q-type', 'e-qtype'].forEach(function (id) {
      var el = document.getElementById(id);
      var keep = el.value;
      var isFilter = id !== 'e-qtype';
      el.innerHTML = (isFilter ? '<option value="全部题型">全部题型</option>' : '') + ZJ.qtypeOptions();
      if (keep) { el.value = keep; }
    });
  }

  function fillTagDatalists() {
    var opts = state.tags.map(function (t) { return '<option value="' + ZJ.esc(t) + '">'; }).join('');
    document.getElementById('tag-list').innerHTML = opts;
    document.getElementById('tag-list-2').innerHTML = opts;
  }

  var bankCache = [];

  function loadBank() {
    return Data.questions(bankFilters).then(function (list) {
      bankCache = list;
      renderBank(list);
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function renderBank(list) {
    document.getElementById('q-count').textContent = list.length ? '共 ' + list.length + ' 题' : '';
    var tbody = document.getElementById('q-tbody');
    selectedIds.clear();
    updateBatchBar();
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="empty-tip"><div class="et-icon">🗃</div>没有符合条件的题目，换个筛选条件或新增试题</div></td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (q) {
      var stem = q.stem.length > 90 ? q.stem.slice(0, 90) + '…' : q.stem;
      return '<tr data-id="' + q.id + '">' +
        '<td><input type="checkbox" class="q-check" data-id="' + q.id + '"></td>' +
        '<td><span class="tag tag-subject">' + ZJ.esc(q.subject) + '</span>' +
        '<div class="cell-sub">' + ZJ.esc(q.qtype) + '</div></td>' +
        '<td class="cell-stem"><div class="stem-snip">' + (q.starred ? '<span class="star on">★</span> ' : '') + (q.isPublic === false ? '<span class="lock" title="私有题">🔒</span> ' : '') + ZJ.esc(stem) + '</div>' +
        (q.imagePath ? '<div class="cell-sub">🖼 含配图</div>' : '') +
        (q.audioPath ? '<div class="cell-sub">🔊 含音频</div>' : '') + '</td>' +
        '<td style="font-size:12px;color:var(--c-text-sub);max-width:110px;">' + ZJ.esc(q.tags || '—') + '</td>' +
        '<td><span class="tag ' + ZJ.diffClass(q.difficulty) + '">' + q.difficulty + ' · ' + ZJ.diffLabel(q.difficulty) + '</span>' +
        '<div class="cell-sub">' + (q.status === '停用' ? '<span class="tag tag-off">停用</span>' : '') + '</div></td>' +
        '<td style="font-family:var(--f-num);">' + (q.score || '—') + '</td>' +
        '<td style="font-family:var(--f-num);' + (q.usedCount ? 'color:var(--c-gold-deep);font-weight:600;' : 'color:var(--c-text-light);') + '">' + (q.usedCount || 0) + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="btn-mini star-btn' + (q.starred ? ' on' : '') + '" data-act="star" title="' + (q.starred ? '取消收藏' : '收藏') + '">' + (q.starred ? '★' : '☆') + '</button>' +
        '<button class="btn-mini primary" data-act="edit">编辑</button>' +
        '<button class="btn-mini gold" data-act="cart" title="加入组卷台试卷">加卷</button>' +
        '<button class="btn-mini" data-act="' + (q.status === '启用' ? 'disable' : 'enable') + '">' + (q.status === '启用' ? '停用' : '启用') + '</button>' +
        '<button class="btn-mini danger" data-act="del">删除</button>' +
        '</div></td></tr>';
    }).join('');
  }

  /* 勾选与批量操作 */
  var selectedIds = new Set();

  function updateBatchBar() {
    var bar = document.getElementById('batch-bar');
    var n = selectedIds.size;
    bar.hidden = n === 0;
    document.getElementById('batch-count').textContent = n;
  }

  document.getElementById('q-tbody').addEventListener('change', function (e) {
    var cb = e.target.closest('input.q-check');
    if (!cb) { return; }
    var id = Number(cb.dataset.id);
    if (cb.checked) { selectedIds.add(id); } else { selectedIds.delete(id); }
    updateBatchBar();
  });
  document.getElementById('q-check-all').addEventListener('change', function (e) {
    var on = e.target.checked;
    document.querySelectorAll('#q-tbody input.q-check').forEach(function (cb) {
      cb.checked = on;
      var id = Number(cb.dataset.id);
      if (on) { selectedIds.add(id); } else { selectedIds.delete(id); }
    });
    updateBatchBar();
  });
  document.getElementById('btn-batch-cancel').addEventListener('click', function () {
    selectedIds.clear();
    document.querySelectorAll('#q-tbody input.q-check').forEach(function (cb) { cb.checked = false; });
    document.getElementById('q-check-all').checked = false;
    updateBatchBar();
  });
  document.getElementById('batch-bar').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-batch]');
    if (!btn || !selectedIds.size) { return; }
    var action = btn.dataset.batch;
    var ids = Array.from(selectedIds);
    var label = { enable: '启用', disable: '停用', star: '收藏', unstar: '取消收藏', delete: '删除' }[action];
    var go = function () {
      Data.batchQuestions(ids, action).then(function () {
        ZJ.toast('已' + label + ' ' + ids.length + ' 题');
        selectedIds.clear();
        loadBank();
        refreshOverview();
      }).catch(function (err) { ZJ.toast(err.message, true); });
    };
    if (action === 'delete') {
      ZJ.confirm('批量删除', '确定删除选中的 ' + ids.length + ' 道题吗？题目将进入回收站，并从所有试卷中移除。', '删除').then(function (ok) {
        if (ok) { go(); }
      });
    } else {
      go();
    }
  });

  /* 回收站 */
  document.getElementById('btn-trash').addEventListener('click', function () {
    loadTrash();
    ZJ.openModal('modal-trash');
  });

  function loadTrash() {
    Data.trashList().then(function (list) {
      var badge = document.getElementById('trash-badge');
      badge.hidden = list.length === 0;
      badge.textContent = list.length;
      document.getElementById('trash-count').textContent = list.length ? '共 ' + list.length + ' 题' : '';
      var box = document.getElementById('trash-list');
      if (!list.length) {
        box.innerHTML = '<div class="empty-tip">回收站是空的</div>';
        return;
      }
      box.innerHTML = list.map(function (q) {
        var stem = q.stem.length > 60 ? q.stem.slice(0, 60) + '…' : q.stem;
        return '<div class="paper-brief" data-id="' + q.id + '">' +
          '<div class="pb-main"><div class="pb-name" style="font-size:14px;">' + ZJ.esc(stem) + '</div>' +
          '<div class="pb-meta">' + ZJ.esc(q.subject) + ' · ' + ZJ.esc(q.qtype) + ' · 删除于 ' + ZJ.fmtDateTime(q.deletedAt || '') + '</div></div>' +
          '<button class="btn-mini primary" data-act="restore">恢复</button>' +
          '<button class="btn-mini danger" data-act="purge">彻底删除</button>' +
          '</div>';
      }).join('');
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  document.getElementById('trash-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) { return; }
    var id = Number(btn.closest('.paper-brief').dataset.id);
    if (btn.dataset.act === 'restore') {
      Data.restoreQuestion(id).then(function () { ZJ.toast('已恢复到题库'); loadTrash(); })
        .catch(function (err) { ZJ.toast(err.message, true); });
    } else {
      ZJ.confirm('彻底删除', '彻底删除后不可恢复，确定吗？', '彻底删除').then(function (ok) {
        if (!ok) { return; }
        Data.purgeQuestion(id).then(function () { ZJ.toast('已彻底删除'); loadTrash(); })
          .catch(function (err) { ZJ.toast(err.message, true); });
      });
    }
  });
  document.getElementById('btn-empty-trash').addEventListener('click', function () {
    ZJ.confirm('清空回收站', '将彻底删除回收站中的全部题目，不可恢复。确定吗？', '清空').then(function (ok) {
      if (!ok) { return; }
      Data.emptyTrash().then(function (r) {
        ZJ.toast('已清空（' + r.purged + ' 题）');
        loadTrash();
        refreshOverview();
      }).catch(function (err) { ZJ.toast(err.message, true); });
    });
  });

  /* 筛选事件 */
  document.getElementById('q-search').addEventListener('input', ZJ.debounce(function (e) {
    bankFilters.q = e.target.value.trim();
    loadBank();
  }, 300));
  ['q-subject', 'q-type', 'q-diff', 'q-status'].forEach(function (id) {
    var key = { 'q-subject': 'subject', 'q-type': 'qtype', 'q-diff': 'difficulty', 'q-status': 'status' }[id];
    document.getElementById(id).addEventListener('change', function (e) {
      bankFilters[key] = e.target.value;
      loadBank();
    });
  });

  /* 题目表格操作（事件委托） */
  document.getElementById('q-tbody').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) { return; }
    var tr = btn.closest('tr[data-id]');
    var id = Number(tr.dataset.id);
    var q = findInCache(id);
    var act = btn.dataset.act;
    if (act === 'edit') { openQuestionModal(q); }
    else if (act === 'cart') { if (window.ZJ_Builder) { window.ZJ_Builder.addQuestion(q); ZJ.toast('已加入组卷台试卷'); } }
    else if (act === 'star') {
      Data.batchQuestions([id], q.starred ? 'unstar' : 'star').then(function () {
        loadBank();
      }).catch(function (err) { ZJ.toast(err.message, true); });
    }
    else if (act === 'enable' || act === 'disable') {
      Data.updateQuestion(id, { status: act === 'enable' ? '启用' : '停用' }).then(function () {
        ZJ.toast(act === 'enable' ? '已启用' : '已停用（组卷时不再抽取）');
        loadBank();
      }).catch(function (err) { ZJ.toast(err.message, true); });
    } else if (act === 'del') {
      ZJ.confirm('删除试题', '删除后进入回收站（可恢复），并从所有包含它的试卷中移除。确定删除吗？', '删除').then(function (ok) {
        if (!ok) { return; }
        Data.deleteQuestion(id).then(function (r) {
          ZJ.toast('已移入回收站' + (r && r.removedFromPapers ? '（同步从 ' + r.removedFromPapers + ' 道试卷移除）' : ''));
          loadBank();
          refreshOverview();
        }).catch(function (err) { ZJ.toast(err.message, true); });
      });
    }
  });

  var bankCache = [];
  function findInCache(id) {
    for (var i = 0; i < bankCache.length; i++) { if (bankCache[i].id === id) { return bankCache[i]; } }
    return null;
  }

  /* ================= 新增 / 编辑试题弹窗 ================= */

  function syncAnswerEditors() {
    var t = document.getElementById('e-qtype').value;
    document.getElementById('e-options-wrap').hidden = !(t === '单选题' || t === '多选题');
    document.getElementById('e-answer-choice-wrap').hidden = !(t === '单选题' || t === '多选题');
    document.getElementById('e-answer-judge-wrap').hidden = t !== '判断题';
    document.getElementById('e-answer-text-wrap').hidden = (t === '单选题' || t === '多选题' || t === '判断题');
  }

  /* ---- 配图上传 ---- */
  var editImagePath = '';

  document.getElementById('btn-e-image').addEventListener('click', function () {
    document.getElementById('e-image-file').click();
  });
  document.getElementById('e-image-file').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file) { return; }
    ZJ.toast('上传中…');
    Data.uploadImage(file).then(function (r) {
      editImagePath = r.path;
      renderEditImage();
      ZJ.toast('配图已上传');
    }).catch(function (err) { ZJ.toast(err.message, true); });
  });
  document.getElementById('btn-e-image-remove').addEventListener('click', function () {
    editImagePath = '';
    renderEditImage();
  });

  function renderEditImage() {
    var img = document.getElementById('e-image-preview');
    var rm = document.getElementById('btn-e-image-remove');
    var name = document.getElementById('e-image-name');
    if (editImagePath) {
      img.src = '/' + editImagePath;
      img.hidden = false;
      rm.hidden = false;
      name.textContent = editImagePath.split('/').pop();
    } else {
      img.hidden = true;
      img.removeAttribute('src');
      rm.hidden = true;
      name.textContent = '';
    }
  }

  /* ---- 题干查重（防抖） ---- */
  document.getElementById('e-stem').addEventListener('input', ZJ.debounce(function () {
    var stem = document.getElementById('e-stem').value.trim();
    var box = document.getElementById('e-dup-warning');
    if (stem.length < 8) { box.hidden = true; return; }
    Data.checkDup(stem, state.editId).then(function (dups) {
      if (!dups.length) { box.hidden = true; return; }
      box.innerHTML = '<b>⚠ 题库中已有 ' + dups.length + ' 道相似题干：</b>' +
        dups.map(function (d) { return ZJ.esc('#' + d.id + ' ' + d.subject + ' · ' + d.stem + '…'); }).join('<br>');
      box.hidden = false;
    }).catch(function () { box.hidden = true; });
  }, 500));

  /* ---- 听力音频上传 ---- */
  var editAudioPath = '';

  document.getElementById('btn-e-audio').addEventListener('click', function () {
    document.getElementById('e-audio-file').click();
  });
  document.getElementById('e-audio-file').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file) { return; }
    ZJ.toast('上传中…');
    Data.uploadImage(file).then(function (r) {
      editAudioPath = r.path;
      renderEditAudio();
      ZJ.toast('音频已上传');
    }).catch(function (err) { ZJ.toast(err.message, true); });
  });
  document.getElementById('btn-e-audio-remove').addEventListener('click', function () {
    editAudioPath = '';
    renderEditAudio();
  });

  function renderEditAudio() {
    var box = document.getElementById('e-audio-preview');
    var rm = document.getElementById('btn-e-audio-remove');
    var name = document.getElementById('e-audio-name');
    if (editAudioPath) {
      box.innerHTML = '<audio controls preload="metadata" src="/' + ZJ.esc(editAudioPath) + '"></audio>';
      box.hidden = false;
      rm.hidden = false;
      name.textContent = editAudioPath.split('/').pop();
    } else {
      box.hidden = true;
      box.innerHTML = '';
      rm.hidden = true;
      name.textContent = '';
    }
  }

  /* ---- 知识点树选择器（题目弹窗内） ---- */
  var knowledgeTree = null;

  document.getElementById('btn-e-knowledge').addEventListener('click', function () {
    var picker = document.getElementById('e-knowledge-picker');
    if (!picker.hidden) { picker.hidden = true; return; }
    Data.knowledge().then(function (tree) {
      knowledgeTree = tree;
      renderKnowledgePicker(tree);
      picker.hidden = false;
    }).catch(function (err) { ZJ.toast(err.message, true); });
  });

  function renderKnowledgePicker(tree) {
    var picker = document.getElementById('e-knowledge-picker');
    if (!tree.length) {
      picker.innerHTML = '<div class="f-hint" style="margin-top:6px;">大纲为空，请先到「知识点大纲」维护</div>';
      return;
    }
    var currentSubject = document.getElementById('e-subject').value;
    var groups = tree;
    var html = '';
    groups.forEach(function (g) {
      html += '<div class="chip-group">' + ZJ.esc(g.subject) + '</div><div class="chip-wrap">';
      g.nodes.forEach(function (p) {
        html += '<span class="chip kp-parent" data-name="' + ZJ.esc(p.name) + '">' + ZJ.esc(p.name) + '</span>';
        p.children.forEach(function (c) {
          html += '<span class="chip" data-name="' + ZJ.esc(c.name) + '">└ ' + ZJ.esc(c.name) + '</span>';
        });
      });
      html += '</div>';
    });
    picker.innerHTML = html + '<div class="f-hint" style="margin-top:6px;">点击知识点追加到输入框（再次点击可移除）</div>';
    picker.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip[data-name]');
      if (!chip) { return; }
      var input = document.getElementById('e-tags');
      var parts = input.value.split(/[、,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      var name = chip.dataset.name;
      var idx = parts.indexOf(name);
      if (idx >= 0) { parts.splice(idx, 1); chip.classList.remove('on'); }
      else { parts.push(name); chip.classList.add('on'); }
      input.value = parts.join('、');
    });
  }

  /* ---- 知识点大纲管理 ---- */
  document.getElementById('btn-knowledge-mgr').addEventListener('click', function () {
    Data.knowledge().then(function (tree) {
      knowledgeTree = tree;
      var sel = document.getElementById('kn-subject');
      var subjects = tree.map(function (t) { return t.subject; });
      sel.innerHTML = subjects.map(function (s) { return '<option value="' + ZJ.esc(s) + '">' + ZJ.esc(s) + '</option>'; }).join('');
      renderKnowledgeTree();
      ZJ.openModal('modal-knowledge');
    }).catch(function (err) { ZJ.toast(err.message, true); });
  });

  function renderKnowledgeTree() {
    var subject = document.getElementById('kn-subject').value;
    var box = document.getElementById('kn-tree');
    var group = (knowledgeTree || []).find(function (t) { return t.subject === subject; });
    if (!group || !group.nodes.length) {
      box.innerHTML = '<div class="empty-tip" style="padding:20px 0;">该科目暂无知识点，请在上方添加一级知识点</div>';
      return;
    }
    box.innerHTML = group.nodes.map(function (p) {
      var children = p.children.map(function (c) {
        return '<span class="chip">' + ZJ.esc(c.name) +
          '<button class="kn-del" data-id="' + c.id + '" title="删除">✕</button></span>';
      }).join('');
      return '<div class="kn-parent"><div class="kn-row"><b>' + ZJ.esc(p.name) + '</b>' +
        '<button class="kn-del" data-id="' + p.id + '" title="删除（含子级）">✕</button></div>' +
        (children ? '<div class="chip-wrap" style="margin-top:6px;">' + children + '</div>' : '') +
        '<div style="margin-top:6px;"><input type="text" class="kn-child-name" placeholder="添加子知识点…" style="height:30px;border:1px solid var(--c-border);border-radius:6px;padding:0 10px;width:180px;"> ' +
        '<button class="btn-mini" data-kn-add="' + p.id + '">＋ 子级</button></div></div>';
    }).join('');
    box.addEventListener('click', knowledgeTreeActions);
  }

  function knowledgeTreeActions(e) {
    var del = e.target.closest('.kn-del');
    var add = e.target.closest('button[data-kn-add]');
    var subject = document.getElementById('kn-subject').value;
    if (del) {
      Data.knowledgeDelete(Number(del.dataset.id)).then(function (tree) {
        knowledgeTree = tree;
        renderKnowledgeTree();
      }).catch(function (err) { ZJ.toast(err.message, true); });
    } else if (add) {
      var input = add.closest('.kn-parent').querySelector('.kn-child-name');
      var name = input.value.trim();
      if (!name) { ZJ.toast('请输入子知识点名称', true); return; }
      Data.knowledgeAdd(subject, name, Number(add.dataset.knAdd)).then(function (tree) {
        knowledgeTree = tree;
        renderKnowledgeTree();
      }).catch(function (err) { ZJ.toast(err.message, true); });
    }
  }
  document.getElementById('kn-subject').addEventListener('change', renderKnowledgeTree);
  document.getElementById('btn-kn-add-parent').addEventListener('click', function () {
    var subject = document.getElementById('kn-subject').value;
    var name = document.getElementById('kn-name').value.trim();
    if (!subject) { ZJ.toast('请先选择科目（可直接输入新科目后回车）', true); return; }
    if (!name) { ZJ.toast('请输入知识点名称', true); return; }
    Data.knowledgeAdd(subject, name, 0).then(function (tree) {
      knowledgeTree = tree;
      renderKnowledgeTree();
      document.getElementById('kn-name').value = '';
    }).catch(function (err) { ZJ.toast(err.message, true); });
  });

  function openQuestionModal(q) {
    state.editId = q ? q.id : null;
    document.getElementById('qm-title').textContent = q ? '编辑试题 #' + q.id : '新增试题';
    document.getElementById('e-qtype').value = q ? q.qtype : '单选题';
    document.getElementById('e-subject').value = q ? q.subject : document.getElementById('q-subject').value !== '全部科目' ? document.getElementById('q-subject').value : (state.subjects[0] ? state.subjects[0].items[0] : '');
    document.getElementById('e-new-subject-wrap').hidden = true;
    document.getElementById('e-difficulty').value = q ? String(q.difficulty) : '3';
    document.getElementById('e-tags').value = q ? (q.tags || '') : '';
    document.getElementById('e-passage').value = q ? (q.passage || '') : '';
    document.getElementById('e-stem').value = q ? q.stem : '';
    document.getElementById('e-options').value = q && q.options ? q.options.join('\n') : '';
    document.getElementById('e-answer-choice').value = q && q.qtype !== '判断题' ? (q.answer || '') : '';
    document.getElementById('e-answer-judge').value = q && q.answer === '错' ? '错' : '对';
    document.getElementById('e-answer-text').value = q ? (q.answer || '') : '';
    document.getElementById('e-explanation').value = q ? (q.explanation || '') : '';
    document.getElementById('e-score').value = q && q.score ? q.score : '';
    document.getElementById('e-duration').value = q && q.duration ? q.duration : '';
    document.getElementById('e-source').value = q ? (q.source || '') : '';
    document.getElementById('e-status').value = q ? q.status : '启用';
    document.getElementById('e-public').value = q && q.isPublic === false ? '0' : '1';
    editImagePath = q ? (q.imagePath || '') : '';
    renderEditImage();
    editAudioPath = q ? (q.audioPath || '') : '';
    renderEditAudio();
    document.getElementById('e-dup-warning').hidden = true;
    document.getElementById('e-knowledge-picker').hidden = true;
    syncAnswerEditors();
    ZJ.openModal('modal-question');
    ZJ.renderMath(document.getElementById('modal-question'));
  }

  document.getElementById('btn-add-question').addEventListener('click', function () { openQuestionModal(null); });
  document.getElementById('e-qtype').addEventListener('change', syncAnswerEditors);
  document.getElementById('e-subject').addEventListener('change', function (e) {
    document.getElementById('e-new-subject-wrap').hidden = e.target.value !== '__new__';
  });

  document.getElementById('btn-save-question').addEventListener('click', function () {
    var subjectSel = document.getElementById('e-subject').value;
    var subject = subjectSel === '__new__' ? document.getElementById('e-new-subject').value.trim() : subjectSel;
    var qtype = document.getElementById('e-qtype').value;
    var fields = {
      subject: subject,
      qtype: qtype,
      difficulty: Number(document.getElementById('e-difficulty').value),
      tags: document.getElementById('e-tags').value.trim(),
      passage: document.getElementById('e-passage').value.trim(),
      stem: document.getElementById('e-stem').value.trim(),
      answer: '',
      explanation: document.getElementById('e-explanation').value.trim(),
      score: Number(document.getElementById('e-score').value) || 0,
      duration: Number(document.getElementById('e-duration').value) || 0,
      source: document.getElementById('e-source').value.trim(),
      status: document.getElementById('e-status').value,
      imagePath: editImagePath,
      audioPath: editAudioPath,
      isPublic: document.getElementById('e-public').value === '1'
    };
    if (qtype === '单选题' || qtype === '多选题') {
      fields.options = document.getElementById('e-options').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      fields.answer = document.getElementById('e-answer-choice').value.trim();
    } else if (qtype === '判断题') {
      fields.answer = document.getElementById('e-answer-judge').value;
    } else {
      fields.answer = document.getElementById('e-answer-text').value.trim();
    }
    var btn = this;
    btn.disabled = true;
    var req = state.editId ? Data.updateQuestion(state.editId, fields) : Data.createQuestion(fields);
    req.then(function () {
      ZJ.toast(state.editId ? '试题已更新' : '试题已加入题库');
      ZJ.closeModal('modal-question');
      refreshTags();
      loadBank();
    }).catch(function (err) { ZJ.toast(err.message, true); })
      .then(function () { btn.disabled = false; });
  });

  /** 拉取科目库与知识点目录（编辑器下拉与 datalist 用） */
  function refreshTags() {
    return Data.bootstrap().then(function (boot) {
      if (!boot || !boot.subjects) { return null; }
      state.subjects = boot.subjects;
      state.tags = boot.tags || [];
      fillSubjectSelects();
      fillTagDatalists();
      return null;
    }).catch(function () { /* 静默：编辑器仍可用内置科目目录 */ });
  }

  /* ================= Excel 导入导出 ================= */

  document.getElementById('btn-export').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    Data.exportQuestions().then(function () { ZJ.toast('题库导出已开始下载'); })
      .catch(function (err) { ZJ.toast(err.message, true); })
      .then(function () { btn.disabled = false; });
  });
  document.getElementById('btn-template').addEventListener('click', function () {
    Data.downloadTemplate().then(function () { ZJ.toast('模板已开始下载'); })
      .catch(function (err) { ZJ.toast(err.message, true); });
  });
  document.getElementById('btn-import').addEventListener('click', function () {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file) { return; }
    ZJ.confirm('导入题库', '从「' + file.name + '」导入试题？与已有题目不会去重，重复内容请自行在模板中删除。', '开始导入').then(function (ok) {
      if (!ok) { return; }
      Data.importQuestions(file).then(function (r) {
        var msg = '导入成功 ' + r.added + ' 题' + (r.skipped ? '，跳过 ' + r.skipped + ' 行' : '');
        ZJ.toast(msg, r.skipped > 0);
        if (r.errors && r.errors.length) { console.warn('[导入跳过明细]', r.errors); }
        refreshTags();
        loadBank();
      }).catch(function (err) { ZJ.toast(err.message, true); });
    });
  });

  /* ================= 试卷库 ================= */

  function loadPapers() {
    return Data.papers().then(function (list) {
      var grid = document.getElementById('paper-grid');
      document.getElementById('p-count').textContent = list.length ? '共 ' + list.length + ' 套试卷' : '';
      if (!list.length) {
        grid.innerHTML = '<div class="empty-tip"><div class="et-icon">📄</div>还没有试卷：去「组卷台」智能生成，或从题库手动挑题组卷</div>';
        return;
      }
      grid.innerHTML = list.map(function (p) {
        return '<div class="paper-card" data-id="' + p.id + '">' +
          '<div class="pc-head"><div class="pc-name">' + ZJ.esc(p.name) + '</div>' +
          '<span class="tag ' + (p.status === '定稿' ? 'tag-final' : 'tag-draft') + '">' + p.status + '</span></div>' +
          '<div class="pc-line">' + ZJ.esc(p.subjectLine || '未设科目行') + (p.remark ? ' · ' + ZJ.esc(p.remark) : '') + '</div>' +
          '<div class="pc-nums">' +
          '<span><b>' + p.questionCount + '</b>题</span>' +
          '<span><b>' + p.totalScore + '</b>总分</span>' +
          '<span><b>' + (p.duration || '—') + '</b>分钟</span>' +
          '</div>' +
          '<div class="pc-foot">' +
          '<span class="pc-time">' + ZJ.fmtDateTime(p.updatedAt) + ' · ' + ZJ.esc(p.createdBy || '') + '</span>' +
          '<div class="pc-actions">' +
          '<a class="btn-mini primary" href="print.html?id=' + p.id + '&ver=student" target="_blank">学生卷</a>' +
          '<a class="btn-mini primary" href="print.html?id=' + p.id + '&ver=teacher" target="_blank">教师卷</a>' +
          '<button class="btn-mini gold" data-act="edit">编辑</button>' +
          '<button class="btn-mini" data-act="dup">复制</button>' +
          '<button class="btn-mini" data-act="toggle">' + (p.status === '定稿' ? '转草稿' : '定稿') + '</button>' +
          '<button class="btn-mini danger" data-act="del">删除</button>' +
          '</div></div></div>';
      }).join('');
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  document.getElementById('paper-grid').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) { return; }
    var card = btn.closest('.paper-card');
    var id = Number(card.dataset.id);
    var act = btn.dataset.act;
    if (act === 'edit') {
      // 统一到组卷台工作区编辑（载入已有试卷）
      switchTab('builder');
      if (window.ZJ_Builder) { window.ZJ_Builder.loadExisting(id); }
    }
    else if (act === 'dup') {
      Data.duplicatePaper(id).then(function (p) { ZJ.toast('已复制为「' + p.name + '」'); loadPapers(); })
        .catch(function (err) { ZJ.toast(err.message, true); });
    } else if (act === 'toggle') {
      var target = btn.textContent.trim() === '定稿' ? '定稿' : '草稿';
      Data.setPaperStatus(id, target).then(function () { ZJ.toast(target === '定稿' ? '试卷已定稿' : '已转回草稿'); loadPapers(); })
        .catch(function (err) { ZJ.toast(err.message, true); });
    } else if (act === 'del') {
      ZJ.confirm('删除试卷', '删除后不可恢复（题库中的题目不受影响）。确定删除这套试卷吗？', '删除').then(function (ok) {
        if (!ok) { return; }
        Data.deletePaper(id).then(function () { ZJ.toast('试卷已删除'); loadPapers(); })
          .catch(function (err) { ZJ.toast(err.message, true); });
      });
    }
  });

  document.getElementById('btn-goto-builder').addEventListener('click', function () { switchTab('builder'); });

  /* ================= 审计 ================= */

  function loadAudit() {
    var action = document.getElementById('audit-action').value;
    Data.auditList(action).then(function (logs) {
      document.getElementById('audit-count').textContent = '共 ' + logs.length + ' 条';
      var tbody = document.getElementById('audit-tbody');
      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="5"><div class="empty-tip">暂无审计记录</div></td></tr>';
        return;
      }
      var actions = {};
      logs.forEach(function (l) { actions[l.action] = true; });
      var sel = document.getElementById('audit-action');
      var keep = sel.value;
      var existing = Array.prototype.map.call(sel.options, function (o) { return o.value; });
      var add = Object.keys(actions).filter(function (a) { return existing.indexOf(a) < 0; });
      if (add.length) {
        sel.innerHTML = '<option value="全部">全部动作</option>' + Object.keys(actions).map(function (a) {
          return '<option value="' + ZJ.esc(a) + '">' + ZJ.esc(a) + '</option>';
        }).join('');
        sel.value = existing.indexOf(keep) >= 0 ? keep : '全部';
      }
      tbody.innerHTML = logs.map(function (l) {
        return '<tr><td style="font-family:var(--f-num);font-size:12.5px;">' + ZJ.esc(l.ts) + '</td>' +
          '<td>' + ZJ.esc(l.actor) + '</td>' +
          '<td><span class="tag tag-type">' + ZJ.esc(l.action) + '</span></td>' +
          '<td>' + ZJ.esc(l.target || '—') + '</td>' +
          '<td style="color:var(--c-text-sub);font-size:13px;">' + ZJ.esc(l.detail || '') + '</td></tr>';
      }).join('');
    }).catch(function (err) {
      document.getElementById('audit-tbody').innerHTML =
        '<tr><td colspan="5"><div class="empty-tip">' + ZJ.esc(err.message) + '</div></td></tr>';
      document.getElementById('audit-count').textContent = '';
    });
  }
  document.getElementById('audit-action').addEventListener('change', loadAudit);

  /* ================= 弹窗通用关闭 ================= */

  document.querySelectorAll('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { ZJ.closeModal(btn.dataset.close); });
  });
  document.querySelectorAll('.modal-mask').forEach(function (mask) {
    mask.addEventListener('click', function (e) {
      if (e.target === mask && mask.id !== 'zj-confirm-mask') { mask.classList.remove('open'); }
    });
  });

  /* ================= 修改密码 ================= */

  document.getElementById('btn-save-password').addEventListener('click', function () {
    var oldPw = document.getElementById('pw-old').value;
    var newPw = document.getElementById('pw-new').value;
    Data.changePassword(oldPw, newPw).then(function () {
      ZJ.toast('密码已修改');
      ZJ.closeModal('modal-password');
      document.getElementById('pw-old').value = '';
      document.getElementById('pw-new').value = '';
    }).catch(function (err) { ZJ.toast(err.message, true); });
  });

  /* ================= 数据管理（备份/恢复） ================= */

  document.getElementById('btn-backup').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    Data.backup().then(function () { ZJ.toast('备份文件已开始下载'); })
      .catch(function (err) { ZJ.toast(err.message, true); })
      .then(function () { btn.disabled = false; });
  });
  document.getElementById('btn-restore').addEventListener('click', function () {
    document.getElementById('restore-file').click();
  });
  document.getElementById('restore-file').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      var data = null;
      try { data = JSON.parse(reader.result); } catch (e) { ZJ.toast('备份文件解析失败', true); return; }
      ZJ.confirm('恢复备份', '将用备份覆盖当前全部题目/试卷/考试/名单/蓝图（账号不受影响）。确定恢复吗？', '恢复').then(function (ok) {
        if (!ok) { return; }
        Data.restore(data).then(function () {
          ZJ.toast('备份已恢复');
          refreshTags();
          fillBlueprintSelect();
          loadBank();
          refreshOverview();
        }).catch(function (err) { ZJ.toast(err.message, true); });
      });
    };
    reader.readAsText(file, 'utf-8');
  });

  /* ================= 启动 ================= */

  initTopbar();
  initModeChip();
  ZJ.injectWatermark();

  ZJ_READY.then(function () {
    return Data.bootstrap().then(function (boot) {
      // boot 为 null：服务端模式但无令牌（跨模式残留登录态）→ 回登录页
      if (!boot || !boot.subjects) {
        ZJ.clearAuth();
        location.replace('index.html');
        return null;
      }
      state.subjects = boot.subjects;
      state.tags = boot.tags || [];
      fillSubjectSelects();
      fillTypeSelects();
      fillTagDatalists();
      refreshOverview();   // 后台刷新统计（含回收站角标），默认页签为组卷台
      if (window.ZJ_Exams) { window.ZJ_Exams.init({ ZJ: ZJ, Data: Data, state: state }); }
      if (window.ZJ_Builder) { window.ZJ_Builder.init({ ZJ: ZJ, Data: Data, state: state }); }
      switchTab('builder');
      return null;
    });
  }).catch(function (err) {
    // 会话失效（后端重启/数据库重置）：清登录态回登录页
    if (err && err.status === 401) {
      ZJ.clearAuth();
      location.replace('index.html');
      return;
    }
    ZJ.toast(err.message || '初始化失败', true);
  });
})();
