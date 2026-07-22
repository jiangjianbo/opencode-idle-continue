# opencode-idle-continue

本项目是 opencode 的一个插件，实现"空闲时自动继续处理"的功能。

## 工作原理

本插件支持两种工作模式：

### 模式 1：传统模式（默认）

1. **空闲检测**：监控系统空闲状态。当 opencode 处于空闲状态时触发后续逻辑。
2. **发送提示词**：从指定的 markdown 文件中读取提示内容并发送给 opencode 继续处理。
3. **提示词热重载**：每次使用 `prompt_file` 时检查文件是否已修改。未修改则使用缓存内容，已修改则重新读入并更新缓存，无需重启插件。
4. **文件变更监控**：维护一个检测文件列表，监控这些文件的内容/时间戳是否变化。
5. **等待状态**：如果发送提示词后检测文件列表中的文件没有变化，则进入等待状态。等待状态需要同时满足：
   - 系统持续空闲
   - 检测文件列表中的文件没有改变
6. **间隔退避**：在等待状态下，每隔一定时间间隔（默认 30 分钟）发送一次提示词。如果连续 5 次检测仍然处于空闲状态（文件未变化），则下一次的等待间隔翻倍。

### 模式 2：子代理模式

1. **空闲检测**：同传统模式，监控系统空闲状态。
2. **延迟执行**：检测到真正空闲后等待指定时间（默认 60 秒）。
3. **触发子代理**：通过主 agent 调用 Task 工具启动子代理。利用宿主（OpenCode Host）的原生能力自动创建子会话、渲染可点击链接、保存完整消息历史。
4. **子代理管理**：宿主自动完成子会话的生命周期管理，包括创建、执行、完成和保存历史记录。
5. **用户交互**：用户可点击链接切换到子会话视图，查看子代理的完整输出。

## 配置

所有参数通过 `idle-continue.json` 配置。配置文件查找顺序（如果与 opencode 的查找顺序冲突，以 opencode 的为准）：

1. 项目根目录
2. `.opencode/` 目录
3. `~/.config/opencode/` 目录

### 配置字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt_file` | string | `"idle-prompt.md"` | 提示词文件路径 |
| `watch_files` | string[] | `["task.md", "wish-list.md"]` | 检测文件列表 |
| `check_interval_minutes` | number | `30` | 等待状态下的检测间隔（分钟） |
| `max_idle_cycles` | number | `5` | 连续空闲次数阈值，超限后间隔翻倍 |
| `enabled` | boolean | `true` | 是否启用插件 |
| `subagent_enabled` | boolean | `false` | 是否启用子代理模式 |
| `subagent_agent_type` | string | `"explore"` | 子代理类型（仅 subagent_enabled=true 时生效） |
| `subagent_delay_ms` | number | `60_000` | 子代理触发延迟（毫秒，仅 subagent_enabled=true 时生效） |

### 示例 `idle-continue.json`

```json
{
  "prompt_file": "idle-prompt.md",
  "watch_files": ["task.md", "wish-list.md"],
  "check_interval_minutes": 30,
  "max_idle_cycles": 5,
  "enabled": true
}
```

## 文件说明

- `idle-prompt.md` — 默认提示词文件，包含发送给 opencode 的提示内容
- `task.md` — 默认检测文件之一，记录当前任务
- `wish-list.md` — 默认检测文件之一，记录待办愿望清单
- `idle-continue.json` — 配置文件

## 项目结构

```
opencode-idle-continue/
│
├── src/
│   ├── index.js                          ← 插件唯一入口。导出 { id, server }
│   ├── opencode-true-idle-detector.js    ← OpenCodeTrueIdleDetector 类（空闲检测去抖状态机）
│   ├── subagent-trigger.js               ← SubagentTrigger 类（子代理触发器）
│   ├── wait-state.js                     ← WaitState 类（等待状态与退避）
│   └── file-utils.js                     ← 文件工具（提示词加载、文件快照、变更检测）
│
├── src/__tests__/
│   ├── opencode-true-idle-detector.test.js  ← 空闲检测状态机测试
│   ├── prompt.test.js                       ← 提示词文件读取/热重载测试
│   ├── file-watch.test.js                   ← 文件快照/变更检测测试
│   ├── wait-state.test.js                   ← 等待状态与退避测试
│   └── index.test.js                        ← 集成测试
│
├── dist/
│   ├── index.js                          ← 构建产物
│   ├── opencode-true-idle-detector.js    ← 构建产物
│   ├── subagent-trigger.js               ← 构建产物
│   ├── wait-state.js                     ← 构建产物
│   └── file-utils.js                     ← 构建产物
│
├── install-local.sh                      ← 构建 + 本地安装脚本
├── clean.sh                              ← 卸载脚本
│
├── package.json                          ← npm 包配置（build → dist/）
├── AGENTS.md                             ← 本文档
├── README.md
├── LICENSE
└── .gitignore
```

## 构建与打包

源码是纯 JavaScript ESM，无需 transpile。构建时将 `src/` 复制到 `dist/`：

```bash
npm run build
```

构建命令：
```
mkdir -p dist && cp src/*.js dist/
```

输出：
- `dist/index.js` — 插件入口（与 `src/index.js` 一致）
- `dist/opencode-true-idle-detector.js` — 空闲检测模块
- `dist/subagent-trigger.js` — 子代理触发模块
- `dist/wait-state.js` — 等待状态模块
- `dist/file-utils.js` — 文件工具模块
- `dist/package.json` — npm 包分发清单

不依赖 bun，node 和 bun 均可使用。

## 安装

### 方式一：本地安装（开发调试）

```bash
bash install-local.sh
```

该脚本依次执行：
1. **项目根目录探查**：从当前目录开始向上遍历父目录，查找第一个存在以下任意标志的目录作为项目根目录：
   - 智能体配置目录：`.opencode/`、`.claude/`、`.cursor/`、`.windsurf/`、`.continue/`、`.github/`、`.copilot/`
   - 智能体配置文件：`agents.md`、`AGENTS.md`、`claude.md`、`CLAUDE.md`、`.cursorrules`、`.windsurfrules`、`continue.json`、`continue.md`、`COPILOT_INSTRUCTIONS.md`
   - 向上遍历不超过文件系统根目录
2. `npm run build` — 构建 `dist/`
3. `npm pack` — 从 `dist/` 创建 tarball `dist/opencode-idle-continue-1.0.0.tgz`
4. 复制 `dist/` 内容到根目录的 `.opencode/plugins/idle-continue/`
5. 在 `.opencode/` 下安装 `@opencode-ai/plugin` 依赖
6. 更新 `opencode.json` 添加插件引用 `./plugins/idle-continue/index.js`

完成后**重启 opencode** 加载插件。

> **项目根目录探查说明**：如果当前目录或其上级目录未发现任何 AI 智能体配置，将回退到当前目录作为项目根目录。

检查日志：`tail -f .log/log-*.log`

### 方式二：npm 发布（生产）

```bash
npm publish
```

`package.json#files` 仅包含 `dist/`、`README.md`、`LICENSE`。
OpenCode 通过插件缓存机制从 npm 拉取安装。

## 卸载

```bash
bash clean.sh
```

## 组件关系

### OpenCodeTrueIdleDetector ↔ WaitState/SubagentTrigger 协作

`OpenCodeTrueIdleDetector` 是直接挂接 opencode 事件系统的入口层，负责从原始事件流中提取信号并通过回调通知 `WaitState` 或 `SubagentTrigger`。

**传统模式（subagent_enabled=false）**：`WaitState` 是复杂状态管理层，负责所有状态维持、定时调度和退避逻辑。

**子代理模式（subagent_enabled=true）**：`SubagentTrigger` 负责子代理的触发和管理，通过向主会话发送 prompt 来启动子代理。

```
opencode 事件流
    │
    ├── event hook (session.status / session.idle / permission.* / question.*)
    │       │
    │       ▼
    │   OpenCodeTrueIdleDetector.handleEvent()
    │       │
    │       ├── onIdle(sessionID)          → WaitState.onIdle()
    │       ├── onIdleExit(sessionID)      → WaitState.onIdleExit()
    │
    └── chat.message hook
            │
            ▼
        OpenCodeTrueIdleDetector.handleChatMessage(input, output)
            │
            ├── 检测到 MessageAbortedError   → onUserInterrupt(sessionID) → WaitState.onUserInterrupt()
            ├── 检测到用户手动输入            → onUserInput(sessionID)    → WaitState.onUserInput()
```

### SubagentTrigger 类

`SubagentTrigger` 类封装了子代理触发逻辑，通过向主会话发送 prompt 来启动子代理。

### 构造函数

```javascript
const trigger = new SubagentTrigger({ client, detector, log, directory });
```

### 核心方法

- `async trigger(sessionID, opts)` - 触发主 agent 调用 Task 工具启动子代理
  - `sessionID`: 主会话 ID
  - `opts.agentType`: 子代理类型（如 'explore'）
  - `opts.prompt`: 子代理的 prompt 文本
  - `opts.description`: Task 描述（用于 TUI 显示）
  - `opts.background`: 是否后台异步执行

### 工作原理

1. 通过 `client.session.prompt()` 向主会话发送结构化的指示文本
2. 主 agent 解析指令后调用 `Task(subagent_type='explore', ...)`
3. 宿主自动完成子会话创建、链接渲染、消息保存等生命周期管理
4. `session.prompt()` 阻塞等待 agent 完成后返回
5. 使用 `inFlight` 标志防止重复触发

### 指示文本格式

```
[subagent-hello 自动触发]

请立即调用 Task 工具，使用以下参数：
- subagent_type: "explore"
- description: "subagent-hello #1"
- prompt: "Hello! 请简短地打个招呼并自我介绍一下。"

直接调用 Task 工具，不要添加任何额外评论或解释。
```

### 与传统模式的区别

| 维度 | 传统模式（WaitState） | 子代理模式（SubagentTrigger） |
|------|---------------------|----------------------------|
| 触发方式 | 直接发送提示词 | 通过 Task 工具启动子代理 |
| 文件监控 | 监控 watch_files 变化 | 不依赖文件监控 |
| 间隔退避 | 支持间隔退避机制 | 不支持，单次触发 |
| 历史记录 | 存储在日志文件 | 由宿主保存到 `~/.local/share/opencode/storage/` |
| 用户交互 | 无特殊交互 | 支持点击链接切换到子会话视图 |

| 回调 | 触发方 | 接收方 | 说明 |
|------|--------|--------|------|
| `onIdle(sessionID)` | Detector (去抖确认后) | WaitState | 进入等待状态 |
| `onIdleExit(sessionID)` | Detector (idle→busy) | WaitState | 退出等待状态 |
| `onUserInterrupt(sessionID)` | Detector (MessageAbortedError) | WaitState | 用户中断 AI 回复 |
| `onUserInput(sessionID)` | Detector (用户手动输入) | WaitState | 用户手动发送消息 |

### 中断状态管理

`WaitState` 内部维护 `#interrupted` 私有字段，由 `onUserInterrupt` 设置、`onUserInput` 清除：
- `#interrupted = true`：`onIdle` 跳过不处理，定时器到期后直接 reset
- `#interrupted = false`：正常处理
- `sendPrompt` 回调也会在 `#interrupted` 为 true 时跳过发送
- **`promptInFlight` 保护**：Detector 内部维护 `#promptInFlight`，插件通过 `session.prompt()` 发送提示词期间该标记为 true，此时收到的 user role 消息不会触发 `onUserInput`，避免插件自身消息清除中断状态

## 事件流

### idle 进入

```
session.status({type:'idle'})
  → OpenCodeTrueIdleDetector
    → 200ms 去抖
    → TRUE_IDLE
    → onIdle(sessionID)
      → WaitState.onIdle()
        → [interrupted?] → 跳过
        → [active?] → 幂等跳过
        → sendPrompt(promptContent)        ← 读取 prompt_file 发送
        → prompt() 阻塞返回
        → checkFilesChanged()
          → 有变化 → waitState.reset()
          → 无变化 → waitState.enter()
```

### idle 退出

```
session.status({type:'busy'})
  → OpenCodeTrueIdleDetector
    → 取消 pending 去抖（DEBOUNCE）
    → 检测到 idle→busy 转换
    → onIdleExit(sessionID)
      → WaitState.onIdleExit()
        → waitState.reset()
        → 重新快照 watch_files（文件状态检查点重置）
```

### 用户中断

```
chat.message({role:'assistant', error:{name:'MessageAbortedError'}})
  → OpenCodeTrueIdleDetector.handleChatMessage()
    → 日志 USER_INTERRUPT
    → onUserInterrupt(sessionID)
      → WaitState.onUserInterrupt()
        → #interrupted = true
        → waitState.reset()                 ← 清理定时器和状态
```

### 用户手动输入（清除中断）

```
chat.message({role:'user'})
  → OpenCodeTrueIdleDetector.handleChatMessage()
    → [promptInFlight?] → 跳过（插件自身消息）
    → 日志 USER_INPUT
    → onUserInput(sessionID)
      → WaitState.onUserInput()
        → #interrupted = false             ← 恢复空闲检测
```

### 等待状态循环

```
WaitState.enter()
  → schedule(interval)
    → setTimeout 触发
    → onFire(waitState)
      → [interrupted?] → waitState.reset() → 退出
      → checkFilesChanged()
        → 有变化 → waitState.reset() → 退出
      → sessionStatus !== 'idle'
        → waitState.reset() → 退出
      → sendPrompt()
      → idleCycles++
      → idleCycles >= max_idle_cycles? → interval *= 2, idleCycles=0
      → schedule(next_interval)
```

## 实现规范

### 插件入口 (`src/index.js`)

- **导出格式**: ESM 默认导出 `{ id: string, server: Plugin }`
- `server(input)` 接收 `PluginInput`，含 `{ directory, client, ... }`
- 返回 `{ event, "chat.message", dispose }` 三个 hook
- `input.client` 用于调用 `session.prompt()` 发送指令

### OpenCodeTrueIdleDetector 类规范 (`src/opencode-true-idle-detector.js`)

- 使用 JavaScript 私有字段（`#`）封装状态，防止外部篡改
- `scheduleCheck` 用 `setTimeout` 实现 200ms 去抖
- `onIdle` 回调在去抖确认后调用，但回调本身可以是 `async`
- `onIdleExit` 回调在状态从 idle 切换到 busy 时同步调用
- `onUserInterrupt` 回调在检测到 `MessageAbortedError` 时调用
- `onUserInput` 回调在检测到用户手动输入时调用
- `handleEvent` 是**同步方法**，仅操作状态机和定时器，不处理回调结果
- `handleChatMessage(input, output)` 处理 `chat.message` hook 数据，检测用户中断和手动输入
- `setPromptInFlight(v)` 标记插件是否正在发送 prompt，防止自身消息触发 `onUserInput`
- `dispose` 清理 pending 定时器

### WaitState 类规范 (`src/wait-state.js`)

- 使用 JavaScript 私有字段封装状态
- `onIdle(sessionID)` 进入等待状态（幂等，已激活时无操作；中断状态时跳过）
- `onIdleExit()` 重置所有状态，重新快照文件
- `onUserInterrupt(sessionID)` 设置 `#interrupted = true`，重置定时和计数
- `onUserInput(sessionID)` 清除 `#interrupted`，恢复空闲检测
- `reset()` 重置所有状态到初始值（定时器、计数、间隔，不重置 `#interrupted`）
- `dispose()` 清理 pending 定时器
- 内部 `#sendAndCheck` 有 `#active` 守卫，防止 reset 后继续执行

### Logger

- 日志路径: `path.join(directory, '.log')` → 项目根目录 `.log/`
- 使用 `directory` input 参数，禁止使用 `__dirname`
- 格式: `[<ISO8601>] [<LEVEL>] <msg>`

### 日志级别

| Level | 触发时机 |
|---|---|
| `INIT` | 插件初始化 |
| `DESIGN` | 启动时输出设计决策 |
| `STATUS` | session.status 变更 |
| `IDLE` | session.idle 事件 |
| `CANDIDATE` | 进入 idle 但尚未去抖确认 |
| `TRUE_IDLE` | **去抖后确认真正空闲** |
| `ON_IDLE_EXIT` | idle→busy 转换 |
| `SKIP` | 去抖后条件不满足，或插件未启用 |
| `DEBOUNCE` | 去抖被 busy 取消 |
| `PERM` | permission.asked/replied |
| `QUEST` | question.asked/replied/rejected |
| `PROMPT` | 发送提示词 |
| `PROMPT_DONE` | 提示词回复完成 |
| `PROMPT_ERR` | 提示词发送失败 |
| `HOT_RELOAD` | prompt_file 热重载 |
| `FILES` | 检测文件变更状态 |
| `WAIT` | 等待状态进入/循环/退出 |
| `RESET` | 等待状态重置 |
| `ON_IDLE` | onIdle 回调触发 |
| `USER_INPUT` | 用户消息 |
| `AI_REPLY` | AI 回复 |
| `USER_INTERRUPT` | 用户中断 AI 回复（MessageAbortedError）|
| `DISPOSE` | 插件关闭 |

### 发送机制

- 使用 `client.session.prompt()`（阻塞式）：发送后等待完整 AI 回复（含工具调用）才继续
- 天然保证"回复处理完成"后才进行下一步

### 去抖机制

- `scheduleCheck(sessionID, delay=200)` 用 `setTimeout` 实现
- 已有 pending 则 `clearTimeout` 重置
- 到期后验证 `status === 'idle' && !waitingPermission && !waitingQuestion`
- 若中途变为 busy，立即取消

### 等待状态与退避

```
TRUE_IDLE → onIdle(sessionID)
  → sendPrompt(promptContent)
  → prompt() 返回
  → checkFilesChanged()
    → 有变化 → waitState.reset()
    → 无变化 → waitState.enter()
      → waitState 定时器触发:
        → 文件变化? → waitState.reset()
        → 非 idle? → waitState.reset()
        → 仍 idle → sendPrompt() → recordCycle(fileChanged)
          → recordCycle 返回 false → waitState.reset()
          → recordCycle 返回 true → schedule(interval)
```

### idle-exit 重置

```
onIdleExit(sessionID)  ← 同步调用
  → waitState.reset()
  → 遍历 watch_files 重新快照（fileSnapshots 更新）
```

## 单元测试

测试框架使用 vitest，使用 `vi.useFakeTimers()` 控制时间，用临时目录 mock 文件系统。

### 测试文件分布

| 文件 | 测试层次 | 说明 |
|------|----------|------|
| `opencode-true-idle-detector.test.js` | 单元测试 | OpenCodeTrueIdleDetector 状态机 |
| `prompt.test.js` | 单元测试 | 提示词文件读取与热重载 |
| `file-watch.test.js` | 单元测试 | 文件快照与变更检测 |
| `wait-state.test.js` | 单元测试 | WaitState 类等待与退避 |
| `index.test.js` | 集成测试 | 全链路：各组件通过插件入口协作 |

### OpenCodeTrueIdleDetector 单元测试

通过公共接口（构造函数、`handleEvent`、`dispose`、`activeSessionID` getter）测试状态机逻辑，`onIdle` / `onIdleExit` mock 回调用于验证行为。

| # | 用例 | 输入 | 预期行为 |
|---|------|------|----------|
| 1 | **基本空闲检测** | `session.status({type:'idle'})` | 200ms 去抖后 `onIdle` 被调用 1 次 |
| 2 | **busy 取消去抖** | idle → 50ms 后 busy | 去抖被取消，`onIdle` 未被调用 |
| 3 | **idle → busy → idle 重置去抖** | idle → 50ms → busy → idle | 第一个去抖取消，第二个重新调度，仅第二个到期时调用 onIdle |
| 4 | **permission.asked 阻止空闲** | idle → permission.asked | 去抖到期条件不满足，`onIdle` 未被调用 |
| 5 | **permission.replied 恢复空闲** | idle → asked → replied | replied 重新调度去抖，到期后 `onIdle` 被调用 |
| 6 | **question.asked 阻止空闲** | idle → question.asked | 去抖到期条件不满足，`onIdle` 未被调用 |
| 7 | **question.replied2 恢复空闲** | idle → asked → replied2 | replied2 重新调度，到期后 `onIdle` 被调用 |
| 8 | **question.rejected2 恢复空闲** | idle → asked → rejected2 | 同上 |
| 9 | **session.idle 更新 sessionID** | 连续两次不同 sessionID | `activeSessionID` 返回最后一次 |
| 10 | **dispose 清理定时器** | idle → 未到 200ms → dispose | pending 定时器清除，`onIdle` 永不被调用 |
| 11 | **idle→busy 触发 onIdleExit** | idle → 立即 busy | `onIdleExit` 被同步调用 1 次，参数 sessionID 正确 |
| 12 | **onIdleExit 不触发于 idle→idle** | 连续两次 idle | `onIdleExit` 未被调用 |
| 13 | **MessageAbortedError 触发 onUserInterrupt** | `handleChatMessage` 含 `error.name='MessageAbortedError'` | `onUserInterrupt` 被调用 1 次 |
| 14 | **正常 assistant 消息不触发中断** | `handleChatMessage` 无 error | `onUserInterrupt` 未被调用 |
| 15 | **用户消息触发 onUserInput** | `handleChatMessage` 含 `role:'user'` | `onUserInput` 被调用 1 次 |
| 16 | **promptInFlight 阻止 onUserInput** | `setPromptInFlight(true)` 后发送用户消息 | `onUserInput` 未被调用 |

### Prompt 模块测试

测试 `loadPromptFile` 函数：文件读取、mtime 缓存、空文件、不存在文件。

| # | 用例 | 输入 | 预期行为 |
|---|------|------|----------|
| 13 | **读取存在的文件** | 文件内容 "hello" | 返回 `{ content: 'hello', mtime: number }` |
| 14 | **读取不存在的文件** | 路径不存在 | 返回 `{ content: '', mtime: 0 }` |
| 15 | **读取空文件** | 文件内容 "" | 返回 `{ content: '', mtime: number }` |

### File Watch 模块测试

测试 `readFileSnapshot` 和 `fileChanged`：文件快照创建与变更比较。

| # | 用例 | 输入 | 预期行为 |
|---|------|------|----------|
| 16 | **读取存在的文件快照** | 存在的路径 | 返回 `{ mtime: number, size: number }` |
| 17 | **读取不存在的文件快照** | 路径不存在 | 返回 `null` |
| 18 | **快照比较：内容未变** | 相同文件两次快照 | `fileChanged` 返回 `false` |
| 19 | **快照比较：内容已变** | 修改文件后再次快照 | `fileChanged` 返回 `true` |
| 20 | **快照比较：一方为 null** | 新出现或消失的文件 | `fileChanged` 返回 `true` |
| 21 | **快照比较：双方为 null** | 都不存在的文件 | `fileChanged` 返回 `false` |

### WaitState 类单元测试

测试等待状态的关键路径。

| # | 用例 | 输入 | 预期行为 |
|---|------|------|----------|
| 22 | **enter 后 active 为 true** | `enter()` | `active` getter 返回 `true` |
| 23 | **enter 幂等** | 连续两次 `enter()` | `onFire` 仅被调度一次 |
| 24 | **reset 清除状态** | enter → reset | `active` 为 false，计数/间隔恢复初始 |
| 25 | **timer 触发 onFire** | enter → advance 间隔 | `onFire` 被调用 1 次 |
| 26 | **recordCycle 递增 idleCycles** | 连续 recordCycle(false) N 次 | N 次后 idlCycles == N（小于 max） |
| 27 | **recordCycle 超过 max 后翻倍** | recordCycle(false) 达到 max 次 | 间隔翻倍，idleCycles 重置为 0 |
| 28 | **recordCycle 文件变化时返回 false** | recordCycle(true) | 返回 false，不继续调度 |
| 29 | **dispose 清理定时器** | enter → dispose | 定时器清除，onFire 不会被调用 |
| 30 | **reset 后 enter 重新激活** | enter → reset → enter | 重新开始，初始间隔 |
| 31 | **onUserInterrupt 阻止 onIdle** | onUserInterrupt → onIdle | onIdle 跳过，不调用 sendPrompt |
| 32 | **onUserInput 恢复 onIdle** | onUserInterrupt → onUserInput → onIdle | onIdle 正常触发 |
| 33 | **中断重置活跃等待状态** | onIdle(enter) → onUserInterrupt | 定时器被清除，不再继续 |
| 34 | **中断后定时器不发送 prompt** | onIdle → 定时器 → onUserInterrupt → 再定时器 | 中断后的定时器不发送 |

### 集成测试

通过 mock `client.session.prompt()`、临时文件系统和 `OpenCodeTrueIdleDetector` 的真实实例，测试全链路协作。

| # | 用例 | 输入 | 预期行为 |
|---|------|------|----------|
| 31 | **idle→发送 prompt→文件未变→等待状态** | idle 事件 | prompt 发送 1 次；等待状态激活 |
| 32 | **idle→发送 prompt→文件已变→重置** | idle 事件，watch_file 已不同 | prompt 发送 1 次；不进入等待（可再次 idle） |
| 33 | **等待状态文件变化 → 退出等待** | 等待状态中，修改 watch_file，触发 wait timer | waitState.reset() 被调用 |
| 34 | **等待状态 idle-exit → 退出等待** | 等待状态中发送 busy 事件 | onIdleExit → waitState.reset() + 文件重新快照 |
| 35 | **等待状态周期 → 仍 idle → 重新发送 prompt** | 等待状态定时器超时 | prompt 再次被发送 |
| 36 | **连续 max 次 idle → 间隔翻倍** | 等待状态路径走完 max 次 | 5 次后 currentInterval 从 30→60 分钟 |
| 37 | **空 prompt 文件 → 跳过发送** | prompt.md 为空 | prompt 未被调用 |
| 38 | **插件 disabled → 跳过** | enabled:false | prompt 未被调用 |
| 39 | **prompt_file 热重载** | 等待状态中修改 prompt.md | 下次 onFire 时 HOT_RELOAD，新内容被发送 |
| 40 | **dispose 清理所有** | 等待状态 → dispose() | 所有定时器清除，无回调 |
| 41 | **用户中断 → idle 跳过** | idle → MessageAbortedError → idle | 中断后 idle 不触发 prompt |
| 42 | **用户手动输入 → 恢复 idle** | 中断 → 用户消息 → idle | 手动输入后 idle 正常触发 |

### 关键约束

1. **不允许使用外部 logger 模块** — createLogger 内联
2. **日志路径必须用 `directory` input** — 禁止 `__dirname`
3. **所有源文件使用 ESM** — `"type": "module"`
4. **`chat.message` 文本截断 2000 字符**
5. **`client.session.prompt()` 阻塞等待完整回复** — 连续处理的基础
6. **`dist/package.json` 不包含 devDependencies** — 分发包保持最小依赖
