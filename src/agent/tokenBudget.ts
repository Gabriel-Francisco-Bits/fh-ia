export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TokenAllocation {
  totalBudget: number;
  codeBudget: number;
  rulesBudget: number;
  historyBudget: number;
}

/**
 * Estimates token count using a BPE-inspired heuristic tuned for code and natural language.
 * Handles subwords, camelCase, snake_case, indentation, punctuation, and multi-byte characters.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Split on whitespace, code tokens, and punctuation
  // BPE-style token patterns:
  // 1. Contractions: 's, 't, 're, 've, 'm, 'll, 'd
  // 2. Numbers: digits sequences
  // 3. Words: alphanumeric sequences (split camelCase)
  // 4. Repeated punctuation / whitespace
  const pattern = /'s|'t|'re|'ve|'m|'ll|'d|[^\r\n\p{L}\p{N}]?[\p{L}]+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;
  const matches = text.match(pattern);
  if (!matches) {
    return Math.ceil(text.length / 4);
  }

  let count = 0;
  for (const part of matches) {
    if (part.length > 8) {
      count += Math.ceil(part.length / 4);
    } else {
      count += 1;
    }
  }

  return Math.max(1, count);
}

export interface TokenBudgetOptions {
  totalBudget?: number;
  codeRatio?: number;    // Default: 0.60 (60%)
  rulesRatio?: number;   // Default: 0.20 (20%)
  historyRatio?: number; // Default: 0.20 (20%)
}

export class TokenBudgetManager {
  readonly totalBudget: number;
  readonly codeRatio: number;
  readonly rulesRatio: number;
  readonly historyRatio: number;

  constructor(options: TokenBudgetOptions = {}) {
    this.totalBudget = options.totalBudget ?? 100_000;
    this.codeRatio = options.codeRatio ?? 0.60;
    this.rulesRatio = options.rulesRatio ?? 0.20;
    this.historyRatio = options.historyRatio ?? 0.20;
  }

  getAllocation(total = this.totalBudget): TokenAllocation {
    const codeBudget = Math.floor(total * this.codeRatio);
    const rulesBudget = Math.floor(total * this.rulesRatio);
    const historyBudget = Math.floor(total * this.historyRatio);
    return {
      totalBudget: total,
      codeBudget,
      rulesBudget,
      historyBudget,
    };
  }

  /**
   * Intelligently prunes conversation history using a sliding window while preserving
   * the root user task/intent at the start of the session.
   */
  pruneHistory(history: ChatMessage[], maxTokens?: number): ChatMessage[] {
    const budget = maxTokens ?? this.getAllocation().historyBudget;
    if (!history || history.length === 0) return [];

    let currentTokens = history.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    if (currentTokens <= budget) {
      return [...history];
    }

    // Always preserve the very first message if it's user intent
    const firstMsg = history[0];
    const firstTokens = estimateTokens(firstMsg.content);

    // If even the first message is huge, truncate it gently
    if (firstTokens >= budget) {
      return [
        {
          role: firstMsg.role,
          content: firstMsg.content.slice(0, Math.floor(budget * 3.5)) + "\n... [truncated]",
        },
      ];
    }

    const preserved: ChatMessage[] = [];
    let remainingBudget = budget - firstTokens;
    let prunedCount = 0;

    // Pick from the tail (most recent) backwards
    const tail: ChatMessage[] = [];
    for (let i = history.length - 1; i >= 1; i--) {
      const msg = history[i];
      const cost = estimateTokens(msg.content);
      if (remainingBudget - cost >= 0) {
        tail.unshift(msg);
        remainingBudget -= cost;
      } else {
        prunedCount++;
      }
    }

    if (prunedCount > 0) {
      preserved.push(firstMsg);
      preserved.push({
        role: "system",
        content: `[Notice: ${prunedCount} previous message(s) pruned to preserve token budget]`,
      });
      preserved.push(...tail);
      return preserved;
    }

    return [firstMsg, ...tail];
  }

  /**
   * Prunes and compresses rules/skills to stay within the 20% rules budget.
   */
  pruneRules(rulesText: string, maxTokens?: number): string {
    const budget = maxTokens ?? this.getAllocation().rulesBudget;
    const tokens = estimateTokens(rulesText);
    if (tokens <= budget) {
      return rulesText;
    }

    // Truncate rules with clear indicator
    const targetChars = Math.floor(budget * 3.5);
    return rulesText.slice(0, targetChars) + "\n\n... [Standing rules truncated to fit token budget]";
  }

  /**
   * Prunes and optimizes workspace and code context to stay within the 60% code budget.
   */
  pruneContext(contextBlock: string, maxTokens?: number): string {
    const budget = maxTokens ?? this.getAllocation().codeBudget;
    const tokens = estimateTokens(contextBlock);
    if (tokens <= budget) {
      return contextBlock;
    }

    // Truncate context block safely
    const targetChars = Math.floor(budget * 3.5);
    return contextBlock.slice(0, targetChars) + "\n\n... [Workspace code context truncated to fit 60% token budget]";
  }
}
