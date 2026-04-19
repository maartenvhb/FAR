/* ============================================================
   FAR Prompts — All AI prompt templates in one place.
   Each function returns { system, prompt } given the necessary
   context variables.  Edit this file to tune AI behaviour
   without touching the application logic in far-ai.js.
   ============================================================ */

const FARPrompts = (() => {

    const SYSTEM = `You are an expert in strategic foresight and Field Anomaly Relaxation (FAR), a methodology developed by Russell Rhyne at Stanford Research Institute. You help analysts brainstorm alternative futures, assess factor compatibility, and compose scenario narratives. Be concise and specific. Avoid generic platitudes.`;

    // ---- Step 1: Initial View ----

    const brainstorm = (ctx, constraints) => ({
        system: SYSTEM,
        prompt: `I am beginning a FAR analysis and need help brainstorming the initial view of the future.

Project: ${ctx.projectName}
Description: ${ctx.description}
Time Horizon: ${ctx.horizon}

Please provide content for ALL THREE of the following sections:

ALTERNATIVE VISIONS:
Provide 4-6 distinct, contrasting visions of the future for this domain. Include optimistic, pessimistic, and surprising/unconventional scenarios. Be specific — avoid generic futures thinking.

FIELD BOUNDARIES:
Suggest what should be included and excluded from this analysis. What geographic, temporal, or domain limits make sense? Be specific about what is in scope and out of scope.

KEY UNCERTAINTIES:
Identify 5-8 major unknowns that could shape the future. These often become sectors in Step 2 of the FAR process. Focus on genuine uncertainties where multiple outcomes are plausible.

Format your response with clear section headers: ALTERNATIVE VISIONS:, FIELD BOUNDARIES:, KEY UNCERTAINTIES:
Write plain text content under each header.${constraints || ''}`,
    });

    const singleField = (fieldName, ctx) => {
        const fieldInstructions = {
            'initial-view': {
                label: 'Alternative Visions of the Future',
                instruction: 'Provide 4-6 distinct, contrasting visions of the future for this domain. Include optimistic, pessimistic, and surprising/unconventional scenarios. Be specific — avoid generic futures thinking.',
                context: [
                    ctx.fieldBoundaries ? `Field Boundaries already defined:\n${ctx.fieldBoundaries}` : '',
                    ctx.keyUncertainties ? `Key Uncertainties already identified:\n${ctx.keyUncertainties}` : '',
                ],
            },
            'field-boundaries': {
                label: 'Field Boundaries',
                instruction: 'Suggest what should be included and excluded from this analysis. What geographic, temporal, or domain limits make sense? Be specific about what is in scope and out of scope.',
                context: [
                    ctx.initialView ? `Alternative Visions already described:\n${ctx.initialView}` : '',
                    ctx.keyUncertainties ? `Key Uncertainties already identified:\n${ctx.keyUncertainties}` : '',
                ],
            },
            'key-uncertainties': {
                label: 'Key Uncertainties',
                instruction: 'Identify 5-8 major unknowns that could shape the future. These often become sectors in Step 2 of the FAR process. Focus on genuine uncertainties where multiple outcomes are plausible.',
                context: [
                    ctx.initialView ? `Alternative Visions already described:\n${ctx.initialView}` : '',
                    ctx.fieldBoundaries ? `Field Boundaries already defined:\n${ctx.fieldBoundaries}` : '',
                ],
            },
        };

        const field = fieldInstructions[fieldName];
        if (!field) return null;
        const contextParts = field.context.filter(c => c).join('\n\n');

        return {
            system: SYSTEM,
            prompt: `I am working on Step 1 of a FAR analysis — forming an initial view of the future.

Project: ${ctx.projectName}
Description: ${ctx.description}
Time Horizon: ${ctx.horizon}
${contextParts ? '\n' + contextParts + '\n' : ''}
Please write content for the "${field.label}" field.

${field.instruction}

Write plain text only — no headings or section markers. Just the content for this single field.`,
        };
    };

    // ---- Step 2: Sectors & Factors ----

    const sectorSuggestion = (ctx, constraints, sectorCount = 6, factorCount = 3) => ({
        system: SYSTEM,
        prompt: `I am constructing the sector array (Step 2) for a FAR analysis.

Project: ${ctx.projectName}
Description: ${ctx.description}
Time Horizon: ${ctx.horizon}
${ctx.initialView ? `\nInitial View (Alternative Visions):\n${ctx.initialView}` : ''}
${ctx.fieldBoundaries ? `\nField Boundaries:\n${ctx.fieldBoundaries}` : ''}
${ctx.keyUncertainties ? `\nKey Uncertainties:\n${ctx.keyUncertainties}` : ''}

Rhyne recommends 6-7 primary sectors identified by a memorable acronym (e.g., "ACTIVES"). Each sector should have mutually exclusive factors representing possible future states.

Please suggest a sector array with exactly ${sectorCount} sectors. For each sector, provide:
- A sector name (one or two words)
- A brief description
- ${factorCount} factors (mutually exclusive possible states), each with a short label and brief description

Use EXACTLY this format for each sector:

SECTOR: [Name]
DESCRIPTION: [Brief description of what this sector covers]
${Array.from({ length: factorCount }, (_, i) => `FACTOR ${i + 1}: [Label] | [Description]`).join('\n')}

Also suggest a memorable acronym from the first letters of the sector names on the first line:
ACRONYM: [acronym]

Be specific to this project domain. Avoid generic sectors.${constraints || ''}`,
    });

    const sectorFactor = (ctx, sector) => ({
        system: SYSTEM,
        prompt: `I am refining factors for one sector in a FAR analysis.

Project: ${ctx.projectName}
Description: ${ctx.description}
Time Horizon: ${ctx.horizon}

Sector ${sector.letter}: ${sector.name || 'Unnamed'}${sector.description ? ' — ' + sector.description : ''}

Current factors:
${sector.factors.map(f => `${f.id}: ${f.label || '(empty)'}${f.description ? ' — ' + f.description : ''}`).join('\n')}

Suggest improved factors for this sector. Each factor should be a mutually exclusive possible future state. Provide exactly ${sector.factors.length} factors.

Use EXACTLY this format:
FACTOR 1: [Label] | [Description]
FACTOR 2: [Label] | [Description]
FACTOR 3: [Label] | [Description]`,
    });

    const factorSimilarity = (sector) => ({
        system: SYSTEM,
        prompt: `I am building a Lewinian Factor Similarity Map for one sector in a FAR analysis. Position each factor on a 2D conceptual map where nearby factors are conceptually similar and distant factors are dissimilar.

Sector ${sector.letter}: ${sector.name || 'Unnamed'}${sector.description ? ' — ' + sector.description : ''}

Factors:
${sector.factors.map(f => `${f.id}: ${f.label || '(unlabelled)'}${f.description ? ' — ' + f.description : ''}`).join('\n')}

Position each factor with X and Y coordinates between 0.0 and 1.0. Group conceptually similar factors close together; spread dissimilar factors far apart. Consider semantic meaning, underlying assumptions, and worldview implied by each factor.

Use EXACTLY this format:
POSITIONS:
${sector.factors.map(f => `${f.id}: X=0.50, Y=0.50 — [brief explanation of why this factor is positioned here relative to others]`).join('\n')}

Replace the placeholder coordinates with meaningful positions and provide a brief explanation for each.`,
    });

    // ---- Step 3: Filtering ----

    const ccmStrictnessBlock = (strictness) => {
        if (strictness === 'strict') return `IMPORTANT: Would a reasonable domain expert agree these can plausibly coexist? Mark NO unless you can describe a specific, non-contrived real-world scenario where both factors appear together. For a typical array, expect 25–40% of pairs to be incompatible. Each NO eliminates every configuration containing that pair, which is necessary — Rhyne expects pair-wise filtering alone to remove ~99.9% of the configuration space.`;
        if (strictness === 'permissive') return `IMPORTANT: Be open-minded. Mark NO only if there is a clear logical contradiction. If you can imagine any plausible way both factors might coexist, mark YES.`;
        return `IMPORTANT: Use your best judgment. Mark NO only when you genuinely cannot imagine a plausible pattern in which both factors coexist. For typical arrays, expect 15-25% of pairs to be incompatible.`;
    };

    const filter2StrictnessBlock = (strictness) => {
        if (strictness === 'strict') return `Be rigorous: reject configurations that feel forced, implausible, or internally contradictory — even if individual pairs are compatible. For strict filtering, expect to reject 30-60% of survivors. Only the most coherent and distinctive futures should survive.`;
        if (strictness === 'permissive') return `Be generous: only reject configurations with clear internal contradictions. Pass anything that represents a conceivable future, even if unlikely.`;
        return `Use balanced judgment: reject configurations that feel incoherent as a whole, even if individual pairs work. Expect to reject 20-40% of survivors.`;
    };

    const ccmPrescoring = (sector1, sector2, pairDescriptions, pairs, strictness) => ({
        system: SYSTEM,
        prompt: `I am performing the Cross-Consistency Matrix (CCM) assessment in a FAR analysis — Rhyne's pair-wise consistency filter.

Sector ${sector1.letter}: ${sector1.name || 'Unnamed'}${sector1.description ? ' — ' + sector1.description : ''}
Sector ${sector2.letter}: ${sector2.name || 'Unnamed'}${sector2.description ? ' — ' + sector2.description : ''}

For each factor pair below, assess whether these two factors can plausibly coexist.

${ccmStrictnessBlock(strictness)}

Factor pairs to assess:
${pairDescriptions}

Format your response as a list. For each pair use EXACTLY this format:
${pairs.map(({ f1, f2 }) => `${f1.id}:${f2.id} — YES/NO — [brief reasoning]`).join('\n')}`,
    });

    const filter2 = (projectName, description, configDescriptions, strictness) => ({
        system: SYSTEM,
        prompt: `I am performing Filter 2 (Holistic Wholeness Assessment) in a FAR analysis.

Project: ${projectName}
${description ? 'Description: ' + description : ''}

These configurations survived the pair-wise consistency check (Filter 1). Now I must assess each one holistically: "Does this entire configuration, taken as a whole, represent a coherent picture of a possible future world?"

Configurations to assess:
${configDescriptions}

${filter2StrictnessBlock(strictness)}

For EACH configuration above, you MUST provide a verdict.

Use EXACTLY this format for each, one per line:
#[number] — PASS/REJECT — [brief reasoning]

You must provide a line for every single configuration listed above. Do not skip any.`,
    });

    const refilter = (projectName, description, configDescriptions, configCount, targetCount) => ({
        system: SYSTEM,
        prompt: `I am performing an adaptive re-filter in a FAR analysis. Too many configurations survived the previous filters (${configCount}), and I need to narrow them to approximately ${targetCount}.

Project: ${projectName}
${description ? 'Description: ' + description : ''}

Comparatively rank these surviving configurations. Identify the LEAST coherent, most redundant, or weakest ones and mark them REJECT. Keep only the ${targetCount} most distinctive, internally consistent, and analytically valuable configurations.

Configurations:
${configDescriptions}

For EACH configuration, you MUST provide a verdict using EXACTLY this format, one per line:
[configKey] — KEEP/REJECT — [brief reasoning]

Where [configKey] is the identifier in square brackets (e.g. A1-B2-C3). You must REJECT enough configurations to bring the total down to approximately ${targetCount}. Do not skip any configuration.`,
    });

    const relax = (projectName, description, pairsSection, rejectsSection, filter1Count, targetCount) => ({
        system: SYSTEM,
        prompt: `I am performing an adaptive relaxation in a FAR analysis. Too few configurations survived filtering (currently ${filter1Count} after Filter 1, leading to fewer than ${targetCount} final survivors). I need to relax prior filtering to recover at least ${targetCount} viable configurations.

Project: ${projectName}
${description ? 'Description: ' + description : ''}
${pairsSection}${rejectsSection}

Review the incompatible pairs and rejected configurations above. Identify which filtering decisions are MOST QUESTIONABLE — where the original rejection was marginal, debatable, or overly strict. Prioritize:
1. First, reversing Filter 2 rejections (cheapest — each reversal directly adds one configuration)
2. Then, reversing CCM incompatible pairs (broader impact — may unlock multiple configurations)

For each item, indicate whether to RELAX (reverse the rejection) or KEEP (maintain the rejection).

Use EXACTLY this format:
${pairsSection ? pairsSection.match(/#P\d+/g)?.map(tag => `${tag} — RELAX/KEEP — [reasoning]`).join('\n') || '' : ''}
${rejectsSection ? rejectsSection.match(/#R\d+/g)?.map(tag => `${tag} — RELAX/KEEP — [reasoning]`).join('\n') || '' : ''}

RELAX enough to plausibly reach at least ${targetCount} final survivors. Prefer the most borderline/questionable rejections.`,
    });

    // ---- Step 4: Scenario Composition ----

    const scenarioComposition = (projectName, description, horizon, sectorInfo, configDescriptions, survivors, minConfigs, maxConfigs, targetLines) => ({
        system: SYSTEM,
        prompt: `Given these ${survivors} surviving configurations from a FAR analysis, compose ${targetLines} distinct scenario lines representing DIFFERENT thematic futures. Each line is a multi-step temporal trajectory from the present through intermediate stages to a unique endpoint.

Project: ${projectName}
Description: ${description}
Time Horizon: ${horizon}

Sectors:
${sectorInfo}

Surviving configurations:
${configDescriptions}

SHARED PRESENT: Configuration #1 is the factual present — it represents the current, observable state of the world as it actually is today. This is NOT speculative. It is already decided for you. ALL scenario lines MUST begin with "#1 | Present" as their CONFIG 1. Do NOT choose a different present for different lines. There is exactly ONE present.

INTERNAL CONSISTENCY: At every time point in every scenario line, the combination of factors must fit together tolerably — each configuration should represent a world that makes sense as a coherent whole at that moment. This is especially critical for the present (CONFIG 1), which must accurately reflect current, known, observable conditions. Do not use the present to set up a narrative; describe the world as it actually is right now.

PLAUSIBLE CONTINUITY: Change along each scenario line must be plausibly continuous. Each transition should follow logically from the previous state — no unexplained jumps, no "and then everything changed overnight." The forces driving change should build on what came before. If a factor shifts, there should be a traceable chain of cause and effect connecting the previous configuration to the next. Abrupt reversals or contradictory shifts between adjacent configurations are not acceptable unless a major, specific triggering event is identified.

CORE PRINCIPLE — DIVERGENT FUTURES WITH GRADUAL EVOLUTION: Each scenario line must represent a genuinely DIFFERENT future AND show the step-by-step path of how the world gets there. All lines share the SAME starting point (#1, Present) but MUST diverge to reach DIFFERENT final configurations through multiple intermediate stages.

MULTI-STEP EVOLUTION: This is critical. Each scenario line must have ${minConfigs}-${maxConfigs} configurations showing gradual change over time:
- Each step should change only 1-2 factors from the previous configuration
- If the transition between two configurations requires changing 3+ factors, you MUST insert intermediate configurations to bridge the gap
- Faster-moving scenarios (e.g., technology disruptions) need MORE intermediate steps, not fewer — show the rapid succession of changes
- Slower-moving scenarios can have fewer steps but should still show at least ${minConfigs} stages
- The same configuration CAN be reused as an intermediate step in multiple lines — this is how branching works (lines share early stages, then diverge)

DIVERGENCE RULES:
- Each scenario line MUST end at a DIFFERENT final configuration — no two lines share their last config
- Lines MAY share the same early intermediate configs (this creates natural branching) but must diverge by their 2nd or 3rd step
- Each line should tell a distinct story of gradual transformation

For each scenario line:
1. Give it a distinctive name and brief description
2. Select ${minConfigs}-${maxConfigs} configurations forming a gradual temporal sequence
3. CONFIG 1 is the shared present; subsequent configs trace a step-by-step path to a unique endpoint
4. Assign period labels spanning the time horizon (e.g., "Present", "2025-2028", "2030-2033", "2035+")
5. Rate each config on:
   - Commitment (F, 1-10): How much deliberate intervention and irreversible commitment? 1=passive, 10=maximum
   - Freedom (O, 1-10): How much diversity and remaining possibility? 1=locked-in, 10=maximum freedom
   Use the FULL 1-10 range. Different configs MUST have meaningfully different scores.

Use EXACTLY this format for EACH scenario line. Reference configurations by NUMBER (#1, #2, etc.):

SCENARIO LINE: [Name]
DESCRIPTION: [Brief description]
CONFIG 1: #1 | Present | F:[1-10] | O:[1-10] | TRIGGER: [what drives the first divergence]
CONFIG 2: #N | [periodLabel] | F:[1-10] | O:[1-10] | TRIGGER: [what drives the next transition]
...add more CONFIG lines as needed (${minConfigs} to ${maxConfigs} total)...
CONFIG N: #N | [periodLabel] | F:[1-10] | O:[1-10]

VARY THE LENGTH: Different scenario lines should have DIFFERENT numbers of configurations depending on how much change occurs. A scenario with rapid, disruptive change needs more intermediate steps (5-${maxConfigs} configs) to show the fast succession of shifts. A scenario with slow, steady change can have fewer steps (${minConfigs}-3 configs). Do NOT give every line the same number of configs.

IMPORTANT:
- EVERY line MUST start with "CONFIG 1: #1 | Present" — this is the shared factual present, not negotiable
- Use ONLY #N numbers from the list above (#1 through #${survivors})
- Each line MUST end at a DIFFERENT configuration — no two lines share their endpoint
- Each line needs ${minConfigs}-${maxConfigs} CONFIG entries (including the shared present)
- Different lines should have DIFFERENT lengths — vary between ${minConfigs} and ${maxConfigs}
- Reuse configs as intermediates across lines to create natural branching
- F and O values MUST be integers from 1-10
- The last CONFIG in each line has no TRIGGER (it is the end-state)`,
    });

    const scenarioNaming = (summaries, scenarioLines) => ({
        system: SYSTEM,
        prompt: `Based on these scenario narratives from a FAR analysis, suggest a short, evocative name (2-5 words) for each scenario that captures its essential character and distinguishes it from the others. Names should be vivid and memorable — avoid generic labels.

${summaries}

Respond using EXACTLY this format for each scenario:
${scenarioLines.map((_, i) => `NAME ${i + 1}: [name]`).join('\n')}`,
    });

    const warningIndicator = (lineName, config1Desc, config2Desc, period1, period2) => ({
        system: SYSTEM,
        prompt: `In a FAR scenario line "${lineName}", there is a transition between two configurations:

FROM (${period1}): ${config1Desc}
TO (${period2}): ${config2Desc}

Describe the broad category of change that would drive this transition. Think at the level of macro forces: what type of shift in policy, technology, markets, society, or environment would need to occur? Keep it high-level and generic enough to encompass multiple specific events that could trigger this transition.

Respond with a single concise warning indicator (1-2 sentences). Frame it as a class of developments to watch for, not a single specific event.`,
    });

    const narrative = (lineName, lineDescription, configDetails, respectLocksNote) => ({
        system: SYSTEM,
        prompt: `Write a scenario narrative for the FAR scenario line "${lineName}".
${lineDescription ? 'Description: ' + lineDescription : ''}

The temporal sequence of configurations is:

${configDetails}

Write a narrative that:
- Follows the temporal sequence from the first period to the last
- Explains HOW and WHY the world transitions from one configuration to the next
- Uses present tense as if describing a world that already exists
- Includes concrete details and examples
- Is internally consistent with the factor values in each configuration
- Is 3-5 paragraphs long

Do not include headings or bullet points — write flowing prose.${respectLocksNote || ''}`,
    });

    // ---- Per-field AI buttons (Step 4) ----

    const scenarioLineName = (ctx, configDetails, lineDescription, otherNames) => ({
        system: SYSTEM,
        prompt: `Suggest a short, evocative name (2-5 words) for this FAR scenario line.

Project: ${ctx.projectName}
Description: ${ctx.description}

Configurations:
${configDetails}
${lineDescription ? '\nCurrent description: ' + lineDescription : ''}${otherNames.length ? '\nOther scenario lines (for differentiation): ' + otherNames.join(', ') : ''}

Respond with JUST the name, nothing else.`,
    });

    const scenarioLineDescription = (ctx, lineName, configDetails) => ({
        system: SYSTEM,
        prompt: `Write a brief description (1-3 sentences) for this FAR scenario line.

Project: ${ctx.projectName}
Description: ${ctx.description}

Line name: ${lineName}
Configurations:
${configDetails}

Describe the overall character and trajectory — what makes this future distinct?
Respond with JUST the description text, no headings or labels.`,
    });

    const periodLabels = (ctx, lineName, configCount, configDetails) => ({
        system: SYSTEM,
        prompt: `Suggest period labels for a FAR scenario line with ${configCount} configurations.

Project: ${ctx.projectName}
Time Horizon: ${ctx.horizon}
Line: ${lineName}

Configurations:
${configDetails}

Provide exactly ${configCount} period labels that span the time horizon with meaningful intervals. The first should typically be "Present" or the current year.

Use EXACTLY this format:
PERIOD 1: [label]
PERIOD 2: [label]
...`,
    });

    const scores = (ctx, lineName, lineDescription, configDetails, configCount) => ({
        system: SYSTEM,
        prompt: `Rate each configuration in this FAR scenario line on two dimensions:
- Commitment/Faustianness (F, 1-10): How much deliberate human intervention and irreversible commitment? 1=passive/drifting, 10=maximum commitment
- Freedom/Openness (O, 1-10): How much diversity and remaining possibility? 1=locked-in, 10=maximum freedom

Project: ${ctx.projectName}
Line: ${lineName}
${lineDescription ? 'Description: ' + lineDescription : ''}

Configurations:
${configDetails}

Use the FULL 1-10 range. Different configs MUST get meaningfully different scores.

Use EXACTLY this format:
${Array.from({ length: configCount }, (_, i) => `#${i + 1}: F=[1-10] O=[1-10]`).join('\n')}`,
    });

    return {
        SYSTEM,
        brainstorm,
        singleField,
        sectorSuggestion,
        sectorFactor,
        factorSimilarity,
        ccmPrescoring,
        ccmStrictnessBlock,
        filter2,
        filter2StrictnessBlock,
        refilter,
        relax,
        scenarioComposition,
        scenarioNaming,
        warningIndicator,
        narrative,
        scenarioLineName,
        scenarioLineDescription,
        periodLabels,
        scores,
    };
})();
