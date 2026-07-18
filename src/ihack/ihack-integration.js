// ============================================================
// ihack-integration.js
// SINGLE FILE: Pipeline + Ghost Overlay + Review Panel + Backend Bridge
// Load this ONE file in AudioMass index.html after app.js
// ============================================================

(function(w) {
    'use strict';

    // ═══════════════════════════════════════════════════════════
    // PART 1: IHACK PIPELINE (State Manager)
    // ═══════════════════════════════════════════════════════════

    var pipelineState = {
        ghostCuts: [],
        midpoints: [],
        segments: [],
        words: [],
        isAnalyzing: false,
        jobId: null,
        appliedCuts: [],
        mergePoints: [],
        customInstruction: '',
        minConfidence: 0.7,
        endpoint: 'http://localhost:8000',
        // Settings
        groqKey: '',
        geminiKey: '',
        openrouterKey: '',
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite',
    };

    var pipelineListeners = {};

    var Pipeline = {
        getState: function() { return pipelineState; },
        getGhostCuts: function() { return pipelineState.ghostCuts; },
        getMidpoints: function() { return pipelineState.midpoints; },
        getSegments: function() { return pipelineState.segments; },

        setGhostCuts: function(cuts) {
            pipelineState.ghostCuts = cuts || [];
            this.emit('ghostcuts:updated');
            this.emit('state:changed');
        },

        updateCutState: function(cutId, newState) {
            var cut = pipelineState.ghostCuts.find(function(c) { return c.id === cutId; });
            if (cut) { cut.state = newState; this.emit('state:changed'); }
        },

        setMidpoints: function(mps) {
            pipelineState.midpoints = mps || [];
            this.emit('state:changed');
        },

        setSegments: function(segs) {
            pipelineState.segments = segs || [];
            this.emit('state:changed');
        },

        setAnalyzing: function(val) {
            pipelineState.isAnalyzing = val;
            this.emit('state:changed');
        },

        setJobId: function(id) { pipelineState.jobId = id; },

        addMergePoint: function(time) {
            pipelineState.mergePoints.push(time);
            this.emit('state:changed');
        },

        on: function(event, handler) {
            if (!pipelineListeners[event]) pipelineListeners[event] = [];
            pipelineListeners[event].push(handler);
        },

        emit: function(event, data) {
            if (!pipelineListeners[event]) return;
            pipelineListeners[event].forEach(function(h) {
                try { h(data); } catch(e) { console.error('[iHack] Event error:', e); }
            });
        },

        // ── Settings ──
        loadSettings: function() {
            try {
                var raw = localStorage.getItem('ihack-settings');
                if (raw) {
                    var saved = JSON.parse(raw);
                    if (saved.groqKey) pipelineState.groqKey = saved.groqKey;
                    if (saved.geminiKey) pipelineState.geminiKey = saved.geminiKey;
                    if (saved.openrouterKey) pipelineState.openrouterKey = saved.openrouterKey;
                    if (saved.provider) pipelineState.provider = saved.provider;
                    if (saved.model) pipelineState.model = saved.model;
                    if (saved.customInstruction) pipelineState.customInstruction = saved.customInstruction;
                }
            } catch(e) {}
        },

        saveSettings: function() {
            try {
                localStorage.setItem('ihack-settings', JSON.stringify({
                    groqKey: pipelineState.groqKey,
                    geminiKey: pipelineState.geminiKey,
                    openrouterKey: pipelineState.openrouterKey,
                    provider: pipelineState.provider,
                    model: pipelineState.model,
                    customInstruction: pipelineState.customInstruction,
                }));
            } catch(e) {}
        },

        getActiveKey: function() {
            if (pipelineState.provider === 'gemini') return pipelineState.geminiKey;
            if (pipelineState.provider === 'openrouter') return pipelineState.openrouterKey;
            return pipelineState.groqKey;
        },

        // ── Demo Data ──
        loadDemo: function() {
            this.setGhostCuts([
                { id: 'c1', start: 5.2, end: 5.8, category: 'FILLER_WORD', confidence: 0.95, state: 'pending', label: 'um' },
                { id: 'c2', start: 12.5, end: 15.6, category: 'LONG_SILENCE', confidence: 0.98, state: 'pending', label: 'silence' },
                { id: 'c3', start: 18.0, end: 20.2, category: 'REDUNDANT_PHRASE', confidence: 0.88, state: 'pending', label: 'you know' },
                { id: 'c4', start: 25.0, end: 28.3, category: 'LONG_PAUSE', confidence: 0.92, state: 'pending', label: 'pause' },
                { id: 'c5', start: 32.1, end: 32.9, category: 'FILLER_WORD', confidence: 0.91, state: 'pending', label: 'uh' },
                { id: 'c6', start: 45.0, end: 50.0, category: 'LONG_SILENCE', confidence: 0.97, state: 'pending', label: 'silence' },
            ]);
            this.setMidpoints([
                { time: 5.5, gap_type: 'CLEAN_SILENCE' },
                { time: 14.0, gap_type: 'TIGHT' },
                { time: 19.1, gap_type: 'BREATH' },
            ]);
            console.log('[iHack] Demo data loaded');
        },

        // ── Analyze via backend ──
        analyze: function(file) {
            var self = this;
            this.setAnalyzing(true);
            this.emit('analysis:start');

            var formData = new FormData();
            formData.append('file', file);
            formData.append('custom_instruction', pipelineState.customInstruction);
            formData.append('min_confidence', pipelineState.minConfidence);

            fetch(pipelineState.endpoint + '/analyze', {
                method: 'POST',
                body: formData
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                self.setJobId(data.job_id);
                var cuts = (data.cuts || []).map(function(c) {
                    return {
                        id: c.id,
                        start: c.start,
                        end: c.end,
                        category: c.type ? c.type.toUpperCase() : 'UNKNOWN',
                        confidence: c.confidence,
                        state: 'pending',
                        label: c.label,
                        transcript: c.transcript,
                        reason: c.reason,
                        severity: c.severity
                    };
                });
                self.setGhostCuts(cuts);
                self.emit('analysis:complete', data);
            })
            .catch(function(err) {
                console.error('[iHack] Analysis failed:', err);
                self.emit('analysis:error', err);
            })
            .finally(function() {
                self.setAnalyzing(false);
            });
        }
    };

    w.IHackPipeline = Pipeline;

    // ═══════════════════════════════════════════════════════════
    // PART 2: GHOST OVERLAY (Canvas Renderer)
    // ═══════════════════════════════════════════════════════════

    var ghostCanvas = null, ghostCtx = null, ghostRafId = null, activeCutId = null, hoveredCutId = null;

    // Colors from Python styles.py — exact match
    var GHOST_COLORS = {
        pending_high: 'rgba(239, 68, 68, 0.45)',
        pending_med:  'rgba(245, 158, 11, 0.45)',
        pending_low:  'rgba(122, 139, 160, 0.35)',
        confirmed:    'rgba(52, 211, 153, 0.18)',
        edited:       'rgba(99, 102, 241, 0.3)',
        executed:     'rgba(52, 211, 153, 0.10)',
        hovered:      'rgba(99, 102, 241, 0.40)',
        active:       'rgba(99, 102, 241, 0.50)',
        manual:       'rgba(6, 182, 212, 0.3)',
        border: {
            pending_high: 'rgba(239,68,68,0.7)',
            pending_med:  'rgba(245,158,11,0.6)',
            pending_low:  'rgba(122,139,160,0.4)',
            confirmed:    'rgba(52,211,153,0.5)',
            edited:       'rgba(99,102,241,0.5)',
            executed:     'rgba(52,211,153,0.2)',
            hovered:      'rgba(99,102,241,0.8)',
        },
        midpoint: {
            CLEAN_SILENCE: { fill: 'rgba(52,211,153,0.5)', dot: 'rgba(52,211,153,0.8)' },
            NOISY_SILENCE: { fill: 'rgba(245,158,11,0.4)', dot: 'rgba(245,158,11,0.7)' },
            TIGHT:         { fill: 'rgba(245,158,11,0.4)', dot: 'rgba(245,158,11,0.7)' },
            TIGHT_CLEAN:   { fill: 'rgba(245,158,11,0.4)', dot: 'rgba(245,158,11,0.7)' },
            BREATH:        { fill: 'rgba(122,139,160,0.3)', dot: 'rgba(122,139,160,0.5)' },
        },
        selection: 'rgba(99,102,241,0.12)',
    };

    function initGhostOverlay(appRef) {
        var wavesurfer = appRef.engine.wavesurfer;
        var container = wavesurfer.drawer.wrapper;
        var parent = container.parentNode || container;

        ghostCanvas = document.createElement('canvas');
        ghostCanvas.id = 'ihack-ghost-canvas';
        ghostCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
        if (parent.style.position !== 'relative' && parent.style.position !== 'absolute') {
            parent.style.position = 'relative';
        }
        parent.appendChild(ghostCanvas);
        ghostCtx = ghostCanvas.getContext('2d');

        parent.addEventListener('click', onGhostClick);
        parent.addEventListener('mousemove', onGhostMouseMove);
        parent.addEventListener('mouseleave', function() { hoveredCutId = null; scheduleGhostRender(); });

        appRef.listenFor('DidDownloadFile', function() { setTimeout(resizeGhost, 100); });
        appRef.listenFor('RequestResize', resizeGhost);
        appRef.listenFor('DidResize', resizeGhost);

        Pipeline.on('ghostcuts:updated', scheduleGhostRender);
        Pipeline.on('state:changed', scheduleGhostRender);

        console.log('[iHack GhostOverlay] Init OK');
        setTimeout(resizeGhost, 200);
    }

    function resizeGhost() {
        if (!ghostCanvas) return;
        var parent = ghostCanvas.parentNode;
        var rect = parent.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        ghostCanvas.width = rect.width * dpr;
        ghostCanvas.height = rect.height * dpr;
        ghostCanvas.style.width = rect.width + 'px';
        ghostCanvas.style.height = rect.height + 'px';
        ghostCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        scheduleGhostRender();
    }

    function scheduleGhostRender() {
        if (ghostRafId) cancelAnimationFrame(ghostRafId);
        ghostRafId = requestAnimationFrame(renderGhost);
    }

    function renderGhost() {
        if (!ghostCtx || !ghostCanvas) return;
        var W = ghostCanvas.width / (window.devicePixelRatio || 1);
        var H = ghostCanvas.height / (window.devicePixelRatio || 1);
        ghostCtx.clearRect(0, 0, W, H);

        var state = Pipeline.getState();
        // Get duration from wavesurfer if available
        var app = w.app || w.PKAudioEditor;
        var duration = (app && app.engine && app.engine.wavesurfer) ? app.engine.wavesurfer.getDuration() : 120;
        if (!duration || duration <= 0) return;

        function tX(t) { return (t / duration) * W; }

        // Midpoints
        var midpoints = state.midpoints || [];
        for (var i = 0; i < midpoints.length; i++) {
            var mp = midpoints[i];
            var x = tX(mp.time);
            var colors = GHOST_COLORS.midpoint[mp.gap_type] || GHOST_COLORS.midpoint.BREATH;
            ghostCtx.strokeStyle = colors.fill;
            ghostCtx.lineWidth = 1;
            ghostCtx.setLineDash([4, 3]);
            ghostCtx.beginPath();
            ghostCtx.moveTo(x, 0);
            ghostCtx.lineTo(x, H);
            ghostCtx.stroke();
            ghostCtx.setLineDash([]);
            ghostCtx.fillStyle = colors.dot;
            ghostCtx.beginPath();
            ghostCtx.arc(x, H / 2, 3, 0, Math.PI * 2);
            ghostCtx.fill();
        }

        // Ghost cuts
        var cuts = state.ghostCuts || [];
        for (var i = 0; i < cuts.length; i++) {
            var cut = cuts[i];
            if (cut.state === 'dismissed') continue;
            var x1 = Math.max(0, tX(cut.start));
            var x2 = Math.min(W, tX(cut.end));
            var w = Math.max(1, x2 - x1);

            var fill, border;
            if (cut.id === activeCutId) { fill = GHOST_COLORS.active; border = GHOST_COLORS.border.hovered; }
            else if (cut.id === hoveredCutId) { fill = GHOST_COLORS.hovered; border = GHOST_COLORS.border.hovered; }
            else if (cut.state === 'executed') { fill = GHOST_COLORS.executed; border = GHOST_COLORS.border.executed; }
            else if (cut.state === 'confirmed') { fill = GHOST_COLORS.confirmed; border = GHOST_COLORS.border.confirmed; }
            else if (cut.state === 'edited') { fill = GHOST_COLORS.edited; border = GHOST_COLORS.border.edited; }
            else if (cut.confidence >= 0.85) { fill = GHOST_COLORS.pending_high; border = GHOST_COLORS.border.pending_high; }
            else if (cut.confidence >= 0.60) { fill = GHOST_COLORS.pending_med; border = GHOST_COLORS.border.pending_med; }
            else { fill = GHOST_COLORS.pending_low; border = GHOST_COLORS.border.pending_low; }

            ghostCtx.fillStyle = fill;
            ghostCtx.fillRect(x1, 0, w, H);
            ghostCtx.strokeStyle = border;
            ghostCtx.lineWidth = (cut.id === hoveredCutId || cut.id === activeCutId) ? 2 : 1.5;
            ghostCtx.strokeRect(x1, 0, w, H);

            if (w > 50) {
                ghostCtx.fillStyle = 'rgba(255,255,255,0.5)';
                ghostCtx.font = '9px monospace';
                ghostCtx.fillText(cut.category.replace(/_/g, ' '), x1 + 4, 14);
            }
            if (w > 80) {
                var confColor = cut.confidence >= 0.85 ? '#ef4444' : cut.confidence >= 0.60 ? '#f59e0b' : '#7a8ba0';
                ghostCtx.fillStyle = confColor;
                ghostCtx.font = 'bold 10px monospace';
                ghostCtx.fillText(Math.round(cut.confidence * 100) + '%', x2 - 30, 14);
            }
        }
    }

    function onGhostClick(e) {
        var rect = ghostCanvas.parentNode.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var W = rect.width;
        var app = w.app || w.PKAudioEditor;
        var duration = (app && app.engine && app.engine.wavesurfer) ? app.engine.wavesurfer.getDuration() : 120;
        var time = (x / W) * duration;
        var cut = findCutAt(time);
        if (cut) {
            if (app && app.fireEvent) {
                app.fireEvent('RequestSeekTo', cut.start / duration);
            }
            activeCutId = cut.id;
            console.log('[iHack] Clicked cut:', cut.id, cut.category, cut.label);
        } else {
            if (app && app.fireEvent) {
                app.fireEvent('RequestSeekTo', time / duration);
            }
            activeCutId = null;
        }
        scheduleGhostRender();
    }

    function onGhostMouseMove(e) {
        var rect = ghostCanvas.parentNode.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var W = rect.width;
        var app = w.app || w.PKAudioEditor;
        var duration = (app && app.engine && app.engine.wavesurfer) ? app.engine.wavesurfer.getDuration() : 120;
        var time = (x / W) * duration;
        var cut = findCutAt(time);
        var newId = cut ? cut.id : null;
        if (newId !== hoveredCutId) {
            hoveredCutId = newId;
            ghostCanvas.parentNode.style.cursor = hoveredCutId ? 'pointer' : 'default';
            scheduleGhostRender();
        }
    }

    function findCutAt(time) {
        var cuts = Pipeline.getGhostCuts();
        for (var i = 0; i < cuts.length; i++) {
            var c = cuts[i];
            if (c.state === 'dismissed' || c.state === 'executed') continue;
            if (time >= c.start && time <= c.end) return c;
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    // PART 3: AUTO-INIT ON APP READY
    // ═══════════════════════════════════════════════════════════

    function waitForApp() {
        // AudioMass uses PKAudioEditor, not window.app
        var app = w.app || w.PKAudioEditor;
        if (app && app.engine && app.engine.wavesurfer) {
            console.log('[iHack] App detected, initializing...');
            Pipeline.loadSettings();
            initGhostOverlay(app);
            // Load demo data so overlays appear immediately
            Pipeline.loadDemo();
            return;
        }
        setTimeout(waitForApp, 200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForApp);
    } else {
        waitForApp();
    }

    console.log('[iHack] Integration loaded v3.0');

})(window);
