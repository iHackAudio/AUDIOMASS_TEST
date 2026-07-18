(function (w) {
	'use strict';

	var canvas = null, ctx = null, app = null, wavesurfer = null, container = null, rafId = null;
	var activeCutId = null, hoveredCutId = null;

	// Colors from Python styles.py — exact match
	var COLORS = {
		// Cut states (CUT_PENDING_HIGH/MED/LOW/CONFIRMED/EDITED/MANUAL)
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
			pending_high: 'rgba(239, 68, 68, 0.7)',
			pending_med:  'rgba(245, 158, 11, 0.6)',
			pending_low:  'rgba(122, 139, 160, 0.4)',
			confirmed:    'rgba(52, 211, 153, 0.5)',
			edited:       'rgba(99, 102, 241, 0.5)',
			executed:     'rgba(52, 211, 153, 0.2)',
			hovered:      'rgba(99, 102, 241, 0.8)',
		},
		// Midpoint markers (MIDPOINT_CONFIRMED / MIDPOINT_UNCONFIRMED)
		midpoint: {
			CLEAN_SILENCE: { fill: 'rgba(52, 211, 153, 0.5)', dot: 'rgba(52, 211, 153, 0.8)' },
			NOISY_SILENCE: { fill: 'rgba(245, 158, 11, 0.4)', dot: 'rgba(245, 158, 11, 0.7)' },
			TIGHT:         { fill: 'rgba(245, 158, 11, 0.4)', dot: 'rgba(245, 158, 11, 0.7)' },
			TIGHT_CLEAN:   { fill: 'rgba(245, 158, 11, 0.4)', dot: 'rgba(245, 158, 11, 0.7)' },
			BREATH:        { fill: 'rgba(122, 139, 160, 0.3)', dot: 'rgba(122, 139, 160, 0.5)' },
		},
		// Selection (SELECTION_COLOR)
		selection: 'rgba(99, 102, 241, 0.12)',
		selection_border: 'rgba(99, 102, 241, 0.7)',
	};

	function init (appRef) {
		app = appRef;
		wavesurfer = app.engine.wavesurfer;
		container = wavesurfer.drawer.wrapper;

		var parent = container.parentNode || container;
		canvas = document.createElement ('canvas');
		canvas.id = 'ihack-ghost-canvas';
		canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
		if (parent.style.position !== 'relative' && parent.style.position !== 'absolute') {
			parent.style.position = 'relative';
		}
		parent.appendChild (canvas);
		ctx = canvas.getContext ('2d');

		parent.addEventListener ('click', onClick);
		parent.addEventListener ('mousemove', onMouseMove);
		parent.addEventListener ('mouseleave', function () { hoveredCutId = null; scheduleRender (); });

		app.listenFor ('DidDownloadFile', function () { setTimeout (resize, 100); });
		app.listenFor ('RequestResize', resize);
		app.listenFor ('DidResize', resize);
		app.listenFor ('RequestSeekTo', scheduleRender);

		var pipeline = window.IHackPipeline;
		if (pipeline) {
			pipeline.on ('ghostcuts:updated', scheduleRender);
			pipeline.on ('state:changed', scheduleRender);
			pipeline.on ('cuts:executed', scheduleRender);
		}

		console.log ('[iHack GhostOverlay] Init OK');
		setTimeout (resize, 200);
	}

	function resize () {
		if (!canvas || !container) return;
		var parent = canvas.parentNode;
		var rect = parent ? parent.getBoundingClientRect () : container.getBoundingClientRect ();
		var dpr = window.devicePixelRatio || 1;
		canvas.width = rect.width * dpr;
		canvas.height = rect.height * dpr;
		canvas.style.width = rect.width + 'px';
		canvas.style.height = rect.height + 'px';
		ctx.setTransform (dpr, 0, 0, dpr, 0, 0);
		scheduleRender ();
	}

	function scheduleRender () {
		if (rafId) cancelAnimationFrame (rafId);
		rafId = requestAnimationFrame (render);
	}

	function render () {
		if (!ctx || !canvas) return;
		var W = canvas.width / (window.devicePixelRatio || 1);
		var H = canvas.height / (window.devicePixelRatio || 1);
		ctx.clearRect (0, 0, W, H);

		var pipeline = window.IHackPipeline;
		if (!pipeline) return;

		var state = pipeline.getState ();
		var duration = wavesurfer.getDuration ();
		if (!duration || duration <= 0) return;

		function tX (t) { return (t / duration) * W; }

		// ── Midpoint markers ──
		var midpoints = state.midpoints || [];
		for (var i = 0; i < midpoints.length; i++) {
			var mp = midpoints[i];
			var x = tX (mp.time);
			var colors = COLORS.midpoint[mp.gap_type] || COLORS.midpoint.BREATH;
			ctx.strokeStyle = colors.fill;
			ctx.lineWidth = 1;
			ctx.setLineDash ([4, 3]);
			ctx.beginPath ();
			ctx.moveTo (x, 0);
			ctx.lineTo (x, H);
			ctx.stroke ();
			ctx.setLineDash ([]);
			ctx.fillStyle = colors.dot;
			ctx.beginPath ();
			ctx.arc (x, H / 2, 3, 0, Math.PI * 2);
			ctx.fill ();
		}

		// ── Ghost cuts ──
		var cuts = state.ghostCuts || [];
		for (var i = 0; i < cuts.length; i++) {
			var cut = cuts[i];
			if (cut.state === 'dismissed') continue;
			var x1 = Math.max (0, tX (cut.start));
			var x2 = Math.min (W, tX (cut.end));
			var w = Math.max (1, x2 - x1);

			var fill, border;
			if (cut.id === activeCutId) {
				fill = COLORS.active; border = COLORS.border.hovered;
			} else if (cut.id === hoveredCutId) {
				fill = COLORS.hovered; border = COLORS.border.hovered;
			} else if (cut.state === 'executed') {
				fill = COLORS.executed; border = COLORS.border.executed;
			} else if (cut.state === 'confirmed') {
				fill = COLORS.confirmed; border = COLORS.border.confirmed;
			} else if (cut.state === 'edited') {
				fill = COLORS.edited; border = COLORS.border.edited;
			} else if (cut.confidence >= 0.85) {
				fill = COLORS.pending_high; border = COLORS.border.pending_high;
			} else if (cut.confidence >= 0.60) {
				fill = COLORS.pending_med; border = COLORS.border.pending_med;
			} else {
				fill = COLORS.pending_low; border = COLORS.border.pending_low;
			}

			ctx.fillStyle = fill;
			ctx.fillRect (x1, 0, w, H);
			ctx.strokeStyle = border;
			ctx.lineWidth = (cut.id === hoveredCutId || cut.id === activeCutId) ? 2 : 1.5;
			ctx.strokeRect (x1, 0, w, H);

			if (w > 50) {
				ctx.fillStyle = 'rgba(255,255,255,0.5)';
				ctx.font = '9px monospace';
				ctx.fillText (cut.category.replace (/_/g, ' '), x1 + 4, 14);
			}
			if (w > 80) {
				var confColor = cut.confidence >= 0.85 ? '#ef4444' : cut.confidence >= 0.60 ? '#f59e0b' : '#7a8ba0';
				ctx.fillStyle = confColor;
				ctx.font = 'bold 10px monospace';
				ctx.fillText (Math.round (cut.confidence * 100) + '%', x2 - 30, 14);
			}
		}
	}

	function onClick (e) {
		var rect = canvas.parentNode.getBoundingClientRect ();
		var x = e.clientX - rect.left;
		var W = rect.width;
		var duration = wavesurfer.getDuration ();
		var time = (x / W) * duration;
		var cut = findCutAt (time);
		if (cut) {
			app.fireEvent ('RequestSeekTo', cut.start / duration);
			app.fireEvent ('ihack:cutClicked', cut);
			activeCutId = cut.id;
		} else {
			app.fireEvent ('RequestSeekTo', time / duration);
			activeCutId = null;
		}
		scheduleRender ();
	}

	function onMouseMove (e) {
		var rect = canvas.parentNode.getBoundingClientRect ();
		var x = e.clientX - rect.left;
		var W = rect.width;
		var duration = wavesurfer.getDuration ();
		var time = (x / W) * duration;
		var cut = findCutAt (time);
		var newId = cut ? cut.id : null;
		if (newId !== hoveredCutId) {
			hoveredCutId = newId;
			canvas.parentNode.style.cursor = hoveredCutId ? 'pointer' : 'default';
			scheduleRender ();
		}
	}

	function findCutAt (time) {
		var pipeline = window.IHackPipeline;
		if (!pipeline) return null;
		var cuts = pipeline.getGhostCuts ();
		for (var i = 0; i < cuts.length; i++) {
			var c = cuts[i];
			if (c.state === 'dismissed' || c.state === 'executed') continue;
			if (time >= c.start && time <= c.end) return c;
		}
		return null;
	}

	function setActiveCut (cutId) {
		activeCutId = cutId;
		scheduleRender ();
	}

	w.IHackGhostOverlay = {
		init: init,
		render: scheduleRender,
		resize: resize,
		setActiveCut: setActiveCut,
	};

}) (window);
