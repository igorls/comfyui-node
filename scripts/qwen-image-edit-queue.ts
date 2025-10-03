/**
 * Qwen Image Edit 2509 - Queue Only
 * ----------------------------------
 * 
 * This version queues the workflow and exits immediately without waiting.
 * Check the ComfyUI web interface or output folder for results.
 * 
 * This avoids the Windows stderr.flush() issue in comfyui-manager.
 */

import path from 'node:path';
import { ComfyApi, Workflow } from '../src/index.ts';
import QwenEditWorkflow from './QwenEdit2509-Nunchaku-R32-S4.json';

async function main() {
    console.log('🔧 Connecting to ComfyUI...\n');
    
    const api = new ComfyApi('http://localhost:10888');
    await api.ready();

    // Load example images
    const EX_DIR = path.resolve(process.cwd(), 'scripts', 'example_images');
    const img1 = await Bun.file(path.join(EX_DIR, 'fast_00240_.png')).arrayBuffer();
    const img2 = await Bun.file(path.join(EX_DIR, 'fast_00245_.png')).arrayBuffer();
    const img3 = await Bun.file(path.join(EX_DIR, 'fast_00313_.png')).arrayBuffer();

    console.log('✓ Loaded 3 reference images');

    const wf = Workflow.fromAugmented(QwenEditWorkflow)
        .input('1', 'value', 'A professional studio portrait with dramatic cinematic lighting, vibrant colors, and elegant composition')
        .input('10', 'seed', Math.floor(Math.random() * 1000000000))
        .attachImage('24', 'image', img1, 'img1.png', { override: true })
        .attachImage('23', 'image', img2, 'img2.png', { override: true })
        .attachImage('21', 'image', img3, 'img3.png', { override: true })
        .output('final_images', '19');

    console.log('✓ Workflow configured\n');
    
    console.log('📝 Workflow Details:');
    console.log('   • Model: Qwen Image Edit 2509 (Nunchaku R32 4-step)');
    console.log('   • Prompt: "A professional studio portrait with dramatic cinematic lighting..."');
    console.log('   • Steps: 4 | Sampler: euler | Scheduler: simple');
    console.log('   • Resolution: 896x896');
    console.log('   • Reference Images: 3\n');

    // Queue the workflow without waiting for completion
    try {
        // Queue it and get the job handle, but don't wait
        const job = await api.run(wf);
        
        console.log('✅ Workflow queued successfully!\n');
        console.log(`📋 Prompt ID: ${(job as any)._promptId || 'N/A'}`);
        console.log('🌐 Monitor progress at: http://localhost:10888\n');
        console.log('📁 Output will be saved to:');
        console.log('   ComfyUI/output/qwen-image-edit/fast-r32-4step/\n');
        console.log('💡 Tip: The workflow may take 10-30 seconds depending on your GPU.');
        console.log('      Check the output folder or ComfyUI web interface for results.');
        
        // Don't wait for done() - just queue and exit
        
    } catch (err: any) {
        console.error('\n❌ Failed to queue workflow\n');
        console.error('Error:', err.message);
        if (err.cause) {
            console.error('Details:', err.cause);
        }
        process.exit(1);
    }
}

main().catch(e => {
    console.error('\n❌ Fatal error:', e.message);
    process.exit(1);
});
