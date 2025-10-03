/**
 * Workflow Class Bypass Demo
 * --------------------------
 * Demonstrates the new bypass() method on the Workflow class
 */

import { ComfyApi, Workflow } from '../src/index.ts';
import BaseWorkflow from './txt2img-workflow.json';

async function main() {
    console.log('🎉 Workflow.bypass() Demo\n');
    
    const api = new ComfyApi('http://localhost:10888');
    
    try {
        await api.ready();
        console.log('✓ Connected to ComfyUI\n');
    } catch (err: any) {
        console.error('❌ Failed to connect:', err.message);
        console.error('   Make sure ComfyUI is running on port 10888\n');
        process.exit(1);
    }

    // Example 1: Simple bypass using Workflow class
    console.log('━━━ Example 1: Skip Negative Prompt ━━━\n');
    
    const wf = Workflow.fromAugmented(BaseWorkflow)
        .input('LOAD_CHECKPOINT', 'ckpt_name', 'dreamshaper_8.safetensors')
        .input('CLIP_TEXT_ENCODE_POSITIVE', 'text', 'beautiful sunset over mountains, professional photography')
        .batchInputs('LATENT_IMAGE', { width: 512, height: 512 })
        .batchInputs('SAMPLER', {
            sampler_name: 'euler',
            scheduler: 'simple',
            steps: 8,
            cfg: 3.5,
            seed: -1
        })
        .output('final_images', 'SAVE_IMAGE')
        .bypass('CLIP_TEXT_ENCODE_NEGATIVE');  // ← NEW! Bypass negative prompt

    console.log('Workflow configuration:');
    console.log('  • Model: dreamshaper_8.safetensors');
    console.log('  • Positive: "beautiful sunset over mountains..."');
    console.log('  • Negative: BYPASSED! ✨');
    console.log('  • Steps: 8\n');

    console.log('⏳ Running workflow...\n');

    const job = await api.run(wf, { autoDestroy: true });

    job.on('progress', (info) => {
        const pct = ((info.value / info.max) * 100).toFixed(0);
        process.stdout.write(`\r⏳ Progress: ${info.value}/${info.max} (${pct}%)   `);
    });

    try {
        const result = await job.done();
        
        console.log('\n\n✅ SUCCESS!\n');
        
        const images = result.final_images?.images || [];
        if (images.length > 0) {
            console.log(`📸 Generated ${images.length} image(s):`);
            for (const img of images) {
                const path = api.ext.file.getPathImage(img);
                console.log(`   → ${path}`);
            }
        }
        
        console.log('\n💡 The CLIP_TEXT_ENCODE_NEGATIVE node was bypassed!');
        console.log('   The workflow ran without a negative prompt.\n');

    } catch (err: any) {
        console.error('\n❌ Failed:', err.message);
        process.exit(1);
    }

    // Example 2: Bypass multiple nodes
    console.log('━━━ Example 2: Bypass Multiple Nodes ━━━\n');
    
    const multiBypass = Workflow.fromAugmented(BaseWorkflow)
        .input('LOAD_CHECKPOINT', 'ckpt_name', 'dreamshaper_8.safetensors')
        .input('CLIP_TEXT_ENCODE_POSITIVE', 'text', 'a cat')
        .output('images', 'SAVE_IMAGE')
        .bypass(['CLIP_TEXT_ENCODE_NEGATIVE', 'LATENT_IMAGE']);  // Multiple at once

    console.log('You can bypass multiple nodes:');
    console.log('  .bypass([\'CLIP_TEXT_ENCODE_NEGATIVE\', \'LATENT_IMAGE\'])\n');

    // Example 3: Reinstate
    console.log('━━━ Example 3: Reinstate Bypassed Nodes ━━━\n');
    
    const reinstated = Workflow.fromAugmented(BaseWorkflow)
        .bypass('CLIP_TEXT_ENCODE_NEGATIVE')
        .bypass('LATENT_IMAGE')
        .reinstate('LATENT_IMAGE');  // Un-bypass it

    console.log('To un-bypass a node:');
    console.log('  .reinstate(\'NODE_ID\')\n');
    console.log('Or reinstate multiple:');
    console.log('  .reinstate([\'NODE_1\', \'NODE_2\'])\n');

    // Example 4: Chaining
    console.log('━━━ Example 4: Chainable API ━━━\n');
    
    console.log('All methods are chainable:');
    console.log('');
    console.log('  Workflow.fromAugmented(json)');
    console.log('    .input(\'checkpoint\', \'ckpt_name\', \'model.safetensors\')');
    console.log('    .input(\'positive\', \'text\', \'beautiful landscape\')');
    console.log('    .bypass(\'UPSCALE_NODE\')        // Skip upscaling');
    console.log('    .bypass(\'DENOISE_NODE\')        // Skip denoising');
    console.log('    .output(\'images\', \'SAVE_IMAGE\')');
    console.log('    .run(api);\n');

    console.log('━━━ Summary ━━━\n');
    console.log('✅ Workflow.bypass() is now available!');
    console.log('✅ Works exactly like PromptBuilder.bypass()');
    console.log('✅ Fully chainable with all Workflow methods');
    console.log('✅ Type-safe and auto-complete friendly\n');

    console.log('🎉 Demo complete!\n');
}

main().catch(e => {
    console.error('\n❌ Fatal error:', e.message);
    process.exit(1);
});
