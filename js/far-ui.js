/* ============================================================
   FAR UI — User Interface Rendering & Interaction
   Aligned with Rhyne's FAR Methodology (1995)
   ============================================================ */

const FARUI = (() => {
    // ---- Step 1: Initial View ----
    const renderInitialView = () => {
        const state = FARCore.getState();
        document.getElementById('initial-view').value = state.initialView || '';
        document.getElementById('field-boundaries').value = state.fieldBoundaries || '';
        document.getElementById('key-uncertainties').value = state.keyUncertainties || '';

        // Add AI buttons: section-level + per-field
        if (typeof FARAI !== 'undefined') {
            FARAI.addFieldAIButtons();
            FARAI.addBrainstormButton();
            FARAI.decorateAllLockedFields();
        }
    };

    const bindInitialViewEvents = () => {
        document.getElementById('initial-view').addEventListener('input', (e) => {
            FARCore.getState().initialView = e.target.value;
        });
        document.getElementById('field-boundaries').addEventListener('input', (e) => {
            FARCore.getState().fieldBoundaries = e.target.value;
        });
        document.getElementById('key-uncertainties').addEventListener('input', (e) => {
            FARCore.getState().keyUncertainties = e.target.value;
        });
    };

    // ---- Step 2: Sector / Factor UI ----
    const renderSectors = () => {
        const container = document.getElementById('sectors-container');
        const state = FARCore.getState();
        container.innerHTML = '';

        // Acronym
        document.getElementById('sector-acronym').value = state.acronym || '';

        // Sector count warning
        const warning = FARCore.getSectorCountWarning();
        const warningEl = document.getElementById('sector-count-warning');
        if (warning) {
            warningEl.innerHTML = `<span class="warning-icon">&#9888;</span> ${warning}`;
            warningEl.style.display = 'block';
        } else {
            warningEl.style.display = 'none';
        }

        state.sectors.forEach((sector, idx) => {
            const block = document.createElement('div');
            block.className = 'sector-block';
            block.innerHTML = `
                <div class="sector-header">
                    <div class="sector-letter">${sector.letter}</div>
                    <input type="text" value="${escHtml(sector.name)}" placeholder="Sector name (e.g., Economy, Governance, Technology...)"
                           data-sector-id="${sector.id}" data-field="name" class="sector-name-input">
                    <button class="btn-danger btn-sm" data-remove-sector="${sector.id}" title="Remove this sector">&times;</button>
                </div>
                <div class="sector-body">
                    <div class="sector-desc">
                        <textarea placeholder="Describe this sector — what aspect of the future does it represent?"
                                  data-sector-id="${sector.id}" data-field="description" rows="2">${escHtml(sector.description)}</textarea>
                    </div>
                    <div class="sector-content-row">
                        <div class="factors-list" id="factors-${sector.id}">
                            ${sector.factors.map((f, fi) => `
                                <div class="factor-row">
                                    <span class="factor-id">${f.id}</span>
                                    <input type="text" value="${escHtml(f.label)}" placeholder="Factor name"
                                           data-sector-id="${sector.id}" data-factor-id="${f.id}" data-field="label">
                                    <textarea placeholder="Brief description (optional)"
                                           data-sector-id="${sector.id}" data-factor-id="${f.id}" data-field="description" class="factor-desc-input" rows="1">${escHtml(f.description)}</textarea>
                                    <button class="factor-remove" data-remove-factor="${f.id}" data-sector-id="${sector.id}" title="Remove factor">&times;</button>
                                </div>
                            `).join('')}
                            <button class="add-factor-btn" data-add-factor="${sector.id}">+ Add Factor</button>
                        </div>
                        <div class="lewinian-map-container">
                            <div class="lewinian-map" id="lewinian-map-${sector.id}" data-sector-id="${sector.id}">
                                <div class="lewinian-map-label">Factor Similarity Map</div>
                                <div class="lewinian-map-help">Drag nearby = conceptually similar</div>
                                ${sector.factors.map(f => `
                                    <div class="lewinian-dot" data-factor-id="${f.id}" data-sector-id="${sector.id}"
                                         style="left:${(f.mapX || 0.5) * 100}%;top:${(f.mapY || 0.5) * 100}%"
                                         title="${f.id}: ${escHtml(f.label || '?')}">
                                        <span class="dot-label">${f.id}</span>
                                    </div>
                                `).join('')}
                            </div>
                            <button class="ai-field-btn ai-similarity-btn" data-sector-id="${sector.id}" title="AI: position factors by conceptual similarity">AI</button>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(block);
        });

        updateConfigCount();
        bindSectorEvents();
        bindLewanianMapEvents();

        // Add AI buttons: section-level + per-sector + similarity maps
        if (typeof FARAI !== 'undefined') {
            FARAI.addSectorFactorButtons();
            FARAI.addSectorSuggestionButton();
            FARAI.decorateAllLockedFields();
            // Bind AI similarity map buttons
            document.querySelectorAll('.ai-similarity-btn').forEach(btn => {
                btn.disabled = !FARAI.isConnected();
                btn.addEventListener('click', () => FARAI.assessFactorSimilarity(btn.dataset.sectorId));
            });
        }
    };

    // One-time acronym binding (avoid accumulating listeners)
    let acronymBound = false;
    let acronymManuallyEdited = false;
    const bindAcronymOnce = () => {
        if (acronymBound) return;
        acronymBound = true;
        document.getElementById('sector-acronym').addEventListener('input', (e) => {
            acronymManuallyEdited = true;
            FARCore.getState().acronym = e.target.value.toUpperCase();
        });
    };

    const autoUpdateAcronym = () => {
        const state = FARCore.getState();
        const autoAcronym = state.sectors
            .map(s => (s.name || '').trim())
            .filter(n => n.length > 0)
            .map(n => n[0].toUpperCase())
            .join('');
        if (!autoAcronym) return;

        // Only auto-update if user hasn't manually edited, or current value
        // matches a previous auto-generated acronym (or is empty)
        const current = (state.acronym || '').toUpperCase();
        if (!acronymManuallyEdited || current === '' || current === autoAcronym) {
            state.acronym = autoAcronym;
            const input = document.getElementById('sector-acronym');
            if (input) input.value = autoAcronym;
            acronymManuallyEdited = false;
        }
    };

    const bindSectorEvents = () => {
        bindAcronymOnce();

        // Auto-resize factor description textareas
        const autoResize = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
        document.querySelectorAll('textarea.factor-desc-input').forEach(ta => {
            autoResize(ta);
            ta.addEventListener('input', () => autoResize(ta));
        });

        // Sector name / description / factor changes
        document.querySelectorAll('[data-sector-id][data-field]').forEach(el => {
            el.addEventListener('input', (e) => {
                const state = FARCore.getState();
                const sector = state.sectors.find(s => s.id === e.target.dataset.sectorId);
                if (!sector) return;
                if (e.target.dataset.factorId) {
                    const factor = sector.factors.find(f => f.id === e.target.dataset.factorId);
                    if (factor) factor[e.target.dataset.field] = e.target.value;
                } else {
                    sector[e.target.dataset.field] = e.target.value;
                    // Auto-update acronym when sector name changes
                    if (e.target.dataset.field === 'name') {
                        autoUpdateAcronym();
                    }
                }
            });
        });

        // Remove sector
        document.querySelectorAll('[data-remove-sector]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (confirm('Remove this sector and all its factors?')) {
                    FARCore.removeSector(e.currentTarget.dataset.removeSector);
                    if (typeof FARAI !== 'undefined') FARAI.clearStructuralLocks();
                    renderSectors();
                }
            });
        });

        // Remove factor
        document.querySelectorAll('[data-remove-factor]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                FARCore.removeFactor(e.currentTarget.dataset.sectorId, e.currentTarget.dataset.removeFactor);
                if (typeof FARAI !== 'undefined') FARAI.clearStructuralLocks();
                renderSectors();
            });
        });

        // Add factor
        document.querySelectorAll('[data-add-factor]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                FARCore.addFactor(e.target.dataset.addFactor);
                renderSectors();
            });
        });
    };

    const bindLewanianMapEvents = () => {
        document.querySelectorAll('.lewinian-dot').forEach(dot => {
            let isDragging = false;
            let startX, startY, startLeft, startTop;

            const onMouseDown = (e) => {
                e.preventDefault();
                isDragging = true;
                const map = dot.closest('.lewinian-map');
                const rect = map.getBoundingClientRect();
                startX = e.clientX;
                startY = e.clientY;
                startLeft = parseFloat(dot.style.left) / 100 * rect.width;
                startTop = parseFloat(dot.style.top) / 100 * rect.height;
                dot.classList.add('dragging');

                const onMouseMove = (e) => {
                    if (!isDragging) return;
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    const newLeft = Math.max(0, Math.min(rect.width, startLeft + dx));
                    const newTop = Math.max(0, Math.min(rect.height, startTop + dy));
                    const pctX = newLeft / rect.width;
                    const pctY = newTop / rect.height;
                    dot.style.left = (pctX * 100) + '%';
                    dot.style.top = (pctY * 100) + '%';
                };

                const onMouseUp = () => {
                    isDragging = false;
                    dot.classList.remove('dragging');
                    // Save position
                    const map = dot.closest('.lewinian-map');
                    const rect = map.getBoundingClientRect();
                    const pctX = parseFloat(dot.style.left) / 100;
                    const pctY = parseFloat(dot.style.top) / 100;
                    const state = FARCore.getState();
                    const sector = state.sectors.find(s => s.id === dot.dataset.sectorId);
                    if (sector) {
                        const factor = sector.factors.find(f => f.id === dot.dataset.factorId);
                        if (factor) {
                            factor.mapX = pctX;
                            factor.mapY = pctY;
                        }
                    }
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            };

            dot.addEventListener('mousedown', onMouseDown);
        });
    };

    const updateConfigCount = () => {
        const el = document.getElementById('config-count');
        const total = FARCore.getTotalConfigurations();
        const state = FARCore.getState();
        if (state.sectors.length === 0) {
            el.innerHTML = '';
        } else {
            const parts = state.sectors.map(s => s.factors.length).join(' &times; ');
            el.innerHTML = `Total configuration space: ${parts} = <strong>${total.toLocaleString()}</strong> configurations`;
        }
    };

    // ---- Step 3: CCM UI (Filter 1) ----
    let currentPairIndex = 0;

    const renderCCM = () => {
        const state = FARCore.getState();
        const pairs = FARCore.getSectorPairs();
        if (pairs.length === 0) {
            document.getElementById('ccm-container').innerHTML = '<p style="color:var(--text-muted)">Add at least 2 sectors with factors first.</p>';
            return;
        }

        // Populate pair selector
        const select = document.getElementById('ccm-pair-select');
        select.innerHTML = '<option value="all">All pairs (full matrix)</option>';
        pairs.forEach(([s1, s2], i) => {
            select.innerHTML += `<option value="${i}">${s1.letter}: ${s1.name || 'Unnamed'} vs ${s2.letter}: ${s2.name || 'Unnamed'}</option>`;
        });
        select.value = currentPairIndex === -1 ? 'all' : currentPairIndex;
        select.onchange = () => {
            currentPairIndex = select.value === 'all' ? -1 : parseInt(select.value);
            renderCCMTable();
        };

        renderCCMTable();
        updateCCMStats();

        // Add AI buttons
        if (typeof FARAI !== 'undefined') {
            FARAI.addCCMButton();
            FARAI.addCombinedFilterButton();
        }
    };

    const renderCCMTable = () => {
        const container = document.getElementById('ccm-container');

        if (currentPairIndex === -1) {
            renderFullCCMMatrix(container);
        } else {
            const pairs = FARCore.getSectorPairs();
            if (currentPairIndex >= pairs.length) currentPairIndex = 0;
            renderSinglePairCCM(container, pairs[currentPairIndex][0], pairs[currentPairIndex][1]);
        }
    };

    const renderFullCCMMatrix = (container) => {
        const state = FARCore.getState();
        const allFactors = FARCore.getAllFactors();
        if (allFactors.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted)">No factors defined yet.</p>';
            return;
        }

        let html = '<table class="ccm-table"><thead><tr><th class="corner"></th>';
        state.sectors.forEach(s => {
            s.factors.forEach(f => {
                html += `<th title="${escHtml(f.label || f.id)}">${f.id}</th>`;
            });
        });
        html += '</tr></thead><tbody>';

        state.sectors.forEach(rowSector => {
            rowSector.factors.forEach(rowFactor => {
                html += `<tr><th class="row-header" title="${escHtml(rowFactor.label || rowFactor.id)}">${rowFactor.id}${rowFactor.label ? ': ' + escHtml(rowFactor.label) : ''}</th>`;
                state.sectors.forEach(colSector => {
                    colSector.factors.forEach(colFactor => {
                        if (rowSector.id === colSector.id) {
                            html += `<td class="ccm-cell same-sector" data-f1="${rowFactor.id}" data-f2="${colFactor.id}"></td>`;
                        } else {
                            const entry = FARCore.getCCMEntry(rowFactor.id, colFactor.id);
                            const cls = entry.compatible ? 'compatible' : 'incompatible';
                            const mark = entry.compatible ? '' : '&times;';
                            html += `<td class="ccm-cell ${cls}" data-f1="${rowFactor.id}" data-f2="${colFactor.id}"><span class="cell-mark">${mark}</span></td>`;
                        }
                    });
                });
                html += '</tr>';
            });
        });

        html += '</tbody></table>';
        container.innerHTML = html;
        bindCCMCells();
    };

    const renderSinglePairCCM = (container, sector1, sector2) => {
        let html = `<h4 style="margin-bottom:12px;color:var(--text-heading)">
            ${sector1.letter}: ${sector1.name || 'Unnamed'} &nbsp;vs&nbsp; ${sector2.letter}: ${sector2.name || 'Unnamed'}
        </h4>`;
        html += '<table class="ccm-table"><thead><tr><th class="corner"></th>';
        sector2.factors.forEach(f => {
            html += `<th>${f.id}: ${escHtml(f.label || '?')}</th>`;
        });
        html += '</tr></thead><tbody>';

        sector1.factors.forEach(f1 => {
            html += `<tr><th class="row-header">${f1.id}: ${escHtml(f1.label || '?')}</th>`;
            sector2.factors.forEach(f2 => {
                const entry = FARCore.getCCMEntry(f1.id, f2.id);
                const cls = entry.compatible ? 'compatible' : 'incompatible';
                const mark = entry.compatible ? '&#10003;' : '&times;';
                html += `<td class="ccm-cell ${cls}" data-f1="${f1.id}" data-f2="${f2.id}">
                    <span class="cell-mark">${mark}</span>
                </td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table>';

        // Navigation
        const pairs = FARCore.getSectorPairs();
        html += '<div style="display:flex;justify-content:space-between;margin-top:16px">';
        if (currentPairIndex > 0) {
            html += `<button class="btn-ghost" id="ccm-prev">&larr; Previous pair</button>`;
        } else {
            html += '<span></span>';
        }
        html += `<span style="color:var(--text-muted);font-size:0.8rem">Pair ${currentPairIndex + 1} of ${pairs.length}</span>`;
        if (currentPairIndex < pairs.length - 1) {
            html += `<button class="btn-ghost" id="ccm-next">Next pair &rarr;</button>`;
        } else {
            html += '<span></span>';
        }
        html += '</div>';

        container.innerHTML = html;

        document.getElementById('ccm-prev')?.addEventListener('click', () => {
            currentPairIndex--;
            document.getElementById('ccm-pair-select').value = currentPairIndex;
            renderCCMTable();
        });
        document.getElementById('ccm-next')?.addEventListener('click', () => {
            currentPairIndex++;
            document.getElementById('ccm-pair-select').value = currentPairIndex;
            renderCCMTable();
        });

        bindCCMCells();
    };

    const bindCCMCells = () => {
        const container = document.getElementById('ccm-container');
        if (!container) return;

        if (container._ccmClickHandler) container.removeEventListener('click', container._ccmClickHandler);

        container._ccmClickHandler = (e) => {
            const cell = e.target.closest('.ccm-cell:not(.same-sector)');
            if (!cell || !cell.dataset.f1 || !cell.dataset.f2) return;
            openCCMModal(cell.dataset.f1, cell.dataset.f2);
        };

        container.addEventListener('click', container._ccmClickHandler);
    };

    const openCCMModal = (f1Id, f2Id) => {
        const f1 = FARCore.getFactorById(f1Id);
        const f2 = FARCore.getFactorById(f2Id);
        const entry = FARCore.getCCMEntry(f1Id, f2Id);

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <h3>Pair-wise Assessment</h3>
                <p style="font-size:0.85rem;margin-bottom:12px;color:var(--text-muted)">
                    <em>"Can we think of a pattern within which these two factors might coexist?"</em> &mdash; Rhyne
                </p>
                <div style="display:flex;gap:12px;margin-bottom:16px;font-size:0.85rem">
                    <div style="flex:1;background:var(--bg-input);padding:10px;border-radius:var(--radius);border:1px solid var(--border)">
                        <strong style="color:var(--accent)">${f1Id}</strong>: ${escHtml(f1?.label || '?')}
                        ${f1?.description ? `<br><small style="color:var(--text-muted)">${escHtml(f1.description)}</small>` : ''}
                    </div>
                    <div style="flex:1;background:var(--bg-input);padding:10px;border-radius:var(--radius);border:1px solid var(--border)">
                        <strong style="color:var(--accent)">${f2Id}</strong>: ${escHtml(f2?.label || '?')}
                        ${f2?.description ? `<br><small style="color:var(--text-muted)">${escHtml(f2.description)}</small>` : ''}
                    </div>
                </div>
                <div class="ccm-status-selector">
                    <button class="ccm-status-btn ${entry.compatible ? 'selected-yes' : ''}" data-val="yes">&#10003; Yes &mdash; can coexist</button>
                    <button class="ccm-status-btn ${!entry.compatible ? 'selected-no' : ''}" data-val="no">&times; No &mdash; cannot coexist</button>
                </div>
                <div class="form-group">
                    <label>Notes <span class="optional">(optional)</span></label>
                    <textarea id="ccm-note" rows="3" placeholder="Why can or can't these two factors coexist? What's the reasoning?">${escHtml(entry.note)}</textarea>
                </div>
                <div class="modal-actions">
                    <button class="btn-ghost" id="ccm-modal-cancel">Cancel</button>
                    <button class="btn-primary" id="ccm-modal-save">Save</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        let selectedCompatible = entry.compatible;

        overlay.querySelectorAll('.ccm-status-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                overlay.querySelectorAll('.ccm-status-btn').forEach(b => b.className = 'ccm-status-btn');
                selectedCompatible = btn.dataset.val === 'yes';
                btn.classList.add(selectedCompatible ? 'selected-yes' : 'selected-no');
            });
        });

        overlay.querySelector('#ccm-modal-cancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('#ccm-modal-save').addEventListener('click', () => {
            const note = document.getElementById('ccm-note').value;
            FARCore.setCCMEntry(f1Id, f2Id, selectedCompatible, note);
            overlay.remove();
            renderCCMTable();
            updateCCMStats();
        });
    };

    const updateCCMStats = () => {
        const el = document.getElementById('ccm-stats');
        const total = FARCore.getPairCount();
        const incompat = FARCore.getIncompatiblePairCount();
        const assessed = Object.keys(FARCore.getState().ccm).length;
        el.innerHTML = `${assessed} of ${total} pairs assessed &nbsp;|&nbsp; <span style="color:var(--red)">${incompat} incompatible (No)</span>`;
    };

    // ---- Step 3: Solution Space / Filter 1 Results ----
    let cachedFilter1 = null;

    const renderSolutionSpace = () => {
        const result = FARCore.computeFilter1();
        cachedFilter1 = result;

        // Summary cards
        const summaryEl = document.getElementById('solution-space-summary');
        const survivingCount = result.allSurvive ? result.total : result.surviving.length;
        const pct = result.total > 0 ? ((survivingCount / result.total) * 100).toFixed(1) : 0;
        const survivingLabel = result.allSurvive ? result.total.toLocaleString() : result.surviving.length.toLocaleString();
        summaryEl.innerHTML = `
            <div class="summary-card">
                <div class="big-num">${result.total.toLocaleString()}</div>
                <div class="label">Total Configurations</div>
            </div>
            <div class="summary-card">
                <div class="big-num red">${result.eliminated.toLocaleString()}</div>
                <div class="label">Eliminated (Filter 1)</div>
            </div>
            <div class="summary-card">
                <div class="big-num green">${survivingLabel}${result.capped ? '+' : ''}</div>
                <div class="label">Surviving (Filter 1)</div>
            </div>
            <div class="summary-card">
                <div class="big-num">${pct}%</div>
                <div class="label">Survival Rate</div>
            </div>
        `;

        if (result.allSurvive) {
            document.getElementById('solution-space-analysis').innerHTML = '<div class="analysis-section"><p>All configurations survive Filter 1 (no incompatible pairs marked). The configuration space is too large to enumerate. Mark some factor pairs as incompatible to reduce the space, or proceed to Filter 2.</p></div>';
            document.getElementById('solution-space-table-container').innerHTML = '';
            document.getElementById('filter2-container').innerHTML = '<p style="color:var(--text-muted)">Mark incompatible pairs in Filter 1 to reduce the space before holistic assessment.</p>';
            document.getElementById('final-summary').innerHTML = '';
            document.getElementById('final-table-container').innerHTML = '';
            return;
        }

        // Factor frequency
        if (result.surviving.length > 0) {
            renderFactorFrequency(result.surviving);
        } else {
            document.getElementById('solution-space-analysis').innerHTML = '';
        }

        // Table of surviving configs
        renderSolutionTable(result.surviving);

        // Render Filter 2
        renderFilter2(result.surviving);

        // Render final results
        renderFinalResults(result.surviving);
    };

    const renderFactorFrequency = (surviving) => {
        const freq = FARCore.analyzeFactorFrequency(surviving);
        const state = FARCore.getState();
        const analysisEl = document.getElementById('solution-space-analysis');

        let html = '<div class="analysis-section"><h4>Factor Frequency in Filter 1 Survivors</h4>';
        html += '<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px">How often does each factor appear? Factors present in all configurations are "robust." Factors that never appear are effectively impossible given your constraints.</p>';

        state.sectors.forEach(sector => {
            html += `<div style="margin-bottom:16px"><strong style="font-size:0.85rem;color:var(--text-heading)">${sector.letter}: ${escHtml(sector.name || 'Unnamed')}</strong>`;
            sector.factors.forEach(f => {
                const count = freq[f.id] || 0;
                const pct = surviving.length > 0 ? ((count / surviving.length) * 100).toFixed(0) : 0;
                const cls = pct == 100 ? 'robust' : pct == 0 ? 'absent' : '';
                html += `
                    <div class="factor-freq-bar">
                        <span class="label">${f.id}: ${escHtml(f.label || '?')}</span>
                        <div class="freq-bar-track"><div class="freq-bar-fill ${cls}" style="width:${pct}%"></div></div>
                        <span class="pct">${pct}%</span>
                    </div>
                `;
            });
            html += '</div>';
        });

        html += '</div>';
        analysisEl.innerHTML = html;
    };

    const renderSolutionTable = (surviving) => {
        const container = document.getElementById('solution-space-table-container');
        const state = FARCore.getState();

        if (surviving.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);padding:16px">No surviving configurations after Filter 1. You may have too many incompatible pairs.</p>';
            return;
        }

        const displayCount = Math.min(surviving.length, 200);
        let html = `<div class="solution-table-wrap"><table class="solution-table"><thead><tr><th>#</th>`;
        state.sectors.forEach(s => {
            html += `<th>${s.letter}: ${escHtml(s.name || 'Unnamed')}</th>`;
        });
        html += '</tr></thead><tbody>';

        for (let i = 0; i < displayCount; i++) {
            const config = surviving[i];
            html += `<tr><td>${i + 1}</td>`;
            config.forEach(fId => {
                const f = FARCore.getFactorById(fId);
                html += `<td>${fId}: ${escHtml(f?.label || '?')}</td>`;
            });
            html += '</tr>';
        }

        html += '</tbody></table></div>';
        if (surviving.length > displayCount) {
            html += `<p style="color:var(--text-muted);font-size:0.8rem;margin-top:8px">Showing first ${displayCount} of ${surviving.length.toLocaleString()} configurations.</p>`;
        }
        container.innerHTML = html;
    };

    // ---- Filter 2: Holistic Assessment UI ----
    const renderFilter2 = (filter1Survivors) => {
        const container = document.getElementById('filter2-container');
        const state = FARCore.getState();

        if (!filter1Survivors || filter1Survivors.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted)">No configurations survived Filter 1.</p>';
            return;
        }

        const displayCount = Math.min(filter1Survivors.length, 100);
        let html = `<p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:16px">Review each surviving configuration as a <em>whole</em>. Does it represent a coherent picture of a possible future? Showing ${displayCount} of ${filter1Survivors.length} configurations.</p>`;

        html += '<div class="filter2-list">';
        for (let i = 0; i < displayCount; i++) {
            const config = filter1Survivors[i];
            const key = FARCore.configKey(config);
            const entry = FARCore.getFilter2Entry(config);

            html += `<div class="filter2-item ${entry.pass ? 'pass' : 'reject'}" data-config-key="${key}" data-config-idx="${i}">
                <div class="filter2-header">
                    <span class="filter2-num">#${i + 1}</span>
                    <span class="filter2-config">${config.map(fId => {
                        const f = FARCore.getFactorById(fId);
                        return `<span class="factor-tag">${fId}: ${escHtml(f?.label || '?')}</span>`;
                    }).join(' ')}</span>
                    <div class="filter2-toggle">
                        <button class="filter2-btn pass-btn ${entry.pass ? 'active' : ''}" data-action="pass" data-key="${key}">&#10003; Pass</button>
                        <button class="filter2-btn reject-btn ${!entry.pass ? 'active' : ''}" data-action="reject" data-key="${key}"${entry.note ? ` title="${escHtml(entry.note)}"` : ''}>&#10007; Reject</button>
                    </div>
                </div>
                <div class="filter2-note-row" ${entry.pass ? 'style="display:none"' : ''}>
                    <textarea class="filter2-note" data-key="${key}" rows="2" placeholder="Why reject? (optional)">${escHtml(entry.note)}</textarea>
                </div>
            </div>`;
        }
        html += '</div>';

        container.innerHTML = html;
        bindFilter2Events(filter1Survivors);

        // Add AI Filter 2 button
        if (typeof FARAI !== 'undefined') FARAI.addFilter2Button();
    };

    const bindFilter2Events = (filter1Survivors) => {
        const container = document.getElementById('filter2-container');
        if (!container) return;

        // Remove old delegation listeners before re-attaching
        if (container._f2ClickHandler) container.removeEventListener('click', container._f2ClickHandler);
        if (container._f2InputHandler) container.removeEventListener('input', container._f2InputHandler);

        container._f2ClickHandler = (e) => {
            const btn = e.target.closest('.filter2-btn');
            if (!btn) return;
            const key = btn.dataset.key;
            const pass = btn.dataset.action === 'pass';
            const config = FARCore.parseConfigKey(key);
            const noteInput = container.querySelector(`.filter2-note[data-key="${key}"]`);
            const note = noteInput?.value || '';
            FARCore.setFilter2Entry(config, pass, note);

            const item = btn.closest('.filter2-item');
            item.className = `filter2-item ${pass ? 'pass' : 'reject'}`;
            item.querySelectorAll('.filter2-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const noteRow = item.querySelector('.filter2-note-row');
            noteRow.style.display = pass ? 'none' : '';

            const rejectBtn = item.querySelector('.reject-btn');
            if (rejectBtn) rejectBtn.title = note;

            renderFinalResults(filter1Survivors);
        };

        container._f2InputHandler = (e) => {
            if (!e.target.matches('.filter2-note')) return;
            const key = e.target.dataset.key;
            const config = FARCore.parseConfigKey(key);
            const entry = FARCore.getFilter2Entry(config);
            FARCore.setFilter2Entry(config, entry.pass, e.target.value);

            const item = e.target.closest('.filter2-item');
            const rejectBtn = item?.querySelector('.reject-btn');
            if (rejectBtn) rejectBtn.title = e.target.value;
        };

        container.addEventListener('click', container._f2ClickHandler);
        container.addEventListener('input', container._f2InputHandler);
    };

    // ---- Final surviving configurations ----
    const renderFinalResults = (filter1Survivors) => {
        if (!filter1Survivors) return;
        const finalSurvivors = FARCore.getFinalSurvivors(filter1Survivors);
        const state = FARCore.getState();

        const summaryEl = document.getElementById('final-summary');
        const filter2Rejects = filter1Survivors.length - filter1Survivors.filter(c => FARCore.getFilter2Entry(c).pass).length;
        const reintroduced = state.reintroducedConfigs.length;

        summaryEl.innerHTML = `
            <div class="summary-card">
                <div class="big-num">${filter1Survivors.length}</div>
                <div class="label">Filter 1 Survivors</div>
            </div>
            <div class="summary-card">
                <div class="big-num red">${filter2Rejects}</div>
                <div class="label">Rejected (Filter 2)</div>
            </div>
            ${reintroduced > 0 ? `<div class="summary-card">
                <div class="big-num purple">${reintroduced}</div>
                <div class="label">Reintroduced</div>
            </div>` : ''}
            <div class="summary-card">
                <div class="big-num green">${finalSurvivors.length}</div>
                <div class="label">Final Survivors</div>
            </div>
        `;

        // Table
        const tableContainer = document.getElementById('final-table-container');
        if (finalSurvivors.length === 0) {
            tableContainer.innerHTML = '<p style="color:var(--text-muted);padding:16px">No final surviving configurations.</p>';
            return;
        }

        const displayCount = Math.min(finalSurvivors.length, 200);
        let html = `<div class="solution-table-wrap"><table class="solution-table"><thead><tr><th>#</th>`;
        state.sectors.forEach(s => {
            html += `<th>${s.letter}: ${escHtml(s.name || 'Unnamed')}</th>`;
        });
        html += '</tr></thead><tbody>';

        for (let i = 0; i < displayCount; i++) {
            const config = finalSurvivors[i];
            const isReintroduced = state.reintroducedConfigs.includes(FARCore.configKey(config));
            html += `<tr class="${isReintroduced ? 'reintroduced-row' : ''}"><td>${i + 1}${isReintroduced ? ' *' : ''}</td>`;
            config.forEach(fId => {
                const f = FARCore.getFactorById(fId);
                html += `<td>${fId}: ${escHtml(f?.label || '?')}</td>`;
            });
            html += '</tr>';
        }

        html += '</tbody></table></div>';
        if (state.reintroducedConfigs.length > 0) {
            html += '<p style="color:var(--text-muted);font-size:0.8rem;margin-top:8px">* = Reintroduced configuration</p>';
        }
        tableContainer.innerHTML = html;
    };

    const getCachedFilter1 = () => cachedFilter1;

    // ---- Step 4: Scenario Lines UI ----
    const SCENARIO_COLORS = ['#1a5f4a', '#2563eb', '#d97706', '#dc2626', '#7c3aed',
                              '#0891b2', '#c2410c', '#be185d', '#4338ca', '#059669'];

    const renderScenarioLines = () => {
        const state = FARCore.getState();
        const container = document.getElementById('scenario-lines-container');
        const filter1 = cachedFilter1 || FARCore.computeFilter1();
        const finalSurvivors = FARCore.getFinalSurvivors(filter1.surviving);

        if (state.scenarioLines.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted)">No scenario lines yet. Add one to begin composing scenarios.</p>';
            return;
        }

        container.innerHTML = '';
        state.scenarioLines.forEach((line, li) => {
            const block = document.createElement('div');
            block.className = 'scenario-line-block';
            block.innerHTML = `
                <div class="scenario-line-header">
                    <div class="scenario-line-color" style="background:${line.color}"></div>
                    <input type="text" value="${escHtml(line.name)}" placeholder="Scenario line name (e.g., Techno-Optimism, Green Transition...)"
                           data-line-idx="${li}" data-field="name" class="scenario-line-name-input">
                    <button class="btn-danger btn-sm" data-remove-line="${li}">&times;</button>
                </div>
                <div class="scenario-line-body">
                    <div class="form-group">
                        <textarea placeholder="Describe the overall character of this scenario line..."
                                  data-line-idx="${li}" data-field="description" rows="2">${escHtml(line.description)}</textarea>
                    </div>
                    <div class="scenario-configs-section">
                        <h4>Configurations in this scenario line (temporal sequence)</h4>
                        <div class="score-anchors">
                            <strong>F</strong> (Commitment): 1 = Passive/drifting &rarr; 5 = Moderate &rarr; 10 = Maximum commitment<br>
                            <strong>O</strong> (Freedom): 1 = Locked-in &rarr; 5 = Moderate &rarr; 10 = Maximum freedom
                        </div>
                        <div class="scenario-configs-list" id="scenario-configs-${li}">
                            ${(line.configs || []).map((cfg, ci) => {
                                let html = `
                                <div class="scenario-config-item">
                                    <span class="config-period">
                                        <input type="text" value="${escHtml(cfg.periodLabel || '')}" placeholder="Period (e.g., 2025)"
                                               data-line-idx="${li}" data-config-idx="${ci}" data-cfield="periodLabel" class="period-input">
                                    </span>
                                    <span class="config-factors-display">
                                        ${FARCore.parseConfigKey(cfg.configKey).map(fId => {
                                            const f = FARCore.getFactorById(fId);
                                            return '<span class="factor-tag">' + fId + ': ' + escHtml(f?.label || '?') + '</span>';
                                        }).join(' ')}
                                        <span class="config-key-secondary">${cfg.configKey}</span>
                                    </span>
                                    <label class="score-label">F: <input type="number" min="1" max="10" value="${cfg.commitment || 5}"
                                           data-line-idx="${li}" data-config-idx="${ci}" data-cfield="commitment" class="score-input" title="Commitment (1=Passive/drifting, 5=Moderate, 10=Maximum commitment)"></label>
                                    <label class="score-label">O: <input type="number" min="1" max="10" value="${cfg.freedom || 5}"
                                           data-line-idx="${li}" data-config-idx="${ci}" data-cfield="freedom" class="score-input" title="Freedom (1=Locked-in, 5=Moderate, 10=Maximum freedom)"></label>
                                    <button class="btn-danger btn-sm" data-remove-config="${ci}" data-line-idx="${li}">&times;</button>
                                </div>`;
                                if (state.project.collectWarningIndicators && ci < line.configs.length - 1) {
                                    html += `
                                <div class="warning-indicator-row">
                                    <span class="warning-indicator-arrow">&darr;</span>
                                    <input type="text" class="warning-indicator-input" value="${escHtml(cfg.warningIndicator || '')}"
                                           placeholder="What event or trend causes this shift?"
                                           data-line-idx="${li}" data-config-idx="${ci}" data-cfield="warningIndicator">
                                </div>`;
                                }
                                return html;
                            }).join('')}
                        </div>
                        <div class="add-config-to-line">
                            <select class="config-selector" data-line-idx="${li}">
                                <option value="">Add a configuration...</option>
                                ${finalSurvivors.map(config => {
                                    const key = FARCore.configKey(config);
                                    const label = config.map(fId => {
                                        const f = FARCore.getFactorById(fId);
                                        return f?.label || fId;
                                    }).join(', ');
                                    return `<option value="${key}">${label} (${key})</option>`;
                                }).join('')}
                            </select>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(block);
        });

        bindScenarioLineEvents(finalSurvivors);

        // Add AI buttons
        if (typeof FARAI !== 'undefined') {
            FARAI.addScenarioCompositionButton();
            FARAI.addScenarioLineFieldButtons();
            FARAI.addWarningIndicatorButtons();
            FARAI.decorateAllLockedFields();
        }
    };

    const bindScenarioLineEvents = (finalSurvivors) => {
        const state = FARCore.getState();

        // Name/description changes
        document.querySelectorAll('[data-line-idx][data-field]').forEach(el => {
            el.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.lineIdx);
                state.scenarioLines[idx][e.target.dataset.field] = e.target.value;
            });
        });

        // Config field changes (period, commitment, freedom)
        document.querySelectorAll('[data-line-idx][data-config-idx][data-cfield]:not(.warning-indicator-input)').forEach(el => {
            el.addEventListener('input', (e) => {
                const li = parseInt(e.target.dataset.lineIdx);
                const ci = parseInt(e.target.dataset.configIdx);
                const field = e.target.dataset.cfield;
                const line = state.scenarioLines[li];
                if (line && line.configs && line.configs[ci]) {
                    if (field === 'commitment' || field === 'freedom') {
                        line.configs[ci][field] = Math.max(1, Math.min(10, parseInt(e.target.value) || 5));
                    } else {
                        line.configs[ci][field] = e.target.value;
                    }
                    FARTree.renderTree();
                }
            });
        });

        // Warning indicator changes
        document.querySelectorAll('.warning-indicator-input').forEach(el => {
            el.addEventListener('input', (e) => {
                const li = parseInt(e.target.dataset.lineIdx);
                const ci = parseInt(e.target.dataset.configIdx);
                const line = state.scenarioLines[li];
                if (line && line.configs && line.configs[ci]) {
                    line.configs[ci].warningIndicator = e.target.value;
                }
            });
        });

        // Remove scenario line
        document.querySelectorAll('[data-remove-line]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.removeLine);
                state.scenarioLines.splice(idx, 1);
                if (typeof FARAI !== 'undefined') FARAI.clearStructuralLocks();
                renderScenarioLines();
                FARTree.renderTree();
            });
        });

        // Remove config from line
        document.querySelectorAll('[data-remove-config]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const li = parseInt(e.currentTarget.dataset.lineIdx);
                const ci = parseInt(e.currentTarget.dataset.removeConfig);
                state.scenarioLines[li].configs.splice(ci, 1);
                renderScenarioLines();
                FARTree.renderTree();
            });
        });

        // Add config to line
        document.querySelectorAll('.config-selector').forEach(select => {
            select.addEventListener('change', (e) => {
                const li = parseInt(e.target.dataset.lineIdx);
                const configKey = e.target.value;
                if (!configKey) return;
                const line = state.scenarioLines[li];
                if (!line.configs) line.configs = [];
                line.configs.push({
                    configKey,
                    periodLabel: '',
                    commitment: 5,
                    freedom: 5,
                });
                renderScenarioLines();
                FARTree.renderTree();
            });
        });
    };

    // ---- Narratives UI ----
    const renderNarratives = () => {
        const state = FARCore.getState();
        const container = document.getElementById('narratives-container');

        if (state.scenarioLines.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted)">Create scenario lines first.</p>';
            return;
        }

        container.innerHTML = '';
        state.scenarioLines.forEach((line, li) => {
            const block = document.createElement('div');
            block.className = 'narrative-block';
            const configCount = (line.configs || []).length;
            block.innerHTML = `
                <h3 style="display:flex;align-items:center;gap:8px">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${line.color}"></span>
                    ${escHtml(line.name || 'Unnamed Scenario Line')}
                </h3>
                <div class="narrative-meta">${configCount} configurations &nbsp;|&nbsp; ${escHtml(line.description || 'No description')}</div>
                <textarea placeholder="Write the scenario narrative for this line. Follow the temporal sequence of configurations, explaining how and why the world transitions from one state to the next..."
                          data-narrative-line-idx="${li}" rows="8">${escHtml(line.narrative || '')}</textarea>
            `;
            container.appendChild(block);
        });

        document.querySelectorAll('[data-narrative-line-idx]').forEach(el => {
            el.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.narrativeLineIdx);
                state.scenarioLines[idx].narrative = e.target.value;
            });
        });

        // Add AI narrative draft buttons
        if (typeof FARAI !== 'undefined') {
            FARAI.addNarrativeButtons();
            FARAI.decorateAllLockedFields();
        }
    };

    // ---- Reintroduce Configs Modal ----
    const openReintroduceModal = () => {
        const filter1 = cachedFilter1 || FARCore.computeFilter1();
        const state = FARCore.getState();

        // Get rejected configs (eliminated by Filter 1 or rejected by Filter 2)
        const filter1Keys = new Set(filter1.surviving.map(c => FARCore.configKey(c)));
        const filter2Rejects = filter1.surviving.filter(c => !FARCore.getFilter2Entry(c).pass);

        if (filter2Rejects.length === 0) {
            alert('No rejected configurations available to reintroduce.');
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        let html = `<div class="modal" style="max-width:700px;max-height:80vh;overflow-y:auto">
            <h3>Reintroduce Configurations</h3>
            <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:16px">
                Select configurations rejected by Filter 2 to bring back into the scenario composition.
                Rhyne allows reintroduction when a configuration serves a scenario narrative.
            </p>
            <div class="reintroduce-list">`;

        filter2Rejects.forEach((config, i) => {
            const key = FARCore.configKey(config);
            const isReintroduced = state.reintroducedConfigs.includes(key);
            html += `<div class="reintroduce-item">
                <label>
                    <input type="checkbox" data-config-key="${key}" ${isReintroduced ? 'checked' : ''}>
                    <span class="config-factors-display">
                        ${config.map(fId => {
                            const f = FARCore.getFactorById(fId);
                            return '<span class="factor-tag">' + fId + ': ' + escHtml(f?.label || '?') + '</span>';
                        }).join(' ')}
                        <span class="config-key-secondary">${key}</span>
                    </span>
                </label>
            </div>`;
        });

        html += `</div>
            <div class="modal-actions">
                <button class="btn-ghost" id="reintro-cancel">Cancel</button>
                <button class="btn-primary" id="reintro-save">Save</button>
            </div>
        </div>`;

        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        overlay.querySelector('#reintro-cancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('#reintro-save').addEventListener('click', () => {
            state.reintroducedConfigs = [];
            overlay.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (cb.checked) {
                    state.reintroducedConfigs.push(cb.dataset.configKey);
                }
            });
            overlay.remove();
            renderFinalResults(filter1.surviving);
            renderScenarioLines();
        });
    };

    // ---- Utilities ----
    const escHtml = (str) => {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    return {
        renderInitialView, bindInitialViewEvents,
        renderSectors, updateConfigCount,
        renderCCM, renderCCMTable, updateCCMStats,
        renderSolutionSpace, getCachedFilter1,
        renderFilter2, renderFinalResults,
        renderScenarioLines, renderNarratives,
        openReintroduceModal,
        escHtml,
        SCENARIO_COLORS,
    };
})();
