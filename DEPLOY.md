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

## 7. 使用 Docker Compose 部署 (推荐)

这是最完整的部署方式，会同时启动数据库和网站服务。

### 步骤 1: 启动服务

```bash
docker-compose up -d --build
```
这会构建镜像并在后台启动数据库 (port: 25432) 和网站 (port: 3000)。

### 步骤 2: 初始化数据库 (必须执行)

Docker 启动后数据库是空的。由于生产环境镜像极度精简（不含 Prisma CLI），你需要**在本地机器**上运行迁移命令，连接到 Docker 暴露出的 `25432` 端口。

1.  确保你的 `.env` 文件指向 Docker 暴露的端口（默认配置已预设）：
    ```env
    # 注意端口是 25432，用户名密码与 docker-compose.yml 保持一致
    DATABASE_URL="postgresql://ricky:lyh1226@localhost:25432/kitty_love_db?schema=public"
    ```

2.  运行迁移：
    ```bash
    npx prisma db push
    ```

### 步骤 3: 创建管理员

同样，在本地运行脚本创建管理员：

```bash
npx ts-node scripts/create-admin.ts admin admin123
```

### 步骤 4: 访问

现在访问 `http://localhost:3000` 即可。

---

## 8. 常见问题

### Q: 为什么不能在这个 Docker 容器里运行 migrate？
A: 为了安全和体积，我们的 Docker 镜像使用 `standalone` 模式，移除了所有开发工具（包括 Prisma CLI）。所以需要在外部（宿主机）执行数据库操作。

### Q: 数据库连接失败？
A: 检查 `.env` 里的 `DATABASE_URL` 端口是否为 `25432`（这是 docker-compose 暴露给宿主机的端口），而不是 `5432`（这是容器内部端口，仅供 webapp 使用）。

## 9. 访问后台 (Access Admin Panel)

访问 `/admin` 路径，使用刚才创建的管理员账号登录。
首次设置建议先去 `/verify` 页面测试一下安全问答功能（如果开启了的话）。

## 9. 常用维护命令

*   **查看数据库**: `npx prisma studio` (打开 Web 界面管理数据)
*   **同步 Schema**: `npx prisma db push`
*   **生成 Client**: `npx prisma generate`

## 10. (可选) 配置腾讯云对象存储 (COS)

如果你不想把图片存在服务器本地（避免占用空间或数据丢失风险），可以配置腾讯云 COS。

### 1. 准备工作
*   在腾讯云控制台开通 COS 服务。
*   创建一个公有读私有写的 Bucket。
*   获取 `SecretId` 和 `SecretKey` (访问管理 -> API密钥管理)。
*   获取 Bucket 名称 (如 `my-bucket-1250000000`) 和 Region (如 `ap-guangzhou`)。

### 2. 配置环境变量
在 `.env` 文件中添加以下配置：

```env
# 存储类型：local (默认) 或 cos
STORAGE_TYPE=cos

# COS 配置 (仅当 STORAGE_TYPE=cos 时需要)
COS_SECRET_ID="你的SecretId"
COS_SECRET_KEY="你的SecretKey"
COS_BUCKET="你的Bucket名称"
COS_REGION="你的Region"
```

### 3. 应用配置
修改完 `.env` 后，重启服务：
```bash
docker-compose up -d --force-recreate
```

现在上传的图片将自动存储到腾讯云 COS，并返回 CDN 加速链接。Local 模式下的 `public/uploads` 目录将不再使用。
