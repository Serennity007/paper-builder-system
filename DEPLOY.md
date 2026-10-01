# 免费部署指南 · 组卷系统真后端版

让线上不只是静态演示，而是**带持久化后端的完整系统**：后端 + 页面是**同一个服务**
（Flask 托管全部页面 + API），部署一个服务即可得到公网可访问、数据落库的完整组卷系统。
首次启动自动从 `backend/seed.json` 建库（87 道题、3 套试卷、示例考试与答题码 `ZX2026`），开箱即用。

> ⚠️ 免费档共性：SQLite 存在实例盘上，**重新部署/实例重启后数据会重置为种子数据**（演示无影响，长期留存需付费挂盘或迁移 MySQL）。
> Render 免费实例 15 分钟无访问会休眠，首次唤醒约 30 秒。

## 部署前的两个安全开关（已默认配好）

| 开关 | 值 | 作用 |
|---|---|---|
| `EMAIL_DEV_ECHO=0` | render.yaml / Dockerfile 已内置 | 关闭验证码回显——公网上验证码不能直接显示在页面里；未配 SMTP 时邮箱登录返回「邮件通道未配置」，账密登录不受影响 |
| 接入正式邮件 | 配环境变量（见下） | 在 Render 的 Environment 里添加即可，无需改代码 |

## 方案 A：Render（推荐，最省事）

1. 确保本仓库（Serennity007/paper-builder-system）已在 GitHub 上（`render.yaml` 在仓库根目录）
2. 注册/登录 [render.com](https://render.com)（用 **Sign in with GitHub**）→ New + → **Web Service** → 选中该仓库
3. Render 自动读到 `render.yaml`：Build `pip install -r backend/requirements.txt`，Start `gunicorn wsgi:app`，点 **Apply**
4. 等 2–3 分钟构建完成，得到 `https://xxxx.onrender.com`——直接访问即是登录页（服务端模式自动生效，数据落库）

**更新代码**：push 到 GitHub 即自动重新部署（数据重置为种子）。

## 方案 B：Hugging Face Spaces（国内访问通常更稳）

1. 注册/登录 [huggingface.co](https://huggingface.co) → New **Space** → SDK 选 **Docker**（Blank 模板）
2. 把本系统文件全部上传到 Space（`Dockerfile` 已备好，监听 7860 符合其要求）
3. 等 Build 完成，得到公网地址

## 接入正式邮箱（可选，两平台通用）

在平台的环境变量里配置（HOST + USER 齐备即自动启用真实发信）：

| 变量 | 示例 | 说明 |
|---|---|---|
| `EMAIL_SMTP_HOST` | smtp.qq.com | SMTP 服务器 |
| `EMAIL_SMTP_PORT` | 465 | 端口（SSL） |
| `EMAIL_SMTP_USER` | noreply@zhxx.cn | 发信账号 |
| `EMAIL_SMTP_PASS` | **** | SMTP 授权码（不是邮箱登录密码） |
| `EMAIL_SMTP_SENDER` | 成都智慧象留学 \<noreply@zhxx.cn\> | 发件人显示（可省略） |
| `EMAIL_SMTP_SSL` | 1 / 0 | 默认 1 |

本地开发想用配置文件而非环境变量：新建 `backend/email_config.json`（字段见 `docs/HANDBOOK.md` 认证一节）。

## 本地验证部署产物（部署前建议）

```bash
pip install -r backend/requirements.txt
cd backend && gunicorn wsgi:app --workers 2 --bind 0.0.0.0:8687
# Windows 本地无 gunicorn 时：python wsgi.py（同入口，行为一致）
# 访问 http://localhost:8687 确认与 python backend/app.py 行为一致
```

## 部署后检查清单

- [ ] 打开首页出现登录页（「纸阅」视觉版：墨蓝品牌区 + 金色点缀）
- [ ] teacher / zx123456 登录（账密通道）
- [ ] 组卷台加题 → 保存试卷 → 保存并打印
- [ ] 考试页签复制学生链接 → 学生凭 `ZX2026` 作答 → 交卷自动判分 → 教师录分 → 报告更新
- [ ] 题库录题 / 回收站 / 知识点大纲可用；审计页有登录留痕
- [ ] 邮箱验证码页签提示「邮件通道未配置」（未接 SMTP 时属预期）；接好 SMTP 后全流程可用
- [ ] 两套系统互不影响（本系统 8687 端口习惯位，线上地址独立）
