# 国际课程题库与智能组卷平台 · 项目交接文档

> 交接日期：2026-09-30　|　原负责人：Serennity007　|　接收方：JennyBrian231（协作者，write 权限）
> 项目仓库：https://github.com/Serennity007/paper-builder-system（公开 · 完整源码）
> 在线演示：https://serennity007.github.io/paper-builder-demo/（公开仓 paper-builder-demo · 纯静态演示模式）
> 本地目录：`C:\Users\ztl\Desktop\学生进度追踪系统-交付集合\06-组卷系统\`
> **当前进度**：PRD v1.0 的 **P0 + P1 全部完成**（Sprint 0–6），MVP 完成定义三要素齐备——管理员能独立录题、用户能按知识点找到真题、能组卷并生成 Question Paper + Mark Scheme。P2（错题本/学习数据/AI 标签/小程序/更多考试局）未开始。

---

## 1. 项目一句话

面向国际课程（MVP：Pearson Edexcel IAL Mathematics P1/P2）的**题库 + 组卷 + 在线答题 + 成绩分析**系统。
技术栈 Flask + SQLite + 原生 JS（无框架无构建），双运行模式（服务端持久化 / 纯静态演示），视觉规范藏蓝+香槟金。

## 2. 交付物清单与状态

| 交付物 | 内容 | 状态 |
|---|---|---|
| 组卷工作台 | 双栏工作区（试题池+试卷实体）、大题分区/改名/拖拽排序、换题候选、A/B 卷、蓝图复用、按配置生成（快速+精确）、组卷篮迁移 | ✅ 已上线 |
| 题库管理 | 7 题型 × 难度 1–5、知识点大纲（两级树）、音频/配图/公式、共享/私有、批量操作、回收站、相似度查重、Excel 导入导出 | ✅ 已上线 |
| 真题库 | exam_papers 元数据（考试局/年份/考季/卷号/QP/MS PDF/资源类型/三态）、按卷知识树（P1/P2 章节）、题目挂接题号/子题号/知识点 | ✅ 已上线 |
| 知识点刷题 | P1/P2 → Topic（含题量）→ 题目列表（年份/考季/难度筛选+分页+关键词搜索）→ 详情（MS 展开）→ 收藏 | ✅ 已上线 |
| 在线答题 | 免登录答题码进入、客观题自动判分（多选漏选半分）、主观题批阅、听力音频、答题卡照片 | ✅ 已上线 |
| 考试与成绩 | 花名册、考试创建、按题录分（✓/✗ 速判）、统计报告（分布/排名/薄弱知识点/讲评建议）、成绩单 Excel | ✅ 已上线 |
| 打印导出 | 学生卷/教师卷/答题卡三版本、密封线、KaTeX 公式、Word 导出、PDF 打印 | ✅ 已上线 |
| 数据安全 | 审计日志、一键备份/恢复（JSON）、软删除回收站 | ✅ 已上线 |
| 文档 | PRD（16 章规划）、HANDBOOK（开发手册）、USER-GUIDE（操作手册）、本交接文档 | ✅ 已推送 |
| 种子数据 | 87 道题（含 34 道市面风格仿真题）、4 套 IAL 真题卷、3 套试卷、6 人名单、1 蓝图、1 场已录分考试 | ✅ 已灌入 |

## 3. 账号与环境

| 项 | 值 |
|---|---|
| 教师账号 | `teacher`（教学总监，admin 全权限）/ `wangli`（教研组长）· 初始密码均为 `zx123456` |
| 学生在线答题码 | `ZX2026`（种子考试「雅思阅读周测」已开启在线作答，考生：陈思远/郎博文/林晓雅/周子墨/吴悦然/郑好） |
| 本地启动 | `python backend/app.py` → http://localhost:8687 （依赖：`pip install -r backend/requirements.txt`） |
| 演示启动 | `python server.py` → 同端口纯静态（sessionStorage，关页重置） |
| 数据文件 | `backend/zujuan.db`（删即重置，自动从 seed.json 重建） |
| 环境要求 | Python 3.11+；KaTeX 已离线内置 `vendor/katex/` |

## 4. 数据机制

- 服务端模式：REST + SQLite，数据跨浏览器持久；演示模式：sessionStorage 本地库，关页即重置
- **双模式必须同步**：判分/统计/组卷算法在 `backend/app.py`（exam_report 等）与 `js/api.js`（demoExamReport 等）成对实现，改一处必须改另一处
- 演示种子 `js/mock-data.js` 由 `python build_mock.py` 从 `backend/seed.json` 生成，**勿手改 mock-data.js**
- 组卷篮存 sessionStorage（`zhxx_zj_cart_v1`）；密封线开关存 localStorage

## 5. 测试与部署

- **三套回归必须全绿才算可交付**（跑前重置库）：`smoke_v2.py`（35 项）+ `smoke_v3.py`（20 项）+ `audit_zujuan.py`（22 项）
- 推送前必跑：`node --check` 改动的 js + 三套冒烟 + 浏览器过主流程（布局 bug 只有截图能暴露）
- **Pages 更新流程**：改静态文件 → 复制 index/admin/answer/print.html 与 css/js/vendor/assets 进 `github-pages-repo/` → commit → push main → Pages 1–2 分钟自动发布（CDN 缓存约 10 分钟，验证需强刷）
- 源码仓与演示仓相互独立（源码仓 .gitignore 排除了演示仓目录）

## 6. 遗留待办（P2，按 PRD 第 13 章）

| 待办 | 说明 | 建议优先级 |
|---|---|---|
| 错题本与做题记录 | 在线答题的 exam_answers 数据可扩展 | P2 首选 |
| 学习数据/正确率 | 按学生/知识点维度统计（报告可扩展） | P2 |
| 微信小程序端 | 前后端分离架构已满足，REST 直接复用 | P2 |
| 拖拽排序增强 / 搜索完善 | P1 尾项微调 | 随手 |
| AI/OCR 录题 | CMS-Q-07 接口已预留 | 远期 |
| 更多 Paper / 考试局 | P3/P4/FP1/S1/M1；CAIE/AP/IGCSE | 远期（现有 87 题练习库迁入"练习题库"板块） |

## 7. 已知限制与注意事项

- 上传文件（图片/音频/PDF）存 `backend/uploads/`，**备份 JSON 不含它们**——迁移环境请一并拷贝该目录
- 后端为 Flask 开发服务器，单机演示级；上生产需换 gunicorn/waitress + HTTPS
- 演示模式（Pages）不含上传/Excel 导入/审计——页面会如实提示，属预期行为
- 判分/统计双模式逻辑成对，改一处漏另一处会导致演示与服务端结果不一致
- HTML 引用的 js/css 版本号 `?v=20260929a`——**改 js/css 必须升版本号**，否则浏览器缓存旧文件
- GitHub 偶发 TLS 中断：push 失败重试即可（历史验证 1–4 次内恢复）

## 8. 文档索引

| 文档 | 面向 | 内容 |
|---|---|---|
| docs/HANDBOOK.md | 开发协作者 | 12 章：代码结构、双模式架构、66 个 API 全表、数据模型、前端约定 7 条、测试、部署、协作规范、踩坑 8 条 |
| docs/PRD.md | 产品规划 | 16 章：定位/角色/MVP 边界/信息架构/功能需求/数据模型/API/业务规则/迭代计划/验收标准 |
| docs/USER-GUIDE.md | 教师/学生/管理员 | 9 章：登录、题库录题、真题库、组卷、考试与成绩、打印、学生答题、备份、FAQ |
| README.md | 快速了解 | 功能总览、快速启动、演示动线、部署说明 |

## 9. 交接清单（接收方确认项）

- [ ] 克隆仓库并本地跑通 `python backend/app.py`（8687 可访问）
- [ ] 用 teacher 账号过一遍五大页签（总览/题库/组卷台/真题库/刷题）
- [ ] 跑三套冒烟测试确认全绿（先删 `backend/zujuan.db` 重置）
- [ ] 阅读 HANDBOOK 第 4 节（双模式）与第 8 节（前端约定 7 条）
- [ ] 接受两个仓库的协作邀请（write 权限）
- [ ] 确认 P2 待办分工与排期
