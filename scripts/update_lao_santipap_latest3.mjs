import fs from "node:fs/promises";

/* ================= CONFIG ================= */

/** เวลาที่อนุญาตให้ดึงข้อมูล (เวลาไทย) — วันละ 2 ครั้ง */
const ALLOWED_RUN_TIMES = [
  { hour: 16, minute: 30 }, // 16:30
  { hour: 21, minute: 0 },  // 21:00
];
const RUN_WINDOW_MINUTES = 5; // อนุญาตรันภายใน 5 นาทีหลังเวลาที่กำหนด

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

/** คืนค่า [ชม., นาที] ตามเวลาไทย (Asia/Bangkok) */
function getBangkokHourMin() {
  const d = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = formatter.format(d).split(":").map(Number);
  return [h, m];
}

/** เช็คว่าอยู่ในช่วงที่อนุญาตให้รัน (16:30 หรือ 21:00) หรือไม่ */
function isAllowedRunTime() {
  const [nowH, nowM] = getBangkokHourMin();
  const nowMinutes = nowH * 60 + nowM;

  for (const { hour, minute } of ALLOWED_RUN_TIMES) {
    const start = hour * 60 + minute;
    const end = start + RUN_WINDOW_MINUTES;
    if (nowMinutes >= start && nowMinutes < end) return true;
  }
  return false;
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

  const body = {
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "Extract lottery results. Return ONLY valid JSON. Latest 3 draws only.",
      },
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
        schema: {
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
                ],
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
        },
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
  // ✅ เช็คเวลาก่อน — ถ้าไม่ใช่ 16:30 หรือ 21:00 ให้ออกทันที
  const [bh, bm] = getBangkokHourMin();
  if (!isAllowedRunTime()) {
    console.log(
      `⏸ ไม่อยู่ในช่วงเวลาที่อนุญาต (16:30 หรือ 21:00). ` +
        `ตอนนี้ ${String(bh).padStart(2, "0")}:${String(bm).padStart(2, "0")} — ออกจากโปรแกรม`
    );
    process.exit(0);
  }

  console.log(
    `🕐 เริ่มดึงข้อมูลเวลา ${String(bh).padStart(2, "0")}:${String(bm).padStart(2, "0")}`
  );

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
