/* =========================================================
 * 成都智慧象留学 - 国际课程组卷系统 · 组卷台 v2（双栏工作区）
 *
 * 左：试题池（筛选挑题，+ 加入试卷）  右：试卷实体（分区/调分/换题/构成统计）
 * 顶部工具条：名称/科目行/时长/AB卷/蓝图；保存与打印。
 * 「按配置生成」弹窗保留原智能组卷全部能力（快速/精确两模式），结果填入工作区。
 * 由 admin.js 初始化：window.ZJ_Builder.init({ ZJ, Data, state })
 * ========================================================= */
(function () {
  'use strict';

  var ZJ, Data, adminState;
  var ready = false;
  var pendingInit = false;

  // 工作副本：{id?, name, subjectLine, duration, variant, status, items:[{questionId, score, section, question}]}
  var paper = null;
  var activeSection = '';   // 当前选中的大题（试题池 + 的目标）
  var genDefaultsSet = false;

  function init(ctx) {
    try {
      ZJ = ctx.ZJ;
      Data = ctx.Data;
      adminState = ctx.state;
      paper = newPaper();
      bindToolbar();
      bindPool();
      bindPaper();
      bindGenConfig();
      bindTopLevel();
      ready = true;
      if (pendingInit) { pendingInit = false; onBootstrap(); }
    } catch (e) {
      window.__builderErr = String(e && e.stack || e);
      ready = false;
    }
  }

  /** 弹窗监听（元素随页面加载存在，放入 init 以便统一诊断） */
  function bindTopLevel() {
    document.getElementById('rp-list').addEventListener('click', function (e) {
      var item = e.target.closest('.rp-item');
      if (!item) { return; }
      var idx = Number(document.getElementById('modal-replace').dataset.idx);
      var newQ = null;
      rpCache.forEach(function (q) { if (q.id === Number(item.dataset.id)) { newQ = q; } });
      if (!newQ) { ZJ.toast('未找到该题目', true); return; }
      paper.items[idx] = {
        questionId: newQ.id, score: paper.items[idx].score || newQ.score || 0,
        section: paper.items[idx].section, question: newQ
      };
      ZJ.closeModal('modal-replace');
      renderPaper();
      ZJ.toast('已换题（分值保留 ' + paper.items[idx].score + ' 分）');
    });
    document.getElementById('btn-view-add').addEventListener('click', function () {
      var qid = Number(this.dataset.qid);
      var q = null;
      poolCache.forEach(function (x) { if (x.id === qid) { q = x; } });
      var finish = function (qq) {
        if (!qq) { ZJ.toast('未找到该题目', true); return; }
        addToPaper(qq);
        ZJ.closeModal('modal-view');
      };
      if (!q) {
        Data.questions({ q: (document.getElementById('view-body').querySelector('.qc-stem') || { textContent: '' }).textContent.slice(0, 20), status: '启用', limit: 50 })
          .then(function (list) {
            list.forEach(function (x) { if (x.id === qid) { q = x; } });
            finish(q);
          }).catch(function () { finish(null); });
      } else {
        finish(q);
      }
    });
  }

  function onBootstrap() {
    fillPoolSelects();
    fillBlueprintSelect();
    renderPaper();
    migrateCart();
  }

  function newPaper() {
    return { id: null, name: '', subjectLine: '', duration: 0, variant: '', status: '草稿', items: [] };
  }

  function refresh() {
    if (!ready) { pendingInit = true; return; }
    // 从 admin 共享的科目/知识点目录填池筛选
    if (adminState.subjects) { fillPoolSelects(); }
    if (!poolCache.length) { loadPool(); } else { renderPool(); }
    renderPaper();
  }

  /* ================= 顶部工具条 ================= */

  function bindToolbar() {
    document.getElementById('ws-name').addEventListener('input', function () { paper.name = this.value; });
    document.getElementById('ws-line').addEventListener('input', function () { paper.subjectLine = this.value; });
    document.getElementById('ws-duration').addEventListener('input', function () { paper.duration = Number(this.value) || 0; });
    document.getElementById('ws-variant').addEventListener('change', function () { paper.variant = this.value; });
    document.getElementById('ws-status').addEventListener('change', function () { paper.status = this.value; });

    document.getElementById('btn-ws-clear').addEventListener('click', function () {
      if (!paper.items.length) { return; }
      ZJ.confirm('清空试卷', '确定清空当前试卷中的全部试题吗？', '清空').then(function (ok) {
        if (ok) { paper.items = []; renderPaper(); }
      });
    });
    document.getElementById('btn-ws-add-section').addEventListener('click', function () {
      paper.items.push({ questionId: null, score: 0, section: '新大题', question: null });
      activeSection = '新大题';
      renderPaper();
    });
    document.getElementById('btn-ws-save').addEventListener('click', saveWorkspace);
    document.getElementById('btn-ws-print').addEventListener('click', function () {
      saveWorkspace(true);
    });
  }

  function syncToolbarFromPaper() {
    document.getElementById('ws-name').value = paper.name;
    document.getElementById('ws-line').value = paper.subjectLine;
    document.getElementById('ws-duration').value = paper.duration || '';
    document.getElementById('ws-variant').value = paper.variant || '';
    document.getElementById('ws-status').value = paper.status || '草稿';
  }

  function collectWorkspace() {
    paper.name = document.getElementById('ws-name').value.trim();
    paper.subjectLine = document.getElementById('ws-line').value.trim();
    paper.duration = Number(document.getElementById('ws-duration').value) || 0;
    paper.variant = document.getElementById('ws-variant').value;
    paper.status = document.getElementById('ws-status').value;
  }

  function validateWorkspace() {
    collectWorkspace();
    if (!paper.name) { ZJ.toast('请先填写试卷名称', true); document.getElementById('ws-name').focus(); return false; }
    var real = paper.items.filter(function (it) { return it.question; });
    if (!real.length) { ZJ.toast('试卷至少需要一道试题（从左侧试题池点 + 加入）', true); return false; }
    return true;
  }

  function saveWorkspace(andPrint) {
    if (!validateWorkspace()) { return; }
    var items = paper.items.filter(function (it) { return it.question; })
      .map(function (it) { return { questionId: it.question.id, score: it.score, section: it.section }; });
    Data.savePaper({
      id: paper.id, name: paper.name, subjectLine: paper.subjectLine, remark: '',
      duration: paper.duration, status: paper.status, variant: paper.variant, items: items
    }).then(function (saved) {
      paper.id = saved.id;
      if (andPrint) {
        // PRD 7.3/7.4：QP（学生卷）与 MS（教师卷答案页）生成记录
        Data.recordGenerated(saved.id, 'qp').catch(function () {});
        Data.recordGenerated(saved.id, 'ms').catch(function () {});
        window.open('print.html?id=' + saved.id + '&ver=student');
      } else {
        ZJ.toast('试卷「' + saved.name + '」已保存（' + saved.status + '，' + saved.questionCount + ' 题 / ' + saved.totalScore + ' 分）');
      }
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  /* ================= 题目全貌预览 ================= */

  function openPreview(q, inPaper) {
    var modal = document.getElementById('modal-view');
    modal.dataset.qid = q.id;
    var tags =
      '<span class="tag tag-subject">' + ZJ.esc(q.subject) + '</span>' +
      '<span class="tag tag-type">' + ZJ.esc(q.qtype) + '</span>' +
      '<span class="tag ' + ZJ.diffClass(q.difficulty) + '">难度' + q.difficulty + ' · ' + ZJ.diffLabel(q.difficulty) + '</span>' +
      (q.score ? '<span class="tag tag-draft">建议 ' + q.score + ' 分</span>' : '') +
      (q.usedCount ? '<span class="tag tag-off">已入卷 ' + q.usedCount + ' 次</span>' : '');
    var html = '<div class="qc-head"><div class="qc-tags">' + tags + '</div></div>' + ZJ.questionBodyHtml(q);
    if (q.answer) { html += '<div class="qc-answer"><b>答案：</b>' + ZJ.esc(q.answer) + '</div>'; }
    if (q.explanation) { html += '<div class="qc-explain"><b>解析：</b>' + ZJ.esc(q.explanation) + '</div>'; }
    document.getElementById('view-body').innerHTML = html;
    var btn = document.getElementById('btn-view-add');
    btn.hidden = !!inPaper;
    btn.disabled = !!inPaper;
    btn.textContent = inPaper ? '已在试卷中' : '加入试卷';
    btn.dataset.qid = q.id;
    ZJ.openModal('modal-view');
    ZJ.renderMath(modal);
  }

  /* ================= 左栏：试题池 ================= */

  var poolFilters = { q: '', subject: '全部科目', qtype: '全部题型', difficulty: '全部难度' };
  var poolCache = [];

  function fillPoolSelects() {
    var groups = adminState.subjects || ZJ.SUBJECT_CATALOG;
    document.getElementById('pool-subject').innerHTML = ZJ.subjectOptions(groups, '全部科目', '全部科目');
    var typeSel = document.getElementById('pool-type');
    var keep = typeSel.value;
    typeSel.innerHTML = '<option value="全部题型">全部题型</option>' + ZJ.qtypeOptions();
    if (keep) { typeSel.value = keep; }
  }

  function bindPool() {
    document.getElementById('pool-search').addEventListener('input', ZJ.debounce(function (e) {
      poolFilters.q = e.target.value.trim();
      loadPool();
    }, 300));
    [['pool-subject', 'subject'], ['pool-type', 'qtype'], ['pool-diff', 'difficulty']].forEach(function (pair) {
      document.getElementById(pair[0]).addEventListener('change', function (e) {
        poolFilters[pair[1]] = e.target.value;
        loadPool();
      });
    });
    document.getElementById('pool-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-add]');
      if (btn) {
        var q0 = null;
        poolCache.forEach(function (x) { if (x.id === Number(btn.dataset.add)) { q0 = x; } });
        if (q0) { addToPaper(q0); }
        return;
      }
      var item = e.target.closest('.pool-item');
      if (item) {
        var q = null;
        poolCache.forEach(function (x) { if (x.id === Number(item.dataset.id)) { q = x; } });
        if (q) { openPreview(q, item.classList.contains('added')); }
      }
    });
  }

  function loadPool() {
    return Data.questions(poolFilters).then(function (list) {
      poolCache = list;
      renderPool();
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function renderPool() {
    var box = document.getElementById('pool-list');
    var inPaper = {};
    paper.items.forEach(function (it) { if (it.question) { inPaper[it.question.id] = true; } });
    document.getElementById('pool-target-hint').textContent =
      activeSection ? ('点 + 加入 → ' + activeSection) : '加入后自动按题型建大题';
    if (!poolCache.length) {
      box.innerHTML = '<div class="empty-tip" style="padding:26px 0;">没有符合条件的题目</div>';
      return;
    }
    box.innerHTML = poolCache.map(function (q) {
      var stem = q.stem.length > 56 ? q.stem.slice(0, 56) + '…' : q.stem;
      return '<div class="pool-item' + (inPaper[q.id] ? ' added' : '') + '" data-id="' + q.id + '">' +
        '<div class="pi-main">' +
        '<div class="pi-stem">' + (q.audioPath ? '🔊' : '') + (q.imagePath ? '🖼' : '') + ' ' + ZJ.esc(stem) + '</div>' +
        '<div class="pi-meta">' + ZJ.esc(q.subject) + ' · ' + ZJ.esc(q.qtype) +
        ' · <span class="' + ZJ.diffClass(q.difficulty) + ' tag">' + q.difficulty + '</span>' +
        ' · ' + (q.score || '—') + ' 分' +
        (q.usedCount >= 3 ? ' · <span class="pi-warn">已用' + q.usedCount + '次</span>' : '') +
        (q.isPublic === false ? ' · 🔒' : '') + '</div></div>' +
        '<button class="btn-mini primary pi-add" data-add="' + q.id + '"' + (inPaper[q.id] ? ' disabled title="已在试卷中"' : '') + '>+</button>' +
        '</div>';
    }).join('');
  }

  /* ================= 右栏：试卷实体 ================= */

  function bindPaper() {
    var sectionsBox = document.getElementById('ws-sections');
    sectionsBox.addEventListener('click', function (e) {
      var sec = e.target.closest('.ws-section');
      if (sec && !e.target.closest('button') && !e.target.closest('input')) {
        activeSection = sec.dataset.section;
        renderPaper();
        return;
      }
      var stem = e.target.closest('.wq-stem');
      if (stem) {
        var it = paper.items[Number(stem.dataset.idx)];
        if (it && it.question) {
          var inPaper = paper.items.some(function (x) { return x.question && x.question.id === it.question.id; });
          openPreview(it.question, true);
        }
        return;
      }
      var btn = e.target.closest('button[data-act]');
      if (!btn) { return; }
      var act = btn.dataset.act;
      if (act === 'sec-up' || act === 'sec-down') { moveSection(btn.dataset.section, act === 'sec-up' ? -1 : 1); }
      else if (act === 'sec-del') { removeSection(btn.dataset.section); }
      else if (act === 'q-up') { moveQuestion(Number(btn.dataset.idx), -1); }
      else if (act === 'q-down') { moveQuestion(Number(btn.dataset.idx), 1); }
      else if (act === 'q-del') {
        paper.items.splice(Number(btn.dataset.idx), 1);
        renderPaper();
      } else if (act === 'q-replace') {
        openReplace(Number(btn.dataset.idx));
      }
    });
    // 拖拽排序（PAPER-03 升级：拖到目标题位置，跨大题拖动自动归入目标大题）
    var dragIdx = null;
    sectionsBox.addEventListener('dragstart', function (e) {
      var row = e.target.closest('.ws-q');
      if (!row) { return; }
      dragIdx = Number(row.dataset.idx);
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(dragIdx)); } catch (err) { /* IE 兼容 */ }
    });
    sectionsBox.addEventListener('dragover', function (e) {
      var row = e.target.closest('.ws-q');
      if (!row || dragIdx === null) { return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      sectionsBox.querySelectorAll('.ws-q.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });
      row.classList.add('drag-over');
    });
    sectionsBox.addEventListener('dragleave', function (e) {
      var row = e.target.closest('.ws-q');
      if (row) { row.classList.remove('drag-over'); }
    });
    sectionsBox.addEventListener('drop', function (e) {
      var row = e.target.closest('.ws-q');
      if (!row || dragIdx === null) { return; }
      e.preventDefault();
      var targetIdx = Number(row.dataset.idx);
      if (targetIdx !== dragIdx && targetIdx < paper.items.length && dragIdx < paper.items.length) {
        var targetItem = paper.items[targetIdx];
        var moved = paper.items.splice(dragIdx, 1)[0];
        var insertAt = targetIdx > dragIdx ? targetIdx - 1 : targetIdx;
        paper.items.splice(insertAt, 0, moved);
        moved.section = targetItem.section;  // 归入目标大题
        renderPaper();
        ZJ.toast('已移动至「' + moved.section + '」');
      }
      dragIdx = null;
      sectionsBox.querySelectorAll('.ws-q.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });
    });
    sectionsBox.addEventListener('dragend', function () {
      dragIdx = null;
      sectionsBox.querySelectorAll('.ws-q.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });
    });
    sectionsBox.addEventListener('input', function (e) {
      var input = e.target.closest('.sec-name-input');
      if (input) { renameSection(input.dataset.section, input.value.trim()); }
      var score = e.target.closest('.ws-score-input');
      if (score) {
        paper.items[Number(score.dataset.idx)].score = Number(score.value) || 0;
        renderStats();
      }
    });
  }

  function addToPaper(q) {
    // 落区规则：区名 = 题型（自动区）→ 按题目题型落区/新建；用户改过名的区（sticky）→ 落当前选中区
    var target = q.qtype;
    if (paper.items.length && activeSection) {
      var blocks0 = sectionBlocks();
      for (var bi = 0; bi < blocks0.length; bi++) {
        if (blocks0[bi].name !== activeSection) { continue; }
        var first = paper.items[blocks0[bi].start].question;
        var isAutoNamed = first && first.qtype === activeSection;
        if (!isAutoNamed || first.qtype === q.qtype) { target = activeSection; }
        break;
      }
    }
    activeSection = target;
    // 插入到目标区末尾（区不存在则 push 新建）
    var idx = -1;
    for (var i = paper.items.length - 1; i >= 0; i--) {
      if (paper.items[i].section === target) { idx = i; break; }
    }
    var item = { questionId: q.id, score: q.score || 0, section: target, question: q };
    if (idx >= 0) {
      paper.items.splice(idx + 1, 0, item);
    } else {
      paper.items.push(item);
    }
    renderPaper();
    updatePoolItemState(q.id);
    var el = document.querySelector('.ws-section[data-section="' + cssEsc(target) + '"]');
    if (el) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  /** 就地更新池内条目状态（不整列表重绘，保留滚动位置、支持连续快速加题） */
  function updatePoolItemState(qid) {
    var el = document.querySelector('.pool-item[data-id="' + qid + '"]');
    if (!el) { return; }
    el.classList.add('added');
    var btn = el.querySelector('.pi-add');
    if (btn) { btn.disabled = true; btn.title = '已在试卷中'; }
  }

  function cssEsc(s) {
    return String(s).replace(/"/g, '\\"');
  }

  function sectionBlocks() {
    // 把 items 按连续相同 section 切块：[{name, start, count}]
    var blocks = [];
    paper.items.forEach(function (it, i) {
      var name = it.section || (it.question ? it.question.qtype : '其他');
      var last = blocks[blocks.length - 1];
      if (last && last.name === name) { last.count += 1; }
      else { blocks.push({ name: name, start: i, count: 1 }); }
    });
    return blocks;
  }

  function moveSection(name, dir) {
    var blocks = sectionBlocks();
    var bi = -1;
    blocks.forEach(function (b, i) { if (b.name === name) { bi = i; } });
    var tj = bi + dir;
    if (bi < 0 || tj < 0 || tj >= blocks.length) { return; }
    var a = blocks[bi], b2 = blocks[tj];
    var moved = paper.items.splice(a.start, a.count);
    var insertAt = (dir > 0 ? blocks[tj].start - a.count + blocks[tj].count : blocks[tj].start);
    paper.items.splice.apply(paper.items, [insertAt, 0].concat(moved));
    renderPaper();
  }

  function removeSection(name) {
    ZJ.confirm('删除大题', '删除「' + name + '」及其下全部试题？', '删除').then(function (ok) {
      if (!ok) { return; }
      paper.items = paper.items.filter(function (it) { return it.section !== name; });
      if (activeSection === name) { activeSection = ''; }
      renderPaper();
    });
  }

  function renameSection(oldName, newName) {
    if (!newName) { newName = oldName; }
    paper.items.forEach(function (it) { if (it.section === oldName) { it.section = newName; } });
    if (activeSection === oldName) { activeSection = newName; }
    document.querySelectorAll('.ws-section[data-section="' + cssEsc(oldName) + '"]').forEach(function (el) {
      el.dataset.section = newName;
    });
  }

  function moveQuestion(idx, dir) {
    var j = idx + dir;
    if (j < 0 || j >= paper.items.length) { return; }
    if (paper.items[j].section !== paper.items[idx].section) { return; } // 区内移动
    var t = paper.items[j];
    paper.items[j] = paper.items[idx];
    paper.items[idx] = t;
    renderPaper();
  }

  function bandOf(d) {
    if (d <= 2) { return 'basic'; }
    if (d === 3) { return 'boost'; }
    return 'sprint';
  }

  function renderStats() {
    var real = paper.items.filter(function (it) { return it.question; });
    var total = 0, dur = 0;
    var bands = { basic: 0, boost: 0, sprint: 0 };
    real.forEach(function (it) {
      total += it.score;
      dur += it.question.duration || 0;
      bands[bandOf(it.question.difficulty)] += 1;
    });
    document.getElementById('ws-sum').textContent =
      real.length + ' 题 · ' + (Math.round(total * 10) / 10) + ' 分' +
      (paper.duration ? ' · ' + paper.duration + ' 分钟' : (dur ? ' · 约 ' + dur + ' 分钟' : ''));
    var n = real.length || 1;
    var seg = function (k, label, cls) {
      var pct = Math.round(bands[k] / n * 100);
      return '<span class="stat-seg ' + cls + '" style="width:' + pct + '%" title="' + label + ' ' + bands[k] + ' 题"></span>';
    };
    document.getElementById('ws-stats').innerHTML = real.length
      ? '<div class="ws-dist">' +
        seg('basic', '基础', 'seg-b') + seg('boost', '强化', 'seg-m') + seg('sprint', '冲刺', 'seg-s') +
        '</div><div class="ws-dist-labels"><span>基础 ' + bands.basic + '</span><span>强化 ' + bands.boost +
        '</span><span>冲刺 ' + bands.sprint + '</span>' +
        (paper.duration ? '' : (dur ? '<span style="margin-left:auto;">自动时长 ' + dur + ' 分钟</span>' : '')) + '</div>'
      : '';
  }

  function renderPaper() {
    var box = document.getElementById('ws-sections');
    var blocks = sectionBlocks();
    // 目标区提示单独更新（池列表不重绘）
    document.getElementById('pool-target-hint').textContent =
      activeSection ? ('点 + 加入 → ' + activeSection) : '加入后自动按题型建大题';
    if (!paper.items.length) {
      box.innerHTML = '<div class="empty-tip" style="padding:34px 0;">' +
        '从左侧试题池点 <b>+</b> 开始组卷；或点「按配置生成」自动配卷</div>';
      renderStats();
      return;
    }
    var no = 0;
    var html = blocks.map(function (b) {
      var total = 0;
      var rows = '';
      for (var i = b.start; i < b.start + b.count; i++) {
        var it = paper.items[i];
        if (!it.question) {
          rows += '<div class="ws-q empty"><span class="wq-no">—</span>' +
            '<span class="wq-stem">（空大题——从左侧试题池点 + 加入「' + ZJ.esc(it.section) + '」）</span></div>';
          continue;
        }
        no += 1;
        total += it.score;
        var q = it.question;
        rows += '<div class="ws-q' + (q.usedCount >= 3 ? ' used-warn' : '') + '" draggable="true" data-idx="' + i + '">' +
          '<span class="wq-no">' + no + '</span>' +
          '<span class="wq-stem" data-idx="' + i + '" title="点击查看题目全貌">' +
          (q.usedCount >= 3 ? '<span class="pi-warn">已用' + q.usedCount + '次</span> ' : '') +
          ZJ.esc(q.stem.length > 52 ? q.stem.slice(0, 52) + '…' : q.stem) + '</span>' +
          '<input type="number" class="ws-score-input" data-idx="' + i + '" min="0" step="0.5" value="' + it.score + '" title="分值">' +
          '<button class="btn-mini" data-act="q-replace" data-idx="' + i + '" title="换题（候选可选）">换</button>' +
          '<button class="btn-mini" data-act="q-up" data-idx="' + i + '"' + (i === b.start ? ' disabled' : '') + '>↑</button>' +
          '<button class="btn-mini" data-act="q-down" data-idx="' + i + '"' + (i === b.start + b.count - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="btn-mini danger" data-act="q-del" data-idx="' + i + '">✕</button>' +
          '</div>';
      }
      return '<div class="ws-section' + (activeSection === b.name ? ' active' : '') + '" data-section="' + ZJ.esc(b.name) + '">' +
        '<div class="ws-sec-head">' +
        '<input type="text" class="sec-name-input" data-section="' + ZJ.esc(b.name) + '" value="' + ZJ.esc(b.name) + '">' +
        '<span class="sec-sum">' + b.count + ' 题 · ' + (Math.round(total * 10) / 10) + ' 分</span>' +
        '<button class="btn-mini" data-act="sec-up" data-section="' + ZJ.esc(b.name) + '" title="大题上移">↑</button>' +
        '<button class="btn-mini" data-act="sec-down" data-section="' + ZJ.esc(b.name) + '" title="大题下移">↓</button>' +
        '<button class="btn-mini danger" data-act="sec-del" data-section="' + ZJ.esc(b.name) + '">✕</button>' +
        '</div>' + rows + '</div>';
    }).join('');
    box.innerHTML = html;
    renderStats();
  }

  /* ================= 换题（候选可选） ================= */

  var rpCache = [];

  function openReplace(idx) {
    var cur = paper.items[idx].question;
    document.getElementById('modal-replace').dataset.idx = idx;
    document.getElementById('rp-sub').textContent =
      '当前：[' + cur.subject + ' · ' + cur.qtype + ' · 难度' + cur.difficulty + '] 同池候选按难度就近排序，点选替换';
    var box = document.getElementById('rp-list');
    box.innerHTML = '<div class="empty-tip" style="padding:20px 0;">候选加载中…</div>';
    ZJ.openModal('modal-replace');
    Data.questions({ subject: cur.subject, qtype: cur.qtype, status: '启用' }).then(function (pool) {
      var inPaper = {};
      paper.items.forEach(function (it) { if (it.question) { inPaper[it.question.id] = true; } });
      rpCache = pool.filter(function (q) { return q.id !== cur.id && !inPaper[q.id]; });
      rpCache.sort(function (a, b) {
        return Math.abs(a.difficulty - cur.difficulty) - Math.abs(b.difficulty - cur.difficulty);
      });
      if (!rpCache.length) {
        box.innerHTML = '<div class="empty-tip" style="padding:20px 0;">该科目 + 题型下没有其他可用题目</div>';
        return;
      }
      box.innerHTML = rpCache.map(function (q) {
        var stem = q.stem.length > 64 ? q.stem.slice(0, 64) + '…' : q.stem;
        return '<div class="rp-item" data-id="' + q.id + '">' +
          '<div class="pi-main"><div class="pi-stem">' + ZJ.esc(stem) + '</div>' +
          '<div class="pi-meta">难度 ' + q.difficulty + ' · ' + (q.score || '—') + ' 分 · ' + ZJ.esc(q.source || '未标来源') +
          (q.usedCount >= 3 ? ' · <span class="pi-warn">已用' + q.usedCount + '次</span>' : '') + '</div></div>' +
          '<button class="btn-mini primary">换为该题</button></div>';
      }).join('');
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  /* ================= 按配置生成（快速 + 精确） ================= */

  function bindGenConfig() {
    // 科目 chips
    var wrap = document.getElementById('g-subjects');
    var html = '';
    (adminState.subjects || ZJ.SUBJECT_CATALOG).forEach(function (g) {
      html += '<div class="chip-group">' + ZJ.esc(g.group) + '</div>';
      g.items.forEach(function (s) {
        html += '<span class="chip" data-subject="' + ZJ.esc(s) + '">' + ZJ.esc(s) + '</span>';
      });
    });
    wrap.innerHTML = html;
    wrap.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (chip) { chip.classList.toggle('on'); }
    });

    var addRow = function (qtype, count, score) {
      var row = document.createElement('div');
      row.className = 'type-row';
      row.innerHTML =
        '<select class="tr-type">' + ZJ.qtypeOptions(qtype || '单选题') + '</select>' +
        '<input type="number" class="tr-count" min="0" placeholder="数量" value="' + (count || '') + '">' +
        '<input type="number" class="tr-score" min="0" step="0.5" placeholder="每题分值" value="' + (score || '') + '">' +
        '<button type="button" class="row-del" title="移除该题型">✕</button>';
      row.querySelector('.row-del').addEventListener('click', function () { row.remove(); });
      document.getElementById('g-type-rows').appendChild(row);
    };
    addRow('单选题', 5, 3);
    addRow('判断题', 3, 2);
    document.getElementById('btn-add-type-row').addEventListener('click', function () { addRow('单选题', '', ''); });

    var updDist = function () {
      var b = document.getElementById('g-basic').value || 0;
      var o = document.getElementById('g-boost').value || 0;
      var s = document.getElementById('g-sprint').value || 0;
      document.getElementById('g-dist-preview').textContent = ZJ.distSummary(b, o, s);
    };
    ['g-basic', 'g-boost', 'g-sprint'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', updDist);
    });
    updDist();

    var readParams = function () {
      var rows = [];
      document.querySelectorAll('#g-type-rows .type-row').forEach(function (row) {
        var qtype = row.querySelector('.tr-type').value;
        var count = Number(row.querySelector('.tr-count').value) || 0;
        var score = Number(row.querySelector('.tr-score').value) || 0;
        if (count > 0) { rows.push({ qtype: qtype, count: count, score: score }); }
      });
      var subjects = [];
      document.querySelectorAll('#g-subjects .chip.on').forEach(function (c) { subjects.push(c.dataset.subject); });
      var tags = document.getElementById('g-tags').value.split(/[、,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      return {
        name: document.getElementById('ws-name').value.trim(),
        subjectLine: document.getElementById('ws-line').value.trim(),
        subjects: subjects, types: rows,
        dist: {
          basic: Number(document.getElementById('g-basic').value) || 0,
          boost: Number(document.getElementById('g-boost').value) || 0,
          sprint: Number(document.getElementById('g-sprint').value) || 0
        },
        tags: tags,
        duration: Number(document.getElementById('ws-duration').value) || 0
      };
    };

    var fillFromGenerate = function (r, params, isQuick) {
      if (!r.questions.length) {
        document.getElementById('gc-note').innerHTML =
          '<span class="shortage-note">题库中没有符合条件的题目：放宽科目/知识点范围，或先去题库补充</span>';
        return;
      }
      var apply = function () {
        paper.items = r.questions.map(function (q) {
          return { questionId: q.id, score: q.assignScore || q.score || 0, section: q.qtype, question: q };
        });
        activeSection = paper.items.length ? paper.items[0].section : '';
        if (!document.getElementById('ws-name').value) {
          paper.name = params.name || (params.subjects.length ? params.subjects.join('、') : '综合') +
            ' · 随机组合练（' + ZJ.todayStr() + '）';
        }
        syncToolbarFromPaper();
        renderPaper();
        ZJ.closeModal('modal-genconfig');
        var notes = [];
        (r.shortage || []).forEach(function (s) {
          notes.push(ZJ.esc(s.qtype) + ' 仅 ' + s.got + '/' + s.requested + ' 题');
        });
        if (r.distNote) { notes.push(ZJ.esc(r.distNote)); }
        ZJ.toast('已生成 ' + r.questions.length + ' 题到试卷' + (notes.length ? '（' + notes.join('；') + '）' : ''), notes.length > 0);
      };
      if (paper.items.filter(function (it) { return it.question; }).length) {
        ZJ.confirm('替换当前试卷', '当前试卷已有试题，生成将替换全部内容（可先保存）。继续吗？', '替换').then(function (ok) {
          if (ok) { apply(); }
        });
      } else {
        apply();
      }
    };

    document.getElementById('btn-quick-gen').addEventListener('click', function () {
      var total = Math.max(3, Number(document.getElementById('g-quick-count').value) || 20);
      var subjects = [];
      document.querySelectorAll('#g-subjects .chip.on').forEach(function (c) { subjects.push(c.dataset.subject); });
      var btn = this;
      btn.disabled = true; btn.textContent = '配题中…';
      var fetches = subjects.length
        ? subjects.map(function (s) { return Data.questions({ subject: s, status: '启用' }); })
        : [Data.questions({ status: '启用' })];
      Promise.all(fetches).then(function (results) {
        var merged = [], seen = {};
        results.forEach(function (list) {
          list.forEach(function (q) { if (!seen[q.id]) { seen[q.id] = true; merged.push(q); } });
        });
        var byType = {};
        merged.forEach(function (q) { (byType[q.qtype] = byType[q.qtype] || []).push(q); });
        delete byType['写作题'];
        delete byType['口语题'];
        var types = Object.keys(byType).filter(function (t) { return byType[t].length; });
        if (!types.length) {
          document.getElementById('gc-note').innerHTML = '<span class="shortage-note">所选范围内没有可用题目</span>';
          return;
        }
        var weights = types.map(function (t) { return byType[t].length; });
        var wsum = weights.reduce(function (a, b) { return a + b; }, 0);
        var counts = types.map(function (t, i) { return Math.floor(total * weights[i] / wsum); });
        var assigned = counts.reduce(function (a, b) { return a + b; }, 0);
        var order = types.map(function (t, i) { return i; }).sort(function (a, b) { return weights[b] - weights[a]; });
        var guard = 0;
        while (assigned < total && guard < 300) {
          var progressed = false;
          for (var oi = 0; oi < order.length && assigned < total; oi++) {
            var i2 = order[oi];
            if (counts[i2] < byType[types[i2]].length) { counts[i2] += 1; assigned += 1; progressed = true; }
          }
          if (!progressed) { break; }
          guard += 1;
        }
        var per = Math.max(0.5, Math.round(100 / total * 2) / 2);
        var rowsBox = document.getElementById('g-type-rows');
        rowsBox.innerHTML = '';
        types.forEach(function (t, i) { if (counts[i] > 0) { addRow(t, counts[i], per); } });
        var payload = {
          subjects: subjects,
          types: types.map(function (t, i) { return counts[i] > 0 ? { qtype: t, count: counts[i], score: per } : null; }).filter(Boolean),
          dist: { basic: 0, boost: 0, sprint: 0 }
        };
        Data.generate(payload).then(function (r) { fillFromGenerate(r, { subjects: subjects }, true); })
          .catch(function (err) { ZJ.toast(err.message, true); });
      }).catch(function (err) { ZJ.toast(err.message, true); })
        .then(function () { btn.disabled = false; btn.textContent = '一键生成到试卷'; });
    });

    document.getElementById('btn-generate').addEventListener('click', function () {
      var params = readParams();
      if (!params.types.length) { ZJ.toast('请至少配置一种题型的数量', true); return; }
      var btn = this;
      btn.disabled = true; btn.textContent = '抽取中…';
      Data.generate({ subjects: params.subjects, types: params.types, dist: params.dist, tags: params.tags })
        .then(function (r) { fillFromGenerate(r, params, false); })
        .catch(function (err) { ZJ.toast(err.message, true); })
        .then(function () { btn.disabled = false; btn.textContent = '按精确配置生成'; });
    });

    document.getElementById('btn-ws-genconfig').addEventListener('click', function () {
      if (!genDefaultsSet) {
        genDefaultsSet = true;
        updDist();
      }
      document.getElementById('gc-note').innerHTML = '';
      ZJ.openModal('modal-genconfig');
    });
  }

  /* ================= 蓝图 ================= */

  function fillBlueprintSelect() {
    return Data.blueprints().then(function (list) {
      adminState.blueprints = list;
      var sel = document.getElementById('g-blueprint');
      sel.innerHTML = '<option value="">选择蓝图…</option>' + list.map(function (b) {
        return '<option value="' + b.id + '">' + ZJ.esc(b.name) + '</option>';
      }).join('');
    }).catch(function () { /* 容错 */ });
  }

  function bindBlueprint() {
    document.getElementById('btn-load-blueprint').addEventListener('click', function () {
      var id = Number(document.getElementById('g-blueprint').value);
      var bp = (adminState.blueprints || []).find(function (b) { return b.id === id; });
      if (!bp) { ZJ.toast('请先选择蓝图', true); return; }
      var cfg = bp.config || {};
      var apply = function () {
        Data.generate({
          subjects: cfg.subjects || [], types: cfg.types || [],
          dist: cfg.dist || { basic: 30, boost: 50, sprint: 20 }, tags: cfg.tags || []
        }).then(function (r) {
          if (!r.questions.length) { ZJ.toast('蓝图范围内没有可用题目', true); return; }
          paper.items = r.questions.map(function (q) {
            return { questionId: q.id, score: q.assignScore || q.score || 0, section: q.qtype, question: q };
          });
          if (cfg.name && !document.getElementById('ws-name').value) {
            document.getElementById('ws-name').value = cfg.name + '（' + ZJ.todayStr() + '）';
            paper.name = document.getElementById('ws-name').value;
          }
          if (cfg.subjectLine && !document.getElementById('ws-line').value) {
            document.getElementById('ws-line').value = cfg.subjectLine;
            paper.subjectLine = cfg.subjectLine;
          }
          if (cfg.duration && !document.getElementById('ws-duration').value) {
            document.getElementById('ws-duration').value = cfg.duration;
            paper.duration = cfg.duration;
          }
          activeSection = paper.items.length ? paper.items[0].section : '';
          renderPaper();
          ZJ.toast('蓝图「' + bp.name + '」已生成 ' + r.questions.length + ' 题到试卷');
        }).catch(function (err) { ZJ.toast(err.message, true); });
      };
      if (paper.items.filter(function (it) { return it.question; }).length) {
        ZJ.confirm('替换当前试卷', '载入蓝图将替换当前试卷内容（可先保存）。继续吗？', '替换').then(function (ok) {
          if (ok) { apply(); }
        });
      } else {
        apply();
      }
    });

    document.getElementById('btn-save-blueprint').addEventListener('click', function () {
      var real = paper.items.filter(function (it) { return it.question; });
      if (!real.length) { ZJ.toast('试卷为空，先组题再存蓝图', true); return; }
      // 以当前试卷结构反推蓝图配置（按大题：题型=区内第一题题型，数量=区题数，分值=均分）
      var blocks = sectionBlocks();
      var types = [];
      var subjects = {};
      var dist = { basic: 0, boost: 0, sprint: 0 };
      var total = 0;
      blocks.forEach(function (b) {
        var first = paper.items[b.start].question;
        var score = 0;
        for (var i = b.start; i < b.start + b.count; i++) {
          var it = paper.items[i];
          score += it.score;
          subjects[it.question.subject] = true;
          dist[bandOf(it.question.difficulty)] += 1;
          total += 1;
        }
        types.push({ qtype: first.qtype, count: b.count, score: Math.round(score / b.count * 10) / 10 });
      });
      if (total) {
        Object.keys(dist).forEach(function (k) { dist[k] = Math.round(dist[k] / total * 100); });
      }
      var name = paper.name || '蓝图 ' + ZJ.todayStr();
      Data.saveBlueprint(name, {
        name: paper.name, subjectLine: paper.subjectLine,
        subjects: Object.keys(subjects), types: types, dist: dist, tags: [],
        duration: paper.duration
      }).then(function () {
        ZJ.toast('已按当前试卷结构保存蓝图「' + name + '」');
        fillBlueprintSelect();
      }).catch(function (err) { ZJ.toast(err.message, true); });
    });
  }

  /* ================= 组卷篮迁移（旧数据不丢失） ================= */

  function migrateCart() {
    try {
      var cart = JSON.parse(sessionStorage.getItem('zhxx_zj_cart_v1') || '[]');
      if (cart.length) {
        cart.forEach(function (q) { addToPaper(q); });
        sessionStorage.removeItem('zhxx_zj_cart_v1');
        ZJ.toast('已把组卷篮中的 ' + cart.length + ' 题并入当前试卷');
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ================= 启动 ================= */

  window.ZJ_Builder = {
    init: function (ctx) {
      init(ctx);
      bindBlueprint();
    },
    refresh: function () { refresh(); },
    /** 题库页「加卷」直通入口 */
    addQuestion: function (q) {
      if (!ready) { ZJ.toast('组卷台初始化中，请稍候', true); return; }
      addToPaper(q);
    },
    /** 试卷库「编辑」：把已有试卷载入工作区 */
    loadExisting: function (id) {
      if (!ready) { ZJ.toast('组卷台初始化中，请稍候', true); return; }
      Data.paper(id).then(function (p) {
        var apply = function () {
          paper = {
            id: p.id, name: p.name, subjectLine: p.subjectLine || '',
            duration: p.duration || 0, variant: p.variant || '', status: p.status || '草稿',
            items: (p.items || []).map(function (it) {
              return { questionId: it.question.id, score: it.score, section: it.section || it.question.qtype, question: it.question };
            })
          };
          activeSection = paper.items.length ? paper.items[0].section : '';
          syncToolbarFromPaper();
          renderPaper();
          ZJ.toast('已载入「' + p.name + '」（' + p.questionCount + ' 题）到组卷台，保存即为更新');
        };
        if (paper.items.filter(function (it) { return it.question; }).length) {
          ZJ.confirm('载入已有试卷', '当前工作区试卷将被替换（未保存的修改会丢失）。继续吗？', '载入').then(function (ok) {
            if (ok) { apply(); }
          });
        } else {
          apply();
        }
      }).catch(function (err) { ZJ.toast(err.message, true); });
    }
  };
})();
