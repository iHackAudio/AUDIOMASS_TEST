(function (w) {
	'use strict';

	// ══════════════════════════════════════════════════════════════
	//  Review Panel — floating card-based cut review workflow
	// ══════════════════════════════════════════════════════════════

	var panel = null;
	var body = null;
	var counterEl = null;
	var app = null;
	var currentCutIdx = 0;
	var isOpen = false;

	function init (appRef) {
		app = appRef;
		createPanel ();

		// Listen for pipeline events
		var pipeline = w.IHackPipeline;
		if (pipeline) {
			pipeline.on ('ghostcuts:updated', function () { if (isOpen) refresh (); });
			pipeline.on ('cuts:executed', function () { if (isOpen) refresh (); });
		}

		// Listen for cut click from overlay
		app.listenFor ('ihack:cutClicked', function (cut) {
			if (!isOpen) open ();
			highlightCut (cut.id);
		});
	}

	function createPanel () {
		panel = document.createElement ('div');
		panel.className = 'ihack-review-panel';
		panel.innerHTML =
			'<div class="ihack-rp-header">' +
				'<span class="ihack-rp-title">✂ Cut Review</span>' +
				'<span class="ihack-rp-counter" id="ihack-rp-counter">0/0</span>' +
				'<button class="ihack-rp-close" id="ihack-rp-close">✕</button>' +
			'</div>' +
			'<div class="ihack-rp-stats" id="ihack-rp-stats"></div>' +
			'<div class="ihack-rp-body" id="ihack-rp-body"></div>' +
			'<div class="ihack-rp-actions">' +
				'<button class="ihack-rp-btn ihack-rp-btn-execute-all" id="ihack-rp-execute-all">✂ Execute All Pending</button>' +
				'<button class="ihack-rp-btn ihack-rp-btn-execute-high" id="ihack-rp-execute-high">⚡ High Confidence Only</button>' +
			'</div>' +
			'<div class="ihack-rp-nav">' +
				'<button class="ihack-rp-nav-btn" id="ihack-rp-prev">◀ Prev</button>' +
				'<button class="ihack-rp-nav-btn" id="ihack-rp-next">Next ▶</button>' +
			'</div>';

		document.body.appendChild (panel);

		// Make draggable
		var header = panel.querySelector ('.ihack-rp-header');
		makeDraggable (panel, header);

		// Events
		document.getElementById ('ihack-rp-close').addEventListener ('click', close);
		document.getElementById ('ihack-rp-execute-all').addEventListener ('click', executeAll);
		document.getElementById ('ihack-rp-execute-high').addEventListener ('click', executeHighConfidence);
		document.getElementById ('ihack-rp-prev').addEventListener ('click', prevCut);
		document.getElementById ('ihack-rp-next').addEventListener ('click', nextCut);

		counterEl = document.getElementById ('ihack-rp-counter');
		body = document.getElementById ('ihack-rp-body');

		// Position
		panel.style.right = '20px';
		panel.style.top = '80px';
	}

	function open () {
		if (!panel) createPanel ();
		panel.style.display = 'flex';
		isOpen = true;
		refresh ();
	}

	function close () {
		if (panel) panel.style.display = 'none';
		isOpen = false;
	}

	function toggle () {
		if (isOpen) close (); else open ();
	}

	function refresh () {
		var pipeline = w.IHackPipeline;
		if (!pipeline) return;

		var cuts = pipeline.getGhostCuts ();
		var pending = cuts.filter (function (c) { return c.state === 'pending'; });
		var high = pending.filter (function (c) { return c.confidence >= 0.85; });
		var confirmed = cuts.filter (function (c) { return c.state === 'confirmed'; });
		var executed = cuts.filter (function (c) { return c.state === 'executed'; });
		var saved = executed.reduce (function (a, c) { return a + (c.end - c.start); }, 0);

		// Counter
		counterEl.textContent = pending.length + '/' + cuts.length + ' pending';

		// Stats
		var statsEl = document.getElementById ('ihack-rp-stats');
		statsEl.innerHTML =
			'<div class="ihack-rp-stat"><span class="ihack-rp-stat-val" style="color:#a78bfa">' + pending.length + '</span><span class="ihack-rp-stat-lbl">Pending</span></div>' +
			'<div class="ihack-rp-stat"><span class="ihack-rp-stat-val" style="color:#ef4444">' + high.length + '</span><span class="ihack-rp-stat-lbl">High Conf</span></div>' +
			'<div class="ihack-rp-stat"><span class="ihack-rp-stat-val" style="color:#34d399">' + executed.length + '</span><span class="ihack-rp-stat-lbl">Executed</span></div>' +
			'<div class="ihack-rp-stat"><span class="ihack-rp-stat-val" style="color:#22d3ee">' + saved.toFixed (1) + 's</span><span class="ihack-rp-stat-lbl">Saved</span></div>';

		// Cards
		var html = '';
		var visible = cuts.filter (function (c) { return c.state !== 'dismissed'; });

		for (var i = 0; i < visible.length; i++) {
			var c = visible[i];
			var confClass = c.confidence >= 0.85 ? 'high' : c.confidence >= 0.60 ? 'med' : 'low';
			var confColor = c.confidence >= 0.85 ? '#ef4444' : c.confidence >= 0.60 ? '#f59e0b' : '#7a8ba0';
			var stateClass = c.state === 'executed' ? 'executed' : c.state === 'confirmed' ? 'confirmed' : '';

			html += '<div class="ihack-rp-card ' + confClass + ' ' + stateClass + '" data-cut-id="' + c.id + '" data-idx="' + i + '">' +
				'<div class="ihack-rp-card-header">' +
					'<span class="ihack-rp-card-cat ' + confClass + '">' + c.category.replace (/_/g, ' ') + '</span>' +
					'<span class="ihack-rp-card-time" data-time="' + c.start + '">' + fmtTime (c.start) + '–' + fmtTime (c.end) + '</span>' +
					'<span class="ihack-rp-card-conf" style="color:' + confColor + '">' + Math.round (c.confidence * 100) + '%</span>' +
				'</div>' +
				(c.text ? '<div class="ihack-rp-card-text">"' + escHtml (c.text.slice (0, 100)) + '"</div>' : '') +
				(c.reason ? '<div class="ihack-rp-card-reason">' + escHtml (c.reason) + '</div>' : '') +
				'<div class="ihack-rp-card-actions">' +
					'<button class="ihack-rp-cab ihack-rp-cab-execute" data-cut-id="' + c.id + '">✂ Execute</button>' +
					'<button class="ihack-rp-cab ihack-rp-cab-keep" data-cut-id="' + c.id + '">✓ Keep</button>' +
					'<button class="ihack-rp-cab ihack-rp-cab-dismiss" data-cut-id="' + c.id + '">✕ Dismiss</button>' +
				'</div>' +
			'</div>';
		}

		if (!visible.length) {
			html = '<div class="ihack-rp-empty">No cuts to review.<br>Run the AI pipeline first.</div>';
		}

		body.innerHTML = html;

		// Wire card events
		var cards = body.querySelectorAll ('.ihack-rp-card');
		for (var i = 0; i < cards.length; i++) {
			cards[i].querySelector ('.ihack-rp-card-time').addEventListener ('click', onTimeClick);
			cards[i].querySelector ('.ihack-rp-cab-execute').addEventListener ('click', onExecuteCut);
			cards[i].querySelector ('.ihack-rp-cab-keep').addEventListener ('click', onKeepCut);
			cards[i].querySelector ('.ihack-rp-cab-dismiss').addEventListener ('click', onDismissCut);
			cards[i].addEventListener ('click', onCardClick);
		}
	}

	function onTimeClick (e) {
		e.stopPropagation ();
		var time = parseFloat (this.getAttribute ('data-time'));
		var duration = app.engine.wavesurfer.getDuration ();
		app.fireEvent ('RequestSeekTo', time / duration);
	}

	function onCardClick (e) {
		if (e.target.classList.contains ('ihack-rp-cab')) return;
		var card = this;
		var time = parseFloat (card.querySelector ('.ihack-rp-card-time').getAttribute ('data-time'));
		var duration = app.engine.wavesurfer.getDuration ();
		app.fireEvent ('RequestSeekTo', time / duration);

		// Highlight
		var allCards = body.querySelectorAll ('.ihack-rp-card');
		for (var i = 0; i < allCards.length; i++) allCards[i].classList.remove ('active');
		card.classList.add ('active');
	}

	function onExecuteCut (e) {
		e.stopPropagation ();
		var cutId = this.getAttribute ('data-cut-id');
		executeSingleCut (cutId);
	}

	function onKeepCut (e) {
		e.stopPropagation ();
		var cutId = this.getAttribute ('data-cut-id');
		var pipeline = w.IHackPipeline;
		var cuts = pipeline.getGhostCuts ();
		var cut = cuts.find (function (c) { return c.id === cutId; });
		if (cut) { cut.state = 'confirmed'; }
		refresh ();
		w.IHackGhostOverlay.render ();
	}

	function onDismissCut (e) {
		e.stopPropagation ();
		var cutId = this.getAttribute ('data-cut-id');
		var pipeline = w.IHackPipeline;
		var cuts = pipeline.getGhostCuts ();
		var cut = cuts.find (function (c) { return c.id === cutId; });
		if (cut) { cut.state = 'dismissed'; }
		refresh ();
		w.IHackGhostOverlay.render ();
	}

	function executeSingleCut (cutId) {
		var pipeline = w.IHackPipeline;
		var cuts = pipeline.getGhostCuts ();
		var cut = cuts.find (function (c) { return c.id === cutId; });
		if (!cut || cut.state === 'executed') return;

		cut.state = 'confirmed';
		var buffer = app.engine.wavesurfer.backend.buffer;

		pipeline.executeCuts (buffer, [cut], app).then (function (newBuffer) {
			if (newBuffer && newBuffer !== buffer) {
				app.engine.FXPreviewHost.OverwriteBuffer (newBuffer);
			}
			refresh ();
			w.IHackGhostOverlay.render ();
			showToast ('✂ Cut executed: ' + cut.category, 'ok');
		}).catch (function (err) {
			showToast ('Cut failed: ' + err.message, 'err');
		});
	}

	function executeAll () {
		var pipeline = w.IHackPipeline;
		var cuts = pipeline.getGhostCuts ();
		var pending = cuts.filter (function (c) { return c.state === 'pending' || c.state === 'confirmed'; });
		if (!pending.length) { showToast ('No cuts to execute', 'warn'); return; }

		var buffer = app.engine.wavesurfer.backend.buffer;
		pipeline.executeCuts (buffer, pending, app).then (function (newBuffer) {
			if (newBuffer && newBuffer !== buffer) {
				app.engine.FXPreviewHost.OverwriteBuffer (newBuffer);
			}
			refresh ();
			w.IHackGhostOverlay.render ();
			showToast ('✂ Executed ' + pending.length + ' cuts', 'ok');
		}).catch (function (err) {
			showToast ('Execute failed: ' + err.message, 'err');
		});
	}

	function executeHighConfidence () {
		var pipeline = w.IHackPipeline;
		var cuts = pipeline.getGhostCuts ();
		var high = cuts.filter (function (c) { return c.state === 'pending' && c.confidence >= 0.85; });
		if (!high.length) { showToast ('No high-confidence cuts', 'warn'); return; }

		var buffer = app.engine.wavesurfer.backend.buffer;
		high.forEach (function (c) { c.state = 'confirmed'; });
		pipeline.executeCuts (buffer, high, app).then (function (newBuffer) {
			if (newBuffer && newBuffer !== buffer) {
				app.engine.FXPreviewHost.OverwriteBuffer (newBuffer);
			}
			refresh ();
			w.IHackGhostOverlay.render ();
			showToast ('⚡ Executed ' + high.length + ' high-confidence cuts', 'ok');
		}).catch (function (err) {
			showToast ('Execute failed: ' + err.message, 'err');
		});
	}

	function highlightCut (cutId) {
		var cards = body.querySelectorAll ('.ihack-rp-card');
		for (var i = 0; i < cards.length; i++) {
			if (cards[i].getAttribute ('data-cut-id') === cutId) {
				cards[i].classList.add ('active');
				cards[i].scrollIntoView ({ behavior: 'smooth', block: 'nearest' });
			} else {
				cards[i].classList.remove ('active');
			}
		}
	}

	function prevCut () {
		var cards = body.querySelectorAll ('.ihack-rp-card');
		if (!cards.length) return;
		currentCutIdx = Math.max (0, currentCutIdx - 1);
		navigateToCard (cards, currentCutIdx);
	}

	function nextCut () {
		var cards = body.querySelectorAll ('.ihack-rp-card');
		if (!cards.length) return;
		currentCutIdx = Math.min (cards.length - 1, currentCutIdx + 1);
		navigateToCard (cards, currentCutIdx);
	}

	function navigateToCard (cards, idx) {
		for (var i = 0; i < cards.length; i++) cards[i].classList.remove ('active');
		if (cards[idx]) {
			cards[idx].classList.add ('active');
			cards[idx].scrollIntoView ({ behavior: 'smooth', block: 'nearest' });
			var time = parseFloat (cards[idx].querySelector ('.ihack-rp-card-time').getAttribute ('data-time'));
			var duration = app.engine.wavesurfer.getDuration ();
			app.fireEvent ('RequestSeekTo', time / duration);
		}
	}

	// ── Draggable ──

	function makeDraggable (el, handle) {
		var dragging = false, startX, startY, startLeft, startTop;
		handle.addEventListener ('mousedown', function (e) {
			dragging = true;
			startX = e.clientX;
			startY = e.clientY;
			var rect = el.getBoundingClientRect ();
			startLeft = rect.left;
			startTop = rect.top;
			e.preventDefault ();
		});
		document.addEventListener ('mousemove', function (e) {
			if (!dragging) return;
			el.style.left = (startLeft + e.clientX - startX) + 'px';
			el.style.top = (startTop + e.clientY - startY) + 'px';
			el.style.right = 'auto';
		});
		document.addEventListener ('mouseup', function () { dragging = false; });
	}

	// ── Helpers ──

	function fmtTime (s) {
		var m = Math.floor (s / 60);
		var sec = s % 60;
		return String (m).padStart (2, '0') + ':' + sec.toFixed (1).padStart (4, '0');
	}

	function escHtml (str) {
		return str.replace (/&/g, '&amp;').replace (/</g, '&lt;').replace (/>/g, '&gt;');
	}

	function showToast (msg, type) {
		var toast = document.createElement ('div');
		toast.className = 'ihack-toast ' + (type || '');
		toast.textContent = msg;
		var container = document.getElementById ('ihack-toasts');
		if (!container) {
			container = document.createElement ('div');
			container.id = 'ihack-toasts';
			document.body.appendChild (container);
		}
		container.appendChild (toast);
		setTimeout (function () {
			toast.classList.add ('out');
			setTimeout (function () { toast.remove (); }, 200);
		}, 3000);
	}

	w.IHackReviewPanel = {
		init: init,
		open: open,
		close: close,
		toggle: toggle,
		refresh: refresh,
	};

}) (window);
