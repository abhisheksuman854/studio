import { useEffect, useState, type FormEvent } from 'react';

type Row = Record<string, any>;

const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const contentType = r.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  }
  const text = await r.text();
  if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
  return text;
};

const triggerDownload = async (url: string, preferredFilename?: string) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch failed');
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = preferredFilename || url.split('/').pop() || 'asset_media.mp4';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch {
    const link = document.createElement('a');
    link.href = url;
    link.download = preferredFilename || url.split('/').pop() || 'asset_media.mp4';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

// ==========================================
// 1. Dashboard View: Creative Workspace Hub
// ==========================================
export function DashboardView({
  onNavigate,
  onSelectCharacterForMotion,
  onSelectAnimationForVideo,
}: {
  onNavigate: (tab: string) => void;
  onSelectCharacterForMotion?: (characterId: number) => void;
  onSelectAnimationForVideo?: (characterId: number, animationId: number) => void;
}) {
  const [stats, setStats] = useState<any>({
    counts: { characters: 0, animations: 0, videos: 0, projects: 0 },
    recent: { characters: [], animations: [], videos: [], projects: [] },
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('GET', '/dashboard/stats')
      .then((res) => {
        if (res && res.counts) setStats(res);
      })
      .catch((e) => console.error('Failed to load dashboard stats:', e))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', paddingBottom: 60 }}>
      {/* Hero Welcome Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%)',
          borderRadius: 16,
          border: '1px solid rgba(99, 102, 241, 0.3)',
          padding: '28px 32px',
          marginBottom: 24,
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.4)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 20,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 32 }}>✨</span>
            <h2 style={{ margin: 0, fontSize: 26, color: '#f8fafc', letterSpacing: -0.5 }}>
              Auravo Studio Creative Workspace
            </h2>
            <span
              style={{
                background: 'rgba(99, 102, 241, 0.2)',
                color: '#a5b4fc',
                padding: '3px 12px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 700,
                border: '1px solid rgba(99, 102, 241, 0.4)',
              }}
            >
              Sprint 4 Production
            </span>
          </div>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 14, maxWidth: 680, lineHeight: 1.5 }}>
            Virtual character generation, local kinematic motion synthesis, and multi-aspect ratio video production.
            100% locally verified with <b>$0.00 external API cost</b>.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn-gold"
            onClick={() => onNavigate('Characters')}
            style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span>+</span>
            <span>New Character</span>
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => onNavigate('Asset Library')}
            style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span>🗄️</span>
            <span>Browse Library</span>
          </button>
        </div>
      </div>

      {/* Interactive 4-Step Pipeline Bar */}
      <div
        style={{
          background: '#0f172a',
          borderRadius: 14,
          padding: '16px 20px',
          border: '1px solid #1e293b',
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 12 }}>
          Core Production Pipeline
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            {
              step: '1',
              title: 'Character Studio',
              desc: 'Design persona, face & prompt',
              tab: 'Characters',
              count: stats.counts.characters,
              icon: '🎭',
            },
            {
              step: '2',
              title: 'Motion Studio',
              desc: 'Synthesize articulated movement',
              tab: 'Motion Studio',
              count: stats.counts.animations,
              icon: '🎬',
            },
            {
              step: '3',
              title: 'Video Studio',
              desc: 'Compose framing, titles & voice',
              tab: 'Video Studio',
              count: stats.counts.videos,
              icon: '📹',
            },
            {
              step: '4',
              title: 'Asset Library',
              desc: 'Inspect, download & manage',
              tab: 'Asset Library',
              count: stats.counts.characters + stats.counts.animations + stats.counts.videos,
              icon: '🗄️',
            },
          ].map((s) => (
            <div
              key={s.step}
              onClick={() => onNavigate(s.tab)}
              style={{
                background: '#1e293b',
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid #334155',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 14 }}>{s.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#f8fafc' }}>
                    {s.title}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.desc}</div>
              </div>
              <span
                style={{
                  background: '#0f172a',
                  color: '#38bdf8',
                  padding: '3px 8px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  border: '1px solid #1e293b',
                }}
              >
                {s.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* KPI Counters Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="card" style={{ padding: '18px 20px', margin: 0, borderLeft: '4px solid #38bdf8' }}>
          <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>SAVED CHARACTERS</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f8fafc', marginTop: 4 }}>
            {stats.counts.characters}
          </div>
          <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 4 }}>Locked identity & portraits</div>
        </div>
        <div className="card" style={{ padding: '18px 20px', margin: 0, borderLeft: '4px solid #f59e0b' }}>
          <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>KINEMATIC ANIMATIONS</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f8fafc', marginTop: 4 }}>
            {stats.counts.animations}
          </div>
          <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>Articulated 30 FPS clips</div>
        </div>
        <div className="card" style={{ padding: '18px 20px', margin: 0, borderLeft: '4px solid #10b981' }}>
          <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>COMPOSED BROADCAST VIDEOS</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f8fafc', marginTop: 4 }}>
            {stats.counts.videos}
          </div>
          <div style={{ fontSize: 11, color: '#10b981', marginTop: 4 }}>9:16 / 16:9 / 1:1 Stereo MP4s</div>
        </div>
        <div className="card" style={{ padding: '18px 20px', margin: 0, borderLeft: '4px solid #a855f7' }}>
          <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>CAMPAIGN PROJECTS</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f8fafc', marginTop: 4 }}>
            {stats.counts.projects}
          </div>
          <div style={{ fontSize: 11, color: '#a855f7', marginTop: 4 }}>End-to-end linked workflows</div>
        </div>
      </div>

      {/* Quick Launch Cards */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 14px 0', fontSize: 17, color: '#f8fafc' }}>⚡ Quick Creation Actions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div
            className="card"
            style={{
              padding: 20,
              margin: 0,
              background: '#0d1322',
              border: '1px solid #1e293b',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🎭</div>
              <h4 style={{ margin: 0, fontSize: 16, color: '#f8fafc' }}>Character Studio</h4>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>
                Create an original character with locked cultural style, costume, and natural lighting prompt.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => onNavigate('Characters')}
              style={{ marginTop: 14, width: '100%', fontSize: 12, borderColor: '#38bdf8', color: '#38bdf8' }}
            >
              Open Character Creator →
            </button>
          </div>

          <div
            className="card"
            style={{
              padding: 20,
              margin: 0,
              background: '#0d1322',
              border: '1px solid #1e293b',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🎬</div>
              <h4 style={{ margin: 0, fontSize: 16, color: '#f8fafc' }}>Motion Studio</h4>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>
                Animate any saved character using PyTorch kinematic grid sampling presets (Wave, Nodding, Walking).
              </p>
            </div>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => onNavigate('Motion Studio')}
              style={{ marginTop: 14, width: '100%', fontSize: 12, borderColor: '#f59e0b', color: '#f59e0b' }}
            >
              Synthesize Motion →
            </button>
          </div>

          <div
            className="card"
            style={{
              padding: 20,
              margin: 0,
              background: '#0d1322',
              border: '1px solid #1e293b',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📹</div>
              <h4 style={{ margin: 0, fontSize: 16, color: '#f8fafc' }}>Video Studio</h4>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>
                Compose final broadcast-ready MP4 with stage framing, subtitles, narration voice, and stereo music.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => onNavigate('Video Studio')}
              style={{ marginTop: 14, width: '100%', fontSize: 12, borderColor: '#10b981', color: '#10b981' }}
            >
              Compose Video →
            </button>
          </div>
        </div>
      </div>

      {/* Recent Work Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 20 }}>
        {/* Recent Composed Videos */}
        <div className="card" style={{ padding: 20, margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h4 style={{ margin: 0, fontSize: 16, color: '#f8fafc' }}>📹 Recent Composed Videos</h4>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => onNavigate('Asset Library')}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              View All
            </button>
          </div>

          {stats.recent.videos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 28, color: '#64748b', fontSize: 13 }}>
              No videos composed yet. Open Video Studio to compose your first MP4.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {stats.recent.videos.map((v: any) => (
                <div
                  key={v.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 10,
                    background: '#0f172a',
                    borderRadius: 8,
                    border: '1px solid #1e293b',
                  }}
                >
                  <img
                    src={v.thumbnailUrl || v.videoUrl}
                    alt={v.title}
                    style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {v.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      ⏱ {v.duration}s • {v.resolution} • {v.createdAt?.slice(0, 10)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => onNavigate('Asset Library')}
                    style={{ fontSize: 11, padding: '4px 10px' }}
                  >
                    Inspect
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Motion Animations */}
        <div className="card" style={{ padding: 20, margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h4 style={{ margin: 0, fontSize: 16, color: '#f8fafc' }}>🎬 Recent Kinematic Motions</h4>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => onNavigate('Motion Studio')}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              Studio
            </button>
          </div>

          {stats.recent.animations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 28, color: '#64748b', fontSize: 13 }}>
              No kinematic animations generated yet. Open Motion Studio to begin.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {stats.recent.animations.map((a: any) => (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 10,
                    background: '#0f172a',
                    borderRadius: 8,
                    border: '1px solid #1e293b',
                  }}
                >
                  <div style={{ width: 48, height: 48, borderRadius: 6, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                    🏃
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#f59e0b' }}>
                      Preset: {a.preset?.toUpperCase()} • {a.durationSec}s
                    </div>
                  </div>
                  {onSelectAnimationForVideo && (
                    <button
                      type="button"
                      className="btn btn-gold"
                      onClick={() => onSelectAnimationForVideo(a.characterId || 1, a.id)}
                      style={{ fontSize: 10, padding: '4px 8px' }}
                    >
                      Compose Video
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 2. Projects View: Creative Campaign Workflow Grouping
// ==========================================
export function ProjectsView({
  brands,
  onOpenCharacterInMotion,
  onOpenInVideoStudio,
  onOpenInAssetLibrary,
}: {
  brands: Row[];
  onOpenCharacterInMotion?: (characterId: number) => void;
  onOpenInVideoStudio?: (characterId: number, animationId: number) => void;
  onOpenInAssetLibrary?: () => void;
}) {
  const [projects, setProjects] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [animations, setAnimations] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedBrandId, setSelectedBrandId] = useState<number>(brands[0]?.id || 1);
  const [selectedCharId, setSelectedCharId] = useState<number | null>(null);
  const [selectedAnimId, setSelectedAnimId] = useState<number | null>(null);
  const [selectedVidId, setSelectedVidId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('ACTIVE');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const loadAll = () => {
    setLoading(true);
    Promise.all([
      api('GET', '/projects').catch(() => []),
      api('GET', '/characters').catch(() => []),
      api('GET', '/motion/animations').then((r) => r.animations || []).catch(() => []),
      api('GET', '/videos').then((r) => r.videos || []).catch(() => []),
    ]).then(([p, c, a, v]) => {
      setProjects(Array.isArray(p) ? p : []);
      setCharacters(Array.isArray(c) ? c : []);
      setAnimations(Array.isArray(a) ? a : []);
      setVideos(Array.isArray(v) ? v : []);
      if (c.length > 0 && !selectedCharId) setSelectedCharId(c[0].id);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { loadAll(); }, []);

  const handleCreateProject = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setErr('');
    try {
      await api('POST', '/projects', {
        brandId: Number(selectedBrandId),
        name: name.trim(),
        description: description.trim() || undefined,
        characterId: selectedCharId ? Number(selectedCharId) : null,
        animationId: selectedAnimId ? Number(selectedAnimId) : null,
        videoId: selectedVidId ? Number(selectedVidId) : null,
        status,
      });
      setShowCreateModal(false);
      setName('');
      setDescription('');
      loadAll();
    } catch (e: any) {
      setErr(e.message || 'Failed to create campaign project');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = async (id: number) => {
    if (!confirm('Are you sure you want to delete this campaign project? (Associated character, animation, and video media files will remain safely preserved in your Asset Library).')) return;
    try {
      await api('DELETE', `/projects/${id}`);
      loadAll();
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          padding: '24px 28px',
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
          borderRadius: 16,
          border: '1px solid rgba(168, 85, 247, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 28 }}>📁</span>
            <h2 style={{ margin: 0, fontSize: 24, color: '#f8fafc' }}>Creative Campaign Projects</h2>
            <span
              style={{
                background: 'rgba(168, 85, 247, 0.2)',
                color: '#c084fc',
                padding: '2px 10px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid rgba(168, 85, 247, 0.4)',
              }}
            >
              {projects.length} Campaigns
            </span>
          </div>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>
            Connect Character Portraits, Articulated Motions, and Composed Videos into single unified campaign deliverables.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-gold"
          onClick={() => setShowCreateModal(true)}
          style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700 }}
        >
          + New Campaign Project
        </button>
      </div>

      {/* Projects List */}
      {projects.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, background: '#0a0f1d' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>No Campaign Projects Created Yet</div>
          <p style={{ color: '#94a3b8', fontSize: 13, maxWidth: 440, margin: '8px auto 20px', lineHeight: 1.4 }}>
            Organize your virtual character production by grouping saved characters, motion clips, and final broadcast videos into unified campaign projects.
          </p>
          <button
            type="button"
            className="btn btn-gold"
            onClick={() => setShowCreateModal(true)}
            style={{ padding: '10px 20px', fontSize: 13, fontWeight: 700 }}
          >
            Create Your First Campaign
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 20 }}>
          {projects.map((proj) => {
            const char = characters.find((c) => c.id === proj.characterId);
            const anim = animations.find((a) => a.id === proj.animationId);
            const vid = videos.find((v) => v.id === proj.videoId);
            const linkedCount = (char ? 1 : 0) + (anim ? 1 : 0) + (vid ? 1 : 0);

            return (
              <div
                key={proj.id}
                className="card"
                style={{
                  background: '#0d1322',
                  border: '1px solid #1e293b',
                  borderRadius: 14,
                  padding: 22,
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                }}
              >
                {/* Project Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <h3 style={{ margin: 0, fontSize: 18, color: '#f8fafc' }}>{proj.name}</h3>
                      <span
                        style={{
                          background: proj.status === 'COMPLETED' ? 'rgba(34, 197, 94, 0.2)' : proj.status === 'ARCHIVED' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                          color: proj.status === 'COMPLETED' ? '#4ade80' : proj.status === 'ARCHIVED' ? '#94a3b8' : '#38bdf8',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          border: `1px solid ${proj.status === 'COMPLETED' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(56, 189, 248, 0.4)'}`,
                        }}
                      >
                        {proj.status || 'ACTIVE'}
                      </span>
                    </div>
                    {proj.description && (
                      <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: 13 }}>{proj.description}</p>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleDeleteProject(proj.id)}
                      style={{ fontSize: 11, padding: '4px 8px' }}
                      title="Delete Campaign Record"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Pipeline Progression Slots */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 }}>
                  {/* Slot 1: Character */}
                  <div
                    style={{
                      background: '#090d16',
                      borderRadius: 10,
                      padding: 12,
                      border: char ? '1px solid #1e293b' : '1px dashed #334155',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    {char ? (
                      <>
                        <img
                          src={char.referenceImage || '/api/media/images/priya_portrait.jpg'}
                          alt={char.name}
                          style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, color: '#38bdf8', fontWeight: 700 }}>1. CHARACTER</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {char.name}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', width: '100%' }}>
                        + No Character Linked
                      </div>
                    )}
                  </div>

                  {/* Slot 2: Motion Animation */}
                  <div
                    style={{
                      background: '#090d16',
                      borderRadius: 10,
                      padding: 12,
                      border: anim ? '1px solid #1e293b' : '1px dashed #334155',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    {anim ? (
                      <>
                        <div style={{ width: 44, height: 44, borderRadius: 8, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                          🎬
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>2. MOTION ANIMATION</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {anim.title || `${anim.preset?.toUpperCase()} Motion`}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', width: '100%' }}>
                        + No Motion Linked
                      </div>
                    )}
                  </div>

                  {/* Slot 3: Composed Video */}
                  <div
                    style={{
                      background: '#090d16',
                      borderRadius: 10,
                      padding: 12,
                      border: vid ? '1px solid #1e293b' : '1px dashed #334155',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    {vid ? (
                      <>
                        <img
                          src={vid.thumbnailUrl || vid.videoUrl}
                          alt={vid.title}
                          style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, color: '#10b981', fontWeight: 700 }}>3. BROADCAST VIDEO</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {vid.title}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', width: '100%' }}>
                        + No Video Linked
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Quick Launch Actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #1e293b', paddingTop: 14 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    Pipeline Progress: <b style={{ color: linkedCount === 3 ? '#4ade80' : '#f59e0b' }}>{linkedCount} of 3</b> Deliverables Ready
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    {char && onOpenCharacterInMotion && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => onOpenCharacterInMotion(char.id)}
                        style={{ fontSize: 11, padding: '5px 10px', borderColor: '#f59e0b', color: '#f59e0b' }}
                      >
                        🎬 Animate Character
                      </button>
                    )}
                    {char && anim && onOpenInVideoStudio && (
                      <button
                        type="button"
                        className="btn btn-gold"
                        onClick={() => onOpenInVideoStudio(char.id, anim.id)}
                        style={{ fontSize: 11, padding: '5px 10px' }}
                      >
                        📹 Compose Video
                      </button>
                    )}
                    {onOpenInAssetLibrary && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={onOpenInAssetLibrary}
                        style={{ fontSize: 11, padding: '5px 10px' }}
                      >
                        🗄️ View Media Assets
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 20,
          }}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            style={{
              background: '#0d1322',
              borderRadius: 16,
              maxWidth: 580,
              width: '100%',
              padding: 28,
              border: '1px solid #a855f7',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.8)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: '#f8fafc' }}>Create New Campaign Project</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProject} style={{ display: 'grid', gap: 14 }}>
              <div>
                <label>Campaign / Project Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Aria Dev - Royal Stage Performance"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label>Brand Association</label>
                <select value={selectedBrandId} onChange={(e) => setSelectedBrandId(Number(e.target.value))}>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Campaign Objective / Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Multi-platform video series targeting theatrical dance music lovers"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div>
                  <label>Link Character</label>
                  <select
                    value={selectedCharId || ''}
                    onChange={(e) => setSelectedCharId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">(None)</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label>Link Motion</label>
                  <select
                    value={selectedAnimId || ''}
                    onChange={(e) => setSelectedAnimId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">(None)</option>
                    {animations.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title || `Animation #${a.id}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label>Link Video</label>
                  <select
                    value={selectedVidId || ''}
                    onChange={(e) => setSelectedVidId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">(None)</option>
                    {videos.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title || `Video #${v.id}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label>Campaign Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="ARCHIVED">ARCHIVED</option>
                </select>
              </div>

              {err && <div style={{ color: '#ef4444', fontSize: 12 }}>{err}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-gold"
                  disabled={saving}
                >
                  {saving ? 'Creating Project...' : 'Save Campaign Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 3. Asset Library View: Unified Media Browser & Exporter
// ==========================================
export function AssetLibraryView({
  onAnimateCharacter,
  onComposeFromAnimation,
}: {
  onAnimateCharacter?: (characterId: number) => void;
  onComposeFromAnimation?: (characterId: number, animationId: number) => void;
}) {
  const [filterType, setFilterType] = useState<'all' | 'portrait' | 'animation' | 'video'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [characters, setCharacters] = useState<any[]>([]);
  const [animations, setAnimations] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeItemDetail, setActiveItemDetail] = useState<any | null>(null);

  const loadAssets = () => {
    setLoading(true);
    Promise.all([
      api('GET', '/characters').catch(() => []),
      api('GET', '/motion/animations').then((r) => r.animations || []).catch(() => []),
      api('GET', '/videos').then((r) => r.videos || []).catch(() => []),
    ]).then(([c, a, v]) => {
      setCharacters(Array.isArray(c) ? c : []);
      setAnimations(Array.isArray(a) ? a : []);
      setVideos(Array.isArray(v) ? v : []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { loadAssets(); }, []);

  // Normalize assets into unified items
  const unifiedAssets = [
    ...characters.map((c) => ({
      kind: 'portrait' as const,
      id: c.id,
      title: c.name,
      description: c.description || c.appearance || 'Persistent Character Portrait',
      mediaUrl: c.referenceImage || '/api/media/images/priya_portrait.jpg',
      thumbUrl: c.referenceImage || '/api/media/images/priya_portrait.jpg',
      aspectRatio: '3:4',
      resolution: '768x1024',
      durationSec: null,
      fileSize: null,
      sha256: null,
      createdAt: c.createdAt,
      raw: c,
    })),
    ...animations.map((a) => ({
      kind: 'animation' as const,
      id: a.id,
      title: a.title || `${a.preset?.toUpperCase()} Motion`,
      description: a.description || `Kinematic articulated ${a.preset} animation`,
      mediaUrl: a.videoUrl,
      thumbUrl: a.thumbnailUrl || a.videoUrl,
      aspectRatio: '3:4',
      resolution: `${a.width}x${a.height}`,
      durationSec: a.durationSec,
      fileSize: a.fileSize,
      sha256: a.sha256,
      createdAt: a.createdAt,
      raw: a,
    })),
    ...videos.map((v) => ({
      kind: 'video' as const,
      id: v.id,
      title: v.title,
      description: v.description || `Composed ${v.aspectRatio} Broadcast Video`,
      mediaUrl: v.videoUrl,
      thumbUrl: v.thumbnailUrl || v.videoUrl,
      aspectRatio: v.aspectRatio,
      resolution: v.resolution,
      durationSec: v.duration,
      fileSize: v.fileSize,
      sha256: v.sha256,
      createdAt: v.createdAt,
      raw: v,
    })),
  ];

  // Apply filters
  let filtered = unifiedAssets;
  if (filterType !== 'all') {
    filtered = filtered.filter((item) => item.kind === filterType);
  }
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        (item.raw.preset && item.raw.preset.toLowerCase().includes(q))
    );
  }

  // Apply sort
  if (sortBy === 'newest') {
    filtered.sort((a, b) => b.id - a.id);
  } else if (sortBy === 'oldest') {
    filtered.sort((a, b) => a.id - b.id);
  } else if (sortBy === 'name') {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  }

  const handleDeleteItem = async (item: typeof unifiedAssets[0]) => {
    if (!confirm(`Are you sure you want to permanently delete ${item.kind.toUpperCase()} "${item.title}"?`)) return;
    try {
      if (item.kind === 'portrait') {
        await api('DELETE', `/characters/${item.id}`);
      } else if (item.kind === 'animation') {
        await api('DELETE', `/motion/animations/${item.id}`);
      } else if (item.kind === 'video') {
        await api('DELETE', `/videos/${item.id}`);
      }
      if (activeItemDetail?.id === item.id && activeItemDetail?.kind === item.kind) {
        setActiveItemDetail(null);
      }
      loadAssets();
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          padding: '24px 28px',
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
          borderRadius: 16,
          border: '1px solid rgba(56, 189, 248, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 28 }}>🗄️</span>
            <h2 style={{ margin: 0, fontSize: 24, color: '#f8fafc' }}>Unified Media Asset Library</h2>
            <span
              style={{
                background: 'rgba(56, 189, 248, 0.2)',
                color: '#38bdf8',
                padding: '2px 10px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid rgba(56, 189, 248, 0.4)',
              }}
            >
              {unifiedAssets.length} Total Assets
            </span>
          </div>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>
            Inspect technical codecs, SHA-256 digests, frame metrics, and export high-resolution media with direct download.
          </p>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 14,
          marginBottom: 24,
          background: '#0f172a',
          padding: '14px 18px',
          borderRadius: 12,
          border: '1px solid #1e293b',
        }}
      >
        {/* Category Pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: `All Assets (${unifiedAssets.length})` },
            { id: 'portrait', label: `🎭 Portraits (${characters.length})` },
            { id: 'animation', label: `🎬 Animations (${animations.length})` },
            { id: 'video', label: `📹 Composed Videos (${videos.length})` },
          ].map((pill) => (
            <button
              key={pill.id}
              type="button"
              className={`btn ${filterType === pill.id ? 'btn-gold' : 'btn-outline'}`}
              style={{ fontSize: 12, padding: '6px 12px', borderRadius: 20 }}
              onClick={() => setFilterType(pill.id as any)}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {/* Search & Sort Controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 220 }}>
            <input
              type="text"
              placeholder="🔍 Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ padding: '7px 12px', fontSize: 12 }}
            />
          </div>

          <div style={{ width: 140 }}>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              style={{ padding: '7px 10px', fontSize: 12 }}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="name">Name (A-Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Assets Grid */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, background: '#0a0f1d' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🗄️</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>No Assets Match Your Criteria</div>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 6 }}>
            {searchQuery ? `No assets matching "${searchQuery}"` : 'Generate characters, animations, or videos to see them listed here.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
          {filtered.map((item) => {
            const isVideo = item.kind === 'video' || item.kind === 'animation';
            return (
              <div
                key={`${item.kind}-${item.id}`}
                className="card"
                style={{
                  background: '#0d1322',
                  border: '1px solid #1e293b',
                  borderRadius: 12,
                  padding: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                }}
              >
                {/* Visual Media Preview */}
                <div
                  style={{
                    position: 'relative',
                    height: 240,
                    background: '#090d16',
                    overflow: 'hidden',
                    cursor: 'pointer',
                  }}
                  onClick={() => setActiveItemDetail(item)}
                >
                  {isVideo ? (
                    <video
                      src={item.mediaUrl}
                      poster={item.thumbUrl}
                      muted
                      loop
                      playsInline
                      onMouseOver={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                      onMouseOut={(e) => (e.target as HTMLVideoElement).pause()}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <img
                      src={item.mediaUrl}
                      alt={item.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
                    />
                  )}

                  {/* Top Badges */}
                  <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6 }}>
                    <span
                      style={{
                        background: item.kind === 'portrait' ? 'rgba(56, 189, 248, 0.85)' : item.kind === 'animation' ? 'rgba(245, 158, 11, 0.85)' : 'rgba(16, 185, 129, 0.85)',
                        color: '#000',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {item.kind}
                    </span>
                    {item.aspectRatio && (
                      <span style={{ background: 'rgba(15, 23, 42, 0.8)', color: '#f8fafc', padding: '2px 6px', borderRadius: 4, fontSize: 10 }}>
                        {item.aspectRatio}
                      </span>
                    )}
                  </div>

                  {item.durationSec && (
                    <div style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(0, 0, 0, 0.8)', color: '#f8fafc', padding: '2px 6px', borderRadius: 4, fontSize: 10 }}>
                      ⏱ {item.durationSec}s
                    </div>
                  )}
                </div>

                {/* Card Content & Details */}
                <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <h4 style={{ margin: 0, fontSize: 15, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.title}
                  </h4>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    {item.resolution} • {item.createdAt?.slice(0, 10)}
                    {item.fileSize ? ` • ${Math.round(item.fileSize / 1024)} KB` : ''}
                  </div>

                  {/* Action Buttons */}
                  <div style={{ marginTop: 'auto', paddingTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setActiveItemDetail(item)}
                      style={{ flex: 1, padding: '5px 8px', fontSize: 11 }}
                    >
                      🔍 Dossier
                    </button>
                    <button
                      type="button"
                      className="btn btn-gold"
                      onClick={() => triggerDownload(item.mediaUrl, `${item.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.${isVideo ? 'mp4' : 'png'}`)}
                      style={{ padding: '5px 10px', fontSize: 11 }}
                      title="Download Asset File"
                    >
                      ⬇
                    </button>
                    {item.kind === 'portrait' && onAnimateCharacter && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => onAnimateCharacter(item.id)}
                        style={{ padding: '5px 8px', fontSize: 11, borderColor: '#f59e0b', color: '#f59e0b' }}
                        title="Animate this character in Motion Studio"
                      >
                        🎬
                      </button>
                    )}
                    {item.kind === 'animation' && onComposeFromAnimation && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => onComposeFromAnimation(item.raw.characterId, item.id)}
                        style={{ padding: '5px 8px', fontSize: 11, borderColor: '#10b981', color: '#10b981' }}
                        title="Compose broadcast video from this animation"
                      >
                        📹
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleDeleteItem(item)}
                      style={{ padding: '5px 8px', fontSize: 11 }}
                      title="Delete Asset"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Asset Dossier Inspection Modal */}
      {activeItemDetail && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.88)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 20,
          }}
          onClick={() => setActiveItemDetail(null)}
        >
          <div
            style={{
              background: '#0d1322',
              borderRadius: 16,
              maxWidth: 720,
              width: '100%',
              padding: 28,
              border: '1px solid #38bdf8',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.8)',
              maxHeight: '92vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <span
                  style={{
                    background: 'rgba(56, 189, 248, 0.2)',
                    color: '#38bdf8',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {activeItemDetail.kind}
                </span>
                <h3 style={{ margin: '4px 0 0', fontSize: 20, color: '#f8fafc' }}>{activeItemDetail.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveItemDetail(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Media Player */}
            <div style={{ background: '#090d16', borderRadius: 12, overflow: 'hidden', marginBottom: 18, display: 'flex', justifyContent: 'center' }}>
              {activeItemDetail.kind === 'portrait' ? (
                <img
                  src={activeItemDetail.mediaUrl}
                  alt={activeItemDetail.title}
                  style={{ maxHeight: 420, maxWidth: '100%', objectFit: 'contain' }}
                />
              ) : (
                <video
                  src={activeItemDetail.mediaUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  style={{ maxHeight: 420, maxWidth: '100%' }}
                />
              )}
            </div>

            {/* Technical Metadata Table */}
            <div style={{ background: '#0f172a', borderRadius: 10, padding: 14, marginBottom: 18, border: '1px solid #1e293b' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8 }}>
                Technical Asset Specifications
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: 12 }}>
                <div>
                  <div style={{ color: '#64748b' }}>RESOLUTION</div>
                  <div style={{ fontWeight: 700, color: '#f8fafc' }}>{activeItemDetail.resolution}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>ASPECT RATIO</div>
                  <div style={{ fontWeight: 700, color: '#f8fafc' }}>{activeItemDetail.aspectRatio}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>DURATION</div>
                  <div style={{ fontWeight: 700, color: '#f8fafc' }}>{activeItemDetail.durationSec ? `${activeItemDetail.durationSec}s` : 'Static Portrait'}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>FILE SIZE</div>
                  <div style={{ fontWeight: 700, color: '#f8fafc' }}>
                    {activeItemDetail.fileSize ? `${Math.round(activeItemDetail.fileSize / 1024)} KB` : 'Local Asset'}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>CREATED DATE</div>
                  <div style={{ fontWeight: 700, color: '#f8fafc' }}>{activeItemDetail.createdAt?.slice(0, 19).replace('T', ' ')}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>AUDIO MIX</div>
                  <div style={{ fontWeight: 700, color: activeItemDetail.kind === 'video' ? '#4ade80' : '#94a3b8' }}>
                    {activeItemDetail.kind === 'video' ? 'AAC Stereo 2-Ch' : 'N/A'}
                  </div>
                </div>
              </div>

              {activeItemDetail.sha256 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #1e293b', fontSize: 10, fontFamily: 'monospace', color: '#94a3b8' }}>
                  <b>SHA-256:</b> {activeItemDetail.sha256}
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              {activeItemDetail.kind === 'portrait' && onAnimateCharacter && (
                <button
                  type="button"
                  className="btn btn-gold"
                  onClick={() => {
                    const charId = activeItemDetail.id;
                    setActiveItemDetail(null);
                    onAnimateCharacter(charId);
                  }}
                  style={{ fontSize: 12 }}
                >
                  🎬 Animate in Motion Studio →
                </button>
              )}
              {activeItemDetail.kind === 'animation' && onComposeFromAnimation && (
                <button
                  type="button"
                  className="btn btn-gold"
                  onClick={() => {
                    const charId = activeItemDetail.raw.characterId;
                    const animId = activeItemDetail.id;
                    setActiveItemDetail(null);
                    onComposeFromAnimation(charId, animId);
                  }}
                  style={{ fontSize: 12 }}
                >
                  📹 Compose in Video Studio →
                </button>
              )}
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => triggerDownload(activeItemDetail.mediaUrl, `${activeItemDetail.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.${activeItemDetail.kind === 'portrait' ? 'png' : 'mp4'}`)}
                style={{ fontSize: 12 }}
              >
                ⬇ Download Media File
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setActiveItemDetail(null)}
                style={{ fontSize: 12 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

