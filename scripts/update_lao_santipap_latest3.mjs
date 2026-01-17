import fs from "node:fs/promises";

const SOURCE_URL = "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาวสันติภาพ/";

function nowISO() {
  const d = new Date();
  const tzOffsetMin = -d.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(tzOffsetMin) / 60)).padStart(2, "0");
  const mm = String(Math.abs(tzOffsetMin) % 60).padStart(2, "0");
  return d.toISOString().replace("Z", `${sign}${hh}:${mm}`);
}

function stripHtmlToText(html) {
  html = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  html = html.replace(/<style[\s\S]*?<\/style>/gi, " ");
  html = html.replace(/<\/?[^>]+>/g, " ");
  html = html.replace(/\s+/g, " ").trim();
  return html.slice(0, 12000);
}

async function fetchHtml() {
  const res = await fetch(SOURCE_URL, {
    headers: { "user-agent": "Mozilla/5.0 (ResultsBot/1.0)" }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return await res.text();
}

async function callOpenAI({ apiKey, text }) {
  const schema = {
    name: "lao_santipap_latest_3",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["lottery", "source_url", "fetched_at", "draws"],
      properties: {
        lottery: { type: "string", enum: ["lao_santipap"] },
        source_url: { type: "string" },
        fetched_at: { type: "string" },
        draws: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["draw_date", "full_number", "top3", "top2", "bottom2"],
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
    reasoning: { effort: "low" },
    input: [
      {
        role: "system",
        content:
          "Extract Lao Santipap lottery results from the provided text. Return ONLY valid JSON following the given schema. Choose the latest 3 draws found."
      },
      {
        role: "user",
        content: `SOURCE_URL: ${SOURCE_URL}\nFETCHED_AT: ${nowISO()}\nTEXT:\n${text}`
      }
    ],
    text: {
      format: { type: "json_schema", json_schema: schema }
    }
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`OpenAI error ${resp.status}: ${err.slice(0, 300)}`);
  }

  const data = await resp.json();
  const outputText =
    data.output_text ??
    data.output?.[0]?.content?.find?.((c) => c.type === "output_text")?.text;

  if (!outputText) throw new Error("No output_text from OpenAI");

  return JSON.parse(outputText);
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const html = await fetchHtml();
  const text = stripHtmlToText(html);
  const json = await callOpenAI({ apiKey, text });

  json.fetched_at = json.fetched_at || nowISO();
  json.source_url = json.source_url || SOURCE_URL;
  json.lottery = "lao_santipap";

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile(
    "public/lao_santipap_latest3.json",
    JSON.stringify(json, null, 2),
    "utf8"
  );

  console.log("Updated public/lao_santipap_latest3.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
