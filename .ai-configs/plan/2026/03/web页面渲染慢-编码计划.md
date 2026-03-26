# Web 页面渲染慢与性能差 - 编码计划

**创建时间**：2026-03-20
**基于需求分析**：`.ai-configs/analysis/2026/03/web页面渲染慢-需求分析.md`
**基于 PRD**：无
**项目版本**：0.4.4

---

## 0. 功能概述

> **需求详情**: `.ai-configs/analysis/2026/03/web页面渲染慢-需求分析.md`
> **产品需求**: 无，本计划直接基于需求分析执行

### 0.1 功能目标
本次目标是降低 Web UI 主线程阻塞，优先改善首屏初始化、Session 切换、终端流式输出和子代理相关面板的卡顿。实施顺序遵循“先观测止血，再优化热路径，最后清理次级渲染链路”。所有优化都以保持终端可用性和现有功能兼容为前提。

核心功能点:
- 建立前端性能观测和更新优先级边界
- 优化 `selectSession`、terminal write、session tabs 的热点路径
- 收敛 task/subagent/project insights/file browser/log viewer/connection lines 的低优先级重绘

### 0.2 用户约束条件
- 保持现有桌面端与移动端行为，不破坏 xterm.js、SSE、subagent 相关能力
- 优先保住终端可用性和切 Session 响应性
- 本轮以性能治理为主，不引入大规模前端框架迁移

### 0.3 根本原因分析
> 详细分析见需求分析报告第 3-5 节

**简要说明**:
- 表面现象：页面初始化、切换 Session、SSE 高频更新期间明显卡顿
- 根本原因：终端写入、Session 切换、面板重绘、SVG 连线与轮询任务在主线程上同时竞争帧预算
- 证据：`src/web/public/app.js:1960`、`src/web/public/terminal-ui.js:929`、`src/web/public/panels-ui.js:731`、`src/web/public/subagent-windows.js:243`

### 0.4 参考实现（纯索引表）

> **完整探索结果**: 详见需求分析报告第 3 节

| 参考点 | 位置（文件:行号） | 用途 |
|-------|-----------------|------|
| 前端初始化入口 | `src/web/public/app.js:484` | 确定首屏重任务拆分位置 |
| SSE 事件连接 | `src/web/public/app.js:662` | 收敛高频事件入口与 listener fan-out |
| Session 切换热路径 | `src/web/public/app.js:1960` | 拆分立即任务与延迟任务 |
| Session tabs 渲染 | `src/web/public/app.js:1530` | 优化 tab render 频率与 patch 粒度 |
| Terminal 流式写入 | `src/web/public/terminal-ui.js:787` | 优化 live output 调度 |
| Terminal flush | `src/web/public/terminal-ui.js:929` | 控制单帧写入预算 |
| Buffer 恢复 | `src/web/public/terminal-ui.js:1024` | 优化切换时大 buffer 恢复 |
| Task panel 渲染 | `src/web/public/panels-ui.js:623` | 优化可见时渲染与增量更新 |
| Subagent panel 渲染 | `src/web/public/panels-ui.js:731` | 降低高频 subagent 事件成本 |
| Project insights 渲染 | `src/web/public/panels-ui.js:2192` | 限制低优先级面板刷新 |
| Log viewer 流式追加 | `src/web/public/panels-ui.js:2662` | 替换高成本 `innerHTML +=` 模式 |
| Connection lines 更新 | `src/web/public/subagent-windows.js:230` | 控制布局读取和 SVG 重绘频率 |
| SSE terminal batch | `src/web/server.ts:2063` | 后端 terminal batching 调整点 |
| Session state debounce | `src/web/server.ts:2186` | 后端 session 更新节流边界 |
| 轻量 Session payload | `src/session.ts:840` | 收缩 session:updated 载荷 |

---

## 1. 技术方案

> **技术决策依据**: 见需求分析报告第 3-5 节
> **探索发现**: 见需求分析报告第 3-4 节

### 1.1 整体架构
**技术栈**:
- 原生浏览器 JavaScript
- xterm.js + fit/webgl addon
- Fastify + SSE + WebSocket terminal I/O

**模块划分**:
- `app.js` 负责初始化、SSE、Session 选择、Tab 渲染
- `terminal-ui.js` 负责 terminal 渲染与 resize
- `panels-ui.js` / `subagent-windows.js` 负责次级面板、浮窗、连线
- `server.ts` / `session.ts` 负责 SSE batching、状态载荷与节流

### 1.2 前端实现方案
**原则**:
- 终端写入最高优先级
- active session / active tab 其次
- 次级面板、monitor、连线、轮询降为低优先级

**核心策略**:
- 给关键路径增加性能埋点，先量化再调参
- 把 `selectSession()` 拆成同步可交互阶段与空闲补全阶段
- 减少 `innerHTML` 全量替换，优先做可见区渲染、增量 patch、dirty-check
- 对 connection lines、system stats、hidden panel 做更强 coalescing

### 1.3 后端技术方案
**主要接口 / 事件**:
- `GET /api/events`
- `GET /api/sessions/:id/terminal`
- `GET /api/system/stats`
- `session:terminal`
- `session:updated`
- `task:*`
- `subagent:*`

**后端调整方向**:
- 保持 terminal batching 机制
- 视结果收缩 `session:updated` 载荷或拆分低价值字段
- 为客户端观测与调参保留可控常量

---

## 2. 实现步骤（Phase 复选框格式）

### Phase 1: 观测与止血

- [ ] **步骤 1.1**: 建立性能观测点
  - **目标**: 为热点链路建立可对比的耗时与频次指标
  - **涉及文件**:
    - `src/web/public/app.js` - 修改
    - `src/web/public/terminal-ui.js` - 修改
    - `src/web/public/panels-ui.js` - 修改
    - `src/web/public/subagent-windows.js` - 修改
  - **具体任务**:
    - [ ] 为 `handleInit`、`selectSession`、tab render、panel render、connection line render 增加统一耗时埋点
    - [ ] 区分“调用次数”与“单次耗时”，避免只看到长任务看不到风暴型更新
    - [ ] 保持埋点默认低噪音，可通过开关启用详细日志
  - **依赖**: 无
  - **验收**: 可以定位首屏、切换 Session、SSE 高频更新期间的主要耗时来源
  - **预计时间**: 2 小时

- [ ] **步骤 1.2**: 增加低优先级更新短路与合并
  - **目标**: 先压住非关键视图的重绘频率
  - **涉及文件**:
    - `src/web/public/app.js` - 修改
    - `src/web/public/panels-ui.js` - 修改
    - `src/web/public/subagent-windows.js` - 修改
    - `src/web/public/constants.js` - 修改
  - **具体任务**:
    - [ ] 为 hidden panel、inactive panel、不可见浮窗添加早返回
    - [ ] 统一低优先级调度常量，避免各处各自 `setTimeout`
    - [ ] 暂时降低 connection lines 和 system stats 的刷新侵入性
  - **依赖**: 步骤 1.1
  - **验收**: 不打开相关面板时，不再发生对应的高频 DOM 重绘
  - **预计时间**: 2 小时

- [ ] **步骤 1.3**: 收敛状态载荷边界
  - **目标**: 为后续前后端协同优化建立清晰边界
  - **涉及文件**:
    - `src/web/server.ts` - 修改
    - `src/session.ts` - 修改
    - `src/config/server-timing.ts` - 修改
  - **具体任务**:
    - [ ] 复核 `session:updated` 载荷中的高频但低价值字段
    - [ ] 让节流常量和阈值可统一调整
    - [ ] 确保前端优化前后 payload 结构稳定，不先引入兼容性破坏
  - **依赖**: 步骤 1.1
  - **验收**: 热路径事件的载荷与发送频率有明确、可调的控制点
  - **预计时间**: 2 小时

**Phase 1 进度**: ⬜⬜⬜ 0/3 (0%)

---

### Phase 2: Session 与 Terminal 热路径优化

- [ ] **步骤 2.1**: 拆分 `selectSession()` 执行阶段
  - **目标**: 优先保证切换后尽快可交互，再延迟次级任务
  - **涉及文件**:
    - `src/web/public/app.js` - 修改
    - `src/web/public/terminal-ui.js` - 修改
  - **具体任务**:
    - [ ] 把 active tab 切换、terminal 可视反馈、buffer 恢复、次级 panel 刷新拆成前后两段
    - [ ] 避免切换期间同步触发 file browser、project insights、subagent visibility 等重任务
    - [ ] 为 stale generation / 快速切换场景保留取消机制
  - **依赖**: Phase 1
  - **验收**: 快速切换 Session 时，活动 tab 和 terminal 响应明显快于次级面板更新
  - **预计时间**: 4 小时

- [ ] **步骤 2.2**: 优化 terminal restore / flush / resize 协同
  - **目标**: 降低 terminal buffer 恢复和 live output 对主线程的持续阻塞
  - **涉及文件**:
    - `src/web/public/terminal-ui.js` - 修改
    - `src/web/public/app.js` - 修改
  - **具体任务**:
    - [ ] 复核 `chunkedTerminalWrite`、`flushPendingWrites`、`_finishBufferLoad` 的调度顺序
    - [ ] 避免 resize、buffer restore、live SSE 同时争抢帧预算
    - [ ] 保持 xterm/WebGL 回退路径稳定
  - **依赖**: 步骤 2.1
  - **验收**: 大 buffer 恢复、持续输出、窗口 resize 并发时，不再出现明显卡死或长时间掉帧
  - **预计时间**: 5 小时

- [ ] **步骤 2.3**: 收敛 Session tabs 更新风暴
  - **目标**: 避免 `session:updated`、task/subagent 事件把 tab 区域反复推入全量重绘
  - **涉及文件**:
    - `src/web/public/app.js` - 修改
    - `src/web/public/panels-ui.js` - 修改
  - **具体任务**:
    - [ ] 稳定 incremental tab patch，减少回退 `_fullRenderSessionTabs()` 的次数
    - [ ] 合并来自 hook/task/subagent 的 tab badge 更新
    - [ ] 只在结构变化时重建 tab DOM，其余场景保持属性级更新
  - **依赖**: 步骤 2.1
  - **验收**: 多 session、多 task/subagent 活跃时，tab 区域不再频繁整块 `innerHTML` 重建
  - **预计时间**: 4 小时

**Phase 2 进度**: ⬜⬜⬜ 0/3 (0%)

---

### Phase 3: 次级面板与浮窗渲染收敛

- [ ] **步骤 3.1**: 优化 task / subagent / project insights 面板
  - **目标**: 降低高频 SSE 对次级面板 DOM 的冲击
  - **涉及文件**:
    - `src/web/public/panels-ui.js` - 修改
    - `src/web/public/app.js` - 修改
  - **具体任务**:
    - [ ] task panel 改为可见时刷新，并优先做增量更新
    - [ ] subagent panel 仅在选中、可见或数据 dirty 时重绘
    - [ ] project insights 只在 active session 和面板可见时更新
  - **依赖**: Phase 2
  - **验收**: 次级面板关闭或不可见时，对主线程影响显著下降
  - **预计时间**: 4 小时

- [ ] **步骤 3.2**: 优化 file browser 与 log viewer
  - **目标**: 处理大列表和流式文本的高成本 DOM 模式
  - **涉及文件**:
    - `src/web/public/panels-ui.js` - 修改
  - **具体任务**:
    - [ ] file browser 避免每次过滤或展开都整棵树重建
    - [ ] log viewer 替换 `innerHTML +=` 模式，改为更可控的 append/trim 方案
    - [ ] 为流式内容增长设置清晰的内存与节点上限
  - **依赖**: Phase 1
  - **验收**: 长日志流和大文件树操作时，页面仍保持基本流畅
  - **预计时间**: 4 小时

- [ ] **步骤 3.3**: 收敛 connection lines 与子代理浮窗更新
  - **目标**: 只在位置真实变化时执行布局读取和 SVG 重绘
  - **涉及文件**:
    - `src/web/public/subagent-windows.js` - 修改
    - `src/web/public/panels-ui.js` - 修改
  - **具体任务**:
    - [ ] 加强 `updateConnectionLines` 的 dirty-check 与 coalescing
    - [ ] 避免无关 subagent 事件触发整轮 rect 读取
    - [ ] 维持拖拽、缩放、最小化、恢复场景的正确性
  - **依赖**: 步骤 1.2
  - **验收**: 子代理窗口较多时，连线更新不再成为稳定的布局热点
  - **预计时间**: 4 小时

**Phase 3 进度**: ⬜⬜⬜ 0/3 (0%)

---

### Phase 4: 验证、回归保护与交付

- [ ] **步骤 4.1**: 补充热路径回归验证
  - **目标**: 防止性能优化引入功能回归
  - **涉及文件**:
    - `test/` - 修改
    - `mobile-test/` - 修改
    - 相关前端文件 - 如有必要修改
  - **具体任务**:
    - [ ] 为 Session 切换、terminal resize、subagent 窗口、hidden panel 短路补关键测试
    - [ ] 优先增加不会引入会话副作用的轻量测试
    - [ ] 明确哪些性能验证只能人工完成
  - **依赖**: Phase 2-3
  - **验收**: 核心交互链路有自动化或半自动回归保护
  - **预计时间**: 3 小时

- [ ] **步骤 4.2**: 形成性能验收清单
  - **目标**: 让优化结果可以复测、复用、复盘
  - **涉及文件**:
    - `docs/` 或 `.ai-configs/plan/` 辅助文档 - 修改
  - **具体任务**:
    - [ ] 记录 before/after 对比指标
    - [ ] 输出手工验证场景：首屏、切 Session、持续输出、多 subagent、resize、移动端
    - [ ] 说明已调参数和保留开关
  - **依赖**: 步骤 4.1
  - **验收**: 团队可按固定步骤复测性能收益与兼容性
  - **预计时间**: 2 小时

- [ ] **步骤 4.3**: 清理临时保护与收尾
  - **目标**: 保持优化后的代码可维护
  - **涉及文件**:
    - `src/web/public/app.js` - 修改
    - `src/web/public/terminal-ui.js` - 修改
    - `src/web/public/panels-ui.js` - 修改
    - `src/web/public/subagent-windows.js` - 修改
    - `src/web/server.ts` - 修改
  - **具体任务**:
    - [ ] 清理仅用于排查的噪音日志
    - [ ] 保留必要的性能埋点和可控开关
    - [ ] 对新增常量、调度边界、优先级策略补充注释
  - **依赖**: 步骤 4.1、4.2
  - **验收**: 代码中保留的诊断能力足够，但不会制造新的运行时噪音
  - **预计时间**: 2 小时

**Phase 4 进度**: ⬜⬜⬜ 0/3 (0%)

---

### 总体进度追踪

```text
Phase 1: ⬜⬜⬜ 0/3 (0%)
Phase 2: ⬜⬜⬜ 0/3 (0%)
Phase 3: ⬜⬜⬜ 0/3 (0%)
Phase 4: ⬜⬜⬜ 0/3 (0%)
━━━━━━━━━━━━━━━━━━━━
总进度: 0/12 (0%)
```

---

## 3. 风险评估

> **技术风险**: 详见需求分析报告第 4.3 节
> **产品风险**: 当前无独立 PRD，按需求分析约束执行

### 3.1 实施层面风险

1. 优化顺序错误
   - 如果先大改结构、不先建立观测，容易反复返工。
   - 应对：严格按 Phase 顺序推进，先量化热点。

2. 终端链路回归
   - terminal restore、resize、WebGL 调整容易影响显示正确性。
   - 应对：把 terminal 相关改动集中在同一 Phase，并补 focused 验证。

3. 多模块并发改动冲突
   - `app.js`、`terminal-ui.js`、`panels-ui.js`、`subagent-windows.js` 耦合高。
   - 应对：以“优先级边界”和“可见性边界”作为统一策略，减少各自临时 patch。

4. 优化后收益不明显
   - 如果真实问题主要来自少数极端场景，盲目全域优化性价比低。
   - 应对：Phase 1 先输出基线指标，后续按指标驱动裁剪范围。

5. 测试副作用
   - 项目存在 tmux/terminal 会话副作用，整套测试不能随意全跑。
   - 应对：优先单文件验证与人工性能回放，不直接跑全量 `vitest run`。

---

## 4. 验收标准

- 首屏加载后，关键交互元素可用时间明显早于次级面板加载完成时间。
- 快速切换多个 Session 时，active tab 与 terminal 主视图响应明显快于优化前。
- 持续 terminal 输出、多个 subagent 活跃时，页面不出现长时间无响应或明显冻结。
- 隐藏的 panel / monitor / connection lines 不再持续触发高频重绘。
- log viewer、file browser、subagent panel 在大数据量场景下不再使用高风险的全量重建路径。
- 核心行为不回归：terminal 输入输出、resize、subagent window、移动端交互保持正常。
- 交付时提供 before/after 性能指标与手工验收步骤。

---

## 附录

### A. 相关文档
- **需求分析报告**: `.ai-configs/analysis/2026/03/web页面渲染慢-需求分析.md`
- **PRD 文档**: 无
- **项目配置**: `.ai-configs/project-context.md`

### B. 关键代码位置索引
> 详见需求分析报告附录 A
