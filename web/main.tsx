import { useEffect, useState, useRef, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';

type Row = Record<string, any>;

export const cleanErrorText = (raw: string, status?: number): string => {
  const text = (raw || '').trim();

  // Backend server offline / connection refused
  if (
    text.includes('ECONNREFUSED') ||
    text.includes('connect ECONNREFUSED 127.0.0.1:4000') ||
    text.includes('Failed to fetch') ||
    text.includes('Load failed') ||
    text.includes('NetworkError')
  ) {
    return 'Backend Studio Server Offline: Cannot connect to http://localhost:4000. Please start the backend in terminal with "npm run dev:server".';
  }

  // Cloudflare Tunnel Expired / 530 / 1016
  if (status === 530 || text.includes('1016') || text.includes('Origin DNS error') || text.includes('HTTP 530')) {
    return 'Cloudflare GPU Tunnel Expired (HTTP 530): The Google Colab GPU session has stopped or disconnected. Re-run your Colab notebook to get a fresh tunnel URL, or click "Switch to 2.5D Mode" to render locally without GPU.';
  }

  // Cloudflare Error 521 (Web server is down)
  if (status === 521 || text.includes('521') || text.includes('Web server is down')) {
    return 'GPU Server Offline (HTTP 521): The Cloudflare tunnel is reachable, but the Python AI worker script is not responding. Please make sure Cell 2 in Colab is running.';
  }

  // 502 / 504 Gateway errors
  if (status === 502 || status === 504 || text.includes('504') || text.includes('Gateway time-out') || text.includes('Bad Gateway')) {
    return `Server Gateway Timeout (HTTP ${status || '502/504'}): The server or GPU worker is busy or restarting. Please verify your runtime.`;
  }

  // If HTML markup was returned by Vite, proxy, or server
  if (text.startsWith('<') || text.toLowerCase().includes('<!doctype html') || text.toLowerCase().includes('<html')) {
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s*\|\s*Cloudflare.*/i, '').trim() : '';
    return `Server Notice (HTTP ${status || 'Error'}): ${title || 'Received HTML response from server'}. Please check your server status.`;
  }

  return text;
};

const api = async (method: string, path: string, body?: unknown) => {
  let r: Response;
  try {
    r = await fetch('/api' + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (netErr: any) {
    throw new Error(
      `Cannot connect to backend Studio server. Please make sure the backend is running ("npm run dev:server" on port 4000). (${netErr.message || 'Network unreachable'})`
    );
  }

  let data: any = null;
  const contentType = r.headers.get('content-type') || '';
  if (r.status !== 204) {
    if (contentType.includes('application/json')) {
      try {
        data = await r.json();
      } catch (_) {
        data = null;
      }
    } else {
      const text = await r.text();
      if (!r.ok) {
        throw new Error(cleanErrorText(text, r.status) || `Server error (${r.status})`);
      }
    }
  }

  if (!r.ok) {
    const rawErr = typeof data?.error === 'string' ? data.error : (data?.message || `Request failed (${r.status})`);
    throw new Error(cleanErrorText(rawErr, r.status));
  }
  return data;
};

export function StudioNotificationCard({
  msg,
  onClear,
  onOpenWalkthrough,
  onClearGpuUrl,
}: {
  msg: string;
  onClear?: () => void;
  onOpenWalkthrough?: () => void;
  onClearGpuUrl?: () => void;
}) {
  if (!msg) return null;

  const isSuccess =
    msg.startsWith('✓') ||
    msg.startsWith('✅') ||
    msg.toLowerCase().includes('generated real neural dance') ||
    msg.toLowerCase().includes('successfully') ||
    msg.toLowerCase().includes('auto-animated') ||
    msg.toLowerCase().includes('complete');
  const isServerOffline =
    msg.includes('Backend Studio Server Offline') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('localhost:4000');
  const isGpuError =
    !isSuccess &&
    !isServerOffline &&
    (msg.includes('Cloudflare') ||
      msg.includes('HTTP 530') ||
      msg.includes('Origin DNS') ||
      msg.includes('Offline') ||
      msg.includes('Expired') ||
      msg.includes('GPU Worker Task Failed') ||
      msg.toLowerCase().includes('failed') ||
      msg.toLowerCase().includes('timed out') ||
      msg.includes('tunnel'));
  const isProgress =
    msg.startsWith('⚡') ||
    msg.startsWith('🎬') ||
    msg.startsWith('📥') ||
    msg.startsWith('🧠') ||
    msg.startsWith('⚙️') ||
    msg.startsWith('🎭');

  const borderColor = isSuccess ? '#10b981' : isServerOffline ? '#ef4444' : isGpuError ? '#f59e0b' : isProgress ? '#6366f1' : '#f59e0b';
  const bgColor = isSuccess ? 'rgba(16, 185, 129, 0.08)' : isServerOffline ? 'rgba(239, 68, 68, 0.12)' : isGpuError ? 'rgba(245, 158, 11, 0.09)' : isProgress ? 'rgba(99, 102, 241, 0.08)' : 'rgba(245, 158, 11, 0.08)';

  // Clean out any accidental raw HTML tags from message
  const displayMsg = msg.replace(/<[^>]*>?/gm, '').trim();

  return (
    <div
      style={{
        marginTop: 12,
        padding: '12px 16px',
        borderRadius: 10,
        background: bgColor,
        border: `1px solid ${borderColor}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>
            {isSuccess ? '✅' : isServerOffline ? '🔌' : isGpuError ? '⚠️' : isProgress ? '⚡' : 'ℹ️'}
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: borderColor, marginBottom: 2 }}>
              {isSuccess
                ? 'Operation Successful'
                : isServerOffline
                ? 'Backend Studio Server Offline'
                : isGpuError
                ? 'GPU Worker Notice'
                : isProgress
                ? 'Studio Pipeline In Progress'
                : 'Studio Notice'}
            </div>
            <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.5 }}>
              {displayMsg}
            </div>
          </div>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 4px',
              lineHeight: 1,
            }}
            title="Dismiss notification"
          >
            ×
          </button>
        )}
      </div>

      {(isGpuError || isServerOffline) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {onOpenWalkthrough && (
            <button
              type="button"
              className="btn btn-gold"
              style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={onOpenWalkthrough}
            >
              📖 GPU Setup Guide &amp; Walkthrough
            </button>
          )}
          {isGpuError && onClearGpuUrl && (
            <button
              type="button"
              className="btn btn-outline"
              style={{ fontSize: 11, padding: '4px 10px', background: '#1c2844' }}
              onClick={onClearGpuUrl}
            >
              ⚡ Switch to 2.5D Mode (Clear Dead URL)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function StudioWalkthroughModal({
  isOpen,
  onClose,
  neuralConfig,
  setNeuralConfig,
  saveNeuralEngineConfig,
  gpuHealth,
  checkGpuHealth,
  clearGpuServerUrl,
}: {
  isOpen: boolean;
  onClose: () => void;
  neuralConfig: any;
  setNeuralConfig: (cfg: any) => void;
  saveNeuralEngineConfig: () => void;
  gpuHealth: any;
  checkGpuHealth: (url?: string) => void;
  clearGpuServerUrl: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'kaggle' | 'colab' | 'modes' | 'troubleshoot'>('kaggle');
  const [copiedKagglePath, setCopiedKagglePath] = useState(false);
  const [copiedNotebookPath, setCopiedNotebookPath] = useState(false);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#0d1322',
          border: '1px solid #23304b',
          borderRadius: 16,
          width: '100%',
          maxWidth: 820,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
          padding: 24,
          color: '#f1f5f9',
        }}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b', paddingBottom: 14, marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 22 }}>🚀</span>
              <h3 style={{ margin: 0, fontSize: 18, color: '#fbbf24' }}>
                Studio Walkthrough: GPU Setup &amp; Automated Video Guide
              </h3>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              Setup guide for Free Kaggle/Colab GPU &amp; complete zero-effort automated video generation.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: '6px 12px', fontSize: 14 }}
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid #1e293b', paddingBottom: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            style={{
              fontSize: 12,
              padding: '6px 14px',
              background: activeTab === 'kaggle' ? '#20beff' : '#1e293b',
              color: activeTab === 'kaggle' ? '#000' : '#f1f5f9',
              fontWeight: 700,
            }}
            onClick={() => setActiveTab('kaggle')}
          >
            ⚡ Free Kaggle GPU (73GB Disk • Recommended)
          </button>
          <button
            type="button"
            className="btn"
            style={{
              fontSize: 12,
              padding: '6px 14px',
              background: activeTab === 'colab' ? '#f59e0b' : '#1e293b',
              color: activeTab === 'colab' ? '#000' : '#f1f5f9',
              fontWeight: 700,
            }}
            onClick={() => setActiveTab('colab')}
          >
            ⚡ Free Colab T4 GPU
          </button>
          <button
            type="button"
            className="btn"
            style={{
              fontSize: 12,
              padding: '6px 14px',
              background: activeTab === 'modes' ? '#6366f1' : '#1e293b',
              color: '#fff',
              fontWeight: 700,
            }}
            onClick={() => setActiveTab('modes')}
          >
            🎬 Do I need to create a video? (Modes)
          </button>
          <button
            type="button"
            className="btn"
            style={{
              fontSize: 12,
              padding: '6px 14px',
              background: activeTab === 'troubleshoot' ? '#10b981' : '#1e293b',
              color: '#fff',
              fontWeight: 700,
            }}
            onClick={() => setActiveTab('troubleshoot')}
          >
            🛠️ Troubleshooting &amp; HTTP 530 Fix
          </button>
        </div>

        {/* TAB 1: KAGGLE SETUP (RECOMMENDED) */}
        {activeTab === 'kaggle' && (
          <div>
            <div style={{ background: '#0c233c', padding: '12px 16px', borderRadius: 8, marginBottom: 16, borderLeft: '4px solid #20beff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b style={{ color: '#20beff', fontSize: 13 }}>💡 Why Kaggle is Recommended over Google Colab:</b>
                <span className="badge" style={{ background: '#20beff22', color: '#38bdf8' }}>73GB Storage • 30h/week</span>
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6, lineHeight: 1.6 }}>
                • <b>Huge 73GB Disk Space:</b> Eliminates Google Colab's "Disk full / No space left on device" errors when downloading 10GB diffusion models.<br />
                • <b>Longer Sessions (up to 12 Hours):</b> Kaggle runs continuously without Colab's aggressive 30-minute idle disconnects.<br />
                • <b>Dual T4 GPUs (T4 x2) or Tesla P100:</b> 100% Free ₹0 tier with 30 hours of free GPU per week.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Step 1 */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ background: '#20beff', color: '#000', fontWeight: 800, width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>1</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>Upload Notebook to Kaggle</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 6px' }}>
                    Go to <b><a href="https://www.kaggle.com/code" target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'underline' }}>kaggle.com/code</a></b> → Click <b>"New Notebook"</b> → In top menu: <b>File → Upload Notebook</b> → Select <code style={{ color: '#6ee7b7' }}>scripts/Auravo_Studio_Dance_Worker_Kaggle.ipynb</code>.
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: 11, padding: '4px 10px', background: '#1c2844' }}
                    onClick={() => {
                      navigator.clipboard.writeText('scripts/Auravo_Studio_Dance_Worker_Kaggle.ipynb');
                      setCopiedKagglePath(true);
                      setTimeout(() => setCopiedKagglePath(false), 2000);
                    }}
                  >
                    {copiedKagglePath ? '✓ Copied path to clipboard!' : '📋 Copy Kaggle Notebook Path'}
                  </button>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ background: '#20beff', color: '#000', fontWeight: 800, width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>2</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>Crucial Kaggle Settings (Right Sidebar)</div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', background: '#101a2f', padding: '8px 12px', borderRadius: 6, marginTop: 4, lineHeight: 1.5, border: '1px dashed #38bdf888' }}>
                    In the right-hand panel under <b>Notebook Options / Settings</b>:<br />
                    • <b>Internet</b>: Toggle to <b style={{ color: '#6ee7b7' }}>Internet On</b> <i>(Required for downloading models &amp; creating tunnel!)</i><br />
                    • <b>Accelerator</b>: Select <b style={{ color: '#38bdf8' }}>GPU T4 x2</b> (or GPU P100)
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ background: '#20beff', color: '#000', fontWeight: 800, width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>3</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>Run CELL 1 &amp; CELL 2 in Kaggle</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    Click the Run button on <b>CELL 1</b> (installs packages) and <b>CELL 2</b> (starts server). When CELL 2 finishes starting, it outputs:
                    <div style={{ marginTop: 4, fontFamily: 'monospace', color: '#93c5fd', background: '#0b1120', padding: '6px 10px', borderRadius: 6 }}>
                      🔗 Public Cloudflare Tunnel URL: https://xxxx-xxxx.trycloudflare.com
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 4 */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ background: '#20beff', color: '#000', fontWeight: 800, width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>4</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>Paste Tunnel URL Below &amp; Test</div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <input
                      type="url"
                      placeholder="https://xxxx-xxxx.trycloudflare.com"
                      value={neuralConfig.gpuServerUrl || ''}
                      onChange={(e) => setNeuralConfig({ ...neuralConfig, gpuServerUrl: e.target.value, apiProvider: 'KAGGLE_GPU' })}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}
                      onClick={() => checkGpuHealth(neuralConfig.gpuServerUrl)}
                      disabled={gpuHealth?.testing || !neuralConfig.gpuServerUrl}
                    >
                      {gpuHealth?.testing ? '🔄 Testing...' : '⚡ Test Connection'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Status and Action bar */}
              {gpuHealth?.connected !== undefined && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    background: gpuHealth.connected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    border: gpuHealth.connected ? '1px solid #10b981' : '1px solid #ef4444',
                    color: gpuHealth.connected ? '#6ee7b7' : '#fca5a5',
                  }}
                >
                  {gpuHealth.connected
                    ? `✓ GPU Worker Online: ${gpuHealth.data?.device || 'Kaggle GPU'} (${gpuHealth.data?.engine || 'Active'})`
                    : `✕ GPU Worker Offline: ${gpuHealth.message || 'Server not reachable'}`}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 14, borderTop: '1px solid #1e293b' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: 12, color: '#fca5a5', borderColor: '#7f1d1d' }}
                  onClick={clearGpuServerUrl}
                >
                  Disconnect GPU / Use Local 2.5D Mode
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-outline" style={{ fontSize: 12 }} onClick={onClose}>
                    Done
                  </button>
                  <button type="button" className="btn btn-gold" style={{ fontSize: 12 }} onClick={saveNeuralEngineConfig}>
                    Save Kaggle URL
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: COLAB SETUP */}
        {activeTab === 'colab' && (
          <div>
            <div style={{ background: '#131e36', padding: '12px 16px', borderRadius: 8, marginBottom: 16, borderLeft: '4px solid #f59e0b' }}>
              <b style={{ color: '#fbbf24', fontSize: 13 }}>💡 Google Colab T4 GPU:</b>
              <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>
                Google provides a 16GB T4 GPU. Note: If Colab throws "Out of disk space / storage full", switch to our Kaggle notebook which has 73GB disk storage!
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ background: '#f59e0b', color: '#000', fontWeight: 800, width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>1</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>Open Worker in Google Colab</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 6px' }}>
                    Open <code style={{ color: '#6ee7b7' }}>scripts/Auravo_Studio_Dance_Worker_T4.ipynb</code> in Google Colab.
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: 11, padding: '4px 10px', background: '#1c2844' }}
                    onClick={() => {
                      navigator.clipboard.writeText('scripts/Auravo_Studio_Dance_Worker_T4.ipynb');
                      setCopiedNotebookPath(true);
                      setTimeout(() => setCopiedNotebookPath(false), 2000);
                    }}
                  >
                    {copiedNotebookPath ? '✓ Copied path to clipboard!' : '📋 Copy Colab Notebook Path'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ background: '#f59e0b', color: '#000', fontWeight: 800, width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>2</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>Set Runtime to T4 GPU</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    Click <b>Runtime → Change runtime type</b>, select <b>T4 GPU</b>, and click Save.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ background: '#f59e0b', color: '#000', fontWeight: 800, width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>3</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>Run Cells to Launch Tunnel</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    Run <b>Cell 1</b> and <b>Cell 2</b>. Copy the generated <code style={{ color: '#93c5fd' }}>https://xxxx.trycloudflare.com</code> URL and paste it in Neural Settings.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DO I NEED TO CREATE A VIDEO? (MODES) */}
        {activeTab === 'modes' && (
          <div>
            <div style={{ background: '#1c1917', border: '1px solid #78350f', padding: '14px 16px', borderRadius: 10, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>🎬</span>
                <h4 style={{ margin: 0, color: '#fbbf24' }}>Do I need to create or shoot a video myself?</h4>
              </div>
              <div style={{ fontSize: 13, color: '#fef3c7', marginTop: 8, lineHeight: 1.6 }}>
                <b>NO! You do NOT need to create, shoot, or record any video.</b><br />
                Auravo Studio is an <b>end-to-end automated platform</b>. It creates the script, story premise, voiceover audio, subtitles, and scene visuals automatically.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
              {/* Option A */}
              <div style={{ background: '#131e36', padding: 14, borderRadius: 10, border: '1px solid #3b82f6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <b style={{ color: '#93c5fd', fontSize: 14 }}>✨ Option A: 100% Automated by AI (Zero Effort - Default)</b>
                  <span className="badge" style={{ background: '#1e3a8a', color: '#bfdbfe' }}>Fully Automated</span>
                </div>
                <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
                  You simply click <b>"⚡ Auto-Animate All 5 Beats in Studio"</b> or <b>"🚀 Render 9:16 Vertical Video"</b>.<br />
                  Studio automatically creates moving video clips for all 5 beats using:
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    <li><b>2.5D Cinematic Master (Local ₹0 - Instant):</b> Generates smooth 30fps Ken Burns camera glides anchored on the character's eye-line with strict 9:16 aspect ratio preservation (zero facial distortion). No GPU needed!</li>
                    <li><b>Neural Dance GPU (via Kaggle or Colab):</b> Automatically synthesizes genuine physical dance moves, spins, mudras, and LivePortrait facial lip-sync onto the character.</li>
                  </ul>
                </div>
              </div>

              {/* Option B */}
              <div style={{ background: '#131e36', padding: 14, borderRadius: 10, border: '1px solid #a855f7' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <b style={{ color: '#d8b4fe', fontSize: 14 }}>🎥 Option B: Custom Video Attachment (Completely Optional)</b>
                  <span className="badge" style={{ background: '#581c87', color: '#e9d5ff' }}>Optional</span>
                </div>
                <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
                  Only if you <i>already have</i> a specific dance clip, TikTok reel, or stock video you want to feature, you can click <b>"🎥 Upload Video"</b> or <b>"🌐 Video URL"</b> on any beat. Studio will automatically loop, trim, and sync it to the music. You never need to use this unless you want custom footage!
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: TROUBLESHOOTING */}
        {activeTab === 'troubleshoot' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: '#131e36', padding: 14, borderRadius: 10, borderLeft: '4px solid #f59e0b' }}>
                <b style={{ color: '#fbbf24', fontSize: 13 }}>⚠️ Why does Cloudflare return "HTTP 530 / Origin DNS Error"?</b>
                <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4, lineHeight: 1.6 }}>
                  Google Colab/Kaggle instances pause after periods of inactivity. Cloudflare’s free <code style={{ color: '#93c5fd' }}>trycloudflare.com</code> tunnels are temporary and shut down when the notebook stops.
                  <br />
                  <b>Quick 10-Second Fix:</b>
                  <br />
                  1. Open your Kaggle/Colab notebook and press <b>Play on CELL 2</b> to get a new URL.
                  <br />
                  2. Paste the new URL in Neural GPU Settings.
                  <br />
                  3. If you don't want to use Kaggle right now, click <b>"Switch to 2.5D Mode"</b> to render immediately without GPU!
                </div>
              </div>

              <div style={{ background: '#131e36', padding: 14, borderRadius: 10, borderLeft: '4px solid #ef4444' }}>
                <b style={{ color: '#fca5a5', fontSize: 13 }}>🔌 Backend Studio Server Offline ("Failed to fetch" or ECONNREFUSED)</b>
                <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4, lineHeight: 1.6 }}>
                  If the frontend cannot communicate with port 4000:
                  <br />
                  • Ensure your backend is running: in your terminal, run <code style={{ color: '#6ee7b7' }}>npm run dev:server</code>.
                  <br />
                  • Ensure Vite frontend is running with <code style={{ color: '#6ee7b7' }}>npm run dev:web</code>.
                </div>
              </div>

              <div style={{ background: '#131e36', padding: 14, borderRadius: 10, borderLeft: '4px solid #10b981' }}>
                <b style={{ color: '#6ee7b7', fontSize: 13 }}>✨ How to get the highest facial quality and smoothness?</b>
                <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4, lineHeight: 1.6 }}>
                  • Use high-resolution vertical portraits (ideally 1080×1920 or centered 896×1200).
                  <br />
                  • Ensure the character's face is centered in the upper third of the photo.
                  <br />
                  • Auravo Studio's new FFmpeg filters supersample at 2160×3840 with anti-aliasing to eliminate pixel shimmer.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


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
  const [activeJob, setActiveJob] = useState<any | null>(null);
  const [msg, setMsg] = useState('');

  // Audio Mode & Song Music state (Pure Song Music vs Voiceover)
  const [audioMode, setAudioMode] = useState<'music_only' | 'narration_and_music'>('music_only');
  const [musicFileName, setMusicFileName] = useState<string>('Sensual Monsoon Hindi BGM (Default)');
  const [musicAssetUrl, setMusicAssetUrl] = useState<string>('');
  const [uploadingMusic, setUploadingMusic] = useState(false);

  // Pre-flight confirmation modals
  const [showRenderConfirm, setShowRenderConfirm] = useState(false);
  const [showAnimateConfirm, setShowAnimateConfirm] = useState(false);

  // Live Task & Cancellation state
  const cancelAnimationRef = useRef<boolean>(false);
  const [animatingTask, setAnimatingTask] = useState<{
    currentBeat: number;
    totalBeats: number;
    beatTitle: string;
    progress: number;
    stage: string;
  } | null>(null);

  const [showExternalTools, setShowExternalTools] = useState(false);

  // Dance Motion Reference Video state (YouTube link or local MP4)
  const [referenceVideoUrl, setReferenceVideoUrl] = useState<string>('');
  const [referenceVideoName, setReferenceVideoName] = useState<string>('');
  const [youtubeDanceUrl, setYoutubeDanceUrl] = useState<string>('');
  const [importingDanceRef, setImportingDanceRef] = useState<boolean>(false);

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
        // Automatically detect and attach active music track
        const musicAsset = d.assets?.find((a: any) => a.type === 'MUSIC');
        if (musicAsset && musicAsset.filePath) {
          const fname = musicAsset.filePath.split('/').pop() || 'Attached Song';
          setMusicFileName(fname);
          setMusicAssetUrl(`/storage/audio/${fname}`);
        } else {
          setMusicFileName('Sensual Monsoon Hindi BGM (Default)');
          setMusicAssetUrl('');
        }

        // Automatically detect and attach active dance reference video
        const refVideoAsset = d.assets?.find((a: any) => a.type === 'REFERENCE_VIDEO');
        if (refVideoAsset && refVideoAsset.filePath) {
          const fname = refVideoAsset.filePath.split('/').pop() || 'Dance Reference Video';
          setReferenceVideoName(fname);
          setReferenceVideoUrl(`/storage/videos/${fname}`);
        } else {
          setReferenceVideoName('');
          setReferenceVideoUrl('');
        }

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

  const startAutoAnimateAll = async () => {
    if (!detail?.scenes || detail.scenes.length === 0) return;
    setShowAnimateConfirm(false);
    cancelAnimationRef.current = false;
    setAnimatingAll(true);

    const scenes = detail.scenes;
    let completedCount = 0;

    for (let i = 0; i < scenes.length; i++) {
      if (cancelAnimationRef.current) {
        setMsg('🛑 Auto-animate stopped by user. Existing beats are preserved.');
        break;
      }

      const sc = scenes[i];
      const beatOrder = sc.sceneOrder || (i + 1);
      const beatTitle = `Beat ${beatOrder}: ${sc.endingType || 'DANCE'}`;
      const progress = Math.round((i / scenes.length) * 100);

      setAnimatingTask({
        currentBeat: i + 1,
        totalBeats: scenes.length,
        beatTitle,
        progress,
        stage: `Diffusing Beat ${beatOrder} of ${scenes.length} on GPU (${sc.visualPrompt?.slice(0, 45) || 'Dance Motion'}...)...`,
      });
      setMsg(`⚡ Studio Auto-Pilot: Synthesizing ${beatTitle} on GPU (~35s)...`);

      try {
        const endpoint = (gpuHealth?.connected)
          ? `/content/${selectedId}/scenes/${sc.id}/neural-dance-generate`
          : `/content/${selectedId}/scenes/${sc.id}/auto-animate`;
        const res = await api('POST', endpoint);
        completedCount++;
        setMsg(`✓ ${beatTitle} generated via ${res.providerUsed || (gpuHealth?.connected ? 'Kaggle GPU' : 'Studio Engine')}!`);
        refreshDetail();
      } catch (err: any) {
        console.warn(`Error animating beat ${beatOrder}:`, err);
        setMsg(`⚠️ Beat ${beatOrder} error: ${err.message}. Continuing to next beat...`);
      }
    }

    setAnimatingTask(null);
    setAnimatingAll(false);
    if (!cancelAnimationRef.current) {
      setMsg(`✓ All ${completedCount} beats animated! Click "Render 9:16 Vertical Video" to assemble.`);
    }
    refreshDetail();
  };

  const cancelAutoAnimate = () => {
    cancelAnimationRef.current = true;
    setMsg('🛑 Cancellation requested. Stopping after current frame...');
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
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [generatingNeuralSceneId, setGeneratingNeuralSceneId] = useState<number | null>(null);
  const [gpuHealth, setGpuHealth] = useState<{ connected?: boolean; message?: string; testing?: boolean; data?: any }>({});

  const clearGpuServerUrl = async () => {
    try {
      const updated = { ...neuralConfig, gpuServerUrl: '' };
      setNeuralConfig(updated);
      await api('POST', '/settings/neural-dance-config', updated);
      setGpuHealth({ connected: false, message: 'Local 2.5D Mode active (No GPU configured)' });
      setMsg('✓ Switched to 2.5D Mode. Video will render locally with zero face distortion.');
    } catch (e: any) {
      setMsg(`Error clearing GPU URL: ${e.message}`);
    }
  };

  const checkGpuHealth = async (testUrl?: string) => {
    setGpuHealth(h => ({ ...h, testing: true }));
    try {
      const urlToTest = testUrl ?? neuralConfig.gpuServerUrl ?? '';
      const endpoint = urlToTest ? `/settings/neural-dance-health?url=${encodeURIComponent(urlToTest)}` : '/settings/neural-dance-health';
      const res = await api('GET', endpoint);
      setGpuHealth({ ...res, testing: false });
    } catch (e: any) {
      setGpuHealth({ connected: false, message: e.message, testing: false });
    }
  };

  useEffect(() => {
    api('GET', '/settings/neural-dance-config').then((cfg) => {
      setNeuralConfig(cfg);
      if (cfg?.gpuServerUrl) {
        checkGpuHealth(cfg.gpuServerUrl);
      }
    }).catch(() => {});
  }, []);

  const saveNeuralEngineConfig = async () => {
    try {
      await api('POST', '/settings/neural-dance-config', neuralConfig);
      setMsg('✓ Neural AI Dance Engine settings saved!');
      checkGpuHealth();
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

  const [animatingLivePortraitSceneId, setAnimatingLivePortraitSceneId] = useState<number | null>(null);

  const generateLivePortraitForScene = async (sceneId: number) => {
    try {
      setAnimatingLivePortraitSceneId(sceneId);
      setMsg('🎭 Generating LivePortrait facial expression, eye contact & head motion...');
      await api('POST', `/content/${selectedId}/scenes/${sceneId}/liveportrait-generate`);
      setMsg(`✓ Real facial animation & expression generated for Beat! Click "Render 9:16 Vertical Video" to assemble.`);
      refreshDetail();
    } catch (e: any) {
      setMsg(`LivePortrait Error: ${e.message}`);
    } finally {
      setAnimatingLivePortraitSceneId(null);
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

  const uploadCustomMusic = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedId) return;
    try {
      setUploadingMusic(true);
      setMsg('🎵 Uploading Hindi song track into Studio...');
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await api('POST', `/content/${selectedId}/attach-music`, {
            audioBase64: reader.result as string,
            filename: file.name,
          });
          setMusicFileName(file.name);
          setMusicAssetUrl(`/storage/audio/${file.name}`);
          setAudioMode('music_only');
          setMsg(`✓ Hindi Song "${file.name}" attached as soundtrack! Master will render with 100% music and zero narration.`);
          refreshDetail();
        } catch (err: any) {
          setMsg(`Music upload failed: ${err.message}`);
        } finally {
          setUploadingMusic(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setMsg(`Upload error: ${err.message}`);
      setUploadingMusic(false);
    }
  };

  const handleAttachDanceReference = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!youtubeDanceUrl.trim() || !selectedId) return;
    setImportingDanceRef(true);
    setMsg('📥 Downloading YouTube dance video via yt-dlp & auto-slicing across all 5 beats...');
    try {
      const res = await api('POST', `/content/${selectedId}/attach-dance-reference`, {
        youtubeUrl: youtubeDanceUrl.trim(),
        autoSlice: true,
      });
      setMsg(`✓ Dance reference synced! ${res.slicedCount || 5} scene beats populated with real choreography motion!`);
      setYoutubeDanceUrl('');
      refreshDetail();
    } catch (err: any) {
      setMsg(`Error importing YouTube reference: ${err.message}`);
    } finally {
      setImportingDanceRef(false);
    }
  };

  const uploadReferenceDanceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedId) return;
    setImportingDanceRef(true);
    setMsg('📁 Uploading dance reference video & auto-slicing across all 5 beats...');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const b64 = reader.result as string;
        const res = await api('POST', `/content/${selectedId}/attach-dance-reference`, {
          videoBase64: b64,
          filename: file.name,
          autoSlice: true,
        });
        setMsg(`✓ Dance reference uploaded! ${res.slicedCount || 5} beats populated with real choreography motion!`);
        refreshDetail();
      } catch (err: any) {
        setMsg(`Error uploading dance reference: ${err.message}`);
      } finally {
        setImportingDanceRef(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const removeDanceReference = async () => {
    if (!selectedId) return;
    try {
      await api('DELETE', `/content/${selectedId}/dance-reference`);
      setReferenceVideoUrl('');
      setReferenceVideoName('');
      setMsg('Dance reference removed. You can generate or attach a new one.');
      refreshDetail();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    }
  };

  const applyDanceReferenceToAll = async () => {
    if (!selectedId) return;
    try {
      setMsg('💃 Applying authentic dance reference video slices to all 5 scene beats...');
      const res = await api('POST', `/content/${selectedId}/apply-dance-reference`);
      setMsg(`✓ ${res.message || 'Real dance reference applied across all beats!'} Click "Render 9:16 Vertical Video" to assemble.`);
      refreshDetail();
    } catch (e: any) {
      setMsg(`Error applying dance reference: ${e.message}`);
    }
  };

  const useReferenceSliceForBeat = async (sceneId: number) => {
    try {
      setMsg('💃 Applying real choreography dance slice to this beat...');
      const res = await api('POST', `/content/${selectedId}/scenes/${sceneId}/use-reference-slice`);
      setMsg(`✓ ${res.message || 'Applied real dance clip to beat!'}`);
      refreshDetail();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    }
  };

  const clearSceneVideo = async (sceneId: number) => {
    try {
      await api('DELETE', `/content/${selectedId}/scenes/${sceneId}/video`);
      setMsg('✓ Clip cleared. Beat will use smooth cinematic camera motion.');
      refreshDetail();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    }
  };

  const cancelRenderJob = async () => {
    if (!activeJob?.id) {
      setRendering(false);
      return;
    }
    try {
      await api('DELETE', `/jobs/${activeJob.id}`);
      setActiveJob((j: any) => (j ? { ...j, status: 'CANCELLED', currentStage: 'Render cancelled by user' } : null));
      setRendering(false);
      setMsg('🛑 Master video render job cancelled.');
    } catch (e: any) {
      setMsg(`Failed to cancel render: ${e.message}`);
    }
  };

  const renderVideo = () => {
    setShowRenderConfirm(true);
  };

  const executeRenderVideo = async () => {
    if (!selectedId) return;
    setShowRenderConfirm(false);
    setRendering(true);
    setMsg(
      audioMode === 'music_only'
        ? `🎬 Launching master render with Pure Song Music ("${musicFileName}")...`
        : '🎬 Launching master render with Spoken Narration + Music...'
    );
    try {
      const res = await api('POST', `/content/${selectedId}/render-async`, { audioMode });
      if (res?.jobId) {
        setActiveJob({
          id: res.jobId,
          status: res.status || 'QUEUED',
          progress: res.progress || 0,
          currentStage: res.currentStage || 'Job queued in background...',
        });

        const interval = setInterval(async () => {
          try {
            const job = await api('GET', `/jobs/${res.jobId}`);
            setActiveJob(job);
            if (job.status === 'COMPLETED') {
              clearInterval(interval);
              setRendering(false);
              setLastRenderTime(Date.now());
              setMsg('✓ Master Video rendered successfully!');
              refreshDetail();
            } else if (job.status === 'FAILED' || job.status === 'CANCELLED') {
              clearInterval(interval);
              setRendering(false);
              setMsg(job.status === 'CANCELLED' ? '🛑 Render cancelled by user.' : `Render error: ${job.error || 'Job failed'}`);
            }
          } catch {
            // Keep polling
          }
        }, 1200);
      } else {
        await api('POST', `/content/${selectedId}/render`, { audioMode });
        setLastRenderTime(Date.now());
        setMsg('✓ Master Video rendered successfully with dancing moves & music!');
        refreshDetail();
        setRendering(false);
      }
    } catch (e: any) {
      setMsg(`Render error: ${e.message}`);
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

            {/* 🎬 UNIFIED VIDEO PRODUCTION CONTROL CENTER */}
            <div className="card" style={{
              background: 'linear-gradient(180deg, #0d1527 0%, #090e1a 100%)',
              border: '1px solid #3b82f677',
              borderRadius: 14,
              padding: 18,
              marginBottom: 16,
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ margin: 0, color: '#f8fafc', fontSize: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                    🎬 Video Production Control Center
                  </h3>
                  <span className="badge" style={{
                    background: gpuHealth?.connected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                    color: gpuHealth?.connected ? '#6ee7b7' : '#fde047',
                    border: gpuHealth?.connected ? '1px solid #10b981' : '1px solid #eab308',
                    fontSize: 11
                  }}>
                    {gpuHealth?.connected ? '🟢 Kaggle GPU Ready' : '⚡ Local 2.5D Mode'}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: 11, padding: '5px 10px', borderColor: '#38bdf8', color: '#38bdf8', background: showExternalTools ? '#1e293b' : 'transparent' }}
                    onClick={() => setShowExternalTools(!showExternalTools)}
                  >
                    ✨ External AI Tools {showExternalTools ? '▲' : '▼'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: 11, padding: '5px 10px', background: '#1c2844' }}
                    onClick={() => setShowNeuralSettings(!showNeuralSettings)}
                  >
                    ⚙️ GPU Config
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: 11, padding: '5px 10px', borderColor: '#f59e0b', color: '#fbbf24', background: '#1e293b' }}
                    onClick={() => setShowWalkthrough(true)}
                  >
                    📖 Kaggle Guide
                  </button>
                </div>
              </div>

              {/* Free External AI Dance Tools Drawer */}
              {showExternalTools && (
                <div style={{ marginTop: 10, marginBottom: 14, padding: 14, background: '#090e1a', borderRadius: 8, border: '1px solid #38bdf855' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                    <h4 style={{ margin: 0, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
                      ✨ Free AI Dance Video &amp; Expression Tools
                    </h4>
                    <span className="badge" style={{ background: '#1e293b', color: '#6ee7b7', fontSize: 10 }}>₹0 Free Tier Ready</span>
                  </div>
                  <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 10px 0' }}>
                    Generate full-body dance moves, lip sync &amp; expressive choreography using external free tools, then attach directly to your scene beats:
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#131e36', padding: '10px 14px', borderRadius: 8, border: '1px solid #1e293b', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#93c5fd' }}>
                        📥 Step 1: Download AI Dancer Face Model
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        Download the character face visual to upload into Viggle AI, Kling AI or LivePortrait.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-gold"
                      style={{ fontSize: 11, padding: '5px 12px' }}
                      onClick={() => {
                        const firstImg = detail?.assets?.find((a: Row) => a.type === 'IMAGE');
                        const filename = firstImg?.filePath ? firstImg.filePath.split('/').pop() : 'rhea_bralette_portrait.jpg';
                        const imgUrl = firstImg?.filePath ? `/storage/images/${filename}` : `/api/media/images/rhea_bralette_portrait.jpg`;
                        triggerDownload(imgUrl, `${(detail?.title || 'Dancer').replace(/[^a-zA-Z0-9]/g, '_')}_Face_Model.jpg`);
                      }}
                    >
                      📥 Download Face Model
                    </button>
                  </div>

                  <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 600, marginBottom: 6 }}>
                    🚀 Step 2: Open Free AI Generators:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    <a href="https://klingai.com" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none', background: '#1e293b', borderColor: '#f59e0b', color: '#fbbf24' }}>
                      🚀 Kling AI (66 Free Credits/Day)
                    </a>
                    <a href="https://lumalabs.ai/dream-machine" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none', background: '#1e293b' }}>
                      🎥 Luma Dream Machine
                    </a>
                    <a href="https://haiper.ai" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none', background: '#1e293b' }}>
                      ✨ Haiper AI
                    </a>
                    <a href="https://pika.art" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none', background: '#1e293b' }}>
                      🎬 Pika Labs
                    </a>
                    <a href="https://huggingface.co/spaces/KwaiVGI/LivePortrait" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none', background: '#1e293b', borderColor: '#38bdf8', color: '#38bdf8' }}>
                      🎭 LivePortrait HF (ZeroGPU)
                    </a>
                    <a href="https://viggle.ai" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none', background: '#1e293b' }}>
                      💃 Viggle AI (Pose Animate)
                    </a>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>
                    💡 Tip: Once generated, click "🎥 Upload Video" or "🔗 Paste Link" on any beat below to instantly attach your video.
                  </div>
                </div>
              )}

              {/* Neural AI Dance Engine Settings Modal/Box */}
              {showNeuralSettings && (
                <div style={{ marginTop: 10, marginBottom: 14, padding: 14, background: '#090e1a', borderRadius: 8, border: '1px solid var(--accent)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h4 style={{ margin: 0, color: '#a5b4fc' }}>🧠 Neural AI Dance Model Configuration</h4>
                    <span className="badge" style={{ background: '#1e293b', color: '#6ee7b7' }}>Free Kaggle / Colab GPU</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px 0' }}>
                    Connect free Kaggle (73GB disk space) or Google Colab T4 GPU for genuine physical dance movement:
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label>AI Model Provider</label>
                      <select
                        value={neuralConfig.apiProvider || 'KAGGLE_GPU'}
                        onChange={(e) => setNeuralConfig({ ...neuralConfig, apiProvider: e.target.value })}
                      >
                        <option value="KAGGLE_GPU">Kaggle Free GPU (Recommended: 73GB Disk, 30 hrs/wk, 2x T4 GPUs)</option>
                        <option value="COLAB_GPU">Google Colab T4 GPU (Free ₹0 - SVD XT / MimicMotion)</option>
                        <option value="REPLICATE">Replicate Cloud API (MimicMotion / AnimateAnyone)</option>
                        <option value="FAL_AI">Fal.ai Cloud API (LivePortrait / Video Diffusion)</option>
                      </select>
                    </div>

                    {neuralConfig.apiProvider === 'COLAB_GPU' || neuralConfig.apiProvider === 'KAGGLE_GPU' ? (
                      <div>
                        <label>{neuralConfig.apiProvider === 'KAGGLE_GPU' ? 'Kaggle Cloudflare Tunnel URL' : 'Colab Cloudflare Tunnel URL'}</label>
                        <input
                          type="url"
                          placeholder="e.g. https://xxxx.trycloudflare.com"
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

                  {gpuHealth?.connected !== undefined && (
                    <div style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      marginBottom: 10,
                      background: gpuHealth.connected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      border: gpuHealth.connected ? '1px solid #10b981' : '1px solid #ef4444',
                      color: gpuHealth.connected ? '#6ee7b7' : '#fca5a5'
                    }}>
                      {gpuHealth.connected
                        ? `✓ GPU Worker Online: ${gpuHealth.data?.device || 'T4 GPU'} (${gpuHealth.data?.engine || 'Stable Video Diffusion XT'})`
                        : `✕ GPU Worker Offline: ${gpuHealth.message || 'Server not reachable'}`}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '4px 12px' }}
                        onClick={() => checkGpuHealth(neuralConfig.gpuServerUrl)}
                        disabled={gpuHealth?.testing || !neuralConfig.gpuServerUrl}
                      >
                        {gpuHealth?.testing ? '🔄 Testing...' : '⚡ Test Connection'}
                      </button>
                      {neuralConfig.gpuServerUrl && (
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '4px 10px', color: '#fca5a5', borderColor: '#7f1d1d' }}
                          onClick={clearGpuServerUrl}
                        >
                          Disconnect / Clear URL
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn btn-outline" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setShowNeuralSettings(false)}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-gold" style={{ fontSize: 11, padding: '4px 14px' }} onClick={saveNeuralEngineConfig}>
                        Save Configuration
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* THREE COLUMNS: STEP 1 (AI CHOREOGRAPHY), STEP 2 (DANCE MOTION REFERENCE - YOUTUBE/UPLOAD), STEP 3 (SOUNDTRACK) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 14 }}>
                {/* STEP 1: AI Dance Choreography */}
                <div style={{ background: '#131e36', borderRadius: 10, padding: 14, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <b style={{ color: '#fbbf24', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        💃 Step 1: AI Choreography
                      </b>
                      <span className="badge" style={{ background: '#1e293b', color: '#93c5fd', fontSize: 10 }}>5 Multi-Angles</span>
                    </div>
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 10px 0' }}>
                      Generates 5 distinct camera angles (medium, close-up, swirl, freeze, outro) on Kaggle GPU with 100% facial proportion lock.
                    </p>
                  </div>

                  <button
                    type="button"
                    className="btn btn-gold"
                    style={{ width: '100%', fontSize: 12, padding: '10px 14px', fontWeight: 700 }}
                    onClick={() => setShowAnimateConfirm(true)}
                    disabled={animatingAll || rendering}
                  >
                    {animatingAll
                      ? (animatingTask ? `⚡ Beat ${animatingTask.currentBeat}/${animatingTask.totalBeats}...` : '⚡ Animating All Beats...')
                      : '⚡ Auto-Animate All 5 Beats'}
                  </button>
                </div>

                {/* STEP 2: Dance Motion Reference (YouTube or File Upload) */}
                <div style={{ background: '#131e36', borderRadius: 10, padding: 14, border: '1px solid #38bdf844', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <b style={{ color: '#38bdf8', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        📹 Step 2: Dance Reference (YouTube)
                      </b>
                      {referenceVideoUrl ? (
                        <span className="badge" style={{ background: '#10b981', color: '#000', fontSize: 10, fontWeight: 'bold' }}>
                          ✓ Reference Synced
                        </span>
                      ) : (
                        <span className="badge" style={{ background: '#1e293b', color: '#cbd5e1', fontSize: 10 }}>
                          Optional
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 8px 0' }}>
                      Paste a YouTube Short/Reel link or upload a dance video. Studio auto-downloads &amp; slices the moves across all 5 beats!
                    </p>

                    <form onSubmit={handleAttachDanceReference} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      <input
                        type="url"
                        placeholder="https://youtube.com/shorts/... or video link"
                        value={youtubeDanceUrl}
                        onChange={(e) => setYoutubeDanceUrl(e.target.value)}
                        style={{ fontSize: 11, padding: '6px 8px', background: '#090e1a', flex: 1, minWidth: 120 }}
                        disabled={importingDanceRef}
                      />
                      <button
                        type="submit"
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '6px 10px', borderColor: '#38bdf8', color: '#38bdf8', background: '#0c2238', whiteSpace: 'nowrap', fontWeight: 600 }}
                        disabled={importingDanceRef || !youtubeDanceUrl.trim()}
                      >
                        {importingDanceRef ? '⏳ Syncing...' : '⚡ Sync'}
                      </button>
                    </form>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, background: '#090e1a', padding: '6px 10px', borderRadius: 6 }}>
                      <span style={{ fontSize: 11, color: referenceVideoUrl ? '#6ee7b7' : '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }} title={referenceVideoName}>
                        {referenceVideoUrl ? `💃 ${referenceVideoName}` : '📁 Or upload local video'}
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <label
                          className="btn btn-outline"
                          style={{ fontSize: 10, padding: '3px 8px', background: '#1e293b', color: '#6ee7b7', borderColor: '#059669', cursor: 'pointer', margin: 0, whiteSpace: 'nowrap' }}
                        >
                          {importingDanceRef ? '⏳ Uploading...' : 'Upload Video'}
                          <input type="file" accept="video/*,.mp4,.mov,.webm" style={{ display: 'none' }} onChange={uploadReferenceDanceFile} disabled={importingDanceRef} />
                        </label>
                        {referenceVideoUrl && (
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ fontSize: 10, padding: '3px 6px', color: '#fca5a5', borderColor: '#7f1d1d', background: '#450a0a' }}
                            onClick={removeDanceReference}
                            title="Remove reference video"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Separate Dance Reference Video Preview */}
                    {referenceVideoUrl && (
                      <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', background: '#090e1a', border: '1px solid #0284c7' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: '#032b4d', fontSize: 10, color: '#38bdf8' }}>
                          <span style={{ fontWeight: 600 }}>💃 Dance Reference (Separate Guide Player)</span>
                          <span className="badge" style={{ background: '#0284c7', color: '#fff', fontSize: 9 }}>Reference Video</span>
                        </div>
                        <video
                          src={referenceVideoUrl}
                          controls
                          playsInline
                          style={{ width: '100%', maxHeight: 150, objectFit: 'contain', background: '#000' }}
                        />
                        <div style={{ padding: '4px 8px', fontSize: 10, color: '#94a3b8', background: '#071526' }}>
                          ℹ️ Used for choreography &amp; body movements. The Master 9:16 Vertical Preview displays your character.
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* STEP 3: Audio Soundtrack & Music */}
                <div style={{ background: '#131e36', borderRadius: 10, padding: 14, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <b style={{ color: '#93c5fd', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        🎵 Step 3: Soundtrack &amp; Audio
                      </b>
                      <span className="badge" style={{ background: audioMode === 'music_only' ? '#10b981' : '#6366f1', color: '#fff', fontSize: 10 }}>
                        {audioMode === 'music_only' ? '✓ Song Music Only' : '🎙️ Voice + Music'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          flex: 1, fontSize: 11, padding: '6px 8px',
                          background: audioMode === 'music_only' ? '#10b981' : '#1e293b',
                          color: audioMode === 'music_only' ? '#000' : '#cbd5e1',
                          fontWeight: 700,
                          border: audioMode === 'music_only' ? '1px solid #34d399' : '1px solid #334155'
                        }}
                        onClick={() => {
                          setAudioMode('music_only');
                          setMsg('🎵 Switched to Song Music Only. Spoken voiceover narration is disabled.');
                        }}
                      >
                        🎵 Song Music
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          flex: 1, fontSize: 11, padding: '6px 8px',
                          background: audioMode === 'narration_and_music' ? '#6366f1' : '#1e293b',
                          color: '#fff',
                          fontWeight: 700,
                          border: audioMode === 'narration_and_music' ? '1px solid #818cf8' : '1px solid #334155'
                        }}
                        onClick={() => {
                          setAudioMode('narration_and_music');
                          setMsg('🎙️ Switched to Spoken Narration + Background Music.');
                        }}
                      >
                        🎙️ Voice + Music
                      </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, background: '#090e1a', padding: '6px 10px', borderRadius: 6 }}>
                      <span style={{ fontSize: 11, color: '#38bdf8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }} title={musicFileName}>
                        🎧 {musicFileName}
                      </span>
                      <label
                        className="btn btn-outline"
                        style={{ fontSize: 10, padding: '3px 8px', background: '#1e293b', color: '#6ee7b7', borderColor: '#059669', cursor: 'pointer', margin: 0, whiteSpace: 'nowrap' }}
                      >
                        {uploadingMusic ? '⏳ Uploading...' : '📁 Upload MP3'}
                        <input type="file" accept="audio/*,.mp3,.wav,.m4a" style={{ display: 'none' }} onChange={uploadCustomMusic} disabled={uploadingMusic} />
                      </label>
                    </div>

                    {musicAssetUrl && (
                      <div style={{ marginTop: 8 }}>
                        <audio controls src={musicAssetUrl} style={{ width: '100%', height: 28 }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* LIVE RUNNING TASK BANNER */}
              {(animatingAll || generatingNeuralSceneId !== null) && (
                <div style={{ marginTop: 10, marginBottom: 12, padding: 14, background: '#0b1120', border: '1px solid #eab308aa', borderRadius: 10, boxShadow: '0 4px 14px rgba(0,0,0,0.5)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge" style={{ background: '#713f12', color: '#fde047', border: '1px solid #eab308', fontSize: 11 }}>
                        ⚡ {animatingTask ? `BEAT ${animatingTask.currentBeat}/${animatingTask.totalBeats}` : 'SYNTHESIZING DANCE ON GPU'}
                      </span>
                      <span style={{ fontSize: 13, color: '#f8fafc', fontWeight: 'bold' }}>
                        {animatingTask?.beatTitle || (generatingNeuralSceneId ? `Beat #${generatingNeuralSceneId}` : 'All 5 Scene Beats')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 'bold', color: '#fbbf24' }}>
                        {animatingTask?.progress ?? 25}%
                      </span>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '3px 8px', color: '#f87171', borderColor: '#ef4444', background: '#450a0a', cursor: 'pointer' }}
                        onClick={cancelAutoAnimate}
                      >
                        🛑 Cancel Task
                      </button>
                    </div>
                  </div>

                  <div style={{ width: '100%', height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
                    <div
                      style={{
                        width: `${animatingTask?.progress || 20}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #3b82f6, #ec4899, #fbbf24, #10b981)',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>

                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {animatingTask?.stage || 'Synthesizing 30fps physical dance motion & mudras on GPU (~35-45s per beat). Click "Cancel Task" above to stop anytime.'}
                  </div>
                </div>
              )}

              {rendering && activeJob && (
                <div style={{ marginTop: 10, marginBottom: 12, padding: 14, background: '#0b1120', border: '1px solid #3b82f688', borderRadius: 10, boxShadow: '0 4px 14px rgba(0,0,0,0.5)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge" style={{ background: '#1e3a8a', color: '#93c5fd', border: '1px solid #3b82f6', fontSize: 11 }}>
                        {activeJob.status}
                      </span>
                      <span style={{ fontSize: 13, color: '#f8fafc', fontWeight: 'bold' }}>
                        Job #{activeJob.id?.slice(-8)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 'bold', color: '#38bdf8' }}>
                        {activeJob.progress || 0}%
                      </span>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '3px 8px', color: '#f87171', borderColor: '#ef4444', background: '#450a0a', cursor: 'pointer' }}
                        onClick={cancelRenderJob}
                      >
                        🛑 Cancel Render
                      </button>
                    </div>
                  </div>

                  {/* Dynamic Progress Bar */}
                  <div style={{ width: '100%', height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
                    <div
                      style={{
                        width: `${activeJob.progress || 5}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #3b82f6, #60a5fa, #fbbf24)',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>

                  <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                    {activeJob.currentStage || 'Processing neural video pipeline in background...'}
                  </div>
                </div>
              )}

              {/* STEP 3: MASTER RENDER ACTION BUTTON */}
              <button
                className="btn btn-gold"
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  fontSize: 14,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 4px 16px rgba(245, 158, 11, 0.35)',
                  marginTop: 4
                }}
                onClick={renderVideo}
                disabled={rendering || animatingAll}
              >
                {rendering
                  ? '⚙️ Assembling 1080x1920 Master Short in Background...'
                  : '🚀 Render 9:16 Vertical Video (FFmpeg Master)'}
              </button>

              <StudioNotificationCard
                msg={msg}
                onClear={() => setMsg('')}
                onOpenWalkthrough={() => setShowWalkthrough(true)}
                onClearGpuUrl={clearGpuServerUrl}
              />
            </div>

            {/* Scene Beats */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{ margin: 0 }}>5-Scene Story Breakdown (45s Short)</h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {detail.assets?.some((a: Row) => a.type === 'REFERENCE_SLICE') && (
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 11, padding: '4px 10px', background: '#059669', borderColor: '#10b981', color: '#ffffff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={applyDanceReferenceToAll}
                      title="Apply real physical dance video clips from your dance reference across all 5 beats"
                    >
                      💃 Apply Real Dance Moves to All Beats
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: 11, padding: '4px 10px', borderColor: '#f59e0b', color: '#fbbf24' }}
                    onClick={() => setShowAnimateConfirm(true)}
                    disabled={animatingAll || rendering}
                  >
                    {animatingAll ? (animatingTask ? `⚡ Beat ${animatingTask.currentBeat}/${animatingTask.totalBeats}...` : '⚡ Animating...') : '⚡ Auto-Animate All Beats'}
                  </button>
                </div>
              </div>
              {detail.scenes?.map((s: Row) => {
                const sceneVideo = detail.assets?.find((a: Row) => a.sceneId === s.id && a.type === 'SCENE_VIDEO');
                const sceneRefSlice = detail.assets?.find((a: Row) => a.sceneId === s.id && a.type === 'REFERENCE_SLICE');
                const sceneImg = detail.assets?.find((a: Row) => a.sceneId === s.id && a.type === 'IMAGE') || detail.assets?.find((a: Row) => a.type === 'IMAGE');

                return (
                  <div key={s.id} className="scene-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--gold)', fontWeight: 700, fontSize: 13, flexWrap: 'wrap', gap: 6 }}>
                      <span>
                        BEAT {s.sceneOrder} · {s.durationSec}s{' '}
                        {sceneVideo ? (
                          <span
                            style={{
                              color: sceneVideo.provider?.includes('DanceReference') ? '#34d399' : '#6ee7b7',
                              fontSize: 11,
                              marginLeft: 6,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: sceneVideo.provider?.includes('DanceReference') ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.15)',
                              border: sceneVideo.provider?.includes('DanceReference') ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(56, 189, 248, 0.3)'
                            }}
                          >
                            {sceneVideo.provider?.includes('DanceReference')
                              ? '💃 Real Dance Video (30 FPS)'
                              : sceneVideo.provider?.includes('LivePortrait')
                              ? '🎭 LivePortrait Face'
                              : sceneVideo.provider?.includes('Neural') || sceneVideo.provider?.includes('Diffusion')
                              ? '🧠 Neural Video'
                              : '🎬 Video Attached'}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: 11, marginLeft: 6 }}>⚡ 30fps Camera Drift</span>
                        )}
                      </span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {sceneRefSlice && !sceneVideo?.provider?.includes('DanceReference') && (
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ fontSize: 11, padding: '3px 8px', background: '#064e3b', borderColor: '#10b981', color: '#6ee7b7' }}
                            title="Use real physical choreography dance moves sliced from attached reference video"
                            onClick={() => useReferenceSliceForBeat(s.id)}
                          >
                            💃 Use Real Dance Move
                          </button>
                        )}
                        {sceneVideo && (
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ fontSize: 11, padding: '3px 8px', color: '#f87171', borderColor: '#ef444466' }}
                            title="Clear attached video clip and revert back to smooth cinematic camera motion"
                            onClick={() => clearSceneVideo(s.id)}
                          >
                            ✕ Clear Clip
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4, background: '#1c2844', borderColor: '#38bdf8', color: '#38bdf8' }}
                          title="Generate real LivePortrait facial expression, eye contact & head movement"
                          onClick={() => generateLivePortraitForScene(s.id)}
                          disabled={animatingLivePortraitSceneId === s.id}
                        >
                          {animatingLivePortraitSceneId === s.id ? '🎭 Animating...' : '🎭 LivePortrait Face'}
                        </button>
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

              {/* End of 5-Scene Story Breakdown */}
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {(() => {
            const hasRealDance = detail?.assets?.some((a: Row) => a.type === 'SCENE_VIDEO' && a.provider?.includes('DanceReference'));
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 6 }}>
                  <h3 style={{ margin: 0 }}>Master 9:16 Vertical Preview</h3>
                  <span
                    className="badge"
                    style={{
                      background: hasRealDance ? 'rgba(16, 185, 129, 0.25)' : gpuHealth?.connected ? 'rgba(56, 189, 248, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                      color: hasRealDance ? '#6ee7b7' : gpuHealth?.connected ? '#7dd3fc' : '#fde047',
                      border: hasRealDance ? '1px solid rgba(16, 185, 129, 0.5)' : gpuHealth?.connected ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(234, 179, 8, 0.4)',
                      fontSize: 10,
                      padding: '2px 8px'
                    }}
                  >
                    {hasRealDance ? '💃 Real Dance Video (30 FPS)' : gpuHealth?.connected ? '🟢 Neural Dance GPU' : '⚡ 30fps Cinematic Glides (Aspect-Preserved)'}
                  </span>
                </div>

                <div style={{
                  margin: '4px 0 12px',
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: hasRealDance ? 'rgba(16, 185, 129, 0.12)' : gpuHealth?.connected ? 'rgba(56, 189, 248, 0.1)' : 'rgba(234, 179, 8, 0.08)',
                  border: hasRealDance ? '1px solid rgba(16, 185, 129, 0.35)' : gpuHealth?.connected ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(234, 179, 8, 0.25)',
                  fontSize: 11,
                  color: '#cbd5e1',
                  lineHeight: 1.4,
                  width: '100%',
                  boxSizing: 'border-box'
                }}>
                  {hasRealDance ? (
                    <span>✨ <b>Real Choreography Video Active:</b> Playing authentic 30fps human dance moves, mudras, spins &amp; physical transitions synchronized with the Hindi beat.</span>
                  ) : gpuHealth?.connected ? (
                    <span>✨ <b>Neural Diffusion Active:</b> Rendering genuine AI dance choreography, mudras, spins &amp; facial expressions via Colab T4 GPU.</span>
                  ) : (
                    <span>ℹ️ <b>Smooth Cinematic Mode:</b> Continuous 30fps camera motion anchored at subject eye-line with strict 9:16 aspect ratio preservation (zero facial distortion). Attach a dance reference video or click <b>"🎥 Upload Video"</b> for physical dance moves.</span>
                  )}
                </div>
              </>
            );
          })()}
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

      <StudioWalkthroughModal
        isOpen={showWalkthrough}
        onClose={() => setShowWalkthrough(false)}
        neuralConfig={neuralConfig}
        setNeuralConfig={setNeuralConfig}
        saveNeuralEngineConfig={saveNeuralEngineConfig}
        gpuHealth={gpuHealth}
        checkGpuHealth={checkGpuHealth}
        clearGpuServerUrl={clearGpuServerUrl}
      />

      {/* 1. Master Video Production Pre-Flight Confirmation Modal */}
      {showRenderConfirm && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          backdropFilter: 'blur(8px)'
        }}>
          <div style={{
            background: '#0d1527',
            border: '1px solid #3b82f6',
            borderRadius: 16,
            maxWidth: 640,
            width: '100%',
            padding: 24,
            boxShadow: '0 25px 50px rgba(0,0,0,0.8)',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8, fontSize: 18 }}>
                <span>🎬</span> Production Pre-Flight Checklist
              </h3>
              <button
                type="button"
                onClick={() => setShowRenderConfirm(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px 0' }}>
              Confirm your audio track and visual beats before assembling the final master 9:16 vertical video:
            </p>

            {/* Audio Track Section */}
            <div style={{ background: '#131e36', border: '1px solid #2563eb55', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                <b style={{ color: '#93c5fd', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  🎵 Audio Track &amp; Soundtrack Mode
                </b>
                <span className="badge" style={{ background: audioMode === 'music_only' ? '#10b981' : '#6366f1', color: '#fff', fontSize: 11 }}>
                  {audioMode === 'music_only' ? '✓ Song Music Only (Zero Narration)' : '🎙️ Voice + Music'}
                </span>
              </div>

              <div style={{ fontSize: 13, color: '#f1f5f9', marginBottom: 6 }}>
                <b>Track:</b> <span style={{ color: '#38bdf8', fontWeight: 600 }}>{musicFileName}</span>
              </div>

              {musicAssetUrl ? (
                <div style={{ marginTop: 8, background: '#090e1a', padding: '10px 12px', borderRadius: 8, border: '1px solid #10b98144' }}>
                  <div style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>▶️</span> <b>Listen to Attached Song:</b>
                  </div>
                  <audio controls src={musicAssetUrl} style={{ width: '100%', height: 34 }} />
                </div>
              ) : (
                <div style={{ fontSize: 11, color: '#fde047', background: 'rgba(234, 179, 8, 0.1)', padding: '8px 12px', borderRadius: 8, marginTop: 6, border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                  ℹ️ No custom music file attached. Default ambient Bollywood track will be mixed. You can upload an MP3 below if you wish.
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label
                  className="btn btn-outline"
                  style={{
                    fontSize: 11,
                    padding: '5px 12px',
                    cursor: 'pointer',
                    background: '#1e293b',
                    color: '#6ee7b7',
                    borderColor: '#059669',
                    margin: 0,
                  }}
                >
                  {uploadingMusic ? '⏳ Uploading...' : '📁 Upload / Replace Song (MP3)'}
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a"
                    style={{ display: 'none' }}
                    onChange={uploadCustomMusic}
                    disabled={uploadingMusic}
                  />
                </label>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>100% volume music mix</span>
              </div>
            </div>

            {/* Visual Choreography Beats */}
            <div style={{ background: '#131e36', border: '1px solid #2563eb55', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <b style={{ color: '#93c5fd', fontSize: 13 }}>
                  💃 Visual Choreography ({detail?.scenes?.length || 5} Beats)
                </b>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>5 Multi-Angle Framings</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                {detail?.scenes?.map((sc: Row, idx: number) => {
                  const hasVideoClip = detail?.assets?.some((a: Row) => a.sceneId === sc.id && a.type === 'SCENE_VIDEO');
                  return (
                    <div key={sc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#090e1a', padding: '6px 10px', borderRadius: 6, fontSize: 12 }}>
                      <div>
                        <span style={{ fontWeight: 'bold', color: '#fbbf24', marginRight: 6 }}>Beat {sc.sceneOrder || idx + 1}:</span>
                        <span style={{ color: '#cbd5e1' }}>{sc.endingType || 'DANCE'}</span>
                      </div>
                      <span className="badge" style={{
                        background: hasVideoClip ? 'rgba(16, 185, 129, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                        color: hasVideoClip ? '#6ee7b7' : '#fde047',
                        border: hasVideoClip ? '1px solid #10b981' : '1px solid #eab308',
                        fontSize: 10
                      }}>
                        {hasVideoClip ? '🟢 AI Video Clip Attached' : '🟡 2.5D Eye-Line Drift'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Output Specs */}
            <div style={{ background: '#090e1a', borderRadius: 10, padding: 12, marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11, color: '#94a3b8' }}>
              <div>📐 <b>Resolution:</b> 1080x1920 (9:16 Vertical)</div>
              <div>⏱️ <b>Duration:</b> ~{detail?.scenes?.reduce((acc: number, s: Row) => acc + (s.durationSec || 8), 0) || 45}s</div>
              <div>🔒 <b>Aspect Ratio:</b> Proportional (Zero Face Stretching)</div>
              <div>⚡ <b>Frame Rate:</b> 30 FPS Master H.264</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowRenderConfirm(false)}
              >
                Cancel / Modify
              </button>
              <button
                type="button"
                className="btn btn-gold"
                style={{ padding: '10px 20px', fontWeight: 700 }}
                onClick={executeRenderVideo}
              >
                🚀 Confirm &amp; Start Master Render
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Auto-Animate All Beats Confirmation Modal */}
      {showAnimateConfirm && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          backdropFilter: 'blur(8px)'
        }}>
          <div style={{
            background: '#0d1527',
            border: '1px solid #eab308',
            borderRadius: 16,
            maxWidth: 640,
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: 24,
            boxShadow: '0 25px 50px rgba(0,0,0,0.8)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8, fontSize: 18 }}>
                <span>⚡</span> Auto-Animate All 5 Beats Confirmation
              </h3>
              <button
                type="button"
                onClick={() => setShowAnimateConfirm(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 14px 0' }}>
              Confirm your character model, dance movement guide, and audio soundtrack before synthesizing 5 multi-angle choreography beats:
            </p>

            {/* Step 1: Target Character Model */}
            <div style={{ background: '#131e36', border: '1px solid #eab30844', borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                <b style={{ color: '#fbbf24', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  👤 Step 1: Target Character Model to Animate
                </b>
                <span className="badge" style={{ background: '#10b981', color: '#000', fontSize: 10, fontWeight: 700 }}>
                  ✓ 100% Facial Consistency Locked
                </span>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 64, height: 80, borderRadius: 8, overflow: 'hidden', border: '2px solid #eab308', flexShrink: 0, background: '#000' }}>
                  <img
                    src="/api/media/images/zara_portrait.jpg"
                    alt="Target Character"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f8fafc' }}>
                    Zara "The Urban Temptress"
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    Glossy black leather &amp; chrome corset top · Sleek high ponytail · Razor-sharp modern stage energy
                  </div>
                  <div style={{ fontSize: 10, color: '#6ee7b7', marginTop: 4 }}>
                    🔒 <b>Facial Identity Lock:</b> Preserved across all 5 beats without face-swapping or distortion.
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Dance Movement & Pose Reference Guide */}
            <div style={{ background: '#131e36', border: '1px solid #38bdf855', borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                <b style={{ color: '#38bdf8', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  📹 Step 2: Dance Motion &amp; Pose Reference (Guide)
                </b>
                {referenceVideoUrl ? (
                  <span className="badge" style={{ background: '#0284c7', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                    ✓ Synced &amp; Sliced across 5 Beats
                  </span>
                ) : (
                  <span className="badge" style={{ background: '#1e293b', color: '#94a3b8', fontSize: 10 }}>
                    Optional Guide
                  </span>
                )}
              </div>

              {referenceVideoUrl ? (
                <div>
                  <div style={{ fontSize: 12, color: '#f1f5f9', marginBottom: 6 }}>
                    <b>Active Motion Guide:</b> <span style={{ color: '#6ee7b7' }}>💃 {referenceVideoName || 'YouTube Dance Reference'}</span>
                  </div>
                  <div style={{ borderRadius: 8, overflow: 'hidden', background: '#090e1a', border: '1px solid #1e293b', marginBottom: 8 }}>
                    <video
                      src={referenceVideoUrl}
                      controls
                      playsInline
                      style={{ width: '100%', maxHeight: 150, objectFit: 'contain', background: '#000' }}
                    />
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                    ✨ <b>Choreography Guide:</b> AI extracts body poses, timing &amp; fluid movements from this reference to animate your character (Zara).
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6 }}>
                    No video reference attached. You can sync a YouTube dance link or proceed with procedural choreography:
                  </div>
                  <form onSubmit={handleAttachDanceReference} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <input
                      type="url"
                      placeholder="https://youtube.com/shorts/... or video link"
                      value={youtubeDanceUrl}
                      onChange={(e) => setYoutubeDanceUrl(e.target.value)}
                      style={{ fontSize: 11, padding: '6px 8px', background: '#090e1a', flex: 1 }}
                      disabled={importingDanceRef}
                    />
                    <button
                      type="submit"
                      className="btn btn-outline"
                      style={{ fontSize: 11, padding: '6px 12px', borderColor: '#38bdf8', color: '#38bdf8', background: '#0c2238', whiteSpace: 'nowrap' }}
                      disabled={importingDanceRef || !youtubeDanceUrl.trim()}
                    >
                      {importingDanceRef ? '⏳ Syncing...' : '⚡ Sync'}
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Step 3: Audio Soundtrack Reference Section */}
            <div style={{ background: '#131e36', border: '1px solid #3b82f666', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                <b style={{ color: '#93c5fd', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  🎵 Step 3: Audio Soundtrack &amp; Rhythm
                </b>
                <span className="badge" style={{ background: audioMode === 'music_only' ? '#10b981' : '#6366f1', color: '#fff', fontSize: 11 }}>
                  {audioMode === 'music_only' ? '✓ Song Music Only (Pure Track)' : '🎙️ Voice + Music'}
                </span>
              </div>

              <div style={{ fontSize: 13, color: '#f1f5f9', marginBottom: 6 }}>
                <b>Active Reference Song:</b> <span style={{ color: '#38bdf8', fontWeight: 600 }}>{musicFileName}</span>
              </div>

              {musicAssetUrl ? (
                <div style={{ marginTop: 8, background: '#090e1a', padding: '10px 12px', borderRadius: 8, border: '1px solid #10b98144' }}>
                  <div style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>▶️</span> <b>Listen to Reference Audio Track:</b>
                  </div>
                  <audio controls src={musicAssetUrl} style={{ width: '100%', height: 34 }} />
                </div>
              ) : (
                <div style={{ fontSize: 11, color: '#fde047', background: 'rgba(234, 179, 8, 0.1)', padding: '8px 12px', borderRadius: 8, marginTop: 6, border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                  ℹ️ Using default Bollywood monsoon soundscape. You can upload your own MP3 below if you want custom audio.
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label
                  className="btn btn-outline"
                  style={{
                    fontSize: 11,
                    padding: '5px 12px',
                    cursor: 'pointer',
                    background: '#1e293b',
                    color: '#6ee7b7',
                    borderColor: '#059669',
                    margin: 0,
                  }}
                >
                  {uploadingMusic ? '⏳ Uploading...' : '📁 Upload / Replace Song (MP3)'}
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a"
                    style={{ display: 'none' }}
                    onChange={uploadCustomMusic}
                    disabled={uploadingMusic}
                  />
                </label>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  ⏱️ 45s Total Runtime · Synchronized to all 5 scene cuts
                </span>
              </div>
            </div>

            <div style={{ background: '#131e36', borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontWeight: 700, color: '#fbbf24', marginBottom: 2 }}>💃 5 Scene Choreography Breakdown:</div>
              <div>🎥 <b>Beat 1:</b> Spotlight Center Stage Medium Shot (Intro eye contact hook)</div>
              <div>👁️ <b>Beat 2:</b> Sensual 1.35x Close-Up (Kohl-lined eyes &amp; mudra hand gestures)</div>
              <div>🌪️ <b>Beat 3:</b> Dynamic Full-Body Climax Swirl (Rapid spin &amp; monsoon silk flow)</div>
              <div>🏛️ <b>Beat 4:</b> Sculpted Theatrical Freeze Arch (Chiaroscuro lighting)</div>
              <div>🌅 <b>Beat 5:</b> Golden Hour Sensual Outro Bow (Gentle head turn &amp; smile)</div>
            </div>

            <div style={{ background: '#090e1a', borderRadius: 10, padding: 12, marginBottom: 18, fontSize: 12, color: '#cbd5e1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span>GPU Acceleration:</span>
                <span className="badge" style={{ background: gpuHealth?.connected ? '#10b981' : '#eab308', color: '#000', fontWeight: 'bold' }}>
                  {gpuHealth?.connected ? '🟢 Kaggle / Colab T4 GPU (Connected)' : '⚡ Local 2.5D Mode'}
                </span>
              </div>
              <div style={{ color: '#94a3b8', fontSize: 11 }}>
                Takes ~35-45s per beat on GPU. You can pause or cancel at any time using the 🛑 Cancel button.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowAnimateConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-gold"
                style={{ padding: '10px 20px', fontWeight: 700 }}
                onClick={startAutoAnimateAll}
              >
                ⚡ Confirm &amp; Start Auto-Animate
              </button>
            </div>
          </div>
        </div>
      )}
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
  const [fullModalArc, setFullModalArc] = useState<any | null>(null);
  const [animatingCharId, setAnimatingCharId] = useState<number | null>(null);
  const [animatedFaceVideo, setAnimatedFaceVideo] = useState<{ name: string; url: string } | null>(null);

  const handleAnimateFace = async (characterId: number, characterName: string) => {
    setAnimatingCharId(characterId);
    setMsg(`✨ LivePortrait AI is synthesizing facial animation for "${characterName}"...`);
    try {
      const res = await api('POST', `/characters/${characterId}/animate-face`, {
        motionPreset: 'natural_speaking',
        durationSec: 4,
      });
      if (res.ok && res.videoUrl) {
        setAnimatedFaceVideo({ name: characterName, url: res.videoUrl });
        setMsg(`✅ Facial animation ready for "${characterName}"!`);
      }
    } catch (err: any) {
      setMsg(`Error generating face animation: ${err.message}`);
    } finally {
      setAnimatingCharId(null);
    }
  };

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
      await api('POST', '/characters/generate-entity', {
        brandId: selectedBrandId,
        name: name.trim(),
        role: `${selectedRegion} Soloist`,
        region: selectedRegion,
        age: Number(age),
        personality: personality.trim(),
        appearance: appearance.trim(),
        clothingStyle: clothingStyle.trim(),
        voiceStyle: voiceStyle.trim(),
        customPrompt: visualPrompt.trim(),
      });
      setMsg(`✨ Custom AI Character Entity "${name}" generated with locked identity tokens and saved to your brand!`);
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 340px))', gap: 24, justifyContent: 'flex-start' }}>
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
                  borderRadius: 12,
                }}
              >
                {/* Visual Face Portrait Header */}
                <div
                  style={{ width: '100%', height: 360, position: 'relative', background: '#0b1120', overflow: 'hidden', cursor: 'zoom-in' }}
                  onClick={() => setFullModalArc(arc)}
                  title="Click to view full uncropped face portrait"
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 60, position: 'absolute', inset: 0, zIndex: 1 }}>
                    {arc.avatarEmoji}
                  </div>
                  {arc.portraitUrl && (
                    <img
                      src={arc.portraitUrl}
                      alt={arc.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', position: 'relative', zIndex: 2, transition: 'transform 0.25s ease' }}
                      onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                    />
                  )}
                  {/* Click to inspect badge */}
                  <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 3, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', padding: '4px 9px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    🔍 View Full
                  </div>
                  <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 3, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.2)' }}>
                    {arc.age} YRS
                  </div>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3, background: 'linear-gradient(to top, rgba(13,19,34,1) 0%, rgba(13,19,34,0.65) 60%, transparent 100%)', padding: '28px 16px 10px' }}>
                    <h4 style={{ margin: 0, fontSize: 18, color: '#f8fafc', textShadow: '0 2px 4px rgba(0,0,0,0.9)' }}>{arc.name}</h4>
                    <div style={{ color: arc.accentColor, fontSize: 12, fontWeight: 'bold', textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>{arc.role}</div>
                  </div>
                </div>

                <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 12, lineHeight: 1.4 }}>
                      "{arc.tagline}"
                    </div>

                    <div style={{ fontSize: 12, display: 'grid', gap: 8 }}>
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
                        title="View & Download 4K face portrait"
                        onClick={() => setFullModalArc(arc)}
                      >
                        🔍 Full Face
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
            {characters.map((c) => {
              const arc = archetypes.find((a: any) => a.name.toLowerCase() === c.name.toLowerCase());
              const portrait = c.referenceImage || arc?.portraitUrl || '/api/media/images/priya_portrait.jpg';
              let tokens: string[] = [];
              try {
                tokens = typeof c.identityTokens === 'string' ? JSON.parse(c.identityTokens) : (c.identityTokens || []);
              } catch (_) {}

              return (
                <div key={c.id} className="card" style={{ background: '#131c31', border: '1px solid var(--card-border)', display: 'flex', gap: 14 }}>
                  <img
                    src={portrait}
                    alt={c.name}
                    style={{ width: 88, height: 124, objectFit: 'cover', objectPosition: 'top center', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <h4 style={{ margin: 0, fontSize: 16 }}>{c.name}</h4>
                          {c.generationModel && (
                            <span style={{ fontSize: 9, background: '#1e293b', color: '#38bdf8', padding: '1px 5px', borderRadius: 4, border: '1px solid #0284c7' }}>
                              {c.generationModel}
                            </span>
                          )}
                        </div>
                        <div style={{ color: 'var(--accent)', fontSize: 12, marginTop: 2 }}>{c.description || 'Virtual Dancer'}</div>
                      </div>
                      <button className="btn btn-danger" style={{ fontSize: 11, padding: '3px 7px' }} onClick={() => deleteCharacter(c.id)}>
                        Remove
                      </button>
                    </div>

                    <div style={{ marginTop: 8, fontSize: 11, display: 'grid', gap: 3, color: '#cbd5e1' }}>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><b>Look:</b> {c.appearance}</div>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><b>Costume:</b> {c.clothingStyle}</div>
                    </div>

                    {tokens.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {tokens.slice(0, 4).map((t, idx) => (
                          <span key={idx} style={{ fontSize: 10, background: '#0f172a', color: '#93c5fd', padding: '1px 5px', borderRadius: 4, border: '1px solid rgba(59,130,246,0.3)' }}>
                            🔒 {t}
                          </span>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4, background: '#131e36', color: '#93c5fd', borderColor: '#3b82f688' }}
                        onClick={() => triggerDownload(portrait, `${c.name.replace(/[^a-zA-Z0-9]/g, '_')}_Face_Model.jpg`)}
                      >
                        📥 Download Portrait
                      </button>
                      <button
                        type="button"
                        className="btn btn-gold"
                        style={{ fontSize: 11, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => handleAnimateFace(c.id, c.name)}
                        disabled={animatingCharId === c.id}
                      >
                        {animatingCharId === c.id ? '⏳ Animating...' : '✨ Animate Face'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* LivePortrait Animated Face Modal */}
      {animatedFaceVideo && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: 20,
          }}
          onClick={() => setAnimatedFaceVideo(null)}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #38bdf8',
              borderRadius: 16,
              padding: 24,
              maxWidth: 420,
              width: '100%',
              textAlign: 'center',
              position: 'relative',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                position: 'absolute',
                top: 14,
                right: 14,
                background: '#1e293b',
                border: 'none',
                color: '#cbd5e1',
                width: 32,
                height: 32,
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: 16,
              }}
              onClick={() => setAnimatedFaceVideo(null)}
            >
              ✕
            </button>
            <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 'bold', letterSpacing: 2, marginBottom: 4 }}>
              LIVEPORTRAIT AI ANIMATION
            </div>
            <h3 style={{ margin: '0 0 16px 0', color: '#f8fafc' }}>{animatedFaceVideo.name}</h3>
            <video
              src={animatedFaceVideo.url}
              autoPlay
              loop
              controls
              playsInline
              style={{ width: '100%', maxHeight: '55vh', borderRadius: 12, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                className="btn btn-outline"
                style={{ fontSize: 12 }}
                onClick={() => triggerDownload(animatedFaceVideo.url, `${animatedFaceVideo.name.replace(/[^a-zA-Z0-9]/g, '_')}_LivePortrait.mp4`)}
              >
                📥 Download MP4 Clip
              </button>
              <button className="btn btn-gold" style={{ fontSize: 12 }} onClick={() => setAnimatedFaceVideo(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Portrait Lightbox Modal */}
      {fullModalArc && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.88)',
            backdropFilter: 'blur(10px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setFullModalArc(null)}
        >
          <div
            style={{
              background: '#0d1322',
              border: `2px solid ${fullModalArc.accentColor || '#38bdf8'}`,
              borderRadius: 16,
              maxWidth: 960,
              maxHeight: '92vh',
              width: '100%',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'row',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.85)',
              position: 'relative',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Full Uncropped Portrait Container */}
            <div style={{ flex: '1 1 52%', background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', maxHeight: '92vh' }}>
              <img
                src={fullModalArc.portraitUrl}
                alt={fullModalArc.name}
                style={{ width: '100%', height: '100%', maxHeight: '92vh', objectFit: 'contain' }}
              />
            </div>

            {/* Side Details Panel */}
            <div style={{ flex: '1 1 48%', padding: 28, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflowY: 'auto', maxHeight: '92vh' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 'bold', color: fullModalArc.accentColor || '#38bdf8', letterSpacing: 1.5 }}>
                      {fullModalArc.regionFlag} {fullModalArc.region?.toUpperCase()}
                    </span>
                    <h2 style={{ margin: '6px 0 4px 0', fontSize: 24, color: '#f8fafc' }}>{fullModalArc.name}</h2>
                    <div style={{ color: fullModalArc.accentColor || '#fbbf24', fontSize: 14, fontWeight: 'bold' }}>{fullModalArc.role}</div>
                  </div>
                  <button
                    className="btn btn-outline"
                    style={{ padding: '6px 12px', fontSize: 16, borderRadius: 8, borderColor: '#475569', color: '#f8fafc' }}
                    onClick={() => setFullModalArc(null)}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ marginTop: 16, padding: '12px 14px', background: '#131e36', borderRadius: 8, fontStyle: 'italic', color: '#cbd5e1', fontSize: 13, borderLeft: `3px solid ${fullModalArc.accentColor || '#38bdf8'}` }}>
                  "{fullModalArc.tagline}"
                </div>

                <div style={{ marginTop: 20, display: 'grid', gap: 12, fontSize: 13 }}>
                  <div>
                    <b style={{ color: '#94a3b8' }}>Age:</b> <span style={{ color: '#f8fafc' }}>{fullModalArc.age} Years</span>
                  </div>
                  <div>
                    <b style={{ color: '#94a3b8' }}>Face & Aesthetics:</b>
                    <div style={{ color: '#e2e8f0', marginTop: 3, lineHeight: 1.4 }}>{fullModalArc.appearance}</div>
                  </div>
                  <div>
                    <b style={{ color: '#94a3b8' }}>Stage Costume:</b>
                    <div style={{ color: '#e2e8f0', marginTop: 3, lineHeight: 1.4 }}>{fullModalArc.clothingStyle}</div>
                  </div>
                  <div>
                    <b style={{ color: '#94a3b8' }}>Stage Personality:</b>
                    <div style={{ color: '#e2e8f0', marginTop: 3, lineHeight: 1.4 }}>{fullModalArc.personality}</div>
                  </div>
                  <div>
                    <b style={{ color: '#94a3b8' }}>Visual Prompt Style:</b>
                    <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3, fontStyle: 'italic', lineHeight: 1.4 }}>{fullModalArc.visualPrompt}</div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-gold"
                  style={{ flex: 1, padding: '12px 16px', fontSize: 13, fontWeight: 'bold' }}
                  onClick={() => triggerDownload(fullModalArc.portraitUrl, `${fullModalArc.name.replace(/[^a-zA-Z0-9]/g, '_')}_Face_Model.jpg`)}
                >
                  📥 Download Full-Res Face Model (.JPG)
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ padding: '12px 18px', fontSize: 13 }}
                  onClick={() => setFullModalArc(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// RAG Choreography & Knowledge Store Studio
// ==========================================
function RAGKnowledgeStudio() {
  const [items, setItems] = useState<any[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [msg, setMsg] = useState('');

  // Add form fields
  const [newCat, setNewCat] = useState<'CHOREOGRAPHY' | 'VIRAL_HOOKS' | 'CHARACTER_CONSISTENCY' | 'SAFETY_POLICY'>('CHOREOGRAPHY');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');

  const loadKnowledge = async () => {
    setLoading(true);
    try {
      if (searchQuery.trim()) {
        const catParam = categoryFilter !== 'ALL' ? `&category=${categoryFilter}` : '';
        const res = await api('GET', `/rag/search?q=${encodeURIComponent(searchQuery.trim())}${catParam}`);
        setItems(res.map((r: any) => r.item));
      } else {
        const catParam = categoryFilter !== 'ALL' ? `?category=${categoryFilter}` : '';
        const res = await api('GET', `/rag/knowledge${catParam}`);
        setItems(res);
      }
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKnowledge();
  }, [categoryFilter, searchQuery]);

  const handleAddKnowledge = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    try {
      const tagsArray = newTags.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      await api('POST', '/rag/knowledge', {
        category: newCat,
        title: newTitle.trim(),
        content: newContent.trim(),
        tags: tagsArray,
      });
      setMsg(`✨ Knowledge item "${newTitle}" added to RAG store!`);
      setShowAddForm(false);
      setNewTitle('');
      setNewContent('');
      setNewTags('');
      loadKnowledge();
    } catch (e: any) {
      setMsg(`Error adding item: ${e.message}`);
    }
  };

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case 'CHOREOGRAPHY': return '#f59e0b';
      case 'VIRAL_HOOKS': return '#d946ef';
      case 'CHARACTER_CONSISTENCY': return '#38bdf8';
      case 'SAFETY_POLICY': return '#10b981';
      default: return '#94a3b8';
    }
  };

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2>📚 Choreography Knowledge Store (Local RAG)</h2>
            <span style={{ fontSize: 11, background: '#1e293b', color: '#38bdf8', padding: '2px 8px', borderRadius: 6, border: '1px solid #0284c7' }}>
              ⚡ LLM Planner Connected
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>
            Curated knowledge base of authentic dance mudras, rhythmic footwork, viral hook formulas, and locked consistency rules retrieved automatically when generating stories.
          </p>
        </div>

        <button className="btn btn-gold" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? '✕ Close Form' : '➕ Add Custom Knowledge'}
        </button>
      </div>

      {msg && <div className="card" style={{ background: '#1e293b' }}>{msg}</div>}

      {showAddForm && (
        <div className="card" style={{ background: '#172033', border: '1px solid var(--accent)' }}>
          <h3 style={{ marginTop: 0 }}>➕ Add Knowledge to RAG Store</h3>
          <form onSubmit={handleAddKnowledge} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <div>
                <label>Category</label>
                <select value={newCat} onChange={(e: any) => setNewCat(e.target.value)}>
                  <option value="CHOREOGRAPHY">💃 CHOREOGRAPHY (Mudras &amp; Footwork)</option>
                  <option value="VIRAL_HOOKS">🚀 VIRAL_HOOKS (Retention Frameworks)</option>
                  <option value="CHARACTER_CONSISTENCY">🔒 CHARACTER_CONSISTENCY (Identity Rules)</option>
                  <option value="SAFETY_POLICY">🛡️ SAFETY_POLICY (Compliance Rules)</option>
                </select>
              </div>
              <div>
                <label>Title</label>
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Pataka Mudra (The Victory Flag)" required />
              </div>
            </div>

            <div>
              <label>Content Description &amp; Visual Prompt Guidelines</label>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Explain the hand gesture, bodily isolation, or hook rhythm and how it should appear in visual prompts..."
                rows={3}
                required
              />
            </div>

            <div>
              <label>Keywords / Tags (Comma-separated)</label>
              <input value={newTags} onChange={(e) => setNewTags(e.target.value)} placeholder="e.g. pataka, mudra, classical, kathak, hand, victory" />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button type="submit" className="btn btn-gold">Save to RAG Knowledge Store</button>
            </div>
          </form>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 Search mudras, footwork, hooks, or consistency rules..."
          style={{ flex: 1, minWidth: 260 }}
        />

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['ALL', 'CHOREOGRAPHY', 'VIRAL_HOOKS', 'CHARACTER_CONSISTENCY', 'SAFETY_POLICY'].map((cat) => (
            <button
              key={cat}
              className={`btn ${categoryFilter === cat ? 'btn-gold' : 'btn-outline'}`}
              style={{ fontSize: 11, padding: '6px 12px' }}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat === 'ALL' ? '🌐 All Knowledge' : cat.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Knowledge Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {items.map((item) => {
          const accentColor = getCategoryColor(item.category);
          const tags = Array.isArray(item.tags) ? item.tags : [];

          return (
            <div
              key={item.id}
              className="card"
              style={{
                background: '#131c31',
                border: '1px solid var(--card-border)',
                borderLeft: `3px solid ${accentColor}`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 'bold', color: accentColor, letterSpacing: 1.2 }}>
                    {item.category.replace('_', ' ')}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>ID #{item.id}</span>
                </div>

                <h4 style={{ margin: '0 0 8px 0', fontSize: 16, color: '#f8fafc' }}>{item.title}</h4>
                <p style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
                  {item.content}
                </p>
              </div>

              {tags.length > 0 && (
                <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {tags.map((t: string, idx: number) => (
                    <span
                      key={idx}
                      style={{
                        fontSize: 10,
                        background: '#0f172a',
                        color: '#93c5fd',
                        padding: '1px 6px',
                        borderRadius: 4,
                        border: '1px solid rgba(59,130,246,0.25)',
                      }}
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
                'Characters',
                'RAG Knowledge Store',
                'Brands',
                'Audience Profiles',
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
            {tab === 'RAG Knowledge Store' && <RAGKnowledgeStudio />}
            {RESOURCES[tab] && <ResourceView key={tab} name={tab} />}
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
