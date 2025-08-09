const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');

class NavigationManager {
  constructor(config = {}) {
    this.config = {
      safeMode: true,
      maxResults: 100,
      maxFileSize: 5 * 1024 * 1024, // 5MB
      recentFilesLimit: 50,
      excludePatterns: [
        'node_modules',
        '.git',
        '.vscode',
        '.idea',
        'dist',
        'build',
        'coverage',
        'logs',
        '*.log',
        '.DS_Store'
      ],
      ...config
    };
    
    this.tools = new Map();
    this.recentFiles = [];
    this.projectCache = new Map();
    this.registerNavigationTools();
  }
  
  registerNavigationTools() {
    // File navigation tools
    this.registerTool('find_files', new FindFilesTool(this.config));
    this.registerTool('search_in_files', new SearchInFilesTool(this.config));
    this.registerTool('goto_definition', new GotoDefinitionTool(this.config));
    this.registerTool('find_references', new FindReferencesTool(this.config));
    this.registerTool('recent_files', new RecentFilesTool(this.config));
    this.registerTool('project_tree', new ProjectTreeTool(this.config));
    this.registerTool('file_outline', new FileOutlineTool(this.config));
    this.registerTool('fuzzy_find', new FuzzyFindTool(this.config));
    
    console.log(`🔧 Registered ${this.tools.size} navigation tools`);
  }
  
  registerTool(name, tool) {
    if (!tool.execute || typeof tool.execute !== 'function') {
      throw new Error(`Navigation tool ${name} must have an execute method`);
    }
    
    this.tools.set(name, tool);
  }
  
  async executeTool(name, input) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Navigation tool '${name}' not found`);
    }
    
    const result = await tool.execute(input);
    
    // Track recent files accessed
    if (result.success && result.file_path) {
      this.addToRecentFiles(result.file_path);
    }
    
    return result;
  }
  
  getToolDefinitions() {
    return Array.from(this.tools.entries()).map(([name, tool]) => ({
      name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));
  }
  
  addToRecentFiles(filePath) {
    const absolutePath = path.resolve(filePath);
    this.recentFiles = this.recentFiles.filter(f => f !== absolutePath);
    this.recentFiles.unshift(absolutePath);
    
    if (this.recentFiles.length > this.config.recentFilesLimit) {
      this.recentFiles = this.recentFiles.slice(0, this.config.recentFilesLimit);
    }
  }
  
  getRecentFiles() {
    return this.recentFiles;
  }
}

// Find Files Tool - Search for files by name pattern
class FindFilesTool {
  constructor(config) {
    this.config = config;
    this.description = "Find files by name pattern with fuzzy matching support";
    this.inputSchema = {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "File name pattern to search for"
        },
        directory: {
          type: "string",
          description: "Directory to search in",
          default: "."
        },
        fuzzy: {
          type: "boolean",
          description: "Enable fuzzy matching",
          default: true
        },
        extensions: {
          type: "array",
          items: { type: "string" },
          description: "Filter by file extensions"
        },
        max_results: {
          type: "integer",
          description: "Maximum number of results",
          default: 50
        }
      },
      required: ["pattern"]
    };
  }
  
  async execute(input) {
    const { 
      pattern, 
      directory = '.', 
      fuzzy = true, 
      extensions = [],
      max_results = 50 
    } = input;
    
    try {
      const files = await this.findFiles(directory, pattern, fuzzy, extensions, max_results);
      
      return {
        success: true,
        pattern,
        directory: path.resolve(directory),
        fuzzy,
        total_found: files.length,
        files: files.slice(0, max_results)
      };
    } catch (error) {
      throw new Error(`Find files failed: ${error.message}`);
    }
  }
  
  async findFiles(startDir, pattern, fuzzy, extensions, maxResults) {
    const results = [];
    const visited = new Set();
    
    const searchDirectory = async (dir, depth = 0) => {
      if (depth > 20 || results.length >= maxResults) return;
      
      try {
        const absoluteDir = path.resolve(dir);
        if (visited.has(absoluteDir)) return;
        visited.add(absoluteDir);
        
        const items = await fs.readdir(dir, { withFileTypes: true });
        
        for (const item of items) {
          if (results.length >= maxResults) break;
          
          const fullPath = path.join(dir, item.name);
          
          // Skip excluded patterns
          if (this.shouldExclude(item.name)) continue;
          
          if (item.isDirectory()) {
            await searchDirectory(fullPath, depth + 1);
          } else if (item.isFile()) {
            // Check extension filter
            if (extensions.length > 0) {
              const ext = path.extname(item.name);
              if (!extensions.includes(ext)) continue;
            }
            
            // Check pattern match
            const match = fuzzy ? 
              this.fuzzyMatch(item.name, pattern) : 
              this.exactMatch(item.name, pattern);
            
            if (match.isMatch) {
              const stats = await fs.stat(fullPath);
              results.push({
                path: path.resolve(fullPath),
                name: item.name,
                directory: path.dirname(fullPath),
                size: stats.size,
                modified: stats.mtime,
                score: match.score,
                matches: match.matches
              });
            }
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    };
    
    await searchDirectory(startDir);
    
    // Sort by score if fuzzy matching
    if (fuzzy) {
      results.sort((a, b) => b.score - a.score);
    }
    
    return results;
  }
  
  shouldExclude(name) {
    return this.config.excludePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
        return regex.test(name);
      }
      return name === pattern || name.startsWith(pattern + '/');
    });
  }
  
  exactMatch(filename, pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
    const isMatch = regex.test(filename);
    return {
      isMatch,
      score: isMatch ? 1 : 0,
      matches: isMatch ? [{ start: 0, end: filename.length }] : []
    };
  }
  
  fuzzyMatch(filename, pattern) {
    const patternLower = pattern.toLowerCase();
    const filenameLower = filename.toLowerCase();
    
    let score = 0;
    let patternIndex = 0;
    const matches = [];
    let consecutiveMatches = 0;
    
    for (let i = 0; i < filenameLower.length && patternIndex < patternLower.length; i++) {
      if (filenameLower[i] === patternLower[patternIndex]) {
        matches.push({ start: i, end: i + 1 });
        patternIndex++;
        consecutiveMatches++;
        score += consecutiveMatches * 2; // Bonus for consecutive matches
      } else {
        consecutiveMatches = 0;
      }
    }
    
    const isMatch = patternIndex === patternLower.length;
    if (isMatch) {
      // Bonus for exact filename matches
      if (filenameLower === patternLower) score += 100;
      // Bonus for starting match
      if (filenameLower.startsWith(patternLower)) score += 50;
      // Penalty for longer filenames
      score -= (filename.length - pattern.length) * 0.1;
    }
    
    return {
      isMatch,
      score: isMatch ? Math.max(score, 1) : 0,
      matches
    };
  }
}

// Search In Files Tool - Search for content within files
class SearchInFilesTool {
  constructor(config) {
    this.config = config;
    this.description = "Search for text content within files";
    this.inputSchema = {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text to search for"
        },
        directory: {
          type: "string",
          description: "Directory to search in",
          default: "."
        },
        extensions: {
          type: "array",
          items: { type: "string" },
          description: "File extensions to search in",
          default: [".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".cpp", ".c", ".h"]
        },
        regex: {
          type: "boolean",
          description: "Treat query as regular expression",
          default: false
        },
        case_sensitive: {
          type: "boolean",
          description: "Case sensitive search",
          default: false
        },
        max_results: {
          type: "integer",
          description: "Maximum number of results",
          default: 100
        },
        context_lines: {
          type: "integer",
          description: "Lines of context around matches",
          default: 2
        }
      },
      required: ["query"]
    };
  }
  
  async execute(input) {
    const {
      query,
      directory = '.',
      extensions = [".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".cpp", ".c", ".h"],
      regex = false,
      case_sensitive = false,
      max_results = 100,
      context_lines = 2
    } = input;
    
    try {
      const results = await this.searchInFiles(
        directory, query, extensions, regex, case_sensitive, max_results, context_lines
      );
      
      return {
        success: true,
        query,
        directory: path.resolve(directory),
        total_matches: results.reduce((sum, r) => sum + r.matches.length, 0),
        files_with_matches: results.length,
        results
      };
    } catch (error) {
      throw new Error(`Search in files failed: ${error.message}`);
    }
  }
  
  async searchInFiles(startDir, query, extensions, useRegex, caseSensitive, maxResults, contextLines) {
    const results = [];
    let totalMatches = 0;
    
    const searchPattern = this.createSearchPattern(query, useRegex, caseSensitive);
    
    const searchDirectory = async (dir, depth = 0) => {
      if (depth > 20 || totalMatches >= maxResults) return;
      
      try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        
        for (const item of items) {
          if (totalMatches >= maxResults) break;
          
          const fullPath = path.join(dir, item.name);
          
          if (item.isDirectory() && !this.shouldExclude(item.name)) {
            await searchDirectory(fullPath, depth + 1);
          } else if (item.isFile()) {
            // Check extension
            const ext = path.extname(item.name);
            if (!extensions.includes(ext)) continue;
            
            // Check file size
            const stats = await fs.stat(fullPath);
            if (stats.size > this.config.maxFileSize) continue;
            
            const fileMatches = await this.searchInFile(fullPath, searchPattern, contextLines);
            if (fileMatches.length > 0) {
              results.push({
                file_path: path.resolve(fullPath),
                file_name: item.name,
                matches: fileMatches,
                total_matches: fileMatches.length
              });
              totalMatches += fileMatches.length;
            }
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    };
    
    await searchDirectory(startDir);
    return results;
  }
  
  createSearchPattern(query, useRegex, caseSensitive) {
    if (useRegex) {
      const flags = caseSensitive ? 'g' : 'gi';
      return new RegExp(query, flags);
    } else {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const flags = caseSensitive ? 'g' : 'gi';
      return new RegExp(escapedQuery, flags);
    }
  }
  
  async searchInFile(filePath, searchPattern, contextLines) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');
      const matches = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineMatches = [...line.matchAll(searchPattern)];
        
        if (lineMatches.length > 0) {
          const context = this.getContext(lines, i, contextLines);
          
          matches.push({
            line_number: i + 1,
            line_content: line,
            matches: lineMatches.map(match => ({
              text: match[0],
              start: match.index,
              end: match.index + match[0].length
            })),
            context
          });
        }
      }
      
      return matches;
    } catch (error) {
      return [];
    }
  }
  
  getContext(lines, centerIndex, contextLines) {
    const start = Math.max(0, centerIndex - contextLines);
    const end = Math.min(lines.length, centerIndex + contextLines + 1);
    
    return lines.slice(start, end).map((line, index) => ({
      line_number: start + index + 1,
      content: line,
      is_match: start + index === centerIndex
    }));
  }
  
  shouldExclude(name) {
    return this.config.excludePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
        return regex.test(name);
      }
      return name === pattern;
    });
  }
}

// Go to Definition Tool - Find where symbols are defined
class GotoDefinitionTool {
  constructor(config) {
    this.config = config;
    this.description = "Find the definition of a symbol (function, class, variable)";
    this.inputSchema = {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Symbol name to find definition for"
        },
        file_path: {
          type: "string",
          description: "Current file path for context"
        },
        directory: {
          type: "string",
          description: "Project root directory",
          default: "."
        },
        language: {
          type: "string",
          description: "Programming language hint",
          enum: ["javascript", "typescript", "python", "java", "cpp", "auto"],
          default: "auto"
        }
      },
      required: ["symbol"]
    };
  }
  
  async execute(input) {
    const { symbol, file_path, directory = '.', language = 'auto' } = input;
    
    try {
      const definitions = await this.findDefinitions(symbol, file_path, directory, language);
      
      return {
        success: true,
        symbol,
        total_definitions: definitions.length,
        definitions
      };
    } catch (error) {
      throw new Error(`Go to definition failed: ${error.message}`);
    }
  }
  
  async findDefinitions(symbol, currentFile, directory, language) {
    const definitions = [];
    const langPattern = this.getLanguagePattern(symbol, language, currentFile);
    
    // Search in files
    const searchTool = new SearchInFilesTool(this.config);
    const searchResult = await searchTool.execute({
      query: langPattern.pattern,
      directory,
      extensions: langPattern.extensions,
      regex: true,
      max_results: 20,
      context_lines: 3
    });
    
    if (searchResult.success) {
      for (const fileResult of searchResult.results) {
        for (const match of fileResult.matches) {
          if (this.isDefinition(match.line_content, symbol, language)) {
            definitions.push({
              file_path: fileResult.file_path,
              file_name: fileResult.file_name,
              line_number: match.line_number,
              line_content: match.line_content.trim(),
              context: match.context,
              confidence: this.calculateConfidence(match.line_content, symbol, language)
            });
          }
        }
      }
    }
    
    // Sort by confidence
    definitions.sort((a, b) => b.confidence - a.confidence);
    
    return definitions;
  }
  
  getLanguagePattern(symbol, language, currentFile) {
    const ext = currentFile ? path.extname(currentFile) : '';
    const detectedLang = language === 'auto' ? this.detectLanguage(ext) : language;
    
    const patterns = {
      javascript: {
        pattern: `(function\\s+${symbol}\\b|const\\s+${symbol}\\s*=|let\\s+${symbol}\\s*=|var\\s+${symbol}\\s*=|class\\s+${symbol}\\b|${symbol}\\s*:\\s*function)`,
        extensions: ['.js', '.jsx', '.mjs']
      },
      typescript: {
        pattern: `(function\\s+${symbol}\\b|const\\s+${symbol}\\s*=|let\\s+${symbol}\\s*=|var\\s+${symbol}\\s*=|class\\s+${symbol}\\b|interface\\s+${symbol}\\b|type\\s+${symbol}\\b|${symbol}\\s*:\\s*function)`,
        extensions: ['.ts', '.tsx']
      },
      python: {
        pattern: `(def\\s+${symbol}\\b|class\\s+${symbol}\\b|${symbol}\\s*=)`,
        extensions: ['.py']
      },
      java: {
        pattern: `(class\\s+${symbol}\\b|interface\\s+${symbol}\\b|enum\\s+${symbol}\\b|public\\s+\\w+\\s+${symbol}\\b|private\\s+\\w+\\s+${symbol}\\b)`,
        extensions: ['.java']
      },
      cpp: {
        pattern: `(class\\s+${symbol}\\b|struct\\s+${symbol}\\b|\\w+\\s+${symbol}\\s*\\(|#define\\s+${symbol}\\b)`,
        extensions: ['.cpp', '.c', '.h', '.hpp']
      }
    };
    
    return patterns[detectedLang] || patterns.javascript;
  }
  
  detectLanguage(extension) {
    const langMap = {
      '.js': 'javascript',
      '.jsx': 'javascript', 
      '.mjs': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'cpp',
      '.h': 'cpp',
      '.hpp': 'cpp'
    };
    
    return langMap[extension] || 'javascript';
  }
  
  isDefinition(line, symbol, language) {
    const trimmed = line.trim();
    
    // Skip comments and imports
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || 
        trimmed.includes('import') || trimmed.includes('require(')) {
      return false;
    }
    
    // Language-specific definition patterns
    const definitionPatterns = [
      `function\\s+${symbol}\\b`,
      `const\\s+${symbol}\\s*=`,
      `let\\s+${symbol}\\s*=`,
      `var\\s+${symbol}\\s*=`,
      `class\\s+${symbol}\\b`,
      `interface\\s+${symbol}\\b`,
      `type\\s+${symbol}\\b`,
      `def\\s+${symbol}\\b`,
      `enum\\s+${symbol}\\b`
    ];
    
    return definitionPatterns.some(pattern => {
      const regex = new RegExp(pattern, 'i');
      return regex.test(trimmed);
    });
  }
  
  calculateConfidence(line, symbol, language) {
    let confidence = 50;
    
    const trimmed = line.trim();
    
    // Higher confidence for clear definition patterns
    if (trimmed.startsWith(`function ${symbol}`)) confidence = 95;
    if (trimmed.startsWith(`class ${symbol}`)) confidence = 95;
    if (trimmed.startsWith(`const ${symbol} =`)) confidence = 90;
    if (trimmed.includes(`def ${symbol}(`)) confidence = 95;
    
    // Lower confidence for usage patterns
    if (trimmed.includes(`${symbol}(`)) confidence = 70;
    if (trimmed.includes(`.${symbol}`)) confidence = 30;
    
    return confidence;
  }
}

// Additional tools - simplified versions for space
class FindReferencesTool {
  constructor(config) {
    this.config = config;
    this.description = "Find all references to a symbol in the codebase";
    this.inputSchema = {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol to find references for" },
        directory: { type: "string", description: "Directory to search", default: "." },
        exclude_definitions: { type: "boolean", description: "Exclude definition lines", default: false }
      },
      required: ["symbol"]
    };
  }
  
  async execute(input) {
    const searchTool = new SearchInFilesTool(this.config);
    return await searchTool.execute({
      query: input.symbol,
      directory: input.directory || '.',
      regex: false,
      case_sensitive: true
    });
  }
}

class RecentFilesTool {
  constructor(config) {
    this.config = config;
    this.description = "List recently accessed files";
    this.inputSchema = {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Number of recent files to return", default: 20 }
      }
    };
  }
  
  async execute(input) {
    const { limit = 20 } = input;
    return {
      success: true,
      recent_files: this.config.recentFiles ? this.config.recentFiles.slice(0, limit) : []
    };
  }
}

class ProjectTreeTool {
  constructor(config) {
    this.config = config;
    this.description = "Generate a tree view of project structure";
    this.inputSchema = {
      type: "object",
      properties: {
        directory: { type: "string", description: "Root directory", default: "." },
        max_depth: { type: "integer", description: "Maximum depth to traverse", default: 3 }
      }
    };
  }
  
  async execute(input) {
    const { directory = '.', max_depth = 3 } = input;
    
    const tree = await this.buildTree(directory, max_depth);
    
    return {
      success: true,
      directory: path.resolve(directory),
      tree: this.formatTree(tree)
    };
  }
  
  async buildTree(dir, maxDepth, currentDepth = 0) {
    if (currentDepth >= maxDepth) return null;
    
    try {
      const items = await fs.readdir(dir, { withFileTypes: true });
      const children = [];
      
      for (const item of items) {
        if (this.shouldExclude(item.name)) continue;
        
        const fullPath = path.join(dir, item.name);
        const child = {
          name: item.name,
          type: item.isDirectory() ? 'directory' : 'file',
          path: fullPath
        };
        
        if (item.isDirectory() && currentDepth < maxDepth - 1) {
          child.children = await this.buildTree(fullPath, maxDepth, currentDepth + 1);
        }
        
        children.push(child);
      }
      
      return children;
    } catch (error) {
      return null;
    }
  }
  
  formatTree(tree, indent = '') {
    if (!tree) return '';
    
    let result = '';
    for (let i = 0; i < tree.length; i++) {
      const item = tree[i];
      const isLast = i === tree.length - 1;
      const prefix = isLast ? '└── ' : '├── ';
      const nextIndent = indent + (isLast ? '    ' : '│   ');
      
      result += `${indent}${prefix}${item.name}\n`;
      
      if (item.children) {
        result += this.formatTree(item.children, nextIndent);
      }
    }
    
    return result;
  }
  
  shouldExclude(name) {
    return this.config.excludePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
        return regex.test(name);
      }
      return name === pattern;
    });
  }
}

class FileOutlineTool {
  constructor(config) {
    this.config = config;
    this.description = "Generate an outline/structure of a code file";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to outline" }
      },
      required: ["file_path"]
    };
  }
  
  async execute(input) {
    const { file_path } = input;
    
    try {
      const content = await fs.readFile(file_path, 'utf8');
      const outline = this.generateOutline(content, path.extname(file_path));
      
      return {
        success: true,
        file_path: path.resolve(file_path),
        outline
      };
    } catch (error) {
      throw new Error(`File outline failed: ${error.message}`);
    }
  }
  
  generateOutline(content, extension) {
    const lines = content.split('\n');
    const outline = [];
    
    const patterns = this.getOutlinePatterns(extension);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      for (const pattern of patterns) {
        const match = trimmed.match(pattern.regex);
        if (match) {
          outline.push({
            type: pattern.type,
            name: match[1] || match[0],
            line_number: i + 1,
            line_content: trimmed
          });
          break;
        }
      }
    }
    
    return outline;
  }
  
  getOutlinePatterns(extension) {
    const patterns = {
      '.js': [
        { type: 'class', regex: /class\s+(\w+)/ },
        { type: 'function', regex: /function\s+(\w+)/ },
        { type: 'function', regex: /const\s+(\w+)\s*=\s*(?:async\s+)?\(/ },
        { type: 'function', regex: /(\w+)\s*:\s*(?:async\s+)?function/ }
      ],
      '.ts': [
        { type: 'class', regex: /class\s+(\w+)/ },
        { type: 'interface', regex: /interface\s+(\w+)/ },
        { type: 'type', regex: /type\s+(\w+)/ },
        { type: 'function', regex: /function\s+(\w+)/ },
        { type: 'function', regex: /const\s+(\w+)\s*=\s*(?:async\s+)?\(/ }
      ],
      '.py': [
        { type: 'class', regex: /class\s+(\w+)/ },
        { type: 'function', regex: /def\s+(\w+)/ }
      ],
      '.java': [
        { type: 'class', regex: /class\s+(\w+)/ },
        { type: 'interface', regex: /interface\s+(\w+)/ },
        { type: 'method', regex: /(?:public|private|protected)\s+(?:static\s+)?\w+\s+(\w+)\s*\(/ }
      ]
    };
    
    return patterns[extension] || patterns['.js'];
  }
}

class FuzzyFindTool {
  constructor(config) {
    this.config = config;
    this.description = "Fuzzy search for files and content with smart ranking";
    this.inputSchema = {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        directory: { type: "string", description: "Directory to search", default: "." },
        search_content: { type: "boolean", description: "Also search file content", default: false },
        max_results: { type: "integer", description: "Maximum results", default: 20 }
      },
      required: ["query"]
    };
  }
  
  async execute(input) {
    const { query, directory = '.', search_content = false, max_results = 20 } = input;
    
    try {
      const fileResults = await this.fuzzyFindFiles(query, directory, max_results);
      let contentResults = [];
      
      if (search_content) {
        const searchTool = new SearchInFilesTool(this.config);
        const contentResult = await searchTool.execute({
          query,
          directory,
          max_results: Math.floor(max_results / 2)
        });
        
        if (contentResult.success) {
          contentResults = contentResult.results;
        }
      }
      
      return {
        success: true,
        query,
        file_matches: fileResults,
        content_matches: contentResults,
        total_matches: fileResults.length + contentResults.length
      };
    } catch (error) {
      throw new Error(`Fuzzy find failed: ${error.message}`);
    }
  }
  
  async fuzzyFindFiles(query, directory, maxResults) {
    const findTool = new FindFilesTool(this.config);
    const result = await findTool.execute({
      pattern: query,
      directory,
      fuzzy: true,
      max_results: maxResults
    });
    
    return result.success ? result.files : [];
  }
}

module.exports = {
  NavigationManager,
  FindFilesTool,
  SearchInFilesTool,
  GotoDefinitionTool,
  FindReferencesTool,
  RecentFilesTool,
  ProjectTreeTool,
  FileOutlineTool,
  FuzzyFindTool
};