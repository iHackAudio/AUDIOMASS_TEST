/**
 * ihack-ui.js
 * iHack Audio v3 — Review Panel, Toolbar, Settings for AudioMass
 * Requires: ihack-pipeline.js
 * 
 * Provides:
 *   - Floating review panel with cut cards
 *   - Toolbar buttons (Analyze, Settings)
 *   - Settings panel (endpoint, confidence, custom instruction)
 *   - Toast notifications
 */

(function(w) {
    'use strict';

    function getPipeline() {
        return w.IHackPipeline || null;
    }

    function fmtTime(seconds) {
        var m = Math.floor(seconds / 60);
        var s = Math.floor(seconds % 60);
        var ms = Math.floor((seconds % 1) * 1000);
        return m + ':' + s.toString().padStart(2, '0') + '.' + ms.toString().padStart(3, '0');
    }

    // ═══════════════════════════════════════════════════════════
    // UI CREATION
    // ═══════════════════════════════════════════════════════════

    function createUI() {
        injectStyles();
        createSettingsPanel();
        createReviewPanel();
        createToolbarButtons();
        createToastContainer();
    }

    function injectStyles() {
        var css = document.createElement('style');
        css.textContent = `
            /* ── Toolbar ── */
            .ihack-toolbar-btn {
                background: #2a2a4a; color: #4fc3f7; border: 1px solid #4fc3f7;
                padding: 6px 14px; border-radius: 6px; cursor: pointer;
                font-size: 13px; font-weight: 600; margin-left: 8px;
                transition: all 0.2s;
            }
            .ihack-toolbar-btn:hover { background: #4fc3f7; color: #1a1a2e; }
            .ihack-toolbar-btn:disabled { opacity: 0.4; cursor: not-allowed; }

            /* ── Settings Panel ── */
            .ihack-settings {
                position: fixed; top: 60px; right: 20px;
                width: 300px; background: #1a1a2e;
                border: 1px solid #333; border-radius: 12px;
                padding: 18px; z-index: 10000;
                box-shadow: 0 12px 48px rgba(0,0,0,0.6);
                display: none;
            }
            .ihack-settings h4 { margin: 0 0 14px; color: #4fc3f7; font-size: 14px; }
            .ihack-settings label {
                display: block; color: #888; font-size: 11px;
                margin: 12px 0 4px; text-transform: uppercase;
            }
            .ihack-settings input[type="text"],
            .ihack-settings input[type="number"],
            .ihack-settings textarea {
                width: 100%; background: #0f0f23; color: #ccc;
                border: 1px solid #333; border-radius: 5px;
                padding: 7px; font-size: 12px; font-family: monospace;
            }
            .ihack-settings input[type="range"] { width: 100%; }
            .ihack-settings button {
                width: 100%; margin-top: 14px; padding: 9px;
                background: #4fc3f7; color: #1a1a2e; border: none;
                border-radius: 5px; font-weight: bold; cursor: pointer;
            }
            .ihack-settings button:hover { background: #29b6f6; }

            /* ── Review Panel ── */
            .ihack-panel {
                position: fixed; right: 16px; top: 60px;
                width: 380px; max-height: 75vh;
                background: #1a1a2e; border: 1px solid #333;
                border-radius: 12px; z-index: 9999;
                box-shadow: 0 12px 48px rgba(0,0,0,0.6);
                overflow: hidden; display: none;
                flex-direction: column;
            }
            .ihack-panel-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 14px 18px; background: #16213e;
                border-bottom: 1px solid #2a2a4a;
            }
            .ihack-panel-header h3 { margin: 0; font-size: 14px; color: #4fc3f7; }
            .ihack-panel-close {
                background: none; border: none; color: #888;
                font-size: 22px; cursor: pointer; line-height: 1;
            }
            .ihack-panel-close:hover { color: #ff5050; }
            .ihack-panel-stats {
                padding: 10px 18px; font-size: 12px; color: #888;
                border-bottom: 1px solid #222;
            }
            .ihack-panel-stats span { margin-right: 20px; color: #ccc; }
            .ihack-cut-list {
                flex: 1; overflow-y: auto; padding: 10px;
                max-height: 50vh;
            }
            .ihack-empty {
                text-align: center; color: #666;
                padding: 40px 20px; font-size: 13px;
            }

            /* ── Cut Cards ── */
            .ihack-card {
                background: #0f0f23; border: 1px solid #2a2a4a;
                border-radius: 10px; padding: 12px;
                margin-bottom: 10px; transition: all 0.2s;
                animation: ihackIn 0.3s ease;
            }
            .ihack-card:hover { border-color: #4fc3f7; }
            .ihack-card.ihack-applied { opacity: 0.35; border-color: #2a4a2a; }
            .ihack-card.ihack-highlight {
                animation: ihackPulse 1s ease;
                box-shadow: 0 0 16px rgba(79,195,247,0.3);
            }
            @keyframes ihackIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes ihackPulse {
                0%, 100% { box-shadow: 0 0 0 rgba(79,195,247,0); }
                50% { box-shadow: 0 0 16px rgba(79,195,247,0.4); }
            }
            .ihack-card-header {
                display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
            }
            .ihack-badge {
                padding: 2px 8px; border-radius: 4px;
                font-size: 10px; font-weight: bold; text-transform: uppercase;
            }
            .ihack-badge--FILLER_WORD { background: #ff5050; color: #fff; }
            .ihack-badge--LONG_SILENCE { background: #5096ff; color: #fff; }
            .ihack-badge--REDUNDANT_PHRASE { background: #ffc850; color: #000; }
            .ihack-badge--LONG_PAUSE { background: #9650ff; color: #fff; }
            .ihack-badge--BREATH { background: #50c896; color: #fff; }
            .ihack-badge--MISTAKE { background: #ff7850; color: #fff; }
            .ihack-time { font-size: 11px; color: #aaa; font-family: monospace; }
            .ihack-conf { font-size: 11px; color: #4fc3f7; margin-left: auto; }
            .ihack-card-body { font-size: 12px; color: #ccc; line-height: 1.5; }
            .ihack-transcript { color: #aed581; font-style: italic; margin: 4px 0; }
            .ihack-reason { color: #888; font-size: 11px; margin-top: 4px; }
            .ihack-card-actions {
                display: flex; gap: 6px; margin-top: 12px;
            }
            .ihack-card-actions button {
                flex: 1; padding: 7px 0; border: none; border-radius: 6px;
                font-size: 12px; font-weight: 600; cursor: pointer;
                transition: opacity 0.15s;
            }
            .ihack-btn-cut { background: #ff5050; color: #fff; }
            .ihack-btn-keep { background: #4caf50; color: #fff; }
            .ihack-btn-jump { background: #424242; color: #fff; }
            .ihack-card-actions button:hover { opacity: 0.85; }

            .ihack-panel-actions {
                display: flex; gap: 8px; padding: 14px;
                border-top: 1px solid #222; background: #0f0f23;
            }
            .ihack-panel-actions button {
                flex: 1; padding: 10px; border: 1px solid #444;
                background: #1a1a2e; color: #ccc; border-radius: 6px;
                cursor: pointer; font-weight: 600; font-size: 12px;
            }
            .ihack-panel-actions button:hover { background: #2a2a4a; color: #fff; }

            .ihack-status {
                padding: 8px 14px; font-size: 11px; color: #888;
                text-align: center; border-top: 1px solid #222;
            }

            /* ── Toasts ── */
            .ihack-toast-container {
                position: fixed; bottom: 24px; left: 50%;
                transform: translateX(-50%);
                z-index: 10001; display: flex;
                flex-direction: column; gap: 8px;
                pointer-events: none;
            }
            .ihack-toast {
                padding: 12px 28px; border-radius: 8px;
                font-size: 13px; font-weight: 500; color: #fff;
                animation: toastIn 0.3s ease;
                pointer-events: auto;
            }
            .ihack-toast--loading { background: #1565c0; }
            .ihack-toast--success { background: #2e7d32; }
            .ihack-toast--error { background: #c62828; }
            @keyframes toastIn {
                from { transform: translateY(20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(css);
    }

    function createSettingsPanel() {
        var html = `
            <div id="ihack-settings" class="ihack-settings">
                <h4>⚙️ iHack AI Settings</h4>
                <label>Backend URL</label>
                <input type="text" id="ihack-endpoint" value="http://localhost:8000" placeholder="http://localhost:8000">
                <label>Min Confidence</label>
                <input type="range" id="ihack-confidence" min="0.5" max="1" step="0.05" value="0.7">
                <span id="ihack-conf-val" style="color:#4fc3f7;font-size:11px;">0.70</span>
                <label>Custom Instruction</label>
                <textarea id="ihack-instr" rows="3" placeholder="e.g. Focus on filler words, keep technical jargon"></textarea>
                <label><input type="checkbox" id="ihack-auto"> Auto-analyze on load</label>
                <button id="ihack-save-settings">Save Settings</button>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('ihack-confidence').addEventListener('input', function(e) {
            document.getElementById('ihack-conf-val').textContent = parseFloat(e.target.value).toFixed(2);
        });

        document.getElementById('ihack-save-settings').addEventListener('click', function() {
            var pl = getPipeline();
            if (!pl) { showToast('Pipeline not loaded', 'error'); return; }
            pl.setEndpoint(document.getElementById('ihack-endpoint').value);
            pl.setMinConfidence(document.getElementById('ihack-confidence').value);
            pl.setCustomInstruction(document.getElementById('ihack-instr').value);
            localStorage.setItem('ihack_endpoint', document.getElementById('ihack-endpoint').value);
            localStorage.setItem('ihack_min_conf', document.getElementById('ihack-confidence').value);
            localStorage.setItem('ihack_instr', document.getElementById('ihack-instr').value);
            document.getElementById('ihack-settings').style.display = 'none';
            showToast('Settings saved', 'success');
        });
    }

    function createReviewPanel() {
        var html = `
            <div id="ihack-panel" class="ihack-panel">
                <div class="ihack-panel-header">
                    <h3>🤖 AI Cut Review</h3>
                    <button class="ihack-panel-close">&times;</button>
                </div>
                <div class="ihack-panel-stats">
                    <span id="ihack-stat-total">0</span> pending
                    <span id="ihack-stat-applied">0</span> applied
                </div>
                <div id="ihack-cut-list" class="ihack-cut-list"></div>
                <div class="ihack-panel-actions">
                    <button id="ihack-apply-all">✂ Apply All</button>
                    <button id="ihack-dismiss-all">✕ Dismiss All</button>
                </div>
                <div id="ihack-status" class="ihack-status">Ready</div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        document.querySelector('.ihack-panel-close').addEventListener('click', function() {
            document.getElementById('ihack-panel').style.display = 'none';
        });

        document.getElementById('ihack-apply-all').addEventListener('click', function() {
            var pl = getPipeline();
            if (!pl) return;
            var pending = pl.getGhostCuts().filter(function(c) { return c.state === 'pending'; });
            pending.forEach(function(c) { pl.executeCut(c.id); });
            populateReviewPanel();
            showToast('Applied ' + pending.length + ' cuts', 'success');
        });

        document.getElementById('ihack-dismiss-all').addEventListener('click', function() {
            var pl = getPipeline();
            if (!pl) return;
            pl.getGhostCuts().forEach(function(c) { if (c.state === 'pending') pl.dismissCut(c.id); });
            populateReviewPanel();
            showToast('All cuts dismissed', 'success');
        });
    }

    function createToolbarButtons() {
        var toolbar = document.querySelector('.app-header, header, .toolbar') || document.body;
        var html = `
            <button id="ihack-analyze-btn" class="ihack-toolbar-btn" title="AI Analyze (Shift+A)">🤖 Analyze</button>
            <button id="ihack-panel-btn" class="ihack-toolbar-btn" title="Review Panel">📋 Review</button>
            <button id="ihack-settings-btn" class="ihack-toolbar-btn" title="Settings">⚙️</button>
        `;
        toolbar.insertAdjacentHTML('beforeend', html);

        document.getElementById('ihack-analyze-btn').addEventListener('click', function() {
            var pl = getPipeline();
            if (!pl) { showToast('Pipeline not loaded', 'error'); return; }
            // Try to get current audio file from AudioMass
            var fileInput = document.querySelector('input[type="file"]');
            if (fileInput && fileInput.files && fileInput.files[0]) {
                pl.analyze(fileInput.files[0]);
            } else {
                pl.loadDemo();
                showToast('Demo data loaded (no backend)', 'success');
            }
            document.getElementById('ihack-panel').style.display = 'flex';
            populateReviewPanel();
        });

        document.getElementById('ihack-panel-btn').addEventListener('click', function() {
            var panel = document.getElementById('ihack-panel');
            panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
            populateReviewPanel();
        });

        document.getElementById('ihack-settings-btn').addEventListener('click', function() {
            var s = document.getElementById('ihack-settings');
            s.style.display = s.style.display === 'none' ? 'block' : 'none';
        });
    }

    function createToastContainer() {
        var div = document.createElement('div');
        div.className = 'ihack-toast-container';
        div.id = 'ihack-toast-container';
        document.body.appendChild(div);
    }

    // ═══════════════════════════════════════════════════════════
    // REVIEW PANEL POPULATION
    // ═══════════════════════════════════════════════════════════

    function populateReviewPanel() {
        var list = document.getElementById('ihack-cut-list');
        if (!list) return;
        list.innerHTML = '';

        var pl = getPipeline();
        if (!pl) {
            list.innerHTML = '<div class="ihack-empty">Pipeline not loaded</div>';
            return;
        }

        var cuts = pl.getGhostCuts();
        var pending = cuts.filter(function(c) { return c.state === 'pending'; });
        var applied = cuts.filter(function(c) { return c.state === 'executed'; });

        document.getElementById('ihack-stat-total').textContent = pending.length;
        document.getElementById('ihack-stat-applied').textContent = applied.length;

        if (!pending.length) {
            list.innerHTML = '<div class="ihack-empty">All cuts reviewed ✓</div>';
            return;
        }

        pending.forEach(function(cut) {
            var card = document.createElement('div');
            card.className = 'ihack-card';
            card.dataset.cutId = cut.id;
            card.innerHTML = `
                <div class="ihack-card-header">
                    <span class="ihack-badge ihack-badge--${cut.category}">${cut.category.replace(/_/g, ' ')}</span>
                    <span class="ihack-time">${fmtTime(cut.start)} - ${fmtTime(cut.end)}</span>
                    <span class="ihack-conf">${Math.round(cut.confidence*100)}%</span>
                </div>
                <div class="ihack-card-body">
                    <p class="ihack-transcript">${cut.transcript || ''}</p>
                    <p class="ihack-reason">${cut.reason || ''}</p>
                </div>
                <div class="ihack-card-actions">
                    <button class="ihack-btn-cut" data-action="cut">✂ Cut</button>
                    <button class="ihack-btn-keep" data-action="keep">✓ Keep</button>
                    <button class="ihack-btn-jump" data-action="jump">⏵ Jump</button>
                </div>
            `;

            card.querySelector('.ihack-btn-cut').addEventListener('click', function() {
                pl.executeCut(cut.id);
                card.classList.add('ihack-applied');
                populateReviewPanel();
                showToast('Cut: ' + cut.label, 'success');
                if (w.IHackGhostOverlay) w.IHackGhostOverlay.render();
            });

            card.querySelector('.ihack-btn-keep').addEventListener('click', function() {
                pl.dismissCut(cut.id);
                card.style.animation = 'none';
                card.style.opacity = '0';
                setTimeout(populateReviewPanel, 200);
                if (w.IHackGhostOverlay) w.IHackGhostOverlay.render();
            });

            card.querySelector('.ihack-btn-jump').addEventListener('click', function() {
                if (w.app && w.app.fireEvent) {
                    w.app.fireEvent('RequestSeekTo', cut.start / (pl.getDuration() || 120));
                }
            });

            list.appendChild(card);
        });
    }

    // ═══════════════════════════════════════════════════════════
    // TOASTS
    // ═══════════════════════════════════════════════════════════

    function showToast(msg, type) {
        var container = document.getElementById('ihack-toast-container');
        if (!container) return;
        var toast = document.createElement('div');
        toast.className = 'ihack-toast ihack-toast--' + type;
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(function() {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(function() { toast.remove(); }, 300);
        }, 3000);
    }

    // ═══════════════════════════════════════════════════════════
    // PIPELINE EVENT LISTENERS
    // ═══════════════════════════════════════════════════════════

    function bindPipelineEvents() {
        var pl = getPipeline();
        if (!pl) {
            setTimeout(bindPipelineEvents, 500);
            return;
        }

        pl.on('analysis:start', function() {
            showToast('Analyzing audio with AI...', 'loading');
            updateStatus('Analyzing...');
        });

        pl.on('analysis:complete', function(data) {
            showToast('Found ' + (data.cuts ? data.cuts.length : 0) + ' cuts', 'success');
            updateStatus('Analysis complete');
            populateReviewPanel();
            document.getElementById('ihack-panel').style.display = 'flex';
        });

        pl.on('analysis:error', function(err) {
            showToast('Analysis failed: ' + (err.message || err), 'error');
            updateStatus('Analysis failed');
        });

        pl.on('state:changed', function() {
            populateReviewPanel();
        });
    }

    function updateStatus(msg) {
        var el = document.getElementById('ihack-status');
        if (el) el.textContent = msg;
    }

    // ═══════════════════════════════════════════════════════════
    // KEYBOARD SHORTCUTS
    // ═══════════════════════════════════════════════════════════

    document.addEventListener('keydown', function(e) {
        if (e.shiftKey && e.key === 'A') {
            e.preventDefault();
            document.getElementById('ihack-analyze-btn').click();
        }
        if (e.shiftKey && e.key === 'R') {
            e.preventDefault();
            document.getElementById('ihack-panel-btn').click();
        }
        if (e.shiftKey && e.key === 'S') {
            e.preventDefault();
            document.getElementById('ihack-settings-btn').click();
        }
    });

    // ═══════════════════════════════════════════════════════════
    // AUTO-INIT
    // ═══════════════════════════════════════════════════════════

    function init() {
        createUI();
        bindPipelineEvents();

        // Load saved settings
        var savedEndpoint = localStorage.getItem('ihack_endpoint');
        var savedConf = localStorage.getItem('ihack_min_conf');
        var savedInstr = localStorage.getItem('ihack_instr');
        if (savedEndpoint) document.getElementById('ihack-endpoint').value = savedEndpoint;
        if (savedConf) document.getElementById('ihack-confidence').value = savedConf;
        if (savedInstr) document.getElementById('ihack-instr').value = savedInstr;

        console.log('[iHack UI] Initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose
    w.IHackUI = {
        showToast: showToast,
        populateReviewPanel: populateReviewPanel,
        updateStatus: updateStatus
    };

})(window);
