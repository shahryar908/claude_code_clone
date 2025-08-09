// Example custom workflow
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
