/* ============================================================
   FAR AI — LLM Integration for AI-Assisted Analysis
   Connects to local Ollama instance for
   brainstorming, CCM pre-scoring, warning indicators, and
   narrative drafting.
   ============================================================ */

const FARAI = (() => {
    // ---- Settings (persisted in localStorage) ----
    let provider = localStorage.getItem('far_ai_provider') || 'ollama';
    let ollamaUrl = localStorage.getItem('far_ollama_url') || 'http://localhost:11434';
    let ollamaModel = localStorage.getItem('far_ollama_model') || '';
    let claudeApiKey = localStorage.getItem('far_claude_api_key') || '';
    let claudeModel = localStorage.getItem('far_claude_model') || 'claude-sonnet-4-6';
    let geminiApiKey = localStorage.getItem('far_gemini_api_key') || '';
    let geminiModel = localStorage.getItem('far_gemini_model') || 'gemini-2.5-flash';
    let strictness = localStorage.getItem('far_ai_strictness') || 'balanced';
    let connected = false;
    let availableModels = [];

    const MAX_SURVIVORS = { permissive: 12, balanced: 8, strict: 6 };
    const MIN_SURVIVORS = 4;

    const SYSTEM_PROMPT = FARPrompts.SYSTEM;

    // ---- Field Lock State ----
    // locks: Map<fieldId, { value, stage }>
    // Field ID scheme: s{stage}:{type}:{identifier}
    const locks = new Map();

    const loadLocks = () => {
        try {
            const raw = localStorage.getItem('far_field_locks');
            if (raw) {
                const entries = JSON.parse(raw);
                locks.clear();
                for (const [k, v] of entries) locks.set(k, v);
            }
        } catch { /* ignore corrupt data */ }
    };

    const saveLocks = () => {
        localStorage.setItem('far_field_locks', JSON.stringify([...locks.entries()]));
    };

    const lockField = (id, value, stage) => {
        locks.set(id, { value, stage });
        saveLocks();
    };

    const unlockField = (id) => {
        locks.delete(id);
        saveLocks();
    };

    const isLocked = (id) => locks.has(id);

    const getLockedValue = (id) => locks.get(id)?.value;

    const getLocksForStage = (n) => {
        const result = [];
        for (const [id, entry] of locks) {
            if (entry.stage === n) result.push({ id, ...entry });
        }
        return result;
    };

    const resetAutopilotFlag = () => {
        autopilotHasRun = false;
        localStorage.removeItem('far_autopilot_done');
    };

    const exportLocks = () => [...locks.entries()];

    const importLocks = (entries) => {
        locks.clear();
        if (Array.isArray(entries)) {
            for (const [k, v] of entries) locks.set(k, v);
        }
        saveLocks();
    };

    const clearAllLocks = () => {
        locks.clear();
        saveLocks();
        // Remove visual decorations
        document.querySelectorAll('.field-locked').forEach(el => el.classList.remove('field-locked'));
        document.querySelectorAll('.field-lock-wrapper').forEach(wrapper => {
            const child = wrapper.querySelector('input, textarea, select');
            if (child) wrapper.parentNode.insertBefore(child, wrapper);
            wrapper.remove();
        });
    };

    const clearLocksForStage = (n) => {
        for (const [id, entry] of locks) {
            if (entry.stage === n) locks.delete(id);
        }
        saveLocks();
    };

    const clearStructuralLocks = () => {
        // When sectors/factors/lines change structurally, clear stages 2-7
        for (const [id, entry] of locks) {
            if (entry.stage >= 2) locks.delete(id);
        }
        saveLocks();
    };

    // ---- Field ID Mapping ----

    const fieldIdFromElement = (el) => {
        if (!el) return null;

        // Step 1 fields (fixed IDs)
        if (el.id === 'initial-view') return 's1:initialView';
        if (el.id === 'field-boundaries') return 's1:fieldBoundaries';
        if (el.id === 'key-uncertainties') return 's1:keyUncertainties';

        // Step 2: Sector name
        if (el.dataset.sectorId && el.dataset.field === 'name' && !el.dataset.factorId) {
            return `s2:sector:${el.dataset.sectorId}:name`;
        }
        // Step 2: Sector description
        if (el.dataset.sectorId && el.dataset.field === 'description' && !el.dataset.factorId) {
            return `s2:sector:${el.dataset.sectorId}:description`;
        }
        // Step 2: Factor label
        if (el.dataset.factorId && el.dataset.field === 'label') {
            return `s2:factor:${el.dataset.factorId}:label`;
        }
        // Step 2: Factor description
        if (el.dataset.factorId && el.dataset.field === 'description') {
            return `s2:factor:${el.dataset.factorId}:description`;
        }

        // Step 4: Scenario line name
        if (el.dataset.lineIdx !== undefined && el.dataset.field === 'name') {
            return `s5:line:${el.dataset.lineIdx}:name`;
        }
        // Step 4: Scenario line description
        if (el.dataset.lineIdx !== undefined && el.dataset.field === 'description' && el.dataset.configIdx === undefined) {
            return `s5:line:${el.dataset.lineIdx}:description`;
        }

        // Step 4: Warning indicator
        if (el.classList.contains('warning-indicator-input') && el.dataset.lineIdx !== undefined) {
            return `s6:warning:${el.dataset.lineIdx}:${el.dataset.configIdx}`;
        }

        // Step 4: Narrative
        if (el.dataset.narrativeLineIdx !== undefined) {
            return `s7:narrative:${el.dataset.narrativeLineIdx}`;
        }

        return null;
    };

    const stageFromFieldId = (fieldId) => {
        const m = fieldId.match(/^s(\d+):/);
        return m ? parseInt(m[1]) : 0;
    };

    const findElementForFieldId = (fieldId) => {
        if (fieldId === 's1:initialView') return document.getElementById('initial-view');
        if (fieldId === 's1:fieldBoundaries') return document.getElementById('field-boundaries');
        if (fieldId === 's1:keyUncertainties') return document.getElementById('key-uncertainties');

        // s2:sector:{id}:name
        let m = fieldId.match(/^s2:sector:(.+):name$/);
        if (m) return document.querySelector(`input[data-sector-id="${m[1]}"][data-field="name"]`);
        m = fieldId.match(/^s2:sector:(.+):description$/);
        if (m) return document.querySelector(`textarea[data-sector-id="${m[1]}"][data-field="description"]`);

        // s2:factor:{id}:label
        m = fieldId.match(/^s2:factor:(.+):label$/);
        if (m) return document.querySelector(`input[data-factor-id="${m[1]}"][data-field="label"]`);
        m = fieldId.match(/^s2:factor:(.+):description$/);
        if (m) return document.querySelector(`textarea[data-factor-id="${m[1]}"][data-field="description"]`);

        // s5:line:{idx}:name
        m = fieldId.match(/^s5:line:(\d+):name$/);
        if (m) return document.querySelector(`input[data-line-idx="${m[1]}"][data-field="name"]`);
        m = fieldId.match(/^s5:line:(\d+):description$/);
        if (m) return document.querySelector(`textarea[data-line-idx="${m[1]}"][data-field="description"]`);

        // s6:warning:{lineIdx}:{configIdx}
        m = fieldId.match(/^s6:warning:(\d+):(\d+)$/);
        if (m) return document.querySelector(`.warning-indicator-input[data-line-idx="${m[1]}"][data-config-idx="${m[2]}"]`);

        // s7:narrative:{lineIdx}
        m = fieldId.match(/^s7:narrative:(\d+)$/);
        if (m) return document.querySelector(`textarea[data-narrative-line-idx="${m[1]}"]`);

        return null;
    };

    // ---- Lock Visual Decoration ----

    const decorateLockedField = (element, fieldId) => {
        if (!element) return;
        element.classList.add('field-locked');

        // Wrap in a relative container if not already
        if (!element.parentElement?.classList.contains('field-lock-wrapper')) {
            const wrapper = document.createElement('span');
            wrapper.className = 'field-lock-wrapper';
            element.parentNode.insertBefore(wrapper, element);
            wrapper.appendChild(element);
        }

        const wrapper = element.parentElement;
        // Remove existing unlock button
        const existing = wrapper.querySelector('.field-unlock-btn');
        if (existing) existing.remove();

        const btn = document.createElement('button');
        btn.className = 'field-unlock-btn';
        btn.title = 'Unlock this field (allow AI to regenerate)';
        btn.innerHTML = '&#x1f512;';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            unlockField(fieldId);
            element.classList.remove('field-locked');
            btn.remove();
        });
        wrapper.appendChild(btn);
    };

    const decorateAllLockedFields = () => {
        for (const [fieldId] of locks) {
            const el = findElementForFieldId(fieldId);
            if (el) {
                decorateLockedField(el, fieldId);
            }
        }
    };

    // ---- Connection Management ----

    const checkConnection = async () => {
        if (provider === 'claude') return checkConnectionClaude();
        if (provider === 'gemini') return checkConnectionGemini();
        return checkConnectionOllama();
    };

    const checkConnectionOllama = async () => {
        try {
            const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
            if (!resp.ok) throw new Error('Not OK');
            const data = await resp.json();
            availableModels = (data.models || []).map(m => m.name);
            connected = true;
            if (!ollamaModel && availableModels.length > 0) {
                ollamaModel = availableModels[0];
                localStorage.setItem('far_ollama_model', ollamaModel);
            }
            return true;
        } catch {
            connected = false;
            availableModels = [];
            return false;
        }
    };

    const checkConnectionClaude = async () => {
        if (!claudeApiKey) { connected = false; return false; }
        try {
            const resp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': claudeApiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify({
                    model: claudeModel,
                    max_tokens: 1,
                    messages: [{ role: 'user', content: 'hi' }],
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            connected = true;
            return true;
        } catch {
            connected = false;
            return false;
        }
    };

    const checkConnectionGemini = async () => {
        if (!geminiApiKey) { connected = false; return false; }
        try {
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            connected = true;
            return true;
        } catch {
            connected = false;
            return false;
        }
    };

    const updateSettingsUI = () => {
        const status = document.getElementById('ai-status');
        const modelSelect = document.getElementById('ai-model-select');
        const urlInput = document.getElementById('ai-ollama-url');
        const claudeKeyInput = document.getElementById('ai-claude-api-key');
        const claudeModelSelect = document.getElementById('ai-claude-model-select');
        const geminiKeyInput = document.getElementById('ai-gemini-api-key');
        const geminiModelSelect = document.getElementById('ai-gemini-model-select');
        const ollamaGroup = document.getElementById('ai-settings-ollama');
        const claudeGroup = document.getElementById('ai-settings-claude');
        const geminiGroup = document.getElementById('ai-settings-gemini');

        if (!status) return;

        // Show/hide provider groups
        if (ollamaGroup) ollamaGroup.style.display = provider === 'ollama' ? '' : 'none';
        if (claudeGroup) claudeGroup.style.display = provider === 'claude' ? '' : 'none';
        if (geminiGroup) geminiGroup.style.display = provider === 'gemini' ? '' : 'none';

        // Update provider toggle buttons
        document.querySelectorAll('.ai-provider-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.provider === provider);
        });

        // Update strictness toggle buttons
        document.querySelectorAll('.ai-strictness-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.strictness === strictness);
        });

        // Status
        if (connected) {
            status.className = 'ai-status ai-status-connected';
            status.textContent = 'Connected';
        } else {
            status.className = 'ai-status ai-status-disconnected';
            status.textContent = 'Not connected';
        }

        // Ollama fields
        if (urlInput) urlInput.value = ollamaUrl;
        if (modelSelect) {
            modelSelect.innerHTML = '';
            if (availableModels.length === 0) {
                modelSelect.innerHTML = '<option value="">No models available</option>';
                modelSelect.disabled = true;
            } else {
                modelSelect.disabled = false;
                availableModels.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    opt.selected = m === ollamaModel;
                    modelSelect.appendChild(opt);
                });
            }
        }

        // Claude fields
        if (claudeKeyInput) claudeKeyInput.value = claudeApiKey;
        if (claudeModelSelect) claudeModelSelect.value = claudeModel;

        // Gemini fields
        if (geminiKeyInput) geminiKeyInput.value = geminiApiKey;
        if (geminiModelSelect) geminiModelSelect.value = geminiModel;

        // Toggle AI buttons visibility
        document.querySelectorAll('.ai-btn, .ai-btn-secondary').forEach(btn => {
            btn.disabled = !connected;
        });

        // Toggle autopilot button
        const autopilotBtn = document.getElementById('btn-autopilot');
        if (autopilotBtn) autopilotBtn.disabled = !connected;
    };

    const bindSettingsEvents = () => {
        const urlInput = document.getElementById('ai-ollama-url');
        const modelSelect = document.getElementById('ai-model-select');
        const testBtn = document.getElementById('ai-test-connection');
        const claudeKeyInput = document.getElementById('ai-claude-api-key');
        const claudeModelSelect = document.getElementById('ai-claude-model-select');

        // Provider toggle
        document.querySelectorAll('.ai-provider-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                provider = btn.dataset.provider;
                localStorage.setItem('far_ai_provider', provider);
                connected = false;
                updateSettingsUI();
            });
        });

        // Strictness toggle
        document.querySelectorAll('.ai-strictness-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                strictness = btn.dataset.strictness;
                localStorage.setItem('far_ai_strictness', strictness);
                updateSettingsUI();
            });
        });

        if (urlInput) {
            urlInput.addEventListener('change', () => {
                ollamaUrl = urlInput.value.replace(/\/+$/, '');
                localStorage.setItem('far_ollama_url', ollamaUrl);
            });
        }

        if (modelSelect) {
            modelSelect.addEventListener('change', () => {
                ollamaModel = modelSelect.value;
                localStorage.setItem('far_ollama_model', ollamaModel);
            });
        }

        if (claudeKeyInput) {
            claudeKeyInput.addEventListener('change', () => {
                claudeApiKey = claudeKeyInput.value.trim();
                localStorage.setItem('far_claude_api_key', claudeApiKey);
            });
        }

        if (claudeModelSelect) {
            claudeModelSelect.addEventListener('change', () => {
                claudeModel = claudeModelSelect.value;
                localStorage.setItem('far_claude_model', claudeModel);
            });
        }

        const geminiKeyInput = document.getElementById('ai-gemini-api-key');
        const geminiModelSelect = document.getElementById('ai-gemini-model-select');

        if (geminiKeyInput) {
            geminiKeyInput.addEventListener('change', () => {
                geminiApiKey = geminiKeyInput.value.trim();
                localStorage.setItem('far_gemini_api_key', geminiApiKey);
            });
        }

        if (geminiModelSelect) {
            geminiModelSelect.addEventListener('change', () => {
                geminiModel = geminiModelSelect.value;
                localStorage.setItem('far_gemini_model', geminiModel);
            });
        }

        if (testBtn) {
            testBtn.addEventListener('click', async () => {
                testBtn.disabled = true;
                testBtn.textContent = 'Testing...';
                await checkConnection();
                updateSettingsUI();
                testBtn.disabled = false;
                testBtn.textContent = 'Test Connection';
            });
        }
    };

    // ---- Streaming Fetch ----

    const streamGenerate = async (prompt, system, onChunk, onDone) => {
        if (provider === 'claude') return streamGenerateClaude(prompt, system, onChunk, onDone);
        if (provider === 'gemini') return streamGenerateGemini(prompt, system, onChunk, onDone);
        return streamGenerateOllama(prompt, system, onChunk, onDone);
    };

    const streamGenerateOllama = async (prompt, system, onChunk, onDone) => {
        const controller = new AbortController();
        try {
            const resp = await fetch(`${ollamaUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: ollamaModel,
                    prompt,
                    system: system || SYSTEM_PROMPT,
                    stream: true,
                }),
                signal: controller.signal,
            });
            if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const chunk = JSON.parse(line);
                        if (chunk.response) {
                            fullText += chunk.response;
                            onChunk(chunk.response, fullText);
                        }
                    } catch { /* skip */ }
                }
            }
            if (onDone) onDone(fullText);
            return fullText;
        } catch (err) {
            if (err.name === 'AbortError') return '';
            throw err;
        }
    };

    const streamGenerateClaude = async (prompt, system, onChunk, onDone) => {
        const controller = new AbortController();
        try {
            const resp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': claudeApiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify({
                    model: claudeModel,
                    max_tokens: 8192,
                    system: system || SYSTEM_PROMPT,
                    messages: [{ role: 'user', content: prompt }],
                    stream: true,
                }),
                signal: controller.signal,
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error?.message || `Claude API error: ${resp.status}`);
            }
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';
            let eventType = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (line.startsWith('event: ')) { eventType = line.slice(7).trim(); continue; }
                    if (line.startsWith('data: ') && eventType === 'content_block_delta') {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.delta?.text) {
                                fullText += data.delta.text;
                                onChunk(data.delta.text, fullText);
                            }
                        } catch { /* skip */ }
                        eventType = '';
                    } else if (line.startsWith('data: ')) { eventType = ''; }
                }
            }
            if (onDone) onDone(fullText);
            return fullText;
        } catch (err) {
            if (err.name === 'AbortError') return '';
            throw err;
        }
    };

    const streamGenerateGemini = async (prompt, system, onChunk, onDone) => {
        const controller = new AbortController();
        try {
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse&key=${geminiApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { role: 'user', parts: [{ text: system || SYSTEM_PROMPT }] },
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                }),
                signal: controller.signal,
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error?.message || `Gemini API error: ${resp.status}`);
            }
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr) continue;
                    try {
                        const data = JSON.parse(jsonStr);
                        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text) {
                            fullText += text;
                            onChunk(text, fullText);
                        }
                    } catch { /* skip */ }
                }
            }
            if (onDone) onDone(fullText);
            return fullText;
        } catch (err) {
            if (err.name === 'AbortError') return '';
            throw err;
        }
    };

    // ---- Suggestion Panel UI ----

    const createSuggestionPanel = (anchorEl, { onApply, onDismiss, applyLabel } = {}) => {
        // Remove any existing panel near this anchor
        const existing = anchorEl.parentElement?.querySelector('.ai-suggestion-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.className = 'ai-suggestion-panel';
        panel.innerHTML = `
            <div class="ai-suggestion-header">
                <span class="ai-badge">AI Suggestion</span>
                <button class="ai-dismiss" title="Dismiss">&times;</button>
            </div>
            <div class="ai-suggestion-content"><span class="ai-loading-dots">Thinking</span></div>
            <div class="ai-suggestion-actions">
                <button class="btn-primary btn-sm ai-apply">${applyLabel || 'Apply'}</button>
                <button class="btn-ghost btn-sm ai-dismiss-btn">Dismiss</button>
            </div>
        `;

        anchorEl.insertAdjacentElement('afterend', panel);

        const contentEl = panel.querySelector('.ai-suggestion-content');
        const dismissAll = () => {
            panel.remove();
            if (onDismiss) onDismiss();
        };

        // getValue returns the current text — from the textarea if editing, otherwise from the div
        const getValue = () => {
            const ta = panel.querySelector('.ai-suggestion-edit');
            return ta ? ta.value : contentEl.textContent;
        };

        // Convert content div to editable textarea once streaming is done
        const makeEditable = () => {
            const text = contentEl.textContent;
            const textarea = document.createElement('textarea');
            textarea.className = 'ai-suggestion-edit';
            textarea.value = text;
            textarea.rows = Math.min(20, Math.max(6, text.split('\n').length + 1));
            contentEl.replaceWith(textarea);
        };

        panel.querySelector('.ai-dismiss').addEventListener('click', dismissAll);
        panel.querySelector('.ai-dismiss-btn').addEventListener('click', dismissAll);
        panel.querySelector('.ai-apply').addEventListener('click', () => {
            if (onApply) onApply(getValue());
            panel.remove();
        });

        return { panel, contentEl, dismiss: dismissAll, makeEditable };
    };

    const createCCMSuggestionPanel = (anchorEl, pairs, onApplySelected, onDismiss) => {
        const existing = anchorEl.parentElement?.querySelector('.ai-suggestion-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.className = 'ai-suggestion-panel ai-ccm-panel';
        panel.innerHTML = `
            <div class="ai-suggestion-header">
                <span class="ai-badge">AI Suggestion</span>
                <button class="ai-dismiss" title="Dismiss">&times;</button>
            </div>
            <div class="ai-suggestion-content"><span class="ai-loading-dots">Thinking</span></div>
            <div class="ai-suggestion-actions">
                <button class="btn-primary btn-sm ai-apply-selected">Apply Selected</button>
                <button class="btn-ghost btn-sm ai-dismiss-btn">Dismiss</button>
            </div>
        `;

        anchorEl.insertAdjacentElement('afterend', panel);

        const contentEl = panel.querySelector('.ai-suggestion-content');
        const dismissAll = () => {
            panel.remove();
            if (onDismiss) onDismiss();
        };

        panel.querySelector('.ai-dismiss').addEventListener('click', dismissAll);
        panel.querySelector('.ai-dismiss-btn').addEventListener('click', dismissAll);
        panel.querySelector('.ai-apply-selected').addEventListener('click', () => {
            const checkboxes = panel.querySelectorAll('.ai-ccm-check:checked');
            const results = [];
            checkboxes.forEach(cb => {
                results.push({
                    f1: cb.dataset.f1,
                    f2: cb.dataset.f2,
                    compatible: cb.dataset.compatible === 'true',
                    note: cb.dataset.note || '',
                });
            });
            if (onApplySelected) onApplySelected(results);
            panel.remove();
        });

        return { panel, contentEl, dismiss: dismissAll };
    };

    // ---- Lock Constraint Injection ----

    const buildConstraintsBlock = (lockedItems) => {
        if (!lockedItems || lockedItems.length === 0) return '';
        let block = '\n\nCONSTRAINTS: The following have been fixed by the user. Your output must include and be consistent with them:\n';
        lockedItems.forEach(item => {
            block += `- ${item.label}: "${item.value}"\n`;
        });
        block += 'Generate remaining elements around these fixed values.';
        return block;
    };

    // ---- Prompt Builders ----

    const buildProjectContext = () => {
        const state = FARCore.getState();
        return {
            projectName: state.project.name || 'Unnamed project',
            description: state.project.description || 'No description provided',
            horizon: state.project.horizon || 'Not specified',
            initialView: state.initialView || '',
            fieldBoundaries: state.fieldBoundaries || '',
            keyUncertainties: state.keyUncertainties || '',
        };
    };

    const buildSingleFieldPrompt = (fieldName) => {
        return FARPrompts.singleField(fieldName, buildProjectContext());
    };

    const buildSectorFactorPrompt = (sector) => {
        return FARPrompts.sectorFactor(buildProjectContext(), sector);
    };

    const buildBrainstormPrompt = (respectLocks = false) => {
        let constraints = '';
        if (respectLocks) {
            const locked = [];
            if (isLocked('s1:initialView')) locked.push({ label: 'Alternative Visions', value: getLockedValue('s1:initialView') });
            if (isLocked('s1:fieldBoundaries')) locked.push({ label: 'Field Boundaries', value: getLockedValue('s1:fieldBoundaries') });
            if (isLocked('s1:keyUncertainties')) locked.push({ label: 'Key Uncertainties', value: getLockedValue('s1:keyUncertainties') });
            constraints = buildConstraintsBlock(locked);
        }
        return FARPrompts.brainstorm(buildProjectContext(), constraints);
    };

    const getRequestedSectorCount = () => parseInt(document.getElementById('ai-sector-count')?.value) || 6;
    const getRequestedFactorCount = () => parseInt(document.getElementById('ai-factor-count')?.value) || 3;

    const buildSectorSuggestionPrompt = (respectLocks = false) => {
        let constraints = '';
        if (respectLocks) {
            const locked = [];
            for (const [id, entry] of locks) {
                if (entry.stage !== 2) continue;
                const m = id.match(/^s2:sector:(.+):(name|description)$/) || id.match(/^s2:factor:(.+):(label|description)$/);
                if (m) locked.push({ label: id, value: entry.value });
            }
            constraints = buildConstraintsBlock(locked);
        }
        return FARPrompts.sectorSuggestion(buildProjectContext(), constraints, getRequestedSectorCount(), getRequestedFactorCount());
    };

    // ---- Factor Similarity Map Assessment ----

    const buildFactorSimilarityPrompt = (sector) => FARPrompts.factorSimilarity(sector);

    const parseFactorSimilarityResponse = (text, sector) => {
        const positions = {};
        const explanations = [];
        const regex = /([A-Z]\d+)\s*:\s*X\s*=\s*([\d.]+)\s*,\s*Y\s*=\s*([\d.]+)(?:\s*[—\-]\s*(.+))?/gi;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const factorId = match[1].toUpperCase();
            const x = Math.min(1, Math.max(0, parseFloat(match[2])));
            const y = Math.min(1, Math.max(0, parseFloat(match[3])));
            const explanation = (match[4] || '').trim();
            if (!isNaN(x) && !isNaN(y)) {
                positions[factorId] = { x, y };
                if (explanation) {
                    const f = sector.factors.find(ff => ff.id === factorId);
                    explanations.push(`${factorId} (${f?.label || '?'}): ${explanation}`);
                }
            }
        }
        // Apply positions — only update factors that were parsed
        const factorIds = new Set(sector.factors.map(f => f.id));
        for (const [fId, pos] of Object.entries(positions)) {
            if (factorIds.has(fId)) {
                const factor = sector.factors.find(f => f.id === fId);
                if (factor) {
                    factor.mapX = pos.x;
                    factor.mapY = pos.y;
                }
            }
        }
        return { positions, explanations };
    };

    const assessFactorSimilarity = async (sectorId) => {
        if (!connected) return;
        const state = FARCore.getState();
        const sector = state.sectors.find(s => s.id === sectorId);
        if (!sector || sector.factors.length < 2) return;

        const prompt = buildFactorSimilarityPrompt(sector);
        const text = await streamGenerate(
            prompt.prompt, prompt.system,
            () => {}, () => {}
        );
        const { explanations } = parseFactorSimilarityResponse(text, sector);
        FARUI.renderSectors();

        // Show explanations below the map
        if (explanations.length > 0) {
            const mapContainer = document.querySelector(`#lewinian-map-${sectorId}`)?.closest('.lewinian-map-container');
            if (mapContainer) {
                const existing = mapContainer.querySelector('.similarity-explanations');
                if (existing) existing.remove();
                const el = document.createElement('div');
                el.className = 'similarity-explanations';
                el.textContent = explanations.join('\n');
                mapContainer.appendChild(el);
            }
        }
    };

    const getCCMStrictnessBlock = () => FARPrompts.ccmStrictnessBlock(strictness);
    const getFilter2StrictnessBlock = () => FARPrompts.filter2StrictnessBlock(strictness);

    const buildCCMPrescoringPrompt = (sector1, sector2, respectLocks = false) => {
        const pairs = [];
        sector1.factors.forEach(f1 => {
            sector2.factors.forEach(f2 => {
                pairs.push({ f1, f2 });
            });
        });
        const pairDescriptions = pairs.map(({ f1, f2 }) =>
            `- ${f1.id} (${f1.label || '?'}${f1.description ? ': ' + f1.description : ''}) vs ${f2.id} (${f2.label || '?'}${f2.description ? ': ' + f2.description : ''})`
        ).join('\n');
        const result = FARPrompts.ccmPrescoring(sector1, sector2, pairDescriptions, pairs, strictness);
        result.pairs = pairs;
        return result;
    };

    const buildFilter2Prompt = (configs, offset = 0, respectLocks = false) => {
        const state = FARCore.getState();
        const configDescriptions = configs.map((config, i) => {
            const globalNum = offset + i + 1;
            const key = FARCore.configKey(config);
            const factors = config.map(fId => {
                const f = FARCore.getFactorById(fId);
                const sector = FARCore.getSectorForFactor(fId);
                return `${sector?.name || sector?.letter || '?'}: ${f?.label || fId}${f?.description ? ' (' + f.description + ')' : ''}`;
            }).join('; ');
            return `#${globalNum} [${key}]: ${factors}`;
        }).join('\n');
        return FARPrompts.filter2(state.project.name || 'Unnamed project', state.project.description || '', configDescriptions, strictness);
    };

    const describeConfig = (cfg) => {
        return FARCore.parseConfigKey(cfg.configKey).map(fId => {
            const f = FARCore.getFactorById(fId);
            return `${fId}: ${f?.label || '?'}${f?.description ? ' (' + f.description + ')' : ''}`;
        }).join(', ');
    };

    const buildWarningIndicatorPrompt = (lineIdx, configIdx, respectLocks = false) => {
        const state = FARCore.getState();
        const line = state.scenarioLines[lineIdx];
        const config1 = line.configs[configIdx];
        const config2 = line.configs[configIdx + 1];
        return FARPrompts.warningIndicator(line.name || 'Unnamed', describeConfig(config1), describeConfig(config2), config1.periodLabel || 'Period 1', config2.periodLabel || 'Period 2');
    };

    const buildNarrativePrompt = (lineIdx, respectLocks = false) => {
        const state = FARCore.getState();
        const line = state.scenarioLines[lineIdx];
        const configDetails = (line.configs || []).map((cfg, ci) => {
            const factors = FARCore.parseConfigKey(cfg.configKey).map(fId => {
                const f = FARCore.getFactorById(fId);
                return `${fId}: ${f?.label || '?'}${f?.description ? ' (' + f.description + ')' : ''}`;
            }).join('; ');
            let detail = `Period "${cfg.periodLabel || 'Period ' + (ci + 1)}": [${cfg.configKey}] — ${factors}`;
            if (cfg.warningIndicator) detail += `\n  Warning indicator for next transition: ${cfg.warningIndicator}`;
            return detail;
        }).join('\n\n');
        const locksNote = respectLocks && isLocked(`s7:narrative:${lineIdx}`)
            ? '\n\nNote: The user has a locked version of this narrative. Be consistent with the tone and content direction but generate a fresh version incorporating the latest configuration data.' : '';
        return FARPrompts.narrative(line.name || 'Unnamed', line.description || '', configDetails, locksNote);
    };

    // ---- Feature: Step 1 Brainstorming ----

    const brainstorm = async (btnEl) => {
        if (!connected) return;
        btnEl.disabled = true;

        const { prompt, system } = buildBrainstormPrompt();
        const { contentEl, dismiss, makeEditable } = createSuggestionPanel(btnEl, {
            onApply: (text) => {
                // Parse sections and fill textareas
                const sections = parseBrainstormResponse(text);
                if (sections.visions) {
                    document.getElementById('initial-view').value = sections.visions;
                    FARCore.getState().initialView = sections.visions;
                }
                if (sections.boundaries) {
                    document.getElementById('field-boundaries').value = sections.boundaries;
                    FARCore.getState().fieldBoundaries = sections.boundaries;
                }
                if (sections.uncertainties) {
                    document.getElementById('key-uncertainties').value = sections.uncertainties;
                    FARCore.getState().keyUncertainties = sections.uncertainties;
                }
            },
            onDismiss: () => { btnEl.disabled = false; },
        });

        try {
            await streamGenerate(prompt, system,
                (chunk, fullText) => { contentEl.textContent = fullText; },
                () => { makeEditable(); btnEl.disabled = false; }
            );
        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    const parseBrainstormResponse = (text) => {
        const result = { visions: '', boundaries: '', uncertainties: '' };
        // Try to split by section headings
        const lines = text.split('\n');
        let currentSection = 'visions';

        for (const line of lines) {
            const lower = line.toLowerCase();
            if (lower.includes('alternative vision') || lower.includes('visions of the future')) {
                currentSection = 'visions';
                continue;
            }
            if (lower.includes('field boundar') || lower.includes('boundaries')) {
                currentSection = 'boundaries';
                continue;
            }
            if (lower.includes('key uncertaint') || lower.includes('uncertainties')) {
                currentSection = 'uncertainties';
                continue;
            }
            result[currentSection] += line + '\n';
        }

        // Trim all sections
        result.visions = result.visions.trim();
        result.boundaries = result.boundaries.trim();
        result.uncertainties = result.uncertainties.trim();

        // If parsing failed (everything in visions), put it all in visions
        if (!result.boundaries && !result.uncertainties) {
            result.visions = text.trim();
        }

        return result;
    };

    // ---- Feature: Step 1 Single Field ----

    const brainstormField = async (btnEl, fieldName, textareaId) => {
        if (!connected) return;
        btnEl.disabled = true;

        const { prompt, system } = buildSingleFieldPrompt(fieldName);
        const textarea = document.getElementById(textareaId);
        const stateFieldMap = {
            'initial-view': 'initialView',
            'field-boundaries': 'fieldBoundaries',
            'key-uncertainties': 'keyUncertainties',
        };

        const { contentEl, dismiss, makeEditable } = createSuggestionPanel(btnEl, {
            onApply: (text) => {
                if (textarea) {
                    textarea.value = text;
                    const stateField = stateFieldMap[fieldName];
                    if (stateField) FARCore.getState()[stateField] = text;
                }
                btnEl.disabled = false;
            },
            onDismiss: () => { btnEl.disabled = false; },
        });

        try {
            await streamGenerate(prompt, system,
                (chunk, fullText) => { contentEl.textContent = fullText; },
                () => { makeEditable(); btnEl.disabled = false; }
            );
        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    // ---- Feature: Step 2 Single Sector Factor Suggestion ----

    const suggestFactorsForSector = async (btnEl, sectorId) => {
        if (!connected) return;
        btnEl.disabled = true;

        const state = FARCore.getState();
        const sector = state.sectors.find(s => s.id === sectorId);
        if (!sector) { btnEl.disabled = false; return; }

        const { prompt, system } = buildSectorFactorPrompt(sector);
        const { contentEl, dismiss, makeEditable } = createSuggestionPanel(btnEl, {
            onApply: (text) => {
                const parsed = parseSectorFactorResponse(text);
                if (parsed.name && !sector.name) sector.name = parsed.name;
                if (parsed.description && !sector.description) sector.description = parsed.description;
                if (parsed.factors.length > 0) {
                    const factorCount = Math.max(2, Math.min(7, parsed.factors.length));
                    sector.factors = [];
                    for (let fi = 0; fi < factorCount; fi++) {
                        sector.factors.push({
                            id: sector.letter + (fi + 1),
                            label: parsed.factors[fi]?.label || '',
                            description: parsed.factors[fi]?.description || '',
                            mapX: 0.5 + 0.3 * Math.cos((fi / factorCount) * Math.PI * 2),
                            mapY: 0.5 + 0.3 * Math.sin((fi / factorCount) * Math.PI * 2),
                        });
                    }
                }
                FARUI.renderSectors();
                btnEl.disabled = false;
            },
            onDismiss: () => { btnEl.disabled = false; },
        });

        try {
            await streamGenerate(prompt, system,
                (chunk, fullText) => { contentEl.textContent = fullText; },
                () => { makeEditable(); btnEl.disabled = false; }
            );
        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    const parseSectorFactorResponse = (text) => {
        const result = { name: '', description: '', factors: [] };
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const sectorMatch = trimmed.match(/^SECTOR:\s*(.+)/i);
            if (sectorMatch) { result.name = sectorMatch[1].trim(); continue; }
            const descMatch = trimmed.match(/^DESCRIPTION:\s*(.+)/i);
            if (descMatch) { result.description = descMatch[1].trim(); continue; }
            const factorMatch = trimmed.match(/^FACTOR\s*\d+:\s*(.+)/i);
            if (factorMatch) {
                const parts = factorMatch[1].split('|').map(s => s.trim());
                result.factors.push({ label: parts[0] || '', description: parts[1] || '' });
            }
        }
        return result;
    };

    // ---- Feature: Step 4 Draft All Narratives ----

    const draftAllNarratives = async (btnEl) => {
        if (!connected) return;
        const state = FARCore.getState();
        if (state.scenarioLines.length === 0) return;

        btnEl.disabled = true;
        btnEl.textContent = 'Drafting...';

        let completed = 0;
        const total = state.scenarioLines.length;

        for (let li = 0; li < total; li++) {
            const line = state.scenarioLines[li];
            if (!line.configs || line.configs.length === 0) {
                completed++;
                continue;
            }

            const { prompt, system } = buildNarrativePrompt(li);
            try {
                const text = await streamGenerate(prompt, system, () => {}, () => {});
                if (text) {
                    line.narrative = text;
                }
            } catch {
                // skip failed ones
            }
            completed++;
            btnEl.textContent = `Drafting... (${completed}/${total})`;
        }

        FARUI.renderNarratives();
        btnEl.disabled = false;
        btnEl.textContent = 'AI Draft All';
    };

    // ---- Feature: Step 2 Sector Suggestion ----

    const suggestSectors = async (btnEl) => {
        if (!connected) return;
        btnEl.disabled = true;

        const { prompt, system } = buildSectorSuggestionPrompt();
        const { contentEl, dismiss, makeEditable } = createSuggestionPanel(btnEl, {
            onApply: (text) => {
                const parsed = parseSectorResponse(text);
                if (parsed.sectors.length === 0) return;

                const state = FARCore.getState();

                // Reset sectors to match count
                state.sectors = [];
                const requestedSectors = getRequestedSectorCount();
                const requestedFactors = getRequestedFactorCount();
                const needed = Math.min(parsed.sectors.length, requestedSectors);
                for (let i = 0; i < needed; i++) {
                    FARCore.addSector();
                }

                // Fill in sector data
                parsed.sectors.forEach((ps, i) => {
                    if (i >= state.sectors.length) return;
                    const sector = state.sectors[i];
                    sector.name = ps.name;
                    sector.description = ps.description;

                    // Reset factors to match count
                    const factorCount = Math.max(2, Math.min(requestedFactors, ps.factors.length || requestedFactors));
                    sector.factors = [];
                    for (let fi = 0; fi < factorCount; fi++) {
                        sector.factors.push({
                            id: sector.letter + (fi + 1),
                            label: ps.factors[fi]?.label || '',
                            description: ps.factors[fi]?.description || '',
                            mapX: 0.5 + 0.3 * Math.cos((fi / factorCount) * Math.PI * 2),
                            mapY: 0.5 + 0.3 * Math.sin((fi / factorCount) * Math.PI * 2),
                        });
                    }
                });

                // Set acronym if suggested and user hasn't set one
                if (parsed.acronym) {
                    const currentAcronym = state.acronym || '';
                    const autoAcronym = state.sectors.map(s => (s.name || ' ')[0]).join('').toUpperCase();
                    if (!currentAcronym || currentAcronym === autoAcronym) {
                        state.acronym = parsed.acronym.toUpperCase();
                    }
                }

                FARUI.renderSectors();
                btnEl.disabled = false;
            },
            onDismiss: () => { btnEl.disabled = false; },
        });

        try {
            await streamGenerate(prompt, system,
                (chunk, fullText) => { contentEl.textContent = fullText; },
                () => { makeEditable(); btnEl.disabled = false; }
            );
        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    const parseSectorResponse = (text) => {
        const result = { acronym: '', sectors: [] };
        const lines = text.split('\n');
        let currentSector = null;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Check for acronym (tolerates markdown formatting)
            const acronymMatch = trimmed.match(/^(?:[*_#\->\s]*)?ACRONYM[*_]*:\s*(.+)/i);
            if (acronymMatch) {
                result.acronym = acronymMatch[1].replace(/[*_]+/g, '').trim().replace(/[^A-Za-z]/g, '');
                continue;
            }

            // Check for sector (tolerates markdown: **SECTOR:**, ### SECTOR:, - SECTOR:, etc.)
            const sectorMatch = trimmed.match(/^(?:[*_#\->\s]*)?SECTOR[*_]*:\s*(.+)/i);
            if (sectorMatch) {
                currentSector = { name: sectorMatch[1].replace(/[*_]+$/g, '').trim(), description: '', factors: [] };
                result.sectors.push(currentSector);
                continue;
            }

            // Check for description
            const descMatch = trimmed.match(/^(?:[*_#\->\s]*)?DESCRIPTION[*_]*:\s*(.+)/i);
            if (descMatch && currentSector) {
                currentSector.description = descMatch[1].replace(/[*_]+$/g, '').trim();
                continue;
            }

            // Check for factor (tolerates markdown and dash/bullet prefixes)
            const factorMatch = trimmed.match(/^(?:[*_#\->\s]*)?FACTOR[*_]*\s*\d+[*_]*:\s*(.+)/i);
            if (factorMatch && currentSector) {
                const parts = factorMatch[1].split('|').map(s => s.replace(/[*_]+/g, '').trim());
                currentSector.factors.push({
                    label: parts[0] || '',
                    description: parts[1] || '',
                });
                continue;
            }
        }

        return result;
    };

    // ---- Feature: Step 3 CCM Pre-scoring ----

    const prescoreCCM = async (btnEl) => {
        if (!connected) return;

        const pairs = FARCore.getSectorPairs();
        const select = document.getElementById('ccm-pair-select');
        const pairIdx = select?.value === 'all' ? -1 : parseInt(select?.value || '0');

        if (pairIdx === -1) {
            alert('Please select a specific sector pair to pre-score (not "All pairs").');
            return;
        }

        const [sector1, sector2] = pairs[pairIdx];
        const { prompt, system, pairs: factorPairs } = buildCCMPrescoringPrompt(sector1, sector2);

        btnEl.disabled = true;

        const { panel, contentEl, dismiss } = createCCMSuggestionPanel(
            btnEl,
            factorPairs,
            (results) => {
                results.forEach(({ f1, f2, compatible, note }) => {
                    FARCore.setCCMEntry(f1, f2, compatible, note);
                });
                FARUI.renderCCMTable();
                FARUI.updateCCMStats();
                FARUI.renderSolutionSpace();
                btnEl.disabled = false;
            },
            () => { btnEl.disabled = false; }
        );

        try {
            let fullText = '';
            await streamGenerate(prompt, system,
                (chunk, text) => {
                    fullText = text;
                    contentEl.textContent = text;
                },
                (text) => {
                    // Parse response and render checkboxes
                    const parsed = parseCCMResponse(text, factorPairs);
                    renderCCMCheckboxes(contentEl, parsed);
                    btnEl.disabled = false;
                }
            );
        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    const parseCCMResponse = (text, factorPairs) => {
        const results = [];
        const lines = text.split('\n');

        /** Build a regex that matches a factor pair like A1:B2 with flexible separators */
        const pairRegex = (id1, id2) => {
            // Match id1 <sep> id2 where sep can be :, /, vs, -, —, spaces, or combos
            // Allow optional markdown characters like * or _ around the IDs
            const esc1 = id1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const esc2 = id2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const sep = '[\\s:./,;|—\\-]+(vs\\.?[\\s]*)?';
            return new RegExp(`[*_]*${esc1}[*_]*${sep}[*_]*${esc2}[*_]*`, 'i');
        };

        for (const pair of factorPairs) {
            const re1 = pairRegex(pair.f1.id, pair.f2.id);
            const re2 = pairRegex(pair.f2.id, pair.f1.id);
            // Also try matching by factor labels (for models that use names instead of IDs)
            const labelRe1 = pair.f1.label && pair.f2.label
                ? pairRegex(pair.f1.label.substring(0, 20), pair.f2.label.substring(0, 20)) : null;
            const labelRe2 = pair.f1.label && pair.f2.label
                ? pairRegex(pair.f2.label.substring(0, 20), pair.f1.label.substring(0, 20)) : null;
            let found = false;

            for (const line of lines) {
                const cleanLine = line.replace(/[*_]/g, '');
                const m1 = re1.exec(line);
                const m2 = !m1 ? re2.exec(line) : null;
                const m3 = (!m1 && !m2 && labelRe1) ? labelRe1.exec(cleanLine) : null;
                const m4 = (!m1 && !m2 && !m3 && labelRe2) ? labelRe2.exec(cleanLine) : null;
                const match = m1 || m2 || m3 || m4;
                if (!match) continue;

                const matchEnd = match.index + match[0].length;
                const srcLine = (m3 || m4) ? cleanLine : line;
                const afterPair = srcLine.substring(matchEnd);

                // Match YES/NO, Compatible/Incompatible, PASS/FAIL, True/False
                const yesRe = /\b(YES|COMPATIBLE|PASS|TRUE|CAN COEXIST)\b/i;
                const noRe = /\b(NO|INCOMPATIBLE|FAIL|FALSE|CANNOT|INCONSISTENT)\b/i;
                const hasYes = yesRe.test(afterPair);
                const hasNo = noRe.test(afterPair);

                let compatible = true;
                if (hasNo && !hasYes) {
                    compatible = false;
                } else if (hasYes && hasNo) {
                    const yesIdx = afterPair.search(yesRe);
                    const noIdx = afterPair.search(noRe);
                    compatible = yesIdx < noIdx;
                }

                // Extract reasoning (text after YES/NO, separated by dash/colon)
                let note = '';
                const parts = afterPair.split(/\s*[—]\s*/);
                if (parts.length >= 3) {
                    note = parts.slice(2).join(' — ');
                } else if (parts.length >= 2) {
                    const yesNoMatch = parts[1].match(/^(YES|NO)\s*[—\-:.]?\s*(.*)/i);
                    if (yesNoMatch) {
                        note = yesNoMatch[2] || '';
                    }
                } else {
                    // Try splitting on regular dashes too
                    const dashParts = afterPair.split(/\s*[-–—]\s*/);
                    if (dashParts.length >= 3) {
                        note = dashParts.slice(2).join(' — ');
                    }
                }

                results.push({
                    f1: pair.f1.id,
                    f2: pair.f2.id,
                    f1Label: pair.f1.label || pair.f1.id,
                    f2Label: pair.f2.label || pair.f2.id,
                    compatible,
                    note: note.trim(),
                    raw: line.trim(),
                });
                found = true;
                break;
            }

            if (!found) {
                // Default to compatible when unparsed (Rhyne: "if any pattern can be imagined, it's Yes")
                results.push({
                    f1: pair.f1.id,
                    f2: pair.f2.id,
                    f1Label: pair.f1.label || pair.f1.id,
                    f2Label: pair.f2.label || pair.f2.id,
                    compatible: true,
                    note: 'Could not parse AI response for this pair — defaulting to compatible',
                    raw: '',
                });
            }
        }

        return results;
    };

    const renderCCMCheckboxes = (contentEl, parsed) => {
        let html = '<div class="ai-ccm-results">';
        parsed.forEach(r => {
            const statusClass = r.compatible ? 'compatible' : 'incompatible';
            const statusText = r.compatible ? 'Yes' : 'No';
            html += `
                <div class="ai-ccm-result-row">
                    <label class="ai-ccm-result-label">
                        <input type="checkbox" class="ai-ccm-check" checked
                               data-f1="${r.f1}" data-f2="${r.f2}"
                               data-compatible="${r.compatible}" data-note="${FARUI.escHtml(r.note)}">
                        <span class="ai-ccm-pair">${r.f1} (${FARUI.escHtml(r.f1Label)}) vs ${r.f2} (${FARUI.escHtml(r.f2Label)})</span>
                        <span class="badge badge-${statusClass}">${statusText}</span>
                    </label>
                    ${r.note ? `<div class="ai-ccm-reasoning">${FARUI.escHtml(r.note)}</div>` : ''}
                </div>`;
        });
        html += '</div>';
        contentEl.innerHTML = html;
    };

    // ---- Feature: Step 3 Filter 2 Holistic Assessment ----

    const FILTER2_BATCH_SIZE = 20;

    const assessFilter2 = async (btnEl) => {
        if (!connected) return;

        const filter1 = FARUI.getCachedFilter1() || FARCore.computeFilter1();
        const survivors = filter1.surviving;
        if (!survivors || survivors.length === 0) return;

        btnEl.disabled = true;

        // Remove any existing panel
        const existingPanel = btnEl.parentElement?.querySelector('.ai-suggestion-panel');
        if (existingPanel) existingPanel.remove();

        // Create panel
        const panel = document.createElement('div');
        panel.className = 'ai-suggestion-panel';
        panel.innerHTML = `
            <div class="ai-suggestion-header">
                <span class="ai-badge">AI Suggestion</span>
                <button class="ai-dismiss" title="Dismiss">&times;</button>
            </div>
            <div class="ai-suggestion-content"><span class="ai-loading-dots">Assessing ${survivors.length} configurations in batches of ${FILTER2_BATCH_SIZE}</span></div>
            <div class="ai-suggestion-actions">
                <button class="btn-primary btn-sm ai-f2-apply">Apply Selected</button>
                <button class="btn-ghost btn-sm ai-f2-dismiss">Dismiss</button>
            </div>
        `;
        btnEl.insertAdjacentElement('afterend', panel);

        const contentEl = panel.querySelector('.ai-suggestion-content');
        const dismissPanel = () => { panel.remove(); btnEl.disabled = false; };
        panel.querySelector('.ai-dismiss').addEventListener('click', dismissPanel);
        panel.querySelector('.ai-f2-dismiss').addEventListener('click', dismissPanel);

        // Process all configs in batches
        const allResults = [];
        const totalBatches = Math.ceil(survivors.length / FILTER2_BATCH_SIZE);

        try {
            for (let b = 0; b < totalBatches; b++) {
                const start = b * FILTER2_BATCH_SIZE;
                const batchConfigs = survivors.slice(start, start + FILTER2_BATCH_SIZE);
                const batchOffset = start; // to number configs globally

                contentEl.textContent = `Processing batch ${b + 1} of ${totalBatches} (configs ${start + 1}–${start + batchConfigs.length} of ${survivors.length})...`;

                const { prompt, system } = buildFilter2Prompt(batchConfigs, batchOffset);
                let batchText = '';
                await streamGenerate(prompt, system,
                    (chunk, text) => {
                        batchText = text;
                        contentEl.textContent = `Batch ${b + 1}/${totalBatches} (configs ${start + 1}–${start + batchConfigs.length}):\n\n${text}`;
                    },
                    () => {}
                );

                const parsed = parseFilter2Response(batchText, batchConfigs, batchOffset);
                allResults.push(...parsed);
            }

            // Render all results as checkboxes
            renderFilter2Checkboxes(contentEl, allResults);

            // Bind apply
            panel.querySelector('.ai-f2-apply').addEventListener('click', async () => {
                const checkboxes = panel.querySelectorAll('.ai-f2-check');
                checkboxes.forEach(cb => {
                    if (!cb.checked) return;
                    const idx = parseInt(cb.dataset.idx);
                    const r = allResults[idx];
                    if (r) {
                        const config = FARCore.parseConfigKey(r.key);
                        FARCore.setFilter2Entry(config, r.pass, r.note);
                    }
                });

                // Adaptive re-filter if too many survivors remain
                const postFilter1 = FARCore.computeFilter1();
                const postSurvivors = FARCore.getFinalSurvivors(postFilter1.surviving || []);
                const threshold = MAX_SURVIVORS[strictness] || 20;
                if (postSurvivors.length > threshold) {
                    contentEl.textContent = `Too many survivors (${postSurvivors.length}), running adaptive re-filter to ~${threshold}...`;
                    await runAdaptiveRefilter(
                        postSurvivors,
                        (msg) => { contentEl.textContent = msg; },
                        () => {}
                    );
                }

                // Adaptive relaxation if too few survivors
                const relaxFilter1 = FARCore.computeFilter1();
                const relaxSurvivors = FARCore.getFinalSurvivors(relaxFilter1.surviving || []);
                if (relaxSurvivors.length < MIN_SURVIVORS) {
                    contentEl.textContent = `Too few survivors (${relaxSurvivors.length}), relaxing filtering to reach at least ${MIN_SURVIVORS}...`;
                    await runAdaptiveRelax(
                        (msg) => { contentEl.textContent = msg; },
                        () => {}
                    );
                }

                panel.remove();
                FARUI.renderFilter2(survivors);
                FARUI.renderFinalResults(survivors);
                btnEl.disabled = false;
            });

        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    const parseFilter2Response = (text, configs, offset) => {
        const results = [];
        const lines = text.split('\n');

        for (let i = 0; i < configs.length; i++) {
            const globalNum = offset + i + 1;
            const key = FARCore.configKey(configs[i]);
            let found = false;

            for (const line of lines) {
                // Strategy 1: "#N ... PASS/REJECT ..."
                const match1 = line.match(new RegExp(`#${globalNum}\\b.*?(PASS|REJECT)(.*)`, 'i'));
                if (match1) {
                    const pass = match1[1].toUpperCase() === 'PASS';
                    let note = (match1[2] || '').replace(/^[\s—\-:]+/, '').trim();
                    results.push({ key, pass, note, configLabel: key });
                    found = true;
                    break;
                }

                // Strategy 2: "N. PASS/REJECT ..." or "N) PASS/REJECT ..." (no # prefix)
                const match2 = line.match(new RegExp(`(?:^|\\s)${globalNum}[\\.:)\\-]\\s*.*?(PASS|REJECT)(.*)`, 'i'));
                if (match2) {
                    const pass = match2[1].toUpperCase() === 'PASS';
                    let note = (match2[2] || '').replace(/^[\s—\-:]+/, '').trim();
                    results.push({ key, pass, note, configLabel: key });
                    found = true;
                    break;
                }

                // Strategy 3: "#N ... YES/NO ..." (some models use yes/no instead of pass/reject)
                const match3 = line.match(new RegExp(`#?${globalNum}\\b[\\s.:)\\-—]*.*?\\b(YES|NO)\\b(.*)`, 'i'));
                if (match3) {
                    const pass = match3[1].toUpperCase() === 'YES';
                    let note = (match3[2] || '').replace(/^[\s—\-:]+/, '').trim();
                    results.push({ key, pass, note, configLabel: key });
                    found = true;
                    break;
                }
            }

            if (!found) {
                results.push({ key, pass: true, note: 'Could not parse AI response for this config — defaulting to pass', configLabel: key });
            }
        }

        return results;
    };

    const renderFilter2Checkboxes = (contentEl, allResults) => {
        const rejectCount = allResults.filter(r => !r.pass).length;
        const passCount = allResults.length - rejectCount;
        let html = `<div class="ai-f2-summary">${allResults.length} configs assessed: ${passCount} pass, ${rejectCount} reject</div>`;
        html += '<div class="ai-ccm-results">';
        allResults.forEach((r, idx) => {
            const statusClass = r.pass ? 'compatible' : 'incompatible';
            const statusText = r.pass ? 'Pass' : 'Reject';
            html += `
                <div class="ai-ccm-result-row">
                    <label class="ai-ccm-result-label">
                        <input type="checkbox" class="ai-f2-check" checked
                               data-idx="${idx}">
                        <span class="ai-ccm-pair">#${idx + 1} ${FARUI.escHtml(r.configLabel)}</span>
                        <span class="badge badge-${statusClass}">${statusText}</span>
                    </label>
                    ${r.note ? `<div class="ai-ccm-reasoning">${FARUI.escHtml(r.note)}</div>` : ''}
                </div>`;
        });
        html += '</div>';
        contentEl.innerHTML = html;
    };

    // ---- Adaptive Re-filter ----

    const buildRefilterPrompt = (configs, targetCount) => {
        const state = FARCore.getState();
        const configDescriptions = configs.map((config) => {
            const key = FARCore.configKey(config);
            const factors = config.map(fId => {
                const f = FARCore.getFactorById(fId);
                const sector = FARCore.getSectorForFactor(fId);
                return `${sector?.name || sector?.letter || '?'}: ${f?.label || fId}${f?.description ? ' (' + f.description + ')' : ''}`;
            }).join('; ');
            return `[${key}]: ${factors}`;
        }).join('\n');
        return FARPrompts.refilter(state.project.name || 'Unnamed project', state.project.description || '', configDescriptions, configs.length, targetCount);
    };

    const parseRefilterResponse = (text, configs) => {
        const results = [];
        // Strip markdown bold/italic before parsing
        const cleanText = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '');
        const lines = cleanText.split('\n');

        // Match KEEP or synonyms vs REJECT or synonyms
        const keepWords = 'KEEP|RETAIN|PASS';
        const rejectWords = 'REJECT|REMOVE|ELIMINATE|DISCARD|DROP';
        const verdictRe = `(${keepWords}|${rejectWords})`;

        for (let i = 0; i < configs.length; i++) {
            const num = i + 1;
            const key = FARCore.configKey(configs[i]);
            const escapedKey = key.replace(/[-]/g, '\\-');
            let found = false;

            for (const line of lines) {
                // Strategy 1: config key match "A1-B2-C3 — KEEP/REJECT ..."
                const matchKey = line.match(new RegExp(`${escapedKey}.*?${verdictRe}(.*)`, 'i'));
                if (matchKey) {
                    const keep = !/(REJECT|REMOVE|ELIMINATE|DISCARD|DROP)/i.test(matchKey[1]);
                    let note = (matchKey[2] || '').replace(/^[\s—\-:]+/, '').trim();
                    results.push({ key, keep, note, config: configs[i] });
                    found = true;
                    break;
                }
                // Strategy 2: "#N ... KEEP/REJECT ..."
                const match1 = line.match(new RegExp(`#${num}\\b.*?${verdictRe}(.*)`, 'i'));
                if (match1) {
                    const keep = !/(REJECT|REMOVE|ELIMINATE|DISCARD|DROP)/i.test(match1[1]);
                    let note = (match1[2] || '').replace(/^[\s—\-:]+/, '').trim();
                    results.push({ key, keep, note, config: configs[i] });
                    found = true;
                    break;
                }
                // Strategy 3: "N. KEEP/REJECT ..." (numbered list)
                const match2 = line.match(new RegExp(`(?:^|\\s)${num}[\\.:)\\-]\\s*.*?${verdictRe}(.*)`, 'i'));
                if (match2) {
                    const keep = !/(REJECT|REMOVE|ELIMINATE|DISCARD|DROP)/i.test(match2[1]);
                    let note = (match2[2] || '').replace(/^[\s—\-:]+/, '').trim();
                    results.push({ key, keep, note, config: configs[i] });
                    found = true;
                    break;
                }
            }

            if (!found) {
                results.push({ key, keep: true, note: 'Could not parse AI response — defaulting to keep', config: configs[i] });
            }
        }

        return results;
    };

    const runAdaptiveRefilter = async (survivors, progressFn, previewFn) => {
        const threshold = MAX_SURVIVORS[strictness] || 20;
        if (survivors.length <= threshold) return false;

        const targetCount = Math.max(Math.floor(threshold * 0.8), 5);

        if (progressFn) progressFn(`Too many survivors (${survivors.length}), narrowing to ~${targetCount}...`);

        const REFILTER_BATCH = 30;
        const totalBatches = Math.ceil(survivors.length / REFILTER_BATCH);
        const allResults = [];

        for (let b = 0; b < totalBatches; b++) {
            const start = b * REFILTER_BATCH;
            const batch = survivors.slice(start, start + REFILTER_BATCH);
            const batchTarget = Math.max(Math.round(targetCount * (batch.length / survivors.length)), 1);

            const { prompt, system } = buildRefilterPrompt(batch, batchTarget);
            let batchText = '';
            await streamGenerate(prompt, system,
                (chunk, full) => {
                    batchText = full;
                    if (previewFn) previewFn(full);
                },
                () => {}
            );

            const parsed = parseRefilterResponse(batchText, batch);
            allResults.push(...parsed);
        }

        // Apply rejections and log all decisions
        const state = FARCore.getState();
        let rejectCount = 0;
        const timestamp = new Date().toISOString();
        allResults.forEach(r => {
            state.filterLog.push({
                timestamp,
                action: 'adaptive-refilter',
                configKey: r.key,
                decision: r.keep ? 'KEEP' : 'REJECT',
                note: r.note,
            });
            if (!r.keep) {
                FARCore.setFilter2Entry(r.config, false, `Adaptive re-filter: ${r.note}`);
                rejectCount++;
            }
        });

        return rejectCount > 0;
    };

    // ---- Adaptive Relaxation (too few survivors) ----

    const buildRelaxPrompt = (incompatiblePairs, rejectedConfigs, filter1Survivors, targetCount) => {
        const state = FARCore.getState();

        let pairsSection = '';
        if (incompatiblePairs.length > 0) {
            pairsSection = `\nINCOMPATIBLE FACTOR PAIRS (CCM — Filter 1):\nThese pairs were marked as incompatible. Reversing any one allows all configurations containing that pair to survive.\n\n`;
            pairsSection += incompatiblePairs.map((p, i) => {
                const f1 = FARCore.getFactorById(p.f1);
                const f2 = FARCore.getFactorById(p.f2);
                const s1 = FARCore.getSectorForFactor(p.f1);
                const s2 = FARCore.getSectorForFactor(p.f2);
                return `#P${i + 1} ${p.f1} (${s1?.name || '?'}: ${f1?.label || '?'}) vs ${p.f2} (${s2?.name || '?'}: ${f2?.label || '?'}) — Reason: ${p.note || 'No reasoning recorded'}`;
            }).join('\n');
        }

        let rejectsSection = '';
        if (rejectedConfigs.length > 0) {
            rejectsSection = `\nREJECTED CONFIGURATIONS (Filter 2):\nThese configurations survived pair-wise consistency but were rejected holistically. Reversing any one adds it back directly.\n\n`;
            rejectsSection += rejectedConfigs.map((r, i) => {
                const factors = FARCore.parseConfigKey(r.key).map(fId => {
                    const f = FARCore.getFactorById(fId);
                    const s = FARCore.getSectorForFactor(fId);
                    return `${s?.name || '?'}: ${f?.label || fId}`;
                }).join('; ');
                return `#R${i + 1} [${r.key}]: ${factors} — Reason: ${r.note || 'No reasoning recorded'}`;
            }).join('\n');
        }

        return FARPrompts.relax(state.project.name || 'Unnamed project', state.project.description || '', pairsSection, rejectsSection, filter1Survivors, targetCount);
    };

    const parseRelaxResponse = (text, incompatiblePairs, rejectedConfigs) => {
        const lines = text.split('\n');
        const pairRelaxations = [];
        const configRelaxations = [];

        for (let i = 0; i < incompatiblePairs.length; i++) {
            const tag = `#P${i + 1}`;
            for (const line of lines) {
                if (line.includes(tag)) {
                    const m = line.match(/RELAX|KEEP/i);
                    if (m && m[0].toUpperCase() === 'RELAX') {
                        pairRelaxations.push(incompatiblePairs[i]);
                    }
                    break;
                }
            }
        }

        for (let i = 0; i < rejectedConfigs.length; i++) {
            const tag = `#R${i + 1}`;
            for (const line of lines) {
                if (line.includes(tag)) {
                    const m = line.match(/RELAX|KEEP/i);
                    if (m && m[0].toUpperCase() === 'RELAX') {
                        configRelaxations.push(rejectedConfigs[i]);
                    }
                    break;
                }
            }
        }

        return { pairRelaxations, configRelaxations };
    };

    const runAdaptiveRelax = async (progressFn, previewFn) => {
        const state = FARCore.getState();

        // Gather incompatible CCM pairs
        const incompatiblePairs = [];
        Object.entries(state.ccm).forEach(([key, val]) => {
            if (!val.compatible) {
                const [f1, f2] = key.split(':');
                incompatiblePairs.push({ f1, f2, note: val.note || '' });
            }
        });

        // Gather Filter 2 rejections
        const rejectedConfigs = [];
        Object.entries(state.filter2).forEach(([key, val]) => {
            if (!val.pass) {
                rejectedConfigs.push({ key, note: val.note || '' });
            }
        });

        if (incompatiblePairs.length === 0 && rejectedConfigs.length === 0) {
            // Nothing to relax — filters haven't run or everything already passes
            return false;
        }

        const filter1 = FARCore.computeFilter1();
        const f1Count = filter1.surviving.length;

        if (progressFn) progressFn(`Too few survivors (${FARCore.getFinalSurvivors(filter1.surviving).length}), relaxing filtering to reach at least ${MIN_SURVIVORS}...`);

        const { prompt, system } = buildRelaxPrompt(incompatiblePairs, rejectedConfigs, f1Count, MIN_SURVIVORS);
        let responseText = '';
        await streamGenerate(prompt, system,
            (chunk, full) => {
                responseText = full;
                if (previewFn) previewFn(full);
            },
            () => {}
        );

        const { pairRelaxations, configRelaxations } = parseRelaxResponse(responseText, incompatiblePairs, rejectedConfigs);

        let changed = false;
        const timestamp = new Date().toISOString();

        // Apply CCM relaxations
        pairRelaxations.forEach(p => {
            FARCore.setCCMEntry(p.f1, p.f2, true, `Relaxed: ${p.note}`);
            state.filterLog.push({
                timestamp,
                action: 'adaptive-relax-ccm',
                configKey: `${p.f1}:${p.f2}`,
                decision: 'RELAX',
                note: p.note,
            });
            changed = true;
        });

        // Apply Filter 2 relaxations
        configRelaxations.forEach(r => {
            const config = FARCore.parseConfigKey(r.key);
            FARCore.setFilter2Entry(config, true, `Relaxed: ${r.note}`);
            state.filterLog.push({
                timestamp,
                action: 'adaptive-relax-filter2',
                configKey: r.key,
                decision: 'RELAX',
                note: r.note,
            });
            changed = true;
        });

        // Check if we need another round (if still below minimum after relaxation)
        if (changed) {
            const newFilter1 = FARCore.computeFilter1();
            const newFinal = FARCore.getFinalSurvivors(newFilter1.surviving || []);
            if (progressFn) progressFn(`After relaxation: ${newFinal.length} survivors (target: ${MIN_SURVIVORS})`);
        }

        return changed;
    };

    // ---- Feature: Step 4 Warning Indicators ----

    const suggestWarningIndicator = async (btnEl, lineIdx, configIdx) => {
        if (!connected) return;
        btnEl.disabled = true;

        const { prompt, system } = buildWarningIndicatorPrompt(lineIdx, configIdx);

        try {
            let fullText = '';
            await streamGenerate(prompt, system,
                (chunk, text) => { fullText = text; },
                (text) => {
                    // Fill the warning indicator input directly
                    const input = btnEl.closest('.warning-indicator-row')?.querySelector('.warning-indicator-input');
                    if (input) {
                        input.value = text.trim();
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    btnEl.disabled = false;
                }
            );
        } catch (err) {
            alert('AI error: ' + err.message);
            btnEl.disabled = false;
        }
    };

    // ---- Feature: Step 4 Narrative Drafting ----

    const draftNarrative = async (btnEl, lineIdx) => {
        if (!connected) return;
        btnEl.disabled = true;

        const { prompt, system } = buildNarrativePrompt(lineIdx);
        const textarea = btnEl.closest('.narrative-block')?.querySelector('textarea');

        const { contentEl, dismiss, makeEditable } = createSuggestionPanel(btnEl, {
            onApply: (text) => {
                if (textarea) {
                    textarea.value = text;
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
                btnEl.disabled = false;
            },
            onDismiss: () => { btnEl.disabled = false; },
        });

        try {
            await streamGenerate(prompt, system,
                (chunk, fullText) => { contentEl.textContent = fullText; },
                () => { makeEditable(); btnEl.disabled = false; }
            );
        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    // ---- Button Rendering Helpers ----

    const addBrainstormButton = () => {
        const container = document.getElementById('key-uncertainties')?.parentElement;
        if (!container || container.querySelector('.ai-btn-secondary')) return;

        const btn = document.createElement('button');
        btn.className = 'btn-secondary btn-sm ai-btn-secondary';
        btn.textContent = 'AI Brainstorm All';
        btn.disabled = !connected;
        btn.addEventListener('click', () => brainstorm(btn));
        container.appendChild(btn);
    };

    const addFieldAIButtons = () => {
        const fields = [
            { id: 'initial-view', label: 'Alternative Visions of the Future' },
            { id: 'field-boundaries', label: 'Field Boundaries' },
            { id: 'key-uncertainties', label: 'Key Uncertainties' },
        ];
        fields.forEach(({ id, label }) => {
            const textarea = document.getElementById(id);
            if (!textarea) return;
            const formGroup = textarea.closest('.form-group');
            const labelEl = formGroup?.querySelector('label');
            if (!labelEl || labelEl.querySelector('.ai-field-btn')) return;

            const btn = document.createElement('button');
            btn.className = 'ai-field-btn';
            btn.textContent = 'AI';
            btn.title = `Generate ${label} with AI`;
            btn.disabled = !connected;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                brainstormField(btn, id, id);
            });
            labelEl.appendChild(btn);
        });
    };

    const addSectorSuggestionButton = () => {
        const area = document.querySelector('.add-sector-area');
        if (!area || area.querySelector('.ai-btn-secondary')) return;

        const btn = document.createElement('button');
        btn.className = 'btn-secondary btn-sm ai-btn-secondary';
        btn.textContent = 'AI Suggest Sectors';
        btn.disabled = !connected;
        btn.addEventListener('click', () => suggestSectors(btn));
        area.appendChild(btn);
    };

    const addSectorFactorButtons = () => {
        document.querySelectorAll('.sector-block').forEach(block => {
            const header = block.querySelector('.sector-header');
            if (!header || header.querySelector('.ai-field-btn')) return;

            const nameInput = header.querySelector('.sector-name-input');
            const sectorId = nameInput?.dataset.sectorId;
            if (!sectorId) return;

            const btn = document.createElement('button');
            btn.className = 'ai-field-btn';
            btn.textContent = 'AI';
            btn.title = 'Suggest factors for this sector with AI';
            btn.disabled = !connected;
            btn.addEventListener('click', () => suggestFactorsForSector(btn, sectorId));
            // Insert after the name input, before the remove button
            const removeBtn = header.querySelector('.btn-danger');
            header.insertBefore(btn, removeBtn);
        });
    };

    const addCCMButton = () => {
        const controls = document.querySelector('.ccm-controls');
        if (!controls || controls.querySelector('.ai-btn-secondary')) return;

        const btn = document.createElement('button');
        btn.className = 'btn-secondary btn-sm ai-btn-secondary';
        btn.textContent = 'AI Pre-score';
        btn.disabled = !connected;
        btn.addEventListener('click', () => prescoreCCM(btn));
        controls.appendChild(btn);
    };

    const addFilter2Button = () => {
        const container = document.getElementById('filter2-container');
        if (!container || container.querySelector('.ai-btn-secondary')) return;
        // Only show if there are configs to assess
        const list = container.querySelector('.filter2-list');
        if (!list) return;

        const btn = document.createElement('button');
        btn.className = 'btn-secondary btn-sm ai-btn-secondary';
        btn.textContent = 'AI Assess';
        btn.disabled = !connected;
        btn.addEventListener('click', () => assessFilter2(btn));
        container.insertBefore(btn, list);
    };

    // ---- Feature: Step 4 Scenario Composition ----

    const suggestScenarioComposition = async (btnEl) => {
        if (!connected) return;

        const filter1 = FARUI.getCachedFilter1() || FARCore.computeFilter1();
        const finalSurvivors = FARCore.getFinalSurvivors(filter1.surviving || []);
        if (finalSurvivors.length === 0) {
            alert('No surviving configurations to compose scenarios from. Complete filtering first.');
            return;
        }

        const state = FARCore.getState();
        const colors = FARUI.SCENARIO_COLORS;
        const origText = btnEl.textContent;
        btnEl.disabled = true;

        try {
            // ---- Phase 1: Compose scenario lines ----
            btnEl.textContent = 'Composing scenarios...';
            const scPromptResult = buildScenarioCompositionPrompt(finalSurvivors);
            const scText = await streamGenerate(scPromptResult.prompt, scPromptResult.system, () => {}, () => {});

            const parsed = parseScenarioCompositionResponse(scText, scPromptResult.sortedSurvivors);

            if (parsed.length > 0) {
                state.scenarioLines = parsed.map((sl, i) => ({
                    id: 'sl_' + Date.now() + '_' + i,
                    name: sl.name,
                    description: sl.description,
                    color: colors[i % colors.length],
                    configs: sl.configs.map(c => ({
                        configKey: c.configKey,
                        periodLabel: c.periodLabel,
                        commitment: c.commitment,
                        freedom: c.freedom,
                        warningIndicator: c.warningIndicator || '',
                    })),
                    narrative: '',
                }));
            } else {
                console.warn('[FAR] Composition parsing failed, using fallback. AI response:', scText.substring(0, 800));
                // Fallback: build lines by similarity (nearest neighbor)
                const remaining = [...finalSurvivors];
                const fallbackLines = [];
                const lineSize = 4;

                while (remaining.length > 0 && fallbackLines.length < 5) {
                    const currentLine = [remaining.splice(0, 1)[0]];
                    while (currentLine.length < lineSize && remaining.length > 0) {
                        const last = currentLine[currentLine.length - 1];
                        let bestIdx = -1;
                        let bestDist = 999;
                        for (let j = 0; j < remaining.length; j++) {
                            const d = FARCore.configDistance(last, remaining[j]);
                            if (d < bestDist) { bestDist = d; bestIdx = j; }
                        }
                        if (bestIdx !== -1) currentLine.push(remaining.splice(bestIdx, 1)[0]);
                        else break;
                    }
                    fallbackLines.push({
                        id: 'sl_' + Date.now() + '_' + fallbackLines.length,
                        name: 'Scenario ' + (fallbackLines.length + 1),
                        description: '',
                        color: colors[fallbackLines.length % colors.length],
                        configs: currentLine.map((config, ci) => ({
                            configKey: FARCore.configKey(config),
                            periodLabel: ci === 0 ? 'Present' : 'T' + ci,
                            commitment: 5, freedom: 5,
                            warningIndicator: '',
                        })),
                        narrative: '',
                    });
                }
                state.scenarioLines = fallbackLines;
            }

            FARUI.renderScenarioLines();
            FARTree.renderTree();

            // ---- Phase 2: Generate warning indicators for empty transitions ----
            if (state.project.collectWarningIndicators) {
                for (let li = 0; li < state.scenarioLines.length; li++) {
                    const line = state.scenarioLines[li];
                    for (let ci = 0; ci < (line.configs || []).length - 1; ci++) {
                        if (line.configs[ci].warningIndicator) continue; // already populated
                        if (isLocked(`s6:warning:${li}:${ci}`)) continue;
                        btnEl.textContent = `Warning indicators (${li + 1}/${state.scenarioLines.length})...`;
                        try {
                            const wiPrompt = buildWarningIndicatorPrompt(li, ci);
                            const wiText = await streamGenerate(wiPrompt.prompt, wiPrompt.system, () => {}, () => {});
                            line.configs[ci].warningIndicator = wiText.trim();
                        } catch { /* skip */ }
                    }
                }
                FARUI.renderScenarioLines();
            }

            // ---- Phase 3: Draft narratives ----
            for (let li = 0; li < state.scenarioLines.length; li++) {
                const line = state.scenarioLines[li];
                if (!line.configs || line.configs.length === 0) continue;
                if (isLocked(`s7:narrative:${li}`)) continue;
                btnEl.textContent = `Drafting narrative ${li + 1}/${state.scenarioLines.length}...`;
                try {
                    const { prompt: narPrompt, system: narSystem } = buildNarrativePrompt(li);
                    const narText = await streamGenerate(narPrompt, narSystem, () => {}, () => {});
                    if (narText) line.narrative = narText;
                } catch { /* skip */ }
            }

            FARUI.renderScenarioLines();
            FARUI.renderNarratives();
            FARTree.renderTree();

        } catch (err) {
            alert('AI Compose error: ' + err.message);
        }

        btnEl.textContent = origText;
        btnEl.disabled = false;
    };

    const addScenarioCompositionButton = () => {
        const controls = document.querySelector('.scenario-controls');
        if (!controls || controls.querySelector('.ai-btn-secondary')) return;

        const btn = document.createElement('button');
        btn.className = 'btn-secondary btn-sm ai-btn-secondary';
        btn.textContent = 'AI Compose Scenarios';
        btn.disabled = !connected;
        btn.addEventListener('click', () => suggestScenarioComposition(btn));
        controls.appendChild(btn);
    };

    const addWarningIndicatorButtons = () => {
        document.querySelectorAll('.warning-indicator-row').forEach(row => {
            if (row.querySelector('.ai-btn')) return;

            const lineIdx = parseInt(row.querySelector('.warning-indicator-input')?.dataset.lineIdx);
            const configIdx = parseInt(row.querySelector('.warning-indicator-input')?.dataset.configIdx);
            if (isNaN(lineIdx) || isNaN(configIdx)) return;

            const btn = document.createElement('button');
            btn.className = 'ai-btn';
            btn.textContent = 'AI';
            btn.title = 'Suggest warning indicator with AI';
            btn.disabled = !connected;
            btn.addEventListener('click', () => suggestWarningIndicator(btn, lineIdx, configIdx));
            row.appendChild(btn);
        });
    };

    const addNarrativeButtons = () => {
        // Per-line buttons
        document.querySelectorAll('.narrative-block').forEach((block, li) => {
            if (block.querySelector('.ai-field-btn')) return;

            const h3 = block.querySelector('h3');
            if (!h3) return;

            const btn = document.createElement('button');
            btn.className = 'ai-field-btn';
            btn.textContent = 'AI';
            btn.title = 'Draft narrative for this scenario line with AI';
            btn.disabled = !connected;
            btn.addEventListener('click', () => draftNarrative(btn, li));
            h3.appendChild(btn);
        });

        // Section-level "Draft All" button
        const container = document.getElementById('narratives-container');
        if (!container || container.querySelector('.ai-btn-secondary')) return;
        const blocks = container.querySelectorAll('.narrative-block');
        if (blocks.length === 0) return;

        const btn = document.createElement('button');
        btn.className = 'btn-secondary btn-sm ai-btn-secondary';
        btn.textContent = 'AI Draft All';
        btn.disabled = !connected;
        btn.addEventListener('click', () => draftAllNarratives(btn));
        container.insertBefore(btn, container.firstChild);
    };

    // ---- Scenario Naming (post-narrative) ----

    const buildScenarioNamingPrompt = (scenarioLines) => {
        const summaries = scenarioLines.map((line, i) => {
            const narrative = (line.narrative || '').trim();
            const desc = (line.description || '').trim();
            const text = narrative || desc || 'No narrative available';
            return `SCENARIO ${i + 1}:\n${text}`;
        }).join('\n\n');
        return FARPrompts.scenarioNaming(summaries, scenarioLines);
    };

    const parseScenarioNamingResponse = (text, count) => {
        const names = [];
        const lines = text.split('\n').map(l => l.replace(/\*\*/g, '').trim()).filter(l => l);

        for (let i = 1; i <= count; i++) {
            let found = '';

            // Strategy 1: "NAME N: ..." (exact format)
            for (const line of lines) {
                const m = line.match(new RegExp(`NAME\\s*${i}\\s*:\\s*(.+)`, 'i'));
                if (m) { found = m[1].trim(); break; }
            }

            // Strategy 2: "Scenario N: ..." or "N. ..." or "N) ..."
            if (!found) {
                for (const line of lines) {
                    const m = line.match(new RegExp(`(?:SCENARIO\\s*)?${i}[\\.:)\\-]\\s*(.+)`, 'i'));
                    if (m) {
                        const val = m[1].replace(/^["']|["']$/g, '').trim();
                        // Skip lines that look like config references or instructions
                        if (val && !val.match(/^#?\d+\s*\|/) && !val.match(/^CONFIG/i)) {
                            found = val;
                            break;
                        }
                    }
                }
            }

            names.push(found);
        }
        return names;
    };

    const nameScenarios = async (progressFn, previewFn) => {
        const state = FARCore.getState();
        if (!connected || state.scenarioLines.length === 0) return;

        const prompt = buildScenarioNamingPrompt(state.scenarioLines);
        const text = await streamGenerate(
            prompt.prompt, prompt.system,
            (chunk, full) => { if (previewFn) previewFn(full); },
            () => {}
        );
        const names = parseScenarioNamingResponse(text, state.scenarioLines.length);
        names.forEach((name, i) => {
            if (name && i < state.scenarioLines.length) {
                state.scenarioLines[i].name = name;
            }
        });
    };

    // ---- Scenario Composition Prompt (NEW for Autopilot) ----

    const buildScenarioCompositionPrompt = (survivors, respectLocks = false) => {
        const state = FARCore.getState();
        const sectorInfo = state.sectors.map(s =>
            `${s.letter}: ${s.name || 'Unnamed'} (${s.factors.map(f => `${f.id}=${f.label || '?'}`).join(', ')})`
        ).join('\n');

        // Sort survivors so that the most "present-like" config is #1
        // Heuristic: the config whose factors have the lowest index (e.g., A1, B1, C1) is most likely the status quo
        const sortedSurvivors = [...survivors].sort((a, b) => {
            const scoreA = a.reduce((s, fId) => s + parseInt(fId.replace(/[A-Z]/i, '') || '9'), 0);
            const scoreB = b.reduce((s, fId) => s + parseInt(fId.replace(/[A-Z]/i, '') || '9'), 0);
            return scoreA - scoreB;
        });

        const configDescriptions = sortedSurvivors.map((config, i) => {
            const key = FARCore.configKey(config);
            const factors = config.map(fId => {
                const f = FARCore.getFactorById(fId);
                const sector = FARCore.getSectorForFactor(fId);
                return `${sector?.name || sector?.letter || '?'}: ${f?.label || fId}`;
            }).join('; ');
            return `#${i + 1} [${key}]: ${factors}${i === 0 ? ' ← THIS IS THE PRESENT' : ''}`;
        }).join('\n');
        const minConfigs = Math.max(2, Math.min(3, survivors.length));
        const maxConfigs = Math.min(7, survivors.length);
        const targetLines = Math.max(2, Math.min(6, survivors.length - 1));

        const result = FARPrompts.scenarioComposition(state.project.name || 'Unnamed project', state.project.description || 'No description provided', state.project.horizon || 'Not specified', sectorInfo, configDescriptions, survivors.length, minConfigs, maxConfigs, targetLines);
        result.sortedSurvivors = sortedSurvivors;
        return result;
    };

    /** Extract factor IDs (e.g. A1, B3, C2) from arbitrary text and sort them */
    const extractFactorIds = (text) => {
        const ids = [];
        const re = /[A-Z]\d+/gi;
        let m;
        while ((m = re.exec(text)) !== null) ids.push(m[0].toUpperCase());
        return ids.sort();
    };

    const parseScenarioCompositionResponse = (text, survivors) => {
        // Primary strategy: number-to-key lookup (#1, #2, etc.)
        const numberToKey = new Map();
        survivors.forEach((config, i) => {
            numberToKey.set(i + 1, FARCore.configKey(config));
        });

        const survivorKeys = new Set(survivors.map(c => FARCore.configKey(c)));

        // Fallback lookup strategies for robust key matching
        const normalizedLookup = new Map();
        const sortedFactorLookup = new Map();
        survivorKeys.forEach(k => {
            normalizedLookup.set(k, k);
            const norm = k.replace(/[\s\[\]_,()'"]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            if (!normalizedLookup.has(norm)) normalizedLookup.set(norm, k);
            const sorted = extractFactorIds(k).join('-');
            if (!sortedFactorLookup.has(sorted)) sortedFactorLookup.set(sorted, k);
        });

        /** Try all strategies to match a raw config key string to a survivor */
        const resolveConfigKey = (raw) => {
            if (!raw) return null;
            const trimmed = raw.trim();

            // 1. Exact match with survivor keys
            if (survivorKeys.has(trimmed)) return trimmed;

            // 2. Pure number reference (#N or just N)
            const pureNumMatch = trimmed.match(/^#?(\d+)$/);
            if (pureNumMatch) {
                const n = parseInt(pureNumMatch[1]);
                if (numberToKey.has(n)) return numberToKey.get(n);
            }

            // 2b. Number reference at start with trailing text (e.g. "#5 (description)" or "#5, A1-B2-C3")
            const leadingNumMatch = trimmed.match(/^#(\d+)\b/);
            if (leadingNumMatch) {
                const n = parseInt(leadingNumMatch[1]);
                if (numberToKey.has(n)) return numberToKey.get(n);
            }

            // 3. Normalized (strip formatting)
            const norm = trimmed.replace(/[\s\[\]_,()'"]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            if (normalizedLookup.has(norm)) return normalizedLookup.get(norm);

            // 4. Extract and sort factor IDs (handles commas, spaces, reordering)
            const sorted = extractFactorIds(trimmed).join('-');
            if (sorted && sortedFactorLookup.has(sorted)) return sortedFactorLookup.get(sorted);

            // 5. If it still looks like a number reference but has junk around it (e.g. "**#1**")
            // and it DOES NOT look like it contains factor IDs (no A-Z followed by digit)
            if (!/[A-Z]\d/i.test(trimmed)) {
                const flexNumMatch = trimmed.match(/#?(\d+)/);
                if (flexNumMatch) {
                    const n = parseInt(flexNumMatch[1]);
                    if (numberToKey.has(n)) return numberToKey.get(n);
                }
            }

            // 6. Last resort: strip all non-alphanumeric except hyphens
            const stripped = trimmed.replace(/[^A-Za-z0-9-]/g, '');
            if (survivorKeys.has(stripped)) return stripped;
            if (normalizedLookup.has(stripped)) return normalizedLookup.get(stripped);

            return null;
        };

        const lines = text.split('\n');
        const scenarioLines = [];
        let current = null;
        let droppedCount = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Strip markdown formatting like ** or - or * or leading/trailing | boxes
            // Preserve # when followed by a digit (config reference like #5)
            const cleanLine = trimmed
                .replace(/^[\s\-*|]+/, '')     // Strip leading dashes, asterisks, pipes, whitespace
                .replace(/^#{1,6}\s+/, '')     // Strip markdown headers (## Heading)
                .replace(/[|]+$/, '')          // Strip trailing pipes
                .replace(/\*\*/g, '')          // Strip bolding
                .trim();

            // Match scenario headers — many formats: "SCENARIO LINE:", "Scenario 1:", "Scenario Line 1 -", "Line 1:", etc.
            const slMatch = cleanLine.match(/SCENARIO(?:\s+LINE)?(?:\s*\d+)?\s*[:—\-]\s*(.+)/i)
                || cleanLine.match(/^LINE\s*\d+\s*[:—\-]\s*(.+)/i);
            if (slMatch) {
                current = { name: slMatch[1].trim(), description: '', configs: [] };
                scenarioLines.push(current);
                continue;
            }

            // Match plain numbered headings as scenario starts: "1. Green Transition" (only if it doesn't look like a config ref)
            const numberedHeading = cleanLine.match(/^(\d+)[\.\)]\s+([A-Z][A-Za-z].*)/);
            if (numberedHeading && !numberedHeading[2].match(/^#?\d+[\s\(\|,\-]/) && !numberedHeading[2].match(/^CONFIG/i)) {
                const name = numberedHeading[2].replace(/[:—\-]\s*$/, '').trim();
                if (name.length > 2 && name.length < 80) {
                    current = { name, description: '', configs: [] };
                    scenarioLines.push(current);
                    continue;
                }
            }

            const descMatch = cleanLine.match(/DESCRIPTION:\s*(.+)/i);
            if (descMatch && current) {
                current.description = descMatch[1].trim();
                continue;
            }

            // Match CONFIG lines: many formats AI models use
            const cfgMatch = cleanLine.match(/(?:CONFIG(?:URATION)?\s*\d+|STEP\s*\d+)\s*[:—\-]\s*(.+)/i)
                || (current && cleanLine.match(/^\d+[\.\)]\s*(#\d+\s*\|.+)/i))  // numbered list with #ref: "1. #5 | ..."
                || (current && cleanLine.match(/^\d+[\.\)]\s*(#\d+\s*[,\-—].+)/i))  // "1. #5 - Present, F:3"
                || (current && cleanLine.match(/^(#\d+\s*\|.+)/i))   // bare "#5 | Present | ..."
                || (current && cleanLine.match(/^(#\d+\s*[,\-—]\s*.+)/i)) // "#5 - Present, F:3, O:8"
                || (current && cleanLine.match(/^(\d+\s*\|.+)/i))    // bare "5 | Present | ..." (table row)
                || (current && cleanLine.match(/^[^a-zA-Z]*?(#\d+[\s\(\|,].+)/i))  // any line starting with #N: "#5 (Present, F:3)"
                || (current && cleanLine.match(/^(\w[\w\s\-]*?:\s*#\d+.+)/i));  // "Present: #5 (F:3, O:8)"
            if (cfgMatch && current) {
                const fullLine = cfgMatch[1];
                // Split parts by pipe, semicolon or multiple spaces and filter out empty strings
                const parts = fullLine.split(/\s*[|;]\s*/).map(s => s.trim()).filter(s => s !== '');

                // Extract the #N config reference from anywhere in the line
                let rawKey = parts[0] || '';
                const hashRef = fullLine.match(/#(\d+)/);
                if (hashRef) rawKey = '#' + hashRef[1];

                // Extract period label: check pipe-parts, or parse from "Period: #N" format
                let periodLabel = '';
                for (const p of parts) {
                    if (/present|now|current|\b\d{4}\b/i.test(p) && !/#\d+/.test(p) && !/^[FO][\s:=]/i.test(p)) {
                        periodLabel = p.replace(/^[\s:—\-]+/, '').trim();
                        break;
                    }
                }
                // Fallback: if the original line has "Period: #N" format, extract period before the #
                if (!periodLabel) {
                    const periodFirst = fullLine.match(/^([\w\s\-+]+?):\s*#\d+/i);
                    if (periodFirst) {
                        const candidate = periodFirst[1].trim();
                        if (/present|now|current|\b\d{4}\b/i.test(candidate)) {
                            periodLabel = candidate;
                        }
                    }
                }
                // Fallback: check comma-separated parts (strip parentheses first)
                if (!periodLabel) {
                    const stripped = fullLine.replace(/[()]/g, ' ');
                    const commaParts = stripped.split(/\s*,\s*/);
                    for (const cp of commaParts) {
                        const clean = cp.trim();
                        if (/present|now|current|\b\d{4}\b/i.test(clean) && !/#\d+/.test(clean) && !/^[FO][\s:=]/i.test(clean)) {
                            periodLabel = clean.replace(/^[\s:—\-]+/, '').trim();
                            break;
                        }
                    }
                }
                // Search the entire line for F/Commitment and O/Freedom values
                const fMatch = fullLine.match(/\bF(?:austianness)?[\s:=]*(\d+)/i)
                    || fullLine.match(/\bCommitment[\s:=]*(\d+)/i)
                    || fullLine.match(/\bC[\s:=]+(\d+)\s*[,|;\/]\s*(?:O|F(?:reedom))/i);  // "C:3, O:8" or "C:3 | Freedom:8"
                const oMatch = fullLine.match(/\bO(?:penness)?[\s:=]*(\d+)/i)
                    || fullLine.match(/\bFreedom[\s:=]*(\d+)/i);

                let commitment = fMatch ? Math.min(10, Math.max(1, parseInt(fMatch[1]))) : 0;
                let freedom = oMatch ? Math.min(10, Math.max(1, parseInt(oMatch[1]))) : 0;

                // Fallback 1: "N/10" format (check before bare numbers to avoid partial matches)
                if (!commitment || !freedom) {
                    const slashNums = [...fullLine.matchAll(/(\d+)\s*\/\s*10/g)];
                    if (slashNums.length >= 2) {
                        if (!commitment) commitment = Math.min(10, Math.max(1, parseInt(slashNums[0][1])));
                        if (!freedom) freedom = Math.min(10, Math.max(1, parseInt(slashNums[1][1])));
                    }
                }
                // Fallback 2: bare number pairs separated by comma or semicolon (not pipe — too ambiguous)
                if (!commitment && !freedom) {
                    const bareNums = fullLine.match(/\b([1-9]|10)\s*[,;]\s*([1-9]|10)\b/);
                    if (bareNums) {
                        commitment = parseInt(bareNums[1]);
                        freedom = parseInt(bareNums[2]);
                    }
                }
                if (!commitment) commitment = 5;
                if (!freedom) freedom = 5;

                // Extract trigger — inline "TRIGGER:" or after the last pipe/semicolon
                const triggerInLine = fullLine.match(/TRIGGER:\s*(.+?)$/i);
                let inlineTrigger = triggerInLine ? triggerInLine[1].trim() : '';
                // Fallback: if no explicit TRIGGER label, check if the last pipe-separated part looks like a trigger description
                if (!inlineTrigger && parts.length >= 4) {
                    const lastPart = parts[parts.length - 1];
                    // If the last part isn't an F/O score and isn't short, treat it as a trigger
                    if (lastPart.length > 15 && !/^[FO][\s:=]*\d+$/i.test(lastPart) && !/^TRIGGER/i.test(lastPart)) {
                        inlineTrigger = lastPart;
                    }
                }

                const configKey = resolveConfigKey(rawKey);
                if (configKey) {
                    current.configs.push({ configKey, periodLabel, commitment, freedom, warningIndicator: inlineTrigger });
                } else {
                    droppedCount++;
                    console.warn(`[FAR] Dropped config: "${rawKey}" not in survivor set (scenario: "${current.name}")`);
                }
                continue;
            }

            // Parse standalone TRIGGER lines
            const trigMatch = cleanLine.match(/TRIGGER:\s*(.+)/i);
            if (trigMatch && current && current.configs.length > 0) {
                const lastCfg = current.configs[current.configs.length - 1];
                if (!lastCfg.warningIndicator) lastCfg.warningIndicator = trigMatch[1].trim();
            }
        }

        if (droppedCount > 0) {
            console.warn(`[FAR] Total configs dropped: ${droppedCount}/${droppedCount + scenarioLines.reduce((s, l) => s + l.configs.length, 0)}`);
        }

        // Log scenario parsing results for debugging
        if (scenarioLines.length === 0) {
            console.warn('[FAR] No scenario lines parsed! First 500 chars of AI response:', text.substring(0, 500));
        }
        scenarioLines.forEach((sl, i) => {
            console.log(`[FAR] Parsed scenario ${i + 1}: "${sl.name}" — ${sl.configs.length} configs`);
        });

        const valid = scenarioLines.filter(sl => sl.configs.length >= 2);
        if (valid.length < scenarioLines.length) {
            console.warn(`[FAR] Dropped ${scenarioLines.length - valid.length} scenario lines with < 2 configs`);
        }
        // Cap at 10 scenario lines maximum
        if (valid.length > 10) {
            console.warn(`[FAR] Capping scenario lines from ${valid.length} to 10`);
            return valid.slice(0, 10);
        }
        return valid;
    };

    // ---- Autopilot Re-run (only redo AI work relevant to user changes) ----

    let autopilotHasRun = localStorage.getItem('far_autopilot_done') === '1';
    // Stages: 1=initial view, 2=sectors, 3=CCM, 4=filter2, 5=scenarios, 6=warnings, 7=narratives
    let lastUserEditStage = 0;

    const showAssistedButton = () => {
        const btn = document.getElementById('btn-assisted');
        if (btn) btn.style.display = '';
    };

    const hideAssistedButton = () => {
        const btn = document.getElementById('btn-assisted');
        if (btn) btn.style.display = 'none';
    };

    const markUserEdit = (stage, element) => {
        if (!autopilotHasRun) return;
        if (stage > lastUserEditStage) {
            lastUserEditStage = stage;
        }
        // Auto-lock the field if we can derive a field ID
        if (element) {
            const fid = fieldIdFromElement(element);
            if (fid) {
                const value = element.value || element.textContent || '';
                lockField(fid, value, stage);
                decorateLockedField(element, fid);
            }
        }
    };

    const bindUserEditTracking = () => {
        // Use the step panels themselves as delegation roots — these are static
        // DOM elements that always exist. Track input, change, and click on
        // interactive elements to catch all edit types (text, selects, buttons).

        const trackOnPanel = (stepSelector, stage, events = ['input', 'change']) => {
            const panel = document.querySelector(stepSelector);
            if (!panel) return;
            events.forEach(evt => {
                panel.addEventListener(evt, (e) => {
                    // Only track edits on actual form/interactive elements
                    const tag = e.target.tagName;
                    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
                        markUserEdit(stage, e.target);
                    }
                    // Also track button clicks that structurally change data
                    // (add/remove sector, add/remove factor, CCM toggles)
                    if (evt === 'click' && tag === 'BUTTON') {
                        markUserEdit(stage, null);
                    }
                });
            });
        };

        // Step 1 panel → stage 1 (initial view)
        trackOnPanel('.step-panel[data-step="1"]', 1);

        // Step 2 panel → stage 2 (sectors & factors)
        trackOnPanel('.step-panel[data-step="2"]', 2, ['input', 'change', 'click']);

        // Step 3 panel → stage 3 (CCM / filtering)
        trackOnPanel('.step-panel[data-step="3"]', 3, ['input', 'change', 'click']);

        // Step 4 panel → stage 5 (scenario composition, warnings, narratives)
        trackOnPanel('.step-panel[data-step="4"]', 5, ['input', 'change', 'click']);
    };

    // ---- Autopilot Progress Overlay ----

    let autopilotAborted = false;

    const showAutopilotOverlay = () => {
        autopilotAborted = false;
        const overlay = document.createElement('div');
        overlay.className = 'autopilot-overlay';
        overlay.id = 'autopilot-overlay';
        overlay.innerHTML = `
            <div class="autopilot-modal">
                <h2>Analyzing Scenarios</h2>
                <div class="autopilot-step" id="autopilot-step-label">Initializing...</div>
                <div class="autopilot-substep" id="autopilot-substep-label"></div>
                <div class="autopilot-preview" id="autopilot-preview"></div>
                <div class="autopilot-progress">
                    <div class="autopilot-progress-fill" id="autopilot-progress-fill" style="width:0%"></div>
                </div>
                <button class="btn-ghost" id="autopilot-cancel">Cancel</button>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('autopilot-cancel').addEventListener('click', () => {
            autopilotAborted = true;
        });
    };

    const AUTOPILOT_STEPS = ['1', '2', '2a', '2b', '3a', '3b', '4a', '4b'];
    const STEP_MAJOR = { '1': 1, '2': 2, '2a': 3, '2b': 3, '3a': 4, '3b': 4, '4a': 5, '4b': 5 };
    const TOTAL_MAJOR_STEPS = 5;

    const updateAutopilotProgress = (stepId, totalSteps, stepLabel, substepLabel) => {
        const stepEl = document.getElementById('autopilot-step-label');
        const subEl = document.getElementById('autopilot-substep-label');
        const fillEl = document.getElementById('autopilot-progress-fill');
        const major = STEP_MAJOR[String(stepId)] || stepId;
        if (stepEl) stepEl.textContent = `Step ${major} of ${TOTAL_MAJOR_STEPS}: ${stepLabel}`;
        if (subEl) subEl.textContent = substepLabel || '';
        if (fillEl) {
            const idx = AUTOPILOT_STEPS.indexOf(String(stepId));
            const pct = idx >= 0 ? Math.round(((idx + 1) / AUTOPILOT_STEPS.length) * 100) : 0;
            fillEl.style.width = `${pct}%`;
        }
    };

    const updateAutopilotPreview = (text) => {
        const el = document.getElementById('autopilot-preview');
        if (el) {
            // Show last ~300 chars of streaming text
            el.textContent = text.length > 300 ? '...' + text.slice(-300) : text;
            el.scrollTop = el.scrollHeight;
        }
    };

    const hideAutopilotOverlay = () => {
        const overlay = document.getElementById('autopilot-overlay');
        if (overlay) overlay.remove();
    };

    // ---- Autopilot Orchestration ----

    // startFromStage: 1=brainstorm, 2=sectors, 3=CCM(2a), 4=filter2(2b), 5=scenarios(3a), 6=warnings(3b), 7=narratives(4a), 8=naming(4b)
    const runAutopilot = async (startFromStage = 1, respectLocks = false) => {
        if (!connected) return;

        const state = FARCore.getState();
        if (!state.project.name) {
            alert('Please enter a project name before running AI Analyst.');
            return;
        }

        showAutopilotOverlay();
        const TOTAL = '4b';

        try {
            // ---- Step 1: Brainstorm Initial View ----
            if (startFromStage <= 1) {
                const s1AllLocked = respectLocks &&
                    isLocked('s1:initialView') && isLocked('s1:fieldBoundaries') && isLocked('s1:keyUncertainties');

                if (s1AllLocked) {
                    updateAutopilotProgress(1, TOTAL, 'Brainstorming Initial View', 'All fields locked — skipping');
                } else {
                    updateAutopilotProgress(1, TOTAL, 'Brainstorming Initial View', 'Generating alternative visions...');
                    const brainstormPrompt = buildBrainstormPrompt(respectLocks);
                    const brainstormText = await streamGenerate(
                        brainstormPrompt.prompt, brainstormPrompt.system,
                        (chunk, full) => updateAutopilotPreview(full),
                        () => {}
                    );
                    if (autopilotAborted) { hideAutopilotOverlay(); return; }

                    const sections = parseBrainstormResponse(brainstormText);
                    if (sections.visions && !(respectLocks && isLocked('s1:initialView'))) {
                        state.initialView = sections.visions;
                    }
                    if (sections.boundaries && !(respectLocks && isLocked('s1:fieldBoundaries'))) {
                        state.fieldBoundaries = sections.boundaries;
                    }
                    if (sections.uncertainties && !(respectLocks && isLocked('s1:keyUncertainties'))) {
                        state.keyUncertainties = sections.uncertainties;
                    }
                }

                document.getElementById('initial-view').value = state.initialView;
                document.getElementById('field-boundaries').value = state.fieldBoundaries;
                document.getElementById('key-uncertainties').value = state.keyUncertainties;
                FAR.goToStep(1);
            }

            // ---- Step 2: Sectors & Factors ----
            if (startFromStage <= 2) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }

                const s2Locks = respectLocks ? getLocksForStage(2) : [];
                const s2AllLocked = s2Locks.length > 0 && (() => {
                    // Check if every sector name, desc, and every factor label, desc are locked
                    for (const sector of state.sectors) {
                        if (!isLocked(`s2:sector:${sector.id}:name`)) return false;
                        if (!isLocked(`s2:sector:${sector.id}:description`)) return false;
                        for (const f of sector.factors) {
                            if (!isLocked(`s2:factor:${f.id}:label`)) return false;
                            if (!isLocked(`s2:factor:${f.id}:description`)) return false;
                        }
                    }
                    return true;
                })();

                if (s2AllLocked) {
                    updateAutopilotProgress(2, TOTAL, 'Generating Sectors & Factors', 'All fields locked — skipping');
                } else {
                    updateAutopilotProgress(2, TOTAL, 'Generating Sectors & Factors', 'Suggesting sector array...');

                    const sectorPrompt = buildSectorSuggestionPrompt(respectLocks);
                    const sectorText = await streamGenerate(
                        sectorPrompt.prompt, sectorPrompt.system,
                        (chunk, full) => updateAutopilotPreview(full),
                        () => {}
                    );
                    if (autopilotAborted) { hideAutopilotOverlay(); return; }

                    const parsed = parseSectorResponse(sectorText);
                    if (parsed.sectors.length > 0) {
                        if (!respectLocks || s2Locks.length === 0) {
                            // No locks: full replacement
                            state.sectors = [];
                            const requestedSectors = getRequestedSectorCount();
                            const requestedFactors = getRequestedFactorCount();
                            const needed = Math.min(parsed.sectors.length, requestedSectors);
                            for (let i = 0; i < needed; i++) {
                                FARCore.addSector();
                            }
                            parsed.sectors.forEach((ps, i) => {
                                if (i >= state.sectors.length) return;
                                const sector = state.sectors[i];
                                sector.name = ps.name;
                                sector.description = ps.description;
                                const factorCount = Math.min(requestedFactors, ps.factors.length || requestedFactors);
                                if (factorCount > 0) {
                                    sector.factors = [];
                                    for (let fi = 0; fi < factorCount; fi++) {
                                        sector.factors.push({
                                            id: sector.letter + (fi + 1),
                                            label: ps.factors[fi]?.label || '',
                                            description: ps.factors[fi]?.description || '',
                                            mapX: 0.5 + 0.3 * Math.cos((fi / factorCount) * Math.PI * 2),
                                            mapY: 0.5 + 0.3 * Math.sin((fi / factorCount) * Math.PI * 2),
                                        });
                                    }
                                }
                            });
                        } else {
                            // Merge: only write to unlocked fields
                            parsed.sectors.forEach((ps, i) => {
                                if (i >= state.sectors.length) return;
                                const sector = state.sectors[i];
                                if (!isLocked(`s2:sector:${sector.id}:name`)) sector.name = ps.name;
                                if (!isLocked(`s2:sector:${sector.id}:description`)) sector.description = ps.description;

                                ps.factors.forEach((pf, fi) => {
                                    if (fi >= sector.factors.length) return;
                                    const f = sector.factors[fi];
                                    if (!isLocked(`s2:factor:${f.id}:label`)) f.label = pf.label || '';
                                    if (!isLocked(`s2:factor:${f.id}:description`)) f.description = pf.description || '';
                                });
                            });
                        }
                        if (parsed.acronym) {
                            state.acronym = parsed.acronym.toUpperCase();
                        }
                    }
                }

                document.getElementById('sector-acronym').value = state.acronym || '';
                FAR.goToStep(2);
            }

            // ---- Step 2b: Factor Similarity Maps ----
            if (startFromStage <= 2) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }
                updateAutopilotProgress(2, TOTAL, 'Factor Similarity Maps', 'Positioning factor similarity maps...');

                for (let si = 0; si < state.sectors.length; si++) {
                    if (autopilotAborted) { hideAutopilotOverlay(); return; }
                    const sector = state.sectors[si];
                    if (sector.factors.length < 2) continue;
                    updateAutopilotProgress(2, TOTAL, 'Factor Similarity Maps',
                        `Sector ${sector.letter}: ${sector.name || 'Unnamed'} (${si + 1}/${state.sectors.length})`);

                    const simPrompt = buildFactorSimilarityPrompt(sector);
                    const simText = await streamGenerate(
                        simPrompt.prompt, simPrompt.system,
                        (chunk, full) => updateAutopilotPreview(full),
                        () => {}
                    );
                    parseFactorSimilarityResponse(simText, sector);
                }
                FARUI.renderSectors();
            }

            // ---- Step 3a: CCM (Filter 1) ----
            if (startFromStage <= 3) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }
                updateAutopilotProgress('2a', TOTAL, 'CCM Pair-wise Assessment', 'Evaluating sector pairs...');

                // Clear old CCM data when re-running (but not locked entries)
                if (!respectLocks) {
                    FARCore.getState().ccm = {};
                }

                const sectorPairs = FARCore.getSectorPairs();
                for (let pi = 0; pi < sectorPairs.length; pi++) {
                    if (autopilotAborted) { hideAutopilotOverlay(); return; }
                    const [s1, s2] = sectorPairs[pi];
                    updateAutopilotProgress('2a', TOTAL, 'CCM Pair-wise Assessment',
                        `Pair ${pi + 1}/${sectorPairs.length}: ${s1.name || s1.letter} vs ${s2.name || s2.letter}`);

                    const ccmPrompt = buildCCMPrescoringPrompt(s1, s2, respectLocks);
                    const ccmText = await streamGenerate(
                        ccmPrompt.prompt, ccmPrompt.system,
                        (chunk, full) => updateAutopilotPreview(full),
                        () => {}
                    );

                    const ccmParsed = parseCCMResponse(ccmText, ccmPrompt.pairs);
                    ccmParsed.forEach(r => {
                        // Skip locked CCM entries
                        const ccmKey = `s3:ccm:${r.f1}:${r.f2}`;
                        if (respectLocks && isLocked(ccmKey)) return;
                        FARCore.setCCMEntry(r.f1, r.f2, r.compatible, r.note);
                    });
                }

                FAR.goToStep(3);
            }

            // ---- Step 3b: Filter 2 ----
            if (startFromStage <= 4) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }
                updateAutopilotProgress('2b', TOTAL, 'Holistic Filter', 'Computing surviving configurations...');

                const filter1 = FARCore.computeFilter1();
                const f1survivors = filter1.surviving;

                if (f1survivors && f1survivors.length > 0) {
                    // Clear old filter2 data when re-running (but not locked entries)
                    if (!respectLocks) {
                        FARCore.getState().filter2 = {};
                    }

                    const totalBatches = Math.ceil(f1survivors.length / FILTER2_BATCH_SIZE);
                    for (let b = 0; b < totalBatches; b++) {
                        if (autopilotAborted) { hideAutopilotOverlay(); return; }
                        const start = b * FILTER2_BATCH_SIZE;
                        const batchConfigs = f1survivors.slice(start, start + FILTER2_BATCH_SIZE);

                        updateAutopilotProgress('2b', TOTAL, 'Holistic Filter',
                            `Batch ${b + 1}/${totalBatches} (configs ${start + 1}-${start + batchConfigs.length} of ${f1survivors.length})`);

                        const f2Prompt = buildFilter2Prompt(batchConfigs, start, respectLocks);
                        const f2Text = await streamGenerate(
                            f2Prompt.prompt, f2Prompt.system,
                            (chunk, full) => updateAutopilotPreview(full),
                            () => {}
                        );

                        const f2Parsed = parseFilter2Response(f2Text, batchConfigs, start);
                        const f2Timestamp = new Date().toISOString();
                        f2Parsed.forEach(r => {
                            const config = FARCore.parseConfigKey(r.key);
                            const f2Key = `s4:filter2:${r.key}`;
                            if (respectLocks && isLocked(f2Key)) return;
                            FARCore.setFilter2Entry(config, r.pass, r.note);
                            state.filterLog.push({
                                timestamp: f2Timestamp,
                                action: 'filter2',
                                configKey: r.key,
                                decision: r.pass ? 'PASS' : 'REJECT',
                                note: r.note,
                            });
                        });
                    }
                }

                FARUI.renderCCM();
                FARUI.renderSolutionSpace();

                // ---- Adaptive Re-filter ----
                if (!autopilotAborted) {
                    const refilterFilter1 = FARCore.computeFilter1();
                    const refilterSurvivors = FARCore.getFinalSurvivors(refilterFilter1.surviving || []);
                    if (refilterSurvivors.length > (MAX_SURVIVORS[strictness] || 20)) {
                        updateAutopilotProgress('2b', TOTAL, 'Adaptive Re-filter',
                            `Too many survivors (${refilterSurvivors.length}), narrowing to ~${MAX_SURVIVORS[strictness] || 20}...`);
                        await runAdaptiveRefilter(
                            refilterSurvivors,
                            (msg) => updateAutopilotProgress('2b', TOTAL, 'Adaptive Re-filter', msg),
                            (text) => updateAutopilotPreview(text)
                        );
                        FARUI.renderCCM();
                        FARUI.renderSolutionSpace();
                    }
                }

                // ---- Adaptive Relaxation (too few survivors) ----
                if (!autopilotAborted) {
                    const relaxFilter1 = FARCore.computeFilter1();
                    const relaxSurvivors = FARCore.getFinalSurvivors(relaxFilter1.surviving || []);
                    if (relaxSurvivors.length < MIN_SURVIVORS) {
                        updateAutopilotProgress('2b', TOTAL, 'Adaptive Relaxation',
                            `Too few survivors (${relaxSurvivors.length}), relaxing filtering to reach at least ${MIN_SURVIVORS}...`);
                        await runAdaptiveRelax(
                            (msg) => updateAutopilotProgress('2b', TOTAL, 'Adaptive Relaxation', msg),
                            (text) => updateAutopilotPreview(text)
                        );
                        FARUI.renderCCM();
                        FARUI.renderSolutionSpace();
                    }
                }
            }

            // ---- Step 4a: Scenario Composition ----
            if (startFromStage <= 5) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }
                updateAutopilotProgress('3a', TOTAL, 'Scenario Composition', 'Grouping survivors into scenario lines...');

                const filter1ForSc = FARCore.computeFilter1();
                const finalSurvivors = FARCore.getFinalSurvivors(filter1ForSc.surviving || []);

                if (finalSurvivors.length > 0) {
                    // Check if ALL scenario line fields are locked
                    const s5Locks = respectLocks ? getLocksForStage(5) : [];
                    const s5AllLocked = s5Locks.length > 0 && state.scenarioLines.length > 0 &&
                        state.scenarioLines.every((_, li) =>
                            isLocked(`s5:line:${li}:name`) && isLocked(`s5:line:${li}:description`));

                    if (!s5AllLocked) {
                        const scPrompt = buildScenarioCompositionPrompt(finalSurvivors, respectLocks);
                        const scText = await streamGenerate(
                            scPrompt.prompt, scPrompt.system,
                            (chunk, full) => updateAutopilotPreview(full),
                            () => {}
                        );
                        if (autopilotAborted) { hideAutopilotOverlay(); return; }

                        const scParsed = parseScenarioCompositionResponse(scText, scPrompt.sortedSurvivors || finalSurvivors);
                        const colors = FARUI.SCENARIO_COLORS;

                        if (scParsed.length > 0) {
                            if (!respectLocks || s5Locks.length === 0) {
                                // No locks: full replacement
                                state.scenarioLines = scParsed.map((sl, i) => ({
                                    id: 'sl_' + Date.now() + '_' + i,
                                    name: sl.name,
                                    description: sl.description,
                                    color: colors[i % colors.length],
                                    configs: sl.configs.map(c => ({
                                        configKey: c.configKey,
                                        periodLabel: c.periodLabel,
                                        commitment: c.commitment,
                                        freedom: c.freedom,
                                        warningIndicator: c.warningIndicator || '',
                                    })),
                                    narrative: '',
                                }));
                            } else {
                                // Merge: preserve locked line names/descriptions, but append extra lines if scParsed is longer
                                scParsed.forEach((sl, i) => {
                                    if (i < state.scenarioLines.length) {
                                        const line = state.scenarioLines[i];
                                        if (!isLocked(`s5:line:${i}:name`)) line.name = sl.name;
                                        if (!isLocked(`s5:line:${i}:description`)) line.description = sl.description;
                                        // Update configs
                                        line.configs = sl.configs.map(c => ({
                                            configKey: c.configKey,
                                            periodLabel: c.periodLabel,
                                            commitment: c.commitment,
                                            freedom: c.freedom,
                                            warningIndicator: c.warningIndicator || '',
                                        }));
                                    } else {
                                        // Append extra lines
                                        state.scenarioLines.push({
                                            id: 'sl_' + Date.now() + '_' + i,
                                            name: sl.name,
                                            description: sl.description,
                                            color: colors[i % colors.length],
                                            configs: sl.configs.map(c => ({
                                                configKey: c.configKey,
                                                periodLabel: c.periodLabel,
                                                commitment: c.commitment,
                                                freedom: c.freedom,
                                                warningIndicator: c.warningIndicator || '',
                                            })),
                                            narrative: '',
                                        });
                                    }
                                });
                            }
                        } else if (!respectLocks || s5Locks.length === 0) {
                            // Fallback: build lines by similarity (nearest neighbor)
                            const remaining = [...finalSurvivors];
                            const fallbackLines = [];
                            const lineSize = 4;
                            const colors = FARUI.SCENARIO_COLORS;

                            while (remaining.length > 0 && fallbackLines.length < 5) {
                                const startIdx = 0; // Just pick the first remaining
                                const currentLine = [remaining.splice(startIdx, 1)[0]];

                                while (currentLine.length < lineSize && remaining.length > 0) {
                                    const last = currentLine[currentLine.length - 1];
                                    let bestIdx = -1;
                                    let bestDist = 999;

                                    for (let j = 0; j < remaining.length; j++) {
                                        const d = FARCore.configDistance(last, remaining[j]);
                                        if (d < bestDist) {
                                            bestDist = d;
                                            bestIdx = j;
                                        }
                                    }

                                    if (bestIdx !== -1) {
                                        currentLine.push(remaining.splice(bestIdx, 1)[0]);
                                    } else break;
                                }

                                fallbackLines.push({
                                    id: 'sl_' + Date.now() + '_' + fallbackLines.length,
                                    name: 'Scenario ' + (fallbackLines.length + 1),
                                    description: 'Automatically grouped by similarity (fallback)',
                                    color: colors[fallbackLines.length % colors.length],
                                    configs: currentLine.map((config, ci) => ({
                                        configKey: FARCore.configKey(config),
                                        periodLabel: ci === 0 ? 'Present' : 'T' + ci,
                                        commitment: 5,
                                        freedom: 5,
                                        warningIndicator: '',
                                    })),
                                    narrative: '',
                                });
                            }
                            state.scenarioLines = fallbackLines;
                        }
                    }
                }

                const warnEnabled = document.getElementById('collect-warning-indicators').checked;
                state.project.collectWarningIndicators = warnEnabled;

                FARUI.renderScenarioLines();
                FARTree.renderTree();
                FAR.goToStep(4);
            }

            // ---- Step 4b: Warning Indicators (if enabled) ----
            if (startFromStage <= 6) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }

                if (state.project.collectWarningIndicators && state.scenarioLines.length > 0) {
                    updateAutopilotProgress('3b', TOTAL, 'Warning Indicators', 'Generating transition signals...');

                    for (let li = 0; li < state.scenarioLines.length; li++) {
                        const line = state.scenarioLines[li];
                        for (let ci = 0; ci < line.configs.length - 1; ci++) {
                            // Skip locked warning indicators
                            if (respectLocks && isLocked(`s6:warning:${li}:${ci}`)) continue;

                            if (autopilotAborted) { hideAutopilotOverlay(); return; }
                            updateAutopilotProgress('3b', TOTAL, 'Warning Indicators',
                                `Line "${line.name}": transition ${ci + 1}/${line.configs.length - 1}`);

                            const wiPrompt = buildWarningIndicatorPrompt(li, ci, respectLocks);
                            const wiText = await streamGenerate(
                                wiPrompt.prompt, wiPrompt.system,
                                (chunk, full) => updateAutopilotPreview(full),
                                () => {}
                            );
                            line.configs[ci].warningIndicator = wiText.trim();
                        }
                    }

                    FARUI.renderScenarioLines();
                } else {
                    updateAutopilotProgress('3b', TOTAL, 'Warning Indicators', 'Skipped (not enabled)');
                }
            }

            // ---- Step 4c: Narratives ----
            if (startFromStage <= 7) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }
                updateAutopilotProgress('4a', TOTAL, 'Scenario Narratives', 'Drafting narratives...');

                for (let li = 0; li < state.scenarioLines.length; li++) {
                    const line = state.scenarioLines[li];
                    if (!line.configs || line.configs.length === 0) continue;

                    // Skip locked narratives
                    if (respectLocks && isLocked(`s7:narrative:${li}`)) continue;

                    if (autopilotAborted) { hideAutopilotOverlay(); return; }

                    updateAutopilotProgress('4a', TOTAL, 'Scenario Narratives',
                        `Drafting "${line.name}" (${li + 1}/${state.scenarioLines.length})`);

                    const narPrompt = buildNarrativePrompt(li, respectLocks);
                    const narText = await streamGenerate(
                        narPrompt.prompt, narPrompt.system,
                        (chunk, full) => updateAutopilotPreview(full),
                        () => {}
                    );
                    line.narrative = narText;
                }

                FARUI.renderNarratives();
            }

            // ---- Step 5: Scenario Naming ----
            if (startFromStage <= 8) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }
                updateAutopilotProgress('4b', TOTAL, 'Scenario Naming', 'Naming scenarios based on narratives...');

                await nameScenarios(
                    (msg) => updateAutopilotProgress('4b', TOTAL, 'Scenario Naming', msg),
                    (text) => updateAutopilotPreview(text)
                );

                FARUI.renderScenarioLines();
                FARUI.renderNarratives();
                FARTree.renderTree();
            }

            // ---- Done ----
            if (autopilotAborted) { hideAutopilotOverlay(); return; }
            hideAutopilotOverlay();
            autopilotHasRun = true;
            localStorage.setItem('far_autopilot_done', '1');
            lastUserEditStage = 0;
            showAssistedButton();
            FAR.goToStep(5);

        } catch (err) {
            hideAutopilotOverlay();
            alert('AI Analyst error: ' + err.message);
        }
    };

    const runAssisted = async () => {
        if (!connected || !autopilotHasRun) return;

        if (locks.size === 0) {
            alert('No fields were changed since the last AI Analyst run.');
            return;
        }

        // ---- Analyze what the user changed ----
        const changedSectorIds = new Set();
        let stage1Changed = false;
        let stage2Changed = false;
        let scenarioFieldsChanged = false;  // line names/descriptions
        let warningFieldsChanged = false;
        let narrativeFieldsChanged = false;

        for (const [fieldId, entry] of locks) {
            if (entry.stage === 1) stage1Changed = true;
            if (entry.stage === 2) {
                stage2Changed = true;
                let m = fieldId.match(/^s2:sector:([^:]+):/);
                if (m) changedSectorIds.add(m[1]);
                m = fieldId.match(/^s2:factor:([^:]+):/);
                if (m) {
                    const factor = FARCore.getFactorById(m[1]);
                    if (factor) changedSectorIds.add(factor.sectorId);
                }
            }
            if (entry.stage === 5) scenarioFieldsChanged = true;
            if (entry.stage === 6) warningFieldsChanged = true;
            if (entry.stage === 7) narrativeFieldsChanged = true;
        }

        // Determine what downstream AI work is needed
        const needsSimilarity = stage2Changed && changedSectorIds.size > 0;
        const needsCCM = stage2Changed && changedSectorIds.size > 0;
        const needsScenarios = needsCCM;
        const needsNarratives = needsCCM || scenarioFieldsChanged;
        const state = FARCore.getState();
        const needsWarnings = state.project.collectWarningIndicators &&
            (needsCCM || warningFieldsChanged);

        if (!needsCCM && !needsNarratives && !needsWarnings) {
            alert('Your changes have been saved. No downstream AI regeneration needed.');
            return;
        }

        showAutopilotOverlay();

        const needsNaming = needsNarratives;
        const assistedTotal = '4b';

        try {
            // ---- Factor Similarity Maps for changed sectors ----
            if (needsSimilarity) {
                const changedSectors = state.sectors.filter(s => changedSectorIds.has(s.id));
                updateAutopilotProgress(2, assistedTotal, 'Factor Similarity Maps',
                    `Repositioning ${changedSectors.length} sector map(s)...`);

                for (let si = 0; si < changedSectors.length; si++) {
                    if (autopilotAborted) { hideAutopilotOverlay(); return; }
                    const sector = changedSectors[si];
                    if (sector.factors.length < 2) continue;
                    updateAutopilotProgress(2, assistedTotal, 'Factor Similarity Maps',
                        `Sector ${sector.letter}: ${sector.name || 'Unnamed'} (${si + 1}/${changedSectors.length})`);

                    const simPrompt = buildFactorSimilarityPrompt(sector);
                    const simText = await streamGenerate(
                        simPrompt.prompt, simPrompt.system,
                        (chunk, full) => updateAutopilotPreview(full),
                        () => {}
                    );
                    parseFactorSimilarityResponse(simText, sector);
                }
                FARUI.renderSectors();
            }

            // ---- CCM: re-assess only sector pairs involving changed sectors ----
            if (needsCCM) {
                const allSectorPairs = FARCore.getSectorPairs();
                const affectedPairs = allSectorPairs.filter(([s1, s2]) =>
                    changedSectorIds.has(s1.id) || changedSectorIds.has(s2.id));

                const affectedSectorNames = affectedPairs.map(([s1, s2]) =>
                    `${s1.name || s1.letter} × ${s2.name || s2.letter}`);
                updateAutopilotProgress('2a', assistedTotal, 'Re-assessing CCM',
                    `${affectedPairs.length} sector pair(s) affected: ${affectedSectorNames.join(', ')}`);

                for (let pi = 0; pi < affectedPairs.length; pi++) {
                    if (autopilotAborted) { hideAutopilotOverlay(); return; }
                    const [s1, s2] = affectedPairs[pi];
                    updateAutopilotProgress('2a', assistedTotal, 'Re-assessing CCM',
                        `Pair ${pi + 1}/${affectedPairs.length}: ${s1.name || s1.letter} × ${s2.name || s2.letter}`);

                    const ccmPrompt = buildCCMPrescoringPrompt(s1, s2, true);
                    const ccmText = await streamGenerate(
                        ccmPrompt.prompt, ccmPrompt.system,
                        (chunk, full) => updateAutopilotPreview(full),
                        () => {}
                    );

                    const ccmParsed = parseCCMResponse(ccmText, ccmPrompt.pairs);
                    ccmParsed.forEach(r => {
                        FARCore.setCCMEntry(r.f1, r.f2, r.compatible, r.note);
                    });
                }

                FAR.goToStep(3);
            }

            // ---- Filter 2: re-assess all surviving configs (filter1 recomputes automatically) ----
            if (needsCCM) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }
                updateAutopilotProgress('2b', assistedTotal, 'Re-running Filter 2',
                    'Recomputing surviving configurations...');

                const filter1 = FARCore.computeFilter1();
                const f1survivors = filter1.surviving;

                // Clear old filter2 entries for configs involving changed sectors
                const oldFilter2 = FARCore.getState().filter2;
                for (const key of Object.keys(oldFilter2)) {
                    const factorIds = key.split('-');
                    const touchesChanged = factorIds.some(fId => {
                        const f = FARCore.getFactorById(fId);
                        return f && changedSectorIds.has(f.sectorId);
                    });
                    if (touchesChanged) delete oldFilter2[key];
                }

                if (f1survivors && f1survivors.length > 0) {
                    // Only re-assess configs that don't already have a filter2 entry
                    const configsToAssess = f1survivors.filter(config => {
                        const key = FARCore.configKey(config);
                        return !oldFilter2[key];
                    });

                    if (configsToAssess.length > 0) {
                        const totalBatches = Math.ceil(configsToAssess.length / FILTER2_BATCH_SIZE);
                        for (let b = 0; b < totalBatches; b++) {
                            if (autopilotAborted) { hideAutopilotOverlay(); return; }
                            const start = b * FILTER2_BATCH_SIZE;
                            const batchConfigs = configsToAssess.slice(start, start + FILTER2_BATCH_SIZE);

                            updateAutopilotProgress('2b', assistedTotal, 'Re-running Filter 2',
                                `Batch ${b + 1}/${totalBatches} (${start + 1}-${start + batchConfigs.length} of ${configsToAssess.length} affected configs)`);

                            const f2Prompt = buildFilter2Prompt(batchConfigs, start, false);
                            const f2Text = await streamGenerate(
                                f2Prompt.prompt, f2Prompt.system,
                                (chunk, full) => updateAutopilotPreview(full),
                                () => {}
                            );

                            const f2Parsed = parseFilter2Response(f2Text, batchConfigs, start);
                            const f2ts = new Date().toISOString();
                            f2Parsed.forEach(r => {
                                const config = FARCore.parseConfigKey(r.key);
                                FARCore.setFilter2Entry(config, r.pass, r.note);
                                state.filterLog.push({ timestamp: f2ts, action: 'filter2-assisted', configKey: r.key, decision: r.pass ? 'PASS' : 'REJECT', note: r.note });
                            });
                        }
                    }
                }

                FARUI.renderCCM();
                FARUI.renderSolutionSpace();

                // ---- Adaptive Re-filter (assisted mode) ----
                if (!autopilotAborted) {
                    const refilterFilter1 = FARCore.computeFilter1();
                    const refilterSurvivors = FARCore.getFinalSurvivors(refilterFilter1.surviving || []);
                    if (refilterSurvivors.length > (MAX_SURVIVORS[strictness] || 20)) {
                        updateAutopilotProgress('2b', assistedTotal, 'Adaptive Re-filter',
                            `Too many survivors (${refilterSurvivors.length}), narrowing to ~${MAX_SURVIVORS[strictness] || 20}...`);
                        await runAdaptiveRefilter(
                            refilterSurvivors,
                            (msg) => updateAutopilotProgress('2b', assistedTotal, 'Adaptive Re-filter', msg),
                            (text) => updateAutopilotPreview(text)
                        );
                        FARUI.renderCCM();
                        FARUI.renderSolutionSpace();
                    }
                }

                // ---- Adaptive Relaxation (assisted mode) ----
                if (!autopilotAborted) {
                    const relaxFilter1 = FARCore.computeFilter1();
                    const relaxSurvivors = FARCore.getFinalSurvivors(relaxFilter1.surviving || []);
                    if (relaxSurvivors.length < MIN_SURVIVORS) {
                        updateAutopilotProgress('2b', assistedTotal, 'Adaptive Relaxation',
                            `Too few survivors (${relaxSurvivors.length}), relaxing filtering to reach at least ${MIN_SURVIVORS}...`);
                        await runAdaptiveRelax(
                            (msg) => updateAutopilotProgress('2b', assistedTotal, 'Adaptive Relaxation', msg),
                            (text) => updateAutopilotPreview(text)
                        );
                        FARUI.renderCCM();
                        FARUI.renderSolutionSpace();
                    }
                }
            }

            // ---- Scenarios: re-compose from updated survivors ----
            if (needsScenarios) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }
                updateAutopilotProgress('3a', assistedTotal, 'Re-composing Scenarios',
                    'Grouping survivors into scenario lines...');

                const filter1ForSc = FARCore.computeFilter1();
                const finalSurvivors = FARCore.getFinalSurvivors(filter1ForSc.surviving || []);

                if (finalSurvivors.length > 0) {
                    const scPrompt = buildScenarioCompositionPrompt(finalSurvivors, true);
                    const scText = await streamGenerate(
                        scPrompt.prompt, scPrompt.system,
                        (chunk, full) => updateAutopilotPreview(full),
                        () => {}
                    );
                    if (autopilotAborted) { hideAutopilotOverlay(); return; }

                    const scParsed = parseScenarioCompositionResponse(scText, scPrompt.sortedSurvivors || finalSurvivors);
                    const colors = FARUI.SCENARIO_COLORS;

                    if (scParsed.length > 0) {
                        // Merge: preserve locked line names/descriptions, append if new lines are returned
                        if (state.scenarioLines.length > 0) {
                            scParsed.forEach((sl, i) => {
                                if (i < state.scenarioLines.length) {
                                    const line = state.scenarioLines[i];
                                    if (!isLocked(`s5:line:${i}:name`)) line.name = sl.name;
                                    if (!isLocked(`s5:line:${i}:description`)) line.description = sl.description;
                                    line.configs = sl.configs.map(c => ({
                                        configKey: c.configKey,
                                        periodLabel: c.periodLabel,
                                        commitment: c.commitment,
                                        freedom: c.freedom,
                                        warningIndicator: c.warningIndicator || '',
                                    }));
                                } else {
                                    // Append extra lines
                                    state.scenarioLines.push({
                                        id: 'sl_' + Date.now() + '_' + i,
                                        name: sl.name,
                                        description: sl.description,
                                        color: colors[i % colors.length],
                                        configs: sl.configs.map(c => ({
                                            configKey: c.configKey,
                                            periodLabel: c.periodLabel,
                                            commitment: c.commitment,
                                            freedom: c.freedom,
                                            warningIndicator: c.warningIndicator || '',
                                        })),
                                        narrative: '',
                                    });
                                }
                            });
                        } else {
                            state.scenarioLines = scParsed.map((sl, i) => ({
                                id: 'sl_' + Date.now() + '_' + i,
                                name: sl.name,
                                description: sl.description,
                                color: colors[i % colors.length],
                                configs: sl.configs.map(c => ({
                                    configKey: c.configKey,
                                    periodLabel: c.periodLabel,
                                    commitment: c.commitment,
                                    freedom: c.freedom,
                                    warningIndicator: c.warningIndicator || '',
                                })),
                                narrative: '',
                            }));
                        }
                    }
                }

                FARUI.renderScenarioLines();
                FARTree.renderTree();
                FAR.goToStep(4);
            }

            // ---- Warning Indicators (if enabled and scenarios changed) ----
            if (state.project.collectWarningIndicators && state.scenarioLines.length > 0 &&
                (needsCCM || warningFieldsChanged)) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }
                updateAutopilotProgress('3b', assistedTotal, 'Warning Indicators',
                    'Generating transition signals...');

                for (let li = 0; li < state.scenarioLines.length; li++) {
                    const line = state.scenarioLines[li];
                    for (let ci = 0; ci < line.configs.length - 1; ci++) {
                        if (isLocked(`s6:warning:${li}:${ci}`)) continue;
                        if (autopilotAborted) { hideAutopilotOverlay(); return; }
                        updateAutopilotProgress('3b', assistedTotal, 'Warning Indicators',
                            `Line "${line.name}": transition ${ci + 1}/${line.configs.length - 1}`);

                        const wiPrompt = buildWarningIndicatorPrompt(li, ci, true);
                        const wiText = await streamGenerate(
                            wiPrompt.prompt, wiPrompt.system,
                            (chunk, full) => updateAutopilotPreview(full),
                            () => {}
                        );
                        line.configs[ci].warningIndicator = wiText.trim();
                    }
                }
                FARUI.renderScenarioLines();
            }

            // ---- Narratives: regenerate for affected lines ----
            if (needsNarratives) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }
                updateAutopilotProgress('4a', assistedTotal, 'Scenario Narratives',
                    'Re-drafting narratives...');

                for (let li = 0; li < state.scenarioLines.length; li++) {
                    const line = state.scenarioLines[li];
                    if (!line.configs || line.configs.length === 0) continue;
                    if (isLocked(`s7:narrative:${li}`)) continue;
                    if (autopilotAborted) { hideAutopilotOverlay(); return; }

                    updateAutopilotProgress('4a', assistedTotal, 'Scenario Narratives',
                        `Drafting "${line.name}" (${li + 1}/${state.scenarioLines.length})`);

                    const narPrompt = buildNarrativePrompt(li, true);
                    const narText = await streamGenerate(
                        narPrompt.prompt, narPrompt.system,
                        (chunk, full) => updateAutopilotPreview(full),
                        () => {}
                    );
                    line.narrative = narText;
                }

                FARUI.renderNarratives();
            }

            // ---- Naming: rename scenarios based on updated narratives ----
            if (needsNaming) {
                if (autopilotAborted) { hideAutopilotOverlay(); return; }
                updateAutopilotProgress('4b', assistedTotal, 'Scenario Naming',
                    'Naming scenarios based on narratives...');

                await nameScenarios(
                    (msg) => updateAutopilotProgress('4b', assistedTotal, 'Scenario Naming', msg),
                    (text) => updateAutopilotPreview(text)
                );

                FARUI.renderScenarioLines();
                FARUI.renderNarratives();
                FARTree.renderTree();
            }

            // ---- Done ----
            if (autopilotAborted) { hideAutopilotOverlay(); return; }
            hideAutopilotOverlay();
            lastUserEditStage = 0;

        } catch (err) {
            hideAutopilotOverlay();
            alert('AI Analyst error: ' + err.message);
        }
    };

    // ---- Initialization ----

    const init = async () => {
        bindSettingsEvents();
        bindUserEditTracking();
        loadLocks();
        // If locks survived a reload, autopilot must have run before
        if (locks.size > 0) autopilotHasRun = true;
        if (autopilotHasRun) showAssistedButton();
        await checkConnection();
        updateSettingsUI();
    };

    const loadSettings = () => {
        provider = localStorage.getItem('far_ai_provider') || 'ollama';
        ollamaUrl = localStorage.getItem('far_ollama_url') || 'http://localhost:11434';
        ollamaModel = localStorage.getItem('far_ollama_model') || '';
        claudeApiKey = localStorage.getItem('far_claude_api_key') || '';
        claudeModel = localStorage.getItem('far_claude_model') || 'claude-sonnet-4-6';
        geminiApiKey = localStorage.getItem('far_gemini_api_key') || '';
        geminiModel = localStorage.getItem('far_gemini_model') || 'gemini-2.5-flash';
        strictness = localStorage.getItem('far_ai_strictness') || 'balanced';
        updateSettingsUI();
    };

    // ---- Feature: Combined Filter (CCM + Filter 2) ----

    const runCombinedFilter = async (btnEl) => {
        if (!connected) return;

        const state = FARCore.getState();
        const hasFactor = state.sectors.some(s => s.factors.some(f => f.label));
        if (!hasFactor) {
            alert('Please define sectors and factors (Step 2) before running filtering.');
            return;
        }

        btnEl.disabled = true;

        const { contentEl, dismiss, makeEditable } = createSuggestionPanel(btnEl, {
            applyLabel: 'Apply All',
            onApply: (text) => {
                // Results already applied during streaming
                FARUI.renderCCM();
                FARUI.renderSolutionSpace();
                btnEl.disabled = false;
            },
            onDismiss: () => { btnEl.disabled = false; },
        });

        try {
            // Phase 1: CCM across all sector pairs
            const sectorPairs = FARCore.getSectorPairs();
            for (let pi = 0; pi < sectorPairs.length; pi++) {
                const [s1, s2] = sectorPairs[pi];
                contentEl.textContent = `CCM: Pair ${pi + 1}/${sectorPairs.length} — ${s1.name || s1.letter} vs ${s2.name || s2.letter}...`;

                const ccmPrompt = buildCCMPrescoringPrompt(s1, s2);
                const ccmText = await streamGenerate(
                    ccmPrompt.prompt, ccmPrompt.system,
                    (chunk, full) => {
                        contentEl.textContent = `CCM ${pi + 1}/${sectorPairs.length}: ${s1.name || s1.letter} vs ${s2.name || s2.letter}\n\n${full}`;
                    },
                    () => {}
                );
                const ccmParsed = parseCCMResponse(ccmText, ccmPrompt.pairs);
                ccmParsed.forEach(r => FARCore.setCCMEntry(r.f1, r.f2, r.compatible, r.note));
            }

            FARUI.renderCCMTable();
            FARUI.updateCCMStats();

            // Phase 2: Filter 2
            const filter1 = FARCore.computeFilter1();
            const survivors = filter1.surviving;

            if (survivors && survivors.length > 0) {
                const totalBatches = Math.ceil(survivors.length / FILTER2_BATCH_SIZE);
                for (let b = 0; b < totalBatches; b++) {
                    const start = b * FILTER2_BATCH_SIZE;
                    const batchConfigs = survivors.slice(start, start + FILTER2_BATCH_SIZE);
                    contentEl.textContent = `Filter 2: Batch ${b + 1}/${totalBatches} (${start + 1}–${start + batchConfigs.length} of ${survivors.length})...`;

                    const f2Prompt = buildFilter2Prompt(batchConfigs, start);
                    const f2Text = await streamGenerate(
                        f2Prompt.prompt, f2Prompt.system,
                        (chunk, full) => {
                            contentEl.textContent = `Filter 2: Batch ${b + 1}/${totalBatches}\n\n${full}`;
                        },
                        () => {}
                    );
                    const f2Parsed = parseFilter2Response(f2Text, batchConfigs, start);
                    const f2ts = new Date().toISOString();
                    f2Parsed.forEach(r => {
                        const config = FARCore.parseConfigKey(r.key);
                        FARCore.setFilter2Entry(config, r.pass, r.note);
                        FARCore.getState().filterLog.push({ timestamp: f2ts, action: 'filter2-combined', configKey: r.key, decision: r.pass ? 'PASS' : 'REJECT', note: r.note });
                    });
                }

                // Adaptive re-filter
                const postSurvivors = FARCore.getFinalSurvivors(filter1.surviving || []);
                const threshold = MAX_SURVIVORS[strictness] || 20;
                if (postSurvivors.length > threshold) {
                    contentEl.textContent = `Adaptive re-filter: ${postSurvivors.length} survivors, narrowing to ~${threshold}...`;
                    await runAdaptiveRefilter(
                        postSurvivors,
                        (msg) => { contentEl.textContent = msg; },
                        () => {}
                    );
                }
            }

            // Adaptive relaxation (too few survivors)
            const finalFilter1 = FARCore.computeFilter1();
            const finalSurvivors = FARCore.getFinalSurvivors(finalFilter1.surviving || []);
            if (finalSurvivors.length < MIN_SURVIVORS) {
                contentEl.textContent = `Too few survivors (${finalSurvivors.length}), relaxing filtering to reach at least ${MIN_SURVIVORS}...`;
                await runAdaptiveRelax(
                    (msg) => { contentEl.textContent = msg; },
                    () => {}
                );
            }

            const doneFilter1 = FARCore.computeFilter1();
            contentEl.textContent = `Done. ${doneFilter1.surviving.length} survived CCM, ${FARCore.getFinalSurvivors(doneFilter1.surviving || []).length} passed Filter 2.`;
            makeEditable();
            btnEl.disabled = false;
        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    const addCombinedFilterButton = () => {
        const controls = document.querySelector('.ccm-controls');
        if (!controls || controls.querySelector('.ai-combined-filter-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'btn-secondary btn-sm ai-btn-secondary ai-combined-filter-btn';
        btn.textContent = 'AI Filter All';
        btn.title = 'Run CCM + Filter 2 end-to-end';
        btn.disabled = !connected;
        btn.addEventListener('click', () => runCombinedFilter(btn));
        controls.appendChild(btn);
    };

    // ---- Feature: Per-field AI buttons for Scenario Lines ----

    const buildScenarioLineContext = (lineIdx) => {
        const state = FARCore.getState();
        const ctx = buildProjectContext();
        const line = state.scenarioLines[lineIdx];
        const configDetails = (line.configs || []).map((cfg, ci) => {
            const factors = FARCore.parseConfigKey(cfg.configKey).map(fId => {
                const f = FARCore.getFactorById(fId);
                return `${fId}: ${f?.label || '?'}${f?.description ? ' (' + f.description + ')' : ''}`;
            }).join('; ');
            return `Config ${ci + 1} [${cfg.configKey}]: ${factors}${cfg.periodLabel ? ' (Period: ' + cfg.periodLabel + ')' : ''}`;
        }).join('\n');
        const otherNames = state.scenarioLines
            .filter((_, i) => i !== lineIdx)
            .map(l => l.name).filter(n => n);
        return { ctx, line, configDetails, otherNames };
    };

    const suggestScenarioLineName = async (btnEl, lineIdx) => {
        if (!connected) return;
        btnEl.disabled = true;
        const { ctx, line, configDetails, otherNames } = buildScenarioLineContext(lineIdx);

        const { contentEl, dismiss, makeEditable } = createSuggestionPanel(btnEl, {
            onApply: (text) => {
                const name = text.trim().replace(/^["']|["']$/g, '');
                FARCore.getState().scenarioLines[lineIdx].name = name;
                const input = document.querySelector(`[data-line-idx="${lineIdx}"][data-field="name"]`);
                if (input) input.value = name;
                FARTree.renderTree();
                btnEl.disabled = false;
            },
            onDismiss: () => { btnEl.disabled = false; },
        });

        try {
            const namePrompt = FARPrompts.scenarioLineName(ctx, configDetails, line.description || '', otherNames);
            await streamGenerate(
                namePrompt.prompt,
                namePrompt.system,
                (chunk, full) => { contentEl.textContent = full; },
                () => { makeEditable(); btnEl.disabled = false; }
            );
        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    const suggestScenarioLineDescription = async (btnEl, lineIdx) => {
        if (!connected) return;
        btnEl.disabled = true;
        const { ctx, line, configDetails } = buildScenarioLineContext(lineIdx);

        const { contentEl, dismiss, makeEditable } = createSuggestionPanel(btnEl, {
            onApply: (text) => {
                FARCore.getState().scenarioLines[lineIdx].description = text.trim();
                const textarea = document.querySelector(`textarea[data-line-idx="${lineIdx}"][data-field="description"]`);
                if (textarea) textarea.value = text.trim();
                btnEl.disabled = false;
            },
            onDismiss: () => { btnEl.disabled = false; },
        });

        try {
            await streamGenerate(
                FARPrompts.scenarioLineDescription(ctx, line.name || 'Unnamed', configDetails).prompt,
                SYSTEM_PROMPT,
                (chunk, full) => { contentEl.textContent = full; },
                () => { makeEditable(); btnEl.disabled = false; }
            );
        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    const suggestPeriodLabels = async (btnEl, lineIdx) => {
        if (!connected) return;
        btnEl.disabled = true;
        const { ctx, line, configDetails } = buildScenarioLineContext(lineIdx);

        const { contentEl, dismiss, makeEditable } = createSuggestionPanel(btnEl, {
            onApply: (text) => {
                const state = FARCore.getState();
                const configs = state.scenarioLines[lineIdx].configs || [];
                const lines = text.split('\n');
                lines.forEach(l => {
                    const m = l.match(/PERIOD\s*(\d+)\s*:\s*(.+)/i);
                    if (m) {
                        const idx = parseInt(m[1]) - 1;
                        if (idx >= 0 && idx < configs.length) {
                            configs[idx].periodLabel = m[2].replace(/[*_]+/g, '').trim();
                            const input = document.querySelector(`[data-line-idx="${lineIdx}"][data-config-idx="${idx}"][data-cfield="periodLabel"]`);
                            if (input) input.value = configs[idx].periodLabel;
                        }
                    }
                });
                FARTree.renderTree();
                btnEl.disabled = false;
            },
            onDismiss: () => { btnEl.disabled = false; },
        });

        try {
            const configs = line.configs || [];
            await streamGenerate(
                FARPrompts.periodLabels(ctx, line.name || 'Unnamed', configs.length, configDetails).prompt,
                SYSTEM_PROMPT,
                (chunk, full) => { contentEl.textContent = full; },
                () => { makeEditable(); btnEl.disabled = false; }
            );
        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    const suggestScores = async (btnEl, lineIdx) => {
        if (!connected) return;
        btnEl.disabled = true;
        const { ctx, line, configDetails } = buildScenarioLineContext(lineIdx);

        const { contentEl, dismiss, makeEditable } = createSuggestionPanel(btnEl, {
            onApply: (text) => {
                const state = FARCore.getState();
                const configs = state.scenarioLines[lineIdx].configs || [];
                const lines = text.split('\n');
                lines.forEach(l => {
                    const m = l.match(/#(\d+)\s*:\s*F\s*=\s*(\d+)\s*O\s*=\s*(\d+)/i);
                    if (m) {
                        const idx = parseInt(m[1]) - 1;
                        if (idx >= 0 && idx < configs.length) {
                            configs[idx].commitment = Math.max(1, Math.min(10, parseInt(m[2])));
                            configs[idx].freedom = Math.max(1, Math.min(10, parseInt(m[3])));
                            const cInput = document.querySelector(`[data-line-idx="${lineIdx}"][data-config-idx="${idx}"][data-cfield="commitment"]`);
                            const fInput = document.querySelector(`[data-line-idx="${lineIdx}"][data-config-idx="${idx}"][data-cfield="freedom"]`);
                            if (cInput) cInput.value = configs[idx].commitment;
                            if (fInput) fInput.value = configs[idx].freedom;
                        }
                    }
                });
                FARTree.renderTree();
                btnEl.disabled = false;
            },
            onDismiss: () => { btnEl.disabled = false; },
        });

        try {
            const configs = line.configs || [];
            await streamGenerate(
                FARPrompts.scores(ctx, line.name || 'Unnamed', line.description || '', configDetails, configs.length).prompt,
                SYSTEM_PROMPT,
                (chunk, full) => { contentEl.textContent = full; },
                () => { makeEditable(); btnEl.disabled = false; }
            );
        } catch (err) {
            contentEl.textContent = 'Error: ' + err.message;
            btnEl.disabled = false;
        }
    };

    const addScenarioLineFieldButtons = () => {
        document.querySelectorAll('.scenario-line-block').forEach(block => {
            const nameInput = block.querySelector('.scenario-line-name-input');
            if (!nameInput) return;
            const lineIdx = parseInt(nameInput.dataset.lineIdx);
            if (isNaN(lineIdx)) return;

            // Name AI button
            const header = block.querySelector('.scenario-line-header');
            if (header && !header.querySelector('.ai-field-btn')) {
                const btn = document.createElement('button');
                btn.className = 'ai-field-btn';
                btn.textContent = 'AI';
                btn.title = 'Suggest scenario line name';
                btn.disabled = !connected;
                btn.addEventListener('click', () => suggestScenarioLineName(btn, lineIdx));
                const removeBtn = header.querySelector('.btn-danger');
                header.insertBefore(btn, removeBtn);
            }

            // Description AI button
            const descTextarea = block.querySelector(`textarea[data-field="description"]`);
            if (descTextarea) {
                const formGroup = descTextarea.closest('.form-group');
                if (formGroup && !formGroup.querySelector('.ai-field-btn')) {
                    const btn = document.createElement('button');
                    btn.className = 'ai-field-btn';
                    btn.textContent = 'AI';
                    btn.title = 'Suggest scenario line description';
                    btn.disabled = !connected;
                    btn.addEventListener('click', () => suggestScenarioLineDescription(btn, lineIdx));
                    formGroup.insertBefore(btn, descTextarea);
                }
            }

            // Period labels + Scores buttons (in the configs section header)
            const configsSection = block.querySelector('.scenario-configs-section');
            const h4 = configsSection?.querySelector('h4');
            if (h4 && !h4.querySelector('.ai-field-btn')) {
                const periodsBtn = document.createElement('button');
                periodsBtn.className = 'ai-field-btn';
                periodsBtn.textContent = 'AI Periods';
                periodsBtn.title = 'Suggest period labels';
                periodsBtn.disabled = !connected;
                periodsBtn.addEventListener('click', () => suggestPeriodLabels(periodsBtn, lineIdx));
                h4.appendChild(periodsBtn);

                const scoresBtn = document.createElement('button');
                scoresBtn.className = 'ai-field-btn';
                scoresBtn.textContent = 'AI Scores';
                scoresBtn.title = 'Suggest commitment/freedom scores';
                scoresBtn.disabled = !connected;
                scoresBtn.addEventListener('click', () => suggestScores(scoresBtn, lineIdx));
                h4.appendChild(scoresBtn);
            }
        });
    };

    // ---- Public API ----
    return {
        init,
        loadSettings,
        checkConnection,
        updateSettingsUI,
        addBrainstormButton,
        addFieldAIButtons,
        addSectorSuggestionButton,
        addSectorFactorButtons,
        assessFactorSimilarity,
        addCCMButton,
        addCombinedFilterButton,
        addFilter2Button,
        addScenarioCompositionButton,
        addWarningIndicatorButtons,
        addScenarioLineFieldButtons,
        addNarrativeButtons,
        runAutopilot,
        runAssisted,
        hideAssistedButton,
        isConnected: () => connected,
        // Field locking API
        isLocked,
        unlockField,
        exportLocks,
        importLocks,
        clearAllLocks,
        clearStructuralLocks,
        resetAutopilotFlag,
        decorateAllLockedFields,
        isAutopilotDone: () => autopilotHasRun,
    };
})();
