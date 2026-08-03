# Kitty Love

面向自己与伴侣的私人陪伴服务。一个部署最多两个用户，每个用户拥有独立人格、用户画像、分层记忆与对话；双方共享留言、备忘、相册、纪念日、计时器等生活数据。Web、Windows 与 macOS 客户端只负责展示和收发，业务与 Agent 编排集中在 Python 服务端。

## 组成

- `app/`：Next.js 16 Web 客户端与管理界面。
- `backend/app/`：FastAPI、LangChain Agent、领域服务、鉴权、附件与 Skill 管理。
- PostgreSQL 15 + pgvector/pg_trgm：业务数据、记忆向量、任务队列与 Checkpoint。
- MinIO：用户附件、相册原图、宠物资源和 Skill 版本包。
- Procrastinate Worker：滚动摘要、画像更新、记忆提取、向量重建。
- Skill Worker：隔离执行通用 Agent Skills 中声明的 Python/Node 脚本。
- `src-tauri/`：Windows/macOS 透明桌宠客户端，系统凭据库保存设备 Token。

## 本地启动

1. 复制 `.env.example` 为 `.env`，填写随机密码、`SESSION_SECRET`、百炼聊天与向量 API Key。
2. 启动核心环境：

   ```powershell
   docker compose up --build -d
   ```

3. 创建双方账号（总数限制为两个）：

   ```powershell
   docker compose exec api python -m app.cli create-user alice "Alice" --password "替换为强密码"
   docker compose exec api python -m app.cli create-user bob "Bob" --password "替换为强密码"
   ```

4. 打开 `http://localhost:3000`。MinIO 管理控制台仅监听本机 `http://127.0.0.1:9001`。

Docling 与 Gotenberg 不在核心 Compose 中启动，避免把文档模型和 LibreOffice
塞进 2C4G 生产机。以后由 Mac mini NAS 单独运行
`docker-compose.document.yml`，主服务只通过私网 URL 调用；具体变量和安全注意
事项见 `.env.example` 与 `.env.document.example`。

常用检查：

```powershell
docker compose ps
docker compose logs -f api worker skill-worker web
docker compose run --rm migrate
```

## 开发与验证

```powershell
pnpm install
pnpm lint
pnpm exec tsc --noEmit
pnpm build

Set-Location backend
uv sync
uv run ruff check app tests
uv run pytest -q

Set-Location ..
cargo check --manifest-path src-tauri/Cargo.toml
```

浏览器烟测在服务启动后执行：

```powershell
pnpm test:e2e
```

## Agent 与记忆

- 每个用户只有自己的 Companion、Persona 与 UserProfile。
- 聊天回复先持久化；记忆提取、向量化、滚动摘要与画像刷新由后台任务完成，在线模型故障不会丢失原始记忆。
- 语义检索与关键词检索融合；向量模型变化时后台全量重建，新旧模型不混算，完成后原子切换。
- Agent 的站内增删改查复用 HTTP 领域服务；相册附件校验所有者和状态。
- 每次工具调用写入 `ToolRun`，共享资源记录 `createdBy` 与 `createdByCompanion`。

## Skills

上传包遵循通用 Agent Skills 规范：ZIP 中包含带 YAML frontmatter 的 `SKILL.md`，可包含 `references/`、`assets/` 与 `scripts/`。服务会校验路径、文件数、展开体积和规范；版本先验证、物化，再原子激活。Agent 单次请求固定 Skill 版本，支持热上传、切换、禁用、重新启用和回滚。

## 宠物资源

资源位于 `public/pet-assets/<pet>/v1`，当前包含 Kitty、Momo、Hello Kitty、Snoopy、柴犬、比熊。柴犬与比熊源图位于 `artwork/pet-sources/`，由实拍参考图生成；manifest 提供独立 `idle`、`walk`、`crawl`（两套写实犬另有 `sit`）动作。

详细架构见 [docs/redesign-master-plan.md](docs/redesign-master-plan.md)，部署见 [DEPLOY.md](DEPLOY.md)。
