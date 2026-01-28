import fs from "node:fs/promises";

/* ================= CONFIG ================= */

const LOTTERIES = [
  {
    key: "lao_pattana",
    name: "หวยลาวพัฒนา",
    url: "https://www.sanook.com/news/laolotto/",
  },
  {
    key: "lao_samakkee",
    name: "ลาวสามัคคี",
    url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาวสามัคคี/",
  },
  {
    key: "lao_vip",
    name: "ลาว VIP",
    url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาว-VIP/",
  },
  {
    key: "lao_star",
    name: "ลาวสตาร์",
    url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาวสตาร์/",
  },
  {
    key: "lao_extra",
    name: "ลาว Extra",
    url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาว-Extra/",
  },
  {
    key: "hanoi",
    name: "ฮานอย",
    url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยฮานอยปกติ/",
  },
];

/* ================= UTILS ================= */

function nowISO() {
  const d = new Date();
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(tz) / 60)).padStart(2, "0");
  const mm = String(Math.abs(tz) % 60).padStart(2, "0");
  return d.toISOString().replace("Z", `${sign}${hh}:${mm}`);
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      accept: "text/html",
      "accept-language": "th-TH,th;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  return await res.text();
}

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

async function callOpenAI(lottery, text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  // เลือก prompt ตาม lottery type
  const isLaoPattana = lottery.key === "lao_pattana";

  const systemPrompt = isLaoPattana
    ? `Extract Lao lottery results from the text. Return ONLY valid JSON.
Get the latest 3 draws from "ตรวจหวยลาวย้อนหลัง" section.
Each draw has: date, เลขท้าย 4 ตัว, เลขท้าย 3 ตัว, เลขท้าย 2 ตัว, and หวยลาวพัฒนา (5 two-digit numbers).`
    : "Extract lottery results. Return ONLY valid JSON. Latest 3 draws only.";

  // Schema สำหรับ lao_pattana (มี pattana_numbers)
  const laoPattanaSchema = {
    type: "object",
    additionalProperties: false,
    required: ["lottery", "source_url", "fetched_at", "draws"],
    properties: {
      lottery: { type: "string" },
      source_url: { type: "string" },
      fetched_at: { type: "string" },
      draws: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "draw_date",
            "full_number",
            "top3",
            "top2",
            "bottom2",
            "pattana_numbers",
          ],
          properties: {
            draw_date: { type: "string", description: "YYYY-MM-DD format" },
            full_number: { type: "string", description: "เลขท้าย 4 ตัว" },
            top3: { type: "string", description: "เลขท้าย 3 ตัว" },
            top2: { type: "string", description: "เลขท้าย 2 ตัว" },
            bottom2: { type: "string", description: "เลขท้าย 2 ตัว (same as top2)" },
            pattana_numbers: {
              type: "array",
              items: { type: "string" },
              description: "หวยลาวพัฒนา 5 เลข 2 หลัก",
            },
          },
        },
      },
    },
  };

  // Schema สำหรับหวยอื่น (ไม่มี pattana_numbers)
  const defaultSchema = {
    type: "object",
    additionalProperties: false,
    required: ["lottery", "source_url", "fetched_at", "draws"],
    properties: {
      lottery: { type: "string" },
      source_url: { type: "string" },
      fetched_at: { type: "string" },
      draws: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["draw_date", "full_number", "top3", "top2", "bottom2"],
          properties: {
            draw_date: { type: "string" },
            full_number: { type: "string" },
            top3: { type: "string" },
            top2: { type: "string" },
            bottom2: { type: "string" },
          },
        },
      },
    },
  };

  const body = {
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `
LOTTERY_KEY: ${lottery.key}
LOTTERY_NAME: ${lottery.name}
SOURCE_URL: ${lottery.url}
FETCHED_AT: ${nowISO()}

TEXT:
${text}
        `,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lotto_latest_3",
        schema: isLaoPattana ? laoPattanaSchema : defaultSchema,
        strict: true,
      },
    },
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t}`);
  }

  const data = await res.json();
  const textOut = data.choices?.[0]?.message?.content;

  if (!textOut) throw new Error("No output from OpenAI");
  return JSON.parse(textOut);
}

/* ================= MAIN ================= */

async function main() {
  const all = {
    updated_at: nowISO(),
    items: [],
  };

  for (const lot of LOTTERIES) {
    console.log(`Processing: ${lot.name}...`);

    try {
      const html = await fetchHtml(lot.url);
      const text = cleanText(html);

      const json = await callOpenAI(lot, text);

      // normalize ให้เหมือนกันหมด
      all.items.push({
        key: lot.key,
        name: lot.name,
        source_url: lot.url,
        fetched_at: json.fetched_at || nowISO(),
        draws: json.draws,
      });

      console.log(`✅ ${lot.name} done`);
    } catch (err) {
      console.error(`❌ ${lot.name} failed:`, err.message);
    }
  }

  // ✅ ไฟล์เดียว
  await fs.writeFile("all_latest3.json", JSON.stringify(all, null, 2), "utf8");
  console.log(`\n✅ Saved all_latest3.json with ${all.items.length} lotteries`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
