/**
 * Simple Text-to-Image Test
 * --------------------------
 * Basic workflow test to verify SDK functionality
 */

import { ComfyApi, Workflow } from '../src/index.ts';
import BaseWorkflow from './txt2img-workflow.json';

async function main() {
    console.log('🔧 Testing simple txt2img workflow...\n');
    
    const api = new ComfyApi('http://localhost:10888');
    await api.ready();
    console.log('✓ Connected to ComfyUI\n');

    const wf = Workflow.fromAugmented(BaseWorkflow)
        .input('LOAD_CHECKPOINT', 'ckpt_name', 'dreamshaper_8.safetensors')
        .input('CLIP_TEXT_ENCODE_POSITIVE', 'text', 'a beautiful sunset over mountains, vibrant colors, professional photography')
        .batchInputs('LATENT_IMAGE', { width: 512, height: 512 })
        .batchInputs('SAMPLER', {
            sampler_name: "euler",
            scheduler: "simple",
            steps: 8,
            cfg: 3.5,
            seed: Math.floor(Math.random() * 1000000000)
        })
        .output('final_images', 'SAVE_IMAGE');

    console.log('📝 Workflow configured:');
    console.log('   • Model: dreamshaper_8.safetensors');
    console.log('   • Prompt: "a beautiful sunset over mountains..."');
    console.log('   • Size: 512x512');
    console.log('   • Steps: 8 (fast test)');
    console.log('   • Sampler: euler + normal\n');

    try {
        console.log('⏳ Running workflow...\n');
        
        const result = await api.runAndWait(wf);
        
        console.log('✅ SUCCESS! Workflow completed!\n');
        
        const images = result.final_images?.images || [];
        if (images.length > 0) {
            console.log(`📸 Generated ${images.length} image(s):`);
            for (const img of images) {
                const path = api.ext.file.getPathImage(img);
                console.log(`   → ${path}`);
            }
        }
        
        console.log('\n🎉 SDK is working correctly!');
        
    } catch (err: any) {
        console.error('\n❌ Test failed\n');
        console.error('Error:', err.message);
        
        if (err.cause) {
            const cause = err.cause;
            console.error('\nDetails:');
            console.error('  Node:', cause.node_id, '-', cause.node_type);
            console.error('  Exception:', cause.exception_type);
            console.error('  Message:', cause.exception_message?.trim());
        }
        
        process.exit(1);
    }
}

main().catch(e => {
    console.error('\n❌ Fatal error:', e.message);
    process.exit(1);
});
