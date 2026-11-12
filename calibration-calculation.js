"use strict";

function calculatePoint({ nominal, standardReadings, measuredReadings, budget, errorRule }) {
  const average = values => values.every(Number.isFinite)
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;

  const meanStandard = average(standardReadings);
  const mean = average(measuredReadings);
  // Access IIf uses STD when MeanSTD > 0 is false, including Null.
  const standard = meanStandard > 0 ? meanStandard : nominal;
  const reference = { "mean-std": meanStandard, nominal, reverse: standard, standard,
    "mean-nominal": nominal, "xray-percent": nominal }[errorRule];
  const difference = reference === null || mean === null ? null : reference - mean;
  let error = (errorRule === "reverse" || errorRule === "mean-nominal") && difference !== null
    ? -difference : difference;
  if (errorRule === "xray-percent") {
    error = difference === null || !nominal ? null : difference / nominal * 100;
  }
  const sd = mean === null ? null : Math.sqrt(
    measuredReadings.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 2
  );
  const uca = sd === null ? null : sd / Math.sqrt(3);
  const expanded = uca === null || !budget.every(Number.isFinite) ? null
    : 2 * Math.hypot(uca, ...budget);

  return { standard, mean, error, sd, uca, expanded };
}

function studentTCritical95_45(df) {
  if (!Number.isFinite(df) || df <= 0) return null;
  // Exact TINV(0.0455, DoF) values read from both supplied workbooks;
  // log-DoF interpolation keeps the reported factor stable between them.
  const points = [
    [7.1442, 2.428809082234241], [11.6805555556, 2.2548660037131212],
    [12.1032, 2.2313513170834232], [16.53125, 2.1689429956774156],
    [18.2106125, 2.1488523236373958], [34.9448, 2.0762554741250105],
    [37.6370816265, 2.0698647189543729], [82.8828125, 2.0309510329774811],
    [100000, 2.0000274442871735]
  ];
  if (df >= points.at(-1)[0]) return points.at(-1)[1];
  for (let i = 1; i < points.length; i++) {
    const [rightDof, rightK] = points[i];
    if (df <= rightDof) {
      const [leftDof, leftK] = points[i - 1];
      const ratio = (Math.log(df) - Math.log(leftDof)) / (Math.log(rightDof) - Math.log(leftDof));
      return leftK + (rightK - leftK) * ratio;
    }
  }
  return 2;
}

function sampleSpread(values) {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  return { mean, sd };
}

function coverageUncertainty(components, repeatability, count, cmc) {
  const uc = Math.sqrt(components.reduce((sum, value) => sum + value ** 2, 0));
  const rawDof = repeatability === 0 ? 100000 : uc ** 4 / (repeatability ** 4 / (count - 1));
  const dof = Math.min(rawDof, 100000);
  const k = studentTCritical95_45(dof);
  const expanded = k * uc;
  return { uc, dof, k, expanded, reported: Math.max(cmc, expanded) };
}

// Device workbook: UUC setting and two standard-analyzer readings. Error is
// mean analyzer reading minus setting; Ureport is the greater of UE and 2.8% CMC.
function calculateInfusionPoint({ nominal, standardReadings }) {
  const readings = standardReadings;
  if (readings.length !== 2 || !readings.every(Number.isFinite) || !Number.isFinite(nominal)) {
    return { standard: nominal, mean: null, error: null, errorPercent: null, sd: null, uca: null, expanded: null };
  }
  const { mean, sd } = sampleSpread(readings);
  const repeatability = sd / Math.sqrt(readings.length);
  const uStd = Math.max(0.024 * mean, 0.05) / Math.sqrt(3);
  const uResolution = (0.01 / 2) / Math.sqrt(3);
  const uncertainty = coverageUncertainty([uStd, uResolution, repeatability], repeatability, readings.length, 0.028 * Math.abs(nominal));
  const error = mean - nominal;
  return { standard: nominal, mean, error, errorPercent: nominal ? error / nominal * 100 : null, sd,
    uca: uncertainty.uc, expanded: uncertainty.reported, ue: uncertainty.expanded,
    dof: uncertainty.dof, coverageFactor: uncertainty.k };
}

// NIBP workbook: three UUC reads, reference accuracy/resolution and repeatability
// form the uncertainty budget; the certificate reports max(CMC, k*uc).
function calculateNibpPoint({ nominal, measuredReadings, pulseRate = false }) {
  if (measuredReadings.length !== 3 || !measuredReadings.every(Number.isFinite) || !Number.isFinite(nominal)) {
    return { standard: nominal, mean: null, error: null, sd: null, uca: null, expanded: null };
  }
  const { mean, sd } = sampleSpread(measuredReadings);
  const repeatability = sd / Math.sqrt(measuredReadings.length);
  const uStd = (pulseRate ? 2 : 0.5 + 0.005 * nominal) / Math.sqrt(3);
  const uResolution = (1 / 2) / Math.sqrt(3);
  const uncertainty = coverageUncertainty([uStd, uResolution, repeatability], repeatability, measuredReadings.length, pulseRate ? 2.5 : 7);
  return { standard: nominal, mean, error: mean - nominal, sd, uca: uncertainty.uc,
    expanded: uncertainty.reported, ue: uncertainty.expanded, dof: uncertainty.dof,
    coverageFactor: uncertainty.k };
}

function calculateCoefficientVariation(values) {
  if (values.length < 2 || !values.every(Number.isFinite)) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  if (!mean) return null;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  return sd / Math.abs(mean) * 100;
}

if (typeof module !== "undefined") module.exports = { calculatePoint, calculateInfusionPoint, calculateNibpPoint, calculateCoefficientVariation };
