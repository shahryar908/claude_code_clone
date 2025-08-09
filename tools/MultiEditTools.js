const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');

class MultiEditManager {
  constructor(config = {}) {
    this.config = {
      safeMode: true,
      backupFiles: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 50,
      ...config
    };
    
    this.tools = new Map();
    this.registerMultiEditTools();
  }
  
  registerMultiEditTools() {
    // Multi-file operations
    this.registerTool('multi_edit', new MultiEditTool(this.config));
    this.registerTool('batch_find_replace', new BatchFindReplaceTool(this.config));
    this.registerTool('multi_file_refactor', new MultiFileRefactorTool(this.config));
    this.registerTool('project_wide_rename', new ProjectWideRenameTool(this.config));
    this.registerTool('apply_template', new ApplyTemplateTool(this.config));
    
    console.log(`🔧 Registered ${this.tools.size} multi-edit tools`);
  }
  
  registerTool(name, tool) {
    if (!tool.execute || typeof tool.execute !== 'function') {
      throw new Error(`Multi-edit tool ${name} must have an execute method`);
    }
    
    this.tools.set(name, tool);
  }
  
  async executeTool(name, input) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Multi-edit tool '${name}' not found`);
    }
    
    return await tool.execute(input);
  }
  
  getToolDefinitions() {
    return Array.from(this.tools.entries()).map(([name, tool]) => ({
      name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));
  }
}

// Multi Edit Tool - Edit multiple files in one operation
class MultiEditTool {
  constructor(config) {
    this.config = config;
    this.description = "Edit multiple files in a single operation with support for different edit types";
    this.inputSchema = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: "Path to the file to edit"
              },
              edit_type: {
                type: "string",
                enum: ["replace", "insert", "append", "prepend", "delete_lines"],
                description: "Type of edit to perform"
              },
              target: {
                type: "string",
                description: "Target text to find (for replace) or line number (for insert)"
              },
              replacement: {
                type: "string",
                description: "New text to insert or replace with"
              },
              line_number: {
                type: "integer",
                description: "Line number for line-based operations"
              },
              create_if_missing: {
                type: "boolean",
                description: "Create file if it doesn't exist",
                default: false
              }
            },
            required: ["file_path", "edit_type"]
          },
          description: "Array of edit operations to perform"
        },
        backup: {
          type: "boolean",
          description: "Create backup files before editing",
          default: true
        },
        dry_run: {
          type: "boolean",
          description: "Show what would be changed without making actual changes",
          default: false
        }
      },
      required: ["edits"]
    };
  }
  
  async execute(input) {
    const { edits, backup = true, dry_run = false } = input;
    
    if (edits.length > this.config.maxFiles) {
      throw new Error(`Too many files to edit (${edits.length}). Maximum allowed: ${this.config.maxFiles}`);
    }
    
    const results = [];
    const backups = [];
    
    try {
      for (const edit of edits) {
        const editResult = await this.performEdit(edit, backup, dry_run);
        results.push(editResult);
        
        if (editResult.backup_path) {
          backups.push(editResult.backup_path);
        }
      }
      
      return {
        success: true,
        dry_run,
        total_files: edits.length,
        results,
        backups: backup ? backups : [],
        summary: this.createSummary(results)
      };
    } catch (error) {
      // If any edit fails, restore from backups if they exist
      if (backup && backups.length > 0) {
        await this.restoreFromBackups(backups);
      }
      throw error;
    }
  }
  
  async performEdit(edit, backup, dry_run) {
    const { file_path, edit_type, target, replacement, line_number, create_if_missing = false } = edit;
    
    // Check if file exists
    const fileExists = await this.fileExists(file_path);
    if (!fileExists && !create_if_missing) {
      throw new Error(`File ${file_path} does not exist`);
    }
    
    let content = '';
    let backup_path = null;
    
    if (fileExists) {
      // Read current content
      const stats = await fs.stat(file_path);
      if (stats.size > this.config.maxFileSize) {
        throw new Error(`File ${file_path} is too large (${stats.size} bytes)`);
      }
      
      content = await fs.readFile(file_path, 'utf8');
      
      // Create backup if requested and not dry run
      if (backup && !dry_run) {
        backup_path = `${file_path}.backup.${Date.now()}`;
        await fs.writeFile(backup_path, content);
      }
    }
    
    // Perform the edit
    let newContent;
    let changeDetails;
    
    switch (edit_type) {
      case 'replace':
        ({ content: newContent, details: changeDetails } = this.performReplace(content, target, replacement));
        break;
      case 'insert':
        ({ content: newContent, details: changeDetails } = this.performInsert(content, line_number, replacement));
        break;
      case 'append':
        newContent = content + (content.endsWith('\n') ? '' : '\n') + replacement;
        changeDetails = { added_lines: replacement.split('\n').length };
        break;
      case 'prepend':
        newContent = replacement + (replacement.endsWith('\n') ? '' : '\n') + content;
        changeDetails = { added_lines: replacement.split('\n').length };
        break;
      case 'delete_lines':
        ({ content: newContent, details: changeDetails } = this.performDeleteLines(content, line_number, parseInt(target) || 1));
        break;
      default:
        throw new Error(`Unknown edit type: ${edit_type}`);
    }
    
    // Write the new content (unless dry run)
    if (!dry_run) {
      await fs.writeFile(file_path, newContent);
    }
    
    return {
      file_path: path.resolve(file_path),
      edit_type,
      success: true,
      backup_path,
      changes: changeDetails,
      size_change: newContent.length - content.length,
      created: !fileExists && create_if_missing
    };
  }
  
  performReplace(content, target, replacement) {
    const originalLength = content.length;
    const newContent = content.replaceAll(target, replacement);
    const replacements = (originalLength - newContent.length + (replacement.length * content.split(target).length - 1)) / (target.length - replacement.length);
    
    return {
      content: newContent,
      details: {
        replacements_made: content.split(target).length - 1,
        target_length: target.length,
        replacement_length: replacement.length
      }
    };
  }
  
  performInsert(content, lineNumber, text) {
    const lines = content.split('\n');
    const insertIndex = Math.max(0, Math.min(lineNumber - 1, lines.length));
    
    lines.splice(insertIndex, 0, text);
    
    return {
      content: lines.join('\n'),
      details: {
        inserted_at_line: insertIndex + 1,
        lines_added: text.split('\n').length
      }
    };
  }
  
  performDeleteLines(content, startLine, numLines) {
    const lines = content.split('\n');
    const startIndex = Math.max(0, startLine - 1);
    const endIndex = Math.min(lines.length, startIndex + numLines);
    
    const deletedLines = lines.splice(startIndex, endIndex - startIndex);
    
    return {
      content: lines.join('\n'),
      details: {
        deleted_lines: deletedLines.length,
        start_line: startLine,
        deleted_content: deletedLines.join('\n')
      }
    };
  }
  
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  createSummary(results) {
    const summary = {
      successful: 0,
      failed: 0,
      created: 0,
      total_size_change: 0,
      edit_types: {}
    };
    
    for (const result of results) {
      if (result.success) {
        summary.successful++;
        if (result.created) summary.created++;
        summary.total_size_change += result.size_change;
        
        const editType = result.edit_type;
        summary.edit_types[editType] = (summary.edit_types[editType] || 0) + 1;
      } else {
        summary.failed++;
      }
    }
    
    return summary;
  }
  
  async restoreFromBackups(backupPaths) {
    for (const backupPath of backupPaths) {
      try {
        const originalPath = backupPath.replace(/\.backup\.\d+$/, '');
        const backupContent = await fs.readFile(backupPath, 'utf8');
        await fs.writeFile(originalPath, backupContent);
      } catch (error) {
        console.error(`Failed to restore from backup ${backupPath}: ${error.message}`);
      }
    }
  }
}

// Batch Find and Replace Tool
class BatchFindReplaceTool {
  constructor(config) {
    this.config = config;
    this.description = "Find and replace text across multiple files with pattern support";
    this.inputSchema = {
      type: "object",
      properties: {
        find: {
          type: "string",
          description: "Text or regex pattern to find"
        },
        replace: {
          type: "string",
          description: "Replacement text"
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "List of file paths to process"
        },
        glob_pattern: {
          type: "string",
          description: "Glob pattern to match files (alternative to files array)"
        },
        use_regex: {
          type: "boolean",
          description: "Treat find pattern as regular expression",
          default: false
        },
        case_sensitive: {
          type: "boolean",
          description: "Case sensitive search",
          default: true
        },
        whole_word_only: {
          type: "boolean",
          description: "Match whole words only",
          default: false
        },
        backup: {
          type: "boolean",
          description: "Create backup files",
          default: true
        },
        dry_run: {
          type: "boolean",
          description: "Preview changes without applying them",
          default: false
        }
      },
      required: ["find", "replace"]
    };
  }
  
  async execute(input) {
    const { 
      find, 
      replace, 
      files, 
      glob_pattern,
      use_regex = false, 
      case_sensitive = true,
      whole_word_only = false,
      backup = true,
      dry_run = false 
    } = input;
    
    // Get list of files to process
    let fileList = [];
    if (files) {
      fileList = files;
    } else if (glob_pattern) {
      fileList = await this.getFilesFromGlob(glob_pattern);
    } else {
      throw new Error('Either files array or glob_pattern must be provided');
    }
    
    if (fileList.length > this.config.maxFiles) {
      throw new Error(`Too many files to process (${fileList.length}). Maximum: ${this.config.maxFiles}`);
    }
    
    // Create search pattern
    let searchPattern;
    if (use_regex) {
      const flags = case_sensitive ? 'g' : 'gi';
      searchPattern = new RegExp(find, flags);
    } else {
      let escapedFind = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (whole_word_only) {
        escapedFind = `\\b${escapedFind}\\b`;
      }
      const flags = case_sensitive ? 'g' : 'gi';
      searchPattern = new RegExp(escapedFind, flags);
    }
    
    const results = [];
    const backups = [];
    
    for (const filePath of fileList) {
      try {
        const result = await this.processFile(filePath, searchPattern, replace, backup, dry_run);
        results.push(result);
        
        if (result.backup_path) {
          backups.push(result.backup_path);
        }
      } catch (error) {
        results.push({
          file_path: filePath,
          success: false,
          error: error.message
        });
      }
    }
    
    return {
      success: true,
      dry_run,
      find_pattern: find,
      replace_text: replace,
      total_files: fileList.length,
      results,
      backups: backup ? backups : [],
      summary: this.createFindReplaceSummary(results)
    };
  }
  
  async processFile(filePath, searchPattern, replace, backup, dry_run) {
    const content = await fs.readFile(filePath, 'utf8');
    
    // Find matches
    const matches = content.match(searchPattern) || [];
    if (matches.length === 0) {
      return {
        file_path: path.resolve(filePath),
        success: true,
        matches: 0,
        changed: false
      };
    }
    
    // Create backup if needed
    let backup_path = null;
    if (backup && !dry_run) {
      backup_path = `${filePath}.backup.${Date.now()}`;
      await fs.writeFile(backup_path, content);
    }
    
    // Perform replacement
    const newContent = content.replace(searchPattern, replace);
    
    // Write new content if not dry run
    if (!dry_run) {
      await fs.writeFile(filePath, newContent);
    }
    
    return {
      file_path: path.resolve(filePath),
      success: true,
      matches: matches.length,
      changed: true,
      backup_path,
      size_change: newContent.length - content.length,
      preview: dry_run ? this.createPreview(content, newContent, searchPattern) : null
    };
  }
  
  createPreview(oldContent, newContent, pattern) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const changes = [];
    
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      const oldLine = oldLines[i] || '';
      const newLine = newLines[i] || '';
      
      if (oldLine !== newLine) {
        changes.push({
          line_number: i + 1,
          old: oldLine,
          new: newLine,
          has_match: pattern.test(oldLine)
        });
      }
    }
    
    return changes.slice(0, 10); // Limit preview to first 10 changes
  }
  
  async getFilesFromGlob(globPattern) {
    // Simple glob implementation - for now, find files in current directory
    // In production, use a proper glob library like 'fast-glob'
    try {
      const files = [];
      const scanDirectory = async (dir, pattern) => {
        const items = await fs.readdir(dir, { withFileTypes: true });
        
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          
          if (item.isDirectory() && !item.name.startsWith('.')) {
            await scanDirectory(fullPath, pattern);
          } else if (item.isFile()) {
            // Simple pattern matching - supports basic wildcards
            if (this.matchesPattern(item.name, pattern)) {
              files.push(fullPath);
            }
          }
        }
      };
      
      await scanDirectory(process.cwd(), globPattern);
      return files;
    } catch (error) {
      console.warn(`Glob pattern matching failed: ${error.message}`);
      return [];
    }
  }
  
  matchesPattern(filename, pattern) {
    // Convert simple glob pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\{([^}]+)\}/g, '($1)')
      .replace(/,/g, '|');
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filename);
  }
  
  createFindReplaceSummary(results) {
    const summary = {
      files_processed: results.length,
      files_changed: 0,
      files_unchanged: 0,
      total_matches: 0,
      errors: 0,
      total_size_change: 0
    };
    
    for (const result of results) {
      if (result.success) {
        if (result.changed) {
          summary.files_changed++;
          summary.total_matches += result.matches || 0;
          summary.total_size_change += result.size_change || 0;
        } else {
          summary.files_unchanged++;
        }
      } else {
        summary.errors++;
      }
    }
    
    return summary;
  }
}

// Multi-file Refactor Tool
class MultiFileRefactorTool {
  constructor(config) {
    this.config = config;
    this.description = "Perform coordinated refactoring operations across multiple files";
    this.inputSchema = {
      type: "object",
      properties: {
        refactor_type: {
          type: "string",
          enum: ["rename_function", "extract_function", "move_function", "update_imports"],
          description: "Type of refactoring to perform"
        },
        target: {
          type: "string",
          description: "Target element to refactor (function name, etc.)"
        },
        new_name: {
          type: "string", 
          description: "New name for rename operations"
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Files involved in the refactoring"
        },
        backup: {
          type: "boolean",
          description: "Create backup files",
          default: true
        },
        dry_run: {
          type: "boolean",
          description: "Preview changes without applying them",
          default: false
        }
      },
      required: ["refactor_type", "target", "files"]
    };
  }
  
  async execute(input) {
    const { refactor_type, target, new_name, files, backup = true, dry_run = false } = input;
    
    const results = [];
    
    switch (refactor_type) {
      case 'rename_function':
        if (!new_name) throw new Error('new_name required for rename_function');
        return await this.renameFunctionAcrossFiles(target, new_name, files, backup, dry_run);
      
      case 'update_imports':
        return await this.updateImportsAcrossFiles(target, new_name, files, backup, dry_run);
      
      default:
        throw new Error(`Refactor type ${refactor_type} not yet implemented`);
    }
  }
  
  async renameFunctionAcrossFiles(oldName, newName, files, backup, dry_run) {
    const results = [];
    
    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const patterns = [
          new RegExp(`function\\s+${oldName}\\b`, 'g'),
          new RegExp(`const\\s+${oldName}\\s*=`, 'g'),
          new RegExp(`${oldName}\\s*:`, 'g'),
          new RegExp(`${oldName}\\(`, 'g')
        ];
        
        let newContent = content;
        let changes = 0;
        
        patterns.forEach(pattern => {
          const matches = newContent.match(pattern);
          if (matches) {
            changes += matches.length;
            newContent = newContent.replace(pattern, match => 
              match.replace(oldName, newName)
            );
          }
        });
        
        if (changes > 0) {
          if (backup && !dry_run) {
            const backupPath = `${filePath}.backup.${Date.now()}`;
            await fs.writeFile(backupPath, content);
          }
          
          if (!dry_run) {
            await fs.writeFile(filePath, newContent);
          }
        }
        
        results.push({
          file_path: path.resolve(filePath),
          success: true,
          changes_made: changes,
          changed: changes > 0
        });
        
      } catch (error) {
        results.push({
          file_path: filePath,
          success: false,
          error: error.message
        });
      }
    }
    
    return {
      success: true,
      refactor_type: 'rename_function',
      old_name: oldName,
      new_name: newName,
      dry_run,
      results,
      summary: this.createRefactorSummary(results)
    };
  }
  
  async updateImportsAcrossFiles(oldImport, newImport, files, backup, dry_run) {
    const results = [];
    
    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const patterns = [
          new RegExp(`import.*${oldImport}.*from`, 'g'),
          new RegExp(`require\\(['"].*${oldImport}.*['"]\\)`, 'g')
        ];
        
        let newContent = content;
        let changes = 0;
        
        patterns.forEach(pattern => {
          if (pattern.test(newContent)) {
            changes++;
            newContent = newContent.replace(pattern, match => 
              match.replace(oldImport, newImport)
            );
          }
        });
        
        if (changes > 0) {
          if (backup && !dry_run) {
            const backupPath = `${filePath}.backup.${Date.now()}`;
            await fs.writeFile(backupPath, content);
          }
          
          if (!dry_run) {
            await fs.writeFile(filePath, newContent);
          }
        }
        
        results.push({
          file_path: path.resolve(filePath),
          success: true,
          changes_made: changes,
          changed: changes > 0
        });
        
      } catch (error) {
        results.push({
          file_path: filePath,
          success: false,
          error: error.message
        });
      }
    }
    
    return {
      success: true,
      refactor_type: 'update_imports',
      old_import: oldImport,
      new_import: newImport,
      dry_run,
      results,
      summary: this.createRefactorSummary(results)
    };
  }
  
  createRefactorSummary(results) {
    const summary = {
      files_processed: results.length,
      files_changed: 0,
      total_changes: 0,
      errors: 0
    };
    
    for (const result of results) {
      if (result.success) {
        if (result.changed) {
          summary.files_changed++;
          summary.total_changes += result.changes_made || 0;
        }
      } else {
        summary.errors++;
      }
    }
    
    return summary;
  }
}

// Project-wide Rename Tool
class ProjectWideRenameTool {
  constructor(config) {
    this.config = config;
    this.description = "Rename variables, functions, or classes across an entire project";
    this.inputSchema = {
      type: "object",
      properties: {
        old_name: {
          type: "string",
          description: "Current name to rename"
        },
        new_name: {
          type: "string",
          description: "New name"
        },
        project_root: {
          type: "string",
          description: "Root directory of the project",
          default: "."
        },
        file_extensions: {
          type: "array",
          items: { type: "string" },
          description: "File extensions to include",
          default: [".js", ".ts", ".jsx", ".tsx"]
        },
        exclude_patterns: {
          type: "array",
          items: { type: "string" },
          description: "Patterns to exclude (node_modules, etc.)",
          default: ["node_modules", ".git", "dist", "build"]
        },
        backup: {
          type: "boolean",
          description: "Create backup files",
          default: true
        },
        dry_run: {
          type: "boolean",
          description: "Preview changes without applying them",
          default: false
        }
      },
      required: ["old_name", "new_name"]
    };
  }
  
  async execute(input) {
    const { 
      old_name, 
      new_name, 
      project_root = '.', 
      file_extensions = ['.js', '.ts', '.jsx', '.tsx'],
      exclude_patterns = ['node_modules', '.git', 'dist', 'build'],
      backup = true,
      dry_run = false 
    } = input;
    
    // Find all relevant files in the project
    const files = await this.findProjectFiles(project_root, file_extensions, exclude_patterns);
    
    if (files.length > this.config.maxFiles) {
      throw new Error(`Project too large (${files.length} files). Maximum: ${this.config.maxFiles}`);
    }
    
    // Use the batch find/replace tool for the actual renaming
    const findReplaceTool = new BatchFindReplaceTool(this.config);
    
    return await findReplaceTool.execute({
      find: old_name,
      replace: new_name,
      files,
      whole_word_only: true,
      backup,
      dry_run
    });
  }
  
  async findProjectFiles(rootDir, extensions, excludePatterns) {
    const files = [];
    
    async function scanDirectory(dir) {
      const items = await fs.readdir(dir, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        
        // Skip excluded patterns
        if (excludePatterns.some(pattern => item.name.includes(pattern))) {
          continue;
        }
        
        if (item.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (item.isFile()) {
          const ext = path.extname(item.name);
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    }
    
    await scanDirectory(path.resolve(rootDir));
    return files;
  }
}

// Apply Template Tool
class ApplyTemplateTool {
  constructor(config) {
    this.config = config;
    this.description = "Apply code templates to multiple files with variable substitution";
    this.inputSchema = {
      type: "object",
      properties: {
        template: {
          type: "string",
          description: "Template content with {{variable}} placeholders"
        },
        variables: {
          type: "object",
          description: "Variables to substitute in the template"
        },
        target_files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file_path: { type: "string" },
              variables: { type: "object" }
            }
          },
          description: "Files to apply template to with per-file variables"
        },
        mode: {
          type: "string",
          enum: ["replace", "append", "prepend", "insert_at_line"],
          description: "How to apply the template",
          default: "replace"
        },
        line_number: {
          type: "integer",
          description: "Line number for insert_at_line mode"
        },
        backup: {
          type: "boolean",
          description: "Create backup files",
          default: true
        },
        dry_run: {
          type: "boolean",
          description: "Preview changes without applying them",
          default: false
        }
      },
      required: ["template", "target_files"]
    };
  }
  
  async execute(input) {
    const { 
      template, 
      variables = {}, 
      target_files, 
      mode = 'replace',
      line_number,
      backup = true,
      dry_run = false 
    } = input;
    
    const results = [];
    
    for (const target of target_files) {
      try {
        // Merge global and per-file variables
        const fileVariables = { ...variables, ...target.variables };
        
        // Process template with variables
        const processedTemplate = this.processTemplate(template, fileVariables);
        
        // Apply to file based on mode
        const result = await this.applyTemplateToFile(
          target.file_path,
          processedTemplate,
          mode,
          line_number,
          backup,
          dry_run
        );
        
        results.push(result);
        
      } catch (error) {
        results.push({
          file_path: target.file_path,
          success: false,
          error: error.message
        });
      }
    }
    
    return {
      success: true,
      mode,
      dry_run,
      total_files: target_files.length,
      results,
      summary: this.createTemplateSummary(results)
    };
  }
  
  processTemplate(template, variables) {
    return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      return variables[varName] !== undefined ? variables[varName] : match;
    });
  }
  
  async applyTemplateToFile(filePath, processedTemplate, mode, lineNumber, backup, dry_run) {
    let content = '';
    let fileExists = true;
    
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        fileExists = false;
        content = '';
      } else {
        throw error;
      }
    }
    
    // Create backup if file exists and backup is requested
    let backup_path = null;
    if (fileExists && backup && !dry_run) {
      backup_path = `${filePath}.backup.${Date.now()}`;
      await fs.writeFile(backup_path, content);
    }
    
    // Apply template based on mode
    let newContent;
    switch (mode) {
      case 'replace':
        newContent = processedTemplate;
        break;
      case 'append':
        newContent = content + (content.endsWith('\n') ? '' : '\n') + processedTemplate;
        break;
      case 'prepend':
        newContent = processedTemplate + (processedTemplate.endsWith('\n') ? '' : '\n') + content;
        break;
      case 'insert_at_line':
        if (lineNumber === undefined) throw new Error('line_number required for insert_at_line mode');
        const lines = content.split('\n');
        lines.splice(lineNumber - 1, 0, processedTemplate);
        newContent = lines.join('\n');
        break;
      default:
        throw new Error(`Unknown template mode: ${mode}`);
    }
    
    // Write new content if not dry run
    if (!dry_run) {
      await fs.writeFile(filePath, newContent);
    }
    
    return {
      file_path: path.resolve(filePath),
      success: true,
      mode,
      backup_path,
      size_change: newContent.length - content.length,
      created: !fileExists
    };
  }
  
  createTemplateSummary(results) {
    const summary = {
      files_processed: results.length,
      files_changed: 0,
      files_created: 0,
      errors: 0,
      total_size_change: 0
    };
    
    for (const result of results) {
      if (result.success) {
        summary.files_changed++;
        if (result.created) summary.files_created++;
        summary.total_size_change += result.size_change || 0;
      } else {
        summary.errors++;
      }
    }
    
    return summary;
  }
}

module.exports = {
  MultiEditManager,
  MultiEditTool,
  BatchFindReplaceTool,
  MultiFileRefactorTool,
  ProjectWideRenameTool,
  ApplyTemplateTool
};