# 国际课程题库与智能组卷平台 · 产品需求文档（PRD）

> v1.0 · MVP 范围：Pearson Edexcel IAL Mathematics P1 / P2
> 项目核心闭环：真题结构化 → 知识点找题 → 单题查看/答案 → 选题组卷 → Question Paper / Mark Scheme PDF 下载

| 文档类型 | 产品需求 / 开发交付说明 |
|---|---|
| 第一阶段产品形态 | Web 应用（用户端 + 管理端）→ 第二阶段微信小程序 |
| 目标用户 | 国际课程数学学生 / 教师 / 平台管理员 |
| 第一阶段课程范围 | Pearson Edexcel IAL Mathematics P1、P2 |
| 版本日期 | 2026-09-29 |
| 现有基础 | paper-builder-system 仓库（组卷闭环已上线：双栏组卷工作区、智能组卷、87 题种子库、在线答题、统计报告、打印/Word 导出） |

---

## 0. 现状映射（先读：哪些已建成，哪些要新建）

本 PRD 沿用合作方提供的模板结构。与已上线的组卷系统对照，**组卷侧大部分 P0 已完成**，差距集中在"真题结构化"一侧。

| 模板要求 | 现状 | 结论 |
|---|---|---|
| 手动组卷篮 / 排序 / 删除 / 防重复（PAPER-01~06） | ✅ 已建成（双栏工作区、区内调序、usedCount 预警） | 直接复用 |
| 自动组卷（分层抽样、难度分布、缺口提示、excludeIds） | ✅ 已建成 | 直接复用 |
| 题库管理 / 批量操作 / 回收站 / 查重 | ✅ 已建成 | 直接复用 |
| Topic / Subtopic 知识树 | ⚠️ 已有基础两级树（按科目），需按 Paper 维度重构 | **需改造** |
| 真题元数据（年份/考季/卷号/QP/MS 文件） | ❌ 无 | **需新建** |
| 题目/答案图片（question_image / answer_image） | ⚠️ 现为文本+公式渲染；图片字段已有（imagePath），需加 answer_image | **需扩展** |
| Mark Scheme 1:1 关联与查看 | ❌ 现为文本答案字段，需改为独立 MS 资源 | **需改造** |
| QP / MS PDF 生成与下载 | ⚠️ 已有打印/Word 导出；需按 7.3/7.4 规则升级为可下载 PDF | **需升级** |
| 用户收藏 / 我的试卷 | ⚠️ 组卷已有（本地登录态）；收藏缺失 | **需新建** |
| 微信小程序端 | ❌ 无（第二阶段） | 架构预留 |
| 管理员独立 CMS | ⚠️ 同站角色区分（admin/teacher），需独立后台入口 | **需改造** |

---

## 1. 项目概述

本项目在现有「国际课程组卷系统」（paper-builder-system）基础上，按本 PRD 演进为一款面向 A-Level / IGCSE / AP 国际课程数学学习者的**真题刷题与智能组卷工具**。第一阶段仅聚焦 Pearson Edexcel IAL Mathematics 的 P1、P2，以最小范围验证"结构化真题数据库 + 精准找题 + 组卷下载"的完整产品闭环。

| 项目项 | 定义 |
|---|---|
| 产品形态 | 第一阶段 Web（用户端 + 管理端）；第二阶段微信小程序（用户端） |
| MVP 课程 | Pearson Edexcel IAL Mathematics |
| MVP Paper | P1、P2 |
| 核心资源 | Question Paper、Mark Scheme、单题切片、Topic/Subtopic 标签 |
| 核心操作 | 找题、查看题目、查看答案、收藏、加入组卷、排序、生成 PDF、下载 |
| 核心后台能力 | 试卷录入、单题管理、标签管理、答案关联、发布/下架 |

第一阶段不是建设"完整国际教育平台"，而是先把 P1/P2 真题结构化，并复用已建成的组卷引擎（双栏工作区、智能分层组卷）支持精准找题与组卷下载。

## 2. 产品定位与目标

### 2.1 产品定位

区别于单纯提供整套 PDF 下载的资源网站，本产品将历年真题拆分为可检索单题，并按 Paper、年份、考季、Topic、Subtopic、难度等维度进行结构化管理。

用户核心路径：
找题 → 做题/查看题目 → 查看 Mark Scheme → 收藏/加入组卷 → 调整顺序 → 生成 Question Paper + Mark Scheme → 下载 PDF

### 2.2 项目目标

| 目标 | 目标说明 | MVP 可验证结果 | 现状 |
|---|---|---|---|
| O1：结构化题库 | 将 P1/P2 原始 QP/MS 转化为可检索单题数据库 | 每题可追溯到 Paper、年份、考季、题号、分值、Topic/Subtopic、答案 | ❌ 本期核心工作 |
| O2：知识点刷题 | 用户可按课程结构定位题目 | 可从 P1/P2 → Topic → Subtopic 进入题目列表，并按年份/难度/考季筛选 | ⚠️ 树已建，需按 Paper 重构 |
| O3：组卷闭环 | 用户可自定义选题并生成可下载试卷 | 题目可加入组卷篮、排序、删除，并生成 QP/MS PDF | ✅ 组卷已建成；PDF 本期升级 |

## 3. 用户角色与核心场景

| 角色 | 主要任务 | 典型场景 |
|---|---|---|
| 学生 | 按知识点找题、查看答案、收藏、生成练习卷 | "我刚学完 Differentiation，想做 10 道相关历年真题。" |
| 教师 | 快速挑题、自定义测试卷、生成 QP/MS | "我要给学生出一份 P1 Transformation + Quadratics 的 50 分测试卷。" |
| 管理员/教研 | 录入试卷、拆题、打标签、关联答案、发布 | "上传 2024 Jan P1 QP/MS，完成单题结构化并发布。" |

MVP 中学生与教师共用前台账号体系（现有 teacher/wangli 账号体系保留，教师可多一个"加入组卷"能力，学生端后续只读+收藏）；管理员使用独立后台入口（现有 admin 角色扩展）。

## 4. MVP 范围与边界

### 4.1 本期范围（P0）

| 端 | P0 功能范围 |
|---|---|
| 用户端（Web） | 登录；P1/P2 切换；Topic/Subtopic 浏览；题目列表（年份/考季/难度筛选）；单题查看；Mark Scheme 查看；收藏；手动加入组卷；组卷篮；排序；删除；生成 QP/MS PDF；下载；整卷真题查看/下载 |
| 管理后台 | Paper 管理（真题元数据 + QP/MS 上传）；Question 创建/编辑（题目/答案图片）；Topic/Subtopic 管理；题目标签；答案关联；状态发布/下架；批量基础操作 |

### 4.2 本期明确不做

- P3/P4/FP1/S1/M1 等其他 Paper
- CAIE、AQA、AP、IGCSE（现有 87 题仿真题库保留为"练习题库"板块，不删）
- 其他学科
- AI 讲题 / AI 聊天机器人 / 拍照搜题 / 自动批改 / 班级管理 / 家长端 / 社区 / 排行榜 / 直播 / 支付 / 复杂学习规划
- 微信小程序（第二阶段，本期内仅做架构预留：前后端分离已满足）

## 5. 产品信息架构

### 5.1 用户端导航（Web 第一阶段）

题库（真题） | 知识点刷题 | 组卷台 | 我的

### 5.2 核心导航层级

```
题库（真题）
├─ P1/P2 → 年份 → 考季 → QP / MS（在线查看 / 下载）
知识点刷题
├─ P1/P2 → Topic → Subtopic → 题目列表 → 单题详情（含 MS 展开）
组卷台（已建成，保持双栏工作区）
├─ 试题池（可切"真题/练习"来源）→ 组卷 → 编辑 → 生成 PDF
我的
├─ 我的收藏
├─ 我的试卷
└─ 下载记录（P1）
```

### 5.3 现有导航映射

现导航（组卷台/题库/试卷库/总览/考试/审计）保留为"工作台模式"（教师/管理员用），新增"题库模式"页签（学生用）：真题库、知识点刷题、我的。角色默认落页：admin/teacher → 工作台；student → 题库模式。

## 6. 用户端功能需求

### 6.1 首页（题库模式首页）

| ID | 功能 | 需求描述 | 优先级 | 验收标准 |
|---|---|---|---|---|
| FE-HOME-01 | 课程入口 | 显示 Pearson Edexcel IAL Mathematics 课程卡片 | P0 | 点击进入 P1/P2 选择页 |
| FE-HOME-02 | 核心入口 | 显示"真题库 / 知识点刷题 / 智能组卷"三大入口 | P0 | 三入口均可正常导航 |
| FE-HOME-03 | 最近浏览 | 显示最近一次浏览的 Paper/Topic（无数据则隐藏） | P1 | 再次进入可继续上次位置 |

### 6.2 Paper 选择

| ID | 功能 | 需求描述 | 优先级 | 验收标准 |
|---|---|---|---|---|
| FE-PAPER-01 | Paper 切换 | 显示 P1、P2 两个入口 | P0 | 点击后进入对应 Topic 页面 |
| FE-PAPER-02 | Paper 信息 | 展示 Pure Mathematics 1 / 2 名称 | P0 | 名称与后台配置一致 |

### 6.3 Topic / Subtopic 浏览

| ID | 功能 | 需求描述 | 优先级 | 验收标准 |
|---|---|---|---|---|
| FE-TOPIC-01 | Topic 列表 | 按 sort_order 展示当前 Paper 的 Topic | P0 | 顺序与后台一致 |
| FE-TOPIC-02 | Subtopic 列表 | 点击 Topic 后显示对应 Subtopic | P0 | 支持"全部"选项 |
| FE-TOPIC-03 | 题量显示 | Topic/Subtopic 可显示题目数量 | P1 | 数量与已发布题目一致 |

### 6.4 题目列表

| ID | 功能 | 需求描述 | 优先级 | 验收标准 |
|---|---|---|---|---|
| FE-Q-01 | 题目卡片 | 显示年份、考季、Paper、题号、Subtopic、marks、难度 | P0 | 字段缺失时不影响页面结构 |
| FE-Q-02 | 筛选 | 支持年份、考季、难度筛选 | P0 | 筛选条件可组合，结果正确 |
| FE-Q-03 | 分页 | 默认 20 题/页或等效无限滚动 | P0 | 连续加载无重复/遗漏 |
| FE-Q-04 | 加入组卷 | 列表卡片直接支持"+加入试卷" | P0 | 加入后提示成功且组卷数量更新 |
| FE-Q-05 | 空状态 | 无符合条件题目时显示明确提示 | P0 | 不出现空白页面 |

### 6.5 单题详情

| ID | 功能 | 需求描述 | 优先级 | 验收标准 |
|---|---|---|---|---|
| FE-DETAIL-01 | 题目展示 | 显示题目图片及来源信息 | P0 | 数学公式清晰、图片完整不裁切（文本题沿用 KaTeX 渲染） |
| FE-DETAIL-02 | 显示答案 | 点击按钮展开/收起 Mark Scheme 图片 | P0 | 展示答案与该题 question_id 一致 |
| FE-DETAIL-03 | 收藏 | 支持收藏/取消收藏 | P0 | 状态持久化到用户账号 |
| FE-DETAIL-04 | 加入组卷 | 支持加入当前试卷 | P0 | 同一试卷默认不重复加入同一题（现有 usedCount/防重复逻辑复用） |

### 6.6 整卷（真题）

| ID | 功能 | 需求描述 | 优先级 | 验收标准 |
|---|---|---|---|---|
| FE-ARCHIVE-01 | 整卷检索 | 按 P1/P2 → 年份 → 考季浏览 Paper | P0 | 正确返回对应 Paper |
| FE-ARCHIVE-02 | QP/MS | 显示 Question Paper 与 Mark Scheme | P0 | 均可在线查看/下载（视资源权限） |

### 6.7 我的

| ID | 功能 | 需求描述 | 优先级 | 验收标准 |
|---|---|---|---|---|
| FE-ME-01 | 我的收藏 | 展示用户收藏题目 | P0 | 可进入题目详情、可取消收藏 |
| FE-ME-02 | 我的试卷 | 展示用户创建的组卷 | P0 | 可继续编辑、生成/下载（现有试卷库复用） |
| FE-ME-03 | 下载记录 | 展示生成文件历史 | P1 | 可重新下载未失效文件 |

## 7. 组卷与 PDF 生成需求

### 7.1 手动组卷（P0）—— 现状：✅ 已建成

| ID | 功能 | 需求描述 | 验收标准 | 现状 |
|---|---|---|---|---|
| PAPER-01 | 自动创建试卷 | 首次"加入试卷"且无草稿时自动创建 Untitled Paper | 题目进入组卷篮 | ✅ addToPaper 自动建区 |
| PAPER-02 | 组卷篮 | 显示已选题目、来源、marks、总题数、总分 | 总分实时更新 | ✅ 实时统计条 |
| PAPER-03 | 排序 | 支持拖拽调整题序 | 刷新后顺序保持 | ⚠️ 现为 ↑↓ 按钮，本期补拖拽 |
| PAPER-04 | 删除 | 从当前试卷删除题目 | 总题数/总分更新 | ✅ |
| PAPER-05 | 修改标题 | 修改试卷标题 | 标题用于 PDF 封面 | ✅ |
| PAPER-06 | 防重复 | 同一试卷同一题默认一次 | 重复添加提示"已在试卷中" | ✅ |

### 7.2 自动组卷（P1，架构已预留）—— 现状：✅ 后端已建成

输入条件：paper, topics[], subtopics[], difficulty, year_from, year_to, question_count 或 target_marks
输出：question_ids[] + total_marks

现有智能组卷引擎已实现分层抽样/难度分布/排除/缺口提示；本期补齐 paper/year/session 维度筛选与 target_marks 模式即可。

### 7.3 Question Paper PDF 规则（本期 P0，由现有打印页升级）

- 封面显示自定义标题、课程名称、Paper、Total Marks；时间字段可后续配置。
- 题目按组卷篮 sort_order 排列。
- 新试卷重新编号为 Question 1, Question 2...；不依赖原始题号。
- 保留每题原始 marks。
- Question Paper 不显示答案。
- 题目图片自动按页面宽度缩放，禁止裁切公式和题干；文本题沿用 KaTeX 渲染。
- 分页尽量避免将同一道题切断；无法避免时保证可读性（现有 break-inside 规则保留）。

### 7.4 Mark Scheme PDF 规则（本期 P0）

- MS 中题目顺序必须与 QP 完全一致。
- 重新编号与 QP 的 Question 1/2/3... 对应。
- 每题显示其对应 answer_image / Mark Scheme 内容。
- 生成失败时不得返回半成品 URL，应返回错误状态并允许重试。

实现方式：第一阶段复用浏览器打印管线（现有 print.html，QP=学生卷 / MS=教师卷答案页另起），新增"下载 PDF"按钮（window.print → 另存 PDF 指引 + generated_files 记录）；第二阶段切服务端生成。

## 8. Web 管理后台需求

### 8.1 后台一级菜单

Dashboard | Papers | Questions | Topics | Users（现有组卷台/题库/考试/审计保留为教师工具区）

### 8.2 Paper 管理

| ID | 功能 | 字段/要求 | 优先级 |
|---|---|---|---|
| CMS-P-01 | 创建/编辑 Paper | Board, Qualification, Subject, Paper, Year, Session, Paper Code, QP URL, MS URL, Status | P0 |
| CMS-P-02 | 上传 QP/MS | 支持 PDF 文件上传并保存资源地址（现有 /api/upload 扩展 PDF 类型） | P0 |
| CMS-P-03 | 状态管理 | draft / published / disabled | P0 |

### 8.3 Question 管理

| ID | 功能 | 需求描述 | 优先级 | 现状 |
|---|---|---|---|---|
| CMS-Q-01 | 创建/编辑题目 | 选择 paper_id，填写题号、子题号、marks、Topic/Subtopic、difficulty | P0 | ⚠️ 字段缺 paper_id/题号/子题号 |
| CMS-Q-02 | 题目图片 | 上传 question_image | P0 | ✅ 已有（imagePath） |
| CMS-Q-03 | 答案图片 | 上传 answer_image 并绑定 | P0 | ❌ 需新增 answer_image 字段 |
| CMS-Q-04 | 排序字段 | 支持 question_order | P0 | ❌ 需新增 |
| CMS-Q-05 | 发布状态 | draft / published / disabled | P0 | ✅（启用/停用 改名即可） |
| CMS-Q-06 | 批量操作 | 批量 Topic/Subtopic、批量发布、批量删除 | P0 | ⚠️ 已有批量启停/收藏/删除，补批量打标 |
| CMS-Q-07 | AI 预处理入口 | 保留未来 OCR/自动标签能力接口 | P2 | 预留 |

### 8.4 Topic / Subtopic 管理

| ID | 功能 | 需求描述 | 优先级 |
|---|---|---|---|
| CMS-T-01 | Topic CRUD | 按 Paper 新增/编辑/排序/停用 Topic | P0 |
| CMS-T-02 | Subtopic CRUD | 在 Topic 下新增/编辑/排序/停用 Subtopic | P0 |
| CMS-T-03 | 顺序控制 | sort_order 控制前台显示顺序 | P0 |

现有知识树管理（两级、按科目）扩展 paper_scope 字段即可。

### 8.5 录题标准流程

创建 Paper → 上传 QP → 上传 MS → 拆题 → 创建 Question → 上传 Question Image → 上传 Answer Image → 选择 Topic/Subtopic → Difficulty → Marks → 保存 → 发布

**关键验收：管理员新增/修改/发布题目后，不需要程序员改代码，前台即可按配置展示。**（现有系统已满足该原则）

## 9. 数据模型

实际数据库沿用现有 SQLite，按下列语义扩展（现有表迁移）。

### 9.1 papers（现有 papers 表扩展真题元数据）

| 字段 | 类型建议 | 说明 | 现状 |
|---|---|---|---|
| id | PK | Paper 主键 | ✅ |
| exam_board | varchar | Edexcel | ❌ 新增 |
| qualification | varchar | IAL | ❌ 新增 |
| subject | varchar | Mathematics | ⚠️ 现为 subject_line 文本 |
| paper_name | varchar | P1 / P2 | ❌ 新增 |
| paper_code | varchar | 如 WMA11/01 | ❌ 新增 |
| year | int | 年份 | ❌ 新增 |
| session | varchar | January / June / October 等 | ❌ 新增 |
| qp_url | text | QP 文件地址 | ❌ 新增 |
| ms_url | text | MS 文件地址 | ❌ 新增 |
| resource_type | enum | official_link / hosted_file / owned_content | ❌ 新增 |
| status | enum | draft / published / disabled | ✅（草稿/定稿） |
| created_at / updated_at | datetime | 时间戳 | ✅ |

### 9.2 questions（现有 questions 表扩展）

| 字段 | 类型建议 | 说明 | 现状 |
|---|---|---|---|
| id | PK | Question 主键 | ✅ |
| paper_id | FK | 关联 papers.id | ❌ 新增 |
| question_number | varchar/int | 原卷大题号 | ❌ 新增 |
| sub_question | varchar nullable | 如 a / b / a-i | ❌ 新增 |
| question_order | int | 原卷/后台排序 | ❌ 新增 |
| marks | int | 分值 | ✅（score） |
| topic_id | FK | Topic | ⚠️ 现为 tags 文本，本期加 FK |
| subtopic_id | FK nullable | Subtopic | ❌ 新增 |
| difficulty | tinyint | 1 Easy / 2 Normal / 3 Hard | ⚠️ 现为 1–5，做映射（1-2→1，3→2，4-5→3） |
| question_image_url | text | 题目图片 | ✅（imagePath） |
| answer_image_url | text | 答案图片 | ❌ 新增 |
| status | enum | draft / published / disabled | ✅ |
| created_at / updated_at | datetime | 时间戳 | ✅ |

### 9.3 topics / subtopics

| 表 | 核心字段 | 现状 |
|---|---|---|
| topics | id, paper_scope(P1/P2), name, sort_order, status | ⚠️ 现有 knowledge_nodes 加 paper_scope + sort_order |
| subtopics | id, topic_id, name, sort_order, status | ✅ 两级结构一致 |

### 9.4 用户相关

| 表 | 核心字段 | 约束/说明 | 现状 |
|---|---|---|---|
| users | id, account, password_hash, role, name | 账号唯一 | ✅ |
| favorites | id, user_id, question_id, created_at | user_id + question_id 唯一 | ❌ 新建 |
| user_papers | id, user_id, title, total_marks, created_at, updated_at | 用户自定义试卷 | ✅（papers，需加 user_id 归属） |
| user_paper_questions | id, user_paper_id, question_id, sort_order | 同一 paper/question 默认唯一 | ✅（paper_items） |
| generated_files | id, user_paper_id, question_pdf_url, mark_scheme_pdf_url, status, created_at | 记录 PDF 生成结果 | ❌ 新建 |

## 10. API 与后端能力要求

沿用现有 REST 风格（Flask），在现有接口上扩展；下表仅列**新增/变更**项。

| 模块 | 接口/能力 | 关键参数 | 现状 |
|---|---|---|---|
| Papers（真题） | GET /papers；GET /papers/:id | paper/year/session/status | ❌ 新增（现有 /api/papers 为组卷卷，路径区分 /api/exam-papers） |
| Topics | GET /papers/:paper/topics | paper=P1/P2 | ❌ 新增（扩展现有 /api/knowledge） |
| Questions | GET /questions; GET /questions/:id | paper/topic/subtopic/year/session/difficulty/page | ⚠️ 现有 /api/questions 加筛选维度 + page |
| Favorites | GET/POST/DELETE /favorites | question_id | ❌ 新增 |
| User Papers | GET/POST/PATCH/DELETE /user-papers | title, user_id | ✅（现有组卷卷加归属） |
| Paper Questions | POST/DELETE /user-papers/:id/questions；PATCH order | question_id, sort_order | ✅ |
| PDF | POST /user-papers/:id/generate | 返回 QP/MS 生成状态与 URL | ❌ 新增（第一阶段由前端打印管线承担） |
| Auto Generator | POST /paper-generator | 筛选条件 + question_count/target_marks | ✅（/api/papers/generate 补维度） |

## 11. 业务规则与异常处理

| 规则 ID | 规则 | 现状 |
|---|---|---|
| BR-01 | 只有 status=published 的 Paper/Question 可在用户端正常检索 | ✅ 同构（启用/停用），加 published 命名 |
| BR-02 | 同一用户试卷中默认不允许重复加入同一 question_id | ✅ 已实现 |
| BR-03 | Mark Scheme 必须与 Question 1:1 关联；无答案的题目不得标记"可生成完整 MS" | ⚠️ 需在数据层强制（answer_image 非空才可生成 MS） |
| BR-04 | 删除/下架题目不能导致历史 user_paper 崩溃 | ✅ 已实现（软删除 + 引用清理提示） |
| BR-05 | 自动组卷资源不足时不允许重复抽题，返回"符合条件题目不足" | ✅ 已实现（shortage） |
| BR-06 | PDF 生成过程需要状态：pending / processing / success / failed | ❌ 新建 generated_files 状态机 |
| BR-07 | 所有异步页面必须处理 Loading / Success / Error / Empty 四种状态 | ⚠️ 部分页面有，统一排查 |
| BR-08 | resource_type 区分官方链接、自有托管文件、自有内容，便于版权控制 | ❌ 新增 |

## 12. 非功能需求

| 类别 | 要求 | 现状 |
|---|---|---|
| 性能 | 题目列表接口 2 秒内返回；20 条/页或无限滚动 | ⚠️ 需加 page 参数与索引 |
| 文件存储 | QP、MS、题目图、答案图、生成 PDF 使用对象存储；推荐 CDN | ⚠️ 第一阶段本地 backend/uploads，架构预留 |
| 图片质量 | 公式清晰；可转 WebP/JPG，不得因压缩影响公式辨认 | ✅ 原图上传 |
| 权限 | 管理员后台独立认证；普通用户不得调用后台写接口 | ✅ require_role 已实现 |
| 安全 | 上传、编辑、删除、发布等管理操作必须管理员权限校验 | ✅ |
| 可维护性 | Topic/Subtopic、Paper 名称、排序、状态必须后台可配置，不写死前端 | ✅ |
| 日志 | 记录 PDF 生成失败、上传失败、关键管理员操作 | ✅ audit_log |
| 版权 | 资源模型支持链接型/托管型/自有内容型；上线资源按授权策略配置 | ❌ resource_type 新增 |

## 13. 开发优先级与迭代计划

### 13.1 功能优先级

| 优先级 | 范围 | 现状 |
|---|---|---|
| P0 | 数据库扩展、CMS、P1/P2 真题库、Topic/Subtopic（按卷）、题目浏览、答案（MS）浏览、收藏、手动组卷、排序、QP/MS PDF 生成与下载 | 组卷侧 ✅；真题侧 ❌ |
| P1 | 自动组卷维度补齐（paper/year/session/target_marks）、关键词搜索、下载记录、拖拽排序 | 自动组卷 ✅；其余 ❌ |
| P2 | 错题本、学习数据/正确率、AI 标签、AI 讲题、微信小程序、更多考试局/科目 | 预留 |

### 13.2 推荐 Sprint（含已完成项）

| Sprint | 开发内容 | 完成标志 | 状态 |
|---|---|---|---|
| Sprint 0（已完成） | 组卷引擎 + 题库 CMS 基础 + 在线答题 + 统计 | 双栏组卷工作区/智能组卷/批量/回收站/知识树/87 题 | ✅ 已上线 |
| Sprint 1 | 数据库扩展 + Paper 真题元数据 | papers/questions 新字段 + 迁移脚本可用 | 本期 |
| Sprint 2 | 文件与录题能力 | QP/MS PDF 上传、answer_image、发布流程 | 本期 |
| Sprint 3 | 知识点刷题页 | P1/P2 → Topic/Subtopic → 列表 → 详情 → MS 跑通 | 本期 |
| Sprint 4 | 用户能力 | favorites、我的收藏、我的试卷归属 | 本期 |
| Sprint 5 | 组卷系统对接 | 真题源接入工作区试题池、防重复、总分 | ✅ 大部分已完成 |
| Sprint 6 | PDF 生成与下载 | QP + MS 按规则生成、generated_files 记录 | 本期 |

## 14. MVP 验收标准

| 验收 Case | 操作路径 | 通过标准 |
|---|---|---|
| AC-01 找题 | 题库模式 → P1 → Differentiation → 题目列表 | 返回该知识点已发布题目；筛选结果正确 |
| AC-02 看答案 | 打开单题 → 显示答案 | 展示的 Mark Scheme 与当前 question_id 正确对应 |
| AC-03 收藏 | 题目详情 → 收藏 → 我的收藏 | 刷新/重新登录后状态仍正确 |
| AC-04 组卷 | 选择多题 → 加入组卷 → 调整顺序 → 删除一题 | 顺序、题数、总分实时正确（现有能力回归） |
| AC-05 QP PDF | 点击生成 Question Paper | 题目顺序、重新编号、marks、图片/公式完整性正确 |
| AC-06 MS PDF | 生成 Mark Scheme | 答案顺序与 QP 完全一致 |
| AC-07 管理端发布 | 新增 Paper/Question → 打标签 → 发布 | 无需改代码即可在前台检索 |
| AC-08 异常态 | 无题/接口失败/PDF 失败 | 有明确 Empty/Error/Retry 状态，不出现白屏 |

**MVP 完成定义：管理员能独立录题；用户能按知识点找到真题；用户能把题目组成试卷并生成 Question Paper + Mark Scheme PDF。三者同时满足才算完成。**

## 15. 第一阶段数据交付要求

第一阶段仅录入 Pearson Edexcel IAL Mathematics P1、P2。建议先完成近 5–8 年数据，待产品链路验证稳定后再逐步补齐近 20 年。

```
Pearson Edexcel IAL Mathematics
├─ P1
│   └─ Paper → Topic → Subtopic → Question → Answer
└─ P2
    └─ Paper → Topic → Subtopic → Question → Answer
```

| 数据项 | 最低要求 |
|---|---|
| Paper 元数据 | year, session, paper_code, QP, MS, status |
| Question | 题号/子题号、marks、question_image、answer_image |
| 标签 | Topic、Subtopic、difficulty |
| 数据质量 | 题目与答案一一匹配；无重复；图片清晰；已发布题目可追溯来源 |

Topic 建议初始集（P1/P2 通用，按 Edexcel 规范）：Quadratics / Inequalities / Simultaneous Equations / Graphs & Transformations / Straight Lines / Circles / Algebraic Expressions / Differentiation / Integration / Trigonometry（P2）/ Exponentials & Logarithms（P2）。

## 16. 后续预留能力

- 自动组卷：按题量/总分、年份、难度、Topic/Subtopic 随机抽题（引擎已具备，补维度）。
- AI/OCR 录题：自动识别题号、marks、切题、Topic/Subtopic、Mark Scheme 匹配，人工审核后发布（CMS-Q-07 接口预留）。
- 错题本与做题记录（现有在线答题 exam_answers 可扩展）。
- 知识点正确率与学习数据（现有统计报告可扩展到学生维度）。
- P3/P4/FP1/S1/M1 等 Paper 扩展。
- CAIE / AP / IGCSE 等考试体系扩展（现有 87 题练习库即多体系，迁入"练习题库"板块）。
- 微信小程序端（第二阶段；前后端分离架构已满足，REST 直接复用）。
- 课程/学习规划/付费服务转化入口。

---

## 附：与本仓库现有代码的关系

- 本 PRD 的 Sprint 5（组卷系统）大部分已在 paper-builder-system 实现：双栏组卷工作区（js/builder.js）、智能分层组卷（backend /api/papers/generate）、试卷管理、在线答题、统计报告。
- Sprint 1–4、6 为本期新增开发，涉及数据库迁移（papers/questions 新列）、新增 favorites / generated_files / exam-papers 路由、题库模式前端页（knowledge.html / archive.html / me.html 或单页内页签）。
- 合作开发约定：改动 js/css 后升级 HTML 内版本号；后端接口变更需同步本 PRD 第 10 节；每日推送 main。
