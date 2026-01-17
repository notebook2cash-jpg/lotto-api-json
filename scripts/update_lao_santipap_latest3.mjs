import fs from "node:fs/promises";

// ===== CONFIG =====
const TARGET_URL =
  "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาวสันติภาพ/";

const SOURCES = [
  "http://textise.net/showtext.aspx?strURL=" + encodeURIComponent(TARGET_URL),
  "http://textise.com/showtext.aspx?strURL=" + encodeURIComponent(TARGET_URL),
  TARGET_URL // fallback to direct fetch
];

// ===== UTILS =====
function nowISO() {
  const d = new Date();
  const tzOffsetMin = -d.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(tzOffsetMin) / 60)).padStart(2, "0");
  const mm = String(Math.abs(tzOffsetMin) % 60).padStart(2, "0");
  return d.toISOString().replace("Z", `${sign}${hh}:${mm}`);
}

async function fetchHtml() {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "th-TH,th;q=0.9,en;q=0.8"
        }
      });
      if (res.ok) {
        console.log("Fetched from:", url);
        return await res.text();
      }
    } catch (e) {
      console.warn("Fetch failed:", url, e.message);
    }
  }
  throw new Error("All sources failed");
}

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

// ===== OPENAI =====
async function callOpenAI(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const schema = {
    name: "lao_santipap_latest_3",
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
              "bottom2"
            ],
            properties: {
              draw_date: { type: "string" },
              full_number: { type: "string" },
              top3: { type: "string" },
              top2: { type: "string" },
              bottom2: { type: "string" }
            }
          }
        }
      }
    },
    strict: true
  };

  const body = {
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "Extract Lao Santipap lottery results. Return ONLY valid JSON following the schema. Use latest 3 draws. draw_date should be in YYYY-MM-DD format."
      },
      {
        role: "user",
        content: `SOURCE_URL: ${TARGET_URL}\nFETCHED_AT: ${nowISO()}\nTEXT:\n${text}`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: schema
    }
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error("OpenAI error: " + err);
  }

  const data = await res.json();
  const outputText = data.choices?.[0]?.message?.content;

  if (!outputText) throw new Error("No content from OpenAI");

  return JSON.parse(outputText);
}

// ===== MAIN =====
async function main() {
  const html = await fetchHtml();
  const text = cleanText(html);
  
  console.log("Text length:", text.length);
  console.log("Text preview:", text.slice(0, 500));
  
  const json = await callOpenAI(text);

  json.lottery = "lao_santipap";
  json.source_url = TARGET_URL;
  json.fetched_at = json.fetched_at || nowISO();

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile(
    "lao_santipap_latest3.json",
    JSON.stringify(json, null, 2),
    "utf8"
  );

  console.log("✅ Updated public/lao_santipap_latest3.json");
  console.log(JSON.stringify(json, null, 2));
}

main().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
