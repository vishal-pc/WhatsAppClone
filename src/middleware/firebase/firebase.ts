import admin from "firebase-admin";
import { fireBaseCredentials } from "./firbaseConfig";

admin.initializeApp({
  credential: admin.credential.cert(fireBaseCredentials),
});

export default admin;
