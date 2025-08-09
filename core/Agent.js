const EventEmitter = require('events');

class CoreAgent extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      model: 'llama3-8b-8192',
      maxTokens: 4000,
      temperature: 0.1,
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1/chat/completions',
      maxHistoryLength: 50,
      contextWindowLimit: 8192, // tokens for llama3-8b-8192
      ...config
    };
    
    this.messageHistory = [];
    this.tools = new Map();
    this.activeSession = null;
    this.currentTask = null;
    this.systemPrompt = '';
    
    // Performance tracking
    this.metrics = {
      totalRequests: 0,
      totalTokens: 0,
      averageResponseTime: 0,
      successRate: 0
    };
    
    this.initialize();
  }
  
  initialize() {
    this.emit('agent:initialized');
    console.log('🤖 Core Agent initialized');
  }
  
  async processMessage(userInput, options = {}) {
    const startTime = Date.now();
    
    try {
      // Validate input
      if (!userInput || typeof userInput !== 'string') {
        throw new Error('Invalid user input');
      }
      
      // Add user message to history
      this.addToHistory('user', userInput);
      
      // Check context window and manage history
      await this.manageContextWindow();
      
      // Prepare API request
      const requestPayload = this.buildAPIRequest(options);
      
      // Call LLM API
      const response = await this.callLLMAPI(requestPayload);
      
      // Process response
      const result = await this.processResponse(response);
      
      // Update metrics
      this.updateMetrics(startTime, true);
      
      this.emit('message:processed', { input: userInput, output: result });
      return result;
      
    } catch (error) {
      this.updateMetrics(startTime, false);
      this.emit('error', error);
      throw error;
    }
  }
  
  addToHistory(role, content, toolCalls = null, toolResults = null) {
    const message = {
      role,
      content,
      timestamp: Date.now(),
      ...(toolCalls && { toolCalls }),
      ...(toolResults && { toolResults })
    };
    
    this.messageHistory.push(message);
    this.emit('history:updated', message);
  }
  
  buildAPIRequest(options = {}) {
    const messages = this.formatMessagesForAPI();
    
    // Add system prompt as first message if it exists
    if (this.systemPrompt) {
      messages.unshift({
        role: 'system',
        content: this.systemPrompt
      });
    }
    
    const request = {
      model: this.config.model,
      max_tokens: Math.min(this.config.maxTokens, 2048), // Reduce max tokens to prevent overflow
      temperature: this.config.temperature,
      messages,
      ...(this.tools.size > 0 && { tools: this.getGroqToolDefinitions() })
    };
    
    // Final safety check - estimate total request size
    const requestSize = JSON.stringify(request).length / 3.5;
    if (requestSize > this.config.contextWindowLimit * 0.9) {
      // Emergency pruning - keep only the most recent messages
      const emergencyMessages = messages.slice(-3); // Keep only last 3 messages + system
      if (this.systemPrompt && emergencyMessages[0].role !== 'system') {
        emergencyMessages.unshift({
          role: 'system',
          content: this.systemPrompt.substring(0, 500) // Truncate system prompt if needed
        });
      }
      request.messages = emergencyMessages;
    }
    
    return request;
  }
  
  formatMessagesForAPI() {
    return this.messageHistory
      .filter(msg => msg.role !== 'system') // System messages handled separately
      .map(msg => ({
        role: msg.role,
        content: msg.content
      }));
  }
  
  async callLLMAPI(payload) {
    const response = await fetch(this.config.baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API Error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }
    
    return await response.json();
  }
  
  async processResponse(apiResponse) {
    const choice = apiResponse.choices[0];
    const message = choice.message;
    
    // Handle text response
    if (message.content) {
      this.addToHistory('assistant', message.content);
      return {
        type: 'text',
        content: message.content,
        usage: apiResponse.usage
      };
    }
    
    // Handle tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      return await this.handleGroqToolCalls(apiResponse);
    }
    
    return {
      type: 'unknown',
      content: message,
      usage: apiResponse.usage
    };
  }
  
  async handleGroqToolCalls(apiResponse) {
    const choice = apiResponse.choices[0];
    const message = choice.message;
    const toolCalls = message.tool_calls;
    
    // Add assistant message with tool calls to history
    this.addToHistory('assistant', message.content || '', toolCalls);
    
    const toolMessages = [];
    
    for (const toolCall of toolCalls) {
      try {
        const result = await this.executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments));
        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
        
        this.emit('tool:executed', { name: toolCall.function.name, input: JSON.parse(toolCall.function.arguments), result });
      } catch (error) {
        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: error.message })
        });
        
        this.emit('tool:error', { name: toolCall.function.name, error });
      }
    }
    
    // Add tool results to history
    toolMessages.forEach(msg => this.addToHistory(msg.role, msg.content));
    
    // Continue conversation with tool results
    const followUpRequest = this.buildAPIRequest();
    followUpRequest.messages.push(...toolMessages);
    
    const followUpResponse = await this.callLLMAPI(followUpRequest);
    return await this.processResponse(followUpResponse);
  }
  
  async executeTool(toolName, input) {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found`);
    }
    
    // Validate input
    if (tool.inputSchema) {
      this.validateToolInput(input, tool.inputSchema);
    }
    
    // Execute tool
    return await tool.execute(input);
  }
  
  validateToolInput(input, schema) {
    // Basic validation - expand as needed
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in input)) {
          throw new Error(`Required field '${field}' missing`);
        }
      }
    }
  }
  
  registerTool(name, tool) {
    if (!tool.execute || typeof tool.execute !== 'function') {
      throw new Error('Tool must have an execute function');
    }
    
    this.tools.set(name, tool);
    this.emit('tool:registered', { name, tool });
    console.log(`🔧 Tool registered: ${name}`);
  }
  
  getToolDefinitions() {
    return Array.from(this.tools.entries()).map(([name, tool]) => ({
      name,
      description: tool.description || `Execute ${name}`,
      input_schema: tool.inputSchema || {
        type: 'object',
        properties: {},
        required: []
      }
    }));
  }
  
  getGroqToolDefinitions() {
    return Array.from(this.tools.entries()).map(([name, tool]) => ({
      type: 'function',
      function: {
        name,
        description: tool.description || `Execute ${name}`,
        parameters: tool.inputSchema || {
          type: 'object',
          properties: {},
          required: []
        }
      }
    }));
  }
  
  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
    this.emit('system:prompt:updated', prompt);
  }
  
  async manageContextWindow() {
    // Better token estimation: 1 token ≈ 3.5 characters on average
    const messageTokens = JSON.stringify(this.messageHistory).length / 3.5;
    const systemTokens = this.systemPrompt ? this.systemPrompt.length / 3.5 : 0;
    const toolTokens = this.tools.size > 0 ? JSON.stringify(this.getGroqToolDefinitions()).length / 3.5 : 0;
    
    const totalEstimatedTokens = messageTokens + systemTokens + toolTokens;
    
    // Use more aggressive pruning - keep only 60% of context limit
    if (totalEstimatedTokens > this.config.contextWindowLimit * 0.6) {
      // Keep fewer messages to leave room for system prompt and tools
      const messagesToKeep = Math.max(5, Math.floor(this.config.maxHistoryLength / 3));
      const recentMessages = this.messageHistory.slice(-messagesToKeep);
      
      this.messageHistory = recentMessages;
      this.emit('context:pruned', { 
        keptMessages: messagesToKeep, 
        estimatedTokens: totalEstimatedTokens,
        contextLimit: this.config.contextWindowLimit 
      });
    }
  }
  
  updateMetrics(startTime, success) {
    this.metrics.totalRequests++;
    
    const responseTime = Date.now() - startTime;
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + responseTime) / 
      this.metrics.totalRequests;
    
    if (success) {
      this.metrics.successRate = 
        (this.metrics.successRate * (this.metrics.totalRequests - 1) + 100) / 
        this.metrics.totalRequests;
    } else {
      this.metrics.successRate = 
        (this.metrics.successRate * (this.metrics.totalRequests - 1)) / 
        this.metrics.totalRequests;
    }
  }
  
  getMetrics() {
    return { ...this.metrics };
  }
  
  clearHistory() {
    this.messageHistory = [];
    this.emit('history:cleared');
  }
  
  saveSession(sessionId) {
    const session = {
      id: sessionId,
      timestamp: Date.now(),
      messageHistory: [...this.messageHistory],
      systemPrompt: this.systemPrompt,
      config: { ...this.config }
    };
    
    this.activeSession = session;
    this.emit('session:saved', session);
    return session;
  }
  
  loadSession(session) {
    this.messageHistory = [...session.messageHistory];
    this.systemPrompt = session.systemPrompt;
    this.activeSession = session;
    
    this.emit('session:loaded', session);
  }
}

module.exports = CoreAgent;