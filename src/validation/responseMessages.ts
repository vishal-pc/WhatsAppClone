export const StatusCodes = {
  Success: {
    Created: 201,
    Ok: 200,
  },
  ClientError: {
    BadRequest: 400,
    Unauthorized: 401,
    NotFound: 404,
    Conflict: 409,
  },
  ServerError: {
    InternalServerError: 500,
  },
};

export const SuccessMessages = {
  ServerRunning: "Server is running... 🚀",
  DataBaseRunning: "Database connected... 👍",
  SampelResponse: "Hello from Node js",
  RegisterSuccess: "Registration successful",
  SignInSuccess: "Sign-in successful",
  SignOutSuccess: "Sign-out successful",
  UserFound: "User found",
  ForgotPasswordSuccess:
    "Reset password OTP has been sent to your email address",
  ResetPasswordSuccess: "Password reset successfully",
  ChangePasswordSuccess: "Password changed successfully",
  UserUpdatedSuccess: "User updated successfully",
  DataFound: "Data found",
};

export const ErrorMessages = {
  ServerError: "Server is not running...😴",
  DatabaseError: "Database not connected...🥱",
  AuthorizeError: "Authorization header not found",
  AuthenticatError: "You are not authenticated!",
  TokenError: "Invalid token or token has expired",
  AccessError: "Unauthorized Access",
  TokenExpire: "Token has expired",
  UserNotFound: "User not found",
  EmailInvalid: "Invalid email format",
  EmalNotFound: "Email not found",
  EmailNotSend: "Email not send",
  OtpError: "Invalid OTP or OTP expired",
  UserExists: (email: string) => `This ${email} email is already exists`,
  IncorrectCredentials: "Incorrect email or password",
  PasswordRequirements:
    "Password must have at least 8 characters,one uppercase, one lowercase, one digit, and one special character (#?!@$%^&*-)",
  InvalidMobileNumber: "Not a valid mobile number",
  IncorrectOldPassword: "The old password does not match.",
  SamePasswordError: "The new password should not be the same as the old one.",
  SomethingWentWrong: "Something went wrong",
  RegisterError: "Error in register",
  LoginError: "Error in login",
  ProfileUpdateError: "Error updating profile",
  MissingFields: (missingFieldsMessage: string) =>
    ` ${missingFieldsMessage} field is required`,
  FileUploadError: "No file uploaded",
  ForgotPasswordError: "Faild to send otp",
  ResetPasswordsError: "Faild to reset password",
  PasswordSameError: "Confirm password and password must be the same",
  DataError: "Data not found",
};
