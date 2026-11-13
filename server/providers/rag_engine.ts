import type { DB } from '../db.js';

export interface RAGKnowledgeItem {
  id: number;
  category: 'CHOREOGRAPHY' | 'VIRAL_HOOKS' | 'CHARACTER_CONSISTENCY' | 'SAFETY_POLICY';
  title: string;
  content: string;
  tags: string[];
  metadata?: Record<string, any>;
  createdAt?: string;
}

export interface RAGSearchResult {
  item: RAGKnowledgeItem;
  score: number;
  matchedTokens: string[];
}

export const SEED_RAG_KNOWLEDGE: Omit<RAGKnowledgeItem, 'id'>[] = [
  // 1. Classical & Contemporary Choreography Knowledge
  {
    category: 'CHOREOGRAPHY',
    title: 'Alapadma Mudra (Blooming Lotus)',
    content: 'Full blooming lotus hand gesture with all fingers separated and gracefully curved outward. Symbolizes beauty, blooming grace, and dramatic revelation. In video prompts: "hands formed in precise Alapadma blooming lotus gesture, fingers delicately splayed".',
    tags: ['alapadma', 'lotus', 'mudra', 'kathak', 'bharatanatyam', 'indian', 'classical', 'grace'],
    metadata: { origin: 'Indo-Classical', visualAnchor: 'hands' },
  },
  {
    category: 'CHOREOGRAPHY',
    title: 'Mayura Mudra (Peacock Grace)',
    content: 'The peacock mudra formed by pressing the ring finger to the thumb tip while keeping other fingers extended straight. Evokes regal royalty, monsoon rain, and proud carriage. In video prompts: "regal posture with hands in Mayura peacock gesture, serene expression".',
    tags: ['mayura', 'peacock', 'mudra', 'monsoon', 'royalty', 'classical', 'indian'],
    metadata: { origin: 'Indo-Classical', visualAnchor: 'hands' },
  },
  {
    category: 'CHOREOGRAPHY',
    title: 'Kathak Chakkars (High-Speed Pirouettes)',
    content: 'Rapid spins performed on the heel and ball of the foot with sharp focal spotting. Causes silk anarkali skirts and flared fabric to fan out into a dramatic 360-degree radial cone. In video prompts: "mid-spin Kathak chakkar pirouette, flared circular silk hem billowing with rotational blur".',
    tags: ['kathak', 'spin', 'chakkar', 'pirouette', 'anarkali', 'silk', 'flair', 'rotation'],
    metadata: { origin: 'Kathak', visualAnchor: 'spin' },
  },
  {
    category: 'CHOREOGRAPHY',
    title: 'Flamenco Zapateado (Syncopated Footwork)',
    content: 'Rhythmic, percussive foot percussion where the dancer strikes the floor with the shoe tip, ball, and heel in complex counter-time polyrhythms. In video prompts: "intense Flamenco zapateado footwork, arched torso, sharp castanet posture under amber stage lights".',
    tags: ['flamenco', 'zapateado', 'footwork', 'rhythm', 'percussive', 'spanish', 'latina'],
    metadata: { origin: 'Flamenco', visualAnchor: 'footwork' },
  },
  {
    category: 'CHOREOGRAPHY',
    title: 'Afro-Fusion Torso & Shoulder Ripple',
    content: 'Poly-rhythmic spinal wave and rapid shoulder isolations synchronized to syncopated polyrhythms and sub-bass kicks. In video prompts: "dynamic Afro-fusion shoulder isolation and spinal wave, powerful grounded center of gravity".',
    tags: ['afro', 'afrobeats', 'isolation', 'ripple', 'polyrhythm', 'grounded', 'energy'],
    metadata: { origin: 'Afro-Fusion', visualAnchor: 'torso' },
  },
  {
    category: 'CHOREOGRAPHY',
    title: 'Contemporary Gravity Suspension & Drop',
    content: 'The dancer leaps into a high vertical extension, appears suspended at apex for a split second, then collapses gracefully into a fluid floor slide. In video prompts: "apex zero-gravity leap suspension, followed by an elegant liquid floor surrender".',
    tags: ['contemporary', 'leap', 'suspension', 'floorwork', 'gravity', 'ballet'],
    metadata: { origin: 'Contemporary', visualAnchor: 'leap' },
  },

  // 2. High-Retention Viral Hook Formats
  {
    category: 'VIRAL_HOOKS',
    title: 'The Unbroken Eye Contact Pivot',
    content: 'First 2 seconds: character maintains hypnotic unbroken eye contact directly into camera while the music suddenly drops to a muffled heartbeat pulse before an explosive beat drop.',
    tags: ['hook', 'eye contact', 'gaze', 'retention', 'viral', 'suspense', 'beat drop'],
    metadata: { retentionMultiplier: 1.45 },
  },
  {
    category: 'VIRAL_HOOKS',
    title: 'The Silhouette-to-Spotlight Reveal',
    content: 'First 3 seconds: extreme high-contrast black silhouette under backlight haze. At beat 3, an intense golden overhead spotlight illuminates the face and signature costume simultaneously.',
    tags: ['hook', 'silhouette', 'spotlight', 'reveal', 'lighting', 'contrast'],
    metadata: { retentionMultiplier: 1.38 },
  },
  {
    category: 'VIRAL_HOOKS',
    title: 'The Impossible Accelerando',
    content: 'The choreography starts at slow, hypnotic half-tempo, and abruptly doubles tempo every 4 beats, creating an overwhelming crescendo of speed and visual precision.',
    tags: ['hook', 'tempo', 'speed', 'crescendo', 'fast', 'accelerando'],
    metadata: { retentionMultiplier: 1.52 },
  },

  // 3. Character Consistency Rules
  {
    category: 'CHARACTER_CONSISTENCY',
    title: 'Facial Token Anchor Hierarchy',
    content: 'Always place locked facial identity tokens (e.g. eye color, cheekbones, hair texture) BEFORE environmental and lighting keywords. Negative prompts must explicitly forbid "face distortion, multiple faces, morphing, cartoon".',
    tags: ['consistency', 'tokens', 'face', 'identity', 'prompting', 'anchor'],
    metadata: { priority: 'CRITICAL' },
  },
  {
    category: 'CHARACTER_CONSISTENCY',
    title: 'Attire & Fabric Stability Directive',
    content: 'Keep fabric descriptions consistent across scenes (e.g. "midnight sapphire silk anarkali with gold embroidery"). Specifying the same weave and color ensures stable texture rendering without dress switching.',
    tags: ['costume', 'fabric', 'anarkali', 'silk', 'consistency', 'color'],
    metadata: { priority: 'HIGH' },
  },

  // 4. Safety & Content Policy Rules
  {
    category: 'SAFETY_POLICY',
    title: 'Luxury Dance Decorum Standard',
    content: 'All dance costumes must maintain luxury stage decorum with full lining. Avoid sheer or see-through without opaque backing. Maintain athletic and artistic classical integrity at all times.',
    tags: ['safety', 'policy', 'compliance', 'decorum', 'costume', 'guidelines'],
    metadata: { enforcement: 'STRICT' },
  },
];

export class RAGEngine {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
    this.seedDefaultsIfNeeded();
  }

  /**
   * Seeds default choreography & viral hook knowledge base if table is empty.
   */
  private seedDefaultsIfNeeded() {
    try {
      const count = this.db.prepare('SELECT COUNT(*) as c FROM rag_knowledge').get() as { c: number };
      if (count.c === 0) {
        const stmt = this.db.prepare(`
          INSERT INTO rag_knowledge (category, title, content, tags, metadata)
          VALUES (?, ?, ?, ?, ?)
        `);

        this.db.transaction(() => {
          for (const item of SEED_RAG_KNOWLEDGE) {
            stmt.run(
              item.category,
              item.title,
              item.content,
              JSON.stringify(item.tags),
              JSON.stringify(item.metadata || {})
            );
          }
        })();
      }
    } catch (_) {
      // Ignore if table not yet created during migrations
    }
  }

  /**
   * Performs semantic token-based relevance search across the RAG knowledge store.
   */
  public search(query: string, options?: { category?: string; limit?: number; minScore?: number }): RAGSearchResult[] {
    const limit = options?.limit || 4;
    const minScore = options?.minScore || 1.5;

    // Tokenize query
    const stopwords = new Set(['the', 'and', 'with', 'for', 'that', 'this', 'from', 'into', 'scene', 'dance', 'dancer']);
    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stopwords.has(t));

    if (queryTokens.length === 0) {
      // If query tokens are empty, return latest entries for category
      let sql = 'SELECT * FROM rag_knowledge';
      const params: any[] = [];
      if (options?.category) {
        sql += ' WHERE category = ?';
        params.push(options.category);
      }
      sql += ' ORDER BY id ASC LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params) as any[];
      return rows.map((r) => ({
        item: {
          ...r,
          tags: JSON.parse(r.tags || '[]'),
          metadata: JSON.parse(r.metadata || '{}'),
        },
        score: 2.0,
        matchedTokens: [],
      }));
    }

    let sql = 'SELECT * FROM rag_knowledge';
    const params: any[] = [];
    if (options?.category) {
      sql += ' WHERE category = ?';
      params.push(options.category);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    const scored: RAGSearchResult[] = [];

    for (const row of rows) {
      const tags: string[] = JSON.parse(row.tags || '[]');
      const titleLower = row.title.toLowerCase();
      const contentLower = row.content.toLowerCase();

      let score = 0;
      const matchedTokens: string[] = [];

      for (const token of queryTokens) {
        if (tags.some((tag) => tag.toLowerCase() === token || tag.toLowerCase().includes(token))) {
          score += 3.0;
          if (!matchedTokens.includes(token)) matchedTokens.push(token);
        } else if (titleLower.includes(token)) {
          score += 2.0;
          if (!matchedTokens.includes(token)) matchedTokens.push(token);
        } else if (contentLower.includes(token)) {
          score += 1.0;
          if (!matchedTokens.includes(token)) matchedTokens.push(token);
        }
      }

      if (score >= minScore) {
        scored.push({
          item: {
            ...row,
            tags,
            metadata: JSON.parse(row.metadata || '{}'),
          },
          score,
          matchedTokens,
        });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Enriches an LLM prompt with retrieved authentic dance and hook knowledge.
   */
  public enrichPromptWithRAG(basePrompt: string, category?: string): { enrichedPrompt: string; citations: string[] } {
    const results = this.search(basePrompt, { category, limit: 3 });
    if (results.length === 0) {
      return { enrichedPrompt: basePrompt, citations: [] };
    }

    const citations = results.map((r) => r.item.title);
    const knowledgeBlock = results
      .map((r) => `• [${r.item.category}] ${r.item.title}: ${r.item.content}`)
      .join('\n');

    const enrichedPrompt = `
[AUTHENTIC CHOREOGRAPHY & CONSISTENCY KNOWLEDGE BASE]:
${knowledgeBlock}

[INSTRUCTION]: Apply the authentic mudras, movement dynamics, and viral hook techniques from the knowledge base above to elevate the scene choreography:
${basePrompt}
    `.trim();

    return { enrichedPrompt, citations };
  }

  /**
   * Add a custom knowledge item to the RAG store.
   */
  public addKnowledge(item: Omit<RAGKnowledgeItem, 'id' | 'createdAt'>): RAGKnowledgeItem {
    const row = this.db.prepare(`
      INSERT INTO rag_knowledge (category, title, content, tags, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      item.category,
      item.title,
      item.content,
      JSON.stringify(item.tags || []),
      JSON.stringify(item.metadata || {})
    );

    return {
      id: Number(row.lastInsertRowid),
      ...item,
    };
  }

  /**
   * List all knowledge items with optional category filter.
   */
  public listKnowledge(category?: string): RAGKnowledgeItem[] {
    let sql = 'SELECT * FROM rag_knowledge';
    const params: any[] = [];
    if (category) {
      sql += ' WHERE category = ?';
      params.push(category);
    }
    sql += ' ORDER BY id ASC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      ...r,
      tags: JSON.parse(r.tags || '[]'),
      metadata: JSON.parse(r.metadata || '{}'),
    }));
  }
}
