import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import { RAGEngine } from '../providers/rag_engine.js';
import { LocalLLMProvider } from '../providers/llm.js';

function client(base: string) {
  let cookie = '';
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
}

test('RAG Engine - Seeding, Token Search & Knowledge Enrichment', () => {
  const db = openDb(':memory:');
  const rag = new RAGEngine(db);

  // 1. Verify default knowledge items seeded
  const allItems = rag.listKnowledge();
  assert.ok(allItems.length >= 8, `Expected at least 8 seeded knowledge items, got ${allItems.length}`);

  // 2. Search for choreography mudra
  const lotusResults = rag.search('lotus blooming gesture');
  assert.ok(lotusResults.length > 0);
  assert.ok(lotusResults[0].item.title.includes('Alapadma'));
  assert.equal(lotusResults[0].item.category, 'CHOREOGRAPHY');

  // 3. Search for Kathak spins
  const spinResults = rag.search('kathak fast pirouette chakkar');
  assert.ok(spinResults.length > 0);
  assert.ok(spinResults[0].item.title.includes('Chakkar'));

  // 4. Search for viral hook patterns
  const hookResults = rag.search('unbroken eye contact camera gaze', { category: 'VIRAL_HOOKS' });
  assert.ok(hookResults.length > 0);
  assert.ok(hookResults[0].item.title.includes('Eye Contact'));

  // 5. Enrich prompt with RAG citations
  const { enrichedPrompt, citations } = rag.enrichPromptWithRAG('Aria Kathak monsoon dance with silk drape');
  assert.ok(citations.length > 0);
  assert.ok(enrichedPrompt.includes('[AUTHENTIC CHOREOGRAPHY & CONSISTENCY KNOWLEDGE BASE]'));

  // 6. Add custom knowledge item
  const custom = rag.addKnowledge({
    category: 'CHOREOGRAPHY',
    title: 'Ghungroo Percussive Ankle Bells',
    content: 'Dancer strikes rhythmic bells tied around ankles in sync with the tabla bols.',
    tags: ['ghungroo', 'bells', 'kathak', 'ankle', 'tabla'],
    metadata: { difficulty: 'EXPERT' },
  });

  assert.ok(custom.id);
  const foundCustom = rag.search('ghungroo bells');
  assert.ok(foundCustom.some((f) => f.item.title.includes('Ghungroo')));
});

test('Local LLM Provider with RAG - Authentic Mudras & Viral Hooks in 5-Scene Story', async () => {
  const db = openDb(':memory:');
  const rag = new RAGEngine(db);
  const llm = new LocalLLMProvider(rag);

  const brand = {
    id: 1,
    name: 'Auravo Kathak Studio',
    handle: '@auravo.dance',
    niche: 'Kathak & Classical Indo-Fusion',
    tone: 'regal, mysterious, intense',
    visualStyle: 'Dramatic theater spotlight, swirling silk anarkali, 9:16 vertical',
    preferredTopics: ['Kathak chakkar pirouettes', 'Monsoon peacock gateway'],
    prohibitedTopics: ['nudity'],
  };

  const character = {
    name: 'Priya',
    appearance: 'Striking classical dancer with deep espresso eyes and sharp jawline',
    clothingStyle: 'Midnight sapphire silk anarkali with ornate gold zardozi',
    personality: 'Regal, intense and poised soloist',
  };

  const story = await llm.generateStory(brand, 'Monsoon Peacock Gateway with Alapadma and Chakkars', undefined, character);

  assert.ok(story.scenes.length === 5);
  // Scene 1 Hook: Should incorporate viral hook or authentic atmosphere
  assert.ok(story.scenes[0].narration.length > 10);
  // Scene 2: Should incorporate retrieved mudras into prompt
  assert.ok(
    story.scenes[1].visualPrompt.toLowerCase().includes('alapadma') ||
    story.scenes[1].visualPrompt.toLowerCase().includes('mudra') ||
    story.scenes[1].visualPrompt.toLowerCase().includes('hands')
  );
  // Scene 3: Should incorporate dynamic choreo / chakkars
  assert.ok(
    story.scenes[2].visualPrompt.toLowerCase().includes('chakkar') ||
    story.scenes[2].visualPrompt.toLowerCase().includes('dance')
  );
});

test('RAG Knowledge Store API - HTTP Endpoints', async () => {
  const srv = createApp(openDb(':memory:')).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  try {
    const c = client(base);

    // 1. Register & Auth
    await c('POST', '/api/auth/register', { email: 'director@auravo.studio', password: 'password123' });

    // 2. Query Knowledge List
    const listRes = await c('GET', '/api/rag/knowledge');
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.body));
    assert.ok(listRes.body.length >= 8);

    // 3. Search Knowledge
    const searchRes = await c('GET', '/api/rag/search?q=flamenco&limit=2');
    assert.equal(searchRes.status, 200);
    assert.ok(Array.isArray(searchRes.body));
    assert.ok(searchRes.body.some((r: any) => r.item.title.toLowerCase().includes('zapateado') || r.item.tags.includes('flamenco')));

    // 4. Add Custom Knowledge Item via API
    const addRes = await c('POST', '/api/rag/knowledge', {
      category: 'VIRAL_HOOKS',
      title: 'The Silent Breath Beat Drop',
      content: 'Cut all background music at 0:02 for a sharp inhalation of breath before drop.',
      tags: ['breath', 'silence', 'hook', 'drop'],
    });

    assert.equal(addRes.status, 201);
    assert.equal(addRes.body.ok, true);
    assert.ok(addRes.body.item.id);
  } finally {
    srv.close();
  }
});
