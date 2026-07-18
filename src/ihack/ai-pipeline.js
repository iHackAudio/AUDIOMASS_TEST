(function (w) {
	'use strict';

	// ══════════════════════════════════════════════════════════════
	//  iHack AI Pipeline — Transcribe, Anchors, Analyze, QC, Execute
	// ══════════════════════════════════════════════════════════════

	var CFG = function () { return w.IHackConfig; };
	var events = {};

	function emit (evt, data) {
		var list = events[evt];
		if (list) for (var i = 0; i < list.length; i++) list[i](data);
	}
	function on (evt, fn) {
		if (!events[evt]) events[evt] = [];
		events[evt].push (fn);
	}
	function off (evt, fn) {
		var list = events[evt];
		if (list) events[evt] = list.filter (function (f) { return f !== fn; });
	}

	// ── Pipeline State ──
	var state = {
		segments: [],       // [{id, start, end, text, speaker}]
		words: [],          // [{word, start, end}]
		midpoints: [],      // [{id, time, gap_ms, gap_type, vad_confirmed, between, ...}]
		ghostCuts: [],      // [{id, start, end, category, confidence, reason, text, state}]
		pipelineStatus: {   // per-pass status: idle|running|done|error
			1: 'idle', 2: 'idle', 3: 'idle', 4: 'idle', 5: 'idle',
		},
		running: false,
	};

	// ══════════════════════════════════════════════════════════════
	//  PASS 1 — TRANSCRIBE (Groq Whisper)
	// ══════════════════════════════════════════════════════════════

	async function transcribe (audioFile) {
		var cfg = CFG ();
		var key = cfg.get ('groqKey');
		if (!key) throw new Error ('Groq API key not set');

		state.pipelineStatus[1] = 'running';
		emit ('pass:start', { pass: 1 });

		try {
			// Send original file — don't convert to WAV (Python pipeline does this)
			var form = new FormData ();
			var fileName = audioFile.name || 'audio.mp3';
			form.append ('file', audioFile, fileName);
			form.append ('model', 'whisper-large-v3');
			form.append ('response_format', 'verbose_json');

			var resp = await fetch ('https://api.groq.com/openai/v1/audio/transcriptions', {
				method: 'POST',
				headers: { 'Authorization': 'Bearer ' + key },
				body: form,
			});

			if (!resp.ok) throw new Error ('Groq API ' + resp.status + ': ' + await resp.text ());
			var data = await resp.json ();
			var raw = data.segments || [];

			state.segments = raw.map (function (s, i) {
				return {
					id: 'T' + String (i + 1).padStart (3, '0'),
					start: round3 (s.start),
					end: round3 (s.end),
					text: (s.text || '').trim (),
					speaker: '',
				};
			});

			// Word-level timestamps
			state.words = [];
			if (data.words) {
				state.words = data.words.map (function (w) {
					return { word: w.word, start: round3 (w.start), end: round3 (w.end) };
				});
			}

			state.pipelineStatus[1] = 'done';
			emit ('pass:done', { pass: 1, segments: state.segments.length, words: state.words.length });
			emit ('state:changed', state);
			return state.segments;

		} catch (err) {
			state.pipelineStatus[1] = 'error';
			emit ('pass:error', { pass: 1, error: err.message });
			throw err;
		}
	}

	// ══════════════════════════════════════════════════════════════
	//  PASS 2 — ANCHOR DETECTION (RMS Silence + Gap Classification)
	// ══════════════════════════════════════════════════════════════

	async function detectAnchors (audioBuffer) {
		state.pipelineStatus[2] = 'running';
		emit ('pass:start', { pass: 2 });

		try {
			var sr = audioBuffer.sampleRate;
			var data = audioBuffer.getChannelData (0);
			var silences = detectSilences (data, sr, 0.01, 20, 80);
			var midpoints = computeMidpoints (state.segments, silences);

			state.midpoints = midpoints;
			state.pipelineStatus[2] = 'done';
			emit ('pass:done', { pass: 2, anchors: midpoints.length });
			emit ('state:changed', state);
			return midpoints;

		} catch (err) {
			state.pipelineStatus[2] = 'error';
			emit ('pass:error', { pass: 2, error: err.message });
			throw err;
		}
	}

	function detectSilences (data, sr, threshold, frameMs, minSilenceMs) {
		var frameSamples = Math.floor (sr * frameMs / 1000);
		var minFrames = Math.max (1, Math.floor (minSilenceMs / frameMs));
		var nFrames = Math.floor (data.length / frameSamples);
		var silences = [];
		var runStart = null;

		for (var i = 0; i < nFrames; i++) {
			var rms = 0;
			var offset = i * frameSamples;
			for (var j = 0; j < frameSamples && offset + j < data.length; j++) {
				rms += data[offset + j] * data[offset + j];
			}
			rms = Math.sqrt (rms / frameSamples);

			if (rms < threshold) {
				if (runStart === null) runStart = i;
			} else {
				if (runStart !== null) {
					if (i - runStart >= minFrames) {
						var tStart = runStart * frameMs / 1000;
						var tEnd = i * frameMs / 1000;
						silences.push ({ start: round3 (tStart), end: round3 (tEnd), mid: round3 ((tStart + tEnd) / 2), gap_ms: round1 ((tEnd - tStart) * 1000) });
					}
					runStart = null;
				}
			}
		}
		if (runStart !== null && nFrames - runStart >= minFrames) {
			var tStart = runStart * frameMs / 1000;
			var tEnd = nFrames * frameMs / 1000;
			silences.push ({ start: round3 (tStart), end: round3 (tEnd), mid: round3 ((tStart + tEnd) / 2), gap_ms: round1 ((tEnd - tStart) * 1000) });
		}
		return silences;
	}

	function computeMidpoints (segments, silences) {
		var midpoints = [];
		for (var i = 0; i < silences.length; i++) {
			var gap = silences[i];
			var beforeSeg = null, afterSeg = null;

			for (var j = 0; j < segments.length; j++) {
				if (segments[j].end <= gap.start + 0.05) beforeSeg = segments[j];
				if (segments[j].start >= gap.end - 0.05 && !afterSeg) { afterSeg = segments[j]; break; }
			}

			var between = [];
			if (beforeSeg) between.push (beforeSeg.id);
			if (afterSeg) between.push (afterSeg.id);

			var gapType;
			if (gap.gap_ms < 80) gapType = 'BREATH';
			else if (gap.gap_ms < 150) gapType = 'TIGHT';
			else gapType = 'CLEAN_SILENCE';

			midpoints.push ({
				id: 'M' + String (i + 1).padStart (3, '0'),
				time: gap.mid,
				between: between,
				gap_ms: gap.gap_ms,
				gap_start: gap.start,
				gap_end: gap.end,
				gap_type: gapType,
				vad_confirmed: gap.gap_ms >= 80,
				confidence: Math.min (1, 0.4 + (gap.gap_ms / 1000) * 2),
			});
		}
		return midpoints;
	}

	// ══════════════════════════════════════════════════════════════
	//  PASS 3 — AI ANALYSIS (Gemini / Groq / OpenRouter)
	// ══════════════════════════════════════════════════════════════

	async function analyze () {
		var cfg = CFG ();
		var key = cfg.getActiveKey ();
		if (!key) {
			logConsole ('⚠ No API key set. Open ⚙ Settings to add your Groq or Gemini key.', 'error');
			throw new Error ('API key not set — click ⚙ Settings to add your key');
		}

		state.pipelineStatus[3] = 'running';
		emit ('pass:start', { pass: 3 });

		try {
			var provider = cfg.get ('provider');
			var model = cfg.get ('model');
			var customInstr = cfg.get ('customInstruction') || '';

			var prompt = buildAnalysisPrompt (state.segments, state.midpoints, customInstr);

			var parsed;
			if (provider === 'gemini') {
				parsed = await callGeminiAPI (key, model, prompt.systemInstruction, prompt.userPrompt);
			} else if (provider === 'openrouter') {
				parsed = await callOpenRouter (key, model, prompt.systemInstruction, prompt.userPrompt);
			} else {
				try {
					parsed = await callGroqLLM (key, model, prompt.systemInstruction, prompt.userPrompt);
				} catch (groqErr) {
					logConsole ('Groq failed: ' + groqErr.message + '. Trying Gemini...', 'warn');
					parsed = await callGeminiAPI (key, model, prompt.systemInstruction, prompt.userPrompt);
				}
			}

			var intents = Array.isArray (parsed) ? parsed : (parsed.cut_intents || []);
			state.ghostCuts = [];

			for (var i = 0; i < intents.length; i++) {
				var item = intents[i];
				var startId = item.cut_start_midpoint || item.start_anchor || '';
				var endId = item.cut_end_midpoint || item.end_anchor || '';
				var startMp = findMidpoint (startId);
				var endMp = findMidpoint (endId);

				var startT, endT;
				if (startMp && endMp) {
					startT = startMp.time;
					endT = endMp.time;
				} else if (item.start_time != null && item.end_time != null) {
					startT = item.start_time;
					endT = item.end_time;
				} else {
					continue;
				}

				if (startT >= endT) continue;

				var conf = item.confidence || 0.5;
				state.ghostCuts.push ({
					id: 'gc-' + Math.random ().toString (36).slice (2, 8),
					start: round3 (startT),
					end: round3 (endT),
					start_midpoint_id: startId,
					end_midpoint_id: endId,
					category: item.category || 'UNKNOWN',
					label: item.reason || '',
					text: (item.target_segments || []).map (function (sid) {
						var seg = state.segments.find (function (s) { return s.id === sid; });
						return seg ? seg.text : '';
					}).join (' '),
					confidence: conf,
					reason: item.reason || '',
					state: 'pending',
				});
			}

			state.pipelineStatus[3] = 'done';
			emit ('pass:done', { pass: 3, cuts: state.ghostCuts.length });
			emit ('state:changed', state);
			emit ('ghostcuts:updated', state.ghostCuts);
			return state.ghostCuts;

		} catch (err) {
			state.pipelineStatus[3] = 'error';
			emit ('pass:error', { pass: 3, error: err.message });
			throw err;
		}
	}

	function findMidpoint (id) {
		return state.midpoints.find (function (m) { return m.id === id; }) || null;
	}

	// ── Prompt Builder (10 categories, aggressive) ──

	function buildAnalysisPrompt (segments, midpoints, customInstruction) {
		var segLines = segments.map (function (s) {
			return '  ' + s.id + ' [' + s.start.toFixed (1) + 's-' + s.end.toFixed (1) + 's] ' + s.text.slice (0, 80);
		}).join ('\n');

		var mpLines = midpoints.map (function (mp) {
			var status = mp.vad_confirmed ? '✓ RELIABLE' : '⚠ REVIEW';
			return '  ' + mp.id + ' | ' + mp.time.toFixed (2) + 's | ' + (mp.gap_ms || 0).toFixed (0) + 'ms | ' + (mp.confidence * 100).toFixed (0) + '% | ' + status;
		}).join ('\n');

		var transcriptFlat = segments.map (function (s) {
			return '  ' + s.id + ' [' + s.start.toFixed (1) + '-' + s.end.toFixed (1) + '] ' + s.text;
		}).join ('\n');

		var baseInstruction = 'You are a surgical audio editor analyzing podcast transcripts for removable content.\n' +
			'GOAL: Make the audio professional, engaging, and concise. Flag anything that doesn\'t add value.\n\n' +
			'AVAILABLE SEGMENTS:\n' + segLines + '\n\n' +
			'AVAILABLE MIDPOINTS (the ONLY valid cut boundaries):\n' + mpLines + '\n\n' +
			'RULES:\n' +
			'1. Every cut MUST use midpoint IDs for both start and end: {"cut_start_midpoint": "M001", "cut_end_midpoint": "M003"}\n' +
			'2. You may ALSO provide start_time/end_time in seconds as fallback.\n' +
			'3. Propose cuts AGGRESSIVELY — aim for 8-20+ cuts minimum.\n' +
			'4. Do NOT skip minor filler — every small cleanup adds up.\n' +
			'5. Prefer midpoints with confidence > 0.60.\n' +
			'6. If content doesn\'t align perfectly with midpoints, still propose it with time fallback.\n\n' +
			'ANALYSIS CATEGORIES (be thorough with ALL of these):\n' +
			'1. FILLER_ACK — Single-word acknowledgments: "Exactly", "Right", "Absolutely", "Yeah", "Sure"\n' +
			'2. FILLER_TRANS — Transition fillers: "So", "Now", "Look", "Well", "Okay so", "I mean"\n' +
			'3. FILLER_HEDGE — Hedging phrases: "You know", "I think", "Sort of", "Kind of", "Basically"\n' +
			'4. CONVERSATIONAL_FILLER — Banter that doesn\'t advance content\n' +
			'5. REDUNDANT_RESTATEMENT — Same idea expressed multiple times\n' +
			'6. SUMMARY_RESTATEMENT — Recap adding nothing new\n' +
			'7. DEAD_CONTENT — Silence artifacts, "um", "uh", long pauses\n' +
			'8. WEAK_OPENER — Slow starts, "Welcome to the show" padding\n' +
			'9. PAUSE_FILLER — Filled pauses: "um", "uh", "er", "like"\n' +
			'10. TANGENT — Off-topic digressions\n\n' +
			'CONFIDENCE SCORING:\n' +
			'- 0.85-1.00: Pure filler/dead air, clear-cut removal\n' +
			'- 0.60-0.84: Clear semantic match, safe to remove\n' +
			'- 0.40-0.59: Probable match, flag for review\n' +
			'- 0.25-0.39: Borderline, include with low confidence\n' +
			'- Below 0.25: Do not include\n\n' +
			'OUTPUT FORMAT (STRICT JSON — no markdown, no code blocks):\n' +
			'{"cut_intents": [\n' +
			'  {"cut_start_midpoint": "M001", "cut_end_midpoint": "M003", "start_time": 1.5, "end_time": 3.2,\n' +
			'   "category": "FILLER_ACK", "target_segments": ["T002"], "reason": "...", "confidence": 0.92}\n' +
			']}';

		var custom = customInstruction || 'GOAL: Make it professional, engaging and to the point. If something doesn\'t add value, flag it.';

		var systemInstruction = custom + '\n\n--- CORE RULES & SCHEMA ---\n\n' + baseInstruction +
			'\n\n--- DATA ---\n\nANCHOR TABLE:\n' + mpLines + '\n\nFULL TRANSCRIPT:\n' + transcriptFlat;

		var userPrompt = 'Analyze the transcript and anchor data above. Identify ALL removable content per the analysis categories and rules. Be AGGRESSIVE — aim for 8-20+ cuts. Return STRICT JSON.';

		return { systemInstruction: systemInstruction, userPrompt: userPrompt };
	}

	// ── API Callers ──

	async function callGeminiAPI (apiKey, model, systemInstruction, userPrompt) {
		var resp = await fetch ('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify ({
				contents: [{ parts: [{ text: userPrompt }] }],
				systemInstruction: { parts: [{ text: systemInstruction }] },
				generationConfig: { temperature: 0.3, maxOutputTokens: 26384, responseMimeType: 'application/json' },
			}),
		});
		if (!resp.ok) throw new Error ('Gemini ' + resp.status + ': ' + await resp.text ());
		var data = await resp.json ();
		var raw = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) ? data.candidates[0].content.parts[0].text : '';
		return parseJSON (raw);
	}

	async function callGroqLLM (apiKey, model, systemInstruction, userPrompt) {
		var resp = await fetch ('https://api.groq.com/openai/v1/chat/completions', {
			method: 'POST',
			headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
			body: JSON.stringify ({
				model: model, temperature: 0.1, max_tokens: 16384,
				messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: userPrompt }],
				response_format: { type: 'json_object' },
			}),
		});
		if (!resp.ok) throw new Error ('Groq ' + resp.status + ': ' + await resp.text ());
		var data = await resp.json ();
		var raw = (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : '';
		return parseJSON (raw);
	}

	async function callOpenRouter (apiKey, model, systemInstruction, userPrompt) {
		var resp = await fetch ('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
			body: JSON.stringify ({
				model: model, temperature: 0.1, max_tokens: 16384,
				messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: userPrompt }],
				response_format: { type: 'json_object' },
			}),
		});
		if (!resp.ok) throw new Error ('OpenRouter ' + resp.status + ': ' + await resp.text ());
		var data = await resp.json ();
		var raw = (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : '';
		return parseJSON (raw);
	}

	function parseJSON (raw) {
		raw = raw.trim ();
		try { return JSON.parse (raw); } catch (e) { /* try more */ }

		// Stage 1: ```json blocks
		var md = raw.match (/```(?:json)?\s*([\s\S]*?)\s*```/i);
		if (md) { try { return JSON.parse (md[1]); } catch (e) { /* try more */ } }

		// Stage 2: Outermost { ... }
		var brace = raw.match (/\{[\s\S]*\}/);
		if (brace) { try { return JSON.parse (brace[0]); } catch (e) { /* try more */ } }

		// Stage 3: Outermost [ ... ]
		var bracket = raw.match (/\[[\s\S]*\]/);
		if (bracket) { try { return JSON.parse (bracket[0]); } catch (e) { /* try more */ } }

		// Stage 4: Repair truncated array (from Python pipeline)
		if (raw.charAt (0) === '[') {
			var lastComplete = raw.lastIndexOf ('}');
			if (lastComplete > 0) {
				var candidate = raw.substring (0, lastComplete + 1).replace (/,$/, '') + ']';
				try { var r = JSON.parse (candidate); if (Array.isArray (r)) return r; } catch (e) { /* try more */ }
				var secondLast = raw.lastIndexOf ('}', lastComplete - 1);
				if (secondLast > 0) {
					candidate = raw.substring (0, secondLast + 1).replace (/,$/, '') + ']';
					try { r = JSON.parse (candidate); if (Array.isArray (r)) return r; } catch (e) { /* fail */ }
				}
			}
		}

		// Stage 5: Repair truncated object (from Python pipeline)
		if (raw.charAt (0) === '{') {
			var openBraces = (raw.match (/\{/g) || []).length - (raw.match (/\}/g) || []).length;
			var openBrackets = (raw.match (/\[/g) || []).length - (raw.match (/\]/g) || []).length;
			var openQuotes = (raw.match (/"/g) || []).length % 2;
			var repaired = raw;
			if (openQuotes) repaired += '"';
			var lastComma = repaired.lastIndexOf (',');
			var lastBrace = repaired.lastIndexOf ('{');
			if (lastComma > lastBrace) repaired = repaired.substring (0, lastComma);
			for (var i = 0; i < openBrackets; i++) repaired += ']';
			for (var i = 0; i < openBraces; i++) repaired += '}';
			try { return JSON.parse (repaired); } catch (e) { /* fail */ }
		}

		throw new Error ('Cannot parse AI response as JSON');
	}

	// ══════════════════════════════════════════════════════════════
	//  PASS 4 — QC AUDIT
	// ══════════════════════════════════════════════════════════════

	async function runQC () {
		state.pipelineStatus[4] = 'running';
		emit ('pass:start', { pass: 4 });

		var issues = [];
		for (var i = 0; i < state.ghostCuts.length; i++) {
			var c = state.ghostCuts[i];
			if (c.state !== 'pending') continue;

			// Flag over-cutting
			if (c.end - c.start > 5.0) {
				issues.push ({ cut_id: c.id, problem: 'over_cutting', severity: 'medium', reason: 'Cut removes >5s' });
			}
			// Auto-dismiss low-confidence dead content
			if (c.category === 'DEAD_CONTENT' && c.confidence < 0.6) {
				c.state = 'dismissed';
			}
		}

		state.pipelineStatus[4] = 'done';
		emit ('pass:done', { pass: 4, issues: issues.length });
		emit ('state:changed', state);
		return issues;
	}

	// ══════════════════════════════════════════════════════════════
	//  PASS 5 — EXECUTE CUTS
	// ══════════════════════════════════════════════════════════════

	async function executeCuts (audioBuffer, cuts, app) {
		state.pipelineStatus[5] = 'running';
		emit ('pass:start', { pass: 5 });

		var confirmed = cuts.filter (function (c) { return c.state === 'pending' || c.state === 'confirmed'; });
		if (!confirmed.length) {
			state.pipelineStatus[5] = 'done';
			emit ('pass:done', { pass: 5, executed: 0 });
			return audioBuffer;
		}

		// Sort end-to-start to preserve offsets
		var sorted = confirmed.slice ().sort (function (a, b) { return b.start - a.start; });
		var sr = audioBuffer.sampleRate;
		var executed = 0;

		// Save undo state via AudioMass
		if (app && app.fireEvent) {
			app.fireEvent ('StateRequestPush', { desc: 'AI Execute ' + confirmed.length + ' cuts' });
		}

		for (var i = 0; i < sorted.length; i++) {
			var cut = sorted[i];
			var startSamp = snapToZeroCrossing (audioBuffer.getChannelData (0), Math.floor (cut.start * sr));
			var endSamp = snapToZeroCrossing (audioBuffer.getChannelData (0), Math.floor (cut.end * sr));

			if (endSamp > startSamp && endSamp <= audioBuffer.length) {
				var fadeSamples = Math.min (256, startSamp);
				var newLen = audioBuffer.length - (endSamp - startSamp);
				var newBuf = audioBuffer.context.createBuffer (audioBuffer.numberOfChannels, newLen, sr);

				for (var ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
					var oldData = audioBuffer.getChannelData (ch);
					var newData = newBuf.getChannelData (ch);
					newData.set (oldData.subarray (0, startSamp));
					newData.set (oldData.subarray (endSamp), startSamp);

					// Micro-fade at join point
					if (fadeSamples > 0 && startSamp > 0) {
						for (var f = 0; f < fadeSamples; f++) {
							var t = f / fadeSamples;
							newData[startSamp - fadeSamples + f] *= (1 - t);
							if (startSamp + f < newData.length) newData[startSamp + f] *= t;
						}
					}
				}

				audioBuffer = newBuf;
				rippleShift (cut.start, cut.end);
				cut.state = 'executed';
				executed++;
			}
		}

		state.pipelineStatus[5] = 'done';
		emit ('pass:done', { pass: 5, executed: executed });
		emit ('state:changed', state);
		emit ('cuts:executed', { count: executed, buffer: audioBuffer });
		return audioBuffer;
	}

	// ══════════════════════════════════════════════════════════════
	//  HELPERS
	// ══════════════════════════════════════════════════════════════

	function snapToZeroCrossing (data, sampleIdx) {
		if (!CFG ().get ('snapToZero')) return sampleIdx;
		var window = 64;
		var start = Math.max (0, sampleIdx - window);
		var end = Math.min (data.length - 1, sampleIdx + window);
		var bestIdx = sampleIdx, bestDist = Infinity;
		for (var i = start + 1; i < end; i++) {
			if ((data[i - 1] >= 0 && data[i] < 0) || (data[i - 1] < 0 && data[i] >= 0)) {
				var dist = Math.abs (i - sampleIdx);
				if (dist < bestDist) { bestDist = dist; bestIdx = i; }
			}
		}
		return bestIdx;
	}

	function rippleShift (cutStart, cutEnd) {
		var dur = cutEnd - cutStart;

		// Segments
		state.segments = state.segments.filter (function (s) {
			return !(s.start >= cutStart && s.end <= cutEnd);
		}).map (function (s) {
			var ns = Object.assign ({}, s);
			if (ns.start >= cutEnd) { ns.start -= dur; ns.end -= dur; }
			else if (ns.start < cutStart && ns.end > cutStart) { ns.end = Math.max (ns.start, cutStart); }
			return ns;
		}).filter (function (s) { return s.end - s.start > 0.001; });
		state.segments.forEach (function (s, i) { s.id = 'T' + String (i + 1).padStart (3, '0'); });

		// Words
		state.words = state.words.filter (function (w) {
			return !(w.start >= cutStart && w.end <= cutEnd);
		}).map (function (w) {
			var nw = Object.assign ({}, w);
			if (nw.start >= cutEnd) { nw.start -= dur; nw.end -= dur; }
			else if (nw.start < cutStart && nw.end > cutStart) { nw.end = Math.max (nw.start, cutStart); }
			return nw;
		}).filter (function (w) { return w.end - w.start > 0.001; });

		// Ghost cuts
		state.ghostCuts = state.ghostCuts.filter (function (gc) {
			return !(gc.start >= cutStart && gc.end <= cutEnd);
		}).map (function (gc) {
			var ng = Object.assign ({}, gc);
			if (ng.start >= cutEnd) { ng.start -= dur; ng.end -= dur; }
			else if (ng.start < cutStart && ng.end > cutStart) { ng.end = Math.max (ng.start, cutStart); }
			return ng;
		});

		// Midpoints
		state.midpoints = state.midpoints.filter (function (mp) {
			return !(mp.time >= cutStart && mp.time <= cutEnd);
		}).map (function (mp) {
			var nm = Object.assign ({}, mp);
			if (nm.time >= cutEnd) nm.time -= dur;
			return nm;
		});
		state.midpoints.forEach (function (mp, i) { mp.id = 'M' + String (i + 1).padStart (3, '0'); });
	}

	function getState () { return state; }
	function getSegments () { return state.segments; }
	function getMidpoints () { return state.midpoints; }
	function getGhostCuts () { return state.ghostCuts; }
	function setSegments (s) { state.segments = s; }
	function setMidpoints (m) { state.midpoints = m; }
	function setGhostCuts (g) { state.ghostCuts = g; }

	function round3 (v) { return Math.round (v * 1000) / 1000; }
	function round1 (v) { return Math.round (v * 10) / 10; }

	// ══════════════════════════════════════════════════════════════
	//  PUBLIC API
	// ══════════════════════════════════════════════════════════════

	w.IHackPipeline = {
		// Events
		on: on, off: off, emit: emit,
		// Pipeline passes
		transcribe: transcribe,
		detectAnchors: detectAnchors,
		analyze: analyze,
		runQC: runQC,
		executeCuts: executeCuts,
		// State
		getState: getState,
		getSegments: getSegments,
		getMidpoints: getMidpoints,
		getGhostCuts: getGhostCuts,
		setSegments: setSegments,
		setMidpoints: setMidpoints,
		setGhostCuts: setGhostCuts,
		// Helpers
		rippleShift: rippleShift,
		snapToZeroCrossing: snapToZeroCrossing,
		// Prompt (for testing)
		buildAnalysisPrompt: buildAnalysisPrompt,
	};

}) (window);
