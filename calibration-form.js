"use strict";

const devices = {
  general: [{ title: "อุณหภูมิ", unit: "°C" }],
  refrig: [{ title: "อุณหภูมิ", unit: "°C" }],
  infusion: [
    { title: "อัตราการไหล · Flow Rate", unit: "mL/h" },
    { title: "ปริมาตร · Volume", unit: "mL" }
  ]
};
const device = document.querySelector("#device");
for (const type of [...additionalCalibrationTypes, ...legacyCalibrationTypes]) {
  devices[type.method] = type.fields;
  const option = new Option(type.name, type.method);
  if (type.legacy) option.hidden = true;
  device.add(option);
}
const sheets = document.querySelector("#sheets");
const budgets = document.querySelector("#budgets");
const status = document.querySelector("#status");
const rowsByDevice = new Map();
const columns = ["จุดทดสอบ", "ค่า STD", "มาตรฐาน รอบ 1", "เครื่อง รอบ 1", "มาตรฐาน รอบ 2", "เครื่อง รอบ 2", "มาตรฐาน รอบ 3", "เครื่อง รอบ 3"];
const outputs = ["standard", "mean", "error", "sd", "uca", "expanded"];
const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const escapeValue = value => String(value).replace(/[&"<>]/g, char => ({
  "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;"
}[char]));
const numeric = value => value === "" ? null : Number(value);

function render() {
  const state = rowsByDevice.get(device.value);
  const digital = device.value === "digital-bp";
  const nibp = device.value === "nibp";
  const infusion = device.value === "infusion";
  document.querySelector("#calStandardsHint").textContent = infusion
    ? "กรอก UUC setting และ Standard Reading 2 ครั้งต่อจุด ตามแบบ Infusion Analyzer"
    : digital || nibp
    ? "กรอกค่า STD แล้วระบบใช้อ้างอิงค่านั้นในผลคำนวณทันที"
    : "กรอกค่า STD แล้วระบบเติมค่ามาตรฐานทั้ง 3 รอบให้ตามค่า STD อัตโนมัติ แก้แต่ละรอบได้";
  const entryColumns = infusion
    ? [{ label: "จุดทดสอบ", index: 0 }, { label: "UUC setting", index: 1 },
      { label: "STD Reading 1", index: 2 }, { label: "STD Reading 2", index: 4 }]
    : digital || nibp
    ? [{ label: "จุดทดสอบ", index: 0 }, { label: "ค่า STD", index: 1 }, { label: "เครื่อง รอบ 1", index: 3 },
      { label: "เครื่อง รอบ 2", index: 5 }, { label: "เครื่อง รอบ 3", index: 7 }]
    : columns.map((label, index) => ({ label, index }));
  const outputColumns = device.value.startsWith("x-ray") ? [...outputs, "cv"] : infusion ? [...outputs, "errorPercent"] : outputs;
  const tableHeader = '<tr>' + (infusion
    ? '<th scope="col" rowspan="2">จุดทดสอบ</th><th scope="col" rowspan="2">UUC setting</th><th scope="colgroup" colspan="2">Standard Reading</th>'
    : '<th scope="col" rowspan="2">จุดทดสอบ</th><th scope="col" rowspan="2">ค่า STD</th>' +
      (digital || nibp ? [1, 2, 3].map(round => '<th scope="col" rowspan="2">เครื่อง รอบ ' + round + '</th>').join("")
        : [1, 2, 3].map(round => '<th scope="colgroup" colspan="2">รอบที่ ' + round + '</th>').join(""))) +
    '<th scope="colgroup" colspan="' + outputColumns.length + '">ผลคำนวณ</th><th scope="col" rowspan="2">ลบ</th></tr><tr>' +
    (infusion ? ["ครั้งที่ 1", "ครั้งที่ 2"] : digital || nibp ? [] : ["มาตรฐาน", "เครื่อง", "มาตรฐาน", "เครื่อง", "มาตรฐาน", "เครื่อง"])
      .concat(["Setting", "Mean", "Error", "SD", "uc", "Ureport"], outputColumns.includes("errorPercent") ? ["Error (%)"] : [], outputColumns.includes("cv") ? ["CV (%)"] : [])
      .map(label => '<th scope="col">' + label + '</th>').join("") + '</tr>';
  sheets.innerHTML = devices[device.value].map((config, i) => {
    const { rows, unit } = state[i];
    const body = rows.map((row, index) => {
      const cells = entryColumns.map(({ label, index: col }) =>
        '<td><input type="number" step="any" placeholder="—" aria-label="' +
        label + ' จุดที่ ' + (index + 1) + '" data-col="' + col + '" value="' +
        escapeValue(row[col]) + '"' + (col === 0 ? " readonly" : "") + '></td>').join("");
      return '<tr data-row="' + index + '">' + cells +
        outputColumns.map(key => '<td class="calc" data-output="' + key + '">—</td>').join("") +
        '<td><button type="button" class="remove" data-remove="' + index +
        '" aria-label="ลบจุดที่ ' + (index + 1) + '">×</button></td></tr>';
    }).join("");
    return '<section class="sheet" data-sheet="' + i + '"><div class="section-head"><h3>' +
      config.title + '</h3><label class="unit">หน่วย <input data-unit maxlength="12" value="' +
      escapeValue(unit) + '"></label></div><div class="scroll"><table aria-label="' +
      config.title + '"><thead>' + tableHeader + '</thead><tbody>' + body + '</tbody></table></div><button type="button" class="add" data-add>+ เพิ่มจุดทดสอบ</button></section>';
  }).join("");

  budgets.innerHTML = infusion || nibp
    ? '<p class="hint">uncertainty และ Ureport คำนวณอัตโนมัติตามสูตรใน Excel ต้นฉบับ</p>'
    : devices[device.value].map((config, i) =>
    '<section class="sheet"><h3>' + config.title + '</h3><div class="fields">' +
    state[i].budget.map((value, j) => '<label>UCB' + (j + 1) +
    '<input type="number" step="any" data-budget="' + i + '" data-item="' + j +
      '" value="' + escapeValue(value) + '"></label>').join("") + '</div></section>').join("");

  const rules = {
    "mean-std": "ค่าเฉลี่ยมาตรฐาน − ค่าเฉลี่ยเครื่อง",
    nominal: "ค่า STD − ค่าเฉลี่ยเครื่อง",
    reverse: "ค่าเฉลี่ยเครื่อง − Standard",
    standard: "Standard − ค่าเฉลี่ยเครื่อง",
    "mean-nominal": "ค่าเฉลี่ยเครื่อง − ค่า STD",
    "xray-percent": "((ค่า setting − ค่าอ่านเฉลี่ย) ÷ ค่า setting) × 100 · % error"
  };
  const source = [...additionalCalibrationTypes, ...legacyCalibrationTypes].find(type => type.method === device.value)?.source;
  document.querySelector("#rule").textContent = "Error = " + rules[calibrationErrorRule(device.value)] +
    (source ? " · Query " + source : "") +
    (infusion ? " · Infusion: Error = ค่าเฉลี่ย Standard Reading − UUC setting; ใช้ 2 รอบ" :
      nibp ? " · NIBP: Error = ค่าเฉลี่ยเครื่อง − STD setting; uncertainty ใช้ CMC และ repeatability จาก Excel" :
      digital ? " · บันทึกค่า STD จุดเดียวและค่าเครื่อง 3 รอบตามแบบต้นทาง" :
      " · Standard ใช้ค่าเฉลี่ยมาตรฐานเมื่อมากกว่า 0 และใช้ค่า STD ในกรณีอื่น");
  state.forEach((_, index) => updateSheet(index));
}

function updateSheet(index) {
  const { rows, budget } = rowsByDevice.get(device.value)[index];
  const infusion = device.value === "infusion";
  const table = sheets.querySelector('[data-sheet="' + index + '"]');
  const xray = device.value.startsWith("x-ray");
  const rowMeans = rows.map(row => {
    const readings = [numeric(row[3]), numeric(row[5]), numeric(row[7])];
    return readings.every(Number.isFinite) ? readings.reduce((sum, value) => sum + value, 0) / readings.length : null;
  });
  const cv = xray && rowMeans.every(Number.isFinite) ? calculateCoefficientVariation(rowMeans) : null;
  rows.forEach((row, rowIndex) => {
    const [, nominal, s1, m1, s2, m2, s3, m3] = row.map(numeric);
    const results = infusion ? calculateInfusionPoint({ nominal, standardReadings: [s1, s2] })
      : nibp ? calculateNibpPoint({ nominal, measuredReadings: [m1, m2, m3],
        pulseRate: /pulse|อัตราชีพจร/i.test(devices[device.value][index].title) })
      : calculatePoint({
      nominal, standardReadings: [s1, s2, s3], measuredReadings: [m1, m2, m3],
      budget: budget.map(numeric), errorRule: calibrationErrorRule(device.value, index)
    });
    const tr = table.querySelector('[data-row="' + rowIndex + '"]');
    [...outputColumns].forEach(key => {
      if (key === "cv") {
        tr.querySelector('[data-output="cv"]').textContent = rowIndex === 0 && Number.isFinite(cv)
          ? formatter.format(cv) : "—";
        return;
      }
      const value = results[key];
      tr.querySelector('[data-output="' + key + '"]').textContent = Number.isFinite(value)
        ? formatter.format(Math.abs(value) < 0.00005 ? 0 : value) : "—";
    });
  });
}

device.addEventListener("change", () => {
  if (!rowsByDevice.has(device.value)) rowsByDevice.set(device.value, stateFor());
  render();
  status.textContent = "เปลี่ยนประเภทเครื่องมือแล้ว";
});

sheets.addEventListener("input", event => {
  const input = event.target;
  const index = Number(input.closest("[data-sheet]").dataset.sheet);
  const state = rowsByDevice.get(device.value)[index];
  if (input.hasAttribute("data-unit")) {
    state.unit = input.value;
    return;
  }
  const row = Number(input.closest("[data-row]").dataset.row);
  const column = Number(input.dataset.col);
  state.rows[row][column] = input.value;
  if (column === 1 && device.value !== "digital-bp" && device.value !== "nibp" && device.value !== "infusion") {
    [2, 4, 6].forEach((standardColumn, round) => {
      if (!state.standardAuto[row][round]) return;
      state.rows[row][standardColumn] = input.value;
      sheets.querySelector('[data-sheet="' + index + '"] [data-row="' + row + '"] [data-col="' + standardColumn + '"]').value = input.value;
    });
  } else if ([2, 4, 6].includes(column)) {
    state.standardAuto[row][[2, 4, 6].indexOf(column)] = false;
  }
  updateSheet(index);
});

sheets.addEventListener("keydown", event => {
  if (event.key !== "Enter" || !event.target.matches("[data-col]")) return;
  event.preventDefault();
  const sheet = event.target.closest("[data-sheet]");
  const inputs = Array.from(sheet.querySelectorAll("[data-col]"));
  const next = inputs[inputs.indexOf(event.target) + 1];
  (next ?? sheet.querySelector("[data-add]")).focus();
});

sheets.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  const index = Number(button.closest("[data-sheet]").dataset.sheet);
  const state = rowsByDevice.get(device.value)[index];
  const { rows, standardAuto } = state;
  if (button.hasAttribute("data-add")) {
    rows.push([String(rows.length + 1), ...Array(7).fill("")]);
    standardAuto.push(Array(3).fill(true));
    render();
    sheets.querySelector('[data-sheet="' + index + '"] tr:last-child [data-col="1"]').focus();
  } else {
    rows.splice(Number(button.dataset.remove), 1);
    standardAuto.splice(Number(button.dataset.remove), 1);
    rows.forEach((row, rowIndex) => { row[0] = String(rowIndex + 1); });
    if (!rows.length) {
      rows.push(["1", ...Array(7).fill("")]);
      standardAuto.push(Array(3).fill(true));
    }
    render();
    sheets.querySelector('[data-sheet="' + index + '"] [data-add]').focus();
  }
});

budgets.addEventListener("input", event => {
  const { budget, item } = event.target.dataset;
  rowsByDevice.get(device.value)[Number(budget)].budget[Number(item)] = event.target.value;
  updateSheet(Number(budget));
});


function stateFor() {
  return devices[device.value].map(({ unit }) => ({
    unit, rows: [["1", ...Array(7).fill("")]], standardAuto: [Array(3).fill(true)],
    budget: ["infusion", "nibp"].includes(device.value) ? ["0", "0", "0", "0"] : Array(4).fill("")
  }));
}

function clearCalibrationMeasurements() {
  rowsByDevice.set(device.value, stateFor());
  render();
}

document.querySelector("#reset").addEventListener("click", clearCalibrationMeasurements);
clearCalibrationMeasurements();
