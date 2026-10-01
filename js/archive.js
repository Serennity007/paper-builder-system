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
  var pendingPdfs = { qp: null, ms: null };
  var sourceState = null;
  var sourceUrls = [];
  var sourceLoad = 0;

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
      else if (act === 'preview-qp' || act === 'preview-ms') {
        Data.previewExamPaperPdf(id, act.slice(8)).catch(function (err) { ZJ.toast(err.message, true); });
      }
      else if (act === 'create-source') { openSourceQuestion(id); }
      else if (act === 'open-source') { openSavedSource(id); }
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
    bindSourceQuestion();
    // QP/MS 上传（编辑弹窗内）
    document.getElementById('btn-ep-qp').addEventListener('click', function () { document.getElementById('ep-qp-file').click(); });
    document.getElementById('btn-ep-ms').addEventListener('click', function () { document.getElementById('ep-ms-file').click(); });
    document.getElementById('ep-qp-file').addEventListener('change', function () {
      pendingPdfs.qp = this.files[0] || null;
      document.getElementById('ep-qp-name').textContent = pendingPdfs.qp ? pendingPdfs.qp.name + '（保存时上传）' : '';
    });
    document.getElementById('ep-ms-file').addEventListener('change', function () {
      pendingPdfs.ms = this.files[0] || null;
      document.getElementById('ep-ms-name').textContent = pendingPdfs.ms ? pendingPdfs.ms.name + '（保存时上传）' : '';
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
          (p.qpAvailable ? '<button class="btn-mini primary" data-act="preview-qp" data-id="' + p.id + '">QP</button>' : '<span class="cell-sub">QP 未传</span>') +
          (p.msAvailable ? '<button class="btn-mini primary" data-act="preview-ms" data-id="' + p.id + '">MS</button>' : '<span class="cell-sub">MS 未传</span>') +
          (p.qpAvailable && Data.mode === 'server' ? '<button class="btn-mini gold" data-act="create-source" data-id="' + p.id + '">创建大题</button>' : '') +
          '<button class="btn-mini gold" data-act="edit" data-id="' + p.id + '">编辑</button>' +
          '<button class="btn-mini danger" data-act="del" data-id="' + p.id + '">删除</button>' +
          '</div></td></tr>';
      }).join('');
      return loadSourceDrafts(list);
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function loadSourceDrafts(papers) {
    var area = document.getElementById('ar-source-drafts');
    if (Data.mode !== 'server') {
      area.textContent = '静态演示模式不包含原卷 PDF 或结构化大题，请从正式后端打开后台。';
      return Promise.resolve();
    }
    return Promise.all(papers.filter(function (p) { return p.qpAvailable; }).map(function (p) {
      return Data.sourceQuestions(p.id);
    })).then(function (lists) {
      var drafts = [].concat.apply([], lists);
      area.innerHTML = drafts.length ? drafts.map(function (q) {
        var qp = q.regions.filter(function (r) { return r.kind === 'qp'; }).length;
        var ms = q.regions.length - qp;
        return '<div style="padding:8px;border-bottom:1px solid #e4e8ed;">' +
          ZJ.esc(q.paperName) + ' · 原题 ' + ZJ.esc(q.originalQuestionNumber) + ' · ' +
          qp + ' 个 QP 区域 / ' + ms + ' 个 MS 区域 · <strong>待教研审核，未发布</strong> ' +
          '<button class="btn-mini primary" data-act="open-source" data-id="' + q.id + '">重新打开预览 #' + q.id + '</button></div>';
      }).join('') : '当前筛选范围内没有结构化大题草稿。';
    });
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
    document.getElementById('ep-qp-source').value = p ? (p.qpSource || '') : '';
    document.getElementById('ep-ms-source').value = p ? (p.msSource || '') : '';
    document.getElementById('ep-permission-note').value = p ? (p.permissionNote || '') : '';
    document.getElementById('ep-display-scope').value = p ? (p.displayScope || 'internal') : 'internal';
    document.getElementById('ep-status').value = p ? p.status : 'draft';
    pendingPdfs = { qp: null, ms: null };
    ['qp', 'ms'].forEach(function (kind) {
      document.getElementById('ep-' + kind + '-file').value = '';
      document.getElementById('ep-' + kind + '-name').textContent = p && p[kind + 'Available'] ? '已上传（可在列表预览）' : '尚未上传';
    });
    ZJ.openModal('modal-exampaper');
  }

  function saveExamPaper() {
    var id = document.getElementById('ep-id').value;
    var fields = {
      paperName: document.getElementById('ep-paper').value,
      paperCode: document.getElementById('ep-code').value.trim(),
      year: Number(document.getElementById('ep-year').value),
      session: document.getElementById('ep-session').value,
      qpSource: document.getElementById('ep-qp-source').value.trim(),
      msSource: document.getElementById('ep-ms-source').value.trim(),
      permissionNote: document.getElementById('ep-permission-note').value.trim(),
      displayScope: document.getElementById('ep-display-scope').value,
      status: document.getElementById('ep-status').value
    };
    var req = id ? Data.updateExamPaper(Number(id), fields) : Data.createExamPaper(fields);
    req.then(function (paper) {
      return ['qp', 'ms'].reduce(function (chain, kind) {
        return chain.then(function () {
          return pendingPdfs[kind] ? Data.uploadExamPaperPdf(paper.id, kind, pendingPdfs[kind]) : null;
        });
      }, Promise.resolve());
    }).then(function () {
      ZJ.toast(id ? '真题卷已更新' : '真题卷已创建');
      ZJ.closeModal('modal-exampaper');
      loadArchive();
    }).catch(function (err) { ZJ.toast('元数据可能已保存；PDF 上传失败时请重新打开记录检查。' + err.message, true); loadArchive(); });
  }

  /* ================= Phase 1B · 从原卷人工建立完整大题 ================= */
  function clearSourceUrls() {
    sourceLoad++;
    sourceUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    sourceUrls = [];
  }

  function bindSourceQuestion() {
    var stage = document.getElementById('sq-stage');
    var kindControl = document.getElementById('sq-kind');
    kindControl.addEventListener('change', function () { displaySourcePage(); });
    document.getElementById('sq-prev').addEventListener('click', function () { changeSourcePage(-1); });
    document.getElementById('sq-next').addEventListener('click', function () { changeSourcePage(1); });
    document.getElementById('sq-page').addEventListener('change', function () {
      if (!sourceState) { return; }
      var kind = kindControl.value;
      sourceState.pages[kind] = Math.max(0, Math.min(sourceState.counts[kind] - 1, Number(this.value || 1) - 1));
      displaySourcePage();
    });
    document.getElementById('sq-add-full').addEventListener('click', function () { addSourceRegion([0, 0, 1, 1]); });
    document.getElementById('sq-add-region').addEventListener('click', function () {
      if (!sourceState || !sourceState.selection) { ZJ.toast('请先在原卷页面上拖选区域', true); return; }
      addSourceRegion(sourceState.selection);
    });
    stage.addEventListener('pointerdown', function (event) {
      if (!sourceState || !sourceState.counts[kindControl.value] || !document.getElementById('sq-image').naturalWidth) { return; }
      var pt = sourcePoint(event);
      sourceState.start = pt;
      sourceState.selection = null;
      stage.setPointerCapture(event.pointerId);
      drawSourceSelection([pt[0], pt[1], pt[0], pt[1]]);
    });
    stage.addEventListener('pointermove', function (event) {
      if (!sourceState || !sourceState.start) { return; }
      var pt = sourcePoint(event);
      var start = sourceState.start;
      drawSourceSelection([Math.min(start[0], pt[0]), Math.min(start[1], pt[1]),
                           Math.max(start[0], pt[0]), Math.max(start[1], pt[1])]);
    });
    stage.addEventListener('pointerup', function (event) {
      if (!sourceState || !sourceState.start) { return; }
      var pt = sourcePoint(event), start = sourceState.start;
      var box = [Math.min(start[0], pt[0]), Math.min(start[1], pt[1]),
                 Math.max(start[0], pt[0]), Math.max(start[1], pt[1])];
      sourceState.start = null;
      sourceState.selection = box[2] - box[0] >= .02 && box[3] - box[1] >= .02 ? box : null;
      drawSourceSelection(sourceState.selection);
    });
    document.getElementById('sq-regions').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-action]');
      if (!button || !sourceState) { return; }
      var kind = button.dataset.kind, index = Number(button.dataset.index);
      var list = sourceState.regions[kind];
      if (button.dataset.action === 'remove') { list.splice(index, 1); }
      if (button.dataset.action === 'up' && index > 0) {
        var prev = list[index - 1]; list[index - 1] = list[index]; list[index] = prev;
      }
      if (button.dataset.action === 'down' && index < list.length - 1) {
        var next = list[index + 1]; list[index + 1] = list[index]; list[index] = next;
      }
      renderSourceRegions();
    });
    document.getElementById('sq-save').addEventListener('click', saveSourceQuestion);
    document.getElementById('modal-source-question').addEventListener('click', function (event) {
      if (event.target.closest('[data-close="modal-source-question"]')) { clearSourceUrls(); sourceState = null; }
    });
  }

  function sourcePoint(event) {
    var rect = document.getElementById('sq-image').getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  }

  function drawSourceSelection(box) {
    var marker = document.getElementById('sq-selection');
    marker.hidden = !box;
    if (!box) { return; }
    var image = document.getElementById('sq-image'), stage = document.getElementById('sq-stage');
    marker.style.left = (image.offsetLeft - stage.clientLeft + box[0] * image.clientWidth) + 'px';
    marker.style.top = (image.offsetTop - stage.clientTop + box[1] * image.clientHeight) + 'px';
    marker.style.width = ((box[2] - box[0]) * image.clientWidth) + 'px';
    marker.style.height = ((box[3] - box[1]) * image.clientHeight) + 'px';
  }

  function changeSourcePage(delta) {
    if (!sourceState) { return; }
    var kind = document.getElementById('sq-kind').value;
    sourceState.pages[kind] = Math.max(0, Math.min(sourceState.counts[kind] - 1, sourceState.pages[kind] + delta));
    displaySourcePage();
  }

  function displaySourcePage() {
    if (!sourceState) { return; }
    var kind = document.getElementById('sq-kind').value;
    var count = sourceState.counts[kind], index = sourceState.pages[kind];
    var image = document.getElementById('sq-image');
    sourceState.selection = null;
    drawSourceSelection(null);
    document.getElementById('sq-page').value = count ? index + 1 : '';
    document.getElementById('sq-page').max = count;
    document.getElementById('sq-page-total').textContent = ' / ' + count + ' 页';
    document.getElementById('sq-add-full').disabled = !count;
    document.getElementById('sq-add-region').disabled = !count;
    image.removeAttribute('src');
    image.alt = count ? '加载私有原卷页…' : '此原卷没有可用 MS（可保留缺失状态）';
    if (!count) { return; }
    var serial = ++sourceLoad;
    Data.sourcePageImage(sourceState.paperId, kind, index).then(function (url) {
      if (serial !== sourceLoad || !sourceState) { URL.revokeObjectURL(url); return; }
      sourceUrls.push(url);
      image.src = url;
      image.alt = kind.toUpperCase() + ' · PDF 第 ' + (index + 1) + ' 页';
    }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function addSourceRegion(box) {
    if (!sourceState) { return; }
    var kind = document.getElementById('sq-kind').value;
    if (!sourceState.counts[kind] || sourceState.regions[kind].length >= 12) {
      ZJ.toast('该资源不可用或选区已达 12 个', true); return;
    }
    sourceState.regions[kind].push({ pageIndex: sourceState.pages[kind], box: box.slice() });
    sourceState.selection = null;
    drawSourceSelection(null);
    renderSourceRegions();
  }

  function renderSourceRegions() {
    if (!sourceState) { return; }
    var area = document.getElementById('sq-regions');
    area.innerHTML = ['qp', 'ms'].map(function (kind) {
      return '<h3 style="margin:12px 0 6px;">' + kind.toUpperCase() + ' · ' + sourceState.regions[kind].length + ' 个区域</h3>' +
        (sourceState.regions[kind].length ? sourceState.regions[kind].map(function (r, i) {
          return '<div style="padding:8px;border:1px solid #e5e8eb;margin:6px 0;border-radius:6px;">' +
            (i + 1) + '. PDF 第 ' + (r.pageIndex + 1) + ' 页' +
            '<div class="row-actions" style="margin:5px 0;">' +
            ['up', 'down', 'remove'].map(function (action) {
              return '<button class="btn-mini" data-action="' + action + '" data-kind="' + kind +
                '" data-index="' + i + '">' + ({ up: '上移', down: '下移', remove: '移除' })[action] + '</button>';
            }).join('') + '</div><img data-source-thumb="' + kind + ':' + i +
            '" alt="选定区域预览" style="max-width:100%;max-height:350px;display:block;"></div>';
        }).join('') : '<div class="f-hint">尚未添加' + kind.toUpperCase() + ' 区域' + (kind === 'ms' ? '；可保留缺失' : '') + '</div>');
    }).join('');
    ['qp', 'ms'].forEach(function (kind) {
      sourceState.regions[kind].forEach(function (r, i) {
        var target = area.querySelector('[data-source-thumb="' + kind + ':' + i + '"]');
        Data.sourcePageImage(sourceState.paperId, kind, r.pageIndex).then(function (url) {
          var source = new Image();
          source.onload = function () {
            if (target.isConnected) {
              var width = Math.max(1, Math.floor(source.naturalWidth * (r.box[2] - r.box[0])));
              var height = Math.max(1, Math.floor(source.naturalHeight * (r.box[3] - r.box[1])));
              var canvas = document.createElement('canvas');
              canvas.width = width; canvas.height = height;
              canvas.getContext('2d').drawImage(source, r.box[0] * source.naturalWidth,
                r.box[1] * source.naturalHeight, width, height, 0, 0, width, height);
              target.src = canvas.toDataURL('image/png');
            }
            URL.revokeObjectURL(url);
          };
          source.onerror = function () { URL.revokeObjectURL(url); };
          source.src = url;
        }).catch(function (err) { ZJ.toast(err.message, true); });
      });
    });
  }

  function openSourceQuestion(id) {
    var paper = epCache.filter(function (p) { return p.id === id; })[0];
    if (!paper || Data.mode !== 'server') { ZJ.toast('请从正式后台打开原卷', true); return; }
    clearSourceUrls();
    sourceState = { paperId: id, counts: { qp: 0, ms: 0 }, pages: { qp: 0, ms: 0 },
      regions: { qp: [], ms: [] }, selection: null, start: null };
    document.getElementById('sq-title').textContent = paper.paperName + ' · ' + paper.year + ' ' + paper.session + ' · 创建完整大题';
    document.getElementById('sq-number').value = '';
    document.getElementById('sq-kind').value = 'qp';
    document.getElementById('sq-confirm').checked = false;
    document.getElementById('sq-selector').hidden = false;
    document.getElementById('sq-saved').hidden = true;
    document.getElementById('sq-save').disabled = false;
    ZJ.openModal('modal-source-question');
    Promise.all([Data.sourcePages(id, 'qp'), paper.msAvailable ? Data.sourcePages(id, 'ms') : Promise.resolve({ pageCount: 0 })])
      .then(function (results) {
        if (!sourceState || sourceState.paperId !== id) { return; }
        sourceState.counts.qp = results[0].pageCount;
        sourceState.counts.ms = results[1].pageCount;
        displaySourcePage();
        renderSourceRegions();
      }).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function saveSourceQuestion() {
    if (!sourceState) { return; }
    var number = document.getElementById('sq-number').value.trim();
    if (!/^[1-9][0-9]{0,2}$/.test(number) || !sourceState.regions.qp.length || !document.getElementById('sq-confirm').checked) {
      ZJ.toast('请填写完整大题号、加入 QP 区域并确认 QP/MS 边界', true); return;
    }
    var button = document.getElementById('sq-save');
    button.disabled = true;
    Data.createSourceQuestion(sourceState.paperId, {
      originalQuestionNumber: number, qpRegions: sourceState.regions.qp,
      msRegions: sourceState.regions.ms, selectionAcknowledged: true
    }).then(function (question) {
      ZJ.toast('完整大题草稿已保存，待教研审核');
      loadArchive();
      showSavedSource(question);
    }).catch(function (err) { button.disabled = false; ZJ.toast(err.message, true); });
  }

  function openSavedSource(id) {
    Data.sourceQuestion(id).then(showSavedSource).catch(function (err) { ZJ.toast(err.message, true); });
  }

  function showSavedSource(question) {
    clearSourceUrls();
    sourceState = null;
    document.getElementById('sq-title').textContent = question.paperName + ' · 原题 ' + question.originalQuestionNumber + ' · 草稿 #' + question.id;
    document.getElementById('sq-selector').hidden = true;
    var area = document.getElementById('sq-saved');
    area.hidden = false;
    area.innerHTML = '<p>以下按保存顺序预览 QP 和 MS。题目仍为私有、停用状态，等待教研核对；不代表已发布。</p>' +
      ['qp', 'ms'].map(function (kind) {
        var list = question.regions.filter(function (r) { return r.kind === kind; })
          .sort(function (a, b) { return a.sortOrder - b.sortOrder; });
        return '<h3>' + kind.toUpperCase() + ' · ' + list.length + ' 个区域</h3>' +
          (list.length ? list.map(function (r, i) {
            return '<div style="padding:10px;margin:8px 0;border:1px solid #e4e8ed;border-radius:6px;">' +
              (i + 1) + '. PDF 第 ' + (r.pageIndex + 1) + ' 页' +
              '<img data-saved-id="' + r.id + '" alt="已保存的' + kind.toUpperCase() + '区域" style="display:block;max-width:100%;max-height:600px;margin-top:8px;"></div>';
          }).join('') : '<p>无 MS 区域：评分方案暂缺，需教研核对。</p>');
      }).join('');
    ZJ.openModal('modal-source-question');
    question.regions.forEach(function (r) {
      Data.sourceRegionImage(question.id, r.id).then(function (url) {
        var img = area.querySelector('[data-saved-id="' + r.id + '"]');
        if (!img || !img.isConnected) { URL.revokeObjectURL(url); return; }
        sourceUrls.push(url);
        img.src = url;
      }).catch(function (err) { ZJ.toast(err.message, true); });
    });
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
