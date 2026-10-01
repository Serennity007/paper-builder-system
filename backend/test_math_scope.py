"""Math-only views must preserve historical non-math data."""
import sqlite3
import unittest

from backend import test_source_papers as source_tests


class MathScopeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = source_tests.SourcePaperTests()
        self.fixture.setUp()
        self.module = self.fixture.module
        self.client = self.fixture.client
        self.auth = self.fixture.auth
        self.module.seed_if_empty()

    def tearDown(self):
        self.fixture.tearDown()

    def test_lists_stats_and_generation_are_math_only_without_deleting_data(self):
        conn = sqlite3.connect(self.module.DB_PATH)
        original_count = conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        expected = conn.execute("SELECT COUNT(*) FROM questions WHERE " + self.module.math_subject_sql()).fetchone()[0]
        self.assertGreater(original_count, expected)
        boot = self.client.get("/api/bootstrap", headers=self.auth)
        self.assertEqual(boot.status_code, 200)
        self.assertEqual(boot.json["stats"]["totalQuestions"], expected)
        self.assertEqual([s for g in boot.json["subjects"] for s in g["items"]], list(self.module.MATH_SUBJECTS))
        questions = self.client.get("/api/questions?page=1&page_size=5", headers=self.auth).json
        self.assertEqual(questions["total"], expected)
        self.assertTrue(all(q["subject"] in self.module.MATH_SUBJECTS for q in questions["questions"]))
        self.assertEqual(self.client.get("/api/questions?subject=雅思阅读", headers=self.auth).json["questions"], [])
        generated = self.client.post("/api/papers/generate", headers=self.auth,
                                     json={"types": [{"qtype": "单选题", "count": 100, "score": 1}]})
        self.assertEqual(generated.status_code, 200)
        self.assertTrue(all(q["subject"] in self.module.MATH_SUBJECTS for q in generated.json["questions"]))
        papers = self.client.get("/api/papers", headers=self.auth)
        self.assertEqual(papers.status_code, 200)
        self.assertEqual(len(papers.json["papers"]), boot.json["stats"]["totalPapers"])
        exams = self.client.get("/api/exams", headers=self.auth)
        self.assertEqual(exams.status_code, 200)
        self.assertEqual(len(exams.json["exams"]), boot.json["stats"]["examCount"])
        for p in papers.json["papers"]:
            detail = self.client.get(f"/api/papers/{p['id']}", headers=self.auth).json["paper"]
            self.assertTrue(all(it["question"]["subject"] in self.module.MATH_SUBJECTS for it in detail["items"]))
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0], original_count)
        conn.close()


if __name__ == "__main__":
    unittest.main()
