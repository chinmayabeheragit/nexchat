export class ApiResponse<T> {
  public success: boolean;
  public data: T | null;
  public message?: string;
  public errors?: any[];

  constructor(success: boolean, data: T | null, message?: string, errors?: any[]) {
    this.success = success;
    this.data = data;
    this.message = message;
    this.errors = errors;
  }

  static success<T>(data: T, message?: string): ApiResponse<T> {
    return new ApiResponse(true, data, message);
  }

  static error(message: string, errors?: any[]): ApiResponse<null> {
    return new ApiResponse(false, null, message, errors);
  }
}
