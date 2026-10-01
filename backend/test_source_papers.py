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


class StructuredSourceQuestionTests(unittest.TestCase):
    """Real PDF parsing/preview, private drafts, and legacy bypass protections."""

    def setUp(self):
        import pymupdf
        self.temp = tempfile.TemporaryDirectory()
        spec = importlib.util.spec_from_file_location("paper_source_app", os.path.join(os.path.dirname(__file__), "app.py"))
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.module.DB_PATH = os.path.join(self.temp.name, "test.db")
        self.module.PRIVATE_PDF_DIR = os.path.join(self.temp.name, "private")
        self.module.ensure_schema()
        with sqlite3.connect(self.module.DB_PATH) as conn:
            conn.execute("INSERT INTO sessions(token,account,role,name,created_at) VALUES('owner','owner','teacher','Owner','now')")
            conn.execute("INSERT INTO sessions(token,account,role,name,created_at) VALUES('other','other','teacher','Other','now')")
            conn.execute("INSERT INTO sessions(token,account,role,name,created_at) VALUES('student','student','student','Student','now')")
        self.client = self.module.app.test_client()
        self.auth = {"Authorization": "Bearer owner"}
        self.other = {"Authorization": "Bearer other"}
        self.student = {"Authorization": "Bearer student"}
        document = pymupdf.open()
        for label in ("Q1 start", "Q1 continued", "Q2"):
            page = document.new_page()
            page.insert_text((60, 80), label)
        self.pdf = document.tobytes()
        document.close()
        response = self.client.post("/api/exam-papers", headers=self.auth,
                                    json={"paperName": "P1", "year": 2026, "session": "Summer"})
        self.pid = response.json["examPaper"]["id"]
        for kind in ("qp", "ms"):
            response = self.client.post(f"/api/exam-papers/{self.pid}/files/{kind}", headers=self.auth,
                                        data={"file": (io.BytesIO(self.pdf), kind + ".pdf")})
            self.assertEqual(response.status_code, 200)

    def tearDown(self):
        self.temp.cleanup()

    def payload(self):
        return {"originalQuestionNumber": "1", "selectionAcknowledged": True,
                "qpRegions": [{"pageIndex": 0, "box": [.05, .05, .95, .35]},
                              {"pageIndex": 1, "box": [0, 0, 1, 1]}],
                "msRegions": [{"pageIndex": 0, "box": [0, 0, 1, .5]},
                              {"pageIndex": 1, "box": [0, .1, 1, .7]}]}

    def test_ordered_multipage_draft_and_private_preview(self):
        pid = self.pid
        page = f"/api/exam-papers/{pid}/pages/qp/0.png"
        self.assertEqual(self.client.get(page).status_code, 401)
        self.assertEqual(self.client.get(page, headers=self.student).status_code, 403)
        self.assertEqual(self.client.get(page, headers=self.auth).mimetype, "image/png")
        self.assertEqual(self.client.get(f"/api/exam-papers/{pid}/pages/qp", headers=self.auth).json["pageCount"], 3)
        created = self.client.post(f"/api/exam-papers/{pid}/source-questions", headers=self.auth, json=self.payload())
        self.assertEqual(created.status_code, 200, created.json)
        question = created.json["question"]
        qid = question["id"]
        self.assertEqual([(r["kind"], r["pageIndex"], r["sortOrder"]) for r in question["regions"]],
                         [("qp", 0, 0), ("qp", 1, 1), ("ms", 0, 0), ("ms", 1, 1)])
        self.assertEqual(self.client.get(f"/api/source-questions/{qid}", headers=self.other).status_code, 403)
        self.assertEqual(self.client.get(f"/api/exam-papers/{pid}/source-questions", headers=self.other).json["questions"], [])
        self.assertEqual(self.client.get(f"/api/source-questions/{qid}", headers=self.auth).json["question"], question)
        region_url = f"/api/source-questions/{qid}/regions/{question['regions'][0]['id']}.png"
        self.assertEqual(self.client.get(region_url).status_code, 401)
        self.assertEqual(self.client.get(region_url, headers=self.other).status_code, 403)
        image = self.client.get(region_url, headers=self.auth)
        self.assertTrue(image.data.startswith(b"\x89PNG"))
        self.assertEqual(image.headers["Cache-Control"], "private, no-store")
        with sqlite3.connect(self.module.DB_PATH) as conn:
            self.assertEqual(conn.execute("SELECT status,is_public,content_mode,score,duration FROM questions WHERE id=?", (qid,)).fetchone(),
                             ("停用", 0, "pdf_regions", 0.0, 0))
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM question_regions WHERE question_id=?", (qid,)).fetchone()[0], 4)
        self.assertEqual(self.client.get("/api/questions", headers=self.student).json["questions"], [])
        self.assertEqual(self.client.put(f"/api/questions/{qid}", headers=self.auth, json={"status": "启用"}).status_code, 409)
        self.assertEqual(self.client.post("/api/questions/batch", headers=self.auth,
                                          json={"ids": [qid], "action": "enable"}).status_code, 409)
        self.assertEqual(self.client.post("/api/papers", headers=self.auth,
                                          json={"name": "draft leak", "items": [{"questionId": qid}]}).status_code, 409)
        self.assertEqual(self.client.delete(f"/api/exam-papers/{pid}", headers=self.auth).status_code, 409)
        self.assertEqual(self.client.post("/api/restore", headers=self.auth,
                                          json={"data": {"questions": [], "papers": [], "paper_items": []}}).status_code, 409)
        self.assertEqual(self.client.post(f"/api/exam-papers/{pid}/source-questions", headers=self.auth,
                                          json=self.payload()).status_code, 409)

    def test_invalid_regions_and_missing_ms(self):
        pid = self.pid
        invalid = self.payload()
        invalid["qpRegions"][0]["pageIndex"] = 99
        self.assertEqual(self.client.post(f"/api/exam-papers/{pid}/source-questions", headers=self.auth,
                                          json=invalid).status_code, 400)
        invalid = self.payload()
        invalid["msRegions"][0]["box"] = [0, 0, 2, 1]
        self.assertEqual(self.client.post(f"/api/exam-papers/{pid}/source-questions", headers=self.auth,
                                          json=invalid).status_code, 400)
        invalid = self.payload()
        invalid["originalQuestionNumber"] = "1(a)"
        self.assertEqual(self.client.post(f"/api/exam-papers/{pid}/source-questions", headers=self.auth,
                                          json=invalid).status_code, 400)
        with sqlite3.connect(self.module.DB_PATH) as conn:
            conn.execute("UPDATE exam_papers SET ms_file='' WHERE id=?", (pid,))
        missing = self.payload()
        missing["msRegions"] = []
        result = self.client.post(f"/api/exam-papers/{pid}/source-questions", headers=self.auth, json=missing)
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(len(result.json["question"]["regions"]), 2)
        with sqlite3.connect(self.module.DB_PATH) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM questions WHERE deleted_at IS NULL").fetchone()[0], 1)
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")


if __name__ == "__main__":
    unittest.main()
