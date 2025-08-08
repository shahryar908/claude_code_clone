#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const fs = require('fs').promises;
const path = require('path');

const CoreAgent = require('../core/Agent');
const PromptManager = require('../prompts/PromptManager');
const ToolManager = require('../tools/ToolManager');
const { TaskManager, WorkflowBuilder } = require('../workflow/TaskManager');

class CodeAssistantCLI {
  constructor() {
    this.agent = null;
    this.promptManager = new PromptManager();
    this.toolManager = new ToolManager();
    this.taskManager = new TaskManager();
    this.config = {};
    this.sessionActive = false;
    
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    // Task manager events
    this.taskManager.on('workflow:started', (data) => {
      console.log(chalk.blue(`🚀 Started workflow: ${data.workflow.name}`));
    });
    
    this.taskManager.on('task:completed', (data) => {
      console.log(chalk.green(`✅ Completed: ${data.task.title}`));
    });
    
    this.taskManager.on('workflow:completed', (data) => {
      console.log(chalk.green(`🎉 Workflow completed in ${data.duration}ms`));
    });
    
    // Agent events
    process.on('SIGINT', () => {
      this.shutdown();
    });
  }
  
  async initialize() {
    try {
      // Load configuration
      await this.loadConfig();
      
      // Initialize agent
      this.agent = new CoreAgent(this.config);
      
      // Set up system prompt
      const systemPrompt = this.promptManager.getMainSystemPrompt();
      this.agent.setSystemPrompt(systemPrompt);
      
      // Register tools
      this.registerTools();
      
      console.log(chalk.green('🤖 Code Assistant initialized successfully!'));
      
    } catch (error) {
      console.error(chalk.red(`Failed to initialize: ${error.message}`));
      process.exit(1);
    }
  }
  
  async loadConfig() {
    const configPaths = [
      path.join(process.cwd(), '.codeassistant.json'),
      path.join(require('os').homedir(), '.codeassistant.json')
    ];
    
    for (const configPath of configPaths) {
      try {
        const configData = await fs.readFile(configPath, 'utf8');
        this.config = { ...this.config, ...JSON.parse(configData) };
        console.log(chalk.blue(`📋 Loaded config from ${configPath}`));
        break;
      } catch (error) {
        // Config file doesn't exist, continue
      }
    }
    
    // Set defaults
    this.config = {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4000,
      temperature: 0.1,
      safeMode: true,
      autoSave: true,
      ...this.config
    };
    
    // Check for API key
    if (!this.config.apiKey && !process.env.GROQ_API_KEY) {
      console.error(chalk.red('❌ GROQ_API_KEY not found in environment or config'));
      process.exit(1);
    }
    
    this.config.apiKey = this.config.apiKey || process.env.GROQ_API_KEY;
  }
  
  registerTools() {
    // Get tools from tool manager
    const tools = this.toolManager.getToolDefinitions();
    
    tools.forEach(tool => {
      this.agent.registerTool(tool.name, {
        description: tool.description,
        inputSchema: tool.input_schema,
        execute: async (input) => {
          return await this.toolManager.executeTool(tool.name, input);
        }
      });
    });
    
    console.log(chalk.blue(`🔧 Registered ${tools.length} tools`));
  }
  
  async chat() {
    console.log(chalk.green('\n💬 Entering chat mode. Type "exit" to quit, "help" for commands.\n'));
    
    this.sessionActive = true;
    
    while (this.sessionActive) {
      try {
        const { input } = await inquirer.prompt([
          {
            type: 'input',
            name: 'input',
            message: chalk.yellow('You:'),
            prefix: ''
          }
        ]);
        
        if (input.toLowerCase() === 'exit') {
          break;
        }
        
        if (input.toLowerCase() === 'help') {
          this.showChatHelp();
          continue;
        }
        
        if (input.toLowerCase().startsWith('/')) {
          await this.handleCommand(input);
          continue;
        }
        
        if (!input.trim()) {
          continue;
        }
        
        const spinner = ora('🤔 Thinking...').start();
        
        try {
          const response = await this.agent.processMessage(input);
          spinner.stop();
          
          console.log(chalk.green('\n🤖 Assistant:'));
          console.log(response.content);
          
          // Show progress if there's an active workflow
          const progress = this.taskManager.formatProgressDisplay();
          if (progress !== 'No active tasks or workflows') {
            console.log(progress);
          }
          
        } catch (error) {
          spinner.stop();
          console.error(chalk.red(`Error: ${error.message}`));
        }
        
      } catch (error) {
        if (error.isTtyError) {
          console.log(chalk.red('Chat mode not available in this environment'));
          break;
        }
        console.error(chalk.red(`Chat error: ${error.message}`));
      }
    }
    
    console.log(chalk.blue('👋 Chat session ended'));
  }
  
  showChatHelp() {
    console.log(chalk.cyan(`
📖 Chat Commands:
  /progress     - Show current task progress
  /workflows    - List available workflows
  /tools        - List available tools
  /metrics      - Show performance metrics
  /clear        - Clear conversation history
  /save [name]  - Save current session
  /load [name]  - Load saved session
  /config       - Show current configuration
  help          - Show this help
  exit          - Exit chat mode
`));
  }
  
  async handleCommand(command) {
    const [cmd, ...args] = command.slice(1).split(' ');
    
    switch (cmd) {
      case 'progress':
        const progress = this.taskManager.formatProgressDisplay();
        console.log(progress);
        break;
        
      case 'workflows':
        this.showWorkflows();
        break;
        
      case 'tools':
        this.showTools();
        break;
        
      case 'metrics':
        this.showMetrics();
        break;
        
      case 'clear':
        this.agent.clearHistory();
        console.log(chalk.blue('🧹 Conversation history cleared'));
        break;
        
      case 'save':
        const sessionName = args[0] || `session_${Date.now()}`;
        await this.saveSession(sessionName);
        break;
        
      case 'load':
        if (args[0]) {
          await this.loadSession(args[0]);
        } else {
          console.log(chalk.red('Please specify a session name'));
        }
        break;
        
      case 'config':
        this.showConfig();
        break;
        
      default:
        console.log(chalk.red(`Unknown command: ${cmd}`));
    }
  }
  
  showWorkflows() {
    console.log(chalk.cyan('\n📋 Available Workflows:'));
    this.taskManager.workflows.forEach((workflow, id) => {
      console.log(chalk.blue(`  ${id}: ${workflow.name}`));
      console.log(chalk.gray(`    ${workflow.description}`));
      console.log(chalk.gray(`    Steps: ${workflow.steps.length}`));
    });
  }
  
  showTools() {
    console.log(chalk.cyan('\n🔧 Available Tools:'));
    this.toolManager.tools.forEach((tool, name) => {
      console.log(chalk.blue(`  ${name}: ${tool.description}`));
    });
  }
  
  showMetrics() {
    const agentMetrics = this.agent.getMetrics();
    const toolMetrics = this.toolManager.getToolMetrics();
    const taskMetrics = this.taskManager.getTaskAnalytics();
    
    console.log(chalk.cyan('\n📊 Performance Metrics:'));
    console.log(chalk.blue('Agent:'));
    console.log(`  Total Requests: ${agentMetrics.totalRequests}`);
    console.log(`  Success Rate: ${agentMetrics.successRate.toFixed(1)}%`);
    console.log(`  Avg Response Time: ${agentMetrics.averageResponseTime.toFixed(0)}ms`);
    
    console.log(chalk.blue('\nTasks:'));
    console.log(`  Total Tasks: ${taskMetrics.totalTasks}`);
    console.log(`  Completed: ${taskMetrics.completedTasks}`);
    console.log(`  In Progress: ${taskMetrics.inProgressTasks}`);
    
    console.log(chalk.blue('\nTop Tools:'));
    Object.entries(toolMetrics)
      .sort(([,a], [,b]) => b.usageCount - a.usageCount)
      .slice(0, 5)
      .forEach(([name, metrics]) => {
        console.log(`  ${name}: ${metrics.usageCount} uses (${(metrics.successCount/metrics.usageCount*100).toFixed(1)}% success)`);
      });
  }
  
  showConfig() {
    console.log(chalk.cyan('\n⚙️ Current Configuration:'));
    const safeConfig = { ...this.config };
    if (safeConfig.apiKey) {
      safeConfig.apiKey = safeConfig.apiKey.substring(0, 8) + '...';
    }
    console.log(JSON.stringify(safeConfig, null, 2));
  }
  
  async saveSession(name) {
    try {
      const session = this.agent.saveSession(name);
      const sessionData = {
        ...session,
        tasks: this.taskManager.exportTasks(),
        timestamp: Date.now()
      };
      
      const sessionsDir = path.join(process.cwd(), '.sessions');
      await fs.mkdir(sessionsDir, { recursive: true });
      
      const sessionPath = path.join(sessionsDir, `${name}.json`);
      await fs.writeFile(sessionPath, JSON.stringify(sessionData, null, 2));
      
      console.log(chalk.green(`💾 Session saved: ${sessionPath}`));
    } catch (error) {
      console.error(chalk.red(`Failed to save session: ${error.message}`));
    }
  }
  
  async loadSession(name) {
    try {
      const sessionPath = path.join(process.cwd(), '.sessions', `${name}.json`);
      const sessionData = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
      
      this.agent.loadSession(sessionData);
      if (sessionData.tasks) {
        this.taskManager.importTasks(sessionData.tasks);
      }
      
      console.log(chalk.green(`📂 Session loaded: ${name}`));
    } catch (error) {
      console.error(chalk.red(`Failed to load session: ${error.message}`));
    }
  }
  
  async analyzeProject(projectPath = '.') {
    console.log(chalk.blue(`🔍 Analyzing project at ${projectPath}...`));
    
    const spinner = ora('Scanning files...').start();
    
    try {
      // Get project structure
      const files = await this.toolManager.executeTool('list_files', {
        directory_path: projectPath,
        recursive: true,
        file_extensions: ['.js', '.ts', '.jsx', '.tsx', '.json', '.md']
      });
      
      spinner.text = 'Analyzing code structure...';
      
      // Analyze key files
      const analysis = {
        structure: files,
        packageInfo: null,
        mainFiles: [],
        codeQuality: {}
      };
      
      // Check for package.json
      const packageFile = files.files.find(f => f.name === 'package.json');
      if (packageFile) {
        const packageContent = await this.toolManager.executeTool('read_file', {
          file_path: packageFile.path
        });
        analysis.packageInfo = JSON.parse(packageContent.content);
      }
      
      // Analyze main code files
      const codeFiles = files.files.filter(f => 
        ['.js', '.ts', '.jsx', '.tsx'].includes(f.extension)
      ).slice(0, 10); // Limit to first 10 files
      
      for (const file of codeFiles) {
        spinner.text = `Analyzing ${file.name}...`;
        
        const codeAnalysis = await this.toolManager.executeTool('analyze_code', {
          file_path: file.path,
          analysis_type: 'all'
        });
        
        analysis.codeQuality[file.name] = codeAnalysis.analysis;
      }
      
      spinner.stop();
      
      // Generate report
      await this.generateProjectReport(analysis);
      
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`Analysis failed: ${error.message}`));
    }
  }
  
  async generateProjectReport(analysis) {
    console.log(chalk.green('\n📊 Project Analysis Report'));
    console.log('='.repeat(50));
    
    // Project overview
    console.log(chalk.blue('\n🏗️ Project Structure:'));
    console.log(`Total files: ${analysis.structure.files.length}`);
    
    const fileTypes = analysis.structure.files.reduce((acc, file) => {
      acc[file.extension] = (acc[file.extension] || 0) + 1;
      return acc;
    }, {});
    
    Object.entries(fileTypes).forEach(([ext, count]) => {
      console.log(`  ${ext || 'no extension'}: ${count} files`);
    });
    
    // Package info
    if (analysis.packageInfo) {
      console.log(chalk.blue('\n📦 Package Information:'));
      console.log(`Name: ${analysis.packageInfo.name}`);
      console.log(`Version: ${analysis.packageInfo.version}`);
      console.log(`Dependencies: ${Object.keys(analysis.packageInfo.dependencies || {}).length}`);
    }
    
    // Code quality summary
    console.log(chalk.blue('\n🔍 Code Quality Summary:'));
    const qualityScores = Object.values(analysis.codeQuality)
      .map(q => q.quality?.maintainabilityIndex || 0);
    
    if (qualityScores.length > 0) {
      const avgQuality = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length;
      console.log(`Average Maintainability Index: ${avgQuality.toFixed(1)}/100`);
    }
    
    // Recommendations
    console.log(chalk.blue('\n💡 Recommendations:'));
    console.log('• Run tests regularly to ensure code quality');
    console.log('• Consider adding documentation for complex functions');
    console.log('• Use consistent coding patterns across the project');
  }
  
  async generateCode(description, options) {
    console.log(chalk.blue(`🔨 Generating ${options.language} code...`));
    
    const workflowId = options.workflow || 'code-generation';
    const task = this.taskManager.startWorkflow(workflowId, `Generate: ${description}`);
    
    const spinner = ora('Analyzing requirements...').start();
    
    try {
      // Step 1: Analyze requirements
      spinner.text = 'Analyzing requirements...';
      this.taskManager.updateTaskProgress(task.subtasks[0], 50, 'in-progress');
      
      const prompt = `Generate ${options.language} code for: ${description}
      
Please follow these requirements:
- Write clean, maintainable code
- Include appropriate error handling
- Add comments for complex logic
- Follow ${options.language} best practices
- Ensure code is production-ready`;

      const response = await this.agent.processMessage(prompt);
      
      this.taskManager.completeTask(task.subtasks[0]);
      
      // Step 2: Generate code
      spinner.text = 'Generating code...';
      this.taskManager.updateTaskProgress(task.subtasks[2], 100, 'completed');
      
      spinner.stop();
      
      console.log(chalk.green('\n✨ Generated Code:'));
      console.log(response.content);
      
      // Save to file if specified
      if (options.file) {
        await this.toolManager.executeTool('write_file', {
          file_path: options.file,
          content: this.extractCodeFromResponse(response.content)
        });
        console.log(chalk.green(`💾 Code saved to ${options.file}`));
      }
      
      this.taskManager.completeTask(task.id);
      
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`Generation failed: ${error.message}`));
    }
  }
  
  async refactorCode(filePath, options) {
    console.log(chalk.blue(`🔧 Refactoring ${filePath}...`));
    
    const task = this.taskManager.startWorkflow('code-refactoring', `Refactor: ${filePath}`);
    const spinner = ora('Reading current code...').start();
    
    try {
      // Create backup if requested
      if (options.backup) {
        const backupPath = `${filePath}.backup.${Date.now()}`;
        const originalContent = await this.toolManager.executeTool('read_file', {
          file_path: filePath
        });
        
        await this.toolManager.executeTool('write_file', {
          file_path: backupPath,
          content: originalContent.content
        });
        
        console.log(chalk.blue(`📋 Backup created: ${backupPath}`));
      }
      
      // Read and analyze current code
      spinner.text = 'Analyzing code structure...';
      this.taskManager.updateTaskProgress(task.subtasks[0], 50, 'in-progress');
      
      const codeAnalysis = await this.toolManager.executeTool('analyze_code', {
        file_path: filePath,
        analysis_type: 'all'
      });
      
      this.taskManager.completeTask(task.subtasks[0]);
      this.taskManager.completeTask(task.subtasks[1]);
      
      // Generate refactoring plan
      spinner.text = 'Planning improvements...';
      this.taskManager.updateTaskProgress(task.subtasks[2], 50, 'in-progress');
      
      const currentCode = await this.toolManager.executeTool('read_file', {
        file_path: filePath
      });
      
      const refactorPrompt = `Please refactor this ${path.extname(filePath)} code to improve ${options.type}:

Current code:
\`\`\`
${currentCode.content}
\`\`\`

Analysis results:
${JSON.stringify(codeAnalysis.analysis, null, 2)}

Please provide the refactored code with explanations of the improvements made.`;

      const response = await this.agent.processMessage(refactorPrompt);
      
      this.taskManager.completeTask(task.subtasks[2]);
      
      // Apply refactoring
      spinner.text = 'Applying refactoring...';
      this.taskManager.updateTaskProgress(task.subtasks[4], 50, 'in-progress');
      
      const refactoredCode = this.extractCodeFromResponse(response.content);
      
      await this.toolManager.executeTool('write_file', {
        file_path: filePath,
        content: refactoredCode
      });
      
      this.taskManager.completeTask(task.subtasks[4]);
      this.taskManager.completeTask(task.id);
      
      spinner.stop();
      
      console.log(chalk.green(`✅ Refactoring completed for ${filePath}`));
      console.log(chalk.blue('\n📝 Improvements made:'));
      console.log(response.content);
      
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`Refactoring failed: ${error.message}`));
    }
  }
  
  async generateTests(filePath, options) {
    console.log(chalk.blue(`🧪 Generating tests for ${filePath}...`));
    
    const spinner = ora('Analyzing code for testing...').start();
    
    try {
      const sourceCode = await this.toolManager.executeTool('read_file', {
        file_path: filePath
      });
      
      const testPrompt = `Generate comprehensive ${options.framework} tests for this code:

\`\`\`
${sourceCode.content}
\`\`\`

Please include:
- Unit tests for all functions/methods
- Edge case testing
- Error condition testing
- Mock implementations where needed
- Clear test descriptions`;

      const response = await this.agent.processMessage(testPrompt);
      
      // Determine output path
      const outputPath = options.output || this.generateTestPath(filePath, options.framework);
      
      const testCode = this.extractCodeFromResponse(response.content);
      
      await this.toolManager.executeTool('write_file', {
        file_path: outputPath,
        content: testCode
      });
      
      spinner.stop();
      
      console.log(chalk.green(`✅ Tests generated: ${outputPath}`));
      console.log(chalk.blue('\n🧪 Test coverage includes:'));
      console.log(response.content);
      
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`Test generation failed: ${error.message}`));
    }
  }
  
  async generateDocumentation(filePath, options) {
    console.log(chalk.blue(`📚 Generating documentation for ${filePath}...`));
    
    const spinner = ora('Analyzing code structure...').start();
    
    try {
      const sourceCode = await this.toolManager.executeTool('read_file', {
        file_path: filePath
      });
      
      const codeAnalysis = await this.toolManager.executeTool('analyze_code', {
        file_path: filePath,
        analysis_type: 'structure'
      });
      
      const docPrompt = `Generate ${options.type} documentation for this code:

\`\`\`
${sourceCode.content}
\`\`\`

Structure analysis:
${JSON.stringify(codeAnalysis.analysis.structure, null, 2)}

Please include:
- Function/method documentation
- Parameter descriptions
- Return value descriptions
- Usage examples
- API documentation where applicable`;

      const response = await this.agent.processMessage(docPrompt);
      
      // Determine output path
      const outputPath = options.output || this.generateDocPath(filePath, options.type);
      
      await this.toolManager.executeTool('write_file', {
        file_path: outputPath,
        content: response.content
      });
      
      spinner.stop();
      
      console.log(chalk.green(`✅ Documentation generated: ${outputPath}`));
      
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`Documentation generation failed: ${error.message}`));
    }
  }
  
  async handleWorkflowCommand(options) {
    if (options.list) {
      this.showWorkflows();
    } else if (options.start) {
      const { title } = await inquirer.prompt([
        {
          type: 'input',
          name: 'title',
          message: 'Enter task title:'
        }
      ]);
      
      const task = this.taskManager.startWorkflow(options.start, title);
      console.log(chalk.green(`🚀 Started workflow: ${task.title}`));
    } else if (options.progress) {
      const progress = this.taskManager.formatProgressDisplay();
      console.log(progress);
    } else {
      console.log(chalk.yellow('Please specify a workflow action. Use --help for options.'));
    }
  }
  
  async handleConfigCommand(options) {
    if (options.set) {
      const [key, value] = options.set.split('=');
      this.config[key] = value;
      await this.saveConfig();
      console.log(chalk.green(`✅ Set ${key} = ${value}`));
    } else if (options.get) {
      const value = this.config[options.get];
      console.log(`${options.get}: ${value || 'not set'}`);
    } else if (options.list) {
      this.showConfig();
    } else {
      console.log(chalk.yellow('Please specify a config action. Use --help for options.'));
    }
  }
  
  async handleSessionCommand(options) {
    if (options.save) {
      await this.saveSession(options.save);
    } else if (options.load) {
      await this.loadSession(options.load);
    } else if (options.list) {
      await this.listSessions();
    } else if (options.delete) {
      await this.deleteSession(options.delete);
    } else {
      console.log(chalk.yellow('Please specify a session action. Use --help for options.'));
    }
  }
  
  async saveConfig() {
    const configPath = path.join(process.cwd(), '.codeassistant.json');
    const configToSave = { ...this.config };
    
    // Don't save API key to file for security
    delete configToSave.apiKey;
    
    await fs.writeFile(configPath, JSON.stringify(configToSave, null, 2));
  }
  
  async listSessions() {
    try {
      const sessionsDir = path.join(process.cwd(), '.sessions');
      const files = await fs.readdir(sessionsDir);
      const sessionFiles = files.filter(f => f.endsWith('.json'));
      
      if (sessionFiles.length === 0) {
        console.log(chalk.blue('No saved sessions found'));
        return;
      }
      
      console.log(chalk.cyan('\n💾 Saved Sessions:'));
      for (const file of sessionFiles) {
        const sessionPath = path.join(sessionsDir, file);
        const stats = await fs.stat(sessionPath);
        const sessionName = path.basename(file, '.json');
        
        console.log(`  ${sessionName} (${stats.mtime.toLocaleDateString()})`);
      }
    } catch (error) {
      console.log(chalk.blue('No saved sessions found'));
    }
  }
  
  async deleteSession(name) {
    try {
      const sessionPath = path.join(process.cwd(), '.sessions', `${name}.json`);
      await fs.unlink(sessionPath);
      console.log(chalk.green(`🗑️ Deleted session: ${name}`));
    } catch (error) {
      console.error(chalk.red(`Failed to delete session: ${error.message}`));
    }
  }
  
  extractCodeFromResponse(content) {
    // Extract code blocks from markdown-formatted response
    const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)\n```/;
    const match = content.match(codeBlockRegex);
    
    if (match) {
      return match[1];
    }
    
    // If no code block found, return content as-is
    return content;
  }
  
  generateTestPath(filePath, framework) {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);
    
    // Different frameworks have different conventions
    const conventions = {
      jest: `${name}.test${ext}`,
      mocha: `${name}.spec${ext}`,
      jasmine: `${name}.spec${ext}`
    };
    
    const testFileName = conventions[framework] || conventions.jest;
    
    // Try to put tests in __tests__ directory or tests directory
    const testDirs = ['__tests__', 'tests', 'test'];
    for (const testDir of testDirs) {
      const testDirPath = path.join(dir, testDir);
      try {
        fs.access(testDirPath);
        return path.join(testDirPath, testFileName);
      } catch {
        // Directory doesn't exist, continue
      }
    }
    
    // Default: same directory with test suffix
    return path.join(dir, testFileName);
  }
  
  generateDocPath(filePath, docType) {
    const dir = path.dirname(filePath);
    const name = path.basename(filePath, path.extname(filePath));
    
    const extensions = {
      jsdoc: '.md',
      markdown: '.md',
      html: '.html',
      rst: '.rst'
    };
    
    const ext = extensions[docType] || '.md';
    
    // Try to put docs in docs directory
    const docsDir = path.join(dir, 'docs');
    try {
      fs.access(docsDir);
      return path.join(docsDir, `${name}${ext}`);
    } catch {
      // Default: same directory
      return path.join(dir, `${name}.docs${ext}`);
    }
  }
  
  async shutdown() {
    if (this.sessionActive) {
      console.log(chalk.yellow('\n🔄 Shutting down...'));
      
      // Auto-save if enabled
      if (this.config.autoSave) {
        await this.saveSession(`autosave_${Date.now()}`);
      }
      
      // Archive old tasks
      this.taskManager.archiveCompletedTasks();
      
      console.log(chalk.blue('👋 Goodbye!'));
    }
    
    process.exit(0);
  }
}

// CLI Commands Setup
async function setupCLI() {
  const cli = new CodeAssistantCLI();
  
  program
    .name('codeassistant')
    .description('Advanced AI-powered coding assistant')
    .version('1.0.0')
    .hook('preAction', async () => {
      await cli.initialize();
    });
  
  program
    .command('chat')
    .description('Start interactive chat session')
    .action(async () => {
      await cli.chat();
    });
  
  program
    .command('analyze [path]')
    .description('Analyze project structure and code quality')
    .action(async (projectPath) => {
      await cli.analyzeProject(projectPath);
    });
  
  program
    .command('generate <description>')
    .description('Generate code from description')
    .option('-l, --language <lang>', 'programming language', 'javascript')
    .option('-f, --file <path>', 'output file path')
    .option('-w, --workflow <id>', 'use specific workflow')
    .action(async (description, options) => {
      await cli.generateCode(description, options);
    });
  
  program
    .command('refactor <file>')
    .description('Refactor existing code file')
    .option('-b, --backup', 'create backup before refactoring', true)
    .option('-t, --type <type>', 'refactoring type', 'quality')
    .action(async (filePath, options) => {
      await cli.refactorCode(filePath, options);
    });
  
  program
    .command('test <file>')
    .description('Generate tests for code file')
    .option('-f, --framework <framework>', 'testing framework', 'jest')
    .option('-o, --output <path>', 'output directory for tests')
    .action(async (filePath, options) => {
      await cli.generateTests(filePath, options);
    });
  
  program
    .command('document <file>')
    .description('Generate documentation for code file')
    .option('-t, --type <type>', 'documentation type', 'jsdoc')
    .option('-o, --output <path>', 'output file path')
    .action(async (filePath, options) => {
      await cli.generateDocumentation(filePath, options);
    });
  
  program
    .command('workflow')
    .description('Workflow management commands')
    .option('-l, --list', 'list available workflows')
    .option('-s, --start <id>', 'start workflow')
    .option('-p, --progress', 'show workflow progress')
    .action(async (options) => {
      await cli.handleWorkflowCommand(options);
    });
  
  program
    .command('config')
    .description('Configuration management')
    .option('-s, --set <key=value>', 'set configuration value')
    .option('-g, --get <key>', 'get configuration value')
    .option('-l, --list', 'list all configuration')
    .action(async (options) => {
      await cli.handleConfigCommand(options);
    });
  
  program
    .command('session')
    .description('Session management')
    .option('-s, --save <name>', 'save current session')
    .option('-l, --load <name>', 'load saved session')
    .option('-ls, --list', 'list saved sessions')
    .option('-d, --delete <name>', 'delete saved session')
    .action(async (options) => {
      await cli.handleSessionCommand(options);
    });
  
  return { cli, program };
}

// Main execution
if (require.main === module) {
  setupCLI().then(({ program }) => {
    program.parse();
  }).catch(error => {
    console.error(chalk.red(`Failed to start CLI: ${error.message}`));
    process.exit(1);
  });
}

module.exports = { CodeAssistantCLI, setupCLI };