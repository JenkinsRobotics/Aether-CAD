import sample from "../../public/examples/harness-demo.json";
import { parseDocument } from "./model";
export function exampleHarness() {
  return parseDocument(JSON.stringify(sample));
}
