# Contributing to Advanced Code Assistant

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/advanced-code-assistant.git`
3. Install dependencies: `npm install`
4. Set up your API key: `export ANTHROPIC_API_KEY="your_key"`
5. Run tests: `npm test`

## Project Structure

```
├── core/           # Core agent logic
├── prompts/        # Prompt engineering system
├── tools/          # Tool implementations
├── workflow/       # Task and workflow management
├── cli/            # Command-line interface
├── tests/          # Test suites
├── examples/       # Usage examples
└── docs/           # Documentation
```

## Adding New Features

### Custom Tools
1. Create tool in `tools/custom/`
2. Implement required interface
3. Add tests in `tests/unit/tools/`
4. Update documentation

### New Workflows
1. Define workflow in `workflow/workflows/`
2. Add to default workflows
3. Test workflow execution
4. Document usage

### Prompt Improvements
1. Modify prompts in `prompts/`
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

1. Create feature branch: `git checkout -b feature/amazing-feature`
2. Make your changes with tests
3. Run full test suite: `npm test`
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
