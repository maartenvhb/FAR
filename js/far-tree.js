/* ============================================================
   FAR Tree - Scenario Tree as Branching Timeline Diagram (Step 4)
   Time flows bottom-to-top: earliest period at bottom, latest
   at top.  Nodes are rectangular boxes showing scenario name
   and config key.  Edges show plausible transitions colored by
   scenario line, with warning-indicator "X" markers.
   Per Rhyne's FAR methodology (1995).
   ============================================================ */

const FARTree = (() => {
    const PAD_TOP = 30;
    const PAD_BOTTOM = 60;
    const PAD_LEFT = 60;
    const PAD_RIGHT = 20;
    const ARROW_SIZE = 6;
    const NODE_PAD_X = 6;
    const NODE_PAD_Y = 4;
    const NODE_LINE_HEIGHT = 13;
    const NODE_GAP_X = 16;
    const NODE_CORNER = 5;
    const FONT = 'DM Sans, system-ui, sans-serif';
    const FONT_DISPLAY = 'Outfit, system-ui, sans-serif';

    /* ---- helpers ---- */
    const svgEl = (tag, attrs) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
        return el;
    };

    const abbreviate = (str, max) =>
        str.length > max ? str.substring(0, max - 1) + '\u2026' : str;

    const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const lightenColor = (hex, amount) => {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const r = Math.min(255, parseInt(hex.substring(0, 2), 16) + amount);
        const g = Math.min(255, parseInt(hex.substring(2, 4), 16) + amount);
        const b = Math.min(255, parseInt(hex.substring(4, 6), 16) + amount);
        return `rgb(${r},${g},${b})`;
    };

    /** Measure text width using a hidden canvas */
    let measureCtx = null;
    const measureText = (text, fontSize, fontFamily) => {
        if (!measureCtx) {
            const c = document.createElement('canvas');
            measureCtx = c.getContext('2d');
        }
        measureCtx.font = `${fontSize}px ${fontFamily}`;
        return measureCtx.measureText(text).width;
    };

    /** Resolve factor list for a config key */
    const resolveFactors = (configKey) => {
        return configKey.split('-').map(fId => {
            const f = FARCore.getFactorById(fId);
            return f ? { id: f.id, label: f.label, description: f.description,
                         sectorLetter: f.sectorLetter, sectorName: f.sectorName }
                     : { id: fId, label: '?', description: '', sectorLetter: '?', sectorName: '?' };
        });
    };

    /* ---- tooltip ---- */
    let tooltipEl = null;

    const ensureTooltip = (canvas) => {
        tooltipEl = canvas.querySelector('.tree-tooltip');
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.className = 'tree-tooltip';
            canvas.appendChild(tooltipEl);
        }
        tooltipEl.style.display = 'none';
        return tooltipEl;
    };

    const hideTooltip = () => {
        if (tooltipEl) tooltipEl.style.display = 'none';
    };

    /** Show a small hover tooltip for edge markers (warnings/triggers) */
    const showEdgeTooltip = (html, mouseX, mouseY, canvas) => {
        if (!tooltipEl) return;
        tooltipEl.innerHTML = html;
        tooltipEl.className = 'tree-tooltip';
        tooltipEl.style.display = 'block';
        tooltipEl.style.maxHeight = '';
        tooltipEl.style.overflowY = '';
        const canvasRect = canvas.getBoundingClientRect();
        const tipW = tooltipEl.offsetWidth;
        const tipH = tooltipEl.offsetHeight;
        let left = mouseX + 16;
        let top = mouseY - tipH / 2;
        if (left + tipW > canvasRect.width - 8) left = mouseX - tipW - 16;
        if (top < 4) top = 4;
        if (top + tipH > canvasRect.height - 4) top = canvasRect.height - tipH - 4;
        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = top + 'px';
    };

    /** Show a click-to-open detail panel for nodes — scrollable, with close button */
    const showDetailPanel = (node, state, canvas) => {
        // Remove any existing panel
        const existing = canvas.querySelector('.tree-detail-panel');
        if (existing) existing.remove();
        hideTooltip();

        const factors = resolveFactors(node.configKey);
        const scenarioNames = node.lines
            .map(li => (state.scenarioLines[li] || {}).name || 'Unnamed').join(', ');

        let html = `<button class="tree-detail-close">&times;</button>`;
        html += `<div class="tree-detail-body">`;
        html += `<div class="tree-tooltip-header">${esc(node.configKey)}</div>`;
        html += `<div class="tree-tooltip-meta">Period: ${esc(node.period)} &nbsp;|&nbsp; F:${node.commitment}/10 &nbsp; O:${node.freedom}/10</div>`;
        html += `<div class="tree-tooltip-meta">Scenarios: ${esc(scenarioNames)}</div>`;
        if (node.warningIndicator) {
            html += `<div class="tree-tooltip-meta" style="color:#2563eb">Trigger: ${esc(node.warningIndicator)}</div>`;
        }
        html += '<div class="tree-tooltip-factors">';
        factors.forEach(f => {
            html += `<div class="tree-tooltip-factor">`;
            html += `<span class="tree-tooltip-sector">${esc(f.sectorLetter)}: ${esc(f.sectorName)}</span>`;
            html += `<span class="tree-tooltip-flabel">${esc(f.id)} &mdash; ${esc(f.label)}</span>`;
            if (f.description) html += `<span class="tree-tooltip-fdesc">${esc(f.description)}</span>`;
            html += `</div>`;
        });
        html += '</div></div>';

        const panel = document.createElement('div');
        panel.className = 'tree-detail-panel';
        panel.innerHTML = html;
        canvas.appendChild(panel);

        panel.querySelector('.tree-detail-close').addEventListener('click', (e) => {
            e.stopPropagation();
            panel.remove();
        });
    };

    const closeDetailPanel = (canvas) => {
        const panel = canvas.querySelector('.tree-detail-panel');
        if (panel) panel.remove();
    };

    /* ---- zoom controls ---- */
    const addZoomControls = (canvas, svg, contentW, contentH) => {
        // Remove old controls if re-rendering
        const old = canvas.querySelector('.tree-zoom-controls');
        if (old) old.remove();

        let scale = 1;
        const containerW = canvas.clientWidth;
        const initialFitScale = Math.min(1, containerW / contentW);
        scale = initialFitScale;

        const applyZoom = () => {
            const vw = contentW / scale;
            const vh = contentH / scale;
            // Keep centered
            const ox = (contentW - vw) / 2;
            const oy = (contentH - vh) / 2;
            svg.setAttribute('viewBox', `${ox} ${oy} ${vw} ${vh}`);
        };

        // Start at fit-to-width
        applyZoom();

        const controls = document.createElement('div');
        controls.className = 'tree-zoom-controls';
        controls.innerHTML = `
            <button class="tree-zoom-btn" data-action="in" title="Zoom in">+</button>
            <button class="tree-zoom-btn" data-action="out" title="Zoom out">&minus;</button>
            <button class="tree-zoom-btn" data-action="fit" title="Fit to view">&#8596;</button>
        `;
        canvas.appendChild(controls);

        controls.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action === 'in') scale = Math.min(3, scale * 1.25);
            else if (action === 'out') scale = Math.max(0.2, scale / 1.25);
            else if (action === 'fit') scale = initialFitScale;
            applyZoom();
        });

        canvas.addEventListener('wheel', (e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const delta = e.deltaY > 0 ? 1 / 1.1 : 1.1;
            scale = Math.max(0.2, Math.min(3, scale * delta));
            applyZoom();
        }, { passive: false });
    };

    /* ---- main render ---- */
    const renderTree = (targetElement) => {
        const state = FARCore.getState();
        const canvas = targetElement || document.getElementById('scenario-tree-canvas');
        if (!canvas) return;

        const scenarioLines = state.scenarioLines || [];

        const hasNodes = scenarioLines.some(l => (l.configs || []).length > 0);
        if (!hasNodes) {
            canvas.innerHTML = '<div class="tree-empty-msg">Add configurations to scenario lines to see the Scenario Tree.</div>';
            canvas.style.height = '300px';
            return;
        }

        /* 1. Build a universal timeline from all period labels */
        const cleanPeriod = (p) => (p || '?').trim().replace(/[\.\,\s]+$/, '').replace(/\s+/g, ' ');

        /** Extract a representative year (midpoint for ranges) */
        const parseYear = (s) => {
            const lower = s.toLowerCase();
            if (lower.includes('present') || lower.includes('now') || lower.includes('current') || lower.includes('today')) return 0;
            if (lower.includes('short')) return 1;
            if (lower.includes('medium') || lower.includes('mid')) return 2;
            if (lower.includes('long')) return 3;
            const rangeMatch = s.match(/\b((?:19|20)\d{2})\s*[-–—to]+\s*((?:19|20)\d{2})\b/);
            if (rangeMatch) return (parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2;
            const singleMatch = s.match(/\b((?:19|20)\d{2})\b/);
            if (singleMatch) return parseInt(singleMatch[1]);
            return 9999;
        };

        // Collect all raw periods with their representative years
        const rawPeriods = [];
        let hasPresent = false;
        let minYear = Infinity;
        let maxYear = -Infinity;
        scenarioLines.forEach(line => {
            (line.configs || []).forEach(cfg => {
                const raw = cleanPeriod(cfg.periodLabel);
                const yr = parseYear(raw);
                rawPeriods.push({ raw, yr });
                if (yr === 0) hasPresent = true;
                if (yr > 3 && yr < 9999) {
                    if (yr < minYear) minYear = yr;
                    if (yr > maxYear) maxYear = yr;
                }
            });
        });

        // Determine the number of non-present time steps needed
        const distinctYears = new Set(rawPeriods.filter(p => p.yr > 3 && p.yr < 9999).map(p => p.yr));
        const numBands = Math.max(2, Math.min(distinctYears.size, 6));

        // Create evenly spaced universal time bands from minYear to maxYear
        const bands = [];
        if (hasPresent) bands.push({ label: 'Present', year: 0 });

        if (minYear <= maxYear) {
            const span = maxYear - minYear;
            const bandWidth = Math.max(1, Math.ceil(span / numBands));
            // Round band edges to nice intervals (multiples of bandWidth)
            const roundedStart = Math.floor(minYear / bandWidth) * bandWidth;
            for (let i = 0; i < numBands; i++) {
                const start = roundedStart + i * bandWidth;
                const end = start + bandWidth;
                const mid = (start + end) / 2;
                bands.push({ label: `${start}\u2013${end}`, year: mid });
            }
        }

        // Map each raw period to the nearest universal band
        const mapPeriod = (p) => {
            const raw = cleanPeriod(p);
            const yr = parseYear(raw);
            if (yr === 0 && hasPresent) return 'Present';
            if (yr <= 3 || yr >= 9999) return raw; // non-year labels pass through
            // Find nearest band (excluding Present)
            let bestBand = bands[bands.length - 1];
            let bestDist = Infinity;
            bands.forEach(b => {
                if (b.year === 0) return; // skip Present
                const dist = Math.abs(yr - b.year);
                if (dist < bestDist) { bestDist = dist; bestBand = b; }
            });
            return bestBand.label;
        };

        const periodOrder = bands.map(b => b.label);

        /* 2. Build node map — key by band|configKey */
        const nodeMap = new Map();
        scenarioLines.forEach((line, li) => {
            (line.configs || []).forEach(cfg => {
                const period = mapPeriod(cfg.periodLabel);
                const key = period + '|' + cfg.configKey;
                if (!nodeMap.has(key)) {
                    nodeMap.set(key, {
                        period,
                        configKey: cfg.configKey,
                        commitment: cfg.commitment || 5,
                        freedom: cfg.freedom || 5,
                        warningIndicator: cfg.warningIndicator || '',
                        lines: [],
                        lineColors: [],
                        factors: resolveFactors(cfg.configKey),
                    });
                }
                const node = nodeMap.get(key);
                if (!node.lines.includes(li)) {
                    node.lines.push(li);
                    node.lineColors.push(line.color || '#1a5f4a');
                }
            });
        });

        /* 3. Identify terminal nodes */
        const terminalNodes = new Set();
        scenarioLines.forEach(line => {
            const cfgs = line.configs || [];
            if (cfgs.length > 0) {
                const last = cfgs[cfgs.length - 1];
                const key = mapPeriod(last.periodLabel) + '|' + last.configKey;
                terminalNodes.add(key);
            }
        });

        /* 4. Compute tight box sizes per node */
        const FONT_SIZE_NAME = 9;
        const FONT_SIZE_KEY = 8;
        const singleLineH = NODE_PAD_Y * 2 + NODE_LINE_HEIGHT;
        const twoLineH = NODE_PAD_Y * 2 + NODE_LINE_HEIGHT * 2 + 2;

        nodeMap.forEach(node => {
            const nk = node.period + '|' + node.configKey;
            const isTerminal = terminalNodes.has(nk);
            const keyW = measureText(node.configKey, FONT_SIZE_KEY, FONT);

            if (isTerminal) {
                const scenarioNames = node.lines
                    .map(li => (scenarioLines[li] || {}).name || 'Unnamed').join(', ');
                const nameW = measureText(scenarioNames, FONT_SIZE_NAME, FONT_DISPLAY);
                node._boxW = Math.max(60, Math.max(nameW, keyW) + NODE_PAD_X * 2 + 4);
                node._boxH = twoLineH;
            } else {
                node._boxW = Math.max(50, keyW + NODE_PAD_X * 2 + 4);
                node._boxH = singleLineH;
            }
        });

        /* 5. Group nodes by period row — earliest at bottom, latest at top */
        const rows = periodOrder.map(p => {
            const nodes = [];
            nodeMap.forEach(n => { if (n.period === p) nodes.push(n); });
            return { period: p, nodes };
        });
        rows.reverse();

        /* 6. Build edges */
        const edges = [];
        scenarioLines.forEach((line, li) => {
            const cfgs = line.configs || [];
            for (let ci = 0; ci < cfgs.length - 1; ci++) {
                const pFrom = mapPeriod(cfgs[ci].periodLabel);
                const pTo   = mapPeriod(cfgs[ci + 1].periodLabel);
                edges.push({
                    fromKey: pFrom + '|' + cfgs[ci].configKey,
                    toKey:   pTo   + '|' + cfgs[ci + 1].configKey,
                    lineIndex: li,
                    color: line.color || '#1a5f4a',
                    warningIndicator: cfgs[ci].warningIndicator || '',
                });
            }
        });

        /* 7. Compute layout — auto-size to content */
        const rowHeight = twoLineH + 28;
        let maxRowW = 0;
        rows.forEach(row => {
            const totalW = row.nodes.reduce((s, n) => s + n._boxW, 0) + Math.max(0, row.nodes.length - 1) * NODE_GAP_X;
            if (totalW > maxRowW) maxRowW = totalW;
        });

        const contentW = Math.max(400, PAD_LEFT + maxRowW + PAD_RIGHT);
        const contentH = Math.max(300, PAD_TOP + rows.length * rowHeight + PAD_BOTTOM);

        rows.forEach((row, ri) => {
            const cy = PAD_TOP + ri * rowHeight + rowHeight / 2;
            const totalW = row.nodes.reduce((s, n) => s + n._boxW, 0) + Math.max(0, row.nodes.length - 1) * NODE_GAP_X;
            let curX = PAD_LEFT + (contentW - PAD_LEFT - PAD_RIGHT - totalW) / 2;
            row.nodes.forEach(node => {
                node.cx = curX + node._boxW / 2;
                node.cy = cy;
                curX += node._boxW + NODE_GAP_X;
            });
        });

        /* 8. Render */
        canvas.innerHTML = '';
        canvas.style.height = Math.min(contentH, 600) + 'px';

        const svg = svgEl('svg', {
            width: '100%', height: '100%',
            viewBox: `0 0 ${contentW} ${contentH}`,
            preserveAspectRatio: 'xMidYMid meet',
        });
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        canvas.appendChild(svg);

        // Tooltip element
        ensureTooltip(canvas);

        // Click canvas background to close detail panel
        canvas.addEventListener('click', () => closeDetailPanel(canvas));

        // Defs: arrowheads
        const defs = svgEl('defs');
        const usedColors = new Set(edges.map(e => e.color));
        usedColors.forEach(color => {
            const marker = svgEl('marker', {
                id: 'arrow-' + color.replace('#', ''),
                markerWidth: ARROW_SIZE, markerHeight: ARROW_SIZE,
                refX: ARROW_SIZE, refY: ARROW_SIZE / 2,
                orient: 'auto', markerUnits: 'userSpaceOnUse',
            });
            marker.appendChild(svgEl('polygon', {
                points: `0,0 ${ARROW_SIZE},${ARROW_SIZE / 2} 0,${ARROW_SIZE}`,
                fill: color,
            }));
            defs.appendChild(marker);
        });
        svg.appendChild(defs);

        // (a) Period row labels + separators
        rows.forEach((row, ri) => {
            const cy = PAD_TOP + ri * rowHeight + rowHeight / 2;
            const label = svgEl('text', {
                x: 6, y: cy + 4,
                'text-anchor': 'start',
                fill: '#1a1a1a',
                'font-size': '10',
                'font-weight': '600',
                'font-family': FONT_DISPLAY,
            });
            label.textContent = row.period;
            svg.appendChild(label);

            if (ri > 0) {
                const sepY = PAD_TOP + ri * rowHeight;
                svg.appendChild(svgEl('line', {
                    x1: PAD_LEFT - 10, y1: sepY,
                    x2: contentW - PAD_RIGHT + 10, y2: sepY,
                    stroke: '#d0e0d8', 'stroke-width': '1',
                    'stroke-dasharray': '4,4',
                }));
            }
        });

        // (b) Edges
        const edgeGroups = new Map();
        edges.forEach(e => {
            const gk = e.fromKey + '>' + e.toKey;
            if (!edgeGroups.has(gk)) edgeGroups.set(gk, []);
            edgeGroups.get(gk).push(e);
        });

        const edgeMarkers = [];
        edgeGroups.forEach(group => {
            // Use the first edge for geometry; pick color from first line
            const e = group[0];
            const fromNode = nodeMap.get(e.fromKey);
            const toNode = nodeMap.get(e.toKey);
            if (!fromNode || !toNode) return;

            // If shared by multiple lines, use grey; otherwise use the line's color
            const color = group.length > 1 ? '#555' : e.color;

            const x1 = fromNode.cx;
            const y1 = fromNode.cy - fromNode._boxH / 2;
            const x2 = toNode.cx;
            const y2 = toNode.cy + toNode._boxH / 2 + ARROW_SIZE;

            const cy1 = y1 + (y2 - y1) * 0.4;
            const cy2 = y2 - (y2 - y1) * 0.4;
            svg.appendChild(svgEl('path', {
                d: `M${x1},${y1} C${x1},${cy1} ${x2},${cy2} ${x2},${y2}`,
                stroke: color,
                'stroke-width': group.length > 1 ? '2.5' : '2',
                fill: 'none',
                opacity: '0.75',
                'marker-end': `url(#arrow-${color.replace('#', '')})`,
            }));

            // Collect unique warning indicators from all edges in this group
            const mx = 0.125 * x1 + 0.375 * x1 + 0.375 * x2 + 0.125 * x2;
            const my = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;

            const warnings = [];
            group.forEach(ge => {
                if (ge.warningIndicator && !warnings.includes(ge.warningIndicator)) {
                    warnings.push(ge.warningIndicator);
                }
            });
            if (warnings.length > 0) {
                edgeMarkers.push({ mx, my, text: warnings.join(' | '), type: 'warning' });
            }
        });

        // Render edge markers
        edgeMarkers.forEach(({ mx, my, text, type }) => {
            const g = svgEl('g', { style: 'cursor:pointer' });
            const isWarning = type === 'warning';
            g.appendChild(svgEl('circle', {
                cx: mx, cy: my, r: 7,
                fill: isWarning ? '#e74c3c' : '#3498db',
                stroke: '#fff', 'stroke-width': '1.5',
            }));
            const label = svgEl('text', {
                x: mx, y: my + 3.5,
                'text-anchor': 'middle',
                fill: '#fff',
                'font-size': '10',
                'font-weight': '700',
                'font-family': FONT,
            });
            label.textContent = isWarning ? 'X' : '\u2192';
            g.appendChild(label);

            const tipHandler = (evt) => {
                const canvasRect = canvas.getBoundingClientRect();
                const tipX = evt.clientX - canvasRect.left;
                const tipY = evt.clientY - canvasRect.top;
                const tipHtml = isWarning
                    ? `<div class="tree-tooltip-header" style="color:#c0392b">\u26a0 Warning Indicator</div><div class="tree-tooltip-meta">${esc(text)}</div>`
                    : `<div class="tree-tooltip-header" style="color:#2563eb">\u2192 Transition Trigger</div><div class="tree-tooltip-meta">${esc(text)}</div>`;
                showEdgeTooltip(tipHtml, tipX, tipY, canvas);
            };
            g.addEventListener('mouseenter', tipHandler);
            g.addEventListener('mousemove', tipHandler);
            g.addEventListener('mouseleave', hideTooltip);
            svg.appendChild(g);
        });

        // (c) Nodes
        nodeMap.forEach(node => {
            const { cx, cy, configKey, lineColors, lines } = node;
            const isShared = lines.length > 1;
            const bw = node._boxW;
            const bh = node._boxH;
            const rx = cx - bw / 2;
            const ry = cy - bh / 2;

            const strokeColor = isShared ? '#555' : lineColors[0];
            const fillColor = isShared ? '#f7faf9' : lightenColor(lineColors[0], 200);

            const rect = svgEl('rect', {
                x: rx, y: ry, width: bw, height: bh,
                rx: NODE_CORNER, ry: NODE_CORNER,
                fill: fillColor,
                stroke: strokeColor,
                'stroke-width': isShared ? '2' : '1.2',
            });
            rect.style.cursor = 'pointer';
            svg.appendChild(rect);

            // Shared-node colored dots
            if (isShared) {
                const dotSpacing = Math.min(14, (bw - 16) / lineColors.length);
                const dotStartX = cx - (lineColors.length - 1) * dotSpacing / 2;
                lineColors.forEach((color, ci) => {
                    svg.appendChild(svgEl('circle', {
                        cx: dotStartX + ci * dotSpacing, cy: ry - 4, r: 3.5,
                        fill: color, stroke: '#fff', 'stroke-width': '1',
                    }));
                });
            }

            const nodeKey = node.period + '|' + configKey;
            const isTerminal = terminalNodes.has(nodeKey);
            const maxCharsKey = Math.floor((bw - NODE_PAD_X * 2) / 5);
            const maxCharsName = Math.floor((bw - NODE_PAD_X * 2) / 5.2);

            if (isTerminal) {
                const scenarioNames = lines
                    .map(li => (scenarioLines[li] || {}).name || 'Unnamed').join(', ');
                const nameText = svgEl('text', {
                    x: cx, y: ry + NODE_PAD_Y + 10,
                    'text-anchor': 'middle',
                    fill: '#1a1a1a',
                    'font-size': String(FONT_SIZE_NAME),
                    'font-weight': '600',
                    'font-family': FONT_DISPLAY,
                    'pointer-events': 'none',
                });
                nameText.textContent = abbreviate(scenarioNames, maxCharsName);
                svg.appendChild(nameText);

                const keyText = svgEl('text', {
                    x: cx, y: ry + NODE_PAD_Y + 10 + NODE_LINE_HEIGHT,
                    'text-anchor': 'middle',
                    fill: '#555',
                    'font-size': String(FONT_SIZE_KEY),
                    'font-family': FONT,
                    'pointer-events': 'none',
                });
                keyText.textContent = abbreviate(configKey, maxCharsKey);
                svg.appendChild(keyText);
            } else {
                const keyText = svgEl('text', {
                    x: cx, y: cy + 3,
                    'text-anchor': 'middle',
                    fill: '#555',
                    'font-size': String(FONT_SIZE_KEY),
                    'font-family': FONT,
                    'pointer-events': 'none',
                });
                keyText.textContent = abbreviate(configKey, maxCharsKey);
                svg.appendChild(keyText);
            }

            // Click to open detail panel
            rect.addEventListener('click', (evt) => {
                evt.stopPropagation();
                showDetailPanel(node, state, canvas);
            });
        });

        // (d) Legend
        drawLegend(svg, contentW, contentH, scenarioLines);

        // (e) Zoom controls
        addZoomControls(canvas, svg, contentW, contentH);
    };

    /* ---- Legend ---- */
    const drawLegend = (svg, width, height, scenarioLines) => {
        if (scenarioLines.length === 0) return;
        const legendX = PAD_LEFT + 10;
        const legendY = height - PAD_BOTTOM + 14;

        let maxLabelLen = 0;
        scenarioLines.forEach(l => {
            const len = (l.name || 'Unnamed').length;
            if (len > maxLabelLen) maxLabelLen = len;
        });
        const itemW = Math.max(100, maxLabelLen * 5.5 + 20);

        const maxPerRow = Math.max(1, Math.floor((width - PAD_LEFT - PAD_RIGHT) / itemW));
        const rows = Math.ceil(scenarioLines.length / maxPerRow);

        const bgWidth = Math.min(width - PAD_LEFT - PAD_RIGHT, Math.min(scenarioLines.length, maxPerRow) * itemW + 16);
        const bgHeight = rows * 18 + 8;
        svg.appendChild(svgEl('rect', {
            x: legendX - 6, y: legendY - 5,
            width: bgWidth, height: bgHeight,
            rx: '5', fill: '#fff', 'fill-opacity': '0.92',
            stroke: '#e0e0e0',
        }));

        scenarioLines.forEach((line, i) => {
            const row = Math.floor(i / maxPerRow);
            const col = i % maxPerRow;
            const itemX = legendX + col * itemW;
            const itemY = legendY + row * 18;
            svg.appendChild(svgEl('circle', {
                cx: itemX, cy: itemY + 6, r: 4,
                fill: line.color || '#1a5f4a',
            }));
            const text = svgEl('text', {
                x: itemX + 9, y: itemY + 10,
                fill: '#1a1a1a',
                'font-size': '9',
                'font-family': FONT,
            });
            text.textContent = abbreviate(line.name || 'Unnamed', 35);
            svg.appendChild(text);
        });
    };

    return { renderTree };
})();
