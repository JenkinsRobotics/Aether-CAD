/** Replace blanket fixation in simple authored rectangles with editable dimensions.
 * Complex styling contours retain their explicit fixed constraint; never imply
 * a fully constrained parametric design when only coordinates were authored. */
export function dimensionRectangles(model) {
  for (const part of model.parts) for (const step of part.steps) {
    const drawing = step.arguments.feature_json?.profile;
    if (drawing?.type !== 'drawing') continue;
    drawing.contours.forEach((c, contour) => {
      if (c.type !== 'path' || c.segments.length !== 4 || c.segments.some(s => s.type !== 'line')) return;
      const points = [c.start, ...c.segments.map(s => s.end)];
      if (points.some((p, i) => i < 4 && p[0] !== points[i + 1][0] && p[1] !== points[i + 1][1])) return;
      if (points[4].some((v, i) => v !== points[0][i])) return;
      drawing.constraints = drawing.constraints.filter(k => k.a.contour !== contour);
      drawing.constraints.push({ id: `origin-${contour}`, kind: 'fix', a: { contour, kind: 'point', index: 0 }, point: c.start });
      for (let index = 0; index < 4; index++) drawing.constraints.push({ id: `axis-${contour}-${index}`, kind: points[index][1] === points[index + 1][1] ? 'horizontal' : 'vertical', a: { contour, kind: 'line', index } });
      for (let index = 0; index < 2; index++) drawing.constraints.push({ id: `size-${contour}-${index}`, kind: 'length', a: { contour, kind: 'line', index }, value: Math.hypot(...points[index].map((v, i) => v - points[index + 1][i])) });
    });
  }
  return model;
}
