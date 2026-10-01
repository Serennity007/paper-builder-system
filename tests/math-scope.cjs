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
  const mathQuestions = original.questions.filter(q => ZJ.isMathSubject(q.subject));
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
  const stored = JSON.parse(storage.get('zhxx_zj_demo_v1'));
  assert.equal(stored.questions.length, original.questions.length);
  assert(stored.questions.length > questions.length);
  console.log('Math-only demo views, generation, statistics and history preservation: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
