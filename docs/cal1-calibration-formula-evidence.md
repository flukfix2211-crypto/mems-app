# cal1 calibration formula evidence

Source: `D:\โปรแกรมสอบเทียบ\cal1 ถ่ายโอน รพ พหล.-พื้นฐาน 29 มิย 69 - 17 กค 69.mdb`

SHA-256: `A181AF0BE5AA0F6803BDEEEE231C5DDD3EFED455C53B19E7FA454D20E370C27C`
Inspection: Microsoft ACE/DAO OLE DB opened the MDB read-only. No Access data was modified.

## Evidence observed

- `Gain` has 56 `Detail` rows with `Gain+`, `Gain-`, and `Units`; 39 rows were the additional catalogue shown by MEMs.
- `ZCER SUB` stores `STD`, three `STD-1..3` readings, and three `SAM-1..3` readings for the ordinary worksheet pattern.
- Access `Print Cert` queries use different signs and tolerance expressions by category and, for some devices, by `Remark`. The web catalogue keeps the source query name in each type definition.
- Common query expressions include `Standard = IIf(MeanSTD > 0, MeanSTD, STD)`, `Error = Standard - Mean`, `Error = Mean - Standard`, and `Error = MeanSTD - Mean`. The web calculation uses the selected type's configured rule.
- X-Ray queries include five-reading coefficient of variation (`sqrt(sum((reading - mean)^2)/4) * 100 / mean`) and per-setting percentage error (`(setting - reading) * 100 / setting`). MEMs calculates CV from the entered point means using sample standard deviation; with five points, the denominator matches the Access expression.

## Coverage

All 39 additional `Gain.Detail` names are now selectable as calibration types, with a registration entry, measurement sheet(s), source query, error rule, and acceptance-limit rule where the Access query exposes one. Multi-parameter forms are represented as separate sheets (for example Defiblillator, EKG, Patient Monitor, Infant Incubator, Radiant Warmer, and Ventilator).

## Interpretation notes

- Access often branches on `Remark`; the MEMs form represents these branches as separate parameter sheets. Where the old database has no example record for a `Detail`/`Remark` pair, its parameter label and sheet grouping are inferred from the corresponding `Add New` and `Print Cert` query names plus `Gain` values.
- The original X-Ray reports have additional settings and output fields beyond the shared three-round MEMs worksheet. MEMs preserves the percentage error and five-point CV calculations in the shared sheet; detailed exposure-specific formulas and report layout should be treated as a remaining compatibility limitation until checked against a populated X-Ray certificate.
- Access report controls can contain calculations outside QueryDef SQL. This note records formulas visible in the MDB queries and does not claim to have inspected rendered report-control expressions.

## Workbook additions (2026-11-12)

Sources in the project folder:

- `Infusion Pump 228 INF- 104450.xlsx`
- `NIBP 120 BPD -137309.xlsx`
- `Cal 05 รพ.พหล  2569.accdb`

The two `.xlsx` files were reopened after the user removed their password. Their worksheet values and formulas were read through Microsoft ACE and the workbook XML. The new Access database was reopened read-only via DAO/ACE on 2026-11-12. Its forms, QueryDefs, Gain, Manufactory, and Standard Tool tables were inspected. No source workbook or Access rows were modified.

Access source: `D:\โปรแกรมสอบเทียบ\Cal 05 รพ.พหล  2569.accdb`

SHA-256: `C3C45B7BC2C792AFCE1DCCCA530CE55D638B30B70F5730A5757F3DAD2FF00510`

Workbook SHA-256 values:

- Infusion: `759A2B4DBB8F4B6187627E229E4D22D1C38C2EC875020C9EA53A31D3BE74E199`
- NIBP: `33FB537827D657312F27853DD2900A0DAAFB5579FFA43585AD1C72B785A18E54`

### Infusion Pump

- Registration data observed: ID `104450`, asset `6515-025-1001-104/51`, Terumo `TE-171`, S/N `07050178`.
- Registration data observed in the workbook: ID `104450`, asset `6515-025-1001-104/51`, Terumo `TE-171`, S/N `07050178`.
- The device workbook is the specific form for this instrument and supersedes the generic three-round Infusion Access report: it captures one UUC setting and two Standard Readings. Its traceability row names `Infusion Analyzer`, S/N `3749056`, Cert `MMP-0063-26`.
- `Mean STD Reading=AVERAGE(reading1,reading2)`, `Error=Mean STD Reading-UUC setting`, and `% Error=Error/UUC setting*100`. For UUC setting 10 and readings 9.75, 9.87, the workbook calculates 9.81, -0.19, -1.90%.
- Workbook uncertainty: `u_std=MAX(2.4%*Mean STD Reading,0.05)/sqrt(3)`, `u_res=(0.01/2)/sqrt(3)`, `u_rep=STDEV.S(two readings)/sqrt(2)`, `uc=sqrt(sum(component^2))`, Welch-Satterthwaite DoF, `k=TINV(0.0455,DoF)`, `UE=k*uc`, and `Ureport=MAX(2.8%*UUC setting,UE)`. The workbook example returns `Ureport≈0.3076` at setting 10.
- Access QueryDef `Print Cert Infusion` is the active formula evidence: `MeanSTD=(STD-1+STD-2+STD-3)/3`, `Mean=(SAM-1+SAM-2+SAM-3)/3`, `Standard=IIf(MeanSTD>0,MeanSTD,STD)`, and `Error=Standard-Mean`.
- Access calculates sample SD as `sqrt(sum((SAM-n - Mean)^2)/2)` and `UCA=SD/sqrt(3)`. The source acceptance expression is `abs(Error) < Gain+ * STD`; the `Gain` row for `Infusion Pump` has `Gain+=0.1`, `Gain-=-0.1`, so the displayed positive acceptance value is 10% of the STD setting.
- Access query `R-STD code Infusion` maps an instrument's `Detail` to `Manufactory.Code` and `Standard Tool`. The Access database contains a Terumo TE-112 to Fluke IDA 4 Plus mapping, but the specific workbook for ID 104450 identifies the actual reference as Infusion Analyzer S/N `3749056`, Cert `MMP-0063-26`; MEMS now uses the specific workbook reference.
- Example measurements in the workbook are not imported into MEMS history.

### NIBP

- Registration data observed: ID `137309`, asset `6515-069-3102-63/63`, Omron `HBP-9020`, S/N `02008795LF`, department `ธนาคารเลือด`.
- Registration data observed in the workbook: ID `137309`, asset `6515-069-3102-63/63`, Omron `HBP-9020`, S/N `02008795LF`, department `ธนาคารเลือด`.
- The workbook has three parameters: systolic, diastolic, and pulse rate. It compares one STD setpoint with three device readings. `Mean=AVERAGE(three device readings)`, `Error=Mean-STD setting`.
- Access `Print Cert NIBP-New` and `NIBP-Sub-BP/BPD/BPM/Heart Rate` each calculate three STD reads and three device reads. `Standard=IIf(MeanSTD>0,MeanSTD,STD)`, `Error=Mean-Standard`, sample SD uses denominator 2, and `UCA=SD/sqrt(3)`. Access lists Fluke Cufflink NIBP-Analyzers (S/N `9110021`, cert `PRE-68-0018`; S/N `2090019`, cert `24MD1970`) and ProSim 8 (S/N `4156062`, cert `24MD1738`) in its standard-tool table. The specified workbook also lists simulator S/N `3240040`, cert `MMP-0061-26`; both references are retained in MEMS notes for operator confirmation.
- The workbook identifies a Vital Sign Simulator S/N `3240040`, certificate `MMP-0061-26`, calibrated 21-Apr-2026. This matches the MEMS FLUKE ProSim8 standard reference.
- Pressure uncertainty components are `u_std=(0.5+0.5%*STD setting)/sqrt(3)`, `u_res=(1/2)/sqrt(3)`, and `u_rep=STDEV.S(three device readings)/sqrt(3)`. Pulse uses `u_std=2/sqrt(3)` with the same resolution and repeatability rules. The workbook combines them to `uc`, calculates DoF and `k=TINV(0.0455,DoF)`, then reports `MAX(7 mmHg, k*uc)` for pressure and `MAX(2.5 BPM,k*uc)` for pulse. Example rows confirm 7 mmHg and 3.5053 BPM respectively.
- Workbook example readings and environmental values are not imported into MEMS history. The NIBP reference is `Vital sign simulator`, S/N `3240040`, Cert `MMP-0061-26`.

The Infusion entry sheet follows the specific device workbook and captures a UUC setting plus two Standard Readings per point. NIBP retains the workbook's three parameters, one setpoint, and three device reads per point. Both methods calculate uncertainty automatically from workbook formulas; the earlier generic Access uncertainty budget controls are hidden for these methods. The generic Access Infusion report still has a separate three-round formula, documented above, but is not used for the two-reading device workbook.
