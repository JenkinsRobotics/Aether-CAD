/** Light angles use the modeling plane: azimuth about the up axis, elevation
 * above the ground. Retain the same appearance when changing Y/Z-up. */
export function environmentLightDirection(azimuthDegrees: number, elevationDegrees: number, upAxis: 'y' | 'z'): [number, number, number] {
  const azimuth = azimuthDegrees * Math.PI / 180, elevation = elevationDegrees * Math.PI / 180;
  const x = Math.cos(azimuth) * Math.cos(elevation), y = Math.sin(azimuth) * Math.cos(elevation), z = Math.sin(elevation);
  return upAxis === 'z' ? [x * 10, y * 10, z * 10] : [x * 10, z * 10, -y * 10];
}
