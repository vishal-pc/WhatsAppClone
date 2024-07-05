// password validation
export const passwordRegex =
  /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).{8,}$/;

// email validation
export const emailValidate = (email: string) => {
  if (
    String(email).match(
      /^[A-Za-z0-9._%-]+@(?:[A-Za-z0-9]+\.)+(com|co\.in|yahoo\.com)$/
    )
  ) {
    return true;
  } else {
    return false;
  }
};

// mobile number validation
export const validateMobileNumber = (mobileNumber: string): boolean => {
  const indianMobileRegex = /^[6789]\d{9}$/;
  return indianMobileRegex.test(mobileNumber);
};

// pincode validation
export const validatePinCode = (pinCode: string): boolean => {
  const indianPinCodeRegex = /^\d{6}$/;
  return indianPinCodeRegex.test(pinCode);
};

// Function to shuffle an array
export const shuffleArray = (array: any[]) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};
