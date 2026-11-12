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

function calculateCoefficientVariation(values) {
  if (values.length < 2 || !values.every(Number.isFinite)) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  if (!mean) return null;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  return sd / Math.abs(mean) * 100;
}

if (typeof module !== "undefined") module.exports = { calculatePoint, calculateCoefficientVariation };
