import { runSelectFeaturesGraph } from "../langgraph/selectFeaturesGraph.js";

export async function selectFeatures(view, { _userPrompt }) {
  return runSelectFeaturesGraph(view, _userPrompt || "");
}