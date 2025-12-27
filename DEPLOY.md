# 部署文档 (Deployment Guide)

这份文档将指导你如何部署和运行 Kitty Love Site。

## 1. 环境要求 (Prerequisites)

*   **Node.js**: >= 18.0.0
*   **PostgreSQL**: >= 13 (推荐使用 Docker)
*   **pnpm** (推荐) 或 npm/yarn

## 2. 安装依赖 (Installation)

```bash
pnpm install
# 或者
npm install
```

## 3. 配置环境变量 (Environment Setup)

复制 `.env` 文件（如果没有请新建）：

```bash
cp .env.example .env
```

确保 `.env` 中包含以下配置：

```env
# 数据库连接 (如果使用 Docker Compose，这将自动生效)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kitty_love?schema=public"

# 如果你在生产环境，请修改这些值
NODE_ENV="production"
```

## 4. 启动数据库 (Start Database)

推荐使用 Docker Compose 快速启动数据库：

```bash
docker-compose up -d
```

如果是首次运行，需要同步数据库结构：

```bash
npx prisma db push
```

## 5. 创建管理员账号 (Create Admin Account)

由于系统没有公开注册页面，你需要通过脚本创建第一个管理员账号。

我们提供了一个便捷脚本（需先安装 `ts-node` 或直接使用 `npx`）：

创建一个名为 `scripts/create-admin.ts` 的文件（如果不存在）：

```typescript
// scripts/create-admin.ts
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'admin123';

  console.log(`正在创建管理员: ${username}...`);

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const admin = await prisma.admin.upsert({
      where: { username },
      update: {
        password: hashedPassword,
        status: 'approved' // 直接设为已审核通过
      },
      create: {
        username,
        password: hashedPassword,
        status: 'approved'
      },
    });
    console.log(`管理员 ${admin.username} 创建成功！`);
  } catch (e) {
    console.error('创建失败:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
```

然后运行它：

```bash
# 格式: npx ts-node scripts/create-admin.ts <用户名> <密码>
npx ts-node scripts/create-admin.ts admin mysecurepassword
```

或者你可以直接修改并运行我们预置的 `npm run create-admin` (如果我在 package.json 里加了的话，暂时你可以用上面的命令)。

## 6. 构建与运行 (Build & Run)

**开发模式：**

```bash
pnpm dev
```

访问: `http://localhost:3000`

**生产模式部署：**

1.  构建项目：
    ```bash
    pnpm build
    ```

2.  启动服务：
    ```bash
    pnpm start
    ```

服务默认运行在 3000 端口。

## 7. 使用 Docker 部署应用 (Docker Deployment)

如果你希望将整个应用（包括前端）也跑在 Docker 里：

1.  构建镜像：
    ```bash
    docker build -t kitty-love-site .
    ```

2.  运行容器：
    ```bash
    docker run -p 3000:3000 -e DATABASE_URL="postgresql://..." kitty-love-site
    ```

注意：确保 Docker 容器内的网络能访问到你的 PostgreSQL 数据库。

## 8. 访问后台 (Access Admin Panel)

访问 `/admin` 路径，使用刚才创建的管理员账号登录。
首次设置建议先去 `/verify` 页面测试一下安全问答功能（如果开启了的话）。

## 9. 常用维护命令

*   **查看数据库**: `npx prisma studio` (打开 Web 界面管理数据)
*   **同步 Schema**: `npx prisma db push`
*   **生成 Client**: `npx prisma generate`
