"""Phase 1A regression checks; use only temporary databases and files."""
import importlib.util
import io
import os
import sqlite3
import tempfile
import unittest


class SourcePaperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        spec = importlib.util.spec_from_file_location("paper_app", os.path.join(os.path.dirname(__file__), "app.py"))
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.module.DB_PATH = os.path.join(self.temp.name, "test.db")
        self.module.PRIVATE_PDF_DIR = os.path.join(self.temp.name, "private")
        self.module.ensure_schema()
        with sqlite3.connect(self.module.DB_PATH) as conn:
            conn.execute("INSERT INTO sessions(token,account,role,name,created_at) VALUES('teacher-token','teacher','teacher','Test','now')")
        conn.close()
        self.client = self.module.app.test_client()
        self.auth = {"Authorization": "Bearer teacher-token"}

    def tearDown(self):
        self.temp.cleanup()

    def test_private_pdf_workflow(self):
        created = self.client.post("/api/exam-papers", headers=self.auth, json={
            "paperName": "P1", "year": 2024, "session": "June", "qpSource": "Pearson QP",
            "msSource": "Pearson MS", "permissionNote": "internal demo",
        })
        self.assertEqual(created.status_code, 200)
        paper = created.json["examPaper"]
        self.assertEqual(paper["resourceStatus"], "missing")
        self.assertEqual(paper["status"], "draft")
        self.assertEqual(paper["displayScope"], "internal")
        pid = paper["id"]
        pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"
        bad = self.client.post(f"/api/exam-papers/{pid}/files/qp", headers=self.auth,
                               data={"file": (io.BytesIO(b"not a pdf"), "bad.pdf")})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.client.post("/api/upload", headers=self.auth,
                                          data={"file": (io.BytesIO(pdf), "old.pdf")}).status_code, 400)
        for kind in ("qp", "ms"):
            response = self.client.post(f"/api/exam-papers/{pid}/files/{kind}", headers=self.auth,
                                        data={"file": (io.BytesIO(pdf), kind + ".pdf")})
            self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["examPaper"]["resourceStatus"], "ready")
        self.assertEqual(self.client.get(f"/api/exam-papers/{pid}/files/qp").status_code, 401)
        preview = self.client.get(f"/api/exam-papers/{pid}/files/qp", headers=self.auth)
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.data, pdf)
        self.assertEqual(preview.mimetype, "application/pdf")
        preview.close()
        with sqlite3.connect(self.module.DB_PATH) as conn:
            conn.execute("INSERT INTO sessions(token,account,role,name,created_at) VALUES('student-token','student','student','Student','now')")
            conn.execute("UPDATE exam_papers SET status='published' WHERE id=?", (pid,))
        conn.close()
        student = {"Authorization": "Bearer student-token"}
        self.assertEqual(self.client.get("/api/exam-papers", headers=student).json["examPapers"], [])
        self.assertEqual(self.client.get(f"/api/exam-papers/{pid}/files/qp", headers=student).status_code, 403)
        self.assertEqual(self.client.get("/backend/zujuan.db").status_code, 404)
        self.assertEqual(self.client.get("/backend/private/exam_papers/1/qp.pdf").status_code, 404)
        self.assertEqual(self.client.get("/css/../backend/seed.json").status_code, 404)
        page = self.client.get("/admin.html")
        self.assertEqual(page.status_code, 200)
        page.close()

    def test_legacy_schema_migrates_without_losing_row(self):
        with sqlite3.connect(self.module.DB_PATH) as conn:
            conn.execute("DROP TABLE exam_papers")
            conn.execute("""CREATE TABLE exam_papers (
                id INTEGER PRIMARY KEY, exam_board TEXT DEFAULT 'Edexcel',
                qualification TEXT DEFAULT 'IAL', subject TEXT DEFAULT 'Mathematics',
                paper_name TEXT NOT NULL, paper_code TEXT DEFAULT '', year INTEGER NOT NULL,
                session TEXT DEFAULT '', qp_url TEXT DEFAULT '', ms_url TEXT DEFAULT '',
                resource_type TEXT DEFAULT 'owned_content', status TEXT DEFAULT 'published',
                created_by TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
            conn.execute("INSERT INTO exam_papers(paper_name,year,created_at,updated_at) VALUES('P2',2025,'now','now')")
        conn.close()
        self.module.ensure_schema()
        with sqlite3.connect(self.module.DB_PATH) as conn:
            self.assertEqual(conn.execute("SELECT paper_name FROM exam_papers").fetchone()[0], "P2")
            columns = {r[1] for r in conn.execute("PRAGMA table_info(exam_papers)")}
            self.assertTrue({"qp_source", "ms_source", "qp_file", "ms_file", "resource_status",
                             "display_scope", "permission_note"}.issubset(columns))
        conn.close()


if __name__ == "__main__":
    unittest.main()
