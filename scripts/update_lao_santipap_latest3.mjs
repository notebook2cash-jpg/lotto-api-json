import fs from "node:fs/promises";
import puppeteer from "puppeteer";

// ===== PAGE CACHE =====
const pageCache = new Map();

// ===== LOTTERIES CONFIGURATION =====
const LOTTERIES = [
  {
    key: "lao_pattana",
    name: "หวยลาวพัฒนา",
    source_url: "https://www.sanook.com/news/laolotto/",
    parser: "sanook_lao",
    drawCount: 3,
  },
  {
    key: "lao_samakkee",
    name: "ลาวสามัคคี",
    source_url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาวสามัคคี/",
    parser: "raakaadee",
    drawCount: 3,
  },
  {
    key: "lao_vip",
    name: "ลาว VIP",
    source_url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาว-VIP/",
    parser: "raakaadee",
    drawCount: 3,
  },
  {
    key: "lao_star",
    name: "ลาวสตาร์",
    source_url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาวสตาร์/",
    parser: "raakaadee",
    drawCount: 3,
  },
  {
    key: "lao_extra",
    name: "ลาว Extra",
    source_url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาว-Extra/",
    parser: "raakaadee_no_date_convert",
    drawCount: 3,
  },
  {
    key: "hanoi",
    name: "ฮานอย",
    source_url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยฮานอยปกติ/",
    parser: "raakaadee_hanoi",
    drawCount: 3,
  },
];

// ===== THAI MONTH MAPPING =====
const THAI_MONTHS = {
  มกราคม: "01",
  กุมภาพันธ์: "02",
  มีนาคม: "03",
  เมษายน: "04",
  พฤษภาคม: "05",
  มิถุนายน: "06",
  กรกฎาคม: "07",
  สิงหาคม: "08",
  กันยายน: "09",
  ตุลาคม: "10",
  พฤศจิกายน: "11",
  ธันวาคม: "12",
};

const THAI_MONTHS_SHORT = {
  "ม.ค.": "01",
  "ก.พ.": "02",
  "มี.ค.": "03",
  "เม.ย.": "04",
  "พ.ค.": "05",
  "มิ.ย.": "06",
  "ก.ค.": "07",
  "ส.ค.": "08",
  "ก.ย.": "09",
  "ต.ค.": "10",
  "พ.ย.": "11",
  "ธ.ค.": "12",
};

function buddhistYearToGregorian(buddhistYear) {
  if (buddhistYear < 100) {
    return 2500 + buddhistYear - 543;
  }
  return buddhistYear - 543;
}

// ===== FETCH PAGE WITH PUPPETEER (with cache) =====
async function fetchPageContent(url, retries = 3) {
  if (pageCache.has(url)) {
    console.log(`  📦 Using cached content for ${url}`);
    return pageCache.get(url);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });

    try {
      const page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

      await new Promise((r) => setTimeout(r, 5000));

      let content = "";
      for (let evalAttempt = 1; evalAttempt <= 3; evalAttempt++) {
        try {
          content = await page.evaluate(() => document.body.innerText);
          break;
        } catch (evalError) {
          if (evalAttempt === 3) throw evalError;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      await browser.close();

      // DEBUG: log first 500 chars to see actual format
      console.log(`  📝 Raw text preview (${url}):`);
      console.log(content.substring(0, 500));
      console.log("  ---");

      pageCache.set(url, content);
      return content;
    } catch (error) {
      await browser.close();
      console.warn(`  Attempt ${attempt}/${retries} failed: ${error.message}`);
      if (attempt === retries) throw error;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// ===== HELPER: parse วันที่จาก Sanook =====
function parseSanookDate(text) {
  const m = text.match(
    /(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(\d{4})/
  );
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = THAI_MONTHS[m[2]];
  const year = buddhistYearToGregorian(parseInt(m[3], 10));
  return `${year}-${month}-${day}`;
}

// ===== SANOOK PARSER: หวยลาวพัฒนา =====
function parseSanookLao(text) {
  const draws = [];

  const historySplitIndex = text.search(
    /ตรวจหวยลาว\s*ย้อนหลัง|ตรวจหวยลาว\s*งวดประจำวันที่/
  );
  const latestSection =
    historySplitIndex > 0 ? text.slice(0, historySplitIndex) : text;

  const latestDateMatch = latestSection.match(
    /ตรวจหวยลาว\s*(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(\d{4})/
  );
  const latestDate = latestDateMatch
    ? parseSanookDate(latestDateMatch[0])
    : null;

  const fullMatch = latestSection.match(/เลขท้าย\s*4\s*ตัว\s*(\d{4})/);
  const top3Match = latestSection.match(/เลขท้าย\s*3\s*ตัว\s*(\d{3})/);
  const top2Match = latestSection.match(/เลขท้าย\s*2\s*ตัว\s*(\d{2})/);

  const pattanaMatch = latestSection.match(
    /หวยลาวพัฒนา\s*(\d{2})\s*(\d{2})\s*(\d{2})\s*(\d{2})\s*(\d{2})/
  );

  if (latestDate) {
    draws.push({
      draw_date: latestDate,
      full_number: fullMatch ? fullMatch[1] : "xxxx",
      top3: top3Match ? top3Match[1] : "xxx",
      top2: top2Match ? top2Match[1] : "xx",
      bottom2: top2Match ? top2Match[1] : "xx",
      pattana_numbers: pattanaMatch
        ? [pattanaMatch[1], pattanaMatch[2], pattanaMatch[3], pattanaMatch[4], pattanaMatch[5]]
        : ["xx", "xx", "xx", "xx", "xx"],
    });

    if (!fullMatch) {
      console.log(`    ⏳ งวดล่าสุด ${latestDate}: รอออกผล`);
    } else {
      console.log(`    ✅ งวดล่าสุด ${latestDate}: ${fullMatch[1]}`);
    }
  }

  const historyRegex =
    /งวดประจำวันที่\s*(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(\d{4})[\s\S]*?เลขท้าย\s*4\s*ตัว\s*(\d{4})[\s\S]*?เลขท้าย\s*3\s*ตัว\s*(\d{3})[\s\S]*?เลขท้าย\s*2\s*ตัว\s*(\d{2})[\s\S]*?หวยลาวพัฒนา\s*(\d{2})\s*(\d{2})\s*(\d{2})\s*(\d{2})\s*(\d{2})/g;

  let match;
  while ((match = historyRegex.exec(text)) !== null && draws.length < 3) {
    const drawDate = parseSanookDate(match[0]);
    if (!drawDate || draws.some((d) => d.draw_date === drawDate)) continue;

    draws.push({
      draw_date: drawDate,
      full_number: match[4],
      top3: match[5],
      top2: match[6],
      bottom2: match[6],
      pattana_numbers: [match[7], match[8], match[9], match[10], match[11]],
    });
  }

  return draws;
}

// ===== RAAKAADEE PARSER =====
// FIX: ใช้ [|\s]* แทน \s* เพื่อรองรับ | (pipe) ที่เว็บเปลี่ยนมาใช้
function parseRaakaadee(text) {
  const draws = [];

  const drawRegex =
    /(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})[\s\S]*?หวยออก[|\s]*(\d{5})[\s\S]*?3\s*ตัวบน[|\s]*(\d{3})[\s\S]*?2\s*ตัวบน[|\s]*(\d{2})[\s\S]*?2\s*ตัวล่าง[|\s]*(\d{2})/g;

  let match;
  while ((match = drawRegex.exec(text)) !== null && draws.length < 3) {
    const day = match[1].padStart(2, "0");
    const monthShort = match[2];
    const yearStr = match[3];
    const month = THAI_MONTHS_SHORT[monthShort];
    if (!month) continue;

    const year = buddhistYearToGregorian(parseInt(yearStr, 10));
    const drawDate = `${year}-${month}-${day}`;

    draws.push({
      draw_date: drawDate,
      full_number: match[4],
      top3: match[5],
      top2: match[6],
      bottom2: match[7],
    });
  }

  return draws;
}

// ===== RAAKAADEE ไม่แปลงวันที่ (lao_extra) =====
function parseRaakaadeeNoDateConvert(text) {
  const draws = [];

  const drawRegex =
    /(\d{1,2}\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*\d{2,4})[\s\S]*?หวยออก[|\s]*(\d{5})[\s\S]*?3\s*ตัวบน[|\s]*(\d{3})[\s\S]*?2\s*ตัวบน[|\s]*(\d{2})[\s\S]*?2\s*ตัวล่าง[|\s]*(\d{2})/g;

  let match;
  while ((match = drawRegex.exec(text)) !== null && draws.length < 3) {
    const rawDate = match[1].trim();

    draws.push({
      draw_date: rawDate,
      full_number: match[2],
      top3: match[3],
      top2: match[4],
      bottom2: match[5],
    });
  }

  return draws;
}

// ===== RAAKAADEE HANOI PARSER =====
function parseRaakaadeeHanoi(text) {
  const draws = [];

  // ฮานอยมี 2 format:
  // Format เก่า (มีข้อมูลครบ): หวยออก|00949| 3 ตัวบน|949| 2 ตัวบน|49| 2 ตัวล่าง|57|
  // Format ใหม่ (ข้อมูลไม่ครบ): หวยออก|3 ตัวบน|2 ตัวบน|2 ตัวล่าง|09|

  // ลองดึงแบบ full format ก่อน
  const fullDrawRegex =
    /(?:[ก-ฮ]+\.?\s*)?(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})[\s\S]*?หวยออก[|\s]*(\d{5})[\s\S]*?3\s*ตัวบน[|\s]*(\d{3})[\s\S]*?2\s*ตัวบน[|\s]*(\d{2})[\s\S]*?2\s*ตัวล่าง[|\s]*(\d{2})/g;

  let match;
  while ((match = fullDrawRegex.exec(text)) !== null && draws.length < 3) {
    const day = match[1].padStart(2, "0");
    const monthShort = match[2];
    const yearStr = match[3];
    const month = THAI_MONTHS_SHORT[monthShort];
    if (!month) continue;

    const year = buddhistYearToGregorian(parseInt(yearStr, 10));
    const drawDate = `${year}-${month}-${day}`;

    draws.push({
      draw_date: drawDate,
      full_number: match[4],
      top3: match[5],
      top2: match[6],
      bottom2: match[7],
    });
  }

  // ถ้าไม่ได้ครบ 3 งวด ลองดึงแบบ short format (มีแค่ 2 ตัวล่าง)
  if (draws.length < 3) {
    const shortDrawRegex =
      /(?:[ก-ฮ]+\.?\s*)?(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})[\s\S]*?หวยออก[|\s]*(?:3\s*ตัวบน)[|\s]*(?:2\s*ตัวบน)[|\s]*(?:2\s*ตัวล่าง)[|\s]*(\d{2})/g;

    while ((match = shortDrawRegex.exec(text)) !== null && draws.length < 3) {
      const day = match[1].padStart(2, "0");
      const monthShort = match[2];
      const yearStr = match[3];
      const month = THAI_MONTHS_SHORT[monthShort];
      if (!month) continue;

      const year = buddhistYearToGregorian(parseInt(yearStr, 10));
      const drawDate = `${year}-${month}-${day}`;

      // ข้ามถ้ามีวันนี้อยู่แล้ว (จาก full format)
      if (draws.some((d) => d.draw_date === drawDate)) continue;

      draws.push({
        draw_date: drawDate,
        full_number: "xxxxx",
        top3: "xxx",
        top2: "xx",
        bottom2: match[4],
      });
    }

    // เรียงตามวันที่ล่าสุดก่อน
    draws.sort((a, b) => b.draw_date.localeCompare(a.draw_date));
  }

  return draws.slice(0, 3);
}

// ===== MAIN PROCESSING =====
async function processLottery(lottery) {
  console.log(`Fetching ${lottery.name} from ${lottery.source_url}...`);

  try {
    const text = await fetchPageContent(lottery.source_url);

    let draws = [];
    switch (lottery.parser) {
      case "sanook_lao":
        draws = parseSanookLao(text);
        break;
      case "raakaadee":
        draws = parseRaakaadee(text);
        break;
      case "raakaadee_no_date_convert":
        draws = parseRaakaadeeNoDateConvert(text);
        break;
      case "raakaadee_hanoi":
        draws = parseRaakaadeeHanoi(text);
        break;
      default:
        console.warn(`Unknown parser: ${lottery.parser}`);
    }

    draws = draws.slice(0, lottery.drawCount);

    return {
      key: lottery.key,
      name: lottery.name,
      source_url: lottery.source_url,
      fetched_at: new Date().toISOString().replace("Z", "+00:00"),
      draws,
    };
  } catch (error) {
    console.error(`Error fetching ${lottery.name}:`, error.message);
    return {
      key: lottery.key,
      name: lottery.name,
      source_url: lottery.source_url,
      fetched_at: new Date().toISOString().replace("Z", "+00:00"),
      draws: [],
      error: error.message,
    };
  }
}

async function main() {
  console.log("Starting lottery data fetch with Puppeteer...\n");

  const items = [];

  for (const lottery of LOTTERIES) {
    const result = await processLottery(lottery);
    items.push(result);
    console.log(`  ✓ ${lottery.name}: ${result.draws.length} draws\n`);
  }

  const output = {
    updated_at: new Date().toISOString().replace("Z", "+00:00"),
    items,
  };

  const outputPath = "all_latest3.json";
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`\n✅ Output saved to ${outputPath}`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
