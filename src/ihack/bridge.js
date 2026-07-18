(function (w, d) {
	'use strict';

	// ══════════════════════════════════════════════════════════════
	//  iHack Bridge — initializes all iHack modules on AudioMass
	// ══════════════════════════════════════════════════════════════

	function init (app) {
		console.log ('[iHack] Initializing AI pipeline bridge...');

		// Load CSS
		var link = d.createElement ('link');
		link.rel = 'stylesheet';
		link.href = 'ihack/ihack.css';
		d.head.appendChild (link);

		// Initialize modules
		w.IHackGhostOverlay.init (app);
		w.IHackReviewPanel.init (app);

		// Inject pipeline status bar into AudioMass UI
	 injectPipelineBar (app);

		// Inject settings into AudioMass modal system
		injectSettings (app);

		// Wire keyboard shortcuts
		d.addEventListener ('keydown', function (e) {
			// R — toggle review panel
			if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInputFocused ()) {
				w.IHackReviewPanel.toggle ();
			}
		});

		// Capture original File BEFORE AudioMass decodes it
		// AudioMass drag handler converts File→ArrayBuffer via FileReader,
		// so we intercept the drop event to grab the original File object
		d.addEventListener ('drop', function (e) {
			var files = e.dataTransfer && e.dataTransfer.files;
			if (files && files.length > 0) {
				var file = files[0];
				if (file.type && file.type.indexOf ('audio/') === 0) {
					originalFile = file;
					console.log ('[iHack] Captured original file:', file.name, (file.size / (1024*1024)).toFixed (1) + 'MB');
				}
			}
		}, true); // Use capture phase to fire BEFORE AudioMass handler

		// Also capture from file input dialog
		d.addEventListener ('change', function (e) {
			if (e.target && e.target.files && e.target.files.length > 0) {
				var file = e.target.files[0];
				if (file.type && file.type.indexOf ('audio/') === 0) {
					originalFile = file;
					console.log ('[iHack] Captured original file:', file.name, (file.size / (1024*1024)).toFixed (1) + 'MB');
				}
			}
		}, true);

		// Listen for audio load to show pipeline bar
		app.listenFor ('DidDownloadFile', function () {
			var bar = d.getElementById ('ihack-pipeline-bar');
			if (bar) bar.style.display = 'flex';
		});

		// Initialize console panel
		injectConsolePanel (app);

		console.log ('[iHack] Bridge initialized.');
	}

	// ── Pipeline Bar ──

	function injectPipelineBar (app) {
		var bar = d.createElement ('div');
		bar.id = 'ihack-pipeline-bar';
		bar.className = 'ihack-pipeline-bar';
		bar.style.display = 'none';
		bar.innerHTML =
			'<span style="font-size:10px;font-weight:700;color:#a78bfa;margin-right:4px;">iHack</span>' +
			'<div class="ihack-pipeline-pass" data-pass="1">🎤 1</div>' +
			'<div class="ihack-pipeline-pass" data-pass="2">🔍 2</div>' +
			'<div class="ihack-pipeline-pass" data-pass="3">🤖 3</div>' +
			'<div class="ihack-pipeline-pass" data-pass="4">🛡 4</div>' +
			'<div class="ihack-pipeline-pass" data-pass="5">✂ 5</div>' +
			'<button class="ihack-pipeline-pass" id="ihack-run-all" style="margin-left:8px;background:#a78bfa;color:#0b0e14;border-color:#a78bfa;">▶ Run All</button>' +
			'<button class="ihack-pipeline-pass" id="ihack-show-settings" style="margin-left:4px;">⚙ Settings</button>' +
			'<button class="ihack-pipeline-pass" id="ihack-show-review" style="margin-left:4px;">📋 Review</button>' +
			'<span class="ihack-pipeline-status" id="ihack-pipeline-status">● Ready</span>';

		// Insert before the main editor area
		var editor = app.el;
		if (editor) editor.insertBefore (bar, editor.firstChild);

		// Wire pass buttons
		var passes = bar.querySelectorAll ('.ihack-pipeline-pass[data-pass]');
		for (var i = 0; i < passes.length; i++) {
			passes[i].addEventListener ('click', function () {
				var passNum = parseInt (this.getAttribute ('data-pass'));
				runPass (app, passNum, this);
			});
		}

		// Run All
		d.getElementById ('ihack-run-all').addEventListener ('click', function () {
			runAllPasses (app);
		});

		// Review
		d.getElementById ('ihack-show-review').addEventListener ('click', function () {
			w.IHackReviewPanel.toggle ();
		});

		// Settings
		d.getElementById ('ihack-show-settings').addEventListener ('click', function () {
			openSettingsModal ();
		});

		// Listen for pipeline events
		var pipeline = w.IHackPipeline;
		pipeline.on ('pass:start', function (data) {
			var el = bar.querySelector ('[data-pass="' + data.pass + '"]');
			if (el) { el.className = 'ihack-pipeline-pass running'; }
			d.getElementById ('ihack-pipeline-status').textContent = '● Pass ' + data.pass + ' running...';
		});
		pipeline.on ('pass:done', function (data) {
			var el = bar.querySelector ('[data-pass="' + data.pass + '"]');
			if (el) { el.className = 'ihack-pipeline-pass done'; el.textContent = el.textContent.replace (' ✓', '') + ' ✓'; }
			d.getElementById ('ihack-pipeline-status').textContent = '● Pass ' + data.pass + ' done';
		});
		pipeline.on ('pass:error', function (data) {
			var el = bar.querySelector ('[data-pass="' + data.pass + '"]');
			if (el) { el.className = 'ihack-pipeline-pass error'; }
			d.getElementById ('ihack-pipeline-status').textContent = '● Pass ' + data.pass + ' error';
		});
	}

	// ── Run Passes ──

	async function runPass (app, passNum, btnEl) {
		var pipeline = w.IHackPipeline;
		var statusEl = d.getElementById ('ihack-pipeline-status');
		var buffer = app.engine.wavesurfer.backend.buffer;

		try {
			switch (passNum) {
				case 1:
					// Transcribe — send original file if captured, otherwise WAV
					if (originalFile) {
						var sizeMB = (originalFile.size / (1024 * 1024)).toFixed (1);
						logConsole ('Sending to Groq Whisper... (' + originalFile.name + ', ' + sizeMB + 'MB)', 'info');
						if (originalFile.size > 25 * 1024 * 1024) {
							logConsole ('⚠ Audio too large (' + sizeMB + 'MB > 25MB).', 'error');
							break;
						}
						await pipeline.transcribe (originalFile);
					} else {
						logConsole ('⚠ No original file captured, sending WAV...', 'warn');
						var blob = await audioBufferToBlob (buffer);
						logConsole ('Sending audio to Groq Whisper... (' + (blob.size / 1024).toFixed (0) + 'KB)', 'info');
						await pipeline.transcribe (blob);
					}
					logConsole ('✓ Transcription complete: ' + pipeline.getSegments ().length + ' segments', 'ok');
					break;
				case 2:
					await pipeline.detectAnchors (buffer);
					break;
				case 3:
					await pipeline.analyze ();
					w.IHackReviewPanel.open ();
					break;
				case 4:
					await pipeline.runQC ();
					break;
				case 5:
					var cuts = pipeline.getGhostCuts ();
					var toExecute = cuts.filter (function (c) { return c.state === 'pending' || c.state === 'confirmed'; });
					if (!toExecute.length) { showBridgeToast ('No cuts to execute', 'warn'); return; }
					var newBuf = await pipeline.executeCuts (buffer, toExecute, app);
					if (newBuf && newBuf !== buffer) {
						app.engine.FXPreviewHost.OverwriteBuffer (newBuf);
					}
					break;
			}
		} catch (err) {
			showBridgeToast ('Pass ' + passNum + ' failed: ' + err.message, 'err');
		}
	}

	async function runAllPasses (app) {
		var bar = d.getElementById ('ihack-pipeline-bar');
		var statusEl = d.getElementById ('ihack-pipeline-status');
		statusEl.textContent = '● Running full pipeline...';

		for (var p = 1; p <= 5; p++) {
			var btn = bar.querySelector ('[data-pass="' + p + '"]');
			await runPass (app, p, btn);
		}

		statusEl.textContent = '● Pipeline complete';
		showBridgeToast ('✅ Full pipeline complete!', 'ok');
	}

	// ── Settings Modal ──

	function openSettingsModal () {
		// Remove existing modal if any
		var existing = d.getElementById ('ihack-settings-modal');
		if (existing) { existing.remove (); return; }

		var cfg = w.IHackConfig;
		var providers = ['gemini', 'groq', 'openrouter'];
		var currentProvider = cfg.get ('provider');
		var models = cfg.PROVIDER_MODELS[currentProvider] || [];

		var overlay = d.createElement ('div');
		overlay.id = 'ihack-settings-modal';
		overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999;display:flex;align-items:center;justify-content:center;';

		var modal = d.createElement ('div');
		modal.style.cssText = 'background:#161b26;border:1px solid #252d3d;border-radius:8px;width:400px;max-height:80vh;overflow-y:auto;box-shadow:0 16px 48px rgba(0,0,0,0.6);font-family:Inter,system-ui,sans-serif;';

		modal.innerHTML =
			'<div style="padding:12px 16px;border-bottom:1px solid #252d3d;display:flex;align-items:center;justify-content:space-between;">' +
				'<span style="font-size:13px;font-weight:700;color:#e2e8f0;">⚙ iHack AI Settings</span>' +
				'<button id="ihack-cfg-close" style="background:none;border:none;color:#7a8ba0;cursor:pointer;font-size:16px;">✕</button>' +
			'</div>' +

			'<div style="padding:16px;">' +
				'<div style="margin-bottom:14px;">' +
					'<label style="display:block;font-size:10px;font-weight:600;text-transform:uppercase;color:#3d4a5e;margin-bottom:4px;">Groq API Key (Whisper)</label>' +
					'<input id="ihack-cfg-groq" type="password" value="' + (cfg.get ('groqKey') || '') + '" placeholder="gsk_..." style="width:100%;padding:8px;background:#111620;border:1px solid #252d3d;border-radius:4px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;outline:none;box-sizing:border-apple;">' +
				'</div>' +

				'<div style="margin-bottom:14px;">' +
					'<label style="display:block;font-size:10px;font-weight:600;text-transform:uppercase;color:#3d4a5e;margin-bottom:4px;">Analysis Provider</label>' +
					'<select id="ihack-cfg-provider" style="width:100%;padding:8px;background:#111620;border:1px solid #252d3d;border-radius:4px;color:#e2e8f0;font-size:11px;cursor:pointer;outline:none;">' +
						providers.map (function (p) { return '<option value="' + p + '"' + (currentProvider === p ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>'; }).join ('') +
					'</select>' +
				'</div>' +

				'<div style="margin-bottom:14px;">' +
					'<label style="display:block;font-size:10px;font-weight:600;text-transform:uppercase;color:#3d4a5e;margin-bottom:4px;">API Key (Analysis)</label>' +
					'<input id="ihack-cfg-aikey" type="password" value="' + (cfg.getActiveKey () || '') + '" placeholder="AIza... or gsk_..." style="width:100%;padding:8px;background:#111620;border:1px solid #252d3d;border-radius:4px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;outline:none;box-sizing:border-box;">' +
				'</div>' +

				'<div style="margin-bottom:14px;">' +
					'<label style="display:block;font-size:10px;font-weight:600;text-transform:uppercase;color:#3d4a5e;margin-bottom:4px;">Model</label>' +
					'<select id="ihack-cfg-model" style="width:100%;padding:8px;background:#111620;border:1px solid #252d3d;border-radius:4px;color:#e2e8f0;font-size:11px;cursor:pointer;outline:none;">' +
						models.map (function (m) { return '<option' + (cfg.get('model') === m ? ' selected' : '') + '>' + m + '</option>'; }).join ('') +
					'</select>' +
				'</div>' +

				'<div style="margin-bottom:14px;">' +
					'<label style="display:block;font-size:10px;font-weight:600;text-transform:uppercase;color:#3d4a5e;margin-bottom:4px;">Custom AI Instructions</label>' +
					'<textarea id="ihack-cfg-custom" rows="3" placeholder="Leave empty for defaults..." style="width:100%;padding:8px;background:#111620;border:1px solid #252d3d;border-radius:4px;color:#e2e8f0;font-size:11px;outline:none;resize:vertical;box-sizing:border-box;font-family:Inter,system-ui,sans-serif;">' + (cfg.get ('customInstruction') || '') + '</textarea>' +
				'</div>' +

				'<button id="ihack-cfg-save" style="width:100%;padding:10px;background:#a78bfa;border:none;border-radius:4px;color:#0b0e14;font-size:12px;font-weight:700;cursor:pointer;">✓ Save Settings</button>' +
			'</div>';

		overlay.appendChild (modal);
		d.body.appendChild (overlay);

		// Events
		d.getElementById ('ihack-cfg-close').addEventListener ('click', function () { overlay.remove (); });
		overlay.addEventListener ('click', function (e) { if (e.target === overlay) overlay.remove (); });

		// Provider change → update model list
		d.getElementById ('ihack-cfg-provider').addEventListener ('change', function () {
			var prov = this.value;
			var newModels = cfg.PROVIDER_MODELS[prov] || [];
			var modelSelect = d.getElementById ('ihack-cfg-model');
			modelSelect.innerHTML = newModels.map (function (m) { return '<option>' + m + '</option>'; }).join ('');
		});

		// Save
		d.getElementById ('ihack-cfg-save').addEventListener ('click', function () {
			saveSettingsFromUI ();
			overlay.remove ();
		});
	}

	function buildSettingsHTML () {
		var cfg = w.IHackConfig;
		var providers = ['gemini', 'groq', 'openrouter'];
		var models = cfg.PROVIDER_MODELS[cfg.get ('provider')] || [];

		var html = '<div class="ihack-settings">' +
			'<h3>⚙ iHack AI Settings</h3>' +

			'<div class="ihack-settings-section">' +
				'<label class="ihack-settings-label">Groq API Key (Whisper Transcription)</label>' +
				'<input type="password" id="ihack-cfg-groq" value="' + (cfg.get ('groqKey') || '') + '" placeholder="gsk_...">' +
			'</div>' +

			'<div class="ihack-settings-section">' +
				'<label class="ihack-settings-label">Analysis Provider</label>' +
				'<select id="ihack-cfg-provider">' +
				providers.map (function (p) {
					return '<option value="' + p + '"' + (cfg.get ('provider') === p ? ' selected' : '') + '>' + p.charAt (0).toUpperCase () + p.slice (1) + '</option>';
				}).join ('') +
				'</select>' +
			'</div>' +

			'<div class="ihack-settings-section">' +
				'<label class="ihack-settings-label">API Key (Analysis)</label>' +
				'<input type="password" id="ihack-cfg-aikey" value="' + (cfg.getActiveKey () || '') + '" placeholder="AIza... or gsk_...">' +
			'</div>' +

			'<div class="ihack-settings-section">' +
				'<label class="ihack-settings-label">Model</label>' +
				'<select id="ihack-cfg-model">' +
				models.map (function (m) {
					return '<option' + (cfg.get ('model') === m ? ' selected' : '') + '>' + m + '</option>';
				}).join ('') +
				'</select>' +
			'</div>' +

			'<div class="ihack-settings-section">' +
				'<label class="ihack-settings-label">Custom AI Instructions</label>' +
				'<textarea id="ihack-cfg-custom" rows="3" placeholder="Leave empty for defaults...">' + (cfg.get ('customInstruction') || '') + '</textarea>' +
			'</div>' +

		'</div>';

		return html;
	}

	function saveSettingsFromUI () {
		var cfg = w.IHackConfig;
		var provider = d.getElementById ('ihack-cfg-provider');
		var aikey = d.getElementById ('ihack-cfg-aikey');

		cfg.set ('groqKey', (d.getElementById ('ihack-cfg-groq') || {}).value || '');
		cfg.set ('provider', provider ? provider.value : 'gemini');
		cfg.set ('model', (d.getElementById ('ihack-cfg-model') || {}).value || 'gemini-2.5-flash');
		cfg.set ('customInstruction', (d.getElementById ('ihack-cfg-custom') || {}).value || '');

		// Set the right key for the provider
		if (aikey) {
			if (provider && provider.value === 'gemini') cfg.set ('geminiKey', aikey.value);
			else if (provider && provider.value === 'openrouter') cfg.set ('openrouterKey', aikey.value);
			else cfg.set ('groqKey', aikey.value);
		}

		showBridgeToast ('✓ Settings saved', 'ok');
	}

	function injectSettings (app) {
		// Settings are now handled by the ⚙ button in pipeline bar
	}

	// ── Console / Log Panel ──

	var consoleEl = null;
	var consoleBody = null;
	var consoleVisible = false;

	function injectConsolePanel (app) {
		consoleEl = d.createElement ('div');
		consoleEl.id = 'ihack-console';
		consoleEl.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:200px;background:#0b0e14;border-top:1px solid #252d3d;z-index:400;display:none;flex-direction:column;font-family:"JetBrains Mono",monospace;';

		consoleEl.innerHTML =
			'<div style="display:flex;align-items:center;padding:4px 10px;background:#111620;border-bottom:1px solid #252d3d;cursor:pointer;user-select:none;">' +
				'<span style="font-size:10px;font-weight:700;color:#a78bfa;">🤖 iHack Console</span>' +
				'<span id="ihack-console-status" style="font-size:10px;color:#7a8ba0;margin-left:8px;">Ready</span>' +
				'<span style="margin-left:auto;font-size:10px;color:#3d4a5e;cursor:pointer;" id="ihack-console-clear">Clear</span>' +
				'<span style="margin-left:10px;font-size:10px;color:#3d4a5e;cursor:pointer;" id="ihack-console-close">✕</span>' +
			'</div>' +
			'<div id="ihack-console-body" style="flex:1;overflow-y:auto;padding:6px 10px;"></div>';

		d.body.appendChild (consoleEl);
		consoleBody = d.getElementById ('ihack-console-body');

		// Events
		d.getElementById ('ihack-console-close').addEventListener ('click', function () { toggleConsole (false); });
		d.getElementById ('ihack-console-clear').addEventListener ('click', function () { consoleBody.innerHTML = ''; });

		// Pipeline events → log
		var pipeline = w.IHackPipeline;

		pipeline.on ('pass:start', function (data) {
			logConsole ('--- Pass ' + data.pass + ' started ---', 'info');
			d.getElementById ('ihack-console-status').textContent = 'Pass ' + data.pass + ' running...';
		});

		pipeline.on ('pass:done', function (data) {
			var msg = '--- Pass ' + data.pass + ' complete ---';
			if (data.segments !== undefined) msg += ' (' + data.segments + ' segments, ' + data.words + ' words)';
			if (data.anchors !== undefined) msg += ' (' + data.anchors + ' anchors)';
			if (data.cuts !== undefined) msg += ' (' + data.cuts + ' cuts proposed)';
			if (data.issues !== undefined) msg += ' (' + data.issues + ' issues)';
			if (data.executed !== undefined) msg += ' (' + data.executed + ' cuts executed)';
			logConsole (msg, 'ok');
			d.getElementById ('ihack-console-status').textContent = 'Pass ' + data.pass + ' done';
		});

		pipeline.on ('pass:error', function (data) {
			logConsole ('ERROR: Pass ' + data.pass + ' — ' + data.error, 'error');
			d.getElementById ('ihack-console-status').textContent = 'Pass ' + data.pass + ' error';
		});

		pipeline.on ('state:changed', function (state) {
			// Log summary
			if (state.segments.length) logConsole ('  Segments: ' + state.segments.length, 'dim');
			if (state.midpoints.length) logConsole ('  Midpoints: ' + state.midpoints.length, 'dim');
			if (state.ghostCuts.length) {
				var pending = state.ghostCuts.filter (function (c) { return c.state === 'pending'; }).length;
				logConsole ('  Ghost Cuts: ' + state.ghostCuts.length + ' (' + pending + ' pending)', 'dim');
			}
		});

		pipeline.on ('cuts:executed', function (data) {
			logConsole ('✂ Executed ' + data.count + ' cuts — audio shortened', 'ok');
		});

		// Add console toggle button to pipeline bar
		var bar = d.getElementById ('ihack-pipeline-bar');
		if (bar) {
			var btn = d.createElement ('button');
			btn.className = 'ihack-pipeline-pass';
			btn.style.marginLeft = '4px';
			btn.textContent = '🖥 Console';
			btn.addEventListener ('click', function () { toggleConsole (); });
			bar.appendChild (btn);
		}
	}

	function toggleConsole (show) {
		if (!consoleEl) return;
		if (show === undefined) show = !consoleVisible;
		consoleEl.style.display = show ? 'flex' : 'none';
		consoleVisible = show;
	}

	function logConsole (msg, type) {
		if (!consoleBody) return;
		var line = d.createElement ('div');
		var color = '#7a8ba0'; // default
		if (type === 'ok') color = '#34d399';
		else if (type === 'error') color = '#ef4444';
		else if (type === 'info') color = '#a78bfa';
		else if (type === 'dim') color = '#3d4a5e';

		var time = new Date ().toLocaleTimeString ('en-US', { hour12: false });
		line.innerHTML = '<span style="color:#3d4a5e;">' + time + '</span> <span style="color:' + color + ';"><span style="color:#252d3d;">▸</span> ' + escHtml (msg) + '</span>';
		line.style.cssText = 'padding:1px 0;font-size:11px;';

		consoleBody.appendChild (line);
		consoleBody.scrollTop = consoleBody.scrollHeight;
	}

	// ── Helpers ──

	function audioBufferToBlob (buffer) {
		var sr = buffer.sampleRate;
		var numChannels = buffer.numberOfChannels;
		var data = buffer.getChannelData (0);
		var bitsPerSample = 16;
		var byteRate = sr * numChannels * bitsPerSample / 8;
		var blockAlign = numChannels * bitsPerSample / 8;
		var dataSize = data.length * blockAlign;
		var buf = new ArrayBuffer (44 + dataSize);
		var view = new DataView (buf);

		function writeStr (offset, str) {
			for (var i = 0; i < str.length; i++) view.setUint8 (offset + i, str.charCodeAt (i));
		}

		writeStr (0, 'RIFF');
		view.setUint32 (4, 36 + dataSize, true);
		writeStr (8, 'WAVE');
		writeStr (12, 'fmt ');
		view.setUint32 (16, 16, true);
		view.setUint16 (20, 1, true);
		view.setUint16 (22, numChannels, true);
		view.setUint32 (24, sr, true);
		view.setUint32 (28, byteRate, true);
		view.setUint16 (32, blockAlign, true);
		view.setUint16 (34, bitsPerSample, true);
		writeStr (36, 'data');
		view.setUint32 (40, dataSize, true);

		for (var i = 0; i < data.length; i++) {
			var s = Math.max (-1, Math.min (1, data[i]));
			view.setInt16 (44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
		}

		return new Blob ([buf], { type: 'audio/wav' });
	}

	function escHtml (str) {
		return str.replace (/&/g, '&amp;').replace (/</g, '&lt;').replace (/>/g, '&gt;');
	}

	function isInputFocused () {
		var el = d.activeElement;
		return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
	}

	function showBridgeToast (msg, type) {
		var toast = d.createElement ('div');
		toast.className = 'ihack-toast ' + (type || '');
		toast.textContent = msg;
		var container = d.getElementById ('ihack-toasts');
		if (!container) {
			container = d.createElement ('div');
			container.id = 'ihack-toasts';
			d.body.appendChild (container);
		}
		container.appendChild (toast);
		setTimeout (function () {
			toast.classList.add ('out');
			setTimeout (function () { toast.remove (); }, 200);
		}, 3000);
	}

	// ── Expose ──

	w.IHackBridge = { init: init };

}) (window, document);
