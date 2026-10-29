import {
  Model,
  polygon,
  rounded,
  rectangle,
  circle,
  radial,
  qy,
} from "../model-kit.mjs";
const m = new Model(
  "wrench",
  "Adjustable Wrench",
  "A 200 mm adjustable wrench with a forged frame, sliding jaw, adjustment roller, captive shaft and grip inserts.",
);
m.tags = ["Extrude", "Pocket", "Hole Wizard", "Revolve", "Chamfer"];
const frame = m.part(
  "frame",
  "Forged wrench frame",
  "steel",
  "Native outline, relieved handle, jaw guide and drilled hanging eye.",
);
frame
  .pad(
    "Forged outline",
    [
      polygon([
        [-168, -6],
        [-159, -11],
        [-62, -12],
        [-34, -22],
        [33, -22],
        [33, 11],
        [18, 11],
        [18, -6],
        [-7, -6],
        [-7, 32],
        [-24, 32],
        [-32, 15],
        [-62, 10],
        [-159, 8],
      ]),
    ],
    0,
    12,
  )
  .finish("Forged edge break", 0.3, 12)
  .pad("Handle relief front", [rounded(100, 9, 4, -108, -1)], 12, 1.8, "cut")
  .pad("Jaw guide", [rectangle(10, 28, -16, 12)], 12, 12, "cut")
  .pad("Adjustment roller window", [rounded(23, 18, 3, -30, -3)], 12, 12, "cut")
  .holes("Hanging eye — through hole", [[-155, -1]], 7, 12, 12, {
    through: true,
    cutType: "countersink",
    counterDiameter: 9,
    angle: 90,
  });
m.place("Wrench frame", frame);
const jaw = m
  .part("jaw", "Sliding jaw", "steel")
  .pad(
    "Jaw shoulder",
    [
      polygon([
        [-21, -2],
        [-11, -2],
        [-11, 10],
        [18, 10],
        [18, 22],
        [-21, 22],
      ]),
    ],
    0,
    11.6,
  )
  .pad("Guide tongue", [rectangle(8.8, 28, -16, -2)], 3.4, 4.8, "add")
  .pad(
    "Rack tooth gaps",
    Array.from({ length: 7 }, (_, i) => rectangle(4, 1.5, -19.5, -13 + i * 3)),
    8.2,
    4.8,
    "cut",
  )
  .finish("Jaw edge break", 0.4, 11.6);
m.place("Adjustable jaw", jaw, [0, 0, 0.2]);
const roller = m.part("roller", "Adjustment roller", "brass").revolve(
  "Turned roller",
  polygon([
    [2, 0],
    [7, 0],
    [8, 1],
    [8, 15],
    [7, 16],
    [2, 16],
  ]),
);
for (let i = 0; i < 6; i++)
  roller.ring(`Grip groove ${i + 1}`, 8.1, 6.7, 1.5 + i * 2.3, 1, "cut");
roller.finish("Roller end bevel", 0.35, 16);
m.place("Adjustment roller", roller, [-38, -3, 6], qy(Math.PI / 2));
const pin = m
  .part("pin", "Captive roller shaft", "steel")
  .ring("Shaft", 1.95, 0, 0, 25)
  .ring("Retaining head", 3.3, 0, 0, 1.5, "add");
m.place("Roller shaft", pin, [-43, -3, 6], qy(Math.PI / 2));
const grip = m
  .part("grip", "Recessed grip insert", "rubber")
  .pad("Molded grip", [rounded(98, 7.5, 3.7)], 0, 1.6);
m.place("Handle grip", grip, [-108, -1, 10.2]);
const marker = m
  .part("marker", "Jaw scale index", "plastic")
  .pad("Scale index", [rectangle(1.2, 4)], 0, 0.3);
for (let i = 0; i < 6; i++)
  m.place(`Jaw scale mark ${i + 1}`, marker, [-5 + i * 4, -14, 12]);
m.mate("Adjustable jaw", "prismatic", "Wrench frame", [0, 1, 0]);
m.mate("Adjustment roller", "revolute", "Roller shaft");
m.motion =
  "Grounded frame, sliding jaw and rotating adjustment roller. Demonstrate 0–10 mm jaw travel; roller and jaw are independent.";
export default m;
