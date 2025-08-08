const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class ProjectSetup {
  async run() {
    console.log(chalk.blue('🚀 Setting up Advanced Code Assistant...\n'));
    
    try {
      await this.createDirectories();
      await this.createConfigFiles();
      await this.createExampleFiles();
      await this.setPermissions();
      
      console.log(chalk.green('\n✅ Setup completed successfully!'));
      console.log(chalk.yellow('\n📖 Next steps:'));
      console.log('1. Set your Anthropic API key: export ANTHROPIC_API_KEY="your_key"');
      console.log('2. Start with: codeassistant chat');
      console.log('3. Or analyze a project: codeassistant analyze');
      
    } catch (error) {
      console.error(chalk.red(`Setup failed: ${error.message}`));
      process.exit(1);
    }
  }
  
  async createDirectories() {
    const dirs = [
      'core',
      'prompts',
      'tools', 
      'tools/custom',
      'workflow',
      'cli',
      'scripts',
      'tests',
      'tests/unit',
      'tests/integration',
      'docs',
      'examples',
      '.sessions'
    ];
    
    console.log(chalk.blue('📁 Creating directory structure...'));
    
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
      console.log(chalk.gray(`  Created: ${dir}/`));
    }
  }
  
  async createConfigFiles() {
    console.log(chalk.blue('\n⚙️ Creating configuration files...'));
    
    // ESLint config
    const eslintConfig = {
      env: {
        node: true,
        es2021: true,
        jest: true
      },
      extends: ['standard'],
      parserOptions: {
        ecmaVersion: 12,
        sourceType: 'module'
      },
      rules: {
        'no-console': 'off',
        'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
      }
    };
    
    await fs.writeFile('.eslintrc.json', JSON.stringify(eslintConfig, null, 2));
    console.log(chalk.gray('  Created: .eslintrc.json'));
    
    // Jest config
    const jestConfig = {
      testEnvironment: 'node',
      collectCoverageFrom: [
        'core/**/*.js',
        'prompts/**/*.js', 
        'tools/**/*.js',
        'workflow/**/*.js',
        '!**/node_modules/**'
      ],
      coverageDirectory: 'coverage',
      coverageReporters: ['text', 'lcov', 'html'],
      testMatch: ['**/tests/**/*.test.js']
    };
    
    await fs.writeFile('jest.config.json', JSON.stringify(jestConfig, null, 2));
    console.log(chalk.gray('  Created: jest.config.json'));
    
    // JSDoc config
    const jsdocConfig = {
      source: {
        include: ['./core', './prompts', './tools', './workflow', './cli'],
        includePattern: '\\.(js)$',
        exclude: ['node_modules/']
      },
      opts: {
        destination: './docs/'
      },
      plugins: ['plugins/markdown']
    };
    
    await fs.writeFile('jsdoc.conf.json', JSON.stringify(jsdocConfig, null, 2));
    console.log(chalk.gray('  Created: jsdoc.conf.json'));
    
    // Default config
    const defaultConfig = {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4000,
      temperature: 0.1,
      safeMode: true,
      autoSave: true,
      preferredLanguage: 'javascript',
      testingFramework: 'jest',
      codeStyle: 'modern'
    };
    
    await fs.writeFile('.codeassistant.json', JSON.stringify(defaultConfig, null, 2));
    console.log(chalk.gray('  Created: .codeassistant.json'));
    
    // Environment template
    const envTemplate = `# Anthropic API Configuration
ANTHROPIC_API_KEY=your_api_key_here

# Optional: Custom API base URL
# ANTHROPIC_BASE_URL=https://api.anthropic.com/v1/messages

# Optional: Debug settings
# DEBUG=codeassistant:*
# VERBOSE=true
`;
    
    await fs.writeFile('.env.example', envTemplate);
    console.log(chalk.gray('  Created: .env.example'));
    
    // .gitignore
    const gitignore = `# Dependencies
node_modules/
npm-debug.log*

# Environment variables
.env
.env.local

# Sessions (may contain sensitive data)
.sessions/

# Logs
*.log
logs/

# Coverage
coverage/

# Build outputs
dist/
build/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Temporary files
*.tmp
*.temp
`;
    
    await fs.writeFile('.gitignore', gitignore);
    console.log(chalk.gray('  Created: .gitignore'));
  }
  
  async createExampleFiles() {
    console.log(chalk.blue('\n📋 Creating example files...'));
    
    // Example custom tool
    const customToolExample = `// Example custom tool
class ExampleTool {
  constructor(config) {
    this.config = config;
    this.description = "An example custom tool that demonstrates the tool interface";
    this.inputSchema = {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Message to process"
        },
        options: {
          type: "object",
          properties: {
            uppercase: { type: "boolean", default: false }
          }
        }
      },
      required: ["message"]
    };
  }
  
  async execute(input) {
    const { message, options = {} } = input;
    
    let result = message;
    
    if (options.uppercase) {
      result = result.toUpperCase();
    }
    
    return {
      success: true,
      originalMessage: message,
      processedMessage: result,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ExampleTool;
`;
    
    await fs.writeFile('examples/custom-tool.js', customToolExample);
    console.log(chalk.gray('  Created: examples/custom-tool.js'));
    
    // Example workflow
    const workflowExample = `// Example custom workflow
const { WorkflowBuilder } = require('../workflow/TaskManager');

function createCustomWorkflow() {
  return new WorkflowBuilder()
    .setName('API Development Workflow')
    .setDescription('Complete workflow for building REST APIs')
    .addStep('design', 'Design API endpoints', true)
    .addStep('models', 'Create data models', true)
    .addStep('controllers', 'Implement controllers', true)
    .addStep('middleware', 'Add middleware', false)
    .addStep('tests', 'Write tests', true)
    .addStep('docs', 'Generate documentation', false)
    .setMetadata('category', 'backend')
    .setMetadata('difficulty', 'intermediate')
    .build();
}

module.exports = { createCustomWorkflow };
`;
    
    await fs.writeFile('examples/custom-workflow.js', workflowExample);
    console.log(chalk.gray('  Created: examples/custom-workflow.js'));
    
    // Example usage script
    const usageExample = `#!/usr/bin/env node

// Example usage of the Code Assistant API
const { CoreAgent } = require('../core/Agent');
const { ToolManager } = require('../tools/ToolManager');
const { TaskManager } = require('../workflow/TaskManager');

async function exampleUsage() {
  console.log('🤖 Advanced Code Assistant API Example\\n');
  
  // Initialize components
  const agent = new CoreAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-20250514'
  });
  
  const toolManager = new ToolManager();
  const taskManager = new TaskManager();
  
  // Set up the agent
  const systemPrompt = \`You are a helpful coding assistant.\`;
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
    console.log('\\n🔍 Analyzing a file...');
    const response2 = await agent.processMessage(
      'Read and analyze the package.json file'
    );
    console.log('Analysis:', response2.content);
    
    // Example 3: Workflow execution
    console.log('\\n🔄 Starting a workflow...');
    const task = taskManager.startWorkflow(
      'code-generation', 
      'Build a user authentication system'
    );
    console.log('Workflow started:', task.title);
    
    // Show final metrics
    console.log('\\n📊 Performance Metrics:');
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
`;
    
    await fs.writeFile('examples/usage-example.js', usageExample);
    console.log(chalk.gray('  Created: examples/usage-example.js'));
    
    // Contributing guide
    const contributing = `# Contributing to Advanced Code Assistant

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

1. Fork the repository
2. Clone your fork: \`git clone https://github.com/yourusername/advanced-code-assistant.git\`
3. Install dependencies: \`npm install\`
4. Set up your API key: \`export ANTHROPIC_API_KEY="your_key"\`
5. Run tests: \`npm test\`

## Project Structure

\`\`\`
├── core/           # Core agent logic
├── prompts/        # Prompt engineering system
├── tools/          # Tool implementations
├── workflow/       # Task and workflow management
├── cli/            # Command-line interface
├── tests/          # Test suites
├── examples/       # Usage examples
└── docs/           # Documentation
\`\`\`

## Adding New Features

### Custom Tools
1. Create tool in \`tools/custom/\`
2. Implement required interface
3. Add tests in \`tests/unit/tools/\`
4. Update documentation

### New Workflows
1. Define workflow in \`workflow/workflows/\`
2. Add to default workflows
3. Test workflow execution
4. Document usage

### Prompt Improvements
1. Modify prompts in \`prompts/\`
2. Test with various scenarios
3. Measure performance impact
4. Update prompt documentation

## Testing Guidelines

- Write tests for all new functionality
- Maintain test coverage above 80%
- Use descriptive test names
- Test edge cases and error conditions

## Code Style

- Follow ESLint configuration
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Keep functions focused and small

## Pull Request Process

1. Create feature branch: \`git checkout -b feature/amazing-feature\`
2. Make your changes with tests
3. Run full test suite: \`npm test\`
4. Update documentation if needed
5. Commit with conventional messages
6. Push and create Pull Request

## Reporting Issues

- Use the issue template
- Provide reproduction steps
- Include environment details
- Add relevant logs/output

## Questions?

- Open a discussion on GitHub
- Join our Discord community
- Email: contribute@your-domain.com
`;
    
    await fs.writeFile('CONTRIBUTING.md', contributing);
    console.log(chalk.gray('  Created: CONTRIBUTING.md'));
    
    // License
    const license = `MIT License

Copyright (c) 2024 Advanced Code Assistant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
    
    await fs.writeFile('LICENSE', license);
    console.log(chalk.gray('  Created: LICENSE'));
  }
  
  async setPermissions() {
    console.log(chalk.blue('\\n🔒 Setting file permissions...'));
    
    try {
      // Make CLI executable
      await fs.chmod('cli/main.js', 0o755);
      console.log(chalk.gray('  Set executable: cli/main.js'));
      
      // Make examples executable
      await fs.chmod('examples/usage-example.js', 0o755);
      console.log(chalk.gray('  Set executable: examples/usage-example.js'));
      
    } catch (error) {
      console.log(chalk.yellow('  ⚠️  Could not set permissions (this is okay on Windows)'));
    }
  }
}

// Run setup if called directly
if (require.main === module) {
  const setup = new ProjectSetup();
  setup.run().catch(console.error);
}

module.exports = ProjectSetup;