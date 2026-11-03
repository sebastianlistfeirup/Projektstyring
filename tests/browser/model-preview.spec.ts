import { expect, test } from '@playwright/test';

// A complete, tiny glTF triangle exercises the actual bundled 3D renderer.
function triangleGlb(): Buffer {
  const positions = Buffer.alloc(36);
  [-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const indices = Buffer.alloc(8);
  [0, 1, 2].forEach((value, index) => indices.writeUInt16LE(value, index * 2));
  const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: 44 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }, { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }] };
  const json = Buffer.from(JSON.stringify(gltf).padEnd(Math.ceil(JSON.stringify(gltf).length / 4) * 4, ' '));
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + 44, 8);
  jsonHeader.writeUInt32LE(json.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(44); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binHeader, positions, indices]);
}

test('GLB preview loads only when opened and stays usable in the merged workspace', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('orbit-toured', '1'));
  await page.route('http://127.0.0.1:4310/api/ai/file/orbit-triangle.glb', route => route.fulfill({ status: 200, body: triangleGlb(), contentType: 'model/gltf-binary', headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.goto('/#/chat');
  await expect(page.getByRole('region', { name: 'Orbit Live' })).toBeVisible();
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this component to the browser for the isolated fixture.
    const { default: Gallery } = await import('/src/components/VisualResultGallery.tsx');
    // @ts-expect-error Vite prebundles React for the local browser test.
    const reactModule = await import('/node_modules/.vite/deps/react.js');
    // @ts-expect-error Vite prebundles React DOM for the local browser test.
    const domModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const React = reactModule.default ?? reactModule;
    const createRoot = domModule.createRoot ?? domModule.default.createRoot;
    const host = document.querySelector('.orbit-live-pane .orbit-pane-content') as HTMLElement;
    (host.firstElementChild as HTMLElement).style.display = 'none';
    const mount = document.createElement('div'); mount.style.cssText = 'height:100%;overflow:auto;padding:14px'; host.appendChild(mount);
    createRoot(mount).render(React.createElement(Gallery, { run: { jobs: [{ id: 'fixture-model', title: '3D-model til gennemgang', status: 'done', notes: [], artifacts: [
      { kind: 'file', name: 'orbit-triangle.glb', mime: 'model/gltf-binary', url: '/api/ai/file/orbit-triangle.glb' },
      { kind: 'file', name: 'legacy-model.fbx', mime: 'model/fbx', url: '/api/ai/file/legacy-model.fbx' },
    ], media: { state: 'completed' } }], results: [] } }));
  });
  const gallery = page.getByRole('region', { name: 'Leverancer og medieproduktion' });
  await expect(gallery.getByRole('button', { name: 'Vis 3D-model' })).toBeVisible();
  await expect(gallery.getByRole('button', { name: 'Vis 3D-model' })).toHaveCount(1);
  await expect(gallery.getByRole('link', { name: 'Hent 3D-fil' })).toHaveAttribute('href', /legacy-model\.fbx$/);
  expect(await page.locator('model-viewer').count()).toBe(0);
  await gallery.getByRole('button', { name: 'Vis 3D-model' }).click();
  await expect(gallery.getByText('Træk for at dreje.')).toBeVisible();
  await expect(page.locator('model-viewer')).toHaveAttribute('camera-controls', '');
  await expect(gallery.getByRole('link', { name: 'Hent originalfil' })).toHaveAttribute('href', /orbit-triangle\.glb$/);
  await page.screenshot({ path: testInfo.outputPath('merged-workspace-3d.png'), fullPage: true });
});
