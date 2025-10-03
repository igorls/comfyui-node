/**
 * Fix ComfyUI-Manager stderr.flush() Bug on Windows
 * --------------------------------------------------
 * 
 * This script patches the comfyui-manager to handle Windows OSError
 * during stderr.flush() operations.
 */

export {}; // Make this a module

console.log('🔧 Patching comfyui-manager for Windows stderr.flush() bug...\n');

const filePath = 'C:\\ComfyUI\\custom_nodes\\comfyui-manager\\prestartup_script.py';

try {
    // Read the file
    const content = await Bun.file(filePath).text();
    
    // Apply the fix - wrap all original_stderr.flush() calls in try-except
    const patched = content.replace(
        /(\s+)(original_stderr\.flush\(\))/g,
        `$1try:\n$1    $2\n$1except OSError:\n$1    pass  # Ignore Windows stderr flush errors`
    );
    
    if (content === patched) {
        console.log('⚠️  No changes needed - file may already be patched or pattern not found');
        process.exit(0);
    }
    
    // Backup original
    const backupPath = filePath + '.backup';
    await Bun.write(backupPath, content);
    console.log(`✓ Created backup: ${backupPath}`);
    
    // Write patched version
    await Bun.write(filePath, patched);
    console.log(`✓ Patched: ${filePath}\n`);
    
    console.log('✅ Fix applied successfully!');
    console.log('\n⚠️  IMPORTANT: Restart ComfyUI for changes to take effect\n');
    
} catch (err: any) {
    console.error('\n❌ Failed to patch file:', err.message);
    console.error('\nYou may need to run this script as administrator or manually edit:');
    console.error(`  ${filePath}\n`);
    console.error('Manual fix: Wrap all "original_stderr.flush()" calls in try-except:');
    console.error('  try:');
    console.error('      original_stderr.flush()');
    console.error('  except OSError:');
    console.error('      pass  # Ignore Windows stderr flush errors\n');
    process.exit(1);
}
