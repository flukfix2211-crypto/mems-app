"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { calculatePoint, calculateInfusionPoint, calculateNibpPoint } = require("../calibration-calculation.js");

test("Infusion pump uses workbook two-reading mean, signed error and uncertainty report", () => {
  const result = calculateInfusionPoint({
    nominal: 10,
    standardReadings: [9.75, 9.87]
  });

  assert.equal(Number(result.mean.toFixed(2)), 9.81);
  assert.equal(Number(result.error.toFixed(2)), -0.19);
  assert.equal(Number(result.errorPercent.toFixed(2)), -1.9);
  assert.equal(Number(result.uca.toFixed(3)), 0.149);
  assert.equal(Number(result.expanded.toFixed(4)), 0.3076);
});

test("Infusion Ureport matches all three workbook flow settings", () => {
  const cases = [
    [10, [9.75, 9.87], 0.3076],
    [100, [97.44, 97.52], 2.8],
    [200, [198.81, 198.95], 5.6]
  ];
  for (const [nominal, standardReadings, expected] of cases) {
    const result = calculateInfusionPoint({ nominal, standardReadings });
    assert.ok(Math.abs(result.expanded - expected) < 0.005);
  }
});

test("NIBP uses device mean minus the standard setpoint", () => {
  const result = calculatePoint({
    nominal: 60,
    standardReadings: [null, null, null],
    measuredReadings: [64, 62, 66],
    budget: [0, 0, 0, 0],
    errorRule: "mean-nominal"
  });

  assert.equal(result.mean, 64);
  assert.equal(result.error, 4);
});

test("NIBP reports workbook pressure CMC uncertainty and pulse uncertainty separately", () => {
  const pressure = calculateNibpPoint({ nominal: 60, measuredReadings: [65, 64, 63] });
  const pulse = calculateNibpPoint({ nominal: 120, measuredReadings: [119, 122, 119], pulseRate: true });

  assert.equal(pressure.mean, 64);
  assert.equal(pressure.error, 4);
  assert.equal(Number(pressure.uca.toFixed(3)), 0.794);
  assert.equal(pressure.expanded, 7);
  assert.equal(Number(pulse.expanded.toFixed(4)), 3.5053);
});

test("NIBP Ureport reproduces all nine workbook parameter points", () => {
  const cases = [
    [60, [65, 64, 63], false, 7], [30, [33, 33, 34], false, 7], [120, [119, 122, 119], true, 3.5053],
    [120, [122, 121, 123], false, 7], [80, [86, 85, 86], false, 7], [80, [80, 80, 80], true, 2.5],
    [200, [203, 203, 205], false, 7], [150, [155, 156, 155], false, 7], [60, [60, 60, 60], true, 2.5]
  ];
  for (const [nominal, measuredReadings, pulseRate, expected] of cases) {
    const result = calculateNibpPoint({ nominal, measuredReadings, pulseRate });
    assert.ok(Math.abs(result.expanded - expected) < 0.01);
  }
});
