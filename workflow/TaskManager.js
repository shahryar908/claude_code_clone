const EventEmitter = require('events');

class TaskManager extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map();
    this.workflows = new Map();
    this.activeWorkflow = null;
    this.taskHistory = [];
    this.progressCallbacks = new Map();
    
    this.initializeDefaultWorkflows();
  }
  
  initializeDefaultWorkflows() {
    // Code generation workflow
    this.registerWorkflow('code-generation', {
      name: 'Code Generation Workflow',
      description: 'Standard workflow for generating new code',
      steps: [
        { id: 'analyze', name: 'Analyze Requirements', required: true },
        { id: 'plan', name: 'Plan Implementation', required: true },
        { id: 'generate', name: 'Generate Code', required: true },
        { id: 'test', name: 'Generate Tests', required: false },
        { id: 'validate', name: 'Validate & Review', required: true }
      ]
    });
    
    // Code refactoring workflow
    this.registerWorkflow('code-refactoring', {
      name: 'Code Refactoring Workflow',
      description: 'Workflow for improving existing code',
      steps: [
        { id: 'read', name: 'Read Current Code', required: true },
        { id: 'analyze', name: 'Analyze Structure', required: true },
        { id: 'plan', name: 'Plan Improvements', required: true },
        { id: 'backup', name: 'Backup Current Code', required: true },
        { id: 'refactor', name: 'Apply Refactoring', required: true },
        { id: 'test', name: 'Run Tests', required: true },
        { id: 'validate', name: 'Validate Changes', required: true }
      ]
    });
    
    // Bug fixing workflow
    this.registerWorkflow('bug-fixing', {
      name: 'Bug Fixing Workflow',
      description: 'Systematic approach to fixing bugs',
      steps: [
        { id: 'reproduce', name: 'Reproduce Bug', required: true },
        { id: 'analyze', name: 'Analyze Root Cause', required: true },
        { id: 'plan', name: 'Plan Solution', required: true },
        { id: 'implement', name: 'Implement Fix', required: true },
        { id: 'test', name: 'Test Fix', required: true },
        { id: 'regression', name: 'Check for Regressions', required: true }
      ]
    });
    
    // Feature development workflow
    this.registerWorkflow('feature-development', {
      name: 'Feature Development Workflow',
      description: 'Complete feature development process',
      steps: [
        { id: 'requirements', name: 'Gather Requirements', required: true },
        { id: 'design', name: 'Design Solution', required: true },
        { id: 'plan', name: 'Create Implementation Plan', required: true },
        { id: 'implement', name: 'Implement Feature', required: true },
        { id: 'test', name: 'Write & Run Tests', required: true },
        { id: 'document', name: 'Update Documentation', required: false },
        { id: 'review', name: 'Code Review', required: true }
      ]
    });
  }
  
  registerWorkflow(id, workflow) {
    this.workflows.set(id, {
      ...workflow,
      id,
      registered: Date.now()
    });
    
    this.emit('workflow:registered', { id, workflow });
  }
  
  createTask(options) {
    const task = {
      id: this.generateTaskId(),
      title: options.title,
      description: options.description || '',
      status: 'pending',
      priority: options.priority || 'medium',
      workflowId: options.workflowId,
      parentId: options.parentId,
      subtasks: [],
      progress: 0,
      created: Date.now(),
      estimatedDuration: options.estimatedDuration,
      dependencies: options.dependencies || [],
      tags: options.tags || [],
      metadata: options.metadata || {}
    };
    
    this.tasks.set(task.id, task);
    
    // Add to parent's subtasks if applicable
    if (task.parentId) {
      const parent = this.tasks.get(task.parentId);
      if (parent) {
        parent.subtasks.push(task.id);
      }
    }
    
    this.emit('task:created', task);
    return task;
  }
  
  startWorkflow(workflowId, taskTitle, options = {}) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow '${workflowId}' not found`);
    }
    
    // Create main task
    const mainTask = this.createTask({
      title: taskTitle,
      description: `Executing ${workflow.name}`,
      workflowId,
      ...options
    });
    
    // Create subtasks for each workflow step
    workflow.steps.forEach((step, index) => {
      const subtask = this.createTask({
        title: step.name,
        description: `Step ${index + 1}: ${step.name}`,
        parentId: mainTask.id,
        workflowId,
        priority: step.required ? 'high' : 'medium',
        metadata: { 
          stepId: step.id, 
          stepIndex: index, 
          required: step.required 
        }
      });
    });
    
    this.activeWorkflow = {
      id: workflowId,
      taskId: mainTask.id,
      currentStep: 0,
      started: Date.now()
    };
    
    this.emit('workflow:started', { workflow, mainTask });
    return mainTask;
  }
  
  updateTaskProgress(taskId, progress, status = null) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found`);
    }
    
    const oldProgress = task.progress;
    const oldStatus = task.status;
    
    task.progress = Math.max(0, Math.min(100, progress));
    if (status) {
      task.status = status;
    }
    
    // Auto-complete when progress reaches 100%
    if (task.progress === 100 && task.status !== 'completed') {
      task.status = 'completed';
      task.completed = Date.now();
    }
    
    // Update parent task progress
    if (task.parentId) {
      this.updateParentProgress(task.parentId);
    }
    
    // Check workflow progression
    if (this.activeWorkflow && task.parentId === this.activeWorkflow.taskId) {
      this.checkWorkflowProgression();
    }
    
    this.emit('task:updated', { 
      task, 
      oldProgress, 
      oldStatus,
      progressDelta: task.progress - oldProgress 
    });
    
    return task;
  }
  
  updateParentProgress(parentId) {
    const parent = this.tasks.get(parentId);
    if (!parent || parent.subtasks.length === 0) return;
    
    const subtasks = parent.subtasks.map(id => this.tasks.get(id)).filter(Boolean);
    const totalProgress = subtasks.reduce((sum, task) => sum + task.progress, 0);
    const averageProgress = totalProgress / subtasks.length;
    
    parent.progress = Math.round(averageProgress);
    
    // Update status based on subtask completion
    const completedSubtasks = subtasks.filter(task => task.status === 'completed').length;
    const inProgressSubtasks = subtasks.filter(task => task.status === 'in-progress').length;
    
    if (completedSubtasks === subtasks.length) {
      parent.status = 'completed';
      parent.completed = Date.now();
    } else if (inProgressSubtasks > 0 || completedSubtasks > 0) {
      parent.status = 'in-progress';
    }
    
    this.emit('task:parent-updated', parent);
  }
  
  checkWorkflowProgression() {
    if (!this.activeWorkflow) return;
    
    const mainTask = this.tasks.get(this.activeWorkflow.taskId);
    const workflow = this.workflows.get(this.activeWorkflow.id);
    
    if (!mainTask || !workflow) return;
    
    const subtasks = mainTask.subtasks.map(id => this.tasks.get(id)).filter(Boolean);
    const currentStepTask = subtasks[this.activeWorkflow.currentStep];
    
    // Check if current step is completed
    if (currentStepTask && currentStepTask.status === 'completed') {
      this.activeWorkflow.currentStep++;
      
      // Check if workflow is complete
      if (this.activeWorkflow.currentStep >= workflow.steps.length) {
        this.completeWorkflow();
      } else {
        // Start next step
        const nextStepTask = subtasks[this.activeWorkflow.currentStep];
        if (nextStepTask) {
          nextStepTask.status = 'ready';
          this.emit('workflow:step-ready', { 
            workflow: this.activeWorkflow, 
            nextStep: nextStepTask 
          });
        }
      }
    }
  }
  
  completeWorkflow() {
    if (!this.activeWorkflow) return;
    
    const mainTask = this.tasks.get(this.activeWorkflow.taskId);
    if (mainTask) {
      mainTask.status = 'completed';
      mainTask.progress = 100;
      mainTask.completed = Date.now();
    }
    
    const completedWorkflow = { ...this.activeWorkflow };
    completedWorkflow.completed = Date.now();
    completedWorkflow.duration = completedWorkflow.completed - completedWorkflow.started;
    
    this.taskHistory.push(completedWorkflow);
    this.activeWorkflow = null;
    
    this.emit('workflow:completed', completedWorkflow);
  }
  
  completeTask(taskId, result = null) {
    const task = this.updateTaskProgress(taskId, 100, 'completed');
    
    if (result) {
      task.result = result;
    }
    
    this.emit('task:completed', { task, result });
    return task;
  }
  
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  getTaskProgress(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    return {
      id: task.id,
      title: task.title,
      progress: task.progress,
      status: task.status,
      subtasks: task.subtasks.map(id => {
        const subtask = this.tasks.get(id);
        return subtask ? {
          id: subtask.id,
          title: subtask.title,
          progress: subtask.progress,
          status: subtask.status
        } : null;
      }).filter(Boolean)
    };
  }
  
  getWorkflowProgress() {
    if (!this.activeWorkflow) return null;
    
    const mainTask = this.tasks.get(this.activeWorkflow.taskId);
    const workflow = this.workflows.get(this.activeWorkflow.id);
    
    if (!mainTask || !workflow) return null;
    
    const subtasks = mainTask.subtasks.map(id => this.tasks.get(id)).filter(Boolean);
    
    return {
      workflowId: this.activeWorkflow.id,
      workflowName: workflow.name,
      mainTaskId: mainTask.id,
      currentStep: this.activeWorkflow.currentStep,
      totalSteps: workflow.steps.length,
      overallProgress: mainTask.progress,
      steps: subtasks.map((task, index) => ({
        id: task.id,
        name: task.title,
        status: task.status,
        progress: task.progress,
        isCurrent: index === this.activeWorkflow.currentStep,
        required: task.metadata.required
      }))
    };
  }
  
  formatProgressDisplay(taskId = null) {
    let target;
    
    if (taskId) {
      target = this.getTaskProgress(taskId);
    } else if (this.activeWorkflow) {
      target = this.getWorkflowProgress();
    } else {
      return 'No active tasks or workflows';
    }
    
    if (!target) return 'Task not found';
    
    if (target.workflowId) {
      // Format workflow progress
      return this.formatWorkflowDisplay(target);
    } else {
      // Format task progress
      return this.formatTaskDisplay(target);
    }
  }
  
  formatWorkflowDisplay(workflow) {
    let output = `\n🔄 ${workflow.workflowName}\n`;
    output += `Overall Progress: ${workflow.overallProgress}% (${workflow.currentStep}/${workflow.totalSteps} steps)\n`;
    output += '─'.repeat(60) + '\n';
    
    workflow.steps.forEach((step, index) => {
      const status = this.getStatusIcon(step.status);
      const current = step.isCurrent ? '👉 ' : '   ';
      const required = step.required ? '⚡' : '⭐';
      const progress = step.progress > 0 ? ` (${step.progress}%)` : '';
      
      output += `${current}${status} ${required} ${step.name}${progress}\n`;
      
      if (step.isCurrent && step.status === 'in-progress') {
        const progressBar = this.createProgressBar(step.progress, 30);
        output += `    ${progressBar}\n`;
      }
    });
    
    return output;
  }
  
  formatTaskDisplay(task) {
    let output = `\n📋 ${task.title}\n`;
    output += `Progress: ${task.progress}% (${task.status})\n`;
    
    if (task.subtasks.length > 0) {
      output += '─'.repeat(40) + '\n';
      task.subtasks.forEach(subtask => {
        const status = this.getStatusIcon(subtask.status);
        const progress = subtask.progress > 0 ? ` (${subtask.progress}%)` : '';
        output += `${status} ${subtask.title}${progress}\n`;
      });
    }
    
    return output;
  }
  
  getStatusIcon(status) {
    const icons = {
      'pending': '⏳',
      'ready': '🟡',
      'in-progress': '🔄',
      'completed': '✅',
      'failed': '❌',
      'blocked': '🚫',
      'skipped': '⏭️'
    };
    
    return icons[status] || '❓';
  }
  
  createProgressBar(progress, width = 20) {
    const filled = Math.round((progress / 100) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty) + ` ${progress}%`;
  }
  
  // Analytics and reporting
  getTaskAnalytics() {
    const allTasks = Array.from(this.tasks.values());
    
    return {
      totalTasks: allTasks.length,
      completedTasks: allTasks.filter(t => t.status === 'completed').length,
      inProgressTasks: allTasks.filter(t => t.status === 'in-progress').length,
      pendingTasks: allTasks.filter(t => t.status === 'pending').length,
      averageCompletionTime: this.calculateAverageCompletionTime(allTasks),
      tasksByPriority: this.groupTasksByPriority(allTasks),
      workflowHistory: this.taskHistory.length
    };
  }
  
  calculateAverageCompletionTime(tasks) {
    const completedTasks = tasks.filter(t => t.completed && t.created);
    if (completedTasks.length === 0) return 0;
    
    const totalTime = completedTasks.reduce((sum, task) => {
      return sum + (task.completed - task.created);
    }, 0);
    
    return Math.round(totalTime / completedTasks.length);
  }
  
  groupTasksByPriority(tasks) {
    return tasks.reduce((groups, task) => {
      groups[task.priority] = (groups[task.priority] || 0) + 1;
      return groups;
    }, {});
  }
  
  // Task dependencies
  addDependency(taskId, dependsOnTaskId) {
    const task = this.tasks.get(taskId);
    const dependsOnTask = this.tasks.get(dependsOnTaskId);
    
    if (!task || !dependsOnTask) {
      throw new Error('One or both tasks not found');
    }
    
    if (!task.dependencies.includes(dependsOnTaskId)) {
      task.dependencies.push(dependsOnTaskId);
    }
    
    this.checkTaskReadiness(taskId);
    this.emit('dependency:added', { taskId, dependsOnTaskId });
  }
  
  checkTaskReadiness(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    
    const allDependenciesComplete = task.dependencies.every(depId => {
      const depTask = this.tasks.get(depId);
      return depTask && depTask.status === 'completed';
    });
    
    if (allDependenciesComplete && task.status === 'pending') {
      task.status = 'ready';
      this.emit('task:ready', task);
    }
  }
  
  // Cleanup and maintenance
  archiveCompletedTasks(olderThanDays = 7) {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const tasksToArchive = [];
    
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' && task.completed < cutoffTime) {
        tasksToArchive.push(task);
        this.tasks.delete(id);
      }
    }
    
    this.emit('tasks:archived', { count: tasksToArchive.length });
    return tasksToArchive;
  }
  
  exportTasks() {
    return {
      tasks: Object.fromEntries(this.tasks),
      workflows: Object.fromEntries(this.workflows),
      activeWorkflow: this.activeWorkflow,
      taskHistory: this.taskHistory,
      exported: Date.now()
    };
  }
  
  importTasks(data) {
    if (data.tasks) {
      this.tasks = new Map(Object.entries(data.tasks));
    }
    if (data.workflows) {
      this.workflows = new Map(Object.entries(data.workflows));
    }
    if (data.activeWorkflow) {
      this.activeWorkflow = data.activeWorkflow;
    }
    if (data.taskHistory) {
      this.taskHistory = data.taskHistory;
    }
    
    this.emit('tasks:imported', { 
      taskCount: this.tasks.size,
      workflowCount: this.workflows.size 
    });
  }
}

// Workflow Builder Helper
class WorkflowBuilder {
  constructor() {
    this.workflow = {
      steps: [],
      metadata: {}
    };
  }
  
  addStep(id, name, required = true, dependencies = []) {
    this.workflow.steps.push({
      id,
      name,
      required,
      dependencies
    });
    return this;
  }
  
  setMetadata(key, value) {
    this.workflow.metadata[key] = value;
    return this;
  }
  
  setName(name) {
    this.workflow.name = name;
    return this;
  }
  
  setDescription(description) {
    this.workflow.description = description;
    return this;
  }
  
  build() {
    if (!this.workflow.name) {
      throw new Error('Workflow must have a name');
    }
    if (this.workflow.steps.length === 0) {
      throw new Error('Workflow must have at least one step');
    }
    
    return { ...this.workflow };
  }
}

module.exports = { TaskManager, WorkflowBuilder };