import type { BrandContext, CharacterContext, GeneratedStory, GeneratedStoryScene, IdeaItem, LLMExecutionMetadata, LLMErrorEvidence, LLMProvider } from './types.js';
import type { RAGEngine } from './rag_engine.js';
import type { ResourceCoordinator, Reservation } from '../coordinator/index.js';
import type { OllamaLifecycleAdapter, ModelAvailabilityStatus } from '../coordinator/ollama_lifecycle.js';

export type LLMErrorCode =
  | 'LLM_UNAVAILABLE'
  | 'LLM_TIMEOUT'
  | 'LLM_UNCERTAIN_DISRUPTION'
  | 'LLM_MODEL_NOT_FOUND'
  | 'LLM_INVALID_REQUEST'
  | 'LLM_PROVIDER_ERROR'
  | 'LLM_INVALID_RESPONSE'
  | 'LLM_INVALID_OUTPUT'
  | 'LLM_INTERNAL_ERROR';

export class SanitizedLLMError extends Error {
  constructor(
    public readonly code: LLMErrorCode,
    message: string,
    public readonly evidence: LLMErrorEvidence = 'TERMINATION_UNCERTAIN'
  ) {
    super(`[${code}] ${message}`);
    this.name = 'SanitizedLLMError';
  }
}

export function validateOllamaEndpoint(endpoint: string): string {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    throw new Error('Ollama endpoint must be a non-empty string');
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint.trim());
  } catch (err: any) {
    throw new Error(`Invalid Ollama endpoint URL: ${err.message || 'malformed URL'}`);
  }

  // 1. Protocol check: strict http: only
  if (parsed.protocol !== 'http:') {
    throw new Error(`Invalid Ollama endpoint protocol: "${parsed.protocol}". Only unencrypted HTTP on local loopback is permitted.`);
  }

  // 2. Credentials check
  if (parsed.username || parsed.password) {
    throw new Error('Ollama endpoint must not contain user credentials');
  }

  // 3. Port check: standard Ollama port 11434 only
  if (parsed.port !== '11434') {
    throw new Error(`Invalid Ollama endpoint port: "${parsed.port || 'default'}". Expected port 11434.`);
  }

  // 4. Hostname check: loopback only (127.0.0.1, localhost, [::1])
  const validLoopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (!validLoopbackHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error(`Invalid Ollama host: "${parsed.hostname}". Only local loopback addresses (127.0.0.1, localhost, [::1]) are permitted.`);
  }

  return `${parsed.protocol}//${parsed.host}`;
}

export interface OllamaProviderOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  admissionTimeoutMs?: number;
  temperature?: number;
  keepAlive?: string | number;
  fetchFn?: typeof fetch;
  coordinator?: ResourceCoordinator;
  lifecycleAdapter?: OllamaLifecycleAdapter;
}

export class LocalLLMProvider implements LLMProvider {
  private ragEngine?: RAGEngine;

  constructor(ragEngine?: RAGEngine) {
    this.ragEngine = ragEngine;
  }

  async generateIdeas(brand: BrandContext, count = 5): Promise<IdeaItem[]> {
    const topics = brand.preferredTopics.length > 0
      ? brand.preferredTopics
      : ['Dramatic stage solo', 'The phantom choreography', 'Midnight overture', 'The golden velvet dress', 'Spotlight illusion'];

    const tones = brand.tone ? brand.tone.split(',').map((s) => s.trim()) : ['elegant', 'dramatic', 'mysterious'];
    const results: IdeaItem[] = [];

    const ideaTemplates = [
      {
        titleSuffix: 'The Hidden Tempo',
        premiseTpl: (t: string, b: string) => `A lone dancer on an empty illuminated stage discovers a secret musical tempo hidden behind the theater walls, leading to an impossible ${t} routine.`,
        cat: 'Choreography & Mystery',
        diff: 'MEDIUM' as const,
      },
      {
        titleSuffix: 'Shadow & Spotlight',
        premiseTpl: (t: string, b: string) => `When the main stage lights malfunction, an artist improvises a silhouette routine with dramatic side-lighting and ${t}, mesmerizing the unseen audience.`,
        cat: 'Stage Performance',
        diff: 'EASY' as const,
      },
      {
        titleSuffix: 'The Velvet Mask',
        premiseTpl: (t: string, b: string) => `An enigmatic performer wearing vintage stage attire executes a breathtaking sequence of syncopated movements before vanishing behind the red curtains.`,
        cat: 'Theatrical Drama',
        diff: 'MEDIUM' as const,
      },
      {
        titleSuffix: 'Overture at Midnight',
        premiseTpl: (t: string, b: string) => `An orchestra crescendo matches every subtle movement of a solo dancer, revealing an emotional tale of passion and precision in ${t}.`,
        cat: 'Music & Storytelling',
        diff: 'HARD' as const,
      },
      {
        titleSuffix: 'Echoes in the Wings',
        premiseTpl: (t: string, b: string) => `Backstage tension dissolves into a stunning display of rhythmic choreography under golden incandescent stage lamps.`,
        cat: 'Behind the Curtain',
        diff: 'MEDIUM' as const,
      },
      {
        titleSuffix: 'The Grand Finale Illusion',
        premiseTpl: (t: string, b: string) => `A dramatic climax where the choreography seems to defy gravity, creating a visual cliffhanger that leaves viewers rewatching.`,
        cat: 'Visual Spectacle',
        diff: 'HARD' as const,
      },
    ];

    for (let i = 0; i < count; i++) {
      const tpl = ideaTemplates[i % ideaTemplates.length];
      const selectedTopic = topics[i % topics.length];
      const randomTone = tones[i % tones.length];

      const potentialScore = 80 + Math.floor(Math.sin(i + 1) * 12 + 5);
      const originalityScore = 85 + Math.floor(Math.cos(i + 2) * 10 + 4);
      const visualPotentialScore = 88 + Math.floor(Math.sin(i * 3) * 8 + 3);

      results.push({
        title: `${brand.name || 'Studio'}: ${tpl.titleSuffix} (Vol. ${i + 1})`,
        premise: tpl.premiseTpl(selectedTopic, brand.name),
        category: tpl.cat,
        potentialScore: Math.min(99, Math.max(70, potentialScore)),
        originalityScore: Math.min(98, Math.max(75, originalityScore)),
        visualPotentialScore: Math.min(99, Math.max(80, visualPotentialScore)),
        difficulty: tpl.diff,
        audienceFit: `Targeted for age ${brand.targetAgeMin || 21}-${brand.targetAgeMax || 60} with interest in ${selectedTopic} and a ${randomTone} mood.`,
        tags: [selectedTopic, randomTone, tpl.cat, brand.niche || 'Entertainment'].slice(0, 4),
        scoreSource: 'deterministic',
        metadata: Object.freeze({
          provider: 'deterministic',
          fallbackOccurred: false,
          latencyMs: 1,
        }),
      });
    }

    return results;
  }

  async generateStory(brand: BrandContext, topic: string, customPremise?: string, character?: CharacterContext, userId?: number): Promise<GeneratedStory> {
    const title = `${brand.name || 'Studio'} — ${topic || 'The Stage Enigma'}`;
    const tone = brand.tone || 'elegant, confident, moody, sensual but classy';
    const visualStyle = brand.visualStyle || 'Dramatic stage lighting, deep shadows, rich textures, 9:16 vertical composition';

    // Retrieve authentic dance mudras and choreography patterns via RAG if available (scoped to tenant context)
    let retrievedMudraText = 'fluid hand choreography and expressive eye contact';
    let retrievedChoreoMovement = 'dynamic, high-precision dance movement, trailing motion blur';
    let retrievedHookText = 'They say the stage only reveals its true secret when the final spotlight cuts through the silence.';

    if (this.ragEngine) {
      const targetUserId = userId ?? (brand as any).ownerId;
      const query = `${topic} ${brand.niche || ''} ${character?.personality || ''} ${character?.appearance || ''}`;
      const mudraResults = this.ragEngine.search(query, { userId: targetUserId, category: 'CHOREOGRAPHY', limit: 2 });
      if (mudraResults.length > 0) {
        retrievedMudraText = `${mudraResults[0].item.title} (${mudraResults[0].item.content.split('.')[0]})`;
        if (mudraResults.length > 1) {
          retrievedChoreoMovement = `${mudraResults[1].item.title}, executing ${mudraResults[1].item.content.split('.')[0]}`;
        }
      }

      const hookResults = this.ragEngine.search(query, { userId: targetUserId, category: 'VIRAL_HOOKS', limit: 1 });
      if (hookResults.length > 0) {
        retrievedHookText = `${hookResults[0].item.content.split('.')[0]}.`;
      }
    }

    const charDesc = character
      ? `${character.name}, a solo dancer with ${character.appearance || 'striking sculpted features and magnetic gaze'}, wearing ${character.clothingStyle || 'a midnight crimson silk gown'}, ${character.personality || 'confident and graceful'}`
      : `a world-class solo dancer in elegant theatrical stage attire`;

    const premise = customPremise || `An atmospheric 45-second performance featuring ${character?.name || 'the solo dancer'} uncovering a mesmerizing choreography piece under dramatic spotlighting, capturing intense suspense and artistry.`;

    const scenes: GeneratedStoryScene[] = [
      {
        sceneOrder: 1,
        durationSec: 5,
        narration: retrievedHookText,
        visualPrompt: `Vertical 9:16, dark theater stage, single intense overhead golden spotlight cutting through atmospheric haze, ${charDesc} standing center stage in silhouette, cinematic contrast, 8k resolution, dramatic ${tone} aesthetic.`,
        voiceDirection: character?.voiceStyle || 'Intriguing, calm, low register, confident and magnetic',
        soundEffects: 'Distorted vinyl crackle, distant low bass hum, single stage light switch click',
        musicDirection: 'Slow atmospheric cello build with soft pulse',
      },
      {
        sceneOrder: 2,
        durationSec: 10,
        narration: `Every step was calculated. Every rhythm counted in the dark. But tonight, the tempo was completely different.`,
        visualPrompt: `Vertical 9:16, close-up shot of ${character?.name || 'the dancer'}'s intense gaze and hands executing ${retrievedMudraText}, ${character?.clothingStyle || 'luxurious velvet and liquid silk'} catching dramatic rim lighting, moody shadows, ${visualStyle}.`,
        voiceDirection: character?.voiceStyle || 'Building pace, steady, sophisticated',
        soundEffects: 'Soft stage floor tap resonating, silk cloth rustle',
        musicDirection: 'Syncopated acoustic percussion entering softly',
      },
      {
        sceneOrder: 3,
        durationSec: 12,
        narration: `As the music accelerates, the boundaries between the dancer and the stage vanish into pure choreography.`,
        visualPrompt: `Vertical 9:16, full-body shot of ${character?.name || 'the dancer'} executing dynamic dance choreography with ${retrievedChoreoMovement}, glowing ambient chandeliers, theatrical depth of field, ${tone}.`,
        voiceDirection: 'Energetic, elevated intensity, dramatic cadence',
        soundEffects: 'Crescendo whoosh, sharp brass accent hit',
        musicDirection: 'Full orchestral crescendo with modern rhythm beats',
      },
      {
        sceneOrder: 4,
        durationSec: 10,
        narration: `In that split second before the applause, the mystery came into full view.`,
        visualPrompt: `Vertical 9:16, striking high-angle freeze frame of ${character?.name || 'the dancer'} in a climax pose, dramatic backlight halo effect, floating golden dust particles in beam of light, ultra-crisp detail.`,
        voiceDirection: 'Climactic whisper fading into awe',
        soundEffects: 'Reverberant cymbal wash, sharp intake of breath',
        musicDirection: 'Sudden melodic suspension with lingering piano chord',
      },
      {
        sceneOrder: 5,
        durationSec: 8,
        narration: `Did you catch the hidden sequence? Replay and look closely at the third move. Follow ${brand.handle || brand.name || 'our channel'} for the next act.`,
        visualPrompt: `Vertical 9:16, sleek closing scene card featuring ${character?.name || 'the dancer'} with glowing minimalist emblem of ${brand.name}, stage curtains gently closing, subtle golden ember particles floating up.`,
        voiceDirection: 'Inviting, smooth call to action, memorable sign-off',
        soundEffects: 'Velvet curtain sweep, subtle notification chime',
        musicDirection: 'Warm resolving outro chord',
        endingType: 'Rewatch hook & Subscribe CTA',
      },
    ];

    const totalDuration = scenes.reduce((acc, s) => acc + s.durationSec, 0);

    return {
      title,
      hook: scenes[0].narration,
      premise,
      targetDurationSec: totalDuration,
      language: brand.language || 'English',
      tone,
      endingType: 'Cliffhanger CTA',
      scenes,
      metadata: Object.freeze({
        provider: 'deterministic',
        fallbackOccurred: false,
        latencyMs: 1,
      }),
    };
  }
}

const IDEAS_JSON_SCHEMA = {
  type: 'object',
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'title',
          'premise',
          'category',
          'potentialScore',
          'originalityScore',
          'visualPotentialScore',
          'difficulty',
          'audienceFit',
          'tags',
        ],
        properties: {
          title: { type: 'string' },
          premise: { type: 'string' },
          category: { type: 'string' },
          potentialScore: { type: 'integer' },
          originalityScore: { type: 'integer' },
          visualPotentialScore: { type: 'integer' },
          difficulty: { type: 'string', enum: ['EASY', 'MEDIUM', 'HARD'] },
          audienceFit: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const STORY_JSON_SCHEMA = {
  type: 'object',
  required: ['title', 'hook', 'premise', 'targetDurationSec', 'language', 'tone', 'endingType', 'scenes'],
  properties: {
    title: { type: 'string' },
    hook: { type: 'string' },
    premise: { type: 'string' },
    targetDurationSec: { type: 'integer' },
    language: { type: 'string' },
    tone: { type: 'string' },
    endingType: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sceneOrder', 'durationSec', 'narration', 'visualPrompt', 'voiceDirection'],
        properties: {
          sceneOrder: { type: 'integer' },
          durationSec: { type: 'integer' },
          narration: { type: 'string' },
          dialogue: { type: 'string' },
          visualPrompt: { type: 'string' },
          voiceDirection: { type: 'string' },
          soundEffects: { type: 'string' },
          musicDirection: { type: 'string' },
          endingType: { type: 'string' },
        },
      },
    },
  },
};

export class OllamaLLMProvider implements LLMProvider {
  private ragEngine?: RAGEngine;
  private baseUrl: string;
  public readonly model: string;
  private timeoutMs: number;
  private admissionTimeoutMs?: number;
  private temperature: number;
  private keepAlive?: string | number;
  private fetchFn: typeof fetch;
  public readonly coordinator?: ResourceCoordinator;
  public readonly lifecycleAdapter?: OllamaLifecycleAdapter;

  constructor(ragEngine?: RAGEngine, options: OllamaProviderOptions = {}) {
    this.ragEngine = ragEngine;
    const rawEndpoint = options.baseUrl || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    this.baseUrl = validateOllamaEndpoint(rawEndpoint);
    this.model = options.model || 'qwen2.5:1.5b';
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.admissionTimeoutMs = options.admissionTimeoutMs;
    this.temperature = options.temperature ?? 0.7;
    this.keepAlive = options.keepAlive;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.coordinator = options.coordinator;
    this.lifecycleAdapter = options.lifecycleAdapter;
  }

  private async executeWithCoordination<T>(
    operation: string,
    ownerId: string,
    metadata: Record<string, unknown>,
    execute: (reservationId?: string) => Promise<T>
  ): Promise<T> {
    if (!this.coordinator) {
      return execute();
    }

    const admissionTimeout = this.admissionTimeoutMs ?? this.timeoutMs;
    const coordinatorAny = this.coordinator as any;
    const reservation = await this.coordinator.acquire('LLM', ownerId, {
      pid: process.pid,
      metadata: {
        operation,
        model: this.model,
        nodePid: process.pid,
        processInstanceId: coordinatorAny?.processInstanceId,
        processStartedAt: coordinatorAny?.processStartedAt,
        ...metadata,
      },
      timeoutMs: admissionTimeout,
    });

    this.lifecycleAdapter?.startRequest(reservation.id, ownerId);

    try {
      const result = await execute(reservation.id);
      this.lifecycleAdapter?.completeRequest(reservation.id);
      await reservation.release();
      return result;
    } catch (err: any) {
      const evidence: LLMErrorEvidence =
        err instanceof SanitizedLLMError && err.evidence
          ? err.evidence
          : err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.message?.includes('timed out')
          ? 'TERMINATION_UNCERTAIN'
          : 'TERMINATION_UNCERTAIN';

      (err as any).reservationId = reservation.id;
      (err as any).errorEvidence = evidence;

      if (evidence === 'TERMINATION_UNCERTAIN') {
        // UNCERTAIN: Daemon execution state cannot be proven stopped -> FAIL CLOSED
        this.lifecycleAdapter?.failRequest(reservation.id, err, true);
        this.coordinator.markRecoveryRequired(
          reservation.id,
          `Inference request ended with uncertain daemon execution state: ${err?.message || err}`
        );
        // Do NOT release reservation!
      } else {
        // TERMINATION_VERIFIED, NOT_DISPATCHED, REJECTED_BEFORE_INFERENCE, COMPLETED_WITH_RESPONSE
        this.lifecycleAdapter?.completeRequest(reservation.id);
        try {
          await reservation.release();
        } catch {
          // Ignore secondary release error
        }
      }

      throw err;
    }
  }

  /**
   * Diagnostic model availability checker (Workstream F).
   */
  public async checkModelAvailability(): Promise<ModelAvailabilityStatus> {
    if (this.lifecycleAdapter) {
      return this.lifecycleAdapter.checkModelAvailability();
    }
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return {
          configuredModel: this.model,
          installedModels: [],
          isConfiguredModelInstalled: false,
          daemonAvailable: false,
          status: 'DAEMON_UNAVAILABLE',
        };
      }
      const data = (await res.json()) as any;
      const rawModels = Array.isArray(data?.models) ? data.models : [];
      const installedModels: string[] = rawModels
        .map((m: any) => m.name || m.model || String(m))
        .filter(Boolean);
      const isConfiguredModelInstalled = installedModels.some(
        (m: string) =>
          m === this.model ||
          m.startsWith(this.model) ||
          (this.model.includes(':') ? m === this.model : m.startsWith(`${this.model}:`))
      );
      return {
        configuredModel: this.model,
        installedModels,
        isConfiguredModelInstalled,
        daemonAvailable: true,
        status: isConfiguredModelInstalled ? 'AVAILABLE' : 'MODEL_NOT_INSTALLED',
      };
    } catch {
      return {
        configuredModel: this.model,
        installedModels: [],
        isConfiguredModelInstalled: false,
        daemonAvailable: false,
        status: 'DAEMON_UNAVAILABLE',
      };
    }
  }

  private async callChat(messages: Array<{ role: string; content: string }>, schema?: any): Promise<any> {
    const url = `${this.baseUrl}/api/chat`;
    const body: Record<string, any> = {
      model: this.model,
      messages,
      stream: false,
      options: {
        temperature: this.temperature,
      },
    };

    if (schema) {
      body.format = schema;
    }

    if (this.keepAlive !== undefined) {
      body.keep_alive = this.keepAlive;
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new SanitizedLLMError(
          'LLM_TIMEOUT',
          `Inference request timed out after ${this.timeoutMs}ms`,
          'TERMINATION_UNCERTAIN'
        );
      }
      const msg = err?.message || String(err);
      const cause = err?.cause;
      const isConnectionRefused =
        cause?.code === 'ECONNREFUSED' ||
        cause?.syscall === 'connect' ||
        msg.includes('ECONNREFUSED');

      if (isConnectionRefused) {
        throw new SanitizedLLMError(
          'LLM_UNAVAILABLE',
          `Local Ollama service unreachable at ${this.baseUrl}`,
          'NOT_DISPATCHED'
        );
      }

      // Mid-stream socket disruption, premature close, broken pipe, or ambiguous fetch failure
      throw new SanitizedLLMError(
        'LLM_UNCERTAIN_DISRUPTION',
        `Network socket disruption during local LLM request: ${msg}`,
        'TERMINATION_UNCERTAIN'
      );
    }

    if (!response.ok) {
      const status = response.status;
      let errText = '';
      try {
        errText = await response.text();
      } catch {}

      if (status === 404 && errText.toLowerCase().includes('not found')) {
        throw new SanitizedLLMError(
          'LLM_MODEL_NOT_FOUND',
          `Model '${this.model}' not found in local Ollama store`,
          'REJECTED_BEFORE_INFERENCE'
        );
      }

      if (status === 400) {
        throw new SanitizedLLMError(
          'LLM_INVALID_REQUEST',
          `Ollama rejected request as invalid (HTTP 400)`,
          'REJECTED_BEFORE_INFERENCE'
        );
      }

      throw new SanitizedLLMError(
        'LLM_INVALID_RESPONSE',
        `Ollama HTTP error ${status}`,
        'COMPLETED_WITH_RESPONSE'
      );
    }

    let envelope: any;
    try {
      envelope = await response.json();
    } catch {
      throw new SanitizedLLMError(
        'LLM_INVALID_RESPONSE',
        'Ollama returned non-JSON HTTP response',
        'COMPLETED_WITH_RESPONSE'
      );
    }

    const content = envelope?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new SanitizedLLMError(
        'LLM_INVALID_RESPONSE',
        'Ollama response missing message content',
        'COMPLETED_WITH_RESPONSE'
      );
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new SanitizedLLMError(
        'LLM_INVALID_RESPONSE',
        'Model output failed JSON parsing',
        'COMPLETED_WITH_RESPONSE'
      );
    }
  }

  async generateIdeas(brand: BrandContext, count = 5): Promise<IdeaItem[]> {
    const ownerId = (brand as any).ownerId ? `user:${(brand as any).ownerId}` : (brand.id ? `brand:${brand.id}` : 'system:llm');
    return this.executeWithCoordination('generateIdeas', ownerId, { brandId: brand.id }, async (reservationId) => {
      const topics = brand.preferredTopics.length > 0
        ? brand.preferredTopics.join(', ')
        : 'Solo classical choreography, dramatic theatrical performance, golden velvet costume, midnight overture';

      const systemPrompt = [
        'You are a professional creative content strategist for cultural and performing arts video productions.',
        'Generate a structured JSON object containing an array of high-concept video ideas.',
        'Strictly adhere to the provided JSON Schema.',
      ].join(' ');

      const userPrompt = [
        `Brand Name: "${brand.name || 'Studio'}"`,
        `Niche: "${brand.niche || 'Classical Dance & Performance'}"`,
        `Tone: "${brand.tone || 'elegant, dramatic, mysterious'}"`,
        `Target Demographics: Age ${brand.targetAgeMin || 21}-${brand.targetAgeMax || 60}`,
        `Key Topics: ${topics}`,
        `Requested Idea Count: ${count}`,
        'Generate exactly the requested number of high-quality video concept ideas.',
      ].join('\n');

      const startTime = Date.now();
      const parsed = await this.callChat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], IDEAS_JSON_SCHEMA);

      if (!parsed || !Array.isArray(parsed.ideas)) {
        throw new SanitizedLLMError('LLM_INVALID_OUTPUT', 'Structured output missing ideas array');
      }

      const latencyMs = Date.now() - startTime;
      const validated: IdeaItem[] = [];
      for (const item of parsed.ideas) {
        if (typeof item.title !== 'string' || typeof item.premise !== 'string' || typeof item.category !== 'string') {
          throw new SanitizedLLMError('LLM_INVALID_OUTPUT', 'Idea item missing required string fields');
        }

        const diff = (['EASY', 'MEDIUM', 'HARD'].includes(item.difficulty) ? item.difficulty : 'MEDIUM') as 'EASY' | 'MEDIUM' | 'HARD';

        // Truthful score contract: preserve valid model score without artificial upward clamping;
        // if missing, null, non-numeric or out-of-range, mark as unavailable (null) with no invented defaults.
        let potentialScore: number | null = null;
        let scoreSource: 'model' | 'deterministic' | 'unavailable' = 'unavailable';

        if (
          typeof item.potentialScore === 'number' &&
          !Number.isNaN(item.potentialScore) &&
          Number.isFinite(item.potentialScore) &&
          item.potentialScore >= 0 &&
          item.potentialScore <= 100
        ) {
          potentialScore = Math.round(item.potentialScore);
          scoreSource = 'model';
        } else {
          potentialScore = null;
          scoreSource = 'unavailable';
        }

        const origScore = typeof item.originalityScore === 'number' && Number.isFinite(item.originalityScore) && item.originalityScore >= 0 && item.originalityScore <= 100
          ? Math.round(item.originalityScore)
          : 85;
        const visScore = typeof item.visualPotentialScore === 'number' && Number.isFinite(item.visualPotentialScore) && item.visualPotentialScore >= 0 && item.visualPotentialScore <= 100
          ? Math.round(item.visualPotentialScore)
          : 85;

        validated.push({
          title: item.title.trim().slice(0, 200),
          premise: item.premise.trim().slice(0, 1000),
          category: item.category.trim().slice(0, 100),
          potentialScore,
          originalityScore: origScore,
          visualPotentialScore: visScore,
          difficulty: diff,
          audienceFit: typeof item.audienceFit === 'string' && item.audienceFit.trim()
            ? item.audienceFit.trim().slice(0, 300)
            : `Targeted for fans of ${brand.name || 'performing arts'}.`,
          tags: Array.isArray(item.tags)
            ? item.tags.map((t: any) => String(t).trim().slice(0, 50)).filter(Boolean).slice(0, 6)
            : [brand.niche || 'Performance'],
          scoreSource,
          metadata: Object.freeze({
            provider: 'ollama',
            fallbackOccurred: false,
            model: this.model,
            latencyMs,
            reservationId,
          }),
        });
      }

      if (validated.length === 0) {
        throw new SanitizedLLMError('LLM_INVALID_OUTPUT', 'Model produced empty ideas array', 'COMPLETED_WITH_RESPONSE');
      }

      return validated.slice(0, count);
    });
  }

  async generateStory(brand: BrandContext, topic: string, customPremise?: string, character?: CharacterContext, userId?: number): Promise<GeneratedStory> {
    const ownerId = userId ? `user:${userId}` : ((brand as any).ownerId ? `user:${(brand as any).ownerId}` : (brand.id ? `brand:${brand.id}` : 'system:llm'));
    return this.executeWithCoordination('generateStory', ownerId, { brandId: brand.id, topic, userId }, async (reservationId) => {
      const tone = brand.tone || 'elegant, confident, moody, sensual but classy';
      const visualStyle = brand.visualStyle || 'Dramatic stage lighting, deep shadows, rich textures, 9:16 vertical composition';

      // RAG Context Retrieval — strictly scoped to authenticated tenant
      let retrievedMudraText = 'fluid hand choreography and expressive eye contact';
      let retrievedChoreoMovement = 'dynamic, high-precision dance movement, trailing motion blur';
      let retrievedHookText = 'They say the stage only reveals its true secret when the final spotlight cuts through the silence.';

      if (this.ragEngine) {
        const targetUserId = userId ?? (brand as any).ownerId;
        const query = `${topic} ${brand.niche || ''} ${character?.personality || ''} ${character?.appearance || ''}`;
        const mudraResults = this.ragEngine.search(query, { userId: targetUserId, category: 'CHOREOGRAPHY', limit: 2 });
        if (mudraResults.length > 0) {
          retrievedMudraText = `${mudraResults[0].item.title} (${mudraResults[0].item.content.split('.')[0]})`;
          if (mudraResults.length > 1) {
            retrievedChoreoMovement = `${mudraResults[1].item.title}, executing ${mudraResults[1].item.content.split('.')[0]}`;
          }
        }

        const hookResults = this.ragEngine.search(query, { userId: targetUserId, category: 'VIRAL_HOOKS', limit: 1 });
        if (hookResults.length > 0) {
          retrievedHookText = `${hookResults[0].item.content.split('.')[0]}.`;
        }
      }

      const charDesc = character
        ? `${character.name}, a solo performer with ${character.appearance || 'striking sculpted features and magnetic gaze'}, wearing ${character.clothingStyle || 'a midnight crimson silk gown'}, ${character.personality || 'confident and graceful'}`
        : `a world-class solo dancer in elegant theatrical stage attire`;

      const premise = customPremise || `An atmospheric 45-second performance featuring ${character?.name || 'the solo dancer'} uncovering a mesmerizing choreography piece under dramatic spotlighting, capturing intense suspense and artistry.`;

      const systemPrompt = [
        'You are a cinematic cultural storyboard director.',
        'Generate a structured 5-scene vertical (9:16) video narrative strictly matching the JSON Schema.',
        'Each scene must specify realistic duration in seconds (between 4 and 15 seconds per scene, totaling approximately 35-60 seconds).',
        'Provide detailed, photorealistic visualPrompts, clear narration, and precise voice directions.',
      ].join(' ');

      const userPrompt = [
        `Brand: "${brand.name || 'Studio'}" (${brand.niche || 'Dance'})`,
        `Topic: "${topic}"`,
        `Premise: "${premise}"`,
        `Visual Style: "${visualStyle}"`,
        `Tone: "${tone}"`,
        `Protagonist Description: ${charDesc}`,
        `Authentic Choreography Notes (retrieved from verified knowledge store):`,
        `- Movement Accent 1: ${retrievedMudraText}`,
        `- Movement Accent 2: ${retrievedChoreoMovement}`,
        `- Atmospheric Hook Note: ${retrievedHookText}`,
        'Produce a 5-scene cinematic storyboard structured according to the JSON Schema.',
      ].join('\n');

      const startTime = Date.now();
      const parsed = await this.callChat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], STORY_JSON_SCHEMA);

      if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
        throw new SanitizedLLMError('LLM_INVALID_OUTPUT', 'Story missing scenes array or scenes array is empty', 'COMPLETED_WITH_RESPONSE');
      }

      if (parsed.scenes.length > 10) {
        throw new SanitizedLLMError('LLM_INVALID_OUTPUT', 'Story exceeded maximum allowed scene count (10)', 'COMPLETED_WITH_RESPONSE');
      }

      const scenes: GeneratedStoryScene[] = [];
      for (let i = 0; i < parsed.scenes.length; i++) {
        const sc = parsed.scenes[i];
        if (typeof sc !== 'object' || sc === null) {
          throw new SanitizedLLMError('LLM_INVALID_OUTPUT', `Scene ${i + 1} is not an object`, 'COMPLETED_WITH_RESPONSE');
        }

        if (
          typeof sc.narration !== 'string' ||
          sc.narration.trim().length === 0 ||
          typeof sc.visualPrompt !== 'string' ||
          sc.visualPrompt.trim().length === 0 ||
          typeof sc.voiceDirection !== 'string' ||
          sc.voiceDirection.trim().length === 0
        ) {
          throw new SanitizedLLMError(
            'LLM_INVALID_OUTPUT',
            `Scene ${i + 1} missing required fields (narration, visualPrompt, voiceDirection)`,
            'COMPLETED_WITH_RESPONSE'
          );
        }

        // Clamp scene duration reasonably (4 to 30 seconds)
        const rawDur = typeof sc.durationSec === 'number' && !isNaN(sc.durationSec) ? Math.round(sc.durationSec) : 8;
        const durationSec = Math.min(30, Math.max(4, rawDur));

        scenes.push({
          sceneOrder: typeof sc.sceneOrder === 'number' ? sc.sceneOrder : i + 1,
          durationSec,
          narration: sc.narration.trim(),
          dialogue: typeof sc.dialogue === 'string' && sc.dialogue.trim() ? sc.dialogue.trim() : undefined,
          visualPrompt: sc.visualPrompt.trim(),
          voiceDirection: sc.voiceDirection.trim(),
          soundEffects: typeof sc.soundEffects === 'string' && sc.soundEffects.trim() ? sc.soundEffects.trim() : undefined,
          musicDirection: typeof sc.musicDirection === 'string' && sc.musicDirection.trim() ? sc.musicDirection.trim() : undefined,
          endingType: typeof sc.endingType === 'string' && sc.endingType.trim() ? sc.endingType.trim() : undefined,
        });
      }

      const totalDuration = scenes.reduce((acc, s) => acc + s.durationSec, 0);

      return {
        title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : `${brand.name || 'Studio'} — ${topic}`,
        hook: typeof parsed.hook === 'string' && parsed.hook.trim() ? parsed.hook.trim() : scenes[0].narration,
        premise: typeof parsed.premise === 'string' && parsed.premise.trim() ? parsed.premise.trim() : premise,
        targetDurationSec: totalDuration,
        language: typeof parsed.language === 'string' && parsed.language.trim() ? parsed.language.trim() : (brand.language || 'English'),
        tone: typeof parsed.tone === 'string' && parsed.tone.trim() ? parsed.tone.trim() : tone,
        endingType: typeof parsed.endingType === 'string' && parsed.endingType.trim() ? parsed.endingType.trim() : 'Call to Action',
        scenes,
        metadata: Object.freeze({
          provider: 'ollama',
          fallbackOccurred: false,
          model: this.model,
          latencyMs: Date.now() - startTime,
          reservationId,
        }),
      };
    });
  }

  async unloadModel(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, keep_alive: 0 }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async isModelLoaded(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/ps`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      const data = await res.json() as any;
      if (!Array.isArray(data?.models)) return false;
      return data.models.some((m: any) => m.name === this.model || m.model === this.model);
    } catch {
      return false;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/version`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export class FallbackLLMProvider implements LLMProvider {
  constructor(
    private primary: LLMProvider,
    private fallback: LLMProvider,
    private onFallback?: (error: SanitizedLLMError, method: string) => void
  ) {}

  async generateIdeas(brand: BrandContext, count = 5): Promise<IdeaItem[]> {
    const startTime = Date.now();
    try {
      const results = await this.primary.generateIdeas(brand, count);
      const latencyMs = Date.now() - startTime;
      const meta = Object.freeze<LLMExecutionMetadata>({
        provider: 'ollama',
        fallbackOccurred: false,
        model: (this.primary as any).model || 'qwen2.5:1.5b',
        latencyMs,
      });
      return results.map((r) => ({
        ...r,
        metadata: r.metadata ? Object.freeze({ ...r.metadata }) : meta,
      }));
    } catch (err: any) {
      const sanitized = err instanceof SanitizedLLMError
        ? err
        : new SanitizedLLMError('LLM_INTERNAL_ERROR', err?.message || 'Primary LLM provider failed');
      if (this.onFallback) {
        this.onFallback(sanitized, 'generateIdeas');
      } else {
        console.warn(`[LLM Fallback] Primary provider failed (${sanitized.code}). Falling back to deterministic provider.`);
      }

      const resvId = (err as any)?.reservationId;
      try {
        const fallbackResults = await this.fallback.generateIdeas(brand, count);
        const latencyMs = Date.now() - startTime;
        const meta = Object.freeze<LLMExecutionMetadata>({
          provider: 'deterministic',
          fallbackOccurred: true,
          fallbackReason: sanitized.code,
          reservationId: resvId,
          errorEvidence: (err as any)?.errorEvidence || (sanitized as any)?.evidence,
          latencyMs,
        });
        return fallbackResults.map((r) => ({
          ...r,
          metadata: meta,
        }));
      } catch (fallbackErr: any) {
        throw new SanitizedLLMError('LLM_INTERNAL_ERROR', 'Both primary and fallback LLM providers failed');
      }
    }
  }

  async generateStory(brand: BrandContext, topic: string, customPremise?: string, character?: CharacterContext, userId?: number): Promise<GeneratedStory> {
    const startTime = Date.now();
    try {
      const story = await this.primary.generateStory(brand, topic, customPremise, character, userId);
      const latencyMs = Date.now() - startTime;
      const meta = Object.freeze<LLMExecutionMetadata>({
        provider: 'ollama',
        fallbackOccurred: false,
        model: (this.primary as any).model || 'qwen2.5:1.5b',
        latencyMs,
      });
      return {
        ...story,
        metadata: story.metadata ? Object.freeze({ ...story.metadata }) : meta,
      };
    } catch (err: any) {
      const sanitized = err instanceof SanitizedLLMError
        ? err
        : new SanitizedLLMError('LLM_INTERNAL_ERROR', err?.message || 'Primary LLM provider failed');
      if (this.onFallback) {
        this.onFallback(sanitized, 'generateStory');
      } else {
        console.warn(`[LLM Fallback] Primary provider failed (${sanitized.code}). Falling back to deterministic provider.`);
      }

      const resvId = (err as any)?.reservationId;
      try {
        const fallbackStory = await this.fallback.generateStory(brand, topic, customPremise, character, userId);
        const latencyMs = Date.now() - startTime;
        const meta = Object.freeze<LLMExecutionMetadata>({
          provider: 'deterministic',
          fallbackOccurred: true,
          fallbackReason: sanitized.code,
          reservationId: resvId,
          errorEvidence: (err as any)?.errorEvidence || (sanitized as any)?.evidence,
          latencyMs,
        });
        return {
          ...fallbackStory,
          metadata: meta,
        };
      } catch (fallbackErr: any) {
        throw new SanitizedLLMError('LLM_INTERNAL_ERROR', 'Both primary and fallback LLM providers failed');
      }
    }
  }
}

export function createDefaultLLMProvider(
  ragEngine?: RAGEngine,
  options?: {
    enableOllama?: boolean;
    ollamaOptions?: OllamaProviderOptions;
    onFallback?: (err: SanitizedLLMError, method: string) => void;
    coordinator?: ResourceCoordinator;
    lifecycleAdapter?: OllamaLifecycleAdapter;
  }
): LLMProvider {
  const localFallback = new LocalLLMProvider(ragEngine);
  const isTestRunner = process.env.NODE_ENV === 'test' || process.argv.some(a => a.includes('test'));
  const enableOllama = options?.enableOllama ?? (
    process.env.AURAVO_USE_OLLAMA === 'true' ||
    (process.env.AURAVO_USE_OLLAMA !== 'false' && !isTestRunner)
  );

  if (!enableOllama) {
    return localFallback;
  }

  const mergedOllamaOptions: OllamaProviderOptions = {
    ...options?.ollamaOptions,
    coordinator: options?.ollamaOptions?.coordinator ?? options?.coordinator,
    lifecycleAdapter: options?.ollamaOptions?.lifecycleAdapter ?? options?.lifecycleAdapter,
  };

  const ollamaProvider = new OllamaLLMProvider(ragEngine, mergedOllamaOptions);
  return new FallbackLLMProvider(ollamaProvider, localFallback, options?.onFallback);
}
