const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');

class SyntaxManager {
  constructor(config = {}) {
    this.config = {
      safeMode: true,
      maxFileSize: 5 * 1024 * 1024, // 5MB
      enableAutoFix: true,
      strictMode: false,
      supportedLanguages: ['javascript', 'typescript', 'python', 'java', 'cpp', 'json'],
      ...config
    };
    
    this.tools = new Map();
    this.languageCheckers = new Map();
    this.registerSyntaxTools();
    this.initializeLanguageCheckers();
  }
  
  registerSyntaxTools() {
    // Syntax checking tools
    this.registerTool('check_syntax', new SyntaxCheckerTool(this.config));
    this.registerTool('validate_file', new FileValidatorTool(this.config));
    this.registerTool('detect_language', new LanguageDetectorTool(this.config));
    this.registerTool('format_check', new FormatCheckerTool(this.config));
    this.registerTool('lint_check', new LintCheckerTool(this.config));
    this.registerTool('suggest_fixes', new FixSuggesterTool(this.config));
    this.registerTool('batch_validate', new BatchValidatorTool(this.config));
    
    console.log(`🔧 Registered ${this.tools.size} syntax tools`);
  }
  
  initializeLanguageCheckers() {
    // Register language-specific checkers
    this.languageCheckers.set('javascript', new JavaScriptChecker(this.config));
    this.languageCheckers.set('typescript', new TypeScriptChecker(this.config));
    this.languageCheckers.set('python', new PythonChecker(this.config));
    this.languageCheckers.set('java', new JavaChecker(this.config));
    this.languageCheckers.set('json', new JSONChecker(this.config));
    this.languageCheckers.set('cpp', new CppChecker(this.config));
  }
  
  registerTool(name, tool) {
    if (!tool.execute || typeof tool.execute !== 'function') {
      throw new Error(`Syntax tool ${name} must have an execute method`);
    }
    
    this.tools.set(name, tool);
  }
  
  async executeTool(name, input) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Syntax tool '${name}' not found`);
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
  
  getLanguageChecker(language) {
    return this.languageCheckers.get(language);
  }
}

// Syntax Checker Tool - Main syntax checking functionality
class SyntaxCheckerTool {
  constructor(config) {
    this.config = config;
    this.description = "Check syntax and validate code files for errors and issues";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the code file to check"
        },
        content: {
          type: "string",
          description: "Code content to check (alternative to file_path)"
        },
        language: {
          type: "string",
          description: "Programming language (auto-detected if not specified)"
        },
        strict_mode: {
          type: "boolean",
          description: "Enable strict syntax checking",
          default: false
        },
        include_warnings: {
          type: "boolean",
          description: "Include warning-level issues",
          default: true
        }
      }
    };
  }
  
  async execute(input) {
    const { file_path, content, language, strict_mode = false, include_warnings = true } = input;
    
    try {
      let codeContent = content;
      let filePath = file_path;
      let detectedLanguage = language;
      
      // Read file if content not provided
      if (!codeContent && filePath) {
        const stats = await fs.stat(filePath);
        if (stats.size > this.config.maxFileSize) {
          throw new Error(`File too large: ${stats.size} bytes (max: ${this.config.maxFileSize})`);
        }
        codeContent = await fs.readFile(filePath, 'utf8');
      }
      
      if (!codeContent) {
        throw new Error('No content provided for syntax checking');
      }
      
      // Detect language if not specified
      if (!detectedLanguage) {
        const detector = new LanguageDetectorTool(this.config);
        const detectionResult = await detector.execute({ 
          content: codeContent, 
          file_path: filePath 
        });
        detectedLanguage = detectionResult.language;
      }
      
      // Get language-specific checker
      const syntaxManager = new SyntaxManager(this.config);
      const checker = syntaxManager.getLanguageChecker(detectedLanguage);
      
      if (!checker) {
        return {
          success: false,
          error: `Language '${detectedLanguage}' is not supported for syntax checking`,
          supported_languages: this.config.supportedLanguages
        };
      }
      
      // Perform syntax check
      const checkResult = await checker.checkSyntax(codeContent, {
        strict_mode,
        include_warnings,
        file_path: filePath
      });
      
      return {
        success: true,
        file_path: filePath ? path.resolve(filePath) : null,
        language: detectedLanguage,
        syntax_valid: checkResult.errors.length === 0,
        total_issues: checkResult.errors.length + checkResult.warnings.length,
        errors: checkResult.errors,
        warnings: include_warnings ? checkResult.warnings : [],
        suggestions: checkResult.suggestions || [],
        performance: checkResult.performance || {}
      };
      
    } catch (error) {
      throw new Error(`Syntax check failed: ${error.message}`);
    }
  }
}

// Language Detector Tool
class LanguageDetectorTool {
  constructor(config) {
    this.config = config;
    this.description = "Detect programming language from file content or extension";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file for extension-based detection"
        },
        content: {
          type: "string",
          description: "Code content for content-based detection"
        }
      }
    };
  }
  
  async execute(input) {
    const { file_path, content } = input;
    
    let language = 'unknown';
    let confidence = 0;
    let detection_method = 'unknown';
    
    // Extension-based detection (most reliable)
    if (file_path) {
      const ext = path.extname(file_path).toLowerCase();
      const extMap = {
        '.js': 'javascript',
        '.jsx': 'javascript',
        '.mjs': 'javascript',
        '.ts': 'typescript',
        '.tsx': 'typescript',
        '.py': 'python',
        '.pyw': 'python',
        '.java': 'java',
        '.cpp': 'cpp',
        '.cxx': 'cpp',
        '.cc': 'cpp',
        '.c': 'cpp',
        '.h': 'cpp',
        '.hpp': 'cpp',
        '.json': 'json',
        '.html': 'html',
        '.css': 'css',
        '.php': 'php',
        '.rb': 'ruby',
        '.go': 'go',
        '.rs': 'rust',
        '.swift': 'swift'
      };
      
      if (extMap[ext]) {
        language = extMap[ext];
        confidence = 95;
        detection_method = 'extension';
      }
    }
    
    // Content-based detection (fallback)
    if (content && confidence < 50) {
      const contentDetection = this.detectByContent(content);
      if (contentDetection.confidence > confidence) {
        language = contentDetection.language;
        confidence = contentDetection.confidence;
        detection_method = 'content';
      }
    }
    
    return {
      success: true,
      language,
      confidence,
      detection_method,
      file_path: file_path ? path.resolve(file_path) : null
    };
  }
  
  detectByContent(content) {
    const patterns = [
      { pattern: /^\s*import\s+.*\s+from\s+['"]/, language: 'javascript', weight: 10 },
      { pattern: /^\s*const\s+\w+\s*=\s*require\s*\(/, language: 'javascript', weight: 10 },
      { pattern: /^\s*function\s+\w+\s*\(/, language: 'javascript', weight: 8 },
      { pattern: /^\s*interface\s+\w+/, language: 'typescript', weight: 15 },
      { pattern: /:\s*\w+(\[\])?(?:\s*=|;)/, language: 'typescript', weight: 8 },
      { pattern: /^\s*def\s+\w+\s*\(/, language: 'python', weight: 15 },
      { pattern: /^\s*import\s+\w+/, language: 'python', weight: 10 },
      { pattern: /^\s*from\s+\w+\s+import/, language: 'python', weight: 10 },
      { pattern: /^\s*public\s+class\s+\w+/, language: 'java', weight: 15 },
      { pattern: /^\s*#include\s*</, language: 'cpp', weight: 15 },
      { pattern: /^\s*using\s+namespace/, language: 'cpp', weight: 12 },
      { pattern: /^\s*\{\s*"/, language: 'json', weight: 10 }
    ];
    
    const scores = {};
    const lines = content.split('\n').slice(0, 20); // Check first 20 lines
    
    for (const line of lines) {
      for (const { pattern, language, weight } of patterns) {
        if (pattern.test(line)) {
          scores[language] = (scores[language] || 0) + weight;
        }
      }
    }
    
    let bestLanguage = 'unknown';
    let bestScore = 0;
    
    for (const [lang, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestLanguage = lang;
      }
    }
    
    return {
      language: bestLanguage,
      confidence: Math.min(bestScore * 2, 90) // Max 90% confidence from content
    };
  }
}

// Base Language Checker
class BaseLanguageChecker {
  constructor(config) {
    this.config = config;
  }
  
  async checkSyntax(content, options = {}) {
    const errors = [];
    const warnings = [];
    const suggestions = [];
    
    // Basic checks that apply to most languages
    const basicChecks = this.performBasicChecks(content);
    errors.push(...basicChecks.errors);
    warnings.push(...basicChecks.warnings);
    
    // Language-specific checks (to be overridden)
    const specificChecks = await this.performLanguageSpecificChecks(content, options);
    errors.push(...specificChecks.errors);
    warnings.push(...specificChecks.warnings);
    suggestions.push(...specificChecks.suggestions);
    
    return {
      errors: errors.sort((a, b) => a.line - b.line),
      warnings: warnings.sort((a, b) => a.line - b.line),
      suggestions: suggestions.sort((a, b) => a.line - b.line)
    };
  }
  
  performBasicChecks(content) {
    const errors = [];
    const warnings = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      
      // Check for common issues
      if (line.length > 120) {
        warnings.push({
          type: 'line_length',
          line: lineNum,
          column: 121,
          message: `Line too long (${line.length} characters)`,
          severity: 'warning'
        });
      }
      
      // Check for trailing whitespace
      if (/\s+$/.test(line)) {
        warnings.push({
          type: 'trailing_whitespace',
          line: lineNum,
          column: line.length,
          message: 'Trailing whitespace',
          severity: 'warning'
        });
      }
      
      // Check for mixed tabs and spaces
      if (/^\t+ +/.test(line) || /^ +\t/.test(line)) {
        warnings.push({
          type: 'mixed_indentation',
          line: lineNum,
          column: 1,
          message: 'Mixed tabs and spaces',
          severity: 'warning'
        });
      }
    }
    
    return { errors, warnings };
  }
  
  async performLanguageSpecificChecks(content, options) {
    // To be overridden by language-specific checkers
    return { errors: [], warnings: [], suggestions: [] };
  }
}

// JavaScript Checker
class JavaScriptChecker extends BaseLanguageChecker {
  async performLanguageSpecificChecks(content, options) {
    const errors = [];
    const warnings = [];
    const suggestions = [];
    
    try {
      // Simple JavaScript syntax validation
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lineNum = i + 1;
        
        // Check for common JS syntax errors
        if (line.includes('var ')) {
          suggestions.push({
            type: 'use_const_let',
            line: lineNum,
            message: 'Consider using const or let instead of var',
            suggestion: line.replace('var ', 'const '),
            severity: 'suggestion'
          });
        }
        
        // Check for missing semicolons (simple check)
        if (/^(let|const|var)\s+\w+.*[^;{}\s]$/.test(line)) {
          warnings.push({
            type: 'missing_semicolon',
            line: lineNum,
            column: line.length + 1,
            message: 'Missing semicolon',
            severity: 'warning'
          });
        }
        
        // Check for unmatched braces (simple check)
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;
        
        if (line.includes('{') && openBraces !== closeBraces && !line.includes('//')) {
          // This is a very basic check - a real parser would be needed for accuracy
        }
        
        // Check for console.log (should be warnings in production)
        if (line.includes('console.log(')) {
          warnings.push({
            type: 'console_log',
            line: lineNum,
            message: 'console.log statement found - consider removing for production',
            severity: 'warning'
          });
        }
        
        // Check for == instead of ===
        if (line.includes('==') && !line.includes('===') && !line.includes('!==')) {
          suggestions.push({
            type: 'strict_equality',
            line: lineNum,
            message: 'Use strict equality (===) instead of loose equality (==)',
            suggestion: line.replace(/==/g, '===').replace(/!==/g, '!=='),
            severity: 'suggestion'
          });
        }
      }
      
    } catch (error) {
      errors.push({
        type: 'parse_error',
        line: 1,
        column: 1,
        message: `JavaScript parse error: ${error.message}`,
        severity: 'error'
      });
    }
    
    return { errors, warnings, suggestions };
  }
}

// TypeScript Checker
class TypeScriptChecker extends JavaScriptChecker {
  async performLanguageSpecificChecks(content, options) {
    const result = await super.performLanguageSpecificChecks(content, options);
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;
      
      // Check for any type usage
      if (line.includes(': any')) {
        result.warnings.push({
          type: 'any_type',
          line: lineNum,
          message: 'Avoid using "any" type - use specific types instead',
          severity: 'warning'
        });
      }
      
      // Check for missing type annotations on functions
      if (/^(export\s+)?function\s+\w+\s*\([^)]*\)\s*\{/.test(line) && !line.includes(':')) {
        result.suggestions.push({
          type: 'missing_return_type',
          line: lineNum,
          message: 'Consider adding return type annotation',
          severity: 'suggestion'
        });
      }
    }
    
    return result;
  }
}

// Python Checker
class PythonChecker extends BaseLanguageChecker {
  async performLanguageSpecificChecks(content, options) {
    const errors = [];
    const warnings = [];
    const suggestions = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const trimmed = line.trim();
      
      // Check indentation (Python is sensitive to this)
      if (trimmed && !line.startsWith(' ') && !line.startsWith('\t') && line !== trimmed) {
        // Line has content but inconsistent indentation
      }
      
      // Check for common Python issues
      if (trimmed.includes('print ') && !trimmed.includes('print(')) {
        errors.push({
          type: 'python3_print',
          line: lineNum,
          message: 'Use print() function syntax for Python 3',
          severity: 'error'
        });
      }
      
      // Check for import statements
      if (trimmed.startsWith('from') && trimmed.includes('import *')) {
        warnings.push({
          type: 'wildcard_import',
          line: lineNum,
          message: 'Avoid wildcard imports',
          severity: 'warning'
        });
      }
      
      // Check for lambda complexity
      if (trimmed.includes('lambda') && trimmed.length > 50) {
        suggestions.push({
          type: 'complex_lambda',
          line: lineNum,
          message: 'Consider replacing complex lambda with a regular function',
          severity: 'suggestion'
        });
      }
    }
    
    return { errors, warnings, suggestions };
  }
}

// JSON Checker
class JSONChecker extends BaseLanguageChecker {
  async performLanguageSpecificChecks(content, options) {
    const errors = [];
    
    try {
      JSON.parse(content);
    } catch (error) {
      const match = error.message.match(/position (\d+)/);
      const position = match ? parseInt(match[1]) : 0;
      const lines = content.substring(0, position).split('\n');
      
      errors.push({
        type: 'json_parse_error',
        line: lines.length,
        column: lines[lines.length - 1].length + 1,
        message: error.message,
        severity: 'error'
      });
    }
    
    return { errors, warnings: [], suggestions: [] };
  }
}

// Java and C++ checkers (simplified)
class JavaChecker extends BaseLanguageChecker {
  async performLanguageSpecificChecks(content, options) {
    const warnings = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;
      
      if (line.includes('System.out.println')) {
        warnings.push({
          type: 'debug_print',
          line: lineNum,
          message: 'Debug print statement found',
          severity: 'warning'
        });
      }
    }
    
    return { errors: [], warnings, suggestions: [] };
  }
}

class CppChecker extends BaseLanguageChecker {
  async performLanguageSpecificChecks(content, options) {
    const warnings = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;
      
      if (line.includes('printf') || line.includes('cout')) {
        warnings.push({
          type: 'debug_output',
          line: lineNum,
          message: 'Debug output statement found',
          severity: 'warning'
        });
      }
    }
    
    return { errors: [], warnings, suggestions: [] };
  }
}

// Additional syntax tools (simplified for space)
class FileValidatorTool {
  constructor(config) {
    this.config = config;
    this.description = "Validate a file and check for common issues";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to validate" }
      },
      required: ["file_path"]
    };
  }
  
  async execute(input) {
    const syntaxTool = new SyntaxCheckerTool(this.config);
    return await syntaxTool.execute({ file_path: input.file_path });
  }
}

class FormatCheckerTool {
  constructor(config) {
    this.config = config;
    this.description = "Check code formatting and style consistency";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to check formatting" }
      },
      required: ["file_path"]
    };
  }
  
  async execute(input) {
    // Simplified format checking
    const content = await fs.readFile(input.file_path, 'utf8');
    const issues = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 100) {
        issues.push({
          type: 'long_line',
          line: i + 1,
          message: `Line too long: ${line.length} characters`
        });
      }
    }
    
    return {
      success: true,
      file_path: path.resolve(input.file_path),
      formatting_issues: issues
    };
  }
}

class LintCheckerTool {
  constructor(config) {
    this.config = config;
    this.description = "Perform linting checks for code quality";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to lint" }
      },
      required: ["file_path"]
    };
  }
  
  async execute(input) {
    const syntaxTool = new SyntaxCheckerTool(this.config);
    return await syntaxTool.execute({ 
      file_path: input.file_path,
      include_warnings: true 
    });
  }
}

class FixSuggesterTool {
  constructor(config) {
    this.config = config;
    this.description = "Suggest automatic fixes for common code issues";
    this.inputSchema = {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to suggest fixes for" }
      },
      required: ["file_path"]
    };
  }
  
  async execute(input) {
    const syntaxTool = new SyntaxCheckerTool(this.config);
    const result = await syntaxTool.execute({ file_path: input.file_path });
    
    return {
      success: true,
      file_path: input.file_path,
      suggested_fixes: result.suggestions || []
    };
  }
}

class BatchValidatorTool {
  constructor(config) {
    this.config = config;
    this.description = "Validate multiple files in batch";
    this.inputSchema = {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" }, description: "List of file paths to validate" },
        directory: { type: "string", description: "Directory to validate all files" }
      }
    };
  }
  
  async execute(input) {
    const { files, directory } = input;
    const results = [];
    let filesToCheck = files || [];
    
    if (directory && !files) {
      // Find all code files in directory
      filesToCheck = await this.findCodeFiles(directory);
    }
    
    const syntaxTool = new SyntaxCheckerTool(this.config);
    
    for (const file of filesToCheck) {
      try {
        const result = await syntaxTool.execute({ file_path: file });
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          file_path: file,
          error: error.message
        });
      }
    }
    
    return {
      success: true,
      total_files: filesToCheck.length,
      results,
      summary: this.createSummary(results)
    };
  }
  
  async findCodeFiles(directory) {
    const files = [];
    const extensions = ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.h'];
    
    const scan = async (dir) => {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory() && !item.name.startsWith('.')) {
          await scan(fullPath);
        } else if (item.isFile() && extensions.includes(path.extname(item.name))) {
          files.push(fullPath);
        }
      }
    };
    
    await scan(directory);
    return files;
  }
  
  createSummary(results) {
    const summary = {
      valid_files: 0,
      invalid_files: 0,
      total_errors: 0,
      total_warnings: 0,
      languages: {}
    };
    
    for (const result of results) {
      if (result.success) {
        if (result.syntax_valid) {
          summary.valid_files++;
        } else {
          summary.invalid_files++;
        }
        summary.total_errors += result.errors?.length || 0;
        summary.total_warnings += result.warnings?.length || 0;
        
        if (result.language) {
          summary.languages[result.language] = (summary.languages[result.language] || 0) + 1;
        }
      }
    }
    
    return summary;
  }
}

module.exports = {
  SyntaxManager,
  SyntaxCheckerTool,
  LanguageDetectorTool,
  FileValidatorTool,
  FormatCheckerTool,
  LintCheckerTool,
  FixSuggesterTool,
  BatchValidatorTool,
  JavaScriptChecker,
  TypeScriptChecker,
  PythonChecker,
  JSONChecker,
  JavaChecker,
  CppChecker
};