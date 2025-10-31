import GenerationGraph from "../workflows/T2I-anime-nova-xl.json" with { type: "json" };
import EditGraph from "../workflows/quick-edit-test.json" with { type: "json" };
import { Workflow } from "../../src/workflow.js";
import { clone } from "./helpers.js";

export function buildGenerationWorkflow(prompt: string, negative: string, seed: number) {
  const wf = Workflow.from(clone(GenerationGraph));
  wf.set("1.inputs.value", prompt)
    .set("2.inputs.value", negative)
    .set("10.inputs.seed", seed)
    .output("base_preview", "12");
  return wf;
}

export function buildEditWorkflow(imageName: string, editPrompt: string, seed: number) {
  const wf = Workflow.from(clone(EditGraph));
  wf.set("91.inputs.prompt", editPrompt).set("51.inputs.seed", seed).set("97.inputs.image", imageName).output("207");
  return wf;
}
