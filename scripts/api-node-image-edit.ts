import path from 'node:path';
import { ComfyApi, Workflow } from '../src/index.ts';
import Seedream4 from './seedream_4_edit.json';

// Minimal Luma/Photon image edit example (requires COMFY_ORG_API_KEY)
const comfyOrgApiKey = process.env.COMFY_ORG_API_KEY;
if (!comfyOrgApiKey) {
    console.error('Please set COMFY_ORG_API_KEY');
    process.exit(1);
}

const EX_DIR = path.resolve(process.cwd(), 'scripts', 'example_images');

const api = await new ComfyApi(process.env.COMFY_HOST || 'http://127.0.0.1:8188', undefined, {
    comfyOrgApiKey,
    wsTimeout: 30000,
}).ready();

const aPath = path.join(EX_DIR, 'fast_00240_.png');
const aBuf = await Bun.file(aPath).arrayBuffer();

const wf = Workflow.fromAugmented(Seedream4)
    .input('1', 'prompt', 'create a photorealistic cinematic portrait of this character, but change her hair to a bright blue color and add stylish sunglasses')
    .input('1', 'seed', -1)
    .attachImage('3', 'image', aBuf, 'fast_00240_.png', { override: true })
    .output('final_images', '2');

// Simple progress + optional API-node text updates
api.on('progress', (ev) => {
    const d: any = (ev as any).detail || {};
    process.stdout.write(`\rprogress ${d.value ?? 0}/${d.max ?? 0}   `);
});

api.on('node_text_update', (ev) => {
    const d: any = (ev as any).detail || {};
    if (d.cleanText) console.log(`\n${d.cleanText}`);
});

try {
    const job = await api.run(wf, { autoDestroy: true });
    const result = await job.done();
    console.log('\nPrompt ID:', result._promptId);
    for (const img of (result.final_images?.images || [])) {
        console.log('image path:', api.ext.file.getPathImage(img));
    }
} catch (e) {
    console.error('\nError:', e);
    process.exit(1);
}