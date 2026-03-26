# Web 页面渲染慢与性能差 - 执行进度

**开始时间**：2026-03-20 22:51
**编码计划**：`.ai-configs/plan/2026/03/web页面渲染慢-编码计划.md`
**执行人员**：Codex

---

## 执行日志

### Session 1 (2026-03-20 22:51 - 23:07)

✅ **准备阶段**: 读取计划、上下文并建立执行跟踪
- 操作：读取编码计划、项目上下文、progress 模板和实施指南；检查当前工作区状态
- 文件：`.ai-configs/plan/2026/03/web页面渲染慢-编码计划.md`、`.ai-configs/project-context.md`
- 结果：约束条件已确认，当前实施顺序锁定为 Phase 1 → 首批热路径优化 → 构建验证
- 耗时：5 分钟

✅ **步骤 1.1**: 建立统一性能观测点
- 操作：新增统一性能埋点和统计记录能力，为 `handleInit`、`selectSession`、tab render、task panel、subagent panel、project insights、connection lines、terminal flush/chunk write 建立观测点
- 文件：`src/web/public/app.js`、`src/web/public/terminal-ui.js`、`src/web/public/panels-ui.js`、`src/web/public/subagent-windows.js`、`src/web/public/constants.js`
- 结果：关键热点链路已有统一 `PERF` 指标输出入口，支持 query/localStorage 开关
- 耗时：18 分钟

✅ **步骤 1.2 / 3.3**: 增加低优先级更新短路与合并
- 操作：引入统一 deferred work 调度；为 hidden panel、monitor、connection lines、system stats 增加短路或更强合并
- 文件：`src/web/public/app.js`、`src/web/public/constants.js`、`src/web/public/panels-ui.js`、`src/web/public/subagent-windows.js`
- 结果：低优先级 UI 更新不再无条件参与主线程竞争，connection lines 改为合并调度并在无窗口时直接退出
- 耗时：16 分钟

✅ **步骤 1.3**: 收敛状态载荷边界
- 操作：移除高频 `session:updated` 中未被前端消费的 `bufferStats`
- 文件：`src/session.ts`
- 结果：减少高频 session 状态 payload 的冗余字段
- 耗时：3 分钟

✅ **步骤 2.1**: 拆分 `selectSession()` 执行阶段
- 操作：将次级面板更新与 file browser 加载从 terminal 主链路中拆出，改为延后调度；补充 file browser 拖拽初始化复用
- 文件：`src/web/public/app.js`、`src/web/public/panels-ui.js`
- 结果：切换 Session 后优先恢复 active tab/terminal，次级 UI 延后进入
- 耗时：17 分钟

✅ **步骤 2.3 / 3.1 / 3.2（部分）**: 收敛 tabs 与次级面板重复重绘
- 操作：为 session tabs 增加状态签名短路；task/subagent/project insights 改为可见时或低优先级调度；log viewer 改用 text node append，file browser 加入请求代际保护
- 文件：`src/web/public/app.js`、`src/web/public/panels-ui.js`
- 结果：重复状态下的 tab render 可以直接跳过，次级面板和流式日志的重绘成本下降
- 耗时：17 分钟

✅ **验证**: 构建通过
- 操作：执行两轮 `npm run build`
- 文件：全项目
- 结果：TypeScript、打包、前端资源构建全部成功
- 耗时：10 分钟

🔄 **剩余优化**: 继续推进
- 操作：Phase 2.2 的 terminal/resize 协同和更深入的面板差量更新尚可继续收敛
- 当前状态：当前版本已经止血并通过构建，后续可在同一计划上继续推进

### Session 2 (2026-03-20 23:07 - 23:32)

✅ **步骤 2.2**: 优化 terminal restore / flush / resize 协同
- 操作：新增 terminal busy/settle 协同状态，统一 `scheduleTerminalResize()` 调度入口；让 `flushPendingWrites()`、`chunkedTerminalWrite()` 在 resize 或 buffer restore 刚发生时自动延后，避免与 `fit()` / SIGWINCH 同帧竞争
- 文件：`src/web/public/constants.js`、`src/web/public/app.js`、`src/web/public/terminal-ui.js`
- 结果：Session 切换后的 resize、持续 SSE 输出、buffer 恢复和窗口 resize 不再直接抢同一帧预算；切换/重连清理逻辑也会取消陈旧的 terminal flush/resize 调度
- 耗时：17 分钟

✅ **步骤 3.2（补强）**: 收敛 file browser 重复重绘
- 操作：为 file browser tree 增加 render signature 短路、单次事件委托和相同 filter 输入早返回；保留现有行为但减少无变化时的整棵树重复重建与事件重复绑定
- 文件：`src/web/public/app.js`、`src/web/public/panels-ui.js`
- 结果：同一份文件树在无状态变化时不再重复全量 `innerHTML` 重建，file browser 的重复渲染成本进一步下降
- 耗时：8 分钟

✅ **验证**: 构建再次通过
- 操作：执行第 3 轮 `npm run build`
- 文件：全项目
- 结果：新增 terminal / file browser 优化后仍可正常通过 TypeScript、前端资源打包与压缩
- 耗时：4 分钟

---

## 错误记录

暂无

---

## 测试结果

### 构建测试
- ✅ `npm run build` - 成功（累计执行 3 次，均通过）

### 单元测试
- ⚠️ 未执行：当前任务以构建与前端性能治理为主；仓库存在会话/终端副作用，本轮未跑整套测试

### 功能测试
- ⚠️ 未执行：本轮未启动浏览器做人工性能回放

---

## 待办事项

- [ ] 补手工性能验收：首屏、切 Session、多 subagent、持续输出、窗口 resize 并发
- [ ] 视人工回放结果决定是否继续做 file browser 树级增量 patch
- [ ] 视验证结果决定是否继续压缩 `session:updated` 载荷

---

## 进度统计

- **总步骤数**：12
- **已完成**：8
- **进行中**：1
- **待执行**：3
- **完成度**：67%
- **预计剩余时间**：1-2 小时
