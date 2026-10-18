"""Exact shape properties from FreeCAD/OCCT, with explicit SI density.

Shape.MatrixOfInertia is the unit-density volume tensor about the center of
mass in global axes (mm^5). Converting to kg*m^2 multiplies by density*1e-15.
"""

import math


def physical_properties(shapes, density=None):
    if density is not None:
        if isinstance(density, bool):
            raise ValueError("Density must be a positive finite value in kg/m³.")
        density = float(density)
        if not math.isfinite(density) or density <= 0:
            raise ValueError("Density must be a positive finite value in kg/m³.")
    result = []
    for key, shape in shapes.items():
        # Boolean/region operations can return a Compound, which exposes volume
        # but not CenterOfMass or MatrixOfInertia. Integrate its native solids;
        # do not approximate physical properties from the render mesh.
        solids = shape.Solids
        if not solids or not shape.isValid():
            raise ValueError("Physical properties require valid solid geometry.")
        volumes = [solid.Volume for solid in solids]
        if any(not math.isfinite(value) or value <= 0 for value in volumes):
            raise ValueError("Physical properties require positive finite volumes.")
        volume = math.fsum(volumes)
        centers = [[solid.CenterOfMass.x, solid.CenterOfMass.y, solid.CenterOfMass.z]
                   for solid in solids]
        center = [math.fsum(v * c[i] for v, c in zip(volumes, centers)) / volume
                  for i in range(3)]
        box = shape.BoundBox
        measurement = {
            "body_id": key,
            "volume_mm3": volume,
            "area_mm2": shape.Area,
            "center_mm": center,
            "bounds_mm": [box.XLength, box.YLength, box.ZLength],
        }
        if density is not None:
            # Parallel-axis theorem, about the compound's volume centroid.
            inertia = [[0.0] * 3 for _ in range(3)]
            for solid, v, c in zip(solids, volumes, centers):
                tensor = solid.MatrixOfInertia
                delta = [c[i] - center[i] for i in range(3)]
                distance2 = sum(d*d for d in delta)
                for i in range(3):
                    for j in range(3):
                        inertia[i][j] += getattr(tensor, f"A{i+1}{j+1}") + v * (
                            (distance2 if i == j else 0) - delta[i]*delta[j])
            measurement.update(
                {
                    "density_kg_m3": density,
                    "mass_kg": volume * density * 1e-9,
                    "inertia_kg_m2": [
                        [
                            inertia[i][j] * density * 1e-15
                            for j in range(3)
                        ]
                        for i in range(3)
                    ],
                }
            )
        result.append(measurement)
    return result
