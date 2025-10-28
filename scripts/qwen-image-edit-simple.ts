/**
 * Qwen Image Edit 2509 Demo Script (Simplified)
 * ----------------------------------------------
 * 
 * Minimal version without progress monitoring to avoid ComfyUI logging issues.
 */

import path from 'node:path';
import { ComfyApi, Workflow } from '../src/index.ts';
import QwenEditWorkflow from './workflows/quick-edit-test.json';

async function main() {
    console.log('🔧 Connecting to ComfyUI at http://localhost:10888...');
    
    const api = new ComfyApi('http://localhost:10888');
    await api.ready();

    console.log('✓ ComfyAPI ready\n');

    // Load example images
    const EX_DIR = path.resolve(process.cwd(), 'scripts', 'example_images');
    const img1 = await Bun.file(path.join(EX_DIR, 'fast_00240_.png')).arrayBuffer();
    const img2 = await Bun.file(path.join(EX_DIR, 'fast_00245_.png')).arrayBuffer();
    const img3 = await Bun.file(path.join(EX_DIR, 'fast_00313_.png')).arrayBuffer();

    console.log('✓ Loaded 3 example images\n');

    const wf = Workflow.fromAugmented(QwenEditWorkflow)
        .input('91', 'prompt', 'A professional studio portrait with dramatic cinematic lighting and vibrant colors')
        .input('51', 'seed', -1)
        .attachImage('97', 'image', img1, 'img1.png', { override: true })
        .output('final_images', '207');

    console.log('📝 Workflow Configuration:');
    console.log('   • Prompt: "A professional studio portrait with dramatic cinematic lighting and vibrant colors"');
    console.log('   • Model: Qwen Image Edit 2509 (Nunchaku R32 4-step)');
    console.log('   • Steps: 4');
    console.log('   • Sampler: euler + simple scheduler');
    console.log('   • Reference images: 3\n');

    try {
        console.log('⏳ Starting workflow execution (this may take a moment)...\n');
        
        // Use runAndWait for simplicity - awaits final output
        const result = await api.runAndWait(wf);
        
        console.log('✅ Workflow completed successfully!\n');
        
        const images = result.final_images?.images || [];
        if (images.length > 0) {
            console.log(`📸 Generated ${images.length} image(s):`);
            for (const img of images) {
                const imagePath = api.ext.file.getPathImage(img);
                console.log(`   → ${imagePath}`);
            }
        } else {
            console.log('⚠️  No images were generated');
        }
    } catch (err: any) {
        console.error('\n❌ Workflow execution failed\n');
        console.error('Error type:', err.constructor.name);
        console.error('Message:', err.message);
        
        if (err.cause) {
            const cause = err.cause;
            console.error('\nDetails:');
            console.error('  Node ID:', cause.node_id);
            console.error('  Node Type:', cause.node_type);
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
