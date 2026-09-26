import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { ComfyApi } from "../client.js";
import { Workflow } from "../workflow.js";
import {
  CandidateArtifact,
  ComfyGenerateInput,
  ComfyInfoInput,
  ComfyInspectInput,
  ComfyJobInput,
  ComfyNodesInput,
  ComfyRecipesInput,
  ComfyReviseInput,
  ComfyValidateInput,
  ComfyWorkflowsInput,
  MediaType,
  RunRecord,
  WorkflowValidationResult
} from "./schemas.js";
import { WorkflowCatalog } from "./workflow-catalog.js";
import { AvailableModels, RecipeCatalog } from "./recipe-catalog.js";
import {
  createBoundedImage,
  createContactSheet,
  createCrop,
  createSideBySideComparison,
  toMcpImageContent
} from "./review-images.js";

export type ComfyInspectOptions = Partial<ComfyInspectInput> & { runId: string };

function detectMediaType(filename: string, mimeType?: string): MediaType {
  const lower = filename.toLowerCase();
  if (mimeType?.startsWith("image/")) {
    if (lower.endsWith(".gif") || lower.endsWith(".webp") || mimeType.includes("gif")) return "image";
    return "image";
  }
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType?.startsWith("model/") || mimeType?.includes("gltf") || mimeType?.includes("glb")) return "3d";

  if (/\.(mp4|webm|mkv|mov|avi|flv)$/i.test(lower)) return "video";
  if (/\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(lower)) return "audio";
  if (/\.(glb|gltf|obj|ply|stl|fbx|blend)$/i.test(lower)) return "3d";
  if (/\.(png|jpe?g|webp|bmp|tiff|svg|gif)$/i.test(lower)) return "image";

  return "file";
}

export class McpGenerationSession {
  private client: ComfyApi;
  private catalog: WorkflowCatalog;
  private recipeCatalog: RecipeCatalog;
  private runs: Map<string, RunRecord> = new Map();
  private promptToRunId: Map<string, string> = new Map();
  private cachedNodeDefs: Record<string, any> | null = null;
  private cachedNodeDefsTime = 0;

  constructor(client: ComfyApi, catalog: WorkflowCatalog, recipeCatalog?: RecipeCatalog) {
    this.client = client;
    this.catalog = catalog;
    this.recipeCatalog = recipeCatalog || new RecipeCatalog();
  }

  getClient(): ComfyApi {
    return this.client;
  }

  getCatalog(): WorkflowCatalog {
    return this.catalog;
  }

  getRecipeCatalog(): RecipeCatalog {
    return this.recipeCatalog;
  }

  getRun(runOrPromptId: string): RunRecord | undefined {
    if (this.runs.has(runOrPromptId)) {
      return this.runs.get(runOrPromptId);
    }
    const mappedRunId = this.promptToRunId.get(runOrPromptId);
    if (mappedRunId && this.runs.has(mappedRunId)) {
      return this.runs.get(mappedRunId);
    }
    return undefined;
  }

  getAllRuns(): RunRecord[] {
    return Array.from(this.runs.values());
  }

  /**
   * Ensure WebSocket connection is initialized
   */
  private async ensureConnected(): Promise<void> {
    if (this.client.connectionState !== "connected") {
      try {
        const initPromise = this.client.init(2, 200);
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 2000));
        await Promise.race([initPromise, timeoutPromise]);
      } catch {
        // Non-fatal; HTTP requests can proceed
      }
    }
  }

  /**
   * Retrieve cached or fresh /object_info node definitions
   *
   * The 1.5s timeout previously raced a ~30s /object_info response on real servers,
   * making live validation silently degrade to schema-less mode on every cold call.
   * 45s tolerates slow servers (measured: ~30s for 3113 nodes over Docker); results
   * are cached for 60s either way, so the cost is paid once per minute at most.
   */
  async getNodeDefs(forceRefresh = false): Promise<Record<string, any> | null> {
    const now = Date.now();
    if (!forceRefresh && this.cachedNodeDefs && now - this.cachedNodeDefsTime < 60000) {
      return this.cachedNodeDefs;
    }

    try {
      if (!this.client?.ext?.node?.getNodeDefs) return null;
      const defs = await Promise.race([
        this.client.ext.node.getNodeDefs(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 45000))
      ]);
      if (defs) {
        this.cachedNodeDefs = defs;
        this.cachedNodeDefsTime = now;
      }
      return defs;
    } catch {
      return this.cachedNodeDefs;
    }
  }

  /**
   * Helper to retrieve installed model names across checkpoints, unets, clips, and vaes
   */
  async getAvailableModels(): Promise<AvailableModels> {
    let unets: string[] = [];
    let checkpoints: string[] = [];
    let clips: string[] = [];
    let vaes: string[] = [];

    try {
      if (this.client?.ext?.node) {
        [unets, checkpoints, clips, vaes] = await Promise.all([
          this.client.ext.node.getUnets().catch(() => []),
          this.client.ext.node.getCheckpoints().catch(() => []),
          this.client.ext.node.getClips().catch(() => []),
          this.client.ext.node.getVaes().catch(() => [])
        ]);
      }
    } catch {
      // Fallback below
    }

    const nodeDefs = this.cachedNodeDefs;
    if (nodeDefs) {
      if (nodeDefs.UNETLoader?.input?.required?.unet_name?.[0]) {
        unets.push(...(nodeDefs.UNETLoader.input.required.unet_name[0] as string[]));
      }
      if (nodeDefs.NunchakuZImageDiTLoader?.input?.required?.model_name?.[0]) {
        unets.push(...(nodeDefs.NunchakuZImageDiTLoader.input.required.model_name[0] as string[]));
      }
      if (nodeDefs.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]) {
        checkpoints.push(...(nodeDefs.CheckpointLoaderSimple.input.required.ckpt_name[0] as string[]));
      }
      if (nodeDefs.CLIPLoader?.input?.required?.clip_name?.[0]) {
        clips.push(...(nodeDefs.CLIPLoader.input.required.clip_name[0] as string[]));
      }
      if (nodeDefs.DualCLIPLoader?.input?.required?.clip_name1?.[0]) {
        clips.push(...(nodeDefs.DualCLIPLoader.input.required.clip_name1[0] as string[]));
      }
      if (nodeDefs.VAELoader?.input?.required?.vae_name?.[0]) {
        vaes.push(...(nodeDefs.VAELoader.input.required.vae_name[0] as string[]));
      }
    }

    return {
      unets: Array.from(new Set(unets)),
      checkpoints: Array.from(new Set(checkpoints)),
      clips: Array.from(new Set(clips)),
      vaes: Array.from(new Set(vaes))
    };
  }

  /**
   * comfy_info: Retrieve server state, queue, models, workflows, and runnable recipes
   */
  async getInfo(input?: ComfyInfoInput): Promise<Record<string, any>> {
    // Lazy connect: comfy_info is usually the first call, so it starts the event socket
    // (bounded wait) instead of leaving it for the first generation.
    await this.ensureConnected();
    const includeModels = input?.includeModels ?? true;
    const includeStats = input?.includeStats ?? true;

    let systemStats: any = null;
    let queueStatus: any = null;
    let checkpoints: string[] = [];
    let loras: string[] = [];
    let samplers: any = null;

    try {
      if (includeStats) {
        systemStats = await this.client.ext.system.getSystemStats().catch(() => null);
      }
    } catch {
      // Non-fatal
    }

    try {
      queueStatus = await this.client.getQueue().catch(() => null);
    } catch {
      // Non-fatal
    }

    try {
      if (includeModels) {
        checkpoints = await this.client.ext.node.getCheckpoints().catch(() => []);
        loras = await this.client.ext.node.getLoras().catch(() => []);
        samplers = await this.client.ext.node.getSamplerInfo().catch(() => null);
      }
    } catch {
      // Non-fatal
    }

    const availableModels = await this.getAvailableModels();
    const recipeList = this.recipeCatalog.list(availableModels, { installedOnly: true });
    const workflows = await this.catalog.scan().catch(() => []);

    return {
      // Whether ComfyUI answered over HTTP. The event socket (connected/connectionState)
      // can still be handshaking on a first call; that does not mean the server is down.
      reachable: systemStats !== null || queueStatus !== null,
      connected: this.client.connectionState === "connected",
      connectionState: this.client.connectionState,
      comfyUrl: (this.client as any).url || "http://127.0.0.1:8188",
      activeJobs: queueStatus?.queue_running?.length || 0,
      pendingJobs: queueStatus?.queue_pending?.length || 0,
      system: systemStats?.system || null,
      devices: systemStats?.devices || [],
      models: {
        checkpointsCount: checkpoints.length,
        checkpoints: checkpoints.slice(0, 20),
        hasMoreCheckpoints: checkpoints.length > 20,
        unetsCount: availableModels.unets.length,
        unets: availableModels.unets.slice(0, 20),
        clipsCount: availableModels.clips.length,
        clips: availableModels.clips.slice(0, 20),
        vaesCount: availableModels.vaes.length,
        vaes: availableModels.vaes.slice(0, 20),
        lorasCount: loras.length,
        loras: loras.slice(0, 20),
        samplers: samplers?.sampler || [],
        schedulers: samplers?.scheduler || []
      },
      availableRecipes: recipeList.recipes.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        distilled: r.distilled,
        description: r.description
      })),
      workflowStorage: {
        configuredDirectories: this.catalog.getDirectories(),
        workflowCount: workflows.length,
        workflows: workflows.map((w) => ({
          name: w.name,
          path: w.path,
          slots: Object.keys(w.slots)
        }))
      },
      workflowCatalog: {
        workflowCount: workflows.length,
        workflows: workflows.map((w) => ({
          name: w.name,
          path: w.path,
          slots: Object.keys(w.slots)
        }))
      }
    };
  }

  /**
   * comfy_recipes: Canonical recipe discovery & dynamic scaffolding
   */
  async manageRecipes(input: ComfyRecipesInput): Promise<Record<string, any>> {
    const action = input.action || "list";
    const availableModels = await this.getAvailableModels();

    if (action === "scaffold") {
      if (!input.recipe) {
        throw new Error(
          "Recipe ID is required when action is 'scaffold' (e.g. 'krea2_turbo', 'z_image_turbo', 'sdxl_base', 'flux_schnell')."
        );
      }

      const scaffolded = this.recipeCatalog.scaffold(input.recipe, availableModels, input);

      let savedWorkflow: any = undefined;
      if (input.saveName) {
        const savedMeta = await this.catalog.saveWorkflow(
          input.saveName,
          scaffolded.workflow,
          scaffolded.slots,
          input.overwrite
        );
        savedWorkflow = {
          name: savedMeta.name,
          path: savedMeta.path,
          slots: Object.keys(savedMeta.slots)
        };
      }

      return {
        action: "scaffold",
        recipe: scaffolded.recipe,
        workflow: scaffolded.workflow,
        slots: scaffolded.slots,
        params: scaffolded.params,
        ...(savedWorkflow ? { savedWorkflow } : {})
      };
    }

    // Default: "list"
    const listResult = this.recipeCatalog.list(availableModels, {
      category: input.category,
      installedOnly: input.installedOnly
    });

    return {
      action: "list",
      count: listResult.count,
      recipes: listResult.recipes
    };
  }

  /**
   * comfy_nodes: Live node search and pin schema query for building workflows
   */
  async searchNodes(input: ComfyNodesInput): Promise<Record<string, any>> {
    const nodeDefs = await this.getNodeDefs();
    if (!nodeDefs) {
      throw new Error("Unable to fetch live node definitions from ComfyUI server (/object_info).");
    }

    // Exact class lookup
    if (input.classType) {
      const def = nodeDefs[input.classType];
      if (!def) {
        const similar = Object.keys(nodeDefs).filter((k) =>
          k.toLowerCase().includes(input.classType!.toLowerCase())
        ).slice(0, 10);

        throw new Error(
          `Node class '${input.classType}' not found on target server.${similar.length > 0 ? ` Did you mean: ${similar.join(", ")}?` : ""}`
        );
      }

      const requiredInputs: Record<string, any> = {};
      for (const [k, v] of Object.entries(def.input?.required || {})) {
        const spec = v as any[];
        requiredInputs[k] = {
          type: spec[0],
          details: spec[1] || null
        };
      }

      const optionalInputs: Record<string, any> = {};
      for (const [k, v] of Object.entries(def.input?.optional || {})) {
        const spec = v as any[];
        optionalInputs[k] = {
          type: spec[0],
          details: spec[1] || null
        };
      }

      const outputs: Array<{ index: number; type: string; name?: string; tooltip?: string }> = [];
      const outputTypes = (def.output || []) as string[];
      const outputNames = (def.output_name || []) as string[];
      const outputTooltips = (def.output_tooltips || []) as string[];

      for (let i = 0; i < outputTypes.length; i++) {
        outputs.push({
          index: i,
          type: outputTypes[i],
          name: outputNames[i] || outputTypes[i],
          tooltip: outputTooltips[i] || undefined
        });
      }

      return {
        classType: input.classType,
        name: def.name || input.classType,
        displayName: def.display_name || def.name || input.classType,
        category: def.category || "uncategorized",
        description: def.description || "",
        isOutputNode: Boolean(def.output_node),
        requiredInputs,
        optionalInputs,
        outputs,
        searchAliases: def.search_aliases || []
      };
    }

    // Search query or category filter
    const query = (input.query || "").toLowerCase().trim();
    const category = (input.category || "").toLowerCase().trim();
    const outputOnly = input.outputOnly ?? false;
    const limit = input.limit || 50;

    const matches: Array<{
      classType: string;
      displayName: string;
      category: string;
      isOutputNode: boolean;
      description?: string;
      inputTypes: string[];
      outputTypes: string[];
    }> = [];

    for (const [classType, def] of Object.entries(nodeDefs)) {
      if (outputOnly && !def.output_node) continue;

      if (category) {
        const defCat = String(def.category || "").toLowerCase();
        if (!defCat.includes(category)) continue;
      }

      if (query) {
        const nameMatch = classType.toLowerCase().includes(query);
        const displayMatch = String(def.display_name || "").toLowerCase().includes(query);
        const catMatch = String(def.category || "").toLowerCase().includes(query);
        const descMatch = String(def.description || "").toLowerCase().includes(query);
        const aliasMatch = Array.isArray(def.search_aliases) && def.search_aliases.some((a: string) => String(a).toLowerCase().includes(query));

        if (!nameMatch && !displayMatch && !catMatch && !descMatch && !aliasMatch) {
          continue;
        }
      }

      const inputTypes: string[] = [];
      for (const [k, v] of Object.entries(def.input?.required || {})) {
        const spec = v as any[];
        const typeName = Array.isArray(spec[0]) ? "ENUM" : String(spec[0]);
        inputTypes.push(`${k}: ${typeName}`);
      }

      const outputTypes = ((def.output || []) as string[]).map((t, idx) => {
        const name = def.output_name?.[idx];
        return name ? `${name} (${t})` : t;
      });

      matches.push({
        classType,
        displayName: def.display_name || def.name || classType,
        category: def.category || "uncategorized",
        isOutputNode: Boolean(def.output_node),
        description: def.description ? String(def.description).substring(0, 120) : undefined,
        inputTypes: inputTypes.slice(0, 8),
        outputTypes
      });

      if (matches.length >= limit) break;
    }

    return {
      query: input.query,
      category: input.category,
      outputOnly,
      count: matches.length,
      nodes: matches
    };
  }

  /**
   * comfy_validate: Deep validation of arbitrary workflow graph JSON
   */
  async validateWorkflow(input: ComfyValidateInput): Promise<WorkflowValidationResult> {
    const resolved = await this.catalog.resolveWorkflowJson(input.workflow);
    const nodeDefs = await this.getNodeDefs();
    return this.catalog.validateWorkflow(resolved.workflowJson, nodeDefs);
  }

  /**
   * comfy_workflows: Manage workflows (list, inspect, save, delete)
   */
  async manageWorkflows(input: ComfyWorkflowsInput): Promise<Record<string, any>> {
    const action = input.action || "list";

    if (action === "save") {
      if (!input.name) {
        throw new Error("Workflow 'name' is required when action is 'save'.");
      }
      if (!input.workflow) {
        throw new Error("Workflow data ('workflow' object or JSON) is required when action is 'save'.");
      }

      const resolved = await this.catalog.resolveWorkflowJson(input.workflow);

      // Validate before saving
      const nodeDefs = await this.getNodeDefs();
      const validation = this.catalog.validateWorkflow(resolved.workflowJson, nodeDefs);

      const saved = await this.catalog.saveWorkflow(
        input.name,
        resolved.workflowJson,
        input.slots,
        input.overwrite,
        input.dir
      );

      return {
        action: "save",
        saved: true,
        workflow: {
          name: saved.name,
          path: saved.path,
          structureHash: saved.structureHash,
          slots: Object.keys(saved.slots),
          outputNodes: saved.outputNodes
        },
        validation
      };
    }

    if (action === "delete") {
      if (!input.name) {
        throw new Error("Workflow 'name' is required when action is 'delete'.");
      }
      await this.catalog.deleteWorkflow(input.name, input.dir);
      return {
        action: "delete",
        deleted: true,
        name: input.name
      };
    }

    if (action === "inspect") {
      if (!input.workflow) {
        throw new Error("Workflow name/path or JSON graph is required when action is 'inspect'.");
      }
      const resolved = await this.catalog.resolveWorkflowJson(input.workflow);
      const nodeDefs = await this.getNodeDefs();
      const validation = this.catalog.validateWorkflow(resolved.workflowJson, nodeDefs);

      return {
        action: "inspect",
        name: resolved.name,
        path: resolved.path,
        structureHash: resolved.structureHash,
        slots: resolved.slots,
        outputNodes: resolved.outputNodes,
        validation,
        workflow: resolved.workflowJson
      };
    }

    // Default: "list"
    const workflows = await this.catalog.scan();
    return {
      action: "list",
      storageDirectories: this.catalog.getDirectories(),
      count: workflows.length,
      workflows: workflows.map((w) => ({
        name: w.name,
        path: w.path,
        structureHash: w.structureHash,
        slots: Object.keys(w.slots),
        outputNodes: w.outputNodes
      }))
    };
  }

  /**
   * comfy_generate: Prepare, validate, and execute a workflow
   */
  async generate(
    input: ComfyGenerateInput,
    onProgress?: (progress: number, total: number, message?: string) => void
  ): Promise<RunRecord> {
    await this.ensureConnected();
    const count = Math.max(1, Math.min(input.count || 1, 10));
    const baseSeed =
      input.seed !== undefined ? input.seed : Math.floor(Math.random() * 2_147_483_647);

    // Compute seeds for each candidate
    const seeds: number[] = [];
    for (let i = 0; i < count; i++) {
      if (i === 0) {
        seeds.push(baseSeed);
      } else if (input.seedPolicy === "fixed") {
        seeds.push(baseSeed);
      } else if (input.seedPolicy === "sequential") {
        seeds.push((baseSeed + i) % 2_147_483_647);
      } else {
        // "random" default
        seeds.push(Math.floor(Math.random() * 2_147_483_647));
      }
    }

    // Resolve workflow JSON and slot information
    const resolved = await this.catalog.resolveWorkflowJson(input.workflow);

    // Live validation against /object_info
    try {
      const nodeDefs = await this.getNodeDefs();
      if (nodeDefs) {
        const validation = this.catalog.validateWorkflow(resolved.workflowJson, nodeDefs);
        if (!validation.valid) {
          throw new Error(
            `Workflow validation failed:\n- ${validation.errors.join("\n- ")}${validation.repairSuggestions.length > 0 ? `\n\nRepair Suggestions:\n- ${validation.repairSuggestions.join("\n- ")}` : ""}`
          );
        }
      }
    } catch (e: any) {
      if (e.message?.startsWith("Workflow validation failed")) {
        throw e;
      }
    }

    const runId = `run_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const runRecord: RunRecord = {
      runId,
      promptIds: [],
      status: "queued",
      workflow: resolved.workflowJson,
      workflowName: resolved.name,
      structureHash: resolved.structureHash,
      appliedInputs: input.inputs ? { ...input.inputs } : {},
      seedPolicy: input.seedPolicy,
      seeds,
      candidates: [],
      createdAt: Date.now()
    };

    this.runs.set(runId, runRecord);

    // Prepare candidate jobs
    const jobPromises: Promise<void>[] = [];

    for (let candidateIdx = 0; candidateIdx < count; candidateIdx++) {
      const candidateSeed = seeds[candidateIdx];
      const candidateInputs = { ...(input.inputs || {}) };

      // Set seed in inputs if not explicitly overriding candidate seeds
      if (resolved.slots.seed) {
        candidateInputs[resolved.slots.seed.slot] = candidateSeed;
      }

      // Apply overrides to workflow JSON
      const candidateWorkflow = this.catalog.applyOverrides(
        resolved.workflowJson,
        resolved.slots,
        candidateInputs
      );

      // Create workflow instance
      const wf = Workflow.from(candidateWorkflow, { autoHash: false });

      // Handle image file attachments
      if (input.images) {
        for (const [targetKey, filePath] of Object.entries(input.images)) {
          const fileBuf = await fs.readFile(path.resolve(filePath));
          const fileName = path.basename(filePath);

          let nodeId = targetKey;
          let inputName = "image";

          if (resolved.slots[targetKey]) {
            nodeId = resolved.slots[targetKey].nodeId;
            inputName = resolved.slots[targetKey].inputName;
          } else if (targetKey.includes(".")) {
            const parts = targetKey.split(".");
            nodeId = parts[0];
            inputName = parts.length > 2 && parts[1] === "inputs" ? parts[2] : parts[1];
          }

          wf.attachImage(nodeId as any, inputName, fileBuf, fileName);
        }
      }

      // Explicit output node IDs if provided
      const outputNodeIds = input.outputNodes || (resolved.outputNodes.length > 0 ? resolved.outputNodes : undefined);

      const runPromise = (async () => {
        try {
          const job = await wf.run(this.client, { includeOutputs: outputNodeIds });

          job.on("pending", (promptId) => {
            if (!runRecord.promptIds.includes(promptId)) {
              runRecord.promptIds.push(promptId);
              this.promptToRunId.set(promptId, runId);
            }
            runRecord.status = "running";
            if (onProgress) {
              onProgress(0, 100, `Queued job ${promptId}`);
            }
          });

          job.on("progress", (info) => {
            const pct = info.max > 0 ? Math.floor((info.value / info.max) * 100) : 0;
            runRecord.progress = {
              value: info.value,
              max: info.max,
              pct,
              node: info.node
            };
            if (onProgress) {
              onProgress(
                info.value,
                info.max,
                `Sampling step ${info.value}/${info.max} (${pct}%) on node ${info.node || "sampler"}`
              );
            }
          });

          const result = await job.done();
          const promptId = result._promptId || (runRecord.promptIds[candidateIdx] ?? `prompt_${candidateIdx}`);

          // Extract candidate images from result
          await this.extractAndStoreCandidates(runRecord, candidateIdx, candidateSeed, promptId, result);
        } catch (err: any) {
          runRecord.status = "failed";
          runRecord.error = err.message || String(err);
          throw err;
        }
      })();

      jobPromises.push(runPromise);
    }

    if (input.wait !== false) {
      const timeoutMs = input.timeoutMs || 120000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Generation timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      try {
        await Promise.race([Promise.all(jobPromises), timeoutPromise]);
        runRecord.status = "completed";
        runRecord.completedAt = Date.now();
      } catch (err: any) {
        const curStatus = runRecord.status as string;
        if (curStatus !== "completed") {
          runRecord.status = "failed";
          runRecord.error = err.message || String(err);
        }
      }
    }

    return runRecord;
  }

  /**
   * Extract multi-modal output artifacts (images, video, audio, 3D, text) and buffer data
   */
  private async extractAndStoreCandidates(
    runRecord: RunRecord,
    candidateIdx: number,
    seed: number,
    promptId: string,
    result: any
  ): Promise<void> {
    for (const [nodeId, val] of Object.entries(result)) {
      if (nodeId.startsWith("_")) continue;
      const valObj: any = val;
      if (!valObj || typeof valObj !== "object") continue;

      // Extract from standard ComfyUI output arrays: images, gifs, videos, audio, 3d, files
      const itemArrays: Array<{ items: any[]; defaultType: MediaType }> = [];

      if (Array.isArray(valObj.images)) itemArrays.push({ items: valObj.images, defaultType: "image" });
      if (Array.isArray(valObj.gifs)) itemArrays.push({ items: valObj.gifs, defaultType: "video" });
      if (Array.isArray(valObj.videos)) itemArrays.push({ items: valObj.videos, defaultType: "video" });
      if (Array.isArray(valObj.audio)) itemArrays.push({ items: valObj.audio, defaultType: "audio" });
      if (Array.isArray(valObj.mesh)) itemArrays.push({ items: valObj.mesh, defaultType: "3d" });
      if (Array.isArray(valObj.files)) itemArrays.push({ items: valObj.files, defaultType: "file" });

      for (const { items, defaultType } of itemArrays) {
        for (const item of items) {
          const filename = String(item.filename || item.name || "artifact");
          const subfolder = String(item.subfolder || "");
          const imgType = String(item.type || "output");
          const mediaType = detectMediaType(filename) || defaultType;

          const artifact: CandidateArtifact = {
            index: candidateIdx,
            promptId,
            nodeId,
            filename,
            subfolder,
            type: imgType,
            mediaType,
            seed
          };

          // Fetch buffer for image/visual inspection caching
          if (mediaType === "image" || filename.endsWith(".png") || filename.endsWith(".jpg") || filename.endsWith(".webp")) {
            try {
              const blob = await this.client.ext.file.getImage({
                filename: artifact.filename,
                subfolder: artifact.subfolder || "",
                type: artifact.type || "output"
              });
              const arrayBuffer = await blob.arrayBuffer();
              artifact.imageBuffer = Buffer.from(arrayBuffer);
              artifact.mimeType = blob.type || "image/png";
            } catch {
              // Non-fatal if buffer fetch fails
            }
          }

          // Build view URL
          artifact.url = this.client.ext.file.getPathImage({
            filename: artifact.filename,
            subfolder: artifact.subfolder || "",
            type: artifact.type || "output"
          });

          runRecord.candidates.push(artifact);
        }
      }
    }
  }

  /**
   * comfy_revise: Create a child run branched from a parent run with targeted revisions
   */
  async revise(
    input: ComfyReviseInput,
    onProgress?: (progress: number, total: number, message?: string) => void
  ): Promise<RunRecord> {
    const parentRun = this.getRun(input.runId);
    if (!parentRun) {
      throw new Error(`Parent run '${input.runId}' not found. Please provide a valid previous run ID.`);
    }

    // Merge overrides
    const newInputs: Record<string, any> = { ...parentRun.appliedInputs };

    if (input.prompt !== undefined) {
      newInputs.prompt = input.prompt;
    }
    if (input.negativePrompt !== undefined) {
      newInputs.negative_prompt = input.negativePrompt;
      newInputs.negativePrompt = input.negativePrompt;
    }
    if (input.inputs) {
      Object.assign(newInputs, input.inputs);
    }

    // Determine seed policy and seed
    let seed: number | undefined;
    let seedPolicy: "random" | "fixed" | "sequential" = "random";

    if (input.seedPolicy === "keep") {
      seed = parentRun.seeds[0];
      seedPolicy = "fixed";
    } else if (typeof input.seedPolicy === "number") {
      seed = input.seedPolicy;
      seedPolicy = "fixed";
    } else {
      // "new"
      seed = Math.floor(Math.random() * 2_147_483_647);
      seedPolicy = "random";
    }

    const childRun = await this.generate(
      {
        workflow: parentRun.workflow,
        inputs: newInputs,
        count: input.count || 1,
        seed,
        seedPolicy,
        wait: input.wait !== false,
        timeoutMs: input.timeoutMs
      },
      onProgress
    );

    childRun.parentRunId = parentRun.runId;
    childRun.note = input.note;

    return childRun;
  }

  /**
   * comfy_job: Query, wait, or cancel a run
   */
  async job(input: ComfyJobInput): Promise<RunRecord> {
    const runRecord = this.getRun(input.runId);
    if (!runRecord) {
      throw new Error(`Run or prompt ID '${input.runId}' not found in active session.`);
    }

    if (input.action === "cancel") {
      for (const pid of runRecord.promptIds) {
        try {
          await this.client.ext.queue.cancelPrompt(pid);
        } catch {
          // Fallback interrupt
          await this.client.ext.queue.interrupt(pid).catch(() => {});
        }
      }
      runRecord.status = "cancelled";
      return runRecord;
    }

    if (input.action === "wait") {
      const isTerminal = (status: string) =>
        status === "completed" || status === "failed" || status === "cancelled";

      if (isTerminal(runRecord.status)) {
        return runRecord;
      }

      const timeoutMs = input.timeoutMs || 30000;
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        const curStatus = runRecord.status as string;
        if (isTerminal(curStatus)) {
          return runRecord;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      return runRecord;
    }

    // Default "status"
    return runRecord;
  }

  /**
   * comfy_inspect: Generate review images (contact sheet, single image, crop, comparison)
   */
  async inspect(input: ComfyInspectOptions): Promise<{
    imageContent?: { type: "image"; data: string; mimeType: string };
    metadata: Record<string, any>;
  }> {
    const runRecord = this.getRun(input.runId);
    if (!runRecord) {
      throw new Error(`Run or prompt ID '${input.runId}' not found in session.`);
    }

    // Ensure candidate buffers are loaded
    await this.ensureCandidateBuffers(runRecord);

    if (runRecord.candidates.length === 0) {
      throw new Error(
        `Run '${input.runId}' has no generated outputs (status: ${runRecord.status}${runRecord.error ? `, error: ${runRecord.error}` : ""}).`
      );
    }

    const candidateIdx = Math.max(0, Math.min(input.candidateIndex ?? 0, runRecord.candidates.length - 1));
    const targetCandidate = runRecord.candidates[candidateIdx];
    const maxDim = input.maxDimension || 1024;
    const format = input.format || "jpeg";

    const mode = input.mode || (runRecord.candidates.length > 1 ? "contact_sheet" : "image");

    const metadata: Record<string, any> = {
      runId: runRecord.runId,
      parentRunId: runRecord.parentRunId,
      status: runRecord.status,
      candidateIndex: candidateIdx,
      totalCandidates: runRecord.candidates.length,
      candidate: {
        filename: targetCandidate.filename,
        subfolder: targetCandidate.subfolder,
        nodeId: targetCandidate.nodeId,
        mediaType: targetCandidate.mediaType,
        seed: targetCandidate.seed,
        url: targetCandidate.url
      },
      mode
    };

    if (mode === "original" || !targetCandidate.imageBuffer) {
      return { metadata };
    }

    if (mode === "contact_sheet") {
      const visualItems = runRecord.candidates
        .filter((c) => Boolean(c.imageBuffer))
        .map((c, i) => ({
          buffer: c.imageBuffer!,
          label: `Candidate ${i + 1} [Seed: ${c.seed ?? "auto"}]`,
          seed: c.seed,
          index: i
        }));

      if (visualItems.length === 0) {
        return { metadata };
      }

      const sheet = await createContactSheet(visualItems, maxDim, format);
      metadata.contactSheet = {
        width: sheet.width,
        height: sheet.height,
        mimeType: sheet.mimeType
      };

      return {
        imageContent: toMcpImageContent(sheet),
        metadata
      };
    }

    if (mode === "crop") {
      if (!input.crop) {
        throw new Error("Mode 'crop' requires 'crop' bounds parameter ({ x, y, width, height }).");
      }
      const cropResult = await createCrop(targetCandidate.imageBuffer, input.crop, format);
      metadata.crop = {
        appliedBounds: input.crop,
        width: cropResult.width,
        height: cropResult.height
      };
      return {
        imageContent: toMcpImageContent(cropResult),
        metadata
      };
    }

    if (mode === "compare") {
      const compareRunId = input.compareRunId || runRecord.parentRunId;
      if (!compareRunId) {
        throw new Error("Mode 'compare' requires a parent run or an explicit 'compareRunId'.");
      }

      const parentRun = this.getRun(compareRunId);
      if (!parentRun) {
        throw new Error(`Comparison run '${compareRunId}' not found.`);
      }

      await this.ensureCandidateBuffers(parentRun);
      if (parentRun.candidates.length === 0 || !parentRun.candidates[0].imageBuffer) {
        throw new Error(`Comparison run '${compareRunId}' has no image buffers.`);
      }

      const parentCandidate = parentRun.candidates[0];
      const compResult = await createSideBySideComparison(
        {
          buffer: parentCandidate.imageBuffer!,
          label: `Parent (${parentRun.runId.substring(0, 12)}... [Seed: ${parentCandidate.seed ?? "auto"}])`
        },
        {
          buffer: targetCandidate.imageBuffer,
          label: `Revision (${runRecord.runId.substring(0, 12)}... [Seed: ${targetCandidate.seed ?? "auto"}])`
        },
        maxDim,
        format
      );

      metadata.compare = {
        parentRunId: parentRun.runId,
        parentSeed: parentCandidate.seed,
        childRunId: runRecord.runId,
        childSeed: targetCandidate.seed
      };

      return {
        imageContent: toMcpImageContent(compResult),
        metadata
      };
    }

    // Default: "image"
    const bounded = await createBoundedImage(targetCandidate.imageBuffer, maxDim, format);
    metadata.image = {
      width: bounded.width,
      height: bounded.height,
      originalWidth: bounded.originalWidth,
      originalHeight: bounded.originalHeight
    };

    return {
      imageContent: toMcpImageContent(bounded),
      metadata
    };
  }

  /**
   * Helper: Ensure candidate image buffers are loaded from ComfyUI history/file APIs
   */
  private async ensureCandidateBuffers(runRecord: RunRecord): Promise<void> {
    for (const candidate of runRecord.candidates) {
      if (!candidate.imageBuffer && candidate.filename && candidate.mediaType === "image") {
        try {
          const blob = await this.client.ext.file.getImage({
            filename: candidate.filename,
            subfolder: candidate.subfolder || "",
            type: candidate.type || "output"
          });
          const ab = await blob.arrayBuffer();
          candidate.imageBuffer = Buffer.from(ab);
          candidate.mimeType = blob.type || "image/png";
        } catch {
          // Ignore fetch error
        }
      }
    }

    // If candidates list is empty, try recovering from history for promptIds
    if (runRecord.candidates.length === 0) {
      for (let i = 0; i < runRecord.promptIds.length; i++) {
        const pid = runRecord.promptIds[i];
        if (!pid) continue;
        try {
          const historyEntry = await this.client.ext.history.getHistory(pid);
          if (historyEntry && historyEntry.outputs) {
            await this.extractAndStoreCandidates(
              runRecord,
              i,
              runRecord.seeds[i] ?? 0,
              pid,
              historyEntry.outputs
            );
          }
        } catch {
          // Ignore
        }
      }
    }
  }
}
