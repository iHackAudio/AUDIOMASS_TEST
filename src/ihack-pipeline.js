/**
 * ihack-pipeline.js
 * iHack Audio v3 — Global State Manager for AudioMass
 * Must load BEFORE ghost-overlay.js
 */

(function(w) {
    'use strict';

    var _state = {
        ghostCuts: [],
        midpoints: [],
        isAnalyzing: false,
        jobId: null,
        appliedCuts: [],
        mergePoints: [],
        customInstruction: '',
        minConfidence: 0.7,
        endpoint: 'http://localhost:8000',
        duration: 0
    };

    var _listeners = {};

    var Pipeline = {
        getState: function() { return _state; },
        getGhostCuts: function() { return _state.ghostCuts; },
        getMidpoints: function() { return _state.midpoints; },
        getDuration: function() { return _state.duration; },
        getAnalyzing: function() { return _state.isAnalyzing; },

        setGhostCuts: function(cuts) {
            _state.ghostCuts = cuts || [];
            this._emit('ghostcuts:updated');
            this._emit('state:changed');
        },

        setMidpoints: function(mps) {
            _state.midpoints = mps || [];
            this._emit('state:changed');
        },

        setDuration: function(d) {
            _state.duration = d || 0;
            this._emit('state:changed');
        },

        setAnalyzing: function(val) {
            _state.isAnalyzing = val;
            this._emit('state:changed');
        },

        setJobId: function(id) { _state.jobId = id; },
        setEndpoint: function(url) { _state.endpoint = url; },
        setCustomInstruction: function(instr) { _state.customInstruction = instr || ''; },
        setMinConfidence: function(val) { _state.minConfidence = parseFloat(val) || 0.7; },

        updateCutState: function(cutId, newState) {
            var cut = _state.ghostCuts.find(function(c) { return c.id === cutId; });
            if (cut) {
                cut.state = newState;
                this._emit('state:changed');
                this._emit('cut:updated', { id: cutId, state: newState });
            }
        },

        dismissCut: function(cutId) { this.updateCutState(cutId, 'dismissed'); },
        confirmCut: function(cutId) { this.updateCutState(cutId, 'confirmed'); },

        executeCut: function(cutId) {
            this.updateCutState(cutId, 'executed');
            var cut = _state.ghostCuts.find(function(c) { return c.id === cutId; });
            if (cut) {
                _state.appliedCuts.push(cut);
                _state.mergePoints.push(cut.start);
                this._emit('cut:executed', cut);
            }
        },

        addMergePoint: function(time) {
            _state.mergePoints.push(time);
            this._emit('state:changed');
        },

        on: function(event, handler) {
            if (!_listeners[event]) _listeners[event] = [];
            _listeners[event].push(handler);
        },

        off: function(event, handler) {
            if (!_listeners[event]) return;
            var idx = _listeners[event].indexOf(handler);
            if (idx > -1) _listeners[event].splice(idx, 1);
        },

        _emit: function(event, data) {
            if (!_listeners[event]) return;
            _listeners[event].forEach(function(h) {
                try { h(data); } catch(e) { console.error('[iHack Pipeline] Event error:', e); }
            });
        },

        analyze: function(file) {
            var self = this;
            this.setAnalyzing(true);
            this._emit('analysis:start');

            var formData = new FormData();
            formData.append('file', file);
            formData.append('custom_instruction', _state.customInstruction);
            formData.append('min_confidence', _state.minConfidence);

            console.log('[iHack Pipeline] Analyzing:', file.name, '->', _state.endpoint);

            fetch(_state.endpoint + '/analyze', {
                method: 'POST',
                body: formData
            })
            .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
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
                        transcript: c.transcript || '',
                        reason: c.reason || '',
                        severity: c.severity || 'medium',
                        suggested_action: c.suggested_action || 'cut'
                    };
                });
                self.setGhostCuts(cuts);
                self._emit('analysis:complete', data);
                console.log('[iHack Pipeline] Analysis complete:', cuts.length, 'cuts');
            })
            .catch(function(err) {
                console.error('[iHack Pipeline] Analysis failed:', err);
                self._emit('analysis:error', err);
            })
            .finally(function() {
                self.setAnalyzing(false);
            });
        },

        loadDemo: function() {
            this.setGhostCuts([
                { id: 'c1', start: 5.2, end: 5.8, category: 'FILLER_WORD', confidence: 0.95, state: 'pending', label: 'um', transcript: 'um, so like', reason: 'Filler word detected by Whisper + AI', severity: 'low' },
                { id: 'c2', start: 12.5, end: 15.6, category: 'LONG_SILENCE', confidence: 0.98, state: 'pending', label: 'silence', transcript: '', reason: 'VAD detected 3.1s of silence', severity: 'medium' },
                { id: 'c3', start: 18.0, end: 20.2, category: 'REDUNDANT_PHRASE', confidence: 0.88, state: 'pending', label: 'you know', transcript: 'you know, you know', reason: 'Phrase repeated 3x within 30s', severity: 'medium' },
                { id: 'c4', start: 25.0, end: 28.3, category: 'LONG_PAUSE', confidence: 0.92, state: 'pending', label: 'pause', transcript: '', reason: '2.5s pause detected', severity: 'low' },
                { id: 'c5', start: 32.1, end: 32.9, category: 'FILLER_WORD', confidence: 0.91, state: 'pending', label: 'uh', transcript: 'uh, basically', reason: 'High confidence filler', severity: 'low' },
                { id: 'c6', start: 45.0, end: 50.0, category: 'LONG_SILENCE', confidence: 0.97, state: 'pending', label: 'silence', transcript: '', reason: '5s silence. Safe to remove', severity: 'medium' },
                { id: 'c7', start: 55.3, end: 56.1, category: 'BREATH', confidence: 0.85, state: 'pending', label: 'loud breath', transcript: '[breath]', reason: 'Isolated breath sound', severity: 'low', suggested_action: 'review' },
                { id: 'c8', start: 62.0, end: 63.5, category: 'MISTAKE', confidence: 0.89, state: 'pending', label: 'false start', transcript: 'So, so, what I meant...', reason: 'False start detected', severity: 'medium' },
            ]);
            this.setMidpoints([
                { time: 5.5, gap_type: 'CLEAN_SILENCE' },
                { time: 14.0, gap_type: 'TIGHT' },
                { time: 19.1, gap_type: 'BREATH' },
                { time: 26.5, gap_type: 'CLEAN_SILENCE' },
                { time: 47.5, gap_type: 'TIGHT' },
            ]);
            console.log('[iHack Pipeline] Demo data loaded (8 cuts, 5 midpoints)');
        },

        reset: function() {
            _state.ghostCuts = [];
            _state.midpoints = [];
            _state.appliedCuts = [];
            _state.mergePoints = [];
            _state.jobId = null;
            this._emit('state:changed');
        }
    };

    w.IHackPipeline = Pipeline;
    console.log('[iHack Pipeline] Initialized v3.0');

})(window);
