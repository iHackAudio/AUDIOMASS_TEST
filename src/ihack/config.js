(function (w) {
	'use strict';

	var STORAGE_KEY = 'ihack_config';

	var defaults = {
		groqKey: '',
		geminiKey: '',
		openrouterKey: '',
		provider: 'gemini',
		model: 'gemini-2.5-flash',
		customInstruction: '',
		// Pipeline
		confidenceFloor: 0.25,
		minCuts: 8,
		maxCuts: 30,
		// Editing
		snapToZero: true,
		crossfadeSamples: 256,
		rippleMode: true,
	};

	var current = Object.assign({}, defaults);

	function load () {
		try {
			var raw = w.localStorage.getItem (STORAGE_KEY);
			if (raw) {
				var saved = JSON.parse (raw);
				Object.assign (current, saved);
			}
		} catch (e) { /* ignore */ }
	}

	function save () {
		try {
			w.localStorage.setItem (STORAGE_KEY, JSON.stringify (current));
		} catch (e) { /* ignore */ }
	}

	function get (key) {
		return current[key];
	}

	function set (key, value) {
		current[key] = value;
		save ();
	}

	function getAll () {
		return Object.assign ({}, current);
	}

	function setAll (obj) {
		Object.assign (current, obj);
		save ();
	}

	function reset () {
		Object.assign (current, defaults);
		save ();
	}

	function getActiveKey () {
		if (current.provider === 'gemini') return current.geminiKey;
		if (current.provider === 'openrouter') return current.openrouterKey;
		return current.groqKey;
	}

	// Provider → model list mapping
	var PROVIDER_MODELS = {
		gemini: [
			'gemini-3.1-flash-lite',
			'gemini-2.5-flash',
			'gemini-2.5-pro',
			'gemini-2.0-flash-001',
		],
		groq: [
			'qwen3-32b',
			'qwen3-8b',
			'llama-3.3-70b-versatile',
			'llama-3.1-8b-instant',
			'mixtral-8x7b-32768',
			'gemma2-9b-it',
		],
		openrouter: [
			'qwen/qwen3-32b',
			'meta-llama/llama-3.3-70b-instruct:free',
			'google/gemma-3-27b-it:free',
			'mistralai/mistral-small-3.2-24b-instruct:free',
		],
	};

	// Load on script parse
	load ();

	w.IHackConfig = {
		get: get,
		set: set,
		getAll: getAll,
		setAll: setAll,
		reset: reset,
		save: save,
		load: load,
		getActiveKey: getActiveKey,
		PROVIDER_MODELS: PROVIDER_MODELS,
		defaults: defaults,
	};

}) (window);
