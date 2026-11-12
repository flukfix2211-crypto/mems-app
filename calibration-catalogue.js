"use strict";

const cal1Sources = {
  tour: "Add New Zcer Sub Tour",
  thermo: "Add New Zcer Sub",
  weight: "Zcer Weight Sub",
  spin: "Zcer Sub Speed / Zcer Sub Timer",
  timer: "Zcer Sub Timer",
  pump: "Zcer Sub Flow R / Zcer Sub Volume",
  "digital-bp": "Add New Digital BP · NIBP-Sub-BP/BPD/BPM/Heart Rate/Spo2"
};

const additionalCalibrationTypes = [
  ["flowmeter","Flowmeter","เครื่องวัดอัตราการไหล","ระบบก๊าซ","nominal","tour",[["อัตราการไหล","L/min"]]],
  ["suction","Suction","เครื่องดูดเสมหะ","ระบบก๊าซ","nominal","tour",[["แรงดูด","mmHg"]]],
  ["regulator","Regulator","ตัวควบคุมแรงดัน","ระบบก๊าซ","nominal","tour",[["แรงดัน","psi"]]],
  ["manual-bp","Manual Blood Pressure","เครื่องวัดความดันโลหิตแบบ Manual","สัญญาณชีพ","nominal","tour",[["ความดันโลหิต","mmHg"]]],
  ["digital-bp","Digital Blood Pressure","เครื่องวัดความดันโลหิตแบบ Digital","สัญญาณชีพ","mean-nominal","digital-bp",[
    ["ความดันตัวบน · Systolic (NIBP-BP)","mmHg"],
    ["ความดันตัวล่าง · Diastolic (NIBP-BPD)","mmHg"],
    ["ความดันเฉลี่ย · Mean pressure (NIBP-BPM)","mmHg"],
    ["อัตราชีพจร · Heart rate","bpm"],
    ["ออกซิเจนในเลือด · SpO₂","%"]
  ]],
  ["ambient","Ambient Thermometer","เทอร์โมมิเตอร์วัดอุณหภูมิห้อง","อุณหภูมิ","standard","thermo",[["อุณหภูมิ","°C"]]],
  ["weight-adult","Weighting Machine (Adult)","เครื่องชั่งผู้ใหญ่","น้ำหนัก","reverse","weight",[["น้ำหนัก","kg"]]],
  ["weight-general","Weighting Machine (General)","เครื่องชั่งทั่วไป","น้ำหนัก","reverse","weight",[["น้ำหนัก","kg"]]],
  ["weight-neo","Weighting Machine (Neo)","เครื่องชั่งทารก","น้ำหนัก","reverse","weight",[["น้ำหนัก","g"]]],
  ["centrifuge","Centrifuge","เครื่องปั่นเหวี่ยง","ห้องปฏิบัติการ","standard","spin",[["ความเร็วรอบ","rpm"],["เวลา","s"]]],
  ["hematocrit","Hematocrit","เครื่องปั่นฮีมาโตคริต","ห้องปฏิบัติการ","standard","spin",[["ความเร็วรอบ","rpm"],["เวลา","s"]]],
  ["rotator","Rotator","เครื่องหมุนผสม","ห้องปฏิบัติการ","standard","spin",[["ความเร็วรอบ","rpm"],["เวลา","s"]]],
  ["serofuge","SEROFUGE","เครื่องปั่นซีโรฟิวจ์","ห้องปฏิบัติการ","standard","spin",[["ความเร็วรอบ","rpm"],["เวลา","s"]]],
  ["alarm","Alarm Clock","นาฬิกาตั้งเวลา","เวลา","standard","timer",[["เวลา","s"]]],
  ["syringe","Syringe Pump","เครื่องควบคุมการฉีดยา","เครื่องให้สารละลาย","standard","pump",[["อัตราการไหล","mL/h"],["ปริมาตร","mL"]]]
].map(([method, name, label, group, errorRule, source, fields]) => ({
  method, name, label, group, errorRule, source: cal1Sources[source],
  fields: fields.map(([title, unit]) => ({ title, unit }))
}));

// Keep already registered records readable while new registrations use explicit methods.
const legacyCalibrationTypes = [{
  method: "blood-pressure", name: "Blood Pressure", label: "Blood Pressure (เดิม)", group: "สัญญาณชีพ",
  errorRule: "nominal", source: cal1Sources.tour, legacy: true,
  fields: [{ title: "ความดันโลหิต", unit: "mmHg" }]
}];

// Additional cal1 Gain.Detail categories and their Access Print Cert formulas.
// Access stores ordinary measurements in ZCER SUB as STD, three STD readings,
// and three SAM readings; complex devices are split by Remark into sheets.
const cal1VerifiedTypes = [
  ["amalgamator", "Amalgamator", "ห้องปฏิบัติการ", "ความเร็วรอบ", "rpm", "standard", "Print Cert Hematocrit", "percent", 0.1],
  ["anaesthesia-machine", "Anaesthesia (Machine)", "ก๊าซและการดมยาสลบ", "ค่าทดสอบ", "", "nominal", "Print Cert Anaes", "percent-or-0.1", 0.1],
  ["anaesthesia-vaporizer", "Anaesthesia (Vapourizer)", "ก๊าซและการดมยาสลบ", "ความเข้มข้นยาสลบ", "%", "nominal", "Print Cert Anaes", "percent", 0.1],
  ["analytical-balance", "Analytical Balance", "น้ำหนัก", "น้ำหนัก", "g", "reverse", "Print Cert Weigh", "percent", 0.1],
  ["blood-bank", "Blood Bank", "อุณหภูมิ", "อุณหภูมิ", "°C", "standard", "Print Cert Blood bank", "absolute", 1],
  ["defibrillator", "Defiblillator", "สัญญาณชีพ", "พลังงาน · Joule", "J", "standard", "Print Cert Defib", "defib", 0.1, ["อัตราชีพจร", "bpm", "ออกซิเจนในเลือด", "%"]],
  ["doptone", "Doptone", "สัญญาณชีพ", "อัตราการเต้นหัวใจทารก", "bpm", "reverse", "Print Cert Doptone", "absolute", 2],
  ["drainage-suction", "Drainage Suction", "ระบบก๊าซ", "แรงดูด", "mmHg", "reverse", "Print Cert Drainage", "percent", 0.1],
  ["dry-bath", "Dry Bath", "อุณหภูมิ", "อุณหภูมิ", "°C", "standard", "Print Cert Drybath", "absolute", 2],
  ["ekg", "EKG", "สัญญาณชีพ", "คลื่นไฟฟ้าหัวใจ", "mV", "reverse", "Print Cert EKG", "ekg", 0.05, ["อัตราชีพจร", "bpm", "ความเร็วกระดาษ", "mm/s"]],
  ["electrosurgical-unit", "Electrosurgical Unit", "เครื่องมือผ่าตัด", "กำลังไฟฟ้า", "W", "reverse", "Print Cert ESU", "percent", 0.1],
  ["fetal-monitor", "Fetal monitor", "สัญญาณชีพ", "อัตราการเต้นหัวใจทารก", "bpm", "standard", "Print Cert Meternal", "fetal", 2, ["การหดรัดตัวมดลูก", "mmHg"]],
  ["freeze-bank", "Freeze Bank", "อุณหภูมิ", "อุณหภูมิ", "°C", "mean-nominal", "Print Cert Freeze", "absolute", 2],
  ["heart-rate", "Heart rate", "สัญญาณชีพ", "อัตราชีพจร", "bpm", "reverse", "Print Cert Defib", "absolute", 2],
  ["hypo-hyperthermia", "Hypo-hyperthermia unit", "อุณหภูมิ", "อุณหภูมิ", "°C", "mean-std", "Print Cert Thermo", "absolute", 2],
  ["incubator", "Incubator", "อุณหภูมิ", "อุณหภูมิ", "°C", "standard", "Print Cert Incubator", "absolute", 1],
  ["infant-incubator", "Infant Incubator", "อุณหภูมิ", "อุณหภูมิ", "°C", "standard", "Print Cert Infant Incubator", "infant-incubator", 1, ["อุณหภูมิผิวหนัง", "°C", "ความชื้น", "%"]],
  ["infant-warmer", "Infant Warmer", "อุณหภูมิ", "อุณหภูมิ", "°C", "standard", "Print Cert Infant Warmer", "absolute", 2],
  ["julse", "Julse", "สัญญาณชีพ", "พลังงานกระตุ้น", "J", "standard", "Print Cert Defib", "percent", 0.05],
  ["pacer", "Pacer", "สัญญาณชีพ", "อัตราการกระตุ้น", "bpm", "standard", "Print Cert Pac", "absolute", 5],
  ["pack-heater", "Pack Heater", "อุณหภูมิ", "อุณหภูมิ", "°C", "standard", "Print Cert Patient", "absolute", 5],
  ["parafine-bath", "Parafine Bath", "อุณหภูมิ", "อุณหภูมิ", "°C", "standard", "Print Cert Patient", "absolute", 5],
  ["patient-monitor", "PATIENT MONITOR", "สัญญาณชีพ", "ความดันโลหิต", "mmHg", "reverse", "Print Cert NIBP", "nibp", 8, ["ความดันตัวล่าง · Diastolic", "mmHg", "ความดันเฉลี่ย · Mean pressure", "mmHg", "อัตราชีพจร", "bpm", "ออกซิเจนในเลือด", "%"]],
  ["patient-thermometer", "Patient Thermometer", "อุณหภูมิ", "อุณหภูมิร่างกาย", "°C", "standard", "Print Cert Patient", "absolute", 0.5],
  ["pulse-oxymeter", "Pulse Oxymeter", "สัญญาณชีพ", "ออกซิเจนในเลือด · SpO₂", "%", "reverse", "Print Cert Spo2", "spo2", 2, ["อัตราชีพจร", "bpm"]],
  ["radiant-warmer", "Radiant Warmer", "อุณหภูมิ", "อุณหภูมิ", "°C", "standard", "Print Cert Radiant Warmer", "radiant", 1, ["ความดันโลหิต", "mmHg"]],
  ["steam-incubator", "Steam Incubator", "อุณหภูมิ", "อุณหภูมิ", "°C", "standard", "Print Cert Steam Incubator", "absolute", 0.1],
  ["tourniquet", "Tourniquet", "สัญญาณชีพ", "แรงดัน", "mmHg", "standard", "Print Cert Meternal", "absolute", 5],
  ["traction", "Traction", "กายภาพบำบัด", "แรงดึง", "kg", "standard", "Print Cert Traction", "traction", 0.1],
  ["ultrasound", "Ultrasound", "กายภาพบำบัด", "กำลังคลื่นเสียง", "W", "mean-nominal", "Print Cert Ultrasound", "absolute", 2],
  ["ultrasound-therapeutic", "Ultrasound Therapeutic", "กายภาพบำบัด", "กำลังคลื่นเสียง", "W", "standard", "Print Cert Meternal", "absolute", 0.2],
  ["vacuum", "Vacuum", "ระบบก๊าซ", "แรงดูด", "mmHg", "standard", "Print Cert Vacuum", "percent", 0.1],
  ["ventilator", "Ventilator", "ระบบก๊าซ", "อัตราการไหล", "L/min", "reverse", "Print Cert Vent", "absolute", 5, ["ความดันทางเดินหายใจ · PEEP", "cmH₂O", "ปริมาตรหายใจ · Tidal volume", "mL", "ความดัน", "cmH₂O"]],
  ["water-bath", "Water bath", "อุณหภูมิ", "อุณหภูมิ", "°C", "standard", "Print Cert Waterbath", "absolute", 1],
  ["x-ray", "X-RAY", "รังสีวินิจฉัย", "แรงดันหลอด · kVp", "kVp", "xray-percent", "Print Cert X-Ray", "xray", 0, ["กระแสหลอด · mA", "mA", "เวลาเปิดรับรังสี", "ms", "ปริมาณรังสี", "mGy"]],
  ["x-ray-variant", "X-RAY -", "รังสีวินิจฉัย", "แรงดันหลอด · kVp", "kVp", "xray-percent", "Print Cert X-Ray", "xray", 0, ["กระแสหลอด · mA", "mA", "เวลาเปิดรับรังสี", "ms", "ปริมาณรังสี", "mGy"]],
  ["x-ray-mas-alt", "X-RAY  (MAS)", "รังสีวินิจฉัย", "แรงดันหลอด · kVp", "kVp", "xray-percent", "Print Cert X-Ray mas", "xray", 0, ["กระแสหลอด · mA", "mA", "เวลาเปิดรับรังสี", "ms", "ปริมาณรังสี", "mGy"]],
  ["x-ray-dental", "X-RAY (DENTAL)", "รังสีวินิจฉัย", "แรงดันหลอด · kVp", "kVp", "xray-percent", "Print Cert X-Ray", "xray", 0, ["กระแสหลอด · mA", "mA", "เวลาเปิดรับรังสี", "ms", "ปริมาณรังสี", "mGy"]],
  ["x-ray-mas", "X-RAY (MAS)", "รังสีวินิจฉัย", "แรงดันหลอด · kVp", "kVp", "xray-percent", "Print Cert X-Ray mas", "xray", 0, ["กระแสหลอด · mA", "mA", "เวลาเปิดรับรังสี", "ms", "ปริมาณรังสี", "mGy"]]
].map(([method, name, group, title, unit, errorRule, source, acceptance, gainPlus, moreFields = []]) => ({
  method, name, label: name, group, errorRule,
  errorRuleBySheet: method === "defibrillator" ? ["standard", "reverse", "reverse"] : null,
  source,
  acceptance: { formula: acceptance, gainPlus },
  fields: [[title, unit], ...Array.from({ length: moreFields.length / 2 }, (_, i) => [moreFields[i * 2], moreFields[i * 2 + 1]])]
    .map(([fieldTitle, fieldUnit]) => ({ title: fieldTitle, unit: fieldUnit }))
}));

additionalCalibrationTypes.push(...cal1VerifiedTypes);
const cal1CatalogueOnly = cal1VerifiedTypes.map(type => type.name);

function calibrationErrorRule(method, sheetIndex = 0) {
  if (method === "general") return "mean-std";
  const type = additionalCalibrationTypes.find(item => item.method === method)
    ?? legacyCalibrationTypes.find(item => item.method === method);
  return type?.errorRuleBySheet?.[sheetIndex] ?? type?.errorRule ?? "standard";
}

// Access Print Cert queries display the acceptance limit as SSS; these rules mirror
// the Gain-based expressions for the methods represented in the MEMS form.
function calibrationAcceptanceLimit(method, sheetIndex, nominal) {
  const absolute = {
    general: 2, refrig: 1, suction: 0.1, regulator: 0.1, "manual-bp": 4,
    "blood-pressure": 4, ambient: 2, "weight-adult": 2, "weight-general": 10,
    "weight-neo": 100
  };
  if (method === "digital-bp") return [8, 8, 1, 2, 2][sheetIndex] ?? null;
  const legacyType = cal1VerifiedTypes.find(type => type.method === method);
  if (legacyType) {
    const { formula, gainPlus } = legacyType.acceptance;
    const value = Math.abs(nominal || 0);
    if (formula === "absolute") return gainPlus;
    if (formula === "percent") return value * gainPlus;
    if (formula === "percent-or-0.1") return value ? value * gainPlus : 0.1;
    if (formula === "defib") return [value * gainPlus, 2, 2][sheetIndex] ?? null;
    if (formula === "ekg") return [value * gainPlus, 2, value * 0.02][sheetIndex] ?? null;
    if (formula === "fetal") return sheetIndex === 1 ? value * 0.1 : gainPlus;
    if (formula === "infant-incubator") return [gainPlus, 0.3, value * 0.1][sheetIndex] ?? null;
    if (formula === "spo2") return sheetIndex === 0 ? gainPlus : 2;
    if (formula === "radiant") return sheetIndex === 1 ? 4 : gainPlus;
    if (formula === "traction") return value * (sheetIndex === 0 ? 0.1 : 5);
    if (formula === "nibp") return [8, 8, 1, 2, 2][sheetIndex] ?? null;
    // The legacy X-ray Access report calculates kVp coefficient of variation;
    // its other exposure fields use separate report expressions, not Gain limits.
    if (formula === "xray") return null;
  }
  if (absolute[method] !== undefined) return absolute[method];
  if (method === "flowmeter") return Math.abs(nominal) * 0.2;
  if (method === "alarm") return Math.abs(nominal) * 0.05;
  if (method === "infusion") return Math.abs(nominal) * 0.1;
  if (method === "syringe") return Math.abs(nominal) * 0.05;
  if (["centrifuge", "hematocrit", "rotator", "serofuge"].includes(method)) {
    return sheetIndex === 1 ? 10 : Math.abs(nominal) * 0.1;
  }
  return null;
}
