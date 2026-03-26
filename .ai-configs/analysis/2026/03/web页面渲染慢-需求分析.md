# Web 页面渲染慢与性能差 - 需求分析报告

**分析时间**：2026-03-20 22:31
**分析人员**：Codex
**项目版本**：0.4.4

---

## 1. 原始需求

**用户描述**：
当前 web 页面浏览器渲染很慢，然后性能比较差。

**需求类型**：功能优化 / 性能治理

---

## 2. 需求澄清

### 澄清的问题与答案
**Q1**: 这次问题更像首屏慢、切换页面慢，还是运行中越来越卡？
**A1**: 基于现有代码探索，三个阶段都可能受影响，但最明显的是初始化、切换 Session、SSE 高频更新期间的主线程阻塞。

**Q2**: 这次需求是否包含后端吞吐优化？
**A2**: 包含必要的后端事件负载控制，但核心瓶颈在前端渲染组织方式，而不是单纯接口慢。

**Q3**: 这次目标是“修一个点”还是“做一轮系统性性能治理”？
**A3**: 建议按系统性治理处理，因为当前问题是多条链路叠加，不是单点缺陷。

### 完善后的需求

**核心功能**：
降低 Codeman Web UI 的主线程占用和重绘频率，改善首屏初始化、Session 切换、终端流式输出、子代理面板更新时的卡顿与掉帧。

**使用场景**：
1. 用户打开 Codeman Web 页面，页面需要尽快完成可交互渲染。
2. 用户切换 Session、查看终端、观察子代理窗口和任务面板时，页面不应出现明显卡顿。
3. 会话高频输出、多个 subagent 活跃、多个面板可见时，浏览器仍应保持可操作。

**功能边界**：
- ✅ 包含：前端渲染链路分析、SSE 事件更新链路分析、终端渲染策略分析、性能治理建议分期
- ✅ 包含：必要的后端事件负载与 payload 影响分析
- ❌ 不包含：本次直接改代码
- ❌ 不包含：完整 PRD / 编码计划

**特殊要求**：
- 性能：降低长任务、减少全量重绘、控制高频事件下的 UI 更新成本
- 兼容性：保持现有桌面端与移动端行为，不破坏 xterm.js、SSE、subagent 相关能力
- 其他：优先保住“终端可用性”和“切 Session 响应性”

---

## 3. 代码探索发现

### 3.1 相关功能模块

1. 前端总入口与状态中心：`src/web/public/app.js`
   - 文件 2624 行，是 Web UI 的主控制器。
   - 负责 `init()`、`connectSSE()`、`handleInit()`、`selectSession()`、`renderSessionTabs()` 等核心流程。
   - 问题特征：初始化、SSE 订阅、Session 选择、Tab 重绘都集中在一个大控制器里，导致高频状态更新时容易互相影响。

2. 终端渲染链路：`src/web/public/terminal-ui.js`
   - 负责 xterm 初始化、WebGL、resize、流式写入、chunked buffer restore。
   - 已经做了一些保护，例如 `batchTerminalWrite()`、`flushPendingWrites()`、`chunkedTerminalWrite()`，说明此前已有明显卡顿问题。
   - 当前仍存在多次 `fit()`、`ResizeObserver`、`requestAnimationFrame`、大 buffer 恢复与 live SSE 竞争主线程的问题。

3. 面板渲染与子代理 UI：`src/web/public/panels-ui.js`
   - 文件 3284 行，承担任务面板、subagent panel、project insights、file browser、log viewer、monitor、system stats 等。
   - 多处使用 `innerHTML` 全量替换，且多个面板通过 SSE 高频触发渲染。

4. 子代理窗口与连线：`src/web/public/subagent-windows.js`
   - 负责浮动窗口、缩放拖拽、SVG connection lines。
   - `updateConnectionLines()` 会读取多个窗口和 tab 的布局，再整块重建 SVG path。
   - 当窗口多、tab 多、resize 或 subagent 高频活动时，这部分会持续吃布局和绘制成本。

5. 后端 SSE 与 session state：`src/web/server.ts`
   - 已有事件节流与 batching，例如 terminal 16-50ms 批量 flush、state update 500ms debounce。
   - 说明后端已有性能意识，但当前前端仍会把这些节流后的事件继续放大成多个视图更新。

### 3.2 参考实现与关键证据

1. 初始化链路已经存在“抢首帧”的痕迹，但后续仍然很重
   - `src/web/public/app.js:484` 的 `init()` 里，先做移动端初始化，再 `requestAnimationFrame(() => initTerminal(); connectSSE(); ...)`。
   - 这说明页面已经试图把重活延后一帧，但紧接着又会初始化终端、注册 SSE、加载 settings、quick-start、tunnel 状态等，首屏后很快重新压满主线程。

2. `handleInit()` 会在 SSE init/重连时清空并重建大量状态
   - `src/web/public/app.js:1320` 一段会清空多个 Map、清理 timer、重置 ResizeObserver、重建 subagent/window 状态，再 `renderSessionTabs()`、`renderSubagentPanel()`、恢复 active session。
   - 这意味着 SSE 重连不是轻量恢复，而是一次接近“前端软重启”的流程。

3. `selectSession()` 是高成本复合操作
   - `src/web/public/app.js:1960` 起，切换 Session 会：
   - 清理旧 WS / IME / 写队列 / 本地回显状态
   - 立即更新 tab active 状态并调度 tab render
   - 读取 terminal cache
   - 请求 `/api/sessions/:id/terminal?tail=131072`
   - 对 cachedBuffer / freshBuffer 执行 `terminal.clear()` + `terminal.reset()` + `chunkedTerminalWrite()`
   - 完成后再触发 resize、任务面板、Ralph、project insights、file browser、subagent visibility 等一批次级更新
   - 这是明显的串行重操作链路。

4. Tab 渲染虽然有 debounce，但仍然存在全量扫描和回退全量重建
   - `src/web/public/app.js:1530` `renderSessionTabs()` 固定 100ms debounce。
   - `src/web/public/app.js:1554` `_renderSessionTabsImmediate()` 每次会遍历所有 session，并对每个 tab 做 `querySelector`。
   - 一旦 badge 结构变化，就回退到 `src/web/public/app.js:1664` `_fullRenderSessionTabs()`，通过大块字符串拼接后 `container.innerHTML = parts.join('')` 整体重绘。
   - 这在 session 多、task/subagent badge 高频变化时成本会持续升高。

5. 终端渲染已经是热点，且仍可能阻塞
   - `src/web/public/terminal-ui.js:787` `batchTerminalWrite()` 使用 rAF 聚合。
   - `src/web/public/terminal-ui.js:929` `flushPendingWrites()` 单帧预算 64KB，超过则分帧写入，注释明确提到“141KB+ can freeze Chrome for 2+ minutes”。
   - `src/web/public/terminal-ui.js:1024` `chunkedTerminalWrite()` 将大 buffer 拆块跨帧恢复。
   - 这些保护说明终端写入本身就足以造成明显卡顿，现在的问题是终端写入还与其他面板更新共享同一主线程。

6. resize 是另一个高风险热路径
   - `src/web/public/terminal-ui.js:233-304` 中，window resize + `ResizeObserver` 最终会触发 `fitAddon.fit()`、清空视口、发 resize API、更新 connection lines、rerender local echo。
   - 即使做了 300ms trailing debounce，最终一次 resize 仍然绑定多个重布局动作。

7. `panels-ui.js` 存在多处全量 `innerHTML` 重绘
   - 任务面板：`src/web/public/panels-ui.js:623`
   - Subagent panel：`src/web/public/panels-ui.js:731`
   - Project insights：`src/web/public/panels-ui.js:2192`
   - File browser tree：`src/web/public/panels-ui.js:2315`
   - Mux sessions：`src/web/public/panels-ui.js:2984`
   - Log viewer 流式输出甚至直接 `body.innerHTML += content`：`src/web/public/panels-ui.js:2662`
   - 这些模式都会导致频繁的 DOM 解析、节点销毁重建、样式重算。

8. 子代理连线会放大 layout 成本
   - `src/web/public/subagent-windows.js:230` `updateConnectionLines()` 做背景调度。
   - `src/web/public/subagent-windows.js:243` 开始批量 `getBoundingClientRect()`，随后 `svg.innerHTML = ''`，再逐条 `appendChild(path)` 重建。
   - 设计上已经避免读写交错，但当窗口数上升时，仍然是稳定的高成本布局+SVG 重绘操作。

9. 前端存在额外的固定频率轮询
   - `src/web/public/app.js:80` 每 2 秒写一次 crash heartbeat 到 `localStorage` 并尝试 `sendBeacon`
   - `src/web/public/panels-ui.js:3213` system stats 每 2 秒 `fetch('/api/system/stats')`
   - 这些不是主瓶颈，但会持续增加后台噪音，尤其在资源紧张设备上。

10. 后端已经做了部分优化，但 payload 仍然偏重
   - `src/web/server.ts:2063` terminal 数据按 session 独立 batch，16/32/50ms 自适应 flush。
   - `src/web/server.ts:2186` `session:updated` 做 500ms debounce。
   - 但 `src/session.ts:840` `toLightDetailedState()` 依然包含 `bufferStats`、`taskStats`、`taskTree`、tokens、respawn 配置等，不算小对象。
   - 当前端对每个 `session:updated` 都连带 tab/panel 逻辑时，后端节流收益会被前端重新放大。

### 3.3 关键工具和库

- `@xterm/xterm@^6.0.0`
- `@xterm/addon-fit@^0.11.0`
- `@xterm/addon-webgl@^0.19.0`
- 原生 `EventSource`
- 原生浏览器 JS，无 React/Vue 这类组件级 diff 机制
- 原生 `ResizeObserver` / `requestAnimationFrame` / `scheduler.postTask(background)` 包装

### 3.4 技术架构分析

1. 当前前端属于“单大控制器 + 多个 mixin 文件”的架构
   - 优点：实现快、文件内可直接互调
   - 缺点：更新边界不清晰，任何状态变更都容易触发多个视图跟着动

2. 渲染层主要依赖字符串模板和 DOM 手工更新
   - 对简单场景足够直接
   - 但在高频实时场景下，缺少组件粒度订阅、memo、虚拟列表、最小差量 patch 机制

3. Web 端同时承载三类重负载
   - xterm canvas / WebGL 渲染
   - 高频 SSE 驱动的数据面板渲染
   - 多浮窗、多连线、拖拽、resize 的布局计算

4. 这三类负载都在主线程竞争
   - 当前代码虽有 debounce/rAF/background task，但没有统一的更新优先级系统
   - 终端写入与面板/连线重绘仍会互相抢占帧预算

### 3.5 探索过程记录

- ⏱️ 22:31 确认项目上下文完整，技术栈为原生浏览器 JS + xterm.js + Fastify
- ⏱️ 22:31 确认 `src/web/public/app.js` 2624 行，是前端主控制器
- ⏱️ 22:31 确认 `terminal-ui.js`、`panels-ui.js`、`subagent-windows.js` 为主要渲染链路
- ⏱️ 22:31 发现 `renderSessionTabs()`、`renderTaskPanel()`、`renderSubagentPanel()`、`renderMuxSessions()` 都依赖 debounce + DOM 重绘
- ⏱️ 22:31 发现 `selectSession()` 会触发 terminal buffer 恢复、次级 panel 更新、file browser 加载、WS 连接等复合操作
- ⏱️ 22:31 发现 `flushPendingWrites()`、`chunkedTerminalWrite()` 已包含“Chrome freeze / WebGL stall”防御代码，说明终端渲染是既有热点
- ⏱️ 22:31 发现 `updateConnectionLines()` 每次都会批量读布局并全量重建 SVG 连接线
- ⏱️ 22:31 发现后端已做 terminal batching 和 session state debounce，但前端更新链路仍偏粗

---

## 4. 影响面分析

### 4.1 直接影响范围

**核心前端文件**
- `src/web/public/app.js`
- `src/web/public/terminal-ui.js`
- `src/web/public/panels-ui.js`
- `src/web/public/subagent-windows.js`
- `src/web/public/index.html`
- `src/web/public/constants.js`

**后端配套文件**
- `src/web/server.ts`
- `src/session.ts`
- `src/config/server-timing.ts`

### 4.2 间接影响范围

1. 交互体验
   - 首屏 skeleton 到可用状态的耗时
   - 切换 session 时的白屏/闪烁/卡顿
   - 终端流式输出时的滚动与输入响应

2. 子系统联动
   - task panel
   - subagent panel / subagent windows
   - project insights
   - file browser
   - mux/monitor/system stats

3. 浏览器资源
   - 主线程长任务
   - layout / style recalc
   - DOM 节点创建销毁
   - canvas / WebGL 负载
   - 内存占用与 GC 压力

4. 网络与事件负载
   - SSE 事件密度
   - `/api/system/stats` 轮询
   - `/api/sessions/:id/terminal` 切换时的 buffer 拉取

### 4.3 风险点

1. 终端优先级不足
   - 如果性能优化只做“减少渲染”而没有明确终端优先级，可能让 terminal 输入/输出延迟更明显。
   - 缓解：把 terminal write 视为最高优先级，面板和连线降级。

2. 过度裁剪 state/payload 导致 UI 缺信息
   - `session:updated` 当前承担多个 UI 的共享输入。
   - 缓解：先加观测，再拆 payload；不要一次性删字段。

3. 手工 DOM 优化容易引入一致性问题
   - 当前很多逻辑依赖 `innerHTML` 后重新绑定事件。
   - 缓解：先做“更新频率治理”，再做“DOM 结构重构”。

4. xterm/WebGL 改动有回归风险
   - 终端是核心能力，任何 flush / fit / renderer 策略改动都可能影响显示正确性。
   - 缓解：优先补性能场景验证，再动渲染细节。

5. 子代理与浮窗逻辑耦合深
   - connection lines、window restore、minimize、teammate terminal 是一套链路。
   - 缓解：先限制更新频率，再考虑重构数据结构。

---

## 5. 可行性评估

### 5.1 技术可行性
**结论**：✅ 可行，但需要分阶段治理

当前代码库已经具备一部分性能治理基础：
- 已有 terminal batching
- 已有 session state debounce
- 已有 requestAnimationFrame / background scheduler
- 已有部分增量更新思路

说明不是“从零开始救火”，而是在现有基础上继续收敛。

建议技术路线：
1. 先加观测与限流
   - 精确统计 `selectSession()`、`renderSessionTabs()`、`updateConnectionLines()`、`_renderSubagentPanelImmediate()`、`renderTaskPanel()` 耗时与频次
   - 区分“事件太多”还是“单次渲染太重”

2. 再做更新分级
   - P0：终端输出、active tab 切换
   - P1：task/subagent/project insights
   - P2：connection lines、monitor、system stats

3. 最后做结构优化
   - 拆大 payload
   - 拆大面板
   - 引入虚拟列表 / DOM 缓存 / 更稳定的增量更新

### 5.2 工作量评估
**功能复杂度**：复杂
**预估时间**：3-6 天
**关键影响因素**：
- 是否只做卡点优化，还是做完整治理
- 当前真实在线使用规模：session 数、subagent 数、终端输出密度
- 是否需要补性能测试脚本与回归验证

建议分段估算：
- 第 1 段：观测与止血，0.5-1.5 天
- 第 2 段：tab/panel/connection lines 更新治理，1-2 天
- 第 3 段：selectSession / terminal / payload 深度优化，1.5-2.5 天

### 5.3 优先级建议
**优先级**：🔴 P0

原因：
- 问题直接影响核心使用体验
- 当前代码里已经出现多处“freeze / stall / performance”防御注释，说明问题真实存在且不是边缘场景
- 一旦 session/subagent 数量上升，性能退化会继续放大

---

## 6. 下一步建议

### 推荐方案

推荐按三阶段实施：

**阶段 A：观测与止血**
- 给 `selectSession()`、`_renderSessionTabsImmediate()`、`renderTaskPanel()`、`_renderSubagentPanelImmediate()`、`_updateConnectionLinesImmediate()` 增加耗时埋点
- 给高频 SSE handler 做“是否真的影响当前视图”的短路
- 暂时降低低优先级更新频率，例如 system stats、connection lines、非可见 panel

**阶段 B：渲染拆分**
- 把 Session tab 更新拆成更稳定的最小 patch，避免回退全量 `innerHTML`
- task/subagent/project insights 改为可见时渲染，且优先增量 append，不做整块替换
- 子代理连线增加更强的 coalescing，只在位置实际变化时重绘

**阶段 C：架构收敛**
- 收缩 `session:updated` 负载，按 UI 关注点拆状态
- 对 file browser / subagent activity / log viewer 引入虚拟化或更严格的窗口化
- 重新审视 `selectSession()` 串行流程，拆分“必须立即完成”和“空闲时补齐”的工作

### 关键决策点
1. 是否接受先做一轮“观测 + 限流 + 渲染分级”，而不是直接重构整个前端
2. 是否接受将低优先级 UI 延后 100-300ms，以换取 terminal 与切 tab 立即响应
3. 是否接受对 file browser / subagent / log viewer 做可见区窗口化，减少一次性 DOM 量

### 后续流程
✅ 需求分析完成
⬇️
📋 下一步：运行 `/create-plan` 生成性能治理编码计划
⬇️
💻 然后：运行 `/code-by-plan` 分阶段实施

---

## 附录

### A. 关键代码位置索引
- `src/web/public/app.js:484` - 前端初始化入口
- `src/web/public/app.js:662` - SSE 连接与事件注册
- `src/web/public/app.js:1320` - `handleInit()` 清理与重建状态
- `src/web/public/app.js:1530` - `renderSessionTabs()`
- `src/web/public/app.js:1554` - `_renderSessionTabsImmediate()`
- `src/web/public/app.js:1664` - `_fullRenderSessionTabs()`
- `src/web/public/app.js:1960` - `selectSession()` 重操作链路
- `src/web/public/terminal-ui.js:233` - resize 处理
- `src/web/public/terminal-ui.js:787` - `batchTerminalWrite()`
- `src/web/public/terminal-ui.js:929` - `flushPendingWrites()`
- `src/web/public/terminal-ui.js:1024` - `chunkedTerminalWrite()`
- `src/web/public/panels-ui.js:623` - 任务面板重绘
- `src/web/public/panels-ui.js:731` - subagent panel 重绘
- `src/web/public/panels-ui.js:1368` - subagent window render 调度
- `src/web/public/panels-ui.js:2192` - project insights 重绘
- `src/web/public/panels-ui.js:2315` - file browser tree 重绘
- `src/web/public/panels-ui.js:2662` - log viewer SSE 流式 `innerHTML +=`
- `src/web/public/panels-ui.js:3213` - system stats 轮询
- `src/web/public/subagent-windows.js:230` - 连线更新调度
- `src/web/public/subagent-windows.js:243` - 连线布局读取与 SVG 重建
- `src/web/server.ts:1872` - 轻量 sessions state 缓存
- `src/web/server.ts:1930` - SSE init light state 组装
- `src/web/server.ts:2063` - terminal 数据 batching
- `src/web/server.ts:2186` - session state debounce
- `src/session.ts:840` - `toLightDetailedState()` 载荷组成

### B. 参考文档
- `.ai-configs/project-context.md`
- `package.json`
- `src/config/server-timing.ts`

### C. 结论摘要
- 当前问题不是单一 bug，而是实时终端场景下的系统性性能退化。
- 主因是：高频 SSE + 终端写入 + 多面板/浮窗/连线重绘同时争抢主线程。
- 最合适的下一步不是直接写 PRD，而是先生成一份编码计划，按“观测止血 → 渲染拆分 → 架构收敛”推进。
