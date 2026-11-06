import type { PartDocument } from '@aether/core/document';
import type { ImportedModelData } from '@aether/core/contracts';

export interface PlaybackModel extends ImportedModelData {
  placements?: ReadonlyMap<string, { position: readonly number[]; rotation: readonly number[] }>;
}
export interface PlaybackSequence {
  features: Pick<PartDocument['features'][number], 'name' | 'suppressed'>[];
  evaluate(index: number, isCurrent?: () => boolean): Promise<PlaybackModel>;
}
export interface PlaybackSnapshot {
  status: 'idle' | 'playing' | 'paused' | 'complete' | 'error';
  available: boolean;
  index: number;
  total: number;
  label: string;
  speed: number;
  pending: boolean;
  buildMilliseconds: number | null;
  presentationMilliseconds: number | null;
  error: string | null;
}
export interface PlaybackService {
  evaluate(document: PartDocument): Promise<ImportedModelData>;
  show(model: PlaybackModel | null, active: boolean): void;
  changed(): void;
  /** Resolve after the viewport has had a chance to present the new geometry. */
  presented(): Promise<void>;
}

/** Read-only, single-flight history replay. A frame uses the canonical kernel,
 * but neither changes the document nor adds undo entries or saves a file. */
export class HistoryPlayback {
  private state: PlaybackSnapshot = {status:'idle',available:false,index:0,total:0,label:'',speed:1,pending:false,buildMilliseconds:null,presentationMilliseconds:null,error:null};
  private listeners = new Set<() => void>();
  private source: PartDocument | null = null;
  private session: PartDocument | null = null;
  private sequence: PlaybackSequence | null = null;
  private sessionSequence: PlaybackSequence | null = null;
  private service: PlaybackService | null = null;
  private generation = 0;
  private running = false;
  private wake: (() => void) | null = null;
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => {this.listeners.delete(listener);}; };
  private patch(change: Partial<PlaybackSnapshot>) { this.state = {...this.state,...change}; this.listeners.forEach(listener=>listener()); }

  configure(service: PlaybackService) { this.stop(); this.service=service; }
  sync(source: PartDocument | null, available = true, sequence: PlaybackSequence | null = null) {
    if (source !== this.source || sequence !== this.sequence || !available) this.stop();
    this.sequence = sequence;
    this.source=source;
    const total = sequence?.features.length ?? source?.features.length ?? 0;
    const next=!!this.service && available && total > 0;
    if (this.state.available!==next || this.state.total!==total)
      this.patch({available:next,total});
  }
  project(source: PartDocument | null): PartDocument | null {
    return this.session && source===this.source ? {...source!,rollbackIndex:this.state.index} : source;
  }
  play() {
    if (!this.state.available || (!this.source && !this.sequence) || !this.service) return;
    if (this.state.status==='playing') return;
    if (this.state.status!=='paused') {
      this.generation++;
      this.session=this.source ? structuredClone(this.source) : null;
      this.sessionSequence=this.sequence;
      this.patch({index:0,label:'Before the first feature',pending:true,buildMilliseconds:null,presentationMilliseconds:null,error:null});
      this.service.show(null,true);
      this.service.changed();
    }
    this.patch({status:'playing'});
    void this.pump();
  }
  pause() {
    if (this.state.status!=='playing') return;
    this.patch({status:'paused'}); this.wake?.();
  }
  stop() {
    if (!this.session && !this.sessionSequence) return;
    this.generation++; this.session=null; this.sessionSequence=null; this.wake?.();
    this.patch({status:'idle',index:0,label:'',pending:false,error:null});
    this.service?.show(null,false); this.service?.changed();
  }
  setSpeed(speed: number) { if ([.5,1,2,4].includes(speed)) this.patch({speed}); }
  private async pump() {
    if (this.running || !this.service || (!this.session && !this.sessionSequence)) return;
    this.running=true;
    const generation=this.generation, source=this.session, sequence=this.sessionSequence, service=this.service;
    const features = sequence?.features ?? source!.features;
    try {
      while(this.state.status==='playing' && generation===this.generation) {
        const index=this.state.index+1;
        if(index>features.length) {this.patch({status:'complete',pending:false});break;}
        this.patch({pending:true});
        const model=sequence ? await sequence.evaluate(index, () => generation === this.generation) : await service.evaluate({...source!,rollbackIndex:index});
        if(generation!==this.generation) return;
        const feature=features[index-1], started=performance.now();
        this.patch({index,label:feature.name+(feature.suppressed?' · Suppressed':''),buildMilliseconds:model.parseMilliseconds});
        service.show(model,true); service.changed();
        await service.presented();
        if(generation!==this.generation) return;
        this.patch({pending:false,presentationMilliseconds:performance.now()-started});
        if(index===features.length) {this.patch({status:'complete'});break;}
        if(this.state.status!=='playing') break;
        await new Promise<void>(resolve=>{
          const finish=()=>{clearTimeout(timer);if(this.wake===finish)this.wake=null;resolve();};
          const timer=setTimeout(finish,1000/this.state.speed); this.wake=finish;
        });
      }
    } catch(error) {
      if(generation===this.generation) this.patch({status:'error',pending:false,error:error instanceof Error?error.message:String(error)});
    } finally {
      this.running=false;
      // A stop/restart while an old build was in flight waits for it here.
      if(this.state.status==='playing' && (this.session || this.sessionSequence)) void this.pump();
    }
  }
}

export const historyPlayback = new HistoryPlayback();
