# -*- coding: utf-8 -*-
"""生产 WSGI 入口：gunicorn wsgi:app（Render / Docker 使用）

首次启动自动建库（backend/zujuan.db，含 87 题种子数据）；重启沿用已有数据。
本地开发仍推荐 python backend/app.py（端口 8687）。
"""
import os

from app import app, init_db

init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT") or 8687), threaded=True)
