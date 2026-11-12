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
