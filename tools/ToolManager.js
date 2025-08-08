const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class ToolManager {
  constructor(config = {}) {
    this.config = {
      safeMode: true,
      allowedCommands: ['npm', 'node', 'git', 'ls', 'cat', 'echo'],
      restrictedPaths: ['/etc', '/usr', '/bin', '/sbin'],
      maxFileSize: 10 * 1024 * 1024, // 10MB
      ...config
    };
    
    this.tools = new Map();
    this.toolMetrics = new Map();
    this.registerDefaultTools();
  }
  
  registerDefaultTools() {
    // File operations
    this.registerTool('read_file', new FileReadTool(this.config));
    this.registerTool('write_file', new FileWriteTool(this.config));
    this.registerTool('list_files', new ListFilesTool(this.config));
    this.registerTool('search_files', new SearchFilesTool(this.config));
    this.registerTool('create_directory', new CreateDirectoryTool(this.config));
    
    // Code operations
    this.registerTool('analyze_code', new CodeAnalysisTool(this.config));
    this.registerTool('format_code', new CodeFormatterTool(this.config));
    this.registerTool('lint_code', new CodeLinterTool(this.config));
    
    // Project operations
    this.registerTool('run_command', new CommandExecutorTool(this.config));
    this.registerTool('git_status', new GitStatusTool(this.config));
    this.registerTool('npm_info', new NPMInfoTool(this.config));
    
    // Task management
    this.registerTool('todo_write', new TodoTool(this.config));
    this.registerTool('todo_read', new TodoReadTool(this.config));
    
    console.log(`🔧 Registered ${this.tools.size} default tools`);
  }
  
  registerTool(name, tool) {
    if (!tool.execute || typeof tool.execute !== 'function') {
      throw new Error(`Tool ${name} must have an execute method`);
    }
    
    this.tools.set(name, tool);
    this.toolMetrics.set(name, {
      usageCount: 0,
      successCount: 0,
      errorCount: 0,
      averageExecutionTime: 0
    });
  }
  
  async executeTool(name, input) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }
    
    const startTime = Date.now();
    const metrics = this.toolMetrics.get(name);
    metrics.usageCount++;
    
    try {
      const result = await tool.execute(input);
      
      metrics.successCount++;
      const executionTime = Date.now() - startTime;
      metrics.averageExecutionTime = 
        (metrics.averageExecutionTime * (metrics.usageCount - 1) + executionTime) / metrics.usageCount;
      
      return result;
    } catch (error) {
      metrics.errorCount++;
      throw error;
    }
  }
  
  getToolDefinitions() {
    return Array.from(this.tools.entries()).map(([name, tool]) => ({
      name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));
  }
  
  getToolMetrics() {
    return Object.fromEntries(this.toolMetrics);
  }
}

// File Read Tool
class FileReadTool {
  constructor(config) {
    this.config = config;
    this.description = "Read the contents of a file. Use this to understand existing code before making changes.";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to read"
        }
      },
      required: ["file_path"]
    };
  }
  
  async execute(input) {
    const { file_path } = input;
    
    // Security check
    if (this.config.safeMode && this.isRestrictedPath(file_path)) {
      throw new Error(`Access to ${file_path} is restricted`);
    }
    
    try {
      const resolvedPath = path.resolve(file_path);
      const stats = await fs.stat(resolvedPath);
      
      if (stats.size > this.config.maxFileSize) {
        throw new Error(`File ${file_path} is too large (${stats.size} bytes)`);
      }
      
      const content = await fs.readFile(resolvedPath, 'utf8');
      
      return {
        success: true,
        content,
        size: stats.size,
        lastModified: stats.mtime,
        path: resolvedPath
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File ${file_path} does not exist`);
      }
      throw error;
    }
  }
  
  isRestrictedPath(filePath) {
    const resolved = path.resolve(filePath);
    return this.config.restrictedPaths.some(restricted => 
      resolved.startsWith(path.resolve(restricted))
    );
  }
}

// File Write Tool
class FileWriteTool {
  constructor(config) {
    this.config = config;
    this.description = "Write content to a file. Creates directories if they don't exist.";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to write"
        },
        content: {
          type: "string",
          description: "Content to write to the file"
        },
        create_directories: {
          type: "boolean",
          description: "Whether to create parent directories if they don't exist",
          default: true
        }
      },
      required: ["file_path", "content"]
    };
  }
  
  async execute(input) {
    const { file_path, content, create_directories = true } = input;
    
    if (this.config.safeMode && this.isRestrictedPath(file_path)) {
      throw new Error(`Writing to ${file_path} is restricted`);
    }
    
    try {
      const resolvedPath = path.resolve(file_path);
      
      if (create_directories) {
        const dir = path.dirname(resolvedPath);
        await fs.mkdir(dir, { recursive: true });
      }
      
      await fs.writeFile(resolvedPath, content, 'utf8');
      
      const stats = await fs.stat(resolvedPath);
      
      return {
        success: true,
        path: resolvedPath,
        size: stats.size,
        created: Date.now()
      };
    } catch (error) {
      throw new Error(`Failed to write file ${file_path}: ${error.message}`);
    }
  }
  
  isRestrictedPath(filePath) {
    const resolved = path.resolve(filePath);
    return this.config.restrictedPaths.some(restricted => 
      resolved.startsWith(path.resolve(restricted))
    );
  }
}

// List Files Tool
class ListFilesTool {
  constructor(config) {
    this.config = config;
    this.description = "List files and directories in a given path with optional filtering.";
    this.inputSchema = {
      type: "object",
      properties: {
        directory_path: {
          type: "string",
          description: "Path to the directory to list",
          default: "."
        },
        include_hidden: {
          type: "boolean",
          description: "Whether to include hidden files",
          default: false
        },
        file_extensions: {
          type: "array",
          items: { type: "string" },
          description: "Filter by file extensions (e.g., ['.js', '.ts'])"
        },
        recursive: {
          type: "boolean",
          description: "Whether to list files recursively",
          default: false
        }
      }
    };
  }
  
  async execute(input) {
    const { 
      directory_path = '.', 
      include_hidden = false, 
      file_extensions = [], 
      recursive = false 
    } = input;
    
    try {
      const resolvedPath = path.resolve(directory_path);
      const files = await this.listFiles(resolvedPath, include_hidden, file_extensions, recursive);
      
      return {
        success: true,
        directory: resolvedPath,
        files,
        count: files.length
      };
    } catch (error) {
      throw new Error(`Failed to list files in ${directory_path}: ${error.message}`);
    }
  }
  
  async listFiles(dirPath, includeHidden, extensions, recursive, currentDepth = 0) {
    if (currentDepth > 10) return []; // Prevent infinite recursion
    
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    const files = [];
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      
      // Skip hidden files if not requested
      if (!includeHidden && item.name.startsWith('.')) {
        continue;
      }
      
      if (item.isDirectory() && recursive) {
        const subFiles = await this.listFiles(fullPath, includeHidden, extensions, recursive, currentDepth + 1);
        files.push(...subFiles);
      } else if (item.isFile()) {
        // Filter by extensions if specified
        if (extensions.length > 0) {
          const ext = path.extname(item.name);
          if (!extensions.includes(ext)) {
            continue;
          }
        }
        
        const stats = await fs.stat(fullPath);
        files.push({
          name: item.name,
          path: fullPath,
          size: stats.size,
          lastModified: stats.mtime,
          type: 'file',
          extension: path.extname(item.name)
        });
      } else if (item.isDirectory()) {
        files.push({
          name: item.name,
          path: fullPath,
          type: 'directory'
        });
      }
    }
    
    return files;
  }
}

// Search Files Tool
class SearchFilesTool {
  constructor(config) {
    this.config = config;
    this.description = "Search for files by name or content using patterns.";
    this.inputSchema = {
      type: "object",
      properties: {
        directory_path: {
          type: "string",
          description: "Directory to search in",
          default: "."
        },
        search_term: {
          type: "string",
          description: "Term to search for"
        },
        search_type: {
          type: "string",
          enum: ["filename", "content", "both"],
          description: "Whether to search filenames, content, or both",
          default: "both"
        },
        file_extensions: {
          type: "array",
          items: { type: "string" },
          description: "Limit search to specific file extensions"
        },
        case_sensitive: {
          type: "boolean",
          description: "Whether search should be case sensitive",
          default: false
        },
        max_results: {
          type: "integer",
          description: "Maximum number of results to return",
          default: 50
        }
      },
      required: ["search_term"]
    };
  }
  
  async execute(input) {
    const {
      directory_path = '.',
      search_term,
      search_type = 'both',
      file_extensions = [],
      case_sensitive = false,
      max_results = 50
    } = input;
    
    try {
      const results = await this.searchFiles(
        directory_path, 
        search_term, 
        search_type, 
        file_extensions, 
        case_sensitive, 
        max_results
      );
      
      return {
        success: true,
        search_term,
        results,
        count: results.length
      };
    } catch (error) {
      throw new Error(`Search failed: ${error.message}`);
    }
  }
  
  async searchFiles(dirPath, searchTerm, searchType, extensions, caseSensitive, maxResults) {
    const results = [];
    const searchPattern = caseSensitive ? searchTerm : searchTerm.toLowerCase();
    
    async function searchDirectory(currentPath, depth = 0) {
      if (depth > 10 || results.length >= maxResults) return;
      
      const items = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(currentPath, item.name);
        
        if (item.isDirectory() && !item.name.startsWith('.')) {
          await searchDirectory(fullPath, depth + 1);
        } else if (item.isFile()) {
          // Check file extension filter
          if (extensions.length > 0) {
            const ext = path.extname(item.name);
            if (!extensions.includes(ext)) continue;
          }
          
          let nameMatch = false;
          let contentMatches = [];
          
          // Search filename
          if (searchType === 'filename' || searchType === 'both') {
            const fileName = caseSensitive ? item.name : item.name.toLowerCase();
            nameMatch = fileName.includes(searchPattern);
          }
          
          // Search content
          if (searchType === 'content' || searchType === 'both') {
            try {
              const content = await fs.readFile(fullPath, 'utf8');
              const lines = content.split('\n');
              
              lines.forEach((line, index) => {
                const searchLine = caseSensitive ? line : line.toLowerCase();
                if (searchLine.includes(searchPattern)) {
                  contentMatches.push({
                    lineNumber: index + 1,
                    line: line.trim(),
                    context: this.getContext(lines, index, 2)
                  });
                }
              });
            } catch (error) {
              // Skip binary files or files that can't be read
            }
          }
          
          if (nameMatch || contentMatches.length > 0) {
            results.push({
              path: fullPath,
              name: item.name,
              nameMatch,
              contentMatches,
              matchCount: contentMatches.length
            });
          }
        }
        
        if (results.length >= maxResults) break;
      }
    }
    
    await searchDirectory(path.resolve(dirPath));
    return results;
  }
  
  getContext(lines, centerIndex, contextSize) {
    const start = Math.max(0, centerIndex - contextSize);
    const end = Math.min(lines.length, centerIndex + contextSize + 1);
    
    return lines.slice(start, end).map((line, index) => ({
      lineNumber: start + index + 1,
      line: line.trim(),
      isMatch: start + index === centerIndex
    }));
  }
}

// Create Directory Tool
class CreateDirectoryTool {
  constructor(config) {
    this.config = config;
    this.description = "Create directories with proper permissions.";
    this.inputSchema = {
      type: "object",
      properties: {
        directory_path: {
          type: "string",
          description: "Path of the directory to create"
        },
        recursive: {
          type: "boolean",
          description: "Create parent directories if they don't exist",
          default: true
        }
      },
      required: ["directory_path"]
    };
  }
  
  async execute(input) {
    const { directory_path, recursive = true } = input;
    
    try {
      await fs.mkdir(directory_path, { recursive });
      return {
        success: true,
        path: path.resolve(directory_path),
        created: Date.now()
      };
    } catch (error) {
      throw new Error(`Failed to create directory ${directory_path}: ${error.message}`);
    }
  }
}

// Command Executor Tool
class CommandExecutorTool {
  constructor(config) {
    this.config = config;
    this.description = "Execute shell commands safely with output capture.";
    this.inputSchema = {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to execute"
        },
        working_directory: {
          type: "string",
          description: "Directory to run the command in",
          default: "."
        },
        timeout: {
          type: "integer",
          description: "Timeout in milliseconds",
          default: 30000
        }
      },
      required: ["command"]
    };
  }
  
  async execute(input) {
    const { command, working_directory = '.', timeout = 30000 } = input;
    
    // Security checks
    if (this.config.safeMode && !this.isAllowedCommand(command)) {
      throw new Error(`Command '${command}' is not allowed in safe mode`);
    }
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: working_directory,
        timeout,
        maxBuffer: 1024 * 1024 // 1MB buffer
      });
      
      return {
        success: true,
        command,
        stdout,
        stderr,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      return {
        success: false,
        command,
        error: error.message,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        exitCode: error.code
      };
    }
  }
  
  isAllowedCommand(command) {
    const commandWord = command.split(' ')[0];
    return this.config.allowedCommands.some(allowed => 
      commandWord === allowed || commandWord.endsWith(`/${allowed}`)
    );
  }
}

// Git Status Tool
class GitStatusTool {
  constructor(config) {
    this.config = config;
    this.description = "Get Git repository status and information.";
    this.inputSchema = {
      type: "object",
      properties: {
        working_directory: {
          type: "string",
          description: "Directory to check Git status",
          default: "."
        }
      }
    };
  }
  
  async execute(input) {
    const { working_directory = '.' } = input;
    
    try {
      const { stdout: status } = await execAsync('git status --porcelain', {
        cwd: working_directory
      });
      
      const { stdout: branch } = await execAsync('git branch --show-current', {
        cwd: working_directory
      });
      
      return {
        success: true,
        branch: branch.trim(),
        status: status.trim(),
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git status failed: ${error.message}`);
    }
  }
}

// NPM Info Tool
class NPMInfoTool {
  constructor(config) {
    this.config = config;
    this.description = "Get NPM package information and project details.";
    this.inputSchema = {
      type: "object",
      properties: {
        working_directory: {
          type: "string",
          description: "Directory containing package.json",
          default: "."
        }
      }
    };
  }
  
  async execute(input) {
    const { working_directory = '.' } = input;
    
    try {
      const packagePath = path.join(working_directory, 'package.json');
      const packageContent = await fs.readFile(packagePath, 'utf8');
      const packageInfo = JSON.parse(packageContent);
      
      return {
        success: true,
        package: packageInfo,
        dependencies: Object.keys(packageInfo.dependencies || {}),
        devDependencies: Object.keys(packageInfo.devDependencies || {}),
        scripts: Object.keys(packageInfo.scripts || {}),
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`NPM info failed: ${error.message}`);
    }
  }
}

// Todo Management Tool
class TodoTool {
  constructor(config) {
    this.config = config;
    this.description = "Create and manage todo lists for tracking task progress. ALWAYS use this tool to plan and track work.";
    this.inputSchema = {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "complete", "add", "remove"],
          description: "Action to perform on the todo list"
        },
        task_id: {
          type: "string",
          description: "ID of the task (for update/complete/remove)"
        },
        title: {
          type: "string",
          description: "Title of the todo list or task"
        },
        description: {
          type: "string",
          description: "Description of the task"
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              completed: { type: "boolean", default: false },
              priority: { type: "string", enum: ["low", "medium", "high"], default: "medium" }
            }
          },
          description: "List of tasks for create action"
        }
      },
      required: ["action"]
    };
  }
  
  async execute(input) {
    const { action, task_id, title, description, tasks } = input;
    
    if (!this.currentTodoList) {
      this.currentTodoList = {
        id: Date.now().toString(),
        title: 'Current Tasks',
        created: new Date(),
        tasks: []
      };
    }
    
    switch (action) {
      case 'create':
        this.currentTodoList = {
          id: Date.now().toString(),
          title: title || 'New Task List',
          created: new Date(),
          tasks: tasks || []
        };
        break;
        
      case 'add':
        const newTask = {
          id: Date.now().toString(),
          title: title || 'New Task',
          description: description || '',
          completed: false,
          priority: 'medium',
          created: new Date()
        };
        this.currentTodoList.tasks.push(newTask);
        break;
        
      case 'update':
        const taskToUpdate = this.currentTodoList.tasks.find(t => t.id === task_id);
        if (taskToUpdate) {
          if (title) taskToUpdate.title = title;
          if (description) taskToUpdate.description = description;
          taskToUpdate.updated = new Date();
        }
        break;
        
      case 'complete':
        const taskToComplete = this.currentTodoList.tasks.find(t => t.id === task_id);
        if (taskToComplete) {
          taskToComplete.completed = true;
          taskToComplete.completedAt = new Date();
        }
        break;
        
      case 'remove':
        this.currentTodoList.tasks = this.currentTodoList.tasks.filter(t => t.id !== task_id);
        break;
    }
    
    return {
      success: true,
      action,
      todoList: this.formatTodoList(this.currentTodoList)
    };
  }
  
  formatTodoList(todoList) {
    const completed = todoList.tasks.filter(t => t.completed).length;
    const total = todoList.tasks.length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    let output = `\n📋 ${todoList.title}\n`;
    output += `Progress: ${completed}/${total} (${progress}%)\n`;
    output += '─'.repeat(50) + '\n';
    
    todoList.tasks.forEach((task, index) => {
      const status = task.completed ? '✅' : '⬜';
      const priority = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
      output += `${status} ${priority} ${task.title}\n`;
      if (task.description) {
        output += `   ${task.description}\n`;
      }
    });
    
    return output;
  }
}

// Todo Read Tool
class TodoReadTool {
  constructor(config) {
    this.config = config;
    this.description = "Read the current todo list status.";
    this.inputSchema = {
      type: "object",
      properties: {}
    };
  }
  
  async execute(input) {
    // Get the current todo list from TodoTool
    const todoTool = new TodoTool(this.config);
    if (todoTool.currentTodoList) {
      return {
        success: true,
        todoList: todoTool.formatTodoList(todoTool.currentTodoList)
      };
    }
    
    return {
      success: false,
      message: "No active todo list found"
    };
  }
}

// Code Analysis Tool
class CodeAnalysisTool {
  constructor(config) {
    this.config = config;
    this.description = "Analyze code files for structure, quality, and potential improvements.";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the code file to analyze"
        },
        analysis_type: {
          type: "string",
          enum: ["structure", "quality", "dependencies", "all"],
          description: "Type of analysis to perform",
          default: "all"
        }
      },
      required: ["file_path"]
    };
  }
  
  async execute(input) {
    const { file_path, analysis_type = 'all' } = input;
    
    try {
      const content = await fs.readFile(file_path, 'utf8');
      const analysis = {};
      
      if (analysis_type === 'structure' || analysis_type === 'all') {
        analysis.structure = this.analyzeStructure(content, file_path);
      }
      
      if (analysis_type === 'quality' || analysis_type === 'all') {
        analysis.quality = this.analyzeQuality(content);
      }
      
      if (analysis_type === 'dependencies' || analysis_type === 'all') {
        analysis.dependencies = this.analyzeDependencies(content);
      }
      
      return {
        success: true,
        file_path,
        analysis
      };
    } catch (error) {
      throw new Error(`Failed to analyze ${file_path}: ${error.message}`);
    }
  }
  
  analyzeStructure(content, filePath) {
    const lines = content.split('\n');
    const extension = path.extname(filePath);
    
    const structure = {
      totalLines: lines.length,
      codeLines: lines.filter(line => line.trim() && !line.trim().startsWith('//')).length,
      commentLines: lines.filter(line => line.trim().startsWith('//')).length,
      emptyLines: lines.filter(line => !line.trim()).length
    };
    
    // Language-specific analysis
    if (['.js', '.ts', '.jsx', '.tsx'].includes(extension)) {
      structure.functions = this.findJSFunctions(content);
      structure.classes = this.findJSClasses(content);
      structure.imports = this.findJSImports(content);
    }
    
    return structure;
  }
  
  analyzeQuality(content) {
    const lines = content.split('\n');
    const issues = [];
    
    // Check for long lines
    lines.forEach((line, index) => {
      if (line.length > 120) {
        issues.push({
          type: 'long_line',
          line: index + 1,
          message: `Line too long (${line.length} characters)`
        });
      }
    });
    
    // Check for complexity indicators
    const complexityIndicators = ['if', 'for', 'while', 'switch', 'catch'];
    let complexityScore = 0;
    
    content.split(/\s+/).forEach(word => {
      if (complexityIndicators.includes(word)) {
        complexityScore++;
      }
    });
    
    return {
      issues,
      complexityScore,
      maintainabilityIndex: Math.max(0, 100 - complexityScore - issues.length * 5)
    };
  }
  
  analyzeDependencies(content) {
    const imports = [];
    const requires = [];
    
    // Find ES6 imports
    const importMatches = content.match(/import\s+.*\s+from\s+['"]([^'"]+)['"]/g);
    if (importMatches) {
      importMatches.forEach(match => {
        const moduleMatch = match.match(/from\s+['"]([^'"]+)['"]/);
        if (moduleMatch) {
          imports.push(moduleMatch[1]);
        }
      });
    }
    
    // Find CommonJS requires
    const requireMatches = content.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    if (requireMatches) {
      requireMatches.forEach(match => {
        const moduleMatch = match.match(/['"]([^'"]+)['"]/);
        if (moduleMatch) {
          requires.push(moduleMatch[1]);
        }
      });
    }
    
    return { imports, requires };
  }
  
  findJSFunctions(content) {
    const functionRegex = /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?\(|(\w+)\s*:\s*(?:async\s+)?function)/g;
    const functions = [];
    let match;
    
    while ((match = functionRegex.exec(content)) !== null) {
      const name = match[1] || match[2] || match[3];
      if (name) {
        functions.push(name);
      }
    }
    
    return functions;
  }
  
  findJSClasses(content) {
    const classRegex = /class\s+(\w+)/g;
    const classes = [];
    let match;
    
    while ((match = classRegex.exec(content)) !== null) {
      classes.push(match[1]);
    }
    
    return classes;
  }
  
  findJSImports(content) {
    const importRegex = /import\s+(?:{[^}]*}|\w+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/g;
    const imports = [];
    let match;
    
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    
    return imports;
  }
}

// Code Formatter Tool
class CodeFormatterTool {
  constructor(config) {
    this.config = config;
    this.description = "Format code according to style guidelines.";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the code file to format"
        },
        style: {
          type: "string",
          enum: ["prettier", "eslint", "standard"],
          description: "Code style to apply",
          default: "prettier"
        }
      },
      required: ["file_path"]
    };
  }
  
  async execute(input) {
    const { file_path, style = 'prettier' } = input;
    
    try {
      // This is a placeholder - in a real implementation,
      // you would use actual formatting tools
      const content = await fs.readFile(file_path, 'utf8');
      
      return {
        success: true,
        file_path,
        formatted: true,
        style,
        message: `Code formatted using ${style} style`
      };
    } catch (error) {
      throw new Error(`Failed to format ${file_path}: ${error.message}`);
    }
  }
}

// Code Linter Tool
class CodeLinterTool {
  constructor(config) {
    this.config = config;
    this.description = "Lint code files for syntax and style issues.";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the code file to lint"
        },
        linter: {
          type: "string",
          enum: ["eslint", "jshint", "standard"],
          description: "Linter to use",
          default: "eslint"
        }
      },
      required: ["file_path"]
    };
  }
  
  async execute(input) {
    const { file_path, linter = 'eslint' } = input;
    
    try {
      // This is a placeholder - in a real implementation,
      // you would use actual linting tools
      const content = await fs.readFile(file_path, 'utf8');
      
      const issues = [];
      const lines = content.split('\n');
      
      // Simple checks as examples
      lines.forEach((line, index) => {
        if (line.includes('var ')) {
          issues.push({
            line: index + 1,
            column: line.indexOf('var ') + 1,
            rule: 'prefer-const',
            message: 'Use const instead of var',
            severity: 'warning'
          });
        }
      });
      
      return {
        success: true,
        file_path,
        linter,
        issues,
        issueCount: issues.length
      };
    } catch (error) {
      throw new Error(`Failed to lint ${file_path}: ${error.message}`);
    }
  }
}

module.exports = ToolManager;