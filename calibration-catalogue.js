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
  ["ambient","Ambient Thermometer","เทอร์โมมิเตอร์วัดอุณหภูมิห้อง","อุณหภูมิ","mean-std","thermo",[["อุณหภูมิ","°C"]]],
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

// Other names from cal1 Gain.Detail, pending a verified input form.
const cal1CatalogueOnly = [
  "Amalgamator",
  "Anaesthesia (Machine)",
  "Anaesthesia (Vapourizer)",
  "Analytical Balance",
  "Blood Bank",
  "Defiblillator",
  "Doptone",
  "Drainage Suction",
  "Dry Bath",
  "EKG",
  "Electrosurgical Unit",
  "Fetal monitor",
  "Freeze Bank",
  "Heart rate",
  "Hypo-hyperthermia unit",
  "Incubator",
  "Infant Incubator",
  "Infant Warmer",
  "Julse",
  "Pacer",
  "Pack Heater",
  "Parafine Bath",
  "PATIENT MONITOR",
  "Patient Thermometer",
  "Pulse Oxymeter",
  "Radiant Warmer",
  "Steam Incubator",
  "Tourniquet",
  "Traction",
  "Ultrasound",
  "Ultrasound Therapeutic",
  "Vacuum",
  "Ventilator",
  "Water bath",
  "X-RAY",
  "X-RAY -",
  "X-RAY  (MAS)",
  "X-RAY (DENTAL)",
  "X-RAY (MAS)"
];

function calibrationErrorRule(method) {
  if (method === "general") return "mean-std";
  return additionalCalibrationTypes.find(type => type.method === method)?.errorRule
    ?? legacyCalibrationTypes.find(type => type.method === method)?.errorRule ?? "standard";
}
