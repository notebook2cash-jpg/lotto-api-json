import fs from "node:fs/promises";

// ===== CONFIG =====
const TARGET_URL =
  "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาวสันติภาพ/";

const SOURCES = [
  "http://textise.net/showtext.aspx?strURL=" + TARGET_URL,
  "http://textise.com/showtext.aspx?strURL=" + TARGET_URL
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
          "user-agent": "Mozilla/5.0",
          accept: "text/html"
        }
      });
      if (res.ok) return await res.text();
    } catch (_) {}
  }
  throw new Error("All sources failed");
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
          minItems: 1,
          maxItems: 3,
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
    model: "gpt-5",
    input: [
      {
        role: "system",
        content:
          "Extract Lao Santipap lottery results. Return ONLY valid JSON following the schema. Use latest 3 draws."
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

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const outputText =
    data.output_text ??
    data.output?.flatMap((o) => o.content || [])?.find((c) => c.type === "output_text")
      ?.text;

  if (!outputText) throw new Error("No output_text from OpenAI");

  return JSON.parse(outputText);
}

// ===== MAIN =====
async function main() {
  const html = await fetchHtml();
  const text = cleanText(html);

  const json = await callOpenAI(text);
  json.lottery = "lao_santipap";
  json.source_url = TARGET_URL;
  json.fetched_at = json.fetched_at || nowISO();

  // ✅ WRITE TO ROOT
  await fs.writeFile(
    "lao_santipap_latest3.json",
    JSON.stringify(json, null, 2),
    "utf8"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
