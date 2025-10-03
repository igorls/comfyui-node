/**
 * Node Bypass Demo
 * ----------------
 * Demonstrates how to bypass nodes in a ComfyUI workflow.
 * 
 * Bypassing a node removes it from the workflow and automatically
 * reconnects its inputs to its outputs where type-compatible.
 */

import { ComfyApi, PromptBuilder } from '../src/index.ts';
import BaseWorkflow from './txt2img-workflow.json';

async function main() {
    console.log('🔧 Node Bypass Demo\n');
    
    const api = new ComfyApi('http://localhost:10888');
    await api.ready();
    console.log('✓ Connected to ComfyUI\n');

    // Example 1: Using PromptBuilder (current approach)
    console.log('━━━ Example 1: PromptBuilder.bypass() ━━━\n');
    
    const workflow = {
        ...BaseWorkflow,
        // Add an upscale node for demonstration
        'UPSCALE': {
            inputs: {
                upscale_method: 'nearest-exact',
                scale_by: 2,
                image: ['VAE_DECODE', 0]
            },
            class_type: 'ImageScaleBy',
            _meta: { title: 'Upscale Image' }
        },
        // Update SaveImage to use upscaled output
        'SAVE_IMAGE': {
            ...BaseWorkflow.SAVE_IMAGE,
            inputs: {
                ...BaseWorkflow.SAVE_IMAGE.inputs,
                images: ['UPSCALE', 0]
            }
        }
    };

    // Create a PromptBuilder
    const builder = new PromptBuilder(
        workflow as any,
        ['checkpoint', 'prompt'] as any, // input keys
        ['final_images'] as any // output keys
    );

    // Set basic workflow parameters  
    builder.setRawInputNode('checkpoint' as any, 'LOAD_CHECKPOINT.inputs.ckpt_name');
    builder.setRawInputNode('prompt' as any, 'CLIP_TEXT_ENCODE_POSITIVE.inputs.text');
    builder.setRawOutputNode('final_images' as any, 'SAVE_IMAGE');

    // Set values
    builder.prompt.LOAD_CHECKPOINT.inputs.ckpt_name = 'dreamshaper_8.safetensors';
    builder.prompt.CLIP_TEXT_ENCODE_POSITIVE.inputs.text = 'a beautiful landscape, high quality';
    builder.prompt.LATENT_IMAGE.inputs.width = 512;
    builder.prompt.LATENT_IMAGE.inputs.height = 512;
    builder.prompt.SAMPLER.inputs.seed = Math.floor(Math.random() * 1000000000);
    builder.prompt.SAMPLER.inputs.steps = 8;

    console.log('Original workflow includes:');
    console.log('  • UPSCALE node (ImageScaleBy)');
    console.log('  • VAE_DECODE → UPSCALE → SAVE_IMAGE\n');

    // NOW BYPASS THE UPSCALE NODE
    const bypassedBuilder = builder.bypass('UPSCALE');
    
    console.log('✨ Bypassing UPSCALE node...');
    console.log('   SDK will automatically reconnect:');
    console.log('   VAE_DECODE → SAVE_IMAGE (skipping UPSCALE)\n');

    console.log('⏳ Running workflow with bypassed node...\n');

    // Use CallWrapper with the bypassed builder
    const { CallWrapper } = await import('../src/index.ts');
    const wrapper = new CallWrapper(api as any, bypassedBuilder);

    wrapper.onProgress((info) => {
        const pct = ((info.value / info.max) * 100).toFixed(0);
        process.stdout.write(`\r⏳ Progress: ${info.value}/${info.max} (${pct}%)   `);
    });

    const result: any = await wrapper.run();

    if (result) {
        console.log('\n\n✅ SUCCESS! Image generated without upscaling\n');
        
        const images = result.final_images?.images || [];
        if (images.length > 0) {
            console.log(`📸 Generated ${images.length} image(s):`);
            for (const img of images) {
                const path = api.ext.file.getPathImage(img);
                console.log(`   → ${path}`);
            }
        }
        console.log('\n💡 The UPSCALE node was removed and connections auto-rewired!');
    } else {
        console.error('\n❌ Workflow failed');
    }

    console.log('\n━━━ Example 2: Bypass Multiple Nodes ━━━\n');

    // You can also bypass multiple nodes at once
    const multiBypass = builder.bypass(['UPSCALE', 'CLIP_TEXT_ENCODE_NEGATIVE']);
    
    console.log('To bypass multiple nodes:');
    console.log('  builder.bypass([\'UPSCALE\', \'CLIP_TEXT_ENCODE_NEGATIVE\'])\n');
    
    console.log('━━━ Example 3: Reinstate Bypassed Node ━━━\n');
    
    const reinstated = multiBypass.reinstate('UPSCALE');
    
    console.log('To un-bypass a node:');
    console.log('  builder.reinstate(\'UPSCALE\')\n');
    console.log('Or reinstate multiple:');
    console.log('  builder.reinstate([\'UPSCALE\', \'OTHER_NODE\'])\n');

    console.log('━━━ How It Works ━━━\n');
    console.log('When bypassing a node, the SDK:');
    console.log('  1. Fetches the node type definition from ComfyUI');
    console.log('  2. Maps outputs to inputs by matching types');
    console.log('  3. Rewires all connections automatically');
    console.log('  4. Removes the bypassed node from workflow\n');
    
    console.log('This is equivalent to ComfyUI\'s "Bypass" feature in the UI!\n');

    console.log('🎉 Demo complete!\n');
}

main().catch(e => {
    console.error('\n❌ Fatal error:', e.message);
    process.exit(1);
});
