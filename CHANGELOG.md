# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-08-08

### Changed
- Updated idle-prompt.md and idle-prompt.zh.md to explicitly prohibit reading worklog.md file (append‑only log file)

## [1.0.0] - 2026-08-06

### Added
- Initial release
- Idle detection with 200ms debounce mechanism
- Automatic prompt delivery during idle periods
- Hot reload support for prompt files
- File change monitoring and snapshot comparison
- Wait state management with interval backoff
- Two working modes:
  - Traditional Mode: Direct prompt delivery with file monitoring
  - Subagent Mode: Task tool integration with automatic session management
- Directory monitoring support (single-level tracking)
- CLI installation commands (system, local, specific directory)
- Comprehensive test suite (103 test cases)
- Bilingual documentation (English and Chinese)

### Features
- Monitors OpenCode idle status and triggers continuation logic
- Reads prompt content from specified markdown files
- Automatic file change detection with backoff mechanism
- Plugin state management with interrupt handling
- Support for both file and directory monitoring in watch_files
- Automatic session lifecycle management in subagent mode

### Configuration
- `prompt_file`: Path to prompt file (default: "idle-prompt.md")
- `watch_files`: List of files/directories to monitor (default: ["task.md", "wish-list.md"])
- `check_interval_minutes`: Check interval in minutes (default: 30)
- `max_idle_cycles`: Max consecutive idle cycles before interval doubling (default: 5)
- `enabled`: Plugin enable/disable (default: true)
- `subagent_enabled`: Subagent mode enable/disable (default: false)
- `subagent_agent_type`: Subagent type for Task tool (default: "explore")
- `subagent_delay_ms`: Subagent trigger delay in milliseconds (default: 60000)

### Installation
- Supports global npm installation
- Supports local development installation
- Provides CLI commands for plugin management

### Documentation
- Comprehensive README with installation and configuration instructions
- Detailed working principles for both modes
- Chinese documentation available
- AGENTS.md with internal documentation

[1.0.0]: https://github.com/jiangjianbo/opencode-idle-continue/releases/tag/1.0.0