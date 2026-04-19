/* ============================================================
   FAR Core — Data Model & Computation Engine
   Aligned with Rhyne's FAR Methodology (1995)
   "Field Anomaly Relaxation — The arts of usage"
   ============================================================ */

const FARCore = (() => {
    const SECTOR_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    const createDefaultState = () => ({
        project: {
            name: '',
            description: '',
            horizon: '',
            collectWarningIndicators: false,
            createdAt: new Date().toISOString(),
        },
        // Step 1: Initial View
        initialView: '',
        fieldBoundaries: '',
        keyUncertainties: '',
        // Step 2: Sectors & Factors
        acronym: '',
        sectors: [],       // [{id, letter, name, description, factors: [{id, label, description, mapX, mapY}]}]
        // Step 3: Filter 1 (CCM) — Yes/No pair assessment
        ccm: {},           // { "A1:B2": { compatible: true|false, note: "" } }
        // Step 3: Filter 2 — Holistic wholeness assessment
        filter2: {},       // { "A1-B2-C3": { pass: true|false, note: "" } }
        // Step 4: Scenario Composition
        scenarioLines: [], // [{id, name, description, color, configs: [{configKey, periodLabel, commitment, freedom}], narrative}]
        tree: {
            periods: ['Present'],
        },
        reintroducedConfigs: [], // config keys brought back after rejection
        filterLog: [], // [{timestamp, action, configKey, decision, note}]
    });

    let state = createDefaultState();

    // ---- State access ----
    const getState = () => state;
    const setState = (newState) => { state = newState; invalidateFilter1Cache(); };

    // ---- Sector / Factor helpers ----
    const addSector = () => {
        invalidateFilter1Cache();
        const idx = state.sectors.length;
        if (idx >= 7) return null; // Rhyne: 6-7 primary sectors
        const letter = SECTOR_LETTERS[idx];
        const sector = {
            id: 'sector_' + Date.now() + '_' + idx,
            letter,
            name: '',
            description: '',
            factors: [
                { id: letter + '1', label: '', description: '', mapX: 0.25, mapY: 0.25 },
                { id: letter + '2', label: '', description: '', mapX: 0.75, mapY: 0.25 },
                { id: letter + '3', label: '', description: '', mapX: 0.5, mapY: 0.75 },
            ],
        };
        state.sectors.push(sector);
        return sector;
    };

    const removeSector = (sectorId) => {
        invalidateFilter1Cache();
        state.sectors = state.sectors.filter(s => s.id !== sectorId);
        // Re-letter sectors
        state.sectors.forEach((s, i) => {
            const newLetter = SECTOR_LETTERS[i];
            s.factors.forEach((f, fi) => { f.id = newLetter + (fi + 1); });
            s.letter = newLetter;
        });
        rebuildCCMKeys();
    };

    const addFactor = (sectorId) => {
        invalidateFilter1Cache();
        const sector = state.sectors.find(s => s.id === sectorId);
        if (!sector || sector.factors.length >= 7) return null;
        const num = sector.factors.length + 1;
        // Position new factor in a circle pattern on the Lewinian map
        const angle = (num / 7) * Math.PI * 2;
        const factor = {
            id: sector.letter + num,
            label: '',
            description: '',
            mapX: Math.max(0.05, Math.min(0.95, 0.5 + 0.3 * Math.cos(angle))),
            mapY: Math.max(0.05, Math.min(0.95, 0.5 + 0.3 * Math.sin(angle))),
        };
        sector.factors.push(factor);
        return factor;
    };

    const removeFactor = (sectorId, factorId) => {
        invalidateFilter1Cache();
        const sector = state.sectors.find(s => s.id === sectorId);
        if (!sector || sector.factors.length <= 2) return;
        sector.factors = sector.factors.filter(f => f.id !== factorId);
        // Re-number
        sector.factors.forEach((f, i) => { f.id = sector.letter + (i + 1); });
        rebuildCCMKeys();
    };

    const rebuildCCMKeys = () => {
        const validKeys = new Set();
        const allFactors = getAllFactors();
        for (let i = 0; i < allFactors.length; i++) {
            for (let j = i + 1; j < allFactors.length; j++) {
                if (allFactors[i].sectorId !== allFactors[j].sectorId) {
                    validKeys.add(pairKey(allFactors[i].id, allFactors[j].id));
                }
            }
        }
        Object.keys(state.ccm).forEach(k => {
            if (!validKeys.has(k)) delete state.ccm[k];
        });
    };

    // ---- Factor enumeration ----
    const getAllFactors = () => {
        const factors = [];
        state.sectors.forEach(s => {
            s.factors.forEach(f => {
                factors.push({ ...f, sectorId: s.id, sectorLetter: s.letter, sectorName: s.name });
            });
        });
        return factors;
    };

    const getFactorById = (id) => {
        for (const s of state.sectors) {
            for (const f of s.factors) {
                if (f.id === id) return { ...f, sectorId: s.id, sectorLetter: s.letter, sectorName: s.name };
            }
        }
        return null;
    };

    const getSectorForFactor = (factorId) => {
        const letter = factorId.charAt(0);
        return state.sectors.find(s => s.letter === letter);
    };

    // ---- Sector count guidance ----
    const getSectorCountWarning = () => {
        const count = state.sectors.length;
        if (count < 6) return `Rhyne recommends 6\u20137 primary sectors. You have ${count}. Consider adding ${6 - count} more.`;
        if (count > 7) return `Rhyne recommends at most 7 primary sectors. You have ${count}.`;
        return null;
    };

    // ---- CCM helpers (Yes/No per Rhyne) ----
    const pairKey = (fId1, fId2) => [fId1, fId2].sort().join(':');

    const getCCMEntry = (fId1, fId2) => {
        const key = pairKey(fId1, fId2);
        return state.ccm[key] || { compatible: true, note: '' };
    };

    let _filter1Cache = null;

    const invalidateFilter1Cache = () => { _filter1Cache = null; };

    const setCCMEntry = (fId1, fId2, compatible, note) => {
        const key = pairKey(fId1, fId2);
        state.ccm[key] = { compatible: !!compatible, note: note || '' };
        invalidateFilter1Cache();
    };

    // ---- Configuration space computation ----
    const getTotalConfigurations = () => {
        if (state.sectors.length === 0) return 0;
        return state.sectors.reduce((prod, s) => prod * s.factors.length, 1);
    };

    const getPairCount = () => {
        let count = 0;
        for (let i = 0; i < state.sectors.length; i++) {
            for (let j = i + 1; j < state.sectors.length; j++) {
                count += state.sectors[i].factors.length * state.sectors[j].factors.length;
            }
        }
        return count;
    };

    const getIncompatiblePairCount = () => {
        return Object.values(state.ccm).filter(e => !e.compatible).length;
    };

    const configKey = (config) => config.join('-');

    const parseConfigKey = (key) => key.split('-');

    const generateAllConfigurations = () => {
        if (state.sectors.length === 0) return [];
        const factorSets = state.sectors.map(s => s.factors.map(f => f.id));
        return cartesianProduct(factorSets);
    };

    const cartesianProduct = (arrays) => {
        if (arrays.length === 0) return [[]];
        const result = [];
        const recurse = (current, depth) => {
            if (depth === arrays.length) {
                result.push([...current]);
                return;
            }
            for (const item of arrays[depth]) {
                current.push(item);
                recurse(current, depth + 1);
                current.pop();
            }
        };
        recurse([], 0);
        return result;
    };

    const isConfigConsistentFilter1 = (config) => {
        for (let i = 0; i < config.length; i++) {
            for (let j = i + 1; j < config.length; j++) {
                const entry = getCCMEntry(config[i], config[j]);
                if (!entry.compatible) return false;
            }
        }
        return true;
    };

    // ---- Filter 1: Pair-wise consistency (CCM) ----
    const computeFilter1 = () => {
        if (_filter1Cache) return _filter1Cache;
        const total = getTotalConfigurations();
        if (total > 100000) { _filter1Cache = computeFilter1Smart(); return _filter1Cache; }
        const all = generateAllConfigurations();
        const surviving = all.filter(isConfigConsistentFilter1);
        _filter1Cache = { total, surviving, eliminated: total - surviving.length };
        return _filter1Cache;
    };

    const computeFilter1Smart = () => {
        const total = getTotalConfigurations();
        const incompatibleSet = new Set();
        Object.entries(state.ccm).forEach(([key, val]) => {
            if (!val.compatible) incompatibleSet.add(key);
        });

        if (incompatibleSet.size === 0) {
            // All configs survive but space is too large — return capped sample
            return { total, surviving: [], eliminated: 0, allSurvive: true, capped: true };
        }

        const factorSets = state.sectors.map(s => s.factors.map(f => f.id));
        const surviving = [];
        const maxSurvivors = 5000;

        const recurse = (current, depth) => {
            if (surviving.length >= maxSurvivors) return;
            if (depth === factorSets.length) {
                surviving.push([...current]);
                return;
            }
            for (const factor of factorSets[depth]) {
                let consistent = true;
                for (let i = 0; i < current.length; i++) {
                    if (incompatibleSet.has(pairKey(current[i], factor))) {
                        consistent = false;
                        break;
                    }
                }
                if (consistent) {
                    current.push(factor);
                    recurse(current, depth + 1);
                    current.pop();
                }
            }
        };

        recurse([], 0);
        return { total, surviving, eliminated: total - surviving.length, capped: surviving.length >= maxSurvivors };
    };

    // ---- Filter 2: Holistic wholeness assessment ----
    const getFilter2Entry = (config) => {
        const key = configKey(config);
        return state.filter2[key] || { pass: true, note: '' };
    };

    const setFilter2Entry = (config, pass, note) => {
        const key = configKey(config);
        state.filter2[key] = { pass: !!pass, note: note || '' };
    };

    // Combined: configs that pass both filters + reintroduced
    const getFinalSurvivors = (filter1Survivors) => {
        const survivors = filter1Survivors.filter(config => {
            const entry = getFilter2Entry(config);
            return entry.pass;
        });

        // Add reintroduced configs
        state.reintroducedConfigs.forEach(key => {
            const parts = parseConfigKey(key);
            const alreadyIn = survivors.some(c => configKey(c) === key);
            if (!alreadyIn) survivors.push(parts);
        });

        return survivors;
    };

    // ---- Factor frequency analysis ----
    const analyzeFactorFrequency = (surviving) => {
        const freq = {};
        state.sectors.forEach(s => {
            s.factors.forEach(f => { freq[f.id] = 0; });
        });
        surviving.forEach(config => {
            config.forEach(fId => { freq[fId] = (freq[fId] || 0) + 1; });
        });
        return freq;
    };

    // ---- Config distance (for sorting/analysis) ----
    const configDistance = (c1, c2) => {
        let diff = 0;
        for (let i = 0; i < c1.length; i++) {
            if (c1[i] !== c2[i]) diff++;
        }
        return diff;
    };

    // ---- Sector pair enumeration for CCM ----
    const getSectorPairs = () => {
        const pairs = [];
        for (let i = 0; i < state.sectors.length; i++) {
            for (let j = i + 1; j < state.sectors.length; j++) {
                pairs.push([state.sectors[i], state.sectors[j]]);
            }
        }
        return pairs;
    };

    // ---- Reintroduce a previously rejected config ----
    const reintroduceConfig = (configKeyStr) => {
        if (!state.reintroducedConfigs.includes(configKeyStr)) {
            state.reintroducedConfigs.push(configKeyStr);
        }
    };

    const unreintroduceConfig = (configKeyStr) => {
        state.reintroducedConfigs = state.reintroducedConfigs.filter(k => k !== configKeyStr);
    };

    // ---- Save / Load ----
    const exportState = () => {
        const out = { ...state };
        // Include field locks if available
        if (typeof FARAI !== 'undefined' && FARAI.exportLocks) {
            out.fieldLocks = FARAI.exportLocks();
        }
        return JSON.stringify(out, null, 2);
    };

    const importState = (jsonStr) => {
        try {
            const parsed = JSON.parse(jsonStr);
            // Handle legacy format: convert old ccm entries
            if (parsed.ccm) {
                Object.keys(parsed.ccm).forEach(key => {
                    const entry = parsed.ccm[key];
                    if ('status' in entry && !('compatible' in entry)) {
                        entry.compatible = entry.status !== 'inconsistent';
                        delete entry.status;
                    }
                });
            }
            // Handle legacy: convert clusters to scenarioLines if needed
            if (parsed.clusters && !parsed.scenarioLines) {
                parsed.scenarioLines = parsed.clusters.map(c => ({
                    id: c.id,
                    name: c.name,
                    description: c.description,
                    color: c.color,
                    configs: [],
                    narrative: parsed.narratives?.[c.id] || '',
                }));
                delete parsed.clusters;
            }
            // Ensure new fields exist
            delete parsed.cycle;
            delete parsed.previousCycles;
            parsed.initialView = parsed.initialView || '';
            parsed.fieldBoundaries = parsed.fieldBoundaries || '';
            parsed.keyUncertainties = parsed.keyUncertainties || '';
            parsed.acronym = parsed.acronym || '';
            parsed.filter2 = parsed.filter2 || {};
            parsed.scenarioLines = parsed.scenarioLines || [];
            parsed.reintroducedConfigs = parsed.reintroducedConfigs || [];
            parsed.filterLog = parsed.filterLog || [];
            parsed.project.collectWarningIndicators = parsed.project.collectWarningIndicators || false;

            // Restore field locks if present in the saved data
            const savedLocks = parsed.fieldLocks;
            delete parsed.fieldLocks; // Don't store in state object itself

            state = parsed;

            // Import locks after state is set
            if (typeof FARAI !== 'undefined' && FARAI.importLocks && savedLocks) {
                FARAI.importLocks(savedLocks);
            }

            return true;
        } catch (e) {
            return false;
        }
    };

    // ---- Public API ----
    return {
        getState, setState, createDefaultState,
        addSector, removeSector, addFactor, removeFactor,
        getAllFactors, getFactorById, getSectorForFactor,
        getSectorCountWarning,
        pairKey, getCCMEntry, setCCMEntry,
        getTotalConfigurations, getPairCount, getIncompatiblePairCount,
        configKey, parseConfigKey,
        computeFilter1, isConfigConsistentFilter1,
        getFilter2Entry, setFilter2Entry, getFinalSurvivors,
        analyzeFactorFrequency, configDistance,
        getSectorPairs,
        reintroduceConfig, unreintroduceConfig,
        exportState, importState,
    };
})();
