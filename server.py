# -*- coding: utf-8 -*-
"""演示站点本地服务：在 http.server 基础上禁用缓存，避免改版后浏览器用旧 JS。

纯静态演示模式（无后端、数据存 sessionStorage，关标签页即重置），
汇报现场兜底用；正式使用请运行 python backend/app.py（端口 8687）。
"""
import http.server
import os
import socketserver
from urllib.parse import unquote, urlsplit

PORT = 8687


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def send_head(self):
        path = unquote(urlsplit(self.path).path).lstrip("/") or "index.html"
        parts = path.split("/")
        allowed = (path in {"index.html", "admin.html", "answer.html", "print.html"}
                   or (len(parts) > 1 and parts[0] in {"css", "js", "vendor", "assets"}))
        if not allowed or any(part in ("", ".", "..") for part in parts):
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"serving on http://localhost:{PORT}")
        httpd.serve_forever()
