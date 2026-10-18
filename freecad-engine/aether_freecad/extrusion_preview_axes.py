"""Transient edit handles resolved on the same path as the extrusion tool."""


def capture_preview_axes(planar, direction, parameters):
    axes = parameters.get('_preview_axes')
    if not isinstance(axes, list) or axes:
        return
    origin = planar.Faces[0].CenterOfMass + direction * float(parameters.get('starting_offset_mm', 0))
    mode = parameters.get('end_type', 'blind')
    second = parameters.get('second_end')

    def add(side, parameter, vector, scale=1):
        axes.append({
            'side': side, 'parameter': parameter,
            'originMillimeters': list(origin), 'direction': list(vector),
            'scale': scale, 'reversed': bool(parameters.get('reversed', False)),
        })

    if mode == 'symmetric':
        add('primary', 'distance', direction, 0.5)
        add('opposite', 'distance', direction * -1, 0.5)
        return
    if mode == 'blind':
        add('primary', 'distance', direction)
    if ((second is not None and second.get('end_type', 'blind') == 'blind')
            or parameters.get('second_distance_mm', 0) > 0):
        add('opposite', 'second', direction * -1)
