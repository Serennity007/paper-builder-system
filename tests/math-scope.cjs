// Data-layer regression test. No browser or DOM interaction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const storage = new Map();
const context = vm.createContext({
  window: {}, console, setTimeout, clearTimeout,
  sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  fetch: () => Promise.reject(new Error('static demo test'))
});
for (const file of ['js/common.js', 'js/mock-data.js', 'js/api.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
}
(async () => {
  await context.window.ZJ_READY;
  const { ZJ, ZJ_Data: data, ZJ_MOCK: original } = context.window;
  assert.equal(original.questions.length, 0);
  assert.equal((await data.questions({})).length, 0);
  const legacy = JSON.parse(JSON.stringify(original));
  delete legacy.questionBankReset;
  legacy.nextQid = 3;
  const fixtureQuestion = (id, subject) => ({ id, subject, qtype: '单选题', difficulty: 3,
    tags: '', passage: '', stem: 'Disposable fixture', options: ['1', '2'], answer: 'A',
    source: 'Test only', score: 1, duration: 1, status: '启用', deletedAt: null, createdAt: '2026-10-01' });
  legacy.questions = [fixtureQuestion(1, 'A-Level 数学'), fixtureQuestion(2, '雅思阅读')];
  legacy.papers[0].items = [{ questionId: 1, score: 1, position: 0 }];
  legacy.exams[0].scores = [{ candidateId: 100, questionId: 1, score: 1 }];
  storage.set('zhxx_zj_demo_v1', JSON.stringify(legacy));
  assert.equal((await data.questions({})).length, 0);
  let stored = JSON.parse(storage.get('zhxx_zj_demo_v1'));
  assert(stored.questions.every(q => q.deletedAt));
  assert.equal(stored.papers[0].items.length, 1);
  assert.equal(stored.exams[0].scores.length, 1);
  await data.createQuestion({ subject: 'A-Level 数学', stem: 'New disposable fixture', answer: 'A', options: ['1', '2'] });
  assert.equal((await data.questions({})).length, 1); // Reset is one-time; later questions survive.
  const testDb = JSON.parse(JSON.stringify(original));
  testDb.questions = [fixtureQuestion(1, 'A-Level 数学'), fixtureQuestion(2, '雅思阅读')];
  testDb.papers[0].items = [{ questionId: 1, score: 1, position: 0 }];
  storage.set('zhxx_zj_demo_v1', JSON.stringify(testDb));
  const mathQuestions = testDb.questions.filter(q => ZJ.isMathSubject(q.subject));
  const boot = await data.bootstrap();
  const questions = await data.questions({});
  assert.equal(questions.length, mathQuestions.length);
  assert.equal(boot.stats.totalQuestions, mathQuestions.length);
  assert(questions.every(q => ZJ.isMathSubject(q.subject)));
  assert((await data.knowledge()).every(g => ZJ.isMathSubject(g.subject)));
  const generated = await data.generate({ types: [{ qtype: '单选题', count: 100, score: 1 }] });
  assert(generated.questions.every(q => ZJ.isMathSubject(q.subject)));
  const papers = await data.papers();
  assert.equal(papers.length, boot.stats.totalPapers);
  const exams = await data.exams();
  assert.equal(exams.length, boot.stats.examCount);
  stored = JSON.parse(storage.get('zhxx_zj_demo_v1'));
  assert.equal(stored.questions.length, testDb.questions.length);
  assert(stored.questions.length > questions.length);
  console.log('Empty bank, recoverable legacy reset, new-question retention and math-only views: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
