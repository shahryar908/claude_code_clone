#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config();

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
    
    // Set defaults with more conservative limits to prevent API errors
    this.config = {
      model: 'llama3-8b-8192',
      maxTokens: 1500, // Reduced from 4000 to prevent overflow
      temperature: 0.1,
      safeMode: true,
      autoSave: true,
      contextWindowLimit: 6144, // Conservative limit for llama3-8b-8192 (75% of 8192)
      maxHistoryLength: 20, // Reduced from default to keep context manageable
      ...this.config
    };
    
    // Prioritize environment variable for API key (more secure)
    if (process.env.GROQ_API_KEY) {
      this.config.apiKey = process.env.GROQ_API_KEY;
    }
    
    // Check for API key
    if (!this.config.apiKey) {
      console.error(chalk.red('❌ GROQ_API_KEY not found in environment or config'));
      console.error(chalk.yellow('💡 Set GROQ_API_KEY environment variable or add apiKey to .codeassistant.json'));
      process.exit(1);
    }
    
    // Don't log the actual API key for security
    if (this.config.apiKey.startsWith('dummy') || this.config.apiKey === 'dummy-key-for-testing') {
      console.error(chalk.red('❌ Please replace dummy API key with a real Groq API key'));
      console.error(chalk.yellow('💡 Get your free API key from https://console.groq.com'));
      process.exit(1);
    }
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
    
    console.log(chalk.cyan('\n🤖 Available Groq Models:'));
    console.log(chalk.blue('Fast Models:'));
    console.log('  • llama3-8b-8192 (8K context, fastest)');
    console.log('  • llama3-70b-8192 (8K context, more capable)');
    console.log('  • mixtral-8x7b-32768 (32K context, good for long documents)');
    console.log('  • gemma-7b-it (7K context, Google model)');
    console.log(chalk.gray('\nTo change model: codeassistant config --set model=llama3-70b-8192'));
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
  
  async handleGitCommand(options) {
    try {
      if (options.status) {
        const result = await this.toolManager.executeTool('git_status', {});
        if (result.success) {
          console.log(chalk.cyan(`\n📍 Current branch: ${result.branch}`));
          if (result.remoteInfo) {
            console.log(chalk.gray(`Remote: ${result.remoteInfo}`));
          }
          
          const { files, summary } = result;
          console.log(chalk.blue('\n📊 Repository Status:'));
          console.log(`  Staged files: ${chalk.green(summary.staged)}`);
          console.log(`  Unstaged changes: ${chalk.yellow(summary.unstaged)}`);
          console.log(`  Untracked files: ${chalk.red(summary.untracked)}`);
          if (summary.conflicted > 0) {
            console.log(`  Conflicts: ${chalk.red(summary.conflicted)}`);
          }
          
          if (files.staged.length > 0) {
            console.log(chalk.green('\n✅ Staged files:'));
            files.staged.forEach(file => console.log(`  ${file.status} ${file.name}`));
          }
          
          if (files.unstaged.length > 0) {
            console.log(chalk.yellow('\n⚠️  Unstaged changes:'));
            files.unstaged.forEach(file => console.log(`  ${file.status} ${file.name}`));
          }
          
          if (files.untracked.length > 0) {
            console.log(chalk.red('\n❓ Untracked files:'));
            files.untracked.forEach(file => console.log(`  ?? ${file.name}`));
          }
          
          if (summary.clean) {
            console.log(chalk.green('\n✨ Working tree is clean!'));
          }
        }
      }
      
      if (options.add) {
        const files = options.add.split(',').map(f => f.trim());
        const result = await this.toolManager.executeTool('git_add', { files });
        if (result.success) {
          console.log(chalk.green(`✅ Added ${files.length} files to staging area`));
          console.log(chalk.gray(`Files: ${files.join(', ')}`));
        }
      }
      
      if (options.commit) {
        const result = await this.toolManager.executeTool('git_commit', { 
          message: options.commit 
        });
        if (result.success) {
          console.log(chalk.green(`✅ Commit created: ${result.commitHash.substring(0, 8)}`));
          console.log(chalk.blue(`Message: ${result.message}`));
        } else {
          console.log(chalk.yellow(`⚠️  ${result.error}`));
        }
      }
      
      if (options.push) {
        console.log(chalk.blue('🚀 Pushing to remote...'));
        const result = await this.toolManager.executeTool('git_push', {});
        if (result.success) {
          console.log(chalk.green('✅ Push completed successfully'));
          console.log(chalk.gray(`Pushed to: ${result.remote}/${result.branch}`));
        }
      }
      
      if (options.log) {
        const count = parseInt(options.log) || 10;
        const result = await this.toolManager.executeTool('git_log', { 
          limit: count, 
          oneline: true 
        });
        if (result.success) {
          console.log(chalk.cyan(`\n📜 Last ${count} commits:`));
          result.commits.forEach((commit, index) => {
            if (commit.hash) {
              console.log(`${chalk.yellow(commit.hash)} ${commit.message}`);
            }
          });
        }
      }
      
      if (options.branch) {
        let action = 'list';
        if (typeof options.branch === 'string') {
          action = options.branch;
        }
        
        const result = await this.toolManager.executeTool('git_branch', { action });
        if (result.success && result.result.branches) {
          console.log(chalk.cyan('\n🌿 Branches:'));
          result.result.branches.forEach(branch => {
            const marker = branch.current ? '* ' : '  ';
            const color = branch.current ? chalk.green : 
                         branch.remote ? chalk.gray : chalk.blue;
            console.log(`${marker}${color(branch.name)}`);
          });
        }
      }
      
      if (options.diff) {
        const result = await this.toolManager.executeTool('git_diff', { 
          target: options.diff === true ? undefined : options.diff 
        });
        if (result.success) {
          console.log(chalk.cyan(`\n📝 Diff (${result.target}):`));
          if (result.diff.trim()) {
            console.log(result.diff);
          } else {
            console.log(chalk.gray('No differences found'));
          }
        }
      }
      
      if (!options.status && !options.add && !options.commit && 
          !options.push && !options.log && !options.branch && !options.diff) {
        console.log(chalk.yellow('Please specify a Git action. Use --help for options.'));
        console.log(chalk.blue('Examples:'));
        console.log('  codeassistant git --status          # Show status');
        console.log('  codeassistant git --add "."         # Add all files');
        console.log('  codeassistant git --commit "fix: bug"  # Commit with message');
        console.log('  codeassistant git --push            # Push to remote');
        console.log('  codeassistant git --log 5           # Show last 5 commits');
      }
      
    } catch (error) {
      console.error(chalk.red(`Git operation failed: ${error.message}`));
    }
  }
  
  async handleMultiEditCommand(options) {
    try {
      console.log(chalk.blue('🔧 Multi-file editing operations'));
      
      if (options.replace && options.find && options.replaceWith) {
        // Batch find and replace
        const files = options.files ? options.files.split(',').map(f => f.trim()) : null;
        
        const toolInput = {
          find: options.find,
          replace: options.replaceWith,
          backup: !options.noBackup,
          dry_run: options.dryRun || false
        };
        
        if (files) {
          toolInput.files = files;
        } else if (options.glob) {
          toolInput.glob_pattern = options.glob;
        } else {
          toolInput.glob_pattern = '**/*.{js,ts,jsx,tsx,vue,py,java,cpp,c,h}';
        }
        
        const spinner = ora('Processing batch find and replace...').start();
        const result = await this.toolManager.executeTool('batch_find_replace', toolInput);
        spinner.stop();
        
        if (result.success) {
          const { summary } = result;
          console.log(chalk.green(`\n✅ Batch Replace Complete:`));
          console.log(`  Files processed: ${summary.files_processed}`);
          console.log(`  Files changed: ${chalk.green(summary.files_changed)}`);
          console.log(`  Total matches: ${summary.total_matches}`);
          
          if (summary.errors > 0) {
            console.log(chalk.red(`  Errors: ${summary.errors}`));
          }
          
          if (options.dryRun) {
            console.log(chalk.blue('\n📋 This was a dry run - no files were modified'));
          } else if (result.backups.length > 0) {
            console.log(chalk.gray(`\n💾 Backups created: ${result.backups.length} files`));
          }
        }
      }
      
      else if (options.edit) {
        // Multi-file edit with JSON edits
        let edits;
        try {
          edits = JSON.parse(options.edit);
        } catch (error) {
          console.error(chalk.red('Invalid JSON format for edits. Example:'));
          console.log(chalk.gray('[{"file_path": "src/test.js", "edit_type": "replace", "target": "oldText", "replacement": "newText"}]'));
          return;
        }
        
        const spinner = ora('Processing multi-file edits...').start();
        const result = await this.toolManager.executeTool('multi_edit', {
          edits,
          backup: !options.noBackup,
          dry_run: options.dryRun || false
        });
        spinner.stop();
        
        if (result.success) {
          const { summary } = result;
          console.log(chalk.green(`\n✅ Multi-Edit Complete:`));
          console.log(`  Total files: ${summary.successful}`);
          console.log(`  Files created: ${summary.created}`);
          console.log(`  Size change: ${summary.total_size_change > 0 ? '+' : ''}${summary.total_size_change} bytes`);
          
          // Show edit types breakdown
          if (Object.keys(summary.edit_types).length > 0) {
            console.log(chalk.blue('\n📊 Edit types:'));
            Object.entries(summary.edit_types).forEach(([type, count]) => {
              console.log(`  ${type}: ${count}`);
            });
          }
          
          if (options.dryRun) {
            console.log(chalk.blue('\n📋 This was a dry run - no files were modified'));
          } else if (result.backups.length > 0) {
            console.log(chalk.gray(`\n💾 Backups created: ${result.backups.length} files`));
          }
        }
      }
      
      else {
        console.log(chalk.yellow('Please specify a multi-edit action. Use --help for options.'));
        console.log(chalk.blue('Examples:'));
        console.log('  # Batch find and replace');
        console.log('  codeassistant multiedit --replace -f "oldText" -R "newText" --glob "src/**/*.js"');
        console.log('');
        console.log('  # Multi-file edits (JSON format)');
        console.log("  codeassistant multiedit --edit '[{\"file_path\": \"src/test.js\", \"edit_type\": \"replace\", \"target\": \"old\", \"replacement\": \"new\"}]'");
        console.log('');
        console.log('  # Dry run to preview changes');
        console.log('  codeassistant multiedit --replace -f "old" -R "new" --dry-run');
      }
      
    } catch (error) {
      console.error(chalk.red(`Multi-edit operation failed: ${error.message}`));
    }
  }
  
  async handleNavigateCommand(options) {
    try {
      console.log(chalk.blue('🧭 Smart Navigation'));
      
      if (options.find) {
        // Find files by pattern
        const extensions = options.ext ? options.ext.split(',').map(e => e.trim()) : [];
        const spinner = ora('Finding files...').start();
        
        const result = await this.toolManager.executeTool('find_files', {
          pattern: options.find,
          directory: options.dir,
          fuzzy: true,
          extensions,
          max_results: parseInt(options.max)
        });
        
        spinner.stop();
        
        if (result.success && result.files.length > 0) {
          console.log(chalk.green(`\n✅ Found ${result.files.length} files matching "${options.find}":`));
          result.files.forEach((file, index) => {
            const score = file.score ? ` (${file.score.toFixed(1)})` : '';
            console.log(`${index + 1}. ${chalk.blue(file.name)}${score}`);
            console.log(`   ${chalk.gray(file.path)}`);
          });
        } else {
          console.log(chalk.yellow(`No files found matching "${options.find}"`));
        }
      }
      
      else if (options.search) {
        // Search content within files
        const extensions = options.ext ? options.ext.split(',').map(e => e.trim()) : undefined;
        const spinner = ora('Searching in files...').start();
        
        const result = await this.toolManager.executeTool('search_in_files', {
          query: options.search,
          directory: options.dir,
          extensions,
          max_results: parseInt(options.max),
          context_lines: 2
        });
        
        spinner.stop();
        
        if (result.success && result.files_with_matches > 0) {
          console.log(chalk.green(`\n✅ Found ${result.total_matches} matches in ${result.files_with_matches} files:`));
          
          result.results.forEach(fileResult => {
            console.log(`\n📄 ${chalk.blue(fileResult.file_name)} (${fileResult.total_matches} matches)`);
            console.log(`   ${chalk.gray(fileResult.file_path)}`);
            
            fileResult.matches.forEach((match, index) => {
              if (index < 3) { // Limit matches shown per file
                console.log(`   Line ${match.line_number}: ${match.line_content.trim()}`);
              }
            });
            
            if (fileResult.matches.length > 3) {
              console.log(`   ${chalk.gray(`... and ${fileResult.matches.length - 3} more matches`)}`);
            }
          });
        } else {
          console.log(chalk.yellow(`No matches found for "${options.search}"`));
        }
      }
      
      else if (options.definition) {
        // Find symbol definition
        const spinner = ora('Finding definition...').start();
        
        const result = await this.toolManager.executeTool('goto_definition', {
          symbol: options.definition,
          directory: options.dir
        });
        
        spinner.stop();
        
        if (result.success && result.definitions.length > 0) {
          console.log(chalk.green(`\n✅ Found ${result.definitions.length} definition(s) for "${options.definition}":`));
          
          result.definitions.forEach((def, index) => {
            console.log(`\n${index + 1}. ${chalk.blue(def.file_name)} (confidence: ${def.confidence}%)`);
            console.log(`   Line ${def.line_number}: ${def.line_content}`);
            console.log(`   ${chalk.gray(def.file_path)}`);
          });
        } else {
          console.log(chalk.yellow(`No definition found for "${options.definition}"`));
        }
      }
      
      else if (options.references) {
        // Find symbol references
        const spinner = ora('Finding references...').start();
        
        const result = await this.toolManager.executeTool('find_references', {
          symbol: options.references,
          directory: options.dir
        });
        
        spinner.stop();
        
        if (result.success && result.files_with_matches > 0) {
          console.log(chalk.green(`\n✅ Found ${result.total_matches} references to "${options.references}" in ${result.files_with_matches} files:`));
          
          result.results.forEach(fileResult => {
            console.log(`\n📄 ${chalk.blue(fileResult.file_name)} (${fileResult.total_matches} references)`);
            fileResult.matches.forEach(match => {
              console.log(`   Line ${match.line_number}: ${match.line_content.trim()}`);
            });
          });
        } else {
          console.log(chalk.yellow(`No references found for "${options.references}"`));
        }
      }
      
      else if (options.tree) {
        // Show project tree
        const spinner = ora('Building project tree...').start();
        
        const result = await this.toolManager.executeTool('project_tree', {
          directory: options.dir,
          max_depth: 4
        });
        
        spinner.stop();
        
        if (result.success) {
          console.log(chalk.green(`\n🌳 Project Structure (${result.directory}):`));
          console.log(result.tree);
        }
      }
      
      else if (options.outline) {
        // Show file outline
        const spinner = ora('Generating file outline...').start();
        
        const result = await this.toolManager.executeTool('file_outline', {
          file_path: options.outline
        });
        
        spinner.stop();
        
        if (result.success && result.outline.length > 0) {
          console.log(chalk.green(`\n📋 File Outline: ${path.basename(options.outline)}`));
          
          result.outline.forEach(item => {
            const icon = item.type === 'class' ? '🏛️' :
                        item.type === 'function' ? '⚡' :
                        item.type === 'interface' ? '🔌' :
                        item.type === 'type' ? '📝' : '📦';
            
            console.log(`${icon} ${item.type}: ${chalk.blue(item.name)} (line ${item.line_number})`);
          });
        } else {
          console.log(chalk.yellow(`No outline generated for "${options.outline}"`));
        }
      }
      
      else if (options.fuzzy) {
        // Fuzzy search
        const spinner = ora('Fuzzy searching...').start();
        
        const result = await this.toolManager.executeTool('fuzzy_find', {
          query: options.fuzzy,
          directory: options.dir,
          search_content: true,
          max_results: parseInt(options.max)
        });
        
        spinner.stop();
        
        if (result.success) {
          if (result.file_matches.length > 0) {
            console.log(chalk.green(`\n📁 File matches for "${options.fuzzy}":`));
            result.file_matches.forEach((file, index) => {
              console.log(`${index + 1}. ${chalk.blue(file.name)} (${file.score.toFixed(1)})`);
              console.log(`   ${chalk.gray(file.path)}`);
            });
          }
          
          if (result.content_matches.length > 0) {
            console.log(chalk.green(`\n📝 Content matches:`));
            result.content_matches.forEach(fileResult => {
              console.log(`\n📄 ${chalk.blue(fileResult.file_name)}`);
              fileResult.matches.forEach(match => {
                console.log(`   Line ${match.line_number}: ${match.line_content.trim()}`);
              });
            });
          }
          
          if (result.total_matches === 0) {
            console.log(chalk.yellow(`No matches found for "${options.fuzzy}"`));
          }
        }
      }
      
      else if (options.recent) {
        // Show recent files
        const result = await this.toolManager.executeTool('recent_files', {
          limit: parseInt(options.max)
        });
        
        if (result.success && result.recent_files.length > 0) {
          console.log(chalk.green(`\n📚 Recently accessed files:`));
          result.recent_files.forEach((filePath, index) => {
            console.log(`${index + 1}. ${chalk.blue(path.basename(filePath))}`);
            console.log(`   ${chalk.gray(filePath)}`);
          });
        } else {
          console.log(chalk.yellow('No recent files found'));
        }
      }
      
      else {
        console.log(chalk.yellow('Please specify a navigation action. Use --help for options.'));
        console.log(chalk.blue('Examples:'));
        console.log('  # Find files by pattern');
        console.log('  codeassistant navigate -f "Component"');
        console.log('');
        console.log('  # Search content in files');
        console.log('  codeassistant navigate -s "useState"');
        console.log('');
        console.log('  # Find symbol definition');
        console.log('  codeassistant navigate -d "MyFunction"');
        console.log('');
        console.log('  # Show project tree');
        console.log('  codeassistant navigate --tree');
        console.log('');
        console.log('  # Fuzzy search files and content');
        console.log('  codeassistant navigate -z "comp hook"');
      }
      
    } catch (error) {
      console.error(chalk.red(`Navigation operation failed: ${error.message}`));
    }
  }
  
  async handleCheckCommand(options) {
    try {
      console.log(chalk.blue('🔍 Code Quality & Syntax Checking'));
      
      if (options.syntax) {
        // Syntax check specific file
        const spinner = ora('Checking syntax...').start();
        
        const result = await this.toolManager.executeTool('check_syntax', {
          file_path: options.syntax,
          language: options.lang,
          strict_mode: options.strict || false,
          include_warnings: !options.noWarnings
        });
        
        spinner.stop();
        
        if (result.success) {
          console.log(chalk.green(`\n✅ Syntax Check: ${path.basename(options.syntax)}`));
          console.log(`Language: ${result.language} | Valid: ${result.syntax_valid ? 'Yes' : 'No'}`);
          console.log(`Issues: ${result.total_issues} (${result.errors.length} errors, ${result.warnings.length} warnings)`);
          
          if (result.errors.length > 0) {
            console.log(chalk.red('\n❌ Errors:'));
            result.errors.forEach(error => {
              console.log(`  Line ${error.line}: ${error.message}`);
              if (error.column) {
                console.log(`    Column ${error.column} | Type: ${error.type}`);
              }
            });
          }
          
          if (result.warnings.length > 0) {
            console.log(chalk.yellow('\n⚠️  Warnings:'));
            result.warnings.forEach(warning => {
              console.log(`  Line ${warning.line}: ${warning.message}`);
            });
          }
          
          if (result.suggestions.length > 0) {
            console.log(chalk.blue('\n💡 Suggestions:'));
            result.suggestions.forEach(suggestion => {
              console.log(`  Line ${suggestion.line}: ${suggestion.message}`);
              if (suggestion.suggestion) {
                console.log(`    Fix: ${chalk.cyan(suggestion.suggestion)}`);
              }
            });
          }
          
          if (result.syntax_valid) {
            console.log(chalk.green('\n✨ Syntax is valid!'));
          }
        }
      }
      
      else if (options.lint) {
        // Lint check specific file
        const spinner = ora('Running lint checks...').start();
        
        const result = await this.toolManager.executeTool('lint_check', {
          file_path: options.lint
        });
        
        spinner.stop();
        
        if (result.success) {
          console.log(chalk.green(`\n📋 Lint Check: ${path.basename(options.lint)}`));
          
          if (result.errors.length > 0) {
            console.log(chalk.red(`\n❌ Lint Errors (${result.errors.length}):`));
            result.errors.forEach(error => {
              console.log(`  Line ${error.line}: ${error.message}`);
            });
          }
          
          if (result.warnings.length > 0) {
            console.log(chalk.yellow(`\n⚠️  Lint Warnings (${result.warnings.length}):`));
            result.warnings.forEach(warning => {
              console.log(`  Line ${warning.line}: ${warning.message}`);
            });
          }
          
          if (result.errors.length === 0 && result.warnings.length === 0) {
            console.log(chalk.green('✨ No lint issues found!'));
          }
        }
      }
      
      else if (options.format) {
        // Format check specific file
        const spinner = ora('Checking formatting...').start();
        
        const result = await this.toolManager.executeTool('format_check', {
          file_path: options.format
        });
        
        spinner.stop();
        
        if (result.success) {
          console.log(chalk.green(`\n🎨 Format Check: ${path.basename(options.format)}`));
          
          if (result.formatting_issues.length > 0) {
            console.log(chalk.yellow(`\n⚠️  Formatting Issues (${result.formatting_issues.length}):`));
            result.formatting_issues.forEach(issue => {
              console.log(`  Line ${issue.line}: ${issue.message}`);
            });
          } else {
            console.log(chalk.green('✨ Formatting looks good!'));
          }
        }
      }
      
      else if (options.validate) {
        // Validate specific file
        const spinner = ora('Validating file...').start();
        
        const result = await this.toolManager.executeTool('validate_file', {
          file_path: options.validate
        });
        
        spinner.stop();
        
        if (result.success) {
          console.log(chalk.green(`\n✅ File Validation: ${path.basename(options.validate)}`));
          console.log(`Language: ${result.language} | Valid: ${result.syntax_valid ? 'Yes' : 'No'}`);
          
          const totalIssues = (result.errors?.length || 0) + (result.warnings?.length || 0);
          if (totalIssues === 0) {
            console.log(chalk.green('🎉 File is valid with no issues!'));
          } else {
            console.log(`Issues found: ${totalIssues}`);
            
            if (result.errors?.length > 0) {
              console.log(chalk.red(`\n❌ Errors (${result.errors.length}):`));
              result.errors.slice(0, 5).forEach(error => {
                console.log(`  Line ${error.line}: ${error.message}`);
              });
              if (result.errors.length > 5) {
                console.log(chalk.gray(`  ... and ${result.errors.length - 5} more errors`));
              }
            }
          }
        }
      }
      
      else if (options.batch) {
        // Batch validate directory
        const spinner = ora('Batch validating files...').start();
        
        const result = await this.toolManager.executeTool('batch_validate', {
          directory: options.batch
        });
        
        spinner.stop();
        
        if (result.success) {
          console.log(chalk.green(`\n📁 Batch Validation: ${options.batch}`));
          console.log(`Files processed: ${result.total_files}`);
          
          const { summary } = result;
          console.log(chalk.blue('\n📊 Summary:'));
          console.log(`  ✅ Valid files: ${chalk.green(summary.valid_files)}`);
          console.log(`  ❌ Invalid files: ${chalk.red(summary.invalid_files)}`);
          console.log(`  🚨 Total errors: ${summary.total_errors}`);
          console.log(`  ⚠️  Total warnings: ${summary.total_warnings}`);
          
          if (Object.keys(summary.languages).length > 0) {
            console.log(chalk.blue('\n🏷️  Languages found:'));
            Object.entries(summary.languages).forEach(([lang, count]) => {
              console.log(`  ${lang}: ${count} files`);
            });
          }
          
          // Show files with issues
          const filesWithIssues = result.results.filter(r => r.success && !r.syntax_valid);
          if (filesWithIssues.length > 0) {
            console.log(chalk.yellow(`\n⚠️  Files with issues:`));
            filesWithIssues.slice(0, 10).forEach(file => {
              const name = path.basename(file.file_path);
              const errors = file.errors?.length || 0;
              const warnings = file.warnings?.length || 0;
              console.log(`  ${name}: ${errors} errors, ${warnings} warnings`);
            });
            
            if (filesWithIssues.length > 10) {
              console.log(chalk.gray(`  ... and ${filesWithIssues.length - 10} more files with issues`));
            }
          }
        }
      }
      
      else if (options.detect) {
        // Detect language
        const spinner = ora('Detecting language...').start();
        
        const result = await this.toolManager.executeTool('detect_language', {
          file_path: options.detect
        });
        
        spinner.stop();
        
        if (result.success) {
          console.log(chalk.green(`\n🔍 Language Detection: ${path.basename(options.detect)}`));
          console.log(`Language: ${chalk.blue(result.language)} (${result.confidence}% confidence)`);
          console.log(`Detection method: ${result.detection_method}`);
        }
      }
      
      else if (options.fix) {
        // Suggest fixes
        const spinner = ora('Analyzing for fixes...').start();
        
        const result = await this.toolManager.executeTool('suggest_fixes', {
          file_path: options.fix
        });
        
        spinner.stop();
        
        if (result.success) {
          console.log(chalk.green(`\n🔧 Fix Suggestions: ${path.basename(options.fix)}`));
          
          if (result.suggested_fixes.length > 0) {
            console.log(chalk.blue(`\n💡 ${result.suggested_fixes.length} suggestions found:`));
            result.suggested_fixes.forEach((fix, index) => {
              console.log(`\n${index + 1}. Line ${fix.line}: ${fix.message}`);
              if (fix.suggestion) {
                console.log(`   Fix: ${chalk.cyan(fix.suggestion)}`);
              }
            });
          } else {
            console.log(chalk.green('✨ No automatic fixes suggested - code looks good!'));
          }
        }
      }
      
      else {
        console.log(chalk.yellow('Please specify a check action. Use --help for options.'));
        console.log(chalk.blue('Examples:'));
        console.log('  # Check syntax of a file');
        console.log('  codeassistant check -s "src/app.js"');
        console.log('');
        console.log('  # Run lint checks');
        console.log('  codeassistant check -l "src/components/Button.jsx"');
        console.log('');
        console.log('  # Batch validate directory');
        console.log('  codeassistant check -b "src/"');
        console.log('');
        console.log('  # Detect language');
        console.log('  codeassistant check --detect "unknown_file"');
        console.log('');
        console.log('  # Suggest fixes');
        console.log('  codeassistant check --fix "src/utils.js"');
      }
      
    } catch (error) {
      console.error(chalk.red(`Syntax check operation failed: ${error.message}`));
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
  
  program
    .command('git')
    .description('Git operations')
    .option('-s, --status', 'show git status')
    .option('-a, --add <files>', 'stage files for commit')
    .option('-c, --commit <message>', 'commit staged changes')
    .option('-p, --push', 'push to remote repository')
    .option('-l, --log [count]', 'show commit history', 10)
    .option('-b, --branch [action]', 'branch operations (list, create, delete)')
    .option('-d, --diff [target]', 'show differences')
    .action(async (options) => {
      await cli.handleGitCommand(options);
    });

  program
    .command('multiedit')
    .description('Multi-file editing operations')
    .option('-e, --edit <edits>', 'perform multiple file edits (JSON format)')
    .option('-r, --replace', 'batch find and replace across files')
    .option('-f, --find <pattern>', 'pattern to find')
    .option('-R, --replace-with <text>', 'replacement text')
    .option('-g, --glob <pattern>', 'glob pattern for files')
    .option('--files <files>', 'specific files to edit (comma-separated)')
    .option('--dry-run', 'preview changes without applying')
    .option('--no-backup', 'skip creating backup files')
    .action(async (options) => {
      await cli.handleMultiEditCommand(options);
    });

  program
    .command('navigate')
    .description('Smart file navigation and search')
    .option('-f, --find <pattern>', 'find files by name pattern')
    .option('-s, --search <query>', 'search content within files')
    .option('-d, --definition <symbol>', 'find symbol definition')
    .option('-r, --references <symbol>', 'find symbol references')
    .option('-t, --tree', 'show project tree structure')
    .option('-o, --outline <file>', 'show file outline/structure')
    .option('-z, --fuzzy <query>', 'fuzzy search files and content')
    .option('--recent', 'show recently accessed files')
    .option('--dir <directory>', 'directory to search in', '.')
    .option('--ext <extensions>', 'file extensions to include (comma-separated)')
    .option('--max <number>', 'maximum number of results', 50)
    .action(async (options) => {
      await cli.handleNavigateCommand(options);
    });

  program
    .command('check')
    .description('Real-time syntax and code quality checking')
    .option('-s, --syntax <file>', 'check syntax of a specific file')
    .option('-l, --lint <file>', 'perform linting checks on a file')
    .option('-f, --format <file>', 'check code formatting')
    .option('-v, --validate <file>', 'validate file for errors and warnings')
    .option('-b, --batch <directory>', 'batch validate all files in directory')
    .option('--detect <file>', 'detect programming language of file')
    .option('--fix <file>', 'suggest automatic fixes for issues')
    .option('--strict', 'enable strict checking mode')
    .option('--no-warnings', 'hide warning-level issues')
    .option('--lang <language>', 'specify language for checking')
    .action(async (options) => {
      await cli.handleCheckCommand(options);
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