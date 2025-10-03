/**
 * Qwen Image Edit 2509 Demo Script
 * ---------------------------------
 * 
 * This script demonstrates using the Qwen Image Edit 2509 model with Nunchaku optimization.
 * It loads three input images and applies an edit instruction to generate a new image.
 * 
 * Requirements:
 * - ComfyUI running at http://localhost:8188
 * - Qwen Image Edit model: svdq-int4_r32-qwen-image-edit-2509-lightningv2.0-4steps.safetensors
 * - Qwen CLIP model: qwen_2.5_vl_7b_fp8_scaled.safetensors
 * - Qwen VAE: qwen_image_vae.safetensors
 * - Nunchaku custom nodes installed
 * - Three input images in the scripts/example_images directory
 * 
 * KNOWN ISSUE: On some Windows setups with comfyui-manager, there may be an
 * OSError "[Errno 22] Invalid argument" during stderr.flush(). This is a
 * ComfyUI logging issue, not a workflow problem. The workflow processes correctly
 * even if this error occurs.
 */

import path from 'node:path';
import { ComfyApi, Workflow } from '../src/index.ts';
import QwenEditWorkflow from './QwenEdit2509-Nunchaku-R32-S4.json';

async function main() {
    const api = new ComfyApi('http://localhost:10888');
    await api.ready();

    console.log('✓ ComfyAPI ready');

    // Load example images
    const EX_DIR = path.resolve(process.cwd(), 'scripts', 'example_images');
    const img1Path = path.join(EX_DIR, 'fast_00240_.png');
    const img2Path = path.join(EX_DIR, 'fast_00245_.png');
    const img3Path = path.join(EX_DIR, 'fast_00313_.png');

    const img1Buf = await Bun.file(img1Path).arrayBuffer();
    const img2Buf = await Bun.file(img2Path).arrayBuffer();
    const img3Buf = await Bun.file(img3Path).arrayBuffer();

    console.log('✓ Loaded 3 example images');

    // Create workflow from the JSON
    const wf = Workflow.fromAugmented(QwenEditWorkflow)
        // Set the edit prompt
        .input('1', 'value', 'A professional studio portrait with dramatic lighting')
        
        // Set the seed (-1 for random)
        .input('10', 'seed', -1)
        
        // Attach the three input images
        .attachImage('24', 'image', img1Buf, 'fast_00240_.png', { override: true })
        .attachImage('23', 'image', img2Buf, 'fast_00245_.png', { override: true })
        .attachImage('21', 'image', img3Buf, 'fast_00313_.png', { override: true })
        
        // Mark the output node (SaveImage node)
        .output('final_images', '19');

    console.log('📝 Workflow configured');
    console.log('   Prompt: "A professional studio portrait with dramatic lighting"');
    console.log('   Steps: 4');
    console.log('   Sampler: euler');
    console.log('   Input images: 3 reference images attached');

    // Run the workflow
    const job = await api.run(wf, { autoDestroy: true });

    job.on('start', (id: string) => {
        console.log(`🚀 Workflow started - Prompt ID: ${id}`);
    });

    let currentNode = '';
    let currentStep = 0;
    let totalSteps = 0;

    job.on('progress', (info) => {
        currentNode = info.node || '';
        currentStep = info.value || 0;
        totalSteps = info.max || 0;
        const pct = totalSteps > 0 ? ((currentStep / totalSteps) * 100).toFixed(1) : '0.0';
        process.stdout.write(`\r⏳ Progress: ${currentStep}/${totalSteps} (${pct}%) - Node: ${currentNode}   `);
    });

    job.on('preview', (blob: Blob) => {
        const pct = totalSteps > 0 ? ((currentStep / totalSteps) * 100).toFixed(1) : '0.0';
        console.log(`\n🖼️  Preview frame: ${blob.size} bytes (${pct}% complete)`);
    });

    job.on('failed', (err: Error) => {
        console.error('\n❌ Workflow failed:', err);
        // Log full error details
        if ((err as any).cause) {
            console.error('Error details:', JSON.stringify((err as any).cause, null, 2));
        }
        process.exit(1);
    });

    console.log('⏳ Executing workflow...\n');

    try {
        const result = await job.done();
        console.log('\n✅ Workflow completed successfully!');
        
        const images = result.final_images?.images || [];
        if (images.length > 0) {
            console.log(`\n📸 Generated ${images.length} image(s):`);
            for (const img of images) {
                const imagePath = api.ext.file.getPathImage(img);
                console.log(`   → ${imagePath}`);
            }
        } else {
            console.log('\n⚠️  No images were generated');
        }
    } catch (err) {
        console.error('\n❌ Error during workflow execution:', err);
        process.exit(1);
    }
}

main().catch(e => {
    console.error('\n❌ Fatal error:', e);
    process.exit(1);
});
