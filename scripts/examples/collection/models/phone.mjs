import {
  Model,
  polygon,
  rounded,
  rectangle,
  circle,
  radial,
  qx,
  qy,
  materials,
} from "../model-kit.mjs";
const m = new Model(
  "smartphone",
  "Studio Smartphone",
  "A modern 154 × 74 mm phone with a machined enclosure, display stack, camera modules, buttons, battery and circuit board.",
);
m.tags = ["Extrude", "Pocket", "Hole Wizard", "Revolve", "Fillet", "Chamfer"];
const frame = m.part(
  "frame",
  "Machined aluminum enclosure",
  "blue",
  "Rounded enclosure, genuine internal pocket, counterbored screw holes, side buttons, connector and speaker apertures.",
);
frame
  .pad("Enclosure blank", [rounded(74, 154, 11)], 0, 7.8)
  .pad("Electronics cavity", [rounded(69, 149, 9)], 7.8, 6.7, "cut")
  .pad(
    "USB-C aperture",
    [rounded(9, 3.2, 1.5, 0, 4)],
    -78,
    5,
    "cut",
    "XZ",
    true,
  )
  .pad(
    "Power button opening",
    [rounded(22, 2.8, 1.2, 19, 4)],
    38,
    5,
    "cut",
    "YZ",
  )
  .pad(
    "Volume button openings",
    [rounded(16, 2.8, 1.2, 18, 4), rounded(16, 2.8, 1.2, 39, 4)],
    -38,
    5,
    "cut",
    "YZ",
    true,
  )
  .holes(
    "Speaker perforations",
    Array.from({ length: 12 }, (_, i) => [
      (i < 6 ? -27 : 13) + (i % 6) * 2.7,
      4,
    ]),
    1.4,
    -78,
    5,
    { plane: "XZ", reversed: true, through: true },
  )
  .holes(
    "Back cover fasteners",
    [
      [-29, -65],
      [29, -65],
      [-29, 65],
      [29, 65],
    ],
    1.6,
    1.1,
    1.1,
    {
      through: true,
      cutType: "counterbore",
      counterDiameter: 2.6,
      counterDepth: 0.5,
    },
  );
m.place("Aluminum frame", frame);
const back = m
  .part("back", "Rear glass panel", {
    ...materials.glass,
    color: "#234d70",
    opacity: 1,
  })
  .pad("Rear glass", [rounded(72, 152, 10)], 0, 0.8)
  .pad(
    "Camera island clearance",
    [rounded(36, 39, 8, -16, 48)],
    0.8,
    0.8,
    "cut",
  );
m.place("Rear glass", back, [0, 0, -0.8]);
const bezel = m
  .part("bezel", "Display perimeter seal", "rubber")
  .pad(
    "Display gasket",
    [rounded(71, 151, 10), rounded(67.5, 147.5, 8)],
    0,
    0.55,
    "new",
    "XY",
    false,
    [34.5, 0],
  );
m.place("Display perimeter seal", bezel, [0, 0, 7.8]);
const display = m
  .part("display", "Display glass", {
    ...materials.glass,
    color: "#172c44",
    opacity: 1,
  })
  .pad("Cover glass", [rounded(68.5, 148.5, 8.8)], 0, 0.6)
  .finish("Glass edge radius", 0.18, 0.6, "fillet");
m.place("Display glass", display, [0, 0, 8.35]);
const screen = m
  .part("screen", "OLED active display", {
    ...materials.plastic,
    color: "#376c98",
    roughness: 0.17,
  })
  .pad("Display active area", [rounded(64.5, 144.5, 7)], 0, 0.08);
m.place("Active screen", screen, [0, 0, 8.96]);
const island = m
  .part("island", "Camera mounting island", "blue")
  .pad("Camera island", [rounded(35, 38, 7)], 0, 2.7)
  .holes(
    "Three camera bores",
    [
      [-8, 9],
      [-8, -10],
      [9, 0],
    ],
    12,
    2.7,
    2.7,
    {
      through: true,
      cutType: "counterbore",
      counterDiameter: 14,
      counterDepth: 1,
    },
  );
m.place("Camera island", island, [-16, 48, -0.7], qx(Math.PI));
const barrel = m.part("camera", "Camera housing", "aluminum").revolve(
  "Camera stepped section",
  polygon([
    [5.4, 0],
    [6, 0],
    [6, 2],
    [7.2, 2],
    [7.2, 3.2],
    [6.8, 3.7],
    [5.4, 3.7],
  ]),
);
const lens = m
  .part("lens", "Camera optical cover", {
    ...materials.glass,
    color: "#142b36",
    opacity: 0.9,
  })
  .ring("Optical disk", 5.35, 0, 0, 0.65)
  .finish("Lens rim radius", 0.15, 0.65, "fillet");
for (const [i, [x, y]] of [
  [-8, 9],
  [-8, -10],
  [9, 0],
].entries()) {
  m.place(
    `Camera housing ${i + 1}`,
    barrel,
    [-16 + x, 48 - y, -2.2],
    qx(Math.PI),
  );
  m.place(`Camera lens ${i + 1}`, lens, [-16 + x, 48 - y, -5.25], qx(Math.PI));
}
const flash = m
  .part("flash", "Flash diffuser", { ...materials.plastic, color: "#f1e9c3" })
  .ring("Diffuser", 2.4, 0, 0, 0.5);
m.place("Flash", flash, [-7, 35, -3.5], qx(Math.PI));
const power = m
  .part("power", "Power button", "aluminum")
  .pad("Button cap", [rounded(21, 2.5, 1.2)], 0, 0.7);
m.place("Power button", power, [37, 19, 4], [0.5, 0.5, 0.5, 0.5]);
const volume = m
  .part("volume", "Volume button", "aluminum")
  .pad("Button cap", [rounded(15, 2.5, 1.2)], 0, 0.7);
for (const y of [18, 39])
  m.place(`Volume button ${y}`, volume, [-37, y, 4], [-0.5, -0.5, 0.5, 0.5]);
const battery = m
  .part("battery", "Battery pack", { ...materials.plastic, color: "#31333a" })
  .pad("Battery cell envelope", [rounded(55, 89, 3)], 0, 4.6);
m.place("Battery", battery, [1, -20, 1.1]);
const board = m
  .part("board", "Logic board", "pcb")
  .pad("Board outline", [rounded(58, 39, 3)], 0, 0.9)
  .holes(
    "Board mounting holes",
    [
      [-25, -15],
      [25, -15],
      [-25, 15],
      [25, 15],
    ],
    1.8,
    0.9,
    0.9,
    { through: true },
  );
m.place("Logic board", board, [0, 48, 1.2]);
const shield = m
  .part("shield", "Logic shield", "steel")
  .pad("EMI shield", [rounded(22, 20, 1)], 0, 1.2);
m.place("Logic shield", shield, [9, 47, 2.1]);
const speaker = m
  .part("speaker", "Speaker module", "plastic")
  .pad("Speaker enclosure", [rounded(49, 10, 2)], 0, 4.5);
m.place("Bottom speaker", speaker, [0, -68, 1.1]);
const pill = m
  .part("pill", "Front sensor window", "rubber")
  .pad("Sensor window", [rounded(21, 5.3, 2.6)], 0, 0.1);
m.place("Front sensor window", pill, [0, 63, 9.05]);
export default m;
