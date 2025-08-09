// Example custom tool
class ExampleTool {
  constructor(config) {
    this.config = config;
    this.description = "An example custom tool that demonstrates the tool interface";
    this.inputSchema = {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Message to process"
        },
        options: {
          type: "object",
          properties: {
            uppercase: { type: "boolean", default: false }
          }
        }
      },
      required: ["message"]
    };
  }
  
  async execute(input) {
    const { message, options = {} } = input;
    
    let result = message;
    
    if (options.uppercase) {
      result = result.toUpperCase();
    }
    
    return {
      success: true,
      originalMessage: message,
      processedMessage: result,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ExampleTool;
