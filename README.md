# AI Code Assistant - Advanced Development Companion

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/yourusername/ai-code-assistant)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)

A comprehensive AI-powered coding assistant that helps developers with complex programming tasks, codebase analysis, and project management. Built with advanced LLM integration and featuring 49+ specialized tools for development workflows.

## 🚀 Features

### Core Capabilities
- **🔧 Git Integration**: 17 comprehensive Git tools (vs Claude Code's 8-10)
- **🔄 Multi-file Editing**: 5 advanced batch editing tools with backup & safety
- **🧭 Smart Navigation**: 8 intelligent code navigation and search tools
- **🔍 Real-time Syntax Checking**: 7 tools supporting 6+ programming languages
- **📊 Advanced Project Analysis**: Deep codebase understanding and metrics
- **💬 Interactive Chat Mode**: AI-powered development assistance
- **⚙️ Modular Architecture**: Extensible tool system with 49 total tools

### Specialized Agents
- **Code Analyzer**: AST parsing, quality metrics, dependency analysis
- **Test Generator**: Comprehensive test suite generation
- **Documentation Agent**: Auto-generate docs, comments, and API documentation
- **Refactoring Agent**: Safe code improvements and optimizations
- **Debug Assistant**: Error analysis and fix suggestions

### Advanced Features
- **Context Management**: Intelligent conversation history pruning
- **Performance Monitoring**: Real-time metrics and analytics
- **Plugin System**: Extensible architecture for custom tools
- **Configuration Management**: Flexible, hierarchical configuration
- **Safety & Security**: Sandboxed execution with user confirmations

## 📦 Installation

### Prerequisites
- Node.js 16+ 
- Groq API key (free tier available)

### Quick Install
```bash
npm install -g advanced-code-assistant
```

### From Source
```bash
git clone https://github.com/yourusername/advanced-code-assistant.git
cd advanced-code-assistant
npm install
npm link
```

## ⚙️ Configuration

### Get Free Groq API Key
1. Visit [https://console.groq.com](https://console.groq.com)
2. Sign up for a free account
3. Navigate to API Keys section
4. Create a new API key
5. Copy your API key

### Environment Variables
```bash
export GROQ_API_KEY="your_groq_api_key_here"
```

### Configuration File
Create `.codeassistant.json` in your project or home directory:

```json
{
  "model": "llama3-8b-8192",
  "maxTokens": 4000,
  "temperature": 0.1,
  "safeMode": true,
  "autoSave": true,
  "preferredLanguage": "javascript",
  "testingFramework": "jest",
  "codeStyle": "modern"
}
```

## 🎯 Quick Start

### Interactive Chat Mode
```bash
codeassistant chat
```

### Analyze Project
```bash
codeassistant analyze
codeassistant analyze ./my-project
```

### Generate Code
```bash
codeassistant generate "Create a REST API with Express and validation"
codeassistant generate "Build a React component for user authentication" --language typescript
```

### Refactor Code
```bash
codeassistant refactor src/utils.js
codeassistant refactor src/components/UserForm.tsx --type performance
```

### Generate Tests
```bash
codeassistant test src/api/userService.js
codeassistant test src/utils/validation.ts --framework jest --output tests/
```

### Documentation
```bash
codeassistant document src/api/userController.js
codeassistant document src/types/User.ts --type jsdoc
```

## 🔧 Advanced Usage

### Workflow Management
```bash
# List available workflows
codeassistant workflow --list

# Start a specific workflow
codeassistant workflow --start feature-development

# Check workflow progress
codeassistant workflow --progress
```

### Session Management
```bash
# Save current session
codeassistant session --save my-session

# Load previous session
codeassistant session --load my-session

# List all sessions
codeassistant session --list
```

### Configuration Management
```bash
# Set configuration values
codeassistant config --set preferredLanguage=typescript
codeassistant config --set testingFramework=vitest

# View current configuration
codeassistant config --list
```

## 🤖 Chat Commands

During interactive chat, use these commands:

- `/progress` - Show current task progress
- `/workflows` - List available workflows  
- `/tools` - List available tools
- `/metrics` - Show performance metrics
- `/clear` - Clear conversation history
- `/save [name]` - Save current session
- `/load [name]` - Load saved session
- `/config` - Show current configuration

## 🏗️ Architecture

### Core Components

```
├── core/
│   └── Agent.js          # Main agent orchestration
├── prompts/
│   └── PromptManager.js  # Advanced prompt engineering
├── tools/
│   └── ToolManager.js    # Comprehensive tool system
├── workflow/
│   └── TaskManager.js    # Task and workflow management
└── cli/
    └── main.js           # CLI interface
```

### Agent Workflow

1. **Input Processing**: Parse and validate user requests
2. **Task Decomposition**: Break complex tasks into manageable steps
3. **Tool Selection**: Choose appropriate tools based on context
4. **Execution**: Run tools with safety checks and error handling
5. **Progress Tracking**: Update visual progress indicators
6. **Result Synthesis**: Combine outputs into coherent responses

### Tool System

**File Operations**
- `read_file` - Read file contents with encoding detection
- `write_file` - Write files with directory creation
- `list_files` - Recursive file listing with filtering
- `search_files` - Content and filename search
- `create_directory` - Directory creation with permissions

**Code Analysis**  
- `analyze_code` - AST parsing, quality metrics, complexity analysis
- `format_code` - Code formatting and style enforcement
- `lint_code` - Static analysis and error detection

**Project Operations**
- `run_command` - Safe command execution with timeouts
- `git_status` - Git repository information
- `npm_info` - Package.json analysis and dependency management

**Task Management**
- `todo_write` - Create and manage task lists
- `todo_read` - Read current task status

## 🔍 Examples

### Generate a Complete Feature

```bash
codeassistant chat
> I need to create a user authentication system with JWT tokens, including login, registration, and password reset functionality.
```

The assistant will:
1. Analyze requirements and create a detailed plan
2. Generate the authentication middleware
3. Create user models and validation schemas  
4. Build API endpoints with proper error handling
5. Generate comprehensive tests
6. Create documentation and usage examples

### Refactor Legacy Code

```bash
codeassistant refactor legacy/user-manager.js --type modernization
```

The assistant will:
1. Analyze current code structure and patterns
2. Identify improvement opportunities
3. Apply modern JavaScript features (async/await, destructuring, etc.)
4. Improve error handling and validation
5. Add proper TypeScript types if applicable
6. Update documentation and comments

### Project Analysis

```bash
codeassistant analyze
```

Provides:
- **File Structure Analysis**: Directory organization, file types, sizes
- **Code Quality Metrics**: Maintainability index, complexity scores  
- **Dependency Analysis**: Package versions, security vulnerabilities
- **Architecture Overview**: Design patterns, module relationships
- **Improvement Recommendations**: Actionable suggestions for enhancement

## 🛠️ Development

### Setup Development Environment
```bash
git clone https://github.com/yourusername/advanced-code-assistant.git
cd advanced-code-assistant
npm install
npm run dev
```

### Testing
```bash
npm test                # Run all tests
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report
```

### Linting
```bash
npm run lint           # Check code style
npm run lint:fix       # Auto-fix issues
```

### Documentation
```bash
npm run docs           # Generate JSDoc documentation
```

## 🔌 Extending the Assistant

### Custom Tools

Create custom tools by extending the base tool class:

```javascript
// tools/custom/MyTool.js
class MyCustomTool {
  constructor(config) {
    this.description = "Description of what my tool does";
    this.inputSchema = {
      type: "object",
      properties: {
        input: { type: "string", description: "Input parameter" }
      },
      required: ["input"]
    };
  }
  
  async execute(input) {
    // Tool implementation
    return { success: true, result: "Tool output" };
  }
}

module.exports = MyCustomTool;
```

### Custom Workflows

Define custom workflows:

```javascript
const { WorkflowBuilder } = require('advanced-code-assistant/workflow/TaskManager');

const customWorkflow = new WorkflowBuilder()
  .setName('My Custom Workflow')
  .setDescription('Workflow for specific task')
  .addStep('step1', 'First Step', true)
  .addStep('step2', 'Second Step', true)
  .addStep('step3', 'Optional Step', false)
  .build();
```

### Custom Prompts

Create specialized prompts for domain-specific tasks:

```javascript
const customPrompt = `You are a specialized assistant for ${domain}.

<capabilities>
- Domain-specific capability 1
- Domain-specific capability 2
</capabilities>

<workflow>
1. Understand ${domain} requirements
2. Apply ${domain} best practices
3. Generate production-ready solutions
</workflow>`;
```

## 📊 Performance & Metrics

The assistant tracks comprehensive metrics:

- **Response Times**: Average API call latency
- **Success Rates**: Tool execution success percentages  
- **Token Usage**: API cost tracking and optimization
- **Task Completion**: Workflow success rates and timing
- **User Satisfaction**: Quality scoring and feedback

View metrics with:
```bash
codeassistant chat
> /metrics
```

## 🔒 Security & Safety

### Safe Mode Features
- **Command Restrictions**: Whitelist of allowed shell commands
- **Path Restrictions**: Prevent access to system directories
- **File Size Limits**: Prevent processing of oversized files
- **User Confirmations**: Prompt before destructive operations
- **Sandboxed Execution**: Isolated tool execution environment

### Configuration
```json
{
  "safeMode": true,
  "allowedCommands": ["npm", "git", "node"],
  "restrictedPaths": ["/etc", "/usr", "/bin"],
  "maxFileSize": 10485760,
  "requireConfirmation": ["write_file", "run_command"]
}
```

## 📈 Roadmap

### Version 1.1 (Next Release)
- [ ] **Multi-language Support**: Python, Java, C++, Rust specialist agents
- [ ] **IDE Integration**: VS Code extension with real-time assistance
- [ ] **Cloud Sync**: Sync sessions and configurations across devices
- [ ] **Team Collaboration**: Shared sessions and collaborative coding
- [ ] **Advanced Analytics**: Detailed code quality trends and insights

### Version 1.2 (Future)
- [ ] **Voice Interface**: Voice-to-code generation and commands
- [ ] **Visual Code Editor**: Built-in code editor with AI suggestions
- [ ] **Database Integration**: SQL query generation and optimization
- [ ] **DevOps Automation**: CI/CD pipeline generation and management
- [ ] **Code Review Bot**: Automated pull request reviews

### Version 2.0 (Long-term)
- [ ] **Multi-model Support**: Support for GPT-4, Gemini, and other LLMs
- [ ] **Custom Model Training**: Fine-tune models on your codebase
- [ ] **Enterprise Features**: RBAC, audit logging, compliance reporting
- [ ] **Advanced Refactoring**: Large-scale codebase transformations
- [ ] **AI Pair Programming**: Real-time collaborative coding with AI

## 🆚 Comparison with Claude Code

| Feature | Advanced Code Assistant | Claude Code |
|---------|------------------------|-------------|
| **Total Tools** | **49 tools** | ~35 tools |
| **Git Integration** | **17 operations** | 8-10 operations |
| **Multi-file Editing** | **5 advanced tools** | Basic support |
| **Navigation System** | **8 smart tools** | Limited search |
| **Syntax Checking** | **7 tools, 6+ languages** | Basic checking |
| **API Cost** | **Free (Groq)** | Paid (Anthropic) |
| **Language Support** | **6+ languages** | 3-4 languages |
| **Architecture** | **Modular & Extensible** | Monolithic |
| **Open Source** | ✅ | ❌ |
| **Self-hosted** | ✅ | ❌ |
| **Custom Tools** | ✅ | ❌ |
| **Batch Operations** | ✅ | Limited |

## 🧪 Testing

### Unit Tests
```bash
npm test -- --verbose
```

### Integration Tests  
```bash
npm run test:integration
```

### End-to-End Tests
```bash
npm run test:e2e
```

### Performance Tests
```bash
npm run test:performance
```

### Test Coverage
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

## 📚 API Documentation

### Core Agent API

```javascript
const { CoreAgent } = require('advanced-code-assistant');

const agent = new CoreAgent({
  model: 'llama3-8b-8192',
  apiKey: 'your-groq-api-key'
});

// Process a message
const response = await agent.processMessage('Generate a React component');

// Register custom tool
agent.registerTool('my_tool', {
  description: 'My custom tool',
  inputSchema: { /* schema */ },
  execute: async (input) => { /* implementation */ }
});
```

### Task Manager API

```javascript
const { TaskManager } = require('advanced-code-assistant');

const taskManager = new TaskManager();

// Start a workflow
const task = taskManager.startWorkflow('code-generation', 'Build user auth');

// Update progress
taskManager.updateTaskProgress(task.id, 50);

// Complete task
taskManager.completeTask(task.id, { result: 'Auth system complete' });
```

### Tool Manager API

```javascript
const { ToolManager } = require('advanced-code-assistant');

const toolManager = new ToolManager();

// Execute a tool
const result = await toolManager.executeTool('read_file', {
  file_path: 'src/index.js'
});

// Register custom tool
toolManager.registerTool('my_tool', new MyCustomTool());
```

## 🔧 Troubleshooting

### Common Issues

**"API Key not found"**
```bash
export GROQ_API_KEY="your_key_here"
# or create .env file with GROQ_API_KEY=your_key_here

as we need to llm model which had context window of more than 20 k so which is why we can 
use the anthropic models those can context window 200k 
which can make this cli aegent more powerful and authentic to use
as they are also state of art model for code genration
```

**"Command not found: codeassistant"**
```bash
npm link
# or
npm install -g advanced-code-assistant
```

**"Permission denied" errors**
```bash
# Enable safe mode in config
echo '{"safeMode": true}' > .codeassistant.json
```

**"Module not found" errors**
```bash
npm install
# or
npm ci
```

### Debug Mode
```bash
DEBUG=* codeassistant chat
```

### Verbose Logging
```bash
codeassistant --verbose chat
```

### Clear Cache
```bash
codeassistant config --set clearCache=true
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes with tests
4. Run the test suite: `npm test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Code Standards
- Follow ESLint configuration
- Write comprehensive tests for new features
- Update documentation for API changes
- Use conventional commit messages

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Groq** for providing fast and free LLM API access
- **Anthropic** for inspiration from Claude Code architecture
- **OpenAI** for advancing the field of AI-powered development tools
- **The Open Source Community** for the foundational libraries and tools
- **Contributors** who help make this project better

## 📞 Support

- **Documentation**: [Full Documentation](https://github.com/yourusername/advanced-code-assistant/wiki)
- **Issues**: [GitHub Issues](https://github.com/yourusername/advanced-code-assistant/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/advanced-code-assistant/discussions)
- **Discord**: [Community Discord](https://discord.gg/your-server)
- **Email**: support@your-domain.com

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=yourusername/advanced-code-assistant&type=Date)](https://star-history.com/#yourusername/advanced-code-assistant&Date)

---

**Built with ❤️ by developers, for developers**

*Transform your coding workflow with AI-powered assistance that understands your context, follows your patterns, and helps you build better software faster.*
