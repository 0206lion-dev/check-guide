// Gemini API 연결 테스트 스크립트
// 사용법: node test-gemini.js

try {
  process.loadEnvFile(".env");
} catch (e) {
  console.error(".env 파일을 읽지 못했습니다:", e.message);
}

const API_KEY = process.env.GEMINI_API_KEY;

async function main() {
  if (!API_KEY) {
    console.error("GEMINI_API_KEY가 .env에 없습니다. 키를 추가한 뒤 다시 실행하세요.");
    process.exit(1);
  }

  console.log("=== 1. 사용 가능한 모델 목록 조회 ===");
  const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;
  try {
    const listRes = await fetch(listUrl);
    if (!listRes.ok) {
      const body = await listRes.text();
      console.error(`모델 목록 조회 실패 - HTTP ${listRes.status}`);
      console.error("응답 본문:", body);
    } else {
      const listData = await listRes.json();
      const models = (listData.models || []).map((m) => m.name);
      console.log(`모델 ${models.length}개 확인됨:`);
      for (const name of models) console.log(" -", name);
    }
  } catch (e) {
    console.error("모델 목록 조회 중 오류:", e.message);
  }

  console.log("\n=== 2. 생성 호출 순차 시도 ===");
  const CANDIDATE_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"];
  let workingModel = null;

  for (const model of CANDIDATE_MODELS) {
    console.log(`\n--- 시도: ${model} ---`);
    const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    try {
      const genRes = await fetch(genUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "안녕" }] }],
        }),
      });

      if (!genRes.ok) {
        const body = await genRes.text();
        console.error(`실패 - HTTP ${genRes.status}`);
        console.error("응답 본문:", body);
        continue;
      }

      const genData = await genRes.json();
      const text = genData.candidates?.[0]?.content?.parts?.[0]?.text;
      console.log("성공. 응답:", text ?? JSON.stringify(genData, null, 2));
      workingModel = model;
      break;
    } catch (e) {
      console.error("요청 중 오류:", e.message);
    }
  }

  if (workingModel) {
    console.log(`\n=== 동작 확인된 모델: ${workingModel} ===`);
  } else {
    console.error("\n=== 시도한 모든 모델이 실패했습니다 ===");
    process.exit(1);
  }
}

main();
