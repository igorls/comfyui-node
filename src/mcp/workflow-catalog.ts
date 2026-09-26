import fs from "fs/promises";
import path from "path";
import { hashWorkflow } from "../pool/utils/hash.js";
import { WorkflowMetadata, WorkflowSlotInfo, WorkflowValidationResult } from "./schemas.js";

export interface SidecarConfig {
  workflow?: string;
  slots?: Record<string, string>; // e.g. "prompt": "6.inputs.text" or "6.text" or "6"
  outputs?: Record<string, string> | string[];
}

export class WorkflowCatalog {
  private directories: string[];
  private cachedWorkflows: Map<string, WorkflowMetadata> = new Map();

  constructor(directories: string[] = []) {
    this.directories = directories.map((d) => path.resolve(d));
    if (this.directories.length === 0) {
      this.directories.push(path.resolve("./workflows"));
    }
  }

  /**
   * Get all configured search directories
   */
  getDirectories(): string[] {
    return [...this.directories];
  }

  /**
   * Add a directory to the workflow search path
   */
  addDirectory(dir: string): void {
    const resolved = path.resolve(dir);
    if (!this.directories.includes(resolved)) {
      this.directories.push(resolved);
    }
  }

  /**
   * Scan all configured directories for JSON workflow files
   */
  async scan(): Promise<WorkflowMetadata[]> {
    const results: WorkflowMetadata[] = [];
    this.cachedWorkflows.clear();

    for (const dir of this.directories) {
      try {
        const stats = await fs.stat(dir);
        if (!stats.isDirectory()) continue;

        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".sidecar.json")) {
            const filePath = path.join(dir, entry.name);
            try {
              const meta = await this.loadWorkflowFile(filePath);
              if (meta) {
                this.cachedWorkflows.set(meta.name, meta);
                this.cachedWorkflows.set(filePath, meta);
                results.push(meta);
              }
            } catch {
              // Ignore unparseable files during general scan
            }
          }
        }
      } catch {
        // Directory may not exist yet
      }
    }

    return results;
  }

  /**
   * Find a workflow by name (e.g. "sdxl", "sdxl.json") or direct filepath
   */
  async getWorkflow(nameOrPath: string): Promise<WorkflowMetadata | null> {
    if (this.cachedWorkflows.has(nameOrPath)) {
      return this.cachedWorkflows.get(nameOrPath)!;
    }

    // Check with .json extension
    if (!nameOrPath.endsWith(".json") && this.cachedWorkflows.has(`${nameOrPath}.json`)) {
      return this.cachedWorkflows.get(`${nameOrPath}.json`)!;
    }

    // Try loading directly if it's a file path
    try {
      const resolved = path.resolve(nameOrPath);
      const meta = await this.loadWorkflowFile(resolved);
      if (meta) {
        this.cachedWorkflows.set(meta.name, meta);
        this.cachedWorkflows.set(resolved, meta);
        return meta;
      }
    } catch {
      // Not a direct path
    }

    // Try checking within configured directories
    for (const dir of this.directories) {
      const candidatePath = path.join(dir, nameOrPath.endsWith(".json") ? nameOrPath : `${nameOrPath}.json`);
      try {
        const meta = await this.loadWorkflowFile(candidatePath);
        if (meta) {
          this.cachedWorkflows.set(meta.name, meta);
          this.cachedWorkflows.set(candidatePath, meta);
          return meta;
        }
      } catch {
        // Next directory
      }
    }

    return null;
  }

  /**
   * Save a newly authored or modified workflow to the workflow storage directory
   */
  async saveWorkflow(
    name: string,
    workflowJson: Record<string, any>,
    sidecarSlots?: Record<string, string>,
    overwrite = false,
    targetDir?: string
  ): Promise<WorkflowMetadata> {
    const fileName = name.endsWith(".json") ? name : `${name}.json`;
    const storageDir = targetDir ? path.resolve(targetDir) : this.directories[0] || path.resolve("./workflows");

    // Ensure storage directory exists
    await fs.mkdir(storageDir, { recursive: true });

    const filePath = path.join(storageDir, fileName);

    if (!overwrite) {
      try {
        await fs.access(filePath);
        throw new Error(
          `Workflow '${fileName}' already exists in storage directory '${storageDir}'. Set 'overwrite: true' to replace it.`
        );
      } catch (err: any) {
        if (err.message?.includes("already exists")) throw err;
        // File does not exist, proceed
      }
    }

    // Write workflow JSON
    await fs.writeFile(filePath, JSON.stringify(workflowJson, null, 2), "utf-8");

    // Write companion sidecar if slots provided
    if (sidecarSlots && Object.keys(sidecarSlots).length > 0) {
      const sidecarPath = filePath.replace(/\.json$/, ".sidecar.json");
      const sidecarData: SidecarConfig = {
        workflow: fileName,
        slots: sidecarSlots
      };
      await fs.writeFile(sidecarPath, JSON.stringify(sidecarData, null, 2), "utf-8");
    }

    const meta = await this.loadWorkflowFile(filePath);
    if (!meta) {
      throw new Error(`Failed to load saved workflow from '${filePath}'.`);
    }

    this.cachedWorkflows.set(meta.name, meta);
    this.cachedWorkflows.set(filePath, meta);

    return meta;
  }

  /**
   * Delete a workflow and its companion sidecar from storage
   */
  async deleteWorkflow(name: string, targetDir?: string): Promise<boolean> {
    const fileName = name.endsWith(".json") ? name : `${name}.json`;
    const searchDirs = targetDir ? [path.resolve(targetDir)] : this.directories;

    let deleted = false;

    for (const dir of searchDirs) {
      const filePath = path.join(dir, fileName);
      try {
        await fs.unlink(filePath);
        deleted = true;

        // Try removing sidecar as well
        const sidecarPath1 = filePath.replace(/\.json$/, ".sidecar.json");
        const sidecarPath2 = `${filePath}.sidecar.json`;
        await fs.unlink(sidecarPath1).catch(() => {});
        await fs.unlink(sidecarPath2).catch(() => {});

        this.cachedWorkflows.delete(fileName);
        this.cachedWorkflows.delete(filePath);
        break;
      } catch {
        // Continue searching other directories
      }
    }

    if (!deleted) {
      throw new Error(`Workflow '${name}' not found in storage directories.`);
    }

    return true;
  }

  /**
   * Resolve a workflow input (string name/path or inline API JSON object)
   */
  async resolveWorkflowJson(
    workflowInput: string | Record<string, any>
  ): Promise<{
    name?: string;
    path?: string;
    workflowJson: Record<string, any>;
    slots: Record<string, WorkflowSlotInfo>;
    outputNodes: string[];
    structureHash?: string;
  }> {
    if (typeof workflowInput === "object" && workflowInput !== null) {
      const workflowJson = structuredClone(workflowInput);
      const slots = this.detectSlots(workflowJson);
      const outputNodes = this.detectOutputNodes(workflowJson);
      const structureHash = hashWorkflow(workflowJson);

      return {
        workflowJson,
        slots,
        outputNodes,
        structureHash
      };
    }

    if (typeof workflowInput === "string") {
      const meta = await this.getWorkflow(workflowInput);
      if (meta) {
        return {
          name: meta.name,
          path: meta.path,
          workflowJson: structuredClone(meta.rawWorkflow),
          slots: meta.slots,
          outputNodes: meta.outputNodes,
          structureHash: meta.structureHash
        };
      }

      // If not in catalog, attempt parsing string as inline JSON
      try {
        const parsed = JSON.parse(workflowInput);
        if (typeof parsed === "object" && parsed !== null) {
          const slots = this.detectSlots(parsed);
          const outputNodes = this.detectOutputNodes(parsed);
          const structureHash = hashWorkflow(parsed);
          return {
            workflowJson: parsed,
            slots,
            outputNodes,
            structureHash
          };
        }
      } catch {
        // Not a JSON string
      }

      throw new Error(
        `Workflow '${workflowInput}' could not be found in configured directories (${this.directories.join(", ") || "none"}) or parsed as JSON.`
      );
    }

    throw new Error("Invalid workflow input: expected workflow name/path or API JSON object.");
  }

  /**
   * Load and parse a workflow JSON file and its optional sidecar
   */
  private async loadWorkflowFile(filePath: string): Promise<WorkflowMetadata | null> {
    const rawContent = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(rawContent);

    // Ensure it looks like a ComfyUI API format workflow
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    // Check if it's UI format (contains nodes array and links array)
    if (Array.isArray((parsed as any).nodes) && Array.isArray((parsed as any).links)) {
      throw new Error(
        `Workflow file '${path.basename(filePath)}' is in ComfyUI UI graph format, not API prompt format. In ComfyUI, please enable 'Enable Dev mode Options' in Settings and click 'Save (API Format)'.`
      );
    }

    const name = path.basename(filePath);
    let slots = this.detectSlots(parsed);
    let outputNodes = this.detectOutputNodes(parsed);

    // Look for sidecar file
    const sidecarPath1 = filePath.replace(/\.json$/, ".sidecar.json");
    const sidecarPath2 = `${filePath}.sidecar.json`;

    let sidecarConfig: SidecarConfig | null = null;
    for (const scPath of [sidecarPath1, sidecarPath2]) {
      try {
        const scContent = await fs.readFile(scPath, "utf-8");
        sidecarConfig = JSON.parse(scContent);
        break;
      } catch {
        // Sidecar doesn't exist
      }
    }

    if (sidecarConfig) {
      if (sidecarConfig.slots) {
        for (const [slotName, targetPath] of Object.entries(sidecarConfig.slots)) {
          const parts = targetPath.split(".");
          const nodeId = parts[0];
          const inputName = parts.length > 2 ? parts[2] : parts.length === 2 ? parts[1] : "text";

          const node = parsed[nodeId];
          slots[slotName] = {
            slot: slotName,
            nodeId,
            inputName,
            currentValue: node?.inputs?.[inputName],
            nodeClassType: node?.class_type
          };
        }
      }

      if (sidecarConfig.outputs) {
        if (Array.isArray(sidecarConfig.outputs)) {
          outputNodes = sidecarConfig.outputs;
        } else {
          outputNodes = Object.values(sidecarConfig.outputs);
        }
      }
    }

    const structureHash = hashWorkflow(parsed);

    return {
      name,
      path: filePath,
      structureHash,
      slots,
      outputNodes,
      rawWorkflow: parsed
    };
  }

  /**
   * Automatically detect common slots from API workflow JSON
   */
  detectSlots(workflow: Record<string, any>): Record<string, WorkflowSlotInfo> {
    const slots: Record<string, WorkflowSlotInfo> = {};
    const textNodes: Array<{ id: string; node: any }> = [];
    const ksamplers: Array<{ id: string; node: any }> = [];
    const latentNodes: Array<{ id: string; node: any }> = [];
    const ckptNodes: Array<{ id: string; node: any }> = [];
    const promptSlotNodes: Array<{ id: string; node: any; inputName: string }> = [];
    const negPromptSlotNodes: Array<{ id: string; node: any; inputName: string }> = [];

    for (const [id, node] of Object.entries(workflow)) {
      if (!node || typeof node !== "object") continue;
      const classType = String(node.class_type || "").toLowerCase();

      if (classType.includes("cliptextencode") || classType === "cliptextencodernode") {
        textNodes.push({ id, node });
      } else if (classType.includes("ksampler")) {
        ksamplers.push({ id, node });
      } else if (classType.includes("emptylatentimage") || classType.includes("latentimage")) {
        latentNodes.push({ id, node });
      } else if (classType.includes("checkpointloader") || classType.includes("loadcheckpoint")) {
        ckptNodes.push({ id, node });
      }

      // Modern composite text-encode nodes (e.g. TextEncodeQwenImage21) expose
      // "prompt" / "negative_prompt" STRING inputs directly instead of "text".
      if (node.inputs && typeof node.inputs.prompt === "string") {
        promptSlotNodes.push({ id, node, inputName: "prompt" });
      }
      if (node.inputs && typeof node.inputs.negative_prompt === "string") {
        negPromptSlotNodes.push({ id, node, inputName: "negative_prompt" });
      }
    }

    // Heuristic 1: KSampler inputs
    if (ksamplers.length > 0) {
      const primarySampler = ksamplers[0];
      const inputs = primarySampler.node.inputs || {};

      if ("seed" in inputs || "noise_seed" in inputs) {
        const seedKey = "seed" in inputs ? "seed" : "noise_seed";
        slots["seed"] = {
          slot: "seed",
          nodeId: primarySampler.id,
          inputName: seedKey,
          currentValue: inputs[seedKey],
          nodeClassType: primarySampler.node.class_type
        };
      }

      if ("steps" in inputs) {
        slots["steps"] = {
          slot: "steps",
          nodeId: primarySampler.id,
          inputName: "steps",
          currentValue: inputs.steps,
          nodeClassType: primarySampler.node.class_type
        };
      }

      if ("cfg" in inputs) {
        slots["cfg"] = {
          slot: "cfg",
          nodeId: primarySampler.id,
          inputName: "cfg",
          currentValue: inputs.cfg,
          nodeClassType: primarySampler.node.class_type
        };
      }

      if ("sampler_name" in inputs) {
        slots["sampler_name"] = {
          slot: "sampler_name",
          nodeId: primarySampler.id,
          inputName: "sampler_name",
          currentValue: inputs.sampler_name,
          nodeClassType: primarySampler.node.class_type
        };
      }

      if ("scheduler" in inputs) {
        slots["scheduler"] = {
          slot: "scheduler",
          nodeId: primarySampler.id,
          inputName: "scheduler",
          currentValue: inputs.scheduler,
          nodeClassType: primarySampler.node.class_type
        };
      }

      // Check positive and negative conditioning links on KSampler
      if (Array.isArray(inputs.positive) && inputs.positive.length > 0) {
        const posNodeId = String(inputs.positive[0]);
        const posNode = workflow[posNodeId];
        if (posNode?.inputs && "text" in posNode.inputs) {
          slots["prompt"] = {
            slot: "prompt",
            nodeId: posNodeId,
            inputName: "text",
            currentValue: posNode.inputs.text,
            nodeClassType: posNode.class_type
          };
        }
      }

      if (Array.isArray(inputs.negative) && inputs.negative.length > 0) {
        const negNodeId = String(inputs.negative[0]);
        const negNode = workflow[negNodeId];
        if (negNode?.inputs && "text" in negNode.inputs) {
          slots["negative_prompt"] = {
            slot: "negative_prompt",
            nodeId: negNodeId,
            inputName: "text",
            currentValue: negNode.inputs.text,
            nodeClassType: negNode.class_type
          };
        }
      }
    }

    // Heuristic 2a: composite text-encode nodes (prompt/negative_prompt STRING inputs,
    // e.g. TextEncodeQwenImage21). Checked BEFORE the CLIPTextEncode "text" fallback so
    // these nodes are recognized as first-class prompt slots.
    if (!slots["prompt"] && promptSlotNodes.length > 0) {
      const n = promptSlotNodes[0];
      slots["prompt"] = {
        slot: "prompt",
        nodeId: n.id,
        inputName: n.inputName,
        currentValue: n.node.inputs?.[n.inputName],
        nodeClassType: n.node.class_type
      };
    }
    if (!slots["negative_prompt"] && negPromptSlotNodes.length > 0) {
      const n = negPromptSlotNodes[0];
      slots["negative_prompt"] = {
        slot: "negative_prompt",
        nodeId: n.id,
        inputName: n.inputName,
        currentValue: n.node.inputs?.[n.inputName],
        nodeClassType: n.node.class_type
      };
    }

    // Heuristic 2b: Text nodes fallback
    if (!slots["prompt"] && textNodes.length > 0) {
      slots["prompt"] = {
        slot: "prompt",
        nodeId: textNodes[0].id,
        inputName: "text",
        currentValue: textNodes[0].node.inputs?.text,
        nodeClassType: textNodes[0].node.class_type
      };

      if (textNodes.length > 1 && !slots["negative_prompt"]) {
        slots["negative_prompt"] = {
          slot: "negative_prompt",
          nodeId: textNodes[1].id,
          inputName: "text",
          currentValue: textNodes[1].node.inputs?.text,
          nodeClassType: textNodes[1].node.class_type
        };
      }
    }

    // Heuristic 3: EmptyLatentImage width / height
    if (latentNodes.length > 0) {
      const lNode = latentNodes[0];
      const inputs = lNode.node.inputs || {};

      if ("width" in inputs) {
        slots["width"] = {
          slot: "width",
          nodeId: lNode.id,
          inputName: "width",
          currentValue: inputs.width,
          nodeClassType: lNode.node.class_type
        };
      }

      if ("height" in inputs) {
        slots["height"] = {
          slot: "height",
          nodeId: lNode.id,
          inputName: "height",
          currentValue: inputs.height,
          nodeClassType: lNode.node.class_type
        };
      }

      if ("batch_size" in inputs) {
        slots["batch_size"] = {
          slot: "batch_size",
          nodeId: lNode.id,
          inputName: "batch_size",
          currentValue: inputs.batch_size,
          nodeClassType: lNode.node.class_type
        };
      }
    }

    // Heuristic 4: CheckpointLoader
    if (ckptNodes.length > 0) {
      const ckptNode = ckptNodes[0];
      const inputs = ckptNode.node.inputs || {};

      if ("ckpt_name" in inputs) {
        slots["ckpt_name"] = {
          slot: "ckpt_name",
          nodeId: ckptNode.id,
          inputName: "ckpt_name",
          currentValue: inputs.ckpt_name,
          nodeClassType: ckptNode.node.class_type
        };
      }
    }

    return slots;
  }

  /**
   * Detect terminal output nodes (images, videos, audio, 3D, files)
   */
  detectOutputNodes(workflow: Record<string, any>): string[] {
    const outputs: string[] = [];

    for (const [id, node] of Object.entries(workflow)) {
      if (!node || typeof node !== "object") continue;
      const classType = String(node.class_type || "").toLowerCase();

      if (
        classType.includes("saveimage") ||
        classType.includes("previewimage") ||
        classType.includes("videocombine") ||
        classType.includes("saveanimated") ||
        classType.includes("savevideo") ||
        classType.includes("saveaudio") ||
        classType.includes("savegltf") ||
        classType.includes("saveobj") ||
        classType.includes("save3d") ||
        classType.includes("savetext")
      ) {
        outputs.push(id);
      }
    }

    return outputs;
  }

  /**
   * Apply user input overrides to workflow JSON using slot names, node paths, or nested objects
   */
  applyOverrides(
    workflowJson: Record<string, any>,
    slots: Record<string, WorkflowSlotInfo>,
    inputs?: Record<string, any>
  ): Record<string, any> {
    if (!inputs || Object.keys(inputs).length === 0) {
      return workflowJson;
    }

    const cloned = structuredClone(workflowJson);

    for (const [key, value] of Object.entries(inputs)) {
      // 1. Direct slot match
      if (slots[key]) {
        const slot = slots[key];
        if (!cloned[slot.nodeId]) cloned[slot.nodeId] = { inputs: {} };
        if (!cloned[slot.nodeId].inputs) cloned[slot.nodeId].inputs = {};
        cloned[slot.nodeId].inputs[slot.inputName] = value;
        continue;
      }

      // 2. Explicit node path (e.g. "6.inputs.text" or "6.text")
      if (key.includes(".")) {
        const parts = key.split(".");
        const nodeId = parts[0];
        const inputName = parts.length > 2 && parts[1] === "inputs" ? parts[2] : parts[1];

        if (!cloned[nodeId]) cloned[nodeId] = { inputs: {} };
        if (!cloned[nodeId].inputs) cloned[nodeId].inputs = {};
        cloned[nodeId].inputs[inputName] = value;
        continue;
      }

      // 3. Node ID with nested object
      if (cloned[key] && typeof value === "object" && value !== null && !Array.isArray(value)) {
        if (!cloned[key].inputs) cloned[key].inputs = {};
        for (const [innerK, innerV] of Object.entries(value)) {
          cloned[key].inputs[innerK] = innerV;
        }
        continue;
      }

      // 4. Fallback: prompt or negative_prompt
      if (key === "prompt" && slots["prompt"]) {
        const slot = slots["prompt"];
        if (!cloned[slot.nodeId]) cloned[slot.nodeId] = { inputs: {} };
        if (!cloned[slot.nodeId].inputs) cloned[slot.nodeId].inputs = {};
        cloned[slot.nodeId].inputs[slot.inputName] = value;
      } else if ((key === "negativePrompt" || key === "negative_prompt") && slots["negative_prompt"]) {
        const slot = slots["negative_prompt"];
        if (!cloned[slot.nodeId]) cloned[slot.nodeId] = { inputs: {} };
        if (!cloned[slot.nodeId].inputs) cloned[slot.nodeId].inputs = {};
        cloned[slot.nodeId].inputs[slot.inputName] = value;
      } else {
        // Silent drops here caused agents to generate whole batches against stale
        // placeholder values with no indication anything was wrong. Fail loudly.
        const known = [...Object.keys(slots), "negativePrompt", "negative_prompt", "prompt"];
        throw new Error(
          `Unknown input override '${key}'. This workflow does not expose a slot or node path for it. ` +
          `Available slots: ${known.join(", ")}. ` +
          `Use explicit dot-notation ('<nodeId>.<inputName>' or '<nodeId>.inputs.<inputName>') to target any node input.`
        );
      }
    }

    return cloned;
  }

  /**
   * Deep validation of workflow against live node definitions (/object_info)
   */
  validateWorkflow(
    workflowJson: Record<string, any>,
    nodeDefs: Record<string, any> | null
  ): WorkflowValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const repairSuggestions: string[] = [];

    if (!workflowJson || typeof workflowJson !== "object" || Object.keys(workflowJson).length === 0) {
      return {
        valid: false,
        errors: ["Workflow JSON is empty or not an object."],
        warnings: [],
        detectedOutputs: [],
        slots: {},
        repairSuggestions: ["Provide a valid ComfyUI API workflow object containing node IDs with 'class_type' and 'inputs'."]
      };
    }

    // Check UI format error
    if (Array.isArray(workflowJson.nodes) && Array.isArray(workflowJson.links)) {
      return {
        valid: false,
        errors: [
          "Workflow is in UI format (contains 'nodes' and 'links' arrays). Must be in API prompt format (node ID keyed map with 'class_type' and 'inputs'). In ComfyUI, save via 'Save (API Format)' in Developer Mode."
        ],
        warnings: [],
        detectedOutputs: [],
        slots: {},
        repairSuggestions: [
          "Export the workflow from ComfyUI using Developer Mode -> Save (API Format), or use the API prompt structure where keys are node IDs."
        ]
      };
    }

    const detectedOutputs = this.detectOutputNodes(workflowJson);
    const slots = this.detectSlots(workflowJson);

    if (detectedOutputs.length === 0) {
      warnings.push("No terminal output node (e.g. SaveImage, PreviewImage, VHS_VideoCombine, SaveAudio) was detected in the workflow.");
      repairSuggestions.push("Add a SaveImage or output node to the graph and link the decoded image/audio/mesh to it.");
    }

    if (!nodeDefs) {
      warnings.push("Live node definitions (/object_info) not available from ComfyUI server; skipped node validation.");
      return {
        valid: true,
        errors: [],
        warnings,
        detectedOutputs,
        slots,
        repairSuggestions
      };
    }

    for (const [nodeId, node] of Object.entries(workflowJson)) {
      if (!node || typeof node !== "object") {
        errors.push(`Node '${nodeId}' is not an object.`);
        continue;
      }

      const classType = node.class_type;
      if (!classType) {
        errors.push(`Node '${nodeId}' is missing 'class_type'.`);
        continue;
      }

      const def = nodeDefs[classType];
      if (!def) {
        errors.push(
          `Node '${nodeId}' uses class '${classType}' which is not installed on the target ComfyUI server.`
        );
        repairSuggestions.push(
          `Install the custom node package providing '${classType}', or replace node '${nodeId}' with an equivalent available node.`
        );
        continue;
      }

      const requiredInputs = def.input?.required || {};
      const optionalInputs = def.input?.optional || {};
      const allDefInputs = { ...requiredInputs, ...optionalInputs };
      const nodeInputs = node.inputs || {};

      // V3 dynamic inputs (COMFY_AUTOGROW_V3, COMFY_DYNAMICCOMBO_V3, etc.) expand
      // at runtime; their declared names in /object_info don't map 1:1 to API keys.
      // Skip missing-required checks against them instead of producing false errors
      // (e.g. TextEncodeQwenImage21's autogrowing 'images' slot).
      const dynamicInputNames = new Set(
        Object.entries({ ...requiredInputs, ...optionalInputs })
          .filter(([, spec]) => Array.isArray(spec) && typeof spec[0] === "string" && spec[0].startsWith("COMFY_"))
          .map(([name]) => name)
      );

      // 1. Check required inputs
      for (const reqKey of Object.keys(requiredInputs)) {
        if (dynamicInputNames.has(reqKey)) continue;
        if (!(reqKey in nodeInputs)) {
          errors.push(`Node '${nodeId}' (${classType}) is missing required input '${reqKey}'.`);
          repairSuggestions.push(`Provide a value or link for input '${reqKey}' on node '${nodeId}' (${classType}).`);
        }
      }

      // 2. Check each input link or scalar value
      for (const [inputKey, inputValue] of Object.entries(nodeInputs)) {
        const inputSpec = allDefInputs[inputKey];

        // Case A: Link connection [sourceNodeId, outputPinIndex]
        if (Array.isArray(inputValue) && inputValue.length === 2 && typeof inputValue[0] === "string" && typeof inputValue[1] === "number") {
          const [sourceNodeId, sourceOutputIdx] = inputValue;
          const sourceNode = workflowJson[sourceNodeId];

          if (!sourceNode) {
            errors.push(
              `Node '${nodeId}' (${classType}) input '${inputKey}' links to non-existent source node '${sourceNodeId}'.`
            );
            repairSuggestions.push(`Ensure node '${sourceNodeId}' exists in the workflow or update link [sourceNodeId, outputIndex].`);
            continue;
          }

          const sourceClassType = sourceNode.class_type;
          const sourceDef = nodeDefs[sourceClassType];

          if (sourceDef && Array.isArray(sourceDef.output)) {
            if (sourceOutputIdx < 0 || sourceOutputIdx >= sourceDef.output.length) {
              errors.push(
                `Node '${nodeId}' (${classType}) input '${inputKey}' links to output pin index ${sourceOutputIdx} on node '${sourceNodeId}' (${sourceClassType}), but '${sourceClassType}' only has ${sourceDef.output.length} output pin(s) (indices 0..${Math.max(0, sourceDef.output.length - 1)}).`
              );
            } else if (inputSpec && typeof inputSpec[0] === "string") {
              const expectedType = String(inputSpec[0]).toUpperCase();
              const actualType = String(sourceDef.output[sourceOutputIdx]).toUpperCase();

              // Pin type mismatch check (e.g. MODEL vs LATENT, IMAGE vs CONDITIONING)
              if (expectedType !== "*" && actualType !== "*" && expectedType !== actualType) {
                warnings.push(
                  `Type mismatch warning: Node '${nodeId}' (${classType}) input '${inputKey}' expects type '${expectedType}', but linked node '${sourceNodeId}' (${sourceClassType}) output pin ${sourceOutputIdx} produces '${actualType}'.`
                );
              }
            }
          }
        }
        // Case B: Enum / model file selection validation
        else if (inputSpec && Array.isArray(inputSpec) && Array.isArray(inputSpec[0]) && typeof inputValue === "string") {
          const validOptions = inputSpec[0];
          if (validOptions.length > 0 && !validOptions.includes(inputValue)) {
            warnings.push(
              `Node '${nodeId}' (${classType}) input '${inputKey}' value '${inputValue}' is not in the server's list of installed options (${validOptions.slice(0, 5).join(", ")}${validOptions.length > 5 ? ` +${validOptions.length - 5} more` : ""}).`
            );
            repairSuggestions.push(
              `Change node '${nodeId}' input '${inputKey}' to an installed model such as '${validOptions[0]}'.`
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      detectedOutputs,
      slots,
      repairSuggestions: Array.from(new Set(repairSuggestions))
    };
  }
}
