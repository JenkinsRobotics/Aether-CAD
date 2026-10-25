/** A feature this engine cannot build yet; the caller may try another engine. */
export class UnsupportedFeature extends Error {
  /** `fullBuild`: the full OpenCascade.js build can do this; the worker loads it and retries. */
  constructor(readonly featureId: string, what: string, readonly fullBuild = false) {
    super(what);
    this.name = "UnsupportedFeature";
  }
}
/** A feature the engine tried and could not build: the user's error. */
export class FeatureFailure extends Error {
  constructor(readonly featureId: string, readonly featureName: string, message: string) {
    super(`${featureName}: ${message}`);
    this.name = "FeatureFailure";
  }
}
