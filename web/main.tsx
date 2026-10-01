import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';

type Row = Record<string, any>;

const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Request failed');
  return data;
};

const triggerDownload = async (url: string, preferredFilename?: string) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch failed');
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = preferredFilename || url.split('/').pop() || 'ai_character_face.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch {
    const link = document.createElement('a');
    link.href = url;
    link.download = preferredFilename || url.split('/').pop() || 'ai_character_face.jpg';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

// Modern Glassmorphic Dark UI Theme
const STYLES = `
  :root {
    --bg: #0b0f19;
    --card: #131b2e;
    --card-border: #23304b;
    --accent: #6366f1;
    --accent-hover: #4f46e5;
    --gold: #f59e0b;
    --pink: #ec4899;
    --text: #f1f5f9;
    --text-muted: #94a3b8;
    --success: #10b981;
    --warning: #f59e0b;
    --danger: #ef4444;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
  }
  .app-container { max-width: 1240px; margin: 0 auto; padding: 24px 16px; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--card-border); padding-bottom: 16px; margin-bottom: 24px; }
  .nav-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
  .nav-btn {
    background: var(--card);
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: 14px;
    transition: all 0.2s;
  }
  .nav-btn:hover { background: #1c2844; color: var(--text); }
  .nav-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .card {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
  }
  .btn {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 9px 18px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }
  .btn:hover { background: var(--accent-hover); }
  .btn-outline { background: transparent; border: 1px solid var(--card-border); color: var(--text); }
  .btn-outline:hover { background: var(--card-border); }
  .btn-gold { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; }
  .btn-success { background: #059669; color: white; }
  .btn-danger { background: #dc2626; color: white; }
  input, select, textarea {
    background: #0d1322;
    border: 1px solid var(--card-border);
    color: var(--text);
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 14px;
    width: 100%;
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }
  label { font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; display: block; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  .badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .badge-discovered { background: #1e3a8a; color: #93c5fd; }
  .badge-draft { background: #334155; color: #cbd5e1; }
  .badge-ready_for_review { background: #854d0e; color: #fde047; }
  .badge-approved_for_publish { background: #065f46; color: #6ee7b7; }
  .badge-scheduled { background: #4338ca; color: #c7d2fe; }
  .badge-rejected { background: #7f1d1d; color: #fca5a5; }
  .badge-score { background: #312e81; color: #c7d2fe; font-size: 12px; }
  
  .qg-item {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 10px 14px;
    border-radius: 8px;
    margin-bottom: 8px;
    font-size: 13px;
  }
  .qg-pass { background: #064e3b; border-left: 4px solid #10b981; }
  .qg-warn { background: #451a03; border-left: 4px solid #f59e0b; }
  .qg-fail { background: #450a0a; border-left: 4px solid #ef4444; }

  .scene-card {
    background: #0d1322;
    border: 1px solid var(--card-border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
  }
  .phone-mockup {
    width: 280px;
    height: 497px;
    border-radius: 24px;
    border: 8px solid #334155;
    background: #000;
    overflow: hidden;
    position: relative;
    box-shadow: 0 20px 40px rgba(0,0,0,0.6);
  }
`;

function IdeasStudio({ brands }: { brands: Row[] }) {
  const [selectedBrandId, setSelectedBrandId] = useState<number>(brands[0]?.id || 0);
  const [ideas, setIdeas] = useState<Row[]>([]);
  const [characters, setCharacters] = useState<Row[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const [customTitle, setCustomTitle] = useState('');
  const [customPremise, setCustomPremise] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const loadIdeas = () => {
    if (!selectedBrandId) return;
    api('GET', `/ideas?brandId=${selectedBrandId}`).then(setIdeas);
    api('GET', `/characters?brandId=${selectedBrandId}`).then((chars) => {
      setCharacters(chars);
      if (chars.length > 0 && selectedCharId === null) {
        setSelectedCharId(chars[0].id);
      }
    });
  };

  useEffect(() => {
    if (brands.length > 0 && !selectedBrandId) {
      setSelectedBrandId(brands[0].id);
    }
  }, [brands]);

  useEffect(() => {
    loadIdeas();
  }, [selectedBrandId]);

  const generateNewIdeas = async () => {
    if (!selectedBrandId) return;
    setLoading(true);
    setMsg('');
    try {
      await api('POST', '/ideas/generate', { brandId: selectedBrandId, count: 4 });
      loadIdeas();
      setMsg('New tailored concepts generated successfully!');
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const acceptIdea = async (ideaId: number) => {
    setLoading(true);
    setMsg('');
    try {
      const res = await api('POST', `/ideas/${ideaId}/accept`, {
        characterId: selectedCharId || undefined,
      });
      setMsg(`Story generated! Content Item #${res.contentItemId} created in Library.`);
      loadIdeas();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const createCustomStory = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedBrandId || !customTitle.trim() || !customPremise.trim()) return;
    setLoading(true);
    setMsg('');
    try {
      const res = await api('POST', '/content/custom', {
        brandId: selectedBrandId,
        characterId: selectedCharId || undefined,
        title: customTitle.trim(),
        premise: customPremise.trim(),
      });
      setMsg(`Custom Story generated! Content Item #${res.contentItemId} created in Library.`);
      setCustomTitle('');
      setCustomPremise('');
      setShowCustom(false);
      loadIdeas();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label>Target Brand</label>
            <select value={selectedBrandId} onChange={(e) => setSelectedBrandId(Number(e.target.value))} style={{ minWidth: 200 }}>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.handle || 'no handle'})</option>)}
            </select>
          </div>
          <div>
            <label>💃 Performing Dancer / Face Model</label>
            <select
              value={selectedCharId || ''}
              onChange={(e) => setSelectedCharId(e.target.value ? Number(e.target.value) : null)}
              style={{ minWidth: 220, border: '1px solid var(--accent)' }}
            >
              <option value="">Default AI Dancer</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.personality?.slice(0, 25)}...)
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-gold" onClick={generateNewIdeas} disabled={loading}>
              {loading ? 'Generating...' : '✨ Auto-Discover AI Ideas'}
            </button>
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <button className="btn btn-outline" onClick={() => setShowCustom(!showCustom)}>
            {showCustom ? '✕ Close Custom Creator' : '✍️ Create Custom Story from Prompt'}
          </button>
        </div>
      </div>

      {showCustom && (
        <div className="card" style={{ background: '#172033', border: '1px solid var(--accent)' }}>
          <h3 style={{ marginTop: 0 }}>✍️ Create Custom Story Concept</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: -6 }}>
            Provide your exact story idea, topic, or script instructions. The AI will weave your selected dancer persona into a tailored 5-scene vertical short.
          </p>
          <form onSubmit={createCustomStory} style={{ display: 'grid', gap: 12 }}>
            <div>
              <label>Custom Title / Concept Name</label>
              <input
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="e.g. The Midnight Waltz of Shadow"
                required
              />
            </div>
            <div>
              <label>Story Premise / Detailed Instructions</label>
              <textarea
                value={customPremise}
                onChange={(e) => setCustomPremise(e.target.value)}
                rows={3}
                placeholder="e.g. A dancer performs a captivating routine on an empty stage. Dramatic side-lighting reveals a hidden mystery in the choreography before an unexpected twist finale."
                required
              />
            </div>
            <div>
              <button className="btn btn-gold" type="submit" disabled={loading}>
                {loading ? 'Generating 5-Scene Script...' : '🚀 Generate 5-Scene Script from My Prompt'}
              </button>
            </div>
          </form>
        </div>
      )}

      {msg && <div className="card" style={{ background: '#1e293b', borderLeft: '4px solid var(--accent)' }}>{msg}</div>}

      <div className="grid-3">
        {ideas.map((idea) => (
          <div key={idea.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <span className={`badge badge-${idea.status.toLowerCase()}`}>{idea.status}</span>
                <span className="badge badge-score">Pot: {idea.potentialScore}% · Orig: {idea.originalityScore}%</span>
              </div>
              <h3 style={{ margin: '8px 0', fontSize: 17 }}>{idea.title}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.45 }}>{idea.premise}</p>
              
              <div style={{ marginTop: 12, fontSize: 13, color: '#a5b4fc' }}>
                <b>Audience Fit:</b> {idea.audienceFit}
              </div>

              {idea.repetitionWarning && (
                <div style={{ marginTop: 10, padding: 8, background: '#451a03', color: '#fde047', borderRadius: 6, fontSize: 12 }}>
                  ⚠️ {idea.repetitionWarning}
                </div>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              {idea.status === 'DISCOVERED' ? (
                <button className="btn" style={{ width: '100%' }} onClick={() => acceptIdea(idea.id)} disabled={loading}>
                  🎬 Turn into 5-Scene Script
                </button>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--success)', fontWeight: 600, fontSize: 14 }}>
                  ✓ Story Script Created
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScriptStudio({ brands }: { brands: Row[] }) {
  const [contentList, setContentList] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState<number>(0);
  const [detail, setDetail] = useState<Row | null>(null);
  const [qualityReport, setQualityReport] = useState<Row | null>(null);
  const [rendering, setRendering] = useState(false);
  const [msg, setMsg] = useState('');

  // Editing state
  const [editingSceneId, setEditingSceneId] = useState<number | null>(null);
  const [editNarration, setEditNarration] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editDuration, setEditDuration] = useState<number>(8);

  // Scheduling dialog
  const [showScheduler, setShowScheduler] = useState(false);
  const [schedulePlatform, setSchedulePlatform] = useState('ALL');
  const [scheduleTime, setScheduleTime] = useState(new Date(Date.now() + 864e5).toISOString().slice(0, 16));

  const loadContent = () => {
    api('GET', '/content').then((rows: Row[]) => {
      setContentList(rows);
      if (rows.length > 0 && !selectedId) {
        setSelectedId(rows[0].id);
      }
    });
  };

  useEffect(() => { loadContent(); }, []);

  const refreshDetail = () => {
    if (selectedId) {
      api('GET', `/content/${selectedId}/full`).then((d) => {
        setDetail(d);
        api('POST', `/content/${selectedId}/quality-gate`).then(setQualityReport).catch(() => setQualityReport(null));
      }).catch(() => setDetail(null));
    }
  };

  useEffect(() => {
    refreshDetail();
  }, [selectedId]);

  const startEditScene = (s: Row) => {
    setEditingSceneId(s.id);
    setEditNarration(s.narration);
    setEditPrompt(s.visualPrompt);
    setEditDuration(s.durationSec);
  };

  const saveSceneEdit = async (sceneId: number) => {
    try {
      await api('PATCH', `/scenes/${sceneId}`, {
        narration: editNarration,
        visualPrompt: editPrompt,
        durationSec: Number(editDuration),
      });
      setEditingSceneId(null);
      refreshDetail();
      setMsg('Scene updated! Click "Render 9:16 Vertical Video" to generate video with changes.');
    } catch (e: any) {
      setMsg(`Error updating scene: ${e.message}`);
    }
  };

  const [animatingSceneId, setAnimatingSceneId] = useState<number | null>(null);
  const [animatingAll, setAnimatingAll] = useState(false);
  const [pastingUrlSceneId, setPastingUrlSceneId] = useState<number | null>(null);
  const [inputVideoUrl, setInputVideoUrl] = useState('');

  const autoAnimateScene = async (sceneId: number) => {
    try {
      setAnimatingSceneId(sceneId);
      setMsg('⚡ Studio Auto-Pilot: Synthesizing AI dance movement & camera choreography for Beat...');
      await api('POST', `/content/${selectedId}/scenes/${sceneId}/auto-animate`);
      setMsg('✓ Beat video clip generated and attached! Re-render when ready.');
      refreshDetail();
    } catch (e: any) {
      setMsg(`Auto-animate error: ${e.message}`);
    } finally {
      setAnimatingSceneId(null);
    }
  };

  const autoAnimateAllScenes = async () => {
    try {
      setAnimatingAll(true);
      setMsg('⚡ Studio Auto-Pilot: Generating AI dance & camera choreography for all 5 beats...');
      await api('POST', `/content/${selectedId}/auto-animate-all`);
      setMsg('✓ All 5 beats auto-animated! Now click "Render 9:16 Vertical Video" to assemble.');
      refreshDetail();
    } catch (e: any) {
      setMsg(`Auto-animate all error: ${e.message}`);
    } finally {
      setAnimatingAll(false);
    }
  };

  const importVideoFromUrl = async (sceneId: number) => {
    if (!inputVideoUrl.trim()) return;
    try {
      setMsg('📥 Downloading & importing video clip into Studio...');
      await api('POST', `/content/${selectedId}/scenes/${sceneId}/attach-video`, { videoUrl: inputVideoUrl.trim() });
      setMsg('✓ Video clip imported into Beat!');
      setInputVideoUrl('');
      setPastingUrlSceneId(null);
      refreshDetail();
    } catch (e: any) {
      setMsg(`Import URL error: ${e.message}`);
    }
  };

  const [neuralConfig, setNeuralConfig] = useState<any>({ gpuServerUrl: '', apiProvider: 'COLAB_GPU', apiKey: '' });
  const [showNeuralSettings, setShowNeuralSettings] = useState(false);
  const [generatingNeuralSceneId, setGeneratingNeuralSceneId] = useState<number | null>(null);

  useEffect(() => {
    api('GET', '/settings/neural-dance-config').then(setNeuralConfig).catch(() => {});
  }, []);

  const saveNeuralEngineConfig = async () => {
    try {
      await api('POST', '/settings/neural-dance-config', neuralConfig);
      setMsg('✓ Neural AI Dance Engine settings saved!');
      setShowNeuralSettings(false);
    } catch (e: any) {
      setMsg(`Config error: ${e.message}`);
    }
  };

  const generateNeuralDanceForScene = async (sceneId: number) => {
    try {
      setGeneratingNeuralSceneId(sceneId);
      setMsg('🧠 Generating Neural Video Diffusion (DensePose + ReferenceNet)...');
      const res = await api('POST', `/content/${selectedId}/scenes/${sceneId}/neural-dance-generate`);
      setMsg(`✓ Neural dance video generated via ${res.providerUsed || 'AI GPU'}!`);
      refreshDetail();
    } catch (e: any) {
      setMsg(`Neural Video Error: ${e.message}`);
      setShowNeuralSettings(true);
    } finally {
      setGeneratingNeuralSceneId(null);
    }
  };

  const regenerateScene = async (sceneId: number) => {
    try {
      await api('POST', `/content/${selectedId}/regenerate-scene`, { sceneId });
      refreshDetail();
      setMsg('Scene regenerated with new AI variation! Re-render when ready.');
    } catch (e: any) {
      setMsg(`Error regenerating scene: ${e.message}`);
    }
  };

  const [lastRenderTime, setLastRenderTime] = useState<number>(Date.now());

  const renderVideo = async () => {
    if (!selectedId) return;
    setRendering(true);
    setMsg('🎬 Assembling real dance video clips, mixing Bollywood background beats, and rendering master 1080x1920 MP4 via FFmpeg...');
    try {
      await api('POST', `/content/${selectedId}/render`);
      setLastRenderTime(Date.now());
      setMsg('✓ Master Video rendered successfully with dancing moves & music!');
      refreshDetail();
    } catch (e: any) {
      setMsg(`Render error: ${e.message}`);
    } finally {
      setRendering(false);
    }
  };

  const approveContent = async () => {
    try {
      await api('POST', `/content/${selectedId}/approve`);
      setMsg('✓ Content Approved for Multi-Platform Publishing!');
      refreshDetail();
      loadContent();
    } catch (e: any) {
      setMsg(`Cannot Approve: ${e.message}`);
    }
  };

  const rejectContent = async () => {
    try {
      await api('POST', `/content/${selectedId}/reject`);
      setMsg('Content marked as REJECTED / NEEDS REVISION.');
      refreshDetail();
      loadContent();
    } catch (e: any) {
      setMsg(`Rejection error: ${e.message}`);
    }
  };

  const submitSchedule = async () => {
    try {
      await api('POST', `/content/${selectedId}/schedule`, {
        platform: schedulePlatform,
        scheduledAt: scheduleTime,
      });
      setMsg(`✓ Scheduled for ${schedulePlatform} at ${scheduleTime}! View in Publishing Calendar.`);
      setShowScheduler(false);
      refreshDetail();
      loadContent();
    } catch (e: any) {
      setMsg(`Scheduling failed: ${e.message}`);
    }
  };

  const videoAsset = detail?.assets?.find((a: any) => a.type === 'VIDEO');
  const videoUrl = videoAsset ? `/api/media/videos/${videoAsset.filePath.split('/').pop()}` : null;

  return (
    <div className="grid-2">
      <div>
        <div className="card">
          <label>Select Content Item</label>
          <select value={selectedId} onChange={(e) => setSelectedId(Number(e.target.value))}>
            {contentList.map((c) => (
              <option key={c.id} value={c.id}>#{c.id} · {c.title} ({c.status})</option>
            ))}
          </select>
        </div>

        {detail && detail.script && (
          <div>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>{detail.script.title}</h2>
                <span className={`badge badge-${detail.status.toLowerCase()}`}>{detail.status}</span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}><b>Hook:</b> "{detail.script.hook}"</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}><b>Premise:</b> {detail.script.premise}</p>

              {/* Action Bar */}
              <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                <button className="btn btn-success" onClick={approveContent}>
                  ✓ Approve for Publish
                </button>
                <button className="btn btn-danger" onClick={rejectContent}>
                  ✕ Reject / Revise
                </button>
                <button className="btn btn-outline" onClick={() => setShowScheduler(!showScheduler)}>
                  📅 Schedule Post
                </button>
              </div>

              {showScheduler && (
                <div style={{ marginTop: 16, padding: 14, background: '#1c2844', borderRadius: 8, border: '1px solid var(--accent)' }}>
                  <h4 style={{ margin: '0 0 10px 0' }}>📅 Schedule Multi-Platform Release</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label>Target Platform</label>
                      <select value={schedulePlatform} onChange={(e) => setSchedulePlatform(e.target.value)}>
                        <option value="ALL">All Platforms (YouTube, Instagram, TikTok)</option>
                        <option value="YOUTUBE">YouTube Shorts</option>
                        <option value="INSTAGRAM">Instagram Reels</option>
                        <option value="TIKTOK">TikTok</option>
                      </select>
                    </div>
                    <div>
                      <label>Date & Time</label>
                      <input type="datetime-local" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
                    </div>
                  </div>
                  <button className="btn btn-gold" onClick={submitSchedule}>Confirm Schedule</button>
                </div>
              )}
            </div>

            {/* Quality Gate Inspector */}
            {qualityReport && (
              <div className="card" style={{ background: '#111827', border: '1px solid var(--card-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>🛡️ Quality Gate &amp; Safety Compliance</h3>
                  <span className="badge" style={{ background: qualityReport.passed ? '#064e3b' : '#7f1d1d', color: qualityReport.passed ? '#6ee7b7' : '#fca5a5' }}>
                    Safety Score: {qualityReport.safetyScore}/100
                  </span>
                </div>

                {qualityReport.checks?.map((chk: Row, idx: number) => (
                  <div key={idx} className={`qg-item qg-${chk.status.toLowerCase()}`}>
                    <div>
                      <b>{chk.name}:</b> {chk.message}
                      {chk.recommendation && (
                        <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 4 }}>
                          💡 <i>{chk.recommendation}</i>
                        </div>
                      )}
                    </div>
                    <span style={{ fontWeight: 800, fontSize: 12 }}>{chk.status}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Free AI Dance Video Generator & Exporter Toolkit */}
            <div className="card" style={{ background: '#0a0f1d', border: '1px solid #f59e0b44', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h4 style={{ margin: 0, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 6 }}>
                  ✨ Free AI Dance Video &amp; Expression Tools
                </h4>
                <span className="badge" style={{ background: '#1e293b', color: '#6ee7b7' }}>₹0 / Free Tier Ready</span>
              </div>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px 0' }}>
                Create real dance moves, lip sync &amp; expressions for free with your AI Dancer face:
              </p>

              {/* Step 1: Download Face/Model */}
              <div style={{ padding: '10px 14px', background: '#131e36', borderRadius: 8, border: '1px solid #3b82f644', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#93c5fd', display: 'flex', alignItems: 'center', gap: 6 }}>
                    📥 Step 1: Download AI Dancer Face / Visual
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    Download the high-resolution face portrait to upload directly to Viggle AI or Kling AI.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-gold"
                  style={{ fontSize: 11, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={() => {
                    const firstImg = detail.assets?.find((a: Row) => a.type === 'IMAGE');
                    const filename = firstImg?.filePath ? firstImg.filePath.split('/').pop() : 'rhea_bralette_portrait.jpg';
                    const imgUrl = firstImg?.filePath ? `/storage/images/${filename}` : `/api/media/images/rhea_bralette_portrait.jpg`;
                    triggerDownload(imgUrl, `${(detail.title || 'Dancer').replace(/[^a-zA-Z0-9]/g, '_')}_Face_Model.jpg`);
                  }}
                >
                  📥 Download Dancer Face Model
                </button>
              </div>

              {/* Step 2: External Tools Links */}
              <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6, fontWeight: 600 }}>
                🚀 Step 2: Upload Face &amp; Generate Dance Motion in Free AI Tools:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <a
                  href="https://klingai.com"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline"
                  style={{ fontSize: 11, padding: '6px 12px', textDecoration: 'none', background: '#1e293b', borderColor: '#f59e0b', color: '#fbbf24' }}
                >
                  🚀 Kling AI (66 Free Credits Every Day)
                </a>
                <a
                  href="https://lumalabs.ai/dream-machine"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline"
                  style={{ fontSize: 11, padding: '6px 12px', textDecoration: 'none', background: '#1e293b' }}
                >
                  🎥 Luma Dream Machine (30 Free Gens / Mo)
                </a>
                <a
                  href="https://haiper.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline"
                  style={{ fontSize: 11, padding: '6px 12px', textDecoration: 'none', background: '#1e293b' }}
                >
                  ✨ Haiper AI (Daily Free Video Gen)
                </a>
                <a
                  href="https://pika.art"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline"
                  style={{ fontSize: 11, padding: '6px 12px', textDecoration: 'none', background: '#1e293b' }}
                >
                  🎬 Pika Labs (Free Daily Credits)
                </a>
                <a
                  href="https://huggingface.co/spaces/KwaiVGI/LivePortrait"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline"
                  style={{ fontSize: 11, padding: '6px 12px', textDecoration: 'none', background: '#1e293b' }}
                >
                  🎭 LivePortrait HF (Free Face/Lip Sync)
                </a>
                <a
                  href="https://viggle.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline"
                  style={{ fontSize: 11, padding: '6px 12px', textDecoration: 'none', background: '#1e293b' }}
                >
                  💃 Viggle AI (Pose Animate)
                </a>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', background: '#131e36', padding: '6px 10px', borderRadius: 6, border: '1px dashed #334155' }}>
                💡 <b>HuggingFace LivePortrait Tip:</b> For ZeroGPU free tier, make sure your Driving Video is a <b>short 3–5 second clip</b> (or click one of the built-in sample videos under the upload box) to avoid the 360s GPU timeout.
              </div>

              {/* 1-Click Studio Automation Button & Neural Model Settings */}
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b style={{ color: '#fbbf24', fontSize: 13 }}>🤖 Full Studio Auto-Pilot:</b>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Synthesize dynamic dance movements &amp; multi-angle camera tracking across all beats without leaving Studio!</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: 12, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 4, background: '#1c2844' }}
                    onClick={() => setShowNeuralSettings(!showNeuralSettings)}
                  >
                    ⚙️ Neural AI GPU Settings {neuralConfig.gpuServerUrl ? '🟢' : '⚪'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-gold"
                    style={{ fontSize: 12, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={autoAnimateAllScenes}
                    disabled={animatingAll || rendering}
                  >
                    {animatingAll ? '⚡ Animating All 5 Beats...' : '⚡ Auto-Animate All 5 Beats in Studio'}
                  </button>
                </div>
              </div>

              {/* Neural AI Dance Engine Settings Modal/Box */}
              {showNeuralSettings && (
                <div style={{ marginTop: 14, padding: 14, background: '#090e1a', borderRadius: 8, border: '1px solid var(--accent)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h4 style={{ margin: 0, color: '#a5b4fc' }}>🧠 Neural AI Dance Model Configuration</h4>
                    <span className="badge" style={{ background: '#1e293b', color: '#6ee7b7' }}>Free Colab / Cloud GPU</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px 0' }}>
                    Connect a free Google Colab 16GB T4 GPU (MimicMotion / LivePortrait) or cloud API key for real neural physical dance movement:
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label>AI Model Provider</label>
                      <select
                        value={neuralConfig.apiProvider || 'COLAB_GPU'}
                        onChange={(e) => setNeuralConfig({ ...neuralConfig, apiProvider: e.target.value })}
                      >
                        <option value="COLAB_GPU">Google Colab T4 GPU (100% Free ₹0 - MimicMotion)</option>
                        <option value="REPLICATE">Replicate Cloud API (MimicMotion / AnimateAnyone)</option>
                        <option value="FAL_AI">Fal.ai Cloud API (LivePortrait / Video Diffusion)</option>
                      </select>
                    </div>

                    {neuralConfig.apiProvider === 'COLAB_GPU' ? (
                      <div>
                        <label>Colab Public ngrok URL</label>
                        <input
                          type="url"
                          placeholder="e.g. https://xxxx-xx-xx.ngrok-free.app"
                          value={neuralConfig.gpuServerUrl || ''}
                          onChange={(e) => setNeuralConfig({ ...neuralConfig, gpuServerUrl: e.target.value })}
                        />
                      </div>
                    ) : (
                      <div>
                        <label>Cloud API Key / Token</label>
                        <input
                          type="password"
                          placeholder="r8_... or fal_..."
                          value={neuralConfig.apiKey || ''}
                          onChange={(e) => setNeuralConfig({ ...neuralConfig, apiKey: e.target.value })}
                        />
                      </div>
                    )}
                  </div>

                  {neuralConfig.apiProvider === 'COLAB_GPU' && (
                    <div style={{ fontSize: 11, color: '#cbd5e1', background: '#131e36', padding: '8px 10px', borderRadius: 6, marginBottom: 10 }}>
                      💡 <b>Free Google Colab GPU Setup:</b> Open <code style={{ color: '#fbbf24' }}>scripts/colab_dance_diffusion_server.ipynb</code> in Google Colab (with free T4 GPU runtime), run the cells, and paste your ngrok URL above!
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-outline" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setShowNeuralSettings(false)}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-gold" style={{ fontSize: 11, padding: '4px 14px' }} onClick={saveNeuralEngineConfig}>
                      Save Configuration
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Scene Beats */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{ margin: 0 }}>5-Scene Story Breakdown (45s Short)</h3>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: 11, padding: '4px 10px', borderColor: '#f59e0b', color: '#fbbf24' }}
                  onClick={autoAnimateAllScenes}
                  disabled={animatingAll || rendering}
                >
                  {animatingAll ? '⚡ Animating...' : '⚡ Auto-Animate All Beats'}
                </button>
              </div>
              {detail.scenes?.map((s: Row) => {
                const sceneVideo = detail.assets?.find((a: Row) => a.sceneId === s.id && a.type === 'SCENE_VIDEO');
                const sceneImg = detail.assets?.find((a: Row) => a.sceneId === s.id && a.type === 'IMAGE') || detail.assets?.find((a: Row) => a.type === 'IMAGE');

                return (
                  <div key={s.id} className="scene-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--gold)', fontWeight: 700, fontSize: 13 }}>
                      <span>BEAT {s.sceneOrder} · {s.durationSec}s {sceneVideo && <span style={{ color: '#6ee7b7', fontSize: 11, marginLeft: 6 }}>● Video Attached</span>}</span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-gold"
                          style={{ fontSize: 11, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                          title="Generate real physical neural video diffusion via Colab GPU or Cloud API"
                          onClick={() => generateNeuralDanceForScene(s.id)}
                          disabled={generatingNeuralSceneId === s.id}
                        >
                          {generatingNeuralSceneId === s.id ? '🧠 Generating...' : '🧠 Neural Dance (GPU)'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '3px 8px', background: '#1e293b', borderColor: '#f59e0b', color: '#fbbf24' }}
                          title="Generate fast choreography & camera motion inside Studio"
                          onClick={() => autoAnimateScene(s.id)}
                          disabled={animatingSceneId === s.id}
                        >
                          {animatingSceneId === s.id ? '⚡ Animating...' : '⚡ Studio Motion'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '3px 8px', background: '#131e36', borderColor: '#3b82f688', color: '#93c5fd' }}
                          title="Paste external video URL (from Kling, Viggle, Discord) to auto-import"
                          onClick={() => {
                            if (pastingUrlSceneId === s.id) {
                              setPastingUrlSceneId(null);
                            } else {
                              setPastingUrlSceneId(s.id);
                              setInputVideoUrl('');
                            }
                          }}
                        >
                          🌐 Paste Link
                        </button>
                        {sceneImg && (
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ fontSize: 11, padding: '3px 8px' }}
                            title="Download this scene beat's visual to animate"
                            onClick={() => {
                              const filename = sceneImg.filePath ? sceneImg.filePath.split('/').pop() : 'rhea_bralette_portrait.jpg';
                              triggerDownload(`/storage/images/${filename}`, `Scene_${s.sceneOrder}_${filename}`);
                            }}
                          >
                            📥 Face
                          </button>
                        )}
                        <label className="btn btn-outline" style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer', margin: 0, background: '#1e293b', borderColor: '#3b82f6', color: '#93c5fd' }}>
                          🎥 Upload Video
                          <input
                            type="file"
                            accept="video/mp4,video/webm,video/quicktime"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                setMsg(`📤 Uploading ${file.name} to Beat ${s.sceneOrder}...`);
                                const reader = new FileReader();
                                reader.onload = async () => {
                                  try {
                                    const res = await fetch(`/api/content/${detail.id}/scenes/${s.id}/attach-video`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ videoBase64: reader.result }),
                                    });
                                    if (!res.ok) {
                                      const err = await res.json().catch(() => ({}));
                                      throw new Error(err.error || `HTTP ${res.status}`);
                                    }
                                    setMsg(`✓ Real dancing video (${file.name}) attached to Beat ${s.sceneOrder}! Click "Render 9:16 Vertical Video" to assemble.`);
                                    refreshDetail();
                                  } catch (err: any) {
                                    setMsg(`Upload failed: ${err.message}`);
                                  }
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                          />
                        </label>
                        <button
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => regenerateScene(s.id)}
                        >
                          ✨ AI Variation
                        </button>
                        <button
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => editingSceneId === s.id ? setEditingSceneId(null) : startEditScene(s)}
                        >
                          {editingSceneId === s.id ? 'Cancel' : '✏️ Edit'}
                        </button>
                      </div>
                    </div>

                    {/* Direct Video URL Auto-Importer Box */}
                    {pastingUrlSceneId === s.id && (
                      <div style={{ marginTop: 10, padding: 8, background: '#0a1020', borderRadius: 6, border: '1px solid #3b82f6', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="url"
                          placeholder="Paste direct video URL (e.g. from Kling, Viggle, Discord, Hugging Face CDN...)"
                          value={inputVideoUrl}
                          onChange={(e) => setInputVideoUrl(e.target.value)}
                          style={{ flex: 1, fontSize: 12, padding: '6px 8px', background: '#131b2e', border: '1px solid #334155' }}
                        />
                        <button
                          type="button"
                          className="btn btn-gold"
                          style={{ fontSize: 11, padding: '6px 12px' }}
                          onClick={() => importVideoFromUrl(s.id)}
                        >
                          ⚡ Auto-Import
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '6px 8px' }}
                          onClick={() => setPastingUrlSceneId(null)}
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {editingSceneId === s.id ? (
                      <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                        <div>
                          <label>Narration (Spoken Voiceover)</label>
                          <textarea
                            value={editNarration}
                            onChange={(e) => setEditNarration(e.target.value)}
                            rows={2}
                          />
                        </div>
                        <div>
                          <label>Visual Prompt &amp; Atmosphere</label>
                          <input
                            value={editPrompt}
                            onChange={(e) => setEditPrompt(e.target.value)}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <div style={{ width: 120 }}>
                            <label>Duration (sec)</label>
                            <input
                              type="number"
                              value={editDuration}
                              onChange={(e) => setEditDuration(Number(e.target.value))}
                            />
                          </div>
                          <button
                            className="btn btn-gold"
                            style={{ marginTop: 18, fontSize: 12 }}
                            onClick={() => saveSceneEdit(s.id)}
                          >
                            Save Scene
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p style={{ margin: '8px 0', fontSize: 15 }}><b>Narration:</b> "{s.narration}"</p>
                        <p style={{ margin: '4px 0', fontSize: 13, color: '#94a3b8' }}><b>Visual Prompt:</b> {s.visualPrompt}</p>
                        <p style={{ margin: '4px 0', fontSize: 12, color: '#6ee7b7' }}><b>Voice Direction:</b> {s.voiceDirection}</p>
                      </>
                    )}
                  </div>
                );
              })}

              <button className="btn btn-gold" style={{ width: '100%', marginTop: 16, padding: '14px' }} onClick={renderVideo} disabled={rendering}>
                {rendering ? '⚙️ Rendering Master Short...' : '🚀 Render 9:16 Vertical Video (FFmpeg)'}
              </button>
              {msg && <p style={{ marginTop: 10, color: 'var(--gold)' }}>{msg}</p>}
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h3>Master 9:16 Vertical Preview</h3>
          {videoUrl ? (
            <div className="phone-mockup">
              <video
                key={`${videoUrl}_${lastRenderTime}`}
                src={`${videoUrl}?t=${lastRenderTime}`}
                controls
                autoPlay
                loop
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          ) : (
            <div className="phone-mockup" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', color: '#64748b' }}>
              <div>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🎬</div>
                <div>No Video Rendered Yet</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>Click "Render 9:16 Vertical Video" to assemble voice, visuals & subtitles.</div>
              </div>
            </div>
          )}

          {detail?.assets && detail.assets.length > 0 && (
            <div style={{ width: '100%', marginTop: 24 }}>
              <h4>Generated Production Assets ({detail.assets.length})</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {detail.assets.map((a: Row) => {
                  const filename = a.filePath ? a.filePath.split('/').pop() : '';
                  const subfolder = a.type === 'IMAGE' ? 'images' : a.type === 'AUDIO' ? 'audio' : a.type === 'VIDEO' ? 'videos' : 'subtitles';
                  const assetUrl = `/storage/${subfolder}/${filename}`;

                  return (
                    <div key={a.id} style={{ background: '#0d1322', padding: 10, borderRadius: 8, fontSize: 12, border: '1px solid var(--card-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <b style={{ color: 'var(--gold)' }}>{a.type}</b>
                        <span style={{ color: '#64748b', fontSize: 10 }}>{a.provider}</span>
                      </div>
                      {a.type === 'IMAGE' && (
                        <div style={{ marginTop: 6, borderRadius: 6, overflow: 'hidden', height: 110, background: '#000', border: '1px solid #1e293b' }}>
                          <img src={assetUrl} alt={a.prompt || 'Scene Beat'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                      )}
                      {a.type === 'AUDIO' && (
                        <audio src={assetUrl} controls style={{ width: '100%', marginTop: 6, height: 30 }} />
                      )}
                      <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {filename}
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ width: '100%', marginTop: 6, fontSize: 11, padding: '3px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                        onClick={() => triggerDownload(assetUrl, filename)}
                      >
                        📥 Download {a.type === 'IMAGE' ? 'Visual' : a.type}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PublishingCalendar({ brands }: { brands: Row[] }) {
  const [schedules, setSchedules] = useState<Row[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<number>(0);
  const [msg, setMsg] = useState('');

  const loadSchedules = () => {
    const q = selectedBrandId ? `?brandId=${selectedBrandId}` : '';
    api('GET', `/schedules${q}`).then(setSchedules);
  };

  useEffect(() => { loadSchedules(); }, [selectedBrandId]);

  const cancelSchedule = async (id: number) => {
    try {
      await api('DELETE', `/schedules/${id}`);
      loadSchedules();
      setMsg('Schedule slot cancelled.');
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    }
  };

  return (
    <div>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2>📅 Publishing Calendar &amp; Multi-Platform Schedule</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            Automated multi-platform slots for YouTube Shorts, Instagram Reels, and TikTok.
          </p>
        </div>
        <div>
          <select value={selectedBrandId} onChange={(e) => setSelectedBrandId(Number(e.target.value))}>
            <option value={0}>All Brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {msg && <div className="card" style={{ background: '#1e293b' }}>{msg}</div>}

      <div className="card">
        {schedules.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📅</div>
            <div>No scheduled posts found.</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Approve a video in "Script &amp; Video Studio" and click "Schedule Post".</div>
          </div>
        ) : (
          <table cellPadding={12} style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--card-border)', color: 'var(--text-muted)', fontSize: 13 }}>
                <th>Scheduled Date/Time</th>
                <th>Brand</th>
                <th>Platform</th>
                <th>Content Title</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <td><b>{s.scheduledAt.replace('T', ' ')}</b></td>
                  <td>{s.brandName} ({s.brandHandle})</td>
                  <td>
                    <span className="badge" style={{
                      background: s.platform === 'YOUTUBE' ? '#7f1d1d' : s.platform === 'INSTAGRAM' ? '#831843' : '#1e1b4b',
                      color: '#ffffff'
                    }}>
                      {s.platform}
                    </span>
                  </td>
                  <td>{s.contentTitle}</td>
                  <td>
                    <span className={`badge badge-${s.status.toLowerCase()}`}>
                      {s.status}
                    </span>
                  </td>
                  <td>
                    {s.status === 'SCHEDULED' && (
                      <button className="btn btn-danger" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => cancelSchedule(s.id)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const REGION_PRESETS: Record<string, { appearance: string; clothingStyle: string; personality: string; voiceStyle: string; visualPrompt: string }> = {
  'South Asian / Indian': {
    appearance: 'Striking sculpted Indian facial features, captivating kohl-lined dark almond eyes, radiant warm golden skin, sleek dark wavy hair with maang tikka',
    clothingStyle: 'Embellished royal peacock-blue silk and gold embroidered stage corset with matching lehenga skirt and delicate jhumka earrings',
    personality: 'Graceful, seductive, expressive eye movements, regal presence',
    voiceStyle: 'Samantha',
    visualPrompt: 'Chiaroscuro palace stage lighting, warm golden rim reflections, silk fabric ripples, cinematic Bollywood drama, 8k vertical',
  },
  'Latina / Hispanic': {
    appearance: 'Striking sculpted Latin facial features, intense deep hazel eyes, dark voluminous wavy hair, athletic silhouette',
    clothingStyle: 'Midnight crimson liquid silk high-slit gown with gold accents and dramatic fabric movement',
    personality: 'Sensual, fierce, poised, magnetic eye contact',
    voiceStyle: 'Samantha',
    visualPrompt: 'High-contrast stage lighting, dramatic backlights, liquid silk ripples, golden haze, intense camera focus on eyes and posture',
  },
  'East Asian': {
    appearance: 'Luminous porcelain complexion, captivating winged cat-eyes, glossy gradient lips, sleek jet-black bob haircut',
    clothingStyle: 'Futuristic metallic lavender and chrome stage corset top with matching high-waisted shorts and thigh-high boots',
    personality: 'Fierce, captivating, sharp modern glamour, intense eye contact',
    voiceStyle: 'Moira',
    visualPrompt: 'Electric neon cyan and violet stage rim lighting, futuristic stage bokeh, high-energy sharp choreography hits, 8k vertical',
  },
  'Middle Eastern / Arab': {
    appearance: 'Exotic graceful bone structure, piercing almond amber eyes, waist-length braided dark hair with gold cuffs',
    clothingStyle: 'Flowing emerald green silk skirt, structured velvet bodice, delicate antique gold arm cuffs and temple jewelry',
    personality: 'Enigmatic, hypnotic, serene, intense artistic focus',
    voiceStyle: 'Karen',
    visualPrompt: 'Violet and emerald neon rim-lighting, stage fog, glossy black reflective floor, fluid body isolations',
  },
  'Western / American': {
    appearance: 'High cheekbones, luminous golden complexion, warm sparkling eyes, vintage Hollywood platinum-blonde waves',
    clothingStyle: 'Embellished gold crystal fringe corset, sheer satin opera gloves, statement crystal earrings',
    personality: 'Playful, confident, ultra-glamorous, seductive smile',
    voiceStyle: 'Victoria',
    visualPrompt: 'Warm amber spotlights, glittering crystal reflections, cinematic cabaret stage bokeh, slow-motion choreography',
  },
  'African / Afro-Diaspora': {
    appearance: 'Radiant deep melanin complexion, high sculpted cheekbones, intense dark eyes, intricate cornrow braids crowned with polished gold cuffs',
    clothingStyle: 'Vibrant rich magenta satin and gold filigree stage bodice with matching flowing skirt and gold jewelry',
    personality: 'Commanding, joyful, regal, magnetic stage presence',
    voiceStyle: 'Victoria',
    visualPrompt: 'Dramatic golden stage rim lighting, vibrant purple and gold bokeh, powerful fluid stage movement, 8k vertical',
  },
  'European / Modern Stage': {
    appearance: 'Sharp angular jawline, sultry cat-eye makeup, sleek high ponytail, powerful sculpted stage presence',
    clothingStyle: 'Glossy black leather & chrome corset top, tailored satin track trousers, 4-inch stage heels',
    personality: 'Bold, commanding, fearless, sharp modern attitude',
    voiceStyle: 'Moira',
    visualPrompt: 'Strobe light flashes, neon cyan and magenta rim light, fast-cut cinematic camera angles, razor-sharp rhythm hits',
  },
};

function CharactersStudio({ brands }: { brands: Row[] }) {
  const [selectedBrandId, setSelectedBrandId] = useState<number>(brands[0]?.id || 0);
  const [archetypes, setArchetypes] = useState<any[]>([]);
  const [characters, setCharacters] = useState<Row[]>([]);
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [customPreviewUrl, setCustomPreviewUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [showCustomForm, setShowCustomForm] = useState(false);

  // Custom Form
  const [selectedRegion, setSelectedRegion] = useState<string>('South Asian / Indian');
  const [name, setName] = useState('Priya');
  const [age, setAge] = useState(23);
  const [personality, setPersonality] = useState(REGION_PRESETS['South Asian / Indian'].personality);
  const [appearance, setAppearance] = useState(REGION_PRESETS['South Asian / Indian'].appearance);
  const [clothingStyle, setClothingStyle] = useState(REGION_PRESETS['South Asian / Indian'].clothingStyle);
  const [voiceStyle, setVoiceStyle] = useState(REGION_PRESETS['South Asian / Indian'].voiceStyle);
  const [visualPrompt, setVisualPrompt] = useState(REGION_PRESETS['South Asian / Indian'].visualPrompt);

  const applyRegionPreset = (r: string) => {
    setSelectedRegion(r);
    const p = REGION_PRESETS[r];
    if (p) {
      setPersonality(p.personality);
      setAppearance(p.appearance);
      setClothingStyle(p.clothingStyle);
      setVoiceStyle(p.voiceStyle);
      setVisualPrompt(p.visualPrompt);
    }
  };

  const loadData = () => {
    if (!selectedBrandId) return;
    api('GET', '/characters/archetypes').then(setArchetypes);
    api('GET', `/characters?brandId=${selectedBrandId}`).then(setCharacters);
  };

  useEffect(() => {
    if (brands.length > 0 && !selectedBrandId) setSelectedBrandId(brands[0].id);
  }, [brands]);

  useEffect(() => {
    loadData();
  }, [selectedBrandId]);

  const adoptArchetype = async (archetypeId: string) => {
    setLoading(true);
    setMsg('');
    try {
      const res = await api('POST', '/characters/archetypes/adopt', {
        brandId: selectedBrandId,
        archetypeId,
      });
      if (res.alreadyAdopted) {
        setMsg(`Dancer "${res.character.name}" is already in your brand persona roster!`);
      } else {
        setMsg(`✨ Dancer "${res.character.name}" adopted successfully!`);
      }
      loadData();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const generatePortraitPreview = async () => {
    if (!appearance.trim() || !clothingStyle.trim()) return;
    setPreviewLoading(true);
    setMsg('');
    try {
      const res = await api('POST', '/characters/preview-portrait', {
        name: name || 'Virtual Dancer',
        appearance,
        clothingStyle,
        visualPrompt,
      });
      setCustomPreviewUrl(res.portraitUrl);
      setMsg('✨ Face model portrait generated successfully!');
    } catch (e: any) {
      setMsg(`Error generating preview: ${e.message}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const createCustomDancer = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setMsg('');
    try {
      await api('POST', '/characters', {
        brandId: selectedBrandId,
        name: name.trim(),
        description: `${selectedRegion} Dancer Persona — ${personality}`,
        age: Number(age),
        personality: personality.trim(),
        appearance: appearance.trim(),
        clothingStyle: clothingStyle.trim(),
        visualPrompt: visualPrompt.trim(),
        negativePrompt: 'nudity, deformed, bad anatomy, blur, low quality, distortion',
        voiceStyle: voiceStyle.trim(),
      });
      setMsg(`✨ Custom dancer "${name}" created and saved to your brand!`);
      setShowCustomForm(false);
      loadData();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteCharacter = async (id: number) => {
    try {
      await api('DELETE', `/characters/${id}`);
      setMsg('Dancer removed.');
      loadData();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    }
  };

  const filteredArchetypes = selectedRegionFilter === 'ALL'
    ? archetypes
    : archetypes.filter((a) => a.region === selectedRegionFilter || a.regionLabel === selectedRegionFilter);

  return (
    <div>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2>💃 Dancer Personas &amp; Face Models Studio</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            Inspect visual portraits, filter by target geographic region/ethnicity, adopt pre-built luxury dancer archetypes, or design your own persistent virtual face model.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <div>
            <label style={{ fontSize: 12 }}>Target Brand</label>
            <select value={selectedBrandId} onChange={(e) => setSelectedBrandId(Number(e.target.value))} style={{ minWidth: 200 }}>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-outline" onClick={() => setShowCustomForm(!showCustomForm)}>
              {showCustomForm ? '✕ Close Custom Creator' : '🎨 Create Custom Face Persona'}
            </button>
          </div>
        </div>
      </div>

      {msg && <div className="card" style={{ background: '#1e293b' }}>{msg}</div>}

      {showCustomForm && (
        <div className="card" style={{ background: '#172033', border: '1px solid var(--accent)', marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>🎨 Create Custom Dancer &amp; Face Model</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: -6 }}>
            Select your target demographic region to auto-populate cultural traits, then customize the facial features, signature costume, and click "Generate Face Preview".
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 24, marginTop: 16 }}>
            <form onSubmit={createCustomDancer} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label>🌍 Target Audience Region &amp; Ethnicity</label>
                <select value={selectedRegion} onChange={(e) => applyRegionPreset(e.target.value)} style={{ border: '1px solid var(--accent)', fontWeight: 'bold' }}>
                  <option value="South Asian / Indian">🇮🇳 South Asian / Indian (Desi, Bollywood, Classical Fusion)</option>
                  <option value="Latina / Hispanic">🇪🇸 Latina / Hispanic (Flamenco, Latin Tango, Ballroom)</option>
                  <option value="East Asian">🇯🇵 East Asian / Korean (K-Pop Stage, High-Heels Soloist)</option>
                  <option value="Middle Eastern / Arab">🇦🇪 Middle Eastern / Arab (Oriental Cabaret, Belly-Fusion)</option>
                  <option value="Western / American">🇺🇸 Western / American (Broadway, Cabaret Noir, High Glamour)</option>
                  <option value="African / Afro-Diaspora">🇳🇬 African / Afro-Diaspora (Afro-Fusion, Royal Stage)</option>
                  <option value="European / Modern Stage">🇪🇺 European / Modern Stage (Commercial Stage, Heels)</option>
                </select>
              </div>
              <div>
                <label>Dancer Name &amp; Stage Title</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Valentina 'The Midnight Flame'" required />
              </div>
              <div>
                <label>Age &amp; Voice Profile</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="number" value={age} onChange={(e) => setAge(Number(e.target.value))} style={{ width: 75 }} required />
                  <select value={voiceStyle} onChange={(e) => setVoiceStyle(e.target.value)} style={{ flex: 1 }}>
                    <option value="Samantha">Samantha (Smooth, confident)</option>
                    <option value="Victoria">Victoria (Warm, velvety, glamorous)</option>
                    <option value="Karen">Karen (Mesmerizing, mysterious)</option>
                    <option value="Moira">Moira (Fierce, punchy)</option>
                    <option value="Daniel">Daniel (Deep, commanding)</option>
                  </select>
                </div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label>Face &amp; Physical Features (Hair, Eyes, Cheekbones, Build)</label>
                <input value={appearance} onChange={(e) => setAppearance(e.target.value)} placeholder="e.g. High cheekbones, deep hazel eyes, dark wavy hair, athletic dancer posture" required />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label>Signature Stage Attire &amp; Costume Glamour</label>
                <input value={clothingStyle} onChange={(e) => setClothingStyle(e.target.value)} placeholder="e.g. Crimson liquid silk high-slit gown with gold crystal corset" required />
              </div>
              <div>
                <label>Personality &amp; Dance Specialty</label>
                <input value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder="e.g. Sensual, poised, magnetic eye contact, Latin Ballroom & Cabaret" required />
              </div>
              <div>
                <label>Lighting &amp; Visual Aesthetics Prompt</label>
                <input value={visualPrompt} onChange={(e) => setVisualPrompt(e.target.value)} placeholder="e.g. Chiaroscuro stage spotlight, golden rim lighting, 9:16 vertical 8k" required />
              </div>

              <div style={{ gridColumn: 'span 2', display: 'flex', gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ flex: 1 }}
                  onClick={generatePortraitPreview}
                  disabled={previewLoading}
                >
                  {previewLoading ? '🎨 Rendering Face Preview...' : '🪄 Generate Live Face Preview'}
                </button>
                <button
                  type="submit"
                  className="btn btn-gold"
                  style={{ flex: 1 }}
                  disabled={loading}
                >
                  {loading ? 'Saving Dancer Persona...' : '🚀 Save Custom Dancer'}
                </button>
              </div>
            </form>

            {/* Live Portrait Preview Card */}
            <div style={{ background: '#0a0f1d', borderRadius: 12, padding: 16, border: '1px solid var(--card-border)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                Live Face Model Preview
              </div>
              {customPreviewUrl ? (
                <div style={{ width: 220, height: 220, borderRadius: 16, overflow: 'hidden', border: '3px solid var(--accent)', boxShadow: '0 10px 30px rgba(0,0,0,0.7)', position: 'relative' }}>
                  <img src={customPreviewUrl} alt="Custom Dancer Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ) : (
                <div style={{ width: 220, height: 220, borderRadius: 16, border: '2px dashed #334155', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', padding: 16 }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>🎭</div>
                  <div style={{ fontSize: 13 }}>No Preview Yet</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Click "Generate Live Face Preview" to visualize this face model.</div>
                </div>
              )}
              {customPreviewUrl && (
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ marginTop: 10, fontSize: 11, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center', borderColor: 'var(--accent)', color: '#a5b4fc' }}
                  onClick={() => triggerDownload(customPreviewUrl, `${(name || 'Custom_Dancer').replace(/[^a-zA-Z0-9]/g, '_')}_Face_Model.png`)}
                >
                  📥 Download AI Face Model (.PNG)
                </button>
              )}
              <div style={{ marginTop: 14, fontSize: 13 }}>
                <b style={{ color: '#f8fafc' }}>{name || 'Custom Dancer'}</b> ({age} yrs)
                <div style={{ color: 'var(--accent)', fontSize: 11, marginTop: 2 }}>{selectedRegion}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pre-Built Curated Dancer Archetypes with Photo Portraits */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0 }}>🌟 Global High-Glamour Dancer Archetypes ({filteredArchetypes.length})</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
              Filter by audience target region to select the ideal cultural persona and visual face aesthetics.
            </p>
          </div>

          {/* Regional Filter Badges */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'ALL', label: 'All Regions' },
              { id: 'South Asian / Indian', label: '🇮🇳 South Asian' },
              { id: 'Latina / Hispanic', label: '🇪🇸 Latina' },
              { id: 'East Asian', label: '🇯🇵 East Asian' },
              { id: 'Middle Eastern / Arab', label: '🇦🇪 Middle Eastern' },
              { id: 'Western / American', label: '🇺🇸 Western' },
              { id: 'African / Afro-Diaspora', label: '🇳🇬 African' },
              { id: 'European / Modern Stage', label: '🇪🇺 European' },
            ].map((rf) => (
              <button
                key={rf.id}
                className={`btn ${selectedRegionFilter === rf.id ? 'btn-gold' : 'btn-outline'}`}
                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20 }}
                onClick={() => setSelectedRegionFilter(rf.id)}
              >
                {rf.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {filteredArchetypes.map((arc) => {
            const isAdopted = characters.some((c) => c.name === arc.name);
            return (
              <div
                key={arc.archetypeId}
                className="card"
                style={{
                  borderTop: `4px solid ${arc.accentColor}`,
                  background: '#0d1322',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  padding: 0,
                  overflow: 'hidden',
                }}
              >
                {/* Visual Face Portrait Header */}
                <div style={{ width: '100%', height: 260, position: 'relative', background: '#000', overflow: 'hidden' }}>
                  {arc.portraitUrl ? (
                    <img
                      src={arc.portraitUrl}
                      alt={arc.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 60 }}>
                      {arc.avatarEmoji}
                    </div>
                  )}
                  <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.2)' }}>
                    {arc.age} YRS
                  </div>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(13,19,34,1) 0%, rgba(13,19,34,0.6) 60%, transparent 100%)', padding: '24px 16px 8px' }}>
                    <h4 style={{ margin: 0, fontSize: 17, color: '#f8fafc', textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>{arc.name}</h4>
                    <div style={{ color: arc.accentColor, fontSize: 12, fontWeight: 'bold', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{arc.role}</div>
                  </div>
                </div>

                <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 10 }}>
                      "{arc.tagline}"
                    </div>

                    <div style={{ fontSize: 12, display: 'grid', gap: 6 }}>
                      <div>
                        <b style={{ color: '#94a3b8' }}>Face &amp; Look:</b> <span style={{ color: '#cbd5e1' }}>{arc.appearance}</span>
                      </div>
                      <div>
                        <b style={{ color: '#94a3b8' }}>Costume:</b> <span style={{ color: '#cbd5e1' }}>{arc.clothingStyle}</span>
                      </div>
                      <div>
                        <b style={{ color: '#94a3b8' }}>Voice:</b> <span style={{ color: '#cbd5e1' }}>{arc.voiceStyle}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                    <button
                      className={`btn ${isAdopted ? 'btn-outline' : 'btn-gold'}`}
                      style={{ flex: 1, fontSize: 12, padding: '8px 10px' }}
                      onClick={() => adoptArchetype(arc.archetypeId)}
                      disabled={loading || isAdopted}
                    >
                      {isAdopted ? '✓ In Brand Roster' : '⚡ Adopt Dancer'}
                    </button>
                    {arc.portraitUrl && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: 12, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 4, background: '#1c2844', borderColor: '#3b82f688', color: '#93c5fd' }}
                        title="Download 4K face portrait to upload to Viggle, Kling, LivePortrait"
                        onClick={() => triggerDownload(arc.portraitUrl, `${arc.name.replace(/[^a-zA-Z0-9]/g, '_')}_Face.jpg`)}
                      >
                        📥 Download Face
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Brand Dancers List */}
      <div>
        <h3>💃 Active Dancers in Brand Roster ({characters.length})</h3>
        {characters.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
            <div>No active dancers found for this brand.</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Click "⚡ Adopt This Dancer" above or create a custom face persona.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            {characters.map((c) => (
              <div key={c.id} className="card" style={{ background: '#131c31', border: '1px solid var(--card-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: 16 }}>{c.name}</h4>
                    <div style={{ color: 'var(--accent)', fontSize: 12, marginTop: 2 }}>{c.description || 'Virtual Dancer'}</div>
                  </div>
                  <button className="btn btn-danger" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => deleteCharacter(c.id)}>
                    Remove
                  </button>
                </div>

                <div style={{ marginTop: 12, fontSize: 12, display: 'grid', gap: 4, color: '#cbd5e1' }}>
                  <div><b>Appearance:</b> {c.appearance}</div>
                  <div><b>Costume:</b> {c.clothingStyle}</div>
                  <div><b>Personality:</b> {c.personality}</div>
                  <div><b>Voice Profile:</b> {c.voiceStyle || 'Samantha'}</div>
                </div>

                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4, background: '#131e36', color: '#93c5fd', borderColor: '#3b82f688' }}
                    onClick={() => {
                      const arc = archetypes.find((a: any) => a.name.toLowerCase() === c.name.toLowerCase());
                      const portrait = arc?.portraitUrl || '/api/media/images/rhea_bralette_portrait.jpg';
                      triggerDownload(portrait, `${c.name.replace(/[^a-zA-Z0-9]/g, '_')}_Face_Model.jpg`);
                    }}
                  >
                    📥 Download Face Model (.JPG)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const RESOURCES: Record<string, { path: string; fields: Array<{ key: string; label: string; kind?: string }> }> = {
  Brands: {
    path: '/brands',
    fields: [
      { key: 'name', label: 'Brand Name' },
      { key: 'handle', label: 'Handle (e.g. @auravo.studio)' },
      { key: 'niche', label: 'Niche / Content Pillar' },
      { key: 'language', label: 'Language' },
      { key: 'tone', label: 'Tone' },
      { key: 'visualStyle', label: 'Visual Style / Lighting Aesthetics' },
      { key: 'targetAgeMin', label: 'Target Age Min', kind: 'number' },
      { key: 'targetAgeMax', label: 'Target Age Max', kind: 'number' },
      { key: 'preferredTopics', label: 'Preferred Topics (comma-separated)', kind: 'list' },
      { key: 'prohibitedTopics', label: 'Prohibited Topics (comma-separated)', kind: 'list' },
    ],
  },
  'Audience Profiles': {
    path: '/audience-profiles',
    fields: [
      { key: 'name', label: 'Profile Name' },
      { key: 'ageMin', label: 'Age Min', kind: 'number' },
      { key: 'ageMax', label: 'Age Max', kind: 'number' },
      { key: 'country', label: 'Country / Region' },
      { key: 'language', label: 'Language' },
      { key: 'tone', label: 'Tone' },
      { key: 'interests', label: 'Audience Interests (comma-separated)', kind: 'list' },
      { key: 'avoid', label: 'Avoid / Safety Exclusions (comma-separated)', kind: 'list' },
    ],
  },
  'Content Library': {
    path: '/content',
    fields: [
      { key: 'brandId', label: 'Brand', kind: 'brand' },
      { key: 'title', label: 'Title' },
      { key: 'topic', label: 'Topic / Pillar' },
    ],
  },
};

function ResourceView({ name }: { name: string }) {
  const { path, fields } = RESOURCES[name];
  const [rows, setRows] = useState<Row[]>([]);
  const [brands, setBrands] = useState<Row[]>([]);
  const [err, setErr] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = () => api('GET', path).then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); api('GET', '/brands').then(setBrands); }, [name]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr('');
    const form = e.currentTarget;
    const f = new FormData(form), body: Row = {};
    for (const { key, kind } of fields) {
      const v = String(f.get(key) ?? '').trim(); if (!v) continue;
      body[key] = kind === 'number' || kind === 'brand' ? Number(v) : kind === 'list' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v;
    }
    try { await api('POST', path, body); form.reset(); load(); } catch (x) { setErr((x as Error).message); }
  };

  const del = (id: number) => api('DELETE', `${path}/${id}`).then(load).catch((x) => setErr(x.message));

  return (
    <div className="grid-2">
      <div className="card">
        <h3>Create New {name.slice(0, -1)}</h3>
        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          {fields.map((f) => (
            <div key={f.key}>
              <label>{f.label}</label>
              {f.kind === 'brand' ? (
                <select name={f.key} required>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              ) : (
                <input name={f.key} type={f.kind === 'number' ? 'number' : 'text'} required={f.key === 'name' || f.key === 'title'} />
              )}
            </div>
          ))}
          <button className="btn" style={{ marginTop: 8 }}>+ Save to Studio</button>
        </form>
        {err && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</p>}
      </div>

      <div>
        <h3>Your {name} ({rows.length})</h3>
        {rows.map((r) => (
          <div key={r.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: 16 }}>{r.name ?? r.title}</h4>
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                  {r.handle ? `@${r.handle.replace('@', '')}` : r.niche ?? r.country ?? r.topic ?? ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                  {expandedId === r.id ? 'Hide' : 'Details'}
                </button>
                <button className="btn btn-danger" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => del(r.id)}>Delete</button>
              </div>
            </div>

            {expandedId === r.id && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--card-border)', fontSize: 13 }}>
                {Object.entries(r).map(([k, v]) => {
                  if (['id', 'ownerId', 'name', 'title'].includes(k)) return null;
                  return (
                    <div key={k} style={{ marginBottom: 6 }}>
                      <b style={{ color: 'var(--text-muted)' }}>{k}:</b>{' '}
                      <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('abhishek.suman854@gmail.com');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuth = async (mode: 'login' | 'register') => {
    setErr('');
    setLoading(true);
    try {
      await api('POST', `/auth/${mode}`, { email: email.trim().toLowerCase(), password });
      onDone();
    } catch (x: any) {
      setErr(x.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
      <div className="card" style={{ width: 360 }}>
        <h2>Sign In to Studio</h2>
        <div style={{ marginBottom: 12 }}>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@example.com"
            required
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8+ characters"
            required
            onKeyDown={(e) => { if (e.key === 'Enter') handleAuth('login'); }}
          />
        </div>
        <button
          className="btn"
          type="button"
          onClick={() => handleAuth('login')}
          disabled={loading}
          style={{ width: '100%', marginBottom: 8 }}
        >
          {loading ? 'Signing in...' : 'Log In'}
        </button>
        <button
          className="btn btn-outline"
          type="button"
          onClick={() => handleAuth('register')}
          disabled={loading}
          style={{ width: '100%' }}
        >
          Create Owner Account
        </button>
        {err && <p style={{ color: 'var(--danger)', marginTop: 10, fontSize: 13 }}>{err}</p>}
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<Row | null | undefined>(undefined);
  const [tab, setTab] = useState('Script & Video Studio');
  const [brands, setBrands] = useState<Row[]>([]);

  const refresh = () => {
    api('GET', '/auth/me').then(setUser).catch(() => setUser(null));
    api('GET', '/brands').then(setBrands).catch(() => setBrands([]));
  };

  useEffect(() => { refresh(); }, []);

  if (user === undefined) return null;

  return (
    <div>
      <style>{STYLES}</style>
      <div className="app-container">
        <header className="header">
          <div>
            <h1 style={{ margin: 0, fontSize: 24, letterSpacing: -0.5 }}>✨ AI Content Studio</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              Multi-Brand Faceless Automation Platform · <b>₹0-First Core</b>
            </div>
          </div>
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{user.email}</span>
              <button className="btn btn-outline" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => api('POST', '/auth/logout').then(refresh)}>
                Log out
              </button>
            </div>
          )}
        </header>

        {!user ? (
          <Login onDone={refresh} />
        ) : (
          <div>
            <nav className="nav-tabs">
              {[
                'Ideas Studio',
                'Script & Video Studio',
                'Publishing Calendar',
                'Brands',
                'Audience Profiles',
                'Characters',
                'Content Library'
              ].map((t) => (
                <button key={t} className={`nav-btn ${t === tab ? 'active' : ''}`} onClick={() => { setTab(t); refresh(); }}>
                  {t}
                </button>
              ))}
            </nav>

            {tab === 'Ideas Studio' && <IdeasStudio brands={brands} />}
            {tab === 'Script & Video Studio' && <ScriptStudio brands={brands} />}
            {tab === 'Publishing Calendar' && <PublishingCalendar brands={brands} />}
            {tab === 'Characters' && <CharactersStudio brands={brands} />}
            {RESOURCES[tab] && <ResourceView key={tab} name={tab} />}
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
