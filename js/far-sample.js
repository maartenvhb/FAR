/* ============================================================
   FAR Sample Project — "Future of Urban Transport 2035"
   Pre-built example for new users to explore the tool
   ============================================================ */

const FAR_SAMPLE_PROJECT = {
    project: {
        name: 'Future of Urban Transport 2035',
        description: 'How will cities move people in the next decade? This analysis explores the interplay of technology, infrastructure investment, governance models, economic forces, and changing ridership patterns.',
        horizon: '2025\u20132035',
        collectWarningIndicators: true,
        createdAt: new Date().toISOString(),
    },

    // Step 1
    initialView: 'Urban transport is at a crossroads. Autonomous vehicles, micro-mobility, and MaaS platforms could transform how cities move people \u2014 or legacy systems and political gridlock could keep things largely unchanged. Climate targets add urgency. Key questions: Will private tech displace public transit? Will infrastructure investment keep pace? How will rider expectations shift?',
    fieldBoundaries: 'Focus: mid-sized to large cities in developed economies. Excludes freight/logistics, intercity rail, and air travel. Time horizon: 2025\u20132035.',
    keyUncertainties: '1. Speed of autonomous vehicle deployment\n2. Political appetite for congestion pricing\n3. Public transit funding levels\n4. Consumer willingness to share rides\n5. Climate policy stringency',

    // Step 2
    acronym: 'TIGER',
    sectors: [
        {
            id: 'sector_sample_0', letter: 'A',
            name: 'Technology',
            description: 'The state of transport technology \u2014 automation, electrification, and digital platforms',
            factors: [
                { id: 'A1', label: 'Incremental Improvement', description: 'Gradual EV adoption, driver-assist only, app-based hailing', mapX: 0.2, mapY: 0.5 },
                { id: 'A2', label: 'Autonomous Breakthrough', description: 'Level 4-5 autonomy widely deployed, robotaxis dominant', mapX: 0.8, mapY: 0.2 },
                { id: 'A3', label: 'Tech Fragmentation', description: 'Multiple incompatible systems, no dominant standard, pilot fatigue', mapX: 0.5, mapY: 0.8 },
            ],
        },
        {
            id: 'sector_sample_1', letter: 'B',
            name: 'Infrastructure',
            description: 'The physical and digital infrastructure supporting urban transport',
            factors: [
                { id: 'B1', label: 'Car-Centric Status Quo', description: 'Roads prioritized, minimal bike/transit infrastructure expansion', mapX: 0.2, mapY: 0.3 },
                { id: 'B2', label: 'Transit Renaissance', description: 'Major rail/BRT expansion, dedicated bus lanes, bike networks', mapX: 0.8, mapY: 0.3 },
                { id: 'B3', label: 'Smart Corridors', description: 'Adaptive infrastructure with real-time lane allocation and sensor networks', mapX: 0.5, mapY: 0.8 },
            ],
        },
        {
            id: 'sector_sample_2', letter: 'C',
            name: 'Governance',
            description: 'Regulatory frameworks, pricing mechanisms, and political decision-making',
            factors: [
                { id: 'C1', label: 'Laissez-Faire', description: 'Minimal regulation, market-led outcomes, no congestion pricing', mapX: 0.2, mapY: 0.5 },
                { id: 'C2', label: 'Active Management', description: 'Congestion pricing, emission zones, integrated MaaS regulation', mapX: 0.8, mapY: 0.2 },
                { id: 'C3', label: 'Fragmented Regulation', description: 'Overlapping jurisdictions, inconsistent rules across city/state/federal', mapX: 0.5, mapY: 0.8 },
            ],
        },
        {
            id: 'sector_sample_3', letter: 'D',
            name: 'Economy',
            description: 'Economic forces shaping transport investment and affordability',
            factors: [
                { id: 'D1', label: 'Growth & Investment', description: 'Strong economy, abundant capital for transport innovation', mapX: 0.2, mapY: 0.3 },
                { id: 'D2', label: 'Austerity & Constraint', description: 'Tight budgets, deferred maintenance, cost-cutting focus', mapX: 0.8, mapY: 0.3 },
                { id: 'D3', label: 'Green Transition Economy', description: 'Climate-driven investment, carbon pricing, green bonds for transit', mapX: 0.5, mapY: 0.8 },
            ],
        },
        {
            id: 'sector_sample_4', letter: 'E',
            name: 'Ridership',
            description: 'How people choose to travel \u2014 preferences, habits, and demographics',
            factors: [
                { id: 'E1', label: 'Car-Dependent Culture', description: 'Private car ownership remains dominant, suburban sprawl continues', mapX: 0.2, mapY: 0.5 },
                { id: 'E2', label: 'Shared & Multimodal', description: 'MaaS subscriptions, ride-sharing, seamless mode switching', mapX: 0.8, mapY: 0.2 },
                { id: 'E3', label: 'Remote-First Reduction', description: 'Widespread remote work cuts commuting; fewer but higher-value trips', mapX: 0.5, mapY: 0.8 },
            ],
        },
    ],

    // Step 3: CCM
    ccm: {
        'A2:B1': { compatible: false, note: 'Level 4-5 autonomy requires at minimum connected infrastructure; pure car-centric roads without sensor networks cannot support fleet-scale robotaxis.' },
        'A2:C3': { compatible: false, note: 'Autonomous vehicle deployment at scale requires consistent regulatory frameworks across jurisdictions.' },
        'B2:C1': { compatible: false, note: 'Major transit expansion requires active government planning and funding, incompatible with laissez-faire.' },
        'B2:D2': { compatible: false, note: 'Large-scale rail/BRT expansion is capital-intensive and cannot happen under severe austerity.' },
        'B3:D2': { compatible: false, note: 'Adaptive infrastructure with sensor networks requires substantial ongoing investment incompatible with austerity.' },
        'C2:E1': { compatible: false, note: 'Congestion pricing and emission zones face insurmountable political opposition in a deeply car-dependent culture.' },
        'C1:D3': { compatible: false, note: 'A green transition economy with carbon pricing is inherently government-directed, contradicting laissez-faire governance.' },
        'A3:B3': { compatible: false, note: 'Smart corridors require standardized data and communication protocols; fragmented tech undermines adaptive infrastructure.' },
        'A1:E2': { compatible: false, note: 'Seamless multimodal MaaS requires advanced digital integration; incremental driver-assist technology alone cannot support it.' },
        'D2:E2': { compatible: false, note: 'Shared multimodal systems need subsidized interchanges and platform investment that austerity budgets cannot support.' },
        // Mark some compatible pairs explicitly
        'A1:B1': { compatible: true, note: 'Incremental tech is the natural companion of car-centric infrastructure.' },
        'A2:B3': { compatible: true, note: 'Autonomous vehicles thrive on smart corridor infrastructure with sensor networks.' },
        'B2:C2': { compatible: true, note: 'Transit expansion and active management reinforce each other.' },
        'C2:D3': { compatible: true, note: 'Active governance enables green transition investment through carbon pricing.' },
        'A1:D1': { compatible: true, note: 'Incremental tech improvement is the default in a growth economy.' },
        'A2:D1': { compatible: true, note: 'Autonomous breakthroughs are fueled by strong investment capital.' },
        'B2:D3': { compatible: true, note: 'Green bonds and climate investment naturally fund transit expansion.' },
    },

    // Step 3: Filter 2
    filter2: {
        'A1-B1-C1-D1-E3': { pass: false, note: 'Strong economic growth would inevitably drive some transport modernization; growth with zero change is implausible.' },
        'A3-B1-C3-D1-E1': { pass: false, note: 'Economic growth combined with triple stagnation is incoherent \u2014 capital would flow toward modernization.' },
    },

    // Step 4: Scenario lines with commitment/freedom, warningIndicators, and varied lengths
    scenarioLines: [
        {
            id: 'sl_sample_1',
            name: 'Green Acceleration',
            description: 'Climate policy and transit investment drive a rapid shift away from car dependency through multiple stages of transformation.',
            color: '#2d8a4e',
            configs: [
                { configKey: 'A1-B1-C1-D1-E1', periodLabel: 'Present', commitment: 2, freedom: 9, warningIndicator: 'First major city announces congestion pricing; federal green infrastructure bill introduced' },
                { configKey: 'A1-B1-C2-D3-E1', periodLabel: '2026\u20132028', commitment: 4, freedom: 7, warningIndicator: 'Green bond issuance for transport exceeds $50B; emission zone networks expand' },
                { configKey: 'A1-B2-C2-D3-E2', periodLabel: '2028\u20132030', commitment: 6, freedom: 5, warningIndicator: 'MaaS subscriptions surpass private car registrations in pilot cities' },
                { configKey: 'A2-B2-C2-D3-E2', periodLabel: '2030\u20132033', commitment: 7, freedom: 4, warningIndicator: 'Autonomous transit shuttles integrated into BRT networks in 20+ cities' },
                { configKey: 'A2-B3-C2-D3-E2', periodLabel: '2033\u20132035', commitment: 8, freedom: 3, warningIndicator: '' },
            ],
            narrative: 'The decade begins with the familiar status quo: incremental technology, car-centric roads, and laissez-faire governance. But a cascade of extreme weather events and mounting climate litigation forces a governance shift first. By 2027, active management takes hold as cities introduce congestion pricing and emission zones, while federal green bonds channel capital into transport.\n\nThe infrastructure follows governance. By 2029, major rail and BRT expansion is underway, funded by the green transition economy. MaaS platforms gain traction as integrated ticketing makes multimodal travel seamless. Car culture begins to erode not through force but through better alternatives.\n\nThe technology transformation comes last. By 2031, autonomous vehicles mature under consistent regulatory frameworks and integrate into the expanded transit network as last-mile connectors rather than competitors. Smart corridors emerge organically as sensor networks installed for transit management prove equally useful for autonomous fleets.\n\nBy 2035, the system is deeply committed: cities have rebuilt around transit-oriented development, autonomous shuttles, and shared mobility. Freedom of action has narrowed \u2014 the infrastructure investments are irreversible \u2014 but the environmental and equity outcomes are transformative.',
        },
        {
            id: 'sl_sample_2',
            name: 'Tech-Led Disruption',
            description: 'Autonomous vehicles and private platforms reshape cities rapidly with minimal government direction.',
            color: '#2563eb',
            configs: [
                { configKey: 'A1-B1-C1-D1-E1', periodLabel: 'Present', commitment: 2, freedom: 9, warningIndicator: 'Major tech company announces Level 4 approval in 5+ cities simultaneously' },
                { configKey: 'A2-B3-C1-D1-E1', periodLabel: '2027\u20132029', commitment: 6, freedom: 5, warningIndicator: 'Private car sales drop 20% in robotaxi-served areas; first smart corridor highway opens' },
                { configKey: 'A2-B3-C2-D1-E2', periodLabel: '2030\u20132035', commitment: 8, freedom: 3, warningIndicator: '' },
            ],
            narrative: 'This scenario begins from the same present-day starting point but follows a faster, technology-driven arc. A breakthrough in autonomous driving \u2014 not policy \u2014 is the catalyst.\n\nBy 2028, Level 4 robotaxis operate at scale across major cities. Tech companies invest in smart corridor infrastructure to support their fleets \u2014 the private sector builds what government did not. Governance remains laissez-faire as regulators struggle to keep pace. Car culture persists, but the cars increasingly drive themselves.\n\nBy the early 2030s, the sheer volume of autonomous vehicles forces cities to adopt active management. Congestion pricing becomes necessary to manage robotaxi-clogged streets. Riders shift to shared multimodal patterns by economics, not ideology: MaaS subscriptions are simply cheaper than car ownership. This is a high-commitment path \u2014 cities become dependent on a few platform providers, narrowing future options significantly.',
        },
        {
            id: 'sl_sample_3',
            name: 'Muddling Through',
            description: 'Fragmentation and austerity prevent transformation; the system drifts with minimal commitment.',
            color: '#b7791f',
            configs: [
                { configKey: 'A1-B1-C1-D1-E1', periodLabel: 'Present', commitment: 2, freedom: 9, warningIndicator: 'Economic recession hits; AV pilot programs cancelled or mothballed' },
                { configKey: 'A3-B1-C3-D2-E1', periodLabel: '2027\u20132029', commitment: 3, freedom: 8, warningIndicator: 'Remote work adoption plateaus; commuting patterns stabilize near pre-pandemic levels' },
                { configKey: 'A3-B1-C3-D2-E3', periodLabel: '2030\u20132035', commitment: 2, freedom: 9, warningIndicator: '' },
            ],
            narrative: 'The most likely scenario may be the least dramatic. An economic downturn in 2026 dries up venture capital for autonomous vehicles and cuts government infrastructure budgets. Multiple AV pilot programs are cancelled or mothballed.\n\nBy 2028, the technology landscape is fragmented \u2014 several incompatible systems compete but none achieves dominance. Governance fragments too as cities, states, and federal regulators adopt contradictory approaches. Austerity budgets mean roads are maintained but not modernized. Car dependency persists because there is no viable alternative.\n\nBy the early 2030s, a second wave of remote work adoption (driven by AI productivity tools) begins to reduce commuting demand. This is a low-commitment, high-freedom outcome \u2014 few commitments have been made, leaving maximum future flexibility but also maximum drift.',
        },
        {
            id: 'sl_sample_4',
            name: 'Equity-First Transition',
            description: 'Government-led investment prioritizes transit equity and accessibility over technological ambition.',
            color: '#7c3aed',
            configs: [
                { configKey: 'A1-B1-C1-D1-E1', periodLabel: 'Present', commitment: 2, freedom: 9, warningIndicator: 'Landmark transit equity legislation passes; federal funding tied to accessibility metrics' },
                { configKey: 'A1-B1-C2-D1-E1', periodLabel: '2026\u20132027', commitment: 3, freedom: 7, warningIndicator: 'Cities adopt congestion pricing with revenue earmarked for underserved neighborhoods' },
                { configKey: 'A1-B2-C2-D1-E1', periodLabel: '2027\u20132029', commitment: 5, freedom: 6, warningIndicator: 'BRT networks connect food deserts and job centers; ridership surges in low-income areas' },
                { configKey: 'A1-B2-C2-D1-E2', periodLabel: '2029\u20132031', commitment: 6, freedom: 5, warningIndicator: 'MaaS platforms required to serve underserved zones; digital divide programs expand' },
                { configKey: 'A1-B2-C2-D3-E2', periodLabel: '2031\u20132033', commitment: 7, freedom: 4, warningIndicator: 'Green transition economy emerges as climate and equity agendas converge' },
                { configKey: 'A2-B2-C2-D3-E2', periodLabel: '2033\u20132035', commitment: 8, freedom: 3, warningIndicator: '' },
            ],
            narrative: 'This scenario traces the slowest but most equitable path to transformation. Rather than technology or climate driving change, a political movement centered on transit equity becomes the catalyst.\n\nThe shift begins with governance: landmark legislation in 2026 ties federal transit funding to accessibility and equity metrics. Cities adopt congestion pricing but earmark revenues specifically for underserved neighborhoods. This changes the politics of transport investment fundamentally.\n\nInfrastructure investment follows, focused on connecting food deserts, job centers, and underserved communities rather than on high-tech showcase projects. BRT networks expand into areas that private companies would never serve. By 2029, ridership surges as transit becomes genuinely useful for the populations who need it most.\n\nShared mobility emerges organically from improved transit. MaaS platforms are regulated to ensure coverage of underserved areas, preventing the cream-skimming that characterized early ride-hailing. The green transition economy converges with the equity agenda by the early 2030s.\n\nAutonomous technology arrives last, in 2033, layered onto an already-transformed transit system. The technology serves the system rather than defining it. By 2035, this scenario has the highest commitment level \u2014 six successive stages of investment create deep path dependency \u2014 but delivers the broadest social benefit.',
        },
    ],

    tree: {
        periods: ['Present', '2026\u20132028', '2028\u20132030', '2030\u20132033', '2033\u20132035'],
    },

    reintroducedConfigs: [],
    filterLog: [
        { timestamp: '2026-03-15T10:00:00Z', action: 'filter2', configKey: 'A1-B1-C1-D1-E3', decision: 'REJECT', note: 'Strong economic growth would inevitably drive some transport modernization.' },
        { timestamp: '2026-03-15T10:00:00Z', action: 'filter2', configKey: 'A3-B1-C3-D1-E1', decision: 'REJECT', note: 'Economic growth combined with triple stagnation is incoherent.' },
        { timestamp: '2026-03-15T10:01:00Z', action: 'filter2', configKey: 'A1-B2-C2-D3-E2', decision: 'PASS', note: 'Green transit investment with active management and shared mobility is highly coherent.' },
        { timestamp: '2026-03-15T10:01:00Z', action: 'filter2', configKey: 'A2-B3-C2-D1-E2', decision: 'PASS', note: 'Autonomous tech with smart infrastructure and active governance forms a plausible future.' },
        { timestamp: '2026-03-15T10:01:00Z', action: 'filter2', configKey: 'A3-B1-C3-D2-E3', decision: 'PASS', note: 'Stagnation with remote work reduction is a coherent drift scenario.' },
    ],
};
