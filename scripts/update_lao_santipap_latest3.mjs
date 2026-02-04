import fs from "node:fs/promises";
import puppeteer from "puppeteer";

// ===== LOTTERIES CONFIGURATION =====
const LOTTERIES = [
  {
    key: "lao_pattana",
    name: "หวยลาวพัฒนา",
    source_url: "https://www.sanook.com/news/laolotto/",
    parser: "sanook",
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

// แปลงปี พ.ศ. เป็น ค.ศ.
function buddhistYearToGregorian(buddhistYear) {
  if (buddhistYear < 100) {
    return 2500 + buddhistYear - 543;
  }
  return buddhistYear - 543;
}

// ===== FETCH PAGE WITH PUPPETEER =====
async function fetchPageContent(url, retries = 3) {
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

      // ใช้ domcontentloaded แทน networkidle2 เพื่อหลีกเลี่ยง navigation issues
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      
      // รอให้หน้า stable
      await new Promise((r) => setTimeout(r, 5000));
      
      // ลอง evaluate หลายครั้งถ้า context ถูก destroy
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
      return content;
    } catch (error) {
      await browser.close();
      console.warn(`  Attempt ${attempt}/${retries} failed: ${error.message}`);
      if (attempt === retries) throw error;
      await new Promise((r) => setTimeout(r, 3000)); // รอก่อน retry
    }
  }
}

// ===== SANOOK PARSER (lao_pattana) =====
function parseSanook(text) {
  const draws = [];

  // หาวันที่ล่าสุด: "ตรวจหวยลาว30 มกราคม2569" หรือ "30 มกราคม 2569"
  const latestDateMatch = text.match(/ตรวจหวยลาว\s*(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(\d{4})/);
  
  let latestDate = null;
  if (latestDateMatch) {
    const day = latestDateMatch[1].padStart(2, "0");
    const month = THAI_MONTHS[latestDateMatch[2]];
    const year = buddhistYearToGregorian(parseInt(latestDateMatch[3], 10));
    latestDate = `${year}-${month}-${day}`;
  }

  // หาเลข 4 ตัว
  const fullNumberMatch = text.match(/เลขท้าย\s*4\s*ตัว\s*(\d{4})/);
  const fullNumber = fullNumberMatch ? fullNumberMatch[1] : "";

  // หาเลข 3 ตัว
  const top3Match = text.match(/เลขท้าย\s*3\s*ตัว\s*(\d{3})/);
  const top3 = top3Match ? top3Match[1] : "";

  // หาเลข 2 ตัว
  const top2Match = text.match(/เลขท้าย\s*2\s*ตัว\s*(\d{2})/);
  const top2 = top2Match ? top2Match[1] : "";

  // หาหวยลาวพัฒนา 5 เลข
  // Format: "หวยลาวพัฒนา\n03\n41\n09\n12\n16" หรือ "หวยลาวพัฒนา 03 41 09 12 16"
  let pattanaNumbers = [];
  const pattanaMatch = text.match(/หวยลาวพัฒนา\s*(\d{2})\s*(\d{2})\s*(\d{2})\s*(\d{2})\s*(\d{2})/);
  if (pattanaMatch) {
    pattanaNumbers = [pattanaMatch[1], pattanaMatch[2], pattanaMatch[3], pattanaMatch[4], pattanaMatch[5]];
  }

  if (latestDate && fullNumber) {
    draws.push({
      draw_date: latestDate,
      full_number: fullNumber,
      top3,
      top2,
      bottom2: top2,
      pattana_numbers: pattanaNumbers,
    });
  }

  // ย้อนหลัง: "งวดประจำวันที่28 มกราคม2569...เลขท้าย4 ตัว3439...หวยลาวพัฒนา2838452227"
  const historyRegex = /งวดประจำวันที่\s*(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(\d{4})[\s\S]*?เลขท้าย\s*4\s*ตัว\s*(\d{4})[\s\S]*?เลขท้าย\s*3\s*ตัว\s*(\d{3})[\s\S]*?เลขท้าย\s*2\s*ตัว\s*(\d{2})[\s\S]*?หวยลาวพัฒนา\s*(\d{2})\s*(\d{2})\s*(\d{2})\s*(\d{2})\s*(\d{2})/g;

  let match;
  while ((match = historyRegex.exec(text)) !== null && draws.length < 3) {
    const day = match[1].padStart(2, "0");
    const month = THAI_MONTHS[match[2]];
    const year = buddhistYearToGregorian(parseInt(match[3], 10));
    const drawDate = `${year}-${month}-${day}`;

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
function parseRaakaadee(text) {
  const draws = [];

  // Pattern: "30 ม.ค. 69" ... "หวยออก 68374" ... "3 ตัวบน 374" ... "2 ตัวบน 74" ... "2 ตัวล่าง 83"
  // หรือ: "ศ. 30 ม.ค. 69เวลา20:30น." ... ตัวเลขในตาราง
  
  const drawRegex = /(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})[\s\S]*?หวยออก\s*(\d{5})[\s\S]*?3\s*ตัวบน\s*(\d{3})[\s\S]*?2\s*ตัวบน\s*(\d{2})[\s\S]*?2\s*ตัวล่าง\s*(\d{2})/g;

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

  const drawRegex = /(\d{1,2}\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*\d{2,4})[\s\S]*?หวยออก\s*(\d{5})[\s\S]*?3\s*ตัวบน\s*(\d{3})[\s\S]*?2\s*ตัวบน\s*(\d{2})[\s\S]*?2\s*ตัวล่าง\s*(\d{2})/g;

  let match;
  while ((match = drawRegex.exec(text)) !== null && draws.length < 3) {
    // เก็บวันที่ดิบ ไม่แปลง (เหมือน AI version)
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

  // Pattern ใหม่: รองรับชื่อย่อวันข้างหน้า และ | คั่นเลข
  // ตัวอย่าง: "ศ. 30 ม.ค. 69เวลา18:30น....2 ตัวล่าง|09|"
  // หรือ: "ส. 3 ม.ค. 69...หวยออก|00949|...2 ตัวล่าง|57|"
  const drawRegex = /(?:[อ-ฮ]+\.?\s*)?(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})[\s\S]*?2\s*ตัวล่าง\|?(\d{2})/g;

  let match;
  while ((match = drawRegex.exec(text)) !== null && draws.length < 3) {
    const day = match[1].padStart(2, "0");
    const monthShort = match[2];
    const yearStr = match[3];
    const month = THAI_MONTHS_SHORT[monthShort];
    if (!month) continue;

    const year = buddhistYearToGregorian(parseInt(yearStr, 10));
    const drawDate = `${year}-${month}-${day}`;
    const bottom2 = match[4];

    draws.push({
      draw_date: drawDate,
      full_number: "",
      top3: bottom2,
      top2: bottom2,
      bottom2: bottom2,
    });
  }

  return draws;
}

// ===== MAIN PROCESSING =====
async function processLottery(lottery) {
  console.log(`Fetching ${lottery.name} from ${lottery.source_url}...`);

  try {
    const text = await fetchPageContent(lottery.source_url);

    let draws = [];
    switch (lottery.parser) {
      case "sanook":
        draws = parseSanook(text);
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
