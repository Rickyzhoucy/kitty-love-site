# 部署说明

本项目按单户私人服务设计：一个实例最多两个用户，不对公网提供注册入口。

## 1. 前置条件

- Docker Engine / Docker Desktop 与 Compose v2
- 服务器可访问阿里云百炼 API
- 至少 4 GB 内存；Skill Worker 单独限制为 512 MB
- 局域网使用时，为服务器配置稳定 IP 或内网域名

## 2. 配置

复制 `.env.example` 为 `.env`，至少替换：

- `POSTGRES_PASSWORD`
- `SESSION_SECRET`（不少于 32 个随机字符）
- `MINIO_ROOT_PASSWORD`
- `SKILL_WORKER_TOKEN`（不少于 32 个随机字符）
- `CHAT_API_KEY`
- `EMBEDDING_API_KEY`（可选；未配置时聊天正常工作，语义检索与自动记忆提取暂停）

聊天默认使用支持图片和 Function Calling 的 `qwen3.6-flash`；向量默认使用 `text-embedding-v4`、1024 维。两者都可通过环境变量替换。未配置向量 Key 时，Agent 使用已有普通记忆并跳过依赖 Embedding 的后台任务。若更换向量模型，Worker 会重算全部记忆向量并在完成后切换。

MinIO S3 端口默认通过 `MINIO_BIND_HOST=127.0.0.1` 仅绑定本机。局域网设备需要直接向 MinIO 上传文件时，同时把绑定地址和签名地址设为客户端可访问的地址，例如：

```dotenv
MINIO_BIND_HOST=192.168.1.10
MINIO_PUBLIC_ENDPOINT=192.168.1.10:9000
```

只允许可信局域网访问 `9000`。若由 HTTPS 反向代理统一暴露，请同步设置 MinIO 的外部域名与安全选项，并把 `SESSION_COOKIE_SECURE` 设为 `true`。

## 3. 启动与建号

```powershell
docker compose pull
docker compose up --build -d
docker compose ps
```

迁移服务会先检查数据库来源，再执行 Alembic 与 Procrastinate 表初始化：

- 空数据库直接执行全部迁移。
- 已存在 `_prisma_migrations` 且完整包含旧版基线表时，自动 `stamp 20260728_0001` 后继续升级。
- 无 Alembic 版本且无法识别的非空数据库会拒绝启动，避免误盖未知 schema。

随后创建双方账号：

```powershell
docker compose exec api python -m app.cli create-user alice "Alice" --password "强密码"
docker compose exec api python -m app.cli create-user bob "Bob" --password "强密码"
```

访问 `http://服务器地址:3000`。PostgreSQL、FastAPI、MinIO S3 和 MinIO Console 默认仅绑定本机；Web 为统一入口。仅在需要局域网附件直传时显式开放 MinIO `9000`。

## 4. 反向代理

反向代理至少转发：

- `/` → Web `3000`
- `/api/v1/*` 由 Next.js 同源代理到 FastAPI
- `/pet-content/*` 由 Next.js 同源代理到 MinIO 宠物桶
- MinIO 上传域名或端口 → MinIO `9000`

SSE 路径 `/api/v1/events` 和 `/api/v1/chat/stream` 必须关闭代理缓冲并允许长连接。

## 5. 更新、备份与恢复

更新前备份 PostgreSQL 与两个 Docker volume：

```powershell
docker compose exec -T postgres pg_dump -U kitty kitty_love_db > kitty-love.sql
docker compose stop
```

从旧 Prisma 版本首次升级前，建议先确认旧表和迁移记录存在：

```powershell
docker compose exec -T postgres psql -U kitty -d kitty_love_db -c "\dt"
docker compose exec -T postgres psql -U kitty -d kitty_love_db -c "select migration_name, finished_at from _prisma_migrations order by finished_at desc limit 5;"
```

拉取代码后：

```powershell
docker compose up --build -d
docker compose run --rm migrate
```

若自动识别因旧库结构不完整而停止，不要手工盲目 stamp。先恢复备份并核对缺失表；只有确认数据库已经完整应用旧 Prisma 基线时，才可手工执行：

```powershell
docker compose run --rm migrate alembic stamp 20260728_0001
docker compose run --rm migrate alembic upgrade head
```

不要删除 `postgres-data` 或 `minio-data`。恢复时先恢复数据库，再恢复 MinIO volume，确保附件元数据和对象版本一致。

## 6. 安全检查

- `.env` 不进入 Git，API Key 不写入镜像或前端环境。
- 定期轮换百炼 Key、数据库密码、MinIO 密码和 Session Secret。
- 只通过 CLI 创建账号，确认用户数不超过两个。
- Skill Worker 不持有数据库、聊天模型或向量模型密钥；容器只读、降权执行、限制 CPU/内存/PID，并位于禁止公网出口的内部 Docker 网络。
- FastAPI 仅绑定宿主机回环地址，并信任 Compose 内部反向代理传入的转发头；不要把 `8000` 直接暴露到公网。
- Tauri 生产构建前，把 capability 中允许的远程 URL 固定为实际可信域名；不要使用通配符。
- 若历史提交曾包含密钥，仅删除当前文件不足以恢复安全：先轮换密钥，再经确认重写并清理 Git 历史。

## 7. 停止

保留数据：

```powershell
docker compose down
```

删除项目容器与数据卷会永久清空本实例，只有在确认已有备份或明确要回收测试环境时才执行：

```powershell
docker compose down --volumes --remove-orphans
```
