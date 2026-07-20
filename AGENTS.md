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
