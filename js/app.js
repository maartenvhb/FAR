/* ============================================================
   FAR App — Main Application Controller
   Aligned with Rhyne's FAR Methodology (1995)
   ============================================================ */

const FAR = (() => {
    let currentStep = 0;
    const TOTAL_STEPS = 5;
    const AUTOSAVE_KEY = 'far_autosave';
    const AUTOSAVE_STEP_KEY = 'far_autosave_step';

    // ---- Auto-save (debounced) ----
    let saveTimer = null;
    const autoSave = () => {
        localStorage.setItem(AUTOSAVE_KEY, FARCore.exportState());
        localStorage.setItem(AUTOSAVE_STEP_KEY, currentStep);
    };
    const scheduleAutoSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(autoSave, 500);
    };

    const restoreFromLocalStorage = () => {
        const saved = localStorage.getItem(AUTOSAVE_KEY);
        if (!saved) return false;
        const success = FARCore.importState(saved);
        if (!success) return false;

        const state = FARCore.getState();
        document.getElementById('project-name').value = state.project.name || '';
        document.getElementById('project-desc').value = state.project.description || '';
        document.getElementById('project-horizon').value = state.project.horizon || '';
        document.getElementById('collect-warning-indicators').checked = state.project.collectWarningIndicators || false;

        const savedStep = parseInt(localStorage.getItem(AUTOSAVE_STEP_KEY));
        currentStep = isNaN(savedStep) ? 0 : savedStep;
        return true;
    };

    const init = () => {
        // Mobile menu toggle
        const menuToggle = document.getElementById('menu-toggle');
        const collapsible = document.getElementById('top-bar-collapsible');
        if (menuToggle && collapsible) {
            menuToggle.addEventListener('click', () => {
                collapsible.classList.toggle('open');
                menuToggle.classList.toggle('open');
            });
        }

        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const step = parseInt(btn.dataset.step);
                // Close mobile menu on nav
                if (collapsible) collapsible.classList.remove('open');
                if (menuToggle) menuToggle.classList.remove('open');
                goToStep(step);
            });
        });

        // Step 1: Initial View event binding
        FARUI.bindInitialViewEvents();

        // Step 2: Add sector button
        document.getElementById('btn-add-sector').addEventListener('click', () => {
            const sector = FARCore.addSector();
            if (!sector) {
                alert('Maximum 7 sectors reached (Rhyne recommends 6\u20137 primary sectors).');
                return;
            }
            FARUI.renderSectors();
        });

        // Step 4: Add scenario line
        document.getElementById('btn-add-scenario-line').addEventListener('click', () => {
            const state = FARCore.getState();
            const colors = FARUI.SCENARIO_COLORS;
            state.scenarioLines.push({
                id: 'sl_' + Date.now(),
                name: 'Scenario Line ' + (state.scenarioLines.length + 1),
                description: '',
                color: colors[state.scenarioLines.length % colors.length],
                configs: [],
                narrative: '',
            });
            FARUI.renderScenarioLines();
            FARUI.renderNarratives();
        });

        // Step 4: Reintroduce configs
        document.getElementById('btn-reintroduce-configs').addEventListener('click', () => {
            FARUI.openReintroduceModal();
        });

        // Save / Load / Restart
        document.getElementById('btn-save').addEventListener('click', saveProject);
        document.getElementById('btn-load').addEventListener('click', () => {
            document.getElementById('file-load').click();
        });
        document.getElementById('file-load').addEventListener('change', loadProject);
        document.getElementById('btn-restart').addEventListener('click', restartProject);

        // Load example project
        document.getElementById('btn-load-example').addEventListener('click', loadExampleProject);

        // PDF export
        document.getElementById('btn-export-pdf').addEventListener('click', () => {
            FARReport.exportPDF();
        });

        // Project name / desc / horizon sync
        document.getElementById('project-name').addEventListener('input', (e) => {
            FARCore.getState().project.name = e.target.value;
        });
        document.getElementById('project-desc').addEventListener('input', (e) => {
            FARCore.getState().project.description = e.target.value;
        });
        document.getElementById('project-horizon').addEventListener('input', (e) => {
            FARCore.getState().project.horizon = e.target.value;
        });
        document.getElementById('collect-warning-indicators').addEventListener('change', (e) => {
            FARCore.getState().project.collectWarningIndicators = e.target.checked;
        });

        // Collapsible sections
        document.querySelectorAll('.collapsible-header').forEach(header => {
            header.addEventListener('click', () => {
                header.closest('.collapsible').classList.toggle('collapsed');
            });
        });

        // Restore saved state or create fresh defaults
        const restored = restoreFromLocalStorage();
        if (!restored) {
            // Add 6 starter sectors for quick start (Rhyne's minimum)
            for (let i = 0; i < 6; i++) {
                FARCore.addSector();
            }
        }

        // AI Analyst button (fresh run clears all locks)
        document.getElementById('btn-autopilot').addEventListener('click', () => {
            FARAI.clearAllLocks();
            FARAI.runAutopilot();
        });

        // AI Analyst re-run button (top bar)
        document.getElementById('btn-assisted').addEventListener('click', () => {
            FARAI.runAssisted();
        });

        // Initialize AI assistant (Ollama)
        FARAI.init();

        // Set initial step
        goToStep(currentStep);

        // Auto-save on data changes, plus beforeunload as safety net
        document.addEventListener('input', scheduleAutoSave);
        document.addEventListener('change', scheduleAutoSave);
        window.addEventListener('beforeunload', autoSave);
    };

    const goToStep = (step) => {
        currentStep = step;

        // Update panels
        document.querySelectorAll('.step-panel').forEach(panel => {
            panel.classList.toggle('active', parseInt(panel.dataset.step) === step);
        });

        // Update nav
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const btnStep = parseInt(btn.dataset.step);
            btn.classList.toggle('active', btnStep === step);
        });

        // Update progress bar
        const pct = step === 0 ? 0 : (step / TOTAL_STEPS) * 100;
        document.getElementById('progress-fill').style.width = pct + '%';

        // Render step-specific content
        switch (step) {
            case 1:
                FARUI.renderInitialView();
                break;
            case 2:
                FARUI.renderSectors();
                break;
            case 3:
                FARUI.renderCCM();
                FARUI.renderSolutionSpace();
                break;
            case 4:
                FARUI.renderScenarioLines();
                FARTree.renderTree();
                FARUI.renderNarratives();
                break;
            case 5:
                FARReport.generateReport();
                break;
        }

        // Persist current step
        scheduleAutoSave();

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const saveProject = () => {
        const state = FARCore.getState();
        const json = FARCore.exportState();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (state.project.name || 'FAR-Analysis').replace(/[^a-zA-Z0-9_-]/g, '_') + '.far.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const loadProject = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            const success = FARCore.importState(evt.target.result);
            if (success) {
                const state = FARCore.getState();
                document.getElementById('project-name').value = state.project.name || '';
                document.getElementById('project-desc').value = state.project.description || '';
                document.getElementById('project-horizon').value = state.project.horizon || '';
                document.getElementById('collect-warning-indicators').checked = state.project.collectWarningIndicators || false;
                // Locks are restored by importState — don't clear them
                FARAI.resetAutopilotFlag();
                FARAI.loadSettings();
                goToStep(0);
                autoSave();
                alert('Project loaded successfully!');
            } else {
                alert('Failed to load project file. Please check the file format.');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const loadExampleProject = () => {
        if (!confirm('This will replace your current project with a pre-built example. Continue?')) return;
        const success = FARCore.importState(JSON.stringify(FAR_SAMPLE_PROJECT));
        if (success) {
            const state = FARCore.getState();
            document.getElementById('project-name').value = state.project.name || '';
            document.getElementById('project-desc').value = state.project.description || '';
            document.getElementById('project-horizon').value = state.project.horizon || '';
            document.getElementById('collect-warning-indicators').checked = state.project.collectWarningIndicators || false;
            FARAI.clearAllLocks();
            FARAI.resetAutopilotFlag();
            FARAI.loadSettings();
            goToStep(0);
            autoSave();
        }
    };

    const restartProject = () => {
        if (!confirm('Are you sure you want to restart? Any unsaved information will be lost.')) {
            return;
        }

        // Clear autosave and field locks
        localStorage.removeItem(AUTOSAVE_KEY);
        localStorage.removeItem(AUTOSAVE_STEP_KEY);
        localStorage.removeItem('far_field_locks');

        // Reset state to fresh defaults
        FARCore.setState(FARCore.createDefaultState());
        for (let i = 0; i < 6; i++) {
            FARCore.addSector();
        }

        // Reset welcome page fields
        document.getElementById('project-name').value = '';
        document.getElementById('project-desc').value = '';
        document.getElementById('project-horizon').value = '';
        document.getElementById('collect-warning-indicators').checked = false;

        // Reset AI state (locks, AI Analyst flag, connection context)
        FARAI.clearAllLocks();
        FARAI.resetAutopilotFlag();
        FARAI.loadSettings();
        FARAI.hideAssistedButton();

        goToStep(0);
    };

    // Initialize on DOM ready
    document.addEventListener('DOMContentLoaded', init);

    return { goToStep };
})();
