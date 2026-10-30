// Display model in millimetres at 1:100. Sources are Discovery OV-103
// HAER TX-116-A sheets 4, 5, 7 and stack TX-116-J sheet 3, hosted by NASA.
// Overall length includes the swept tail: it is NOT the fuselage length.
export const shuttleDimensions = Object.freeze({
  scale: 100,
  orbiterLength: 370.4,
  fuselageLength: 328.9,
  span: 238,
  flightHeight: 140.9, // Gear retracted; not the 16.55/17.20 m runway dimensions.
  payloadLength: 182.88, // 60 ft useful bay; exterior door is 61 ft 1/2 in.
  payloadDiameter: 45.72,
  doorLength: 186.055,
  doorAft: 57.1,
  tankLength: 466.9,
  tankDiameter: 83.8,
  stackHeight: 564,
  boosterLength: 457.2,
  boosterDiameter: 37.1,
  boosterOffset: 63.6,
  orbiterDatum: [0, -79.6, 69.1],
});
export const shuttleSources = [
  {
    title:
      "NASA / HAER Discovery measured elevations and plan (sheets 4, 5, 7)",
    url: "https://www.nasa.gov/wp-content/uploads/2024/12/space-shuttle-orbiter-drawings.pdf",
  },
  {
    title: "NASA / HAER Shuttle stack measured elevations (sheet 3)",
    url: "https://www.nasa.gov/wp-content/uploads/2024/12/stack-assembly-drawings.pdf",
  },
  {
    title: "NASA Shuttle component dimensions",
    url: "https://www.nasa.gov/reference/the-space-shuttle/",
  },
];
// Intermediate stations and skin/wall thicknesses are a simplified reading of
// the published outlines, not flight hardware manufacturing specifications.
export const fuselageStations = [
  [0, 64, 61.3, 18, 3.65],
  [40, 60, 61.3, 18, 3.65],
  [57.1, 54, 61.3, 18, 3.65],
  [243.155, 54, 61.3, 18, 3.65],
  [255, 51.8, 61.3, 17, 3.65],
  [268, 49, 58, 17, 2],
  [282, 44, 49, 16, -2.5],
  [296, 36, 39, 14, -5.5],
];
export const noseStations = [
  fuselageStations.at(-1),
  [302, 32, 35, 13, -7],
  [310, 26, 29, 11, -8],
  [318, 20, 23, 9, -9],
  [325, 9, 16, 4, -9],
  [328.9, 1.2, 4, 0.5, -9],
];
// Half-plan from sheet 7: near-parallel strake, then the outer delta.
export const wingOutline = [
  [25, 10],
  [38.5, 8.2],
  [119, 22.6],
  [119, 40.3],
  [110, 59.2],
  [50.7, 118.7],
  [45, 132],
  [27, 253],
];
