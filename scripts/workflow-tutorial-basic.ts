/**
 * Basic High-Level Workflow Tutorial
 * ----------------------------------
 *
 * Steps:
 *  1. Load a base workflow JSON
 *  2. Change a few inputs with .set('nodeId.inputs.field', value)
 *  3. Mark desired output node with an alias via .output('final_images:9')
 *  4. Run with api.run(wf, { autoDestroy: true }) and watch events
 *  5. Print image file paths
 *
 * Assumptions: ComfyUI running at http://127.0.0.1:8188 and node 9 is a SaveImage node.
 */

import { ComfyApi, Workflow } from '../src/index.ts';
import BaseWorkflow from './txt2img-workflow.json';

async function main() {
    const api = new ComfyApi('http://127.0.0.1:8188');
    await api.ready();

    console.log('ComfyAPI ready, version');

    api.on('b_preview', () => {
        console.log('[preview] new frame');
    });

    // Create a mutable workflow copy.
    const wf = Workflow.fromAugmented(BaseWorkflow)

        // Set inputs on nodes by node ID and input key.
        .input('LOAD_CHECKPOINT', 'ckpt_name', 'dreamshaper_8.safetensors')

        // Define the text prompt.
        .input('CLIP_TEXT_ENCODE_POSITIVE', 'text', 'A cinematic landscape, warm sunrise light, ultradetailed')

        // Image dimensions
        .batchInputs('LATENT_IMAGE', { width: 1280, height: 720 })

        // Seed: keep -1 to allow SDK auto-randomization
        .batchInputs('SAMPLER', {
            sampler_name: "dpmpp_2m_sde_gpu",
            scheduler: "karras",
            steps: 20,
            cfg: 1.2,
            seed: -1
        })

        // alias 'final_images' -> node SAVE_IMAGE
        .output('final_images', 'SAVE_IMAGE');

    // Run the workflow; awaiting resolves AFTER acceptance (pending state) and returns a WorkflowJob handle.
    // (If you don't need events you can use: const outputs = await api.runAndWait(wf); )
    const job = await api.run(wf, { autoDestroy: true });

    job.on('start', (id: string) => {
        console.log(`[start] executing prompt ->`, id);
    });

    let currentPct = '0%';
    let currentNode = '';
    let currentStep = 0;
    let totalSteps = 0;

    job.on('progress', (info) => {
        console.log(info);
        currentPct = (info.value / info.max * 100).toFixed(1) + '%';
        currentNode = info.node;
        currentStep = info.value;
        totalSteps = info.max;
    });

    job.on('preview', (blob: Blob) => {
        console.log(`[preview] [${currentNode}] [STEP: ${currentStep}/${totalSteps}] new frame - ${blob.size} bytes (${currentPct})`);
    });

    job.on('preview_meta', ({ metadata, blob }) => {
        console.log(`[preview-meta] [${currentNode}] [STEP: ${currentStep}/${totalSteps}] new frame - ${blob.size} bytes (${currentPct})`, metadata);
    });

    job.on('failed', (err: Error) => {
        console.error(`[error] workflow failed:`, err);
    });

    const result = await job.done();
    // Access images via alias key.
    const images = result.final_images.images || [];
    for (const img of images) {
        console.log(' image path ->', api.ext.file.getPathImage(img));
    }
}

main().catch(e => {
    console.error('[fatal] Tutorial script error:', e);
    process.exit(1);
});
