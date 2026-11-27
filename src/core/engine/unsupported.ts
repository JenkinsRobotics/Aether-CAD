/** A feature an engine cannot build yet. In Automatic mode the policy tries the
 *  next engine; a forced engine reports it against the feature. */
export class EngineUnsupported extends Error {
  constructor(readonly engine: string, readonly featureId: string, what: string) { super(what); this.name = "EngineUnsupported"; }
}
