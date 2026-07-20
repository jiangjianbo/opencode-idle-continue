# opencode-idle-continue

本项目是 opencode 的一个插件，实现"空闲时自动继续处理"的功能。

## 工作原理

1. **空闲检测**：监控系统空闲状态。当 opencode 处于空闲状态时触发后续逻辑。
2. **发送提示词**：从指定的 markdown 文件中读取提示内容并发送给 opencode 继续处理。
3. **提示词热重载**：每次使用 `prompt_file` 时检查文件是否已修改。未修改则使用缓存内容，已修改则重新读入并更新缓存，无需重启插件。
4. **文件变更监控**：维护一个检测文件列表，监控这些文件的内容/时间戳是否变化。
5. **等待状态**：如果发送提示词后检测文件列表中的文件没有变化，则进入等待状态。等待状态需要同时满足：
   - 系统持续空闲
   - 检测文件列表中的文件没有改变
6. **间隔退避**：在等待状态下，每隔一定时间间隔（默认 30 分钟）发送一次提示词。如果连续 5 次检测仍然处于空闲状态（文件未变化），则下一次的等待间隔翻倍。

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
│   └── opencode-true-idle-detector.js    ← OpenCodeTrueIdleDetector 类（空闲检测）
│
├── dist/
│   ├── index.js                          ← bun build 打包产物（含 idle detector）
│   └── package.json                      ← npm 包分发清单
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
- `dist/package.json` — npm 包分发清单

不依赖 bun，node 和 bun 均可使用。

## 安装

### 方式一：本地安装（开发调试）

```bash
bash install-local.sh
```

该脚本依次执行：
1. `bun run build` — 构建 `dist/`
2. `npm pack` — 从 `dist/` 创建 tarball `dist/opencode-idle-continue-1.0.0.tgz`
3. 复制 `dist/` 内容到 `.opencode/plugins/idle-continue/`
4. 在 `.opencode/` 下安装 `@opencode-ai/plugin` 依赖
5. 更新 `opencode.json` 添加插件引用 `./plugins/idle-continue/index.js`

完成后**重启 opencode** 加载插件。

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

## 行为细节

1. 插件启动后立即开始监控空闲状态
2. 每次使用 `prompt_file` 时检查文件是否已修改。未修改则使用缓存内容，已修改则重新读入并更新缓存（热重载）
3. 检测到空闲时，读取 `prompt_file` 的当前内容作为提示词发送
4. 发送后检查 `watch_files` 中所有文件是否有变化（文件大小或修改时间）
5. 任一文件有变化 → 重置空闲计数，恢复正常监控
6. 所有文件无变化 → 进入等待状态，开始计时
7. 等待状态下每 `check_interval_minutes` 分钟检测一次，若仍空闲则发送提示词
8. 连续 `max_idle_cycles` 次检测到空闲 → `check_interval_minutes` 翻倍
9. 任意时刻检测到文件变化 → 间隔重置为初始值，退出等待状态

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
- `handleEvent` 是**同步方法**，仅操作状态机和定时器，不处理回调结果
- `dispose` 清理 pending 定时器

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
    → 有变化 → resetWaitState() (idleCycles=0, interval=初始)
    → 无变化 → enterWaitState()
      → scheduleWaitCheck(interval)
        → 定时器触发:
          → 文件变化? → resetWaitState()
          → 非 idle? → resetWaitState()
          → 仍 idle → sendPrompt() → 检查文件
            → 无变化 → idleCycles++
              → idleCycles >= max_idle_cycles? → interval *= 2, idleCycles=0
            → scheduleWaitCheck(interval)
```

### 关键约束

1. **不允许使用外部 logger 模块** — createLogger 内联
2. **日志路径必须用 `directory` input** — 禁止 `__dirname`
3. **所有源文件使用 ESM** — `"type": "module"`
4. **`chat.message` 文本截断 2000 字符**
5. **`client.session.prompt()` 阻塞等待完整回复** — 连续处理的基础
6. **`dist/package.json` 不包含 devDependencies** — 分发包保持最小依赖
