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

    const desc = description || `subagent-hello #${this.#count}`;
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
   * 构建指示主 agent 调用 Task 工具的 prompt 文本。
   * 该文本会作为 user message 出现在主会话中。
   */
  #buildInstruction(agentType, subPrompt, description, background) {
    const lines = [
      '[subagent-hello 自动触发]',
      '',
      '请立即调用 Task 工具，使用以下参数：',
      `- subagent_type: "${agentType}"`,
    ];
    if (background) {
      lines.push(`- background: ${background}`);
    }
    lines.push(
      `- description: "${description}"`,
      `- prompt: "${subPrompt}"`,
      '',
      '直接调用 Task 工具，不要添加任何额外评论或解释。',
    );
    return lines.join('\n');
  }
}