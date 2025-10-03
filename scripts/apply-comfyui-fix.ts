/**
 * Complete ComfyUI-Manager Fix for Windows
 * -----------------------------------------
 * This script applies the fix AND clears Python cache to ensure it takes effect.
 */

export {};

console.log('🔧 Applying complete fix for ComfyUI-Manager...\n');

const managerPath = 'C:\\ComfyUI\\custom_nodes\\comfyui-manager';
const scriptPath = `${managerPath}\\prestartup_script.py`;
const cachePath = `${managerPath}\\__pycache__`;

try {
    // Step 1: Apply the patch
    console.log('📝 Step 1: Patching prestartup_script.py...');
    const content = await Bun.file(scriptPath).text();
    
    const patched = content.replace(
        /(\s+)(original_stderr\.flush\(\))/g,
        `$1try:\n$1    $2\n$1except OSError:\n$1    pass  # Ignore Windows stderr flush errors`
    );
    
    if (content === patched) {
        console.log('   ℹ️  Already patched\n');
    } else {
        const backupPath = scriptPath + '.backup';
        await Bun.write(backupPath, content);
        await Bun.write(scriptPath, patched);
        console.log('   ✓ Patched successfully\n');
    }
    
    // Step 2: Clear Python cache
    console.log('📝 Step 2: Clearing Python bytecode cache...');
    try {
        await Bun.$`rm -rf "${cachePath}"`.quiet();
        console.log('   ✓ Cache cleared\n');
    } catch {
        console.log('   ℹ️  No cache to clear\n');
    }
    
    console.log('✅ Fix applied successfully!\n');
    console.log('⚠️  CRITICAL: You MUST restart ComfyUI for changes to take effect:');
    console.log('   1. Close ComfyUI completely');
    console.log('   2. Wait 5 seconds');
    console.log('   3. Restart ComfyUI');
    console.log('   4. Wait for it to fully load');
    console.log('   5. Then run: bun run scripts/test-simple-txt2img.ts\n');
    
} catch (err: any) {
    console.error('\n❌ Failed:', err.message);
    process.exit(1);
}
