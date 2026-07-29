# Kitty Love Site 重构总体方案

> 版本：v2.3（实现对齐与验收版）· 2026-07-28
> 范围：前端设计系统重构（P1-P8）→ Python 伴侣服务端（B1-B5）→ H5 / macOS / Windows 客户端
> 目标：解决视觉噪音与重复实现，并将项目演进为「两个人、两个伴侣人格、一个共享生活空间」的私有伴侣服务。
>
> 变更记录：
> - v1.0 初版：CSS Modules + token 方案
> - v1.1 升级：Tailwind CSS 4 + Radix；暗色模式、admin 后台纳入范围
> - v1.2 新增：宠物与 AI 演进路线（§十二）
> - v2.0 定稿：Python/LangChain 服务端战略（§十三）；废弃 Vercel AI SDK；全文审校（修正 P5 矛盾、token 命名、编号重排）
> - v2.1 收敛：明确非 SaaS、最多两名用户与两个人格；Agent 全部运行在服务端；采用通用 Agent Skills 规范热加载；静态资源统一使用 MinIO；宠物动画改为离线生成资源包
> - v2.2 工程定稿：Alembic 成为唯一 Schema owner；Agent 采用 middleware 编排；中文记忆使用 `pg_trgm + pgvector`；默认调用阿里云百炼在线 Embedding；后台任务使用 PostgreSQL 队列；Skill scripts 由独立固定环境执行；认证改为服务端 Session
> - v2.3 实现对齐：聊天模型改为支持视觉与 Function Calling 的百炼多模态模型；附件由服务端以内联数据交给模型；记忆持久化与在线向量调用解耦，模型切换采用后台全量重建和原子激活；相册统一领域校验；Skill 激活原子化并按请求固定版本；补齐 ToolRun、资源创建者归属、Tauri 透明桌宠与六套离线动作资源。

---

## 实施状态（2026-07-28）

P1-P8 与 B1-B5 已落到当前工作树。交付验证以以下命令和实机流程为准：

- Python：Ruff、Pytest、Alembic 全量迁移；
- Web：ESLint、TypeScript、Next.js production build、Playwright 登录/页面切换/宠物帧稳定性；
- 服务：Docker Compose 健康检查、PostgreSQL/MinIO/Worker/Skill Worker、SSE 并发与真实百炼调用；
- 桌面：Tauri `cargo check`、透明桌宠模式、系统凭据命令与可信来源限制；
- 资源：六套 manifest 与动作帧，柴犬/比熊按实拍参考图生成并在透明、白色和棋盘格底色抽检。

本方案不再保留旧 Prisma/Next API、Live2D、等级/饥饿/经验、装饰品或签到类系统。

## 一、现状诊断摘要

### 核心问题（按严重度排序）

| # | 问题 | 证据 |
|---|------|------|
| 1 | **视觉噪音过载** | 每页固定 3 层全屏动画（FloatingHearts + KittyStickers + ParticleBackground），首页再叠加 3D 场景 + 漂浮 emoji + confetti，共 5 层动效同时抢注意力 |
| 2 | **设计 token 形同虚设** | `globals.css` 定义了 `--pk-*` 变量但几乎无人使用；`#F48FB1` 等 hex 全站硬编码几十处 |
| 3 | **强调色 6 套互不统一** | 主粉 `#F48FB1`、深粉 `#E91E63`（verify）、hot pink `#FF69B4`（HomeTimers/FloatingPet）、紫 `#E1BEE7`（Reminders）、黄便签系（guestbook）、蓝 `#4DD0E1`（表单提交）、蓝紫渐变 `#667eea→#764ba2`（等级徽章） |
| 4 | **大段复制粘贴** | PageHeader 4 份逐字拷贝；gallery/timeline 表单 CSS 完全相同；气泡导航 2 套实现（48px vs 46px）；模态框 4 套实现（z-index 1000/2000/9999 混用） |
| 5 | **生效中的样式 bug** | `Countdown.module.css` 引用从未定义的变量 `--white`/`--secondary-blue`/`--text-light`/`--dark-pink` → 背景透明、边框消失 |
| 6 | **内联样式泛滥** | gallery Lightbox（60 行）、HomeTimers 整体（100 行）、FloatingPet 多处、layout 的 main |
| 7 | **字体声明未加载** | Fredoka、Quicksand 均未引入，全部 fallback sans-serif |
| 8 | **移动端隐患** | 全局 `button,a { min-height:44px }` 撑爆小按钮；memo 删除按钮 hover-only 不可发现；右下角宠物+菜单+提醒互相挤压；`!important` 8 处 |
| 9 | **其他** | `<html lang="en">` 实为中文站；Wikipedia 外链 Kitty 图 5 处（防盗链风险）；`alert()` 原生弹窗 |

---

## 二、设计方向：精致可爱

保留可爱基因，做减法。一句话：**"一家布置温馨的甜品店，而不是撒满亮片的幼儿园"**。

- 奶油白底（去波点）+ 柔和粉/蓝仅作点缀
- 玻璃拟态仅用于导航/模态等浮层，内容卡片保持不透明（可读性 + GPU 性能）
- 圆角 16-20px，单层柔和阴影（禁止多层阴影叠加）
- 全站同一时间最多一层环境动效
- 点缀色克制：粉色强调 + 每页最多一个辅助色

> Token 化设计保证主题切换只需修改 `@theme` 变量，组件实现保持不变。

---

## 三、设计系统：Tailwind CSS 4 + Design Token

**样式方案决策**：全站迁移到 **Tailwind CSS 4**。理由：
- 所有页面样式本来就要重写，迁移边际成本≈零
- v4 是 CSS-first 配置：`@theme` 定义 token，原生构建于 cascade layers + `color-mix()` + OKLCH 之上
- `tailwind-merge`/`clsx` 已在依赖中
- 复杂动效（宠物、3D）和特殊组件仍可保留少量 CSS Module，二者可混用

```css
/* globals.css —— Tailwind 4 CSS-first 配置 */
@import "tailwindcss";

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme {
  /* ── 唯一手写颜色：OKLCH 主色，变体用 color-mix 派生 ── */
  --color-accent:         oklch(76% 0.12 355);   /* 主粉 → bg-accent / text-accent */
  --color-accent-strong:  color-mix(in oklch, var(--color-accent), black 12%);
  --color-accent-soft:    color-mix(in oklch, var(--color-accent), white 85%);
  --color-secondary:      oklch(80% 0.08 210);   /* 辅助蓝 */
  --color-secondary-soft: color-mix(in oklch, var(--color-secondary), white 85%);

  /* ── 基础色板 ── */
  --color-bg-base:    #FFF9F5;   /* 奶油白 → bg-bg-base */
  --color-bg-surface: #FFFFFF;
  --color-bg-sunken:  #FFF1F2;

  /* ── 文字（命名 ink，生成 text-ink 而非冗余的 text-text-primary）── */
  --color-ink:       #4A4A56;
  --color-ink-muted: #9E9EAE;

  /* ── 语义色 ── */
  --color-success: #66BB6A;
  --color-warning: #FFA726;
  --color-danger:  #EF5350;

  /* ── 圆角 / 阴影 / 动效 ── */
  --radius-sm: 10px; --radius-md: 16px; --radius-lg: 20px;
  /* 阴影从 accent 派生：暗色模式下自动跟随，不硬编码粉色 */
  --shadow-soft:  0 2px 8px  color-mix(in oklch, var(--color-accent), transparent 92%);
  --shadow-lift:  0 4px 16px color-mix(in oklch, var(--color-accent), transparent 88%);
  --shadow-modal: 0 12px 40px color-mix(in oklch, var(--color-accent), transparent 82%);
  --ease-spring: cubic-bezier(0.22, 1, 0.36, 1);

  --font-rounded: 'Nunito', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

/* 暗色模式：只覆盖基础色，派生色（soft/strong/阴影）自动跟随 */
[data-theme="dark"] {
  --color-bg-base:    #1C1917;
  --color-bg-surface: #292524;
  --color-bg-sunken:  #44403C;
  --color-ink:        #F5F5F4;
  --color-ink-muted:  #A8A29E;
}

/* z-index 标尺（原生 CSS 变量，全站唯一） */
:root {
  --z-decoration: 0; --z-content: 1; --z-sticky: 10;
  --z-nav: 100; --z-fab: 200; --z-modal: 1000;
  --z-toast: 1100; --z-verify: 9999;
}
```

**配套规则：**
1. 引入真实字体：Nunito（圆润、中文 fallback 友好），删除无效的 Fredoka/Quicksand 声明
2. 颜色一律用 token 类（`bg-accent`、`text-ink`），禁止 hex 字面量
3. 全局 `min-height: 44px` 规则删除，触控区在 Button 组件内控制
4. `prefers-reduced-motion`：关闭所有装饰性动画
5. `<html lang="zh-CN">`
6. 暗色模式主机制是 `[data-theme="dark"]` 下的**变量覆盖**；`dark:` variant 仅用于个别需要结构差异的场景

---

## 四、公共组件规范（新增 app/components/ui/）

**组件行为层引入 [Radix UI primitives](https://www.radix-ui.com/)**（Dialog、Toast、Select 等）——只提供可访问性行为（focus trap、ESC 关闭、ARIA 属性），样式完全自定义，保证可爱风外观 + 完善的可访问性，不引入 shadcn 的 SaaS 默认皮肤。

| 组件 | 底层 | 职责 | 消灭的重复 |
|------|------|------|-----------|
| `PageHeader` | — | 标题 + 副标题 + 本地 Kitty 图标（下载到 public/ 替换 Wikipedia 外链） | 4 份逐字拷贝的 header |
| `Card` | — | 统一白卡 + 可选 glass 变体；容器查询响应式 | 各页散装卡片 |
| `Button` | — | variant: primary/secondary/ghost/danger；size: sm/md；触控区 ≥44px | 5 处重写的渐变 pill + 蓝色 submit |
| `Modal` | Radix Dialog | 统一遮罩 + focus trap + ESC；framer-motion 进出场 | 4 套模态实现 |
| `Input` / `Textarea` / `Select` | Radix Select | 统一输入控件样式与 focus 态 | 5 处重写的输入框 |
| `Toast` | Radix Toast | 替代所有 `alert()`/`confirm()` | 原生弹窗 |
| `EmptyState` | — | 空列表占位 | 各页散装空态 |
| `ThemeToggle` | — | 暗色模式切换按钮 | — |

---

## 五、装饰层收敛策略（解决视觉噪音的关键）

| 层 | 现状 | 重构后 |
|----|------|--------|
| FloatingHearts（全局） | 15 颗无限上飘 ❤️ | **删除，不留替代** |
| KittyStickers | 每页 6-8 个 emoji 贴纸 | **删除组件** |
| ParticleBackground | 每页 8-12 个粒子、4 套 keyframes | **删除**。首页 3D 场景本身就是动效主角 |
| 页面漂浮 emoji | 首页 💖🎀⭐ | 删除 |
| 背景 | 双色波点平铺 | 奶油白纯色 + 极淡的顶部径向光晕（`radial-gradient(ellipse at top, var(--color-accent-soft), transparent 60%)`） |
| confetti | 点击 Kitty 触发 | **保留**——这是有交互目的的正反馈，不是环境噪音 |

净效果：每页动效层从 3-5 层降到 0-1 层，同时减少约 400 行 CSS。

---

## 六、2026 技术采用清单（调研结论）

| 技术 | 用途 | 状态 |
|------|------|------|
| **Tailwind CSS 4** | 全站样式方案（CSS-first `@theme` token） | ✅ P1 采用 |
| **Radix UI primitives** | Modal/Toast/Select 的可访问性行为层 | ✅ P2 采用 |
| `color-mix()` + OKLCH | token 派生色，换主题改一行 | ✅ P1 采用 |
| Cascade Layers (`@layer`) | 消灭 8 处 `!important`（Tailwind 4 原生内置） | ✅ P1 采用 |
| Container Queries | Card/Bento 组件级响应式 | ✅ P2 采用 |
| Scroll-Driven Animations (`animation-timeline: view()`) | timeline 页滚动动画去 JS 化（渐进增强） | ✅ P4 采用 |
| View Transitions API | 页面切换过渡（渐进增强） | ✅ P3 采用 |
| 克制 Glassmorphism（`backdrop-filter`） | 仅底部导航 + 模态框，内容卡片不透明 | ✅ 采用 |
| Bento Grid | 首页计时器/提醒/入口的信息架构 | ✅ P4 采用 |
| **暗色模式** | `data-theme` 变量覆盖 + 跟随系统 | ✅ P6 采用 |
| shadcn/ui 预设皮肤 | 风格不符；只借其底层 Radix | ❌ 不采用 |
| Rive 替换 Live2D | 需重做整套宠物美术资源，且与离线帧动画路线矛盾（§12.3） | ❌ 不采用 |
| 换框架（Svelte/Astro 等） | Next.js 16.1.1 + React 19.2 已是最新栈 | ❌ 不采用 |
| Vercel AI SDK | TS 生态，与 Python 服务端战略冲突 | ❌ 不采用（§13.3） |

---

## 七、导航重构

- **删除首页自有 bubbleMenu 和旧 Navbar** 的右侧垂直菜单，统一为新组件 **`BottomNav`**：
  - 5 项：🏠 首页 / 💌 留言 / 📝 备忘 / 📷 相册 / ⭐ 故事
  - active 态：`text-accent` icon + 文字；非 active：`text-ink-muted`
  - 桌面端同样底部居中（pill 形态悬浮 + `backdrop-filter` 玻璃效果），不做两套
  - 高度 ≤64px，z-index `--z-nav`(100)
- 底部栏避开 FloatingPet 活动区：宠物默认右下，导航栏居中；宠物可拖拽，冲突由用户自行拖开（现状逻辑保留）

---

## 八、逐页改造清单

### 1. 首页 `/`
- 删除：KittyStickers、ParticleBackground、decorations 漂浮 emoji、自有 bubbleMenu
- 3D 场景保留为绝对主角；标题**顶部居中**，去掉白底 pill，改用文字阴影保证可读性
- `HomeTimers`：内联样式迁出，用 `Card` + Tailwind 重写；定位改为文档流内（3D 场景下方），不再 fixed 左上角
- `RemindersList`：同样改为文档流区块，不再 fixed 左下
- 首页信息架构：**Bento Grid**——3D Kitty（主角）下方用 bento 网格组织「计时器卡片 / 提醒列表 / 四个功能入口」，容器查询控制卡片在不同宽度下的跨列，单栏纵向滚动，告别满屏 fixed
- 修复：LoveLetter 解除对 `page.module.css` 的反向依赖，样式用 Tailwind 重写；overlay 改用 `Modal` 组件

### 2. 验证页 `/verify`
- 修复 render 期副作用 bug（`fetchQuestion` 移入 useEffect）
- 紫色渐变遮罩 → 奶油白 + 淡粉光晕（融入全站），保留"盖住全局装饰"语义（`--z-verify`）
- 深粉 `#E91E63` 按钮 → `bg-accent`
- 卡片改用 `Card` + `Button` + `Input`

### 3. 留言板 `/guestbook`
- header → `PageHeader`
- 黄色便签卡 → 白卡 + 粉色 🎀 角标保留（隐喻保留，配色收敛）；rotate ±2deg 保留（这是性格）
- 表单 → `Input`/`Textarea` + `Button`；`alert` → `Toast`
- 网格中间档（768-1024px）改为 2 列

### 4. 备忘录 `/memo`
- header → `PageHeader`
- 分类色从 4 色硬编码 → token；选中态用 `border-accent` + `bg-accent-soft`
- 删除按钮移动端常显（桌面保留 hover 显示）
- 看板列标题的彩色下边框保留但改用 token

### 5. 照片墙 `/gallery`
- header → `PageHeader`（消除 80px/70px 不一致）
- Lightbox 60 行内联样式 → `Modal` 变体（`--z-modal`，修复与宠物撞层问题）
- 拍立得样式保留（白边 + 手写 caption + 微旋转），这是页面灵魂
- 上传表单蓝色 submit → `Button variant="primary"`
- `.imagePlaceholder` 纯色 → 柔和渐变占位
- `alert` → `Toast`

### 6. 时间线 `/timeline`
- header → `PageHeader`；表单与 gallery 统一组件
- 8 处 `!important` 通过 cascade layers 层级消除
- 滚动进入动画从 framer-motion `whileInView` 迁移到 CSS `animation-timeline: view()`（渐进增强）
- marker 的 -42px 魔数改为 CSS 变量

### 7. 全局 layout
- `<html lang="zh-CN">`，metadata 中文化（用于分享卡片，不做 SEO，见 §十一）
- main 的内联 style 迁入 CSS
- 删除全局 FloatingHearts

---

## 九、宠物系统兼容约束（不可破坏）

重构中必须保持：

1. `PET_CONFIG.colors[].color` 是**任意 CSS background 值**（含 gradient 字符串），直接消费于内联样式和 mix-blend-mode 着色层 —— 新 token 体系不要试图接管宠物换色
2. 解锁逻辑：颜色按 `pet.level`（1/5/10/15/20/30），配饰按 `pet.evolution`（2/3/4）
3. `lib/petEvents.ts` 事件总线签名不变：`notifyPetExperience(amount, source)`，四个功能页继续调用
4. FloatingPet 固定右下，z-index 从 9999 收敛到 `--z-fab`(200)（高于导航、低于模态）；`localStorage.petPosition` 兼容
5. FloatingPet 自身 UI（菜单、聊天气泡）按新 token 重刷样式（hot pink → `bg-accent`，蓝紫等级徽章 → token）

---

## 十、实施阶段（按序执行，每阶段独立可交付）

| 阶段 | 内容 | 预估改动量 |
|------|------|-----------|
| **P1 地基** | 接入 Tailwind CSS 4 + `@theme` token；引入字体；删波点/FloatingHearts/Stickers/Particle；lang/metadata；修 Countdown 变量 bug | ~8 文件 |
| **P2 组件** | 安装 Radix primitives；新建 ui/ 目录 8 个组件（§四）；**`lib/api/` 统一 client 层**（§13.7） | ~10 新文件 |
| **P3 导航** | `BottomNav` 替换双套气泡菜单；接入 View Transitions | ~3 文件 |
| **P4 前台页面** | 6 个页面逐个接入新组件与 Tailwind（每页一个 commit）；首页 Bento Grid；timeline 滚动动画 CSS 化 | ~15 文件 |
| **P5 宠物** | FloatingPet 样式刷新、z-index 归位；**PetRenderer 可插拔抽象** + SpriteRenderer 升级（§12.3） | ~5 文件 |
| **P6 暗色模式** | `data-theme` 切换 + ThemeToggle + 系统跟随 + 全站暗色走查 | 散布 |
| **P7 后台重构** | admin 全站接入同一设计系统（PageHeader/Card/Button/Modal/Toast），统一后台观感 | ~15 文件 |
| **P8 打磨** | prefers-reduced-motion、移动端复测、性能审计（Lighthouse） | 散布 |

**每阶段验收**：`npm run build` 通过 + 目检桌面/移动两视口 + 暗色模式（P6 后）。

---

## 十一、明确不做的（YAGNI）

- **Rive 替换 Live2D**：需重做整套宠物美术资源，且与离线帧动画路线矛盾（§12.3）
- **换框架（Svelte/Astro/Qwik 等）**：Next.js 16.1.1 + React 19.2 已是 2026 最新栈
- **Vercel AI SDK**：agent 层位于 Python 服务端，避免维护两套 Agent 实现（§13.3）
- **shadcn/ui 预设皮肤**：只借其底层 Radix primitives，外观完全自定义
- **SEO / 国际化 i18n**：站点在问答验证墙后、仅两人使用，无搜索引擎和多语言场景（metadata 中文化仅为分享卡片观感）
- **自建设计系统文档站（Storybook）**：组件仅 8 个，本方案文档即合同

---

## 十二、宠物、人格与动画资源

> 产品边界：这是自己和伴侣使用的私有服务，不是 SaaS。一般情况下只有两名真实用户，双方各拥有一个稳定的伴侣人格；网站、macOS 与 Windows 客户端只是不同入口。

### 12.1 从游戏宠物转向伴侣人格

现有 `Pet` 的等级、饥饿、进化、配饰等游戏化字段不再作为新系统核心。新系统关注：

- 稳定身份：名字、外观、说话方式和行为边界不会随单次对话漂移
- 用户画像：各自的偏好、习惯、人物关系和沟通方式
- 关系连续性：共同经历、约定、纪念日和长期计划
- 行动能力：通过服务端工具查询和修改网站中的备忘录、提醒、照片和时间线

双方人格彼此独立，但可读取共享关系记忆：

```text
用户 A → 伴侣人格 A → A 的对话与画像 ┐
                                      ├→ 共享关系记忆
用户 B → 伴侣人格 B → B 的对话与画像 ┘
```

人格本体与记忆分离。`CompanionPersona` 保存稳定设定；自动总结只能更新用户画像和关系记忆，不直接改写核心人格。

### 12.2 记忆分层

记忆系统固定为四层：

| 层 | 内容 | 保存方式 |
|----|------|----------|
| 当前对话 | 最近消息与工具结果 | LangGraph thread/checkpointer |
| 对话摘要 | 长对话的滚动摘要 | `ConversationSummary` |
| 长期记忆 | 偏好、计划、人物、约定、生活事件 | `MemoryItem` |
| 人物画像 | 用户特征与伴侣相处方式 | `UserProfile` |

长期记忆使用 `owner / companion / shared` 三种作用域。每累计约 20-30 条消息或会话空闲后，由后台 Worker：

1. 更新对话摘要
2. 提取少量长期记忆候选
3. 与已有记忆去重或合并
4. 保留来源消息 ID 后写入 PostgreSQL

`MemoryItem` 使用 PostgreSQL 结构化条件、`pg_trgm` 字面检索与 pgvector 语义检索进行混合召回：

```text
owner / companion / shared 作用域与类型过滤
→ pg_trgm 召回名字、日期、原话、短语和近似文本
→ pgvector 召回语义相近内容
→ Reciprocal Rank Fusion 合并两组排名
→ 按重要度和时间衰减重排
```

PostgreSQL 原生 FTS 不提供中文分词，因此不使用 `to_tsvector` 作为中文记忆检索基础，也不安装 zhparser 或 pg_jieba。`pg_trgm` 和 pgvector 均作为 PostgreSQL 扩展随数据库初始化。

Embedding 使用在线 API，不部署本地模型或推理容器：

```text
默认 Provider    阿里云百炼 Model Studio
地域             华北 2（北京）
模型             text-embedding-v4
维度             1024
距离             cosine
数据库类型       vector(1024)
```

业务层只依赖 `EmbeddingProvider` 接口。所有可替换模型必须输出 1024 维向量；`MemoryEmbedding` 保存 provider、model、profile version、content hash、状态和生成时间。更换模型时创建新的 `EmbeddingProfile`，后台重算全部记忆，完成后原子切换 active profile；同一次检索不得混用不同模型生成的向量。

长期记忆写入后由后台任务批量生成向量；查询时同步生成 query embedding。API 失败时写入任务保留并重试，查询自动退化为 `pg_trgm`，不阻断对话。发送给 Provider 的内容只包含规范化后的检索文本，不包含整段原始会话。

### 12.3 动画资源：离线生成、运行时播放

GPT Image 2 仅用于项目开发期生成宠物美术资源，不进入线上服务，也不提供用户侧实时生成能力。

资源生产流程：

```text
角色基准图
→ idle / walk / crawl / sleep / happy 等动作分解
→ 筛选和补帧
→ 透明背景、统一画布与锚点
→ 导出 WebP 帧序列
→ 上传 MinIO
→ 客户端按 manifest 播放
```

MinIO 中采用不可变版本目录：

```text
pet-assets/
  companion-a/v1/
    manifest.json
    idle/01.webp
    walk/01.webp
    crawl/01.webp
  companion-b/v1/
    ...
```

服务端只发送动作事件，例如：

```json
{
  "type": "pet.action",
  "action": "happy",
  "duration": 3000
}
```

H5/Tauri 客户端根据本地缓存的 manifest 播放资源。最终删除 Live2D 运行时；Pixi 可继续作为轻量精灵渲染器。

### 12.4 确定的实现约束

- `PetRenderer` 保留渲染抽象，帧动画渲染器作为默认实现
- 线上服务只读取已发布的资源包，不包含运行时图像生成链路
- Agent 与模型 SDK 仅存在于 Python 服务端，Next.js 保持纯客户端职责
- 宠物图片、帧动画和 manifest 统一存入 MinIO
- 宠物资源通过资源版本或 `asset_id` 引用；迁移完成后删除 `customSprite`

---

## 十三、Python 伴侣服务端

> 决策：Agent、人格、记忆、Skill、文件解析与网站操作全部运行在 Python 服务端。客户端只负责发送文字/文件、接收流式事件和展示宠物动画。

### 13.1 目标架构

```text
┌──────────────────┐   ┌─────────────────────┐
│ Next.js H5       │   │ Tauri macOS/Windows │
│ 页面与文件收发   │   │ 透明窗口与动画播放  │
└────────┬─────────┘   └──────────┬──────────┘
         └──────────────┬─────────┘
                        ▼
             ┌───────────────────────┐
             │ FastAPI /api/v1       │
             │ REST + SSE + Upload   │
             └───────────┬───────────┘
                         ▼
      ┌─────────────────────────────────────┐
      │ Companion Service                  │
      │ Agent / Persona / Memory / Skills  │
      └─────────────┬───────────┬───────────┘
                    ▼           ▼
           Domain Services   Background Worker
                    │           │
                    ▼           ▼
              PostgreSQL      MinIO
```

Next.js 最终只是 H5 客户端。Tauri 只提供透明宠物窗口、动画、聊天和文件选择，不在本地运行 Agent，也不提供 PC 控制能力。

### 13.2 领域服务与 Agent 工具共用

网页 API 与 Agent 工具必须调用同一层业务服务：

```text
POST /api/v1/memos ─┐
                    ├→ MemoService.create()
Agent memo_create ──┘
```

核心工具集合：

```text
memo_list / memo_create / memo_update / memo_complete
reminder_list / reminder_create / reminder_complete
photo_list / photo_add / photo_describe
timeline_list / timeline_add
message_list / message_create
```

Agent 不直接写数据库，也不通过浏览器点击页面。操作完成后发布结构化事件：

```json
{
  "type": "resource.changed",
  "resource": "memo",
  "action": "created",
  "id": "..."
}
```

客户端收到事件后刷新对应资源。

### 13.3 服务端技术栈

- FastAPI：REST、SSE、文件上传和认证
- LangChain `create_agent` + middleware：Agent 推理、上下文注入与工具调用
- LangGraph PostgreSQL checkpointer：线程与运行状态
- SQLAlchemy 2.0 + Alembic：业务模型与迁移
- PostgreSQL + `pg_trgm` + pgvector：业务数据、中文混合记忆检索和 Skill 元数据
- Procrastinate：基于 PostgreSQL 的持久后台任务队列
- 阿里云百炼 `text-embedding-v4`：在线中文 Embedding
- MinIO：图片、文件、宠物动画、Skill 包及派生资源
- Background Worker：对话总结、记忆提取、文件解析和缩略图

`create_agent` 本身基于 LangGraph 编译并全局复用，不再在外层重复手写一套 Graph。服务端执行管线通过 middleware 实现：

```text
dynamic_prompt     加载 CompanionPersona / UserProfile
before_model       混合检索并注入 owner / companion / shared 记忆
wrap_model_call    模型选择、超时、重试和调用日志
wrap_tool_call     参数校验、领域服务调用和 ToolRun 审计
after_agent        持久化结果、写入事件 Outbox、投递后台任务
```

PostgreSQL 使用一个全局异步连接池；PostgreSQL checkpointer 在启动时完成 setup，Graph 编译一次并复用。对话请求通过 checkpointer 保证可恢复；摘要、记忆提取、Embedding 和文件派生任务由 Worker 幂等执行，不阻塞回复流。

LLM 通过 LangChain model interface 注入，业务代码不直接依赖厂商 SDK：

```text
MODEL_PROVIDER
MODEL_NAME
MODEL_BASE_URL
MODEL_API_KEY
MODEL_TIMEOUT
```

当前架构不部署 LiteLLM Proxy；单独增加代理服务不会改善两人场景下的模型调用。

后台任务全部进入 Procrastinate 的 PostgreSQL 持久队列：

```text
conversation.summarize
memory.extract
memory.embed
attachment.process
photo.thumbnail
```

任务必须定义幂等键、最大重试次数和失败状态。`LISTEN / NOTIFY` 只负责唤醒 Worker 和推送即时 UI 事件，不能替代持久任务；Worker 即使错过通知，也会从任务表继续消费。

### 13.4 核心数据模型

#### 13.4.1 数据库 Schema 所有权

现有 PostgreSQL 由 Prisma migrations 创建。Python 接管后采用单一 Schema owner：

1. 根据现有 Prisma Schema 手写 SQLAlchemy 2.0 模型，不使用 automap 作为长期模型
2. 创建包含现有完整结构的 Alembic baseline migration
3. 已部署数据库执行 `alembic stamp <baseline>`；全新数据库执行 `alembic upgrade head`
4. 从 baseline 起停止 `prisma migrate`，所有 DDL 只由 Alembic 发起
5. Prisma 在对应领域 API 切换前可以继续执行 DML，但不得改变 Schema
6. Memo、Reminder、Photo 等按领域切换写入口；任何时刻同一领域只能有一个写入口，禁止双写
7. 领域切换完成后删除对应 Next.js API route，不保留长期转发层
8. LangGraph checkpointer 与 Procrastinate 的内部表由各自组件自行创建和维护，不纳入 Alembic 迁移范围；Alembic autogenerate 时应在 `env.py` 中 exclude 这两组表，避免噪声迁移

主键继续使用字符串类型；Python 为新增记录生成 CUID2，现有 Prisma CUID 无需批量改写，外键始终按不透明字符串处理。

#### 13.4.2 模型清单

新增核心模型：

```text
User
UserSession
Companion
CompanionPersona
UserProfile
Conversation
ChatMessage
ConversationSummary
MemoryItem
MemoryEmbedding
EmbeddingProfile
Attachment
Skill
SkillVersion
ToolRun
```

现有 `Memo`、`Reminder`、`Photo`、`Milestone`、`Message`、`EventTimer` 保留，并增加 `createdBy` / `createdByCompanion`。不引入 SaaS 多租户、组织、计费、RLS 或设备权限模型。

### 13.5 通用 Agent Skills 规范

服务端只提供通用 Skill 运行时，不把邮件、写作或办公能力固化在业务代码中。所有具体 Skill 都以标准包上传、启用和版本化。

严格兼容 [Agent Skills 开放规范](https://agentskills.io/)：

```text
skill-name/
├── SKILL.md
├── scripts/       # 可选
├── references/    # 可选
└── assets/        # 可选
```

`SKILL.md` 必须包含标准 YAML frontmatter：

```markdown
---
name: email-assistant
description: 起草、润色和发送邮件。用户要求处理邮件时使用。
---

# 邮件助手

具体操作说明……
```

系统提供：

- 标准目录/ZIP 上传与 `skills-ref` 校验
- 启用、停用、更新与回滚
- 启动时仅加载 `name` 和 `description`
- 匹配后按需加载完整 `SKILL.md`
- 按需读取 `scripts/`、`references/` 和 `assets/`
- 多 Worker 热加载

Agent Skills 规范不承担分发版本管理；版本、SHA-256、启用状态由 PostgreSQL 中的 `Skill` / `SkillVersion` 管理，原始包保存在 MinIO：

```text
skill-packages/
  email-assistant/
    revisions/
      <revision-id>/package.zip
```

热加载流程：

```text
上传 ZIP
→ 标准校验
→ 写入 MinIO
→ 创建 SkillVersion
→ 原子切换 active_version
→ PostgreSQL NOTIFY skill_changed
→ Agent 进程清理元数据缓存并加载新版本
```

`NOTIFY` 只负责及时唤醒，不作为状态真相。每个 Agent 进程启动时、连接恢复后及周期校对时都从 PostgreSQL 重新读取 active version，因此错过通知不会造成版本永久不一致。

当前请求固定使用开始执行时的 Skill 版本；新请求使用新版本，因此更新无需重启且不会打断运行中的回复。

`scripts/` 统一交给独立 Skill Worker 执行：

- Skill Worker 使用固定、预构建并受审计的 Python/Node 运行环境
- Skill ZIP 不允许在线安装任意依赖；需要新增依赖时升级 Skill Worker 镜像
- 每个 `SkillVersion` 对应不可变解包目录，每次执行启动独立子进程
- 子进程限制工作目录、环境变量、超时、并发和输出大小
- 凭据不写入 Skill 包，只按对应领域工具调用注入所需权限
- 停用和回滚只切换 active version；已发布版本保留，不实现引用计数和即时自动回收

Skill Worker 与 API/Agent 进程隔离，脚本异常、死循环或模块污染不得影响对话服务。

### 13.6 MinIO 资源策略

Bucket 划分：

```text
pet-assets       宠物形象、动作帧和 manifest
user-uploads     聊天图片、照片和文件
skill-packages   Skill ZIP 与附属资源
derived-assets   缩略图、OCR 文本和转换后的 WebP
```

PostgreSQL 不保存完整 URL，只保存：

```text
bucket / object_key / version_id / content_type / size / sha256
```

上传流程：

```text
客户端申请上传
→ FastAPI 返回 MinIO presigned PUT URL
→ 客户端直传 MinIO
→ 客户端提交 object_key
→ FastAPI 创建 Attachment
→ Agent 通过 attachment_id 使用文件
```

宠物资源采用不可变路径和长期缓存；用户文件使用私有 Bucket 与临时签名 URL。

### 13.7 前端 API client 层

#### 13.7.1 认证

现有 Base64 JSON Cookie 可被客户端伪造，必须由服务端 Session 替换，不引入 JWT refresh、黑名单或轮换体系。

`UserSession` 保存：

```text
id / user_id / token_hash / expires_at / last_seen_at / revoked_at / device_name
```

- 登录成功后生成高熵随机 token，PostgreSQL 只保存 hash
- H5 使用 `HttpOnly + Secure + SameSite=Lax` Cookie
- H5 与 FastAPI 通过反向代理同源部署，避免跨域 Cookie
- Tauri 将设备 token 保存到 macOS Keychain 或 Windows Credential Manager，请求时通过 `Authorization: Bearer <token>` 头携带，不使用 Cookie（桌面 WebView 的 Cookie 行为跨平台不一致）
- 注销、设备移除或密码变更时直接撤销 Session
- 登录接口按 IP 和账号限流

#### 13.7.2 API 与流式事件

所有 `fetch` 调用继续收敛到 `lib/api/`：

```ts
export const api = {
  get:  <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
};
```

`NEXT_PUBLIC_API_BASE_URL` 控制 Next.js API 与 Python `/api/v1` 的切换。聊天使用 SSE 接收：

```text
text.delta
tool.started
tool.completed
resource.changed
pet.action
message.completed
```

`resource.changed` 由领域服务在事务中写入事件 Outbox，提交后通过 PostgreSQL `NOTIFY` 唤醒 SSE 分发器。通知载荷只包含资源类型、ID 和版本；SSE 断线重连后客户端重新拉取资源状态，因此通知丢失不会造成数据不一致。

### 13.8 迁移路线

| 阶段 | 内容 | 验收 |
|------|------|------|
| **B1 Python 地基** | SQLAlchemy 手写映射、Alembic baseline、冻结 Prisma DDL、FastAPI、服务端 Session、MinIO、Procrastinate、SSE | 现有库可 stamp、全新库可 upgrade；H5 可登录、上传文件并接收流式事件 |
| **B2 人格与记忆** | 两个 Companion、middleware、Summary、MemoryItem、`pg_trgm + pgvector`、百炼 `text-embedding-v4` | 两个人格稳定对话；记忆自动形成、混合召回且 Embedding 故障可降级 |
| **B3 网站工具** | 按领域迁移 Memo、Reminder、Photo、Timeline；领域服务、Agent Tool、Outbox、`NOTIFY → SSE` | 每个已迁移领域只有 Python 写入口；Agent 操作后客户端实时同步 |
| **B4 Skill Runtime** | Agent Skills 校验、MinIO 版本、按需加载、热更新、固定环境 Skill Worker | 上传标准 Skill 后无需重启即可使用或回滚，脚本异常不影响 Agent |
| **B5 动画与桌面** | 离线生成两套动作资源、帧动画渲染、Tauri 透明窗口与系统凭据 | H5/桌面端播放同一动作协议与资源包，桌面端不运行本地 Agent |

### 13.9 部署拓扑

`docker-compose` 最终包含：

```text
web            Next.js
api            FastAPI + Companion Service
worker         Procrastinate 任务、总结、记忆与文件处理
skill-worker   固定环境中的 Skill scripts 子进程
postgres       PostgreSQL + pg_trgm + pgvector
minio          对象存储
```

PostgreSQL 镜像包含 pgvector，初始化时启用 `vector` 与 `pg_trgm` 扩展。反向代理按路径分流：`/api/v1` → FastAPI，其余 → Next.js；H5 与 API 保持同源，MinIO 不直接暴露管理端口给公网。

---

## 十四、参考来源

**设计趋势与 CSS**
- UI Trends 2026：https://mediaplus.com.sg/ui-trends/
- View Transitions & Scroll-Driven Animations：https://www.frontendhorizon.com/blog/view-transitions-api-and-css-scroll-driven-animations-the-browser-wins-of-2026
- Bento Grid 2026：https://senorit.de/en/blog/bento-grid-design-trend-2025
- Modern CSS 2026（cascade layers / container queries / color functions）：https://adamarant.com/en/blog/modern-css-in-2026-cascade-layers-container-queries-color-functions

**宠物渲染**
- Rive vs Lottie 2026：https://unicornicons.com/learn/rive-vs-lottie
- OpenAI Image Generation Guide：https://platform.openai.com/docs/guides/image-generation
- OpenAI ChatGPT Images 2.0：https://openai.com/index/introducing-chatgpt-images-2-0/

**AI 与服务端**
- Agent Skills 开放规范：https://agentskills.io/
- Agent Skills 官方仓库：https://github.com/agentskills/agentskills
- LangChain Agents 官方文档：https://docs.langchain.com/oss/python/langchain/agents
- LangGraph 官方文档：https://docs.langchain.com/oss/python/langgraph/overview
- LangGraph Memory 官方文档：https://docs.langchain.com/oss/python/langgraph/add-memory
- FastAPI 官方文档：https://fastapi.tiangolo.com/
- PostgreSQL pg_trgm 官方文档：https://www.postgresql.org/docs/current/pgtrgm.html
- pgvector 官方仓库：https://github.com/pgvector/pgvector
- Procrastinate 官方文档：https://procrastinate.readthedocs.io/en/stable/
- 阿里云百炼 Embedding 官方文档：https://help.aliyun.com/en/model-studio/embedding
- 阿里云百炼模型价格：https://help.aliyun.com/zh/model-studio/model-pricing
- MinIO 官方文档：https://min.io/docs/minio/linux/index.html
- Utsuwa Tauri AI Companion：https://github.com/The-Lab-by-Ordinary-Company/utsuwa
- Tauri Window API：https://v2.tauri.app/reference/javascript/api/namespacewindow/
