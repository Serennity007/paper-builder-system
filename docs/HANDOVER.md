# 国际课程题库与智能组卷平台 · 项目交接文档（详细版）

> 交接日期：2026-09-30（覆盖至仓库提交 c4533ea）
> 原负责人：Serennity007　|　接收方：JennyBrian231（协作者，write 权限，已于 2026-09-29 接受 demo 仓邀请）
> 源码仓库：https://github.com/Serennity007/paper-builder-system（公开 · 完整源码 + 全部文档）
> 在线演示：https://serennity007.github.io/paper-builder-demo/（公开仓 paper-builder-demo · 纯静态演示模式）
> 部署套件：本仓库已含 Render / Docker 部署配置（见 §8，协作者贡献）

---

## 1. 项目背景与建设历程

本项目为成都智慧象留学（国际课程教培）内部教研工具，面向 IELTS / TOEFL / A-Level / AP 国际课程场景。MVP 聚焦 **Pearson Edexcel IAL Mathematics P1 / P2**，验证「真题结构化 → 知识点找题 → 选题组卷 → QP/MS 下载」闭环（需求见 `docs/PRD.md`）。

建设历程（按仓库提交顺序）：

| 阶段 | 内容 | 提交 |
|---|---|---|
| 初版交付 | 组卷核心 + 题库 + 组卷工作区 + 在线答题 + 统计报告 + 全部文档（87 题种子） | `0d8ac48` |
| 规划 | 按 PRD 模板完成 16 章需求文档与差距分析 | `715cb79` |
| Sprint 1–4、6 | 真题结构化（exam_papers/知识树按卷/收藏/分页/PDF 记录） | `4b3a91f` |
| 视觉 v1 | 去 AI 味美工（圆角/字距/密度/扁平悬浮/表情清理） | `f6eb8e3` |
| 操作手册 | 使用者操作手册（教师/学生分篇 + FAQ） | `09e291f` |
| 交接 | 交接文档初版 | `8b7a99f` |
| **协作者接手后** | **邮箱验证码登录 + SMTP 通道 + Render/HF 部署套件 + 纸阅视觉 v2** | `40beee5` |
| **协作者接手后** | **LXGW 文楷排印层 + 登录页去模板化 + 印章式状态章 + 动效层 micro.js** | `c4533ea`（最新） |

> 注意：`c4533ea` 起前端版本号序列为 `v=20261001x`，样式基准已从「藏蓝+香槟金」演进出**文楷排印与印章元素**（`vendor/lxgw/`），视觉规范以当前 `css/style.css` 为准。

## 2. 系统概述与产品形态

- **用户**：教师（组卷/考试/成绩）、学生（刷题/在线答题/收藏）、管理员（录题/发布/管理）
- **形态**：第一阶段 Web（用户端与管理端同站分角色）；第二阶段微信小程序（REST 架构已预留）
- **技术栈**：Flask + SQLite（后端，单文件 `backend/app.py`）+ 原生 JS（前端，无框架无构建）
- **双运行模式**：服务端模式（REST + SQLite 持久化）与纯静态演示模式（sessionStorage，关页重置）——前端零感知，页面只调 `ZJ_Data.*`

## 3. 系统架构

### 3.1 后端（backend/app.py，约 2900 行，63 个路由）

| 模块 | 代表路由 | 说明 |
|---|---|---|
| 认证 | /api/auth/login、/api/auth/email-code、/api/auth/email-login | 账号密码登录 + **邮箱验证码登录**（开发模式回显验证码，SMTP 走环境变量） |
| 题库 | /api/questions…（含 trash/restore/purge/batch/check-dup） | 增删改查、回收站、批量、相似度查重 |
| 附件 | /api/upload | 图片 5MB / 音频 20MB / PDF 20MB |
| 组卷 | /api/papers/generate | 分层抽样（难度三带）+ 排除 + 缺口提示 + distNote |
| 试卷 | /api/papers… | CRUD / 复制 / 定稿 / A-B 卷 |
| 真题库 | /api/exam-papers…、/api/exam-topics | Paper 元数据（年份/考季/卷号/QP/MS）+ 按卷知识树 |
| 刷题 | /api/questions（分页+真题维度筛选）、/api/favorites… | 20 条/页、收藏 |
| 考试成绩 | /api/exams…、/api/online/verify·submit、/api/exams/{id}/report·export.xlsx | 答题码、自动判分（多选漏选半分）、统计、成绩单 |
| 记录 | /api/generated-files、/api/audit | PDF 生成状态机、审计日志 |
| 数据 | /api/backup · /api/restore | 全库 JSON 备份/恢复 |
| 部署 | wsgi.py + Dockerfile + render.yaml | 生产 WSGI 入口（gunicorn）与 Render/HF 一键部署 |

### 3.2 前端（js/，无构建）

| 文件 | 职责 |
|---|---|
| api.js | 数据访问层：服务端 REST 与演示 sessionStorage **双实现**，页面零感知（**新增接口必须三处同步：API / Demo / ZJ_Data**） |
| admin.js | 工作台主控：页签切换、题库/批量/回收站、审计、备份恢复 |
| builder.js | 组卷台双栏工作区：试题池、试卷实体、大题分区、拖拽排序、换题候选、蓝图 |
| archive.js | 真题库、知识点刷题、收藏、下载记录 |
| exams.js | 考试创建、按题录分（✓/✗ 速判）、统计报告 |
| print.js | 学生卷/教师卷/答题卡三版本、密封线、Word 导出 |
| micro.js | 动效与微交互层（进场编排/数字滚动/涟漪；尊重 prefers-reduced-motion）——协作者新增 |
| common.js / mock-data.js | 公共工具与演示种子（mock 由 build_mock.py 生成） |

### 3.3 视觉体系

`css/style.css` 设计令牌集中在 `:root`。当前为**文楷排印版**：LXGW 文楷屏显字体（`vendor/lxgw/`）+ 登录页手绘金线 + 印章式状态章（协作者 `c4533ea`）。页面版本号 `?v=20261001d`。

## 4. 数据模型与存储

核心表：`users / sessions / questions / papers（组卷卷）+ paper_items / exam_papers（真题元数据）/ knowledge_nodes（两级树，paper_scope）/ exams + exam_candidates + exam_scores + exam_answers / favorites / generated_files / subjects / roster / blueprints / audit_log / classes`

- 字段明细见 `docs/PRD.md` 第 9 章；迁移用 `ensure_schema()` 内 PRAGMA 检测 + ALTER TABLE（老库平滑升级）
- 种子只灌空库（`seed_if_empty` 以 questions 数量判断）；改 `seed.json` 后删 `zujuan.db` 重启即重建
- 演示种子 `js/mock-data.js` 由 `python build_mock.py` 生成，**勿手改**

## 5. 环境与账号凭据

| 项 | 值 |
|---|---|
| 教师账号 | `teacher`（教学总监，admin）/ `wangli`（教研组长）· 初始密码均为 `zx123456` |
| 学生在线答题码 | `ZX2026`（种子考试「雅思阅读周测」已开启在线作答；考生：陈思远/郎博文/林晓雅/周子墨/吴悦然/郑好） |
| 邮箱登录 | 开发模式验证码直接回显在响应中（便于联调）；生产配置 SMTP 环境变量后走真实发信 |
| 本地启动 | `python backend/app.py` → http://localhost:8687 |
| 演示启动 | `python server.py`（纯静态，无依赖） |
| 数据文件 | `backend/zujuan.db`（删即重置） |
| 环境要求 | Python 3.11+；`pip install -r backend/requirements.txt`（flask、openpyxl、gunicorn[部署]） |

## 6. 运维手册

### 6.1 启动 / 停止 / 重置

```bash
python backend/app.py     # 启动（Ctrl+C 停止）
# 重置数据：停止后删除 backend/zujuan.db，再启动（自动从 seed.json 重建）
```

### 6.2 备份 / 恢复

- 备份：登录 →「审计」页签 → 数据管理 → 导出备份（全库 JSON）
- 恢复：同页「从备份恢复」上传 JSON（账号与会话不受影响）
- ⚠️ 备份 JSON **不含** `backend/uploads/` 内的上传文件——迁移环境请一并拷贝

### 6.3 三种部署方式

| 方式 | 入口 | 说明 |
|---|---|---|
| 本地 | `python backend/app.py` | 开发与日常使用（8687 端口） |
| Render（免费） | render.yaml + DEPLOY.md 指南 | 同一服务托管页面+API，公网可访问；免费档 SQLite 随重启重置、15 分钟休眠 |
| Docker | `Dockerfile` + `backend/wsgi.py` | gunicorn 生产入口 |

### 6.4 演示站（GitHub Pages）

- https://serennity007.github.io/paper-builder-demo/ ← 仓库 paper-builder-demo（纯静态演示模式）
- 更新流程：改静态文件 → 复制 index/admin/answer/print.html 与 css/js/vendor/assets 进 `github-pages-repo/` → commit → push → 1–2 分钟自动发布（CDN 缓存约 10 分钟，验证需强刷）

## 7. 测试体系与验收

| 测试 | 覆盖 | 跑法 |
|---|---|---|
| smoke_v2.py（35 项） | 题库/批量/回收站/查重/上传/蓝图/名单/考试/备份 | 重置库后 `python smoke_v2.py` |
| smoke_v3.py（20 项） | 在线答题全流程/知识树/共享权限/成绩单 | 同上 |
| audit_zujuan.py（22 项） | 组卷专项（生成算法/存卷/蓝图/平行卷/Excel） | 同上 |
| smoke_email.py | 邮箱验证码登录（协作者新增） | 需后端运行；60s 发码限频自动等待 |

**规矩**：推送前必须重置库跑三套（当前基准 35+20+22 全绿）+ `node --check` 改动的 js + 浏览器过主流程；判分/统计逻辑改一处必须同步另一处（服务端 `exam_report` ⇆ 演示 `demoExamReport`）。

## 8. 已知限制与注意事项

1. 备份 JSON 不含 `backend/uploads/` 上传文件，迁移需一并拷贝
2. 后端为 Flask 开发服务器，生产需 gunicorn（wsgi.py 已备）+ HTTPS
3. Render 免费档 SQLite 随重启重置、15 分钟休眠（DEPLOY.md 有说明）
4. 演示模式不含上传/Excel 导入/审计——页面如实提示，属预期
5. HTML 引用的静态资源版本号（当前 `v=20261001d`）**改 js/css 必须升级**，否则浏览器缓存旧文件
6. GitHub 偶发 TLS 中断：push 失败等待重试（历史 1–4 次内恢复）
7. 删除题目 = 软删除进回收站；`paper_items` 级联移除并在审计注明
8. 录分/在线交卷均为「整份覆盖」语义（未填 = 清除原值）

## 9. P2 待办路线（尚未开始）

| 待办 | 说明 | 建议 |
|---|---|---|
| 错题本与做题记录 | exam_answers 数据可扩展 | P2 首选 |
| 学习数据/正确率 | 按学生/知识点维度统计 | P2 |
| 微信小程序端 | REST 直接复用，前后端分离已满足 | P2 |
| 拖拽排序增强、搜索完善 | P1 尾项微调 | 随手 |
| AI/OCR 录题 | CMS-Q-07 接口已预留 | 远期 |
| 更多 Paper / 考试局 | P3/P4/FP1/S1/M1；CAIE/AP/IGCSE | 远期（87 题练习库可迁入"练习题库"板块） |

## 10. 文档索引

| 文档 | 面向 | 内容 |
|---|---|---|
| docs/HANDBOOK.md | 开发协作者 | 12 章：代码结构、双模式架构、API 清单（注意：协作者新增邮箱登录两接口后总数 63 个）、数据模型、前端约定 7 条、测试、部署、协作规范、踩坑 8 条 |
| docs/PRD.md | 产品规划 | 16 章：定位/角色/MVP 边界/信息架构/功能需求/数据模型/API/业务规则/迭代计划/验收标准 |
| docs/USER-GUIDE.md | 教师/学生/管理员 | 9 章：登录、题库、真题库、组卷、考试与成绩、打印、学生答题、备份、FAQ |
| docs/HANDOVER.md | 交接 | 本文档 |
| DEPLOY.md | 部署 | Render 免费部署指南（协作者编写） |

## 11. 交接确认清单（接收方逐项签收）

- [ ] 克隆仓库：`git clone https://github.com/Serennity007/paper-builder-system.git`
- [ ] `pip install -r backend/requirements.txt` 后 `python backend/app.py`，8687 可访问
- [ ] teacher 账号过一遍八大页签（组卷台/真题库/刷题/题库/试卷库/总览/考试/审计）
- [ ] 删除 `backend/zujuan.db` 重置后，三套冒烟全绿（35+20+22）
- [ ] 阅读 HANDBOOK 第 4 节（双模式）、第 8 节（前端约定 7 条）、第 12 节（踩坑）
- [ ] 学生侧验证：`answer.html` 用答题码 `ZX2026` + 考生姓名在线作答并交卷
- [ ] 阅读 DEPLOY.md，确认 P2 待办分工与排期
