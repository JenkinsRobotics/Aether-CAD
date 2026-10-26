/** Display-only cross-section faces from the rendered mesh, including holes.
* The exact CAD body is never modified. Other cuts trim each cap as well. */
import { BufferGeometry, Float32BufferAttribute, Plane, ShapeUtils, Vector2, Vector3 } from 'three/webgpu';
export function sectionCapGeometry(geometry: BufferGeometry, planes: readonly Plane[]): BufferGeometry {
  const position = geometry.getAttribute('position'), index = geometry.index;
  const output: number[] = [];
  if (!position)
    return new BufferGeometry();
  geometry.computeBoundingBox();
  const epsilon = Math.max(geometry.boundingBox!.getSize(new Vector3()).length() * 1e-7, 1e-7);
  for (const plane of planes) {
    const vertices: Vector3[] = [];
    const buckets = new Map<string, number[]>();
    const edges = new Map<string, [number, number]>();
    // Weld neighboring triangle intersections before tracing the closed loops.
    const vertex = (p: Vector3) => {
      const cell = p.toArray().map(v => Math.floor(v / epsilon));
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++) {
            for (const id of buckets.get(`${cell[0] + x},${cell[1] + y},${cell[2] + z}`) ?? [])
              if (vertices[id].distanceToSquared(p) < epsilon * epsilon)
                return id;
          }
      const key = cell.join(','), id = vertices.length;
      vertices.push(p);
      buckets.set(key, [...(buckets.get(key) ?? []), id]);
      return id;
    };
    const triangle = [new Vector3(), new Vector3(), new Vector3()];
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      triangle.forEach((p, k) => p.fromBufferAttribute(position, index ? index.getX(i + k) : i + k));
      const distances = triangle.map(p => plane.distanceToPoint(p));
      if (distances.every(d => Math.abs(d) <= epsilon))
        continue;
      const points: Vector3[] = [];
      for (let k = 0; k < 3; k++) {
        const next = (k + 1) % 3, d = distances[k], e = distances[next];
        if (Math.abs(d) <= epsilon)
          points.push(triangle[k].clone());
        else if ((d > epsilon && e < -epsilon) || (d < -epsilon && e > epsilon))
          points.push(triangle[k].clone().lerp(triangle[next], d / (d - e)));
      }
      const ids = [...new Set(points.map(vertex))];
      if (ids.length === 2)
        edges.set([...ids].sort((a, b) => a - b).join(','), [ids[0], ids[1]]);
    }
    const adjacent = new Map<number, number[]>();
    for (const [a, b] of edges.values()) {
      adjacent.set(a, [...(adjacent.get(a) ?? []), b]);
      adjacent.set(b, [...(adjacent.get(b) ?? []), a]);
    }
    const used = new Set<string>(), loops: number[][] = [];
    const edgeKey = (a: number, b: number) => a < b ? `${a},${b}` : `${b},${a}`;
    for (const [a, b] of edges.values()) {
      if (used.has(edgeKey(a, b)))
        continue;
      const loop = [a];
      let previous = a, current = b;
      used.add(edgeKey(a, b));
      while (current !== a && loop.length <= edges.size) {
        loop.push(current);
        const next = adjacent.get(current)?.find(id => id !== previous && !used.has(edgeKey(current, id)));
        if (next === undefined)
          break;
        used.add(edgeKey(current, next));
        previous = current;
        current = next;
      }
      if (current === a && loop.length >= 3)
        loops.push(loop);
    }
    const normal = plane.normal;
    const reference = Math.abs(normal.z) < .9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    const u = reference.cross(normal).normalize(), v = normal.clone().cross(u);
    const projected = loops.map(loop => loop.map(id => new Vector2(vertices[id].dot(u), vertices[id].dot(v))));
    const areas = projected.map(loop => Math.abs(ShapeUtils.area(loop)));
    const contains = (loop: Vector2[], p: Vector2) => {
      let inside = false;
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        if ((loop[i].y > p.y) !== (loop[j].y > p.y) &&
            p.x < (loop[j].x - loop[i].x) * (p.y - loop[i].y) / (loop[j].y - loop[i].y) + loop[i].x) {
          inside = !inside;
        }
      }
      return inside;
    };
    // Even nesting depths are solid islands; immediate children are their holes.
    const parents = projected.map((loop, i) => projected.reduce((parent, candidate, j) => {
      const encloses = j !== i && areas[j] > areas[i] && contains(candidate, loop[0]);
      return encloses && (parent < 0 || areas[j] < areas[parent]) ? j : parent;
    }, -1));
    const depth = (i: number): number => parents[i] < 0 ? 0 : 1 + depth(parents[i]);
    projected.forEach((loop, i) => {
      if (depth(i) % 2)
        return;
      const holes = projected.flatMap((hole, j) => parents[j] === i ? [{ points: hole, ids: loops[j] }] : []);
      const all = [...loops[i], ...holes.flatMap(hole => hole.ids)];
      for (const face of ShapeUtils.triangulateShape(loop, holes.map(hole => hole.points))) {
        let polygon = face.map(id => vertices[all[id]].clone());
        for (const other of planes) {
          if (other === plane)
            continue;
          const clipped: Vector3[] = [];
          polygon.forEach((a, k) => {
            const b = polygon[(k + 1) % polygon.length];
            const da = other.distanceToPoint(a), db = other.distanceToPoint(b);
            if (da >= -epsilon) clipped.push(a);
            if ((da >= -epsilon) !== (db >= -epsilon)) clipped.push(a.clone().lerp(b, da / (da - db)));
          });
          polygon = clipped;
        }
        for (let k = 1; k + 1 < polygon.length; k++)
          for (const p of [polygon[0], polygon[k], polygon[k + 1]])
            output.push(p.x, p.y, p.z);
      }
    });
  }
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(output, 3));
  result.computeVertexNormals();
  return result;
}
