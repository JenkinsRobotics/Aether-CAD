import type { MeasurePoint as Vec } from './measurement-geometry';
export interface MeasurementFrame {
    origin: Vec;
    xAxis: Vec;
    yAxis: Vec;
    zAxis: Vec;
    label: string;
}
export function frameCoordinates(point: Vec, frame?: MeasurementFrame | null): Vec {
    if (!frame)
        return point;
    const d = point.map((v, i) => v - frame.origin[i]);
    return [frame.xAxis, frame.yAxis, frame.zAxis].map(axis => axis.reduce((sum, v, i) => sum + v * d[i], 0)) as unknown as Vec;
}
export function framePoint(point: Vec, frame?: MeasurementFrame | null): Vec {
    if (!frame)
        return point;
    return frame.origin.map((v, i) => v + point[0] * frame.xAxis[i] + point[1] * frame.yAxis[i] + point[2] * frame.zAxis[i]) as unknown as Vec;
}
