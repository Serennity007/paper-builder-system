/* =========================================================
 * 成都智慧象留学 - 国际课程组卷系统 · 数据访问层（双模式）
 *
 * 服务端模式：检测到后端（python backend/app.py，端口 8687）时走 REST API，
 *             数据落 SQLite 持久保存，跨浏览器成立。
 * 演示模式：  仅用 server.py 打开（无后端）时，退回 sessionStorage 本地演示，
 *             种子来自 js/mock-data.js，关标签页即重置。
 *
 * 两种模式对外提供同一套方法（window.ZJ_Data），页面逻辑无需区分。
 * 与学生进度追踪系统（8686）保持同一探测协议：POST /api/ping。
 * ========================================================= */
(function () {
  'use strict';

  var TOKEN_KEY = 'zhxx_zj_token_v1';
  var MODE_KEY = 'zhxx_zj_mode_v1';
  var DEMO_DB_KEY = 'zhxx_zj_demo_v1';

  /* ---------------- 服务端模式 ---------------- */

  var API = {
    mode: 'demo',
    token: null,

    loadToken: function () {
      try { API.token = sessionStorage.getItem(TOKEN_KEY) || null; } catch (e) { API.token = null; }
      return API.token;
    },
    saveToken: function (token) {
      API.token = token;
      try {
        if (token) { sessionStorage.setItem(TOKEN_KEY, token); } else { sessionStorage.removeItem(TOKEN_KEY); }
      } catch (e) { /* 忽略 */ }
    },

    detect: function () {
      return fetch('/api/ping', { method: 'POST', cache: 'no-store' })
        .then(function (res) { return res.ok; })
        .then(function (ok) {
          API.mode = ok ? 'server' : 'demo';
          try { sessionStorage.setItem(MODE_KEY, API.mode); } catch (e) { /* 忽略 */ }
          API.loadToken();
          return API.mode;
        })
        .catch(function () {
          API.mode = 'demo';
          try { sessionStorage.setItem(MODE_KEY, API.mode); } catch (e) { /* 忽略 */ }
          API.loadToken();
          return API.mode;
        });
    },

    req: function (method, path, body) {
      var headers = { 'Content-Type': 'application/json' };
      if (API.token) { headers['Authorization'] = 'Bearer ' + API.token; }
      return fetch(path, {
        method: method,
        headers: headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store'
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var err = new Error(data.error || ('请求失败（' + res.status + '）'));
            err.status = res.status;
            throw err;
          }
          return data;
        });
      });
    },

    login: function (account, password) {
      return API.req('POST', '/api/auth/login', { account: account, password: password })
        .then(function (data) {
          API.saveToken(data.token);
          return data.profile;
        });
    },
    logout: function () {
      if (API.mode === 'server' && API.token) {
        API.req('POST', '/api/auth/logout').catch(function () { /* 忽略 */ });
      }
      API.saveToken(null);
    },

    bootstrap: function () {
      if (API.mode !== 'server' || !API.token) { return Promise.resolve(null); }
      return API.req('GET', '/api/bootstrap');
    },

    questions: function (filters) {
      var qs = [];
      Object.keys(filters || {}).forEach(function (k) {
        var v = filters[k];
        if (v !== undefined && v !== null && String(v) !== '') { qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); }
      });
      return API.req('GET', '/api/questions' + (qs.length ? '?' + qs.join('&') : '')).then(function (d) { return d.questions; });
    },
    createQuestion: function (fields) {
      return API.req('POST', '/api/questions', fields).then(function (d) { return d.question; });
    },
    updateQuestion: function (id, fields) {
      return API.req('PUT', '/api/questions/' + encodeURIComponent(id), fields).then(function (d) { return d.question; });
    },
    deleteQuestion: function (id) {
      return API.req('DELETE', '/api/questions/' + encodeURIComponent(id));
    },
    batchQuestions: function (ids, action) {
      return API.req('POST', '/api/questions/batch', { ids: ids, action: action });
    },
    trashList: function () {
      return API.req('GET', '/api/questions/trash').then(function (d) { return d.questions; });
    },
    restoreQuestion: function (id) {
      return API.req('POST', '/api/questions/' + encodeURIComponent(id) + '/restore');
    },
    purgeQuestion: function (id) {
      return API.req('DELETE', '/api/questions/' + encodeURIComponent(id) + '/purge');
    },
    emptyTrash: function () {
      return API.req('POST', '/api/questions/empty-trash');
    },
    checkDup: function (stem, excludeId) {
      return API.req('POST', '/api/questions/check-dup', { stem: stem, excludeId: excludeId || 0 })
        .then(function (d) { return d.duplicates; });
    },

    uploadFile: function (file) {
      var fd = new FormData();
      fd.append('file', file);
      var headers = {};
      if (API.token) { headers['Authorization'] = 'Bearer ' + API.token; }
      return fetch('/api/upload', { method: 'POST', headers: headers, body: fd, cache: 'no-store' })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) { throw new Error(data.error || ('上传失败（' + res.status + '）')); }
            return data;
          });
        });
    },

    knowledge: function () {
      return API.req('GET', '/api/knowledge').then(function (d) { return d.tree; });
    },
    knowledgeAdd: function (subject, name, parentId) {
      return API.req('POST', '/api/knowledge', { subject: subject, name: name, parentId: parentId || 0 })
        .then(function (d) { return d.tree; });
    },
    knowledgeDelete: function (id) {
      return API.req('DELETE', '/api/knowledge/' + encodeURIComponent(id)).then(function (d) { return d.tree; });
    },

    onlineVerify: function (examId, code, name) {
      return API.req('POST', '/api/online/verify', { examId: examId, code: code, name: name });
    },
    onlineSubmit: function (examId, code, candidateId, answers) {
      return API.req('POST', '/api/online/submit', { examId: examId, code: code, candidateId: candidateId, answers: answers });
    },
    uploadAnswerSheet: function (examId, candidateId, file) {
      var fd = new FormData();
      fd.append('file', file);
      var headers = {};
      if (API.token) { headers['Authorization'] = 'Bearer ' + API.token; }
      return fetch('/api/exams/' + encodeURIComponent(examId) + '/candidates/' + encodeURIComponent(candidateId) + '/sheet',
        { method: 'POST', headers: headers, body: fd, cache: 'no-store' })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) { throw new Error(data.error || ('上传失败（' + res.status + '）')); }
            return data;
          });
        });
    },
    exportExamScores: function (examId, examName) {
      return API.downloadFile('/api/exams/' + encodeURIComponent(examId) + '/export.xlsx',
        (examName || '考试') + '_成绩单.xlsx');
    },

    generate: function (params) {
      return API.req('POST', '/api/papers/generate', params);
    },

    papers: function () {
      return API.req('GET', '/api/papers').then(function (d) { return d.papers; });
    },
    paper: function (id) {
      return API.req('GET', '/api/papers/' + encodeURIComponent(id)).then(function (d) { return d.paper; });
    },
    savePaper: function (fields) {
      var req = fields.id ? API.req('PUT', '/api/papers/' + encodeURIComponent(fields.id), fields)
                          : API.req('POST', '/api/papers', fields);
      return req.then(function (d) { return d.paper; });
    },
    duplicatePaper: function (id) {
      return API.req('POST', '/api/papers/' + encodeURIComponent(id) + '/duplicate').then(function (d) { return d.paper; });
    },
    setPaperStatus: function (id, status) {
      return API.req('PUT', '/api/papers/' + encodeURIComponent(id) + '/status', { status: status }).then(function (d) { return d.paper; });
    },
    deletePaper: function (id) {
      return API.req('DELETE', '/api/papers/' + encodeURIComponent(id));
    },

    exams: function () {
      return API.req('GET', '/api/exams').then(function (d) { return d.exams; });
    },
    exam: function (id) {
      return API.req('GET', '/api/exams/' + encodeURIComponent(id)).then(function (d) { return d.exam; });
    },
    createExam: function (fields) {
      return API.req('POST', '/api/exams', fields).then(function (d) { return d.exam; });
    },
    updateExam: function (id, fields) {
      return API.req('PUT', '/api/exams/' + encodeURIComponent(id), fields).then(function (d) { return d.exam; });
    },
    deleteExam: function (id) {
      return API.req('DELETE', '/api/exams/' + encodeURIComponent(id));
    },
    saveExamScores: function (examId, candidateId, scores) {
      return API.req('PUT', '/api/exams/' + encodeURIComponent(examId) + '/scores', { candidateId: candidateId, scores: scores });
    },
    examReport: function (id) {
      return API.req('GET', '/api/exams/' + encodeURIComponent(id) + '/report').then(function (d) { return d; });
    },

    roster: function () {
      return API.req('GET', '/api/roster').then(function (d) { return d.students; });
    },
    rosterAdd: function (students) {
      return API.req('POST', '/api/roster', { students: students });
    },
    rosterRemove: function (id) {
      return API.req('DELETE', '/api/roster/' + encodeURIComponent(id));
    },

    blueprints: function () {
      return API.req('GET', '/api/blueprints').then(function (d) { return d.blueprints; });
    },
    saveBlueprint: function (name, config) {
      return API.req('POST', '/api/blueprints', { name: name, config: config });
    },
    deleteBlueprint: function (id) {
      return API.req('DELETE', '/api/blueprints/' + encodeURIComponent(id));
    },

    stats: function () {
      return API.req('GET', '/api/stats/overview').then(function (d) { return d.stats; });
    },
    auditList: function (action) {
      var qs = action && action !== '全部' ? ('?action=' + encodeURIComponent(action)) : '?limit=200';
      return API.req('GET', '/api/audit' + qs).then(function (d) { return d.logs; });
    },

    changePassword: function (oldPassword, newPassword) {
      return API.req('PUT', '/api/me/password', { oldPassword: oldPassword, newPassword: newPassword });
    },

    examPapers: function (filters) {
      var qs = [];
      Object.keys(filters || {}).forEach(function (k) {
        var v = filters[k];
        if (v !== undefined && v !== null && String(v) !== '') { qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); }
      });
      return API.req('GET', '/api/exam-papers' + (qs.length ? '?' + qs.join('&') : '')).then(function (d) { return d.examPapers; });
    },
    createExamPaper: function (fields) {
      return API.req('POST', '/api/exam-papers', fields).then(function (d) { return d.examPaper; });
    },
    updateExamPaper: function (id, fields) {
      return API.req('PUT', '/api/exam-papers/' + encodeURIComponent(id), fields).then(function (d) { return d.examPaper; });
    },
    deleteExamPaper: function (id) {
      return API.req('DELETE', '/api/exam-papers/' + encodeURIComponent(id));
    },
    uploadExamPaperPdf: function (id, kind, file) {
      var fd = new FormData();
      fd.append('file', file);
      return fetch('/api/exam-papers/' + encodeURIComponent(id) + '/files/' + kind,
        { method: 'POST', headers: { Authorization: 'Bearer ' + API.token }, body: fd, cache: 'no-store' })
        .then(function (res) { return res.json().then(function (data) {
          if (!res.ok) { throw new Error(data.error || '上传失败'); }
          return data.examPaper;
        }); });
    },
    previewExamPaperPdf: function (id, kind) {
      var tab = window.open('', '_blank');
      return fetch('/api/exam-papers/' + encodeURIComponent(id) + '/files/' + kind,
        { headers: { Authorization: 'Bearer ' + API.token }, cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) { throw new Error('预览失败（' + res.status + '）'); }
          return res.blob();
        }).then(function (blob) {
          var url = URL.createObjectURL(blob);
          if (tab) { tab.location.href = url; }
          else { window.ZJ.downloadBlob(blob, kind.toUpperCase() + '.pdf'); }
          setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        }).catch(function (err) {
          if (tab) { tab.close(); }
          throw err;
        });
    },
    examTopics: function (paper) {
      return API.req('GET', '/api/exam-topics?paper=' + encodeURIComponent(paper)).then(function (d) { return d; });
    },
    favorites: function () {
      return API.req('GET', '/api/favorites').then(function (d) { return d.questions; });
    },
    addFavorite: function (questionId) {
      return API.req('POST', '/api/favorites', { questionId: questionId });
    },
    removeFavorite: function (questionId) {
      return API.req('DELETE', '/api/favorites/' + encodeURIComponent(questionId));
    },
    recordGenerated: function (userPaperId, kind) {
      return API.req('POST', '/api/generated-files', { userPaperId: userPaperId, kind: kind || 'qp' });
    },
    generatedFiles: function (userPaperId) {
      return API.req('GET', '/api/generated-files' + (userPaperId ? '?userPaperId=' + encodeURIComponent(userPaperId) : '')).then(function (d) { return { files: d.files }; });
    },

    backup: function () {
      return API.downloadFile('/api/backup', '组卷系统备份_' + window.ZJ.todayStr() + '.json');
    },
    restore: function (data) {
      return API.req('POST', '/api/restore', { data: data });
    },

    /** 下载需要鉴权的文件（导出/模板/备份） */
    downloadFile: function (path, filename) {
      var headers = {};
      if (API.token) { headers['Authorization'] = 'Bearer ' + API.token; }
      return fetch(path, { headers: headers, cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) { throw new Error('下载失败（' + res.status + '）'); }
          return res.blob();
        })
        .then(function (blob) { window.ZJ.downloadBlob(blob, filename); });
    },
    exportQuestions: function () {
      return API.downloadFile('/api/questions/export', '国际课程题库_' + window.ZJ.todayStr() + '.xlsx');
    },
    downloadTemplate: function () {
      return API.downloadFile('/api/questions/template', '题库导入模板.xlsx');
    },
    importQuestions: function (file) {
      var fd = new FormData();
      fd.append('file', file);
      var headers = {};
      if (API.token) { headers['Authorization'] = 'Bearer ' + API.token; }
      return fetch('/api/questions/import', { method: 'POST', headers: headers, body: fd, cache: 'no-store' })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) { throw new Error(data.error || ('导入失败（' + res.status + '）')); }
            return data;
          });
        });
    }
  };

  /* ---------------- 演示模式（sessionStorage 本地库） ---------------- */

  function ssGet(key, fallback) {
    try {
      var raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function ssSet(key, val) {
    try { sessionStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 忽略 */ }
  }

  function demoDb() {
    var db = ssGet(DEMO_DB_KEY, null);
    if (!db || !db.questions) {
      db = JSON.parse(JSON.stringify(window.ZJ_MOCK));
      db.nextQid = db.questions.length + 1;
      db.nextPid = db.papers.length + 1;
      db.nextExamId = db.exams.length + 1;
      ssSet(DEMO_DB_KEY, db);
    }
    return db;
  }
  function demoSave(db) { ssSet(DEMO_DB_KEY, db); }
  function now() { return new Date().toISOString().slice(0, 19); }
  function normStem(s) {
    return String(s || '').toLowerCase().split('').filter(function (ch) { return /[a-z0-9\u4e00-\u9fa5]/.test(ch); }).join('');
  }

  function demoLogin(account, password) {
    var creds = window.ZJ_MOCK.credentials;
    for (var i = 0; i < creds.length; i++) {
      if (creds[i].account === String(account).trim() && creds[i].password === password) {
        return Promise.resolve({ role: creds[i].role, name: creds[i].name, title: creds[i].title, account: creds[i].account });
      }
    }
    return Promise.reject(new Error('账号或密码不正确'));
  }

  function demoQuestionDict(q) { return JSON.parse(JSON.stringify(q)); }
  function demoUsedCount(db, qid) {
    var n = 0;
    db.papers.forEach(function (p) { (p.items || []).forEach(function (it) { if (it.questionId === qid) { n += 1; } }); });
    return n;
  }

  function demoFilterQuestions(filters, includeDeleted) {
    var db = demoDb();
    var list = db.questions.slice().reverse();
    return list.filter(function (q) {
      if (!includeDeleted && q.deletedAt) { return false; }
      if (filters.subject && filters.subject !== '全部科目' && q.subject !== filters.subject) { return false; }
      if (filters.qtype && filters.qtype !== '全部题型' && q.qtype !== filters.qtype) { return false; }
      if (filters.difficulty && filters.difficulty !== '全部难度' && filters.difficulty !== '0' &&
          Number(q.difficulty) !== Number(filters.difficulty)) { return false; }
      if (filters.status && filters.status !== '全部状态' && q.status !== filters.status) { return false; }
      if (filters.tag && q.tags.indexOf(filters.tag) < 0) { return false; }
      if (filters.starred === '1' || filters.starred === 'true') { if (!q.starred) { return false; } }
      if (filters.q) {
        var kw = filters.q;
        if ((q.stem + q.passage + q.tags + q.answer + q.source).indexOf(kw) < 0) { return false; }
      }
      return true;
    });
  }

  /** 演示模式智能组卷（与服务端算法同口径：分层抽样 + 回补 + 排除） */
  function demoGenerate(params) {
    var db = demoDb();
    var subjects = params.subjects || [];
    var pct = params.dist || {};
    var totalPct = (pct.basic || 0) + (pct.boost || 0) + (pct.sprint || 0);
    var bands = { basic: [1, 2], boost: [3, 3], sprint: [4, 5] };
    var share;
    if (totalPct > 0) {
      share = { basic: (pct.basic || 0) / totalPct, boost: (pct.boost || 0) / totalPct, sprint: (pct.sprint || 0) / totalPct };
    } else {
      share = { basic: 0, boost: 1, sprint: 0 };
    }
    var tags = params.tags || [];
    var exclude = {};
    (params.excludeIds || []).forEach(function (id) { exclude[id] = true; });
    var selected = [], shortage = [], used = {};
    (params.types || []).forEach(function (tr) {
      var count = Math.max(0, Number(tr.count) || 0);
      if (!tr.qtype || count <= 0) { return; }
      var pool = db.questions.filter(function (q) {
        return q.qtype === tr.qtype && q.status === '启用' && !q.deletedAt &&
          (subjects.length === 0 || subjects.indexOf(q.subject) >= 0) && !exclude[q.id];
      });
      if (tags.length) {
        var hit = pool.filter(function (q) { return tags.some(function (t) { return q.tags.indexOf(t) >= 0; }); });
        if (hit.length >= count) { pool = hit; }
      }
      function bandOf(q) {
        for (var b in bands) { if (q.difficulty >= bands[b][0] && q.difficulty <= bands[b][1]) { return b; } }
        return 'boost';
      }
      var strata = { basic: [], boost: [], sprint: [] };
      pool.forEach(function (q) { strata[bandOf(q)].push(q); });
      function shuffle(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      }
      Object.keys(strata).forEach(function (k) { shuffle(strata[k]); });
      var targets = {}, remain = count;
      var order = ['basic', 'boost', 'sprint'].sort(function (a, b) { return share[b] - share[a]; });
      order.forEach(function (band, idx) {
        if (idx === order.length - 1) { targets[band] = remain; }
        else {
          targets[band] = Math.min(remain, Math.round(count * share[band]));
          remain -= targets[band];
        }
      });
      var picked = [];
      order.forEach(function (band) {
        var cand = strata[band].filter(function (q) { return !used[q.id]; });
        picked = picked.concat(cand.slice(0, Math.min(targets[band], cand.length)));
      });
      if (picked.length < count) {
        var rest = pool.filter(function (q) { return !used[q.id] && picked.indexOf(q) < 0; });
        shuffle(rest);
        picked = picked.concat(rest.slice(0, count - picked.length));
      }
      picked.forEach(function (q) { used[q.id] = true; });
      if (picked.length < count) {
        shortage.push({ qtype: tr.qtype, requested: count, got: picked.length, pool: pool.length });
      }
      picked.forEach(function (q) {
        var d = demoQuestionDict(q);
        d.assignScore = Number(tr.score) || 0;
        selected.push(d);
      });
    });
    return Promise.resolve({ questions: selected, shortage: shortage });
  }

  function demoPaperMeta(p) {
    var total = 0, n = 0;
    (p.items || []).forEach(function (it) {
      total += Number(it.score) || 0;
      n += 1;
    });
    return {
      id: p.id, name: p.name, subjectLine: p.subjectLine || '', remark: p.remark || '',
      duration: p.duration || 0, status: p.status, variant: p.variant || '', createdBy: p.createdBy,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
      questionCount: n, totalScore: Math.round(total * 10) / 10
    };
  }

  function demoPaperFull(p) {
    var db = demoDb();
    var full = demoPaperMeta(p);
    full.items = (p.items || []).map(function (it) {
      var q = null;
      for (var i = 0; i < db.questions.length; i++) {
        if (db.questions[i].id === it.questionId) { q = db.questions[i]; break; }
      }
      return {
        itemId: it.itemId, position: it.position,
        score: Number(it.score) || 0,
        section: it.section || (q ? q.qtype : ''),
        question: q ? demoQuestionDict(q) : null
      };
    }).filter(function (it) { return it.question; });
    return full;
  }

  /** 演示模式统计报告（与服务端 /report 同口径） */
  function demoExamReport(db, examId) {
    var exam = null;
    db.exams.forEach(function (e) { if (e.id === examId) { exam = e; } });
    if (!exam) { throw new Error('考试不存在'); }
    var paper = null;
    db.papers.forEach(function (p) { if (p.id === exam.paperId) { paper = p; } });
    var items = paper ? paper.items : [];
    var qmap = {};
    db.questions.forEach(function (q) { qmap[q.id] = q; });
    var candidates = exam.candidates || [];
    var scoreMap = {};
    (exam.scores || []).forEach(function (s) { scoreMap[s.candidateId + ':' + s.questionId] = Number(s.score) || 0; });
    var totals = candidates.map(function (c) {
      var total = 0, entered = 0;
      items.forEach(function (it) {
        if (scoreMap[c.id + ':' + it.questionId] !== undefined) {
          entered += 1;
          total += scoreMap[c.id + ':' + it.questionId];
        }
      });
      return { candidateId: c.id, name: c.name, total: Math.round(total * 10) / 10, entered: entered, questionCount: items.length };
    });
    var fullTotal = Math.round(items.reduce(function (s, it) { return s + (Number(it.score) || 0); }, 0) * 10) / 10;
    var values = totals.map(function (t) { return t.total; });
    var n = values.length;
    var avg = n ? Math.round(values.reduce(function (a, b) { return a + b; }, 0) / n * 10) / 10 : 0;
    var passLine = Math.round(fullTotal * 0.6 * 10) / 10;
    var perQuestion = items.map(function (it, idx) {
      var q = qmap[it.questionId] || {};
      var full = Number(it.score) || 0;
      var enteredN = 0, got = 0;
      candidates.forEach(function (c) {
        var v = scoreMap[c.id + ':' + it.questionId];
        if (v !== undefined) { enteredN += 1; got += v; }
      });
      return {
        questionId: it.questionId, position: idx + 1, section: it.section || q.qtype || '',
        qtype: q.qtype || '', fullScore: full,
        rate: enteredN && full > 0 ? Math.round(got / (full * enteredN) * 1000) / 10 : null,
        entered: enteredN, tags: q.tags || '', stem: String(q.stem || '').slice(0, 40)
      };
    });
    var tagAcc = {};
    perQuestion.forEach(function (pq) {
      if (pq.rate === null || pq.fullScore <= 0) { return; }
      String(pq.tags || '').replace(/，/g, '、').split('、').forEach(function (t) {
        t = t.trim();
        if (!t) { return; }
        var acc = tagAcc[t] || { got: 0, full: 0 };
        acc.got += pq.rate / 100 * pq.fullScore * pq.entered;
        acc.full += pq.fullScore * pq.entered;
        tagAcc[t] = acc;
      });
    });
    var weakTags = Object.keys(tagAcc).map(function (t) {
      return { tag: t, rate: Math.round(tagAcc[t].got / tagAcc[t].full * 1000) / 10, full: Math.round(tagAcc[t].full * 10) / 10 };
    }).sort(function (a, b) { return a.rate - b.rate; });
    var step = fullTotal <= 150 ? 10 : 20;
    var distribution = [];
    for (var i = 0; i * step <= fullTotal; i++) {
      var lo = i * step, hi = (i + 1) * step;
      distribution.push({
        label: hi < fullTotal ? (lo + '-' + hi) : (lo + '-' + fullTotal + '+'),
        count: values.filter(function (v) { return hi >= fullTotal ? v >= lo : (v >= lo && v < hi); }).length
      });
    }
    var worst = perQuestion.filter(function (q) { return q.rate !== null; }).sort(function (a, b) { return a.rate - b.rate; }).slice(0, 3);
    var cells = candidates.length * items.length;
    var enteredCells = totals.reduce(function (s, t) { return s + t.entered; }, 0);
    return {
      exam: demoExamMeta(db, exam),
      fullTotal: fullTotal,
      candidateCount: candidates.length,
      enteredProgress: { cells: enteredCells, total: cells },
      avg: avg,
      max: n ? Math.max.apply(null, values) : 0,
      min: n ? Math.min.apply(null, values) : 0,
      median: n ? values.slice().sort(function (a, b) { return a - b; })[Math.floor((n - 1) / 2)] : 0,
      passLine: passLine,
      passRate: n ? Math.round(values.filter(function (v) { return v >= passLine; }).length / n * 1000) / 10 : 0,
      distribution: distribution,
      perQuestion: perQuestion,
      weakTags: weakTags.slice(0, 8),
      totals: totals.slice().sort(function (a, b) { return b.total - a.total; }),
      reviewAdvice: worst.map(function (q) {
        return { position: q.position, section: q.section, rate: q.rate, stem: q.stem };
      })
    };
  }

  function demoExamMeta(db, e) {
    var paper = null;
    db.papers.forEach(function (p) { if (p.id === e.paperId) { paper = p; } });
    var candN = (e.candidates || []).length;
    var total = 0;
    if (paper) { (paper.items || []).forEach(function (it) { total += Number(it.score) || 0; }); }
    var enteredMap = {};
    (e.scores || []).forEach(function (s) {
      enteredMap[s.candidateId] = (enteredMap[s.candidateId] || 0) + (Number(s.score) || 0);
    });
    var entered = Object.keys(enteredMap).length;
    var sum = 0;
    Object.keys(enteredMap).forEach(function (k) { sum += enteredMap[k]; });
    return {
      id: e.id, paperId: e.paperId, name: e.name, examDate: e.examDate || '', remark: e.remark || '',
      status: e.status, createdBy: e.createdBy, createdAt: e.createdAt,
      paperName: paper ? paper.name : '（试卷已删除）', subjectLine: paper ? paper.subjectLine : '',
      candidateCount: candN, totalScore: Math.round(total * 10) / 10,
      enteredCandidates: entered, enteredSum: Math.round(sum * 10) / 10,
      avgScore: entered ? Math.round(sum / entered * 10) / 10 : null
    };
  }

  var Demo = {
    bootstrap: function () {
      var db = demoDb();
      var stats = Demo.statsSync(db);
      var tags = {};
      db.questions.forEach(function (q) {
        String(q.tags || '').replace(/，/g, '、').split('、').forEach(function (t) {
          t = t.trim();
          if (t) { tags[t] = true; }
        });
      });
      var groups = [];
      db.subjects.forEach(function (s) {
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].group === s.group) { groups[i].items.push(s.name); return; }
        }
        groups.push({ group: s.group, items: [s.name] });
      });
      return Promise.resolve({
        profile: window.ZJ_Auth ? window.ZJ_Auth.get() : null,
        subjects: groups,
        stats: stats,
        tags: Object.keys(tags).sort()
      });
    },

    questions: function (filters) {
      return Promise.resolve(demoFilterQuestions(filters || {}, false).map(function (q) {
        var d = demoQuestionDict(q);
        d.usedCount = demoUsedCount(demoDb(), q.id);
        return d;
      }));
    },
    createQuestion: function (fields) {
      var db = demoDb();
      if (!fields.subject) { return Promise.reject(new Error('请选择科目')); }
      if (!String(fields.stem || '').trim()) { return Promise.reject(new Error('题干不能为空')); }
      var known = db.subjects.some(function (s) { return s.name === fields.subject; });
      if (!known) { db.subjects.push({ name: fields.subject, group: '自定义' }); }
      var q = {
        id: db.nextQid++, subject: fields.subject, qtype: fields.qtype || '简答题',
        difficulty: Number(fields.difficulty) || 3, tags: fields.tags || '',
        passage: fields.passage || '', stem: String(fields.stem || '').trim(),
        options: fields.options || [], answer: fields.answer || '',
        explanation: fields.explanation || '', score: Number(fields.score) || 0,
        duration: Number(fields.duration) || 0, source: fields.source || '演示录入',
        status: fields.status || '启用', starred: 0, deletedAt: null, imagePath: fields.imagePath || '',
        createdBy: 'teacher', createdAt: now(), updatedAt: now()
      };
      db.questions.push(q);
      demoSave(db);
      return Promise.resolve(demoQuestionDict(q));
    },
    updateQuestion: function (id, fields) {
      var db = demoDb();
      var q = null;
      db.questions.forEach(function (x) { if (x.id === Number(id)) { q = x; } });
      if (!q) { return Promise.reject(new Error('试题不存在')); }
      Object.keys(fields).forEach(function (k) {
        if (fields[k] !== undefined) {
          if (k === 'imagePath') { q.imagePath = fields[k]; } else { q[k] = fields[k]; }
        }
      });
      q.updatedAt = now();
      demoSave(db);
      return Promise.resolve(demoQuestionDict(q));
    },
    deleteQuestion: function (id) {
      var db = demoDb();
      var removed = 0;
      db.questions.forEach(function (q) {
        if (q.id === Number(id)) { q.deletedAt = now(); }
      });
      db.papers.forEach(function (p) {
        var before = (p.items || []).length;
        p.items = (p.items || []).filter(function (it) { return it.questionId !== Number(id); });
        removed += before - p.items.length;
      });
      demoSave(db);
      return Promise.resolve({ ok: true, removedFromPapers: removed });
    },
    batchQuestions: function (ids, action) {
      var db = demoDb();
      ids = ids.map(Number);
      var nowTs = now();
      db.questions.forEach(function (q) {
        if (ids.indexOf(q.id) < 0 || q.deletedAt) { return; }
        if (action === 'enable') { q.status = '启用'; q.updatedAt = nowTs; }
        if (action === 'disable') { q.status = '停用'; q.updatedAt = nowTs; }
        if (action === 'star') { q.starred = 1; q.updatedAt = nowTs; }
        if (action === 'unstar') { q.starred = 0; q.updatedAt = nowTs; }
        if (action === 'delete') { q.deletedAt = nowTs; q.updatedAt = nowTs; }
      });
      if (action === 'delete') {
        db.papers.forEach(function (p) {
          p.items = (p.items || []).filter(function (it) { return ids.indexOf(it.questionId) < 0; });
        });
      }
      demoSave(db);
      return Promise.resolve({ ok: true, affected: ids.length });
    },
    trashList: function () {
      return Promise.resolve(demoFilterQuestions({}, true).filter(function (q) { return q.deletedAt; }));
    },
    restoreQuestion: function (id) {
      var db = demoDb();
      db.questions.forEach(function (q) { if (q.id === Number(id)) { q.deletedAt = null; } });
      demoSave(db);
      return Promise.resolve({ ok: true });
    },
    purgeQuestion: function (id) {
      var db = demoDb();
      db.questions = db.questions.filter(function (q) { return q.id !== Number(id); });
      demoSave(db);
      return Promise.resolve({ ok: true });
    },
    emptyTrash: function () {
      var db = demoDb();
      var n = db.questions.filter(function (q) { return q.deletedAt; }).length;
      db.questions = db.questions.filter(function (q) { return !q.deletedAt; });
      demoSave(db);
      return Promise.resolve({ ok: true, purged: n });
    },
    checkDup: function (stem, excludeId) {
      var db = demoDb();
      var target = normStem(stem);
      var dups = [];
      if (target) {
        for (var i = db.questions.length - 1; i >= 0 && dups.length < 5; i--) {
          var q = db.questions[i];
          if (q.deletedAt || q.id === Number(excludeId)) { continue; }
          if (normStem(q.stem) === target) {
            dups.push({ id: q.id, subject: q.subject, qtype: q.qtype, stem: q.stem.slice(0, 60) });
          }
        }
      }
      return Promise.resolve(dups);
    },
    uploadImage: function () {
      return Promise.reject(new Error('演示模式（无后端）不支持上传配图，请启动 backend/app.py'));
    },

    generate: function (params) { return demoGenerate(params); },

    papers: function () {
      var db = demoDb();
      return Promise.resolve(db.papers.slice().sort(function (a, b) {
        return String(b.updatedAt).localeCompare(String(a.updatedAt));
      }).map(demoPaperMeta));
    },
    paper: function (id) {
      var db = demoDb();
      for (var i = 0; i < db.papers.length; i++) {
        if (db.papers[i].id === Number(id)) { return Promise.resolve(demoPaperFull(db.papers[i])); }
      }
      return Promise.reject(new Error('试卷不存在'));
    },
    savePaper: function (fields) {
      var db = demoDb();
      if (!String(fields.name || '').trim()) { return Promise.reject(new Error('请填写试卷名称')); }
      if (!fields.items || !fields.items.length) { return Promise.reject(new Error('试卷至少需要一道试题')); }
      var p;
      if (fields.id) {
        for (var i = 0; i < db.papers.length; i++) { if (db.papers[i].id === Number(fields.id)) { p = db.papers[i]; } }
        if (!p) { return Promise.reject(new Error('试卷不存在')); }
      } else {
        p = {
          id: db.nextPid++, createdBy: 'teacher', createdAt: now(),
          items: [], name: '', subjectLine: '', remark: '', duration: 0, status: '草稿', variant: ''
        };
        db.papers.push(p);
      }
      p.name = String(fields.name).trim();
      p.subjectLine = fields.subjectLine || '';
      p.remark = fields.remark || '';
      p.duration = Number(fields.duration) || 0;
      p.status = fields.status === '定稿' ? '定稿' : '草稿';
      p.variant = fields.variant || '';
      p.updatedAt = now();
      p.items = fields.items.map(function (it, pos) {
        return { itemId: p.id + '-' + pos, position: pos, questionId: Number(it.questionId),
                 score: Number(it.score) || 0, section: it.section || '' };
      });
      demoSave(db);
      return Promise.resolve(demoPaperFull(p));
    },
    duplicatePaper: function (id) {
      var db = demoDb();
      var src = null;
      db.papers.forEach(function (p) { if (p.id === Number(id)) { src = p; } });
      if (!src) { return Promise.reject(new Error('试卷不存在')); }
      var copy = JSON.parse(JSON.stringify(src));
      copy.id = db.nextPid++;
      copy.name = src.name + '（副本）';
      copy.status = '草稿';
      copy.createdBy = 'teacher';
      copy.createdAt = now();
      copy.updatedAt = now();
      copy.items.forEach(function (it, pos) { it.itemId = copy.id + '-' + pos; it.position = pos; });
      db.papers.push(copy);
      demoSave(db);
      return Promise.resolve(demoPaperFull(copy));
    },
    setPaperStatus: function (id, status) {
      var db = demoDb();
      for (var i = 0; i < db.papers.length; i++) {
        if (db.papers[i].id === Number(id)) {
          db.papers[i].status = status === '定稿' ? '定稿' : '草稿';
          db.papers[i].updatedAt = now();
          demoSave(db);
          return Promise.resolve(demoPaperFull(db.papers[i]));
        }
      }
      return Promise.reject(new Error('试卷不存在'));
    },
    deletePaper: function (id) {
      var db = demoDb();
      db.papers = db.papers.filter(function (p) { return p.id !== Number(id); });
      demoSave(db);
      return Promise.resolve({ ok: true });
    },

    /* ---- 考试 ---- */
    exams: function () {
      var db = demoDb();
      return Promise.resolve(db.exams.slice().reverse().map(function (e) { return demoExamMeta(db, e); }));
    },
    exam: function (id) {
      var db = demoDb();
      var exam = null;
      db.exams.forEach(function (e) { if (e.id === Number(id)) { exam = e; } });
      if (!exam) { return Promise.reject(new Error('考试不存在')); }
      var paper = null;
      db.papers.forEach(function (p) { if (p.id === exam.paperId) { paper = p; } });
      var items = paper ? (paper.items || []).map(function (it, idx) {
        var q = null;
        db.questions.forEach(function (x) { if (x.id === it.questionId) { q = x; } });
        return {
          questionId: it.questionId, position: idx, fullScore: Number(it.score) || 0,
          section: it.section || (q ? q.qtype : ''), qtype: q ? q.qtype : '',
          stem: String(q ? q.stem : '').slice(0, 50), difficulty: q ? q.difficulty : 3, tags: q ? (q.tags || '') : ''
        };
      }) : [];
      var scoreMap = {};
      (exam.scores || []).forEach(function (s) {
        scoreMap[s.candidateId + ':' + s.questionId] = Number(s.score) || 0;
      });
      var out = {
        id: exam.id, paperId: exam.paperId, name: exam.name, examDate: exam.examDate || '',
        remark: exam.remark || '', status: exam.status, createdBy: exam.createdBy,
        paperName: paper ? paper.name : '（试卷已删除）', subjectLine: paper ? paper.subjectLine : '',
        items: items,
        candidates: (exam.candidates || []).map(function (c) {
          var enteredCount = 0, total = 0;
          items.forEach(function (it) {
            var v = scoreMap[c.id + ':' + it.questionId];
            if (v !== undefined) { enteredCount += 1; total += v; }
          });
          return { id: c.id, name: c.name, className: c.className || '',
                   enteredCount: enteredCount, questionCount: items.length, totalScore: Math.round(total * 10) / 10 };
        }),
        scores: (exam.scores || []).map(function (s) {
          return { candidateId: s.candidateId, questionId: s.questionId, score: Number(s.score) || 0 };
        })
      };
      return Promise.resolve(out);
    },
    createExam: function (fields) {
      var db = demoDb();
      if (!String(fields.name || '').trim()) { return Promise.reject(new Error('请填写考试名称')); }
      var paper = null;
      db.papers.forEach(function (p) { if (p.id === Number(fields.paperId)) { paper = p; } });
      if (!paper) { return Promise.reject(new Error('请选择关联试卷')); }
      if (!fields.candidates || !fields.candidates.length) { return Promise.reject(new Error('请至少选择或录入一名考生')); }
      var e = {
        id: db.nextExamId++, paperId: Number(fields.paperId), name: String(fields.name).trim(),
        examDate: fields.examDate || '', remark: fields.remark || '', status: '进行中',
        createdBy: 'teacher', createdAt: now(),
        candidates: fields.candidates.filter(function (c) { return String(c.name || '').trim(); })
          .map(function (c) { return { name: String(c.name).trim(), className: String(c.className || '').trim() }; }),
        scores: []
      };
      e.candidates.forEach(function (c, i) { c.id = e.id * 100 + i; });
      db.exams.push(e);
      demoSave(db);
      return Promise.resolve(demoExamMeta(db, e));
    },
    updateExam: function (id, fields) {
      var db = demoDb();
      var e = null;
      db.exams.forEach(function (x) { if (x.id === Number(id)) { e = x; } });
      if (!e) { return Promise.reject(new Error('考试不存在')); }
      if (fields.name) { e.name = String(fields.name).trim(); }
      if (fields.examDate !== undefined) { e.examDate = fields.examDate; }
      if (fields.remark !== undefined) { e.remark = fields.remark; }
      if (fields.status === '已完结' || fields.status === '进行中') { e.status = fields.status; }
      demoSave(db);
      return Promise.resolve(demoExamMeta(db, e));
    },
    deleteExam: function (id) {
      var db = demoDb();
      db.exams = db.exams.filter(function (e) { return e.id !== Number(id); });
      demoSave(db);
      return Promise.resolve({ ok: true });
    },
    saveExamScores: function (examId, candidateId, scores) {
      var db = demoDb();
      var exam = null;
      db.exams.forEach(function (e) { if (e.id === Number(examId)) { exam = e; } });
      if (!exam) { return Promise.reject(new Error('考试不存在')); }
      var paper = null;
      db.papers.forEach(function (p) { if (p.id === exam.paperId) { paper = p; } });
      var full = {};
      if (paper) { (paper.items || []).forEach(function (it) { full[it.questionId] = Number(it.score) || 0; }); }
      exam.scores = exam.scores || [];
      var saved = 0;
      Object.keys(scores).forEach(function (qidRaw) {
        var qid = Number(qidRaw);
        if (!(qid in full)) { return; }
        var val = scores[qidRaw];
        for (var i = exam.scores.length - 1; i >= 0; i--) {
          if (exam.scores[i].candidateId === candidateId && exam.scores[i].questionId === qid) { exam.scores.splice(i, 1); }
        }
        if (val === null || val === '') { return; }
        var v = Math.max(0, Math.min(Number(val) || 0, full[qid]));
        exam.scores.push({ candidateId: candidateId, questionId: qid, score: Math.round(v * 10) / 10 });
        saved += 1;
      });
      demoSave(db);
      var enteredCount = 0, total = 0;
      exam.scores.forEach(function (s) {
        if (s.candidateId === candidateId) { enteredCount += 1; total += s.score; }
      });
      return Promise.resolve({ saved: saved, enteredCount: enteredCount, totalScore: Math.round(total * 10) / 10 });
    },
    examReport: function (id) {
      var db = demoDb();
      try {
        return Promise.resolve(demoExamReport(db, Number(id)));
      } catch (e) {
        return Promise.reject(e);
      }
    },

    /* ---- 名单 ---- */
    roster: function () {
      var db = demoDb();
      return Promise.resolve(db.roster.map(function (s, i) {
        return { id: s.id || i + 1, name: s.name, class_name: s.className || s.class_name || '' };
      }));
    },
    rosterAdd: function (students) {
      var db = demoDb();
      var added = 0, skipped = 0;
      students.forEach(function (s) {
        var name = String(s.name || '').trim();
        if (!name) { skipped += 1; return; }
        var cn = String(s.className || '').trim();
        var dup = db.roster.some(function (x) { return x.name === name && (x.className || x.class_name) === cn; });
        if (dup) { skipped += 1; return; }
        db.roster.push({ id: db.roster.length + 1, name: name, className: cn });
        added += 1;
      });
      demoSave(db);
      return Promise.resolve({ added: added, skipped: skipped });
    },
    rosterRemove: function (id) {
      var db = demoDb();
      db.roster = db.roster.filter(function (s) { return (s.id || 0) !== Number(id); });
      demoSave(db);
      return Promise.resolve({ ok: true });
    },

    /* ---- 蓝图 ---- */
    blueprints: function () {
      var db = demoDb();
      return Promise.resolve(db.blueprints.map(function (b, i) {
        return { id: b.id || i + 1, name: b.name, config: b.config, createdAt: b.createdAt || '' };
      }));
    },
    saveBlueprint: function (name, config) {
      var db = demoDb();
      if (!String(name || '').trim()) { return Promise.reject(new Error('请填写蓝图名称')); }
      db.blueprints.push({ id: db.blueprints.length + 1, name: String(name).trim(), config: config, createdAt: now() });
      demoSave(db);
      return Promise.resolve({ ok: true });
    },
    deleteBlueprint: function (id) {
      var db = demoDb();
      db.blueprints = db.blueprints.filter(function (b) { return (b.id || 0) !== Number(id); });
      demoSave(db);
      return Promise.resolve({ ok: true });
    },

    /* ---- 知识点树（演示模式存本地库） ---- */
    knowledge: function () {
      var db = demoDb();
      return Promise.resolve(Demo.knowledgeTree(db));
    },
    knowledgeTree: function (db) {
      var tree = {};
      (db.knowledge || []).forEach(function (n) {
        tree[n.subject] = tree[n.subject] || [];
        tree[n.subject].push(n);
      });
      return Object.keys(tree).map(function (subject) {
        var nodes = tree[subject];
        var parents = nodes.filter(function (n) { return !n.parentId; });
        return {
          subject: subject,
          nodes: parents.map(function (p) {
            return {
              id: p.id, name: p.name,
              children: nodes.filter(function (n) { return n.parentId === p.id; })
                .map(function (c) { return { id: c.id, name: c.name }; })
            };
          })
        };
      });
    },
    knowledgeAdd: function (subject, name, parentId) {
      var db = demoDb();
      if (!subject || !String(name || '').trim()) { return Promise.reject(new Error('科目与知识点名称不能为空')); }
      db.knowledge = db.knowledge || [];
      if (parentId) {
        var p = db.knowledge.find(function (n) { return n.id === parentId; });
        if (!p || p.parentId) { return Promise.reject(new Error('父节点不存在（仅支持两级）')); }
      }
      var dup = db.knowledge.some(function (n) {
        return n.subject === subject && n.name === name && (n.parentId || 0) === (parentId || 0);
      });
      if (dup) { return Promise.reject(new Error('该知识点已存在')); }
      db.knowledge.push({ id: db.knowledge.length + 1, subject: subject, name: String(name).trim(), parentId: parentId || 0 });
      demoSave(db);
      return Promise.resolve(Demo.knowledgeTree(db));
    },
    knowledgeDelete: function (id) {
      var db = demoDb();
      db.knowledge = (db.knowledge || []).filter(function (n) { return n.id !== Number(id) && n.parentId !== Number(id); });
      demoSave(db);
      return Promise.resolve(Demo.knowledgeTree(db));
    },

    /* ---- 在线答题（演示模式同口径判分） ---- */
    onlineVerify: function (examId, code, name) {
      var db = demoDb();
      var exam = null;
      db.exams.forEach(function (e) { if (e.id === Number(examId)) { exam = e; } });
      if (!exam || !exam.onlineCode) { return Promise.reject(new Error('考试不存在或未开启在线作答')); }
      if (String(code).trim().toUpperCase() !== String(exam.onlineCode).toUpperCase()) {
        return Promise.reject(new Error('答题码不正确'));
      }
      if (exam.status !== '进行中') { return Promise.reject(new Error('该考试已结束作答')); }
      var cand = (exam.candidates || []).find(function (c) { return c.name === String(name).trim(); });
      if (!cand) { return Promise.reject(new Error('姓名不在考生名单中，请联系老师')); }
      var paper = db.papers.find(function (p) { return p.id === exam.paperId; });
      var questions = paper ? (paper.items || []).map(function (it) {
        var q = db.questions.find(function (x) { return x.id === it.questionId; }) || {};
        return {
          questionId: it.questionId, qtype: q.qtype || '', passage: q.passage || '', stem: q.stem || '',
          options: q.options || [], fullScore: Number(it.score) || 0,
          audioPath: q.audioPath || '', imagePath: q.imagePath || '', duration: q.duration || 0
        };
      }) : [];
      return Promise.resolve({
        candidateId: cand.id,
        exam: {
          name: exam.name,
          paperName: paper ? paper.name : '', subjectLine: paper ? paper.subjectLine : '',
          duration: paper ? paper.duration : 0
        },
        questions: questions
      });
    },
    onlineSubmit: function (examId, code, candidateId, answers) {
      var db = demoDb();
      var exam = null;
      db.exams.forEach(function (e) { if (e.id === Number(examId)) { exam = e; } });
      if (!exam || !exam.onlineCode || String(code).trim().toUpperCase() !== String(exam.onlineCode).toUpperCase()) {
        return Promise.reject(new Error('答题码不正确或未开启在线作答'));
      }
      if (exam.status !== '进行中') { return Promise.reject(new Error('该考试已结束作答')); }
      var paper = db.papers.find(function (p) { return p.id === exam.paperId; });
      exam.scores = (exam.scores || []).filter(function (s) { return s.candidateId !== candidateId; });
      exam.answers = (exam.answers || []).filter(function (s) { return s.candidateId !== candidateId; });
      var objective = 0, subjective = 0, detail = [];
      (paper ? paper.items : []).forEach(function (it) {
        var q = db.questions.find(function (x) { return x.id === it.questionId; }) || {};
        var full = Number(it.score) || 0;
        var ans = answers[String(it.questionId)];
        if (q.qtype === '单选题' || q.qtype === '判断题') {
          var got = (ans !== undefined && String(ans).trim().toUpperCase() === String(q.answer || '').trim().toUpperCase()) ? full : 0;
          exam.scores.push({ candidateId: candidateId, questionId: it.questionId, score: got });
          objective += got;
          detail.push({ questionId: it.questionId, got: got, full: full });
        } else if (q.qtype === '多选题') {
          var pick = String(ans || '').split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean).sort();
          var truth = String(q.answer || '').split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean).sort();
          var got2 = 0;
          if (pick.length && pick.join(',') === truth.join(',')) { got2 = full; }
          else if (pick.length && pick.every(function (p) { return truth.indexOf(p) >= 0; })) { got2 = Math.round(full / 2 * 10) / 10; }
          exam.scores.push({ candidateId: candidateId, questionId: it.questionId, score: got2 });
          objective += got2;
          detail.push({ questionId: it.questionId, got: got2, full: full });
        } else {
          var text = String(ans === undefined ? '' : ans).trim();
          if (text) {
            exam.answers.push({ candidateId: candidateId, questionId: it.questionId, answerText: text.slice(0, 5000) });
            subjective += 1;
          }
        }
      });
      demoSave(db);
      return Promise.resolve({
        objectiveScore: Math.round(objective * 10) / 10,
        detail: detail, subjectiveCount: subjective,
        message: '交卷成功：客观题已自动判分' + (subjective ? '，主观题待老师批阅' : '')
      });
    },
    uploadAnswerSheet: function () {
      return Promise.reject(new Error('演示模式（无后端）不支持上传答题卡照片，请启动 backend/app.py'));
    },
    exportExamScores: function (examId, examName) {
      return Data.examReport(examId).then(function (r) {
        var lines = [['名次', '姓名', '班级', '总分', '满分', '得分率(%)', '录分进度'].join(',')];
        r.totals.forEach(function (t, i) {
          lines.push([i + 1, t.name, t.className || '', t.total, r.fullTotal,
            r.fullTotal ? Math.round(t.total / r.fullTotal * 1000) / 10 : 0,
            t.entered + '/' + t.questionCount].join(','));
        });
        var csv = '\uFEFF' + lines.join('\r\n');
        window.ZJ.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), (examName || '考试') + '_成绩单_演示.csv');
      });
    },

    statsSync: function (db) {
      db = db || demoDb();
      var byType = {}, byDiff = {}, bySub = {};
      var weekAgo = Date.now() - 7 * 864e5;
      var weekNew = 0;
      var active = db.questions.filter(function (q) { return !q.deletedAt; });
      active.forEach(function (q) {
        byType[q.qtype] = (byType[q.qtype] || 0) + 1;
        byDiff[q.difficulty] = (byDiff[q.difficulty] || 0) + 1;
        bySub[q.subject] = (bySub[q.subject] || 0) + 1;
        if (new Date(String(q.createdAt).replace(' ', 'T')).getTime() >= weekAgo) { weekNew += 1; }
      });
      var bySubject = Object.keys(bySub).map(function (s) { return { subject: s, n: bySub[s] }; })
        .sort(function (a, b) { return b.n - a.n; });
      var usedMap = {};
      db.papers.forEach(function (p) {
        (p.items || []).forEach(function (it) {
          usedMap[it.questionId] = (usedMap[it.questionId] || 0) + 1;
        });
      });
      var topUsed = Object.keys(usedMap).map(function (qid) {
        var q = null;
        db.questions.forEach(function (x) { if (x.id === Number(qid)) { q = x; } });
        return q ? { stem: String(q.stem).slice(0, 36), subject: q.subject, n: usedMap[qid] } : null;
      }).filter(Boolean).sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
      function weekly(field) {
        var buckets = [];
        var today = new Date();
        for (var i = 7; i >= 0; i--) {
          var ws = new Date(today.getTime() - (today.getDay() === 0 ? 6 : today.getDay() - 1) * 864e5 - 7 * i * 864e5);
          var we = new Date(ws.getTime() + 6 * 864e5);
          var n = 0;
          db[field].forEach(function (x) {
            var d = String(x.createdAt).slice(0, 10);
            if (d >= ws.toISOString().slice(0, 10) && d <= we.toISOString().slice(0, 10)) { n += 1; }
          });
          buckets.push({ label: (ws.getMonth() + 1) + '/' + ws.getDate(), n: n });
        }
        return buckets;
      }
      return {
        totalQuestions: active.length,
        enabledQuestions: active.filter(function (q) { return q.status === '启用'; }).length,
        weekNew: weekNew,
        totalPapers: db.papers.length,
        byType: byType, byDifficulty: byDiff, bySubject: bySubject,
        recentPapers: db.papers.slice().sort(function (a, b) {
          return String(b.updatedAt).localeCompare(String(a.updatedAt));
        }).slice(0, 5).map(demoPaperMeta),
        weeklyQuestions: weekly('questions'),
        weeklyPapers: weekly('papers'),
        topUsed: topUsed,
        trashCount: db.questions.filter(function (q) { return q.deletedAt; }).length,
        examCount: db.exams.length
      };
    },
    stats: function () {
      return Promise.resolve(Demo.statsSync());
    },
    auditList: function () {
      return Promise.reject(new Error('演示模式（无后端）不记录审计日志，请启动 backend/app.py'));
    },
    changePassword: function () {
      return Promise.reject(new Error('演示模式（无后端）不支持修改密码，请启动 backend/app.py'));
    },
    /* ---- 真题库 / 收藏 / 生成记录（演示模式，存本地库） ---- */
    examPapers: function (filters) {
      var db = demoDb();
      var list = db.examPapers.filter(function (p) {
        if (filters.paper && filters.paper !== '全部' && p.paperName !== filters.paper) { return false; }
        if (filters.year && String(p.year) !== String(filters.year)) { return false; }
        if (filters.session && filters.session !== '全部' && p.session !== filters.session) { return false; }
        if (filters.status && filters.status !== '全部状态' && p.status !== filters.status) { return false; }
        return true;
      });
      return Promise.resolve(list.map(function (p) {
        var n = 0;
        db.questions.forEach(function (q) { if (q.examPaperId === p.id && !q.deletedAt) { n += 1; } });
        return JSON.parse(JSON.stringify(Object.assign({}, p, { questionCount: n })));
      }));
    },
    createExamPaper: function (fields) {
      var db = demoDb();
      if (['P1', 'P2'].indexOf(fields.paperName) < 0) { return Promise.reject(new Error('paperName 须为 P1 或 P2')); }
      var p = {
        id: db.examPapers.length + 1,
        examBoard: fields.examBoard || 'Edexcel', qualification: fields.qualification || 'IAL',
        subject: fields.subject || 'Mathematics', paperName: fields.paperName,
        paperCode: fields.paperCode || '', year: Number(fields.year) || 0,
        session: fields.session || '', qpUrl: fields.qpUrl || '', msUrl: fields.msUrl || '',
        resourceType: fields.resourceType || 'owned_content', status: fields.status || 'published',
        createdBy: 'teacher', createdAt: now(), updatedAt: now()
      };
      db.examPapers.push(p);
      demoSave(db);
      return Promise.resolve(JSON.parse(JSON.stringify(Object.assign({}, p, { questionCount: 0 }))));
    },
    updateExamPaper: function (id, fields) {
      var db = demoDb();
      var p = db.examPapers.find(function (x) { return x.id === Number(id); });
      if (!p) { return Promise.reject(new Error('真题卷不存在')); }
      ['paperCode', 'qpUrl', 'msUrl', 'resourceType', 'status'].forEach(function (k) {
        if (fields[k] !== undefined) { p[k] = fields[k]; }
      });
      p.updatedAt = now();
      demoSave(db);
      return Promise.resolve(JSON.parse(JSON.stringify(p)));
    },
    deleteExamPaper: function (id) {
      var db = demoDb();
      db.examPapers = db.examPapers.filter(function (p) { return p.id !== Number(id); });
      db.questions.forEach(function (q) { if (q.examPaperId === Number(id)) { q.examPaperId = null; } });
      demoSave(db);
      return Promise.resolve({ ok: true });
    },
    examTopics: function (paper) {
      var db = demoDb();
      var rows = (db.knowledge || []).filter(function (n) { return n.paperScope === paper; });
      var parents = rows.filter(function (n) { return !n.parentId; });
      var topics = parents.map(function (p) {
        var children = rows.filter(function (n) { return n.parentId === p.id; });
        var cnt = function (tid) {
          return db.questions.filter(function (q) { return q.topicId === tid && !q.deletedAt && q.status === '启用'; }).length;
        };
        return { id: p.id, name: p.name, count: cnt(p.id),
                 children: children.map(function (c) { return { id: c.id, name: c.name, count: cnt(c.id) }; }) };
      });
      return Promise.resolve({ paper: paper, topics: topics });
    },
    favorites: function () {
      var db = demoDb();
      var favIds = (db.favorites || []).map(function (f) { return f.questionId; });
      return Promise.resolve(db.questions.filter(function (q) {
        return favIds.indexOf(q.id) >= 0 && !q.deletedAt;
      }).map(function (q) {
        var d = JSON.parse(JSON.stringify(q));
        d.usedCount = demoUsedCount(db, q.id);
        d.favorite = true;
        return d;
      }));
    },
    addFavorite: function (qid) {
      var db = demoDb();
      db.favorites = db.favorites || [];
      if (!db.favorites.some(function (f) { return f.questionId === Number(qid); })) {
        db.favorites.push({ user_id: 'teacher', questionId: Number(qid), created_at: now() });
      }
      demoSave(db);
      return Promise.resolve({ ok: true, favorite: true });
    },
    removeFavorite: function (qid) {
      var db = demoDb();
      db.favorites = (db.favorites || []).filter(function (f) { return f.questionId !== Number(qid); });
      demoSave(db);
      return Promise.resolve({ ok: true, favorite: false });
    },
    recordGenerated: function (userPaperId, kind) {
      var db = demoDb();
      db.generatedFiles = db.generatedFiles || [];
      db.generatedFiles.push({ userPaperId: Number(userPaperId), kind: kind || 'qp', status: 'success', created_at: now() });
      demoSave(db);
      return Promise.resolve({ ok: true });
    },
    generatedFiles: function (userPaperId) {
      var db = demoDb();
      var list = (db.generatedFiles || []).filter(function (f) {
        return !userPaperId || f.userPaperId === Number(userPaperId);
      }).map(function (f) {
        var paper = db.papers.find(function (p) { return p.id === f.userPaperId; });
        return Object.assign({}, f, { paperName: paper ? paper.name : '' });
      });
      return Promise.resolve({ files: list });
    },

    backup: function () {
      var db = demoDb();
      var payload = { meta: { system: 'zujuan-demo', exportedAt: now() }, questions: db.questions,
                      papers: db.papers, subjects: db.subjects, roster: db.roster,
                      blueprints: db.blueprints, exams: db.exams };
      var blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      window.ZJ.downloadBlob(blob, '组卷系统备份_演示模式.json');
      return Promise.resolve();
    },
    restore: function (data) {
      if (!data || !data.questions || !data.papers) {
        return Promise.reject(new Error('备份文件不完整（缺少必要数据表）'));
      }
      var db = demoDb();
      db.questions = data.questions;
      db.papers = data.papers;
      if (data.subjects) { db.subjects = data.subjects; }
      if (data.roster) { db.roster = data.roster; }
      if (data.blueprints) { db.blueprints = data.blueprints; }
      if (data.exams) { db.exams = data.exams; }
      db.nextQid = db.questions.reduce(function (m, q) { return Math.max(m, q.id); }, 0) + 1;
      db.nextPid = db.papers.reduce(function (m, p) { return Math.max(m, p.id); }, 0) + 1;
      db.nextExamId = db.exams.reduce(function (m, e) { return Math.max(m, e.id); }, 0) + 1;
      demoSave(db);
      return Promise.resolve({ ok: true });
    },
    exportQuestions: function () {
      // 演示模式：导出 CSV（Excel 可直接打开）
      return Demo.questions({}).then(function (list) {
        var head = ['科目', '题型', '难度(1-5)', '知识点', '材料与文章', '题干', '选项(每行一个)', '答案', '解析', '建议分值', '建议用时(分钟)', '来源', '状态'];
        var lines = [head.join(',')];
        list.forEach(function (q) {
          var cell = function (v) { return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"'; };
          lines.push([q.subject, q.qtype, q.difficulty, q.tags, q.passage, q.stem, q.options.join('\n'),
                      q.answer, q.explanation, q.score, q.duration, q.source, q.status].map(cell).join(','));
        });
        var csv = '\uFEFF' + lines.join('\r\n');
        window.ZJ.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
          '国际课程题库_演示模式.csv');
      });
    },
    downloadTemplate: function () {
      return Promise.reject(new Error('演示模式（无后端）不支持模板下载，请启动 backend/app.py'));
    },
    importQuestions: function () {
      return Promise.reject(new Error('演示模式（无后端）不支持 Excel 导入，请启动 backend/app.py'));
    }
  };

  /* ---------------- 统一入口 ---------------- */

  window.ZJ_Data = {
    get mode() { return API.mode; },

    detect: function () { return API.detect(); },
    login: function (account, password) {
      return API.mode === 'server' ? API.login(account, password) : demoLogin(account, password);
    },
    logout: function () { API.logout(); },

    bootstrap: function () { return API.mode === 'server' ? API.bootstrap() : Demo.bootstrap(); },
    questions: function (filters) { return API.mode === 'server' ? API.questions(filters) : Demo.questions(filters); },
    createQuestion: function (f) { return API.mode === 'server' ? API.createQuestion(f) : Demo.createQuestion(f); },
    updateQuestion: function (id, f) { return API.mode === 'server' ? API.updateQuestion(id, f) : Demo.updateQuestion(id, f); },
    deleteQuestion: function (id) { return API.mode === 'server' ? API.deleteQuestion(id) : Demo.deleteQuestion(id); },
    batchQuestions: function (ids, action) { return API.mode === 'server' ? API.batchQuestions(ids, action) : Demo.batchQuestions(ids, action); },
    trashList: function () { return API.mode === 'server' ? API.trashList() : Demo.trashList(); },
    restoreQuestion: function (id) { return API.mode === 'server' ? API.restoreQuestion(id) : Demo.restoreQuestion(id); },
    purgeQuestion: function (id) { return API.mode === 'server' ? API.purgeQuestion(id) : Demo.purgeQuestion(id); },
    emptyTrash: function () { return API.mode === 'server' ? API.emptyTrash() : Demo.emptyTrash(); },
    checkDup: function (stem, excludeId) { return API.mode === 'server' ? API.checkDup(stem, excludeId) : Demo.checkDup(stem, excludeId); },
    uploadImage: function (file) { return API.mode === 'server' ? API.uploadFile(file) : Demo.uploadImage(file); },
    knowledge: function () { return API.mode === 'server' ? API.knowledge() : Demo.knowledge(); },
    knowledgeAdd: function (s, n, p) { return API.mode === 'server' ? API.knowledgeAdd(s, n, p) : Demo.knowledgeAdd(s, n, p); },
    knowledgeDelete: function (id) { return API.mode === 'server' ? API.knowledgeDelete(id) : Demo.knowledgeDelete(id); },
    onlineVerify: function (eid, code, name) { return API.mode === 'server' ? API.onlineVerify(eid, code, name) : Demo.onlineVerify(eid, code, name); },
    onlineSubmit: function (eid, code, cid, answers) { return API.mode === 'server' ? API.onlineSubmit(eid, code, cid, answers) : Demo.onlineSubmit(eid, code, cid, answers); },
    uploadAnswerSheet: function (eid, cid, file) { return API.mode === 'server' ? API.uploadAnswerSheet(eid, cid, file) : Demo.uploadAnswerSheet(eid, cid, file); },
    exportExamScores: function (eid, name) { return API.mode === 'server' ? API.exportExamScores(eid, name) : Demo.exportExamScores(eid, name); },
    generate: function (params) { return API.mode === 'server' ? API.generate(params) : Demo.generate(params); },

    papers: function () { return API.mode === 'server' ? API.papers() : Demo.papers(); },
    paper: function (id) { return API.mode === 'server' ? API.paper(id) : Demo.paper(id); },
    savePaper: function (fields) { return API.mode === 'server' ? API.savePaper(fields) : Demo.savePaper(fields); },
    duplicatePaper: function (id) { return API.mode === 'server' ? API.duplicatePaper(id) : Demo.duplicatePaper(id); },
    setPaperStatus: function (id, status) { return API.mode === 'server' ? API.setPaperStatus(id, status) : Demo.setPaperStatus(id, status); },
    deletePaper: function (id) { return API.mode === 'server' ? API.deletePaper(id) : Demo.deletePaper(id); },

    exams: function () { return API.mode === 'server' ? API.exams() : Demo.exams(); },
    exam: function (id) { return API.mode === 'server' ? API.exam(id) : Demo.exam(id); },
    createExam: function (fields) { return API.mode === 'server' ? API.createExam(fields) : Demo.createExam(fields); },
    updateExam: function (id, fields) { return API.mode === 'server' ? API.updateExam(id, fields) : Demo.updateExam(id, fields); },
    deleteExam: function (id) { return API.mode === 'server' ? API.deleteExam(id) : Demo.deleteExam(id); },
    saveExamScores: function (examId, candidateId, scores) {
      return API.mode === 'server' ? API.saveExamScores(examId, candidateId, scores) : Demo.saveExamScores(examId, candidateId, scores);
    },
    examReport: function (id) { return API.mode === 'server' ? API.examReport(id) : Demo.examReport(id); },

    roster: function () { return API.mode === 'server' ? API.roster() : Demo.roster(); },
    rosterAdd: function (students) { return API.mode === 'server' ? API.rosterAdd(students) : Demo.rosterAdd(students); },
    rosterRemove: function (id) { return API.mode === 'server' ? API.rosterRemove(id) : Demo.rosterRemove(id); },

    blueprints: function () { return API.mode === 'server' ? API.blueprints() : Demo.blueprints(); },
    saveBlueprint: function (name, config) { return API.mode === 'server' ? API.saveBlueprint(name, config) : Demo.saveBlueprint(name, config); },
    deleteBlueprint: function (id) { return API.mode === 'server' ? API.deleteBlueprint(id) : Demo.deleteBlueprint(id); },

    stats: function () { return API.mode === 'server' ? API.stats() : Demo.stats(); },
    auditList: function (action) { return API.mode === 'server' ? API.auditList(action) : Demo.auditList(action); },
    changePassword: function (o, n) { return API.mode === 'server' ? API.changePassword(o, n) : Demo.changePassword(o, n); },
    examPapers: function (filters) { return API.mode === 'server' ? API.examPapers(filters) : Demo.examPapers(filters); },
    createExamPaper: function (f) { return API.mode === 'server' ? API.createExamPaper(f) : Demo.createExamPaper(f); },
    updateExamPaper: function (id, f) { return API.mode === 'server' ? API.updateExamPaper(id, f) : Demo.updateExamPaper(id, f); },
    deleteExamPaper: function (id) { return API.mode === 'server' ? API.deleteExamPaper(id) : Demo.deleteExamPaper(id); },
    uploadExamPaperPdf: function (id, kind, file) { return API.mode === 'server' ? API.uploadExamPaperPdf(id, kind, file) : Promise.reject(new Error('请启动正式后端后上传原始 PDF')); },
    previewExamPaperPdf: function (id, kind) { return API.mode === 'server' ? API.previewExamPaperPdf(id, kind) : Promise.reject(new Error('静态演示模式无法预览私有 PDF')); },
    examTopics: function (paper) { return API.mode === 'server' ? API.examTopics(paper) : Demo.examTopics(paper); },
    favorites: function () { return API.mode === 'server' ? API.favorites() : Demo.favorites(); },
    addFavorite: function (qid) { return API.mode === 'server' ? API.addFavorite(qid) : Demo.addFavorite(qid); },
    removeFavorite: function (qid) { return API.mode === 'server' ? API.removeFavorite(qid) : Demo.removeFavorite(qid); },
    recordGenerated: function (upid, kind) { return API.mode === 'server' ? API.recordGenerated(upid, kind) : Demo.recordGenerated(upid, kind); },
    generatedFiles: function (upid) { return API.mode === 'server' ? API.generatedFiles(upid) : Demo.generatedFiles(upid); },
    backup: function () { return API.mode === 'server' ? API.backup() : Demo.backup(); },
    restore: function (data) { return API.mode === 'server' ? API.restore(data) : Demo.restore(data); },
    exportQuestions: function () { return API.mode === 'server' ? API.exportQuestions() : Demo.exportQuestions(); },
    downloadTemplate: function () { return API.mode === 'server' ? API.downloadTemplate() : Demo.downloadTemplate(); },
    importQuestions: function (file) { return API.mode === 'server' ? API.importQuestions(file) : Demo.importQuestions(file); }
  };

  /** 模式探测完成即视为公共层就绪 */
  window.ZJ_READY = API.detect();
})();
