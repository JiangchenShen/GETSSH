import { streamTurnLLM, LlmRequest, Turn, Block, UnifiedTool } from './llmService';
import { toolRegistry } from './agent/ToolRegistry';
import { ToolExecutionContext } from './agent/types';

export class AgentEngine {
  /**
   * Run the Autonomous ReAct Loop with Native Tool Calling & Block/Turn Continuity
   */
  static async runAgentLoop(
    endpoint: string,
    apiKey: string,
    provider: string,
    model: string,
    prompt: string,
    context: string,
    sessionId: string,
    workspaceId: string | undefined,
    mode: string,
    requestId: string,
    aiMaxTokens: number,
    searchConfig: any,
    onChunk: (chunk: string) => void,
    onDone: () => void,
    onError: (error: Error) => void,
    askApproval?: (command: string) => Promise<boolean>,
    onGlobalAction?: (payload: any) => void,
    thinkingEffort?: any
  ) {
    // ── Mode Guard ───────────────────────────────────────────────────────
    if (mode !== 'agent_full' && mode !== 'agent_semi') {
      const rejectionPrompt = `[SYSTEM REJECTION]: Your current permission level is "${mode}". You do NOT have permission to use any tools or execute any commands. Inform the user that they need to switch to Agent mode (Full Takeover or Semi-Takeover) in the AI settings to enable tool execution. Do NOT pretend you executed anything.`;
      
      const req: LlmRequest = {
        endpoint,
        apiKey,
        model,
        prompt: rejectionPrompt,
        context,
        thinkingEffort: thinkingEffort || 'medium',
        store: false
      };
      streamTurnLLM(provider, req, {
        onChunk,
        onDone: () => onDone(),
        onError
      });
      return;
    }

    let loopCount = 0;
    const MAX_LOOPS = 15;

    const ctx: ToolExecutionContext = {
      sessionId,
      workspaceId,
      mode,
      aiMaxTokens,
      searchConfig,
      onChunk,
      askApproval,
      onGlobalAction
    };

    // 工具清单每轮重算：MCP server 是可以在 Agent 跑起来之后才连上的，
    // 在循环外算一次的话，本轮之内新连的 server 一直不可见。
    const buildTools = (): UnifiedTool[] =>
      toolRegistry
        .getAvailableTools({
          hasSession: !!sessionId,
          searchEnabled: searchConfig?.enabled !== false
        })
        .map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters || {
            type: 'object',
            properties: {},
            required: []
          }
        }));

    // Initialize multi-turn history with system context and initial user prompt
    const history: Turn[] = [];
    if (context) {
      history.push({
        role: 'system',
        blocks: [{ kind: 'text', text: context }]
      });
    }
    history.push({
      role: 'user',
      blocks: [{ kind: 'text', text: prompt }]
    });

    const runTurn = async () => {
      if (loopCount >= MAX_LOOPS) {
        onChunk('\n⚠️ **[AGENT]** 已达到最大自主执行步数，自动停止以防止失控。\n');
        onDone();
        return;
      }
      loopCount++;

      let isExecutingLegacyAction = false;
      let legacyActionStr = '';
      let textBuffer = '';
      const startTag = '<ACTION>';
      const endTag = '</ACTION>';
      let hasThoughtStarted = false;
      let hasThoughtEnded = false;

      const request: LlmRequest = {
        endpoint,
        apiKey,
        model,
        history,
        tools: buildTools(),
        toolChoice: 'auto',
        thinkingEffort: thinkingEffort || 'medium',
        store: false
      };

      try {
        await streamTurnLLM(provider, request, {
          onChunk: (chunk: string) => {
            if (hasThoughtStarted && !hasThoughtEnded) {
              hasThoughtEnded = true;
              onChunk('\n</think>\n\n');
            }

            // Check for legacy text <ACTION> tags if model outputted them as raw text
            if (isExecutingLegacyAction) {
              legacyActionStr += chunk;
              const executeEndMatch = legacyActionStr.indexOf(endTag);
              if (executeEndMatch !== -1) {
                isExecutingLegacyAction = false;
              }
              return;
            }

            textBuffer += chunk;
            const executeStartMatch = textBuffer.indexOf(startTag);
            if (executeStartMatch !== -1) {
              const beforeStart = textBuffer.substring(0, executeStartMatch);
              if (beforeStart) onChunk(beforeStart);

              isExecutingLegacyAction = true;
              legacyActionStr = textBuffer.substring(executeStartMatch + startTag.length);
              textBuffer = '';

              const executeEndMatch = legacyActionStr.indexOf(endTag);
              if (executeEndMatch !== -1) {
                isExecutingLegacyAction = false;
              }
              return;
            }

            // Safe stream output
            let safeToEmitEndIndex = textBuffer.length;
            for (let i = 0; i < startTag.length; i++) {
              const suffix = textBuffer.substring(textBuffer.length - (startTag.length - i));
              if (suffix && startTag.startsWith(suffix)) {
                safeToEmitEndIndex = textBuffer.length - suffix.length;
                break;
              }
            }

            if (safeToEmitEndIndex > 0) {
              const safeContent = textBuffer.substring(0, safeToEmitEndIndex);
              onChunk(safeContent);
              textBuffer = textBuffer.substring(safeToEmitEndIndex);
            }
          },

          onThoughtChunk: (thoughtChunk: string) => {
            if (!hasThoughtStarted) {
              hasThoughtStarted = true;
              onChunk('<think>\n');
            }
            onChunk(thoughtChunk);
          },

          onDone: async (response) => {
            if (hasThoughtStarted && !hasThoughtEnded) {
              hasThoughtEnded = true;
              onChunk('\n</think>\n\n');
            }
            if (textBuffer.length > 0 && !isExecutingLegacyAction) {
              onChunk(textBuffer);
              textBuffer = '';
            }

            // Handle Stop Reasons (P0 #11)
            if (response.stopReason === 'budget_exceeded') {
              onChunk('\n\n⚠️ **[AGENT]** 模型已达到推理 Token 上限 (Thinking Budget Exceeded)，以下为阶段性总结。\n');
            } else if (response.stopReason === 'max_tokens') {
              onChunk('\n\n⚠️ **[AGENT]** 输出已达到最大 Token 长度截断限制 (Max Tokens Reached)。\n');
            }

            // 1. Native Structured Tool Calls handling (Primary)
            if (response.toolCalls && response.toolCalls.length > 0) {
              // Record assistant turn in history (including reasoning blocks with signatures!)
              history.push({
                role: 'assistant',
                blocks: response.blocks
              });

              const toolResultBlocks: Block[] = [];
              let skipRemaining = false;

              for (let i = 0; i < response.toolCalls.length; i++) {
                const call = response.toolCalls[i];

                if (skipRemaining) {
                  // Pair all remaining tools to prevent provider 400 (P0 #6)
                  toolResultBlocks.push({
                    kind: 'tool_result',
                    callId: call.callId,
                    name: call.name,
                    content: ['Execution skipped due to previous critical tool failure.'],
                    isError: true
                  });
                  continue;
                }

                console.log(`[AgentEngine] Executing native tool: ${call.name} (callId=${call.callId})`, call.args);
                
                // Real-time progress feedback to the user so they know what the Agent is doing
                const toolActionDesc = 
                  call.name === 'search_web' ? `🔍 **[Agent 联网检索]** 正在搜索: "${call.args?.query || ''}"` :
                  call.name === 'execute_terminal' ? `💻 **[Agent 终端执行]** \`${call.args?.command || ''}\`` :
                  call.name === 'open_session' ? `🚀 **[Agent 调度会话]** 正在连接主机: \`${call.args?.target || ''}\`` :
                  call.name === 'get_environment_info' ? `⏱️ **[Agent 环境感知]** 正在读取客户端与系统环境` :
                  `🔌 **[Agent 工具调用]** 执行 \`${call.name}\``;
                
                onChunk(`\n\n> ${toolActionDesc}...\n\n`);

                try {
                  const result = await toolRegistry.execute(call.name, call.args, ctx);
                  
                  const resultText = result.contextFeed || result.promptFeed || (result.success ? 'Success' : `Error: ${result.error || 'Execution failed'}`);
                  toolResultBlocks.push({
                    kind: 'tool_result',
                    callId: call.callId,
                    name: call.name,
                    content: [resultText],
                    isError: !result.success
                  });

                  if (!result.success) {
                    const toolInst = toolRegistry.getTool(call.name);
                    if (toolInst?.isCritical !== false) {
                      console.error(`[AgentEngine] Critical tool ${call.name} reported failure, skipping remaining tools.`);
                      skipRemaining = true;
                    }
                  }
                } catch (toolErr: any) {
                  console.error(`[AgentEngine] Error executing tool ${call.name}:`, toolErr);
                  toolResultBlocks.push({
                    kind: 'tool_result',
                    callId: call.callId,
                    name: call.name,
                    content: [`Tool execution failed with unexpected error: ${toolErr.message || String(toolErr)}`],
                    isError: true
                  });
                  skipRemaining = true;
                }
              }

              // Append user turn containing all tool results (100% paired!)
              history.push({
                role: 'user',
                blocks: toolResultBlocks
              });

              // P0 #7: Always continue the turn so LLM sees tool results and formulates final response or next actions
              await runTurn();
              return;
            }

            // 2. Pause turn handling for Anthropic / iterative agents
            if (response.stopReason === 'pause_turn') {
              history.push({
                role: 'assistant',
                blocks: response.blocks
              });
              history.push({
                role: 'user',
                blocks: [{ kind: 'text', text: 'Please continue.' }]
              });
              await runTurn();
              return;
            }

            // 3. Legacy Text <ACTION> fallback handling
            let finalLegacyCommand = '';
            if (legacyActionStr) {
              const endIdx = legacyActionStr.indexOf(endTag);
              finalLegacyCommand = endIdx !== -1 ? legacyActionStr.substring(0, endIdx).trim() : legacyActionStr.trim();
            }

            if (finalLegacyCommand) {
              let actionPayload: any;
              let jsonToParse = finalLegacyCommand;
              const startBrace = jsonToParse.indexOf('{');
              const endBrace = jsonToParse.lastIndexOf('}');
              if (startBrace !== -1 && endBrace !== -1) {
                jsonToParse = jsonToParse.substring(startBrace, endBrace + 1);
              }

              try {
                actionPayload = JSON.parse(jsonToParse);
              } catch (e) {
                console.error('[AgentEngine] Failed to parse legacy JSON action:', jsonToParse, e);
                onChunk(`\n❌ **[AGENT]** 无法解析操作指令: JSON 格式错误。\n`);
                onDone();
                return;
              }

              const toolName = actionPayload.type;
              delete actionPayload.type;

              try {
                const result = await toolRegistry.execute(toolName, actionPayload, ctx);
                
                history.push({
                  role: 'assistant',
                  blocks: [{ kind: 'text', text: `${startTag}\n${finalLegacyCommand}\n${endTag}` }]
                });

                const resultFeed = result.contextFeed || result.promptFeed || (result.success ? 'Success' : `Error: ${result.error || 'Execution failed'}`);
                history.push({
                  role: 'user',
                  blocks: [{ kind: 'text', text: `[Action Result]: ${resultFeed}` }]
                });

                await runTurn();
                return;
              } catch (err: any) {
                console.error(`[AgentEngine] Failed to execute legacy action ${toolName}:`, err);
                onChunk(`\n❌ **[AGENT]** 指令执行发生异常: ${err.message || String(err)}\n`);
                onDone();
                return;
              }
            }

            onDone();
          },

          onError: (err) => {
            onError(err);
          }
        });
      } catch (err: any) {
        onError(err);
      }
    };

    // Kick off turn 1
    await runTurn();
  }
}
