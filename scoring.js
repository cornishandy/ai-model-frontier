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
    hle: { maker: 'CAIS & Scale AI', set: 'public', size: '2,158 text questions', since: '2025-01', indep: 2, audit: -1, verdict: 'Still separates models, but the ceiling is error-laden: treat 2-point gaps as noise.' },
    gpqa: { maker: 'NYU and others (some authors at Anthropic, Cohere)', set: 'public', size: '198 questions', since: '2023-11', indep: 2, audit: -1, verdict: 'Saturated (top models at 96%, within a point): a sanity check, not a frontier comparison.' },
    critpt: { maker: '50+ academic physicists', set: 'private', size: '71 challenges', since: '2025-11', indep: 2, audit: -1, verdict: 'Superseded by CritPt v2; its hard subset replaced CritPt in the index (v5.0).' },
    omniscience: { maker: 'Artificial Analysis', set: 'private', size: '6,000 questions', since: '2025-11', indep: 2, auditNote: 'questions generated by one LLM family; the abstention reward can be gamed (the authors\' own caveats)', verdict: 'Meaningful and unsaturated; made by the index owner.' },
    omniscienceAccuracy: { maker: 'Artificial Analysis', set: 'private', size: '6,000 questions', since: '2025-11', indep: 2, verdict: 'A part of AA-Omniscience: accuracy alone, without the penalty for wrong answers.' },
    hallucination: { maker: 'Artificial Analysis', set: 'private', size: '6,000 questions', since: '2025-11', indep: 2, verdict: 'A part of AA-Omniscience: how often a model guesses instead of abstaining.' },
    ifbench: { maker: 'Ai2', set: 'public', size: '58 constraint types', since: '2025-07', indep: 2, audit: -1, verdict: 'Saturated; retired from the index.' },
    mmmuPro: { maker: 'MMMU team (academic)', set: 'public', size: '3,460 questions', since: '2024-09', indep: 2, verdict: 'Saturated at the frontier (top three within a point).' },
    aime25: { maker: 'MAA', set: 'public', size: '30 problems', since: '2025-02', indep: 2, audit: -1, verdict: 'Dead: several models score 100%.' },
    terminalBench40: { maker: 'Stanford & Laude Institute', set: 'public', size: '66 tasks (with a canary string)', since: '2026-01', indep: 2, auditNote: AUD.terminalBench40, verdict: 'Meaningful; compare scores within one harness only.' },
    terminalBench21: { maker: 'Stanford & Laude Institute', set: 'public', size: '89 tasks', since: '2025-12', indep: 2, auditNote: AUD.terminalBench21, verdict: 'Saturated (top three within 2 points); superseded by 4.0.' },
    terminalbenchHard: { maker: 'Artificial Analysis (subset of Terminal-Bench 2.0)', set: 'public', size: '44 tasks', since: '2025-10', indep: 2, auditNote: AUD.terminalbenchHard, verdict: 'Legacy; don\'t use for current models.' },
    terminalBenchScience: { maker: 'Terminal-Bench team with domain scientists', set: 'public', size: '70 tasks', since: '2026-05', indep: 2, auditNote: 'single runs in a generic harness: high variance', verdict: 'Meaningful but noisy.' },
    scicode: { maker: 'Academic consortium', set: 'public', size: '288 subproblems', since: '2024-07', indep: 2, audit: -1, verdict: 'Removed from the index in v5.0; wait for the corrected set.' },
    livecodebench: { maker: 'UC Berkeley, MIT, Cornell', set: 'rolling', size: 'contest problems, continually added', since: '2024-03', indep: 2, audit: -1, verdict: 'Saturated on the window AA uses; sound design for newer windows.' },
    tau2: { maker: 'Sierra', set: 'public', since: '2025-06', indep: 2, audit: -1, verdict: 'Dead at 99%.' },
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
    'ext:dubesorChess': { maker: 'dubesor (hobbyist)', set: 'public', since: '2025-01', indep: 2, audit: -1, auditNote: 'no methodology page; tiny samples (a handful of games per pair)', verdict: 'Not for frontier comparison.' },
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
    'ext:lmarenaText': { maker: 'Arena (company)', set: 'live', size: '8.6M votes', since: '2024-01', indep: 2, audit: -1, verdict: 'A preference signal only; the top cluster sits inside the confidence intervals.' },
    'ext:lmarenaWebdev': { maker: 'Arena (company)', set: 'live', since: '2025-05', indep: 2, audit: -1, auditNote: AUD['ext:lmarenaText'], verdict: 'Human preference on interactive web builds; useful UI/frontend signal.' },
    'ext:lmarenaVision': { maker: 'Arena (company)', set: 'live', since: '2024-06', indep: 2, audit: -1, auditNote: AUD['ext:lmarenaText'], verdict: 'Multimodal human preference signal with style control.' },
    'ext:lmarenaSearch': { maker: 'Arena (company)', set: 'live', since: '2025-03', indep: 2, audit: -1, auditNote: AUD['ext:lmarenaText'], verdict: 'Web-grounded search preference signal with style control.' },
  };
  for (const k of ['hle', 'gpqa', 'critpt', 'scicode', 'aime25', 'tau2', 'gdpval', 'ifbench', 'livecodebench', 'terminalBench21', 'terminalbenchHard', 'tauBanking', 'ext:lmarenaText', 'gdpPdf', 'apexAgents']) if (BASE_META[k] && AUD[k]) BASE_META[k].auditNote = AUD[k];

const SHAPES={"intelligence":{"frac":false,"better":"high","label":"Intelligence Index"},"myIndex":{"frac":false,"better":"high","label":"Your index"},"hleDiamond":{"frac":true,"better":"high","label":"HLE-Diamond"},"hle":{"frac":true,"better":"high","label":"Humanity's Last Exam"},"gpqa":{"frac":true,"better":"high","label":"GPQA Diamond"},"critptHard":{"frac":true,"better":"high","label":"CritPt v2 (hard)"},"critptV2":{"frac":true,"better":"high","label":"CritPt v2"},"critpt":{"frac":true,"better":"high","label":"CritPt"},"healthbench":{"frac":true,"better":"high","label":"HealthBench"},"healthbenchPro":{"frac":true,"better":"high","label":"HealthBench Professional"},"globalMmlu":{"frac":true,"better":"high","label":"Global-MMLU-Lite"},"mmluPro":{"frac":true,"better":"high","label":"MMLU-Pro"},"math500":{"frac":true,"better":"high","label":"MATH-500"},"omniscience":{"frac":false,"better":"high","label":"AA-Omniscience Index"},"omniscienceAccuracy":{"frac":true,"better":"high","label":"AA-Omniscience accuracy"},"hallucination":{"frac":true,"better":"low","label":"AA-Omniscience hallucination rate"},"ifbench":{"frac":true,"better":"high","label":"IFBench"},"mmmuPro":{"frac":true,"better":"high","label":"MMMU-Pro"},"aime25":{"frac":true,"better":"high","label":"AIME 2025"},"terminalBench40":{"frac":true,"better":"high","label":"Terminal-Bench 4.0"},"terminalBench21":{"frac":true,"better":"high","label":"Terminal-Bench 2.1"},"terminalbenchHard":{"frac":true,"better":"high","label":"Terminal-Bench Hard"},"terminalBenchScience":{"frac":true,"better":"high","label":"Terminal-Bench-Science"},"frontierCode20":{"frac":true,"better":"high","label":"FrontierCode 2.0"},"frontierCode":{"frac":true,"better":"high","label":"FrontierCode 1.1"},"code2video":{"frac":false,"better":"high","label":"Code2Video-AA (Elo)"},"aa3d":{"frac":false,"better":"high","label":"AA-3D (Elo)"},"scicode":{"frac":true,"better":"high","label":"SciCode"},"livecodebench":{"frac":true,"better":"high","label":"LiveCodeBench"},"tau2":{"frac":true,"better":"high","label":"τ²-Bench Telecom"},"tauBanking":{"frac":true,"better":"high","label":"τ³-Banking"},"automationBench":{"frac":true,"better":"high","label":"AutomationBench-AA"},"enterpriseOps":{"frac":true,"better":"high","label":"EnterpriseOps-Gym-AA"},"apexAgents":{"frac":true,"better":"high","label":"APEX-Agents-AA"},"itBench":{"frac":true,"better":"high","label":"ITBench-AA (SRE)"},"analystAgent":{"frac":true,"better":"high","label":"AA-AnalystAgent"},"cyberIndex":{"frac":false,"better":"high","label":"AA Cyber Index"},"cweBench":{"frac":true,"better":"high","label":"CWE-Bench-AA"},"deepsecBench":{"frac":true,"better":"high","label":"DeepsecBench-AA"},"cybergym":{"frac":true,"better":"high","label":"CyberGym-E2E-AA"},"decisionIndex":{"frac":false,"better":"high","label":"AA Decision Index"},"gdpval":{"frac":false,"better":"high","label":"GDPval-AA (Elo)"},"briefcase":{"frac":false,"better":"high","label":"AA-Briefcase (Elo)"},"gdpPdf":{"frac":true,"better":"high","label":"GDP.pdf"},"lcr":{"frac":true,"better":"high","label":"AA-LCR"},"mlcr":{"frac":true,"better":"high","label":"MLCR-AA (medical)"},"harvey":{"frac":true,"better":"high","label":"Harvey LAB-AA (legal)"},"capFinance":{"frac":false,"better":"high","label":"AA Finance Capability"},"capStrategy":{"frac":false,"better":"high","label":"AA Strategy & Consulting"},"capLegal":{"frac":false,"better":"high","label":"AA Legal Capability"},"capMedical":{"frac":false,"better":"high","label":"AA Medical Capability"},"capEngineering":{"frac":false,"better":"high","label":"AA Engineering Capability"},"capEconomics":{"frac":false,"better":"high","label":"AA Economics Capability"},"openness":{"frac":false,"better":"high","label":"Openness Index"},"costPerTask":{"frac":false,"better":"low","label":"Cost per task"},"myCost":{"frac":false,"better":"low","label":"Cost per task, your benchmarks"},"costToRun":{"frac":false,"better":"low","label":"Cost to run Intelligence Index"},"priceBlended":{"frac":false,"better":"low","label":"Price (blended 3:1)"},"priceInput":{"frac":false,"better":"low","label":"Input price"},"priceOutput":{"frac":false,"better":"low","label":"Output price"},"tasksPerDollar":{"frac":false,"better":"high","label":"Tasks per dollar"},"pointsPerDollar":{"frac":false,"better":"high","label":"Index points per dollar"},"planTasks":{"frac":false,"better":"high","label":"Tasks a month on your plan"},"tokensPerTask":{"frac":false,"better":"low","label":"Output tokens per task"},"outputTokens":{"frac":false,"better":"low","label":"Tokens used for Intelligence Index"},"outputSpeed":{"frac":false,"better":"high","label":"Output speed"},"ttft":{"frac":false,"better":"low","label":"Time to first answer token"},"e2eMean":{"frac":false,"better":"low","label":"End-to-end time (mean of single requests)"},"timePerTask":{"frac":false,"better":"low","label":"Time per index task"},"parameters":{"frac":false,"better":"low","label":"Parameters"}};
const metadata = () => JSON.parse(JSON.stringify(BASE_META));
function buildSnapshot(DATA, external = {sources:[]}) {
const BENCH_META=metadata(), METRICS=structuredClone(SHAPES);
for(const m of Object.values(METRICS))m.fmt=v=>String(v);
let ALL=DATA.models.map(m=>({...m,label:m.shortName}));
const BY_ID=new Map(ALL.map(m=>[m.id,m]));
const EXT=external.sources || [];
const EFFORT_LEVEL={'non-reasoning':0,minimal:10,low:20,medium:30,default:35,high:40,xhigh:50,max:60};
const EFFORT_LABEL=Object.fromEntries(Object.keys(EFFORT_LEVEL).map(e=>[e,e.charAt(0).toUpperCase()+e.slice(1)]));
const ensureEffort=()=>{};
const pct=v=>(100*v).toFixed(1)+'%',elo=v=>String(Math.round(v)),one=v=>v.toFixed(1);
  const GROUPS = {
    'Knowledge & reasoning': ['intelligence', 'myIndex', 'hleDiamond', 'hle', 'gpqa', 'critptHard', 'critptV2', 'critpt', 'omniscience', 'omniscienceAccuracy', 'hallucination', 'ifbench', 'mmmuPro', 'globalMmlu', 'mmluPro', 'aime25', 'math500'],
    'Coding & terminal': ['terminalBench40', 'frontierCode20', 'frontierCode', 'terminalBench21', 'terminalbenchHard', 'terminalBenchScience', 'scicode', 'livecodebench', 'code2video', 'aa3d'],
    'Agents & tool use': ['tau2', 'tauBanking', 'automationBench', 'enterpriseOps', 'apexAgents', 'itBench', 'analystAgent', 'cyberIndex', 'cweBench', 'deepsecBench', 'cybergym', 'decisionIndex'],
    'Work & documents': ['gdpval', 'briefcase', 'gdpPdf', 'lcr', 'mlcr', 'harvey', 'healthbench', 'healthbenchPro', 'capFinance', 'capStrategy', 'capLegal', 'capMedical', 'capEngineering', 'capEconomics', 'openness'],
    'Independent benchmarks': [], // filled from data/external.js
    'Cost': ['costPerTask', 'myCost', 'tasksPerDollar', 'pointsPerDollar', 'planTasks', 'costToRun', 'priceBlended', 'priceInput', 'priceOutput'],
    'Tokens & speed': ['tokensPerTask', 'outputTokens', 'outputSpeed', 'ttft', 'e2eMean', 'timePerTask', 'parameters'],
  };

for(const src of EXT){METRICS['ext:'+src.key]={frac:!!src.frac,better:'high',label:src.label,fmt:v=>String(v)};GROUPS['Independent benchmarks'].push('ext:'+src.key);}
const BENCH_GROUPS=Object.keys(GROUPS).filter(g=>g!=='Cost'&&g!=='Tokens & speed');
const isBench=k=>k!=='openness'&&k!=='myIndex'&&BENCH_GROUPS.some(g=>GROUPS[g].includes(k));
  function registerDynamicBenchmarks(d) {
    for (const b of d.dynamicBenchmarks || []) {
      if (AAData.isNonBenchKey(b.key) || AAData.isNonBenchKey(b.rawKey)) continue;
      if (METRICS[b.key] && !METRICS[b.key].dynamic) continue;
      METRICS[b.key] = {
        label: b.label, long: b.long || b.label,
        fmt: b.fmt === 'pct' ? pct : b.fmt === 'elo' ? elo : one,
        better: b.better || 'high', frac: !!b.frac, dynamic: true,
        desc: `Auto-discovered Artificial Analysis evaluation (${b.rawKey || b.key}).`,
      };
      const grp = GROUPS[b.group] ? b.group : 'Work & documents';
      for (const g of Object.keys(GROUPS)) if (g !== grp) {
        const idx = GROUPS[g].indexOf(b.key);
        if (idx >= 0) GROUPS[g].splice(idx, 1);
      }
      if (!GROUPS[grp].includes(b.key)) GROUPS[grp].push(b.key);
      BENCH_META[b.key] ||= { maker: 'Artificial Analysis', set: 'mixed', since: (d.scrapedAt || '').slice(0, 7) || '2026-10', indep: 2, verdict: 'Newly added Artificial Analysis evaluation.' };
    }
  }

registerDynamicBenchmarks(DATA);
  function famKey(s) {
    const t = String(s).toLowerCase().replace(/^.*\//, '').replace(/[@:].*$/, '').replace(/\(.*?\)/g, '').replace(/[\s._]+/g, '-')
      .replace(/-(20\d\d-\d\d-\d\d|20\d{6}|\d{4}|\d\d-\d\d)(?=-|$)/g, '').replace(/([a-z])(\d)/g, '$1-$2');
    const parts = t.split('-').filter(Boolean);
    return [...parts.filter((p) => /[a-z]/.test(p)), ...parts.filter((p) => !/[a-z]/.test(p))].join('-');
  }
  const DEFAULT_PICK = ['default', 'high', 'medium', 'xhigh', 'max', 'low', 'minimal', 'non-reasoning'];
  function joinExternal() {
    const famFor = new Map(), variants = new Map();
    for (const m of ALL) {
      ensureEffort(m.effort);
      (variants.get(m.family) || variants.set(m.family, []).get(m.family)).push(m);
      const k = famKey(m.family), cur = famFor.get(k) && variants.get(famFor.get(k))[0];
      if (!cur || (cur.deprecated && !m.deprecated) || (cur.deprecated === m.deprecated && (m.releaseDate || '') > (cur.releaseDate || ''))) famFor.set(k, m.family);
    }
    for (const src of EXT) {
      const got = new Map(), famsHit = new Set();
      const rows = src.rows.map((r) => ({ r, fam: famFor.get(famKey(r.fam)) })).filter((x) => x.fam);
      // A stated effort matches that variant; if AA only published other effort levels of an effort-tiered family
      // (e.g. Gemini 4 Argon has High on AA while ARC-AGI also tested Low and Medium), synthesize the missing effort variant.
      for (const { r, fam } of rows) if (r.effort) {
        ensureEffort(r.effort);
        const vs = variants.get(fam), reasoning = vs.filter((v) => v.effort !== 'non-reasoning');
        let m = vs.find((v) => v.effort === r.effort);
        if (!m && r.effort !== 'non-reasoning' && r.effort !== 'default' && reasoning.length > 0) {
          const base = reasoning.find((v) => !v.deprecated) || reasoning[0] || vs[0];
          const elab = EFFORT_LABEL[r.effort] || r.effort;
          m = {
            id: `${base.id}:${r.effort}`, slug: `${base.slug}-${r.effort}`,
            name: `${base.familyName} (${elab})`, shortName: `${base.familyName} (${elab})`, label: `${base.familyName} (${elab})`,
            creator: base.creator, creatorSlug: base.creatorSlug, creatorColor: base.creatorColor,
            family: base.family, familyName: base.familyName, releaseDate: base.releaseDate,
            effort: r.effort, effortLevel: EFFORT_LEVEL[r.effort] ?? 35, isReasoning: true,
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


joinExternal();
  let FRONTIER = [], FRESH = []; // best model of each of the top 5 families, best first; the ones too new to count
  const MISSING = new Map(); // benchmark key -> the frontier families it has no result for
  function frontierOf() {
    const best = new Map();
    for (const m of ALL) if (!m.deprecated && !m.estimated && m.intelligence != null && !(best.get(m.family)?.intelligence >= m.intelligence)) best.set(m.family, m);
    FRONTIER = [...best.values()].sort((a, b) => b.intelligence - a.intelligence).slice(0, 5);
    const newest = (f) => ALL.filter((m) => m.family === f.family).reduce((d, m) => (m.releaseDate || '') > d ? m.releaseDate : d, '');
    FRESH = FRONTIER.filter((f) => newest(f) && new Date(DATA.scrapedAt) - new Date(newest(f) + 'T00:00:00Z') < 14 * 864e5);
    MISSING.clear();
    for (const k of Object.keys(METRICS)) {
      if (!isBench(k) && !METRICS[k].costOf) continue;
      const key = METRICS[k].costOf ? 'ext:' + METRICS[k].costOf : k; // a cost follows its benchmark
      MISSING.set(k, FRONTIER.filter((f) => !FRESH.includes(f) && !ALL.some((m) => m.family === f.family && m[key] != null)));
    }
  }
  const isActive = (k) => { const miss = MISSING.get(k); return !miss || !FRONTIER.length || (!miss.includes(FRONTIER[0]) && FRONTIER.length - miss.length >= Math.min(3, FRONTIER.length)); };

frontierOf();
  function topModels(k, n = 3) {
    const low = METRICS[k].better === 'low', best = new Map();
    for (const m of ALL) {
      if (m.deprecated || m[k] == null) continue;
      const cur = best.get(m.family);
      if (!cur || (low ? m[k] < cur[k] : m[k] > cur[k])) best.set(m.family, m);
    }
    return [...best.values()].sort((a, b) => low ? a[k] - b[k] : b[k] - a[k]).slice(0, n);
  }

  const GRADE_ORDER = 'ABCDF', letterOf = (score) => score >= 9 ? 'A' : score >= 7 ? 'B' : score >= 5 ? 'C' : score >= 3 ? 'D' : 'F';
  const monthsAgo = (ym) => (Date.parse(DATA.scrapedAt) - new Date(ym + '-15T12:00:00Z')) / (30.44 * 864e5);
  function reportCard(k) {
    const B = BENCH_META[k], M = METRICS[k];
    if (!B || !M || !isBench(k)) return null;
    const top = topModels(k, 3), low = M.better === 'low', lines = [];
    let score = 0;
    const add = (pts, max, text) => { score += pts; lines.push(`${pts}/${max} · ${text}`); };
    add({ private: 2, 'semi-private': 1, rolling: 1, live: 1, mixed: 1, public: 0 }[B.set] ?? 0, 2, `test set ${B.set}${B.size ? ` (${B.size})` : ''}`);
    let sat = 1, satText = 'too few current models to judge saturation';
    if (top.length >= 2) {
      const v = top.map((m) => m[k]), spread = Math.abs(v[0] - v[v.length - 1]), rel = spread / Math.abs(v[0] || 1), pts = spread * 100;
      const ceiling = M.frac && !low && v[0] > 0.95;
      sat = ceiling || (M.frac ? pts < 2 : rel < 0.02) ? 0 : (M.frac ? pts >= 5 && v[0] < 0.8 : rel >= 0.05) ? 3 : 2;
      satText = `${sat === 0 ? 'saturated: ' : sat === 3 ? 'wide open: ' : ''}top ${top.length} current models within ${M.frac ? pts.toFixed(1) + ' points' : (rel * 100).toFixed(1) + '%'}${ceiling ? `, top score ${M.fmt(v[0])}` : ''}`;
      if (B.aboveHuman && sat > 0) { sat--; satText += '; models beat the human baseline'; }
    }
    add(sat, 3, satText);
    add(isActive(k) ? 1 : 0, 1, isActive(k) ? 'still run on the current frontier' : 'not run on the current frontier');
    add(B.indep ?? 2, 2, B.indep === 0 ? 'made and run by a frontier lab' : B.indep === 1 ? 'made by a frontier lab, run independently' : 'independent of the frontier labs');
    const live = B.set === 'rolling' || B.set === 'live', fresh = live || (B.since && monthsAgo(B.since) <= 18);
    add(fresh ? 1 : 0, 1, live ? 'refreshed continually' : `${fresh ? 'current' : 'dated'}: from ${B.since}`);
    if (B.audit) { score += B.audit; lines.push(`${B.audit > 0 ? '+1' : '−1'} · ${B.auditNote}`); } else if (B.auditNote) lines.push(`±0 · ${B.auditNote}`);
    score = Math.max(0, Math.min(10, score));
    return { score, letter: letterOf(score), lines, verdict: B.verdict, maker: B.maker };
  }

const ELO_AA=new Set(['gdpval','briefcase']),ranges=new Map(),variants=new Map(),COVER=0.75;
for(const m of ALL)(variants.get(m.family)||variants.set(m.family,[]).get(m.family)).push(m);
  function norm(k, v) {
    const M = METRICS[k];
    if (M.frac) return M.better === 'low' ? 1 - v : v;
    if (ELO_AA.has(k)) return Math.max(0, Math.min(1, (v - 500) / 2000));
    if (k === 'omniscience') return (v + 100) / 200;
    let r = ranges.get(k);
    if (!r) { const vs = ALL.map((m) => m[k]).filter((x) => x != null); r = [Math.min(...vs), Math.max(...vs)]; if (r[0] >= 0 && r[1] <= 1) r = [0, 1]; ranges.set(k, r); }
    return r[1] > r[0] ? (v - r[0]) / (r[1] - r[0]) : 0.5;
  }

  function fillGap(m, k) {
    if (!(m.intelligence > 0)) return null;
    let best = null;
    for (const o of variants.get(m.family) || []) if (o !== m && o[k] != null && o.intelligence > 0 && (!best || Math.abs(o.effortLevel - m.effortLevel) < Math.abs(best.effortLevel - m.effortLevel))) best = o;
    return best ? Math.min(1, (norm(k, best[k]) * m.intelligence) / best.intelligence) : null;
  }

const W=DATA.indexWeights || {briefcase:.15,automationBench:.05,terminalBench40:.1,frontierCode20:.15,omniscience:.15,gdpPdf:.05,hleDiamond:.1,critptHard:.1,terminalBenchScience:.15};
const parts=new Set(['intelligence','omniscienceAccuracy','hallucination']);
const keys=BENCH_GROUPS.flatMap(g=>GROUPS[g]).filter(k=>isBench(k)&&!parts.has(k)&&isActive(k)&&reportCard(k)&&['A','B'].includes(reportCard(k).letter)).map(k=>[k,W[k]??.1]);
const total=keys.reduce((a,[,w])=>a+w,0),best=new Map();
for(const m of ALL){
 if(m.deprecated||m.extOnly)continue;
 let sw=0,sv=0;const values=[],raw={};
 for(const [k,w] of keys){
  let v=m[k]!=null?norm(k,m[k]):null,donor=null;
  if(m[k]!=null)raw[k]=m[k];
  if(v==null&&m.intelligence>0){
   let b=null;for(const o of variants.get(m.family)||[])if(o!==m&&o[k]!=null&&o.intelligence>0&&(!b||Math.abs(o.effortLevel-m.effortLevel)<Math.abs(b.effortLevel-m.effortLevel)))b=o;
   v=fillGap(m,k);if(v!=null)donor=b?.id;
  }
  if(v==null||!Number.isFinite(v))continue;
  sw+=w;sv+=w*v;values.push({key:k,normalized:v,weight:w,donor});
 }
 if(!(total&&sw/total>=COVER))continue;
 const score=100*sv/sw,slug=m.creatorSlug;
 if(!best.has(slug)||score>best.get(slug).score)best.set(slug,{slug,lab:m.creator,score,model:{id:m.id,name:m.shortName,family:m.family,effort:m.effort},raw,coveredWeight:sw,contributions:values.map(v=>({...v,points:100*v.weight*v.normalized/sw}))});
}
return {v:1,scrapedAt:DATA.scrapedAt,identity:identity(DATA,external),basis:'B',fill:true,keys:keys.map(([k])=>k),weights:Object.fromEntries(keys),ranges:Object.fromEntries(ranges),rows:[...best.values()].sort((a,b)=>b.score-a.score).slice(0,5)};
}
function meaningful(value){return Array.isArray(value)?value.map(meaningful):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>!['scrapedAt','fetchedAt','stale','publication'].includes(k)).map(k=>[k,meaningful(value[k])])):value;}
function identity(data,external){const s=JSON.stringify(meaningful([data,external]));let a=2166136261,b=5381;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i);}return(a>>>0).toString(16)+(b>>>0).toString(16);}
function validBoard(b){return b?.v===1&&typeof b.identity==='string'&&Number.isFinite(Date.parse(b.scrapedAt))&&Array.isArray(b.keys)&&b.keys.every(k=>typeof k==='string')&&Array.isArray(b.rows)&&b.rows.length>=2&&b.rows.length<=5&&b.rows.every(r=>r&&typeof r.slug==='string'&&Number.isFinite(r.score)&&r.model&&typeof r.model.name==='string'&&r.raw&&Array.isArray(r.contributions));}
globalThis.FrontierScoring={buildSnapshot,metadata,meaningful,identity,validBoard};
})();
