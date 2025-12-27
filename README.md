# Kitty Love Site

一个浪漫的 Next.js 网站，用于展示你们的爱情故事。

## ✨ 功能特性

*   **🌹 浪漫首页**：3D Hello Kitty 模型、粒子效果、倒计时、情书展示。
*   **🔒 安全后台**: 
    *   管理员登录与安全问答验证。
    *   防暴力破解机制。
*   **⚙️ 动态配置**:
    *   **全站配置**: 在后台自由修改情书内容、纪念日时间、首页 3D 模型。
    *   **版本控制**: 配置修改支持历史回滚，误操作也不怕。
    *   **模块化管理**: 纪念日、情书、模型独立配置。
*   **📝 内容管理**:
    *   留言板管理。
    *   备忘录管理。
    *   照片墙管理。
    *   恋爱里程碑管理。

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境

复制 `.env.example` 为 `.env` 并配置数据库连接。

### 3. 创建管理员

我们提供了一个脚本来创建初始管理员账号：

```bash
npx ts-node scripts/create-admin.ts <用户名> <密码>
```

### 4. 启动开发服务器

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看效果。
后台地址: [http://localhost:3000/admin](http://localhost:3000/admin)

## 📖 详细部署文档

更多关于生产环境部署、Docker 部署以及数据库配置的信息，请参阅 [DEPLOY.md](./DEPLOY.md)。

## 技术栈

*   **框架**: Next.js 15+ (App Router)
*   **语言**: TypeScript
*   **数据库**: PostgreSQL + Prisma
*   **样式**: CSS Modules + Tailwind CSS
*   **3D 渲染**: React Three Fiber
*   **认证**: Custom Auth (bcrypt + cookies)

