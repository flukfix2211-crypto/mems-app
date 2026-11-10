"use strict";

function calculatePoint({ nominal, standardReadings, measuredReadings, budget, errorRule }) {
  const average = values => values.every(Number.isFinite)
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;

  const meanStandard = average(standardReadings);
  const mean = average(measuredReadings);
  // Access IIf uses STD when MeanSTD > 0 is false, including Null.
  const standard = meanStandard > 0 ? meanStandard : nominal;
  const reference = { "mean-std": meanStandard, nominal, reverse: standard, standard }[errorRule];
  const difference = reference === null || mean === null ? null : reference - mean;
  const error = errorRule === "reverse" && difference !== null ? -difference : difference;
  const sd = mean === null ? null : Math.sqrt(
    measuredReadings.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 2
  );
  const uca = sd === null ? null : sd / Math.sqrt(3);
  const expanded = uca === null || !budget.every(Number.isFinite) ? null
    : 2 * Math.hypot(uca, ...budget);

  return { standard, mean, error, sd, uca, expanded };
}

if (typeof module !== "undefined") module.exports = { calculatePoint };
