import fs from "node:fs/promises";

/* ================= CONFIG ================= */

const LOTTERIES = [
  {
    key: "lao_pattana",
    name: "หวยลาวพัฒนา",
    url: "https://www.sanook.com/news/laolotto/",
    parser: "sanook",
  },
  {
    key: "lao_samakkee",
    name: "ลาวสามัคคี",
    url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาวสามัคคี/",
    parser: "raakaadee",
  },
  {
    key: "lao_vip",
    name: "ลาว VIP",
    url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาว-VIP/",
    parser: "raakaadee",
  },
  {
    key: "lao_star",
    name: "ลาวสตาร์",
    url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาวสตาร์/",
    parser: "raakaadee",
  },
  {
    key: "lao_extra",
    name: "ลาว Extra",
    url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาว-Extra/",
    parser: "raakaadee",
  },
  {
    key: "hanoi",
    name: "ฮานอย",
    url: "https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยฮานอยปกติ/",
    parser: "raakaadee_hanoi",
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

/**
 * แปลงวันที่ไทยเป็น YYYY-MM-DD
 */
function parseThaiDate(dateStr) {
  const monthMap = {
    "ม.ค.": "01", "ก.พ.": "02", "มี.ค.": "03", "เม.ย.": "04",
    "พ.ค.": "05", "มิ.ย.": "06", "ก.ค.": "07", "ส.ค.": "08",
    "ก.ย.": "09", "ต.ค.": "10", "พ.ย.": "11", "ธ.ค.": "12",
    "มกราคม": "01", "กุมภาพันธ์": "02", "มีนาคม": "03", "เมษายน": "04",
    "พฤษภาคม": "05", "มิถุนายน": "06", "กรกฎาคม": "07", "สิงหาคม": "08",
    "กันยายน": "09", "ตุลาคม": "10", "พฤศจิกายน": "11", "ธันวาคม": "12",
  };

  // Pattern: "30 ม.ค. 69" หรือ "ศ. 30 ม.ค. 69"
  let match = dateStr.match(/(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})/);
  if (match) {
    const day = match[1].padStart(2, "0");
    const month = monthMap[match[2]];
    let year = match[3];
    if (year.length === 2) {
      year = String(2500 + parseInt(year) - 543 + 43);
    } else if (parseInt(year) > 2500) {
      year = String(parseInt(year) - 543);
    }
    return `${year}-${month}-${day}`;
  }

  // Pattern: "23 มกราคม2569" หรือ "23 มกราคม 2569"
  match = dateStr.match(/(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(\d{4})/);
  if (match) {
    const day = match[1].padStart(2, "0");
    const month = monthMap[match[2]];
    const year = String(parseInt(match[3]) - 543);
    return `${year}-${month}-${day}`;
  }

  return dateStr;
}

/* ================= PARSERS ================= */

/**
 * Parser สำหรับ sanook.com (หวยลาวพัฒนา)
 */
function parseSanook(html) {
  const draws = [];
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // หา pattern: "งวดประจำวันที่23 มกราคม2569" ตามด้วยข้อมูล
  const drawPattern = /งวดประจำวันที่\s*(\d{1,2}\s*[ก-ฮ]+\s*\d{4})\s*.*?เลขท้าย\s*4\s*ตัว\s*(\d{4})\s*เลขท้าย\s*3\s*ตัว\s*(\d{3})\s*เลขท้าย\s*2\s*ตัว\s*(\d{2})\s*หวยลาวพัฒนา\s*(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/g;

  let match;
  while ((match = drawPattern.exec(text)) !== null && draws.length < 3) {
    draws.push({
      draw_date: parseThaiDate(match[1]),
      full_number: match[2],
      top3: match[3],
      top2: match[4],
      bottom2: match[4],
      pattana_numbers: [match[5], match[6], match[7], match[8], match[9]],
    });
  }

  return draws;
}

/**
 * Parser สำหรับ raakaadee.com (หวยลาวอื่นๆ - มี 5 หลัก)
 */
function parseRaakaadee(html) {
  const draws = [];
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // Pattern: "ออก ศ. 30 ม.ค. 69 เวลา 20:30 น. หวยออก 68374 3 ตัวบน 374 2 ตัวบน 74 2 ตัวล่าง 83"
  const datePattern = /ออก\s+(?:จ\.|อ\.|พ\.|พฤ\.|ศ\.|ส\.|อา\.)\s+(\d{1,2}\s+(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s+\d{2})/g;
  const dates = [];
  let dateMatch;
  while ((dateMatch = datePattern.exec(text)) !== null) {
    dates.push(parseThaiDate(dateMatch[1]));
  }

  // Pattern: "หวยออก 68374 3 ตัวบน 374 2 ตัวบน 74 2 ตัวล่าง 83"
  const resultPattern = /หวยออก\s+(\d{5})\s+3\s*ตัวบน\s+(\d{3})\s+2\s*ตัวบน\s+(\d{2})\s+2\s*ตัวล่าง\s+(\d{2})/g;
  
  let resultMatch;
  let i = 0;
  while ((resultMatch = resultPattern.exec(text)) !== null && draws.length < 3) {
    draws.push({
      draw_date: dates[i] || new Date().toISOString().split("T")[0],
      full_number: resultMatch[1],
      top3: resultMatch[2],
      top2: resultMatch[3],
      bottom2: resultMatch[4],
    });
    i++;
  }

  return draws;
}

/**
 * Parser สำหรับ raakaadee.com (หวยฮานอย - มีเฉพาะ 2 ตัวล่าง บางงวด)
 */
function parseRaakaadeeHanoi(html) {
  const draws = [];
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // หาวันที่ทั้งหมด
  const datePattern = /ออก\s+(?:จ\.|อ\.|พ\.|พฤ\.|ศ\.|ส\.|อา\.)\s+(\d{1,2}\s+(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s+\d{2})/g;
  const dates = [];
  let dateMatch;
  while ((dateMatch = datePattern.exec(text)) !== null) {
    dates.push(parseThaiDate(dateMatch[1]));
  }

  // Pattern แบบครบ: "หวยออก 00949 3 ตัวบน 949 2 ตัวบน 49 2 ตัวล่าง 57"
  const fullPattern = /หวยออก\s+(\d{5})\s+3\s*ตัวบน\s+(\d{3})\s+2\s*ตัวบน\s+(\d{2})\s+2\s*ตัวล่าง\s+(\d{2})/g;
  
  // Pattern แบบย่อ: "หวยออก 3 ตัวบน 2 ตัวบน 2 ตัวล่าง 90" (แค่ 2 ตัวล่าง)
  const shortPattern = /หวยออก\s+3\s*ตัวบน\s+2\s*ตัวบน\s+2\s*ตัวล่าง\s+(\d{2})/g;

  let i = 0;
  let fullMatch;
  
  // ลองหาแบบครบก่อน
  while ((fullMatch = fullPattern.exec(text)) !== null && draws.length < 3) {
    draws.push({
      draw_date: dates[i] || new Date().toISOString().split("T")[0],
      full_number: fullMatch[1],
      top3: fullMatch[2],
      top2: fullMatch[3],
      bottom2: fullMatch[4],
    });
    i++;
  }

  // ถ้าไม่เจอแบบครบ ลองหาแบบย่อ
  if (draws.length === 0) {
    let shortMatch;
    while ((shortMatch = shortPattern.exec(text)) !== null && draws.length < 3) {
      const bottom2 = shortMatch[1];
      draws.push({
        draw_date: dates[i] || new Date().toISOString().split("T")[0],
        full_number: "",
        top3: bottom2,
        top2: bottom2,
        bottom2: bottom2,
      });
      i++;
    }
  }

  return draws;
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

      let draws = [];
      if (lot.parser === "sanook") {
        draws = parseSanook(html);
      } else if (lot.parser === "raakaadee") {
        draws = parseRaakaadee(html);
      } else if (lot.parser === "raakaadee_hanoi") {
        draws = parseRaakaadeeHanoi(html);
      }

      if (draws.length === 0) {
        console.log(`⚠️ ${lot.name}: No draws found, skipping...`);
        continue;
      }

      all.items.push({
        key: lot.key,
        name: lot.name,
        source_url: lot.url,
        fetched_at: nowISO(),
        draws: draws,
      });

      console.log(`✅ ${lot.name} done (${draws.length} draws)`);
    } catch (err) {
      console.error(`❌ ${lot.name} failed:`, err.message);
    }
  }

  await fs.writeFile("all_latest3-test.json", JSON.stringify(all, null, 2), "utf8");
  console.log(`\n✅ Saved all_latest3-test.json with ${all.items.length} lotteries`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
