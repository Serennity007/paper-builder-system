"""Empty banks remain empty across restarts, with accounts and source metadata retained."""
import sqlite3
import unittest

from backend import test_source_papers as source_tests


class EmptyBankTests(unittest.TestCase):
    def test_initialization_and_restart_do_not_restore_samples(self):
        fixture = source_tests.SourcePaperTests()
        fixture.setUp()
        try:
            fixture.module.init_db()
            conn = sqlite3.connect(fixture.module.DB_PATH)
            counts = {table: conn.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
                      for table in ('questions', 'users', 'exam_papers', 'knowledge_nodes')}
            self.assertEqual(counts['questions'], 0)
            self.assertGreater(counts['users'], 0)
            fixture.module.init_db()
            for table, count in counts.items():
                self.assertEqual(conn.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0], count)
            conn.close()
            response = fixture.client.get('/api/questions', headers=fixture.auth)
            self.assertEqual(response.json['questions'], [])
            generated = fixture.client.post('/api/papers/generate', headers=fixture.auth,
                                            json={'types': [{'qtype': '简答题', 'count': 1, 'score': 5}]})
            self.assertEqual(generated.status_code, 200)
            self.assertEqual(generated.json['questions'], [])
            self.assertTrue(generated.json['shortage'])
        finally:
            fixture.tearDown()
