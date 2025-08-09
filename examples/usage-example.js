#!/usr/bin/env node

// Example usage of the Code Assistant API
const { CoreAgent } = require('../core/Agent');
const { ToolManager } = require('../tools/ToolManager');
const { TaskManager } = require('../workflow/TaskManager');

async function exampleUsage() {
  console.log('🤖 Advanced Code Assistant API Example\n');
  
  // Initialize components
  const agent = new CoreAgent({
    apiKey: process.env.GROQ_API_KEY,
    model: 'llama3-8b-8192'
  });
  
  const toolManager = new ToolManager();
  const taskManager = new TaskManager();
  
  // Set up the agent
  const systemPrompt = `You are a helpful coding assistant.`;
  agent.setSystemPrompt(systemPrompt);
  
  // Register tools
  toolManager.getToolDefinitions().forEach(tool => {
    agent.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.input_schema,
      execute: async (input) => toolManager.executeTool(tool.name, input)
    });
  });
  
  try {
    // Example 1: Simple code generation
    console.log('📝 Generating a utility function...');
    const response1 = await agent.processMessage(
      'Create a JavaScript function that validates email addresses'
    );
    console.log('Response:', response1.content);
    
    // Example 2: File analysis
    console.log('\n🔍 Analyzing a file...');
    const response2 = await agent.processMessage(
      'Read and analyze the package.json file'
    );
    console.log('Analysis:', response2.content);
    
    // Example 3: Workflow execution
    console.log('\n🔄 Starting a workflow...');
    const task = taskManager.startWorkflow(
      'code-generation', 
      'Build a user authentication system'
    );
    console.log('Workflow started:', task.title);
    
    // Show final metrics
    console.log('\n📊 Performance Metrics:');
    console.log(agent.getMetrics());
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run the example
if (require.main === module) {
  exampleUsage().catch(console.error);
}

module.exports = { exampleUsage };
