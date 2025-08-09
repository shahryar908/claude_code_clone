const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class GitManager {
  constructor(config = {}) {
    this.config = {
      safeMode: true,
      autoStage: false,
      requireConfirmation: true,
      ...config
    };
    
    this.tools = new Map();
    this.registerGitTools();
  }
  
  registerGitTools() {
    // Core Git operations
    this.registerTool('git_status', new GitStatusTool(this.config));
    this.registerTool('git_add', new GitAddTool(this.config));
    this.registerTool('git_commit', new GitCommitTool(this.config));
    this.registerTool('git_push', new GitPushTool(this.config));
    this.registerTool('git_pull', new GitPullTool(this.config));
    
    // Branch operations
    this.registerTool('git_branch', new GitBranchTool(this.config));
    this.registerTool('git_checkout', new GitCheckoutTool(this.config));
    this.registerTool('git_merge', new GitMergeTool(this.config));
    
    // History and diff
    this.registerTool('git_log', new GitLogTool(this.config));
    this.registerTool('git_diff', new GitDiffTool(this.config));
    this.registerTool('git_show', new GitShowTool(this.config));
    
    // Advanced operations
    this.registerTool('git_stash', new GitStashTool(this.config));
    this.registerTool('git_reset', new GitResetTool(this.config));
    this.registerTool('git_revert', new GitRevertTool(this.config));
    
    // Repository management
    this.registerTool('git_init', new GitInitTool(this.config));
    this.registerTool('git_clone', new GitCloneTool(this.config));
    this.registerTool('git_remote', new GitRemoteTool(this.config));
    
    console.log(`🔧 Registered ${this.tools.size} Git tools`);
  }
  
  registerTool(name, tool) {
    if (!tool.execute || typeof tool.execute !== 'function') {
      throw new Error(`Git tool ${name} must have an execute method`);
    }
    
    this.tools.set(name, tool);
  }
  
  async executeTool(name, input) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Git tool '${name}' not found`);
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

// Git Status Tool
class GitStatusTool {
  constructor(config) {
    this.config = config;
    this.description = "Get detailed Git repository status including staged, unstaged, and untracked files";
    this.inputSchema = {
      type: "object",
      properties: {
        working_directory: {
          type: "string",
          description: "Directory to check Git status",
          default: "."
        },
        porcelain: {
          type: "boolean", 
          description: "Use porcelain format for parsing",
          default: true
        }
      }
    };
  }
  
  async execute(input) {
    const { working_directory = '.', porcelain = true } = input;
    
    try {
      // Get basic status
      const statusCmd = porcelain ? 'git status --porcelain' : 'git status';
      const { stdout: status } = await execAsync(statusCmd, { cwd: working_directory });
      
      // Get current branch
      const { stdout: branch } = await execAsync('git branch --show-current', { cwd: working_directory });
      
      // Get remote tracking info
      let remoteInfo = null;
      try {
        const { stdout: remote } = await execAsync('git status -b --porcelain', { cwd: working_directory });
        const remoteLine = remote.split('\n')[0];
        if (remoteLine.includes('[')) {
          remoteInfo = remoteLine.match(/\[(.*?)\]/)?.[1] || null;
        }
      } catch (error) {
        // No remote tracking
      }
      
      // Parse porcelain output
      const files = this.parseGitStatus(status);
      
      return {
        success: true,
        branch: branch.trim(),
        remoteInfo,
        files,
        summary: this.createStatusSummary(files),
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      if (error.message.includes('not a git repository')) {
        return {
          success: false,
          error: 'Not a Git repository',
          working_directory: path.resolve(working_directory)
        };
      }
      throw new Error(`Git status failed: ${error.message}`);
    }
  }
  
  parseGitStatus(status) {
    const files = {
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: []
    };
    
    const lines = status.trim().split('\n').filter(line => line.length > 0);
    
    for (const line of lines) {
      if (line.length < 3) continue;
      
      const stagedStatus = line[0];
      const unstagedStatus = line[1];
      const fileName = line.substring(3);
      
      const fileInfo = { name: fileName, status: line.substring(0, 2) };
      
      // Check for conflicts
      if (stagedStatus === 'U' || unstagedStatus === 'U' || 
          (stagedStatus === 'A' && unstagedStatus === 'A') ||
          (stagedStatus === 'D' && unstagedStatus === 'D')) {
        files.conflicted.push(fileInfo);
      }
      // Staged changes
      else if (stagedStatus !== ' ' && stagedStatus !== '?') {
        files.staged.push(fileInfo);
      }
      // Unstaged changes
      if (unstagedStatus !== ' ' && unstagedStatus !== '?') {
        files.unstaged.push(fileInfo);
      }
      // Untracked files
      if (stagedStatus === '?' && unstagedStatus === '?') {
        files.untracked.push(fileInfo);
      }
    }
    
    return files;
  }
  
  createStatusSummary(files) {
    return {
      staged: files.staged.length,
      unstaged: files.unstaged.length,
      untracked: files.untracked.length,
      conflicted: files.conflicted.length,
      clean: files.staged.length + files.unstaged.length + files.untracked.length === 0
    };
  }
}

// Git Add Tool
class GitAddTool {
  constructor(config) {
    this.config = config;
    this.description = "Stage files for commit with Git add";
    this.inputSchema = {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string" },
          description: "Files to stage (use '.' for all files)"
        },
        working_directory: {
          type: "string",
          description: "Directory to run git add",
          default: "."
        },
        force: {
          type: "boolean",
          description: "Force add ignored files",
          default: false
        }
      },
      required: ["files"]
    };
  }
  
  async execute(input) {
    const { files, working_directory = '.', force = false } = input;
    
    try {
      const fileList = Array.isArray(files) ? files.join(' ') : files;
      const forceFlag = force ? ' --force' : '';
      const command = `git add${forceFlag} ${fileList}`;
      
      const { stdout, stderr } = await execAsync(command, { cwd: working_directory });
      
      // Get updated status
      const { stdout: status } = await execAsync('git status --porcelain', { cwd: working_directory });
      
      return {
        success: true,
        command,
        files: Array.isArray(files) ? files : [files],
        stdout,
        stderr,
        statusAfter: status.trim(),
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git add failed: ${error.message}`);
    }
  }
}

// Git Commit Tool
class GitCommitTool {
  constructor(config) {
    this.config = config;
    this.description = "Commit staged changes with a message";
    this.inputSchema = {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Commit message"
        },
        working_directory: {
          type: "string",
          description: "Directory to run git commit",
          default: "."
        },
        add_all: {
          type: "boolean",
          description: "Add all tracked files before committing (-a flag)",
          default: false
        },
        amend: {
          type: "boolean",
          description: "Amend the last commit",
          default: false
        }
      },
      required: ["message"]
    };
  }
  
  async execute(input) {
    const { message, working_directory = '.', add_all = false, amend = false } = input;
    
    try {
      let command = 'git commit';
      if (add_all) command += ' -a';
      if (amend) command += ' --amend';
      command += ` -m "${message.replace(/"/g, '\\"')}"`;
      
      const { stdout, stderr } = await execAsync(command, { cwd: working_directory });
      
      // Get the commit hash
      const { stdout: hash } = await execAsync('git rev-parse HEAD', { cwd: working_directory });
      
      return {
        success: true,
        message,
        commitHash: hash.trim(),
        stdout,
        stderr,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      if (error.message.includes('nothing to commit')) {
        return {
          success: false,
          error: 'Nothing to commit - no staged changes',
          working_directory: path.resolve(working_directory)
        };
      }
      throw new Error(`Git commit failed: ${error.message}`);
    }
  }
}

// Git Branch Tool
class GitBranchTool {
  constructor(config) {
    this.config = config;
    this.description = "Create, list, or delete Git branches";
    this.inputSchema = {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "delete", "rename"],
          description: "Action to perform",
          default: "list"
        },
        branch_name: {
          type: "string",
          description: "Branch name for create/delete/rename operations"
        },
        new_name: {
          type: "string", 
          description: "New branch name for rename operation"
        },
        working_directory: {
          type: "string",
          description: "Directory to run git branch",
          default: "."
        },
        remote: {
          type: "boolean",
          description: "Include remote branches in list",
          default: false
        }
      }
    };
  }
  
  async execute(input) {
    const { action = 'list', branch_name, new_name, working_directory = '.', remote = false } = input;
    
    try {
      let command;
      let result;
      
      switch (action) {
        case 'list':
          command = remote ? 'git branch -a' : 'git branch';
          const { stdout } = await execAsync(command, { cwd: working_directory });
          result = this.parseBranchList(stdout);
          break;
          
        case 'create':
          if (!branch_name) throw new Error('Branch name required for create action');
          command = `git branch ${branch_name}`;
          await execAsync(command, { cwd: working_directory });
          result = { created: branch_name };
          break;
          
        case 'delete':
          if (!branch_name) throw new Error('Branch name required for delete action');
          command = `git branch -d ${branch_name}`;
          await execAsync(command, { cwd: working_directory });
          result = { deleted: branch_name };
          break;
          
        case 'rename':
          if (!branch_name || !new_name) throw new Error('Both branch names required for rename');
          command = `git branch -m ${branch_name} ${new_name}`;
          await execAsync(command, { cwd: working_directory });
          result = { renamed: { from: branch_name, to: new_name } };
          break;
          
        default:
          throw new Error(`Unknown branch action: ${action}`);
      }
      
      return {
        success: true,
        action,
        command,
        result,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git branch ${action} failed: ${error.message}`);
    }
  }
  
  parseBranchList(output) {
    const lines = output.trim().split('\n');
    const branches = [];
    let currentBranch = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('* ')) {
        currentBranch = trimmed.substring(2);
        branches.push({ name: currentBranch, current: true, remote: false });
      } else if (trimmed.startsWith('remotes/')) {
        branches.push({ name: trimmed, current: false, remote: true });
      } else if (trimmed) {
        branches.push({ name: trimmed, current: false, remote: false });
      }
    }
    
    return { branches, currentBranch };
  }
}

// Git Push Tool
class GitPushTool {
  constructor(config) {
    this.config = config;
    this.description = "Push commits to remote repository";
    this.inputSchema = {
      type: "object",
      properties: {
        remote: {
          type: "string",
          description: "Remote name",
          default: "origin"
        },
        branch: {
          type: "string",
          description: "Branch to push (current branch if not specified)"
        },
        working_directory: {
          type: "string",
          description: "Directory to run git push",
          default: "."
        },
        force: {
          type: "boolean",
          description: "Force push",
          default: false
        }
      }
    };
  }
  
  async execute(input) {
    const { remote = 'origin', branch, working_directory = '.', force = false } = input;
    
    try {
      let command = `git push ${remote}`;
      if (branch) command += ` ${branch}`;
      if (force) command += ' --force';
      
      const { stdout, stderr } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        command,
        remote,
        branch: branch || 'current',
        stdout,
        stderr,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git push failed: ${error.message}`);
    }
  }
}

// Git Pull Tool
class GitPullTool {
  constructor(config) {
    this.config = config;
    this.description = "Pull changes from remote repository";
    this.inputSchema = {
      type: "object",
      properties: {
        remote: {
          type: "string",
          description: "Remote name",
          default: "origin"
        },
        branch: {
          type: "string",
          description: "Branch to pull from"
        },
        working_directory: {
          type: "string",
          description: "Directory to run git pull",
          default: "."
        }
      }
    };
  }
  
  async execute(input) {
    const { remote = 'origin', branch, working_directory = '.' } = input;
    
    try {
      let command = `git pull ${remote}`;
      if (branch) command += ` ${branch}`;
      
      const { stdout, stderr } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        command,
        remote,
        branch: branch || 'current',
        stdout,
        stderr,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git pull failed: ${error.message}`);
    }
  }
}

// Git Checkout Tool  
class GitCheckoutTool {
  constructor(config) {
    this.config = config;
    this.description = "Switch branches or restore files";
    this.inputSchema = {
      type: "object",
      properties: {
        branch_or_file: {
          type: "string",
          description: "Branch name to switch to or file to restore"
        },
        create_branch: {
          type: "boolean",
          description: "Create new branch (-b flag)",
          default: false
        },
        working_directory: {
          type: "string",
          description: "Directory to run git checkout",
          default: "."
        }
      },
      required: ["branch_or_file"]
    };
  }
  
  async execute(input) {
    const { branch_or_file, create_branch = false, working_directory = '.' } = input;
    
    try {
      let command = 'git checkout';
      if (create_branch) command += ' -b';
      command += ` ${branch_or_file}`;
      
      const { stdout, stderr } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        command,
        target: branch_or_file,
        created: create_branch,
        stdout,
        stderr,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git checkout failed: ${error.message}`);
    }
  }
}

// Git Merge Tool
class GitMergeTool {
  constructor(config) {
    this.config = config;
    this.description = "Merge branches";
    this.inputSchema = {
      type: "object",
      properties: {
        branch: {
          type: "string",
          description: "Branch to merge into current branch"
        },
        working_directory: {
          type: "string",
          description: "Directory to run git merge",
          default: "."
        },
        no_ff: {
          type: "boolean",
          description: "Create merge commit even if fast-forward is possible",
          default: false
        }
      },
      required: ["branch"]
    };
  }
  
  async execute(input) {
    const { branch, working_directory = '.', no_ff = false } = input;
    
    try {
      let command = 'git merge';
      if (no_ff) command += ' --no-ff';
      command += ` ${branch}`;
      
      const { stdout, stderr } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        command,
        merged_branch: branch,
        stdout,
        stderr,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      if (error.message.includes('CONFLICT')) {
        return {
          success: false,
          error: 'Merge conflict detected',
          conflicts: true,
          stderr: error.stderr,
          working_directory: path.resolve(working_directory)
        };
      }
      throw new Error(`Git merge failed: ${error.message}`);
    }
  }
}

// Git Diff Tool
class GitDiffTool {
  constructor(config) {
    this.config = config;
    this.description = "Show differences between commits, working tree, etc.";
    this.inputSchema = {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "File, commit, or branch to diff against"
        },
        staged: {
          type: "boolean",
          description: "Show staged changes (--cached)",
          default: false
        },
        working_directory: {
          type: "string",
          description: "Directory to run git diff",
          default: "."
        }
      }
    };
  }
  
  async execute(input) {
    const { target, staged = false, working_directory = '.' } = input;
    
    try {
      let command = 'git diff';
      if (staged) command += ' --cached';
      if (target) command += ` ${target}`;
      
      const { stdout } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        command,
        diff: stdout,
        target: target || (staged ? 'staged' : 'working tree'),
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git diff failed: ${error.message}`);
    }
  }
}

// Git Show Tool
class GitShowTool {
  constructor(config) {
    this.config = config;
    this.description = "Show information about Git objects (commits, tags, etc.)";
    this.inputSchema = {
      type: "object",
      properties: {
        object: {
          type: "string",
          description: "Git object to show (commit hash, tag, etc.)",
          default: "HEAD"
        },
        working_directory: {
          type: "string",
          description: "Directory to run git show",
          default: "."
        }
      }
    };
  }
  
  async execute(input) {
    const { object = 'HEAD', working_directory = '.' } = input;
    
    try {
      const command = `git show ${object}`;
      const { stdout } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        command,
        object,
        content: stdout,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git show failed: ${error.message}`);
    }
  }
}

// Git Stash Tool
class GitStashTool {
  constructor(config) {
    this.config = config;
    this.description = "Stash changes in working directory";
    this.inputSchema = {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["save", "pop", "list", "show", "drop"],
          description: "Stash action to perform",
          default: "save"
        },
        message: {
          type: "string",
          description: "Stash message for save action"
        },
        stash_index: {
          type: "integer",
          description: "Stash index for pop/show/drop actions",
          default: 0
        },
        working_directory: {
          type: "string",
          description: "Directory to run git stash",
          default: "."
        }
      }
    };
  }
  
  async execute(input) {
    const { action = 'save', message, stash_index = 0, working_directory = '.' } = input;
    
    try {
      let command = 'git stash';
      
      switch (action) {
        case 'save':
          if (message) command += ` push -m "${message}"`;
          else command += ' push';
          break;
        case 'pop':
          command += ` pop stash@{${stash_index}}`;
          break;
        case 'list':
          command += ' list';
          break;
        case 'show':
          command += ` show stash@{${stash_index}}`;
          break;
        case 'drop':
          command += ` drop stash@{${stash_index}}`;
          break;
      }
      
      const { stdout } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        action,
        command,
        output: stdout,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git stash ${action} failed: ${error.message}`);
    }
  }
}

// Git Reset Tool
class GitResetTool {
  constructor(config) {
    this.config = config;
    this.description = "Reset current HEAD to specified state";
    this.inputSchema = {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["soft", "mixed", "hard"],
          description: "Reset mode",
          default: "mixed"
        },
        target: {
          type: "string",
          description: "Commit to reset to",
          default: "HEAD"
        },
        working_directory: {
          type: "string",
          description: "Directory to run git reset",
          default: "."
        }
      }
    };
  }
  
  async execute(input) {
    const { mode = 'mixed', target = 'HEAD', working_directory = '.' } = input;
    
    try {
      const command = `git reset --${mode} ${target}`;
      const { stdout } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        command,
        mode,
        target,
        output: stdout,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git reset failed: ${error.message}`);
    }
  }
}

// Git Revert Tool
class GitRevertTool {
  constructor(config) {
    this.config = config;
    this.description = "Revert commits by creating new commits";
    this.inputSchema = {
      type: "object",
      properties: {
        commit: {
          type: "string",
          description: "Commit hash to revert"
        },
        working_directory: {
          type: "string",
          description: "Directory to run git revert",
          default: "."
        }
      },
      required: ["commit"]
    };
  }
  
  async execute(input) {
    const { commit, working_directory = '.' } = input;
    
    try {
      const command = `git revert ${commit}`;
      const { stdout } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        command,
        reverted_commit: commit,
        output: stdout,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git revert failed: ${error.message}`);
    }
  }
}

// Git Init Tool
class GitInitTool {
  constructor(config) {
    this.config = config;
    this.description = "Initialize a new Git repository";
    this.inputSchema = {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory to initialize as Git repo",
          default: "."
        },
        bare: {
          type: "boolean",
          description: "Create bare repository",
          default: false
        }
      }
    };
  }
  
  async execute(input) {
    const { directory = '.', bare = false } = input;
    
    try {
      let command = 'git init';
      if (bare) command += ' --bare';
      
      const { stdout } = await execAsync(command, { cwd: directory });
      
      return {
        success: true,
        command,
        directory: path.resolve(directory),
        bare,
        output: stdout
      };
    } catch (error) {
      throw new Error(`Git init failed: ${error.message}`);
    }
  }
}

// Git Clone Tool
class GitCloneTool {
  constructor(config) {
    this.config = config;
    this.description = "Clone a repository into a new directory";
    this.inputSchema = {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Repository URL to clone"
        },
        directory: {
          type: "string",
          description: "Directory name for cloned repository"
        },
        working_directory: {
          type: "string",
          description: "Parent directory for clone operation",
          default: "."
        }
      },
      required: ["url"]
    };
  }
  
  async execute(input) {
    const { url, directory, working_directory = '.' } = input;
    
    try {
      let command = `git clone ${url}`;
      if (directory) command += ` ${directory}`;
      
      const { stdout } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        command,
        url,
        directory: directory || null,
        output: stdout,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git clone failed: ${error.message}`);
    }
  }
}

// Git Remote Tool
class GitRemoteTool {
  constructor(config) {
    this.config = config;
    this.description = "Manage Git remotes";
    this.inputSchema = {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "add", "remove", "show"],
          description: "Remote action to perform",
          default: "list"
        },
        name: {
          type: "string",
          description: "Remote name for add/remove/show actions"
        },
        url: {
          type: "string",
          description: "Remote URL for add action"
        },
        working_directory: {
          type: "string",
          description: "Directory to run git remote",
          default: "."
        }
      }
    };
  }
  
  async execute(input) {
    const { action = 'list', name, url, working_directory = '.' } = input;
    
    try {
      let command = 'git remote';
      
      switch (action) {
        case 'list':
          command += ' -v';
          break;
        case 'add':
          if (!name || !url) throw new Error('Name and URL required for add action');
          command += ` add ${name} ${url}`;
          break;
        case 'remove':
          if (!name) throw new Error('Name required for remove action');
          command += ` remove ${name}`;
          break;
        case 'show':
          if (!name) throw new Error('Name required for show action');
          command += ` show ${name}`;
          break;
      }
      
      const { stdout } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        action,
        command,
        output: stdout,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git remote ${action} failed: ${error.message}`);
    }
  }
}

// Git Log Tool
class GitLogTool {
  constructor(config) {
    this.config = config;
    this.description = "View Git commit history with various formatting options";
    this.inputSchema = {
      type: "object", 
      properties: {
        limit: {
          type: "integer",
          description: "Number of commits to show",
          default: 10
        },
        oneline: {
          type: "boolean",
          description: "Show one line per commit",
          default: false
        },
        graph: {
          type: "boolean", 
          description: "Show ASCII graph",
          default: false
        },
        working_directory: {
          type: "string",
          description: "Directory to run git log",
          default: "."
        },
        author: {
          type: "string",
          description: "Filter by author"
        },
        since: {
          type: "string",
          description: "Show commits since date (e.g., '2 weeks ago')"
        }
      }
    };
  }
  
  async execute(input) {
    const { limit = 10, oneline = false, graph = false, working_directory = '.', author, since } = input;
    
    try {
      let command = 'git log';
      command += ` -${limit}`;
      
      if (oneline) command += ' --oneline';
      if (graph) command += ' --graph';
      if (author) command += ` --author="${author}"`;
      if (since) command += ` --since="${since}"`;
      
      const { stdout } = await execAsync(command, { cwd: working_directory });
      
      return {
        success: true,
        command,
        commits: oneline ? this.parseOneLineLog(stdout) : stdout,
        working_directory: path.resolve(working_directory)
      };
    } catch (error) {
      throw new Error(`Git log failed: ${error.message}`);
    }
  }
  
  parseOneLineLog(output) {
    return output.trim().split('\n').map(line => {
      const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
      if (match) {
        return { hash: match[1], message: match[2] };
      }
      return { raw: line };
    });
  }
}

// Export all Git tools
module.exports = {
  GitManager,
  GitStatusTool,
  GitAddTool, 
  GitCommitTool,
  GitPushTool,
  GitPullTool,
  GitBranchTool,
  GitCheckoutTool,
  GitMergeTool,
  GitLogTool,
  GitDiffTool,
  GitShowTool,
  GitStashTool,
  GitResetTool,
  GitRevertTool,
  GitInitTool,
  GitCloneTool,
  GitRemoteTool
};