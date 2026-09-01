// 확인길잡이 — LLM 보정 레이어 (2단계 위에 얹는 층, 규칙 기반 결과는 건드리지 않음)
//
// 이 함수는 규칙 기반 판정을 대체하지 않는다. 딱 두 가지만 한다:
//   1) 유형 판정 보정 (확신 없으면 규칙 결과 유지)
//   2) 상황 요약 (규칙으로는 못 만드는 자연어 1~2문장)
// 실패/타임아웃 시 { ok: false }만 반환한다 — 화면은 규칙 기반 결과로 계속 동작해야 한다.
//
// 모델 선정 메모: gemini-3.6-flash는 무료 티어 일일 할당량이 20건/일이라 심사 중
// 쉽게 소진되고, 소진되면 자정(태평양 시간)까지 복구되지 않는다(회귀 테스트 중 실제로 소진됨).
// lite 계열(gemini-3.1-flash-lite, gemini-3.5-flash-lite)은 무료 티어 제한이
// "분당 15건"으로, 소진돼도 수십 초 안에 복구된다.
//
// 3.1-flash-lite와 3.5-flash-lite 중에서는 3.1-flash-lite를 택했다. 두 모델 모두
// Netlify Functions 기본 실행 제한(10초)에 여유 있게 들어오지만(5회 실측: 3.1은
// 평균 1793ms/최대 2130ms, 3.5는 평균 1254ms/최대 1550ms — 3.5가 더 빠름), 3.5-flash-lite는
// 별도 세션에서 반복 실측한 결과 "대출 상담을 빌미로"를 "대출 상담을 빌로"처럼 음절을
// 빠뜨리는 오류를 재현성 있게 냈다(캐시 생성 시 1회, 5회 실측 시 1회). 3.1-flash-lite는
// 동일 시나리오에서 이 오류가 한 번도 나오지 않았다. 요약문은 그대로 화면에 노출되는
// 사용자 대상 텍스트라 속도 400ms 차이보다 문법 오류 재현성이 더 큰 문제로 판단했다.
// 모델을 바꿀 일이 있으면 이 상수만 바꾸면 된다.
const GEMINI_MODEL = "gemini-3.1-flash-lite";

const SYSTEM_INSTRUCTION = `당신은 금융 사기 의심 상황을 검토하는 보조 판정자입니다. 아래 규칙을 반드시 지키세요.

역할은 딱 두 가지입니다:
1. 유형 판정 보정: 규칙 기반 판정 결과와 감지된 신호 목록을 참고해, 본문 전체 맥락상 다른 유형이 더 맞다고 "확신"할 때만 보정된 유형과 근거를 제시하세요. 확신이 없으면 반드시 규칙 판정 결과를 그대로 유지하세요 (corrected: false).
2. 상황 요약: 사용자가 입력한 상황을 1~2문장으로 간결하게 요약하세요.

절대 하지 말 것:
- URL이나 메뉴 경로를 새로 만들지 마세요. 제공된 데이터에 없는 경로/링크는 언급하지 마세요.
- 건수나 비율을 계산하지 마세요. 제공된 집계값(숫자) 외의 숫자를 만들지 마세요.
- 제공되지 않은 통계, 사례, 경보 번호를 지어내지 마세요.
- 확인 대상 목록을 새로 만들지 마세요. 그것은 규칙 결과 그대로 유지되어야 합니다.

반드시 아래 JSON 형식으로만 응답하세요. 마크다운 코드펜스나 설명 문구를 붙이지 마세요.
{
  "summary": "1~2문장 상황 요약",
  "corrected": true 또는 false,
  "correctedType": "투자사기" | "대출사기" | "가상자산" | null,
  "reason": "보정했다면 그 근거 1문장, 보정하지 않았다면 빈 문자열"
}`;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false }) };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 200, body: JSON.stringify({ ok: false }) };
    }

    const { text, ruleResult } = JSON.parse(event.body || "{}");
    if (!text || !ruleResult) {
      return { statusCode: 200, body: JSON.stringify({ ok: false }) };
    }

    const userPayload = {
      본문: text,
      규칙판정유형: ruleResult.type,
      감지된신호: ruleResult.signals || [],
      확인대상: ruleResult.checks || [],
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    // gemini-3.1-flash-lite 실측 최대치는 2130ms(5회 측정) — 네트워크 지연 등 예외 상황을
    // 감안해도 8초 이내면 Netlify Functions 기본 실행 제한(무료/스타터 10초)에 여유 있게
    // 들어온다. 이 시간을 넘기면 플랫폼이 강제 종료해 502/504가 나갈 수 있으니, 그 전에
    // 우리 코드가 먼저 깔끔한 { ok:false } JSON으로 끝낸다.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: SYSTEM_INSTRUCTION },
                { text: `입력 데이터:\n${JSON.stringify(userPayload, null, 2)}` },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 429) {
        return { statusCode: 200, body: JSON.stringify({ ok: false, quotaExceeded: true }) };
      }
      return { statusCode: 200, body: JSON.stringify({ ok: false }) };
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return { statusCode: 200, body: JSON.stringify({ ok: false }) };
    }

    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ ok: false }) };
    }

    if (typeof parsed.summary !== "string") {
      return { statusCode: 200, body: JSON.stringify({ ok: false }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        summary: parsed.summary,
        corrected: Boolean(parsed.corrected) && Boolean(parsed.correctedType),
        correctedType: parsed.correctedType || null,
        reason: parsed.reason || "",
      }),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false }) };
  }
};
