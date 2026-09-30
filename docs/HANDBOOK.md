# 国际课程组卷系统 · 开发协作手册（HANDBOOK）

> v1.0 · 面向本仓库协作者（前后端开发 / 测试 / 教研录题）
> 配套文档：`docs/PRD.md`（产品需求与迭代计划）· `README.md`（功能总览与快速启动）
> 版本日期：2026-09-30

---

## 1. 项目一句话

面向国际课程（IELTS / TOEFL / A-Level / AP，MVP 聚焦 Edexcel IAL Mathematics P1/P2）的**题库 + 组卷 + 在线答题 + 成绩分析**系统。
技术栈：**Flask + SQLite + 原生 JS**（无框架、无构建步骤），双运行模式（服务端持久化 / 纯静态演示）。

## 2. 代码结构导览

```
06-组卷系统/
├─ backend/
│   ├─ app.py            # 后端唯一入口（~2800 行）：全部路由、数据模型、种子、组卷算法
│   ├─ seed.json         # 种子数据（87 题、4 套真题卷、试卷/名单/蓝图/考试/知识树）
│   └─ requirements.txt  # flask + openpyxl
├─ js/
│   ├─ common.js         # 公共工具（esc/toast/弹窗/KaTeX 渲染/音频/图片组件）
│   ├─ api.js            # 数据访问层（服务端 REST + 演示 sessionStorage 双实现，页面零感知）
│   ├─ admin.js          # 工作台主控（页签切换/题库/批量/回收站/审计/备份）
│   ├─ builder.js        # 组卷台双栏工作区（试题池/试卷实体/拖拽/蓝图/生成弹窗）
│   ├─ exams.js          # 考试与成绩（创建/录分/统计报告）
│   ├─ archive.js        # 真题库 + 知识点刷题 + 收藏 + 下载记录
│   ├─ print.js          # 打印页（学生卷/教师卷/答题卡/密封线/Word 导出）
│   └─ mock-data.js      # 演示模式种子（由 build_mock.py 从 seed.json 生成，勿手改）
├─ css/style.css         # 全站样式（设计令牌 :root，藏蓝+香槟金）
├─ index.html            # 登录页（教师登录 + 学生在线答题入口）
├─ admin.html            # 工作台（全部页签与弹窗的壳）
├─ answer.html           # 学生在线答题页（免登录，答题码进入）
├─ print.html            # 试卷打印/导出页
├─ vendor/katex/         # 离线 KaTeX（公式渲染，勿动）
├─ assets/               # 静态资源（示例听力音频等）
├─ build_mock.py         # seed.json → js/mock-data.js 生成器
├─ smoke_v2.py / smoke_v3.py / audit_zujuan.py  # 三套回归测试
└─ docs/PRD.md           # 产品需求文档（16 章）
```

**职责铁律**：后端逻辑只进 `app.py`；页面只调 `ZJ_Data.*`（模式差异在 api.js 内消化）；组件渲染统一走 `common.js` 的 `ZJ.questionCardHtml / questionBodyHtml`。

## 3. 环境搭建

```bash
# 1. 依赖（Python 3.11+）
pip install -r backend/requirements.txt   # flask, openpyxl

# 2. 启动（二选一）
python backend/app.py   # 服务端模式 → http://localhost:8687（SQLite 持久化）
python server.py        # 纯静态演示模式（无依赖，sessionStorage，关页即重置）

# 3. 账号
teacher / zx123456   # 教学总监（admin，全部权限）
wangli  / zx123456   # 教研组长（teacher）
```

- 数据文件 `backend/zujuan.db`，**删除即重置**（自动从 seed.json 重建）
- 改了 `seed.json` 后：删 `zujuan.db` 重启（服务端）+ 跑 `python build_mock.py`（演示模式）——**两边必须同步**

## 4. 双模式约定（最重要的架构规则）

前端**零感知**：所有页面只调 `window.ZJ_Data.*`，api.js 内部按 `/api/ping` 探测结果分发到 `API.*`（服务端）或 `Demo.*`（演示）。

| 能力 | 服务端 | 演示模式 |
|---|---|---|
| 题库/组卷/考试/收藏/真题库/知识树/报告 | REST + SQLite | sessionStorage 本地实现（同口径） |
| 上传（图片/音频/PDF）、Excel 导入导出、审计、备份恢复 | ✅ | ❌ 拒绝并如实提示 |
| 用户可见标识 | 页面顶栏「服务端模式 · 数据持久化」 | 「演示模式 · 关闭即重置」 |

**新增接口的规矩**：服务端方法加进 `api.js` 的 `API` 对象 → 演示实现加进 `Demo` 对象 → 转发加进 `window.ZJ_Data`。三处缺一不可（漏了会出现 `xxx is not a function`，且只在一种模式下暴露）。

## 5. API 接口清单（66 个，按模块）

除 `/api/ping`、`/api/online/*`、`/api/roster` 外均需 `Authorization: Bearer <token>`（登录获得）。

### 认证与首屏
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/ping | 模式探测（演示模式返回 404 → 前端自动切演示） |
| POST | /api/auth/login · /api/auth/logout | 登录/登出 |
| PUT | /api/me/password | 修改密码 |
| GET | /api/bootstrap | 首屏（身份+科目库+统计+知识点标签） |

### 题库
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/questions | 列表；筛选 subject/qtype/difficulty/status/tag/q/starred/mine；**真题维度** exam_paper/year/session/topic_id/subtopic_id/only_exam；**分页** page+page_size（返回 total） |
| POST / PUT / DELETE | /api/questions… | 新增/编辑/软删除（进回收站并从试卷移除） |
| GET | /api/questions/trash + restore/purge/empty-trash | 回收站 |
| POST | /api/questions/batch | 批量 enable/disable/star/unstar/delete |
| POST | /api/questions/check-dup | 相似度查重（≥82% 返回候选） |
| GET/POST | /api/questions/template · export · import | Excel 模板/导出/导入 |

### 真题库（exam_papers，PRD 9.1）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | /api/exam-papers | 真题卷列表（学生仅 published）/新建 |
| PUT/DELETE | /api/exam-papers/{id} | 编辑（QP/MS 地址/状态）/删除（题目脱离关联不删题） |
| GET | /api/exam-topics?paper=P1 | 按卷知识树（含题量，父级含子级） |

### 组卷与试卷
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/papers/generate | 智能组卷：subjects/types[{qtype,count,score}]/dist/excludeIds/tags → 分层抽样 + 缺口 + distNote |
| GET/POST/PUT/DELETE | /api/papers… | 试卷 CRUD（variant=A卷/B卷）+ duplicate + status |

### 知识树 / 名单 / 收藏 / 生成记录
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST/DELETE | /api/knowledge… | 全局知识树（含 paperScope/sort_order） |
| GET/POST/DELETE | /api/roster… | 考生名单（去重） |
| GET/POST/DELETE | /api/favorites… | 收藏（user+question 唯一） |
| GET/POST | /api/generated-files | PDF 生成记录（BR-06 状态机） |

### 考试与成绩
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST/PUT/DELETE | /api/exams… | 考试 CRUD（online=true 生成 6 位答题码） |
| GET | /api/exams/{id} | 详情（题目/考生/成绩/在线作答原文/答题卡照片） |
| PUT | /api/exams/{id}/scores | 按考生整份覆盖录分（超满分截断） |
| GET | /api/exams/{id}/report · export.xlsx | 统计报告 / 成绩单 |
| POST | /api/online/verify · submit | 学生答题（免登录，判分：多选漏选半分） |
| POST | /api/exams/{eid}/candidates/{cid}/sheet | 答题卡照片上传 |

### 其他
上传 /api/upload（图片 5MB/音频 20MB/PDF 20MB）· 统计 /api/stats/overview · 审计 /api/audit · 备份 /api/backup + /api/restore

## 6. 数据模型速查

六张核心表 + 四张扩展表，字段明细见 PRD 第 9 章：

```
users ─┬─ sessions（令牌）
       ├─ favorites（user_id+question_id 唯一）
questions ─┬─ paper_items ── papers（组卷卷，user_papers 语义）
           ├─ exam_scores / exam_answers ── exams ── exam_candidates
           └─ topic_id/subtopic_id ── knowledge_nodes（两级树，paper_scope=P1/P2）
exam_paper_id ── exam_papers（真题元数据，QP/MS URL）
generated_files ── papers（PDF 生成状态机）
```

**迁移规矩**：所有新列用 `ensure_schema()` 里的 `PRAGMA table_info` 检测 + `ALTER TABLE ADD COLUMN`（老库平滑升级）；种子只灌空库（`seed_if_empty` 以 questions 数量判断）。

## 7. 录题标准流程（PRD 8.5）

创建 Paper（真题库→新建真题卷，填年份/考季/卷号，上传 QP/MS PDF）→ 题库→新增试题（选科目、**真题关联**：examPaper/题号/子题号/知识点树节点）→ 上传题目配图（可选）、音频（听力题）→ 答案与解析 → 保存 → 启用。

**关键验收**：管理员发布后前台零代码生效；无答案的题不得生成完整 MS（answer 与 answer_image 至少有一）。

## 8. 前端开发约定

1. **版本号**：改任何 js/css 后必须把引用它的 HTML 里 `?v=20260928k` 升一位（admin/index/print 三处一致）。漏升 = 浏览器缓存旧文件 = 「改了没生效」
2. **事件绑定**：列表/表格用容器级事件委托（`root.addEventListener + closest`）；动态弹窗内容同理。直接绑在子元素上的监听会在重渲染后丢失（踩过三次的坑）
3. **switchTab 页签清单**：admin.js 的 switchTab 里有一个 sections 数组控制显隐——**新增页签必须同步加进这个数组**（漏了 = 导航高亮但内容不显示，隐形 bug）
4. **HTML 转义**：所有动态文案过 `ZJ.esc()`；题目选项渲染走 `ZJ.questionBodyHtml`（自动处理选项前缀/公式/音频/图片）
5. **公式**：文本用 `$...$` 包裹，渲染调 `ZJ.renderMath(el)`（KaTeX 已离线 vendor，勿引 CDN）
6. **新页签三件套**：nav-tab 按钮 + section（id=tab-xxx，默认 hidden）+ js 文件（`window.ZJ_XXX = {init, refresh}`，admin.js 里 switchTab 分支与 init 各接一行）
7. **录分/交卷语义**：整份覆盖（未填=清除）；在线交卷覆盖该生全部成绩

## 9. 测试指南

```bash
python smoke_v2.py      # 35 项：题库/批量/回收站/查重/上传/蓝图/名单/考试/备份（需干净库）
python smoke_v3.py      # 20 项：在线答题全流程/知识树/共享权限/成绩单
python audit_zujuan.py  # 22 项：组卷专项（生成算法/存卷/蓝图/平行卷/Excel）
```

- **必须先重置库再跑**（脚本间有数据耦合）：`taskkill /F /IM python.exe` → 删 `backend/zujuan.db` → 重启 → 跑
- 三套全绿才算可交付；改了判分/统计逻辑需同步 `exam_report`（后端）与 `demoExamReport`（api.js）两处
- 前端改动用浏览器过一遍：登录 → 五页签 → 组卷全流程 → 打印；视觉检查截图（布局 bug 只有截图能暴露）

## 10. 部署（GitHub Pages 演示）

- 演示站：https://serennity007.github.io/paper-builder-demo/（公开仓 paper-builder-demo，纯静态演示模式）
- 更新流程：改静态文件 → 复制 index/admin/answer/print.html 与 css/js/vendor/assets 进 `github-pages-repo/` → commit → push main → Pages 1–2 分钟自动发布（CDN 缓存约 10 分钟，验证时强刷）
- **源码仓**（paper-builder-system）与演示仓相互独立：源码仓的 `.gitignore` 排除了演示仓目录
- 后端/数据库永不上 Pages；正式使用跑本地 `python backend/app.py`

## 11. 协作流程

1. 分支：日常直接推 main（小团队）；大改动开 `feat/xxx` 分支自测后合并
2. Commit：一行中文摘要，动词开头，注明模块（如 `feat(practice): keyword search fallback`）
3. **推送前必跑**：`node --check` 改过的 js + 三套冒烟（重置库）+ 浏览器过一遍主流程
4. PRD 变更：功能与计划有出入时同步改 `docs/PRD.md` 对应章节（第 10 节 API、第 13 节计划优先）
5. 协作者：JennyBrian231（write 权限）；有问题在 Issue 里提，重要决定记进 PRD

## 12. 已踩过的坑（勿重蹈）

| 坑 | 教训 |
|---|---|
| 页签数组漏项 | switchTab 显隐数组漏了页签 → 内容永不显示，且 locator 读 DOM 正常、只有截图能发现——**视觉检查不可省** |
| 删旧模块留引用 | 删弹窗后 js 里残留 `getElementById('旧id')` → init 抛错整个工作台瘫痪且无提示——删 UI 必须同步删 js 引用 |
| heredoc 写中文/反斜杠 | Git Bash heredoc 会吞 `\\` 与截断长脚本：**长脚本一律写成 .py/.js 文件再执行**；反斜杠用 `chr(92)` 构造 |
| JSON 转义 form feed | seed 里 `\frac` 少写一个反斜杠 → `\f` 被解析成换页符，公式渲染报错——数学内容写完必须 grep `\x0c` |
| 种子漏新列 | seed_if_empty 的 INSERT 与表结构不同步（如漏 online_code）→ 字段永远为空——加列时同步改种子 INSERT |
| 双模式不同步 | 判分/统计逻辑只改服务端 → 演示模式数据对不上——成对修改（exam_report ⇆ demoExamReport） |
| 匿名 IIFE 变量遮蔽 | `params` 在 conds 中途被重新赋值 → bindings 数量错——改 SQL 参数时先读全函数 |
