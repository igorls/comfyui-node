#!/usr/bin/env bun

/**
 * Script to update sampler and scheduler types from the official ComfyUI repository
 * 
 * This script fetches the latest sampler names from:
 * https://github.com/comfyanonymous/ComfyUI/blob/master/comfy/samplers.py
 * 
 * And updates the TSamplerName and TSchedulerName types in src/types/sampler.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

async function updateSamplerTypes() {
  console.log("Fetching latest sampler names from ComfyUI repository...");
  
  try {
    // Fetch the samplers.py file from the ComfyUI repository
    const response = await fetch("https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy/samplers.py");
    
    if (!response.ok) {
      throw new Error(`Failed to fetch samplers.py: ${response.status} ${response.statusText}`);
    }
    
    const content = await response.text();
    
    // Extract KSAMPLER_NAMES
    const ksamplerNamesMatch = content.match(/KSAMPLER_NAMES\s*=\s*\[([^\]]+)\]/s);
    if (!ksamplerNamesMatch) {
      throw new Error("Could not find KSAMPLER_NAMES in samplers.py");
    }
    
    // Extract SAMPLER_NAMES (which includes KSAMPLER_NAMES + additional samplers)
    const samplerNamesMatch = content.match(/SAMPLER_NAMES\s*=\s*KSAMPLER_NAMES\s*\+\s*\[([^\]]+)\]/);
    if (!samplerNamesMatch) {
      throw new Error("Could not find SAMPLER_NAMES in samplers.py");
    }
    
    // Extract SCHEDULER_NAMES
    const schedulerNamesMatch = content.match(/SCHEDULER_NAMES\s*=\s*list\(([^\)]+)\)/);
    if (!schedulerNamesMatch) {
      throw new Error("Could not find SCHEDULER_NAMES in samplers.py");
    }
    
    // Parse KSAMPLER_NAMES
    const ksamplerNames = parseNameList(ksamplerNamesMatch[1]);
    
    // Parse additional samplers in SAMPLER_NAMES
    const additionalSamplers = parseNameList(samplerNamesMatch[1]);
    
    // Combine all sampler names
    const allSamplerNames = [...ksamplerNames, ...additionalSamplers];
    
    // Parse SCHEDULER_HANDLERS to get scheduler names
    const schedulerHandlersMatch = content.match(/SCHEDULER_HANDLERS\s*=\s*\{([^}]+)\}/s);
    if (!schedulerHandlersMatch) {
      throw new Error("Could not find SCHEDULER_HANDLERS in samplers.py");
    }
    
    const schedulerNames = parseSchedulerNames(schedulerHandlersMatch[1]);
    
    console.log("Found sampler names:", allSamplerNames);
    console.log("Found scheduler names:", schedulerNames);
    
    // Update src/types/sampler.ts
    const samplerTsPath = join("src", "types", "sampler.ts");
    let samplerTsContent = readFileSync(samplerTsPath, "utf-8");
    
    // Update TSamplerName
    const samplerNameRegex = /export type TSamplerName =[^;]+;/s;
    const samplerNameReplacement = `export type TSamplerName =\n  ${allSamplerNames.map(name => `| "${name}"`).join("\n  ")};`;
    samplerTsContent = samplerTsContent.replace(samplerNameRegex, samplerNameReplacement);
    
    // Update TSchedulerName
    const schedulerNameRegex = /export type TSchedulerName =[^;]+;/s;
    const schedulerNameReplacement = `export type TSchedulerName = \n  ${schedulerNames.map(name => `| "${name}"`).join("\n  ")};`;
    samplerTsContent = samplerTsContent.replace(schedulerNameRegex, schedulerNameReplacement);
    
    // Write the updated content back to the file
    writeFileSync(samplerTsPath, samplerTsContent);
    
    console.log("Successfully updated src/types/sampler.ts with latest sampler and scheduler names!");
  } catch (error) {
    console.error("Error updating sampler types:", error);
    process.exit(1);
  }
}

/**
 * Parse a list of names from the Python array format
 * @param listContent - The content of the Python list
 * @returns Array of parsed names
 */
function parseNameList(listContent: string): string[] {
  // Remove line breaks and extra spaces
  const cleaned = listContent.replace(/\s+/g, " ").trim();
  
  // Extract quoted strings
  const matches = cleaned.match(/"([^"]+)"|'([^']+)'/g);
  
  if (!matches) {
    return [];
  }
  
  // Remove quotes from each match
  return matches.map(match => match.slice(1, -1));
}

/**
 * Parse scheduler names from the SCHEDULER_HANDLERS object
 * @param handlersContent - The content of the SCHEDULER_HANDLERS object
 * @returns Array of scheduler names
 */
function parseSchedulerNames(handlersContent: string): string[] {
  // Extract keys from the object (scheduler names)
  const matches = handlersContent.match(/"([^"]+)"\s*:/g);
  
  if (!matches) {
    return [];
  }
  
  // Remove quotes and colon from each match
  return matches.map(match => match.slice(1, -2));
}

// Run the script
updateSamplerTypes();
