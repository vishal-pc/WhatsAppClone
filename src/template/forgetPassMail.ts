export const sendMailForPassword = (fullName: string, otp: string) => {
  return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Password Reset Email</title>
      </head>
      <body
        style="
          font-family: Arial, sans-serif;
          background-color: #f4f4f4;
          padding: 20px;
        "
      >
        <div
          style="
            background-color: #fff;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0px 2px 5px rgba(0, 0, 0, 0.1);
          "
        >
          <strong style="font-size: 24px">Hi ${fullName} 🖐️,</strong>
          <p style="font-size: 16px">
            Forgot your password!<br />We have received a request to reset the
            password for your account 😀
          </p>
          <p style="font-size: 16px">
            If you did not make this request then please ignore this email.
          </p>
          <p style="font-size: 18px; font-weight: bold">
            Otherwise, here is your OTP for password reset:-
            <span style="color: #007bff">${otp} </span>
          </p>
          <p style="font-size: small">
            <strong>Note:-</strong>The OTP will expire within 5 minutes!
          </p>
          <p style="font-size: 16px; font-weight: bold">Best regards,<br />UrbanCart 🛒</p>
        </div>
      </body>
    </html>
    `;
};
