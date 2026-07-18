/**
 * ghost-overlay.js
 * iHack Audio v3 — Ghost Cut Overlay for AudioMass Waveform
 * Requires: ihack-pipeline.js (must load BEFORE this file)
 * 
 * Renders translucent ghost cut regions and midpoint markers
 * on a canvas layer above the AudioMass waveform.
 */

(function (w) {
	'use strict';

	var canvas = null, ctx = null, app = null, wavesurfer = null, container = null, rafId = null, activeCutId = null;

	var COLORS = {
		high: 'rgba(239,68,68,0.35)', medium: 'rgba(245,158,11,0.30)', low: 'rgba(122,139,160,0.20)',
		confirmed: 'rgba(52,211,153,0.25)', executed: 'rgba(52,211,153,0.10)', active: 'rgba(99,102,241,0.40)',
		border: { high: 'rgba(239,68,68,0.7)', medium: 'rgba(245,158,11,0.6)', low: 'rgba(122,139,160,0.4)', confirmed: 'rgba(52,211,153,0.5)', executed: 'rgba(52,211,153,0.2)' },
		midpoint: { CLEAN_SILENCE: 'rgba(52,211,153,0.5)', TIGHT: 'rgba(245,158,11,0.4)', BREATH: 'rgba(122,139,160,0.3)' },
	};

	// ── Safe pipeline accessor (never crashes) ──
	function getPipeline () {
		return w.IHackPipeline || null;
	}

	function init (appRef) {
		app = appRef;
		wavesurfer = app.engine.wavesurfer;
		container = wavesurfer.drawer.wrapper;

		// Append overlay canvas to container's parent
		var parent = container.parentNode || container;
		canvas = document.createElement('canvas');
		canvas.id = 'ihack-ghost-canvas';
		canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
		if (parent.style.position !== 'relative' && parent.style.position !== 'absolute') {
			parent.style.position = 'relative';
		}
		parent.appendChild(canvas);
		ctx = canvas.getContext('2d');

		// Mouse events on parent (canvas is transparent to clicks)
		parent.addEventListener('click', onClick);
		parent.addEventListener('mousemove', onMouseMove);
		parent.addEventListener('mouseleave', function () { activeCutId = null; scheduleRender(); });

		// AudioMass resize events
		app.listenFor('DidDownloadFile', function () { setTimeout(resize, 100); });
		app.listenFor('RequestResize', resize);
		app.listenFor('DidResize', resize);

		// ── Pipeline event binding (with retry) ──
		var pl = getPipeline();
		if (pl) {
			bindPipelineEvents(pl);
		} else {
			console.warn('[iHack GhostOverlay] Pipeline not ready, will retry...');
			var retries = 0;
			function retryBind() {
				var pl2 = getPipeline();
				if (pl2) {
					bindPipelineEvents(pl2);
					scheduleRender();
					console.log('[iHack GhostOverlay] Pipeline connected');
				} else if (retries++ < 40) {
					setTimeout(retryBind, 250);
				} else {
					console.error('[iHack GhostOverlay] Pipeline never loaded — ensure ihack-pipeline.js loads BEFORE ghost-overlay.js');
				}
			}
			setTimeout(retryBind, 250);
		}

		console.log('[iHack GhostOverlay] Init OK');
		setTimeout(resize, 200);
	}

	function bindPipelineEvents(pl) {
		pl.on('ghostcuts:updated', scheduleRender);
		pl.on('state:changed', scheduleRender);
		pl.on('cuts:executed', scheduleRender);
	}

	function resize () {
		if (!canvas || !container) return;
		var parent = canvas.parentNode;
		var rect = parent ? parent.getBoundingClientRect() : container.getBoundingClientRect();
		var dpr = window.devicePixelRatio || 1;
		canvas.width = rect.width * dpr;
		canvas.height = rect.height * dpr;
		canvas.style.width = rect.width + 'px';
		canvas.style.height = rect.height + 'px';
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		console.log('[iHack GhostOverlay] Resize:', rect.width.toFixed(0), 'x', rect.height.toFixed(0));
		scheduleRender();
	}

	function scheduleRender () {
		if (rafId) cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(render);
	}

	function render () {
		if (!ctx || !canvas) return;
		var W = canvas.width / (window.devicePixelRatio || 1);
		var H = canvas.height / (window.devicePixelRatio || 1);
		ctx.clearRect(0, 0, W, H);

		// ── SAFE: get pipeline, show placeholder if missing ──
		var pl = getPipeline();
		if (!pl) {
			ctx.fillStyle = 'rgba(255,255,255,0.25)';
			ctx.font = '13px monospace';
			ctx.textAlign = 'center';
			ctx.fillText('AI pipeline loading...', W/2, H/2 - 10);
			ctx.font = '11px monospace';
			ctx.fillStyle = 'rgba(255,255,255,0.15)';
			ctx.fillText('(ensure ihack-pipeline.js loads first)', W/2, H/2 + 10);
			return;
		}

		var state = pl.getState ? pl.getState() : {};
		var duration = state.duration || (wavesurfer.getDuration ? wavesurfer.getDuration() : 0);
		if (!duration || duration <= 0) {
			// Try to get duration from wavesurfer as fallback
			if (wavesurfer && wavesurfer.backend && wavesurfer.backend.buffer) {
				duration = wavesurfer.backend.buffer.duration;
				pl.setDuration(duration);
			}
			if (!duration || duration <= 0) return;
		}

		function tX (t) { return (t / duration) * W; }

		// ── Draw midpoints ──
		var midpoints = state.midpoints || [];
		for (var i = 0; i < midpoints.length; i++) {
			var mp = midpoints[i];
			var x = tX(mp.time);
			var color = COLORS.midpoint[mp.gap_type] || COLORS.midpoint.BREATH;
			ctx.strokeStyle = color;
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 3]);
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, H);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(x, H / 2, 3, 0, Math.PI * 2);
			ctx.fill();
		}

		// ── Draw ghost cuts ──
		var cuts = state.ghostCuts || [];
		for (var i = 0; i < cuts.length; i++) {
			var cut = cuts[i];
			if (cut.state === 'dismissed') continue;
			var x1 = Math.max(0, tX(cut.start));
			var x2 = Math.min(W, tX(cut.end));
			var w = Math.max(1, x2 - x1);

			var fill, border;
			if (cut.id === activeCutId) { fill = COLORS.active; border = 'rgba(99,102,241,0.8)'; }
			else if (cut.state === 'executed') { fill = COLORS.executed; border = COLORS.border.executed; }
			else if (cut.state === 'confirmed') { fill = COLORS.confirmed; border = COLORS.border.confirmed; }
			else if (cut.confidence >= 0.85) { fill = COLORS.high; border = COLORS.border.high; }
			else if (cut.confidence >= 0.60) { fill = COLORS.medium; border = COLORS.border.medium; }
			else { fill = COLORS.low; border = COLORS.border.low; }

			ctx.fillStyle = fill;
			ctx.fillRect(x1, 0, w, H);
			ctx.strokeStyle = border;
			ctx.lineWidth = 1.5;
			ctx.strokeRect(x1, 0, w, H);

			if (w > 40) {
				ctx.fillStyle = 'rgba(255,255,255,0.5)';
				ctx.font = '9px monospace';
				ctx.fillText(cut.category.replace(/_/g, ' '), x1 + 4, 12);
			}
		}
	}

	function onClick (e) {
		var rect = canvas.parentNode.getBoundingClientRect();
		var x = e.clientX - rect.left;
		var W = rect.width;
		var pl = getPipeline();
		if (!pl) return;
		var duration = pl.getDuration() || (wavesurfer.getDuration ? wavesurfer.getDuration() : 0);
		if (!duration) return;
		var time = (x / W) * duration;
		var cut = findCutAt(time);
		if (cut) {
			app.fireEvent('RequestSeekTo', cut.start / duration);
			app.fireEvent('ihack:cutClicked', cut);
			console.log('[iHack GhostOverlay] Clicked cut:', cut.id, cut.label);
		}
	}

	function onMouseMove (e) {
		var rect = canvas.parentNode.getBoundingClientRect();
		var x = e.clientX - rect.left;
		var W = rect.width;
		var pl = getPipeline();
		if (!pl) return;
		var duration = pl.getDuration() || (wavesurfer.getDuration ? wavesurfer.getDuration() : 0);
		if (!duration) return;
		var time = (x / W) * duration;
		var cut = findCutAt(time);
		var newId = cut ? cut.id : null;
		if (newId !== activeCutId) {
			activeCutId = newId;
			scheduleRender();
		}
	}

	function findCutAt (time) {
		var pl = getPipeline();
		if (!pl || !pl.getGhostCuts) return null;
		var cuts = pl.getGhostCuts();
		for (var i = 0; i < cuts.length; i++) {
			var c = cuts[i];
			if (c.state === 'dismissed' || c.state === 'executed') continue;
			if (time >= c.start && time <= c.end) return c;
		}
		return null;
	}

	w.IHackGhostOverlay = { init: init, render: scheduleRender, resize: resize };

})(window);
