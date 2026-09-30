/* =========================================================
 * 成都智慧象留学 - 国际课程组卷系统 · 真题库与知识点刷题
 *
 * 页签：真题库（Paper 元数据 + QP/MS）｜知识点刷题（P1/P2→Topic→Subtopic→列表→详情→MS）｜我的收藏
 * 由 admin.js 初始化：window.ZJ_Archive.init({ ZJ, Data, state })
 * ========================================================= */
(function () {
  'use strict';

  var ZJ, Data, adminState, root, rootPractice;
  var ready = false;
  var paperFilter = 'P1';          // 刷题页当前 Paper
  var currentTopicId = 0;          // 0 = 全部
  var practiceFilters = { year: '', session: '', difficulty: '' };
  var archiveFilters = { paper: '全部', year: '', session: '', status: '全部状态' };
  var epCache = [];                // 真题卷缓存

  function init(ctx) {
    try {
      ZJ = ctx.ZJ;
      Data = ctx.Data;
      adminState = ctx.state;
      root = document.getElementById('tab-archive');
      rootPractice = document.getElementById('tab-practice');
      bindArchive();
      bindPractice();
      ready = true;
    } catch (e) {
      window.__archiveErr = String(e && e.stack || e);
    }
  }

  function refresh() {
    if (!ready) { return; }
    loadArchive();
    loadTopics();
  }

  /* ================= 真题库 ================= */

  function bindArchive() {
    root.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) { return; }
      var id = Number(btn.dataset.id);
      var act = btn.dataset.act;
      if (act === 'new') { openExamPaperModal(null); }
      else if (act === 'edit') { openExamPaperModal(id); }
      else if (act === 'del') {
        ZJ.confirm('删除真题卷', '删除后该卷下题目将脱离真题关联（题目保留在题库）。确定删除吗？', '删除').then(function (ok) {
          if (!ok) { return; }
          Data.deleteExamPaper(id).then(function () { ZJ.toast('真题卷已删除'); loadArchive(); })
            .catch(function (err) { ZJ.toast(err.message, true); });
        });
      }
    });
    ['ar-paper', 'ar-year', 'ar-session', 'ar-status'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () {
        archiveFilters.paper = document.getElementById('ar-paper').value;
        archiveFilters.year = document.getElementById('ar-year').value;
        archiveFilters.session = document.getElementById('ar-session').value;
        archiveFilters.status = document.getElementById('ar-status').value;
        loadArchive();
      });
    });
    document.getElementById('btn-ep-save').addEventListener('click', saveExamPaper);
    // QP/MS 上传（编辑弹窗内）
    document.getElementById('btn-ep-qp').addEventListener('click', function () { document.getElementById('ep-qp-file').click(); });
    document.getElementById('btn-ep-ms').addEventListener('click', function () { document.getElementById('ep-ms-file').click(); });
    document.getElementById('ep-qp-file').addEventListener('change', function () {
      uploadTo(this, function (r) { document.getElementById('ep-qp-url').value = r.path; ZJ.toast('QP 已上传'); });
    });
    document.getElementById('ep-ms-file').addEventListener('change', function () {
      uploadTo(this, function (r) { document.getElementById('ep-ms-url').value = r.path; ZJ.toast('MS 已上传'); });
    });
  }

  function uploadTo(input, cb) {
    var file = input.files[0];
    input.value = '';
    if (!file) { return; }
    ZJ.toast('上传中…');
    Data.uploadFile(file).then(cb).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function loadArchive() {
    return Data.examPapers(archiveFilters).then(function (list) {
      epCache = list;
      var tbody = document.getElementById('ar-tbody');
      document.getElementById('ar-count').textContent = list.length ? '共 ' + list.length + ' 套' : '';
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-tip">没有真题卷，点「新建真题卷」录入</div></td></tr>';
        return;
      }
      tbody.innerHTML = list.map(function (p) {
        var res = (p.resourceType === 'official_link' ? '链接型' : p.resourceType === 'owned_content' ? '自有内容' : '托管文件');
        return '<tr data-id="' + p.id + '">' +
          '<td><b style="font-family:var(--f-serif);color:var(--c-navy-2);">' + ZJ.esc(p.paperName) + '</b>' +
          '<div class="cell-sub">' + ZJ.esc(p.paperCode || '—') + ' · ' + ZJ.esc(p.examBoard) + '</div></td>' +
          '<td style="font-family:var(--f-num);">' + p.year + '</td>' +
          '<td>' + ZJ.esc(p.session || '—') + '</td>' +
          '<td style="font-family:var(--f-num);">' + p.questionCount + '</td>' +
          '<td>' + res + '</td>' +
          '<td><span class="tag ' + (p.status === 'published' ? 'tag-ok' : p.status === 'draft' ? 'tag-draft' : 'tag-off') + '">' +
          (p.status === 'published' ? '已发布' : p.status === 'draft' ? '草稿' : '已下架') + '</span></td>' +
          '<td><div class="row-actions">' +
          (p.qpUrl ? '<a class="btn-mini primary" href="/' + ZJ.esc(p.qpUrl) + '" target="_blank">QP</a>' : '<span class="cell-sub">QP 未传</span>') +
          (p.msUrl ? '<a class="btn-mini primary" href="/' + ZJ.esc(p.msUrl) + '" target="_blank">MS</a>' : '<span class="cell-sub">MS 未传</span>') +
          '<button class="btn-mini gold" data-act="edit" data-id="' + p.id + '">编辑</button>' +
          '<button class="btn-mini danger" data-act="del" data-id="' + p.id + '">删除</button>' +
          '</div></td></tr>';
      }).join('');
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function openExamPaperModal(id) {
    var p = null;
    epCache.forEach(function (x) { if (x.id === id) { p = x; } });
    document.getElementById('ep-title').textContent = p ? '编辑真题卷 #' + p.id : '新建真题卷';
    document.getElementById('ep-id').value = p ? p.id : '';
    document.getElementById('ep-paper').value = p ? p.paperName : 'P1';
    document.getElementById('ep-code').value = p ? (p.paperCode || '') : '';
    document.getElementById('ep-year').value = p ? p.year : ZJ.todayStr().slice(0, 4);
    document.getElementById('ep-session').value = p ? (p.session || 'June') : 'June';
    document.getElementById('ep-qp-url').value = p ? (p.qpUrl || '') : '';
    document.getElementById('ep-ms-url').value = p ? (p.msUrl || '') : '';
    document.getElementById('ep-status').value = p ? p.status : 'published';
    ZJ.openModal('modal-exampaper');
  }

  function saveExamPaper() {
    var id = document.getElementById('ep-id').value;
    var fields = {
      paperName: document.getElementById('ep-paper').value,
      paperCode: document.getElementById('ep-code').value.trim(),
      year: Number(document.getElementById('ep-year').value),
      session: document.getElementById('ep-session').value,
      qpUrl: document.getElementById('ep-qp-url').value.trim(),
      msUrl: document.getElementById('ep-ms-url').value.trim(),
      status: document.getElementById('ep-status').value
    };
    var req = id ? Data.updateExamPaper(Number(id), fields) : Data.createExamPaper(fields);
    req.then(function () {
      ZJ.toast(id ? '真题卷已更新' : '真题卷已创建');
      ZJ.closeModal('modal-exampaper');
      loadArchive();
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  /* ================= 知识点刷题 ================= */

  function bindPractice() {
    document.getElementById('pt-paper').addEventListener('change', function () {
      paperFilter = this.value;
      currentTopicId = 0;
      loadTopics();
    });
    document.querySelectorAll('#tab-practice .topic-pill').forEach(function () { /* 动态绑定在渲染时 */ });
    document.getElementById('practice-list').addEventListener('click', function (e) {
      var fav = e.target.closest('button[data-act="fav"]');
      if (fav) {
        var qid = Number(fav.dataset.qid);
        var isFav = fav.dataset.fav === '1';
        var req = isFav ? Data.removeFavorite(qid) : Data.addFavorite(qid);
        req.then(function () {
          fav.dataset.fav = isFav ? '0' : '1';
          fav.classList.toggle('on', !isFav);
          fav.textContent = isFav ? '♡' : '♥';
        }).catch(function (err) { ZJ.toast(err.message, true); });
        return;
      }
      var add = e.target.closest('button[data-act="add"]');
      if (add) {
        var q = null;
        (practiceCache || []).forEach(function (x) { if (x.id === Number(add.dataset.qid)) { q = x; } });
        if (q && window.ZJ_Builder) {
          window.ZJ_Builder.addQuestion(q);
          ZJ.toast('已加入组卷台试卷');
        }
        return;
      }
      var card = e.target.closest('.pq-card');
      if (card) { openQuestionDetail(Number(card.dataset.qid)); }
    });
    ['pf-year', 'pf-session', 'pf-diff'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', loadPractice);
    });
    document.getElementById('pf-search').addEventListener('input', ZJ.debounce(function (e) {
      practiceFilters.q = e.target.value.trim();
      loadPractice();
    }, 300));
    document.getElementById('pf-dl').addEventListener('click', function () {
      var pane = document.getElementById('dl-pane');
      pane.hidden = !pane.hidden;
      document.getElementById('practice-fav-pane').hidden = true;
      if (!pane.hidden) { loadDownloads(); }
    });
    document.getElementById('pf-fav').addEventListener('click', function () {
      document.getElementById('practice-fav-pane').hidden = !document.getElementById('practice-fav-pane').hidden;
      if (!document.getElementById('practice-fav-pane').hidden) { loadFavorites(); }
    });
  }

  function loadTopics() {
    return Data.examTopics(paperFilter).then(function (t) {
      var box = document.getElementById('topic-pills');
      var html = '<span class="chip on" data-tid="0">全部</span>';
      t.topics.forEach(function (tp) {
        html += '<span class="chip topic-pill" data-tid="' + tp.id + '">' + ZJ.esc(tp.name) +
          ' <i style="font-style:normal;opacity:.65;">' + tp.count + '</i></span>';
      });
      box.innerHTML = html;
      box.addEventListener('click', topicPillClick);
      loadPractice();
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function topicPillClick(e) {
    var chip = e.target.closest('.chip[data-tid]');
    if (!chip) { return; }
    currentTopicId = Number(chip.dataset.tid);
    document.querySelectorAll('#topic-pills .chip').forEach(function (c) { c.classList.toggle('on', c === chip); });
    loadPractice();
  }

  var practiceCache = [];

  function loadPractice() {
    practiceFilters.year = document.getElementById('pf-year').value;
    practiceFilters.session = document.getElementById('pf-session').value;
    practiceFilters.difficulty = document.getElementById('pf-diff').value;
    var searching = !!(practiceFilters.q && practiceFilters.q.length);
    var filters = {
      page: 1, page_size: 50,
      q: practiceFilters.q || '',
      // 有关键词时放宽到全库（卡片上标注 真题/练习）；否则仅真题
      only_exam: searching ? '' : '1',
      exam_paper: searching ? '' : paperFilter,
      topic_id: searching ? '' : (currentTopicId || ''),
      year: practiceFilters.year,
      session: practiceFilters.session,
      difficulty: practiceFilters.difficulty
    };
    return Data.questions(filters).then(function (list) {
      practiceCache = list;
      var box = document.getElementById('practice-list');
      document.getElementById('practice-count').textContent = list.length ? '共 ' + list.length + ' 题' : '';
      if (!list.length) {
        box.innerHTML = '<div class="empty-tip" style="padding:30px 0;">该知识点下暂无已发布真题，换一个 Topic 或筛选条件</div>';
        return;
      }
      box.innerHTML = list.map(function (q) {
        var stem = q.stem.length > 72 ? q.stem.slice(0, 72) + '…' : q.stem;
        return '<div class="pq-card" data-qid="' + q.id + '">' +
          '<div class="pq-main">' +
          '<div class="pq-stem">' + (q.audioPath ? '🔊 ' : '') + (q.imagePath ? '🖼 ' : '') + ZJ.esc(stem) + '</div>' +
          '<div class="pq-meta">' +
          '<span class="tag tag-type">' + ZJ.esc(q.qtype) + '</span>' +
          '<span class="tag ' + ZJ.diffClass(q.difficulty) + '">难度 ' + q.difficulty + '</span>' +
          '<span class="tag tag-subject">' + (q.marks || q.score || '—') + ' 分</span>' +
          '<span class="tag tag-off">' + (q.questionNumber ? 'Q' + ZJ.esc(q.questionNumber) + (q.subQuestion ? '(' + ZJ.esc(q.subQuestion) + ')' : '') : '—') + '</span>' +
          '<span>' + (q.examPaperId ? '真题' : '练习') + '</span>' +
          '</div></div>' +
          '<div class="pq-tools">' +
          '<button class="btn-mini star-btn' + (q.favorite ? ' on' : '') + '" data-act="fav" data-qid="' + q.id + '" data-fav="' + (q.favorite ? '1' : '0') + '">' + (q.favorite ? '♥' : '♡') + '</button>' +
          '<button class="btn-mini primary" data-act="add" data-qid="' + q.id + '" title="加入组卷台试卷">+ 试卷</button>' +
          '</div></div>';
      }).join('');
      ZJ.renderMath(box);
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  /* ================= 下载记录 ================= */

  function loadDownloads() {
    return Data.generatedFiles().then(function (r) {
      var box = document.getElementById('dl-list');
      var files = r.files || [];
      if (!files.length) {
        box.innerHTML = '<div class="empty-tip" style="padding:24px 0;">暂无生成记录：在组卷台点「保存并打印」后此处出现 QP/MS 记录</div>';
        return;
      }
      box.innerHTML = files.map(function (f) {
        return '<div class="pq-card"><div class="pq-main">' +
          '<div class="pq-stem">' + ZJ.esc(f.paperName || ('试卷 #' + f.user_paper_id)) + '</div>' +
          '<div class="pq-meta"><span class="tag ' + (f.kind === 'ms' ? 'tag-d3' : 'tag-d1') + '">' +
          (f.kind === 'ms' ? 'Mark Scheme' : 'Question Paper') + '</span>' +
          '<span class="tag tag-ok">' + f.status + '</span>' +
          '<span>' + ZJ.fmtDateTime(f.created_at) + '</span></div></div>' +
          '<a class="btn-mini primary" href="print.html?id=' + f.user_paper_id + '&ver=' + (f.kind === 'ms' ? 'teacher' : 'student') + '" target="_blank">重新打开</a>' +
          '</div>';
      }).join('');
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  /* ================= 题目详情（含 MS 展开） ================= */

  function openQuestionDetail(qid) {
    var q = null;
    practiceCache.forEach(function (x) { if (x.id === qid) { q = x; } });
    if (!q) { return; }
    var modal = document.getElementById('modal-qd');
    var tags =
      '<span class="tag tag-subject">' + ZJ.esc(q.subject) + '</span>' +
      '<span class="tag tag-type">' + ZJ.esc(q.qtype) + '</span>' +
      '<span class="tag ' + ZJ.diffClass(q.difficulty) + '">难度 ' + q.difficulty + '</span>' +
      '<span class="tag tag-draft">' + (q.score || '—') + ' 分</span>';
    var html =
      '<div class="qc-head"><div class="qc-tags">' + tags + '</div></div>' +
      '<div class="qc-stem" style="margin-top:6px;">' + ZJ.esc(q.stem) + '</div>' +
      ZJ.questionAudioHtml(q) + ZJ.questionImageHtml(q);
    if ((q.qtype === '单选题' || q.qtype === '多选题') && q.options && q.options.length) {
      html += '<ul class="qc-options">';
      q.options.forEach(function (opt, i) {
        html += '<li data-letter="' + String.fromCharCode(65 + i) + '">' + ZJ.esc(String(opt).replace(/^[A-Za-z][.、．]\s*/, '')) + '</li>';
      });
      html += '</ul>';
    }
    document.getElementById('qd-body').innerHTML = html;
    // MS（答案）展开区
    var ms = '';
    if (q.answerImageUrl) {
      ms = '<img src="/' + ZJ.esc(q.answerImageUrl) + '" style="max-width:100%;border:1px solid var(--c-border);border-radius:6px;">';
    } else {
      ms = (q.answer ? '<div class="qc-answer"><b>答案：</b>' + ZJ.esc(q.answer) + '</div>' : '') +
        (q.explanation ? '<div class="qc-explain"><b>解析：</b>' + ZJ.esc(q.explanation) + '</div>' : '<div class="f-hint">本题暂无 Mark Scheme</div>');
    }
    document.getElementById('qd-ms').innerHTML = ms;
    document.getElementById('qd-ms').hidden = true;
    var favBtn = document.getElementById('qd-fav');
    favBtn.dataset.qid = q.id;
    favBtn.dataset.fav = q.favorite ? '1' : '0';
    favBtn.textContent = (q.favorite ? '♥ 已收藏' : '♡ 收藏');
    favBtn.classList.toggle('on', !!q.favorite);
    var addBtn = document.getElementById('qd-add');
    addBtn.dataset.qid = q.id;
    ZJ.openModal('modal-qd');
    ZJ.renderMath(modal);
  }

  function bindDetail() {
    document.getElementById('qd-toggle-ms').addEventListener('click', function () {
      var ms = document.getElementById('qd-ms');
      ms.hidden = !ms.hidden;
      this.textContent = ms.hidden ? '查看 Mark Scheme' : '收起 Mark Scheme';
    });
    document.getElementById('qd-fav').addEventListener('click', function () {
      var qid = Number(this.dataset.qid);
      var isFav = this.dataset.fav === '1';
      var req = isFav ? Data.removeFavorite(qid) : Data.addFavorite(qid);
      var btn = this;
      req.then(function () {
        btn.dataset.fav = isFav ? '0' : '1';
        btn.textContent = isFav ? '♡ 收藏' : '♥ 已收藏';
        btn.classList.toggle('on', !isFav);
        loadPractice();
      }).catch(function (err) { ZJ.toast(err.message, true); });
    });
    document.getElementById('qd-add').addEventListener('click', function () {
      var qid = Number(this.dataset.qid);
      var q = null;
      practiceCache.forEach(function (x) { if (x.id === qid) { q = x; } });
      if (q && window.ZJ_Builder) {
        window.ZJ_Builder.addQuestion(q);
        ZJ.closeModal('modal-qd');
        ZJ.toast('已加入组卷台试卷');
      }
    });
  }

  /* ================= 我的收藏 ================= */

  function loadFavorites() {
    return Data.favorites().then(function (list) {
      var box = document.getElementById('fav-list');
      if (!list.length) {
        box.innerHTML = '<div class="empty-tip" style="padding:24px 0;">还没有收藏题目：在题目卡片点 ♡ 收藏</div>';
        return;
      }
      box.innerHTML = list.map(function (q) {
        var stem = q.stem.length > 60 ? q.stem.slice(0, 60) + '…' : q.stem;
        return '<div class="pq-card" data-qid="' + q.id + '">' +
          '<div class="pq-main"><div class="pq-stem">' + ZJ.esc(stem) + '</div>' +
          '<div class="pq-meta">' + ZJ.esc(q.subject) + ' · ' + ZJ.esc(q.qtype) + ' · 难度 ' + q.difficulty + '</div></div>' +
          '<div class="pq-tools"><button class="btn-mini danger" data-act="unfav" data-qid="' + q.id + '">取消收藏</button></div></div>';
      }).join('');
      box.onclick = function (e) {
        var btn = e.target.closest('button[data-act="unfav"]');
        if (!btn) { return; }
        Data.removeFavorite(Number(btn.dataset.qid)).then(function () { loadFavorites(); })
          .catch(function (err) { ZJ.toast(err.message, true); });
      };
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  window.ZJ_Archive = {
    init: function (ctx) {
      init(ctx);
      bindDetail();
    },
    refresh: function () { refresh(); }
  };
})();
