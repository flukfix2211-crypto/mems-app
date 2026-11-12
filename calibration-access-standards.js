"use strict";

// Cal 05 Access: Manufactory.Detail joined to Standard Tool by Code.
// X-Ray options come from the X-Ray entries in Standard Tool.
const calibrationAccessStandards = {
  "alarm clock": [
    "Seiko · W073-4000 · S/N 680037 · รหัส EEL.BP.14/0667"
  ],
  "amalgamator": [
    "Testo · 470 · S/N 1304077 · รหัส TEC-68-0010",
    "Seiko · W073-4000 · S/N 680037 · รหัส EEL.BP.14/0667"
  ],
  "ambient thermometer": [
    "KIMO · HD200 · S/N 11059978 · รหัส TEM-68-0020"
  ],
  "amg": [
    "Fluke · 717-100G · S/N 1657044 · รหัส PRE-68-0021"
  ],
  "anaesthesia (machine)": [
    "Fluke · VT900A · S/N 6939769 · รหัส 2025005575"
  ],
  "anaesthesia (vapourizer)": [
    "Fluke · Vapor · S/N 6944034 · รหัส 81000"
  ],
  "analytical balance": [
    "Stainless · Class F2 · รหัส MAS-67-0014"
  ],
  "blood bank": [
    "KIMO · HD200 · S/N 11059978 · รหัส TEM-68-0020",
    "EXTECH · TM500 · รหัส 24T2032"
  ],
  "blood pressure": [
    "Fluke · 717-100G · S/N 1657044 · รหัส PRE-68-0021",
    "Fluke · 717-100G · S/N 9924083 · รหัส PRE-68-0019",
    "BIO-TEK · DPM-1B · S/N 34963 · รหัส PRE-67-0020"
  ],
  "blood pressure-": [
    "Fluke · 717-100G · S/N 1657044 · รหัส PRE-68-0021",
    "Fluke · 717-100G · S/N 9924083 · รหัส PRE-68-0019",
    "BIO-TEK · DPM-1B · S/N 34963 · รหัส PRE-67-0020"
  ],
  "centrifuge": [
    "Testo · 470 · S/N 1304077 · รหัส TEC-68-0010",
    "Digical · DT-250TP · S/N 66811 · รหัส TEC-68-0009",
    "Seiko · W073-4000 · S/N 680037 · รหัส EEL.BP.14/0667"
  ],
  "clinical ee thermometer (continuous)": [
    "Hart · 1521 · S/N A36770 · รหัส RB1010-8"
  ],
  "defibrillator": [
    "Fluke · Impulse7000 DP · S/N 4124005 · รหัส 24MD1733",
    "Metron · QA-45 MK III · S/N 45091 · รหัส 24MD1736",
    "Fluke · Impulse 7000 DP · S/N 2071004 · รหัส 24MD1734"
  ],
  "defibrillator-": [
    "Fluke · Impulse7000 DP · S/N 4124005 · รหัส 24MD1733",
    "Metron · QA-45 MK III · S/N 45091 · รหัส 24MD1736",
    "Fluke · Impulse 7000 DP · S/N 2071004 · รหัส 24MD1734"
  ],
  "digital blood pressure": [
    "Fluke · Cufflink · S/N 9110021 · รหัส PRE-68-0018",
    "Fluke · Cufflink · S/N 2090019 · รหัส 24MD1970",
    "Fluke · ProSim 8 · S/N 4156062 · รหัส 24MD1738",
    "Fluke · Prosim 4 · S/N 6928022 · รหัส 80866",
    "Fluke · Prosim 8 · S/N 6838069 · รหัส 30230"
  ],
  "doptone": [
    "Fluke · PS320 · S/N 2092424 · รหัส 24MD1798",
    "Fluke · PS320 · S/N 50013 · รหัส 24MD1797",
    "DATREND · FMS-3 · S/N FMS20050187 · รหัส FTS-68-0002"
  ],
  "drainage suction": [
    "Fluke · 717-100G · S/N 1657044 · รหัส PRE-68-0021",
    "Fluke · 717-100G · S/N 9924083 · รหัส PRE-68-0019"
  ],
  "dry bath": [
    "KIMO · HD200 · S/N 11059978 · รหัส TEM-68-0020"
  ],
  "ekg": [
    "Fluke · ProSim 8 · S/N 4156062 · รหัส 24MD1738",
    "Fluke · MPS 450 · S/N 209101 · รหัส PTS-68-0012",
    "Fluke · Prosim 8 · S/N 6838069 · รหัส 30230"
  ],
  "electrocardiograph": [
    "Fluke · ProSim 8 · S/N 4156062 · รหัส 24MD1738"
  ],
  "electrosurgical unit": [
    "Fluke · QA-ES II · S/N 201270 · รหัส 24MD1739",
    "Fluke · QA-ES Mk II · S/N 6640 · รหัส 24MD1740"
  ],
  "fetal monitor": [
    "Fluke · PS320 · S/N 2092424 · รหัส 24MD1798",
    "Fluke · PS320 · S/N 50013 · รหัส 24MD1797",
    "DATREND · FMS-3 · S/N FMS20050187 · รหัส FTS-68-0002"
  ],
  "flowmeter": [
    "Fluke · VT Plus HF · S/N 2086758 · รหัส 24MD1737",
    "Meas labs · Defender 510 · S/N 153624 · รหัส FLW-68-0006",
    "Fluke · Prosim 8 · S/N 6838069 · รหัส 30230",
    "IMT.Analytics · F2 · S/N BG000164 · รหัส 25MD1934"
  ],
  "freeze bank": [
    "KIMO · HD200 · S/N 11059978 · รหัส TEM-68-0020",
    "EXTECH · TM500 · รหัส 24T2032"
  ],
  "general thermometer": [
    "KIMO · HD200 · S/N 11059978 · รหัส TEM-68-0020"
  ],
  "hematocrit": [
    "Testo · 470 · S/N 316003 · รหัส TEC-66-0003",
    "Testo · 470 · S/N 1304077 · รหัส TEC-68-0010",
    "Digical · DT-250TP · S/N 66811 · รหัส TEC-68-0009",
    "Seiko · W073-4000 · S/N 680037 · รหัส EEL.BP.14/0667"
  ],
  "hypo-hyperthermia unit": [
    "KIMO · HD200 · S/N 11059978 · รหัส TEM-68-0020",
    "EXTECH · TM500 · รหัส 24T2032"
  ],
  "incubator": [
    "KIMO · HD200 · S/N 11059978 · รหัส TEM-68-0020",
    "EXTECH · TM500 · รหัส 24T2032"
  ],
  "infant incubator": [
    "Fluke · INCU II · S/N 3728005 · รหัส INC-68-0006",
    "Fluke · INCU II · S/N 48690041 · รหัส INC-68-0005"
  ],
  "infant incubator-": [
    "Fluke · INCU II · S/N 3728005 · รหัส INC-68-0006"
  ],
  "infant warmer": [
    "Fluke · INCU II · S/N 3728005 · รหัส INC-68-0006"
  ],
  "infared ear thermometer": [
    "Hotech · 336 · S/N 2K140530R14003504 · รหัส IRC-64-0001"
  ],
  "infared thermometer": [
    "HIGH · CN37 · S/N 2006205 · รหัส TR-0008-25",
    "HIGH · CN37 · S/N 2006207 · รหัส TR-0009-25"
  ],
  "infusion pump": [
    "Fluke · IDA 4 Plus · S/N 10232 · รหัส IPA-68-0007",
    "RIGEL · MULT-FLO 4 CH · S/N 09K-0017 · รหัส IPA-66-0012",
    "Fluke · IDA 4 Plus · S/N 12728 · รหัส IPA-68-0008",
    "Rigel · Multi-flo · S/N 44S-0383 · รหัส 25MD2202"
  ],
  "infusion pump-": [
    "Fluke · IDA 4 Plus · S/N 10232 · รหัส IPA-68-0007",
    "RIGEL · MULT-FLO 4 CH · S/N 09K-0017 · รหัส IPA-66-0012",
    "Fluke · IDA 4 Plus · S/N 12728 · รหัส IPA-68-0008"
  ],
  "non-invasive sphygmomanameters": [
    "Fluke · Cufflink · S/N 9110021 · รหัส PRE-68-0018",
    "Fluke · Cufflink · S/N 2090019 · รหัส 24MD1970",
    "Fluke · ProSim 8 · S/N 4156062 · รหัส 24MD1738",
    "Fluke · 717-100G · S/N 1657044 · รหัส PRE-68-0021",
    "Fluke · 717-100G · S/N 9924083 · รหัส PRE-68-0019",
    "BIO-TEK · DPM-1B · S/N 34963 · รหัส PRE-67-0020"
  ],
  "oxygen blender": [
    "Fluke · VT900A · S/N 6939769 · รหัส 2025005575"
  ],
  "oxygen concentrator": [
    "Fluke · VT Plus HF · S/N 2086758 · รหัส 24MD1737",
    "Fluke · VT900A · S/N 6939769 · รหัส 2025005575"
  ],
  "oxygen highflow": [
    "Fluke · VT Plus HF · S/N 2086758 · รหัส 24MD1737"
  ],
  "pacer": [
    "Fluke · Impulse7000 DP · S/N 4124005 · รหัส 24MD1733"
  ],
  "pack heater": [
    "KIMO · HD200 · S/N 11059978 · รหัส TEM-68-0020"
  ],
  "parafine bath": [
    "KIMO · HD200 · S/N 11059978 · รหัส TEM-68-0020"
  ],
  "parameter tester": [
    "KIMO · HD200 · S/N 11059978 · รหัส TEM-68-0020"
  ],
  "patient monitor": [
    "Fluke · Cufflink · S/N 9110021 · รหัส PRE-68-0018",
    "Fluke · Cufflink · S/N 2090019 · รหัส 24MD1970",
    "Fluke · ProSim 8 · S/N 4156062 · รหัส 24MD1738",
    "Fluke · INDEX 2 · S/N 2090008 · รหัส SPO-68-0005",
    "Fluke · INDEX · S/N 9107040 · รหัส SPO-67-0008",
    "Fluke · Prosim 8 · S/N 6838069 · รหัส 30230"
  ],
  "patient monitor-": [
    "Fluke · Cufflink · S/N 9110021 · รหัส PRE-68-0018",
    "Fluke · Cufflink · S/N 2090019 · รหัส 24MD1970",
    "Fluke · ProSim 8 · S/N 4156062 · รหัส 24MD1738",
    "Fluke · INDEX 2 · S/N 2090008 · รหัส SPO-68-0005",
    "Fluke · INDEX · S/N 9107040 · รหัส SPO-67-0008"
  ],
  "patient thermometer": [
    "Fluke · 7102 · S/N A77266 · รหัส TEM-68-0019",
    "Hart · 1521 · S/N A36770 · รหัส RB1010-8"
  ],
  "pharmaceutical refrig.": [
    "Hart · 1521 · S/N A36770 · รหัส RB1010-8",
    "EXTECH · TM500 · รหัส 24T2032"
  ],
  "pulse oxymeter": [
    "Fluke · ProSim 8 · S/N 4156062 · รหัส 24MD1738",
    "Fluke · INDEX 2 · S/N 2090008 · รหัส SPO-68-0005",
    "Fluke · INDEX · S/N 9107040 · รหัส SPO-67-0008"
  ],
  "radiant warmer": [
    "Fluke · INCU II · S/N 3728005 · รหัส INC-68-0006"
  ],
  "refrig.thermometer": [
    "Fluke · 7102 · S/N A77266 · รหัส TEM-68-0019",
    "Hart · 1521 · S/N A36770 · รหัส RB1010-8"
  ],
  "regulator": [
    "Fluke · 717-100G · S/N 1657044 · รหัส PRE-68-0021"
  ],
  "rotator": [
    "BC BIOMEDICAL · USP-50sp · S/N 901265701110 · รหัส MAS-68-0074",
    "Stainless · Class F2 · รหัส MAS-67-0014"
  ],
  "serofuge": [
    "Testo · 470 · S/N 316003 · รหัส TEC-66-0003",
    "Testo · 470 · S/N 1304077 · รหัส TEC-68-0010",
    "Digical · DT-250TP · S/N 66811 · รหัส TEC-68-0009"
  ],
  "steam incubator": [
    "Hart · 1521 · S/N A36770 · รหัส RB1010-8"
  ],
  "suction": [
    "Fluke · 717-100G · S/N 1657044 · รหัส PRE-68-0021",
    "Fluke · 717-100G · S/N 9924083 · รหัส PRE-68-0019"
  ],
  "syringe pump": [
    "Fluke · IDA 4 Plus · S/N 10232 · รหัส IPA-68-0007",
    "RIGEL · MULT-FLO 4 CH · S/N 09K-0017 · รหัส IPA-66-0012",
    "Fluke · IDA 4 Plus · S/N 12728 · รหัส IPA-68-0008",
    "Rigel · Multi-flo · S/N 44S-0383 · รหัส 25MD2202"
  ],
  "therapeutic ultrasound": [
    "BC BIOMEDICAL · USP-50sp · S/N 901265701110 · รหัส MAS-68-0074"
  ],
  "tourniquct": [
    "Fluke · 717-100G · S/N 1657044 · รหัส PRE-68-0021"
  ],
  "traction": [
    "Shimpo · FGE-100X · S/N Z9507F028 · รหัส MAS-66-0111",
    "Shimpo · FGV-200-XY · S/N Z9507F042 · รหัส MAS-68-0102"
  ],
  "ultrasound": [
    "Fluke · 84-555B · S/N 7885 · รหัส D-4578",
    "CIRS · 040GSE · S/N 180531501 · รหัส D-4578",
    "Sun nuclear · 040GSE · S/N U840-011770-029436"
  ],
  "ultrasound 2": [
    "Fluke · 717-100G · S/N 9924083 · รหัส PRE-68-0019"
  ],
  "ultrasound 3": [
    "CIRS · 040GSE · S/N 180531501 · รหัส D-4578"
  ],
  "ultrasound therapeutic": [
    "BC BIOMEDICAL · USP-50sp · S/N 901265701110 · รหัส MAS-68-0074"
  ],
  "vacuum": [
    "Fluke · 717-100G · S/N 1657044 · รหัส PRE-68-0021",
    "Fluke · 717-100G · S/N 9924083 · รหัส PRE-68-0019"
  ],
  "ventilator": [
    "Fluke · VT Plus HF · S/N 2086758 · รหัส 24MD1737",
    "Fluke · VT Plus HF · S/N 9113001 · รหัส 24MD1968",
    "Fluke · VT650 · S/N 4145510 · รหัส 23-64/0702-02",
    "Fluke · VT900A · S/N 6939769 · รหัส 2025005575"
  ],
  "ventilator-": [
    "Fluke · VT Plus HF · S/N 2086758 · รหัส 24MD1737",
    "Fluke · VT Plus HF · S/N 9113001 · รหัส 24MD1968",
    "Fluke · VT650 · S/N 4145510 · รหัส 23-64/0702-02"
  ],
  "water bath": [
    "Hart · 1521 · S/N A36770 · รหัส RB1010-8",
    "KIMO · HD200 · S/N 11059978 · รหัส TEM-68-0020"
  ],
  "weighting machine (adult)": [
    "LS · Class M · รหัส MAS-67-0013"
  ],
  "weighting machine (general)": [
    "Stainless · Class F2 · รหัส MAS-67-0014",
    "LS · Class M · รหัส MAS-67-0013"
  ],
  "weighting machine (neo)": [
    "Stainless · Class F2 · รหัส MAS-67-0014",
    "LS · Class M · รหัส MAS-67-0013"
  ],
  "x-ray": [
    "Victoreen · 4000 M+",
    "RTI · PIRANHA 657 · S/N B2-110521 · รหัส 115A4841",
    "Fluke · 451B · S/N 0000002066"
  ]
};
