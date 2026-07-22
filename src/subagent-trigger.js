/**
 * SubagentTrigger
 *
 * 通过向主会话注入 prompt，指示主 agent 调用内置 Task 工具来启动子代理。
 * 宿主（OpenCode Host）接管全部子会话生命周期：
 *   - 创建子会话 (ses_xxx)
 *   - 渲染 <task id="ses_xxx" state="running/completed"> 可点击链接
 *   - 自动保存子会话完整消息历史到 ~/.local/share/opencode/storage/
 *   - 子代理完成后向父会话注入合成消息
 *
 * 设计参考：../swarm-subagent-screen.md Pattern 1（agent 调用 Task 工具）
 */
export class SubagentTrigger {
  #client;
  #detector;
  #log;
  #directory;
  #inFlight = false;
  #count = 0;

  constructor({ client, detector, log, directory }) {
    this.#client = client;
    this.#detector = detector;
    this.#log = log;
    this.#directory = directory;
  }

  get inFlight() {
    return this.#inFlight;
  }

  get count() {
    return this.#count;
  }

  /**
   * 触发主 agent 调用 Task 工具，启动子代理。
   *
   * 宿主自动完成：创建子会话 → 渲染可点击链接 → 保存消息 → 注入完成信封。
   * 调用方只需检查 inFlight 防重入。
   *
   * @param {string} sessionID - 主会话 ID
   * @param {Object} opts
   * @param {string} opts.agentType - 子代理类型（如 'explore'）
   * @param {string} opts.prompt - 子代理的 prompt 文本
   * @param {string} [opts.description] - Task 描述（用于 TUI 显示）
   * @param {boolean} [opts.background=false] - 是否后台异步执行
   */
  async trigger(sessionID, opts = {}) {
    const {
      agentType = 'explore',
      prompt: subPrompt = 'Hello!',
      description,
      background = false,
    } = opts;

    if (this.#inFlight) {
      this.#log('SKIP', `session=${sessionID} trigger already in flight`);
      return;
    }

    this.#inFlight = true;
    this.#count++;

    const desc = description || `subagent #${this.#count}`;
    const instruction = this.#buildInstruction(agentType, subPrompt, desc, background);

    this.#log(
      'TRIGGER',
      `session=${sessionID} count=${this.#count} agentType=${agentType} desc=${desc}`,
    );

    try {
      this.#detector.setPromptInFlight(true);
      await this.#client.session.prompt({
        path: { id: sessionID },
        query: { directory: this.#directory },
        body: {
          parts: [{ type: 'text', text: instruction }],
        },
      });
      this.#log('TRIGGER_DONE', `session=${sessionID} count=${this.#count}`);
    } catch (err) {
      this.#log(
        'TRIGGER_ERR',
        `session=${sessionID} count=${this.#count} ${err.message}`,
      );
    } finally {
      this.#detector.setPromptInFlight(false);
      this.#inFlight = false;
    }
  }

  /**
   * 构建指示主 Agent 立即调用 Task 工具的指令提示词。
   * 此文本将作为 user message 注入主会话，强制触发工具调用。
   * 
   * @param {string} agentType - 子代理类型标识
   * @param {string} subPrompt - 传递给子代理的核心提示词（可能包含多行/特殊字符）
   * @param {string} description - 任务的简短描述
   * @param {string} [background] - 可选的背景信息
   * @returns {string} 格式化后的工具调用指令
   */
  #buildInstruction(agentType, subPrompt, description, background) {
    // 使用 JSON.stringify 安全转义，确保换行符、引号、特殊字符被正确处理
    const safePrompt = JSON.stringify(subPrompt);
    const safeDesc = JSON.stringify(description);

    const lines = [
      '[SYSTEM: SUBAGENT_TRIGGER]',
      '',
      'You must call the "Task" tool immediately with the following parameters.',
      'Do NOT output any text, explanation, or markdown. Only execute the tool call.',
      '',
      'Tool arguments (JSON format):',
      '{',
      `  "subagent_type": "${agentType}",`,
      `  "description": ${safeDesc},`  // 注意此处无额外引号，因为 stringify 已包含
    ];

    // 仅在 background 有值时添加，避免传入空字符串或 undefined
    if (background) {
      const safeBg = JSON.stringify(background);
      lines.push(`  "background": ${safeBg},`);
    }

    lines.push(
      `  "prompt": ${safePrompt}`,
      '}',
      '',
      'CRITICAL: Reply with the tool call only. No introductory phrases.'
    );

    return lines.join('\n');
  }
}