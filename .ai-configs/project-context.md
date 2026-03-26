# 项目上下文

> 此文件由 `wf-skills init` 自动生成，请根据项目实际情况填写。
> 所有标记 `[待填写]` 的字段必须补全，否则 AI skill 将拒绝执行。

## 基础信息

- **项目名称**：Codeman（npm 包名 `aicodeman`）
- **项目描述**：AI 编码代理的控制平面，支持多会话管理、实时监控、移动端 Web UI、Respawn Controller 与长期自治运行
- **仓库地址**：`https://github.com/Ark0N/Codeman`
- **当前版本**：`0.4.4`

## 技术栈

- **语言**：TypeScript 5.9 + 少量原生 JavaScript（前端静态资源模块） <!-- 如: TypeScript 5.x, Java 17, Python 3.11 -->
- **前端框架**：无前端框架，采用原生浏览器 JavaScript + xterm.js 构建 Web UI <!-- 如: React 18, Vue 3.4, Next.js 14 -->
- **UI 组件库**：无传统 UI 组件库；主要依赖 xterm.js 与自定义界面模块 <!-- 如: Ant Design 5.x, Element Plus, shadcn/ui -->
- **状态管理**：前端采用自定义模块化状态/事件协作；后端采用进程内状态存储 <!-- 如: Zustand, Pinia, Redux Toolkit -->
- **后端框架**：Fastify 5.x <!-- 如: Spring Boot 3.x, Express, FastAPI, 无 -->
- **数据库**：无传统数据库，运行状态主要持久化到本地 JSON 文件 <!-- 如: MySQL 8.0, PostgreSQL 15, MongoDB, 无 -->
- **构建工具**：TypeScript 编译 + 自定义 `esbuild` 构建脚本 <!-- 如: Vite, Webpack 5, Turbopack -->
- **包管理器**：npm workspaces <!-- 如: pnpm, npm, yarn -->

## 项目结构

```text
src/
  index.ts                  # 应用入口
  cli.ts                    # CLI 入口
  web/                      # Web 服务、路由、SSE、静态前端资源
  session*.ts               # 会话生命周期与自动化控制
  respawn*.ts               # Respawn Controller 相关逻辑
  ralph*.ts                 # Ralph Loop / 任务跟踪相关逻辑
  config/                   # 服务端配置
  types/                    # 领域类型定义
  utils/                    # 通用工具
  prompts/                  # AI 提示词模板
  templates/                # 模板文件

test/
  routes/                   # API 路由测试
  e2e/                      # 端到端测试辅助
  *.test.ts                 # 核心单元/集成测试

mobile-test/
  *.test.ts                 # 移动端和可访问性测试
  helpers/                  # 浏览器与触控测试辅助

packages/
  xterm-zerolag-input/      # 本地零延迟输入插件包

docs/                       # 架构、方案、测试与设计文档
scripts/                    # 构建、运维、截图、辅助脚本
agent-teams/                # Agent Teams 相关说明与资源
```

## 设计规范

- **设计系统**：自定义 Web 控制台式界面，未发现独立设计系统或组件规范文件 <!-- 如: 内部设计系统 v2, Material Design, 无 -->
- **主色调**：无统一规范 <!-- 如: #1890ff -->
- **字体**：无统一规范 <!-- 如: PingFang SC, Inter -->
- **响应式断点**：明确支持移动端，但未发现统一断点配置文件 <!-- 如: 1440/1280/768/375 -->

## 编码规范

- **代码风格**：ESLint + Prettier + TypeScript strict 模式 <!-- 如: ESLint + Prettier, 团队规范文档链接 -->
- **命名约定**：文件名多使用 kebab-case；类型/类名使用 PascalCase；函数与变量使用 camelCase <!-- 如: 组件 PascalCase, hooks use 前缀, 文件 kebab-case -->
- **Git 分支策略**：`master` 为主分支，疑似 Trunk-based <!-- 如: Git Flow, Trunk-based -->
- **提交规范**：Conventional Commits 风格（如 `fix:`、`refactor:`、`chore:`） <!-- 如: Conventional Commits, 自定义格式 -->

## 业务领域

- **产品类型**：开发者工具 / AI 编码代理控制台 <!-- 如: B 端 SaaS, C 端 App, 内部工具 -->
- **核心业务**：为 AI 编码代理提供多会话管理、实时监控、移动端访问、任务续跑与长期自治运行能力。 <!-- 一句话描述核心业务 -->
- **目标用户**：使用 Claude Code、OpenCode 等 AI 编码工具的开发者、独立开发者和需要并行管理多个代理会话的技术团队。 <!-- 主要使用人群 -->

## 团队约束

- **Review 流程**：功能或架构改动通过 PR 合并，提交前需完成自测；重要改动建议至少 1 人 review。 <!-- 如: PR 需至少 1 人 review -->
- **测试要求**：CI 执行 `typecheck`、`lint`、`format:check`；本地使用 Vitest 单文件测试与 Playwright/mobile test 验证关键流程 <!-- 如: 核心逻辑需单测, E2E 覆盖主流程 -->
- **部署方式**：通过 Changesets + GitHub Actions Release 发布；生产环境构建后重启 `codeman-web` 服务 <!-- 如: CI/CD 自动部署, 手动发布 -->

## 补充说明

- 项目是 ESM-only，避免使用 `require()`。
- 会话与自动化运行强依赖 `tmux`，操作 tmux 时需要格外谨慎。
- 测试存在会话/终端副作用，通常只运行单个测试文件，不直接跑整套 `vitest run`。
- 产品名为 `Codeman`，npm 包名为 `aicodeman`。
