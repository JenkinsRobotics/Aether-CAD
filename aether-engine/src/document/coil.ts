/** Coil (SolidCraft's solid.coil): a round wire swept along a helix. */
export interface CoilFeature {
  id:string;type:'coil';name:string;suppressed:boolean;
  radiusMillimeters:number;pitchMillimeters:number;turns:number;wireDiameterMillimeters:number;
  centerMillimeters?:[number,number,number];axis?:'X'|'Y'|'Z';leftHand?:boolean;
  operation:'new'|'add'|'cut';bodyId?:string;targetBodyId?:string;
}
export function validateCoil(feature:CoilFeature) {
  const pos=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
  if(!pos(feature.radiusMillimeters)||!pos(feature.pitchMillimeters)||!pos(feature.turns)||!pos(feature.wireDiameterMillimeters))throw Error('Coil radius, pitch, turns and wire diameter must be positive.');
  if(feature.wireDiameterMillimeters>=feature.pitchMillimeters)throw Error('Coil wire diameter must be less than the pitch, or the turns touch.');
  if(feature.wireDiameterMillimeters/2>=feature.radiusMillimeters)throw Error('Coil wire must be thinner than the coil radius.');
  if(feature.centerMillimeters!==undefined&&!(Array.isArray(feature.centerMillimeters)&&feature.centerMillimeters.length===3&&feature.centerMillimeters.every(Number.isFinite)))throw Error('Coil centre must be finite.');
  if(feature.axis!==undefined&&!['X','Y','Z'].includes(feature.axis))throw Error('Coil axis must be X, Y or Z.');
  if(!['new','add','cut'].includes(feature.operation))throw Error('Invalid coil operation.');
}
