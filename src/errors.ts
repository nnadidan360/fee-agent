export class AuthError extends Error {
  readonly statusCode = 401;

  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  readonly statusCode = 400;
  readonly fields?: Record<string, string>;

  constructor(message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

export class BAGSApiError extends Error {
  readonly statusCode: number;
  readonly apiMessage: string;

  constructor(statusCode: number, apiMessage: string) {
    super(`BAGS API error ${statusCode}: ${apiMessage}`);
    this.name = 'BAGSApiError';
    this.statusCode = statusCode;
    this.apiMessage = apiMessage;
  }
}

export class ActionExecutionError extends Error {
  readonly actionType: string;
  readonly bagsMessage: string;
  readonly attemptedAmount: number;

  constructor(actionType: string, bagsMessage: string, attemptedAmount: number) {
    super(`Action execution failed [${actionType}]: ${bagsMessage}`);
    this.name = 'ActionExecutionError';
    this.actionType = actionType;
    this.bagsMessage = bagsMessage;
    this.attemptedAmount = attemptedAmount;
  }
}
