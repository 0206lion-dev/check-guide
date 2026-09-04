// 확인길잡이 — 규칙 기반 판정 로직 (2단계: LLM 없이 동작)

const TYPE_ORDER = ["투자사기", "대출사기", "가상자산"];

// 조치 3 — 신호 어휘가 전혀 없을 때의 키워드 폴백 (보도자료 문체가 아닌 일반 문장 대응)
const KEYWORD_FALLBACK = {
  투자사기: ["투자", "채권", "주식", "종목", "코인 수익", "펀드"],
  대출사기: ["대출", "한도", "신용", "급전", "상환"],
  가상자산: ["가상자산", "거래소", "코인", "지갑", "출금"],
};

// 조치 E — 이 서비스가 다루는 3개 유형(투자사기/대출사기/가상자산)의 확인 대상은
// 전부 금융위·금감원의 인가·등록 체계를 전제로 한다. 순수 부동산 매매·분양 권유는
// 그런 인가 체계 자체가 없는 영역이다 — 경보 198건 중 "부동산"이 들어간 사례는
// 1건(2024-21호)뿐이고, 그마저도 부동산 자체가 아니라 그것을 파는 "펀드"가
// 유사수신·온라인투자연계금융업인지를 묻는 사례였다(즉 금융상품으로 포장된 경우만
// 데이터에 있음). 데이터에 없는 부동산 사기 유형을 새로 만들어 억지로 커버하는 대신,
// 순수 부동산 거래로 보이면 이 서비스의 범위 밖이라는 사실을 안내한다. 펀드·신탁 등
// 금융상품 포장이 함께 언급되면(2024-21호 사례처럼) 범위 밖으로 보지 않고 평소대로
// 유형 판정을 진행한다.
const OUT_OF_SCOPE_RULES = [
  {
    name: "부동산",
    match: (text) =>
      /부동산|기획부동산|분양권|토지\s*투자/.test(text) &&
      !/펀드|신탁|조합원|리츠|REIT|온라인투자연계|P2P|유사수신|증권사/i.test(text),
    message:
      "이 서비스는 금융회사·금융상품 확인에 특화되어 있습니다. 입력하신 내용은 부동산 매매·분양 관련으로 보이며, 파인(FINE)이 조회하는 제도권 금융회사·대부업체 등록 대상에 해당하지 않아 이 서비스로는 확인해 드리기 어렵습니다. 사기가 의심되면 경찰(112)에 문의하세요.",
  },
];

// "부동산" 같은 비금융 키워드가 있어도, 리딩방·사칭·SNS 등 실제 경보 198건에서
// 집계한 데이터 기반 위험 신호가 함께 있으면 그 소재를 미끼로 한 투자·대출·가상자산
// 사기일 가능성이 크다("아파트 부동산 투자하면 110% 이익이라고 텔레그램 리딩방에서
// 나왔어요" 같은 경우 — 부동산은 미끼일 뿐 핵심 위험은 리딩방 투자사기다). 소재 키워드
// 유무로 판정이 갈리면 안 되므로, 데이터 기반 신호가 하나라도 감지되면 범위 밖 판정을
// 보류하고 정상 유형 판정 흐름으로 넘긴다. 비금융 키워드만 있고 위험 신호가 전혀 없을
// 때만 범위 밖으로 처리한다.
function detectOutOfScope(text, matchedSignals) {
  const hasDataBackedSignal = (matchedSignals || []).some((s) => s.dataBacked);
  if (hasDataBackedSignal) return null;
  return OUT_OF_SCOPE_RULES.find((r) => r.match(text)) || null;
}

// 조치 2 — 숫자 패턴 (수익률 표현은 signals.json의 '고수익'과 동일하게 취급)
const PCT_PATTERN = /(?:연|월|일|주)?\s*\d{1,3}(?:\.\d+)?\s*%/;
const MONEY_REMIT_PATTERN =
  /\d[\d,]{0,10}\s*(?:만\s*원|천\s*원|원)\s*(?:을|를)?[^.!?\n]{0,15}?(?:송금|입금|보내|이체|빌려)/;
const MONEY_AMOUNT_PATTERN = /\d[\d,]{0,10}\s*(?:만\s*원|천\s*원)/g;
const SHORT_TERM_WORD_PATTERN = /일주일|하루|며칠|한\s*달|1개월|2주|이틀|사흘/;
const REPAY_WORD_PATTERN = /갚|상환/;

// signals.json 24종은 실제 경보 198건을 집계한 "데이터 기반" 신호다.
// 아래는 페르소나 검증 과정에서 필요해 새로 정의한 "패턴 기반" 신호로,
// 경보 건수·비중 데이터는 없다. 각 항목의 source는 실제 경보 원문에서 확인한 소재를
// 인용한 것이며(임의로 지어내지 않음), UI에서도 데이터 기반 신호와 구분해 표시한다.
const PATTERN_SIGNALS = [
  {
    signal: "단기 고금리",
    dataBacked: false,
    leanType: "대출사기",
    weight: 4,
    source: "2024-14호 원문: \"신용 확인이 필요하다는 명목으로 초고금리 급전대출을 수 차례 이용하게 한 후... 10만원→7일 후 30만원 상환(연10,428.6%)\"",
    match(text) {
      const amounts = text.match(MONEY_AMOUNT_PATTERN) || [];
      const hasTwoAmounts = new Set(amounts).size >= 2;
      return hasTwoAmounts && SHORT_TERM_WORD_PATTERN.test(text) && REPAY_WORD_PATTERN.test(text);
    },
    describe() {
      return "단기간 금액 증가(짧은 기간 내 상환액 급증)";
    },
  },
  {
    signal: "선입금 요구",
    dataBacked: false,
    leanType: "대출사기",
    weight: 3,
    source: "2024-14호 원문: \"대출승인을 위해서는 거래실적 또는 신용 확인이 필요하다는 명목으로... 급전대출을 수 차례 이용하게 한 후\"",
    match(text) {
      return MONEY_REMIT_PATTERN.test(text);
    },
    describe(text) {
      const m = text.match(MONEY_REMIT_PATTERN);
      return m ? m[0] : "금액 + 송금/입금/이체 요구";
    },
  },
  {
    signal: "영업종료 사칭",
    dataBacked: false,
    leanType: "가상자산",
    weight: 3,
    source: "2024-28호 원문: \"영업종료 가상자산사업자를 사칭한 금전 편취 사기가 성행\" (제목: 영업종료로 인한 가상자산 소각? 가상자산사업자 사칭 사기를 의심하세요!)",
    match(text) {
      return /영업\s*종료|곧\s*문을\s*닫는다|문을\s*닫는다며|문을\s*닫는다고/.test(text);
    },
    describe() {
      return "영업종료를 빙자한 사업자 사칭 (2024-28호 소재)";
    },
  },
  {
    signal: "가상자산 소각 빙자",
    dataBacked: false,
    leanType: "가상자산",
    weight: 3,
    source: "2024-28호 원문: \"휴면 가상자산을 영업종료로 소각할 예정이니 가까운 시일 내 출금해야 한다는 대량문자를 발송\"",
    match(text) {
      return /소각된다는|소각할\s*예정|소각\s*예정|소각\s*된다/.test(text);
    },
    describe() {
      return "보유 자산이 소각된다는 문구로 긴급성을 조성 (2024-28호 소재)";
    },
  },
  {
    signal: "링크 유도",
    dataBacked: false,
    leanType: "가상자산",
    weight: 2,
    source: "2024-28호 원문: \"가짜 거래소 홈페이지로 유인\" — 페르소나 문장의 '링크로 들어가서'는 이 소재의 일반화된 표현으로, 알림 원문에 동일 단어가 있는 것은 아님",
    match(text) {
      return /링크로\s*들어가|링크를\s*눌러|링크에\s*접속|링크로\s*이동|링크를\s*클릭/.test(text);
    },
    describe() {
      return "문자·메시지의 링크 클릭 유도";
    },
  },
];

const state = {
  alerts: [],
  typeProfiles: {},
  signals: [],
  personas: [],
  synonyms: {},
  personaAiCache: [],
  llmRequestId: 0,
  llmSessionCache: new Map(),
  postIncident: {},
};

// LLM 호출 없이 규칙 결과만 보여줄 최소 입력 길이. 너무 짧은 입력은 요약할 내용이
// 마땅치 않고, 호출 자체를 아끼는 편이 할당량 관리에 낫다.
const MIN_TEXT_LENGTH_FOR_LLM = 20;

async function loadData() {
  const [alerts, typeProfiles, signals, personas, synonyms, personaAiCache, postIncident] = await Promise.all([
    fetch("data/alerts.json").then((r) => r.json()),
    fetch("data/type_profiles.json").then((r) => r.json()),
    fetch("data/signals.json").then((r) => r.json()),
    fetch("data/personas.json").then((r) => r.json()),
    fetch("data/signal_synonyms.json").then((r) => r.json()),
    fetch("data/persona_ai_cache.json").then((r) => r.json()),
    fetch("data/post_incident.json").then((r) => r.json()),
  ]);
  state.alerts = alerts;
  state.typeProfiles = typeProfiles;
  state.signals = signals;
  state.personas = personas;
  state.synonyms = synonyms;
  state.personaAiCache = personaAiCache;
  state.postIncident = postIncident;
}

// 페르소나 3종은 입력이 고정돼 있으므로 미리 생성해둔 LLM 응답을 재사용한다.
// (심사 중 API 호출 자체를 아끼고, 응답도 즉시 나온다) 텍스트를 조금이라도 고치면
// 더 이상 일치하지 않아 자동으로 실시간 API 호출로 넘어간다.
function findPersonaAiCache(text) {
  return state.personaAiCache.find((c) => c.scenario === text) || null;
}

function renderPersonaButtons() {
  const row = document.getElementById("persona-row");
  state.personas.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "persona-btn";
    btn.textContent = p.persona_type;
    btn.addEventListener("click", () => {
      document.getElementById("scenario-input").value = p.scenario;
    });
    row.appendChild(btn);
  });
}

// --- 1단계: 규칙 기반 판정 ---

// signals.json 원문 어휘 + 동의어 사전 + 숫자 패턴(수익률)까지 포함해 매칭한다.
// (데이터 기반 24종)
function detectDataBackedSignals(text) {
  if (!text) return [];
  const hasPct = PCT_PATTERN.test(text);
  return state.signals
    .map((s) => {
      const exact = text.includes(s.signal);
      const synonymHit = (state.synonyms[s.signal] || []).find((alt) => text.includes(alt));
      const numericHit = s.signal === "고수익" && hasPct;
      if (exact) return { ...s, dataBacked: true, matchedVia: "원문", matchedText: s.signal };
      if (synonymHit) return { ...s, dataBacked: true, matchedVia: "유사표현", matchedText: synonymHit };
      if (numericHit) return { ...s, dataBacked: true, matchedVia: "숫자 패턴", matchedText: text.match(PCT_PATTERN)[0] };
      return null;
    })
    .filter(Boolean);
}

// 패턴 기반(비데이터) 신호. signals.json에 없으므로 by_type/total_count_55가 없다.
function detectPatternSignals(text) {
  if (!text) return [];
  return PATTERN_SIGNALS.filter((p) => p.match(text)).map((p) => ({
    signal: p.signal,
    dataBacked: false,
    leanType: p.leanType,
    weight: p.weight,
    matchedVia: "패턴 추정",
    matchedText: p.describe(text),
    source: p.source,
  }));
}

function detectSignals(text) {
  return [...detectDataBackedSignals(text), ...detectPatternSignals(text)];
}

function keywordFallbackScore(text) {
  const scores = { 투자사기: 0, 대출사기: 0, 가상자산: 0 };
  const matched = { 투자사기: [], 대출사기: [], 가상자산: [] };
  TYPE_ORDER.forEach((t) => {
    KEYWORD_FALLBACK[t].forEach((kw) => {
      if (text.includes(kw)) {
        scores[t] += 1;
        matched[t].push(kw);
      }
    });
  });
  if (MONEY_REMIT_PATTERN.test(text)) {
    scores["대출사기"] += 1;
    matched["대출사기"].push("금액+송금 요구 패턴");
  }
  return { scores, matched };
}

// 동점이면 배열 순서(TYPE_ORDER)로 임의로 승자를 정하지 않고 미확정(null)으로 처리한다.
// 실제로 55건 커버리지 측정에서 이 배열 순서 편향으로 오분류된 사례가 나온 것을 보고 고쳤다
// (2025-6호: 키워드 점수 투자사기·가상자산 동률 1점 — 배열에서 먼저 나온 투자사기로 잘못
// 확정됐었다). 미확정이면 renderType/renderChecks가 이미 3개 유형 후보를 모두 보여준다.
function pickMax(scores) {
  let best = null;
  let bestScore = 0;
  let tie = false;
  TYPE_ORDER.forEach((t) => {
    if (scores[t] > bestScore) {
      bestScore = scores[t];
      best = t;
      tie = false;
    } else if (scores[t] === bestScore && bestScore > 0) {
      tie = true;
    }
  });
  return tie ? null : best;
}

// 조치 F — 배타적 키워드. "사칭" 같은 교차 유형 신호가 만드는 오분류(기획서 4장 (5))를
// 짧은 텍스트에서도 바로잡기 위해, 신호 가중합보다 우선하는 키워드를 별도로 뒀다.
// 아무 키워드나 넣지 않았다 — 55건 전수에서 각 후보 키워드가 유형별로 몇 건에 등장하는지
// 직접 세어, 표본이 5건 이상이면서 한 유형에 80% 이상(그리고 사실상 100%로 깨끗하게)
// 집중된 것만 넣었다. "가상자산"(60%)·"거래소"(75%, 그나마도 투자사기 쪽에 더 쏠림)·
// "코인"(71.4%)은 이 기준을 통과하지 못해 제외했다 — 가상자산과 투자사기가 어휘를
// 상당히 공유한다는 뜻이며, 이 사실 자체가 가상자산 정확도 문제의 원인 중 하나다.
const EXCLUSIVE_KEYWORDS = {
  대출사기: ["대출"],
  투자사기: ["주식"],
};

// 1차: 배타적 키워드가 정확히 한 유형에서만 걸리면 그걸로 즉시 확정한다(신호보다 우선).
// 2차: 아니면 신호(원문/동의어/숫자패턴) 매칭 합산 → 있으면 그걸로 판정
// 3차: 신호가 0건이면 일반 키워드 폴백 → 그것도 0건이면 판정불가
function determineType(matchedSignals, text) {
  const exclusiveHits = Object.keys(EXCLUSIVE_KEYWORDS).filter((type) =>
    EXCLUSIVE_KEYWORDS[type].some((kw) => text.includes(kw))
  );
  if (exclusiveHits.length === 1) {
    const type = exclusiveHits[0];
    return {
      type,
      totals: { 투자사기: 0, 대출사기: 0, 가상자산: 0 },
      basis: "exclusive-keyword",
      keywordsForChosenType: EXCLUSIVE_KEYWORDS[type].filter((kw) => text.includes(kw)),
    };
  }

  const signalTotals = { 투자사기: 0, 대출사기: 0, 가상자산: 0 };
  matchedSignals.forEach((sig) => {
    if (sig.dataBacked) {
      TYPE_ORDER.forEach((t) => {
        if (sig.by_type[t]) signalTotals[t] += sig.by_type[t];
      });
    } else if (sig.leanType) {
      signalTotals[sig.leanType] += sig.weight || 1;
    }
  });

  const signalBest = pickMax(signalTotals);
  const fallback = keywordFallbackScore(text);
  const fallbackBest = pickMax(fallback.scores);

  if (signalBest) {
    // 신호 기반 판정은 여러 유형에 걸친 신호(예: '사칭')의 과거 비중에 끌려갈 수 있다.
    // 본문에 특정 유형의 키워드가 뚜렷하게(2개 이상) 등장하는데 신호 기반 결과와 다르면
    // 키워드가 이 글의 실제 맥락에 더 가깝다고 보고 그쪽으로 보정한다.
    if (
      fallbackBest &&
      fallbackBest !== signalBest &&
      fallback.scores[fallbackBest] >= 2 &&
      fallback.scores[fallbackBest] > (fallback.scores[signalBest] || 0)
    ) {
      return {
        type: fallbackBest,
        totals: signalTotals,
        basis: "signal+keyword-correction",
        matchedKeywords: fallback.matched[fallbackBest],
        keywordsForChosenType: fallback.matched[fallbackBest] || [],
      };
    }
    return {
      type: signalBest,
      totals: signalTotals,
      basis: "signal",
      keywordsForChosenType: fallback.matched[signalBest] || [],
    };
  }

  if (fallbackBest) {
    return {
      type: fallbackBest,
      totals: fallback.scores,
      basis: "keyword",
      matchedKeywords: fallback.matched[fallbackBest],
      keywordsForChosenType: fallback.matched[fallbackBest] || [],
    };
  }

  return { type: null, totals: signalTotals, basis: "none", keywordsForChosenType: [] };
}

const REPORT_ONLY_KEYWORDS = ["신고센터", "불법 행위 신고", "채권추심 신고"];

function isReportOnly(check) {
  return REPORT_ONLY_KEYWORDS.some(
    (k) => check["확인대상"].includes(k) || check["서비스명"].includes(k)
  );
}

// 조치 D — URL도 없고 검증된 탐색 절차(탐색절차)도 없는 항목은 관련성이 낮아 기본 카드에서 뺀다
// (예: 투자사기의 P2P·해외 비상장주식 — 경보 본문에 "확인 방법"이라고만 적혀 있고 실제 경로를
// 이번 조사에서 확인하지 못한 항목). 단 탐색절차가 있으면 URL이 없어도 유지한다 — 가상자산사업자
// 신고 여부처럼 "검색창 없이 공지사항을 뒤져야 한다"는 절차 안내 자체가 가치 있는 경우.
function pickChecks(type) {
  const profile = state.typeProfiles[type];
  if (!profile) return [];
  const menus = profile.fine_menu_paths || [];

  const verifiable = menus.filter((m) => !isReportOnly(m));
  const reportOnly = menus.filter((m) => isReportOnly(m));

  const confirmed = verifiable.filter((m) => /^https?:\/\//.test(m.url));
  const unconfirmedWithProcedure = verifiable.filter(
    (m) => !/^https?:\/\//.test(m.url) && Array.isArray(m["탐색절차"]) && m["탐색절차"].length > 0
  );

  let picked = [...confirmed, ...unconfirmedWithProcedure];
  if (picked.length < 2) picked = [...picked, ...reportOnly];

  return picked.slice(0, 3);
}

// 조치 A — 확인 대상 종류별로 근거로 쓸 신호를 명시적으로 매핑한다.
// (이전에는 감지된 신호 중 첫 번째를 그냥 썼음 — 확인 대상과 무관한 신호가 붙는 문제가 있었다)
const CHECK_SIGNAL_RULES = [
  { match: (name) => /등록|신고/.test(name), signals: ["미신고", "무인가"] }, // 등록/신고 여부 확인
  { match: (name) => /제도권|인가/.test(name), signals: ["사칭"] }, // 제도권 인가 여부 확인
  { match: (name) => /진위|발신|매물/.test(name), signals: ["사칭", "가짜 거래소"] }, // 발신·매물 진위 확인
];

// signals.json 24종 전체(by_type)에서 찾는다. type_profiles의 top_signals는 상위 5개뿐이라
// '미신고'처럼 순위가 낮은 신호는 거기 없을 수 있기 때문에 원본 signals 배열을 직접 본다.
function findSignalCountForType(type, candidateSignalNames) {
  for (const name of candidateSignalNames) {
    const sig = state.signals.find((s) => s.signal === name);
    if (sig && sig.by_type[type]) {
      return { signal: name, count: sig.by_type[type] };
    }
  }
  return null;
}

// 조치 C — 확인 대상별로 "왜 확인해야 하나" 문구를 다르게 준다(제도적 결과가 서로 다르므로).
// 키는 fine_menu_paths의 "확인대상" 문자열과 정확히 맞춘다.
const REASON_BY_TARGET = {
  "제도권 금융회사 여부":
    "미인가 업체는 예금자보호법과 금융분쟁조정 대상에서 제외됩니다. 문제가 생겨도 법적 구제를 받기 어렵습니다.",
  "유사투자자문업자 등록 여부":
    "등록돼 있어도 특정 종목을 콕 집어 매매를 권유하거나 투자금을 대신 운용(투자일임)하는 것은 금지된 행위입니다. 등록 여부와 별개로 그 행위 자체가 위반입니다.",
  "가상자산사업자 신고 여부":
    "미신고 사업자를 이용하면 가상자산이용자보호법의 예치금 분리보관·해킹 배상 등 보호를 받지 못합니다.",
  "대부업체 등록 여부":
    "미등록 대부업자에게 받은 대출은 이자제한법상 최고금리 초과분에 대해 무효를 주장할 수 있고, 미등록 영업 자체가 형사처벌 대상입니다.",
};

// 결과 없음/있음일 때의 판단 기준도 카드마다 다르게 준다.
const JUDGMENT_BY_TARGET = {
  "제도권 금융회사 여부": {
    없음: "제도권 금융회사가 아닙니다. 거래를 중단하세요.",
    있음: "조회된 회사명이 정확히 일치하는지 확인하고, 회사 공식 대표번호로 직접 전화해 연락 사실을 확인하세요. (사칭 사기범은 실제 회사와 무관합니다)",
  },
  "유사투자자문업자 등록 여부": {
    없음: "등록된 유사투자자문업자가 아닙니다. 투자자문을 받지 마세요.",
    있음: "등록돼 있어도 개별 종목 매매를 권유했다면 그 행위 자체가 불법입니다 — 등록 여부와 별개로 신고할 수 있습니다.",
  },
  "가상자산사업자 신고 여부": {
    없음: "신고된 사업자가 아닙니다. 자산을 맡기거나 거래하지 마세요.",
    있음: "신고된 사업자라도 공지사항 명단의 정식 상호와 접속한 사이트 이름이 정확히 일치하는지 다시 확인하세요.",
  },
  "대부업체 등록 여부": {
    없음: "등록된 대부업체가 아닙니다. 대출 계약을 하지 마세요.",
    있음: "등록업체가 맞더라도 법정 최고금리(연 20%)를 초과하면 불법이니 실제 적용 금리를 꼭 확인하세요.",
  },
};

const DEFAULT_JUDGMENT = {
  없음: "제도권이 아닙니다. 거래를 중단하세요.",
  있음: "업체 공식 대표번호로 직접 전화해 연락 사실을 확인하세요. (사칭 사기범은 실제 업체와 무관합니다)",
};

function buildReason(type, check) {
  if (isReportOnly(check)) {
    return "이미 진행 중이거나 피해가 의심되는 상황이라면, 확인보다 신고가 우선입니다.";
  }

  const profile = state.typeProfiles[type];
  const total = profile ? profile.count : null;
  const period = profile ? profile.period : null;

  const targetSpecific = REASON_BY_TARGET[check["확인대상"]];
  const rule = CHECK_SIGNAL_RULES.find((r) => r.match(check["확인대상"]));
  const related = rule ? findSignalCountForType(type, rule.signals) : null;

  const base = targetSpecific || "제도권(등록)이 아니면 예금자보호·분쟁조정 대상이 아닙니다.";

  if (related && total) {
    return `${base} ${type} 경보 ${total}건 중 ${related.count}건이 '${related.signal}' 관련 사례였습니다.`;
  }
  // 매핑되는 신호가 없으면 유형 전체 건수만 근거로 쓴다(조치 A 원칙).
  if (total) {
    return `${base} ${type} 경보 ${total}건(${period})이 발령됐습니다.`;
  }
  return base;
}

function buildJudgment(check) {
  const specific = JUDGMENT_BY_TARGET[check["확인대상"]];
  return specific || DEFAULT_JUDGMENT;
}

function renderSignals(matchedSignals, typeResult) {
  const el = document.getElementById("signals-output");
  el.innerHTML = "";

  const dataBacked = matchedSignals.filter((s) => s.dataBacked);
  const patternOnly = matchedSignals.filter((s) => !s.dataBacked);

  if (matchedSignals.length === 0) {
    el.innerHTML = '<p class="no-signals">일치하는 위험 신호 표현을 찾지 못했습니다. (일반 키워드로 유형을 추정합니다)</p>';
  }

  // 경보 198건 집계에서 나온 "데이터 기반" 신호가 0건이면, 대신 무엇을 근거로
  // 판정했는지(패턴/키워드) 문장으로 설명한다. 빈 섹션으로 두지 않는다.
  if (dataBacked.length === 0) {
    const patternNames = patternOnly.map((s) => `'${s.signal}'`);
    const keywordNames = (typeResult && typeResult.keywordsForChosenType || [])
      .filter((k) => k !== "금액+송금 요구 패턴")
      .map((k) => `'${k}'`);
    const parts = [];
    if (keywordNames.length) parts.push(`${keywordNames.join(", ")} 키워드`);
    if (patternNames.length) parts.push(`${patternNames.join(", ")} 패턴`);
    if (parts.length) {
      const note = document.createElement("p");
      note.className = "judgment-basis";
      note.textContent = `판정 근거 — 입력에서 ${parts.join("와 ")}을 확인했습니다.`;
      el.appendChild(note);
    }
  }

  matchedSignals.forEach((s) => {
    const chip = document.createElement("span");
    if (s.dataBacked) {
      chip.className = "signal-chip";
      const viaTag = s.matchedVia === "원문" ? "" : ` · ${escapeHtml(s.matchedVia)}("${escapeHtml(s.matchedText)}")`;
      chip.innerHTML = `${escapeHtml(s.signal)} <span class="signal-meta">(${s.total_count_55}건 중 확인 · 주로 ${escapeHtml(s.dominant_type)}${viaTag})</span>`;
    } else {
      chip.className = "signal-chip signal-chip-pattern";
      if (s.source) chip.title = s.source;
      chip.innerHTML = `${escapeHtml(s.signal)} <span class="signal-meta">(패턴 추정 · 경보 집계 아님 · "${escapeHtml(s.matchedText)}")</span>`;
    }
    el.appendChild(chip);
  });
}

function renderType(typeResult) {
  const el = document.getElementById("type-output");
  el.innerHTML = "";
  if (!typeResult.type) {
    el.innerHTML = '<p class="type-desc">신호나 키워드가 없거나 여러 유형에 걸쳐 동률이라 유형을 확정할 수 없습니다. 아래에서 3개 유형의 확인 항목을 모두 보여드립니다 — 직접 상황에 맞는 것을 골라보세요.</p>';
    return;
  }
  const profile = state.typeProfiles[typeResult.type];
  const name = document.createElement("div");
  name.className = "type-name";
  name.textContent = typeResult.type;
  const desc = document.createElement("div");
  desc.className = "type-desc";
  let basisNote = "";
  if (typeResult.basis === "exclusive-keyword") {
    basisNote = ` (배타적 키워드 기반 확정: ${(typeResult.keywordsForChosenType || []).map((k) => `"${k}"`).join(", ")})`;
  } else if (typeResult.basis === "keyword") {
    basisNote = ` (일반 키워드 기반 추정: ${(typeResult.matchedKeywords || []).map((k) => `"${k}"`).join(", ")})`;
  } else if (typeResult.basis === "signal+keyword-correction") {
    basisNote = ` (감지된 신호는 여러 유형에 걸쳐 있어, 본문 키워드 ${(typeResult.matchedKeywords || []).map((k) => `"${k}"`).join(", ")} 기준으로 보정했습니다)`;
  }
  desc.textContent = (profile ? `${profile.period}년 ${profile.count}건 발령` : "") + basisNote;
  el.appendChild(name);
  el.appendChild(desc);
}

function buildChecksCardsHtml(type) {
  const checks = pickChecks(type);
  if (checks.length === 0) {
    return '<p class="no-signals">이 유형에 대해 확인된 조회 경로가 없습니다.</p>';
  }
  return checks
    .map((c) => {
      const hasUrl = /^https?:\/\//.test(c.url);
      const titleBadge = hasUrl ? "" : '<span class="badge-unconfirmed">URL 미확인 · 절차로 안내</span>';

      let step1;
      if (hasUrl) {
        step1 = `${escapeHtml(c["경로"])} — <a href="${c.url}" target="_blank" rel="noopener">바로가기</a>`;
      } else if (Array.isArray(c["탐색절차"]) && c["탐색절차"].length) {
        const subSteps = c["탐색절차"]
          .map((s) => `<li>${escapeHtml(s)}</li>`)
          .join("");
        const agencyNote = c["기관"] ? `<div class="agency-note">${escapeHtml(c["기관"])}</div>` : "";
        step1 = `${escapeHtml(c["경로"])}
          <div class="no-search-note">이 경로는 검색창이 없어 게시물을 직접 찾아야 합니다.</div>
          ${agencyNote}
          <ol class="sub-steps">${subSteps}</ol>`;
      } else {
        step1 = `${escapeHtml(c["경로"])} (정확한 URL 미확인 — 위 경로를 직접 방문해 확인하세요)`;
      }

      const judgment = buildJudgment(c);
      // 확인 대상 목록을 대신 조회해주는 게 아니라 "직접 확인하는 절차"를 안내하는
      // 서비스라는 원칙(가치 정의: 다음엔 혼자 할 수 있어야 한다)을 화면에도 남긴다.
      // 신고 전용 카드는 반복 학습할 "경로"가 아니라 1회성 신고 행위이므로 제외한다.
      const revisitNote = isReportOnly(c)
        ? ""
        : `<div class="revisit-note">다음에도 같은 경로로 직접 확인하실 수 있습니다.</div>`;

      return `
        <div class="check-card">
          <h3>${escapeHtml(c["확인대상"])} ${titleBadge}</h3>
          <div class="check-section">
            <div class="label">왜 확인해야 하나</div>
            <div class="why">${escapeHtml(buildReason(type, c))}</div>
          </div>
          <div class="check-section">
            <div class="label">어떻게 확인하나</div>
            <ol class="check-steps">
              <li>${step1}</li>
              <li>입력값: ${escapeHtml(c["입력값"])}</li>
              <li><div class="judgment-box">
                <p><strong>결과 없음</strong> → ${escapeHtml(judgment["없음"])}</p>
                <p><strong>결과 있음</strong> → ${escapeHtml(judgment["있음"])}</p>
              </div></li>
            </ol>
            ${revisitNote}
          </div>
        </div>`;
    })
    .join("");
}

function renderChecks(type) {
  const el = document.getElementById("checks-output");
  if (type) {
    el.innerHTML = buildChecksCardsHtml(type);
    return;
  }
  // 판정 불가: 3개 유형 전체를 보여준다
  el.innerHTML = TYPE_ORDER.map(
    (t) => `<h3 class="type-group-title">${escapeHtml(t)}</h3>${buildChecksCardsHtml(t)}`
  ).join("");
}

// 조치 B — 유사 경보 사례
// matchedSignalNames는 데이터 기반(dataBacked) 신호 이름만 받는다. 패턴 신호(단기 고금리,
// 선입금 요구, 영업종료 사칭, 가상자산 소각 빙자, 링크 유도)는 signals.json 24종이 아니라서
// alerts.json의 각 경보 signals 배열에 애초에 등장할 수 없다 — 겹침 계산에 넣으면 항상 0이라
// 의미가 없으므로 호출부(runAnalysis)에서 걸러서 넘긴다.
function renderSimilarAlertsForType(type, matchedSignalNames) {
  const alertsOfType = state.alerts.filter((a) => a.type === type);

  // 신호 1개만 겹치는 경우는 "유사 사례"로 부르기엔 근거가 약하다 — "고수익"·"사칭" 같은
  // 신호는 그 유형 전체에서 워낙 흔해(55건 중 20건 이상) 1개만 겹쳐서는 이 경보와 특별히
  // 비슷하다고 말하기 어렵다. 2개 이상 겹칠 때만 "유사 사례"로 제시하고, 그렇지 않으면
  // 최근 경보로 대체해 과장된 유사성을 주장하지 않는다.
  const MIN_OVERLAP_FOR_SIMILARITY = 2;

  const withOverlap = alertsOfType
    .map((a) => {
      const overlapSignals = (a.signals || []).filter((s) => matchedSignalNames.includes(s));
      return { alert: a, overlapSignals };
    })
    .filter((c) => c.overlapSignals.length >= MIN_OVERLAP_FOR_SIMILARITY)
    .sort((a, b) => b.overlapSignals.length - a.overlapSignals.length)
    .slice(0, 3);

  if (withOverlap.length > 0) {
    return { items: withOverlap, mode: "overlap" };
  }

  // 겹치는 신호가 기준 미만이면 "사례 없음"을 띄우지 않고, 같은 유형의 최근 경보로 대체한다.
  const recent = [...alertsOfType]
    .sort((a, b) => (b.year - a.year) || (b.no - a.no))
    .slice(0, 3)
    .map((alert) => ({ alert, overlapSignals: [] }));
  return { items: recent, mode: "recent" };
}

function renderSimilarAlerts(type, matchedSignalNames) {
  const el = document.getElementById("similar-output");
  el.innerHTML = "";

  const typesToShow = type ? [type] : TYPE_ORDER;

  typesToShow.forEach((t) => {
    const { items, mode } = renderSimilarAlertsForType(t, matchedSignalNames);
    if (items.length === 0) return; // 해당 유형에 경보 자체가 없는 경우

    if (!type) {
      const header = document.createElement("h3");
      header.className = "type-group-title";
      header.textContent = t;
      el.appendChild(header);
    }

    if (mode === "recent") {
      const note = document.createElement("p");
      note.className = "similar-mode-note";
      note.textContent = "겹치는 위험 신호는 없었지만, 같은 유형의 최근 경보입니다.";
      el.appendChild(note);
    }

    items.forEach(({ alert, overlapSignals }) => {
      const item = document.createElement("div");
      item.className = "similar-item";
      const overlapNote = overlapSignals.length
        ? `<div class="similar-overlap">겹치는 신호: ${overlapSignals.map(escapeHtml).join(", ")}</div>`
        : "";
      item.innerHTML = `<a href="${alert.url}" target="_blank" rel="noopener">${escapeHtml(alert.title)}</a>
        <div class="similar-meta">${alert.year}-${alert.no}호</div>
        ${overlapNote}`;
      el.appendChild(item);
    });
  });

  if (!el.innerHTML) {
    el.innerHTML = '<p class="no-similar">이 유형의 경보 사례가 없습니다.</p>';
  }
}

// 조회 경로·판단 기준 안내에서 끝나면 흐름이 완결되지 않는다(가치 정의: 스스로 판단할
// 수 있는 상태에 도달하는 것). 확인 결과가 "미등록·미신고"로 나왔을 때 무엇을 해야
// 하는지까지 안내해 흐름을 마무리한다. 신고 기한은 경보 원문 어디에도 명시돼 있지
// 않으므로(judgment_criteria.csv 조사 결과) 기한을 지어내지 않고 "지체 없이"라는
// 경보 원문의 표현을 그대로 쓴다. 담당부서 직통번호도 데이터에 있는 것만 쓴다 — 없으면
// 만들지 않고 표시하지 않는다.
function renderPostIncident(type) {
  const el = document.getElementById("postincident-output");
  el.innerHTML = "";

  const typesToShow = type ? [type] : TYPE_ORDER;

  typesToShow.forEach((t) => {
    const info = state.postIncident[t];

    if (!type) {
      const header = document.createElement("h3");
      header.className = "type-group-title";
      header.textContent = t;
      el.appendChild(header);
    }

    const deptNote = info
      ? `<div class="dept-contact">${escapeHtml(t)} 관련 최근 경보(${escapeHtml(info.source_alert)})에 안내된 금융감독원 담당부서: <a href="${info.source_url}" target="_blank" rel="noopener">${escapeHtml(info.dept_contact)}</a> (경보마다 담당부서가 다를 수 있습니다)</div>`
      : "";

    const block = document.createElement("div");
    block.className = "postincident-block";
    block.innerHTML = `
      <p class="postincident-lead">확인 결과가 <strong>"미등록·미신고"</strong>라면</p>
      <div class="postincident-branch">
        <div class="label">이미 송금했다면</div>
        <ul>
          <li>거래 은행에 지급정지 신청</li>
          <li>경찰 112</li>
          <li>금융감독원 1332</li>
        </ul>
      </div>
      <div class="postincident-branch">
        <div class="label">아직 송금 전이라면</div>
        <ul>
          <li>거래 중단</li>
          <li>금융감독원 불법금융신고센터 신고</li>
        </ul>
      </div>
      ${deptNote}
      <p class="postincident-caveat">※ 경보 원문에 명시적 신고 기한은 없으며 "지체 없이 신고"를 권고하고 있습니다.</p>`;
    el.appendChild(block);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- 2단계: LLM 보정 레이어 (실패해도 1단계 결과는 그대로 유지) ---

function renderSummaryLoading() {
  const el = document.getElementById("summary-output");
  el.innerHTML = '<p class="summary-loading">AI가 상황을 정리하고 있습니다...</p>';
}

function clearSummary() {
  document.getElementById("summary-output").innerHTML = "";
}

function renderQuotaNotice() {
  const el = document.getElementById("summary-output");
  el.innerHTML = '<p class="summary-quota-notice">AI 요약은 일시적으로 제공되지 않습니다</p>';
}

function renderSummary(llmResult, currentType, fromCache) {
  const el = document.getElementById("summary-output");
  el.innerHTML = "";

  if (fromCache) {
    const badge = document.createElement("div");
    badge.className = "summary-cache-badge";
    badge.textContent = "사전 생성된 예시 응답";
    el.appendChild(badge);
  }

  const summaryP = document.createElement("p");
  summaryP.className = "summary-text";
  summaryP.textContent = llmResult.summary;
  el.appendChild(summaryP);

  if (llmResult.corrected && llmResult.correctedType && llmResult.correctedType !== currentType) {
    const note = document.createElement("div");
    note.className = "summary-correction";
    note.innerHTML = `<strong>AI가 본문 해석으로 유형을 보정했습니다.</strong><br>${escapeHtml(llmResult.correctedType)} — ${escapeHtml(llmResult.reason || "")}`;
    el.appendChild(note);
  }
}

async function fetchLlmAnalysis(text, typeResult, matchedSignals) {
  try {
    const res = await fetch("/.netlify/functions/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        ruleResult: {
          type: typeResult.type,
          signals: matchedSignals.map((s) => s.signal),
          checks: pickChecks(typeResult.type).map((c) => c["확인대상"]),
        },
      }),
    });
    if (!res.ok) return { ok: false };
    return await res.json();
  } catch (e) {
    return { ok: false };
  }
}

function renderOutOfScope(rule) {
  document.getElementById("scope-notice-text").textContent = rule.message;
  document.getElementById("scope-notice").hidden = false;
}

function runAnalysis() {
  const text = document.getElementById("scenario-input").value.trim();
  const resultSection = document.getElementById("result-section");
  const emptyState = document.getElementById("empty-state");
  const scopeNotice = document.getElementById("scope-notice");

  scopeNotice.hidden = true;

  if (!text) {
    resultSection.hidden = true;
    emptyState.hidden = true;
    return;
  }

  // 조치 E: 이 서비스의 판정 대상이 아닌 사안(예: 순수 부동산 거래)은 유형 판정도
  // 확인 카드도 만들지 않고, 범위 밖이라는 사실만 정직하게 안내한다. 단, 비금융
  // 키워드가 있어도 데이터 기반 위험 신호가 함께 감지되면(소재가 미끼일 뿐인 경우)
  // 범위 밖 판정을 보류해야 하므로, 신호 탐지를 먼저 실행한 뒤 그 결과를 넘긴다.
  const matchedSignals = detectSignals(text);
  const outOfScope = detectOutOfScope(text, matchedSignals);
  if (outOfScope) {
    resultSection.hidden = true;
    emptyState.hidden = true;
    renderOutOfScope(outOfScope);
    return;
  }

  const typeResult = determineType(matchedSignals, text);

  // 조치 4: 신호·키워드가 전부 0건이라도 빈 화면 대신 3개 유형 전체를 보여준다.
  emptyState.hidden = true;
  resultSection.hidden = false;

  clearSummary();
  renderSignals(matchedSignals, typeResult);
  renderType(typeResult);
  renderChecks(typeResult.type);
  // 패턴 신호는 alerts.json에 존재할 수 없으므로 겹침 계산 전에 데이터 기반 신호만 남긴다.
  const dataBackedSignalNames = matchedSignals.filter((s) => s.dataBacked).map((s) => s.signal);
  renderSimilarAlerts(typeResult.type, dataBackedSignalNames);
  renderPostIncident(typeResult.type);

  // 규칙 기반 결과는 이미 화면에 떴다. LLM은 여기서부터 별도로, 실패해도 위 결과에 영향 없다.
  const cached = findPersonaAiCache(text);
  if (cached) {
    // 페르소나 예시는 입력이 고정돼 있어 미리 생성해둔 응답을 그대로 쓴다 — API 호출도,
    // 대기도 없다. 텍스트를 수정하면 더 이상 일치하지 않아 아래 실시간 호출로 넘어간다.
    renderSummary(cached, typeResult.type, true);
    return;
  }

  // 너무 짧은 입력은 요약할 내용이 마땅치 않다 — 호출 자체를 생략하고 규칙 결과만 둔다.
  if (text.length < MIN_TEXT_LENGTH_FOR_LLM) {
    return;
  }

  // 같은 문장을 다시 확인하면 세션 내 캐시를 그대로 쓴다 — 재호출하지 않는다.
  const sessionCached = state.llmSessionCache.get(text);
  if (sessionCached) {
    if (sessionCached.ok) {
      renderSummary(sessionCached, typeResult.type, false);
    } else if (sessionCached.quotaExceeded) {
      renderQuotaNotice();
    } else {
      clearSummary();
    }
    return;
  }

  // 응답 시간이 편차가 커서(초 단위로 변동) 대기 중 사용자가 "확인하기"를 다시 누르면 이전
  // 요청의 응답이 늦게 도착해 새 결과를 덮어쓸 수 있다 — 요청 ID로 최신 요청만 반영한다.
  renderSummaryLoading();
  const requestId = ++state.llmRequestId;
  fetchLlmAnalysis(text, typeResult, matchedSignals).then((llmResult) => {
    state.llmSessionCache.set(text, llmResult);
    if (requestId !== state.llmRequestId) return;
    if (llmResult.ok) {
      renderSummary(llmResult, typeResult.type, false);
    } else if (llmResult.quotaExceeded) {
      renderQuotaNotice();
    } else {
      clearSummary();
    }
  });
}

async function init() {
  await loadData();
  renderPersonaButtons();
  document.getElementById("analyze-btn").addEventListener("click", runAnalysis);
}

init();
