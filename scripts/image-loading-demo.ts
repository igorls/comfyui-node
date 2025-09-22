import { ComfyApi, Workflow } from '../src/index.ts';
import Graph from './ImageLoading.json';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/*
  Demo: Loading images in multiple ways
  - LoadImage nodes with fixed filenames (IMAGE_A.png, IMAGE_B.png)
  - LoadImageSetFromFolderNode with a folder (EXAMPLE_IMAGES)
  - PreviewImage nodes to visualize

  This script demonstrates how to:
  - Upload local example images to the server automatically
  - Run the workflow and print preview/info

  Assumptions:
  - We assume the server does NOT already have the images; this script uploads them first.
  - Files are read from scripts/example_images relative to this repo.
*/
const HOST = process.env.COMFY_HOST || 'http://127.0.0.1:8188';
const EX_DIR = path.resolve(process.cwd(), 'scripts', 'example_images');

async function main() {
  const api = await new ComfyApi(HOST).ready();

  const wf = Workflow.from(Graph);

  // 1) Attach individual images for nodes 2 and 4 (LoadImage)
  //    The workflow references IMAGE_A.png and IMAGE_B.png
  const aPath = path.join(EX_DIR, 'fast_00240_.png');
  const bPath = path.join(EX_DIR, 'fast_00245_.png');
  const aBuf = await Bun.file(aPath).arrayBuffer();
  const bBuf = await Bun.file(bPath).arrayBuffer();
  wf.attachImage('2', 'image', aBuf, 'IMAGE_A.png', { override: true })
    .attachImage('4', 'image', bBuf, 'IMAGE_B.png', { override: true });

  // 2) Attach a folder of images for node 5 (LoadImageSetFromFolderNode)
  //    We'll use subfolder name 'EXAMPLE_IMAGES' to match the graph default
  const folderName = 'EXAMPLE_IMAGES';
  const files = await fs.readdir(EX_DIR);
  const folderFiles = files
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .map((f) => ({ fileName: f, data: Bun.file(path.join(EX_DIR, f)).arrayBuffer() }));
  // Resolve array buffers
  const resolved = await Promise.all(
    folderFiles.map(async (f) => ({ fileName: f.fileName, data: await f.data }))
  );
  wf.attachFolderFiles(folderName, resolved, { override: true });
  // Ensure folder input matches our subfolder
  wf.set('5.inputs.folder', folderName);

  // Declare an output so we can confirm something executed; PreviewImage doesn't produce a file,
  // but we can still target it to observe that the node executed.
  wf.output('1'); // PreviewImage node id (arbitrary selection for demonstration)

  const job = await api.run(wf, { autoDestroy: true });

  job.on('progress_pct', (p: number) => process.stdout.write(`\rprogress ${p}%   `));
  job.on('output', (key: string) => console.log(`\nnode output collected: ${key}`));

  const result = await job.done();
  console.log('\nDone. Prompt ID:', result._promptId);
  console.log('Collected nodes:', result._nodes);
}

main().catch((e) => {
  console.error('\nError:', e);
  process.exit(1);
});
