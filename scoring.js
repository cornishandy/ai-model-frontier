// Shared publication/visitor scoring. Pure per-dataset context; no browser controls or wall-clock grading.
(() => {
  const AUD = { hle: '~18–29% of bio/chem answers found wrong (FutureHouse; HLE team); physics re-grade lifts scores 47→79%', gpqa: 'paraphrased questions found in training data; dropped from the AA index (v4.2) as saturated', critpt: 'expert re-grading found reference and grader errors; Artificial Analysis marks it under review', scicode: 'SciCode-Verified found dataset defects; Artificial Analysis marks it under review', aime25: 'contest sets inflate 10–20% vs fresh problems (MathArena); dropped from the AA index (v4.0)', tau2: 'task and policy misalignments found (fixed in τ²-bench-verified, which AA doesn\'t run); replaced in the AA index (v4.1)', 'ext:lmarenaText': '"The Leaderboard Illusion" (NeurIPS 2025): private variant testing, data asymmetry, silent deprecations', gdpval: 'OpenAI\'s grader agrees with humans 66% of the time (humans with each other: 71%)', terminalBench40: 'harness-dependent: the official board, AA and Vals differ by ~5 points', gdpPdf: 'a PDF-parsing layer adds about 9 points; AA and Surge harnesses differ', apexAgents: '±5-point confidence intervals; Mercor\'s own leaderboard runs far higher', ifbench: 'dropped from the AA index (v4.1): no longer separates frontier models', livecodebench: 'dropped from the AA index (v4.0) as saturated on the window used', tauBanking: 'replaced in the AA index (v4.3) by AutomationBench', terminalBench21: 'superseded by Terminal-Bench 4.0 in the AA index (v4.3)', terminalbenchHard: 'legacy subset, replaced by Terminal-Bench 2.1 in the AA index (v4.1)' };
  const BASE_META = {
    intelligence: { maker: 'Artificial Analysis', set: 'mixed', size: '9 evaluations', since: '2026-10', indep: 2, verdict: 'The best single composite, but an editorial mix; the top is often a tie.' }, // size, since and verdict follow the data (applyIndexMakeup)
    hleDiamond: { maker: 'CAIS & Scale AI', set: 'public', size: '1,000 questions', since: '2026-10', indep: 2, verdict: 'The cleaned-up HLE; replaced HLE in the index with v5.0.' },
    critptHard: { maker: '50+ academic physicists', set: 'private', size: '40 of 70 challenges', since: '2026-10', indep: 2, auditNote: 'small n, and the subset was chosen by what frontier models failed at launch', verdict: 'Replaced CritPt in the index with v5.0; small, so noisy.' },
    critptV2: { maker: '50+ academic physicists', set: 'private', size: '70 challenges', since: '2026-10', indep: 2, verdict: 'The corrected CritPt; its hard subset is what the index uses.' },
    healthbench: { maker: 'OpenAI', set: 'public', size: '5,000 conversations', since: '2025-05', indep: 1, verdict: 'Run on few models so far.' },
    healthbenchPro: { maker: 'OpenAI', set: 'public', size: '525 conversations', since: '2026-04', indep: 1, verdict: 'Run on few models so far.' },
    globalMmlu: { maker: 'Cohere Labs and collaborators', set: 'public', since: '2024-12', indep: 2, verdict: 'Multilingual knowledge; a breadth check, not a frontier separator.' },
    mmluPro: { maker: 'TIGER-Lab (University of Waterloo)', set: 'public', size: '12,000 questions', since: '2024-06', indep: 2, verdict: 'Retired by Artificial Analysis; legacy results only.' },
    math500: { maker: 'OpenAI (subset of Hendrycks\' MATH)', set: 'public', size: '500 problems', since: '2023-05', indep: 1, verdict: 'Retired: saturated.' },
    frontierCode20: { maker: 'Cognition, with open-source maintainers', set: 'mixed', size: '132 tasks', since: '2026-10', indep: 2, auditNote: 'Artificial Analysis doesn\'t say how much of the task set is public; an LLM judge grades the rubric', verdict: 'New in the index (v5.0) at 15%; real repositories, maintainer-style grading.' },
    code2video: { maker: 'HeyGen (briefs); Artificial Analysis harness', set: 'mixed', size: '114 briefs (75 private)', since: '2026-10', indep: 2, auditNote: 'judged by a Gemini model, head to head', verdict: 'New; a design-in-code test judged by a model.' },
    aa3d: { maker: 'Artificial Analysis', set: 'live', since: '2026-10', indep: 2, verdict: 'New; human blind votes on 3D scenes built in code.' },
    cweBench: { maker: 'Collinear; run by Artificial Analysis', set: 'mixed', since: '2026-07', indep: 2, verdict: 'Part of the Cyber Index; run on few models.' },
    deepsecBench: { maker: 'Vercel; run by Artificial Analysis', set: 'mixed', since: '2026-07', indep: 2, verdict: 'Part of the Cyber Index; run on few models.' },
    cybergym: { maker: 'UC Berkeley RDI; run by Artificial Analysis', set: 'public', since: '2026-07', indep: 2, verdict: 'Part of the Cyber Index; run on few models.' },
    hle: { maker: 'CAIS & Scale AI', set: 'public', size: '2,158 text questions', since: '2025-01', indep: 2, verdict: 'Still separates models, but the ceiling is error-laden: treat 2-point gaps as noise.' },
    gpqa: { maker: 'NYU and others (some authors at Anthropic, Cohere)', set: 'public', size: '198 questions', since: '2023-11', indep: 2, verdict: 'Saturated (top models at 96%, within a point): a sanity check, not a frontier comparison.' },
    critpt: { maker: '50+ academic physicists', set: 'private', size: '71 challenges', since: '2025-11', indep: 2, verdict: 'Superseded by CritPt v2; its hard subset replaced CritPt in the index (v5.0).' },
    omniscience: { maker: 'Artificial Analysis', set: 'private', size: '6,000 questions', since: '2025-11', indep: 2, auditNote: 'questions generated by one LLM family; the abstention reward can be gamed (the authors\' own caveats)', verdict: 'Meaningful and unsaturated; made by the index owner.' },
    omniscienceAccuracy: { maker: 'Artificial Analysis', set: 'private', size: '6,000 questions', since: '2025-11', indep: 2, verdict: 'A part of AA-Omniscience: accuracy alone, without the penalty for wrong answers.' },
    hallucination: { maker: 'Artificial Analysis', set: 'private', size: '6,000 questions', since: '2025-11', indep: 2, verdict: 'A part of AA-Omniscience: how often a model guesses instead of abstaining.' },
    ifbench: { maker: 'Ai2', set: 'public', size: '58 constraint types', since: '2025-07', indep: 2, verdict: 'Saturated; retired from the index.' },
    mmmuPro: { maker: 'MMMU team (academic)', set: 'public', size: '3,460 questions', since: '2024-09', indep: 2, verdict: 'Saturated at the frontier (top three within a point).' },
    aime25: { maker: 'MAA', set: 'public', size: '30 problems', since: '2025-02', indep: 2, verdict: 'Dead: several models score 100%.' },
    terminalBench40: { maker: 'Stanford & Laude Institute', set: 'public', size: '66 tasks (with a canary string)', since: '2026-01', indep: 2, auditNote: AUD.terminalBench40, verdict: 'Meaningful; compare scores within one harness only.' },
    terminalBench21: { maker: 'Stanford & Laude Institute', set: 'public', size: '89 tasks', since: '2025-12', indep: 2, auditNote: AUD.terminalBench21, verdict: 'Saturated (top three within 2 points); superseded by 4.0.' },
    terminalbenchHard: { maker: 'Artificial Analysis (subset of Terminal-Bench 2.0)', set: 'public', size: '44 tasks', since: '2025-10', indep: 2, auditNote: AUD.terminalbenchHard, verdict: 'Legacy; don\'t use for current models.' },
    terminalBenchScience: { maker: 'Terminal-Bench team with domain scientists', set: 'public', size: '70 tasks', since: '2026-05', indep: 2, auditNote: 'single runs in a generic harness: high variance', verdict: 'Meaningful but noisy.' },
    scicode: { maker: 'Academic consortium', set: 'public', size: '288 subproblems', since: '2024-07', indep: 2, verdict: 'Removed from the index in v5.0; wait for the corrected set.' },
    livecodebench: { maker: 'UC Berkeley, MIT, Cornell', set: 'rolling', size: 'contest problems, continually added', since: '2024-03', indep: 2, verdict: 'Saturated on the window AA uses; sound design for newer windows.' },
    tau2: { maker: 'Sierra', set: 'public', since: '2025-06', indep: 2, verdict: 'Dead at 99%.' },
    tauBanking: { maker: 'Sierra, run privately by Artificial Analysis', set: 'private', size: '97 tasks', since: '2025-12', indep: 2, auditNote: AUD.tauBanking, verdict: 'Unsaturated but the top is bunched; no longer in the index.' },
    automationBench: { maker: 'Zapier', set: 'private', size: '657 held-out tasks', since: '2026-04', indep: 2, verdict: 'Meaningful: an 8-point spread at the top.' },
    enterpriseOps: { maker: 'ServiceNow', set: 'public', size: '1,150 tasks', since: '2026-02', indep: 2, verdict: 'Unsaturated, but the top is bunched within a point.' },
    apexAgents: { maker: 'Mercor', set: 'public', size: '452 tasks', since: '2026-01', indep: 2, auditNote: AUD.apexAgents, verdict: 'Meaningful but harness-sensitive.' },
    itBench: { maker: 'IBM', set: 'semi-private', size: '40 public + 19 held-out incidents', since: '2026-02', indep: 2, verdict: 'Meaningful, narrow (Kubernetes root cause only, small n).' },
    analystAgent: { maker: 'Artificial Analysis', set: 'private', size: '80 questions, pass on all 5 attempts', since: '2026-03', indep: 2, verdict: 'Meaningful, small (wide confidence intervals).' },
    gdpval: { maker: 'OpenAI (dataset); Artificial Analysis harness and LLM judge', set: 'public', size: '220 gold tasks', since: '2025-09', indep: 1, auditNote: AUD.gdpval, verdict: 'Meaningful, with lab-made data and LLM-judge caveats.' },
    briefcase: { maker: 'Artificial Analysis', set: 'private', size: '91 tasks in 4 scenarios', since: '2026-06', indep: 2, auditNote: 'new in 2026 and not yet audited; LLM-judged; 15% of the index', verdict: 'Promising, unaudited.' },
    gdpPdf: { maker: 'Surge AI', set: 'public', size: '100 tasks (4,592 pages)', since: '2026-03', indep: 2, auditNote: AUD.gdpPdf, verdict: 'Meaningful; judge- and parsing-sensitive.' },
    lcr: { maker: 'Artificial Analysis', set: 'public', size: '100 questions', since: '2025-08', indep: 2, verdict: 'Nearing saturation: 69% to 89% in a year.' },
    mlcr: { maker: 'Wisedocs', set: 'private', size: '60 questions, 3-judge panel', since: '2026-04', indep: 2, auditNote: 'regraded 21 Oct 2026 (prompt and three-judge panel; 15 of 60 references refined); synthetic cases; concision auto-fails', verdict: 'Meaningful, narrow. A pass needs both completeness and accuracy.' },
    harvey: { maker: 'Harvey (legal; OpenAI-backed)', set: 'private', size: '120 tasks', since: '2026-05', indep: 2, auditNote: 'a single LLM rubric judge; the all-pass rate is tiny, so it\'s noisy', verdict: 'Meaningful for legal work; wide confidence intervals.' },
    'ext:weirdml': { maker: 'Håvard Tveit Ihle (independent)', set: 'private', size: '11 hidden tasks', since: '2026-07', indep: 2, auditNote: 'small n, single author', verdict: 'Meaningful, low n; a wide spread at the top.' },
    'ext:weirdml2': { maker: 'Håvard Tveit Ihle (independent)', set: 'semi-private', size: '17 tasks (6 public)', since: '2025-02', indep: 2, verdict: 'Saturated (a tie at 92.9); use v3.' },
    'ext:llmChess': { maker: 'Maxim Saplin (independent)', set: 'public', since: '2024-11', indep: 2, auditNote: 'Elo is anchored by weak opponents (random, Komodo ≤1000), so the ceiling is low', verdict: 'Niche; weak discrimination at the frontier.' },
    'ext:gameArena': { maker: 'Google DeepMind & Kaggle', set: 'live', since: '2025-08', indep: 0, auditNote: 'the owner\'s model tops its own board', verdict: 'Interesting, with a conflict-of-interest caveat; chess only.' },
    'ext:dubesorChess': { maker: 'dubesor (hobbyist)', set: 'public', since: '2025-01', indep: 2, auditNote: 'no methodology page; tiny samples (a handful of games per pair)', verdict: 'Not for frontier comparison.' },
    frontierCode: { maker: 'Cognition, with open-source maintainers', set: 'mixed', since: '2026-06', indep: 2, verdict: 'Superseded by FrontierCode 2.0.' },
    cyberIndex: { maker: 'Artificial Analysis', set: 'private', since: '2026-07', indep: 2, verdict: 'Composite cybersecurity index; separates frontier models well.' },
    decisionIndex: { maker: 'Artificial Analysis', set: 'live', since: '2026-08', indep: 2, verdict: 'Composite strategic decision-making score across interactive environments.' },
    capFinance: { maker: 'Artificial Analysis', set: 'mixed', since: '2026-06', indep: 2, verdict: 'Domain composite for financial analysis work.' },
    capStrategy: { maker: 'Artificial Analysis', set: 'mixed', since: '2026-06', indep: 2, verdict: 'Domain composite for strategy and consulting work.' },
    capLegal: { maker: 'Artificial Analysis', set: 'mixed', since: '2026-06', indep: 2, verdict: 'Domain composite for legal reasoning and deliverables.' },
    capMedical: { maker: 'Artificial Analysis', set: 'mixed', since: '2026-06', indep: 2, verdict: 'Domain composite for clinical and medical reasoning.' },
    capEngineering: { maker: 'Artificial Analysis', set: 'mixed', since: '2026-06', indep: 2, verdict: 'Domain composite for software and engineering tasks.' },
    capEconomics: { maker: 'Artificial Analysis', set: 'mixed', since: '2026-06', indep: 2, verdict: 'Domain composite for economic analysis.' },
    'ext:arcAgi3': { maker: 'ARC Prize Foundation', set: 'semi-private', since: '2026-03', indep: 2, verdict: 'The live interactive visual reasoning frontier; wide spread at the top.' },
    'ext:arcAgi2': { maker: 'ARC Prize Foundation', set: 'semi-private', since: '2025-03', indep: 2, verdict: 'Near-saturated (93–95% at the top); ARC-AGI-3 is the live one.' },
    'ext:gameArenaWerewolf': { maker: 'Google DeepMind & Kaggle', set: 'live', since: '2026-02', indep: 0, verdict: 'Multi-agent social deduction in Game Arena; lab-hosted caveat.' },
    'ext:simpleBench': { maker: 'Philip (AI Explained) & Hemang (independent)', set: 'private', size: '200+ questions (10 public)', since: '2024-10', indep: 2, aboveHuman: true, auditNote: 'the human baseline is 9 people, and models now beat it', verdict: 'Past its ceiling; low value now.' },
    'ext:lmarenaText': { maker: 'Arena (company)', set: 'live', size: '8.6M votes', since: '2024-01', indep: 2, verdict: 'A preference signal only; the top cluster sits inside the confidence intervals.' },
    'ext:lmarenaWebdev': { maker: 'Arena (company)', set: 'live', since: '2025-05', indep: 2, auditNote: AUD['ext:lmarenaText'], verdict: 'Human preference on interactive web builds; useful UI/frontend signal.' },
    'ext:lmarenaVision': { maker: 'Arena (company)', set: 'live', since: '2024-06', indep: 2, auditNote: AUD['ext:lmarenaText'], verdict: 'Multimodal human preference signal with style control.' },
    'ext:lmarenaSearch': { maker: 'Arena (company)', set: 'live', since: '2025-03', indep: 2, auditNote: AUD['ext:lmarenaText'], verdict: 'Web-grounded search preference signal with style control.' },
  };
  for (const k of ['hle', 'gpqa', 'critpt', 'scicode', 'aime25', 'tau2', 'gdpval', 'ifbench', 'livecodebench', 'terminalBench21', 'terminalbenchHard', 'tauBanking', 'ext:lmarenaText', 'gdpPdf', 'apexAgents']) if (BASE_META[k] && AUD[k]) BASE_META[k].auditNote = AUD[k];

const SHAPES={"intelligence":{"frac":false,"better":"high","label":"Intelligence Index"},"myIndex":{"frac":false,"better":"high","label":"Your index"},"hleDiamond":{"frac":true,"better":"high","label":"HLE-Diamond"},"hle":{"frac":true,"better":"high","label":"Humanity's Last Exam"},"gpqa":{"frac":true,"better":"high","label":"GPQA Diamond"},"critptHard":{"frac":true,"better":"high","label":"CritPt v2 (hard)"},"critptV2":{"frac":true,"better":"high","label":"CritPt v2"},"critpt":{"frac":true,"better":"high","label":"CritPt"},"healthbench":{"frac":true,"better":"high","label":"HealthBench"},"healthbenchPro":{"frac":true,"better":"high","label":"HealthBench Professional"},"globalMmlu":{"frac":true,"better":"high","label":"Global-MMLU-Lite"},"mmluPro":{"frac":true,"better":"high","label":"MMLU-Pro"},"math500":{"frac":true,"better":"high","label":"MATH-500"},"omniscience":{"frac":false,"better":"high","label":"AA-Omniscience Index"},"omniscienceAccuracy":{"frac":true,"better":"high","label":"AA-Omniscience accuracy"},"hallucination":{"frac":true,"better":"low","label":"AA-Omniscience hallucination rate"},"ifbench":{"frac":true,"better":"high","label":"IFBench"},"mmmuPro":{"frac":true,"better":"high","label":"MMMU-Pro"},"aime25":{"frac":true,"better":"high","label":"AIME 2025"},"terminalBench40":{"frac":true,"better":"high","label":"Terminal-Bench 4.0"},"terminalBench21":{"frac":true,"better":"high","label":"Terminal-Bench 2.1"},"terminalbenchHard":{"frac":true,"better":"high","label":"Terminal-Bench Hard"},"terminalBenchScience":{"frac":true,"better":"high","label":"Terminal-Bench-Science"},"frontierCode20":{"frac":true,"better":"high","label":"FrontierCode 2.0"},"frontierCode":{"frac":true,"better":"high","label":"FrontierCode 1.1"},"code2video":{"frac":false,"better":"high","label":"Code2Video-AA (Elo)"},"aa3d":{"frac":false,"better":"high","label":"AA-3D (Elo)"},"scicode":{"frac":true,"better":"high","label":"SciCode"},"livecodebench":{"frac":true,"better":"high","label":"LiveCodeBench"},"tau2":{"frac":true,"better":"high","label":"τ²-Bench Telecom"},"tauBanking":{"frac":true,"better":"high","label":"τ³-Banking"},"automationBench":{"frac":true,"better":"high","label":"AutomationBench-AA"},"enterpriseOps":{"frac":true,"better":"high","label":"EnterpriseOps-Gym-AA"},"apexAgents":{"frac":true,"better":"high","label":"APEX-Agents-AA"},"itBench":{"frac":true,"better":"high","label":"ITBench-AA (SRE)"},"analystAgent":{"frac":true,"better":"high","label":"AA-AnalystAgent"},"cyberIndex":{"frac":false,"better":"high","label":"AA Cyber Index"},"cweBench":{"frac":true,"better":"high","label":"CWE-Bench-AA"},"deepsecBench":{"frac":true,"better":"high","label":"DeepsecBench-AA"},"cybergym":{"frac":true,"better":"high","label":"CyberGym-E2E-AA"},"decisionIndex":{"frac":false,"better":"high","label":"AA Decision Index"},"gdpval":{"frac":false,"better":"high","label":"GDPval-AA (Elo)"},"briefcase":{"frac":false,"better":"high","label":"AA-Briefcase (Elo)"},"gdpPdf":{"frac":true,"better":"high","label":"GDP.pdf"},"lcr":{"frac":true,"better":"high","label":"AA-LCR"},"mlcr":{"frac":true,"better":"high","label":"MLCR-AA (medical)"},"harvey":{"frac":true,"better":"high","label":"Harvey LAB-AA (legal)"},"capFinance":{"frac":false,"better":"high","label":"AA Finance Capability"},"capStrategy":{"frac":false,"better":"high","label":"AA Strategy & Consulting"},"capLegal":{"frac":false,"better":"high","label":"AA Legal Capability"},"capMedical":{"frac":false,"better":"high","label":"AA Medical Capability"},"capEngineering":{"frac":false,"better":"high","label":"AA Engineering Capability"},"capEconomics":{"frac":false,"better":"high","label":"AA Economics Capability"},"openness":{"frac":false,"better":"high","label":"Openness Index"},"costPerTask":{"frac":false,"better":"low","label":"Cost per task"},"myCost":{"frac":false,"better":"low","label":"Cost per task, your benchmarks"},"costToRun":{"frac":false,"better":"low","label":"Cost to run Intelligence Index"},"priceBlended":{"frac":false,"better":"low","label":"Price (blended 3:1)"},"priceInput":{"frac":false,"better":"low","label":"Input price"},"priceOutput":{"frac":false,"better":"low","label":"Output price"},"tasksPerDollar":{"frac":false,"better":"high","label":"Tasks per dollar"},"pointsPerDollar":{"frac":false,"better":"high","label":"Index points per dollar"},"planTasks":{"frac":false,"better":"high","label":"Tasks a month on your plan"},"tokensPerTask":{"frac":false,"better":"low","label":"Output tokens per task"},"outputTokens":{"frac":false,"better":"low","label":"Tokens used for Intelligence Index"},"outputSpeed":{"frac":false,"better":"high","label":"Output speed"},"ttft":{"frac":false,"better":"low","label":"Time to first answer token"},"e2eMean":{"frac":false,"better":"low","label":"End-to-end time (mean of single requests)"},"timePerTask":{"frac":false,"better":"low","label":"Time per index task"},"parameters":{"frac":false,"better":"low","label":"Parameters"}};
const GRADING_VERSION = 2;
const metadata = () => JSON.parse(JSON.stringify(BASE_META));
const EFFORT_LEVEL={'non-reasoning':0,minimal:10,low:20,medium:30,default:35,high:40,xhigh:50,max:60};
const EFFORT_LABEL=Object.fromEntries(Object.keys(EFFORT_LEVEL).map(e=>[e,e.charAt(0).toUpperCase()+e.slice(1)]));

  function famKey(s) {
    const t = String(s).toLowerCase().replace(/^.*\//, '').replace(/[@:].*$/, '').replace(/\(.*?\)/g, '').replace(/[\s._]+/g, '-')
      .replace(/-(20\d\d-\d\d-\d\d|20\d{6}|\d{4}|\d\d-\d\d)(?=-|$)/g, '').replace(/([a-z])(\d)/g, '$1-$2');
    const parts = t.split('-').filter(Boolean);
    return [...parts.filter((p) => /[a-z]/.test(p)), ...parts.filter((p) => !/[a-z]/.test(p))].join('-');
  }
  const DEFAULT_PICK = ['default', 'high', 'medium', 'xhigh', 'max', 'low', 'minimal', 'non-reasoning'];
  function joinExternal(ALL, EXT, { effortLevels = EFFORT_LEVEL, effortLabels = EFFORT_LABEL, ensureEffort = () => {}, inheritResults = false } = {}) {
    const BY_ID = new Map(ALL.map(m => [m.id, m]));
    const famFor = new Map(), variants = new Map();
    for (const m of ALL) {
      ensureEffort(m.effort);
      (variants.get(m.family) || variants.set(m.family, []).get(m.family)).push(m);
      const k = famKey(m.family), cur = famFor.get(k) && variants.get(famFor.get(k))[0];
      if (!cur || (cur.deprecated && !m.deprecated) || (cur.deprecated === m.deprecated && (m.releaseDate || '') > (cur.releaseDate || ''))) famFor.set(k, m.family);
    }
    for (const src of EXT) {
      const got = new Map(), famsHit = new Set();
      const rows = (src.rows || []).map((r) => ({ r, fam: famFor.get(famKey(r.fam)) })).filter((x) => x.fam);
      // A stated effort matches that variant; if AA only published other effort levels of an effort-tiered family
      // (e.g. Gemini 4 Argon has High on AA while ARC-AGI also tested Low and Medium), synthesize the missing effort variant.
      for (const { r, fam } of rows) if (r.effort) {
        ensureEffort(r.effort);
        const vs = variants.get(fam), reasoning = vs.filter((v) => v.effort !== 'non-reasoning');
        let m = vs.find((v) => v.effort === r.effort);
        if (!m && r.effort !== 'non-reasoning' && r.effort !== 'default' && reasoning.length > 0) {
          const base = reasoning.find((v) => !v.deprecated) || reasoning[0] || vs[0];
          const elab = effortLabels[r.effort] || r.effort;
          m = {
            ...(inheritResults ? base : {}),
            ext: inheritResults ? { ...base.ext } : {},
            id: `${base.id}:${r.effort}`, slug: `${base.slug}-${r.effort}`,
            name: `${base.familyName} (${elab})`, shortName: `${base.familyName} (${elab})`, label: `${base.familyName} (${elab})`,
            creator: base.creator, creatorSlug: base.creatorSlug, creatorColor: base.creatorColor,
            family: base.family, familyName: base.familyName, releaseDate: base.releaseDate,
            effort: r.effort, effortLevel: effortLevels[r.effort] ?? 35, isReasoning: true,
            openWeights: base.openWeights, deprecated: base.deprecated, defaultSelected: false,
            estimated: true, extOnly: true, intelligence: null,
            priceInput: base.priceInput, priceOutput: base.priceOutput, priceBlended: base.priceBlended,
          };
          ALL.push(m); BY_ID.set(m.id, m); vs.push(m);
        } else if (!m && r.effort !== 'non-reasoning' && reasoning.length === 1) m = reasoning[0];
        if (m && !got.has(m.id)) { got.set(m.id, r); famsHit.add(fam); }
      }
      // No effort stated (the source ran its default): the family's default variant, unless the family already has a match.
      for (const { r, fam } of rows) if (!r.effort && !famsHit.has(fam)) {
        const vs = variants.get(fam).filter((v) => !got.has(v.id));
        const m = DEFAULT_PICK.map((e) => vs.find((v) => v.effort === e && !v.deprecated) || vs.find((v) => v.effort === e)).find(Boolean);
        if (m) { got.set(m.id, { ...r, guessed: true }); famsHit.add(fam); }
      }
      for (const [id, r] of got) {
        const m = BY_ID.get(id);
        m['ext:' + src.key] = r.value; (m.ext ||= {})[src.key] = r;
        if (src.cost && r.cost != null) m['ext:' + src.cost.key] = r.cost;
      }
    }
  }


const GRADING_LABELS = {
  deterministic: 'Deterministic',
  hybrid: 'Hybrid',
  'multi-judge': 'Multi-judge',
  'human-judge': 'Human judge',
  'single-llm-judge': 'Single-LLM judge',
  'crowd-votes': 'Crowd votes',
};

// Every non-zero auditPenalty is strictly on-menu (0 | -8 | -15 | -25) AND cites a traceable source in scoring.js AUD/BASE_META.
const V2_EXTRA = {
  intelligence:          { role: 'composite',    grading: 'hybrid',           tasks: null, scale: 'index100', auditPenalty: 0 },
  hleDiamond:            { role: 'atomic',       grading: 'hybrid',           tasks: 1000, scale: 'pct' },
  critptHard:            { role: 'subcomponent', grading: 'deterministic',    tasks: 40,   scale: 'pct', parent: 'critptV2', subsetNote: '40 failed-at-launch subset of CritPt v2 (kept in AA v5)' },
  critptV2:              { role: 'atomic',       grading: 'deterministic',    tasks: 70,   scale: 'pct' },
  critpt:                { role: 'atomic',       grading: 'deterministic',    tasks: 71,   scale: 'pct', supersededBy: 'critptV2' },
  healthbench:           { role: 'atomic',       grading: 'single-llm-judge', tasks: 5000, scale: 'pct' },
  healthbenchPro:        { role: 'atomic',       grading: 'single-llm-judge', tasks: 525,  scale: 'pct' },
  globalMmlu:            { role: 'atomic',       grading: 'deterministic',    tasks: 6000, scale: 'pct' },
  mmluPro:               { role: 'atomic',       grading: 'deterministic',    tasks: 12000,scale: 'pct', retired: true },
  math500:               { role: 'atomic',       grading: 'deterministic',    tasks: 500,  scale: 'pct', retired: true },
  frontierCode20:        { role: 'atomic',       grading: 'hybrid',           tasks: 132,  scale: 'pct' },
  frontierCode:          { role: 'atomic',       grading: 'hybrid',           tasks: null, scale: 'pct', supersededBy: 'frontierCode20' },
  code2video:            { role: 'atomic',       grading: 'single-llm-judge', tasks: 114,  scale: 'elo' },
  aa3d:                  { role: 'atomic',       grading: 'crowd-votes',      tasks: null, scale: 'elo' },
  cweBench:              { role: 'atomic',       grading: 'deterministic',    tasks: 120,  scale: 'pct' },
  deepsecBench:          { role: 'atomic',       grading: 'deterministic',    tasks: null, scale: 'pct' },
  cybergym:              { role: 'atomic',       grading: 'deterministic',    tasks: 1507, scale: 'pct' },
  hle:                   { role: 'atomic',       grading: 'hybrid',           tasks: 2158, scale: 'pct', supersededBy: 'hleDiamond', auditPenalty: -15, auditCite: 'FutureHouse & HLE team bio/chem audit (~18–29% wrong answers) & physics re-grade (47→79%)', auditSource: 'scoring.js AUD.hle' },
  gpqa:                  { role: 'atomic',       grading: 'deterministic',    tasks: 198,  scale: 'pct', retired: true, auditPenalty: -15, auditCite: 'Paraphrased questions found in training data; dropped from AA Index v4.2', auditSource: 'scoring.js AUD.gpqa' },
  omniscience:           { role: 'atomic',       grading: 'hybrid',           tasks: 6000, scale: 'signed100', auditPenalty: -8, auditCite: 'AA-Omniscience authors\' caveats (Nov 2025): single-LLM question generation & gameable abstention reward', auditSource: 'scoring.js BASE_META.omniscience' },
  omniscienceAccuracy:   { role: 'subcomponent', grading: 'hybrid',           tasks: 6000, scale: 'pct', parent: 'omniscience' },
  hallucination:         { role: 'subcomponent', grading: 'hybrid',           tasks: 6000, scale: 'pct', lowerIsBetter: true, parent: 'omniscience' },
  ifbench:               { role: 'atomic',       grading: 'deterministic',    tasks: 294,  scale: 'pct', retired: true },
  mmmuPro:               { role: 'atomic',       grading: 'deterministic',    tasks: 3460, scale: 'pct' },
  aime25:                { role: 'atomic',       grading: 'deterministic',    tasks: 30,   scale: 'pct', retired: true, auditPenalty: -15, auditCite: 'MathArena study: public contest sets inflate 10–20% vs fresh problems; dropped AA Index v4.0', auditSource: 'scoring.js AUD.aime25' },
  terminalBench40:       { role: 'atomic',       grading: 'deterministic',    tasks: 66,   scale: 'pct', harnessSensitive: true },
  terminalBench21:       { role: 'atomic',       grading: 'deterministic',    tasks: 89,   scale: 'pct', supersededBy: 'terminalBench40' },
  terminalbenchHard:     { role: 'subcomponent', grading: 'deterministic',    tasks: 44,   scale: 'pct', supersededBy: 'terminalBench40', parent: 'terminalBench40' },
  terminalBenchScience:  { role: 'atomic',       grading: 'deterministic',    tasks: 70,   scale: 'pct', harnessSensitive: true },
  scicode:               { role: 'atomic',       grading: 'deterministic',    tasks: 288,  scale: 'pct', auditPenalty: -15, auditCite: 'SciCode-Verified audit found dataset defects; marked under review & removed AA Index v5.0', auditSource: 'scoring.js AUD.scicode' },
  livecodebench:         { role: 'atomic',       grading: 'deterministic',    tasks: 511,  scale: 'pct', retired: true },
  tau2:                  { role: 'atomic',       grading: 'deterministic',    tasks: 114,  scale: 'pct', retired: true, auditPenalty: -15, auditCite: 'τ²-bench-verified audit found task & policy misalignments (unadopted by AA); replaced AA Index v4.1', auditSource: 'scoring.js AUD.tau2' },
  tauBanking:            { role: 'atomic',       grading: 'deterministic',    tasks: 97,   scale: 'pct', retired: true },
  automationBench:       { role: 'atomic',       grading: 'deterministic',    tasks: 657,  scale: 'pct' },
  enterpriseOps:         { role: 'atomic',       grading: 'deterministic',    tasks: 1150, scale: 'pct' },
  apexAgents:            { role: 'atomic',       grading: 'hybrid',           tasks: 452,  scale: 'pct', harnessSensitive: true },
  itBench:               { role: 'atomic',       grading: 'deterministic',    tasks: 59,   scale: 'pct' },
  analystAgent:          { role: 'atomic',       grading: 'deterministic',    tasks: 80,   scale: 'pct' },
  gdpval:                { role: 'atomic',       grading: 'single-llm-judge', tasks: 220,  scale: 'elo', auditPenalty: -8, auditCite: 'OpenAI GDPval paper: LLM grader agrees with humans 66% vs 71% human-human', auditSource: 'scoring.js AUD.gdpval' },
  briefcase:             { role: 'atomic',       grading: 'single-llm-judge', tasks: 91,   scale: 'elo' },
  gdpPdf:                { role: 'atomic',       grading: 'single-llm-judge', tasks: 100,  scale: 'pct', harnessSensitive: true },
  lcr:                   { role: 'atomic',       grading: 'single-llm-judge', tasks: 100,  scale: 'pct' },
  mlcr:                  { role: 'atomic',       grading: 'multi-judge',      tasks: 60,   scale: 'pct' },
  harvey:                { role: 'atomic',       grading: 'single-llm-judge', tasks: 120,  scale: 'pct' },
  cyberIndex:            { role: 'composite',    grading: 'deterministic',    tasks: null, scale: 'index100', setOverride: 'mixed' },
  decisionIndex:         { role: 'composite',    grading: 'deterministic',    tasks: null, scale: 'index100' },
  capFinance:            { role: 'composite',    grading: 'hybrid',           tasks: null, scale: 'index100' },
  capStrategy:           { role: 'composite',    grading: 'hybrid',           tasks: null, scale: 'index100' },
  capLegal:              { role: 'composite',    grading: 'hybrid',           tasks: null, scale: 'index100' },
  capMedical:            { role: 'composite',    grading: 'hybrid',           tasks: null, scale: 'index100' },
  capEngineering:        { role: 'composite',    grading: 'hybrid',           tasks: null, scale: 'index100' },
  capEconomics:          { role: 'composite',    grading: 'hybrid',           tasks: null, scale: 'index100' },
  'ext:weirdml':         { role: 'atomic',       grading: 'deterministic',    tasks: 11,   scale: 'pct' },
  'ext:weirdml2':        { role: 'atomic',       grading: 'deterministic',    tasks: 17,   scale: 'pct', supersededBy: 'ext:weirdml' },
  'ext:llmChess':        { role: 'atomic',       grading: 'deterministic',    tasks: null, scale: 'elo', auditPenalty: -8, auditCite: 'Maxim Saplin LLM Chess board: Elo anchored by weak opponents (random, Komodo ≤1000)', auditSource: 'scoring.js BASE_META[ext:llmChess]' },
  'ext:gameArena':       { role: 'atomic',       grading: 'deterministic',    tasks: null, scale: 'elo' },
  'ext:dubesorChess':    { role: 'atomic',       grading: 'deterministic',    tasks: null, scale: 'elo', auditPenalty: -15, auditCite: 'Dubesor Chess board: no methodology page & tiny per-pair game counts', auditSource: 'scoring.js BASE_META[ext:dubesorChess]' },
  'ext:arcAgi3':         { role: 'atomic',       grading: 'deterministic',    tasks: null, scale: 'pct' },
  'ext:arcAgi2':         { role: 'atomic',       grading: 'deterministic',    tasks: 120,  scale: 'pct', supersededBy: 'ext:arcAgi3' },
  'ext:gameArenaWerewolf':{ role: 'atomic',      grading: 'deterministic',    tasks: null, scale: 'arb' },
  'ext:simpleBench':     { role: 'atomic',       grading: 'deterministic',    tasks: 200,  scale: 'pct', humanBaseline: 0.837 },
  'ext:lmarenaText':     { role: 'atomic',       grading: 'crowd-votes',      tasks: 5000, scale: 'elo', auditPenalty: -15, auditCite: '"The Leaderboard Illusion" (Singh et al., NeurIPS 2025): private variant testing, data asymmetry, silent deprecations', auditSource: 'scoring.js AUD[ext:lmarenaText]' },
  'ext:lmarenaWebdev':   { role: 'atomic',       grading: 'crowd-votes',      tasks: 1000, scale: 'elo', auditPenalty: -15, auditCite: '"The Leaderboard Illusion" (Singh et al., NeurIPS 2025): Arena private testing & voting asymmetry', auditSource: 'scoring.js BASE_META[ext:lmarenaWebdev]' },
  'ext:lmarenaVision':   { role: 'atomic',       grading: 'crowd-votes',      tasks: 1000, scale: 'elo', auditPenalty: -15, auditCite: '"The Leaderboard Illusion" (Singh et al., NeurIPS 2025): Arena private testing & voting asymmetry', auditSource: 'scoring.js BASE_META[ext:lmarenaVision]' },
  'ext:lmarenaSearch':   { role: 'atomic',       grading: 'crowd-votes',      tasks: 1000, scale: 'elo', auditPenalty: -15, auditCite: '"The Leaderboard Illusion" (Singh et al., NeurIPS 2025): Arena private testing & voting asymmetry', auditSource: 'scoring.js BASE_META[ext:lmarenaSearch]' },
};

function canonicalBenchLabel(key, label) {
  if (key === 'mkaClimbWsr') return 'MKA Climb WSR';
  if (key === 'vialsScore') return 'VIALS Score';
  return label || key.replace(/^ext:/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());
}

function validateAuditEntry(key, entry) {
  const { auditPenalty, auditCite, auditSource } = entry;
  if (auditPenalty != null && ![0, -8, -15, -25].includes(auditPenalty)) {
    throw new Error(`Off-menu auditPenalty on ${key}: ${auditPenalty}`);
  }
  if (!auditPenalty) return;
  const source = typeof auditSource === 'string' && auditSource.match(/^(?:wt\/)?scoring\.js (AUD|BASE_META)(?:\.([a-zA-Z0-9]+)|\[([a-zA-Z0-9:]+)\])$/);
  const register = source?.[1] === 'AUD' ? AUD : BASE_META;
  const citedKey = source?.[2] || source?.[3];
  if (typeof auditCite !== 'string' || !auditCite.trim() || citedKey !== key || !Object.hasOwn(register, citedKey)) {
    throw new Error(`Missing or untraceable auditCite/auditSource on ${key}`);
  }
}

for (const [key, entry] of Object.entries(V2_EXTRA)) validateAuditEntry(key, entry);

// Grace affects activity only. The score always uses the full frontier denominator.
function computeP5a(fMeasured, fEligible, hasLeader, totalFrontier = 5) {
  const active = totalFrontier > 0 && fEligible >= Math.min(3, totalFrontier) && fMeasured >= 1 && hasLeader;
  return { active, p5a: active ? Math.round((fMeasured / totalFrontier) * 7) : 0 };
}

function weightHundredths(weight) {
  const number = typeof weight === 'string' || typeof weight === 'number' ? Number(weight) : 0;
  const hundredths = Math.round(number * 100);
  return Number.isSafeInteger(hundredths) && hundredths > 0 ? hundredths : 0;
}

const roundWeight = weight => weightHundredths(weight) / 100;

function normalizeWeights(weights) {
  const normalized = {};
  if (!weights || typeof weights !== 'object') return normalized;
  for (const [key, raw] of Object.entries(weights)) {
    if (Object.hasOwn(Object.prototype, key)) continue;
    const weight = roundWeight(raw);
    if (weight > 0) normalized[key] = weight;
  }
  return normalized;
}

// The chart and the fitter use the same measured-weight gate and score.
function createMixDeriver(models, norm, fillGap) {
  const columns = new Map();
  return (weights, { cover = 0.75, fill = true } = {}) => {
    const entries = Object.entries(normalizeWeights(weights)).sort(([a], [b]) => a.localeCompare(b)).map(([key, weight]) => {
      if (!columns.has(key)) {
        columns.set(key, models.map(model => {
          const measured = Number.isFinite(model[key]) ? norm(key, model[key]) : null;
          return Number.isFinite(measured) ? { measured } : { estimated: fillGap(model, key) };
        }));
      }
      return [columns.get(key), weightHundredths(weight)];
    });
    if (!entries.length) return [];
    const totalH = entries.reduce((sum, [, h]) => sum + h, 0);
    const coverPct = Math.round(cover * 100);
    // Ordinary weights are safe Numbers. Preserve exact comparisons for unusually large imported weights.
    const exact = totalH <= Number.MAX_SAFE_INTEGER / 100;
    const exactTotal = exact ? null : entries.reduce((sum, [, h]) => sum + BigInt(h), 0n);
    const rows = [];
    models.forEach((model, i) => {
      let measH = 0, estH = 0, valueH = 0, exactMeasured = 0n;
      for (const [column, h] of entries) {
        const { measured, estimated } = column[i];
        if (measured != null) {
          measH += h;
          if (!exact) exactMeasured += BigInt(h);
          valueH += h * measured;
        } else if (fill && Number.isFinite(estimated)) {
          estH += h;
          valueH += h * estimated;
        }
      }
      const covered = exact ? measH * 100 >= coverPct * totalH : exactMeasured * 100n >= BigInt(coverPct) * exactTotal;
      if (covered && measH + estH > 0) {
        rows.push({ id: model.id, score: (100 * valueH) / (measH + estH), measuredPct: 100 * measH / totalH, estShare: estH / (measH + estH) });
      }
    });
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((row, i) => { row.rank = row.score === rows[i - 1]?.score ? rows[i - 1].rank : i + 1; });
    return rows;
  };
}

function frontierFor(ALL, scrapedAt) {
  const allLive = ALL.filter(m => !m.deprecated);
  const bestFam = new Map();
  for (const m of allLive) if (!m.estimated && m.intelligence != null && !(bestFam.get(m.family)?.intelligence >= m.intelligence)) bestFam.set(m.family, m);
  const FRONTIER = [...bestFam.values()].sort((a, b) => b.intelligence - a.intelligence).slice(0, 5);
  const FRESH_SET = new Set(FRONTIER.filter(f => {
    const newest = allLive.filter(m => m.family === f.family).reduce((d, m) => (m.releaseDate || '') > d ? m.releaseDate : d, '');
    return newest && (Date.parse(scrapedAt) - Date.parse(newest + 'T00:00:00Z')) < 14 * 864e5;
  }).map(f => f.family));

  return { frontier: FRONTIER, fresh: FRESH_SET };
}

function frontierCoverage(frontier, freshFamilies, measuredFamilies) {
  const measured = frontier.filter(model => measuredFamilies.has(model.family));
  const grace = frontier.filter(model => freshFamilies.has(model.family) && !measuredFamilies.has(model.family));
  const missing = frontier.filter(model => !freshFamilies.has(model.family) && !measuredFamilies.has(model.family));
  const leader = frontier[0]?.family;
  const hasLeader = measuredFamilies.has(leader) || freshFamilies.has(leader);
  return { measured, grace, missing, ...computeP5a(measured.length, measured.length + grace.length, hasLeader, frontier.length) };
}

function gradeCatalog(DATA, external = { sources: [] }) {
  const EXT = external.sources || [];
  const ALL = DATA.models.map(m => ({ ...m, ext: { ...m.ext } }));
  // Preserve the reference rubric's projection on its grading-only copy.
  joinExternal(ALL, EXT, { inheritResults: true });
  const allLive = ALL.filter(m => !m.deprecated);
  const { frontier: FRONTIER, fresh: FRESH_SET } = frontierFor(ALL, DATA.scrapedAt);
  const dynamic = (DATA.dynamicBenchmarks || []).filter(b =>
    !Object.hasOwn(Object.prototype, b.key) && !globalThis.AAData?.isNonBenchKey(b.key) && !globalThis.AAData?.isNonBenchKey(b.rawKey));
  const labels = new Map([
    ...dynamic.map(b => [b.key, canonicalBenchLabel(b.key, b.label)]),
    ...Object.entries(SHAPES).map(([k, m]) => [k, m.label]),
    ...EXT.map(src => ['ext:' + src.key, canonicalBenchLabel('ext:' + src.key, src.label || src.name)]),
  ]);
  const multiEffortFams = new Set();
  {
    const byF = new Map();
    for (const m of allLive) {
      if (m.effort && m.effort !== 'default' && m.effort !== 'non-reasoning') {
        (byF.get(m.family) || byF.set(m.family, new Set()).get(m.family)).add(m.effort);
      }
    }
    for (const [f, s] of byF) if (s.size >= 2) multiEffortFams.add(f);
  }

  const extMap = new Map(EXT.map(s => ['ext:' + s.key, s]));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const monthsAgo = ym => (Date.parse(DATA.scrapedAt) - Date.parse(ym + '-15T12:00:00Z')) / (30.44 * 864e5);
  const letterV2 = s => s >= 80 ? 'A' : s >= 65 ? 'B' : s >= 50 ? 'C' : s >= 35 ? 'D' : 'F';

  const rows = [];
  const keys = new Set([...Object.keys(BASE_META), ...EXT.map(src => 'ext:' + src.key), ...dynamic.map(b => b.key)]);
  for (const k of keys) {
    const base = BASE_META[k], X = V2_EXTRA[k];
    const B = k === 'intelligence' && DATA.index?.since ? { ...base, since: DATA.index.since.slice(0, 7) } : base;
    const label = labels.get(k) || canonicalBenchLabel(k);
    if (!B || !X) {
      rows.push({
        k, label, maker: B?.maker || extMap.get(k)?.by, verdict: B?.verdict || 'Unaudited benchmark.', letter: '—', score: null, rawSum: null, caps: [], capSummary: 'Unaudited', role: 'ungraded', eligible: false,
        eligLabel: 'Excluded (ungraded)', liveFacts: 'Auto-discovered',
        reason: 'Raw — → Unaudited → Final — · Excluded (ungraded) · Auto-discovered',
      });
      continue;
    }
    const low = !!X.lowerIsBetter;
    const ext = extMap.get(k);
    const famVals = new Map(), famEff = new Map();
    const measuredFamilies = new Set();
    // Use joined ALL rows for AA & external benchmarks alike (plus unmapped external rows for spread if a legacy board has <3 mapped live models)
    for (const m of allLive) {
      if (Number.isFinite(m[k])) {
        measuredFamilies.add(m.family);
        famVals.set(m.family, low ? Math.min(famVals.get(m.family) ?? Infinity, m[k]) : Math.max(famVals.get(m.family) ?? -Infinity, m[k]));
      }
      if (Number.isFinite(m[k]) && m.effort && m.effort !== 'default' && m.effort !== 'non-reasoning') {
        (famEff.get(m.family) || famEff.set(m.family, new Set()).get(m.family)).add(m.effort);
      }
    }
    if (ext && famVals.size < 3) {
        for (const r of ext.rows || []) {
        const fk = famKey(r.fam || r.model || r.name || '');
        if (!fk || !Number.isFinite(r.value)) continue;
        if (!famVals.has(fk)) famVals.set(fk, r.value);
        else famVals.set(fk, low ? Math.min(famVals.get(fk), r.value) : Math.max(famVals.get(fk), r.value));
      }
    }
    const vals = [...famVals.values()].sort((a, b) => low ? a - b : b - a);
    if (vals.length < 3) {
      const modelWord = vals.length === 1 ? 'model' : 'models';
      rows.push({
        k, label, maker: B?.maker || extMap.get(k)?.by, verdict: B?.verdict || 'Unaudited benchmark.', letter: '—', score: null, rawSum: null, caps: [], capSummary: 'Insufficient data (<3 models)', role: X.role, eligible: false, nFam: vals.length,
        eligLabel: 'Excluded (insufficient data)', liveFacts: `${vals.length} ${modelWord} measured`,
        reason: `Raw — → Insufficient data (<3 models) → Final — · Excluded (insufficient data) · ${vals.length} ${modelWord} measured`,
      });
      continue;
    }
    let p1 = 0, top3 = vals.slice(0, 3), top5 = vals.slice(0, Math.min(5, vals.length));
    let spread5 = 0, spread3 = 0;
    if (X.scale === 'pct' || X.scale === 'signed100' || X.scale === 'index100') {
      const norm = v => X.scale === 'pct' ? (low ? 1 - v : v) : X.scale === 'signed100' ? (v + 100) / 200 : v / 100;
      const nt3 = top3.map(norm), nt5 = top5.map(norm);
      const meanTop3 = nt3.reduce((a, b) => a + b, 0) / nt3.length;
      spread5 = Math.max(0, nt5[0] - nt5[nt5.length - 1]);
      spread3 = Math.max(0, nt3[0] - nt3[nt3.length - 1]);
      const head = clamp((1 - meanTop3) / 0.30, 0, 1);
      const disc = clamp(spread5 / 0.12, 0, 1);
      const floorGate = clamp(nt3[0] / 0.05, 0, 1);
      const spreadGate = clamp(spread5 / 0.03, 0, 1);
      p1 = (head * Math.min(floorGate, spreadGate) * 13) + (disc * 12);
      if (X.humanBaseline != null && top3[0] >= X.humanBaseline) p1 = Math.max(0, p1 - 6);
    } else if (X.scale === 'elo') {
      spread5 = Math.abs(top5[0] - top5[top5.length - 1]);
      spread3 = Math.abs(top3[0] - top3[top3.length - 1]);
      const winMargin = (1 / (1 + Math.pow(10, -spread5 / 400))) - 0.5;
      p1 = clamp(winMargin / 0.15, 0, 1) * 25;
    } else {
      const q1 = vals[Math.floor(vals.length * 0.75)], q3 = vals[Math.floor(vals.length * 0.25)];
      const iqr = Math.max(Math.abs(q3 - q1), 1e-6);
      spread5 = Math.abs(top5[0] - top5[top5.length - 1]);
      spread3 = Math.abs(top3[0] - top3[top3.length - 1]);
      p1 = clamp((spread5 / iqr) / 1.5, 0, 1) * 20;
    }
    p1 = Math.round(p1);

    const set = X.setOverride || B.set;
    const age = B.since ? Math.max(0, monthsAgo(B.since)) : 12;
    const p2 = set === 'private' ? 20 : (set === 'rolling' || set === 'live') ? 17 : (set === 'semi-private' || set === 'mixed') ? 12 : Math.round(8 - clamp(age / 18, 0, 1) * 6);
    const gMap = { deterministic: 20, hybrid: 14, 'multi-judge': 14, 'human-judge': 10, 'single-llm-judge': 9, 'crowd-votes': 6 };
    const p3 = Math.max(0, (gMap[X.grading] ?? 10) - (X.harnessSensitive ? 3 : 0));
    const p4 = B.indep === 2 ? 15 : B.indep === 1 ? 8 : 0;

    const { measured, grace, active, p5a } = frontierCoverage(FRONTIER, FRESH_SET, measuredFamilies);
    const fMeasured = measured.length, fEligible = fMeasured + grace.length;
    const meMeasured = [...famEff.entries()].filter(([f]) => multiEffortFams.has(f));
    const meMulti = meMeasured.filter(([, s]) => s.size >= 2).length;
    const p5b = meMeasured.length >= 3 ? Math.round(clamp((meMulti / meMeasured.length) / 0.5, 0, 1) * 3) : 1;
    const p5 = p5a + p5b;

    const n = X.tasks;
    const p6a = n == null ? 2 : n >= 200 ? 6 : n >= 100 ? 5 : n >= 50 ? 3 : n >= 20 ? 1 : 0;
    const p6b = (set === 'rolling' || set === 'live') ? 4 : Math.round(clamp(1 - Math.max(0, age - 6) / 18, 0, 1) * 4);
    const p6 = p6a + p6b;

    const gradingLabel = GRADING_LABELS[X.grading] || X.grading;
    const rawSum = p1 + p2 + p3 + p4 + p5 + p6;
    let score = rawSum + (X.auditPenalty || 0);
    const caps = [];
    if (X.auditPenalty) caps.push(`Audit ${X.auditPenalty}: ${X.auditCite}`);
    if (X.supersededBy || X.retired) {
      const supName = X.supersededBy ? labels.get(X.supersededBy) || canonicalBenchLabel(X.supersededBy) : null;
      score = Math.min(score - 25, 49);
      caps.push(supName ? `Superseded by ${supName} (−25, cap D 49)` : 'Retired (−25, cap D 49)');
    }
    if (B.indep === 0) {
      if (score > 64) { score = 64; caps.push('Lab-run own board (cap C 64)'); }
      else caps.push('Lab-run own board (P4=0, cap C 64)');
    }
    if (p1 <= 3 && score > 49) { score = 49; caps.push(`Severe saturation P1=${p1}/25 (cap D 49)`); }
    else if (p1 <= 6 && score > 64) { score = 64; caps.push(`Low headroom P1=${p1}/25 (cap C 64)`); }
    if (X.tasks != null && X.tasks < 20 && score > 64) { score = 64; caps.push(`Tiny sample n=${X.tasks}<20 (cap C 64)`); }
    else if (X.tasks != null && X.tasks < 50 && score > 79) { score = 79; caps.push(`Small sample n=${X.tasks}<50 (cap B 79)`); }
    if (['single-llm-judge', 'crowd-votes', 'human-judge'].includes(X.grading) && score > 79) {
      score = 79; caps.push(`${gradingLabel} (cap B 79)`);
    }
    score = clamp(Math.round(score), 0, 100);
    const letter = letterV2(score);
    const eligible = X.role === 'atomic' && !X.supersededBy && !X.retired && active;
    const exclReasons = [];
    if (X.role !== 'atomic') exclReasons.push(X.role);
    if (X.supersededBy) exclReasons.push('superseded');
    else if (X.retired) exclReasons.push('retired');
    if (!active) exclReasons.push('inactive');
    const eligLabel = eligible ? 'Eligible' : `Excluded (${exclReasons.join(', ')})`;

    const cleanZero = v => Math.abs(v) < 5e-4 ? 0 : v;
    const fmtV = v => {
      const c = cleanZero(v);
      if (X.scale === 'pct') return `${(c * 100).toFixed(1)}%`;
      if (X.scale === 'elo') return `${Math.round(c)}`;
      if (X.scale === 'arb' && Math.abs(c) < 1) return c.toFixed(3);
      return c.toFixed(1);
    };
    const graceCount = fEligible - fMeasured;
    const top3Part = !active && fMeasured === 0 ? 'top 3: — (no frontier models)' : `top 3: ${fmtV(top3[0])}–${fmtV(top3[top3.length - 1])}`;
    const liveParts = [
      `${active ? 'Active' : 'Inactive'} ${fMeasured}/${FRONTIER.length} frontier${graceCount ? ` (+${graceCount} grace)` : ''}`,
      top3Part,
      n != null ? `${n} tasks` : 'n unknown',
      caps.some(c => c.startsWith(gradingLabel)) ? null : gradingLabel,
    ].filter(Boolean);
    const liveFacts = liveParts.join(' · ');
    const capSummary = caps.length ? caps.join(' · ') : 'No caps/penalties';
    const reason = `Raw ${rawSum} → ${capSummary} → Final ${letter} ${score} · ${eligLabel} · ${liveFacts}`;
    rows.push({
      k, label, maker: B.maker, verdict: B.verdict, letter, score, rawSum, auditPenalty: X.auditPenalty || 0, auditCite: X.auditCite || null, auditSource: X.auditSource || null, caps, capSummary,
      p1, p2, p3, p4, p5, p6, role: X.role, eligible, eligLabel, sup: !!(X.supersededBy || X.retired),
      active, fMeasured, fEligible, p5a, p5b, nFam: vals.length, tasks: n, grading: X.grading, gradingLabel, set,
      top3, top5, spread3, spread5, scale: X.scale, liveFacts, reason,
    });
  }

  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

function reportCardFor(catalog, key) {
  return catalog.find(row => row.k === key) ?? null;
}

function buildSnapshot(DATA, external = { sources: [] }) {
  const METRICS = { ...SHAPES };
  const ALL = DATA.models.map(m => ({ ...m, label: m.shortName, ext: { ...m.ext } }));
  joinExternal(ALL, external.sources || []);
  for (const src of external.sources || []) METRICS['ext:' + src.key] = { frac: !!src.frac, better: 'high' };
  const ELO_AA = new Set(['gdpval', 'briefcase']), ranges = new Map(), variants = new Map();
  for (const m of ALL) (variants.get(m.family) || variants.set(m.family, []).get(m.family)).push(m);

  function norm(k, v) {
    const M = METRICS[k];
    if (M.frac) return M.better === 'low' ? 1 - v : v;
    if (ELO_AA.has(k)) return Math.max(0, Math.min(1, (v - 500) / 2000));
    if (k === 'omniscience') return (v + 100) / 200;
    let r = ranges.get(k);
    if (!r) { const vs = ALL.map((m) => m[k]).filter((x) => x != null); r = [Math.min(...vs), Math.max(...vs)]; if (r[0] >= 0 && r[1] <= 1) r = [0, 1]; ranges.set(k, r); }
    return r[1] > r[0] ? (v - r[0]) / (r[1] - r[0]) : 0.5;
  }

  function nearestDonor(model, key) {
    if (!(model.intelligence > 0)) return null;
    let best = null;
    let distance = Infinity;
    for (const other of variants.get(model.family) || []) {
      if (other === model || other[key] == null || !(other.intelligence > 0)) continue;
      const gap = Math.abs(other.effortLevel - model.effortLevel);
      if (!best || gap < distance) { best = other; distance = gap; }
    }
    return best;
  }

  const W = DATA.indexWeights || { briefcase: .15, automationBench: .05, terminalBench40: .1, frontierCode20: .15, omniscience: .15, gdpPdf: .05, hleDiamond: .1, critptHard: .1, terminalBenchScience: .15 };
  const keys = gradeCatalog(DATA, external).filter(card => card.eligible && ['A', 'B'].includes(card.letter))
    .map(card => [card.k, W[card.k] ?? 0.1]);
  const total = keys.reduce((sum, [, w]) => sum + w, 0);
  const best = new Map();
  for (const m of ALL) {
    if (m.deprecated || m.extOnly) continue;
    let coveredWeight = 0, value = 0;
    const contributions = [], raw = {};
    for (const [key, weight] of keys) {
      let normalized, donor = null;
      if (m[key] != null) {
        raw[key] = m[key];
        normalized = norm(key, m[key]);
      } else {
        const source = nearestDonor(m, key);
        if (!source) continue;
        donor = source.id;
        normalized = Math.min(1, (norm(key, source[key]) * m.intelligence) / source.intelligence);
      }
      if (!Number.isFinite(normalized)) continue;
      coveredWeight += weight; value += weight * normalized;
      contributions.push({ key, normalized, weight, donor });
    }
    if (!(total && coveredWeight / total >= 0.75)) continue;
    const score = 100 * value / coveredWeight, slug = m.creatorSlug;
    if (!best.has(slug) || score > best.get(slug).score) best.set(slug, {
      slug, lab: m.creator, score, model: { id: m.id, name: m.shortName, family: m.family, effort: m.effort },
      raw, coveredWeight, contributions: contributions.map(c => ({ ...c, points: 100 * c.weight * c.normalized / coveredWeight })),
    });
  }
  return { v: 1, rubric: GRADING_VERSION, scrapedAt: DATA.scrapedAt, identity: identity(DATA, external), basis: 'B', fill: true,
    keys: keys.map(([k]) => k), weights: Object.fromEntries(keys), ranges: Object.fromEntries(ranges),
    rows: [...best.values()].sort((a, b) => b.score - a.score).slice(0, 5),
  };
}
function meaningful(value){return Array.isArray(value)?value.map(meaningful):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>!['scrapedAt','fetchedAt','stale','publication'].includes(k)).map(k=>[k,meaningful(value[k])])):value;}
function identity(data,external){const s=JSON.stringify(meaningful([data,external]));let a=2166136261,b=5381;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i);}return(a>>>0).toString(16)+(b>>>0).toString(16);}
function validBoard(b){return b?.v===1&&typeof b.identity==='string'&&Number.isFinite(Date.parse(b.scrapedAt))&&Array.isArray(b.keys)&&b.keys.every(k=>typeof k==='string')&&Array.isArray(b.rows)&&b.rows.length>=2&&b.rows.length<=5&&b.rows.every(r=>r&&typeof r.slug==='string'&&Number.isFinite(r.score)&&r.model&&typeof r.model.name==='string'&&r.raw&&Array.isArray(r.contributions));}
globalThis.FrontierScoring = {
  GRADING_VERSION, gradeCatalog, reportCardFor, validateAuditEntry, computeP5a, canonicalBenchLabel, famKey, joinExternal, frontierFor, frontierCoverage,
  weightHundredths, roundWeight, normalizeWeights, createMixDeriver,
  buildSnapshot, metadata, meaningful, identity, validBoard,
};
})();
