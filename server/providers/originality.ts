export interface OriginalityCheckResult {
  score: number; // 0 (identical) to 100 (unique)
  similarityWithHighest: number; // 0 to 1
  mostSimilarTitle?: string;
  isRepetitive: boolean;
  warning?: string;
}

export class OriginalityEngine {
  private static tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    );
  }

  public static calculateSimilarity(textA: string, textB: string): number {
    const tokensA = this.tokenize(textA);
    const tokensB = this.tokenize(textB);
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++;
    }
    const union = new Set([...tokensA, ...tokensB]).size;
    return union === 0 ? 0 : intersection / union;
  }

  public static evaluateAgainstHistory(
    candidateTitle: string,
    candidatePremise: string,
    history: Array<{ title: string; premise: string }>
  ): OriginalityCheckResult {
    if (!history || history.length === 0) {
      return {
        score: 100,
        similarityWithHighest: 0,
        isRepetitive: false,
      };
    }

    const candidateFull = `${candidateTitle} ${candidatePremise}`;
    let maxSim = 0;
    let mostSimilarTitle: string | undefined;

    for (const item of history) {
      const existingFull = `${item.title} ${item.premise}`;
      const sim = this.calculateSimilarity(candidateFull, existingFull);
      if (sim > maxSim) {
        maxSim = sim;
        mostSimilarTitle = item.title;
      }
    }

    // Score from 0 to 100 (100 = 0% similarity)
    const score = Math.max(0, Math.min(100, Math.round((1 - maxSim) * 100)));
    const isRepetitive = maxSim >= 0.45;

    return {
      score,
      similarityWithHighest: Math.round(maxSim * 100) / 100,
      mostSimilarTitle: isRepetitive ? mostSimilarTitle : undefined,
      isRepetitive,
      warning: isRepetitive
        ? `This concept has ${(maxSim * 100).toFixed(0)}% similarity to previous content: "${mostSimilarTitle}". Consider introducing a twist or varied premise.`
        : undefined,
    };
  }
}

const STOP_WORDS = new Set([
  'the', 'and', 'with', 'that', 'this', 'for', 'from', 'about', 'into', 'over', 'after',
  'scene', 'story', 'video', 'short', 'hook', 'shows', 'look', 'make', 'when', 'what',
  'which', 'where', 'while', 'have', 'been', 'their', 'there', 'they', 'them', 'your',
]);
