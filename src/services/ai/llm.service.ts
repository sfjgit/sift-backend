// File: llm.service.ts
// Path: src/services/ai/llm.service.ts
//
// T3 — the LLM call (spec §4 L3). Provider-abstracted: today Anthropic Claude
// (Haiku tier); a self-hosted model can implement LlmProvider later.
//
//   • only READ tools + control tools are passed, already filtered by role;
//   • tool choice is forced ("any"), so the model can only pick a tool — free
//     text is never read back as an instruction;
//   • the system prompt says read-only, but nothing relies on it: the answer is
//     validated against the registry afterwards (G4);
//   • the model sees masked text + catalog only — never a row of business data.

import Anthropic from "@anthropic-ai/sdk";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import type { TokenUsage } from "@/services/ai/cost.service";

export interface LlmTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmRequest {
  /** static: instructions + catalog (cached) */
  system: string;
  /** per request: masked text + placeholder kinds */
  user: string;
  tools: LlmTool[];
}

export interface LlmAnswer {
  tool: string;
  input: unknown;
  usage: TokenUsage;
  model: string;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "timeout" | "refused" | "no_tool" | "api",
    readonly usage?: TokenUsage,
    readonly model?: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmProvider {
  readonly model: string;
  call(req: LlmRequest): Promise<LlmAnswer>;
}

class AnthropicProvider implements LlmProvider {
  readonly model = AI_DEFAULTS.model;
  private client: Anthropic | null = null;

  private get api() {
    if (!this.client) {
      if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
        throw new LlmError("ANTHROPIC_API_KEY is not set", "not_configured");
      }
      this.client = new Anthropic({ timeout: AI_DEFAULTS.llmTimeoutMs, maxRetries: 1 });
    }
    return this.client;
  }

  async call(req: LlmRequest): Promise<LlmAnswer> {
    let res: Anthropic.Message;
    try {
      res = await this.api.messages.create({
        model: this.model,
        max_tokens: AI_DEFAULTS.maxOutputTokens,
        // static prefix first (tools → system), cached; the request text comes last
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        tools: req.tools as Anthropic.Tool[],
        tool_choice: { type: "any", disable_parallel_tool_use: true },
        output_config: { effort: "low" },
        messages: [{ role: "user", content: req.user }],
      });
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (e instanceof Anthropic.APIConnectionTimeoutError) throw new LlmError("The AI took too long to answer", "timeout");
      if (e instanceof Anthropic.APIError) throw new LlmError(`AI provider error ${e.status ?? ""}`.trim(), "api");
      throw new LlmError((e as Error).message, "api");
    }

    const usage: TokenUsage = {
      inputTokens: res.usage.input_tokens ?? 0,
      outputTokens: res.usage.output_tokens ?? 0,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    };
    if (res.stop_reason === "refusal") throw new LlmError("The AI declined this request", "refused", usage, res.model);
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!call) throw new LlmError("The AI gave no action", "no_tool", usage, res.model);
    return { tool: call.name, input: call.input, usage, model: res.model };
  }
}

let provider: LlmProvider = new AnthropicProvider();

export const llm = () => provider;

/** tests swap in a fake; production never calls this */
export const setLlmProvider = (p: LlmProvider) => {
  provider = p;
};

// control tools shared by both modes
export const REJECT_TOOL: LlmTool = {
  name: "reject_request",
  description:
    "Use when the request asks to create, change, delete, assign, send, approve, import, run or otherwise modify anything — or anything else that is not reading/viewing. The assistant is read-only.",
  input_schema: {
    type: "object",
    properties: { reason: { type: "string", description: "Short reason, one sentence" } },
    required: ["reason"],
    additionalProperties: false,
  },
};

export const CLARIFY_TOOL: LlmTool = {
  name: "ask_clarification",
  description: "Use when the request is a read request but too unclear to pick an action. Ask one short question.",
  input_schema: {
    type: "object",
    properties: { question: { type: "string" } },
    required: ["question"],
    additionalProperties: false,
  },
};
