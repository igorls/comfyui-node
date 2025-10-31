import { MultiWorkflowPool } from "src/multipool/multi-workflow-pool.js";
import { Workflow } from "src/multipool/workflow.js";

/**
 * Error Classification Validation Tests
 * 
 * This script validates the error classification logic by intentionally triggering
 * different types of errors from real ComfyUI servers.
 * 
 * Test Cases:
 * 1. Missing Model Error (workflow_incompatibility)
 * 2. Missing Custom Node Error (workflow_incompatibility) 
 * 3. Invalid Input Error (transient)
 * 4. Connection Error (connection)
 */

const pool = new MultiWorkflowPool();

// Add your real ComfyUI servers here
pool.addClient("http://server1:8188", {
  workflowAffinity: [],
  priority: 1
});

pool.addClient("http://server2:8188", {
  workflowAffinity: [],
  priority: 1
});

pool.addClient("http://server3:8188", {
  workflowAffinity: [],
  priority: 1
});

await pool.init();

console.log("\n" + "=".repeat(80));
console.log("ERROR CLASSIFICATION VALIDATION TESTS");
console.log("=".repeat(80) + "\n");

// ============================================================================
// TEST 1: Missing Model Error (should be classified as workflow_incompatibility)
// ============================================================================
async function testMissingModel() {
  console.log("\n📋 TEST 1: Missing Model Error");
  console.log("-".repeat(80));
  
  const workflow = new Workflow({
    "1": {
      "inputs": {
        "text": "beautiful landscape"
      },
      "class_type": "CLIPTextEncode",
      "_meta": {
        "title": "CLIP Text Encode (Prompt)"
      }
    },
    "2": {
      "inputs": {
        "ckpt_name": "this_model_definitely_does_not_exist_anywhere_12345.safetensors"
      },
      "class_type": "CheckpointLoaderSimple",
      "_meta": {
        "title": "Load Checkpoint"
      }
    },
    "3": {
      "inputs": {
        "seed": 12345,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler",
        "scheduler": "normal",
        "denoise": 1.0,
        "model": ["2", 0],
        "positive": ["1", 0],
        "negative": ["1", 0],
        "latent_image": ["4", 0]
      },
      "class_type": "KSampler",
      "_meta": {
        "title": "KSampler"
      }
    },
    "4": {
      "inputs": {
        "width": 512,
        "height": 512,
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage",
      "_meta": {
        "title": "Empty Latent Image"
      }
    },
    "5": {
      "inputs": {
        "samples": ["3", 0],
        "vae": ["2", 2]
      },
      "class_type": "VAEDecode",
      "_meta": {
        "title": "VAE Decode"
      }
    },
    "6": {
      "inputs": {
        "filename_prefix": "ComfyUI",
        "images": ["5", 0]
      },
      "class_type": "SaveImage",
      "_meta": {
        "title": "Save Image"
      }
    }
  });

  try {
    const jobId = await pool.submitJob(workflow);
    console.log(`Submitted job: ${jobId}`);
    const result = await pool.waitForJobCompletion(jobId);
    
    if (result.status === "failed") {
      console.log("✅ Test PASSED: Job failed as expected");
      console.log(`Error classification should be: workflow_incompatibility`);
      console.log(`Actual error:`, result.error);
    } else {
      console.log("❌ Test FAILED: Job should have failed but didn't");
    }
  } catch (error) {
    console.log("❌ Test ERROR:", error);
  }
}

// ============================================================================
// TEST 2: Missing Custom Node Error (should be classified as workflow_incompatibility)
// ============================================================================
async function testMissingCustomNode() {
  console.log("\n📋 TEST 2: Missing Custom Node Error");
  console.log("-".repeat(80));
  
  const workflow = new Workflow({
    "1": {
      "inputs": {
        "some_input": "test"
      },
      "class_type": "NonExistentCustomNode_XYZ_12345",
      "_meta": {
        "title": "This Node Does Not Exist"
      }
    },
    "2": {
      "inputs": {
        "filename_prefix": "test",
        "images": ["1", 0]
      },
      "class_type": "SaveImage",
      "_meta": {
        "title": "Save Image"
      }
    }
  });

  try {
    const jobId = await pool.submitJob(workflow);
    console.log(`Submitted job: ${jobId}`);
    const result = await pool.waitForJobCompletion(jobId);
    
    if (result.status === "failed") {
      console.log("✅ Test PASSED: Job failed as expected");
      console.log(`Error classification should be: workflow_incompatibility`);
      console.log(`Actual error:`, result.error);
    } else {
      console.log("❌ Test FAILED: Job should have failed but didn't");
    }
  } catch (error) {
    console.log("❌ Test ERROR:", error);
  }
}

// ============================================================================
// TEST 3: Invalid Input Error (should be classified as transient)
// ============================================================================
async function testInvalidInput() {
  console.log("\n📋 TEST 3: Invalid Input Error");
  console.log("-".repeat(80));
  
  const workflow = new Workflow({
    "1": {
      "inputs": {
        "width": -999999,  // Negative width should cause validation error
        "height": -999999,  // Negative height should cause validation error
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage",
      "_meta": {
        "title": "Empty Latent Image"
      }
    },
    "2": {
      "inputs": {
        "filename_prefix": "test",
        "images": ["1", 0]
      },
      "class_type": "SaveImage",
      "_meta": {
        "title": "Save Image"
      }
    }
  });

  try {
    const jobId = await pool.submitJob(workflow);
    console.log(`Submitted job: ${jobId}`);
    const result = await pool.waitForJobCompletion(jobId);
    
    if (result.status === "failed") {
      console.log("✅ Test PASSED: Job failed as expected");
      console.log(`Error classification should be: transient`);
      console.log(`Actual error:`, result.error);
    } else {
      console.log("❌ Test FAILED: Job should have failed but didn't");
    }
  } catch (error) {
    console.log("❌ Test ERROR:", error);
  }
}

// ============================================================================
// TEST 4: Connection Error (should be classified as connection)
// ============================================================================
async function testConnectionError() {
  console.log("\n📋 TEST 4: Connection Error");
  console.log("-".repeat(80));
  
  const isolatedPool = new MultiWorkflowPool();
  
  // Add a client that definitely doesn't exist
  isolatedPool.addClient("http://this-server-does-not-exist-12345:8188", {
    workflowAffinity: [],
    priority: 1
  });

  try {
    console.log("Attempting to connect to non-existent server...");
    await isolatedPool.init();
    console.log("❌ Test FAILED: Should have failed to connect");
  } catch (error) {
    console.log("✅ Test PASSED: Connection failed as expected");
    console.log(`Error classification should be: connection`);
    console.log(`Actual error:`, error);
  } finally {
    await isolatedPool.shutdown();
  }
}

// ============================================================================
// TEST 5: Missing LoRA Error (should be classified as workflow_incompatibility)
// ============================================================================
async function testMissingLoRA() {
  console.log("\n📋 TEST 5: Missing LoRA Error");
  console.log("-".repeat(80));
  
  const workflow = new Workflow({
    "1": {
      "inputs": {
        "text": "beautiful landscape"
      },
      "class_type": "CLIPTextEncode",
      "_meta": {
        "title": "CLIP Text Encode"
      }
    },
    "2": {
      "inputs": {
        "ckpt_name": "novaAnimeXL_ilV125.safetensors"  // Use a model that exists on the servers
      },
      "class_type": "CheckpointLoaderSimple",
      "_meta": {
        "title": "Load Checkpoint"
      }
    },
    "3": {
      "inputs": {
        "lora_name": "this_lora_does_not_exist_12345.safetensors",
        "strength_model": 1.0,
        "strength_clip": 1.0,
        "model": ["2", 0],
        "clip": ["2", 1]
      },
      "class_type": "LoraLoader",
      "_meta": {
        "title": "Load LoRA"
      }
    },
    "4": {
      "inputs": {
        "width": 512,
        "height": 512,
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage",
      "_meta": {
        "title": "Empty Latent Image"
      }
    },
    "5": {
      "inputs": {
        "seed": 12345,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler",
        "scheduler": "normal",
        "denoise": 1.0,
        "model": ["3", 0],
        "positive": ["1", 0],
        "negative": ["1", 0],
        "latent_image": ["4", 0]
      },
      "class_type": "KSampler",
      "_meta": {
        "title": "KSampler"
      }
    },
    "6": {
      "inputs": {
        "samples": ["5", 0],
        "vae": ["2", 2]
      },
      "class_type": "VAEDecode",
      "_meta": {
        "title": "VAE Decode"
      }
    },
    "7": {
      "inputs": {
        "filename_prefix": "ComfyUI",
        "images": ["6", 0]
      },
      "class_type": "SaveImage",
      "_meta": {
        "title": "Save Image"
      }
    }
  });

  try {
    const jobId = await pool.submitJob(workflow);
    console.log(`Submitted job: ${jobId}`);
    const result = await pool.waitForJobCompletion(jobId);
    
    if (result.status === "failed") {
      console.log("✅ Test PASSED: Job failed as expected");
      console.log(`Error classification should be: workflow_incompatibility`);
      console.log(`Actual error:`, result.error);
    } else {
      console.log("❌ Test FAILED: Job should have failed but didn't");
    }
  } catch (error) {
    console.log("❌ Test ERROR:", error);
  }
}

// ============================================================================
// Run all tests
// ============================================================================
async function runAllTests() {
  try {
    await testMissingModel();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await testMissingCustomNode();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await testInvalidInput();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await testMissingLoRA();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await testConnectionError();
    
    console.log("\n" + "=".repeat(80));
    console.log("ALL TESTS COMPLETED");
    console.log("=".repeat(80) + "\n");
    
  } catch (error) {
    console.error("Fatal error during tests:", error);
  } finally {
    await pool.shutdown();
    process.exit(0);
  }
}

// Run the tests
runAllTests();
