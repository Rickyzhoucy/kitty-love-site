# 🐱 Kitty Love Site (For My Love)

![Next.js](https://img.shields.io/badge/Next.js-16.1.1-black?style=for-the-badge&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/License-Apache%202.0-green?style=for-the-badge)

一个充满爱意、高度可定制的专属二人世界纪念网站。拥有桌面级交互体验的虚拟宠物、实时状态同步、照片墙、纪念日计时器和任务提醒功能。专为情侣打造的数字家园。

## ✨ 核心特性

### 🎮 宠物生活与成长 (Pet & Gamification)
*   **深度页面联动**：宠物不仅仅是装饰！完成首页的 **待办事项 (Memo)**、上传 **照片 (Gallery)** 或达成 **里程碑 (Milestones)** 都会转化为宠物的成长经验。
*   **养成解锁系统**：
    *   随着宠物升级，自动解锁更多 **主题背景色** 和 **精美饰品**。
    *   沉浸式养成体验，让您对网站的每一次经营都得到可视化的反馈。
*   **AI 灵魂注入**：
    *   接入大语言模型 (LLM)，宠物拥有记忆和性格。
    *   **高度自定义 AI**：在管理后台可随意切换模型 (Model Name)、设置专属 API Key 和代理地址 (Base URL)。

### 🏠以此为家 (My Digital Home)
整个项目包含完整的数字生活板块：
*   **首页 (Home)**：聚合核心信息，一目了然。
*   **留言板 (Love Letter)**：写给伴侣的深情寄语，支持 HTML 排版。
*   **备忘录 (Reminders)**：极简的待办管理，支持过期划线、删除，与宠物成长挂钩。
*   **照片墙 (Gallery)**：记录美好瞬间，支持批量上传与大图浏览。
*   **我们的故事 (Milestones)**：记录爱情长跑的重要节点，铭记每一个"第一次"。
*   **计时器 (Timer)**：灵活的桌面组件，支持自定义 **正计时**（积累回忆）和 **倒计时**（期待未来），过期自动归档。

### 🛡️ 强大的管理后台 (Admin Dashboard)
*   **可视化配置中心**：无需修改代码，在后台即可配置：
    *   **AI 参数**：API Key, Base URL, 模型名称。
    *   **网站内容**：主计时器日期、情书内容、前台验证问题。
    *   **资源管理**：上传 Live2D 模型、3D 资源或背景图。
*   **安全验证**：前后台分离的权限验证体系，保障隐私安全。

## 🛠️ 技术栈

## 🛠️ 技术栈

*   **前端**：Next.js 16 (App Router), React 19, Framer Motion, Tailwind CSS
*   **后端**：Next.js API Routes
*   **数据库**：PostgreSQL, Prisma ORM
*   **AI/LLM**：OpenAI API (支持自定义 endpoint)
*   **图形/动画**：Pixi.js, Live2D SDK, Canvas Confetti
*   **部署**：Docker, Docker Compose

## 🚀 快速开始

### 前置要求
*   Docker & Docker Compose
*   Node.js 20+ (仅开发环境)

### 1. 克隆项目
```bash
git clone https://github.com/Rickyzhoucy/kitty-love-site.git
cd kitty-love-site
```

### 2. 配置环境变量
复制 `.env.example` 为 `.env`（Docker部署通常不需要手动创建，直接在 `docker-compose.yml` 中管理或使用默认值，生产环境建议在 Admin 后台配置）。

### 3. Docker 一键启动
```bash
# 构建并后台运行
docker compose up -d --build
```
### 4. 系统初始化 (关键步骤)
1.  **注册管理员**：访问 `http://localhost:3000/admin`。系统检测到无管理员时，会引导您注册首个账号（自动获得管理员权限）。
2.  **配置前台验证**：登录后台后，请立即前往 **配置中心 (Config)** 设置前台的"验证问题"与"答案"。
    *   *注意：在未配置验证问题前，前台首页可能无法正常进入。*

## 📂 项目结构
```
kitty-love-site/
├── app/
│   ├── admin/           # 管理后台页面
│   ├── api/             # 后端 API (Auth, Pet, Timers, etc.)
│   ├── components/      # React 组件 (FloatingPet, HomeTimers, etc.)
│   ├── gallery/         # 相册页面
│   └── page.tsx         # 首页入口
├── lib/                 # 工具库 (Prisma, Auth, Pet Logic)
├── prisma/              # 数据库 Schema
├── public/              # 静态资源 (Live2D模型等)
└── docker-compose.yml   # 容器编排配置
```

## ⚙️ 常见问题

**Q: 为什么手机上点击日期没反应？**
A: 这是通过 `stopPropagation` 修复的已知问题。项目已针对 iOS 等移动端设备进行了深度触摸事件优化。

**Q: 如何更换 Live2D 模型？**
A: 将模型文件放入 `public/wanko` 或其他目录，并在代码或配置中更新路径即可。

**Q: 部署后数据丢失？**
A: 请确保 `docker-compose.yml` 中正确配置了 PostgreSQL 的 Volume 挂载，例如：
```yaml
volumes:
  - /home/app/pgvolume:/var/lib/postgresql/data
```

## 📄 开源协议
本项目采用 [Apache License 2.0](LICENSE) 协议开源。
```
