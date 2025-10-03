/**
 * Quick Bypass Example
 * --------------------
 * Minimal example showing how to bypass a node
 */

import { ComfyApi, PromptBuilder, CallWrapper } from '../src/index.ts';

async function main() {
    // 1. Connect to ComfyUI
    const api = await new ComfyApi('http://localhost:10888').ready();

    // 2. Your workflow (this example bypasses a negative prompt node)
    const workflow = {
        'CHECKPOINT': {
            inputs: { ckpt_name: 'dreamshaper_8.safetensors' },
            class_type: 'CheckpointLoaderSimple'
        },
        'POSITIVE': {
            inputs: { 
                text: 'beautiful landscape',
                clip: ['CHECKPOINT', 1]
            },
            class_type: 'CLIPTextEncode'
        },
        'NEGATIVE': {
            inputs: {
                text: 'ugly, blurry',
                clip: ['CHECKPOINT', 1]
            },
            class_type: 'CLIPTextEncode'
        },
        'LATENT': {
            inputs: { width: 512, height: 512, batch_size: 1 },
            class_type: 'EmptyLatentImage'
        },
        'SAMPLER': {
            inputs: {
                seed: 12345,
                steps: 10,
                cfg: 7.0,
                sampler_name: 'euler',
                scheduler: 'simple',
                denoise: 1.0,
                model: ['CHECKPOINT', 0],
                positive: ['POSITIVE', 0],
                negative: ['NEGATIVE', 0],  // ← This will be removed
                latent_image: ['LATENT', 0]
            },
            class_type: 'KSampler'
        },
        'DECODE': {
            inputs: {
                samples: ['SAMPLER', 0],
                vae: ['CHECKPOINT', 2]
            },
            class_type: 'VAEDecode'
        },
        'SAVE': {
            inputs: {
                filename_prefix: 'test',
                images: ['DECODE', 0]
            },
            class_type: 'SaveImage'
        }
    };

    // 3. Create builder and bypass the negative prompt node
    const builder = new PromptBuilder(workflow as any, [], ['output'])
        .setRawOutputNode('output' as any, 'SAVE')
        .bypass('NEGATIVE');  // ← BYPASS THE NODE!

    console.log('🚀 Running workflow with NEGATIVE prompt node bypassed...\n');

    // 4. Execute
    const wrapper = new CallWrapper(api as any, builder);
    wrapper.onProgress((info) => {
        process.stdout.write(`\r⏳ ${info.value}/${info.max}   `);
    });

    const result: any = await wrapper.run();

    if (result?.output?.images) {
        console.log('\n✅ Success!');
        console.log('Generated:', api.ext.file.getPathImage(result.output.images[0]));
        console.log('\n💡 The NEGATIVE node was completely removed from the workflow');
    }
}

main().catch(console.error);
