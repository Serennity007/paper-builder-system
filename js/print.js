/* =========================================================
 * 成都智慧象留学 - 国际课程组卷系统 · 试卷打印页
 *
 * print.html?id={试卷id}&ver=student|teacher|card
 *  - student：学生卷（无答案）
 *  - teacher：教师卷（文末附答案与解析，另起一页）
 *  - card：  答题卡（客观题填涂区 + 填空作答行 + 简答作答框）
 * 附加：密封线开关（左侧装订线）、A/B 卷标记（取试卷 variant）、题目配图。
 * 导出 Word：将排版好的试卷 DOM 序列化为 .doc；打印走浏览器「打印 → 另存为 PDF」。
 * ========================================================= */
(function () {
  'use strict';

  var ZJ = window.ZJ;
  var Data = window.ZJ_Data;

  if (!ZJ.requireLogin()) { return; }
  ZJ.injectWatermark();

  var params = new URLSearchParams(location.search);
  var paperId = params.get('id');
  var ver = ['student', 'teacher', 'card'].indexOf(params.get('ver')) >= 0 ? params.get('ver') : 'student';
  var sealOn = localStorage.getItem('zhxx_zj_seal') === '1';
  var paper = null;

  var VER_NAMES = { student: '学生卷', teacher: '教师卷', card: '答题卡' };

  function zhNum(n) {
    var digits = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
      '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
    return digits[n - 1] || String(n);
  }

  function optionHtml(opt, i) {
    var text = String(opt).replace(/^[A-Za-z][.、．]\s*/, '');
    return '<div class="opt"><b>' + String.fromCharCode(65 + i) + '.</b> ' + ZJ.esc(text) + '</div>';
  }

  function imageHtml(q) {
    return q.imagePath ? '<div class="p-image"><img src="/' + ZJ.esc(q.imagePath) + '" alt="题目配图"></div>' : '';
  }

  /** 按题型给出作答区 */
  function answerAreaHtml(q) {
    if (q.qtype === '单选题' || q.qtype === '多选题') {
      var opts = q.options || [];
      if (!opts.length) { return ''; }
      return '<div class="p-options">' + opts.map(optionHtml).join('') + '</div>';
    }
    if (q.qtype === '判断题') {
      return '<div class="p-options"><div class="opt">(　) 对 / 错</div></div>';
    }
    if (q.qtype === '填空题') {
      // 题干自带下划线空位时不另作答区
      return /_{2,}/.test(q.stem) ? '' :
        '<div class="p-answer-lines"><div class="line"></div></div>';
    }
    if (q.qtype === '简答题') {
      return '<div class="p-answer-lines">' +
        '<div class="line"></div><div class="line"></div><div class="line"></div></div>';
    }
    if (q.qtype === '写作题') {
      var lines = '';
      for (var i = 0; i < 22; i++) { lines += '<div class="line"></div>'; }
      return '<div class="p-writing-lines">' + lines + '</div>';
    }
    return ''; // 口语题无作答区
  }

  function questionHtml(q, no) {
    var html = '<div class="p-question">';
    if (q.passage) { html += '<div class="p-passage">' + ZJ.esc(q.passage) + '</div>'; }
    html += '<div class="p-stem">' + no + '. ' + ZJ.esc(q.stem) + '</div>';
    if (q.audioPath) {
      html += '<div class="p-audio-note">🔊 本题为听力题，配套音频请在课堂播放或使用在线答题（答题页可播放）。</div>';
    }
    html += imageHtml(q);
    if (q.qtype === '判断题') {
      html += '<div class="p-options"><div class="opt">(　) 对 / 错</div></div>';
    } else {
      html += answerAreaHtml(q);
    }
    html += '</div>';
    return html;
  }

  /** 连续同 section 的题目聚合为大题 */
  function sectionsHtml() {
    var items = paper.items || [];
    var sections = [];
    items.forEach(function (it) {
      var name = it.section || it.question.qtype;
      var last = sections[sections.length - 1];
      if (last && last.name === name) { last.items.push(it); }
      else { sections.push({ name: name, items: [it] }); }
    });
    var no = 0;
    return sections.map(function (sec, i) {
      var total = sec.items.reduce(function (s, it) { return s + (Number(it.score) || 0); }, 0);
      var scores = sec.items.map(function (it) { return Number(it.score) || 0; });
      var uniform = scores.every(function (s) { return Math.abs(s - scores[0]) < 0.01; });
      var note = '共 ' + sec.items.length + ' 题，共 ' + (Math.round(total * 10) / 10) + ' 分' +
        (uniform && sec.items.length > 1 ? '（每题 ' + scores[0] + ' 分）' : '');
      var html = '<div class="p-section">' + zhNum(i + 1) + '、' + ZJ.esc(sec.name) +
        '<span class="sec-note">' + note + '</span></div>';
      sec.items.forEach(function (it) {
        no += 1;
        html += questionHtml(it.question, no);
      });
      return html;
    }).join('');
  }

  function keySectionHtml() {
    var items = paper.items || [];
    if (!items.length) { return ''; }
    var html = '<div class="p-key"><div class="k-title">参考答案与解析（教师卷）</div>';
    items.forEach(function (it, i) {
      var q = it.question;
      html += '<div class="k-item"><b>' + (i + 1) + '.</b> ' +
        '<span class="k-ans">' + (q.answer ? '【答案】' + ZJ.esc(q.answer) : '【要点】见题库') + '</span>' +
        (q.explanation ? '<br><span class="k-exp">【解析】' + ZJ.esc(q.explanation) + '</span>' : '') +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  /** 答题卡：客观题填涂气泡 + 填空作答行 + 简答作答框 */
  function answerCardHtml() {
    var items = paper.items || [];
    var html = '<div class="p-card-note">请用 2B 铅笔将对应题目的答案标号涂黑；填空题与简答题在指定区域作答，字迹工整。</div>';
    var no = 0;
    var groups = { obj: [], fill: [], subj: [] };
    items.forEach(function (it) {
      var q = it.question;
      if (q.qtype === '单选题' || q.qtype === '多选题' || q.qtype === '判断题') { groups.obj.push(it); }
      else if (q.qtype === '填空题') { groups.fill.push(it); }
      else { groups.subj.push(it); }
    });
    if (groups.obj.length) {
      html += '<div class="p-section">一、客观题填涂区<span class="sec-note">共 ' + groups.obj.length + ' 题</span></div>';
      groups.obj.forEach(function (it) {
        no += 1;
        var q = it.question;
        html += '<div class="card-row">';
        html += '<span class="card-no">' + no + '</span>';
        if (q.qtype === '判断题') {
          html += '<span class="bubble">对</span><span class="bubble">错</span>';
        } else {
          var n = Math.max((q.options || []).length, 4);
          var maxPick = q.qtype === '多选题' ? 2 : 1; // 多选给两行涂卡位
          for (var row = 0; row < maxPick; row++) {
            if (row === 1) { html += '<span class="card-no"></span>'; }
            for (var i = 0; i < n; i++) {
              html += '<span class="bubble">' + String.fromCharCode(65 + i) + '</span>';
            }
          }
        }
        html += '</div>';
      });
    }
    if (groups.fill.length) {
      html += '<div class="p-section">' + (groups.obj.length ? '二' : '一') + '、填空题作答区<span class="sec-note">共 ' + groups.fill.length + ' 题</span></div>';
      groups.fill.forEach(function (it) {
        no += 1;
        html += '<div class="card-fill"><span class="card-no">' + no + '.</span><span class="fill-line"></span></div>';
      });
    }
    if (groups.subj.length) {
      html += '<div class="p-section">' + (groups.obj.length || groups.fill.length ? '三' : '一') +
        '、简答 / 主观题作答区<span class="sec-note">共 ' + groups.subj.length + ' 题</span></div>';
      groups.subj.forEach(function (it) {
        no += 1;
        var q = it.question;
        if (q.qtype === '写作题') {
          html += '<div class="card-subject-box tall"><div class="csb-label">' + no + '. ' + ZJ.esc(q.qtype) + '（在本框内作答或贴附作文纸）</div><div class="csb-lines">';
          for (var i = 0; i < 14; i++) { html += '<div class="line"></div>'; }
          html += '</div></div>';
        } else if (q.qtype === '口语题') {
          html += '<div class="card-fill"><span class="card-no">' + no + '.</span><span class="fill-line"></span></div>' +
            '<div class="card-note" style="margin:2pt 0 8pt;">口语题由考官现场记录评分。</div>';
        } else {
          html += '<div class="card-subject-box"><div class="csb-label">' + no + '. ' + ZJ.esc(q.qtype) + '</div><div class="csb-lines">';
          for (var j = 0; j < 4; j++) { html += '<div class="line"></div>'; }
          html += '</div></div>';
        }
      });
    }
    return '<div class="p-answer-card">' + html + '</div>';
  }

  function sealHtml() {
    if (!sealOn) { return ''; }
    return '<div class="p-seal"><span>密　封　线　内　不　得　答　题</span></div>';
  }

  function sheetHtml(withKey) {
    var meta = [
      paper.subjectLine || '',
      paper.duration ? '考试时长：' + paper.duration + ' 分钟' : '',
      '总分：' + (paper.totalScore || 0) + ' 分'
    ].filter(Boolean).join('　|　');
    var variantBadge = paper.variant ? '<span class="p-variant">' + ZJ.esc(paper.variant) + '</span>' : '';
    var titleArea =
      '<div class="p-school">成都智慧象留学 · 国际课程组卷系统</div>' +
      '<div class="p-title">' + ZJ.esc(paper.name) + (ver === 'card' ? ' · 答题卡' : '') + variantBadge + '</div>' +
      (meta && ver !== 'card' ? '<div class="p-subline">' + ZJ.esc(meta) + '</div>' : '');
    var body;
    if (ver === 'card') {
      body = '<div class="p-info-row"><span>姓名：<span class="blank"></span></span>' +
        '<span>班级：<span class="blank"></span></span>' +
        '<span>考号：<span class="blank"></span></span></div>' + answerCardHtml();
    } else {
      body = '<div class="p-info-row"><span>姓名：<span class="blank"></span></span>' +
        '<span>班级：<span class="blank"></span></span>' +
        '<span>得分：<span class="blank"></span></span></div>' +
        sectionsHtml();
    }
    var html =
      '<div class="paper-sheet' + (sealOn ? ' with-seal' : '') + '" id="paper-sheet">' +
      sealHtml() + titleArea + body;
    if (withKey) { html += keySectionHtml(); }
    html += '</div>';
    return html;
  }

  function render() {
    document.getElementById('pt-title').textContent = VER_NAMES[ver] + ' · ' + paper.name;
    // 版本切换按钮组
    var sw = document.getElementById('pt-switch');
    var order = ['student', 'teacher', 'card'];
    var next = order[(order.indexOf(ver) + 1) % order.length];
    sw.textContent = '切换' + VER_NAMES[next];
    sw.href = 'print.html?id=' + paperId + '&ver=' + next;
    var sealBtn = document.getElementById('pt-seal');
    sealBtn.classList.toggle('on', sealOn);
    sealBtn.textContent = sealOn ? '✓ 密封线' : '密封线';
    document.getElementById('print-root').innerHTML = sheetHtml(ver === 'teacher');
    ZJ.renderMath(document.getElementById('print-root'));
    // BR-06：记录 PDF 生成结果（QP=学生卷 / MS=教师卷），失败不影响预览
    if (window.ZJ_Data && window.ZJ_Data.recordGenerated) {
      window.ZJ_Data.recordGenerated(paper.id, ver === 'teacher' ? 'ms' : 'qp').catch(function () {});
    }
    document.title = paper.name + '（' + VER_NAMES[ver] + '）';
  }

  /* ---- 导出 Word ---- */
  function exportWord() {
    var inner = document.getElementById('paper-sheet');
    if (!inner) { return; }
    var doc = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">' +
      '<head><meta charset="utf-8"><title>' + ZJ.esc(paper.name) + '</title>' +
      '<style>' +
      'body { font-family: DengXian, "Microsoft YaHei", SimSun, serif; font-size: 12.5pt; line-height: 1.85; color: #1A2432; }' +
      '.p-school { text-align: center; font-size: 11pt; color: #6E7B88; letter-spacing: 2px; }' +
      '.p-title { text-align: center; font-size: 17pt; font-weight: bold; margin: 4pt 0; }' +
      '.p-variant { display: inline-block; border: 1pt solid #12233A; font-size: 12pt; padding: 0 8pt; margin-left: 8pt; }' +
      '.p-subline { text-align: center; font-size: 10.5pt; color: #6E7B88; }' +
      '.p-info-row { font-size: 11pt; margin: 10pt 0; }' +
      '.p-info-row .blank { display: inline-block; width: 72pt; border-bottom: 1pt solid #444; }' +
      '.p-section { font-size: 12.5pt; font-weight: bold; margin: 14pt 0 6pt; }' +
      '.p-section .sec-note { font-weight: normal; font-size: 10.5pt; color: #55606C; }' +
      '.p-question { margin-bottom: 12pt; }' +
      '.p-passage { border-left: 2.25pt solid #C9A85C; background: #FAF8F2; padding: 7pt 10pt; font-size: 11pt; white-space: pre-wrap; }' +
      '.p-stem { white-space: pre-wrap; }' +
      '.p-image img { max-width: 60%; }' +
      '.p-options .opt { padding-left: 22pt; text-indent: -22pt; }' +
      '.p-answer-lines .line, .p-writing-lines .line { border-bottom: 0.75pt solid #9AA3AC; height: 24pt; }' +
      '.card-row { margin-bottom: 6pt; } .card-no { font-weight: bold; margin-right: 8pt; }' +
      '.bubble { display: inline-block; width: 22pt; height: 16pt; line-height: 15pt; text-align: center; border: 1pt solid #55606C; border-radius: 8pt; font-size: 9pt; margin-right: 6pt; }' +
      '.card-fill { margin: 8pt 0; } .fill-line { display: inline-block; width: 82%; border-bottom: 0.75pt solid #55606C; }' +
      '.card-subject-box { border: 0.75pt solid #55606C; padding: 6pt 8pt; margin: 8pt 0; }' +
      '.csb-label { font-size: 10.5pt; color: #55606C; }' +
      '.csb-lines .line { border-bottom: 0.75pt solid #9AA3AC; height: 22pt; }' +
      '.p-key { border-top: 1.5pt dashed #12233A; padding-top: 8pt; page-break-before: always; }' +
      '.p-key .k-title { font-size: 13pt; font-weight: bold; margin-bottom: 8pt; }' +
      '.p-key .k-item { font-size: 11pt; margin-bottom: 8pt; }' +
      '.k-exp { color: #55606C; }' +
      '</style></head><body>' + inner.outerHTML + '</body></html>';
    var blob = new Blob(['\ufeff', doc], { type: 'application/msword;charset=utf-8' });
    ZJ.downloadBlob(blob, paper.name + (ver === 'teacher' ? '_教师卷' : ver === 'card' ? '_答题卡' : '_学生卷') + '.doc');
    ZJ.toast('Word 文档已生成，可用 Word / WPS 打开编辑');
  }

  /* ---- 工具栏 ---- */
  document.getElementById('pt-print').addEventListener('click', function () { window.print(); });
  document.getElementById('pt-word').addEventListener('click', exportWord);
  document.getElementById('pt-seal').addEventListener('click', function () {
    sealOn = !sealOn;
    try { localStorage.setItem('zhxx_zj_seal', sealOn ? '1' : '0'); } catch (e) { /* 忽略 */ }
    render();
  });

  /* ---- 启动 ---- */
  ZJ_READY.then(function () {
    if (!paperId) {
      document.getElementById('print-root').innerHTML =
        '<div class="empty-tip" style="padding-top:80px;">缺少试卷参数，请从「试卷库」进入打印预览。</div>';
      return;
    }
    return Data.paper(paperId).then(function (p) {
      paper = p;
      render();
    });
  }).catch(function (err) {
    document.getElementById('print-root').innerHTML =
      '<div class="empty-tip" style="padding-top:80px;">' + ZJ.esc(err.message || '试卷加载失败') + '</div>';
  });
})();
