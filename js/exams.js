/* =========================================================
 * 成都智慧象留学 - 国际课程组卷系统 · 考试与成绩模块
 *
 * 视图：考试列表 → 录分（按考生 × 按题登记，客观题一键判分）→ 统计报告
 * 由 admin.js 初始化（window.ZJ_Exams.init），页签切换时调用 refresh()。
 * ========================================================= */
(function () {
  'use strict';

  var ZJ, Data, root;
  var ready = false;
  var pendingRefresh = false;
  var currentView = 'list';
  var currentExamId = null;
  var currentExam = null;
  var currentCandidate = null;
  var scoreDraft = {};      // questionId -> 数值（'' 表示未录）

  function init(ctx) {
    ZJ = ctx.ZJ;
    Data = ctx.Data;
    root = document.getElementById('tab-exams');
    root.addEventListener('click', listActions);
    bindCreateModal();
    ready = true;
    if (pendingRefresh) {
      pendingRefresh = false;
      refresh();
    }
  }

  function refresh() {
    // admin 的 bootstrap 未完成时（用户抢先点页签），挂起待 init 后补刷
    if (!ready) { pendingRefresh = true; return Promise.resolve(); }
    if (currentView === 'entry' && currentExamId) {
      return loadEntry(currentExamId, currentCandidate);
    }
    if (currentView === 'report' && currentExamId) {
      return loadReport(currentExamId);
    }
    return loadList();
  }

  /* ================= 考试列表 ================= */

  function loadList() {
    currentView = 'list';
    return Data.exams().then(function (list) {
      root.innerHTML =
        '<div class="toolbar">' +
        '  <button class="btn btn-primary" id="btn-open-exam-modal">＋ 创建考试</button>' +
        '  <span class="result-count">' + (list.length ? '共 ' + list.length + ' 场考试' : '') + '</span>' +
        '</div>' +
        (list.length
          ? '<div class="table-wrap"><table class="data"><thead><tr>' +
            '<th style="width:220px;">考试</th><th>关联试卷</th><th style="width:110px;">日期</th>' +
            '<th style="width:90px;">考生</th><th style="width:130px;">录分进度</th>' +
            '<th style="width:90px;">平均分</th><th style="width:86px;">状态</th><th style="width:230px;">操作</th>' +
            '</tr></thead><tbody>' +
            list.map(function (e) {
              var prog = e.enteredCandidates + '/' + e.candidateCount;
              var online = e.onlineCode
                ? '<div class="cell-sub">答题码 <b class="online-code">' + ZJ.esc(e.onlineCode) + '</b> ' +
                  '<button class="btn-mini" data-act="copy-link" data-id="' + e.id + '" data-code="' + ZJ.esc(e.onlineCode) + '">复制学生链接</button> ' +
                  '<button class="btn-mini" data-act="toggle-online" data-id="' + e.id + '" data-on="0">关闭在线</button></div>'
                : '<div class="cell-sub"><button class="btn-mini" data-act="toggle-online" data-id="' + e.id + '" data-on="1">开启在线作答</button></div>';
              return '<tr>' +
                '<td><b style="font-family:var(--f-serif);color:var(--c-navy-2);">' + ZJ.esc(e.name) + '</b>' +
                (e.remark ? '<div class="cell-sub">' + ZJ.esc(e.remark) + '</div>' : '') + '</td>' +
                '<td>' + ZJ.esc(e.paperName) + '<div class="cell-sub">总分 ' + e.totalScore + '</div></td>' +
                '<td style="font-family:var(--f-num);font-size:12.5px;">' + ZJ.esc(e.examDate || '—') + '</td>' +
                '<td style="font-family:var(--f-num);">' + e.candidateCount + '</td>' +
                '<td style="font-family:var(--f-num);">' + prog + (e.avgScore !== null ? ' · 均 ' + e.avgScore : '') + '</td>' +
                '<td style="font-family:var(--f-num);font-weight:600;color:var(--c-navy-2);">' + (e.avgScore !== null ? e.avgScore : '—') + '</td>' +
                '<td><span class="tag ' + (e.status === '已完结' ? 'tag-final' : 'tag-draft') + '">' + e.status + '</span>' + online + '</td>' +
                '<td><div class="row-actions">' +
                '<button class="btn-mini primary" data-act="entry" data-id="' + e.id + '">录分</button>' +
                '<button class="btn-mini gold" data-act="report" data-id="' + e.id + '">报告</button>' +
                '<button class="btn-mini" data-act="export" data-id="' + e.id + '">导出</button>' +
                '<button class="btn-mini" data-act="toggle" data-id="' + e.id + '" data-status="' + e.status + '">' + (e.status === '已完结' ? '重开' : '完结') + '</button>' +
                '<button class="btn-mini danger" data-act="del" data-id="' + e.id + '">删除</button>' +
                '</div></td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<div class="card"><div class="empty-tip">还没有考试：用「试卷库」里的试卷创建一场，考后按题录分自动生成统计报告</div></div>');
      root.querySelector('#btn-open-exam-modal').addEventListener('click', openExamModal);
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function listActions(e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) { return; }
    var id = Number(btn.dataset.id);
    var act = btn.dataset.act;
    if (act === 'entry') {
      loadEntry(id, null);
    } else if (act === 'report') {
      loadReport(id);
    } else if (act === 'export') {
      var btnName = btn.closest('tr').querySelector('td b');
      Data.exportExamScores(id, btnName ? btnName.textContent : '考试')
        .then(function () { ZJ.toast('成绩单已开始下载'); })
        .catch(function (err) { ZJ.toast(err.message, true); });
    } else if (act === 'copy-link') {
      var link = location.origin + '/answer.html?examId=' + id;
      var text = '在线答题链接：' + link + '　答题码：' + btn.dataset.code;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { ZJ.toast('学生答题链接与答题码已复制'); })
          .catch(function () { ZJ.toast(text); });
      } else {
        ZJ.toast(text);
      }
    } else if (act === 'toggle-online') {
      var on = btn.dataset.on === '1';
      Data.updateExam(id, { online: on }).then(function (exam) {
        ZJ.toast(on ? '已开启在线作答，答题码 ' + exam.onlineCode : '已关闭在线作答');
        loadList();
      }).catch(function (err) { ZJ.toast(err.message, true); });
    } else if (act === 'toggle') {
      var target = btn.dataset.status === '已完结' ? '进行中' : '已完结';
      Data.updateExam(id, { status: target }).then(function () {
        ZJ.toast(target === '已完结' ? '考试已完结' : '已重开为进行中');
        loadList();
      }).catch(function (err) { ZJ.toast(err.message, true); });
    } else if (act === 'del') {
      ZJ.confirm('删除考试', '删除考试将同时删除已录成绩，确定吗？', '删除').then(function (ok) {
        if (!ok) { return; }
        Data.deleteExam(id).then(function () { ZJ.toast('考试已删除'); loadList(); })
          .catch(function (err) { ZJ.toast(err.message, true); });
      });
    }
  }
  // listActions 由 init() 一次性绑定到 root（事件委托），页面重渲染无需重绑

  /* ================= 创建考试弹窗 ================= */

  function bindCreateModal() {
    document.getElementById('btn-create-exam').addEventListener('click', function () {
      var name = document.getElementById('x-name').value.trim();
      var paperId = Number(document.getElementById('x-paper').value);
      var date = document.getElementById('x-date').value;
      var remark = document.getElementById('x-remark').value.trim();
      if (!name) { ZJ.toast('请填写考试名称', true); return; }
      // 勾选的考生 + 粘贴框考生
      var candidates = [];
      document.querySelectorAll('#x-roster input:checked').forEach(function (cb) {
        candidates.push({ name: cb.dataset.name, className: cb.dataset.className || '' });
      });
      var paste = document.getElementById('x-paste').value.trim();
      var pasteList = [];
      if (paste) {
        paste.split('\n').forEach(function (line) {
          var parts = line.replace(/，/g, ',').split(',').map(function (s) { return s.trim(); });
          if (parts[0]) { pasteList.push({ name: parts[0], className: parts[1] || '' }); }
        });
      }
      var finish = function (extra) {
        var all = candidates.concat(extra || []);
        if (!all.length) { ZJ.toast('请至少选择或录入一名考生', true); return; }
        Data.createExam({
          name: name, paperId: paperId, examDate: date, remark: remark,
          candidates: all, online: document.getElementById('x-online').checked
        }).then(function (exam) {
          ZJ.toast('考试「' + exam.name + '」已创建' +
            (exam.onlineCode ? '，答题码 ' + exam.onlineCode : ''));
          ZJ.closeModal('modal-exam');
          currentExamId = exam.id;
          loadEntry(exam.id, null);
        }).catch(function (err) { ZJ.toast(err.message, true); });
      };
      if (pasteList.length) {
        // 粘贴考生同时加入花名册（去重交给后端）
        Data.rosterAdd(pasteList).then(function () { finish(pasteList); })
          .catch(function () { finish(pasteList); });
      } else {
        finish();
      }
    });
  }

  function openExamModal() {
    return Promise.all([Data.papers(), Data.roster()]).then(function (rs) {
      var papers = rs[0], roster = rs[1];
      var sel = document.getElementById('x-paper');
      sel.innerHTML = '<option value="">选择试卷…</option>' + papers.map(function (p) {
        return '<option value="' + p.id + '">' + ZJ.esc(p.name) + '（' + p.questionCount + ' 题 / ' + p.totalScore + ' 分）</option>';
      }).join('');
      var box = document.getElementById('x-roster');
      if (!roster.length) {
        box.innerHTML = '<div class="empty-tip" style="padding:14px 0;">花名册为空，请在下方批量粘贴考生</div>';
      } else {
        var cls = null;
        var html = '';
        roster.forEach(function (s) {
          var c = s.class_name || s.className || '';
          if (c !== cls) {
            if (cls !== null) { html += '</div>'; }
            html += '<div class="chip-group">' + ZJ.esc(c || '未分班') + '</div><div class="chip-wrap">';
            cls = c;
          }
          html += '<label class="chip" style="gap:6px;"><input type="checkbox" data-name="' + ZJ.esc(s.name) +
            '" data-class-name="' + ZJ.esc(c) + '"> ' + ZJ.esc(s.name) + '</label>';
        });
        html += '</div>';
        box.innerHTML = html;
      }
      document.getElementById('x-name').value = '';
      document.getElementById('x-date').value = ZJ.todayStr();
      document.getElementById('x-remark').value = '';
      document.getElementById('x-paste').value = '';
      ZJ.openModal('modal-exam');
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  /* ================= 录分视图 ================= */

  function loadEntry(examId, candidateId) {
    currentView = 'entry';
    currentExamId = examId;
    return Data.exam(examId).then(function (exam) {
      currentExam = exam;
      if (!exam.candidates.length) {
        root.innerHTML = backBar() + '<div class="card"><div class="empty-tip">这场考试没有考生</div></div>';
        bindBack();
        return;
      }
      currentCandidate = candidateId || exam.candidates[0].id;
      // 把已有成绩装入草稿
      scoreDraft = {};
      exam.scores.forEach(function (s) {
        if (s.candidateId === currentCandidate) { scoreDraft[s.questionId] = s.score; }
      });
      renderEntry();
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function backBar() {
    return '<div class="toolbar"><button class="btn btn-ghost" id="btn-exam-back">← 返回考试列表</button></div>';
  }
  function bindBack() {
    var b = document.getElementById('btn-exam-back');
    if (b) { b.addEventListener('click', function () { currentExamId = null; loadList(); }); }
  }

  function candTotal() {
    var t = 0;
    Object.keys(scoreDraft).forEach(function (k) { t += Number(scoreDraft[k]) || 0; });
    return Math.round(t * 10) / 10;
  }

  function renderEntry() {
    var exam = currentExam;
    var cand = exam.candidates.find(function (c) { return c.id === currentCandidate; });
    var objective = exam.items.filter(function (it) {
      return it.qtype === '单选题' || it.qtype === '多选题' || it.qtype === '判断题';
    });
    // 该生的在线主观题作答（questionId -> 文本）
    var answerMap = {};
    (exam.answers || []).forEach(function (a) {
      if (a.candidateId === currentCandidate) { answerMap[a.questionId] = a.answerText; }
    });
    var html = backBar() +
      '<div class="entry-head">' +
      '  <div><div class="eh-title">' + ZJ.esc(exam.name) + '</div>' +
      '  <div class="eh-sub">' + ZJ.esc(exam.paperName) + ' · 共 ' + exam.items.length + ' 题 · 总分 ' +
      (Math.round(exam.items.reduce(function (s, it) { return s + it.fullScore; }, 0) * 10) / 10) +
      (exam.onlineCode ? ' · 在线答题码 <b class="online-code">' + ZJ.esc(exam.onlineCode) + '</b>' : '') + '</div></div>' +
      '  <div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '    <input type="file" id="sheet-file" accept=".png,.jpg,.jpeg,.webp" hidden>' +
      '    <button class="btn btn-ghost" id="btn-upload-sheet">上传答题卡照片</button>' +
      '    <button class="btn btn-ghost" id="btn-exam-report">查看统计报告</button>' +
      '  </div>' +
      '</div>' +
      '<div class="entry-grid">' +
      // 左：考生列表
      '  <div class="card cand-pane"><div class="section-head"><h2>考生</h2></div>' +
      exam.candidates.map(function (c) {
        var active = c.id === currentCandidate;
        return '<div class="cand-row' + (active ? ' active' : '') + '" data-cid="' + c.id + '">' +
          '<div class="cr-main"><b>' + ZJ.esc(c.name) + '</b>' +
          '<span class="cell-sub">' + ZJ.esc(c.className || '未分班') +
          (c.sheetPath ? ' · <a href="/' + ZJ.esc(c.sheetPath) + '" target="_blank" class="sheet-link">答题卡照片</a>' : '') +
          '</span></div>' +
          '<div class="cr-num"><b>' + c.totalScore + '</b> 分<div class="cell-sub">' + c.enteredCount + '/' + c.questionCount + ' 题</div></div>' +
          '</div>';
      }).join('') +
      '  </div>' +
      // 右：录分表
      '  <div class="card score-pane">' +
      '    <div class="section-head"><h2>' + ZJ.esc(cand.name) + ' · 按题录分</h2>' +
      '    <span class="sec-note">客观题可按标准答案速判；主观题可对照学生在线作答</span></div>' +
      (objective.length
        ? '<div class="toolbar" style="margin-bottom:14px;">' +
          '<button class="btn btn-ghost" id="btn-obj-all">客观题全对</button>' +
          '<button class="btn btn-ghost" id="btn-obj-none">客观题全错</button>' +
          '<button class="btn btn-ghost" id="btn-clear-all">清空本题全部得分</button>' +
          '</div>'
        : '') +
      '    <div class="score-grid">' +
      exam.items.map(function (it, i) {
        var v = scoreDraft[it.questionId];
        var ansText = answerMap[it.questionId];
        var isObj = it.qtype === '单选题' || it.qtype === '多选题' || it.qtype === '判断题';
        var quick = isObj
          ? '<span class="sq-quick">' +
            '<button class="btn-mini primary" data-quick="full" data-qid="' + it.questionId + '" data-full="' + it.fullScore + '" title="判对（满分）">✓</button>' +
            '<button class="btn-mini danger" data-quick="zero" data-qid="' + it.questionId + '" title="判错（0分）">✗</button></span>'
          : '';
        var answerHint = isObj ? '<span class="sq-answer">答案 ' + ZJ.esc(it.qtype === '判断题' ? '对/错' : '见批注') + '</span>' : '';
        var onlineAns = ansText
          ? '<div class="online-answer"><b>学生在线作答：</b>' + ZJ.esc(ansText) + '</div>'
          : (it.qtype === '填空题' ? '<div class="online-answer hint">填空题参考答案以题库为准</div>' : '');
        return '<div class="score-row-wrap">' +
          '<div class="score-row">' +
          '<span class="sq-no">' + (i + 1) + '</span>' +
          '<span class="sq-stem" title="' + ZJ.esc(it.stem) + '">[' + ZJ.esc(it.qtype) + ' · ' + it.fullScore + '分] ' + ZJ.esc(it.stem) + '</span>' +
          quick +
          '<input type="number" class="sq-score" data-qid="' + it.questionId + '" min="0" max="' + it.fullScore + '" step="0.5" value="' + (v === undefined ? '' : v) + '" placeholder="—">' +
          '</div>' + onlineAns + '</div>';
      }).join('') +
      '    </div>' +
      '    <div class="gen-summary" style="position:static;margin-top:16px;">' +
      '      <span class="gs-item"><b id="entry-sum">' + candTotal() + '</b>当前合计</span>' +
      '      <span class="gs-item" id="entry-progress">已录 ' + Object.keys(scoreDraft).length + '/' + exam.items.length + ' 题</span>' +
      '      <span class="spacer"></span>' +
      '      <button class="btn btn-accent" id="btn-save-scores">保存本科目成绩</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    root.innerHTML = html;
    ZJ.renderMath(root);
    bindBack();
    root.querySelector('#btn-exam-report').addEventListener('click', function () { loadReport(exam.id); });
    // 答题卡照片上传
    var sheetInput = root.querySelector('#sheet-file');
    root.querySelector('#btn-upload-sheet').addEventListener('click', function () { sheetInput.click(); });
    sheetInput.addEventListener('change', function () {
      var file = this.files[0];
      this.value = '';
      if (!file) { return; }
      Data.uploadAnswerSheet(exam.id, currentCandidate, file).then(function () {
        ZJ.toast('答题卡照片已上传');
        loadEntry(exam.id, currentCandidate);
      }).catch(function (err) { ZJ.toast(err.message, true); });
    });
    root.querySelectorAll('.cand-row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.closest('button') || e.target.closest('a')) { return; }
        currentCandidate = Number(row.dataset.cid);
        loadEntry(exam.id, currentCandidate);
      });
    });
    root.querySelectorAll('.sq-score').forEach(function (input) {
      input.addEventListener('input', function () {
        var qid = Number(input.dataset.qid);
        var v = input.value === '' ? '' : Math.max(0, Number(input.value) || 0);
        if (v !== '') { scoreDraft[qid] = v; } else { delete scoreDraft[qid]; }
        document.getElementById('entry-sum').textContent = candTotal();
        document.getElementById('entry-progress').textContent = '已录 ' + Object.keys(scoreDraft).length + '/' + currentExam.items.length + ' 题';
      });
    });
    // ✓/✗ 速判
    root.querySelectorAll('button[data-quick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var qid = Number(btn.dataset.qid);
        scoreDraft[qid] = btn.dataset.quick === 'full' ? Number(btn.dataset.full) : 0;
        var input = root.querySelector('.sq-score[data-qid="' + qid + '"]');
        if (input) { input.value = scoreDraft[qid]; }
        document.getElementById('entry-sum').textContent = candTotal();
        document.getElementById('entry-progress').textContent = '已录 ' + Object.keys(scoreDraft).length + '/' + currentExam.items.length + ' 题';
      });
    });
    var saveBtn = root.querySelector('#btn-save-scores');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var payload = {};
        Object.keys(scoreDraft).forEach(function (k) { payload[k] = scoreDraft[k]; });
        currentExam.items.forEach(function (it) {
          if (!(it.questionId in payload)) { payload[it.questionId] = null; }
        });
        Data.saveExamScores(exam.id, currentCandidate, payload).then(function (r) {
          ZJ.toast('已保存：' + r.enteredCount + ' 题 / 合计 ' + r.totalScore + ' 分');
          loadEntry(exam.id, currentCandidate);
        }).catch(function (err) { ZJ.toast(err.message, true); });
      });
    }
    var objAll = root.querySelector('#btn-obj-all');
    if (objAll) {
      objAll.addEventListener('click', function () {
        currentExam.items.forEach(function (it) {
          if (objective.some(function (o) { return o.questionId === it.questionId; })) {
            scoreDraft[it.questionId] = it.fullScore;
          }
        });
        renderEntry();
      });
      root.querySelector('#btn-obj-none').addEventListener('click', function () {
        currentExam.items.forEach(function (it) {
          if (objective.some(function (o) { return o.questionId === it.questionId; })) {
            scoreDraft[it.questionId] = 0;
          }
        });
        renderEntry();
      });
      root.querySelector('#btn-clear-all').addEventListener('click', function () {
        scoreDraft = {};
        renderEntry();
      });
    }
  }

  /* ================= 统计报告 ================= */

  function loadReport(examId) {
    currentView = 'report';
    currentExamId = examId;
    return Data.examReport(examId).then(function (r) {
      var distMax = Math.max(1, Math.max.apply(null, r.distribution.map(function (d) { return d.count; })));
      var html = backBar() +
        '<div class="entry-head">' +
        '  <div><div class="eh-title">' + ZJ.esc(r.exam.name) + ' · 统计报告</div>' +
        '  <div class="eh-sub">' + ZJ.esc(r.exam.paperName) + ' · 满分 ' + r.fullTotal + ' · ' + r.candidateCount + ' 名考生' +
        (r.exam.status === '已完结' ? ' · 已完结' : '') + '</div></div>' +
        '  <button class="btn btn-ghost" id="btn-goto-entry">返回录分</button>' +
        '  <button class="btn btn-primary" id="btn-export-report">导出成绩单</button>' +
        '</div>' +

        // 指标卡
        '<div class="stat-grid" style="grid-template-columns:repeat(5,1fr);">' +
        reportStat(r.avg, '平均分') + reportStat(r.max, '最高分') + reportStat(r.min, '最低分') +
        reportStat(r.median, '中位数') + reportStat(r.passRate + '%', '及格率（' + r.passLine + ' 分线）') +
        '</div>' +

        '<div class="overview-grid" style="margin-top:18px;">' +
        // 分数段
        '<div class="card"><div class="section-head"><h2>分数段分布</h2><span class="sec-note">满分 ' + r.fullTotal + ' 分</span></div>' +
        '<div>' + r.distribution.map(function (d) {
          return '<div class="dist-row"><span class="dist-label" style="width:70px;">' + ZJ.esc(d.label) + '</span>' +
            '<span class="dist-track"><span class="dist-fill" style="width:' + Math.round(d.count / distMax * 100) + '%"></span></span>' +
            '<span class="dist-num">' + d.count + '</span></div>';
        }).join('') + '</div>' +
        '<div class="section-head" style="margin-top:18px;"><h2>薄弱知识点</h2><span class="sec-note">按知识点得分率升序</span></div>' +
        (r.weakTags.length ? r.weakTags.map(function (t) {
          var color = t.rate < 50 ? 'var(--c-danger)' : t.rate < 70 ? 'var(--c-gold-deep)' : 'var(--c-done)';
          return '<div class="dist-row"><span class="dist-label" style="width:120px;">' + ZJ.esc(t.tag) + '</span>' +
            '<span class="dist-track"><span class="dist-fill" style="width:' + t.rate + '%;background:' + color + ';"></span></span>' +
            '<span class="dist-num" style="color:' + color + ';">' + t.rate + '%</span></div>';
        }).join('') : '<div class="empty-tip" style="padding:18px 0;">题目未标注知识点，无法聚合</div>') +
        '</div>' +

        // 成绩排名
        '<div class="card"><div class="section-head"><h2>成绩排名</h2><span class="sec-note">' +
        r.enteredProgress.cells + '/' + r.enteredProgress.total + ' 格已录</span></div>' +
        '<div class="table-wrap" style="box-shadow:none;border:none;">' +
        '<table class="data"><thead><tr><th style="width:60px;">名次</th><th>考生</th><th style="width:90px;">总分</th>' +
        '<th style="width:110px;">得分率</th><th style="width:110px;">录分进度</th></tr></thead><tbody>' +
        r.totals.map(function (t, i) {
          var rate = r.fullTotal ? Math.round(t.total / r.fullTotal * 100) : 0;
          var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
          return '<tr><td style="font-family:var(--f-num);">' + medal + '</td><td>' + ZJ.esc(t.name) + '</td>' +
            '<td style="font-family:var(--f-num);font-weight:700;color:var(--c-navy-2);">' + t.total + '</td>' +
            '<td><span class="tag ' + (rate >= 85 ? 'tag-d1' : rate >= 60 ? 'tag-d3' : 'tag-d4') + '">' + rate + '%</span></td>' +
            '<td style="font-family:var(--f-num);font-size:12.5px;">' + t.entered + '/' + t.questionCount + ' 题</td></tr>';
        }).join('') + '</tbody></table></div></div>' +
        '</div>' +

        // 每题得分率 + 讲评建议
        '<div class="card" style="margin-top:18px;"><div class="section-head"><h2>每题得分率</h2>' +
        '<span class="sec-note">红色 &lt;50% 需重点讲评</span></div>' +
        '<div class="perq-grid">' +
        r.perQuestion.map(function (q) {
          var color = q.rate === null ? 'var(--c-text-light)' : q.rate < 50 ? 'var(--c-danger)' : q.rate < 70 ? 'var(--c-gold-deep)' : 'var(--c-done)';
          return '<div class="perq-cell" title="' + ZJ.esc(q.stem) + '">' +
            '<span class="pq-no">' + q.position + '</span>' +
            '<span class="pq-rate" style="color:' + color + ';">' + (q.rate === null ? '未录' : q.rate + '%') + '</span>' +
            '<span class="pq-full">/' + q.fullScore + '分</span>' +
            '</div>';
        }).join('') +
        '</div>' +
        (r.reviewAdvice.length ? '<div class="qc-explain" style="margin-top:14px;"><b>讲评建议：</b>重点讲评第 ' +
          r.reviewAdvice.map(function (q) { return q.position + ' 题（' + q.rate + '%，' + q.section + '）'; }).join('、') +
          '，建议结合薄弱知识点安排针对性练习。</div>' : '') +
        '</div>';
      root.innerHTML = html;
      bindBack();
      root.querySelector('#btn-goto-entry').addEventListener('click', function () { loadEntry(examId, null); });
      root.querySelector('#btn-export-report').addEventListener('click', function () {
        Data.exportExamScores(examId, r.exam.name).then(function () { ZJ.toast('成绩单已开始下载'); })
          .catch(function (err) { ZJ.toast(err.message, true); });
      });
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function reportStat(value, label) {
    return '<div class="stat-card"><div class="stat-meta">' +
      '<div class="stat-value" style="font-size:24px;">' + value + '</div>' +
      '<div class="stat-label">' + label + '</div></div></div>';
  }

  window.ZJ_Exams = {
    init: init,
    refresh: refresh
  };
})();
