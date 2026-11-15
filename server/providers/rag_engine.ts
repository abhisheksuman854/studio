import type { DB } from '../db.js';

export interface RAGKnowledgeItem {
  id: number;
  seedKey?: string | null;
  ownerId?: number | null;
  isSystemDefault: boolean;
  isQuarantined?: boolean;
  category: 'CHOREOGRAPHY' | 'VIRAL_HOOKS' | 'CHARACTER_CONSISTENCY' | 'SAFETY_POLICY';
  title: string;
  content: string;
  tags: string[];
  metadata?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

export interface RAGSearchResult {
  item: RAGKnowledgeItem;
  score: number;
  matchedTokens: string[];
}

export const SEED_RAG_KNOWLEDGE: (Omit<RAGKnowledgeItem, 'id' | 'isSystemDefault' | 'isQuarantined' | 'ownerId'> & { seedKey: string })[] = [
  // 1. Classical & Contemporary Choreography Knowledge
  {
    seedKey: 'canonical_v1_alapadma_mudra',
    category: 'CHOREOGRAPHY',
    title: 'Alapadma Mudra (Blooming Lotus)',
    content: 'Full blooming lotus hand gesture with all fingers separated and gracefully curved outward. Symbolizes beauty, blooming grace, and dramatic revelation. In video prompts: "hands formed in precise Alapadma blooming lotus gesture, fingers delicately splayed".',
    tags: ['alapadma', 'lotus', 'mudra', 'kathak', 'bharatanatyam', 'indian', 'classical', 'grace'],
    metadata: { origin: 'Indo-Classical', visualAnchor: 'hands' },
  },
  {
    seedKey: 'canonical_v1_mayura_mudra',
    category: 'CHOREOGRAPHY',
    title: 'Mayura Mudra (Peacock Grace)',
    content: 'The peacock mudra formed by pressing the ring finger to the thumb tip while keeping other fingers extended straight. Evokes regal royalty, monsoon rain, and proud carriage. In video prompts: "regal posture with hands in Mayura peacock gesture, serene expression".',
    tags: ['mayura', 'peacock', 'mudra', 'monsoon', 'royalty', 'classical', 'indian'],
    metadata: { origin: 'Indo-Classical', visualAnchor: 'hands' },
  },
  {
    seedKey: 'canonical_v1_kathak_chakkars',
    category: 'CHOREOGRAPHY',
    title: 'Kathak Chakkars (High-Speed Pirouettes)',
    content: 'Rapid spins performed on the heel and ball of the foot with sharp focal spotting. Causes silk anarkali skirts and flared fabric to fan out into a dramatic 360-degree radial cone. In video prompts: "mid-spin Kathak chakkar pirouette, flared circular silk hem billowing with rotational blur".',
    tags: ['kathak', 'spin', 'chakkar', 'pirouette', 'anarkali', 'silk', 'flair', 'rotation'],
    metadata: { origin: 'Kathak', visualAnchor: 'spin' },
  },
  {
    seedKey: 'canonical_v1_flamenco_zapateado',
    category: 'CHOREOGRAPHY',
    title: 'Flamenco Zapateado (Syncopated Footwork)',
    content: 'Rhythmic, percussive foot percussion where the dancer strikes the floor with the shoe tip, ball, and heel in complex counter-time polyrhythms. In video prompts: "intense Flamenco zapateado footwork, arched torso, sharp castanet posture under amber stage lights".',
    tags: ['flamenco', 'zapateado', 'footwork', 'rhythm', 'percussive', 'spanish', 'latina'],
    metadata: { origin: 'Flamenco', visualAnchor: 'footwork' },
  },
  {
    seedKey: 'canonical_v1_afro_fusion_torso',
    category: 'CHOREOGRAPHY',
    title: 'Afro-Fusion Torso & Shoulder Ripple',
    content: 'Poly-rhythmic spinal wave and rapid shoulder isolations synchronized to syncopated polyrhythms and sub-bass kicks. In video prompts: "dynamic Afro-fusion shoulder isolation and spinal wave, powerful grounded center of gravity".',
    tags: ['afro', 'afrobeats', 'isolation', 'ripple', 'polyrhythm', 'grounded', 'energy'],
    metadata: { origin: 'Afro-Fusion', visualAnchor: 'torso' },
  },
  {
    seedKey: 'canonical_v1_contemporary_gravity',
    category: 'CHOREOGRAPHY',
    title: 'Contemporary Gravity Suspension & Drop',
    content: 'The dancer leaps into a high vertical extension, appears suspended at apex for a split second, then collapses gracefully into a fluid floor slide. In video prompts: "apex zero-gravity leap suspension, followed by an elegant liquid floor surrender".',
    tags: ['contemporary', 'leap', 'suspension', 'floorwork', 'gravity', 'ballet'],
    metadata: { origin: 'Contemporary', visualAnchor: 'leap' },
  },

  // 2. High-Retention Viral Hook Formats
  {
    seedKey: 'canonical_v1_unbroken_eye_contact',
    category: 'VIRAL_HOOKS',
    title: 'The Unbroken Eye Contact Pivot',
    content: 'First 2 seconds: character maintains hypnotic unbroken eye contact directly into camera while the music suddenly drops to a muffled heartbeat pulse before an explosive beat drop.',
    tags: ['hook', 'eye contact', 'gaze', 'retention', 'viral', 'suspense', 'beat drop'],
    metadata: { retentionMultiplier: 1.45 },
  },
  {
    seedKey: 'canonical_v1_silhouette_spotlight',
    category: 'VIRAL_HOOKS',
    title: 'The Silhouette-to-Spotlight Reveal',
    content: 'First 3 seconds: extreme high-contrast black silhouette under backlight haze. At beat 3, an intense golden overhead spotlight illuminates the face and signature costume simultaneously.',
    tags: ['hook', 'silhouette', 'spotlight', 'reveal', 'lighting', 'contrast'],
    metadata: { retentionMultiplier: 1.38 },
  },
  {
    seedKey: 'canonical_v1_impossible_accelerando',
    category: 'VIRAL_HOOKS',
    title: 'The Impossible Accelerando',
    content: 'The choreography starts at slow, hypnotic half-tempo, and abruptly doubles tempo every 4 beats, creating an overwhelming crescendo of speed and visual precision.',
    tags: ['hook', 'tempo', 'speed', 'crescendo', 'fast', 'accelerando'],
    metadata: { retentionMultiplier: 1.52 },
  },

  // 3. Character Consistency Rules
  {
    seedKey: 'canonical_v1_facial_token_anchor',
    category: 'CHARACTER_CONSISTENCY',
    title: 'Facial Token Anchor Hierarchy',
    content: 'Always place locked facial identity tokens (e.g. eye color, cheekbones, hair texture) BEFORE environmental and lighting keywords. Negative prompts must explicitly forbid "face distortion, multiple faces, morphing, cartoon".',
    tags: ['consistency', 'tokens', 'face', 'identity', 'prompting', 'anchor'],
    metadata: { priority: 'CRITICAL' },
  },
  {
    seedKey: 'canonical_v1_attire_fabric_stability',
    category: 'CHARACTER_CONSISTENCY',
    title: 'Attire & Fabric Stability Directive',
    content: 'Keep fabric descriptions consistent across scenes (e.g. "midnight sapphire silk anarkali with gold embroidery"). Specifying the same weave and color ensures stable texture rendering without dress switching.',
    tags: ['costume', 'fabric', 'anarkali', 'silk', 'consistency', 'color'],
    metadata: { priority: 'HIGH' },
  },

  // 4. Safety & Content Policy Rules
  {
    seedKey: 'canonical_v1_luxury_dance_decorum',
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
   * Seeds verified canonical default choreography & viral hook knowledge base.
   * System defaults are strictly marked with seedKey, isSystemDefault=1, ownerId=NULL, isQuarantined=0.
   * Distinguishes missing canonical defaults from private records, and never overwrites user records.
   */
  private seedDefaultsIfNeeded() {
    try {
      const checkStmt = this.db.prepare('SELECT id FROM rag_knowledge WHERE seedKey = ?');
      const insertStmt = this.db.prepare(`
        INSERT INTO rag_knowledge (seedKey, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 1, 0)
      `);

      this.db.transaction(() => {
        for (const item of SEED_RAG_KNOWLEDGE) {
          const existing = checkStmt.get(item.seedKey);
          if (!existing) {
            insertStmt.run(
              item.seedKey,
              item.category,
              item.title,
              item.content,
              JSON.stringify(item.tags),
              JSON.stringify(item.metadata || {})
            );
          }
        }
      })();
    } catch (_) {
      // Ignore if table not yet created during migrations
    }
  }

  /**
   * Performs tenant-isolated semantic token-based relevance search across the RAG knowledge store.
   * Scopes strictly to (ownerId = userId OR isSystemDefault = 1) AND isQuarantined = 0.
   */
  public search(
    query: string,
    options?: { userId?: number; category?: string; limit?: number; minScore?: number }
  ): RAGSearchResult[] {
    const limit = options?.limit || 4;
    const minScore = options?.minScore ?? 1.0;
    const userId = options?.userId;

    // Tokenize query
    const stopwords = new Set(['the', 'and', 'with', 'for', 'that', 'this', 'from', 'into', 'scene', 'dance', 'dancer']);
    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stopwords.has(t));

    // Base query enforces tenant boundary and quarantine status at the SQL layer
    let sql = 'SELECT * FROM rag_knowledge WHERE ';
    const params: any[] = [];
    if (userId !== undefined && userId !== null) {
      sql += '(ownerId = ? OR isSystemDefault = 1)';
      params.push(userId);
    } else {
      sql += 'isSystemDefault = 1';
    }
    sql += ' AND isQuarantined = 0';

    if (options?.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }

    if (queryTokens.length === 0) {
      sql += ' ORDER BY isSystemDefault DESC, id ASC LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params) as any[];
      return rows.map((r) => ({
        item: {
          ...r,
          seedKey: r.seedKey ?? null,
          isSystemDefault: Boolean(r.isSystemDefault),
          isQuarantined: Boolean(r.isQuarantined),
          tags: JSON.parse(r.tags || '[]'),
          metadata: JSON.parse(r.metadata || '{}'),
        },
        score: 2.0,
        matchedTokens: [],
      }));
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
        if (tags.some((tag) => {
          const tLower = tag.toLowerCase();
          return tLower === token || tLower.includes(token);
        })) {
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
            seedKey: row.seedKey ?? null,
            isSystemDefault: Boolean(row.isSystemDefault),
            isQuarantined: Boolean(row.isQuarantined),
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
   * Enriches an LLM prompt with retrieved authentic dance and hook knowledge,
   * scoped strictly to the requesting user's tenant context and verified system defaults.
   */
  public enrichPromptWithRAG(
    basePrompt: string,
    options?: { userId?: number; category?: string; limit?: number } | string
  ): { enrichedPrompt: string; citations: string[] } {
    const opts = typeof options === 'string' ? { category: options } : options;

    const results = this.search(basePrompt, {
      userId: opts?.userId,
      category: opts?.category,
      limit: opts?.limit || 3,
    });
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
   * Add a private user-owned knowledge item to the RAG store.
   * All runtime user additions are strictly private records (isSystemDefault=0, seedKey=NULL).
   * Canonical system defaults can only be established via authorized forward migrations.
   */
  public addKnowledge(
    item: Omit<RAGKnowledgeItem, 'id' | 'createdAt' | 'isSystemDefault' | 'isQuarantined' | 'seedKey'>,
    ownerId?: number | null
  ): RAGKnowledgeItem {
    const row = this.db.prepare(`
      INSERT INTO rag_knowledge (seedKey, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
    `).run(
      null,
      item.category,
      item.title,
      item.content,
      JSON.stringify(item.tags || []),
      JSON.stringify(item.metadata || {}),
      ownerId ?? null
    );

    return {
      id: Number(row.lastInsertRowid),
      seedKey: null,
      ownerId: ownerId ?? null,
      isSystemDefault: false,
      isQuarantined: false,
      ...item,
    };
  }

  /**
   * Updates a user-owned knowledge item.
   * Enforces that system-default records are immutable and users cannot edit other tenants' records.
   */
  public updateKnowledge(
    id: number,
    userId: number,
    updates: {
      category?: 'CHOREOGRAPHY' | 'VIRAL_HOOKS' | 'CHARACTER_CONSISTENCY' | 'SAFETY_POLICY';
      title?: string;
      content?: string;
      tags?: string[];
      metadata?: Record<string, any>;
    }
  ): { ok: boolean; status: 200 | 403 | 404; item?: RAGKnowledgeItem; error?: string } {
    const existing = this.db.prepare('SELECT * FROM rag_knowledge WHERE id = ?').get(id) as any;
    if (!existing || existing.isQuarantined) {
      return { ok: false, status: 404, error: 'Knowledge item not found' };
    }
    if (existing.isSystemDefault) {
      return { ok: false, status: 403, error: 'System default knowledge items are immutable' };
    }
    if (existing.ownerId !== userId) {
      return { ok: false, status: 404, error: 'Knowledge item not found' };
    }

    const newCategory = updates.category ?? existing.category;
    const newTitle = updates.title ?? existing.title;
    const newContent = updates.content ?? existing.content;
    const newTags = updates.tags !== undefined ? JSON.stringify(updates.tags) : existing.tags;
    const newMetadata = updates.metadata !== undefined ? JSON.stringify(updates.metadata) : existing.metadata;

    this.db.prepare(`
      UPDATE rag_knowledge
      SET category = ?, title = ?, content = ?, tags = ?, metadata = ?
      WHERE id = ? AND ownerId = ? AND isSystemDefault = 0
    `).run(newCategory, newTitle, newContent, newTags, newMetadata, id, userId);

    const updated = this.db.prepare('SELECT * FROM rag_knowledge WHERE id = ?').get(id) as any;
    return {
      ok: true,
      status: 200,
      item: {
        ...updated,
        seedKey: updated.seedKey ?? null,
        isSystemDefault: false,
        isQuarantined: false,
        tags: JSON.parse(updated.tags || '[]'),
        metadata: JSON.parse(updated.metadata || '{}'),
      },
    };
  }

  /**
   * Deletes a user-owned knowledge item.
   * Enforces that system-default records cannot be deleted and users cannot delete other tenants' records.
   */
  public deleteKnowledge(id: number, userId: number): { ok: boolean; status: 200 | 403 | 404; error?: string } {
    const existing = this.db.prepare('SELECT * FROM rag_knowledge WHERE id = ?').get(id) as any;
    if (!existing || existing.isQuarantined) {
      return { ok: false, status: 404, error: 'Knowledge item not found' };
    }
    if (existing.isSystemDefault) {
      return { ok: false, status: 403, error: 'System default knowledge items cannot be deleted' };
    }
    if (existing.ownerId !== userId) {
      return { ok: false, status: 404, error: 'Knowledge item not found' };
    }

    this.db.prepare('DELETE FROM rag_knowledge WHERE id = ? AND ownerId = ? AND isSystemDefault = 0').run(id, userId);
    return { ok: true, status: 200 };
  }

  /**
   * List knowledge items visible to the authenticated tenant.
   * Returns only (ownerId = userId OR isSystemDefault = 1) AND isQuarantined = 0.
   */
  public listKnowledge(userId?: number, category?: string): RAGKnowledgeItem[] {
    let sql = 'SELECT * FROM rag_knowledge WHERE ';
    const params: any[] = [];
    if (userId !== undefined && userId !== null) {
      sql += '(ownerId = ? OR isSystemDefault = 1)';
      params.push(userId);
    } else {
      sql += 'isSystemDefault = 1';
    }
    sql += ' AND isQuarantined = 0';

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY isSystemDefault DESC, id ASC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      ...r,
      seedKey: r.seedKey ?? null,
      isSystemDefault: Boolean(r.isSystemDefault),
      isQuarantined: Boolean(r.isQuarantined),
      tags: JSON.parse(r.tags || '[]'),
      metadata: JSON.parse(r.metadata || '{}'),
    }));
  }
}
