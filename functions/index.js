const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const storage = admin.storage();

exports.processApplication = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const { name, email, phone, cvFileName } = req.body;
  const cvPublicLink = `https://storage.googleapis.com/YOUR_BUCKET_NAME/cvs/${cvFileName}`;

  // Save to Google Sheets (Optional)
  // Send a confirmation email (Optional)
  
  return res.status(200).json({ message: "Application received", cvLink: cvPublicLink });
});
