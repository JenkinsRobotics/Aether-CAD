import type { CADScreenPoint, CADSelectionItem, CADSelectionStroke } from '../cad-selection-store';

/** Collects a gesture without mutating selection. Releasing commits; cancellation is lossless. */
export class SelectionStroke {
  private points: CADScreenPoint[]=[];
  private painted=new Map<string,CADSelectionItem>();
  constructor(readonly mode: CADSelectionStroke['mode'], start: CADScreenPoint,
    private readonly pick: (point:CADScreenPoint)=>CADSelectionItem|null) { this.append(start); }

  append(point: CADScreenPoint): void {
    const previous=this.points.at(-1);
    const distance=previous?Math.hypot(point.x-previous.x,point.y-previous.y):0;
    if (previous && distance<2) return;
    if (this.mode==='paint') {
      const steps=Math.max(1,Math.ceil(distance/4));
      for(let i=1;i<=steps;i++) {
        const x=previous?previous.x+(point.x-previous.x)*i/steps:point.x;
        const y=previous?previous.y+(point.y-previous.y)*i/steps:point.y;
        for(const [dx,dy] of [[0,0],[-6,0],[6,0],[0,-6],[0,6]]) {
          const hit=this.pick({x:x+dx,y:y+dy});
          if(hit)this.painted.set(hit.id,hit);
        }
      }
    }
    this.points.push(point);
  }
  snapshot(): CADSelectionStroke { return {mode:this.mode,points:[...this.points]}; }
  items(): readonly CADSelectionItem[] { return [...this.painted.values()]; }
}
