import { runSelectFeaturesGraph } from "../langgraph/selectFeaturesGraph.js";

export async function selectFeatures(view, { _userPrompt, _history }) {
  return runSelectFeaturesGraph(view, _userPrompt || "", _history || []);
}