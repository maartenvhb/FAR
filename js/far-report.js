/* ============================================================
   FAR Report — Final Report Generation & PDF Export
   Aligned with Rhyne's FAR Methodology (1995)
   ============================================================ */

const FARReport = (() => {

    const generateReport = () => {
        const state = FARCore.getState();
        const container = document.getElementById('report-content');
        const filter1 = FARUI.getCachedFilter1() || FARCore.computeFilter1();
        const finalSurvivors = FARCore.getFinalSurvivors(filter1.surviving);
        // Sanitize: escape HTML and strip control characters that break html2canvas
        const esc = (s) => FARUI.escHtml(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B\u200C\u200D\uFEFF]/g, '');

        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        let html = '';

        // ---- Title ----
        html += `<h1>${esc(state.project.name) || 'Untitled FAR Analysis'}</h1>`;
        html += `<p class="report-subtitle">${esc(state.project.description) || 'Field Anomaly Relaxation Analysis'}</p>`;
        if (state.project.horizon) {
            html += `<p class="report-subtitle">Time Horizon: ${esc(state.project.horizon)}</p>`;
        }
        html += `<p class="report-date">Generated ${dateStr}</p>`;

        // ---- 1. Methodology ----
        html += `<h2>1. Methodology Overview</h2>`;
        html += `<p>This report presents the results of a <strong>Field Anomaly Relaxation (FAR)</strong> analysis &mdash; a systematic foresight methodology developed by Russell Rhyne at the Stanford Research Institute (1971). As described in Rhyne's 1995 paper "Field Anomaly Relaxation &mdash; The arts of usage," FAR is an iterative, cyclic process:</p>`;
        html += `<ol>
            <li><strong>Form a View:</strong> Initial brainstorming of alternative futures, field boundaries, and key uncertainties</li>
            <li><strong>Sector Array Construction:</strong> Defining 6&ndash;7 primary sectors with factors and a mnemonic acronym</li>
            <li><strong>Two-Stage Filtering:</strong> Filter 1 (pair-wise: "Can these factors coexist?") and Filter 2 (holistic: "Is this whole configuration coherent?")</li>
            <li><strong>Scenario Composition:</strong> Stringing configurations into temporal scenario lines on the Scenario Tree &mdash; a branching timeline diverging from a shared present, scored by Commitment and Freedom</li>
        </ol>`;

        // ---- 2. Initial View ----
        html += `<h2>2. Initial View of the Future</h2>`;
        if (state.initialView) {
            html += `<div class="narrative-text">${esc(state.initialView)}</div>`;
        } else {
            html += '<p><em>No initial view recorded.</em></p>';
        }
        if (state.fieldBoundaries) {
            html += `<h3>Field Boundaries</h3><p>${esc(state.fieldBoundaries)}</p>`;
        }
        if (state.keyUncertainties) {
            html += `<h3>Key Uncertainties</h3><p>${esc(state.keyUncertainties)}</p>`;
        }

        // ---- 3. Sector & Factor Array ----
        html += `<h2>3. Sector &amp; Factor Array</h2>`;
        if (state.acronym) {
            html += `<p><strong>Array Acronym:</strong> ${esc(state.acronym)}</p>`;
        }
        html += `<p>The analysis domain is characterized by <strong>${state.sectors.length} sectors</strong> with a total of <strong>${state.sectors.reduce((s, sec) => s + sec.factors.length, 0)} factors</strong>, producing a morphological space of <strong>${filter1.total.toLocaleString()}</strong> possible configurations.</p>`;

        html += '<table><thead><tr><th>Sector</th><th>Factor ID</th><th>Factor Name</th><th>Description</th></tr></thead><tbody>';
        state.sectors.forEach(sector => {
            sector.factors.forEach((f, fi) => {
                html += `<tr>
                    ${fi === 0 ? `<td rowspan="${sector.factors.length}"><strong>${sector.letter}: ${esc(sector.name)}</strong><br><small>${esc(sector.description)}</small></td>` : ''}
                    <td>${f.id}</td>
                    <td>${esc(f.label)}</td>
                    <td>${esc(f.description)}</td>
                </tr>`;
            });
        });
        html += '</tbody></table>';

        // ---- 4. Filter 1: Pair-wise Assessment ----
        html += `<h2>4. Filter 1 &mdash; Pair-wise Consistency</h2>`;
        const totalPairs = FARCore.getPairCount();
        const incompatible = FARCore.getIncompatiblePairCount();
        const compatible = totalPairs - incompatible;

        html += `<p>A total of <strong>${totalPairs}</strong> factor pairs across different sectors were evaluated with Rhyne's question: <em>"Can we think of a pattern within which these two factors might coexist?"</em></p>`;
        html += `<table><thead><tr><th>Assessment</th><th>Count</th><th>Percentage</th></tr></thead><tbody>
            <tr><td><span class="report-badge rpt-compatible">Yes (compatible)</span></td><td>${compatible}</td><td>${totalPairs > 0 ? ((compatible / totalPairs) * 100).toFixed(1) : 0}%</td></tr>
            <tr><td><span class="report-badge rpt-incompatible">No (incompatible)</span></td><td>${incompatible}</td><td>${totalPairs > 0 ? ((incompatible / totalPairs) * 100).toFixed(1) : 0}%</td></tr>
        </tbody></table>`;

        // List incompatible pairs
        const ccmEntries = Object.entries(state.ccm).filter(([_, v]) => !v.compatible);
        if (ccmEntries.length > 0) {
            html += `<h3>Incompatible Pairs</h3>`;
            html += '<table><thead><tr><th>Factor 1</th><th>Factor 2</th><th>Notes</th></tr></thead><tbody>';
            ccmEntries.forEach(([key, val]) => {
                const [f1Id, f2Id] = key.split(':');
                const f1 = FARCore.getFactorById(f1Id);
                const f2 = FARCore.getFactorById(f2Id);
                html += `<tr>
                    <td>${f1Id}: ${esc(f1?.label)}</td>
                    <td>${f2Id}: ${esc(f2?.label)}</td>
                    <td>${esc(val.note) || '<em>No notes</em>'}</td>
                </tr>`;
            });
            html += '</tbody></table>';
        }

        // Filter 1 results
        const pct = filter1.total > 0 ? ((filter1.surviving.length / filter1.total) * 100).toFixed(1) : 0;
        html += `<h3>Filter 1 Results</h3>`;
        html += `<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>
            <tr><td>Total configurations</td><td>${filter1.total.toLocaleString()}</td></tr>
            <tr><td>Eliminated (incompatible pairs)</td><td>${filter1.eliminated.toLocaleString()}</td></tr>
            <tr><td>Surviving</td><td><strong>${filter1.surviving.length.toLocaleString()}${filter1.capped ? '+' : ''}</strong></td></tr>
            <tr><td>Survival rate</td><td>${pct}%</td></tr>
        </tbody></table>`;

        // ---- 5. Filter 2: Holistic Assessment ----
        html += `<h2>5. Filter 2 &mdash; Holistic Wholeness Assessment</h2>`;
        const filter2Rejects = filter1.surviving.filter(c => !FARCore.getFilter2Entry(c).pass);
        html += `<p>Each Filter 1 survivor was assessed holistically: <em>"Does this entire configuration, taken as a whole, represent a coherent picture of a possible future world?"</em></p>`;
        html += `<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>
            <tr><td>Filter 1 survivors reviewed</td><td>${filter1.surviving.length}</td></tr>
            <tr><td>Rejected (Filter 2)</td><td>${filter2Rejects.length}</td></tr>
            <tr><td>Reintroduced configurations</td><td>${state.reintroducedConfigs.length}</td></tr>
            <tr><td>Final survivors</td><td><strong>${finalSurvivors.length}</strong></td></tr>
        </tbody></table>`;

        if (filter2Rejects.length > 0) {
            html += '<h3>Rejected by Filter 2</h3>';
            html += '<table><thead><tr><th>Configuration</th><th>Reason</th></tr></thead><tbody>';
            filter2Rejects.slice(0, 20).forEach(config => {
                const entry = FARCore.getFilter2Entry(config);
                html += `<tr><td>${FARCore.configKey(config)}</td><td>${esc(entry.note) || '<em>No reason given</em>'}</td></tr>`;
            });
            html += '</tbody></table>';
        }

        // CCM Heatmap
        const allFactors = FARCore.getAllFactors();
        if (allFactors.length > 0) {
            html += `<h3>Cross-Consistency Matrix</h3>`;
            html += '<div style="overflow-x:auto;margin-bottom:16px;">';
            html += '<table class="ccm-heatmap"><thead><tr><th></th>';
            allFactors.forEach(f => {
                html += `<th title="${esc(f.label)}">${f.id}</th>`;
            });
            html += '</tr></thead><tbody>';
            allFactors.forEach((rowF, ri) => {
                html += `<tr><th title="${esc(rowF.label)}">${rowF.id}</th>`;
                allFactors.forEach((colF, ci) => {
                    if (ri === ci) {
                        html += '<td class="ccm-heat-self"></td>';
                    } else if (rowF.sectorLetter === colF.sectorLetter) {
                        html += '<td class="ccm-heat-same"></td>';
                    } else {
                        const entry = FARCore.getCCMEntry(rowF.id, colF.id);
                        const assessed = state.ccm[FARCore.pairKey(rowF.id, colF.id)];
                        if (!assessed) {
                            html += '<td class="ccm-heat-none"></td>';
                        } else if (entry.compatible) {
                            html += `<td class="ccm-heat-yes" title="${esc(rowF.id + ' \u00d7 ' + colF.id + ': ' + (entry.note || 'Compatible'))}"></td>`;
                        } else {
                            html += `<td class="ccm-heat-no" title="${esc(rowF.id + ' \u00d7 ' + colF.id + ': ' + (entry.note || 'Incompatible'))}"></td>`;
                        }
                    }
                });
                html += '</tr>';
            });
            html += '</tbody></table></div>';

            // Sector legend for heatmap
            html += '<p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">';
            state.sectors.forEach(s => {
                html += `<strong>${s.letter}</strong>: ${esc(s.name)} &nbsp; `;
            });
            html += '</p>';
        }

        // ---- 6. Scenario Lines & Scenario Tree ----
        html += `<h2>6. Scenario Composition &amp; Scenario Tree</h2>`;
        if (state.scenarioLines.length === 0) {
            html += '<p><em>No scenario lines defined.</em></p>';
        } else {
            html += `<p>${state.scenarioLines.length} scenario lines were composed. Each line represents a temporal sequence of configurations arranged on the Scenario Tree &mdash; a branching timeline diagram flowing from earliest period (bottom) to latest (top). Nodes are annotated with <strong>Commitment</strong> (how much this future narrows possibilities) and <strong>Freedom</strong> (how diverse and unconstrained it is).</p>`;

            // Render the Scenario Tree diagram inline
            html += `<div id="report-scenario-tree" class="tree-canvas" style="margin:16px 0 24px;min-height:300px;position:relative;"></div>`;

            state.scenarioLines.forEach((line, li) => {
                html += `<div class="cluster-report-block" style="border-left-color:${line.color}">
                    <h3 style="margin-top:0;border-left:3px solid ${line.color};padding-left:10px;">
                        Scenario Line ${li + 1}: ${esc(line.name)}
                    </h3>
                    ${line.description ? `<p>${esc(line.description)}</p>` : ''}
                `;

                const configs = line.configs || [];
                if (configs.length > 0) {
                    html += '<table><thead><tr><th>Period</th><th>Configuration</th><th>Commitment</th><th>Freedom</th></tr></thead><tbody>';
                    configs.forEach(cfg => {
                        html += `<tr>
                            <td>${esc(cfg.periodLabel) || '?'}</td>
                            <td>${esc(cfg.configKey)}</td>
                            <td>${cfg.commitment || 5}/10</td>
                            <td>${cfg.freedom || 5}/10</td>
                        </tr>`;
                    });
                    html += '</tbody></table>';
                }

                if (line.narrative && line.narrative.trim()) {
                    html += `<h4 style="margin-top:12px;margin-bottom:4px;">Narrative</h4>`;
                    html += `<div class="narrative-text">${esc(line.narrative)}</div>`;
                }

                html += '</div>';
            });
        }

        // ---- 7. Warning Indicators ----
        if (state.project.collectWarningIndicators) {
            let hasIndicators = false;
            state.scenarioLines.forEach(line => {
                (line.configs || []).forEach(cfg => {
                    if (cfg.warningIndicator && cfg.warningIndicator.trim()) hasIndicators = true;
                });
            });
            if (hasIndicators) {
                html += `<h2>7. Warning Indicators</h2>`;
                html += `<p>Warning indicators identify the events, trends, or signals that cause transitions between successive configurations in each scenario line.</p>`;
                state.scenarioLines.forEach((line, li) => {
                    const configs = line.configs || [];
                    const lineHasIndicators = configs.some(cfg => cfg.warningIndicator && cfg.warningIndicator.trim());
                    if (!lineHasIndicators) return;
                    html += `<h3 style="border-left:3px solid ${line.color};padding-left:10px;">${esc(line.name)}</h3>`;
                    html += '<table><thead><tr><th>From</th><th>To</th><th>Warning Indicator</th></tr></thead><tbody>';
                    configs.forEach((cfg, ci) => {
                        if (ci < configs.length - 1 && cfg.warningIndicator && cfg.warningIndicator.trim()) {
                            const next = configs[ci + 1];
                            html += `<tr>
                                <td>${esc(cfg.periodLabel || '?')} &mdash; ${esc(cfg.configKey)}</td>
                                <td>${esc(next.periodLabel || '?')} &mdash; ${esc(next.configKey)}</td>
                                <td>${esc(cfg.warningIndicator)}</td>
                            </tr>`;
                        }
                    });
                    html += '</tbody></table>';
                });
            }
        }

        // ---- Appendix: Filter Decision Log ----
        if (state.filterLog && state.filterLog.length > 0) {
            html += `<h2>Appendix: Filter Decision Log</h2>`;
            html += `<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px">Complete log of all automated filtering decisions (${state.filterLog.length} entries). Each entry shows the configuration or pair identifier, the decision made, and the reasoning.</p>`;
            html += '<table style="font-size:0.75rem"><thead><tr><th>Time</th><th>Action</th><th>Configuration / Pair</th><th>Decision</th><th>Reasoning</th></tr></thead><tbody>';
            state.filterLog.forEach(entry => {
                const time = entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
                const actionLabels = {
                    'filter2': 'Holistic Filter',
                    'filter2-assisted': 'Holistic Filter (re-run)',
                    'filter2-combined': 'Holistic Filter (combined)',
                    'adaptive-refilter': 'Adaptive Re-filter',
                    'adaptive-relax-ccm': 'Adaptive Relax (CCM)',
                    'adaptive-relax-filter2': 'Adaptive Relax (Filter 2)',
                };
                const actionLabel = actionLabels[entry.action] || entry.action;
                const decisionClass = entry.decision === 'KEEP' || entry.decision === 'PASS' || entry.decision === 'RELAX'
                    ? 'rpt-compatible' : 'rpt-incompatible';
                html += `<tr>
                    <td style="white-space:nowrap">${time}</td>
                    <td>${esc(actionLabel)}</td>
                    <td><code>${esc(entry.configKey)}</code></td>
                    <td><span class="report-badge ${decisionClass}">${esc(entry.decision)}</span></td>
                    <td>${esc(entry.note) || '<em>—</em>'}</td>
                </tr>`;
            });
            html += '</tbody></table>';
        }

        // ---- Footer ----
        html += `<hr style="margin:32px 0;border:none;border-top:1px solid #ddd">`;
        html += `<p style="text-align:center;color:#999;font-size:0.75rem;">
            Generated by the FAR Analysis Tool &mdash; Field Anomaly Relaxation methodology (Rhyne, 1971, 1995)<br>
            ${dateStr}
        </p>`;

        container.innerHTML = html;

        // Render the Scenario Tree into the report container
        const reportTreeEl = document.getElementById('report-scenario-tree');
        if (reportTreeEl) {
            FARTree.renderTree(reportTreeEl);
        }
    };

    const exportPDF = () => {
        const element = document.getElementById('report-content');
        if (!element || !element.innerHTML.trim()) {
            alert('Generate the report first by navigating to the Report step.');
            return;
        }

        // Open report in a new window styled for print, then trigger browser print dialog
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Pop-up blocked. Please allow pop-ups for this site and try again.');
            return;
        }

        // Collect styles from the current page
        const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
            .map(el => el.outerHTML).join('\n');

        printWindow.document.write(`<!DOCTYPE html>
<html><head>
<title>${FARUI.escHtml(FARCore.getState().project.name || 'FAR Report')}</title>
${styles}
<style>
    body {
        max-width: 780px;
        margin: 0 auto;
        padding: 32px 24px;
        font-family: 'DM Sans', system-ui, sans-serif;
        font-size: 10.5pt;
        line-height: 1.6;
        color: #1a1a1a;
    }

    /* Title page feel */
    h1 {
        font-family: 'Outfit', system-ui, sans-serif;
        font-size: 22pt;
        font-weight: 700;
        color: #1a3a2a;
        margin-top: 48px;
        margin-bottom: 4px;
        letter-spacing: -0.5px;
    }
    .report-subtitle {
        font-size: 11pt;
        color: #555;
        margin-top: 4px;
        margin-bottom: 2px;
    }
    .report-date {
        font-size: 9pt;
        color: #999;
        margin-top: 8px;
        margin-bottom: 32px;
        padding-bottom: 20px;
        border-bottom: 2px solid #1a5f4a;
    }

    /* Section headers */
    h2 {
        font-family: 'Outfit', system-ui, sans-serif;
        font-size: 15pt;
        font-weight: 600;
        color: #1a3a2a;
        margin-top: 36px;
        margin-bottom: 12px;
        padding-bottom: 6px;
        border-bottom: 1px solid #d0e0d8;
        page-break-after: avoid;
    }
    h3 {
        font-family: 'Outfit', system-ui, sans-serif;
        font-size: 12pt;
        font-weight: 600;
        color: #2a4a3a;
        margin-top: 24px;
        margin-bottom: 8px;
        page-break-after: avoid;
    }
    h4 {
        font-size: 10.5pt;
        font-weight: 600;
        color: #333;
        margin-top: 16px;
        margin-bottom: 6px;
    }

    /* Body text */
    p { margin-top: 0; margin-bottom: 10px; }
    blockquote {
        border-left: 3px solid #1a5f4a;
        padding: 8px 16px;
        margin: 12px 0;
        color: #444;
        font-style: italic;
        background: #f8faf9;
    }

    /* Tables */
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 9.5pt;
        margin: 12px 0 16px;
    }
    th, td {
        border: 1px solid #d0d8d4;
        padding: 6px 10px;
        text-align: left;
    }
    th {
        background: #f0f4f3;
        font-weight: 600;
        color: #1a3a2a;
        font-size: 9pt;
    }
    tr:nth-child(even) td { background: #fafcfb; }

    /* Badges */
    .report-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 8.5pt;
        font-weight: 600;
    }
    .report-badge.rpt-compatible { background: #e6f9ee; color: #1a8a4a; }
    .report-badge.rpt-incompatible { background: #fde8e8; color: #c53030; }

    /* Scenario blocks */
    .cluster-report-block {
        background: #f8faf9;
        border: 1px solid #e0e8e4;
        border-radius: 6px;
        padding: 16px 20px;
        margin: 16px 0;
        page-break-inside: avoid;
    }
    .cluster-report-block h3 {
        margin-top: 0;
        border-bottom: none;
        padding-bottom: 0;
    }

    /* Narrative text */
    .narrative-text {
        white-space: pre-wrap;
        line-height: 1.65;
        color: #333;
    }

    /* CCM Heatmap */
    .ccm-heatmap td { width: 18px; height: 18px; min-width: 18px; padding: 0; }
    .ccm-heatmap th { font-size: 7.5pt; padding: 2px 4px; }

    /* Tree */
    .tree-canvas {
        break-inside: avoid;
        margin: 16px 0;
        border: 1px solid #e0e8e4;
        border-radius: 6px;
        background: #f8faf9;
    }
    .tree-zoom-controls, .tree-detail-panel, .tree-tooltip { display: none !important; }

    /* Filter log */
    .appendix-table td, .appendix-table th { font-size: 8.5pt; padding: 4px 6px; }

    @media print {
        body { padding: 0; margin: 0 auto; }
        h1 { margin-top: 24px; }
        .tree-canvas { overflow: visible; height: auto !important; }
        .tree-canvas svg { position: static !important; width: 100% !important; height: auto !important; }
    }
</style>
</head><body>
${element.innerHTML}
</body></html>`);
        printWindow.document.close();

        // Re-render the scenario tree in the print window
        printWindow.onload = () => {
            const treeEl = printWindow.document.getElementById('report-scenario-tree');
            if (treeEl) {
                try { FARTree.renderTree(treeEl); } catch { /* skip if tree fails */ }
                // Remove zoom controls from print
                const zoom = treeEl.querySelector('.tree-zoom-controls');
                if (zoom) zoom.remove();
            }
            // Short delay to let images/fonts load, then print
            setTimeout(() => {
                printWindow.print();
            }, 500);
        };
    };

    return { generateReport, exportPDF };
})();
